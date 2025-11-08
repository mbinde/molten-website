# Inventory Sharing - CloudFlare Pages Deployment Guide

This document explains how to deploy the inventory sharing API endpoints to CloudFlare Pages.

---

## 🔧 CloudFlare KV Namespace Setup

The inventory sharing feature requires a CloudFlare KV namespace called `INVENTORY_SHARES` to store:
- Encrypted inventory snapshots
- Share metadata (creation time, access counts)
- Rate limiting data

### Step 1: Create KV Namespace

**Via CloudFlare Dashboard:**
1. Log in to CloudFlare Dashboard
2. Select your account
3. Go to **Workers & Pages** → **KV**
4. Click **Create a namespace**
5. Name: `INVENTORY_SHARES`
6. Click **Add**

**Via Wrangler CLI:**
```bash
npx wrangler kv:namespace create "INVENTORY_SHARES"
```

You'll get output like:
```
🌀  Creating namespace with title "INVENTORY_SHARES"
✨  Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "INVENTORY_SHARES", id = "abc123..." }
```

---

### Step 2: Bind KV Namespace to Pages Project

**Via CloudFlare Dashboard:**
1. Go to **Workers & Pages**
2. Select your **molten-website** project
3. Go to **Settings** → **Functions**
4. Scroll to **KV Namespace Bindings**
5. Click **Add binding**
   - **Variable name**: `INVENTORY_SHARES`
   - **KV namespace**: Select the `INVENTORY_SHARES` namespace you created
6. Click **Save**

**⚠️ IMPORTANT**: Deploy a new version of your site after adding the binding for it to take effect.

---

### Step 3: Verify KV Namespace Access

Create a test endpoint to verify KV access:

**File:** `src/pages/api/test-kv-shares.ts`

```typescript
import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const env = (locals.runtime as any)?.env;
  const kv = env?.INVENTORY_SHARES;

  if (!kv) {
    return new Response(
      JSON.stringify({ error: 'INVENTORY_SHARES KV namespace not found' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Test write
  await kv.put('test-key', 'test-value');

  // Test read
  const value = await kv.get('test-key');

  // Test delete
  await kv.delete('test-key');

  return new Response(
    JSON.stringify({
      success: true,
      message: 'KV namespace working correctly',
      testResult: value
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
```

**Test:** Visit `https://yourdomain.com/api/test-kv-shares` after deployment.

---

## 🚀 Deployment Steps

### Option 1: Automatic Deployment (Git Push)

If your CloudFlare Pages project is connected to your GitHub repository:

1. **Commit the new code:**
   ```bash
   cd /Users/binde/molten-website
   git add .
   git commit -m "feat: add inventory sharing API endpoints"
   git push origin main
   ```

2. **CloudFlare automatically deploys:**
   - Go to CloudFlare Dashboard → Workers & Pages → molten-website
   - Click on **Deployments** tab
   - Wait for deployment to complete (usually 1-2 minutes)

3. **Verify deployment:**
   - Check deployment logs for errors
   - Test endpoint: `https://yourdomain.com/api/test` (should return JSON)

---

### Option 2: Manual Deployment (Wrangler)

If you prefer manual deployment:

1. **Install Wrangler:**
   ```bash
   npm install -g wrangler
   ```

2. **Login to CloudFlare:**
   ```bash
   wrangler login
   ```

3. **Build the project:**
   ```bash
   npm run build
   ```

4. **Deploy:**
   ```bash
   wrangler pages deploy dist --project-name=molten-website
   ```

---

## 📋 Post-Deployment Checklist

### 1. Test Share Creation (POST /api/share)

```bash
curl -X POST https://yourdomain.com/api/share \
  -H "Content-Type: application/json" \
  -d '{
    "shareCode": "TEST01",
    "snapshotData": "'"$(echo -n '{"items":[],"timestamp":"2025-01-01T00:00:00Z","version":"1.0"}' | base64)"'",
    "publicKey": "'"$(openssl rand -base64 32)"'"
  }'
```

**Expected Response:** `201 Created` (empty body)

---

### 2. Test Share Retrieval (GET /api/share/:code)

```bash
curl https://yourdomain.com/api/share/TEST01
```

**Expected Response:**
```json
{
  "snapshotData": "...",
  "publicKey": "..."
}
```

---

### 3. Test Share Update (PUT /api/share/:code)

**Note:** This requires a valid Ed25519 signature. Test after iOS app integration.

```bash
curl -X PUT https://yourdomain.com/api/share/TEST01 \
  -H "Content-Type: application/json" \
  -H "X-Ownership-Signature: <base64-signature>" \
  -d '{
    "snapshotData": "...",
    "publicKey": "..."
  }'
```

**Expected Response:** `200 OK` (empty body) or `403 Forbidden` (invalid signature)

---

### 4. Test Share Deletion (DELETE /api/share/:code)

```bash
curl -X DELETE https://yourdomain.com/api/share/TEST01 \
  -H "X-Ownership-Signature: <base64-signature>"
```

**Expected Response:** `204 No Content` or `403 Forbidden` (invalid signature)

---

### 5. Test Rate Limiting

Make 11 POST requests in rapid succession:

```bash
for i in {1..11}; do
  curl -X POST https://yourdomain.com/api/share \
    -H "Content-Type: application/json" \
    -d '{
      "shareCode": "TEST'$i'",
      "snapshotData": "data",
      "publicKey": "key"
    }'
  echo ""
done
```

**Expected:** First 10 succeed (`201`), 11th fails with `429 Too Many Requests`

---

## 🔐 Security Verification

### Ed25519 Signature Verification

The endpoints use Web Crypto API's Ed25519 support. Verify it's working:

**Create a test endpoint:**

```typescript
// src/pages/api/test-ed25519.ts
import type { APIRoute } from 'astro';
import { verifyEd25519Signature } from '../../lib/crypto';

export const prerender = false;

export const GET: APIRoute = async () => {
  // Test data (these are test keys, not production)
  const publicKey = "MCowBQYDK2VwAyEAkMqLMPWvtZlFZ8F2LxQlXxLVQhb..."; // Example
  const signature = "..."; // Example
  const data = "TEST01";

  const isValid = await verifyEd25519Signature(signature, data, publicKey);

  return new Response(
    JSON.stringify({
      isValid,
      message: isValid ? 'Signature valid' : 'Signature invalid'
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
```

---

## 📊 Monitoring & Analytics

### CloudFlare Analytics

1. Go to CloudFlare Dashboard → **Workers & Pages** → **molten-website**
2. Click on **Analytics** tab
3. Monitor:
   - **Requests per second**
   - **Error rate**
   - **Response time**

### KV Storage Usage

1. Go to CloudFlare Dashboard → **Workers & Pages** → **KV**
2. Click on **INVENTORY_SHARES** namespace
3. Monitor:
   - **Total keys**
   - **Storage size**
   - **Operations per day**

**Free tier limits:**
- 100,000 reads/day
- 1,000 writes/day
- 1 GB storage

---

## 🐛 Troubleshooting

### Error: "Storage not configured"

**Cause:** KV namespace binding not set up correctly.

**Fix:**
1. Verify KV namespace exists
2. Check binding name is exactly `INVENTORY_SHARES`
3. Redeploy site after adding binding

---

### Error: "Invalid signature" on ownership verification

**Cause:** Ed25519 signature verification failing.

**Check:**
1. Public key format (base64-encoded 32 bytes)
2. Signature format (base64-encoded 64 bytes)
3. Data being signed matches exactly (shareCode as string)

**Debug:**
```typescript
console.log('Public Key:', publicKey);
console.log('Signature:', signature);
console.log('Data:', shareCode);
```

---

### Rate limiting not working

**Cause:** KV writes failing or not expiring correctly.

**Fix:**
1. Check KV write operations in CloudFlare dashboard
2. Verify `expirationTtl` is set correctly
3. Clear test rate limit keys:
   ```bash
   # Via Wrangler CLI
   wrangler kv:key delete "ratelimit:test-ip:create-share" \
     --namespace-id=<YOUR_KV_ID>
   ```

---

### Share codes expiring too soon

**Current:** 90-day expiration

**To change:**
Edit `expirationTtl` in `/src/pages/api/share/index.ts`:

```typescript
await kv.put(`share:${shareCode}`, JSON.stringify(share), {
  expirationTtl: 180 * 24 * 60 * 60  // Change to 180 days
});
```

---

## 🔄 Data Migration (If Needed)

If you need to migrate existing share data:

**Export shares:**
```bash
wrangler kv:key list --namespace-id=<YOUR_KV_ID> --prefix="share:"
```

**Import shares:**
```bash
# Create JSON file with shares
# Then bulk upload
wrangler kv:bulk put shares.json --namespace-id=<YOUR_KV_ID>
```

---

## 📈 Scaling Considerations

### Current Limits

**Rate Limits (per IP):**
- Create: 10/hour
- Download: 60/hour
- Update: 30/hour
- Delete: 30/hour

**Storage:**
- 90-day auto-expiration
- ~1KB per share
- CloudFlare free tier: 1 GB = ~1 million shares

### Adjusting Limits

To increase rate limits, edit the `checkRateLimit()` calls in each endpoint:

```typescript
// Increase create limit to 20/hour
const rateLimit = await checkRateLimit(env, rateLimitKey, 20, 60);
```

---

## 🔐 App Attest Implementation (Future)

Currently, App Attest verification returns `{ valid: true }` for all requests. To implement full verification:

1. **Create attestation registration endpoint:**
   - `POST /api/attest/challenge` - Generate server challenge
   - `POST /api/attest/register` - Store attestation public key

2. **Implement CBOR parsing:**
   - Add `cbor` npm package
   - Parse assertion structure

3. **Store attestation keys in KV:**
   - Key: `attest:${keyId}`
   - Value: `{ publicKey, attestation, counter }`

4. **Verify assertions:**
   - Check signature matches stored public key
   - Validate counter increments
   - Verify client data hash

**Reference:** `src/lib/crypto.ts` - `verifyAppAttestAssertion()` function

---

## 📞 Support

**CloudFlare Issues:**
- CloudFlare Community: https://community.cloudflare.com/
- CloudFlare Docs: https://developers.cloudflare.com/

**API Issues:**
- Check CloudFlare Pages deployment logs
- Test endpoints with `curl -v` for verbose output
- Review `src/lib/crypto.ts` for signature verification

**iOS App Integration:**
- See `InventorySharingDeploymentSteps.md` in iOS project
- Update iOS app base URL to your CloudFlare Pages domain
- Extract SSL certificate for certificate pinning

---

**Last Updated:** 2025-11-07
**Status:** Ready for deployment
