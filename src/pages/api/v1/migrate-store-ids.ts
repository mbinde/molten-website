import type { APIRoute } from 'astro';
import { requireAuth } from '../../../lib/auth';
import { regenerateLocationsJSON } from '../../../lib/location-generator';

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

interface PendingLocation {
  stable_id: string;
  name: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  zip: string;
  phone?: string;
  website_url?: string;
  notes?: string;
  submitted_at: string;
  status: 'pending' | 'approved' | 'rejected';
  submitter?: {
    name?: string;
    email?: string;
  };
  approved_at?: string;
  rejected_at?: string;
  latitude?: number;
  longitude?: number;
}

interface PendingLocationsData {
  version: string;
  submissions: PendingLocation[];
}

async function loadPendingLocations(kv: KVNamespace): Promise<PendingLocationsData> {
  try {
    const content = await kv.get('pending-locations', 'json');
    if (content) {
      return content as PendingLocationsData;
    }
  } catch (error) {
    console.error('Error loading from KV:', error);
  }

  return {
    version: '1.0',
    submissions: []
  };
}

async function savePendingLocations(kv: KVNamespace, data: PendingLocationsData): Promise<void> {
  await kv.put('pending-locations', JSON.stringify(data, null, 2));
}

// Generate a unique hash ID for the location (12 lowercase hex characters)
function generateHashId(): string {
  const array = new Uint8Array(6); // 6 bytes = 12 hex chars
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Check if an ID is old-style (slug-based) vs new-style (hash)
function isOldStyleId(stableId: string): boolean {
  // Old style: contains hyphens and words (e.g., "frantz-art-glass")
  // New style: 12 hex chars (e.g., "a3f8c2d9e1b4")
  return /[a-z]+-[a-z-]+/.test(stableId);
}

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

    const pendingData = await loadPendingLocations(kv);
    const migrations: Array<{ old_id: string; new_id: string; name: string }> = [];

    // Migrate old-style IDs to hash IDs
    for (const location of pendingData.submissions) {
      if (isOldStyleId(location.stable_id)) {
        const oldId = location.stable_id;
        const newId = generateHashId();
        location.stable_id = newId;
        migrations.push({ old_id: oldId, new_id: newId, name: location.name });
        console.log(`Migrated "${location.name}": ${oldId} → ${newId}`);
      }
    }

    if (migrations.length > 0) {
      await savePendingLocations(kv, pendingData);

      // Auto-regenerate locations.json with new IDs
      const locationCount = await regenerateLocationsJSON(kv);

      return new Response(
        JSON.stringify({
          message: 'Successfully migrated location IDs',
          migrations,
          locations_json_updated: true,
          total_locations: locationCount
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    } else {
      return new Response(
        JSON.stringify({
          message: 'No locations needed migration',
          migrations: [],
          locations_json_updated: false
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

  } catch (error) {
    console.error('Error migrating location IDs:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
};
