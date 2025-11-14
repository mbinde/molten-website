# Rating System: Cloudflare Setup Guide

This guide walks through setting up the Cloudflare infrastructure for the rating system.

---

## Prerequisites

- Cloudflare account with Pages project deployed
- `wrangler` CLI installed (`npm install -g wrangler`)
- Logged in to Cloudflare: `wrangler login`

---

## Step 1: Create D1 Database

### Create the database

```bash
wrangler d1 create molten-ratings
```

This will output something like:
```
✅ Successfully created DB 'molten-ratings'
Created your database using D1's new storage backend.

[[d1_databases]]
binding = "RATINGS_DB"
database_name = "molten-ratings"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### Update wrangler.toml

Replace `PLACEHOLDER_REPLACE_AFTER_CREATING_D1` in `wrangler.toml` with the actual `database_id` from above.

### Run migrations

```bash
# Apply the migrations to your D1 database
wrangler d1 migrations apply molten-ratings
```

This will create the tables:
- `rating_submissions` - Individual user ratings
- `word_submissions` - Individual words from ratings
- `rate_limits` - Rate limiting tracking
- `aggregation_log` - Cron job execution log

### Verify tables were created

```bash
wrangler d1 execute molten-ratings --command "SELECT name FROM sqlite_master WHERE type='table';"
```

Should show: `rating_submissions`, `word_submissions`, `rate_limits`, `aggregation_log`

---

## Step 2: Create KV Namespace for Ratings Cache

### Create KV namespace

```bash
wrangler kv:namespace create "RATINGS_CACHE"
```

This will output:
```
✅ Successfully created KV namespace 'RATINGS_CACHE'
ID: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

Add the following to wrangler.toml:
[[kv_namespaces]]
binding = "RATINGS_CACHE"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### Update wrangler.toml

Replace `PLACEHOLDER_REPLACE_AFTER_CREATING_KV` in `wrangler.toml` with the actual KV namespace ID.

---

## Step 3: Deploy

After updating `wrangler.toml` with the actual IDs:

```bash
# Deploy the Pages site with new bindings
npm run deploy

# Or just deploy the functions
wrangler pages deploy
```

---

## Step 4: Verify Setup

### Test D1 connection

```bash
# Insert a test rating
wrangler d1 execute molten-ratings --command "INSERT INTO rating_submissions (item_stable_id, cloudkit_user_id_hash, star_rating, submitted_at, app_attest_token) VALUES ('test-item', 'test-hash', 5, $(date +%s), 'test-token');"

# Query it back
wrangler d1 execute molten-ratings --command "SELECT * FROM rating_submissions;"

# Clean up test data
wrangler d1 execute molten-ratings --command "DELETE FROM rating_submissions WHERE item_stable_id = 'test-item';"
```

### Test KV connection

```bash
# Write a test value
wrangler kv:key put --namespace-id=YOUR_RATINGS_CACHE_ID "test:key" '{"test":"value"}'

# Read it back
wrangler kv:key get --namespace-id=YOUR_RATINGS_CACHE_ID "test:key"

# Delete it
wrangler kv:key delete --namespace-id=YOUR_RATINGS_CACHE_ID "test:key"
```

---

## Step 5: Set up Cron Trigger (Optional - for later)

Once the aggregation cron job is implemented, add to `wrangler.toml`:

```toml
[triggers]
crons = ["0 * * * *"]  # Run every hour at minute 0
```

Then deploy:
```bash
wrangler pages deploy
```

---

## Environment Variables (if needed)

If you need to set environment variables (like secrets):

```bash
# Set a secret (not needed for basic rating system)
wrangler pages secret put SECRET_NAME
```

---

## Monitoring

### View D1 database stats
```bash
wrangler d1 info molten-ratings
```

### View recent aggregation logs
```bash
wrangler d1 execute molten-ratings --command "SELECT * FROM aggregation_log ORDER BY started_at DESC LIMIT 10;"
```

### Check KV storage usage
Via Cloudflare Dashboard → Workers & Pages → KV → RATINGS_CACHE

---

## Troubleshooting

### Migration fails
If migration fails partway through:
```bash
# Check which migrations have been applied
wrangler d1 migrations list molten-ratings

# Manually fix via SQL if needed
wrangler d1 execute molten-ratings --command "YOUR_FIX_SQL_HERE"
```

### Binding not found errors
Make sure `wrangler.toml` has the correct IDs and you've deployed after updating:
```bash
npm run deploy
```

---

## Cost Estimates

Based on Cloudflare's free tier:
- **D1**: 5GB storage, 5M rows read/day, 100K rows written/day (FREE)
- **KV**: 100K reads/day, 1K writes/day, 1GB storage (FREE)
- **Workers**: 100K requests/day (FREE)

The rating system should stay well within free tier limits for typical usage.

---

## Next Steps

After setup is complete:
1. Test API endpoints (see RATING-SYSTEM-API-TESTING.md)
2. Monitor initial usage
3. Set up cron job for aggregations
4. Add analytics/monitoring if desired
