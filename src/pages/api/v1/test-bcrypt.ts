import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals.runtime as any)?.env;
    const body = await request.json();
    const { password } = body;

    console.log('Step 1: Imports successful');

    // Import bcrypt dynamically to see if it works
    const bcrypt = await import('bcryptjs');
    console.log('Step 2: bcrypt imported');

    // Try to compare
    const hash = env.ADMIN_PASSWORD_HASH;
    console.log('Step 3: Got hash from env');

    const result = await bcrypt.compare(password, hash);
    console.log('Step 4: bcrypt.compare completed:', result);

    return new Response(
      JSON.stringify({
        success: true,
        passwordMatches: result,
        steps: ['imports', 'bcrypt import', 'got hash', 'compare completed']
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Bcrypt test error:', error);
    return new Response(
      JSON.stringify({
        error: 'Bcrypt test failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
};
