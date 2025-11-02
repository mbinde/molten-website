import type { APIRoute } from 'astro';
import { requireAuth } from '../../lib/auth';

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
  latitude?: number;
  longitude?: number;
}

interface PendingLocationsData {
  version: string;
  submissions: PendingLocation[];
}

interface PublicStore {
  stable_id: string;
  name: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  zip: string;
  latitude: number;
  longitude: number;
  website_url?: string;
  phone?: string;
  notes?: string;
  is_verified: boolean;
}

interface StoresOutput {
  version: string;
  generated: string;
  store_count: number;
  stores: PublicStore[];
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

async function saveStoresJSON(kv: KVNamespace, data: StoresOutput): Promise<void> {
  // Save to KV so it can be served via API
  await kv.put('stores-json', JSON.stringify(data, null, 2));
}

/**
 * Get coordinates from approved store
 * Coordinates are added during approval via Nominatim geocoding
 */
function getCoordinates(store: PendingStore): { latitude: number; longitude: number } {
  // Use coordinates from approval (geocoded via Nominatim)
  if (location.latitude && location.longitude) {
    return {
      latitude: location.latitude,
      longitude: location.longitude
    };
  }

  // Fallback to 0.0 if geocoding failed during approval
  // iOS app handles this gracefully (no map display, but store still shows in list)
  return {
    latitude: 0.0,
    longitude: 0.0
  };
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

    // Load pending stores from KV
    const pendingData = await loadPendingLocations(kv);

    // Filter approved stores only
    const approvedStores = pendingData.submissions.filter(s => s.status === 'approved');

    if (approvedStores.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'No approved stores to export',
          count: 0
        }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Transform to public store format
    const publicStores: PublicStore[] = approvedStores.map((store) => {
      const coords = getCoordinates(store);

      return {
        stable_id: location.stable_id,
        name: location.name,
        address_line1: location.address_line1,
        address_line2: location.address_line2,
        city: location.city,
        state: location.state,
        zip: location.zip,
        latitude: coords.latitude,
        longitude: coords.longitude,
        website_url: location.website_url,
        phone: location.phone,
        notes: location.notes,
        is_verified: true // All approved stores are marked as verified
      };
    });

    // Sort by name
    publicStores.sort((a, b) => a.name.localeCompare(b.name));

    // Create output structure
    const output: StoresOutput = {
      version: '1.0',
      generated: new Date().toISOString(),
      store_count: publicStores.length,
      stores: publicStores
    };

    // Save to KV (accessible via /stores.json endpoint)
    await saveStoresJSON(kv, output);

    return new Response(
      JSON.stringify({
        message: `Successfully generated stores.json with ${publicStores.length} approved stores`,
        count: publicStores.length,
        path: '/stores.json'
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );

  } catch (error) {
    console.error('Error generating stores.json:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
};
