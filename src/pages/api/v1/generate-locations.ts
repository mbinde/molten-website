import type { APIRoute } from 'astro';
import { requireAuth } from '../../../lib/auth';
import { regenerateLocationsJSON } from '../../../lib/location-generator';

// IMPORTANT: Disable prerendering for API routes (required for Cloudflare)
export const prerender = false;

/**
 * Manual endpoint to regenerate locations.json from approved locations
 * Normally this happens automatically on approve/reject/update, but this
 * allows manual refresh if needed.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  // Get env from Cloudflare runtime
  const env = (locals.runtime as any)?.env;

  // Check authentication
  const auth = await requireAuth(env, request);
  if (!auth.authorized) {
    return new Response(
      JSON.stringify({ error: auth.error || 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Get KV namespace from Cloudflare runtime
    const kv = env?.STORE_DATA;
    if (!kv) {
      console.error('🚨 KV namespace STORE_DATA not found');
      return new Response(
        JSON.stringify({ error: 'Storage not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Use shared regeneration function
    console.log('🔄 Starting locations.json regeneration...');
    const locationCount = await regenerateLocationsJSON(kv);
    console.log(`✅ Generated locations.json with ${locationCount} approved locations`);

    // Verify it was saved by reading it back
    const verification = await kv.get('locations-json', 'text');
    if (verification) {
      console.log(`✓ Verified: locations-json exists in KV (${verification.length} bytes)`);
    } else {
      console.warn('⚠️  Warning: locations-json not found in KV after generation');
    }

    return new Response(
      JSON.stringify({
        message: `Successfully generated locations.json with ${locationCount} approved locations`,
        count: locationCount,
        path: '/locations.json',
        verified: !!verification
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error generating locations.json:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
