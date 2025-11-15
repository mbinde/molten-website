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
  try {
    // Get runtime bindings
    const kv = (locals.runtime.env as any).RATINGS_CACHE;

    if (!kv) {
      return new Response(JSON.stringify({
        error: 'Cache not configured',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // List all ratings from KV cache (keys are "ratings:aggregated:<item_stable_id>")
    const listResult = await kv.list({ prefix: 'ratings:aggregated:' });

    const ratings = [];

    // Fetch each rating from KV
    for (const key of listResult.keys) {
      const rating = await kv.get(key.name, 'json');
      if (rating) {
        ratings.push(rating);
      }
    }

    console.log(`✅ [bulk] Fetched ${ratings.length} ratings from cache`);

    const response = {
      ratings,
      generatedAt: new Date().toISOString(),
      count: ratings.length,
    };

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
