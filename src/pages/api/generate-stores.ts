import type { APIRoute } from 'astro';
import fs from 'fs/promises';
import path from 'path';
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
}

interface PendingStoresData {
  version: string;
  submissions: PendingStore[];
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

async function loadPendingStores(filePath: string): Promise<PendingStoresData> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

async function saveStoresJSON(filePath: string, data: StoresOutput): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Get coordinates from approved store
 * Coordinates are added during approval via Nominatim geocoding
 */
function getCoordinates(store: PendingStore): { latitude: number; longitude: number } {
  // Use coordinates from approval (geocoded via Nominatim)
  if (store.latitude && store.longitude) {
    return {
      latitude: store.latitude,
      longitude: store.longitude
    };
  }

  // Fallback to 0.0 if geocoding failed during approval
  // iOS app handles this gracefully (no map display, but store still shows in list)
  return {
    latitude: 0.0,
    longitude: 0.0
  };
}

export const POST: APIRoute = async ({ request }) => {
  // Check authentication
  const auth = requireAuth(request);
  if (!auth.authorized) {
    return new Response(
      JSON.stringify({ error: auth.error || 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  try {
    const pendingPath = path.join(process.cwd(), 'public', 'data', 'pending-stores.json');
    const outputPath = path.join(process.cwd(), 'public', 'stores.json');

    // Load pending stores
    const pendingData = await loadPendingStores(pendingPath);

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
        stable_id: store.stable_id,
        name: store.name,
        address_line1: store.address_line1,
        address_line2: store.address_line2,
        city: store.city,
        state: store.state,
        zip: store.zip,
        latitude: coords.latitude,
        longitude: coords.longitude,
        website_url: store.website_url,
        phone: store.phone,
        notes: store.notes,
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

    // Save to public/stores.json
    await saveStoresJSON(outputPath, output);

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
