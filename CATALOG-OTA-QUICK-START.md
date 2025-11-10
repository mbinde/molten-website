# Catalog OTA Quick Start Guide

**Estimated Time:** 10 minutes

This guide walks you through deploying the catalog OTA update system to production.

---

## ✅ Step 1: Create Cloudflare KV Namespace (2 min)

### Via Wrangler CLI (Recommended):

```bash
cd ~/molten-website
npx wrangler kv:namespace create "CATALOG_VERSIONS"
```

You'll get output like:
```
🌀  Creating namespace with title "CATALOG_VERSIONS"
✨  Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "CATALOG_VERSIONS", id = "abc123def456..." }
```

**📝 SAVE THE NAMESPACE ID** - Copy `id = "abc123def456..."` for Step 3

### Alternative: Via Cloudflare Dashboard:

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Select your account
3. Click **Workers & Pages** → **KV**
4. Click **Create a namespace**
5. Name: `CATALOG_VERSIONS`
6. Click **Add**
7. **Copy the namespace ID** from the list

---

## ✅ Step 2: Bind KV Namespace to Pages Project (2 min)

### Via Cloudflare Dashboard:

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Click **Workers & Pages**
3. Click on your **molten-website** project
4. Go to **Settings** tab
5. Click **Functions** in the left sidebar
6. Scroll down to **KV Namespace Bindings**
7. Click **Add binding**
8. Fill in:
   - **Variable name**: `CATALOG_VERSIONS` (must be exact)
   - **KV namespace**: Select `CATALOG_VERSIONS` from dropdown
9. Click **Save**

⚠️ **IMPORTANT**: The binding won't work until you deploy (Step 5)

---

## ✅ Step 3: Set Environment Variables (1 min)

You need 3 values:

### 3.1 Get Your Account ID

**Option A**: From Cloudflare Dashboard URL
- Go to https://dash.cloudflare.com/
- Look at the URL: `https://dash.cloudflare.com/{ACCOUNT_ID}/...`
- Copy the account ID

**Option B**: From right sidebar
- Go to any page in Cloudflare Dashboard
- Look at the right sidebar under "Account ID"
- Click to copy

### 3.2 Create API Token

1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Click **Create Token**
3. Use **Edit Cloudflare Workers** template
4. Click **Continue to summary**
5. Click **Create Token**
6. **Copy the token** (you won't see it again!)

### 3.3 Set Environment Variables

```bash
# Replace with your actual values
export CLOUDFLARE_ACCOUNT_ID="your-account-id-from-3.1"
export CLOUDFLARE_API_TOKEN="your-api-token-from-3.2"
export CLOUDFLARE_KV_NAMESPACE_ID="your-namespace-id-from-step-1"
```

**💡 TIP**: Add these to your `~/.zshrc` or `~/.bashrc` to make them permanent:

```bash
echo 'export CLOUDFLARE_ACCOUNT_ID="your-account-id"' >> ~/.zshrc
echo 'export CLOUDFLARE_API_TOKEN="your-api-token"' >> ~/.zshrc
echo 'export CLOUDFLARE_KV_NAMESPACE_ID="your-namespace-id"' >> ~/.zshrc
source ~/.zshrc
```

---

## ✅ Step 4: Upload Initial Catalog (1 min)

Run the upload script to push your catalog to Cloudflare KV:

```bash
cd ~/molten-website
node upload-catalog.js \
  ~/projects/catalog/Molten/Resources/glassitems.json \
  1 \
  "Initial catalog version for OTA system"
```

**Expected output:**
```
📦 Uploading catalog to Cloudflare KV...

📖 Reading catalog file: ~/projects/catalog/Molten/Resources/glassitems.json
   ✅ Loaded 3198 glass items

🔒 Calculating checksum...
   ✅ Checksum: sha256:abc123def456...

🗜️  Compressing with gzip...
   ✅ Original: 3072.0 KB
   ✅ Compressed: 524.3 KB
   ✅ Compression: 82.9%

☁️  Uploading to Cloudflare KV...
   📝 Uploading version 1 metadata...
   ✅ Metadata uploaded
   📦 Uploading compressed catalog data...
   ✅ Catalog data uploaded
   🔖 Updating latest version pointer...
   ✅ Latest version set to 1

✅ SUCCESS! Catalog uploaded to Cloudflare KV
```

**❌ If you get an error:**
- Check environment variables are set: `echo $CLOUDFLARE_ACCOUNT_ID`
- Verify namespace ID matches from Step 1
- Ensure API token has "Edit Cloudflare Workers" permissions

---

## ✅ Step 5: Deploy to Cloudflare Pages (2 min)

Push the code to trigger auto-deployment:

```bash
cd ~/molten-website
git push origin main
```

**Monitor deployment:**
1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Click **Workers & Pages** → **molten-website**
3. Click **Deployments** tab
4. Watch the latest deployment (should be in progress)
5. Wait for status to change to **Success** (usually 1-2 minutes)

**💡 TIP**: Click on the deployment to see detailed logs if anything fails.

---

## ✅ Step 6: Test the Endpoints (2 min)

### 6.1 Test Version Endpoint

```bash
curl https://molten.glass/api/catalog/version
```

**Expected response (200 OK):**
```json
{
  "version": 1,
  "item_count": 3198,
  "release_date": "2025-11-10T20:00:00.000Z",
  "file_size": 3145728,
  "checksum": "sha256:abc123def456...",
  "min_app_version": "1.5.0",
  "changelog": "Initial catalog version for OTA system"
}
```

### 6.2 Test Data Endpoint

```bash
curl https://molten.glass/api/catalog/data \
  -H "Accept-Encoding: gzip" \
  --output catalog.json.gz

gunzip catalog.json.gz
cat catalog.json | head -20
```

**Expected**: Should see JSON catalog starting with:
```json
{
  "version": "1.0",
  "catalog_data_version": 1,
  "generated": "...",
  "item_count": 3198,
  "glassitems": [
    ...
  ]
}
```

### 6.3 Test ETag (304 Not Modified)

```bash
# Get ETag from first request
ETAG=$(curl -sI https://molten.glass/api/catalog/data | grep -i etag | cut -d' ' -f2 | tr -d '\r')
echo "ETag: $ETAG"

# Second request with If-None-Match should return 304
curl -I https://molten.glass/api/catalog/data \
  -H "If-None-Match: $ETAG"
```

**Expected**: `HTTP/2 304` (Not Modified)

### 6.4 Test Rate Limiting

```bash
# Make 11 requests rapidly (limit is 10/hour)
for i in {1..11}; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://molten.glass/api/catalog/data)
  echo "Request $i: HTTP $STATUS"
done
```

**Expected**:
- Requests 1-10: `HTTP 200`
- Request 11: `HTTP 429` (Too Many Requests)

---

## ✅ TROUBLESHOOTING

### ❌ Error: "Catalog storage not configured"

**Problem**: KV namespace not bound to Pages project

**Solution**:
1. Go back to Step 2 and verify KV binding
2. Ensure variable name is exactly `CATALOG_VERSIONS` (case-sensitive)
3. Deploy again (Step 5) - bindings don't take effect until deployment

### ❌ Error: "No catalog versions available" (404)

**Problem**: Catalog not uploaded to KV

**Solution**:
```bash
# Check if catalog exists
npx wrangler kv:key get \
  --namespace-id $CLOUDFLARE_KV_NAMESPACE_ID \
  "catalog:latest_version"

# If empty or error, run upload again
node upload-catalog.js ~/projects/catalog/Molten/Resources/glassitems.json 1 "Initial version"
```

### ❌ Upload script fails: "Failed to upload metadata"

**Problem**: Invalid API token or account ID

**Solution**:
1. Verify environment variables are set:
   ```bash
   echo $CLOUDFLARE_ACCOUNT_ID
   echo $CLOUDFLARE_API_TOKEN
   echo $CLOUDFLARE_KV_NAMESPACE_ID
   ```
2. Test API token:
   ```bash
   curl -X GET "https://api.cloudflare.com/client/v4/user/tokens/verify" \
     -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
   ```
3. If token invalid, create new one at https://dash.cloudflare.com/profile/api-tokens

### ❌ iOS App: "Failed to check for updates"

**Problem**: Network request failing from iOS app

**Solution**:
1. Test endpoints from browser first (Step 6)
2. Check iOS app logs for detailed error
3. Verify App Transport Security allows HTTPS to your domain
4. Check Cloudflare Dashboard → Analytics for failed requests

---

## 🎉 SUCCESS!

Your OTA catalog system is now live!

### What's Working:

✅ Server endpoints deployed and responding
✅ Catalog version 1 uploaded to Cloudflare KV
✅ Rate limiting active
✅ Caching with ETags working
✅ iOS app can check for updates

### Next Steps:

1. **Test with iOS App**:
   - Open app on simulator or device
   - Go to **Settings** → **Catalog Info**
   - Tap "Check for Updates"
   - Should see "Version 1 is the latest version"

2. **Update Catalog** (when needed):
   ```bash
   node upload-catalog.js \
     ~/projects/catalog/Molten/Resources/glassitems.json \
     2 \
     "Added 15 new colors, updated 7 discontinued items"
   ```

3. **Monitor Usage**:
   - Cloudflare Dashboard → Workers & Pages → molten-website → Analytics
   - Filter by path: `/api/catalog/*`
   - View requests, bandwidth, response times

---

## 📚 More Information

- **Full Deployment Guide**: `CATALOG-OTA-DEPLOYMENT.md`
- **Implementation Details**: `~/projects/catalog/Molten/Docs/OTA-Catalog-Implementation-Plan.md`
- **iOS Client Code**: `~/projects/catalog` (ota-catalog branch)

---

## 📞 Need Help?

Check logs in Cloudflare Dashboard:
1. **Workers & Pages** → **molten-website**
2. Click **Logs** tab
3. Select **Production** environment
4. Click **Begin log stream**
5. Make a request to see real-time logs

Or query KV directly:
```bash
# List all keys
npx wrangler kv:key list --namespace-id $CLOUDFLARE_KV_NAMESPACE_ID

# Get specific key
npx wrangler kv:key get \
  --namespace-id $CLOUDFLARE_KV_NAMESPACE_ID \
  "catalog:version:1:metadata"
```
