#!/usr/bin/env node

/**
 * Generate bcrypt password hash for admin authentication
 *
 * Usage:
 *   node generate-password-hash.js "your-strong-password-here"
 */

const bcrypt = require('bcryptjs');

const password = process.argv[2];

if (!password) {
  console.error('❌ Error: No password provided\n');
  console.log('Usage:');
  console.log('  node generate-password-hash.js "your-strong-password-here"\n');
  console.log('Example:');
  console.log('  node generate-password-hash.js "my-super-secure-password-123!"\n');
  process.exit(1);
}

// Generate hash (10 rounds = good balance of security vs performance)
const hash = bcrypt.hashSync(password, 10);

console.log('\n✅ Password hash generated successfully!\n');
console.log('Add this to your .env file:\n');
console.log(`ADMIN_PASSWORD_HASH="${hash}"`);
console.log('');
console.log('🔒 Keep this hash secret! Anyone with this hash can verify passwords.');
console.log('');
