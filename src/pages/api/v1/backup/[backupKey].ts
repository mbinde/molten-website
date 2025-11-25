/**
 * POST /api/v1/backup/:backupKey - Upload a backup
 * GET /api/v1/backup/:backupKey?type=inventory - Get latest backup of a type
 *
 * POST Request Body:
 * {
 *   "type": "inventory" | "tags",
 *   "data": "<base64-encoded backup data>",
 *   "checksum": "<sha256 hash of the data for deduplication>"
 * }
 *
 * Security:
 * - App Attest assertion in X-Apple-Assertion header (iOS 14+)
 * - Ownership signature in X-Ownership-Signature header (POST only)
 * - Rate limiting: 30 uploads per hour, 60 downloads per hour per IP
 * - Up to 50 backups kept per type
 */

import type { APIRoute } from 'astro';
import { verifyAppAttestAssertion, verifyEd25519Signature, checkRateLimit } from '../../../../lib/crypto';

export const prerender = false;
const BACKUP_KEY_REGEX = /^[A-Z2-9]{3}-[A-Z2-9]{3}-[A-Z2-9]{3}$/;
const VALID_BACKUP_TYPES = ['inventory', 'tags'];
const MAX_BACKUPS_PER_TYPE = 50;
const BACKUP_TTL_DAYS = 365; // Keep backups for 1 year
export const GET: APIRoute = async ({ params, request, locals, clientAddress }) => {
  const env = (locals.runtime as any)?.env;
  const kv = env?.BACKUPS;

  if (!kv) {
    return new Response(
      JSON.stringify({ error: 'Storage not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const { backupKey } = params;
    const url = new URL(request.url);
    const type = url.searchParams.get('type');

    if (!backupKey || !BACKUP_KEY_REGEX.test(backupKey)) {
      return new Response(
        JSON.stringify({ error: 'Invalid backup key format' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!type || !VALID_BACKUP_TYPES.includes(type)) {
      return new Response(
        JSON.stringify({ error: 'Invalid or missing type parameter (must be: inventory, tags)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Rate limiting: 60 downloads per hour per IP
    const rateLimitKey = `ratelimit:${clientAddress}:download-backup`;
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
        path: `/api/v1/backup/${backupKey}`
      },
      env
    );

    if (!attestResult.valid) {
      return new Response(
        JSON.stringify({ error: attestResult.error || 'Invalid app attestation' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if backup key is registered
    const registryEntry = await kv.get(`backup-registry:${backupKey}`);
    if (!registryEntry) {
      return new Response(
        JSON.stringify({ error: 'Backup key not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get the index of backups for this key and type
    const indexKey = `backup-index:${backupKey}:${type}`;
    const indexData = await kv.get(indexKey);

    if (!indexData) {
      return new Response(
        JSON.stringify({ error: 'No backups found for this type' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const index: BackupIndexEntry[] = JSON.parse(indexData);
    if (index.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No backups found for this type' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get the latest backup (last in the sorted index)
    const latestEntry = index[index.length - 1];
    const backupData = await kv.get(`backup:${backupKey}:${type}:${latestEntry.timestamp}`);

    if (!backupData) {
      return new Response(
        JSON.stringify({ error: 'Backup data not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const backup = JSON.parse(backupData);

    return new Response(
      JSON.stringify({
        data: backup.data,
        checksum: backup.checksum,
        timestamp: latestEntry.timestamp,
        backupCount: index.length
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining': rateLimit.remaining.toString(),
          
        }
      }
    );

  } catch (error) {
    console.error('Error downloading backup:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST: APIRoute = async ({ params, request, locals, clientAddress }) => {
  const env = (locals.runtime as any)?.env;
  const kv = env?.BACKUPS;

  if (!kv) {
    return new Response(
      JSON.stringify({ error: 'Storage not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const { backupKey } = params;

    if (!backupKey || !BACKUP_KEY_REGEX.test(backupKey)) {
      return new Response(
        JSON.stringify({ error: 'Invalid backup key format' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Rate limiting: 30 uploads per hour per IP
    const rateLimitKey = `ratelimit:${clientAddress}:upload-backup`;
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
            
          }
        }
      );
    }

    // Parse request body
    const body = await request.json();
    const { type, data, checksum } = body;

    if (!type || !data || !checksum) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: type, data, checksum' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!VALID_BACKUP_TYPES.includes(type)) {
      return new Response(
        JSON.stringify({ error: 'Invalid type (must be: inventory, tags)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify App Attest assertion
    const assertion = request.headers.get('X-Apple-Assertion');
    const attestResult = await verifyAppAttestAssertion(
      assertion,
      {
        method: 'POST',
        path: `/api/v1/backup/${backupKey}`,
        bodyHash: await hashBody(data)
      },
      env
    );

    if (!attestResult.valid) {
      return new Response(
        JSON.stringify({ error: attestResult.error || 'Invalid app attestation' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get registry entry to verify ownership
    const registryData = await kv.get(`backup-registry:${backupKey}`);
    if (!registryData) {
      return new Response(
        JSON.stringify({ error: 'Backup key not registered' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const registry = JSON.parse(registryData);

    // Verify ownership signature
    const ownershipSignature = request.headers.get('X-Ownership-Signature');
    if (!ownershipSignature) {
      return new Response(
        JSON.stringify({ error: 'Missing ownership signature' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const isValidOwnership = await verifyEd25519Signature(
      ownershipSignature,
      backupKey,
      registry.publicKey
    );

    if (!isValidOwnership) {
      return new Response(
        JSON.stringify({ error: 'Invalid ownership signature' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get current backup index for this type
    const indexKey = `backup-index:${backupKey}:${type}`;
    const indexData = await kv.get(indexKey);
    let index: BackupIndexEntry[] = indexData ? JSON.parse(indexData) : [];

    // Check if the latest backup has the same checksum (skip duplicate)
    if (index.length > 0) {
      const latestEntry = index[index.length - 1];
      if (latestEntry.checksum === checksum) {
        // Data hasn't changed - just update lastChecked timestamp
        return new Response(
          JSON.stringify({
            message: 'Backup unchanged',
            skipped: true,
            latestTimestamp: latestEntry.timestamp
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'X-RateLimit-Remaining': rateLimit.remaining.toString(),
              
            }
          }
        );
      }
    }

    // Create new backup
    const now = new Date().toISOString();
    const ttlSeconds = BACKUP_TTL_DAYS * 24 * 60 * 60;

    const backupEntry = {
      data,
      checksum,
      createdAt: now
    };

    // Store the backup data
    const backupDataKey = `backup:${backupKey}:${type}:${now}`;
    await kv.put(backupDataKey, JSON.stringify(backupEntry), {
      expirationTtl: ttlSeconds
    });

    // Add to index
    index.push({
      timestamp: now,
      checksum
    });

    // If we have more than MAX_BACKUPS_PER_TYPE, remove the oldest ones
    while (index.length > MAX_BACKUPS_PER_TYPE) {
      const oldest = index.shift()!;
      await kv.delete(`backup:${backupKey}:${type}:${oldest.timestamp}`);
    }

    // Update the index
    await kv.put(indexKey, JSON.stringify(index), {
      expirationTtl: ttlSeconds
    });

    return new Response(
      JSON.stringify({
        message: 'Backup created',
        timestamp: now,
        backupCount: index.length
      }),
      {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining': rateLimit.remaining.toString(),
          
        }
      }
    );

  } catch (error) {
    console.error('Error uploading backup:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

interface BackupIndexEntry {
  timestamp: string;
  checksum: string;
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
