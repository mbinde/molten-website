interface IPAttempt {
  ip: string;
  attempts: number;
  lastAttempt: string;
  blockedUntil?: string;
}

interface RateLimitData {
  ips: IPAttempt[];
  totalFailedAttempts: number;
  isLocked: boolean;
  lockedAt?: string;
}

const MAX_ATTEMPTS_PER_IP = 3;
const IP_BLOCK_HOURS = 24;
const TOTAL_ATTEMPTS_LOCKDOWN = 10;

// Load rate limit data from KV
async function loadRateLimitData(kv: KVNamespace): Promise<RateLimitData> {
  try {
    const content = await kv.get('rate-limit', 'json');
    if (content) {
      return content as RateLimitData;
    }
  } catch (error) {
    console.error('Error loading rate limit data from KV:', error);
  }

  // Return empty structure
  return {
    ips: [],
    totalFailedAttempts: 0,
    isLocked: false
  };
}

// Save rate limit data to KV
async function saveRateLimitData(kv: KVNamespace, data: RateLimitData): Promise<void> {
  await kv.put('rate-limit', JSON.stringify(data, null, 2));
}

// Get client IP from request
export function getClientIP(request: Request): string {
  // Try various headers (different hosting providers use different headers)
  const headers = request.headers;

  const ip =
    headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    headers.get('x-real-ip') ||
    headers.get('cf-connecting-ip') || // Cloudflare
    headers.get('x-client-ip') ||
    'unknown';

  return ip;
}

// Check if system is locked down
async function isSystemLocked(kv: KVNamespace): Promise<boolean> {
  const data = await loadRateLimitData(kv);
  return data.isLocked;
}

// Check if IP is blocked
async function isIPBlocked(kv: KVNamespace, ip: string): Promise<{ blocked: boolean; reason?: string }> {
  const data = await loadRateLimitData(kv);

  // Check if entire system is locked
  if (data.isLocked) {
    return {
      blocked: true,
      reason: `System is locked down due to ${data.totalFailedAttempts} failed login attempts. Contact administrator.`
    };
  }

  // Find IP record
  const ipRecord = data.ips.find(record => record.ip === ip);
  if (!ipRecord) {
    return { blocked: false };
  }

  // Check if IP is blocked
  if (ipRecord.blockedUntil) {
    const blockedUntil = new Date(ipRecord.blockedUntil);
    if (new Date() < blockedUntil) {
      const hoursLeft = Math.ceil((blockedUntil.getTime() - Date.now()) / (1000 * 60 * 60));
      return {
        blocked: true,
        reason: `IP blocked for ${hoursLeft} more hour(s) due to too many failed attempts.`
      };
    }
  }

  return { blocked: false };
}

// Record failed login attempt
export async function recordFailedAttempt(kv: KVNamespace, ip: string): Promise<void> {
  const data = await loadRateLimitData(kv);

  // Increment total attempts
  data.totalFailedAttempts++;

  console.warn(`⚠️  Failed login attempt from ${ip} (Total: ${data.totalFailedAttempts})`);

  // Check if we should lock down the entire system
  if (data.totalFailedAttempts >= TOTAL_ATTEMPTS_LOCKDOWN && !data.isLocked) {
    data.isLocked = true;
    data.lockedAt = new Date().toISOString();
    console.error(`🚨 SYSTEM LOCKED DOWN after ${data.totalFailedAttempts} failed attempts`);
    console.error(`🔒 Run 'node unlock-admin.js' to unlock`);
  }

  // Find or create IP record
  let ipRecord = data.ips.find(record => record.ip === ip);
  if (!ipRecord) {
    ipRecord = {
      ip,
      attempts: 0,
      lastAttempt: new Date().toISOString()
    };
    data.ips.push(ipRecord);
  }

  // Increment IP attempts
  ipRecord.attempts++;
  ipRecord.lastAttempt = new Date().toISOString();

  // Block IP if too many attempts
  if (ipRecord.attempts >= MAX_ATTEMPTS_PER_IP) {
    const blockedUntil = new Date();
    blockedUntil.setHours(blockedUntil.getHours() + IP_BLOCK_HOURS);
    ipRecord.blockedUntil = blockedUntil.toISOString();

    console.warn(`🚫 IP ${ip} blocked until ${blockedUntil.toISOString()}`);
  }

  await saveRateLimitData(kv, data);
}

// Record successful login (reset IP attempts)
export async function recordSuccessfulLogin(kv: KVNamespace, ip: string): Promise<void> {
  const data = await loadRateLimitData(kv);

  // Find IP record and reset attempts
  const ipRecord = data.ips.find(record => record.ip === ip);
  if (ipRecord) {
    ipRecord.attempts = 0;
    ipRecord.blockedUntil = undefined;
    console.log(`✅ Successful login from ${ip}, attempts reset`);
  }

  await saveRateLimitData(kv, data);
}

// Main rate limit check
export async function checkRateLimit(kv: KVNamespace, request: Request): Promise<{ allowed: boolean; error?: string }> {
  const ip = getClientIP(request);

  console.log(`🔍 Login attempt from IP: ${ip}`);

  // Check if IP is blocked
  const ipCheck = await isIPBlocked(kv, ip);
  if (ipCheck.blocked) {
    return {
      allowed: false,
      error: ipCheck.reason
    };
  }

  return { allowed: true };
}

// Admin function: Unlock system
export async function unlockSystem(kv: KVNamespace): Promise<void> {
  const data = await loadRateLimitData(kv);
  data.isLocked = false;
  data.lockedAt = undefined;
  data.totalFailedAttempts = 0;
  console.log('✅ System unlocked');
  await saveRateLimitData(kv, data);
}

// Admin function: Unblock IP
export async function unblockIP(kv: KVNamespace, ip: string): Promise<void> {
  const data = await loadRateLimitData(kv);
  const ipRecord = data.ips.find(record => record.ip === ip);
  if (ipRecord) {
    ipRecord.attempts = 0;
    ipRecord.blockedUntil = undefined;
    console.log(`✅ IP ${ip} unblocked`);
    await saveRateLimitData(kv, data);
  }
}

// Admin function: Get rate limit status
export async function getRateLimitStatus(kv: KVNamespace): Promise<RateLimitData> {
  return await loadRateLimitData(kv);
}
