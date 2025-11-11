// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  output: 'server', // Full SSR mode (required for API routes on Cloudflare)
  adapter: cloudflare({
    mode: 'directory' // Use directory mode for Cloudflare Pages
    // Routing handled by public/_routes.json instead
  }),
  vite: {
    plugins: [tailwindcss()]
  },
  security: {
    checkOrigin: false // Disable CSRF protection - we use Ed25519 signature auth instead
  },
  image: {
    service: {
      entrypoint: 'astro/assets/services/noop' // Disable image optimization (we have 1,321 static images)
    }
  }
});