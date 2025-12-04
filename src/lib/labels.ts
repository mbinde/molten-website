/**
 * Label Database OTA Update - Server Utilities
 *
 * Utilities for managing label database versions in Cloudflare KV:
 * - Version metadata storage and retrieval
 * - SHA-256 checksum calculation
 * - Download tracking and analytics
 */

/**
 * Label database version metadata stored in KV
 */
export interface LabelVersion {
  version: number;
  releaseDate: string;  // ISO 8601
  fileSize: number;
  checksum: string;  // "sha256:abc123..."
  minAppVersion: string;  // "1.0.0"
  changelog: string | null;
  createdAt: string;  // ISO 8601
  createdBy: string;
}

/**
 * Get latest label database version metadata from KV
 * @param kv Cloudflare KV namespace
 * @returns Latest label version metadata, or null if none exists
 */
export async function getLatestLabelVersion(kv: KVNamespace): Promise<LabelVersion | null> {
  try {
    // Get latest version number
    const latestVersionStr = await kv.get('labels:latest_version');
    if (!latestVersionStr) {
      return null;
    }

    const latestVersion = parseInt(latestVersionStr, 10);
    if (isNaN(latestVersion)) {
      console.error('Invalid latest label version:', latestVersionStr);
      return null;
    }

    // Get version metadata
    return await getLabelVersion(kv, latestVersion);
  } catch (error) {
    console.error('Error getting latest label version:', error);
    return null;
  }
}

/**
 * Get specific label database version metadata from KV
 * @param kv Cloudflare KV namespace
 * @param version Version number
 * @returns Label version metadata, or null if not found
 */
export async function getLabelVersion(kv: KVNamespace, version: number): Promise<LabelVersion | null> {
  try {
    const metadataJson = await kv.get(`labels:version:${version}:metadata`);
    if (!metadataJson) {
      return null;
    }

    return JSON.parse(metadataJson) as LabelVersion;
  } catch (error) {
    console.error(`Error getting label version ${version}:`, error);
    return null;
  }
}

/**
 * Get label database data (SQLite file, possibly gzipped) from KV
 * @param kv Cloudflare KV namespace
 * @param version Version number
 * @returns Database data as Uint8Array, or null if not found
 */
export async function getLabelData(kv: KVNamespace, version: number): Promise<Uint8Array | null> {
  try {
    const dataBase64 = await kv.get(`labels:version:${version}:data`);
    if (!dataBase64) {
      return null;
    }

    // Decode base64 to Uint8Array
    return base64ToBytes(dataBase64);
  } catch (error) {
    console.error(`Error getting label data for version ${version}:`, error);
    return null;
  }
}

/**
 * Store label database version in KV
 * @param kv Cloudflare KV namespace
 * @param metadata Version metadata
 * @param data Database data (SQLite file)
 */
export async function storeLabelVersion(
  kv: KVNamespace,
  metadata: LabelVersion,
  data: Uint8Array
): Promise<void> {
  // Store metadata
  await kv.put(
    `labels:version:${metadata.version}:metadata`,
    JSON.stringify(metadata)
  );

  // Store data (as base64 since KV stores strings)
  const dataBase64 = bytesToBase64(data);
  await kv.put(
    `labels:version:${metadata.version}:data`,
    dataBase64
  );

  // Update latest version pointer
  await kv.put('labels:latest_version', metadata.version.toString());

  console.log(`✅ Stored label database version ${metadata.version} (${data.length} bytes)`);
}

/**
 * Check label download rate limit
 * @param kv Cloudflare KV namespace
 * @param identifier IP address or device fingerprint
 * @param endpoint 'label_version' or 'label_data'
 * @param limit Max requests per window
 * @param windowMinutes Window size in minutes
 * @returns { allowed: boolean, remaining: number, resetAt: Date }
 */
export async function checkLabelRateLimit(
  kv: KVNamespace,
  identifier: string,
  endpoint: string,
  limit: number,
  windowMinutes: number
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const now = new Date();
  const windowKey = `labels:ratelimit:${identifier}:${endpoint}:${Math.floor(now.getTime() / (windowMinutes * 60 * 1000))}`;

  // Get current count
  const countStr = await kv.get(windowKey);
  const count = countStr ? parseInt(countStr, 10) : 0;

  if (count >= limit) {
    // Rate limit exceeded
    const resetAt = new Date(Math.ceil(now.getTime() / (windowMinutes * 60 * 1000)) * windowMinutes * 60 * 1000);
    return {
      allowed: false,
      remaining: 0,
      resetAt
    };
  }

  // Increment counter
  await kv.put(windowKey, (count + 1).toString(), {
    expirationTtl: windowMinutes * 60 + 60  // Window + 1 minute buffer
  });

  const resetAt = new Date(Math.ceil(now.getTime() / (windowMinutes * 60 * 1000)) * windowMinutes * 60 * 1000);
  return {
    allowed: true,
    remaining: limit - count - 1,
    resetAt
  };
}

/**
 * Calculate SHA-256 checksum of data
 * @param data Uint8Array to hash
 * @returns Checksum in format "sha256:abc123..."
 */
export async function calculateChecksum(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `sha256:${hashHex}`;
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
 * Convert Uint8Array to base64 string
 */
function bytesToBase64(bytes: Uint8Array): string {
  const binaryString = Array.from(bytes)
    .map(byte => String.fromCharCode(byte))
    .join('');
  return btoa(binaryString);
}
