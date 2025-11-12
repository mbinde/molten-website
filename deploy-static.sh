#!/bin/bash
set -e

echo "📦 Building Astro site..."

# Build the Astro site
npm run build

# Copy all static assets from public/ to dist/ (using rsync for speed)
echo "📁 Syncing static assets..."
rsync -a --delete public/ dist/

echo "✅ Copied $(ls dist/images | wc -l | tr -d ' ') images"

# Deploy to Cloudflare Pages
echo "☁️  Deploying to Cloudflare Pages..."
npx wrangler pages deploy dist --project-name=molten-website

echo "🎉 Deployment complete!"
echo "Site available at: https://www.moltenglass.app/"
