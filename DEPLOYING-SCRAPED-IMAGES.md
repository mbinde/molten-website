# Deploying Scraped Images to Website

This guide explains how to get downloaded images from the scraper into the website and deploy them to Cloudflare Pages.

## Overview

The image deployment workflow:
1. **Scraper** downloads images → `/Users/binde/molten-data/images/`
2. **Copy** images → `/Users/binde/molten-website/public/images/`
3. **Deploy** to Cloudflare Pages → `https://www.moltenglass.app/images/`

## Prerequisites

- Scraper has downloaded images to `/Users/binde/molten-data/images/`
- Both full-size images and thumbnails (`*_thumb.jpg`) are present
- Wrangler CLI configured with Cloudflare credentials

## Step-by-Step Deployment

### Step 1: Verify Scraped Images

Check that the scraper has downloaded images successfully:

```bash
# Count images in scraper output directory
ls /Users/binde/molten-data/images/ | wc -l

# Check for both full-size and thumbnails
ls /Users/binde/molten-data/images/*_thumb.jpg | head -5
ls /Users/binde/molten-data/images/*.jpg | grep -v _thumb | head -5
```

**Expected output:**
- 6000+ total files (full-size + thumbnails)
- Thumbnails have `_thumb.jpg` suffix
- Full-size images: `.jpg`, `.jpeg`, `.png`, `.webp`

### Step 2: Copy Images to Website

Copy all scraped images to the website's public directory:

```bash
cd /Users/binde/molten-website

# Create images directory if it doesn't exist
mkdir -p public/images

# Copy all images from scraper output
rsync -av --progress /Users/binde/molten-data/images/ public/images/

# Verify copy was successful
echo "Images copied: $(ls public/images | wc -l)"
```

**What rsync does:**
- `-a`: Archive mode (preserves permissions, timestamps)
- `-v`: Verbose (shows files being copied)
- `--progress`: Shows progress during copy
- Only copies new/modified files (incremental)

**Expected output:**
```
sending incremental file list
000NCe.jpg
000NCe_thumb.jpg
007aE3.jpg
007aE3_thumb.jpg
...

Images copied: 6446
```

### Step 3: Option A - Deploy Images Only (Fast)

If you only want to deploy images without rebuilding the entire site:

```bash
cd /Users/binde/molten-website

# Use the dedicated image deployment script
./deploy-images.sh
```

**What this does:**
- Creates temporary directory
- Copies only images + headers
- Deploys to Cloudflare Pages
- Deploys to `images` branch (separate from main site)

**Output:**
```
📦 Deploying images to Cloudflare Pages...
📁 Created temp directory: /var/folders/...
✅ Copied 6446 images
☁️  Uploading to Cloudflare Pages...
🎉 Done!
```

**Result:** Images available at `https://www.moltenglass.app/images/[filename]`

### Step 3: Option B - Deploy Full Site with Images (Recommended)

To deploy images as part of the full website:

```bash
cd /Users/binde/molten-website

# Method 1: Use deployment script
./deploy-static.sh

# Method 2: Manual deployment
npm run build
npx wrangler pages deploy dist --project-name=molten-website
```

**What this does:**
- Builds the Astro website
- Includes all static assets (images, CSS, JS)
- Deploys everything to main branch
- More comprehensive but slower

**Output:**
```
📦 Building site for static deployment...
📁 Copying static assets...
✅ Copied 6446 images
☁️  Deploying to Cloudflare Pages...
🎉 Deployment complete!
Images available at: https://www.moltenglass.app/images/
```

### Step 4: Verify Deployment

Test that images are accessible from the deployed site:

```bash
# Test a sample full-size image
curl -I https://www.moltenglass.app/images/000NCe.jpg

# Test a sample thumbnail
curl -I https://www.moltenglass.app/images/000NCe_thumb.jpg

# Expected: HTTP 200 OK
```

**In browser:**
1. Open: https://www.moltenglass.app/images/000NCe.jpg
2. Should display the image
3. Check a few more random images

### Step 5: Update iOS App (If Needed)

The iOS app downloads images from the website. After deploying new images:

1. **Test in simulator** with real image URLs
2. **No code changes needed** if image naming convention is consistent
3. Images auto-downloaded on first view

## Incremental Updates

When scraper downloads new/updated images:

### Option 1: Copy Only New Images

```bash
# rsync automatically skips unchanged files
rsync -av --progress /Users/binde/molten-data/images/ /Users/binde/molten-website/public/images/

# Deploy only new images
cd /Users/binde/molten-website
./deploy-images.sh
```

### Option 2: Deploy Everything

```bash
cd /Users/binde/molten-website
./deploy-static.sh
```

## Automation Script

For convenience, create a one-command deployment:

```bash
# Create script
cat > /Users/binde/molten-website/sync-and-deploy-images.sh << 'EOF'
#!/bin/bash
set -e

echo "🔄 Syncing images from scraper..."
rsync -av /Users/binde/molten-data/images/ /Users/binde/molten-website/public/images/

echo ""
echo "🚀 Deploying to Cloudflare Pages..."
cd /Users/binde/molten-website
./deploy-static.sh

echo ""
echo "✅ Done! Images deployed to https://www.moltenglass.app/images/"
EOF

# Make executable
chmod +x /Users/binde/molten-website/sync-and-deploy-images.sh
```

**Usage:**
```bash
/Users/binde/molten-website/sync-and-deploy-images.sh
```

## Directory Structure

```
/Users/binde/
├── molten-data/
│   └── images/              # Scraper output (source of truth)
│       ├── 000NCe.jpg       # Full-size images
│       ├── 000NCe_thumb.jpg # Thumbnails
│       └── ...
│
└── molten-website/
    ├── public/
    │   └── images/          # Staging area for deployment
    │       ├── 000NCe.jpg   # Copied from molten-data
    │       └── ...
    └── dist/                # Built site (after npm run build)
        └── images/          # Images included in deployment
```

## Image Naming Convention

**Format:** `{stable_id}.{ext}` or `{stable_id}_thumb.{ext}`

Examples:
- Full-size: `000NCe.jpg`, `007aE3.jpg`, `00kns3.png`
- Thumbnail: `000NCe_thumb.jpg`, `007aE3_thumb.jpg`

**iOS App Usage:**
- `ImageDownloadService.loadImage(..., useThumbnail: false)` → `000NCe.jpg`
- `ImageDownloadService.loadImage(..., useThumbnail: true)` → `000NCe_thumb.jpg`

## Troubleshooting

### Images not copying

**Problem:** `rsync` says "No such file or directory"

**Solution:**
```bash
# Check source exists
ls /Users/binde/molten-data/images/ | head

# Create destination
mkdir -p /Users/binde/molten-website/public/images

# Try again
rsync -av /Users/binde/molten-data/images/ /Users/binde/molten-website/public/images/
```

### Deployment fails

**Problem:** Wrangler authentication error

**Solution:**
```bash
# Login to Cloudflare
npx wrangler login

# Or set API token
export CLOUDFLARE_API_TOKEN=your-token-here
```

### Images not accessible after deployment

**Problem:** 404 errors when accessing images

**Solution:**
```bash
# Check images were included in deployment
ls /Users/binde/molten-website/public/images/ | wc -l

# Verify deployment went to correct project
npx wrangler pages deployment list --project-name=molten-website

# Re-deploy if needed
./deploy-static.sh
```

### Wrong image sizes

**Problem:** Thumbnails too large or full-size too small

**Solution:**
```bash
# Check actual file sizes
ls -lh /Users/binde/molten-data/images/ | grep thumb | head
ls -lh /Users/binde/molten-data/images/ | grep -v thumb | head

# Thumbnails should be ~10-50KB
# Full-size should be ~50-500KB

# If wrong, re-run scraper with correct settings
```

## Performance Considerations

### Deployment Time

- **Images only:** ~2-5 minutes for 6000+ images
- **Full site:** ~5-10 minutes including build

### Bandwidth

- Initial deployment uploads all images (~650 MB total)
- Incremental deployments only upload changed files
- Cloudflare edge caching reduces origin requests

### Storage Costs

- Cloudflare Pages: Free tier includes 500 MB
- Current usage: ~650 MB (within free tier after compression)
- Thumbnails: ~100 MB
- Full-size: ~550 MB

## Best Practices

1. **Always rsync before deploying** - Ensures latest images are included
2. **Test locally first** - Use `npx serve dist` to test before deploying
3. **Deploy during low-traffic hours** - Avoid peak times (early morning best)
4. **Keep scraper output intact** - Don't delete `/Users/binde/molten-data/images/`
5. **Version control** - Commit changes to `public/images/` directory structure (not images themselves)

## Monitoring

After deployment, monitor:

1. **Cloudflare Analytics**
   - Go to: https://dash.cloudflare.com/
   - Select Pages project: `molten-website`
   - View: Request count, bandwidth, cache hit rate

2. **iOS App Logs**
   - Check image download success rate
   - Monitor 404 errors (missing images)
   - Track cache hit rate

3. **File Counts**
   ```bash
   # Compare source vs deployed
   echo "Source: $(ls /Users/binde/molten-data/images/ | wc -l)"
   echo "Staged: $(ls /Users/binde/molten-website/public/images/ | wc -l)"
   ```

## Quick Reference

```bash
# Full workflow in one go:
cd /Users/binde/molten-website
rsync -av /Users/binde/molten-data/images/ public/images/
./deploy-static.sh

# Or use the automation script:
./sync-and-deploy-images.sh
```

## Related Documentation

- **Image Hosting Setup:** `IMAGE-HOSTING-SETUP.md` (R2 bucket configuration)
- **Scraper Usage:** `/Users/binde/molten-data/scrapers/CLAUDE.md`
- **Deploy Scripts:** `deploy-images.sh`, `deploy-static.sh`
- **Website Build:** `astro.config.mjs`, `package.json`
