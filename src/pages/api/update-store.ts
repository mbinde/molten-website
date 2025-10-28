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
  rejected_at?: string;
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
    const { stable_id, updates } = body;

    if (!stable_id) {
      return new Response(
        JSON.stringify({ error: 'stable_id is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    if (!updates || typeof updates !== 'object') {
      return new Response(
        JSON.stringify({ error: 'updates object is required' }),
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

    // Update allowed fields
    const allowedFields = [
      'name', 'address_line1', 'address_line2', 'city', 'state', 'zip',
      'phone', 'website_url', 'notes', 'latitude', 'longitude',
      'supports_casting', 'supports_flameworking_hard', 'supports_flameworking_soft',
      'supports_fusing', 'supports_glass_blowing', 'supports_stained_glass', 'supports_other'
    ];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        (store as any)[field] = updates[field];
      }
    }

    pendingData.submissions[storeIndex] = store;
    await savePendingStores(kv, pendingData);

    // Auto-regenerate stores.json if this is an approved store
    let storesUpdated = false;
    let totalStores = 0;
    if (store.status === 'approved') {
      totalStores = await regenerateStoresJSON(kv);
      storesUpdated = true;
    }

    return new Response(
      JSON.stringify({
        message: 'Store updated successfully',
        stable_id,
        stores_json_updated: storesUpdated,
        total_approved_stores: totalStores
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );

  } catch (error) {
    console.error('Error updating store:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
};
