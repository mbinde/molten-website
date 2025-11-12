/**
 * POST /api/v1/admin/upload-catalog - Upload new catalog version to KV
 *
 * Purpose:
 * - Upload new catalog JSON to KV storage
 * - Calculate checksums and compress data
 * - Create version metadata
 *
 * Security:
 * - Requires admin authentication (basic auth or JWT)
 * - Only accessible from deployment scripts
 *
 * Request Body:
 * {
 *   "catalog": { "glassitems": [...] },  // Full catalog JSON
 *   "version": 1,  // Version number
 *   "changelog": "Initial release..."
 * }
 */

import type { APIRoute } from 'astro';
import {
  calculateChecksum,
  compressGzip,
  storeCatalogVersion,
  type CatalogVersion
} from '../../../../../lib/catalog';

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

export const POST: APIRoute = async ({ request, locals }) => {
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
    // 1. Check authentication
    const authHeader = request.headers.get('Authorization');
    const adminPassword = env?.ADMIN_PASSWORD;

    if (!adminPassword || authHeader !== `Bearer ${adminPassword}`) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'Bearer',
            ...CORS_HEADERS
          }
        }
      );
    }

    // 2. Parse request body
    const body = await request.json();
    const { catalog, version, changelog, min_app_version } = body;

    if (!catalog || !catalog.glassitems || !Array.isArray(catalog.glassitems)) {
      return new Response(
        JSON.stringify({ error: 'Invalid catalog format' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS
          }
        }
      );
    }

    if (typeof version !== 'number' || version < 1) {
      return new Response(
        JSON.stringify({ error: 'Invalid version number' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS
          }
        }
      );
    }

    // 3. Calculate metadata
    const catalogJson = JSON.stringify(catalog);
    const itemCount = catalog.glassitems.length;
    const fileSize = new TextEncoder().encode(catalogJson).length;
    const checksum = await calculateChecksum(catalogJson);

    // 4. Compress catalog
    const compressedData = await compressGzip(catalogJson);

    console.log(`📦 Catalog v${version}: ${itemCount} items, ${fileSize} bytes uncompressed, ${compressedData.length} bytes compressed`);

    // 5. Create metadata
    const metadata: CatalogVersion = {
      version,
      item_count: itemCount,
      file_size: fileSize,
      checksum,
      release_date: new Date().toISOString(),
      min_app_version: min_app_version || '1.0.0',
      changelog: changelog || 'No changelog provided',
      created_at: new Date().toISOString(),
      created_by: 'admin-upload'
    };

    // 6. Store in KV
    await storeCatalogVersion(kv, metadata, compressedData);

    // 7. Return success
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
