/**
 * GET /api/v1/catalog/data - Download full catalog JSON
 *
 * Purpose:
 * - Download complete catalog as gzipped JSON
 * - Support versioning and caching with ETags
 *
 * Security:
 * - App Attest assertion REQUIRED (X-Apple-Assertion header)
 * - Rate limiting: 10 requests/hour per IP, 5/hour per device
 *
 * Query Parameters:
 * - version (optional): Specific version to download (defaults to latest)
 *
 * Response Headers:
 * - Content-Type: application/json
 * - Content-Encoding: gzip
 * - ETag: "v{version}-{checksum}"
 * - Cache-Control: public, max-age=86400 (24 hours)
 * - X-Catalog-Version: {version}
 * - X-Checksum: {checksum}
 *
 * Response:
 * Gzipped JSON catalog data
 */

import type { APIRoute } from 'astro';
import {
  getLatestCatalogVersion,
  getCatalogVersion,
  getCatalogData,
  checkCatalogRateLimit,
  logCatalogDownload
} from '../../../../lib/catalog';
import { verifyAppAttestAssertion } from '../../../../lib/crypto';

export const prerender = false;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Apple-Assertion, If-None-Match',
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
    // 1. Verify App Attest assertion (REQUIRED for data downloads)
    const assertion = request.headers.get('X-Apple-Assertion');
    const url = new URL(request.url);

    const attestResult = await verifyAppAttestAssertion(
      assertion,
      {
        method: 'GET',
        path: url.pathname + url.search
      },
      env
    );

    if (!attestResult.valid) {
      return new Response(
        JSON.stringify({
          error: attestResult.error || 'App attestation required',
          message: 'Catalog downloads require valid App Attest assertion'
        }),
        {
          status: 401,
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
      `ip:${ipAddress}`,
      'catalog_data',
      10,
      60
    );

    if (!rateLimit.allowed) {
      // Log failed download attempt
      await logCatalogDownload(kv, {
        version: 0,
        ip_address: ipAddress,
        user_agent: request.headers.get('User-Agent') || undefined,
        download_type: 'full',
        success: false,
        error_message: 'Rate limit exceeded',
        downloaded_at: new Date().toISOString()
      });

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

    // 3. Get requested version (or latest)
    const requestedVersion = url.searchParams.get('version');
    let version;

    if (requestedVersion) {
      const versionNum = parseInt(requestedVersion, 10);
      if (isNaN(versionNum)) {
        return new Response(
          JSON.stringify({ error: 'Invalid version parameter' }),
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...CORS_HEADERS
            }
          }
        );
      }
      version = await getCatalogVersion(kv, versionNum);
    } else {
      version = await getLatestCatalogVersion(kv);
    }

    if (!version) {
      // Log failed download
      await logCatalogDownload(kv, {
        version: requestedVersion ? parseInt(requestedVersion, 10) : 0,
        ip_address: ipAddress,
        user_agent: request.headers.get('User-Agent') || undefined,
        download_type: 'full',
        success: false,
        error_message: 'Catalog version not found',
        downloaded_at: new Date().toISOString()
      });

      return new Response(
        JSON.stringify({ error: 'Catalog version not found' }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS
          }
        }
      );
    }

    // 4. Check ETag for 304 Not Modified
    const etag = `"v${version.version}-${version.checksum}"`;
    const ifNoneMatch = request.headers.get('If-None-Match');

    if (ifNoneMatch === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          'ETag': etag,
          'X-Catalog-Version': version.version.toString(),
          'X-RateLimit-Remaining': rateLimit.remaining.toString(),
          ...CORS_HEADERS
        }
      });
    }

    // 5. Get catalog data
    const catalogData = await getCatalogData(kv, version.version);

    if (!catalogData) {
      // Log failed download
      await logCatalogDownload(kv, {
        version: version.version,
        ip_address: ipAddress,
        user_agent: request.headers.get('User-Agent') || undefined,
        download_type: 'full',
        success: false,
        error_message: 'Catalog data not found',
        downloaded_at: new Date().toISOString()
      });

      return new Response(
        JSON.stringify({ error: 'Catalog data not found' }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS
          }
        }
      );
    }

    // 6. Log successful download
    await logCatalogDownload(kv, {
      version: version.version,
      ip_address: ipAddress,
      user_agent: request.headers.get('User-Agent') || undefined,
      download_type: 'full',
      success: true,
      downloaded_at: new Date().toISOString()
    });

    // 7. Return gzipped catalog data
    return new Response(catalogData, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'Content-Length': catalogData.length.toString(),
        'ETag': etag,
        'Cache-Control': 'public, max-age=86400',  // Cache for 24 hours
        'X-Catalog-Version': version.version.toString(),
        'X-Checksum': version.checksum,
        'X-RateLimit-Remaining': rateLimit.remaining.toString(),
        'X-RateLimit-Reset': rateLimit.resetAt.toISOString(),
        ...CORS_HEADERS
      }
    });

  } catch (error) {
    console.error('Error downloading catalog data:', error);

    // Log failed download
    const ipAddress = clientAddress || 'unknown';
    await logCatalogDownload(kv, {
      version: 0,
      ip_address: ipAddress,
      user_agent: request.headers.get('User-Agent') || undefined,
      download_type: 'full',
      success: false,
      error_message: error instanceof Error ? error.message : 'Internal server error',
      downloaded_at: new Date().toISOString()
    });

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
