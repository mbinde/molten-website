/**
 * GET /api/share/:shareCode - Download a friend's share
 * PUT /api/share/:shareCode - Update existing share (requires ownership signature)
 * DELETE /api/share/:shareCode - Delete share (requires ownership signature)
 *
 * Security:
 * - App Attest assertion in X-Apple-Assertion header (iOS 14+)
 * - Ownership signature in X-Ownership-Signature header (PUT/DELETE only)
 * - Rate limiting: 60 downloads per hour per IP
 */

import type { APIRoute } from 'astro';
import { verifyAppAttestAssertion, verifyEd25519Signature, checkRateLimit } from '../../../lib/crypto';

export const prerender = false;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Apple-Assertion, X-Ownership-Signature',
};

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
};

export const GET: APIRoute = async ({ params, request, locals, clientAddress }) => {
  const env = (locals.runtime as any)?.env;
  const kv = env?.INVENTORY_SHARES;

  if (!kv) {
    return new Response(
      JSON.stringify({ error: 'Storage not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  try {
    const { shareCode } = params;

    if (!shareCode) {
      return new Response(
        JSON.stringify({ error: 'Share code required' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Rate limiting: 60 downloads per hour per IP
    const rateLimitKey = `ratelimit:${clientAddress}:download-share`;
    const rateLimit = await checkRateLimit(env, rateLimitKey, 60, 60);

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

    // Verify App Attest assertion
    const assertion = request.headers.get('X-Apple-Assertion');
    const attestResult = await verifyAppAttestAssertion(
      assertion,
      {
        method: 'GET',
        path: `/api/share/${shareCode}`
      },
      env
    );

    if (!attestResult.valid) {
      return new Response(
        JSON.stringify({ error: attestResult.error || 'Invalid app attestation' }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Fetch share from KV
    const shareData = await kv.get(`share:${shareCode}`);

    if (!shareData) {
      return new Response(
        JSON.stringify({ error: 'Share not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    const share = JSON.parse(shareData);

    // Update access tracking (but DON'T reset TTL - we want expiration based on owner's last update)
    share.accessCount = (share.accessCount || 0) + 1;
    share.lastAccessed = new Date().toISOString();

    // Calculate remaining TTL based on original snapshot timestamp
    const snapshotDate = new Date(share.snapshotTimestamp || share.createdAt);
    const expirationDate = new Date(snapshotDate.getTime() + (90 * 24 * 60 * 60 * 1000));
    const ttlSeconds = Math.max(60, Math.floor((expirationDate.getTime() - Date.now()) / 1000));

    // Update share metadata but preserve the original TTL
    await kv.put(`share:${shareCode}`, JSON.stringify(share), {
      expirationTtl: ttlSeconds  // Preserve original expiration based on snapshot timestamp
    });

    // Return share data
    return new Response(
      JSON.stringify({
        snapshotData: share.snapshotData,
        publicKey: share.publicKey
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining': rateLimit.remaining.toString(),
          ...CORS_HEADERS
        }
      }
    );

  } catch (error) {
    console.error('Error downloading share:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
};

export const PUT: APIRoute = async ({ params, request, locals, clientAddress }) => {
  const env = (locals.runtime as any)?.env;
  const kv = env?.INVENTORY_SHARES;

  if (!kv) {
    return new Response(
      JSON.stringify({ error: 'Storage not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  try {
    const { shareCode } = params;

    if (!shareCode) {
      return new Response(
        JSON.stringify({ error: 'Share code required' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Rate limiting: 30 updates per hour per IP
    const rateLimitKey = `ratelimit:${clientAddress}:update-share`;
    const rateLimit = await checkRateLimit(env, rateLimitKey, 30, 60);

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
            ...CORS_HEADERS
          }
        }
      );
    }

    // Parse request body
    const body = await request.json();
    const { snapshotData, publicKey } = body;

    if (!snapshotData || !publicKey) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: snapshotData, publicKey' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Verify App Attest assertion
    const assertion = request.headers.get('X-Apple-Assertion');
    const attestResult = await verifyAppAttestAssertion(
      assertion,
      {
        method: 'PUT',
        path: `/api/share/${shareCode}`,
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

    // Fetch existing share
    const shareData = await kv.get(`share:${shareCode}`);

    if (!shareData) {
      return new Response(
        JSON.stringify({ error: 'Share not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    const share = JSON.parse(shareData);

    // Verify ownership signature
    const ownershipSignature = request.headers.get('X-Ownership-Signature');

    if (!ownershipSignature) {
      return new Response(
        JSON.stringify({ error: 'Missing ownership signature' }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    const isValidOwnership = await verifyEd25519Signature(
      ownershipSignature,
      shareCode,
      share.publicKey
    );

    if (!isValidOwnership) {
      return new Response(
        JSON.stringify({ error: 'Invalid ownership signature' }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Extract new snapshot timestamp for updated TTL
    const snapshotTimestamp = extractSnapshotTimestamp(snapshotData);
    const now = new Date().toISOString();

    // Update share with new snapshot and timestamp
    share.snapshotData = snapshotData;
    share.publicKey = publicKey;
    share.snapshotTimestamp = snapshotTimestamp || now;  // Update to new snapshot timestamp
    share.updatedAt = now;

    // Calculate NEW TTL based on updated snapshot timestamp (resets to 90 days from new update)
    const snapshotDate = new Date(snapshotTimestamp || now);
    const expirationDate = new Date(snapshotDate.getTime() + (90 * 24 * 60 * 60 * 1000));
    const ttlSeconds = Math.max(60, Math.floor((expirationDate.getTime() - Date.now()) / 1000));

    await kv.put(`share:${shareCode}`, JSON.stringify(share), {
      expirationTtl: ttlSeconds  // Reset to 90 days from new snapshot timestamp
    });

    return new Response(null, {
      status: 200,
      headers: {
        'X-RateLimit-Remaining': rateLimit.remaining.toString(),
        ...CORS_HEADERS
      }
    });

  } catch (error) {
    console.error('Error updating share:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
};

export const DELETE: APIRoute = async ({ params, request, locals, clientAddress }) => {
  const env = (locals.runtime as any)?.env;
  const kv = env?.INVENTORY_SHARES;

  if (!kv) {
    return new Response(
      JSON.stringify({ error: 'Storage not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  try {
    const { shareCode } = params;

    if (!shareCode) {
      return new Response(
        JSON.stringify({ error: 'Share code required' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Rate limiting: 30 deletes per hour per IP
    const rateLimitKey = `ratelimit:${clientAddress}:delete-share`;
    const rateLimit = await checkRateLimit(env, rateLimitKey, 30, 60);

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
            ...CORS_HEADERS
          }
        }
      );
    }

    // Verify App Attest assertion
    const assertion = request.headers.get('X-Apple-Assertion');
    const attestResult = await verifyAppAttestAssertion(
      assertion,
      {
        method: 'DELETE',
        path: `/api/share/${shareCode}`
      },
      env
    );

    if (!attestResult.valid) {
      return new Response(
        JSON.stringify({ error: attestResult.error || 'Invalid app attestation' }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Fetch existing share
    const shareData = await kv.get(`share:${shareCode}`);

    if (!shareData) {
      return new Response(
        JSON.stringify({ error: 'Share not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    const share = JSON.parse(shareData);

    // Verify ownership signature
    const ownershipSignature = request.headers.get('X-Ownership-Signature');

    console.log('🔐 [SERVER DELETE] Share code:', shareCode);
    console.log('🔐 [SERVER DELETE] Stored public key:', share.publicKey?.substring(0, 20) + '...');
    console.log('🔐 [SERVER DELETE] Received signature:', ownershipSignature?.substring(0, 20) + '...');

    if (!ownershipSignature) {
      console.log('🔐 [SERVER DELETE] ERROR: Missing ownership signature');
      return new Response(
        JSON.stringify({ error: 'Missing ownership signature' }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    const isValidOwnership = await verifyEd25519Signature(
      ownershipSignature,
      shareCode,
      share.publicKey
    );

    console.log('🔐 [SERVER DELETE] Signature valid:', isValidOwnership);

    if (!isValidOwnership) {
      console.log('🔐 [SERVER DELETE] ERROR: Invalid ownership signature');
      return new Response(
        JSON.stringify({
          error: 'Invalid ownership signature',
          debug: {
            shareCode,
            storedPublicKey: share.publicKey?.substring(0, 40) + '...',
            receivedSignature: ownershipSignature?.substring(0, 40) + '...'
          }
        }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    console.log('🔐 [SERVER DELETE] Deleting share');
    // Delete share
    await kv.delete(`share:${shareCode}`);

    console.log('🔐 [SERVER DELETE] SUCCESS');
    return new Response(null, {
      status: 204,
      headers: {
        'X-RateLimit-Remaining': rateLimit.remaining.toString(),
        ...CORS_HEADERS
      }
    });

  } catch (error) {
    console.error('Error deleting share:', error);
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
