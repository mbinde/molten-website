import type { APIRoute } from 'astro';
import { requireAuth } from '../../lib/auth';
import { regenerateStoresJSON } from '../../lib/store-generator';

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

interface PendingStore {
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
  supports_casting?: boolean;
  supports_flameworking_hard?: boolean;
  supports_flameworking_soft?: boolean;
  supports_fusing?: boolean;
  supports_glass_blowing?: boolean;
  supports_stained_glass?: boolean;
  supports_other?: boolean;
}

interface PendingStoresData {
  version: string;
  submissions: PendingStore[];
}

async function loadPendingStores(kv: KVNamespace): Promise<PendingStoresData> {
  try {
    const content = await kv.get('pending-stores', 'json');
    if (content) {
      return content as PendingStoresData;
    }
  } catch (error) {
    console.error('Error loading from KV:', error);
  }

  return {
    version: '1.0',
    submissions: []
  };
}

async function savePendingStores(kv: KVNamespace, data: PendingStoresData): Promise<void> {
  await kv.put('pending-stores', JSON.stringify(data, null, 2));
}

/**
 * Geocode address using Nominatim (OpenStreetMap) - FREE, no API key needed
 * Rate limit: 1 request/second (perfect for manual approvals)
 * Docs: https://nominatim.org/release-docs/latest/api/Search/
 */
async function geocodeAddress(store: PendingStore): Promise<{ latitude: number; longitude: number } | null> {
  try {
    // Build address string
    const addressParts = [
      store.address_line1,
      store.address_line2,
      store.city,
      store.state,
      store.zip
    ].filter(Boolean);
    const address = addressParts.join(', ');

    console.log(`🌍 Geocoding: ${address}`);

    // Call Nominatim API
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', address);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('addressdetails', '1');

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Molten-Glass-App/1.0 (moltenglass.app; store submission system)'
      }
    });

    if (!response.ok) {
      console.error(`Nominatim API error: ${response.status}`);
      return null;
    }

    const results = await response.json();

    if (results && results.length > 0) {
      const lat = parseFloat(results[0].lat);
      const lon = parseFloat(results[0].lon);

      console.log(`✅ Geocoded: ${lat}, ${lon}`);

      return {
        latitude: lat,
        longitude: lon
      };
    } else {
      console.warn(`⚠️  No geocoding results for: ${address}`);
      return null;
    }
  } catch (error) {
    console.error('Geocoding error:', error);
    return null;
  }
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

    const body = await request.json();
    const { stable_id } = body;

    if (!stable_id) {
      return new Response(
        JSON.stringify({ error: 'stable_id is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    const pendingData = await loadPendingStores(kv);

    const storeIndex = pendingData.submissions.findIndex(
      s => s.stable_id === stable_id
    );

    if (storeIndex === -1) {
      return new Response(
        JSON.stringify({ error: 'Store not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    const store = pendingData.submissions[storeIndex];

    // Geocode the address if not already geocoded
    if (!store.latitude || !store.longitude || (store.latitude === 0 && store.longitude === 0)) {
      console.log(`📍 Attempting to geocode store: ${store.name}`);
      const coords = await geocodeAddress(store);

      if (coords) {
        store.latitude = coords.latitude;
        store.longitude = coords.longitude;
      } else {
        console.warn(`⚠️  Could not geocode ${store.name}, will use 0,0 coordinates`);
        store.latitude = 0;
        store.longitude = 0;
      }
    }

    // Update status to approved
    store.status = 'approved';
    store.approved_at = new Date().toISOString();

    pendingData.submissions[storeIndex] = store;
    await savePendingStores(kv, pendingData);

    // Auto-regenerate stores.json with the newly approved store
    const storeCount = await regenerateStoresJSON(kv);

    return new Response(
      JSON.stringify({
        message: 'Store approved successfully',
        stable_id,
        stores_json_updated: true,
        total_approved_stores: storeCount
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );

  } catch (error) {
    console.error('Error approving store:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
};
