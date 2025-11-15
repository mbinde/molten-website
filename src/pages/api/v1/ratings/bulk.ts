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

    // Query D1 directly for all items with ratings
    const result = await db
      .prepare(
        `SELECT
          item_stable_id,
          AVG(stars) as average_rating,
          COUNT(*) as total_ratings
        FROM ratings
        GROUP BY item_stable_id
        HAVING COUNT(*) > 0`
      )
      .all();

    const ratings = [];

    // For each item with ratings, get top words from aggregated_words table
    for (const row of result.results) {
      const itemStableId = row.item_stable_id;
      const averageRating = row.average_rating;
      const totalRatings = row.total_ratings;

      // Get top 5 words for this item
      const wordsResult = await db
        .prepare(
          `SELECT word, frequency
           FROM aggregated_words
           WHERE item_stable_id = ?
           ORDER BY frequency DESC, word ASC
           LIMIT 5`
        )
        .bind(itemStableId)
        .all();

      const topWords = wordsResult.results.map((w, index) => ({
        word: w.word,
        frequency: w.frequency,
        rank: index + 1,
      }));

      ratings.push({
        item_stable_id: itemStableId,
        average_rating: averageRating,
        total_ratings: totalRatings,
        top_words: topWords,
        last_aggregated: Math.floor(Date.now() / 1000), // Unix timestamp
      });
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
