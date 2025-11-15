/**
 * GET /v1/catalog/version - Get latest catalog version metadata
 *
 * This endpoint serves the iOS app's catalog update system.
 * Note: This is a simplified version without the /api prefix for iOS app compatibility.
 */

import type { APIRoute } from 'astro';
import { getLatestCatalogVersion, checkCatalogRateLimit } from '../../../lib/catalog';

export const prerender = false;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Apple-Assertion',
};

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
};

export const GET: APIRoute = async ({ request, locals, clientAddress }) => {
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
    // Rate limiting: 100 requests per hour per IP
    const ipAddress = clientAddress || 'unknown';
    const rateLimit = await checkCatalogRateLimit(
      kv,
      `ip:${ipAddress}`,
      'catalog_version',
      100,
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

    // Get latest catalog version for glass items
    const version = await getLatestCatalogVersion(kv, 'glass');

    if (!version) {
      return new Response(
        JSON.stringify({ error: 'No catalog versions available' }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS
          }
        }
      );
    }

    // Return version metadata
    return new Response(
      JSON.stringify({
        version: version.version,
        item_count: version.item_count,
        release_date: version.release_date,
        file_size: version.file_size,
        checksum: version.checksum,
        min_app_version: version.min_app_version,
        changelog: version.changelog
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, must-revalidate',  // No cache during development
          'ETag': `"${version.version}"`,
          'X-RateLimit-Remaining': rateLimit.remaining.toString(),
          'X-RateLimit-Reset': rateLimit.resetAt.toISOString(),
          ...CORS_HEADERS
        }
      }
    );

  } catch (error) {
    console.error('Error getting catalog version:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
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
