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

// Generate a unique hash ID for the store (12 lowercase hex characters)
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

    const pendingData = await loadPendingStores(kv);
    const migrations: Array<{ old_id: string; new_id: string; name: string }> = [];

    // Migrate old-style IDs to hash IDs
    for (const store of pendingData.submissions) {
      if (isOldStyleId(store.stable_id)) {
        const oldId = store.stable_id;
        const newId = generateHashId();
        store.stable_id = newId;
        migrations.push({ old_id: oldId, new_id: newId, name: store.name });
        console.log(`Migrated "${store.name}": ${oldId} → ${newId}`);
      }
    }

    if (migrations.length > 0) {
      await savePendingStores(kv, pendingData);

      // Auto-regenerate stores.json with new IDs
      const storeCount = await regenerateStoresJSON(kv);

      return new Response(
        JSON.stringify({
          message: 'Successfully migrated store IDs',
          migrations,
          stores_json_updated: true,
          total_stores: storeCount
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    } else {
      return new Response(
        JSON.stringify({
          message: 'No stores needed migration',
          migrations: [],
          stores_json_updated: false
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

  } catch (error) {
    console.error('Error migrating store IDs:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
};
