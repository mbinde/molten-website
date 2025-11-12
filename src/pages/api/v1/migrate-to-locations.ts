import type { APIRoute } from 'astro';
import { requireAuth } from '../../lib/auth';
import { regenerateLocationsJSON } from '../../lib/location-generator';

// IMPORTANT: Disable prerendering for API routes (required for Cloudflare)
export const prerender = false;

// CORS headers for API routes
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
 * One-time migration script to copy data from old KV keys to new ones
 * - pending-stores → pending-locations
 * - stores-json → locations-json
 *
 * This ensures existing data continues to work after the rename.
 */
export const POST: APIRoute = async ({ request, locals }) => {
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
      console.error('🚨 KV namespace STORE_DATA not found');
      return new Response(
        JSON.stringify({ error: 'Storage not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    const migrationLog: string[] = [];

    // Step 1: Migrate pending-stores to pending-locations
    const oldPendingData = await kv.get('pending-stores', 'json');
    if (oldPendingData) {
      await kv.put('pending-locations', JSON.stringify(oldPendingData, null, 2));
      migrationLog.push('✅ Copied pending-stores → pending-locations');
      console.log('Migrated pending-stores to pending-locations');
    } else {
      migrationLog.push('ℹ️  No pending-stores data found to migrate');
    }

    // Step 2: Check if pending-locations already has newer data
    const newPendingData = await kv.get('pending-locations', 'json');
    if (newPendingData) {
      migrationLog.push(`📊 pending-locations now has ${(newPendingData as any).submissions?.length || 0} submissions`);
    }

    // Step 3: Regenerate locations.json from the migrated data
    const locationCount = await regenerateLocationsJSON(kv);
    migrationLog.push(`✅ Regenerated locations.json with ${locationCount} approved locations`);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Migration completed successfully',
        log: migrationLog,
        total_locations: locationCount
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );

  } catch (error) {
    console.error('Error during migration:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error)
      }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
};
