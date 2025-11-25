/**
 * Cryptographic utilities for inventory sharing
 * - Ed25519 signature verification
 * - App Attest validation (future)
 */

/**
 * Verify Ed25519 signature for ownership verification
 * @param signature Base64-encoded signature
 * @param data Original data that was signed
 * @param publicKey Base64-encoded Ed25519 public key
 * @returns True if signature is valid
 */
export async function verifyEd25519Signature(
  signature: string,
  data: string,
  publicKey: string
): Promise<boolean> {
  try {
    // Decode from base64
    const signatureBytes = base64ToBytes(signature);
    const publicKeyBytes = base64ToBytes(publicKey);
    const dataBytes = new TextEncoder().encode(data);

    // Import public key
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      publicKeyBytes,
      {
        name: 'Ed25519',
        namedCurve: 'Ed25519'
      } as any,  // CloudFlare Workers supports Ed25519
      false,
      ['verify']
    );

    // Verify signature
    const isValid = await crypto.subtle.verify(
      'Ed25519',
      cryptoKey,
      signatureBytes,
      dataBytes
    );

    return isValid;
  } catch (error) {
    console.error('Signature verification failed:', error);
    return false;
  }
}

/**
 * Convert base64 string to Uint8Array
 */
function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Verify App Attest assertion (iOS 14+)
 *
 * SECURITY NOTE: App Attest verification is NOT YET IMPLEMENTED.
 * Currently, this function:
 * - Rejects requests that provide an assertion (fail closed - can't verify it)
 * - Allows requests without an assertion (for older devices without App Attest)
 *
 * This is a known limitation. Additional rate limiting and abuse detection
 * should be used until full App Attest is implemented.
 *
 * @param assertion Base64-encoded App Attest assertion
 * @param requestData Request data to verify
 * @param env CloudFlare environment (for KV access to stored keys)
 * @returns Object with valid status and optional error
 */
export async function verifyAppAttestAssertion(
  assertion: string | null,
  requestData: {
    method: string;
    path: string;
    bodyHash?: string;
  },
  env: any
): Promise<{ valid: boolean; error?: string }> {
  // If no assertion provided, allow the request
  // This supports older iOS devices that don't have App Attest capability
  // Rate limiting should be applied at the endpoint level for abuse prevention
  if (!assertion) {
    return { valid: true };
  }

  // SECURITY: If an assertion IS provided, we must reject it since we can't verify it
  // This prevents attackers from sending fake assertions that would bypass any
  // future verification logic. Fail closed.
  //
  // TODO: Implement full App Attest verification
  // See: https://developer.apple.com/documentation/devicecheck/validating_apps_that_connect_to_your_server
  //
  // Steps required:
  // 1. Decode CBOR assertion
  // 2. Extract authenticator data and signature
  // 3. Reconstruct client data hash
  // 4. Fetch stored public key from KV (based on keyId from authenticator data)
  // 5. Verify signature using public key
  // 6. Validate counter to prevent replay attacks

  return {
    valid: false,
    error: 'App Attest verification not yet implemented - please retry without assertion or contact support'
  };
}

/**
 * Rate limiting using CloudFlare KV
 * @param env CloudFlare environment
 * @param key Rate limit key (e.g., "ratelimit:ip:1.2.3.4:create-share")
 * @param limit Maximum requests
 * @param windowMinutes Time window in minutes
 * @returns Object with allowed status and remaining count
 */
export async function checkRateLimit(
  env: any,
  key: string,
  limit: number,
  windowMinutes: number
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const kv = env?.INVENTORY_SHARES;
  if (!kv) {
    console.warn('Rate limiting KV not available, allowing request');
    return { allowed: true, remaining: limit, resetAt: new Date(Date.now() + windowMinutes * 60000) };
  }

  try {
    // Get current count
    const data = await kv.get(key, 'json') as { count: number; resetAt: number } | null;
    const now = Date.now();

    // If no data or expired, start fresh
    if (!data || now > data.resetAt) {
      const resetAt = now + (windowMinutes * 60000);
      await kv.put(key, JSON.stringify({ count: 1, resetAt }), {
        expirationTtl: windowMinutes * 60
      });
      return { allowed: true, remaining: limit - 1, resetAt: new Date(resetAt) };
    }

    // Check if over limit
    if (data.count >= limit) {
      return { allowed: false, remaining: 0, resetAt: new Date(data.resetAt) };
    }

    // Increment count
    const newCount = data.count + 1;
    await kv.put(key, JSON.stringify({ count: newCount, resetAt: data.resetAt }), {
      expirationTtl: Math.ceil((data.resetAt - now) / 1000)
    });

    return { allowed: true, remaining: limit - newCount, resetAt: new Date(data.resetAt) };
  } catch (error) {
    console.error('Rate limiting error:', error);
    // On error, allow request (fail open)
    return { allowed: true, remaining: limit, resetAt: new Date(Date.now() + windowMinutes * 60000) };
  }
}
