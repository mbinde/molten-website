/**
 * GET /api/v1/labels/database - Download label database
 *
 * Purpose:
 * - Allow iOS app to download updated label database (SQLite)
 * - Support optional version parameter for specific versions
 *
 * Query Parameters:
 * - version (optional): Specific version to download, defaults to latest
 *
 * Security:
 * - Rate limiting: 10 downloads/hour per IP (databases are larger)
 *
 * Response:
 * - 200: SQLite database file (application/x-sqlite3)
 * - 404: Version not found
 * - 429: Rate limit exceeded
 */

import type { APIRoute } from 'astro';
import { getLatestLabelVersion, getLabelVersion, getLabelData, checkLabelRateLimit } from '../../../../lib/labels';

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
    // Rate limiting: 10 downloads per hour per IP (databases are larger than version checks)
    const ipAddress = clientAddress || 'unknown';
    const rateLimit = await checkLabelRateLimit(
      kv,
      `ip:${ipAddress}`,
      'label_database',
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

    // Parse version from query string
    const url = new URL(request.url);
    const versionParam = url.searchParams.get('version');

    let version: number;
    let metadata;

    if (versionParam) {
      // Specific version requested
      version = parseInt(versionParam, 10);
      if (isNaN(version) || version < 1) {
        return new Response(
          JSON.stringify({ error: 'Invalid version parameter' }),
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
            }
          }
        );
      }
      metadata = await getLabelVersion(kv, version);
    } else {
      // Get latest version
      metadata = await getLatestLabelVersion(kv);
      if (metadata) {
        version = metadata.version;
      }
    }

    if (!metadata) {
      return new Response(
        JSON.stringify({ error: 'Label version not found' }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
          }
        }
      );
    }

    // Get database data
    const data = await getLabelData(kv, metadata.version);

    if (!data) {
      return new Response(
        JSON.stringify({ error: 'Label database data not found' }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
          }
        }
      );
    }

    // Return database file
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-sqlite3',
        'Content-Length': data.length.toString(),
        'Content-Disposition': `attachment; filename="labels-v${metadata.version}.db"`,
        'Cache-Control': 'public, max-age=86400',  // Cache for 24 hours
        'ETag': `"${metadata.checksum}"`,
        'X-Label-Version': metadata.version.toString(),
        'X-Label-Checksum': metadata.checksum,
        'X-RateLimit-Remaining': rateLimit.remaining.toString(),
        'X-RateLimit-Reset': rateLimit.resetAt.toISOString(),
      }
    });

  } catch (error) {
    console.error('Error downloading label database:', error);
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
