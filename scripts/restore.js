#!/usr/bin/env node
// Restore the database and uploads from a backup snapshot.

require('dotenv').config();

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { DB_PATH } = require('../lib/config');

const args = process.argv.slice(2);
const backupRoot = path.join(__dirname, '..', 'backups');
let sourceDir = null;
let force = false;

function printUsage() {
  console.log('Usage: node scripts/restore.js --source <backup_dir> [--force]');
  console.log('       node scripts/restore.js --date YYYY-MM-DD [--force]');
  console.log('       node scripts/restore.js --month YYYY-MM [--force]');
}

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--source') {
    sourceDir = args[i + 1];
    i += 1;
    continue;
  }
  if (arg === '--date') {
    const dateKey = args[i + 1];
    sourceDir = dateKey ? path.join(backupRoot, 'daily', dateKey) : null;
    i += 1;
    continue;
  }
  if (arg === '--month') {
    const monthKey = args[i + 1];
    sourceDir = monthKey ? path.join(backupRoot, 'monthly', monthKey) : null;
    i += 1;
    continue;
  }
  if (arg === '--force') {
    force = true;
    continue;
  }
  if (arg === '--help' || arg === '-h') {
    printUsage();
    process.exit(0);
  }
}

if (!sourceDir) {
  printUsage();
  process.exit(1);
}

const resolvedSource = path.resolve(sourceDir);
const resolvedDbPath = path.resolve(DB_PATH || './rebuild.db');
const dbFileName = path.basename(resolvedDbPath);
const sourceDbPath = path.join(resolvedSource, dbFileName);

const uploadMappings = [
  {
    label: 'secure_uploads',
    src: path.join(resolvedSource, 'secure_uploads'),
    dest: path.join(__dirname, '..', 'secure_uploads')
  },
  {
    label: 'uploads',
    src: path.join(resolvedSource, 'uploads'),
    dest: path.join(__dirname, '..', 'uploads')
  },
  {
    label: 'public_uploads',
    src: path.join(resolvedSource, 'public_uploads'),
    dest: path.join(__dirname, '..', 'public', 'uploads')
  }
];

async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      await fsp.copyFile(srcPath, destPath);
    }
  }
}

async function removeDir(target) {
  if (!target) return;
  if (fsp.rm) {
    await fsp.rm(target, { recursive: true, force: true });
    return;
  }
  await fsp.rmdir(target, { recursive: true });
}

async function restore() {
  if (!fs.existsSync(resolvedSource)) {
    throw new Error(`Backup source not found: ${resolvedSource}`);
  }
  if (!fs.existsSync(sourceDbPath)) {
    throw new Error(`Backup DB not found: ${sourceDbPath}`);
  }

  if (fs.existsSync(resolvedDbPath) && !force) {
    throw new Error(
      `Target DB exists at ${resolvedDbPath}. Re-run with --force to overwrite.`
    );
  }

  console.log('Restoring from:', resolvedSource);
  console.log('Target DB:', resolvedDbPath);
  console.log('Reminder: stop the server before restoring.');

  if (fs.existsSync(resolvedDbPath) && force) {
    await fsp.copyFile(resolvedDbPath, `${resolvedDbPath}.bak`);
  }

  await fsp.copyFile(sourceDbPath, resolvedDbPath);

  for (const mapping of uploadMappings) {
    if (!fs.existsSync(mapping.src)) continue;
    if (fs.existsSync(mapping.dest)) {
      if (!force) {
        throw new Error(
          `${mapping.label} exists at ${mapping.dest}. Re-run with --force to overwrite.`
        );
      }
      await removeDir(mapping.dest);
    }
    await copyDir(mapping.src, mapping.dest);
  }

  console.log('Restore complete.');
}

restore().catch(err => {
  console.error('Restore failed:', err.message || err);
  process.exit(1);
});
