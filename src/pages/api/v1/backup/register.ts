/**
 * POST /api/v1/backup/register - Register a new backup key
 *
 * Request Body:
 * {
 *   "backupKey": "A1B-C2D-E3F",
 *   "publicKey": "<base64-encoded Ed25519 public key>"
 * }
 *
 * Security:
 * - App Attest assertion in X-Apple-Assertion header (iOS 14+)
 * - Rate limiting: 10 registrations per hour per IP
 * - Keys are permanently reserved (never reused)
 */

import type { APIRoute } from 'astro';
import { verifyAppAttestAssertion, checkRateLimit } from '../../../../lib/crypto';

export const prerender = false;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Apple-Assertion',
};

// Backup key format: 3 sets of 3 alphanumerics separated by dashes
const BACKUP_KEY_REGEX = /^[A-Z2-9]{3}-[A-Z2-9]{3}-[A-Z2-9]{3}$/;

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
};

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  const env = (locals.runtime as any)?.env;
  const kv = env?.BACKUPS;

  if (!kv) {
    return new Response(
      JSON.stringify({ error: 'Storage not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  try {
    // Rate limiting: 10 registrations per hour per IP
    const rateLimitKey = `ratelimit:${clientAddress}:register-backup`;
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
    const { backupKey, publicKey } = body;

    // Validate required fields
    if (!backupKey || !publicKey) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: backupKey, publicKey' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Validate backup key format (3 sets of 3 alphanumerics, excluding confusing chars)
    if (!BACKUP_KEY_REGEX.test(backupKey)) {
      return new Response(
        JSON.stringify({ error: 'Invalid backup key format (must be XXX-XXX-XXX with A-Z, 2-9)' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Verify App Attest assertion
    const assertion = request.headers.get('X-Apple-Assertion');
    const attestResult = await verifyAppAttestAssertion(
      assertion,
      {
        method: 'POST',
        path: '/api/v1/backup/register',
        bodyHash: await hashBody(JSON.stringify({ backupKey, publicKey }))
      },
      env
    );

    if (!attestResult.valid) {
      return new Response(
        JSON.stringify({ error: attestResult.error || 'Invalid app attestation' }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Check if backup key already exists in registry
    const existingEntry = await kv.get(`backup-registry:${backupKey}`);
    if (existingEntry) {
      return new Response(
        JSON.stringify({ error: 'Backup key already registered' }),
        { status: 409, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Create registry entry (permanent - no TTL)
    const registryEntry = {
      publicKey,
      createdAt: new Date().toISOString(),
      createdIp: clientAddress
    };

    await kv.put(`backup-registry:${backupKey}`, JSON.stringify(registryEntry));

    return new Response(null, {
      status: 201,
      headers: {
        'X-RateLimit-Remaining': rateLimit.remaining.toString(),
        ...CORS_HEADERS
      }
    });

  } catch (error) {
    console.error('Error registering backup key:', error);
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
