#!/bin/bash

# Deploy images to Cloudflare Pages using wrangler
# This uploads images as static assets without building the Astro site

echo "📦 Deploying images to Cloudflare Pages..."

# Create a temporary directory structure
TEMP_DIR=$(mktemp -d)
echo "📁 Created temp directory: $TEMP_DIR"

# Copy images to temp directory (using rsync for speed)
mkdir -p "$TEMP_DIR/images"
rsync -a public/images/ "$TEMP_DIR/images/"
cp public/_headers "$TEMP_DIR/"

# Copy index.html to prevent directory listing
cp public/images/index.html "$TEMP_DIR/images/"

echo "✅ Copied $(ls $TEMP_DIR/images | wc -l | tr -d ' ') images"

# Deploy using wrangler
echo "☁️  Uploading to Cloudflare Pages..."
npx wrangler pages deploy "$TEMP_DIR" --project-name=molten-website --branch=images

# Cleanup
rm -rf "$TEMP_DIR"
echo "🎉 Done!"
