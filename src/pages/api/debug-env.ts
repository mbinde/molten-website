import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  try {
    const env = (locals.runtime as any)?.env;

    const debug = {
      hasRuntime: !!locals.runtime,
      hasEnv: !!env,
      hasStoreData: !!env?.STORE_DATA,
      hasAdminPasswordHash: !!env?.ADMIN_PASSWORD_HASH,
      hasJwtSecret: !!env?.JWT_SECRET,
      adminPasswordHashLength: env?.ADMIN_PASSWORD_HASH?.length || 0,
      jwtSecretLength: env?.JWT_SECRET?.length || 0,
      envKeys: env ? Object.keys(env) : []
    };

    return new Response(
      JSON.stringify(debug, null, 2),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'Debug failed',
        message: error instanceof Error ? error.message : 'Unknown error'
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
