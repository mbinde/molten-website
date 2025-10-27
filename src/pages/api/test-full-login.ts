import type { APIRoute } from 'astro';

export const prerender = false;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const POST: APIRoute = async ({ request, locals }) => {
  const steps: string[] = [];

  try {
    steps.push('1. Starting');

    // Get KV
    const kv = (locals.runtime as any)?.env?.STORE_DATA;
    steps.push('2. Got KV: ' + !!kv);

    if (!kv) {
      return new Response(
        JSON.stringify({ error: 'No KV', steps }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Get env
    const env = (locals.runtime as any)?.env;
    steps.push('3. Got env: ' + !!env);

    // Parse body
    const body = await request.json();
    const { password } = body;
    steps.push('4. Got password: ' + !!password);

    // Import bcrypt
    const bcrypt = await import('bcryptjs');
    steps.push('5. Imported bcrypt');

    // Verify password
    const hash = env.ADMIN_PASSWORD_HASH;
    const isValid = await bcrypt.compare(password, hash);
    steps.push('6. Password valid: ' + isValid);

    if (!isValid) {
      return new Response(
        JSON.stringify({ error: 'Invalid password', steps }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Import JWT
    const jwt = await import('jsonwebtoken');
    steps.push('7. Imported JWT');

    // Generate token
    const token = jwt.sign(
      { admin: true },
      env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    steps.push('8. Generated token: ' + !!token);

    return new Response(
      JSON.stringify({
        success: true,
        token,
        steps
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );

  } catch (error) {
    console.error('Full login test error:', error);
    return new Response(
      JSON.stringify({
        error: 'Test failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        steps
      }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
};
