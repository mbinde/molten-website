/**
 * POST /api/v1/admin/upload-catalog - Upload new catalog version to KV
 *
 * Purpose:
 * - Allow authenticated admin to upload new catalog versions
 * - Calculate checksum and compress data
 * - Store in KV for OTA updates
 *
 * Security:
 * - CATALOG_API_KEY required in Authorization header (Bearer token)
 * - Rate limiting: 10 requests/hour per IP
 *
 * Request Body:
 * {
 *   "type": "glass",  // "glass", "tools", or "coatings"
 *   "catalog": { "glassitems": [...] },  // or "tools": [...], "coatings": [...]
 *   "version": 2,
 *   "changelog": "Added 15 new AB Imagery colors...",
 *   "min_app_version": "1.5.0"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "version": 2,
 *   "item_count": 3198,
 *   "file_size": 6234567,
 *   "compressed_size": 1234567,
 *   "checksum": "sha256:abc123def456..."
 * }
 */

import type { APIRoute } from 'astro';
import {
  storeCatalogVersion,
  calculateChecksum,
  compressGzip,
  checkCatalogRateLimit
} from '../../../../lib/catalog';
import type { CatalogVersion } from '../../../../lib/catalog';

export const prerender = false;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
};

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  const env = (locals.runtime as any)?.env;
  const kv = env?.CATALOG_VERSIONS;

  if (!kv) {
    return new Response(
      JSON.stringify({ error: 'Catalog storage not configured' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...CORS_HEADERS
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
            ...CORS_HEADERS
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
            ...CORS_HEADERS
          }
        }
      );
    }

    // 2. Rate limiting: 10 requests per hour per IP
    const ipAddress = clientAddress || 'unknown';
    const rateLimit = await checkCatalogRateLimit(
      kv,
      `admin:${ipAddress}`,
      'upload_catalog',
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
            ...CORS_HEADERS
          }
        }
      );
    }

    // 3. Parse request body
    let body: any;
    try {
      body = await request.json();
    } catch (error) {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON in request body' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS
          }
        }
      );
    }

    // 4. Validate request body
    const { type, catalog, version, changelog, min_app_version } = body;

    // Validate catalog type
    const validTypes = ['glass', 'tools', 'coatings'];
    if (!type || !validTypes.includes(type)) {
      return new Response(
        JSON.stringify({
          error: 'Missing or invalid "type" field',
          message: 'Must be one of: glass, tools, coatings'
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS
          }
        }
      );
    }

    if (!catalog || typeof catalog !== 'object') {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid "catalog" field' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS
          }
        }
      );
    }

    if (!version || typeof version !== 'number' || version <= 0) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid "version" field (must be positive integer)' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS
          }
        }
      );
    }

    if (!changelog || typeof changelog !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid "changelog" field' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS
          }
        }
      );
    }

    if (!min_app_version || typeof min_app_version !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid "min_app_version" field' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS
          }
        }
      );
    }

    // 5. Calculate metadata
    const catalogJson = JSON.stringify(catalog);
    const fileSize = new TextEncoder().encode(catalogJson).length;

    // Get item count based on catalog type
    let itemCount = 0;
    let itemsKey = '';
    if (type === 'glass') {
      itemsKey = 'glassitems';
      itemCount = catalog.glassitems?.length || 0;
    } else if (type === 'tools') {
      itemsKey = 'tools';
      itemCount = catalog.tools?.length || 0;
    } else if (type === 'coatings') {
      itemsKey = 'coatings';
      itemCount = catalog.coatings?.length || 0;
    }

    if (itemCount === 0) {
      return new Response(
        JSON.stringify({
          error: `Catalog contains no \${type} items`,
          message: `Expected array at catalog.\${itemsKey}`
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS
          }
        }
      );
    }

    console.log(`📦 Processing \${type} catalog upload: version \${version}, \${itemCount} items, \${fileSize} bytes`);

    // 6. Compress catalog data
    const compressedData = await compressGzip(catalogJson);
    const compressionRatio = Math.round(compressedData.length / fileSize * 100);
    console.log(`🗜️  Compressed: \${fileSize} → \${compressedData.length} bytes (\${compressionRatio}%)`);

    // 7. Calculate checksum of ORIGINAL (uncompressed) data
    const checksum = await calculateChecksum(catalogJson);
    console.log(`🔐 Checksum: \${checksum}`);

    // 8. Create metadata
    const now = new Date().toISOString();
    const metadata: CatalogVersion = {
      version,
      item_count: itemCount,
      file_size: fileSize,
      checksum,
      release_date: now,
      min_app_version,
      changelog,
      created_at: now,
      created_by: `admin@\${ipAddress}`
    };

    // 9. Store in KV
    await storeCatalogVersion(kv, type, metadata, compressedData);

    console.log(`✅ Successfully uploaded \${type} catalog version \${version}`);

    // 10. Return success response
    return new Response(
      JSON.stringify({
        success: true,
        version: metadata.version,
        item_count: metadata.item_count,
        file_size: metadata.file_size,
        compressed_size: compressedData.length,
        checksum: metadata.checksum,
        release_date: metadata.release_date
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining': rateLimit.remaining.toString(),
          'X-RateLimit-Reset': rateLimit.resetAt.toISOString(),
          ...CORS_HEADERS
        }
      }
    );

  } catch (error) {
    console.error('Error uploading catalog:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...CORS_HEADERS
        }
      }
    );
  }
};
