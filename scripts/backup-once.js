#!/usr/bin/env node
// Single-run backup helper so backups can be scheduled outside the web process.

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const db = require('../db');
const { DB_PATH } = require('../lib/config');

const dbPath = DB_PATH;
const backupDir = path.join(__dirname, '..', 'backups');

async function backupOnce() {
  if (db.ready) {
    await db.ready;
  }

  await fsp.mkdir(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `avian-time-${timestamp}.db`;
  const backupPath = path.join(backupDir, backupName);

  if (typeof db.backup === 'function') {
    await new Promise((resolve, reject) => {
      const backup = db.backup(backupPath);
      backup.step(-1, err => {
        if (err) return reject(err);
        backup.finish(err2 => (err2 ? reject(err2) : resolve()));
      });
    });
  } else {
    await fsp.copyFile(dbPath, backupPath);
  }

  // Keep only the 30 most recent backups
  const files = await fsp.readdir(backupDir);
  const dbBackups = files
    .filter(f => f.startsWith('avian-time-'))
    .sort(
      (a, b) =>
        fs.statSync(path.join(backupDir, b)).mtime -
        fs.statSync(path.join(backupDir, a)).mtime
    );

  const MAX_BACKUPS = 30;
  if (dbBackups.length > MAX_BACKUPS) {
    const toDelete = dbBackups.slice(MAX_BACKUPS);
    for (const file of toDelete) {
      await fsp.unlink(path.join(backupDir, file));
    }
  }

  return backupName;
}

backupOnce()
  .then(name => {
    console.log(`Backup created: ${name}`);
    db.close();
  })
  .catch(err => {
    console.error('Backup failed:', err);
    db.close();
    process.exitCode = 1;
  });
