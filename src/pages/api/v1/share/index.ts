/**
 * POST /api/v1/share - Create a new inventory share
 *
 * Request Body:
 * {
 *   "shareCode": "ABC123",
 *   "snapshotData": "<base64-encoded snapshot>",
 *   "publicKey": "<base64-encoded Ed25519 public key>"
 * }
 *
 * Security:
 * - App Attest assertion in X-Apple-Assertion header (iOS 14+)
 * - Rate limiting: 10 creates per hour per IP
 */

import type { APIRoute } from 'astro';
import { verifyAppAttestAssertion, checkRateLimit } from '../../../../lib/crypto';

export const prerender = false;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Apple-Assertion',
};

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
};

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  const env = (locals.runtime as any)?.env;
  const kv = env?.INVENTORY_SHARES;

  if (!kv) {
    return new Response(
      JSON.stringify({ error: 'Storage not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  try {
    // Rate limiting: 10 creates per hour per IP
    const rateLimitKey = `ratelimit:${clientAddress}:create-share`;
    const rateLimit = await checkRateLimit(env, rateLimitKey, 10, 60);

    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({
          error: 'Rate limit exceeded',
          resetAt: rateLimit.resetAt.toISOString()
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': rateLimit.resetAt.toISOString(),
            ...CORS_HEADERS
          }
        }
      );
    }

    // Parse request body
    const body = await request.json();
    const { shareCode, snapshotData, publicKey } = body;

    // Validate required fields
    if (!shareCode || !snapshotData || !publicKey) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: shareCode, snapshotData, publicKey' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Validate share code format (6 characters, alphanumeric)
    if (!/^[A-Z0-9]{6}$/.test(shareCode)) {
      return new Response(
        JSON.stringify({ error: 'Invalid share code format (must be 6 uppercase alphanumeric characters)' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Verify App Attest assertion
    const assertion = request.headers.get('X-Apple-Assertion');
    const attestResult = await verifyAppAttestAssertion(
      assertion,
      {
        method: 'POST',
        path: '/api/v1/share',
        bodyHash: await hashBody(snapshotData)
      },
      env
    );

    if (!attestResult.valid) {
      return new Response(
        JSON.stringify({ error: attestResult.error || 'Invalid app attestation' }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Check if share code already exists
    const existingShare = await kv.get(`share:${shareCode}`);
    if (existingShare) {
      return new Response(
        JSON.stringify({ error: 'Share code already exists' }),
        { status: 409, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Extract snapshot timestamp for TTL calculation
    const snapshotTimestamp = extractSnapshotTimestamp(snapshotData);
    const now = new Date().toISOString();

    // Calculate expiration date (90 days from snapshot timestamp)
    const snapshotDate = new Date(snapshotTimestamp || now);
    const expirationDate = new Date(snapshotDate.getTime() + (90 * 24 * 60 * 60 * 1000));
    const ttlSeconds = Math.max(60, Math.floor((expirationDate.getTime() - Date.now()) / 1000));

    // Create share object
    const share = {
      shareCode,
      snapshotData,
      publicKey,
      snapshotTimestamp: snapshotTimestamp || now,  // Use extracted timestamp or fallback to now
      expiresAt: expirationDate.toISOString(),  // Include expiration date in share object
      createdAt: now,
      createdIp: clientAddress,
      accessCount: 0,
      lastAccessed: null
    };

    // Store in KV (expires 90 days from snapshot timestamp)
    await kv.put(`share:${shareCode}`, JSON.stringify(share), {
      expirationTtl: ttlSeconds
    });

    return new Response(null, {
      status: 201,
      headers: {
        'X-RateLimit-Remaining': rateLimit.remaining.toString(),
        ...CORS_HEADERS
      }
    });

  } catch (error) {
    console.error('Error creating share:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
};

/**
 * Hash body for App Attest verification
 */
async function hashBody(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Extract snapshot timestamp from base64-encoded snapshot data
 * Format: [length:4 bytes][JSON:N bytes][signature:64 bytes]
 * @param snapshotData Base64-encoded snapshot blob
 * @returns ISO 8601 timestamp string, or null if parsing fails
 */
function extractSnapshotTimestamp(snapshotData: string): string | null {
  try {
    // Decode base64
    const binaryString = atob(snapshotData);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Extract JSON length (first 4 bytes, little-endian Int32)
    const lengthSize = 4;
    const signatureSize = 64;

    if (bytes.length < lengthSize + signatureSize) {
      return null;
    }

    const jsonLength = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);

    // Validate length
    if (jsonLength < 0 || bytes.length !== lengthSize + jsonLength + signatureSize) {
      return null;
    }

    // Extract JSON data
    const jsonBytes = bytes.slice(lengthSize, lengthSize + jsonLength);
    const jsonString = new TextDecoder().decode(jsonBytes);
    const payload = JSON.parse(jsonString);

    // Return timestamp from payload
    return payload.timestamp || null;
  } catch (error) {
    console.error('Failed to extract snapshot timestamp:', error);
    return null;
  }
}
