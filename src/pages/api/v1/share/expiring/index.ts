/**
 * POST /api/v1/share/expiring - Create a new expiring share alias
 *
 * Request Body:
 * {
 *   "mainShareCode": "ABC123",
 *   "displayName": "GAS 2025 Share",
 *   "shareNotes": "Available during conference only",
 *   "expirationDuration": 86400  // seconds (1 day)
 * }
 *
 * Response:
 * {
 *   "shareCode": "XYZ789",
 *   "expiresAt": "2025-01-20T15:30:00Z"
 * }
 *
 * Security:
 * - App Attest assertion in X-Apple-Assertion header (iOS 14+)
 * - Rate limiting: 20 creates per hour per IP
 */

import type { APIRoute } from 'astro';
import { verifyAppAttestAssertion, checkRateLimit } from '../../../../../lib/crypto';

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
    // Rate limiting: 20 creates per hour per IP
    const rateLimitKey = `ratelimit:${clientAddress}:create-expiring-share`;
    const rateLimit = await checkRateLimit(env, rateLimitKey, 20, 60);

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
    const { mainShareCode, displayName, shareNotes, expirationDuration } = body;

    // Validate required fields
    if (!mainShareCode || !displayName || !expirationDuration) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: mainShareCode, displayName, expirationDuration' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Validate main share code format (6 characters, alphanumeric)
    if (!/^[A-Z0-9]{6}$/.test(mainShareCode)) {
      return new Response(
        JSON.stringify({ error: 'Invalid main share code format (must be 6 uppercase alphanumeric characters)' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Validate expiration duration (max 30 days + 23 hours)
    const maxDuration = (30 * 24 * 60 * 60) + (23 * 60 * 60); // 30 days + 23 hours in seconds
    if (expirationDuration < 3600 || expirationDuration > maxDuration) {
      return new Response(
        JSON.stringify({ error: 'Invalid expiration duration (must be between 1 hour and 30 days + 23 hours)' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Verify App Attest assertion
    const assertion = request.headers.get('X-Apple-Assertion');
    const attestResult = await verifyAppAttestAssertion(
      assertion,
      {
        method: 'POST',
        path: '/api/v1/share/expiring',
        bodyHash: await hashBody(JSON.stringify(body))
      },
      env
    );

    if (!attestResult.valid) {
      return new Response(
        JSON.stringify({ error: attestResult.error || 'Invalid app attestation' }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Verify main share exists
    console.log(`🔍 [SERVER] Looking for main share: share:${mainShareCode}`);
    const mainShare = await kv.get(`share:${mainShareCode}`);
    console.log(`🔍 [SERVER] Main share found:`, mainShare ? 'YES' : 'NO');
    if (!mainShare) {
      console.log(`🔍 [SERVER] Main share not found for code: ${mainShareCode}`);
      return new Response(
        JSON.stringify({ error: 'Main share not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Generate unique share code
    const shareCode = await generateUniqueShareCode(kv);

    // Calculate expiration
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (expirationDuration * 1000));

    // Create expiring share object
    const expiringShare = {
      shareCode,
      mainShareCode,
      displayName,
      shareNotes: shareNotes || null,
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
      createdIp: clientAddress,
      accessCount: 0,
      lastAccessed: null
    };

    // Store in KV with TTL matching expiration
    const ttlSeconds = Math.max(60, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    await kv.put(`expiring:${shareCode}`, JSON.stringify(expiringShare), {
      expirationTtl: ttlSeconds
    });

    // Also store in index for listing by main share code
    const indexKey = `expiring-index:${mainShareCode}`;
    const existingIndex = await kv.get(indexKey);
    const shareCodes = existingIndex ? JSON.parse(existingIndex) : [];
    shareCodes.push(shareCode);

    // Index TTL should match the longest expiring share
    await kv.put(indexKey, JSON.stringify(shareCodes), {
      expirationTtl: ttlSeconds
    });

    return new Response(
      JSON.stringify({
        shareCode,
        expiresAt: expiresAt.toISOString()
      }),
      {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining': rateLimit.remaining.toString(),
          ...CORS_HEADERS
        }
      }
    );

  } catch (error) {
    console.error('Error creating expiring share:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
};

/**
 * Generate a unique 6-character share code
 */
async function generateUniqueShareCode(kv: any): Promise<string> {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    // Check both regular and expiring share namespaces
    const regularExists = await kv.get(`share:${code}`);
    const expiringExists = await kv.get(`expiring:${code}`);

    if (!regularExists && !expiringExists) {
      return code;
    }

    attempts++;
  }

  throw new Error('Failed to generate unique share code after maximum attempts');
}

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
