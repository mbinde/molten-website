/**
 * Simple Cloudflare Worker to trigger rating moderation on a schedule
 *
 * Deploy with:
 * npx wrangler deploy workers/moderate-ratings-cron.js --name moderate-ratings-cron
 *
 * Then add cron trigger in Cloudflare Dashboard:
 * Workers & Pages > moderate-ratings-cron > Triggers > Cron Triggers > Add Cron Trigger
 * Schedule: 0 3 * * * (3:00 AM UTC daily)
 */

export default {
  async scheduled(event, env, ctx) {
    // Call the moderation endpoint
    const response = await fetch('https://moltenglass.app/api/v1/ratings/moderate-batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    console.log('Moderation batch completed:', {
      status: response.status,
      processed: data.processed,
      approved: data.approved,
      rejected: data.rejected,
      errors: data.errors,
    });

    // If there were errors, log them
    if (!response.ok || !data.success) {
      console.error('Moderation batch failed:', data);
    }

    return data;
  },

  // Optional: Allow manual triggering via HTTP
  async fetch(request, env, ctx) {
    // Trigger the scheduled handler manually
    const result = await this.scheduled(null, env, ctx);

    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
