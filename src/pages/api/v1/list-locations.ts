import type { APIRoute } from 'astro';
import { requireAuth } from '../../../lib/auth';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  // Get env from Cloudflare runtime
  const env = (locals.runtime as any)?.env;

  // Check authentication
  const auth = await requireAuth(env, request);
  if (!auth.authorized) {
    return new Response(
      JSON.stringify({ error: auth.error || 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Get KV namespace from Cloudflare runtime
    const kv = env?.STORE_DATA;
    if (!kv) {
      console.error('🚨 KV namespace STORE_DATA not found');
      return new Response(
        JSON.stringify({ error: 'Storage not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Load pending locations from KV (with fallback to old key for backward compatibility)
    let content = await kv.get('pending-locations', 'json');

    // Fallback: Check old key if new key doesn't exist
    if (!content) {
      console.log('⚠️  pending-locations not found, checking old pending-stores key...');
      content = await kv.get('pending-stores', 'json');
      if (content) {
        console.log('✅ Found data in pending-stores, will use it (migration recommended)');
      }
    }

    if (!content) {
      // Return empty list if no data in either key
      return new Response(
        JSON.stringify({
          version: '1.0',
          submissions: []
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify(content),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error listing stores:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
