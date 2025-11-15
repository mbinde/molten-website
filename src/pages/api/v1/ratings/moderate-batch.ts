/**
 * POST /api/v1/ratings/moderate-batch - Batch moderate pending submissions
 *
 * Purpose:
 * - Daily cron job to moderate pending submissions using Perspective API
 * - Checks up to 1000 pending submissions per run
 * - Updates moderation_status based on toxicity scores
 *
 * Security:
 * - Internal endpoint (should be triggered by Cloudflare Cron only)
 * - No authentication required (cron runs in worker context)
 *
 * Response:
 * 200: {
 *   "success": true,
 *   "processed": 150,
 *   "approved": 145,
 *   "rejected": 5,
 *   "errors": ["..."]  // Optional
 * }
 */

import type { APIRoute } from 'astro';

export const prerender = false;

// Perspective API configuration
const PERSPECTIVE_URL = 'https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze';
const TOXICITY_THRESHOLD = 0.7; // 70% confidence = toxic
const PROFANITY_THRESHOLD = 0.7; // 70% confidence = profane
const SEVERE_TOXICITY_THRESHOLD = 0.8; // 80% confidence = severely toxic
const BATCH_LIMIT = 1000; // Max submissions per batch
const RATE_LIMIT_DELAY_MS = 100; // 100ms between requests (max 10 req/sec)

interface PerspectiveRequest {
  comment: { text: string };
  languages: string[];
  requestedAttributes: {
    TOXICITY: Record<string, never>;
    SEVERE_TOXICITY: Record<string, never>;
    PROFANITY: Record<string, never>;
  };
}

interface PerspectiveResponse {
  attributeScores: {
    TOXICITY: { summaryScore: { value: number } };
    SEVERE_TOXICITY: { summaryScore: { value: number } };
    PROFANITY: { summaryScore: { value: number } };
  };
}

interface PendingSubmission {
  id: number;
  item_stable_id: string;
  cloudkit_user_id_hash: string;
}

export const POST: APIRoute = async ({ locals }) => {
  const startTime = Date.now();

  try {
    // Get runtime bindings
    const db = (locals.runtime.env as any).RATINGS_DB;
    const apiKey = (locals.runtime.env as any).PERSPECTIVE_API_KEY;

    if (!db) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Database not configured'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!apiKey) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Perspective API key not configured'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 1. Fetch pending submissions (limit to batch size)
    const pendingResult = await db.prepare(`
      SELECT id, item_stable_id, cloudkit_user_id_hash
      FROM rating_submissions
      WHERE moderation_status = 'pending'
      ORDER BY submitted_at ASC
      LIMIT ?
    `).bind(BATCH_LIMIT).all<PendingSubmission>();

    const pendingSubmissions = pendingResult.results;

    if (pendingSubmissions.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No pending submissions to moderate',
        processed: 0,
        approved: 0,
        rejected: 0
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let approvedCount = 0;
    let rejectedCount = 0;
    const errors: string[] = [];

    // 2. Process each submission
    for (const submission of pendingSubmissions) {
      try {
        // Fetch the 5 words for this submission
        const wordsResult = await db.prepare(`
          SELECT word
          FROM word_submissions
          WHERE item_stable_id = ?
            AND cloudkit_user_id_hash = ?
          ORDER BY position ASC
        `).bind(submission.item_stable_id, submission.cloudkit_user_id_hash)
          .all<{ word: string }>();

        const words = wordsResult.results.map(r => r.word);

        if (words.length !== 5) {
          errors.push(`Submission ${submission.id} has ${words.length} words, expected 5`);
          continue;
        }

        // 3. Call Perspective API
        const text = words.join(' ');
        const perspectiveRequest: PerspectiveRequest = {
          comment: { text },
          languages: ['en'],
          requestedAttributes: {
            TOXICITY: {},
            SEVERE_TOXICITY: {},
            PROFANITY: {}
          }
        };

        const response = await fetch(`${PERSPECTIVE_URL}?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(perspectiveRequest)
        });

        if (!response.ok) {
          const errorText = await response.text();
          errors.push(`Perspective API error for submission ${submission.id}: ${response.status} - ${errorText}`);
          continue;
        }

        const data: PerspectiveResponse = await response.json();

        const toxicityScore = data.attributeScores.TOXICITY.summaryScore.value;
        const severeToxicityScore = data.attributeScores.SEVERE_TOXICITY.summaryScore.value;
        const profanityScore = data.attributeScores.PROFANITY.summaryScore.value;

        // 4. Determine moderation decision
        const isRejected =
          toxicityScore >= TOXICITY_THRESHOLD ||
          profanityScore >= PROFANITY_THRESHOLD ||
          severeToxicityScore >= SEVERE_TOXICITY_THRESHOLD;

        const status = isRejected ? 'rejected' : 'approved';

        // 5. Update database
        await db.prepare(`
          UPDATE rating_submissions
          SET
            moderation_status = ?,
            moderation_checked_at = ?,
            toxicity_score = ?,
            profanity_score = ?,
            severe_toxicity_score = ?
          WHERE id = ?
        `).bind(
          status,
          Math.floor(Date.now() / 1000),
          toxicityScore,
          profanityScore,
          severeToxicityScore,
          submission.id
        ).run();

        if (isRejected) {
          rejectedCount++;
        } else {
          approvedCount++;
        }

        // 6. Rate limiting: Wait between API calls (max 10 req/sec)
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));

      } catch (error) {
        errors.push(`Error processing submission ${submission.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    const durationMs = Date.now() - startTime;

    return new Response(JSON.stringify({
      success: true,
      processed: pendingSubmissions.length,
      approved: approvedCount,
      rejected: rejectedCount,
      durationMs,
      errors: errors.length > 0 ? errors : undefined
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in batch moderation endpoint:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
