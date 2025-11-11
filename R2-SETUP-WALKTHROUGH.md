# R2 Image CDN Setup - Step by Step

**Goal:** Host product images at `https://cdn.moltenglass.app/`

**Time:** ~10 minutes

---

## Step 1: Create the R2 Bucket (2 min)

You need to be in the `molten-website` directory because that's where your Cloudflare/wrangler configuration lives.

```bash
cd ~/molten-website

# Create the R2 bucket
npx wrangler r2 bucket create product-images
```

**Expected output:**
```
⛅️ wrangler 3.x.x
-------------------
✨ Created bucket 'product-images' with default storage class of Standard.
```

**What this does:** Creates a storage bucket in your Cloudflare account (like an S3 bucket but better/cheaper).

---

## Step 2: Connect the Subdomain (5 min)

Now connect `cdn.moltenglass.app` to point to this bucket.

### Option A: Via Cloudflare Dashboard (Recommended - Easier)

1. Go to https://dash.cloudflare.com/
2. Select your account
3. Click **R2** in the left sidebar
4. Click on **product-images** bucket
5. Click **Settings** tab
6. Scroll down to **Public access** section
7. Click **Connect Domain**
8. Choose **Custom Domains**
9. Enter: `cdn.moltenglass.app`
10. Click **Continue**
11. Cloudflare will automatically:
    - Create the DNS record
    - Issue SSL certificate
    - Connect the domain to R2

**Wait 2-3 minutes** for DNS propagation.

### Option B: Via Command Line (Alternative)

```bash
cd ~/molten-website

# Connect the domain
npx wrangler r2 bucket domain add product-images --domain cdn.moltenglass.app
```

---

## Step 3: Verify It's Working (1 min)

Test that the subdomain resolves:

```bash
# Should resolve without errors
nslookup cdn.moltenglass.app

# Expected: Returns an IP address (means DNS is working)
```

Try accessing the bucket (should get 404 since we haven't uploaded anything yet):

```bash
curl -I https://cdn.moltenglass.app/test.jpg

# Expected: HTTP 404 Not Found (this is good - means bucket is accessible)
```

---

## Step 4: Upload the Product Images (2 min)

Now upload all 1,321 images from molten-data:

```bash
cd ~/molten-website

# Set environment variables (if not already set)
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
export CLOUDFLARE_API_TOKEN="your-api-token"

# Upload all images
node upload-images.js ~/molten-data/images/product-images/
```

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

🔗 Images available at: https://cdn.moltenglass.app/
   Example: https://cdn.moltenglass.app/BB-650001.webp
```

**This will take ~2 minutes** to upload all images.

---

## Step 5: Test an Image (1 min)

Verify an image is accessible:

```bash
# Test a known image
curl -I https://cdn.moltenglass.app/BB-650001.webp

# Expected: HTTP 200 OK
```

Open in browser: https://cdn.moltenglass.app/BB-650001.webp

**Should see:** The product image for Boro Batch item 650001

---

## 🎉 Done!

Your CDN is now live at `https://cdn.moltenglass.app/`!

All 1,321 product images are accessible at:
- `https://cdn.moltenglass.app/BB-650001.webp`
- `https://cdn.moltenglass.app/CIM-511101.jpg`
- etc.

---

## Troubleshooting

### ❌ "npx: command not found"

You need Node.js installed. Check:

```bash
node --version
npm --version
```

If not installed: https://nodejs.org/

### ❌ "wrangler: command not found"

The `npx wrangler` command should work automatically (npx downloads it on-demand).

If it doesn't work, install globally:

```bash
npm install -g wrangler
```

### ❌ "Error: Not authenticated"

You need to log in to Cloudflare:

```bash
cd ~/molten-website
npx wrangler login
```

This will open a browser to authenticate.

### ❌ "Error: A bucket with this name already exists"

The bucket already exists! Skip to Step 2.

Or list your buckets:

```bash
npx wrangler r2 bucket list
```

### ❌ "Custom domain already in use"

The domain is already connected! Skip to Step 4.

Or check in dashboard: Cloudflare → R2 → product-images → Settings → Public access

### ❌ Environment variables not set

You need your Cloudflare API credentials for the upload script.

**Get Account ID:**
1. Go to https://dash.cloudflare.com/
2. Look at the URL: `https://dash.cloudflare.com/{ACCOUNT_ID}/...`
3. Copy the account ID from URL

**Get API Token:**
1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Click **Create Token**
3. Use **Edit Cloudflare Workers** template
4. Click **Continue to summary**
5. Click **Create Token**
6. **Copy the token** (you won't see it again!)

**Set them:**
```bash
export CLOUDFLARE_ACCOUNT_ID="abc123..."
export CLOUDFLARE_API_TOKEN="xyz789..."
```

**Make permanent** (add to ~/.zshrc):
```bash
echo 'export CLOUDFLARE_ACCOUNT_ID="abc123..."' >> ~/.zshrc
echo 'export CLOUDFLARE_API_TOKEN="xyz789..."' >> ~/.zshrc
source ~/.zshrc
```

---

## What Happens Next?

Once this is done:

1. **iOS app will automatically download images** from `cdn.moltenglass.app`
2. **Images are cached locally** on the device (fast subsequent loads)
3. **Falls back to manufacturer defaults** if image doesn't exist
4. **You can update images** anytime by re-running the upload script

No App Store release needed to update images! 🎉
