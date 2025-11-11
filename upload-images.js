#!/usr/bin/env node

/**
 * Upload Product Images to Cloudflare R2
 *
 * Uploads product images from local directory to Cloudflare R2 bucket.
 *
 * Usage:
 *   node upload-images.js <images-directory>
 *
 * Example:
 *   node upload-images.js ~/molten-data/images/product-images/
 *
 * Environment variables required:
 *   - CLOUDFLARE_ACCOUNT_ID
 *   - CLOUDFLARE_API_TOKEN (with R2 write permissions)
 *   - CLOUDFLARE_R2_BUCKET_NAME (default: "product-images")
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Configuration
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'product-images';

// Supported image extensions
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

// Content-Type mapping
const CONTENT_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

/**
 * Main upload function
 */
async function main() {
  console.log('📦 Uploading product images to Cloudflare R2...\n');

  // Validate arguments
  if (process.argv.length < 3) {
    console.error('❌ Error: Missing images directory argument');
    console.error('Usage: node upload-images.js <images-directory>');
    console.error('Example: node upload-images.js ~/molten-data/images/product-images/');
    process.exit(1);
  }

  // Validate environment variables
  if (!ACCOUNT_ID || !API_TOKEN) {
    console.error('❌ Error: Missing required environment variables');
    console.error('Please set:');
    console.error('  - CLOUDFLARE_ACCOUNT_ID');
    console.error('  - CLOUDFLARE_API_TOKEN');
    process.exit(1);
  }

  const imagesDir = path.resolve(process.argv[2]);

  // Validate directory exists
  if (!fs.existsSync(imagesDir)) {
    console.error(`❌ Error: Directory not found: ${imagesDir}`);
    process.exit(1);
  }

  if (!fs.statSync(imagesDir).isDirectory()) {
    console.error(`❌ Error: Not a directory: ${imagesDir}`);
    process.exit(1);
  }

  // Scan directory for images
  console.log(`📂 Scanning directory: ${imagesDir}`);
  const imageFiles = scanDirectory(imagesDir);
  console.log(`   ✅ Found ${imageFiles.length} images\n`);

  if (imageFiles.length === 0) {
    console.log('⚠️  No images found in directory');
    process.exit(0);
  }

  // Upload images
  console.log(`☁️  Uploading to R2 bucket '${BUCKET_NAME}'...`);
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  let totalSize = 0;

  for (let i = 0; i < imageFiles.length; i++) {
    const file = imageFiles[i];
    const filename = path.basename(file);
    const progress = `[${i + 1}/${imageFiles.length}]`;

    try {
      const exists = await checkFileExists(filename);
      if (exists) {
        process.stdout.write(`   ${progress} Skipping ${filename} (already exists)\r`);
        skipped++;
        continue;
      }

      await uploadFile(file, filename);
      const stats = fs.statSync(file);
      totalSize += stats.size;
      uploaded++;

      // Show progress
      const percent = Math.round((i + 1) / imageFiles.length * 100);
      const bar = '█'.repeat(Math.floor(percent / 5)) + '░'.repeat(20 - Math.floor(percent / 5));
      process.stdout.write(`   [${bar}] ${i + 1}/${imageFiles.length} (${percent}%)\r`);
    } catch (error) {
      console.error(`\n   ❌ Failed to upload ${filename}: ${error.message}`);
      failed++;
    }
  }

  console.log('\n');

  // Summary
  if (uploaded > 0) {
    const sizeMB = (totalSize / 1024 / 1024).toFixed(1);
    console.log(`   ✅ Uploaded ${uploaded} images (${sizeMB} MB total)`);
  }
  if (skipped > 0) {
    console.log(`   ⏭️  Skipped ${skipped} images (already exist)`);
  }
  if (failed > 0) {
    console.log(`   ❌ Failed ${failed} images`);
  }

  console.log(`\n✅ SUCCESS! Image upload complete`);
  console.log(`\n🔗 Images available at: https://images.molten.glass/`);
  console.log(`   Example: https://images.molten.glass/${path.basename(imageFiles[0])}`);
}

/**
 * Scan directory for image files
 */
function scanDirectory(dir) {
  const files = fs.readdirSync(dir);
  return files
    .filter(file => {
      const ext = path.extname(file).toLowerCase();
      return IMAGE_EXTENSIONS.includes(ext);
    })
    .map(file => path.join(dir, file))
    .sort();
}

/**
 * Check if file already exists in R2
 */
async function checkFileExists(filename) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.cloudflare.com',
      port: 443,
      path: `/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET_NAME}/objects/${filename}`,
      method: 'HEAD',
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`
      }
    };

    const req = https.request(options, (res) => {
      // 200 = exists, 404 = doesn't exist
      resolve(res.statusCode === 200);
    });

    req.on('error', (error) => {
      // If HEAD fails, assume doesn't exist (upload will fail if it does)
      resolve(false);
    });

    req.end();
  });
}

/**
 * Upload a file to R2
 */
async function uploadFile(filePath, filename) {
  return new Promise((resolve, reject) => {
    const fileContent = fs.readFileSync(filePath);
    const ext = path.extname(filename).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';

    const options = {
      hostname: 'api.cloudflare.com',
      port: 443,
      path: `/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET_NAME}/objects/${filename}`,
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': contentType,
        'Content-Length': fileContent.length,
        'Cache-Control': 'public, max-age=31536000', // 1 year cache
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          resolve();
        } else {
          let errorMessage = `HTTP ${res.statusCode}`;
          try {
            const jsonResponse = JSON.parse(responseData);
            if (jsonResponse.errors && jsonResponse.errors.length > 0) {
              errorMessage = jsonResponse.errors[0].message;
            }
          } catch (e) {
            // Use HTTP status as error message
          }
          reject(new Error(errorMessage));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(fileContent);
    req.end();
  });
}

// Run main function
main().catch((error) => {
  console.error(`\n❌ Fatal error: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
});
