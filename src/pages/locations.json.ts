import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  try {
    // Get KV namespace from Cloudflare runtime
    const kv = (locals.runtime as any)?.env?.STORE_DATA;
    if (!kv) {
      console.error('🚨 KV namespace STORE_DATA not found');
      return new Response(
        JSON.stringify({ error: 'Storage not configured' }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }

    // Get generated locations from KV (with fallback to old key)
    let locationsJSON = await kv.get('locations-json', 'text');

    // Fallback to old key for backward compatibility
    if (!locationsJSON) {
      console.log('⚠️  locations-json not found, checking old stores-json key...');
      locationsJSON = await kv.get('stores-json', 'text');
      if (locationsJSON) {
        console.log('✅ Found data in stores-json, will use it (migration recommended)');
        // Note: The old JSON has store_count/stores, but we'll return it as-is for now
        // The client should handle both formats, or you can run migration to update it
      }
    }

    if (!locationsJSON) {
      // Return empty locations list if not generated yet
      const emptyResponse = {
        version: '1.0',
        generated: new Date().toISOString(),
        location_count: 0,
        locations: []
      };

      return new Response(
        JSON.stringify(emptyResponse, null, 2),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=300' // Cache for 5 minutes
          }
        }
      );
    }

    return new Response(
      locationsJSON,
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=300' // Cache for 5 minutes
        }
      }
    );

  } catch (error) {
    console.error('Error serving locations.json:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  }
};
