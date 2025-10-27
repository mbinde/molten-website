// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  output: 'hybrid', // Enables both static pages and API routes
  adapter: cloudflare({
    mode: 'directory', // Use directory mode for Cloudflare Pages
  }),
  vite: {
    plugins: [tailwindcss()]
  }
});