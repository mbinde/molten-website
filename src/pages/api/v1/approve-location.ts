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
  country?: string;
  phone?: string;
  website_url?: string;
  retail_url?: string;
  classes_url?: string;
  rentals_url?: string;
  notes?: string;
  submitted_at: string;
  status: 'pending' | 'approved' | 'rejected';
  submitter?: {
    name?: string;
    phone?: string;
    email?: string;
    comments?: string;
  };
  approved_at?: string;
  latitude?: number;
  longitude?: number;
  // Retail glass offerings
  retail_supports_casting?: boolean;
  retail_supports_flameworking_hard?: boolean;
  retail_supports_flameworking_soft?: boolean;
  retail_supports_fusing?: boolean;
  retail_supports_glass_blowing?: boolean;
  retail_supports_stained_glass?: boolean;
  retail_supports_other?: boolean;
  // Classes offerings
  classes_supports_casting?: boolean;
  classes_supports_flameworking_hard?: boolean;
  classes_supports_flameworking_soft?: boolean;
  classes_supports_fusing?: boolean;
  classes_supports_glass_blowing?: boolean;
  classes_supports_stained_glass?: boolean;
  classes_supports_other?: boolean;
  // Rentals offerings
  rentals_supports_casting?: boolean;
  rentals_supports_flameworking_hard?: boolean;
  rentals_supports_flameworking_soft?: boolean;
  rentals_supports_fusing?: boolean;
  rentals_supports_glass_blowing?: boolean;
  rentals_supports_stained_glass?: boolean;
  rentals_supports_other?: boolean;
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

/**
 * Geocode address using Nominatim (OpenStreetMap) - FREE, no API key needed
 * Rate limit: 1 request/second (perfect for manual approvals)
 * Docs: https://nominatim.org/release-docs/latest/api/Search/
 */
async function geocodeAddress(location: PendingLocation): Promise<{ latitude: number; longitude: number } | null> {
  try {
    // Build address string
    const addressParts = [
      location.address_line1,
      location.address_line2,
      location.city,
      location.state,
      location.zip
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
        'User-Agent': 'Molten-Glass-App/1.0 (moltenglass.app; location submission system)'
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

    const pendingData = await loadPendingLocations(kv);

    const locationIndex = pendingData.submissions.findIndex(
      s => s.stable_id === stable_id
    );

    if (locationIndex === -1) {
      return new Response(
        JSON.stringify({ error: 'Location not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    const location = pendingData.submissions[locationIndex];

    // Geocode the address if not already geocoded
    if (!location.latitude || !location.longitude || (location.latitude === 0 && location.longitude === 0)) {
      console.log(`📍 Attempting to geocode store: ${location.name}`);
      const coords = await geocodeAddress(store);

      if (coords) {
        location.latitude = coords.latitude;
        location.longitude = coords.longitude;
      } else {
        console.warn(`⚠️  Could not geocode ${location.name}, will use 0,0 coordinates`);
        location.latitude = 0;
        location.longitude = 0;
      }
    }

    // Update status to approved
    location.status = 'approved';
    location.approved_at = new Date().toISOString();

    pendingData.submissions[locationIndex] = store;
    await savePendingLocations(kv, pendingData);

    // Auto-regenerate stores.json with the newly approved store
    const locationCount = await regenerateLocationsJSON(kv);

    return new Response(
      JSON.stringify({
        message: 'Location approved successfully',
        stable_id,
        locations_json_updated: true,
        total_approved_locations: locationCount
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );

  } catch (error) {
    console.error('Error approving location:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
};
