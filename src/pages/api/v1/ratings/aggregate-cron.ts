/**
 * Cron Job: Aggregate Ratings
 *
 * Purpose:
 * - Runs hourly to aggregate rating data from D1 into KV cache
 * - Processes items with new/updated ratings since last run
 * - Updates KV cache with fresh aggregated data
 *
 * Trigger:
 * - Scheduled via wrangler.toml cron trigger (every hour)
 * - Can also be manually triggered via GET request (for testing)
 *
 * Process:
 * 1. Find items with ratings submitted since last aggregation
 * 2. For each item, calculate average rating and word frequencies
 * 3. Store aggregated results in KV cache
 * 4. Log aggregation run to database
 *
 * Response:
 * 200: { "success": true, "itemsAggregated": 42, "duration": 1234 }
 * 500: { "success": false, "error": "..." }
 */

import type { APIRoute } from 'astro';
import { aggregateRatingsForItem, setCachedRating } from '../../../../lib/ratings';

export const prerender = false;

interface AggregationLogEntry {
  started_at: number;
  completed_at?: number;
  items_aggregated: number;
  status: 'running' | 'completed' | 'failed';
  error_message?: string;
}

async function runAggregation(db: any, kv: any): Promise<{ success: boolean; itemsAggregated: number; error?: string }> {
  const startTime = Math.floor(Date.now() / 1000);
  let itemsAggregated = 0;

  try {
    // Log aggregation start
    await db
      .prepare('INSERT INTO aggregation_log (started_at, status, items_aggregated) VALUES (?, ?, ?)')
      .bind(startTime, 'running', 0)
      .run();

    // Get last successful aggregation time (or 0 if never run)
    const lastRun = await db
      .prepare('SELECT MAX(completed_at) as last_completed FROM aggregation_log WHERE status = ?')
      .bind('completed')
      .first<{ last_completed: number | null }>();

    const lastAggregatedTime = lastRun?.last_completed || 0;

    // Find items with ratings submitted since last aggregation
    const itemsToAggregate = await db
      .prepare(`
        SELECT DISTINCT item_stable_id
        FROM rating_submissions
        WHERE submitted_at > ?
      `)
      .bind(lastAggregatedTime)
      .all<{ item_stable_id: string }>();

    console.log(`Found ${itemsToAggregate.results.length} items to aggregate`);

    // Aggregate each item
    for (const row of itemsToAggregate.results) {
      const aggregated = await aggregateRatingsForItem(db, row.item_stable_id);
      if (aggregated) {
        await setCachedRating(kv, aggregated);
        itemsAggregated++;
      }
    }

    // Log aggregation completion
    const endTime = Math.floor(Date.now() / 1000);
    await db
      .prepare('UPDATE aggregation_log SET completed_at = ?, status = ?, items_aggregated = ? WHERE started_at = ?')
      .bind(endTime, 'completed', itemsAggregated, startTime)
      .run();

    console.log(`Aggregation completed: ${itemsAggregated} items processed`);

    return { success: true, itemsAggregated };

  } catch (error: any) {
    console.error('Aggregation error:', error);

    // Log aggregation failure
    const endTime = Math.floor(Date.now() / 1000);
    await db
      .prepare('UPDATE aggregation_log SET completed_at = ?, status = ?, error_message = ? WHERE started_at = ?')
      .bind(endTime, 'failed', error.message || 'Unknown error', startTime)
      .run();

    return { success: false, itemsAggregated: 0, error: error.message };
  }
}

// Manual trigger endpoint (GET request)
export const GET: APIRoute = async ({ locals }) => {
  const startTime = Date.now();

  try {
    // Get runtime bindings
    const db = (locals.runtime.env as any).RATINGS_DB;
    const kv = (locals.runtime.env as any).RATINGS_CACHE;

    if (!db || !kv) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Database or cache not configured'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Run aggregation
    const result = await runAggregation(db, kv);

    const duration = Date.now() - startTime;

    if (result.success) {
      return new Response(JSON.stringify({
        success: true,
        itemsAggregated: result.itemsAggregated,
        duration
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      return new Response(JSON.stringify({
        success: false,
        error: result.error,
        duration
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

  } catch (error: any) {
    console.error('Error in aggregation endpoint:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Internal server error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// Scheduled cron handler
// Note: Cloudflare Pages doesn't support cron triggers directly
// This would need to be a separate Worker or use Cloudflare's Scheduled Events
// For now, this endpoint can be called manually or via an external scheduler
export const scheduled: any = async (event: any, env: any, ctx: any) => {
  console.log('Cron trigger: Starting rating aggregation');

  try {
    const db = env.RATINGS_DB;
    const kv = env.RATINGS_CACHE;

    if (!db || !kv) {
      console.error('Database or cache not configured');
      return;
    }

    const result = await runAggregation(db, kv);

    if (result.success) {
      console.log(`Cron: Successfully aggregated ${result.itemsAggregated} items`);
    } else {
      console.error(`Cron: Aggregation failed: ${result.error}`);
    }

  } catch (error) {
    console.error('Cron: Fatal error in aggregation:', error);
  }
};
