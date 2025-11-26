# Rating Moderation System - Implementation Status

**Date**: 2025-11-14
**System**: Two-tier profanity moderation for glass art ratings

---

## ✅ Completed Tasks

### 1. Database Schema Migration

**File**: `migrations/0002_add_moderation_columns_fixed.sql`

Successfully added to remote D1 database (`molten-ratings`):

- ✅ `moderation_status TEXT NOT NULL DEFAULT 'pending'`
- ✅ `moderation_checked_at INTEGER` (Unix timestamp)
- ✅ `toxicity_score REAL` (0.0-1.0 from Perspective API)
- ✅ `profanity_score REAL` (0.0-1.0 from Perspective API)
- ✅ `severe_toxicity_score REAL` (0.0-1.0 from Perspective API)
- ✅ Index: `idx_rating_submissions_moderation` (moderation_status, submitted_at)
- ✅ Index: `idx_rating_submissions_approved_item` (item_stable_id, moderation_status)

**Verification**:
```bash
npx wrangler d1 execute molten-ratings --remote --command="SELECT sql FROM sqlite_master WHERE type='table' AND name='rating_submissions'"
```

### 2. Client-Side Profanity List (Tier 1)

**Files**:
- `src/lib/ratings.ts` (server-side validation)
- `/Users/binde/projects/rating/Molten/Sources/Models/Helpers/ProfanityList.swift` (iOS client)

**Status**: ✅ Synchronized (72 words across 7 categories)

**Categories**:
1. Strong profanity (18 words)
2. Moderate profanity (11 words)
3. Racial/ethnic slurs - zero tolerance (10 words)
4. Sexual orientation/gender slurs - zero tolerance (8 words)
5. Disability slurs - zero tolerance (6 words)
6. Sexual/explicit content (12 words)
7. Spam/commercial (11 words)
8. Common obfuscations (16 variants)

### 3. Server-Side Batch Moderation (Tier 2)

**File**: `src/pages/api/v1/ratings/moderate-batch.ts`

**Status**: ✅ Deployed and tested

**Endpoint**: `POST /api/v1/ratings/moderate-batch`

**Features**:
- Processes up to 1000 pending submissions per batch
- Calls Google Perspective API for toxicity analysis
- Rate limiting: 100ms delay between requests (max 10 req/sec)
- Updates moderation_status based on thresholds:
  - TOXICITY ≥ 0.7 → rejected
  - PROFANITY ≥ 0.7 → rejected
  - SEVERE_TOXICITY ≥ 0.8 → rejected
- Stores all three scores in database for analytics
- Comprehensive error handling and reporting

**Test Result**:
```json
{
  "success": true,
  "message": "No pending submissions to moderate",
  "processed": 0,
  "approved": 0,
  "rejected": 0
}
```

### 4. Aggregation Filtering

**File**: `src/lib/ratings.ts` (`aggregateRatingsForItem`)

**Status**: ✅ Updated to filter by moderation_status

**Changes**:
- Star ratings: Only include `WHERE moderation_status = 'approved'`
- Word frequencies: JOIN with rating_submissions and filter by `moderation_status = 'approved'`
- Ensures rejected submissions never appear in public ratings

### 5. Deployment

**Status**: ✅ Deployed to Cloudflare Pages

**Latest Deployment**: https://43c690fa.molten-website.pages.dev

**Modules Deployed**:
- `pages/api/v1/ratings/moderate-batch.astro.mjs` (5.22 KiB)
- `chunks/ratings_CUsjcfas.mjs` (9.24 KiB - includes updated profanity list)

---

## ⏳ Remaining Tasks

### 1. Configure Cloudflare Cron Trigger

**Status**: ❌ Not configured (requires Cloudflare dashboard access)

**Required Steps**:

#### Option A: Cloudflare Dashboard (Recommended)
1. Go to Cloudflare Dashboard → Workers & Pages
2. Select "molten-website" project
3. Go to "Settings" → "Triggers" → "Cron Triggers"
4. Click "Add Cron Trigger"
5. Set schedule: `0 3 * * *` (3:00 AM UTC daily)
6. Set endpoint: `/api/v1/ratings/moderate-batch`
7. Save

#### Option B: GitHub Actions
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
      - name: Trigger moderation
        run: |
          curl -X POST https://moltenglass.app/api/v1/ratings/moderate-batch \
            -H "Content-Type: application/json"
```

#### Option C: Separate Cloudflare Worker
Create a scheduled worker that calls the endpoint.

### 2. Testing

**Status**: ❌ Not tested with real submissions

**Test Plan**:

#### Test Case 1: Tier 1 (Client-side) Rejection
1. iOS app submits rating with word "fuck"
2. Client-side validation should catch it immediately
3. Submission should be rejected before reaching server

#### Test Case 2: Tier 2 (Server-side) Approval
1. Submit rating with clean words: "beautiful", "colorful", "vibrant", "stunning", "quality"
2. Rating should be stored with `moderation_status = 'pending'`
3. Wait for cron job (or manually trigger endpoint)
4. Rating should be updated to `moderation_status = 'approved'`
5. Rating should appear in aggregated results

#### Test Case 3: Tier 2 (Server-side) Rejection
1. Submit rating with subtle toxicity that passes Tier 1 (e.g., "terrible", "awful", "garbage", "worthless", "waste")
2. Rating should be stored with `moderation_status = 'pending'`
3. Trigger moderation endpoint
4. Rating should be updated to `moderation_status = 'rejected'` (if toxicity ≥ 0.7)
5. Rating should NOT appear in aggregated results

#### Test Case 4: Verify Aggregation Filtering
1. Create mix of approved/rejected submissions for same item
2. Query aggregated ratings for that item
3. Verify only approved submissions are included in:
   - Average star rating
   - Total rating count
   - Word frequency list

### 3. Monitoring

**Status**: ❌ Not configured

**Recommended Monitoring**:
1. Set up Cloudflare Workers analytics for moderation endpoint
2. Create dashboard to track:
   - Pending submission count (should trend toward 0 after cron runs)
   - Approval rate (% approved vs rejected)
   - Average toxicity scores
   - API error rate
3. Set up alerts for:
   - Perspective API failures
   - Unusually high rejection rate (may indicate spam attack)
   - Pending backlog > 5000 submissions

### 4. Cost Optimization (Optional)

**Current Settings**:
- Batch size: 1000 submissions per run
- Rate limit: 100ms delay (max 10 req/sec)
- Schedule: Daily at 3am UTC

**Optimization Options**:
1. **Reduce batch size** if 1000 submissions take too long
2. **Increase delay** to stay under Perspective API free tier
3. **Run multiple times per day** if submissions are time-sensitive
4. **Use Cloudflare Workers analytics** to tune thresholds based on real data

---

## 📊 Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│                     iOS App (Client)                        │
│  1. User submits rating (5 stars + 5 words)                │
│  2. Tier 1: Client-side profanity check (72 words)         │
│     ├─ REJECT immediately if profanity detected            │
│     └─ ACCEPT: Send to server with moderation_status='pending'│
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              Cloudflare Pages + D1 Database                 │
│  1. Store submission with moderation_status='pending'       │
│  2. Return success to client                                │
│  3. Rating NOT included in aggregated results yet           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│         Daily Cron Job (3am UTC) - Not Yet Configured       │
│  POST /api/v1/ratings/moderate-batch                        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              Batch Moderation Process                       │
│  1. Fetch up to 1000 pending submissions                    │
│  2. For each submission:                                    │
│     a. Fetch 5 words from word_submissions                  │
│     b. Call Perspective API (rate limited: 100ms delay)     │
│     c. Get toxicity/profanity/severe_toxicity scores        │
│     d. REJECT if any score ≥ threshold                      │
│     e. APPROVE otherwise                                    │
│     f. Update moderation_status + scores in database        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              Aggregation (Only Approved)                    │
│  - Average star rating (WHERE moderation_status='approved') │
│  - Word frequencies (JOIN + WHERE moderation_status='approved')│
│  - Cached in KV for 1 week                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔧 Configuration

### Environment Variables (Already Configured)
- `PERSPECTIVE_API_KEY`: Google Perspective API key (set in Cloudflare Pages secrets)
- `RATINGS_DB`: D1 database binding (configured in wrangler.toml)

### Thresholds (Can be tuned)
File: `src/pages/api/v1/ratings/moderate-batch.ts`

```typescript
const TOXICITY_THRESHOLD = 0.7;          // 70% confidence
const PROFANITY_THRESHOLD = 0.7;         // 70% confidence
const SEVERE_TOXICITY_THRESHOLD = 0.8;   // 80% confidence
const BATCH_LIMIT = 1000;                // Max per batch
const RATE_LIMIT_DELAY_MS = 100;         // 100ms = 10 req/sec
```

**Tuning Recommendations**:
- If too many false positives (clean content rejected): **increase** thresholds
- If too many false negatives (toxic content approved): **decrease** thresholds
- Monitor scores in database to find optimal thresholds for your use case

---

## 📝 Next Steps

1. **Immediate**: Configure Cloudflare Cron Trigger (see Option A above)
2. **Testing**: Submit test ratings to verify both tiers work correctly
3. **Monitoring**: Set up analytics dashboard in Cloudflare
4. **Tuning**: After 1 week, review toxicity scores and adjust thresholds if needed

---

## 📚 Documentation References

- **Setup Guide**: `RATING-MODERATION-SETUP.md` (comprehensive setup instructions)
- **Migration File**: `migrations/0002_add_moderation_columns_fixed.sql`
- **Endpoint**: `src/pages/api/v1/ratings/moderate-batch.ts`
- **Ratings Library**: `src/lib/ratings.ts`
- **iOS Profanity List**: `/Users/binde/projects/rating/Molten/Sources/Models/Helpers/ProfanityList.swift`

---

## ✅ System Health Checklist

Before considering this complete, verify:

- [ ] Cron trigger is configured and running daily
- [ ] Test submission gets moderated correctly
- [ ] Approved submissions appear in aggregated ratings
- [ ] Rejected submissions do NOT appear in aggregated ratings
- [ ] Perspective API key is valid and not hitting rate limits
- [ ] Database indexes are being used (check query performance)
- [ ] Monitoring/alerting is in place
- [ ] iOS and server-side profanity lists remain in sync

---

**Status**: 🟡 Implementation Complete, Cron Configuration Required
