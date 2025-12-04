/**
 * POST /api/v1/admin/upload-labels - Upload new label database version to KV
 *
 * Purpose:
 * - Allow authenticated admin to upload new label database versions
 * - Calculate checksum and store SQLite database
 * - Store in KV for OTA updates
 *
 * Security:
 * - CATALOG_API_KEY required in Authorization header (Bearer token)
 * - Rate limiting: 10 requests/hour per IP
 *
 * Request:
 * - Content-Type: multipart/form-data
 * - Fields:
 *   - database: SQLite database file
 *   - version: Version number (integer)
 *   - changelog: Description of changes (optional)
 *   - min_app_version: Minimum app version required
 *
 * Response:
 * {
 *   "success": true,
 *   "version": 1,
 *   "fileSize": 123456,
 *   "checksum": "sha256:abc123def456..."
 * }
 */

import type { APIRoute } from 'astro';
import {
  storeLabelVersion,
  calculateChecksum,
  checkLabelRateLimit
} from '../../../../lib/labels';
import type { LabelVersion } from '../../../../lib/labels';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  const env = (locals.runtime as any)?.env;
  const kv = env?.CATALOG_VERSIONS;  // Reusing same KV namespace with different key prefix

  if (!kv) {
    return new Response(
      JSON.stringify({ error: 'Label storage not configured' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        }
      }
    );
  }

  try {
    // 1. Verify authentication
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid Authorization header' }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
          }
        }
      );
    }

    const providedKey = authHeader.substring(7); // Remove "Bearer "
    const catalogApiKey = env.CATALOG_API_KEY;

    if (!catalogApiKey || providedKey !== catalogApiKey) {
      return new Response(
        JSON.stringify({ error: 'Invalid API key' }),
        {
          status: 403,
          headers: {
            'Content-Type': 'application/json',
          }
        }
      );
    }

    // 2. Rate limiting: 10 requests per hour per IP
    const ipAddress = clientAddress || 'unknown';
    const rateLimit = await checkLabelRateLimit(
      kv,
      `admin:${ipAddress}`,
      'upload_labels',
      10,
      60
    );

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
            'Retry-After': Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 1000).toString(),
          }
        }
      );
    }

    // 3. Parse multipart form data
    const contentType = request.headers.get('Content-Type') || '';

    let databaseData: Uint8Array;
    let version: number;
    let changelog: string | null = null;
    let minAppVersion: string;

    if (contentType.includes('multipart/form-data')) {
      // Parse multipart form data
      const formData = await request.formData();

      const databaseFile = formData.get('database') as File | null;
      const versionStr = formData.get('version') as string | null;
      changelog = formData.get('changelog') as string | null;
      minAppVersion = formData.get('min_app_version') as string || '1.0.0';

      if (!databaseFile) {
        return new Response(
          JSON.stringify({ error: 'Missing "database" file in form data' }),
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
            }
          }
        );
      }

      if (!versionStr) {
        return new Response(
          JSON.stringify({ error: 'Missing "version" field in form data' }),
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
            }
          }
        );
      }

      version = parseInt(versionStr, 10);
      if (isNaN(version) || version < 1) {
        return new Response(
          JSON.stringify({ error: 'Invalid version (must be positive integer)' }),
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
            }
          }
        );
      }

      // Read file data
      const arrayBuffer = await databaseFile.arrayBuffer();
      databaseData = new Uint8Array(arrayBuffer);

    } else if (contentType.includes('application/json')) {
      // Parse JSON body (database as base64)
      const body = await request.json();

      if (!body.database) {
        return new Response(
          JSON.stringify({ error: 'Missing "database" field (base64-encoded SQLite)' }),
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
            }
          }
        );
      }

      if (!body.version || typeof body.version !== 'number' || body.version < 1) {
        return new Response(
          JSON.stringify({ error: 'Missing or invalid "version" field' }),
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
            }
          }
        );
      }

      version = body.version;
      changelog = body.changelog || null;
      minAppVersion = body.min_app_version || '1.0.0';

      // Decode base64 database
      try {
        const binaryString = atob(body.database);
        databaseData = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          databaseData[i] = binaryString.charCodeAt(i);
        }
      } catch (e) {
        return new Response(
          JSON.stringify({ error: 'Invalid base64 encoding for database' }),
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
            }
          }
        );
      }

    } else {
      return new Response(
        JSON.stringify({ error: 'Content-Type must be multipart/form-data or application/json' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          }
        }
      );
    }

    // 4. Validate SQLite file
    const header = new TextDecoder().decode(databaseData.slice(0, 16));
    if (!header.startsWith('SQLite format 3')) {
      return new Response(
        JSON.stringify({ error: 'Invalid SQLite database file' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          }
        }
      );
    }

    console.log(`📦 Processing label database upload: version ${version}, ${databaseData.length} bytes`);

    // 5. Calculate checksum
    const checksum = await calculateChecksum(databaseData);
    console.log(`🔐 Checksum: ${checksum}`);

    // 6. Create metadata
    const now = new Date().toISOString();
    const metadata: LabelVersion = {
      version,
      releaseDate: now,
      fileSize: databaseData.length,
      checksum,
      minAppVersion,
      changelog,
      createdAt: now,
      createdBy: `admin@${ipAddress}`
    };

    // 7. Store in KV
    await storeLabelVersion(kv, metadata, databaseData);

    console.log(`✅ Successfully uploaded label database version ${version}`);

    // 8. Return success response
    return new Response(
      JSON.stringify({
        success: true,
        version: metadata.version,
        fileSize: metadata.fileSize,
        checksum: metadata.checksum,
        releaseDate: metadata.releaseDate
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining': rateLimit.remaining.toString(),
          'X-RateLimit-Reset': rateLimit.resetAt.toISOString(),
        }
      }
    );

  } catch (error) {
    console.error('Error uploading label database:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        }
      }
    );
  }
};
