/**
 * GET /api/v1/labels/version - Get latest label database version metadata
 *
 * Purpose:
 * - Allow iOS app to check if label database update is available
 * - Return version metadata without downloading full database
 *
 * Security:
 * - Rate limiting: 100 requests/hour per IP
 *
 * Response:
 * {
 *   "version": 1,
 *   "releaseDate": "2025-12-03T00:00:00Z",
 *   "fileSize": 123456,
 *   "checksum": "sha256:abc123def456...",
 *   "minAppVersion": "1.0.0",
 *   "changelog": "Initial versioned release"
 * }
 */

import type { APIRoute } from 'astro';
import { getLatestLabelVersion, checkLabelRateLimit } from '../../../../lib/labels';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals, clientAddress }) => {
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
    // Rate limiting: 100 requests per hour per IP
    const ipAddress = clientAddress || 'unknown';
    const rateLimit = await checkLabelRateLimit(
      kv,
      `ip:${ipAddress}`,
      'label_version',
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
          }
        }
      );
    }

    // Get latest label version
    const version = await getLatestLabelVersion(kv);

    if (!version) {
      return new Response(
        JSON.stringify({ error: 'No label versions available' }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
          }
        }
      );
    }

    // Return version metadata (using camelCase to match iOS model)
    return new Response(
      JSON.stringify({
        version: version.version,
        releaseDate: version.releaseDate,
        fileSize: version.fileSize,
        checksum: version.checksum,
        minAppVersion: version.minAppVersion,
        changelog: version.changelog
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',  // Always fetch fresh for version checks
          'ETag': `"labels-${version.version}"`,
          'X-RateLimit-Remaining': rateLimit.remaining.toString(),
          'X-RateLimit-Reset': rateLimit.resetAt.toISOString(),
        }
      }
    );

  } catch (error) {
    console.error('Error getting label version:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        }
      }
    );
  }
};
