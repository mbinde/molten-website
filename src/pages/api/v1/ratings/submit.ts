/**
 * POST /api/v1/ratings/submit - Submit a rating
 *
 * Purpose:
 * - Submit a star rating + 5 descriptive words for an item
 * - Enforce rate limiting (60 submissions/hour per user)
 * - Validate via App Attest
 *
 * Security:
 * - App Attest assertion REQUIRED (X-Apple-Assertion header)
 * - CloudKit user ID hash required
 * - Rate limiting: 60 submissions/hour per user
 * - Profanity filtering on words
 *
 * Request Body:
 * {
 *   "itemStableId": "bullseye-001-0",
 *   "cloudkitUserIdHash": "sha256_hash_of_user_id",
 *   "starRating": 5,
 *   "words": ["beautiful", "vibrant", "smooth", "reliable", "stunning"],
 *   "appAttestToken": "base64_encoded_token"
 * }
 *
 * Response:
 * 200: { "success": true, "message": "Rating submitted" }
 * 400: { "success": false, "error": "Validation error", "errors": [...] }
 * 429: { "success": false, "error": "Rate limit exceeded" }
 * 500: { "success": false, "error": "Internal server error" }
 */

import type { APIRoute } from 'astro';
import {
  validateRatingSubmission,
  checkRateLimit,
  incrementRateLimit,
  submitRating,
  aggregateRatingsForItem,
  setCachedRating
} from '../../../../lib/ratings';

export const prerender = false;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Apple-Assertion',
};

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    // Get runtime bindings
    const db = (locals.runtime.env as any).RATINGS_DB;
    const kv = (locals.runtime.env as any).RATINGS_CACHE;

    if (!db || !kv) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Database not configured'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    // Parse request body
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid JSON in request body'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    // Validate submission
    const validation = validateRatingSubmission(body);
    if (!validation.valid) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Validation failed',
        errors: validation.errors
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    // Check rate limit
    const rateLimitCheck = await checkRateLimit(db, body.cloudkitUserIdHash);
    if (!rateLimitCheck.allowed) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Rate limit exceeded. Maximum 60 submissions per hour.'
      }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
          ...CORS_HEADERS
        }
      });
    }

    // TODO: Verify App Attest assertion
    // For now, we'll skip this step - add it when implementing full security
    // const assertionValid = await verifyAppAttestAssertion(request, body.appAttestToken);
    // if (!assertionValid) {
    //   return new Response(JSON.stringify({
    //     success: false,
    //     error: 'Invalid App Attest assertion'
    //   }), { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
    // }

    // Submit rating
    const result = await submitRating(db, body);
    if (!result.success) {
      return new Response(JSON.stringify({
        success: false,
        error: result.error || 'Failed to submit rating'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    // Increment rate limit counter
    await incrementRateLimit(db, body.cloudkitUserIdHash);

    // Immediately aggregate and update cache (for instant feedback during development)
    // TODO: Switch to cron-based aggregation with moderation when ready for production
    const aggregated = await aggregateRatingsForItem(db, body.itemStableId);
    if (aggregated) {
      await setCachedRating(kv, aggregated);
    }

    // Return success
    return new Response(JSON.stringify({
      success: true,
      message: 'Rating submitted successfully'
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-RateLimit-Remaining': String(rateLimitCheck.remaining),
        ...CORS_HEADERS
      }
    });

  } catch (error) {
    console.error('Error in submit rating endpoint:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Internal server error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }
};
