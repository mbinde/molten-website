/**
 * Rating System Library
 *
 * Handles rating submissions, aggregation, and caching operations
 */

import type { D1Database, KVNamespace } from '@cloudflare/workers-types';

// ============================================================================
// Types
// ============================================================================

export interface RatingSubmission {
  itemStableId: string;
  cloudkitUserIdHash: string;
  starRating: number;
  words: string[];
  appAttestToken: string;
}

export interface AggregatedRating {
  itemStableId: string;
  averageRating: number;
  totalRatings: number;
  topWords: RatingWord[];
  lastAggregated: number; // Unix timestamp
}

export interface RatingWord {
  word: string;
  frequency: number;
  rank: number;
}

interface RateLimitRecord {
  cloudkit_user_id_hash: string;
  submission_count: number;
  window_start: number;
}

// ============================================================================
// Constants
// ============================================================================

// Comprehensive profanity list (client-side filtering tier 1)
// Based on community-maintained lists + glass art context
const PROFANITY_LIST = new Set([
  // Strong profanity
  'fuck', 'fucked', 'fucker', 'fucking', 'fucks', 'motherfucker',
  'shit', 'shitty', 'shits', 'bullshit', 'horseshit',
  'cunt', 'cunts',
  'cock', 'cocks', 'cocksucker',
  'pussy', 'pussies',
  'asshole', 'assholes',

  // Moderate profanity
  'damn', 'goddamn', 'dammit',
  'hell',
  'ass', 'asses',
  'bitch', 'bitches', 'bitchy',
  'bastard', 'bastards',
  'crap', 'crappy',
  'piss', 'pissed', 'pissing',
  'dick', 'dicks',

  // Racial/ethnic slurs (zero tolerance)
  'nigger', 'nigga', 'nig',
  'chink', 'gook', 'jap',
  'kike', 'spic', 'wetback',
  'towelhead', 'raghead',
  'beaner', 'cracker',

  // Sexual orientation/gender slurs (zero tolerance)
  'fag', 'faggot', 'fags',
  'dyke', 'dykes',
  'tranny', 'trannies',
  'shemale',

  // Disability slurs (zero tolerance)
  'retard', 'retarded', 'retards',
  'tard', 'libtard',
  'spaz', 'spastic',

  // Sexual/explicit
  'porn', 'porno',
  'whore', 'whores',
  'slut', 'sluts', 'slutty',
  'rape', 'raping', 'rapist',

  // Spam/commercial
  'viagra', 'cialis',
  'casino', 'poker',
  'lottery', 'jackpot',
  'bitcoin', 'crypto',

  // Common obfuscations
  'fuk', 'fck', 'sht', 'btch'
]);

const RATE_LIMIT_WINDOW = 3600; // 1 hour in seconds
const RATE_LIMIT_MAX = 60; // 60 submissions per hour
const KV_CACHE_TTL = 604800; // 1 week in seconds

// ============================================================================
// Validation
// ============================================================================

export function validateRatingSubmission(submission: RatingSubmission): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate item stable ID
  if (!submission.itemStableId || submission.itemStableId.trim().length === 0) {
    errors.push('Item stable ID is required');
  }

  // Validate CloudKit user ID hash
  if (!submission.cloudkitUserIdHash || submission.cloudkitUserIdHash.length !== 64) {
    errors.push('Invalid CloudKit user ID hash (must be 64-character SHA-256)');
  }

  // Validate star rating
  if (submission.starRating < 1 || submission.starRating > 5) {
    errors.push('Star rating must be between 1 and 5');
  }

  // Validate words array
  if (!Array.isArray(submission.words)) {
    errors.push('Words must be an array');
  } else if (submission.words.length !== 5) {
    errors.push('Exactly 5 words are required');
  } else {
    // Validate each word
    submission.words.forEach((word, index) => {
      const cleanWord = word.trim().toLowerCase();

      if (cleanWord.length === 0) {
        errors.push(`Word ${index + 1} cannot be empty`);
      } else if (cleanWord.length > 30) {
        errors.push(`Word ${index + 1} must be 30 characters or less`);
      } else if (PROFANITY_LIST.has(cleanWord)) {
        errors.push(`Word ${index + 1} contains profanity`);
      }
    });

    // Check for duplicate words
    const uniqueWords = new Set(submission.words.map(w => w.trim().toLowerCase()));
    if (uniqueWords.size !== submission.words.length) {
      errors.push('Words must be unique');
    }
  }

  // Validate app attest token
  if (!submission.appAttestToken || submission.appAttestToken.length === 0) {
    errors.push('App attest token is required');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// ============================================================================
// Rate Limiting
// ============================================================================

export async function checkRateLimit(
  db: D1Database,
  cloudkitUserIdHash: string
): Promise<{ allowed: boolean; remaining: number }> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % RATE_LIMIT_WINDOW);

  // Get current rate limit record
  const result = await db
    .prepare('SELECT * FROM rate_limits WHERE cloudkit_user_id_hash = ?')
    .bind(cloudkitUserIdHash)
    .first<RateLimitRecord>();

  if (!result) {
    // No record exists - allowed
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }

  // Check if window has expired
  if (result.window_start < windowStart) {
    // Window expired - reset
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }

  // Check if under limit
  if (result.submission_count < RATE_LIMIT_MAX) {
    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX - result.submission_count - 1
    };
  }

  // Rate limit exceeded
  return { allowed: false, remaining: 0 };
}

export async function incrementRateLimit(
  db: D1Database,
  cloudkitUserIdHash: string
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % RATE_LIMIT_WINDOW);

  await db
    .prepare(`
      INSERT INTO rate_limits (cloudkit_user_id_hash, submission_count, window_start)
      VALUES (?, 1, ?)
      ON CONFLICT(cloudkit_user_id_hash) DO UPDATE SET
        submission_count = CASE
          WHEN window_start < ? THEN 1
          ELSE submission_count + 1
        END,
        window_start = ?
    `)
    .bind(cloudkitUserIdHash, windowStart, windowStart, windowStart)
    .run();
}

// ============================================================================
// Rating Submission
// ============================================================================

export async function submitRating(
  db: D1Database,
  submission: RatingSubmission
): Promise<{ success: boolean; error?: string }> {
  const now = Math.floor(Date.now() / 1000);

  try {
    // Start transaction (D1 doesn't support explicit transactions, but batch does atomic operations)
    const batch = [];

    // 1. Insert/update star rating
    batch.push(
      db.prepare(`
        INSERT INTO rating_submissions (item_stable_id, cloudkit_user_id_hash, star_rating, submitted_at, app_attest_token)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(item_stable_id, cloudkit_user_id_hash) DO UPDATE SET
          star_rating = excluded.star_rating,
          submitted_at = excluded.submitted_at,
          app_attest_token = excluded.app_attest_token
      `).bind(
        submission.itemStableId,
        submission.cloudkitUserIdHash,
        submission.starRating,
        now,
        submission.appAttestToken
      )
    );

    // 2. Delete old words for this user/item
    batch.push(
      db.prepare('DELETE FROM word_submissions WHERE item_stable_id = ? AND cloudkit_user_id_hash = ?')
        .bind(submission.itemStableId, submission.cloudkitUserIdHash)
    );

    // 3. Insert new words
    submission.words.forEach((word, index) => {
      batch.push(
        db.prepare(`
          INSERT INTO word_submissions (item_stable_id, cloudkit_user_id_hash, word, position, submitted_at)
          VALUES (?, ?, ?, ?, ?)
        `).bind(
          submission.itemStableId,
          submission.cloudkitUserIdHash,
          word.trim().toLowerCase(),
          index + 1,
          now
        )
      );
    });

    // Execute batch
    await db.batch(batch);

    return { success: true };
  } catch (error) {
    console.error('Error submitting rating:', error);
    return { success: false, error: 'Failed to submit rating' };
  }
}

// ============================================================================
// Delete User Ratings
// ============================================================================

export async function deleteUserRatings(
  db: D1Database,
  cloudkitUserIdHash: string
): Promise<{ success: boolean; deletedCount: number; error?: string }> {
  try {
    // Count ratings before deletion
    const countResult = await db
      .prepare('SELECT COUNT(*) as count FROM rating_submissions WHERE cloudkit_user_id_hash = ?')
      .bind(cloudkitUserIdHash)
      .first<{ count: number }>();

    const deletedCount = countResult?.count || 0;

    // Delete ratings and words
    await db.batch([
      db.prepare('DELETE FROM rating_submissions WHERE cloudkit_user_id_hash = ?')
        .bind(cloudkitUserIdHash),
      db.prepare('DELETE FROM word_submissions WHERE cloudkit_user_id_hash = ?')
        .bind(cloudkitUserIdHash)
    ]);

    return { success: true, deletedCount };
  } catch (error) {
    console.error('Error deleting user ratings:', error);
    return { success: false, deletedCount: 0, error: 'Failed to delete ratings' };
  }
}

// ============================================================================
// Aggregation
// ============================================================================

export async function aggregateRatingsForItem(
  db: D1Database,
  itemStableId: string
): Promise<AggregatedRating | null> {
  try {
    // Get average rating and count (ONLY approved submissions)
    const ratingStats = await db
      .prepare(`
        SELECT
          AVG(star_rating) as average_rating,
          COUNT(*) as total_ratings
        FROM rating_submissions
        WHERE item_stable_id = ?
          AND moderation_status = 'approved'
      `)
      .bind(itemStableId)
      .first<{ average_rating: number; total_ratings: number }>();

    if (!ratingStats || ratingStats.total_ratings === 0) {
      return null;
    }

    // Get word frequencies (ONLY from approved submissions)
    const wordResults = await db
      .prepare(`
        SELECT
          w.word,
          COUNT(*) as frequency
        FROM word_submissions w
        INNER JOIN rating_submissions r
          ON w.item_stable_id = r.item_stable_id
          AND w.cloudkit_user_id_hash = r.cloudkit_user_id_hash
        WHERE w.item_stable_id = ?
          AND r.moderation_status = 'approved'
        GROUP BY w.word
        ORDER BY frequency DESC, w.word ASC
        LIMIT 50
      `)
      .bind(itemStableId)
      .all<{ word: string; frequency: number }>();

    const topWords: RatingWord[] = wordResults.results.map((row, index) => ({
      word: row.word,
      frequency: row.frequency,
      rank: index + 1
    }));

    return {
      itemStableId,
      averageRating: Math.round(ratingStats.average_rating * 10) / 10, // Round to 1 decimal
      totalRatings: ratingStats.total_ratings,
      topWords,
      lastAggregated: Math.floor(Date.now() / 1000)
    };
  } catch (error) {
    console.error('Error aggregating ratings:', error);
    return null;
  }
}

// ============================================================================
// KV Cache Operations
// ============================================================================

export async function getCachedRating(
  kv: KVNamespace,
  itemStableId: string
): Promise<AggregatedRating | null> {
  try {
    const key = `ratings:aggregated:${itemStableId}`;
    const cached = await kv.get(key, 'json');
    return cached as AggregatedRating | null;
  } catch (error) {
    console.error('Error getting cached rating:', error);
    return null;
  }
}

export async function setCachedRating(
  kv: KVNamespace,
  rating: AggregatedRating
): Promise<void> {
  try {
    const key = `ratings:aggregated:${rating.itemStableId}`;
    await kv.put(key, JSON.stringify(rating), {
      expirationTtl: KV_CACHE_TTL
    });
  } catch (error) {
    console.error('Error setting cached rating:', error);
  }
}

export async function deleteCachedRating(
  kv: KVNamespace,
  itemStableId: string
): Promise<void> {
  try {
    const key = `ratings:aggregated:${itemStableId}`;
    await kv.delete(key);
  } catch (error) {
    console.error('Error deleting cached rating:', error);
  }
}

// ============================================================================
// Batch Operations
// ============================================================================

export async function getCachedRatingsBatch(
  kv: KVNamespace,
  itemStableIds: string[]
): Promise<Record<string, AggregatedRating>> {
  const result: Record<string, AggregatedRating> = {};

  // KV doesn't support batch get, so we fetch individually
  // In production, consider using Durable Objects or D1 for batch reads
  await Promise.all(
    itemStableIds.map(async (itemStableId) => {
      const rating = await getCachedRating(kv, itemStableId);
      if (rating) {
        result[itemStableId] = rating;
      }
    })
  );

  return result;
}
