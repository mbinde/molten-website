
# Rating System API Testing Guide

Quick reference for testing the rating system API endpoints.

---

## Endpoints

### 1. Submit Rating

**POST** `/api/v1/ratings/submit`

Submit a star rating + 5 descriptive words for an item.

**Request:**
```bash
curl -X POST https://your-domain.com/api/v1/ratings/submit \
  -H "Content-Type: application/json" \
  -d '{
    "itemStableId": "bullseye-001-0",
    "cloudkitUserIdHash": "a1b2c3d4e5f6...(64 char SHA-256 hash)",
    "starRating": 5,
    "words": ["beautiful", "vibrant", "smooth", "reliable", "stunning"],
    "appAttestToken": "test-token"
  }'
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Rating submitted successfully"
}
```

**Response (Rate Limited):**
```json
{
  "success": false,
  "error": "Rate limit exceeded. Maximum 60 submissions per hour."
}
```

---

### 2. Fetch Ratings

**GET** `/api/v1/ratings/fetch?items={item1},{item2},...`

Fetch aggregated ratings for one or more items.

**Request (Single Item):**
```bash
curl "https://your-domain.com/api/v1/ratings/fetch?items=bullseye-001-0"
```

**Request (Multiple Items):**
```bash
curl "https://your-domain.com/api/v1/ratings/fetch?items=bullseye-001-0,cim-412-0,ef-207-0"
```

**Response:**
```json
{
  "ratings": [
    {
      "itemStableId": "bullseye-001-0",
      "averageRating": 4.7,
      "totalRatings": 142,
      "topWords": [
        { "word": "beautiful", "frequency": 89, "rank": 1 },
        { "word": "vibrant", "frequency": 67, "rank": 2 },
        { "word": "smooth", "frequency": 45, "rank": 3 }
      ],
      "lastAggregated": 1699564800
    }
  ]
}
```

---

### 3. Delete User Ratings

**DELETE** `/api/v1/ratings/delete`

Delete all ratings submitted by a user (GDPR compliance).

**Request:**
```bash
curl -X DELETE https://your-domain.com/api/v1/ratings/delete \
  -H "Content-Type: application/json" \
  -d '{
    "cloudkitUserIdHash": "a1b2c3d4e5f6...(64 char SHA-256 hash)",
    "appAttestToken": "test-token"
  }'
```

**Response:**
```json
{
  "success": true,
  "deletedCount": 12
}
```

---

### 4. Manual Aggregation Trigger

**GET** `/api/v1/ratings/aggregate-cron`

Manually trigger rating aggregation (normally runs via cron).

**Request:**
```bash
curl "https://your-domain.com/api/v1/ratings/aggregate-cron"
```

**Response:**
```json
{
  "success": true,
  "itemsAggregated": 42,
  "duration": 1234
}
```

---

## Validation Rules

### Star Rating
- Must be integer 1-5

### Words
- Exactly 5 words required
- Each word: 1-30 characters
- Words must be unique (no duplicates)
- Profanity filtered (basic list)
- Auto-trimmed and lowercased

### CloudKit User ID Hash
- Must be 64-character SHA-256 hash
- Represents hashed CloudKit user record ID

### Rate Limiting
- 60 submissions per hour per user
- Sliding window

---

## Testing Locally

### 1. Set up D1 and KV
```bash
# Create D1 database
wrangler d1 create molten-ratings

# Create KV namespace
wrangler kv:namespace create "RATINGS_CACHE"

# Update wrangler.toml with IDs
# Run migrations
wrangler d1 migrations apply molten-ratings
```

### 2. Run dev server
```bash
npm run dev
```

### 3. Test endpoints
```bash
# Submit a test rating
curl -X POST http://localhost:4321/api/v1/ratings/submit \
  -H "Content-Type: application/json" \
  -d '{
    "itemStableId": "test-item",
    "cloudkitUserIdHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "starRating": 5,
    "words": ["beautiful", "vibrant", "smooth", "reliable", "stunning"],
    "appAttestToken": "test"
  }'

# Aggregate ratings (since no cron in dev)
curl http://localhost:4321/api/v1/ratings/aggregate-cron

# Fetch ratings
curl "http://localhost:4321/api/v1/ratings/fetch?items=test-item"
```

---

## Database Queries (Debugging)

### View all ratings
```bash
wrangler d1 execute molten-ratings --command "SELECT * FROM rating_submissions;"
```

### View all words
```bash
wrangler d1 execute molten-ratings --command "SELECT * FROM word_submissions ORDER BY item_stable_id, position;"
```

### View rate limits
```bash
wrangler d1 execute molten-ratings --command "SELECT * FROM rate_limits;"
```

### View aggregation log
```bash
wrangler d1 execute molten-ratings --command "SELECT * FROM aggregation_log ORDER BY started_at DESC LIMIT 10;"
```

### Count ratings per item
```bash
wrangler d1 execute molten-ratings --command "SELECT item_stable_id, COUNT(*) as count FROM rating_submissions GROUP BY item_stable_id ORDER BY count DESC;"
```

### Top words for an item
```bash
wrangler d1 execute molten-ratings --command "SELECT word, COUNT(*) as frequency FROM word_submissions WHERE item_stable_id = 'bullseye-001-0' GROUP BY word ORDER BY frequency DESC LIMIT 10;"
```

---

## Performance Notes

- **Fetch endpoint**: Cached in KV, edge-cached for 1 hour
- **Submit endpoint**: Invalidates cache, re-aggregated hourly by cron
- **Delete endpoint**: Invalidates affected caches immediately
- **Batch fetch**: Max 100 items per request

---

## Error Codes

- **400**: Validation error (check request body)
- **401**: Unauthorized (App Attest failed)
- **429**: Rate limit exceeded (60/hour)
- **500**: Server error (check logs)

---

## Next Steps

1. Set up actual App Attest verification (currently placeholder)
2. Add monitoring/analytics
3. Configure cron trigger in production
4. Add admin dashboard for viewing stats
