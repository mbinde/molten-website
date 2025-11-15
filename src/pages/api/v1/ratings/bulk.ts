/**
 * GET /api/v1/ratings/bulk
 *
 * Returns ALL aggregated ratings in a single response
 * Cached aggressively for performance
 *
 * Response: { ratings: AggregatedRating[], generatedAt: ISO8601 }
 */

import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const db = locals.runtime.env.DB;
  const kv = locals.runtime.env.KV_STORE;

  try {
    const cacheKey = 'ratings:bulk:all';

    // Try to get from KV cache first (24 hour TTL)
    const cached = await kv.get(cacheKey, 'json');
    if (cached) {
      console.log('✅ [bulk] Returning cached bulk ratings');
      return new Response(JSON.stringify(cached), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600', // Client can cache for 1 hour
        },
      });
    }

    // Fetch all aggregated ratings from KV
    // KV keys are prefixed with "ratings:aggregated:"
    const listResult = await kv.list({ prefix: 'ratings:aggregated:' });

    const ratings = [];
    for (const key of listResult.keys) {
      const rating = await kv.get(key.name, 'json');
      if (rating) {
        ratings.push(rating);
      }
    }

    const response = {
      ratings,
      generatedAt: new Date().toISOString(),
      count: ratings.length,
    };

    // Cache in KV for 24 hours (86400 seconds)
    await kv.put(cacheKey, JSON.stringify(response), {
      expirationTtl: 86400,
    });

    console.log(`✅ [bulk] Generated bulk ratings file (${ratings.length} ratings)`);

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600', // Client can cache for 1 hour
      },
    });

  } catch (error) {
    console.error('❌ [bulk] Failed to generate bulk ratings:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to generate bulk ratings',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
