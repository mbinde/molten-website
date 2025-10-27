import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ locals }) => {
  try {
    const env = (locals.runtime as any)?.env;

    console.log('Step 1: Got env');

    // Import jwt dynamically
    const jwt = await import('jsonwebtoken');
    console.log('Step 2: jwt imported');

    const JWT_SECRET = env.JWT_SECRET;
    console.log('Step 3: Got JWT_SECRET, length:', JWT_SECRET?.length);

    // Try to generate token
    const token = jwt.sign(
      { admin: true },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    console.log('Step 4: Token generated, length:', token?.length);

    // Try to verify it
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('Step 5: Token verified:', decoded);

    return new Response(
      JSON.stringify({
        success: true,
        tokenGenerated: !!token,
        tokenLength: token?.length,
        decoded: decoded,
        steps: ['got env', 'jwt import', 'got secret', 'token generated', 'token verified']
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('JWT test error:', error);
    return new Response(
      JSON.stringify({
        error: 'JWT test failed',
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
