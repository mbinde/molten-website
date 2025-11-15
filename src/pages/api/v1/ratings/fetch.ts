/**
 * GET /api/v1/ratings/fetch - Fetch aggregated ratings
 *
 * Purpose:
 * - Fetch aggregated rating data for one or more items
 * - Returns cached data from KV (updated hourly by cron)
 * - Batch fetch supported via comma-separated item IDs
 *
 * Query Parameters:
 * - items: Comma-separated list of item stable IDs (max 100)
 *   Example: ?items=bullseye-001-0,cim-412-0,ef-207-0
 *
 * Response:
 * 200: {
 *   "ratings": [
 *     {
 *       "itemStableId": "bullseye-001-0",
 *       "averageRating": 4.7,
 *       "totalRatings": 142,
 *       "topWords": [
 *         { "word": "beautiful", "frequency": 89, "rank": 1 },
 *         { "word": "vibrant", "frequency": 67, "rank": 2 },
 *         ...
 *       ],
 *       "lastAggregated": 1699564800
 *     }
 *   ]
 * }
 *
 * Error Responses:
 * 400: { "success": false, "error": "Invalid request" }
 * 500: { "success": false, "error": "Internal server error" }
 */

import type { APIRoute } from 'astro';
import { getCachedRating, getCachedRatingsBatch } from '../../../../lib/ratings';

export const prerender = false;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MAX_ITEMS_PER_REQUEST = 100;

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
};

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    // Get runtime bindings
    const kv = (locals.runtime.env as any).RATINGS_CACHE;

    if (!kv) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Cache not configured'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    // Parse query parameters
    const url = new URL(request.url);
    const itemsParam = url.searchParams.get('items');

    if (!itemsParam) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing "items" query parameter'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    // Parse item IDs
    const itemIds = itemsParam
      .split(',')
      .map(id => id.trim())
      .filter(id => id.length > 0);

    if (itemIds.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No valid item IDs provided'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    if (itemIds.length > MAX_ITEMS_PER_REQUEST) {
      return new Response(JSON.stringify({
        success: false,
        error: `Too many items requested. Maximum ${MAX_ITEMS_PER_REQUEST} per request.`
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    // Fetch ratings from cache
    let ratings;
    if (itemIds.length === 1) {
      // Single item - direct fetch
      const rating = await getCachedRating(kv, itemIds[0]);
      ratings = rating ? [rating] : [];
    } else {
      // Multiple items - batch fetch
      const ratingsMap = await getCachedRatingsBatch(kv, itemIds);
      ratings = Object.values(ratingsMap);
    }

    // Return ratings
    return new Response(JSON.stringify({
      ratings
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache', // Don't cache - we aggregate immediately
        ...CORS_HEADERS
      }
    });

  } catch (error) {
    console.error('Error in fetch ratings endpoint:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Internal server error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }
};
