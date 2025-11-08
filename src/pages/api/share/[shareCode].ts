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

    // Update access tracking
    share.accessCount = (share.accessCount || 0) + 1;
    share.lastAccessed = new Date().toISOString();
    await kv.put(`share:${shareCode}`, JSON.stringify(share), {
      expirationTtl: 90 * 24 * 60 * 60  // Keep 90-day expiration
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

    // Update share
    share.snapshotData = snapshotData;
    share.publicKey = publicKey;
    share.updatedAt = new Date().toISOString();

    await kv.put(`share:${shareCode}`, JSON.stringify(share), {
      expirationTtl: 90 * 24 * 60 * 60  // Keep 90-day expiration
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

    // Delete share
    await kv.delete(`share:${shareCode}`);

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
