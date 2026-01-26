const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

// Database backup helper (uses SQLite backup API when available).
module.exports = function createBackupHelper({
  db,
  dbPath,
  backupDir,
  uploadsRoot,
  extraUploadsRoots
}) {
  const uploadSources = [];
  const seenRoots = new Set();

  function addUploadSource(root, label) {
    if (!root) return;
    const resolved = path.resolve(root);
    if (seenRoots.has(resolved)) return;
    seenRoots.add(resolved);
    uploadSources.push({
      root,
      label: label || path.basename(root) || 'uploads'
    });
  }

  addUploadSource(uploadsRoot);
  if (Array.isArray(extraUploadsRoots)) {
    extraUploadsRoots.forEach(entry => {
      if (!entry) return;
      if (typeof entry === 'string') {
        addUploadSource(entry);
      } else if (entry.root) {
        addUploadSource(entry.root, entry.label);
      }
    });
  }
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

  async function pruneBackupDirs(root, maxCount) {
    try {
      const entries = await fsp.readdir(root, { withFileTypes: true });
      const dirs = entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort()
        .reverse();
      if (dirs.length <= maxCount) return;
      const toDelete = dirs.slice(maxCount);
      for (const dirName of toDelete) {
        await removeDir(path.join(root, dirName));
        console.log(`🗑 Deleted old backup: ${path.join(root, dirName)}`);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn('Backup retention prune failed:', err.message || err);
      }
    }
  }

  async function writeDatabaseBackup(targetPath) {
    if (typeof db.backup === 'function') {
      await new Promise((resolve, reject) => {
        const backup = db.backup(targetPath);
        backup.step(-1, err => {
          if (err) return reject(err);
          backup.finish(err2 => (err2 ? reject(err2) : resolve()));
        });
      });
    } else {
      const escaped = String(targetPath).replace(/'/g, "''");
      await new Promise((resolve, reject) => {
        db.exec(`VACUUM INTO '${escaped}'`, err => (err ? reject(err) : resolve()));
      });
    }
  }

  async function performDatabaseBackup() {
    try {
      await fsp.mkdir(backupDir, { recursive: true });

      const now = new Date();
      const dateKey = now.toISOString().slice(0, 10);
      const monthKey = dateKey.slice(0, 7);
      const dailyDir = path.join(backupDir, 'daily', dateKey);
      const monthlyDir = path.join(backupDir, 'monthly', monthKey);
      const dbFileName = path.basename(dbPath) || 'rebuild.db';
      const uploadTargets = uploadSources.map(source => ({
        root: source.root,
        label: source.label || path.basename(source.root) || 'uploads'
      }));

      await fsp.mkdir(dailyDir, { recursive: true });
      await writeDatabaseBackup(path.join(dailyDir, dbFileName));

      for (const source of uploadTargets) {
        if (!source.root || !fs.existsSync(source.root)) continue;
        await copyDir(source.root, path.join(dailyDir, source.label));
      }

      if (!fs.existsSync(monthlyDir)) {
        await fsp.mkdir(monthlyDir, { recursive: true });
        await fsp.copyFile(path.join(dailyDir, dbFileName), path.join(monthlyDir, dbFileName));
        for (const source of uploadTargets) {
          if (!source.root || !fs.existsSync(source.root)) continue;
          await copyDir(source.root, path.join(monthlyDir, source.label));
        }
      }

      await pruneBackupDirs(path.join(backupDir, 'daily'), 30);
      await pruneBackupDirs(path.join(backupDir, 'monthly'), 12);

      console.log(`📦 Backup snapshot created for ${dateKey}.`);
    } catch (err) {
      console.error('Backup error:', err);
      throw err;
    }
  }

  return { performDatabaseBackup };
};
