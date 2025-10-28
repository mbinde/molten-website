/**
 * Shared logic for generating stores.json from approved stores
 * Used by approve-store.ts and reject-store.ts to auto-regenerate after changes
 */

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
  supports_casting: boolean;
  supports_flameworking_hard: boolean;
  supports_flameworking_soft: boolean;
  supports_fusing: boolean;
  supports_glass_blowing: boolean;
  supports_stained_glass: boolean;
  supports_other: boolean;
}

interface StoresOutput {
  version: string;
  generated: string;
  store_count: number;
  stores: PublicStore[];
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

async function saveStoresJSON(kv: KVNamespace, data: StoresOutput): Promise<void> {
  await kv.put('stores-json', JSON.stringify(data, null, 2));
}

function getCoordinates(store: PendingStore): { latitude: number; longitude: number } {
  if (store.latitude && store.longitude) {
    return {
      latitude: store.latitude,
      longitude: store.longitude
    };
  }

  return {
    latitude: 0.0,
    longitude: 0.0
  };
}

/**
 * Generate stores.json from approved stores in KV
 * This is automatically called after approving or rejecting stores
 */
export async function regenerateStoresJSON(kv: KVNamespace): Promise<number> {
  const pendingData = await loadPendingStores(kv);

  // Filter approved stores only
  const approvedStores = pendingData.submissions.filter(s => s.status === 'approved');

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
      is_verified: true,
      supports_casting: store.supports_casting || false,
      supports_flameworking_hard: store.supports_flameworking_hard || false,
      supports_flameworking_soft: store.supports_flameworking_soft || false,
      supports_fusing: store.supports_fusing || false,
      supports_glass_blowing: store.supports_glass_blowing || false,
      supports_stained_glass: store.supports_stained_glass || false,
      supports_other: store.supports_other || false,
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

  // Save to KV
  await saveStoresJSON(kv, output);

  console.log(`✅ Auto-regenerated stores.json with ${publicStores.length} approved stores`);

  return publicStores.length;
}
