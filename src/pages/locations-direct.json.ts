import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  try {
    // Get KV namespace from Cloudflare runtime
    const kv = (locals.runtime as any)?.env?.STORE_DATA;
    if (!kv) {
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

    // Get locations-json directly from KV - no fallbacks, no checks
    const locationsJSON = await kv.get('locations-json', 'text');

    if (!locationsJSON) {
      return new Response(
        JSON.stringify({ error: 'locations-json key not found in KV' }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }

    // Return the raw JSON from KV
    return new Response(
      locationsJSON,
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      }
    );

  } catch (error) {
    console.error('Error serving locations-direct.json:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error)
      }),
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
