#!/usr/bin/env node

/**
 * Emergency unlock script for admin system
 *
 * Use this when:
 * - System locked down after 10 failed login attempts
 * - Need to unblock a specific IP
 * - Need to check rate limit status
 *
 * Usage:
 *   node unlock-admin.js                    # Unlock system
 *   node unlock-admin.js status             # Check status
 *   node unlock-admin.js unblock <ip>       # Unblock specific IP
 */

const fs = require('fs').promises;
const path = require('path');

const RATE_LIMIT_FILE = path.join(__dirname, 'public', 'data', 'rate-limit.json');

async function loadRateLimitData() {
  try {
    const content = await fs.readFile(RATE_LIMIT_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.log('ℹ️  No rate limit data found (system is unlocked)');
    return {
      ips: [],
      totalFailedAttempts: 0,
      isLocked: false
    };
  }
}

async function saveRateLimitData(data) {
  await fs.writeFile(RATE_LIMIT_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

async function showStatus() {
  const data = await loadRateLimitData();

  console.log('\n📊 Rate Limit Status\n');
  console.log(`System Status: ${data.isLocked ? '🔒 LOCKED' : '✅ Unlocked'}`);
  console.log(`Total Failed Attempts: ${data.totalFailedAttempts}/10`);

  if (data.lockedAt) {
    console.log(`Locked At: ${new Date(data.lockedAt).toLocaleString()}`);
  }

  if (data.ips.length > 0) {
    console.log(`\n📍 IP Records (${data.ips.length}):\n`);

    for (const ip of data.ips) {
      const status = ip.blockedUntil && new Date(ip.blockedUntil) > new Date() ? '🚫 BLOCKED' : '✅ OK';
      console.log(`  ${status} ${ip.ip}`);
      console.log(`     Attempts: ${ip.attempts}/3`);
      console.log(`     Last: ${new Date(ip.lastAttempt).toLocaleString()}`);

      if (ip.blockedUntil) {
        const blockedUntil = new Date(ip.blockedUntil);
        if (blockedUntil > new Date()) {
          console.log(`     Blocked until: ${blockedUntil.toLocaleString()}`);
        }
      }
      console.log('');
    }
  } else {
    console.log('\nNo IP records found.');
  }

  console.log('');
}

async function unlockSystem() {
  const data = await loadRateLimitData();

  if (!data.isLocked) {
    console.log('✅ System is already unlocked');
    return;
  }

  data.isLocked = false;
  data.lockedAt = undefined;
  data.totalFailedAttempts = 0;

  await saveRateLimitData(data);

  console.log('\n✅ System unlocked successfully!');
  console.log('   All IP blocks remain in place (expire after 24h).');
  console.log('   Use "node unlock-admin.js unblock <ip>" to unblock specific IPs.\n');
}

async function unblockIP(ip) {
  if (!ip) {
    console.error('❌ Error: No IP address provided\n');
    console.log('Usage: node unlock-admin.js unblock <ip>\n');
    process.exit(1);
  }

  const data = await loadRateLimitData();
  const ipRecord = data.ips.find(record => record.ip === ip);

  if (!ipRecord) {
    console.log(`ℹ️  IP ${ip} not found in records (already clean)`);
    return;
  }

  ipRecord.attempts = 0;
  ipRecord.blockedUntil = undefined;

  await saveRateLimitData(data);

  console.log(`\n✅ IP ${ip} unblocked successfully!\n`);
}

async function resetAll() {
  const data = {
    ips: [],
    totalFailedAttempts: 0,
    isLocked: false
  };

  await saveRateLimitData(data);

  console.log('\n✅ All rate limit data reset!\n');
}

// Main
async function main() {
  const command = process.argv[2] || 'unlock';
  const arg = process.argv[3];

  try {
    switch (command) {
      case 'status':
        await showStatus();
        break;

      case 'unlock':
        await unlockSystem();
        break;

      case 'unblock':
        await unblockIP(arg);
        break;

      case 'reset':
        console.log('⚠️  This will reset ALL rate limit data.');
        console.log('   - Unlock system');
        console.log('   - Unblock all IPs');
        console.log('   - Reset all counters\n');

        // Simple confirmation
        if (arg === '--confirm') {
          await resetAll();
        } else {
          console.log('Add --confirm to proceed: node unlock-admin.js reset --confirm\n');
        }
        break;

      case 'help':
      case '--help':
      case '-h':
        console.log('\nMolten Admin Unlock Script\n');
        console.log('Commands:');
        console.log('  node unlock-admin.js                  # Unlock system');
        console.log('  node unlock-admin.js status           # Show rate limit status');
        console.log('  node unlock-admin.js unblock <ip>     # Unblock specific IP');
        console.log('  node unlock-admin.js reset --confirm  # Reset all (requires --confirm)');
        console.log('');
        break;

      default:
        console.error(`❌ Unknown command: ${command}\n`);
        console.log('Run "node unlock-admin.js help" for usage.\n');
        process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
