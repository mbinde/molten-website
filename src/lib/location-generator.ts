/**
 * Shared logic for generating locations.json from approved locations
 * Used by approve-location.ts and reject-location.ts to auto-regenerate after changes
 */

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

interface PendingLocationsData {
  version: string;
  submissions: PendingLocation[];
}

interface PublicLocation {
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

interface LocationsOutput {
  version: string;
  generated: string;
  location_count: number;
  locations: PublicLocation[];
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

async function saveLocationsJSON(kv: KVNamespace, data: LocationsOutput): Promise<void> {
  await kv.put('locations-json', JSON.stringify(data, null, 2));
}

function getCoordinates(location: PendingLocation): { latitude: number; longitude: number } {
  if (location.latitude && location.longitude) {
    return {
      latitude: location.latitude,
      longitude: location.longitude
    };
  }

  return {
    latitude: 0.0,
    longitude: 0.0
  };
}

/**
 * Generate locations.json from approved locations in KV
 * This is automatically called after approving or rejecting locations
 */
export async function regenerateLocationsJSON(kv: KVNamespace): Promise<number> {
  const pendingData = await loadPendingLocations(kv);

  // Filter approved locations only
  const approvedLocations = pendingData.submissions.filter(s => s.status === 'approved');

  // Transform to public location format
  const publicLocations: PublicLocation[] = approvedLocations.map((location) => {
    const coords = getCoordinates(location);

    return {
      stable_id: location.stable_id,
      name: location.name,
      address_line1: location.address_line1,
      address_line2: location.address_line2,
      city: location.city,
      state: location.state,
      zip: location.zip,
      country: location.country,
      latitude: coords.latitude,
      longitude: coords.longitude,
      website_url: location.website_url,
      retail_url: location.retail_url,
      classes_url: location.classes_url,
      rentals_url: location.rentals_url,
      phone: location.phone,
      notes: location.notes,
      is_verified: true,
      // Retail glass offerings
      retail_supports_casting: location.retail_supports_casting || false,
      retail_supports_flameworking_hard: location.retail_supports_flameworking_hard || false,
      retail_supports_flameworking_soft: location.retail_supports_flameworking_soft || false,
      retail_supports_fusing: location.retail_supports_fusing || false,
      retail_supports_glass_blowing: location.retail_supports_glass_blowing || false,
      retail_supports_stained_glass: location.retail_supports_stained_glass || false,
      retail_supports_other: location.retail_supports_other || false,
      // Classes offerings
      classes_supports_casting: location.classes_supports_casting || false,
      classes_supports_flameworking_hard: location.classes_supports_flameworking_hard || false,
      classes_supports_flameworking_soft: location.classes_supports_flameworking_soft || false,
      classes_supports_fusing: location.classes_supports_fusing || false,
      classes_supports_glass_blowing: location.classes_supports_glass_blowing || false,
      classes_supports_stained_glass: location.classes_supports_stained_glass || false,
      classes_supports_other: location.classes_supports_other || false,
      // Rentals offerings
      rentals_supports_casting: location.rentals_supports_casting || false,
      rentals_supports_flameworking_hard: location.rentals_supports_flameworking_hard || false,
      rentals_supports_flameworking_soft: location.rentals_supports_flameworking_soft || false,
      rentals_supports_fusing: location.rentals_supports_fusing || false,
      rentals_supports_glass_blowing: location.rentals_supports_glass_blowing || false,
      rentals_supports_stained_glass: location.rentals_supports_stained_glass || false,
      rentals_supports_other: location.rentals_supports_other || false,
    };
  });

  // Sort by name
  publicLocations.sort((a, b) => a.name.localeCompare(b.name));

  // Create output structure
  const output: LocationsOutput = {
    version: '1.0',
    generated: new Date().toISOString(),
    location_count: publicLocations.length,
    locations: publicLocations
  };

  // Save to KV
  await saveLocationsJSON(kv, output);

  console.log(`✅ Auto-regenerated locations.json with ${publicLocations.length} approved locations`);

  return publicLocations.length;
}
