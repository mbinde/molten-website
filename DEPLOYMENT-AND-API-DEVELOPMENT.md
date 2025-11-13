# Deployment and API Development Guide

**For AI Assistants and Developers**

This document explains how to deploy changes and add new API endpoints to the molten-website project.

---

## 🚀 How to Deploy Changes

**CRITICAL**: Do NOT use `astro build` or `npx wrangler pages deploy` manually!

### The Correct Deployment Process:

1. **Make your changes** (edit files, add endpoints, etc.)
2. **Commit to git**:
   ```bash
   cd /Users/binde/molten-project/molten-website
   git add .
   git commit -m "your change description"
   ```
3. **Push to GitHub**:
   ```bash
   git push origin main
   ```
4. **Cloudflare Pages automatically**:
   - Detects the push via GitHub integration
   - Runs `npm run build` (which runs `astro build`)
   - Deploys the `dist/` output
   - Makes your changes live at https://www.moltenglass.app

### Why This Works:

- **GitHub Integration**: Cloudflare Pages is connected to the GitHub repository
- **Automatic Builds**: Cloudflare runs the build process in their environment
- **No Manual Steps**: Just commit and push - Cloudflare handles everything else

### What NOT to Do:

- ❌ `npm run build` locally (not needed, Cloudflare does this)
- ❌ `npx wrangler pages deploy dist` (not needed, Cloudflare auto-deploys)
- ❌ `npx wrangler pages deploy public` (deploys static files only, missing API routes!)

---

## 🛠️ How to Add a New API Endpoint

### Step 1: Create the Endpoint File

API endpoints go in `src/pages/api/`. The file path determines the URL:

**File Location** → **URL**
- `src/pages/api/v1/hello.ts` → `/api/v1/hello`
- `src/pages/api/v1/users/[id].ts` → `/api/v1/users/:id` (dynamic route)
- `src/pages/api/v1/admin/upload.ts` → `/api/v1/admin/upload`

### Step 2: Write the Endpoint

```typescript
/**
 * GET /api/v1/hello - Example endpoint
 */

import type { APIRoute } from 'astro';

export const prerender = false; // Required for SSR

export const GET: APIRoute = async ({ request, locals, clientAddress }) => {
  // Access Cloudflare environment
  const env = (locals.runtime as any)?.env;

  // Access KV namespaces
  const kv = env?.CATALOG_VERSIONS;
  const storeData = env?.STORE_DATA;

  // Access environment variables
  const adminPassword = env?.ADMIN_PASSWORD;

  // Return JSON response
  return new Response(
    JSON.stringify({ message: 'Hello from API!' }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    }
  );
};

// Support POST, PUT, DELETE, etc.
export const POST: APIRoute = async ({ request }) => {
  const body = await request.json();
  // ... handle POST
};
```

### Step 3: Deploy It

```bash
cd /Users/binde/molten-project/molten-website
git add src/pages/api/v1/hello.ts
git commit -m "feat: add hello API endpoint"
git push origin main
```

That's it! Cloudflare will build and deploy automatically.

### Step 4: Test It

Wait ~30 seconds for Cloudflare to deploy, then:

```bash
curl https://www.moltenglass.app/api/v1/hello
```

---

## 🔧 Environment Setup (One-Time)

If your endpoint needs KV storage or environment variables, set them up in Cloudflare Dashboard:

### Adding a KV Namespace:

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. **Workers & Pages** → **KV**
3. **Create a namespace** (e.g., `CATALOG_VERSIONS`)
4. Go to **Workers & Pages** → **molten-website** → **Settings** → **Functions**
5. **KV Namespace Bindings** → **Add binding**:
   - Variable name: `CATALOG_VERSIONS` (exact name used in code)
   - KV namespace: Select the namespace you created
6. **Save**
7. **Redeploy**: Go to **Deployments** → **Retry deployment** (or push to GitHub)

### Adding Environment Variables:

1. Go to **Workers & Pages** → **molten-website** → **Settings** → **Environment variables**
2. **Add variable**:
   - Name: `ADMIN_PASSWORD` (or whatever your code needs)
   - Value: `your-secret-value`
   - Environment: **Production** (and **Preview** if needed)
3. **Save**
4. **Redeploy** (same as above)

---

## 📁 Project Structure

```
molten-website/
├── src/
│   ├── pages/
│   │   ├── index.astro          # Homepage (https://www.moltenglass.app/)
│   │   └── api/                 # API routes (serverless functions)
│   │       ├── v1/
│   │       │   ├── catalog/
│   │       │   │   ├── [type]/
│   │       │   │   │   ├── version.ts    # /api/v1/catalog/{type}/version
│   │       │   │   │   └── data.ts       # /api/v1/catalog/{type}/data
│   │       │   └── admin/
│   │       │       └── upload-catalog.ts # /api/v1/admin/upload-catalog
│   │       └── ...
│   └── lib/                     # Shared utilities
│       ├── catalog.ts           # Catalog helpers
│       └── crypto.ts            # App Attest verification
├── public/                      # Static assets (served as-is)
│   ├── glassitems.json          # Static catalog JSON
│   └── images/                  # Product images
├── astro.config.mjs             # Astro config (SSR mode, Cloudflare adapter)
├── wrangler.toml                # Cloudflare config
└── package.json                 # Dependencies and build scripts
```

---

## 🔍 Debugging Deployments

### Check Deployment Status:

1. Go to Cloudflare Dashboard → **Workers & Pages** → **molten-website**
2. Click **Deployments** tab
3. Check latest deployment status:
   - ✅ **Success** - Your changes are live
   - ❌ **Failed** - Click to see build logs

### Common Issues:

**API returns empty response:**
- Check that KV namespace is bound (Settings → Functions → KV Namespace Bindings)
- Check that environment variables are set (Settings → Environment variables)
- Redeploy after adding bindings/variables

**API route 404:**
- Verify file is in `src/pages/api/` (not `public/api/`)
- Verify `export const prerender = false;` is in the file
- Check deployment succeeded (Deployments tab)

**Build fails:**
- Check build logs in Cloudflare Deployments tab
- Usually TypeScript errors or import issues

---

## 📝 Summary

**To deploy anything:**
1. Edit files
2. `git commit`
3. `git push`
4. Cloudflare auto-deploys

**To add an API endpoint:**
1. Create `src/pages/api/v1/your-endpoint.ts`
2. Export `GET`, `POST`, etc. functions
3. Commit and push
4. Test at `https://www.moltenglass.app/api/v1/your-endpoint`

**Never run manually:**
- ❌ `npm run build`
- ❌ `npx wrangler pages deploy`

**Let Cloudflare handle the build!**
