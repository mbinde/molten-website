#!/bin/bash
set -e

echo "📦 Building site for static deployment..."

# Create dist directory manually (skip Astro build since it hangs)
mkdir -p dist/images

# Copy all static assets from public/ (using rsync for speed)
echo "📁 Copying static assets..."
rsync -a --delete public/ dist/

echo "✅ Copied $(ls dist/images | wc -l | tr -d ' ') images"

# Deploy to Cloudflare Pages
echo "☁️  Deploying to Cloudflare Pages..."
npx wrangler pages deploy dist --project-name=molten-website

echo "🎉 Deployment complete!"
echo "Images available at: https://www.moltenglass.app/images/"
