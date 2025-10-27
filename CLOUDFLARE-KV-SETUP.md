# Cloudflare KV Setup Guide

## Problem Solved

The store submission system was getting 500 errors because Cloudflare Pages Functions are **serverless and read-only** - they cannot write to the filesystem. We've migrated all data storage to **Cloudflare KV** (key-value storage), which is designed for serverless environments.

## What You Need to Do

### Step 1: Create a KV Namespace

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **Workers & Pages** → **KV**
3. Click **Create a namespace**
4. Name it: `molten-store-data`
5. Click **Add**

### Step 2: Bind the KV Namespace to Your Pages Project

1. In Cloudflare Dashboard, go to **Workers & Pages**
2. Find your **moltenglass** Pages project
3. Click on it → **Settings** → **Functions**
4. Scroll to **KV Namespace Bindings**
5. Click **Add binding**
6. Fill in:
   - **Variable name:** `STORE_DATA` (must be exactly this!)
   - **KV namespace:** Select `molten-store-data` from dropdown
7. Click **Save**

### Step 3: Redeploy

The next git push will trigger a rebuild with the KV binding active. Or you can trigger a manual redeploy in the Cloudflare dashboard:

1. Go to your Pages project → **Deployments**
2. Click **Retry deployment** on the latest one

## How It Works Now

- **Store submissions** → Saved to `STORE_DATA` KV with key `pending-stores`
- **Approve/reject** → Updates the same KV key
- **Generate stores.json** → Saves to `STORE_DATA` KV with key `stores-json`
- **iOS app fetch** → Reads from `https://moltenglass.app/stores.json` (served from KV)

## Testing After Setup

1. **Test submission:** Visit https://moltenglass.app/submit-store/ and submit a test store
2. **Check admin:** Visit https://moltenglass.app/admin/stores and log in
3. **You should see:** Your test submission in the pending queue
4. **Approve it:** Click approve and check console for geocoding logs
5. **Generate:** Click "Generate stores.json from Approved Stores"
6. **Verify:** Visit https://moltenglass.app/stores.json to see the generated JSON

## Environment Variables Already Set

You already configured these in Cloudflare:
- ✅ `ADMIN_PASSWORD_HASH` - Your bcrypt password hash
- ✅ `JWT_SECRET` - For session tokens

## Troubleshooting

**If you still get "Storage not configured" errors:**
- Make sure the variable name is EXACTLY `STORE_DATA` (case-sensitive)
- Make sure you saved the binding in the Functions settings
- Try a manual redeploy to pick up the new binding

**If geocoding fails (0,0 coordinates):**
- This is okay! Stores still work in the app, just without a map view
- Nominatim sometimes fails for obscure addresses
- Check browser console for geocoding logs when approving stores

## Migration Notes

All old filesystem-based code has been removed. The system now:
- ✅ Works in Cloudflare's serverless environment
- ✅ Persists data across function invocations
- ✅ Scales automatically with KV's global distribution
- ✅ No file system dependencies
