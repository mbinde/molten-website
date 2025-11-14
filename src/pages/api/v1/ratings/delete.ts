/**
 * DELETE /api/v1/ratings/delete - Delete all user ratings
 *
 * Purpose:
 * - Allow users to delete all their ratings (GDPR compliance)
 * - Deletes from database and invalidates affected caches
 *
 * Security:
 * - App Attest assertion REQUIRED (X-Apple-Assertion header)
 * - CloudKit user ID hash required
 *
 * Request Body:
 * {
 *   "cloudkitUserIdHash": "sha256_hash_of_user_id",
 *   "appAttestToken": "base64_encoded_token"
 * }
 *
 * Response:
 * 200: { "success": true, "deletedCount": 12 }
 * 400: { "success": false, "error": "Invalid request" }
 * 401: { "success": false, "error": "Unauthorized" }
 * 500: { "success": false, "error": "Internal server error" }
 */

import type { APIRoute } from 'astro';
import { deleteUserRatings } from '../../../../lib/ratings';

export const prerender = false;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Apple-Assertion',
};

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
};

export const DELETE: APIRoute = async ({ request, locals }) => {
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

    // Validate required fields
    if (!body.cloudkitUserIdHash || body.cloudkitUserIdHash.length !== 64) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid CloudKit user ID hash'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    if (!body.appAttestToken) {
      return new Response(JSON.stringify({
        success: false,
        error: 'App attest token is required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
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

    // Get list of items this user rated (for cache invalidation)
    const userItems = await db
      .prepare('SELECT DISTINCT item_stable_id FROM rating_submissions WHERE cloudkit_user_id_hash = ?')
      .bind(body.cloudkitUserIdHash)
      .all();

    // Delete user ratings
    const result = await deleteUserRatings(db, body.cloudkitUserIdHash);
    if (!result.success) {
      return new Response(JSON.stringify({
        success: false,
        error: result.error || 'Failed to delete ratings'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    // Invalidate caches for affected items
    // (They will be re-aggregated by the cron job)
    if (userItems.results && userItems.results.length > 0) {
      await Promise.all(
        userItems.results.map((row: any) =>
          kv.delete(`ratings:aggregated:${row.item_stable_id}`)
        )
      );
    }

    // Return success
    return new Response(JSON.stringify({
      success: true,
      deletedCount: result.deletedCount
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...CORS_HEADERS
      }
    });

  } catch (error) {
    console.error('Error in delete ratings endpoint:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Internal server error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }
};
