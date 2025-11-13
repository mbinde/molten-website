/**
 * Catalog OTA Update - Server Utilities
 *
 * Utilities for managing catalog versions in Cloudflare KV:
 * - Version metadata storage and retrieval
 * - SHA-256 checksum calculation
 * - Gzip compression/decompression
 * - Download tracking and analytics
 */

/**
 * Catalog version metadata stored in KV
 */
export interface CatalogVersion {
  version: number;
  item_count: number;
  file_size: number;
  checksum: string;  // "sha256:abc123..."
  release_date: string;  // ISO 8601
  min_app_version: string;  // "1.5.0"
  changelog: string;
  created_at: string;  // ISO 8601
  created_by: string;
}

/**
 * Download analytics stored in KV
 */
export interface CatalogDownload {
  version: number;
  device_fingerprint?: string;  // From App Attest
  ip_address: string;
  user_agent?: string;
  download_type: 'full' | 'delta';
  success: boolean;
  error_message?: string;
  downloaded_at: string;  // ISO 8601
}

/**
 * Rate limiting for catalog downloads
 */
export interface CatalogRateLimit {
  identifier: string;  // IP or device fingerprint
  endpoint: string;  // 'catalog_version' or 'catalog_data'
  request_count: number;
  window_start: string;  // ISO 8601
  window_end: string;  // ISO 8601
}

/**
 * Calculate SHA-256 checksum of data
 * @param data String or Uint8Array to hash
 * @returns Checksum in format "sha256:abc123..."
 */
export async function calculateChecksum(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `sha256:${hashHex}`;
}

/**
 * Compress data using gzip
 * @param data String to compress
 * @returns Compressed Uint8Array
 */
export async function compressGzip(data: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(data);

  // Use CompressionStream API (available in Cloudflare Workers)
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  });

  const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
  const reader = compressedStream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  // Combine chunks
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Decompress gzipped data
 * @param compressed Compressed Uint8Array
 * @returns Decompressed string
 */
export async function decompressGzip(compressed: Uint8Array): Promise<string> {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(compressed);
      controller.close();
    }
  });

  const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
  const reader = decompressedStream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  // Combine chunks
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(result);
}

/**
 * Get latest catalog version metadata from KV
 * @param kv Cloudflare KV namespace
 * @param type Catalog type ('glass', 'tools', or 'coatings')
 * @returns Latest catalog version metadata, or null if none exists
 */
export async function getLatestCatalogVersion(kv: KVNamespace, type: string): Promise<CatalogVersion | null> {
  try {
    // Get latest version number for this catalog type
    const latestVersionStr = await kv.get(`catalog:${type}:latest_version`);
    if (!latestVersionStr) {
      return null;
    }

    const latestVersion = parseInt(latestVersionStr, 10);
    if (isNaN(latestVersion)) {
      console.error(`Invalid latest version for ${type}:`, latestVersionStr);
      return null;
    }

    // Get version metadata
    return await getCatalogVersion(kv, type, latestVersion);
  } catch (error) {
    console.error(`Error getting latest ${type} catalog version:`, error);
    return null;
  }
}

/**
 * Get specific catalog version metadata from KV
 * @param kv Cloudflare KV namespace
 * @param type Catalog type ('glass', 'tools', or 'coatings')
 * @param version Version number
 * @returns Catalog version metadata, or null if not found
 */
export async function getCatalogVersion(kv: KVNamespace, type: string, version: number): Promise<CatalogVersion | null> {
  try {
    const metadataJson = await kv.get(`catalog:${type}:version:${version}:metadata`);
    if (!metadataJson) {
      return null;
    }

    return JSON.parse(metadataJson) as CatalogVersion;
  } catch (error) {
    console.error(`Error getting ${type} catalog version ${version}:`, error);
    return null;
  }
}

/**
 * Get catalog data (gzipped JSON) from KV
 * @param kv Cloudflare KV namespace
 * @param type Catalog type ('glass', 'tools', or 'coatings')
 * @param version Version number
 * @returns Compressed catalog data as Uint8Array, or null if not found
 */
export async function getCatalogData(kv: KVNamespace, type: string, version: number): Promise<Uint8Array | null> {
  try {
    const dataBase64 = await kv.get(`catalog:${type}:version:${version}:data`);
    if (!dataBase64) {
      return null;
    }

    // Decode base64 to Uint8Array
    return base64ToBytes(dataBase64);
  } catch (error) {
    console.error(`Error getting ${type} catalog data for version ${version}:`, error);
    return null;
  }
}

/**
 * Store catalog version in KV
 * @param kv Cloudflare KV namespace
 * @param type Catalog type ('glass', 'tools', or 'coatings')
 * @param metadata Version metadata
 * @param compressedData Gzipped catalog JSON
 */
export async function storeCatalogVersion(
  kv: KVNamespace,
  type: string,
  metadata: CatalogVersion,
  compressedData: Uint8Array
): Promise<void> {
  // Store metadata
  await kv.put(
    `catalog:${type}:version:${metadata.version}:metadata`,
    JSON.stringify(metadata)
  );

  // Store compressed data (as base64 since KV stores strings)
  const dataBase64 = bytesToBase64(compressedData);
  await kv.put(
    `catalog:${type}:version:${metadata.version}:data`,
    dataBase64
  );

  // Update latest version pointer for this catalog type
  await kv.put(`catalog:${type}:latest_version`, metadata.version.toString());

  console.log(`✅ Stored ${type} catalog version ${metadata.version} (${metadata.item_count} items, ${compressedData.length} bytes compressed)`);
}

/**
 * Log catalog download for analytics
 * @param kv Cloudflare KV namespace
 * @param download Download record
 */
export async function logCatalogDownload(
  kv: KVNamespace,
  download: CatalogDownload
): Promise<void> {
  try {
    // Generate unique ID for this download
    const downloadId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Store download record
    await kv.put(
      `catalog:download:${downloadId}`,
      JSON.stringify(download),
      {
        expirationTtl: 90 * 24 * 60 * 60  // Keep for 90 days
      }
    );

    // Update version download counter
    const counterKey = `catalog:version:${download.version}:downloads`;
    const currentCount = parseInt(await kv.get(counterKey) || '0', 10);
    await kv.put(counterKey, (currentCount + 1).toString());
  } catch (error) {
    console.error('Error logging catalog download:', error);
  }
}

/**
 * Check catalog download rate limit
 * @param kv Cloudflare KV namespace
 * @param identifier IP address or device fingerprint
 * @param endpoint 'catalog_version' or 'catalog_data'
 * @param limit Max requests per window
 * @param windowMinutes Window size in minutes
 * @returns { allowed: boolean, remaining: number, resetAt: Date }
 */
export async function checkCatalogRateLimit(
  kv: KVNamespace,
  identifier: string,
  endpoint: string,
  limit: number,
  windowMinutes: number
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const now = new Date();
  const windowKey = `catalog:ratelimit:${identifier}:${endpoint}:${Math.floor(now.getTime() / (windowMinutes * 60 * 1000))}`;

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
