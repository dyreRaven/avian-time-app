#!/usr/bin/env node
// Single-run backup helper so backups can be scheduled outside the web process.

require('dotenv').config();

const path = require('path');
const db = require('../db');
const {
  DB_PATH,
  BACKUP_DIR,
  BACKUP_DAILY_RETENTION_COUNT,
  BACKUP_MONTHLY_RETENTION_COUNT
} = require('../lib/config');
const createBackupHelper = require('../lib/backup');

const dbPath = DB_PATH;
const backupDir = BACKUP_DIR;
const secureUploadsRoot = path.join(__dirname, '..', 'secure_uploads');
const legacyUploadsRoot = path.join(__dirname, '..', 'uploads');
const legacyPublicUploadsRoot = path.join(__dirname, '..', 'public', 'uploads');
const { performDatabaseBackup } = createBackupHelper({
  db,
  dbPath,
  backupDir,
  dailyRetentionCount: BACKUP_DAILY_RETENTION_COUNT,
  monthlyRetentionCount: BACKUP_MONTHLY_RETENTION_COUNT,
  uploadsRoot: secureUploadsRoot,
  extraUploadsRoots: [
    { root: legacyUploadsRoot, label: 'uploads' },
    { root: legacyPublicUploadsRoot, label: 'public_uploads' }
  ]
});

const BACKUP_LOCK_TTL_MS = 4 * 60 * 60 * 1000;
const BACKUP_LOCK_KEY = 'backup';
const BACKUP_LOCKER_ID = `backup-once:${process.pid}`;

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) return reject(err);
      resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

async function acquireJobLock() {
  const nowMs = Date.now();
  const lockUntil = nowMs + BACKUP_LOCK_TTL_MS;
  const res = await dbRun(
    `
      INSERT INTO job_locks (job_key, locked_by, locked_at, locked_until)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(job_key) DO UPDATE SET
        locked_by = excluded.locked_by,
        locked_at = excluded.locked_at,
        locked_until = excluded.locked_until
      WHERE job_locks.locked_until IS NULL
        OR job_locks.locked_until <= ?
    `,
    [BACKUP_LOCK_KEY, BACKUP_LOCKER_ID, nowMs, lockUntil, nowMs]
  );
  return !!(res && res.changes > 0);
}

async function releaseJobLock() {
  await dbRun(
    `DELETE FROM job_locks WHERE job_key = ? AND locked_by = ?`,
    [BACKUP_LOCK_KEY, BACKUP_LOCKER_ID]
  );
}

async function refreshJobLock() {
  const nowMs = Date.now();
  const lockUntil = nowMs + BACKUP_LOCK_TTL_MS;
  await dbRun(
    `
      UPDATE job_locks
      SET locked_at = ?, locked_until = ?
      WHERE job_key = ? AND locked_by = ?
    `,
    [nowMs, lockUntil, BACKUP_LOCK_KEY, BACKUP_LOCKER_ID]
  );
}

async function backupOnce() {
  if (db.ready) {
    await db.ready;
  }

  let gotLock = false;
  try {
    gotLock = await acquireJobLock();
  } catch (err) {
    console.error('Failed to acquire backup lock:', err.message || err);
    throw err;
  }

  if (!gotLock) {
    console.log('Backup lock busy; skipping backup.');
    return { skipped: true };
  }

  const refreshMs = Math.min(BACKUP_LOCK_TTL_MS / 2, 15 * 60 * 1000);
  let refreshTimer = null;

  try {
    refreshTimer = setInterval(() => {
      refreshJobLock().catch(err => {
        console.warn('Failed to refresh backup lock:', err.message || err);
      });
    }, refreshMs);
    if (refreshTimer.unref) refreshTimer.unref();
    await performDatabaseBackup();
    return { skipped: false };
  } finally {
    if (refreshTimer) clearInterval(refreshTimer);
    await releaseJobLock();
  }
}

backupOnce()
  .then(result => {
    if (result && result.skipped) {
      console.log('Backup skipped.');
    } else {
      console.log('Backup created.');
    }
    db.close();
  })
  .catch(err => {
    console.error('Backup failed:', err);
    db.close();
    process.exitCode = 1;
  });
