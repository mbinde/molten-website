# Molten Store Admin - Quick Reference

**Save this in 1Password Notes field**

---

## 🔑 Access

**URL:** https://yourdomain.com/admin/stores
**Password:** [Your strong 20+ character password from 1Password]

Session lasts 24 hours. Just log in when you want to approve stores.

---

## ✅ Approving Stores

1. Visit admin URL
2. Login with password
3. Review pending submissions
4. Click **✓ Approve** (automatically geocodes address)
5. Click **Generate stores.json** when done
6. Optional: Copy `public/stores.json` to iOS bundle

---

## 🚨 If Something Goes Wrong

### Wrong Password / Locked Out
```bash
cd /Users/binde/molten-website

# Check what's blocked
node unlock-admin.js status

# Unblock your IP
node unlock-admin.js unblock YOUR_IP

# Or unlock entire system
node unlock-admin.js
```

### Security Limits
- **3 wrong passwords** = Your IP blocked for 24 hours
- **10 total wrong passwords** = System locked (run unlock script)

---

## 🔧 Updating Password

```bash
cd /Users/binde/molten-website

# 1. Generate hash for new password
node generate-password-hash.js "new-password-from-1password"

# 2. Copy the hash and update .env
# Add: ADMIN_PASSWORD_HASH="$2a$10$xyz..."

# 3. Unlock if needed
node unlock-admin.js

# 4. Redeploy site
```

---

## 📝 Important Paths

**Website:** `/Users/binde/molten-website`
**iOS Bundle:** `/Users/binde/Library/Mobile Documents/com~apple~CloudDocs/Molten/Molten/Sources/Resources/stores.json`

---

## 🛟 Emergency Commands

```bash
# See all status
node unlock-admin.js status

# Unlock system
node unlock-admin.js

# Unblock specific IP
node unlock-admin.js unblock 1.2.3.4

# Reset everything
node unlock-admin.js reset --confirm
```

---

**Security:** Password is hashed (bcrypt), tokens expire after 24h, rate-limited against brute force attacks.
