import type { APIRoute } from 'astro';

export const prerender = false;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals.runtime as any)?.env;

    console.log('Test login - env available:', !!env);
    console.log('Test login - ADMIN_PASSWORD_HASH available:', !!env?.ADMIN_PASSWORD_HASH);

    const body = await request.json();
    const { password } = body;

    console.log('Test login - password received:', !!password);

    // Simple test without bcrypt
    const testResult = {
      hasEnv: !!env,
      hasPasswordHash: !!env?.ADMIN_PASSWORD_HASH,
      hasJwtSecret: !!env?.JWT_SECRET,
      passwordReceived: !!password,
      passwordLength: password?.length || 0
    };

    return new Response(
      JSON.stringify({
        message: 'Test login endpoint',
        debug: testResult
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
    console.error('Test login error:', error);
    return new Response(
      JSON.stringify({
        error: 'Test login failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
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
