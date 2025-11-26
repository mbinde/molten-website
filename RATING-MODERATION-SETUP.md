# Rating System Moderation - Setup Guide

This guide walks through setting up the two-tier moderation system for the Molten rating system.

## Overview

The rating system uses a **two-tier approach**:

1. **Tier 1 (Client-side)**: Comprehensive word list (100+ words) for instant feedback
2. **Tier 2 (Server-side)**: Daily batch moderation with Perspective API for ML-based detection

## Prerequisites

- ✅ Perspective API key (from Google Cloud Console)
- ✅ Cloudflare Pages project (`molten-website`)
- ✅ D1 database (`molten-ratings`)
- ✅ KV namespace (`RATINGS_CACHE`)

## Step 1: Database Migration

Run the migration to add moderation columns:

```bash
cd /Users/binde/molten-website

# Apply migration to D1 database
npx wrangler d1 execute molten-ratings --file=./migrations/0002_add_moderation_columns.sql
```

This adds:
- `moderation_status` (pending/approved/rejected)
- `moderation_checked_at` (timestamp)
- `toxicity_score`, `profanity_score`, `severe_toxicity_score` (0.0-1.0)

## Step 2: Configure Perspective API Key

Already completed! ✅ You've added `PERSPECTIVE_API_KEY` as a Cloudflare Pages secret.

Verify it's set:
```bash
npx wrangler pages secret list --project-name=molten-website
```

You should see `PERSPECTIVE_API_KEY` in the list.

## Step 3: Set Up Cron Trigger (Cloudflare Dashboard)

Cloudflare Pages doesn't support cron triggers in code. You need to set them up via the dashboard:

### Option A: Cloudflare Cron Triggers (Recommended)

1. Go to https://dash.cloudflare.com/
2. Navigate to **Workers & Pages** → **molten-website**
3. Go to **Settings** → **Triggers** tab
4. Click **Add Cron Trigger**
5. Set schedule: `0 3 * * *` (daily at 3am UTC)
6. Set endpoint: `https://moltenglass.app/api/v1/ratings/moderate-batch`
7. Click **Save**

### Option B: External Scheduler (Alternative)

If Cloudflare Cron Triggers aren't available, use an external scheduler:

**Using GitHub Actions** (free):

Create `.github/workflows/moderate-ratings.yml`:

```yaml
name: Moderate Ratings Daily
on:
  schedule:
    - cron: '0 3 * * *'  # 3am UTC daily
  workflow_dispatch:  # Allow manual trigger

jobs:
  moderate:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger moderation endpoint
        run: |
          curl -X POST https://moltenglass.app/api/v1/ratings/moderate-batch
```

**Using Cloudflare Workers** (requires separate Worker):

Create a Worker that calls the endpoint on a schedule:

```typescript
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    await fetch('https://moltenglass.app/api/v1/ratings/moderate-batch', {
      method: 'POST'
    });
  }
}
```

Then configure the Worker cron trigger in `wrangler.toml`:

```toml
[triggers]
crons = ["0 3 * * *"]
```

## Step 4: Deploy Updated Code

Deploy the changes to Cloudflare Pages:

```bash
npm run build
npx wrangler pages deploy dist
```

Or if you have automatic deployments via Git:

```bash
git add -A
git commit -m "feat: add rating moderation system"
git push origin main
```

## Step 5: Test the System

### Test Tier 1 (Client-side filtering)

Try submitting a rating with profanity via the iOS app:
- Words: `["fuck", "this", "is", "bad", "stuff"]`
- Expected: Rejected immediately (client-side)

### Test Tier 2 (Server-side moderation)

1. Submit a rating with subtle toxicity that passes client-side:
   - Words: `["this", "sucks", "totally", "useless", "garbage"]`
   - Expected: Accepted by client, marked as `pending` in database

2. Manually trigger moderation (for testing):
   ```bash
   curl -X POST https://moltenglass.app/api/v1/ratings/moderate-batch
   ```

3. Check the response:
   ```json
   {
     "success": true,
     "processed": 1,
     "approved": 0,
     "rejected": 1,
     "durationMs": 1234
   }
   ```

4. Verify in database:
   ```bash
   npx wrangler d1 execute molten-ratings --command="SELECT id, moderation_status, toxicity_score FROM rating_submissions WHERE id = 123"
   ```

   Should show `moderation_status = 'rejected'` and `toxicity_score > 0.7`.

### Test Aggregation Filter

1. Submit a clean rating:
   - Words: `["beautiful", "vibrant", "smooth", "quality", "perfect"]`
   - Expected: `moderation_status = 'pending'`

2. Approve it manually (simulating batch moderation):
   ```bash
   npx wrangler d1 execute molten-ratings --command="UPDATE rating_submissions SET moderation_status = 'approved' WHERE id = 456"
   ```

3. Trigger aggregation:
   ```bash
   curl https://moltenglass.app/api/v1/ratings/aggregate-cron
   ```

4. Fetch ratings from app:
   - Expected: Only approved ratings appear in aggregated data

## Step 6: Monitor Moderation

### Check Moderation Stats

Query the database to see moderation statistics:

```bash
npx wrangler d1 execute molten-ratings --command="
SELECT
  moderation_status,
  COUNT(*) as count,
  AVG(toxicity_score) as avg_toxicity,
  AVG(profanity_score) as avg_profanity
FROM rating_submissions
GROUP BY moderation_status
"
```

### Monitor Cron Job Logs

View cron execution logs in Cloudflare dashboard:

1. Go to **Workers & Pages** → **molten-website**
2. Click **Logs** tab (Real-time Logs)
3. Filter by keyword: `moderate-batch`

### Set Up Alerts (Optional)

Create a Worker or GitHub Action to monitor rejection rates:

```typescript
// Check if rejection rate is too high (> 10%)
const response = await fetch('https://moltenglass.app/api/v1/ratings/moderate-batch', { method: 'POST' });
const data = await response.json();

const rejectionRate = data.rejected / (data.approved + data.rejected);
if (rejectionRate > 0.1) {
  // Send alert (email, Slack, etc.)
  await sendAlert(`High rejection rate: ${rejectionRate * 100}%`);
}
```

## Thresholds & Tuning

Current thresholds (in `moderate-batch.ts`):

```typescript
const TOXICITY_THRESHOLD = 0.7;           // 70% confidence
const PROFANITY_THRESHOLD = 0.7;          // 70% confidence
const SEVERE_TOXICITY_THRESHOLD = 0.8;    // 80% confidence
```

**If you see too many false positives:**
- Increase thresholds to 0.75 or 0.8
- Check rejected submissions manually
- Adjust per your community standards

**If you see too many false negatives:**
- Decrease thresholds to 0.6 or 0.65
- Monitor for abuse patterns

## Cost Estimation

**Perspective API Pricing:**
- Free tier: 1 QPS (queries per second)
- Paid tier: $1 per 1,000 requests beyond free tier

**Expected costs:**
- 1000 submissions/day = ~$0.30/month
- 100 submissions/day = Free (within free tier)

**Batch size optimization:**
- Current: 1000 submissions/batch (daily)
- If volume increases, run twice daily instead of increasing batch size

## Troubleshooting

### Moderation endpoint returns 500

Check:
1. Is `PERSPECTIVE_API_KEY` set correctly?
2. Is the API key valid? (test in Google Cloud Console)
3. Check Cloudflare logs for error details

### All submissions stuck as "pending"

Check:
1. Is cron trigger configured correctly?
2. Manually trigger: `curl -X POST https://moltenglass.app/api/v1/ratings/moderate-batch`
3. Check cron logs for errors

### Aggregation doesn't include new ratings

Check:
1. Are ratings approved? (`moderation_status = 'approved'`)
2. Run aggregation manually: `curl https://moltenglass.app/api/v1/ratings/aggregate-cron`
3. Check KV cache for stale data

## Manual Operations

### Approve a submission manually

```bash
npx wrangler d1 execute molten-ratings --command="
UPDATE rating_submissions
SET moderation_status = 'approved',
    moderation_checked_at = strftime('%s', 'now')
WHERE id = 123
"
```

### Reject a submission manually

```bash
npx wrangler d1 execute molten-ratings --command="
UPDATE rating_submissions
SET moderation_status = 'rejected',
    moderation_checked_at = strftime('%s', 'now'),
    toxicity_score = 1.0
WHERE id = 123
"
```

### Re-moderate all pending submissions

```bash
curl -X POST https://moltenglass.app/api/v1/ratings/moderate-batch
```

### Reset moderation status (for testing)

```bash
npx wrangler d1 execute molten-ratings --command="
UPDATE rating_submissions
SET moderation_status = 'pending',
    moderation_checked_at = NULL,
    toxicity_score = NULL,
    profanity_score = NULL,
    severe_toxicity_score = NULL
"
```

## Next Steps

1. ✅ Apply database migration
2. ✅ Verify Perspective API key is set
3. ⏳ Configure cron trigger (Option A or B)
4. ⏳ Deploy updated code
5. ⏳ Test with sample submissions
6. ⏳ Monitor for 1 week
7. ⏳ Adjust thresholds if needed

## Support

- **Perspective API Docs**: https://developers.perspectiveapi.com/
- **Cloudflare Cron Triggers**: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- **D1 Database**: https://developers.cloudflare.com/d1/
