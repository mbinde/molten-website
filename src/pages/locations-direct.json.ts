import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  try {
    console.log('locals:', locals);
    console.log('locals.runtime:', (locals as any).runtime);

    // Get KV namespace from Cloudflare runtime
    const runtime = (locals as any).runtime;
    if (!runtime) {
      console.error('Runtime not available');
      return new Response(
        JSON.stringify({ error: 'Runtime not available', locals_keys: Object.keys(locals) }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
          }
        }
      );
    }

    const env = runtime.env;
    if (!env) {
      console.error('Env not available');
      return new Response(
        JSON.stringify({ error: 'Env not available', runtime_keys: Object.keys(runtime) }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
          }
        }
      );
    }

    const kv = env.STORE_DATA;
    if (!kv) {
      console.error('KV not available');
      return new Response(
        JSON.stringify({ error: 'STORE_DATA not configured', env_keys: Object.keys(env) }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
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
        }
      }
    );
  }
};
