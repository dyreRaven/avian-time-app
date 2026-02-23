#!/usr/bin/env node
// Validate that a recent daily backup exists and SQLite integrity passes.

require('dotenv').config();

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const sqlite3 = require('sqlite3');
const { BACKUP_DIR, DB_PATH } = require('../lib/config');

const args = process.argv.slice(2);

function readArg(name, fallback = null) {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  const value = args[idx + 1];
  if (!value || value.startsWith('--')) return fallback;
  return value;
}

function hasFlag(name) {
  return args.includes(name);
}

function printUsage() {
  console.log('Usage: node scripts/backup-health-check.js [--max-age-hours 30] [--json]');
}

if (hasFlag('--help') || hasFlag('-h')) {
  printUsage();
  process.exit(0);
}

const maxAgeHoursRaw = readArg('--max-age-hours', '30');
const maxAgeHours = Number(maxAgeHoursRaw);
const jsonOut = hasFlag('--json');
const backupRoot = path.resolve(BACKUP_DIR || path.join(__dirname, '..', 'backups'));
const dailyRoot = path.join(backupRoot, 'daily');

function fail(message, details = {}) {
  if (jsonOut) {
    console.log(JSON.stringify({ ok: false, error: message, ...details }, null, 2));
  } else {
    console.error(`Backup health check failed: ${message}`);
    const keys = Object.keys(details || {});
    keys.forEach(key => {
      console.error(`  ${key}: ${details[key]}`);
    });
  }
  process.exitCode = 1;
}

function ok(payload) {
  if (jsonOut) {
    console.log(JSON.stringify({ ok: true, ...payload }, null, 2));
  } else {
    console.log(
      `Backup health OK: latest daily=${payload.latest_daily_key}, age=${payload.age_hours.toFixed(
        2
      )}h, db=${payload.db_file_size_bytes} bytes`
    );
  }
}

async function getLatestDailyDir(root) {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  const keys = entries
    .filter(entry => entry && entry.isDirectory())
    .map(entry => entry.name)
    .sort()
    .reverse();
  if (!keys.length) return null;
  return {
    key: keys[0],
    dir: path.join(root, keys[0])
  };
}

function runQuickCheck(filePath) {
  return new Promise((resolve, reject) => {
    const conn = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, err => {
      if (err) return reject(err);
      conn.get('PRAGMA quick_check(1) AS result', (queryErr, row) => {
        conn.close(() => {
          if (queryErr) return reject(queryErr);
          const result = String(row && row.result ? row.result : '').trim().toLowerCase();
          if (result !== 'ok') {
            return reject(new Error(`quick_check returned "${row && row.result}"`));
          }
          resolve();
        });
      });
    });
  });
}

async function main() {
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    return fail('Invalid --max-age-hours value.', { max_age_hours: maxAgeHoursRaw });
  }

  if (!fs.existsSync(dailyRoot)) {
    return fail('Daily backup directory does not exist.', { daily_root: dailyRoot });
  }

  let latest = null;
  try {
    latest = await getLatestDailyDir(dailyRoot);
  } catch (err) {
    return fail('Could not read daily backup directory.', {
      daily_root: dailyRoot,
      detail: err && err.message ? err.message : String(err)
    });
  }

  if (!latest) {
    return fail('No daily backup snapshots found.', { daily_root: dailyRoot });
  }

  const dbFileName = path.basename(DB_PATH || 'rebuild.db');
  const backupDbPath = path.join(latest.dir, dbFileName);

  if (!fs.existsSync(backupDbPath)) {
    return fail('Latest snapshot is missing the DB backup file.', {
      latest_daily_key: latest.key,
      expected_db_path: backupDbPath
    });
  }

  let stat = null;
  try {
    stat = await fsp.stat(backupDbPath);
  } catch (err) {
    return fail('Could not stat DB backup file.', {
      db_path: backupDbPath,
      detail: err && err.message ? err.message : String(err)
    });
  }

  if (!stat.isFile() || stat.size <= 0) {
    return fail('DB backup file is missing or empty.', {
      db_path: backupDbPath,
      size_bytes: stat.size
    });
  }

  const ageHours = (Date.now() - stat.mtimeMs) / (60 * 60 * 1000);
  if (ageHours > maxAgeHours) {
    return fail('Latest daily backup is older than allowed threshold.', {
      latest_daily_key: latest.key,
      age_hours: Number(ageHours.toFixed(2)),
      max_age_hours: maxAgeHours
    });
  }

  try {
    await runQuickCheck(backupDbPath);
  } catch (err) {
    return fail('SQLite quick_check failed for latest backup DB.', {
      db_path: backupDbPath,
      detail: err && err.message ? err.message : String(err)
    });
  }

  return ok({
    backup_root: backupRoot,
    latest_daily_key: latest.key,
    db_file: dbFileName,
    db_file_size_bytes: stat.size,
    age_hours: Number(ageHours.toFixed(2)),
    max_age_hours: maxAgeHours
  });
}

main().catch(err => {
  fail('Unexpected backup health-check error.', {
    detail: err && err.message ? err.message : String(err)
  });
});
