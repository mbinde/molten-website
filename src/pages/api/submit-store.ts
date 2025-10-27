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

interface StoreSubmission {
  name: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  zip: string;
  phone?: string;
  website_url?: string;
  notes?: string;
  submitter_name?: string;
  submitter_email?: string;
}

interface PendingStore extends Omit<StoreSubmission, 'submitter_name' | 'submitter_email'> {
  stable_id: string;
  submitted_at: string;
  status: 'pending' | 'approved' | 'rejected';
  submitter?: {
    name?: string;
    email?: string;
  };
}

interface PendingStoresData {
  version: string;
  submissions: PendingStore[];
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

  // Validate state format (2 uppercase letters)
  if (data.state && !/^[A-Z]{2}$/.test(data.state)) {
    errors.push('State must be a 2-letter abbreviation (e.g., WA, CA, TX)');
  }

  // Validate ZIP format (5 or 9 digits)
  if (data.zip && !/^\d{5}(-\d{4})?$/.test(data.zip)) {
    errors.push('ZIP code must be in format 12345 or 12345-6789');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// Load existing pending stores from KV
async function loadPendingStores(kv: KVNamespace): Promise<PendingStoresData> {
  try {
    const content = await kv.get('pending-stores', 'json');
    if (content) {
      return content as PendingStoresData;
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
async function savePendingStores(kv: KVNamespace, data: PendingStoresData): Promise<void> {
  await kv.put('pending-stores', JSON.stringify(data, null, 2));
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
    const pendingStore: PendingStore = {
      stable_id: stableId,
      name: body.name.trim(),
      address_line1: body.address_line1.trim(),
      address_line2: body.address_line2?.trim() || undefined,
      city: body.city.trim(),
      state: body.state.trim().toUpperCase(),
      zip: body.zip.trim(),
      phone: body.phone?.trim() || undefined,
      website_url: body.website_url?.trim() || undefined,
      notes: body.notes?.trim() || undefined,
      submitted_at: new Date().toISOString(),
      status: 'pending'
    };

    // Add submitter info if provided
    if (body.submitter_name || body.submitter_email) {
      pendingStore.submitter = {
        name: body.submitter_name?.trim() || undefined,
        email: body.submitter_email?.trim() || undefined
      };
    }

    // Load existing pending stores from KV
    const pendingData = await loadPendingStores(kv);

    // Add new submission (hash IDs are unique, no duplicate checking needed)
    pendingData.submissions.push(pendingStore);

    // Save updated data to KV
    await savePendingStores(kv, pendingData);

    return new Response(
      JSON.stringify({
        message: 'Thank you! Your store submission has been received and will be reviewed shortly.',
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
    console.error('Error processing store submission:', error);

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
