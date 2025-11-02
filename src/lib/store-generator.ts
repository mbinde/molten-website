/**
 * Shared logic for generating stores.json from approved stores
 * Used by approve-store.ts and reject-store.ts to auto-regenerate after changes
 */

interface PendingStore {
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
  // Rentals offerings (for future use)
  rentals_supports_casting?: boolean;
  rentals_supports_flameworking_hard?: boolean;
  rentals_supports_flameworking_soft?: boolean;
  rentals_supports_fusing?: boolean;
  rentals_supports_glass_blowing?: boolean;
  rentals_supports_stained_glass?: boolean;
  rentals_supports_other?: boolean;
}

interface PendingStoresData {
  version: string;
  submissions: PendingStore[];
}

interface PublicStore {
  stable_id: string;
  name: string;
  address_line1?: string;
  address_line2?: string;
  city: string;
  state: string;
  zip?: string;
  country?: string;
  latitude: number;
  longitude: number;
  website_url?: string;
  retail_url?: string;
  classes_url?: string;
  rentals_url?: string;
  phone?: string;
  notes?: string;
  is_verified: boolean;
  // Retail glass offerings
  retail_supports_casting: boolean;
  retail_supports_flameworking_hard: boolean;
  retail_supports_flameworking_soft: boolean;
  retail_supports_fusing: boolean;
  retail_supports_glass_blowing: boolean;
  retail_supports_stained_glass: boolean;
  retail_supports_other: boolean;
  // Classes offerings
  classes_supports_casting: boolean;
  classes_supports_flameworking_hard: boolean;
  classes_supports_flameworking_soft: boolean;
  classes_supports_fusing: boolean;
  classes_supports_glass_blowing: boolean;
  classes_supports_stained_glass: boolean;
  classes_supports_other: boolean;
  // Rentals offerings
  rentals_supports_casting: boolean;
  rentals_supports_flameworking_hard: boolean;
  rentals_supports_flameworking_soft: boolean;
  rentals_supports_fusing: boolean;
  rentals_supports_glass_blowing: boolean;
  rentals_supports_stained_glass: boolean;
  rentals_supports_other: boolean;
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
      country: store.country,
      latitude: coords.latitude,
      longitude: coords.longitude,
      website_url: store.website_url,
      retail_url: store.retail_url,
      classes_url: store.classes_url,
      rentals_url: store.rentals_url,
      phone: store.phone,
      notes: store.notes,
      is_verified: true,
      // Retail glass offerings
      retail_supports_casting: store.retail_supports_casting || false,
      retail_supports_flameworking_hard: store.retail_supports_flameworking_hard || false,
      retail_supports_flameworking_soft: store.retail_supports_flameworking_soft || false,
      retail_supports_fusing: store.retail_supports_fusing || false,
      retail_supports_glass_blowing: store.retail_supports_glass_blowing || false,
      retail_supports_stained_glass: store.retail_supports_stained_glass || false,
      retail_supports_other: store.retail_supports_other || false,
      // Classes offerings
      classes_supports_casting: store.classes_supports_casting || false,
      classes_supports_flameworking_hard: store.classes_supports_flameworking_hard || false,
      classes_supports_flameworking_soft: store.classes_supports_flameworking_soft || false,
      classes_supports_fusing: store.classes_supports_fusing || false,
      classes_supports_glass_blowing: store.classes_supports_glass_blowing || false,
      classes_supports_stained_glass: store.classes_supports_stained_glass || false,
      classes_supports_other: store.classes_supports_other || false,
      // Rentals offerings
      rentals_supports_casting: store.rentals_supports_casting || false,
      rentals_supports_flameworking_hard: store.rentals_supports_flameworking_hard || false,
      rentals_supports_flameworking_soft: store.rentals_supports_flameworking_soft || false,
      rentals_supports_fusing: store.rentals_supports_fusing || false,
      rentals_supports_glass_blowing: store.rentals_supports_glass_blowing || false,
      rentals_supports_stained_glass: store.rentals_supports_stained_glass || false,
      rentals_supports_other: store.rentals_supports_other || false,
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
