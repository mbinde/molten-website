import type { APIRoute } from 'astro';
import { verifyPassword, generateToken } from '../../../lib/auth';
import { checkRateLimit, recordFailedAttempt, recordSuccessfulLogin, getClientIP } from '../../../lib/rate-limit';

// IMPORTANT: Disable prerendering for API routes (required for Cloudflare)
export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    // Get KV namespace from Cloudflare runtime
    const kv = (locals.runtime as any)?.env?.STORE_DATA;
    if (!kv) {
      console.error('🚨 KV namespace STORE_DATA not found');
      return new Response(
        JSON.stringify({ error: 'Storage not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check rate limit FIRST
    const rateLimitCheck = await checkRateLimit(kv, request);
    if (!rateLimitCheck.allowed) {
      return new Response(
        JSON.stringify({ error: rateLimitCheck.error || 'Too many failed attempts' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const env = (locals.runtime as any)?.env;

    const body = await request.json();
    const { password } = body;

    if (!password) {
      return new Response(
        JSON.stringify({ error: 'Password is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify password
    const isValid = await verifyPassword(env, password);

    if (!isValid) {
      // Record failed attempt
      const ip = getClientIP(request);
      await recordFailedAttempt(kv, ip);

      // Add delay to prevent brute force
      await new Promise(resolve => setTimeout(resolve, 1000));

      return new Response(
        JSON.stringify({ error: 'Invalid password' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Record successful login (resets IP attempts)
    const ip = getClientIP(request);
    await recordSuccessfulLogin(kv, ip);

    // Generate JWT token (valid for 24 hours)
    const token = await generateToken(env);

    return new Response(
      JSON.stringify({
        success: true,
        token,
        expiresIn: '24h'
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Login error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
