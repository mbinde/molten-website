# R2 Image Storage Setup

This document explains how product images are now served from Cloudflare R2 instead of being bundled with the Pages deployment.

## Overview

Previously, all 7,768 product images (686MB) were bundled with every Pages deployment, making each deployment slow and inefficient. Now images are stored in R2 and served via API endpoints with checksum-based caching.

## Architecture

```
App Request Flow:
1. App -> GET /api/v1/images/manifest -> Returns list of all images with ETags (checksums)
2. App -> GET /api/v1/images/000NCe.jpg -> Returns image from R2 with caching headers
3. App caches images locally and uses ETags to determine if updates are needed
```

## R2 Bucket

**Bucket Name:** `molten-product-images`
**Region:** Auto (Cloudflare global)
**Contents:** All product images (~7,700 images, ~686MB)

## API Endpoints

### GET /api/v1/images/manifest

Returns a JSON manifest of all images with their checksums.

**Response:**
```json
{
  "version": "1.0",
  "generatedAt": "2024-11-13T...",
  "images": [
    {
      "filename": "000NCe.jpg",
      "etag": "abc123def456...",
      "size": 41605,
      "lastModified": "2024-11-11T..."
    },
    ...
  ],
  "totalCount": 7768,
  "totalSize": 686000000
}
```

**Caching:** 5 minutes

**Use Case:** App downloads this manifest on startup to determine which images need to be updated.

### GET /api/v1/images/{filename}

Serves an individual image from R2.

**Example:** `/api/v1/images/000NCe.jpg`

**Headers:**
- `ETag`: MD5 hash of the image (for checksum validation)
- `Cache-Control`: `public, max-age=31536000, immutable` (1 year)
- `Content-Type`: Appropriate MIME type (image/jpeg, image/png, etc.)

**Conditional Requests:**
- Client can send `If-None-Match: <etag>` header
- Server returns `304 Not Modified` if ETag matches (no data transfer)

**Use Case:** App downloads images it doesn't have or needs to update based on ETag comparison.

## Upload Script

### Commands

```bash
# Upload only new/changed images (default)
npm run images:upload

# Dry run - see what would be uploaded
npm run images:upload:dry-run

# Force upload all images
npm run images:upload:force
```

### How It Works

1. **Scan local images:** Reads all files from `public/images/`
2. **Compute checksums:** Calculates MD5 hash for each image
3. **Fetch R2 manifest:** Gets list of existing images with ETags from R2
4. **Compare:** Determines which images are new or changed
5. **Upload:** Only uploads images that need updating
6. **Report:** Shows statistics (uploaded, skipped, total size)

### Example Output

```
🚀 Product Image Upload to R2
================================

📂 Scanning local images...
   Found 7768 local images

☁️  Fetching R2 manifest...
   Found 7500 images in R2

📊 Upload Statistics
-------------------
Total local images:  7768
New images:          200
Changed images:      68
Unchanged images:    7500
To upload:           268
Total upload size:   45.2 MB

⬆️  Uploading images...

✅ Uploaded: 000NCe.jpg
✅ Uploaded: 007aE3.jpg
...
   Progress: 100/268 (37.3%)
...

✅ Upload Complete!
   Uploaded: 268
```

## R2 Binding Configuration

The R2 bucket needs to be bound to the Pages project as `PRODUCT_IMAGES`.

### Via Cloudflare Dashboard

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **Workers & Pages** > **molten-website**
3. Go to **Settings** > **Functions**
4. Scroll to **R2 bucket bindings**
5. Click **Add binding**
6. Set:
   - Variable name: `PRODUCT_IMAGES`
   - R2 bucket: `molten-product-images`
7. Click **Save**

### Via Wrangler (Alternative)

You can also configure this in `wrangler.toml` for local development:

```toml
name = "molten-website"
pages_build_output_dir = "./dist"
compatibility_date = "2024-11-11"
compatibility_flags = ["nodejs_compat_v2"]

[[r2_buckets]]
binding = "PRODUCT_IMAGES"
bucket_name = "molten-product-images"
```

Note: For production Pages deployments, the dashboard configuration takes precedence.

## Deployment Workflow

### Old Workflow (Bundled Images)

```bash
1. npm run build              # Builds site with all images (~686MB)
2. rsync images to dist/      # Copies all images
3. wrangler pages deploy      # Uploads everything (~800MB total)
```

**Total deployment time:** ~5-10 minutes
**Bandwidth used:** ~800MB every deployment

### New Workflow (R2 Images)

```bash
1. npm run images:upload      # Upload only changed images (once)
2. npm run build              # Builds site WITHOUT images (~100MB)
3. wrangler pages deploy      # Uploads only HTML/CSS/JS (~100MB)
```

**Total deployment time:** ~1-2 minutes
**Bandwidth used:** ~100MB for Pages, only changed images to R2

## Benefits

1. ✅ **Faster deployments:** Pages deployment is 87% smaller
2. ✅ **Zero egress costs:** R2 -> Pages/Workers traffic is free
3. ✅ **Better caching:** 1-year cache with ETag validation
4. ✅ **Efficient updates:** Only upload changed images
5. ✅ **Independent updates:** Can update images without redeploying site
6. ✅ **Checksum validation:** ETags ensure data integrity

## App Integration

The iOS/macOS app will:

1. On first launch:
   - Fetch `/api/v1/images/manifest`
   - Download all images (or subset)
   - Store locally with ETags

2. On subsequent launches:
   - Fetch manifest
   - Compare local ETags with server ETags
   - Only download images where ETags differ
   - Use conditional requests (If-None-Match) for efficiency

3. Image URLs:
   - Old: `https://molten.glass/images/000NCe.jpg`
   - New: `https://molten.glass/api/v1/images/000NCe.jpg`

## Testing

### Test Manifest Endpoint

```bash
curl https://molten.glass/api/v1/images/manifest | jq
```

### Test Image Serving

```bash
# Download an image
curl -I https://molten.glass/api/v1/images/000NCe.jpg

# Test conditional request
curl -H "If-None-Match: \"abc123...\"" -I https://molten.glass/api/v1/images/000NCe.jpg
```

### Test Local Upload

```bash
# Dry run first
npm run images:upload:dry-run

# Upload for real
npm run images:upload
```

## Migration Checklist

- [x] Create R2 bucket (`molten-product-images`)
- [x] Create API endpoints (`/api/v1/images/*`)
- [x] Create upload script with checksum tracking
- [ ] Configure R2 binding in Pages dashboard
- [ ] Upload initial images to R2
- [ ] Test API endpoints
- [ ] Update app to use new image URLs
- [ ] Remove images from Pages deployment
- [ ] Update CI/CD workflow

## Troubleshooting

### Images not serving

1. Check R2 binding is configured: Visit dashboard > Workers & Pages > molten-website > Settings > Functions
2. Verify bucket has images: `npx wrangler r2 object list molten-product-images | head`
3. Check function logs: Dashboard > Workers & Pages > molten-website > Logs

### Upload script fails

1. Ensure wrangler is authenticated: `npx wrangler whoami`
2. Verify bucket exists: `npx wrangler r2 bucket list`
3. Check permissions: Ensure your account has R2 write access

### Checksums don't match

- R2 uses MD5 for ETags on simple uploads
- If using multipart upload (>5MB files), ETags are different format
- Current images are all <5MB, so MD5 works fine

## Future Enhancements

1. **Image optimization:** Automatically generate WebP/AVIF versions
2. **Thumbnail generation:** Create thumbnails on-upload via Worker
3. **CDN caching:** Add Cloudflare cache API for even faster delivery
4. **Analytics:** Track image download patterns
5. **Versioning:** Keep image history for rollback capability
