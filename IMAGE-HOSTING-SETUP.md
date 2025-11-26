# Product Image Hosting Setup

This guide explains how to host product images on Cloudflare R2 for the Molten iOS app.

---

## Overview

**Problem:** After removing product images from the iOS app bundle to reduce size, the app needs to download images from a CDN.

**Solution:** Host the 1,321 product images in a Cloudflare R2 bucket and serve them at `https://moltenglass.app/images/[filename]`.

**Image Naming:** Images are named with manufacturer-code format (e.g., `BB-650001.webp`, `CiM-511101.jpg`)

---

## Step 1: Create R2 Bucket

### Via Wrangler CLI (Recommended):

```bash
cd ~/molten-website
npx wrangler r2 bucket create product-images
```

**Expected output:**
```
 ⛅️ wrangler 3.x.x
-------------------
✨ Created bucket 'product-images' with default storage class of Standard.
```

### Alternative: Via Cloudflare Dashboard:

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Select your account
3. Click **R2** in the left sidebar
4. Click **Create bucket**
5. Name: `product-images`
6. Location: **Automatic** (let Cloudflare choose optimal location)
7. Storage class: **Standard**
8. Click **Create bucket**

---

## Step 2: Configure R2 Bucket for Public Access

We'll use a **Custom Domain** to serve images at `https://moltenglass.app/images/*`.

### 2.1 Connect Custom Domain to R2:

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) → **R2**
2. Click on **product-images** bucket
3. Click **Settings** tab
4. Scroll to **Public access**
5. Click **Connect Domain**
6. Choose **Custom Domains**
7. Enter: `cdn.moltenglass.app`
8. Click **Continue**
9. Cloudflare will automatically create the DNS record
10. Wait a few minutes for DNS propagation

### 2.2 Verify Domain Connection:

```bash
# Should resolve to R2 bucket
nslookup cdn.moltenglass.app
```

---

## Step 3: Upload Images to R2

Run the upload script to push all 1,321 product images:

```bash
cd ~/molten-website
node upload-images.js ~/molten-data/images/product-images/
```

**What it does:**
- Scans directory for image files (jpg, jpeg, png, webp)
- Uploads each image to R2 bucket
- Sets correct Content-Type headers
- Enables caching with Cache-Control headers
- Shows progress bar

**Expected output:**
```
📦 Uploading product images to Cloudflare R2...

📂 Scanning directory: ~/molten-data/images/product-images/
   ✅ Found 1,321 images

☁️  Uploading to R2 bucket 'product-images'...
   [████████████████████] 1,321/1,321 (100%)
   ✅ Uploaded 1,321 images (68.2 MB total)
   ⏱️  Time: 2m 15s

✅ SUCCESS! All images uploaded to R2
```

---

## Step 4: Test Image Access

### 4.1 Test Direct Access:

```bash
# Test a sample image
curl -I https://cdn.moltenglass.app/BB-650001.webp

# Expected: HTTP 200 OK with image content-type
```

**Expected headers:**
```
HTTP/2 200
content-type: image/webp
cache-control: public, max-age=31536000
etag: "abc123def456..."
```

### 4.2 Test in Browser:

Open: https://cdn.moltenglass.app/BB-650001.webp

Should display the glass product image.

### 4.3 Test 404 Handling:

```bash
curl -I https://cdn.moltenglass.app/DOES-NOT-EXIST.jpg

# Expected: HTTP 404 Not Found
```

---

## Step 5: Configure iOS App

The iOS app's `ImageHelpers.swift` needs to check for images at `https://cdn.moltenglass.app/{filename}` before falling back to manufacturer defaults.

**Image Loading Priority:**
1. User-uploaded images (from UserImageRepository)
2. Downloaded images from `https://cdn.moltenglass.app/` (cached locally)
3. Bundled manufacturer default images

**Implementation:** See `ImageHelpers.swift` update in Step 6.

---

## Image Naming Convention

Images are named with manufacturer code format:

**Format:** `{MANUFACTURER}-{CODE}.{ext}`

**Examples:**
- `BB-650001.webp` - Boro Batch item 650001
- `CiM-511101.jpg` - Creation is Messy item 511101
- `OC-6023-83CC-F.png` - Oceanside Glass item 6023-83CC-F

**Extensions:** `.jpg`, `.jpeg`, `.png`, `.webp`

---

## R2 Bucket Configuration

**Bucket Name:** `product-images`
**Region:** Automatic (Cloudflare chooses optimal location)
**Public Access:** Via custom domain `cdn.moltenglass.app`
**CORS:** Enabled for `https://moltenglass.app` origin
**Caching:** Long-lived (1 year) with ETag support
**Compression:** Automatic (Cloudflare serves compressed when supported)

---

## Cost Estimate

Cloudflare R2 Pricing (as of 2025):
- **Storage:** $0.015 per GB/month
- **Class A operations** (write): $4.50 per million requests
- **Class B operations** (read): $0.36 per million requests
- **Egress:** **FREE** (no bandwidth charges)

**Our usage:**
- Storage: 68 MB = 0.068 GB × $0.015 = **$0.001/month** (~$0.01/year)
- Initial upload: 1,321 writes × $4.50/1M = **$0.006 one-time**
- Monthly reads (estimated 10,000 image downloads): $0.0036/month = **$0.04/year**

**Total estimated cost: ~$0.05/year** (essentially free!)

---

## Updating Images

When new images are added to molten-data:

```bash
# Upload only new images (script skips existing)
cd ~/molten-website
node upload-images.js ~/molten-data/images/product-images/
```

The upload script automatically:
- Checks if image already exists in R2
- Skips unchanged files
- Uploads only new/modified images

---

## Troubleshooting

### ❌ Error: "Failed to create bucket"

**Solution:**
```bash
# Check if bucket already exists
npx wrangler r2 bucket list

# If exists, skip creation step
```

### ❌ Error: "Failed to upload: Unauthorized"

**Solution:**
1. Verify API token has R2 permissions:
   ```bash
   curl -X GET "https://api.cloudflare.com/client/v4/user/tokens/verify" \
     -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
   ```
2. If token invalid, create new one with R2 permissions at:
   https://dash.cloudflare.com/profile/api-tokens

### ❌ Custom domain not resolving

**Solution:**
1. Wait 5-10 minutes for DNS propagation
2. Check DNS record exists:
   ```bash
   nslookup cdn.moltenglass.app
   ```
3. If missing, go to Cloudflare Dashboard → DNS → Add CNAME record:
   - Name: `images`
   - Target: `product-images.{account-id}.r2.cloudflarestorage.com`

### ❌ Images not loading in iOS app

**Solution:**
1. Test image URL directly in browser first
2. Check iOS App Transport Security allows HTTPS
3. Verify image filename matches exactly (case-sensitive)
4. Check iOS logs for detailed error message

---

## Security Considerations

**Public Read Access:** Images are publicly accessible at `https://cdn.moltenglass.app/`
- This is intentional for the iOS app to download without authentication
- Images are product photos, not sensitive data
- If you need to prevent hotlinking, add Cloudflare Access rules

**No Write Access:** Only server-side scripts can upload images
- R2 API requires API token (not exposed to clients)
- iOS app can only read (GET), not write

---

## Monitoring

View R2 usage in Cloudflare Dashboard:

1. Go to **R2** → **product-images** bucket
2. Click **Metrics** tab
3. View:
   - Storage used
   - Requests per day
   - Bandwidth used
   - Error rates

**Set up alerts:**
1. Go to **Notifications** in Cloudflare Dashboard
2. Create alert for:
   - Storage exceeds 1 GB
   - Error rate > 5%
   - Requests spike above normal

---

## Next Steps

After setup is complete:

1. ✅ R2 bucket created
2. ✅ Custom domain connected
3. ✅ Images uploaded
4. ✅ Test image access works
5. 🔄 Update iOS `ImageHelpers.swift` to download from R2
6. 🔄 Test with iOS app (simulator and device)
7. 🔄 Update OTA catalog update service to pre-download images
8. 🔄 Deploy to production

---

## References

- **Cloudflare R2 Docs:** https://developers.cloudflare.com/r2/
- **Wrangler CLI:** https://developers.cloudflare.com/workers/wrangler/
- **R2 Pricing:** https://developers.cloudflare.com/r2/pricing/
- **Custom Domains:** https://developers.cloudflare.com/r2/buckets/public-buckets/
