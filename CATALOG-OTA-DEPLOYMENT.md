# Catalog OTA (Over-The-Air) Updates - Deployment Guide

This document explains how to deploy the catalog OTA update system to Cloudflare Pages.

---

## 📋 Overview

The catalog OTA system allows the iOS app to download catalog updates without requiring App Store releases.

**Features:**
- ✅ Version checking (`GET /api/catalog/version`)
- ✅ Catalog downloads with gzip compression (`GET /api/catalog/data`)
- ✅ ETag support for 304 Not Modified responses
- ✅ Rate limiting (100/hour for version checks, 10/hour for downloads)
- ✅ Download analytics
- ✅ SHA-256 checksum verification

---

## 🔧 Step 1: Create Cloudflare KV Namespace

The catalog OTA system requires a Cloudflare KV namespace called `CATALOG_VERSIONS` to store:
- Catalog version metadata (version number, item count, checksums, changelogs)
- Compressed catalog JSON data (gzipped)
- Download analytics
- Rate limiting data

### Via Cloudflare Dashboard:

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Select your account
3. Go to **Workers & Pages** → **KV**
4. Click **Create a namespace**
5. Name: `CATALOG_VERSIONS`
6. Click **Add**

### Via Wrangler CLI:

```bash
npx wrangler kv:namespace create "CATALOG_VERSIONS"
```

You'll get output like:
```
🌀  Creating namespace with title "CATALOG_VERSIONS"
✨  Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "CATALOG_VERSIONS", id = "abc123..." }
```

**Save the namespace ID** - you'll need it later!

---

## 🔗 Step 2: Bind KV Namespace to Pages Project

### Via Cloudflare Dashboard:

1. Go to **Workers & Pages**
2. Select your **molten-website** project
3. Go to **Settings** → **Functions**
4. Scroll to **KV Namespace Bindings**
5. Click **Add binding**
   - **Variable name**: `CATALOG_VERSIONS`
   - **KV namespace**: Select the `CATALOG_VERSIONS` namespace you created
6. Click **Save**

**⚠️ IMPORTANT**: Deploy a new version of your site after adding the binding for it to take effect.

---

## 📤 Step 3: Upload Initial Catalog

### 3.1 Set Environment Variables

Create a `.env` file (or export in shell):

```bash
# Find your Account ID in Cloudflare Dashboard URL or right sidebar
export CLOUDFLARE_ACCOUNT_ID="your-account-id"

# Create API token at: https://dash.cloudflare.com/profile/api-tokens
# Use "Edit Cloudflare Workers" template
export CLOUDFLARE_API_TOKEN="your-api-token"

# Find namespace ID in: Workers & Pages → KV → CATALOG_VERSIONS
export CLOUDFLARE_KV_NAMESPACE_ID="your-namespace-id"
```

### 3.2 Run Upload Script

The catalog JSON file should be in the iOS project at:
```
~/projects/catalog/Molten/Resources/glassitems.json
```

Upload it as version 1:

```bash
node upload-catalog.js ~/projects/catalog/Molten/Resources/glassitems.json 1 "Initial catalog version for OTA system"
```

Expected output:
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

---

## 🧪 Step 4: Test the Endpoints

### 4.1 Test Version Endpoint

```bash
curl -X GET https://molten.glass/api/catalog/version
```

Expected response (200 OK):
```json
{
  "version": 1,
  "item_count": 3198,
  "release_date": "2025-11-10T12:00:00.000Z",
  "file_size": 3145728,
  "checksum": "sha256:abc123def456...",
  "min_app_version": "1.5.0",
  "changelog": "Initial catalog version for OTA system"
}
```

### 4.2 Test Data Endpoint (without App Attest)

⚠️ **Note**: The data endpoint currently accepts requests without App Attest for testing. This will be enforced in production.

```bash
curl -X GET https://molten.glass/api/catalog/data \
  -H "Accept-Encoding: gzip" \
  --output catalog.json.gz
```

Decompress and verify:
```bash
gunzip catalog.json.gz
jq '.item_count' catalog.json
# Should output: 3198
```

### 4.3 Test ETag (304 Not Modified)

```bash
# First request - get ETag
ETAG=$(curl -sI https://molten.glass/api/catalog/data | grep -i etag | cut -d' ' -f2 | tr -d '\r')

# Second request with If-None-Match
curl -X GET https://molten.glass/api/catalog/data \
  -H "If-None-Match: $ETAG" \
  -v
# Should return: 304 Not Modified
```

### 4.4 Test Rate Limiting

```bash
# Run 11 requests rapidly (limit is 10/hour)
for i in {1..11}; do
  echo "Request $i:"
  curl -X GET https://molten.glass/api/catalog/data -w "\nStatus: %{http_code}\n\n"
done

# 11th request should return: 429 Too Many Requests
```

---

## 🚀 Step 5: Deploy to Production

### 5.1 Commit and Push

```bash
cd ~/molten-website
git add src/lib/catalog.ts
git add src/pages/api/catalog/version.ts
git add src/pages/api/catalog/data.ts
git add upload-catalog.js
git add CATALOG-OTA-DEPLOYMENT.md
git commit -m "feat: add catalog OTA update endpoints"
git push
```

### 5.2 Cloudflare Pages Auto-Deploy

Cloudflare Pages will automatically deploy when you push to `main` branch.

Monitor the deployment:
1. Go to **Workers & Pages** → **molten-website** → **Deployments**
2. Wait for deployment to complete
3. Click on the deployment to see logs

### 5.3 Verify KV Binding

After deployment, check that KV namespace is bound:

```bash
curl -X GET https://molten.glass/api/catalog/version
```

If you get `{"error": "Catalog storage not configured"}`, the KV binding is not active. Re-check Step 2.

---

## 📊 Step 6: Monitoring & Analytics

### 6.1 View Download Logs in KV

You can query download logs using Wrangler:

```bash
# List all download log keys
npx wrangler kv:key list --namespace-id YOUR_NAMESPACE_ID --prefix "catalog:download:"

# Get specific download log
npx wrangler kv:key get --namespace-id YOUR_NAMESPACE_ID "catalog:download:1699999999-abc123"
```

### 6.2 View Download Counts

```bash
# Get download count for version 1
npx wrangler kv:key get --namespace-id YOUR_NAMESPACE_ID "catalog:version:1:downloads"
```

### 6.3 Cloudflare Analytics

View request analytics in Cloudflare Dashboard:
1. Go to **Workers & Pages** → **molten-website**
2. Click **Analytics** tab
3. Filter by path: `/api/catalog/*`

Metrics available:
- Request rate (requests per second)
- Response time (p50, p99)
- Status codes (200, 304, 429, etc.)
- Bandwidth usage

---

## 🔄 Updating the Catalog

When you need to release a new catalog version:

### 1. Update `glassitems.json`

Make changes to the catalog file in the iOS project:
```
~/projects/catalog/Molten/Resources/glassitems.json
```

### 2. Upload New Version

```bash
node upload-catalog.js \
  ~/projects/catalog/Molten/Resources/glassitems.json \
  2 \
  "Added 15 new AB Imagery colors, updated 7 discontinued Effetre items"
```

### 3. Verify New Version

```bash
curl -X GET https://molten.glass/api/catalog/version
# Should return version: 2
```

### 4. iOS App Will Auto-Update

The iOS app's `BackgroundUpdateService` checks for updates:
- On app launch
- Based on user's update frequency setting (daily/weekly/manual)
- User can manually check in Settings → Catalog Info

---

## 🔒 Security Notes

### App Attest Enforcement

Currently, the `/api/catalog/data` endpoint accepts requests without App Attest for testing. To enforce App Attest in production:

1. Update `src/lib/crypto.ts` - implement full App Attest verification
2. Remove the "allow for now" fallback in `verifyAppAttestAssertion()`
3. Test with iOS app to ensure attestation works

### Rate Limiting

Current limits:
- **Version checks**: 100/hour per IP
- **Data downloads**: 10/hour per IP

These limits are stored in KV and automatically reset after the time window.

To adjust limits, edit:
- `src/pages/api/catalog/version.ts` (line ~52)
- `src/pages/api/catalog/data.ts` (line ~88)

---

## 🐛 Troubleshooting

### Error: "Catalog storage not configured"

**Cause**: KV namespace not bound to Pages project

**Solution**:
1. Verify KV namespace exists in Cloudflare Dashboard
2. Check KV binding in **Settings** → **Functions** → **KV Namespace Bindings**
3. Ensure variable name is exactly `CATALOG_VERSIONS`
4. Deploy a new version after adding binding

### Error: "No catalog versions available" (404)

**Cause**: No catalog uploaded to KV

**Solution**:
```bash
# Check if catalog exists in KV
npx wrangler kv:key get --namespace-id YOUR_NAMESPACE_ID "catalog:latest_version"

# If empty, upload catalog
node upload-catalog.js ~/projects/catalog/Molten/Resources/glassitems.json 1 "Initial version"
```

### Rate Limit Not Resetting

**Cause**: KV TTL (time-to-live) not expiring correctly

**Solution**:
```bash
# Manually clear rate limit for testing
npx wrangler kv:key delete --namespace-id YOUR_NAMESPACE_ID "catalog:ratelimit:ip:YOUR_IP:catalog_data:WINDOW_ID"
```

### Compressed Data Corrupt

**Cause**: Base64 encoding/decoding issue

**Solution**:
1. Download catalog data: `curl https://molten.glass/api/catalog/data --output test.gz`
2. Test decompression: `gunzip test.gz`
3. If fails, check upload script's base64 encoding
4. Re-upload catalog with fixed script

---

## 📚 API Reference

### GET /api/catalog/version

**Purpose**: Check latest catalog version metadata

**Rate Limit**: 100 requests/hour per IP

**Headers**:
- `X-Apple-Assertion` (optional): App Attest assertion

**Response (200 OK)**:
```json
{
  "version": 2,
  "item_count": 3198,
  "release_date": "2025-11-02T08:46:18Z",
  "file_size": 3145728,
  "checksum": "sha256:abc123...",
  "min_app_version": "1.5.0",
  "changelog": "Added 15 new colors..."
}
```

**Caching**:
- `Cache-Control: public, max-age=3600` (1 hour)
- `ETag: "{version}"`

---

### GET /api/catalog/data

**Purpose**: Download full catalog JSON (gzipped)

**Rate Limit**: 10 requests/hour per IP

**Query Parameters**:
- `version` (optional): Specific version to download (defaults to latest)

**Headers**:
- `X-Apple-Assertion` (required): App Attest assertion
- `Accept-Encoding: gzip` (optional): Accept gzip encoding
- `If-None-Match` (optional): ETag for 304 Not Modified

**Response (200 OK)**:
- Content-Type: `application/json`
- Content-Encoding: `gzip`
- ETag: `"v{version}-{checksum}"`
- Cache-Control: `public, max-age=86400` (24 hours)
- X-Catalog-Version: `{version}`
- X-Checksum: `{checksum}`

**Response (304 Not Modified)**:
- Returned when `If-None-Match` matches current ETag
- No body, saves bandwidth

**Response (429 Too Many Requests)**:
```json
{
  "error": "Rate limit exceeded",
  "resetAt": "2025-11-10T14:00:00.000Z"
}
```

---

## 🎯 Next Steps

### v2.0 Features (Future)

1. **Delta/Incremental Updates**
   - Implement `GET /api/catalog/delta?from=1&to=2`
   - Only download changed items (smaller downloads)
   - Requires diff algorithm in upload script

2. **Device-Based Rate Limiting**
   - Track by App Attest key ID instead of just IP
   - More accurate limits per device

3. **Admin Dashboard**
   - Web UI to view analytics
   - Manage catalog versions
   - Block abusive devices

4. **Push Notifications**
   - Notify users when catalog update available
   - iOS APNs integration

---

## 📞 Support

For issues or questions:
1. Check Cloudflare Dashboard logs: **Workers & Pages** → **molten-website** → **Logs**
2. View KV data: `npx wrangler kv:key list --namespace-id YOUR_NAMESPACE_ID`
3. Check iOS app implementation: `Molten/Sources/Services/Core/CatalogUpdateService.swift`
4. Review documentation: `Molten/Docs/OTA-Catalog-Implementation-Plan.md`
