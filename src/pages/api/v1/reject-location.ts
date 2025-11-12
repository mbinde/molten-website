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
  rejected_at?: string;
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

    // Update status to rejected
    pendingData.submissions[locationIndex].status = 'rejected';
    pendingData.submissions[locationIndex].rejected_at = new Date().toISOString();

    await savePendingLocations(kv, pendingData);

    // Auto-regenerate stores.json (removes the rejected store if it was previously approved)
    const storeCount = await regenerateLocationsJSON(kv);

    return new Response(
      JSON.stringify({
        message: 'Location rejected successfully',
        stable_id,
        locations_json_updated: true,
        total_approved_locations: storeCount
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );

  } catch (error) {
    console.error('Error rejecting location:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
};
