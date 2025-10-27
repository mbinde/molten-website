#!/usr/bin/env node

/**
 * Generate bcrypt password hash for admin authentication
 *
 * Usage:
 *   node generate-password-hash.js              # Interactive (recommended)
 *   node generate-password-hash.js "password"   # Command line
 */

import bcrypt from 'bcryptjs';
import readline from 'readline';

async function promptPassword() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  // Disable echo for password input
  const stdin = process.stdin;
  if (stdin.isTTY) {
    stdin.setRawMode(true);
  }

  return new Promise((resolve) => {
    let password = '';

    console.log('Enter your password (input hidden): ');

    stdin.on('data', (char) => {
      const byte = char.toString();

      if (byte === '\n' || byte === '\r' || byte === '\u0004') {
        // Enter pressed
        stdin.setRawMode(false);
        stdin.pause();
        console.log('\n'); // New line after hidden input
        rl.close();
        resolve(password);
      } else if (byte === '\u0003') {
        // Ctrl+C
        console.log('\n\n❌ Cancelled\n');
        process.exit(0);
      } else if (byte === '\u007f' || byte === '\b') {
        // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
        }
      } else {
        // Regular character
        password += byte;
      }
    });
  });
}

async function main() {
  let password = process.argv[2];

  // If no command line arg, prompt for password
  if (!password) {
    console.log('🔐 Generate Password Hash for Molten Admin\n');
    password = await promptPassword();

    if (!password || password.trim().length === 0) {
      console.error('❌ Error: Password cannot be empty\n');
      process.exit(1);
    }
  }

  console.log('⏳ Generating hash (this takes a few seconds)...\n');

  // Generate hash (10 rounds = good balance of security vs performance)
  const hash = bcrypt.hashSync(password, 10);

  console.log('✅ Password hash generated successfully!\n');
  console.log('Add this to your .env file:\n');
  console.log(`ADMIN_PASSWORD_HASH="${hash}"`);
  console.log('');
  console.log('🔒 Keep this hash secret! Anyone with this hash can verify passwords.');
  console.log('');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
