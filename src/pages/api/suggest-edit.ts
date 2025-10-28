import type { APIRoute } from 'astro';

interface EditSuggestion {
  store_stable_id: string;
  original_name: string;
  suggested_changes: {
    name?: string;
    website_url?: string;
    address_line1?: string;
    address_line2?: string;
    city?: string;
    state?: string;
    zip?: string;
    phone?: string;
    notes?: string;
    supports_casting?: boolean;
    supports_flameworking_hard?: boolean;
    supports_flameworking_soft?: boolean;
    supports_fusing?: boolean;
    supports_glass_blowing?: boolean;
    supports_stained_glass?: boolean;
    supports_other?: boolean;
  };
  edit_reason: string;
  submitter_name?: string;
  submitter_email?: string;
  submitted_at: string;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const data = await request.json();

    // Validate required fields
    const errors: string[] = [];

    if (!data.store_stable_id || typeof data.store_stable_id !== 'string') {
      errors.push('Store ID is required');
    }

    if (!data.edit_reason || typeof data.edit_reason !== 'string' || data.edit_reason.trim().length === 0) {
      errors.push('Edit reason is required');
    }

    if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
      errors.push('Store name is required');
    }

    if (!data.website_url || typeof data.website_url !== 'string' || data.website_url.trim().length === 0) {
      errors.push('Website URL is required');
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

    if (errors.length > 0) {
      return new Response(JSON.stringify({ error: errors.join(', ') }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Build edit suggestion object
    const suggestion: EditSuggestion = {
      store_stable_id: data.store_stable_id,
      original_name: data.original_name || data.name,
      suggested_changes: {
        name: data.name,
        website_url: data.website_url,
        address_line1: data.address_line1,
        address_line2: data.address_line2 || '',
        city: data.city,
        state: data.state,
        zip: data.zip,
        phone: data.phone || '',
        notes: data.notes || '',
        supports_casting: data.supports_casting === true || data.supports_casting === 'true',
        supports_flameworking_hard: data.supports_flameworking_hard === true || data.supports_flameworking_hard === 'true',
        supports_flameworking_soft: data.supports_flameworking_soft === true || data.supports_flameworking_soft === 'true',
        supports_fusing: data.supports_fusing === true || data.supports_fusing === 'true',
        supports_glass_blowing: data.supports_glass_blowing === true || data.supports_glass_blowing === 'true',
        supports_stained_glass: data.supports_stained_glass === true || data.supports_stained_glass === 'true',
        supports_other: data.supports_other === true || data.supports_other === 'true',
      },
      edit_reason: data.edit_reason,
      submitter_name: data.submitter_name || '',
      submitter_email: data.submitter_email || '',
      submitted_at: new Date().toISOString(),
    };

    // Store in KV
    const kv = (import.meta as any).env.MOLTEN_STORES;
    if (!kv) {
      throw new Error('KV namespace not available');
    }

    const suggestionId = `edit_suggestion:${Date.now()}`;
    await kv.put(suggestionId, JSON.stringify(suggestion));

    return new Response(
      JSON.stringify({
        message: 'Edit suggestion submitted successfully! We will review it shortly.',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error handling edit suggestion:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
