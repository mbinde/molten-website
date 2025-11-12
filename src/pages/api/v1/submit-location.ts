import type { APIRoute } from 'astro';

// IMPORTANT: Disable prerendering for API routes (required for Cloudflare)
export const prerender = false;

// CORS headers for API routes
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Handle OPTIONS preflight request
export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
};

interface LocationSubmission {
  name: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
  website_url: string;
  retail_url?: string;
  classes_url?: string;
  rentals_url?: string;
  notes?: string;
  submitter_name?: string;
  submitter_phone?: string;
  submitter_email?: string;
  submitter_comments?: string;
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

interface PendingLocation extends Omit< LocationSubmission, 'submitter_name' | 'submitter_phone' | 'submitter_email' | 'submitter_comments'> {
  stable_id: string;
  submitted_at: string;
  status: 'pending' | 'approved' | 'rejected';
  submitter?: {
    name?: string;
    phone?: string;
    email?: string;
    comments?: string;
  };
  latitude?: number;
  longitude?: number;
  approved_at?: string;
  rejected_at?: string;
}

interface PendingLocationsData {
  version: string;
  submissions: PendingLocation[];
}

// Generate a unique hash ID for the store (12 lowercase hex characters)
function generateStableId(): string {
  const array = new Uint8Array(6); // 6 bytes = 12 hex chars
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Validate required fields
function validateSubmission(data: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
    errors.push('Store name is required');
  }

  if (!data.address_line1 || typeof data.address_line1 !== 'string' || data.address_line1.trim().length === 0) {
    errors.push('Address is required');
  }

  if (!data.city || typeof data.city !== 'string' || data.city.trim().length === 0) {
    errors.push('City is required');
  }

  if (!data.state || typeof data.state !== 'string' || data.state.trim().length === 0) {
    errors.push('State is required');
  }

  if (!data.zip || typeof data.zip !== 'string' || data.zip.trim().length === 0) {
    errors.push('ZIP code is required');
  }

  if (!data.country || typeof data.country !== 'string' || data.country.trim().length === 0) {
    errors.push('Country is required');
  }

  if (!data.website_url || typeof data.website_url !== 'string' || data.website_url.trim().length === 0) {
    errors.push('Website URL is required');
  }

  // Note: Removed restrictive validation for state/province and postal code
  // to support international addresses

  return {
    valid: errors.length === 0,
    errors
  };
}

// Load existing pending stores from KV
async function loadPendingLocations(kv: KVNamespace): Promise<PendingLocationsData> {
  try {
    const content = await kv.get('pending-locations', 'json');
    if (content) {
      return content as PendingLocationsData;
    }
  } catch (error) {
    console.error('Error loading from KV:', error);
  }

  // Return empty structure if nothing found or error
  return {
    version: '1.0',
    submissions: []
  };
}

// Save pending stores to KV
async function savePendingLocations(kv: KVNamespace, data: PendingLocationsData): Promise<void> {
  await kv.put('pending-locations', JSON.stringify(data, null, 2));
}

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    // Get KV namespace from Cloudflare runtime
    const kv = (locals.runtime as any)?.env?.STORE_DATA;
    if (!kv) {
      console.error('🚨 KV namespace STORE_DATA not found');
      return new Response(
        JSON.stringify({
          error: 'Storage not configured. Please contact administrator.'
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS
          }
        }
      );
    }

    // Parse request body
    const body = await request.json();

    // Validate submission
    const validation = validateSubmission(body);
    if (!validation.valid) {
      return new Response(
        JSON.stringify({
          error: 'Validation failed',
          details: validation.errors
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS
          }
        }
      );
    }

    // Generate unique hash ID
    const stableId = generateStableId();

    // Create pending store object
    const pendingLocation: PendingStore = {
      stable_id: stableId,
      name: body.name.trim(),
      address_line1: body.address_line1.trim(),
      address_line2: body.address_line2?.trim() || undefined,
      city: body.city.trim(),
      state: body.state.trim(),
      zip: body.zip.trim(),
      country: body.country.trim(),
      phone: body.phone?.trim() || undefined,
      website_url: body.website_url?.trim() || undefined,
      retail_url: body.retail_url?.trim() || undefined,
      classes_url: body.classes_url?.trim() || undefined,
      rentals_url: body.rentals_url?.trim() || undefined,
      notes: body.notes?.trim() || undefined,
      submitted_at: new Date().toISOString(),
      status: 'pending',
      // Retail glass offerings
      retail_supports_casting: body.retail_supports_casting || false,
      retail_supports_flameworking_hard: body.retail_supports_flameworking_hard || false,
      retail_supports_flameworking_soft: body.retail_supports_flameworking_soft || false,
      retail_supports_fusing: body.retail_supports_fusing || false,
      retail_supports_glass_blowing: body.retail_supports_glass_blowing || false,
      retail_supports_stained_glass: body.retail_supports_stained_glass || false,
      retail_supports_other: body.retail_supports_other || false,
      // Classes offerings
      classes_supports_casting: body.classes_supports_casting || false,
      classes_supports_flameworking_hard: body.classes_supports_flameworking_hard || false,
      classes_supports_flameworking_soft: body.classes_supports_flameworking_soft || false,
      classes_supports_fusing: body.classes_supports_fusing || false,
      classes_supports_glass_blowing: body.classes_supports_glass_blowing || false,
      classes_supports_stained_glass: body.classes_supports_stained_glass || false,
      classes_supports_other: body.classes_supports_other || false,
      // Rentals offerings
      rentals_supports_casting: body.rentals_supports_casting || false,
      rentals_supports_flameworking_hard: body.rentals_supports_flameworking_hard || false,
      rentals_supports_flameworking_soft: body.rentals_supports_flameworking_soft || false,
      rentals_supports_fusing: body.rentals_supports_fusing || false,
      rentals_supports_glass_blowing: body.rentals_supports_glass_blowing || false,
      rentals_supports_stained_glass: body.rentals_supports_stained_glass || false,
      rentals_supports_other: body.rentals_supports_other || false,
    };

    // Add submitter info if provided
    if (body.submitter_name || body.submitter_phone || body.submitter_email || body.submitter_comments) {
      pendingLocation.submitter = {
        name: body.submitter_name?.trim() || undefined,
        phone: body.submitter_phone?.trim() || undefined,
        email: body.submitter_email?.trim() || undefined,
        comments: body.submitter_comments?.trim() || undefined
      };
    }

    // Load existing pending stores from KV
    const pendingData = await loadPendingLocations(kv);

    // Add new submission (hash IDs are unique, no duplicate checking needed)
    pendingData.submissions.push(pendingLocation);

    // Save updated data to KV
    await savePendingLocations(kv, pendingData);

    return new Response(
      JSON.stringify({
        message: 'Thank you! Your location submission has been received and will be reviewed shortly.',
        stable_id: stableId
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...CORS_HEADERS
        }
      }
    );

  } catch (error) {
    console.error('Error processing location submission:', error);

    return new Response(
      JSON.stringify({
        error: 'Internal server error. Please try again later.'
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...CORS_HEADERS
        }
      }
    );
  }
};
