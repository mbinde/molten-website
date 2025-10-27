import type { APIRoute } from 'astro';
import fs from 'fs/promises';
import path from 'path';

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

// Generate a stable_id slug from store name
function generateStableId(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-')          // Replace spaces with hyphens
    .replace(/-+/g, '-')           // Replace multiple hyphens with single
    .replace(/^-|-$/g, '');        // Remove leading/trailing hyphens
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

// Load existing pending stores
async function loadPendingStores(filePath: string): Promise<PendingStoresData> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    // File doesn't exist or is invalid, return empty structure
    return {
      version: '1.0',
      submissions: []
    };
  }
}

// Save pending stores
async function savePendingStores(filePath: string, data: PendingStoresData): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export const POST: APIRoute = async ({ request }) => {
  try {
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

    // Generate stable_id
    const stableId = generateStableId(body.name);

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

    // Load existing pending stores
    const dataPath = path.join(process.cwd(), 'public', 'data', 'pending-stores.json');
    const pendingData = await loadPendingStores(dataPath);

    // Check for duplicate stable_id
    const existingIndex = pendingData.submissions.findIndex(
      s => s.stable_id === stableId
    );

    if (existingIndex !== -1) {
      // Update existing submission (in case someone resubmits)
      pendingData.submissions[existingIndex] = pendingStore;
    } else {
      // Add new submission
      pendingData.submissions.push(pendingStore);
    }

    // Save updated data
    await savePendingStores(dataPath, pendingData);

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
