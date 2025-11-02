# Molten Glass Website

Community-sourced directory of locations that support the glass art community.

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
├── src/
│   └── pages/
│       └── index.astro
└── package.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## ⚠️ Important: Cloudflare Routes Configuration

**CRITICAL**: When adding new API routes or JSON endpoints, you MUST update `/public/_routes.json` to include them in Cloudflare's SSR routing.

### Example: Adding a new endpoint

If you create a new file like `/src/pages/my-data.json.ts`, add it to the `include` array:

```json
{
  "version": 1,
  "include": [
    "/api/*",
    "/admin/*",
    "/locations.json",
    "/my-data.json"  // <- Add your new endpoint here
  ],
  "exclude": []
}
```

**Without this**, Cloudflare Pages will try to serve your endpoint as a static file, resulting in empty responses (zero bytes) even though your code is correct and KV data exists.

### Symptoms of missing route configuration:
- Endpoint returns completely empty (0 bytes)
- No errors in logs
- KV data exists and is accessible via other endpoints
- Works locally but fails in production

## 👀 Want to learn more?

Feel free to check [Astro documentation](https://docs.astro.build) or [Cloudflare Pages documentation](https://developers.cloudflare.com/pages/).
