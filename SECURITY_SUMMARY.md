# Security Summary - Store Submission System

## 🔐 Authentication & Authorization

### Password Security
- **Hashing**: bcrypt with 10 rounds
- **Storage**: Hash stored in environment variables (never in code)
- **Verification**: Server-side only (never client-side)

### Session Management
- **Tokens**: JWT (JSON Web Tokens)
- **Expiration**: 24 hours
- **Storage**: Browser localStorage
- **Validation**: Server-side on every admin action

### Rate Limiting & Brute Force Protection

#### Per-IP Limits
- **3 failed attempts** → IP blocked for 24 hours
- **Automatic unblock** after 24 hours
- **Manual unblock**: `node unlock-admin.js unblock <ip>`

#### System-Wide Protection
- **10 total failed attempts** → System lockdown
- **Manual unlock required**: `node unlock-admin.js`
- **Console alerts**: Logged with IP addresses and timestamps

#### How It Works
1. Every login attempt tracked by IP address
2. Failed attempt counter increments
3. After 3 failures: IP blocked for 24h
4. After 10 total failures: System locks down
5. Server logs all failed attempts with timestamps
6. Rate limit data stored in `public/data/rate-limit.json`

---

## 🛡️ Attack Mitigation

### Brute Force Attacks
- **Prevented by**: IP blocking after 3 attempts
- **System lockdown**: After 10 total attempts
- **1-second delay**: On each failed login
- **Automatic**: No manual intervention needed for normal operation

### Credential Stuffing
- **Prevented by**: Bcrypt slow hashing (computationally expensive)
- **Unique password**: Not reused from other sites
- **Rate limiting**: Limits attempts per IP

### Session Hijacking
- **Prevented by**: HTTPS only (enforced by hosting)
- **Token expiration**: 24-hour limit
- **Server validation**: Every request verified

### Distributed Attacks
- **Limited by**: System-wide lockdown after 10 attempts
- **Manual unlock**: Required after lockdown (prevents automated attacks)

---

## 📊 Monitoring & Logging

### What's Logged
```
⚠️  Failed login attempt from 192.168.1.100 (Total: 3)
🚫 IP 192.168.1.100 blocked until 2025-10-27T18:30:00Z
🚨 SYSTEM LOCKED DOWN after 10 failed attempts
🔒 Run 'node unlock-admin.js' to unlock
```

### Check Current Status
```bash
node unlock-admin.js status
```

Shows:
- System lock status
- Total failed attempts
- All IP addresses with attempt counts
- Block status and expiration times

---

## 🚨 Emergency Response

### Scenario 1: You're Locked Out (Wrong Password)
1. Check if your IP is blocked: `node unlock-admin.js status`
2. Unblock your IP: `node unlock-admin.js unblock YOUR_IP`
3. Try logging in again with correct password from 1Password

### Scenario 2: System Under Attack
1. System automatically locks after 10 attempts
2. Attacker IPs remain blocked for 24 hours
3. You can manually unlock system: `node unlock-admin.js`
4. Review attack IPs: `node unlock-admin.js status`
5. Consider additional firewall rules if needed

### Scenario 3: Forgot Password
1. Unlock system if needed: `node unlock-admin.js`
2. Generate new password in 1Password
3. Generate new hash: `node generate-password-hash.js "new-password"`
4. Update `ADMIN_PASSWORD_HASH` in hosting provider
5. Redeploy site

---

## 🔍 Security Checklist

### Before Deployment
- [ ] Generate strong password (20+ characters) in 1Password
- [ ] Generate password hash: `node generate-password-hash.js`
- [ ] Set `ADMIN_PASSWORD_HASH` in hosting provider env vars
- [ ] Generate random JWT_SECRET: `openssl rand -base64 32`
- [ ] Set `JWT_SECRET` in hosting provider env vars
- [ ] Verify `.env` file is in `.gitignore`
- [ ] Test login works
- [ ] Test rate limiting (try 3 wrong passwords)

### After Deployment
- [ ] Verify HTTPS is enabled (should be automatic)
- [ ] Test login from production URL
- [ ] Keep admin URL private (don't link publicly)
- [ ] Save all credentials in 1Password
- [ ] Test unlock script: `node unlock-admin.js status`

### Regular Maintenance
- [ ] Review rate-limit.json periodically for suspicious IPs
- [ ] Monitor server logs for attack patterns
- [ ] Keep password secure in 1Password
- [ ] Consider rotating JWT_SECRET annually

---

## 📈 Threat Model

### Assets Protected
1. Store approval authority (prevent unauthorized approvals)
2. stores.json integrity (prevent malicious store additions)
3. Admin credentials (prevent account takeover)

### Attack Vectors Addressed
✅ Brute force password guessing → Rate limiting
✅ Credential stuffing → Unique strong password + rate limiting
✅ Session hijacking → HTTPS + token expiration
✅ Distributed attacks → System lockdown
✅ Manual enumeration → 1-second delay + IP blocking

### Known Limitations
⚠️ No IP geofencing (admin can login from anywhere)
⚠️ No 2FA (single-factor authentication)
⚠️ localStorage XSS vulnerability (acceptable for admin-only)
⚠️ No email alerts on failed attempts

### Risk Assessment
- **Low-value target**: Store addresses (publicly submitted)
- **Low frequency**: Manual approvals, not high-traffic
- **Single admin**: No multi-user complexity
- **Acceptable risk**: Current security appropriate for threat level

---

## 🎯 Security Best Practices

### For You
1. **Use 1Password** for password storage
2. **Use strong password** (20+ random characters)
3. **Keep admin URL private** (don't share or link publicly)
4. **Check unlock script** works before you need it
5. **Log out** from shared/public computers
6. **Monitor logs** for suspicious activity

### For System
1. **HTTPS everywhere** (enforced)
2. **Bcrypt hashing** (current standard)
3. **JWT tokens** (industry standard)
4. **Rate limiting** (prevents brute force)
5. **Server-side validation** (never trust client)
6. **Secrets in env vars** (never in code)

---

**Last Updated:** October 26, 2025
**Security Version:** 1.0 with IP Rate Limiting
