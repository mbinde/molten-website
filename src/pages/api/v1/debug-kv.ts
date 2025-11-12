import type { APIRoute } from 'astro';
import { requireAuth } from '../../../lib/auth';

// IMPORTANT: Disable prerendering for API routes (required for Cloudflare)
export const prerender = false;

// CORS headers for API routes
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Handle OPTIONS preflight request
export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
};

/**
 * Debug endpoint to check what's actually in KV
 */
export const GET: APIRoute = async ({ request, locals }) => {
  // Get env from Cloudflare runtime
  const env = (locals.runtime as any)?.env;

  // Check authentication
  const auth = await requireAuth(env, request);
  if (!auth.authorized) {
    return new Response(
      JSON.stringify({ error: auth.error || 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  try {
    // Get KV namespace from Cloudflare runtime
    const kv = env?.STORE_DATA;
    if (!kv) {
      return new Response(
        JSON.stringify({ error: 'Storage not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    const debug: any = {
      timestamp: new Date().toISOString(),
      kv_checks: {}
    };

    // Check locations-json
    const locationsJSON = await kv.get('locations-json', 'text');
    debug.kv_checks['locations-json'] = {
      exists: !!locationsJSON,
      size_bytes: locationsJSON?.length || 0,
      preview: locationsJSON ? locationsJSON.substring(0, 200) + '...' : null
    };

    // Check stores-json (old key)
    const storesJSON = await kv.get('stores-json', 'text');
    debug.kv_checks['stores-json'] = {
      exists: !!storesJSON,
      size_bytes: storesJSON?.length || 0,
      preview: storesJSON ? storesJSON.substring(0, 200) + '...' : null
    };

    // Check pending-locations
    const pendingLocations = await kv.get('pending-locations', 'json');
    debug.kv_checks['pending-locations'] = {
      exists: !!pendingLocations,
      submission_count: (pendingLocations as any)?.submissions?.length || 0,
      approved_count: (pendingLocations as any)?.submissions?.filter((s: any) => s.status === 'approved').length || 0
    };

    // Check pending-stores (old key)
    const pendingStores = await kv.get('pending-stores', 'json');
    debug.kv_checks['pending-stores'] = {
      exists: !!pendingStores,
      submission_count: (pendingStores as any)?.submissions?.length || 0,
      approved_count: (pendingStores as any)?.submissions?.filter((s: any) => s.status === 'approved').length || 0
    };

    return new Response(
      JSON.stringify(debug, null, 2),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...CORS_HEADERS,
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error)
      }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
};
