# Molten Store Admin Setup Instructions

**Save this in 1Password for future reference**

---

## 🔐 Initial Setup (Do this ONCE)

### Step 1: Generate a Strong Password

Use 1Password to generate a strong random password (20+ characters).

**Example:** `mK9#vL2$nQ7@xR5!wP3&tJ8`

Save this password in 1Password with:
- **Title:** "Molten Store Admin"
- **URL:** `https://yourdomain.com/admin/stores` (update with your actual domain)
- **Password:** (the generated password)

### Step 2: Generate Password Hash

In your terminal, run:

```bash
cd /Users/binde/molten-website
node generate-password-hash.js "your-password-from-1password"
```

**Copy the output hash** (starts with `$2a$10$...`)

### Step 3: Add to Environment Variables

Create or edit `.env` file in the website root:

```bash
# .env
ADMIN_PASSWORD_HASH="$2a$10$xyz...abc"  # Paste the hash from Step 2
JWT_SECRET="your-random-jwt-secret"      # Generate another random string
```

**For JWT_SECRET**, generate another random string in 1Password (32+ characters):
```bash
echo "JWT_SECRET=\"$(openssl rand -base64 32)\"" >> .env
```

### Step 4: Deploy

Deploy the website with these environment variables set:

**For Netlify:**
```bash
netlify env:set ADMIN_PASSWORD_HASH "$2a$10$xyz...abc"
netlify env:set JWT_SECRET "your-jwt-secret"
```

**For Vercel:**
```bash
vercel env add ADMIN_PASSWORD_HASH
vercel env add JWT_SECRET
```

Or set via the web dashboard.

---

## 📝 How to Approve Store Submissions

### 1. Visit Admin Page

Go to: `https://yourdomain.com/admin/stores`

### 2. Login

Enter your password from 1Password (the plain password, NOT the hash).

Your session token lasts **24 hours** - you'll stay logged in even if you close the tab.

### 3. Review Submissions

- **Pending** tab shows new submissions
- Click **✓ Approve** to approve (automatically geocodes address)
- Click **✗ Reject** to reject

### 4. Generate stores.json

After approving stores:
1. Click **"Generate stores.json from Approved Stores"**
2. This creates/updates `public/stores.json` for the iOS app

### 5. Update iOS Bundle (Optional)

If you want to update the bundled stores in the iOS app:

```bash
# Copy website's stores.json to iOS bundle
cp /Users/binde/molten-website/public/stores.json \
   "/Users/binde/Library/Mobile Documents/com~apple~CloudDocs/Molten/Molten/Sources/Resources/stores.json"

# Commit and rebuild app
cd "/Users/binde/Library/Mobile Documents/com~apple~CloudDocs/Molten"
git add Molten/Sources/Resources/stores.json
git commit -m "Update bundled store directory"
```

---

## 🔧 Troubleshooting

### "Invalid password"
- Check you're using the **plain password** from 1Password, not the hash
- Verify `.env` file has correct `ADMIN_PASSWORD_HASH`
- In development: You can use `ADMIN_PASSWORD="plain-password"` instead of hash
- **Warning:** 3 wrong attempts = IP blocked for 24 hours

### "Too many failed attempts" or "IP blocked"
- Your IP is blocked for 24 hours after 3 failed login attempts
- Either wait 24 hours or run: `node unlock-admin.js unblock YOUR_IP`
- Check status: `node unlock-admin.js status`

### "System is locked down"
- System locks after 10 total failed attempts (across all IPs)
- Run: `node unlock-admin.js` to unlock
- This is an anti-brute-force protection

### "Session expired"
- Tokens expire after 24 hours
- Just log in again with your password

### "Unauthorized" errors on approve/reject
- Your session expired
- Refresh the page and log in again

### Can't see geocoding results
- Open browser console (F12) to see geocoding logs:
  - `🌍 Geocoding: address...`
  - `✅ Geocoded: lat, lon`
  - `⚠️ Could not geocode...`

---

## 🔒 Security Notes

### What's Protected
- ✅ Password hashed with bcrypt (can't be reversed)
- ✅ JWT tokens expire after 24 hours
- ✅ All admin actions require valid token
- ✅ Tokens validated server-side
- ✅ 1-second delay on failed login (anti-brute-force)
- ✅ **IP-based rate limiting:**
  - After 3 failed attempts: IP blocked for 24 hours
  - After 10 total failed attempts: System locks down completely
  - Automatic IP unblock after 24 hours
  - Manual unlock available via command line

### What to Keep Secret
1. **Your plain password** (in 1Password)
2. **ADMIN_PASSWORD_HASH** (in .env / hosting provider)
3. **JWT_SECRET** (in .env / hosting provider)
4. **Admin URL** (don't link publicly)

### Production Checklist
- ✅ Site uses HTTPS (automatic on Netlify/Vercel)
- ✅ `.env` file in `.gitignore` (already done)
- ✅ Strong password (20+ characters from 1Password)
- ✅ Keep admin URL private

---

## 🛠️ For Development

During local development, you can use a plain password instead of hash:

```bash
# .env (local development only)
ADMIN_PASSWORD="your-test-password"
JWT_SECRET="dev-secret-change-in-production"
```

**Never commit .env file to git!**

---

## 🚨 Emergency Procedures

### System Locked Down (10 Failed Attempts)

If the system locks down after too many failed login attempts:

```bash
cd /Users/binde/molten-website

# Check status
node unlock-admin.js status

# Unlock system
node unlock-admin.js

# The system will unlock, but blocked IPs remain blocked for 24h
```

### IP Blocked (3 Failed Attempts)

If a specific IP is blocked:

```bash
# Check which IPs are blocked
node unlock-admin.js status

# Unblock specific IP
node unlock-admin.js unblock 192.168.1.100
```

### Reset Everything

To completely reset all rate limiting data:

```bash
node unlock-admin.js reset --confirm
```

This will:
- Unlock system
- Unblock all IPs
- Reset all counters

### Password Reset

If you lose your password:

1. Generate a new password in 1Password
2. Generate new hash: `node generate-password-hash.js "new-password"`
3. Update `ADMIN_PASSWORD_HASH` in hosting provider dashboard
4. Redeploy site
5. Unlock system if it was locked: `node unlock-admin.js`

---

## 🔄 Changing Your Password

1. Generate new password in 1Password
2. Generate new hash: `node generate-password-hash.js "new-password"`
3. Update `.env` file (local) and hosting provider (production)
4. Redeploy (if needed)
5. All existing sessions will be invalidated

---

## 📊 How It Works

1. **You enter password** → Sent to `/api/login`
2. **Server verifies** against bcrypt hash
3. **Server returns JWT token** (valid 24 hours)
4. **Browser stores token** in localStorage
5. **All admin actions** send token in `Authorization: Bearer <token>` header
6. **Server validates token** on every request

**If token expires:** You're automatically logged out and prompted to log in again.

---

**Last Updated:** October 26, 2025
**System Version:** 1.0 with JWT Authentication
