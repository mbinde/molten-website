#!/usr/bin/env node

/**
 * Upload Catalog to Cloudflare KV
 *
 * Usage:
 *   node upload-catalog.js <catalog-file> <version> <changelog>
 *
 * Example:
 *   node upload-catalog.js glassitems.json 1 "Initial catalog version"
 *   node upload-catalog.js glassitems.json 2 "Added 15 new AB Imagery colors, updated 7 discontinued Effetre items"
 *
 * Environment variables:
 *   CLOUDFLARE_ACCOUNT_ID - Your Cloudflare account ID
 *   CLOUDFLARE_API_TOKEN - API token with KV edit permissions
 *   CLOUDFLARE_KV_NAMESPACE_ID - KV namespace ID for CATALOG_VERSIONS
 *
 * Requirements:
 *   npm install @cloudflare/wrangler-api --save-dev
 */

import fs from 'fs';
import { createHash } from 'crypto';
import { gzipSync } from 'zlib';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const [,, catalogFile, versionArg, ...changelogParts] = process.argv;

if (!catalogFile || !versionArg) {
  console.error('Usage: node upload-catalog.js <catalog-file> <version> <changelog>');
  console.error('Example: node upload-catalog.js glassitems.json 1 "Initial catalog version"');
  process.exit(1);
}

const version = parseInt(versionArg, 10);
if (isNaN(version) || version < 1) {
  console.error('Error: Version must be a positive integer');
  process.exit(1);
}

const changelog = changelogParts.join(' ') || 'Catalog update';

// Check environment variables
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const namespaceId = process.env.CLOUDFLARE_KV_NAMESPACE_ID;

if (!accountId || !apiToken || !namespaceId) {
  console.error('Error: Missing required environment variables:');
  console.error('  CLOUDFLARE_ACCOUNT_ID');
  console.error('  CLOUDFLARE_API_TOKEN');
  console.error('  CLOUDFLARE_KV_NAMESPACE_ID');
  console.error('\nYou can find these values in your Cloudflare dashboard:');
  console.error('  Account ID: https://dash.cloudflare.com/ (in the URL or right sidebar)');
  console.error('  API Token: https://dash.cloudflare.com/profile/api-tokens (create with "Edit Cloudflare Workers" template)');
  console.error('  KV Namespace ID: https://dash.cloudflare.com/ → Workers & Pages → KV → CATALOG_VERSIONS');
  process.exit(1);
}

async function uploadCatalog() {
  console.log('📦 Uploading catalog to Cloudflare KV...\n');

  // 1. Read catalog file
  console.log(`📖 Reading catalog file: ${catalogFile}`);
  const catalogPath = path.resolve(catalogFile);

  if (!fs.existsSync(catalogPath)) {
    console.error(`Error: File not found: ${catalogPath}`);
    process.exit(1);
  }

  const catalogContent = fs.readFileSync(catalogPath, 'utf-8');
  let catalogData;

  try {
    catalogData = JSON.parse(catalogContent);
  } catch (error) {
    console.error('Error: Invalid JSON in catalog file');
    console.error(error);
    process.exit(1);
  }

  // Extract item count
  const itemCount = catalogData.glassitems?.length || 0;
  console.log(`   ✅ Loaded ${itemCount} glass items`);

  // 2. Calculate checksum (SHA-256)
  console.log('\n🔒 Calculating checksum...');
  const hash = createHash('sha256');
  hash.update(catalogContent);
  const checksum = `sha256:${hash.digest('hex')}`;
  console.log(`   ✅ Checksum: ${checksum.substring(0, 50)}...`);

  // 3. Compress with gzip
  console.log('\n🗜️  Compressing with gzip...');
  const compressed = gzipSync(catalogContent);
  const originalSize = Buffer.byteLength(catalogContent);
  const compressedSize = compressed.length;
  const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(1);
  console.log(`   ✅ Original: ${(originalSize / 1024).toFixed(1)} KB`);
  console.log(`   ✅ Compressed: ${(compressedSize / 1024).toFixed(1)} KB`);
  console.log(`   ✅ Compression: ${compressionRatio}%`);

  // 4. Create metadata
  const metadata = {
    version,
    item_count: itemCount,
    file_size: originalSize,
    checksum,
    release_date: new Date().toISOString(),
    min_app_version: '1.5.0',
    changelog,
    created_at: new Date().toISOString(),
    created_by: process.env.USER || 'unknown'
  };

  // 5. Upload to Cloudflare KV
  console.log('\n☁️  Uploading to Cloudflare KV...');

  // Convert compressed data to base64
  const compressedBase64 = compressed.toString('base64');

  // Prepare KV API requests
  const kvApiBase = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`;
  const headers = {
    'Authorization': `Bearer ${apiToken}`,
    'Content-Type': 'application/json'
  };

  try {
    // Upload metadata
    console.log(`   📝 Uploading version ${version} metadata...`);
    const metadataResponse = await fetch(`${kvApiBase}/values/catalog:version:${version}:metadata`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(metadata)
    });

    if (!metadataResponse.ok) {
      const error = await metadataResponse.text();
      throw new Error(`Failed to upload metadata: ${error}`);
    }
    console.log(`   ✅ Metadata uploaded`);

    // Upload compressed data
    console.log(`   📦 Uploading compressed catalog data...`);
    const dataResponse = await fetch(`${kvApiBase}/values/catalog:version:${version}:data`, {
      method: 'PUT',
      headers,
      body: compressedBase64
    });

    if (!dataResponse.ok) {
      const error = await dataResponse.text();
      throw new Error(`Failed to upload data: ${error}`);
    }
    console.log(`   ✅ Catalog data uploaded`);

    // Update latest version pointer
    console.log(`   🔖 Updating latest version pointer...`);
    const latestResponse = await fetch(`${kvApiBase}/values/catalog:latest_version`, {
      method: 'PUT',
      headers,
      body: version.toString()
    });

    if (!latestResponse.ok) {
      const error = await latestResponse.text();
      throw new Error(`Failed to update latest version: ${error}`);
    }
    console.log(`   ✅ Latest version set to ${version}`);

    // Success!
    console.log('\n✅ SUCCESS! Catalog uploaded to Cloudflare KV\n');
    console.log('📊 Summary:');
    console.log(`   Version: ${version}`);
    console.log(`   Items: ${itemCount}`);
    console.log(`   Size: ${(compressedSize / 1024).toFixed(1)} KB (compressed)`);
    console.log(`   Checksum: ${checksum.substring(0, 50)}...`);
    console.log(`   Changelog: ${changelog}`);
    console.log('\n🚀 The catalog is now available at:');
    console.log(`   GET https://yourdomain.com/api/catalog/version`);
    console.log(`   GET https://yourdomain.com/api/catalog/data`);

  } catch (error) {
    console.error('\n❌ Upload failed:');
    console.error(error.message);
    process.exit(1);
  }
}

uploadCatalog();
