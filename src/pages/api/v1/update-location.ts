import type { APIRoute } from 'astro';
import { requireAuth } from '../../../lib/auth';
import { regenerateLocationsJSON } from '../../../lib/location-generator';

// IMPORTANT: Disable prerendering for API routes (required for Cloudflare)
export const prerender = false;

interface PendingLocation {
  stable_id: string;
  name: string;
  address_line1?: string;
  address_line2?: string;
  city: string;
  state: string;
  zip?: string;
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
  rejected_at?: string;
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

    const body = await request.json();
    const { stable_id, updates } = body;

    if (!stable_id) {
      return new Response(
        JSON.stringify({ error: 'stable_id is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!updates || typeof updates !== 'object') {
      return new Response(
        JSON.stringify({ error: 'updates object is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const pendingData = await loadPendingLocations(kv);

    const locationIndex = pendingData.submissions.findIndex(
      s => s.stable_id === stable_id
    );

    if (locationIndex === -1) {
      return new Response(
        JSON.stringify({ error: 'Location not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const location = pendingData.submissions[locationIndex];

    // Update allowed fields
    const allowedFields = [
      'name', 'address_line1', 'address_line2', 'city', 'state', 'zip', 'country',
      'phone', 'website_url', 'retail_url', 'classes_url', 'rentals_url', 'notes', 'latitude', 'longitude',
      'status',  // Allow status updates (e.g., moving rejected back to pending)
      'retail_supports_casting', 'retail_supports_flameworking_hard', 'retail_supports_flameworking_soft',
      'retail_supports_fusing', 'retail_supports_glass_blowing', 'retail_supports_stained_glass', 'retail_supports_other',
      'classes_supports_casting', 'classes_supports_flameworking_hard', 'classes_supports_flameworking_soft',
      'classes_supports_fusing', 'classes_supports_glass_blowing', 'classes_supports_stained_glass', 'classes_supports_other',
      'rentals_supports_casting', 'rentals_supports_flameworking_hard', 'rentals_supports_flameworking_soft',
      'rentals_supports_fusing', 'rentals_supports_glass_blowing', 'rentals_supports_stained_glass', 'rentals_supports_other'
    ];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        (location as any)[field] = updates[field];
      }
    }

    pendingData.submissions[locationIndex] = store;
    await savePendingLocations(kv, pendingData);

    // Auto-regenerate stores.json if this is an approved store
    let storesUpdated = false;
    let totalStores = 0;
    if (location.status === 'approved') {
      totalStores = await regenerateLocationsJSON(kv);
      storesUpdated = true;
    }

    return new Response(
      JSON.stringify({
        message: 'Location updated successfully',
        stable_id,
        locations_json_updated: storesUpdated,
        total_approved_locations: totalStores
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error updating location:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
