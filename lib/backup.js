const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

// Database backup helper (uses SQLite backup API when available).
module.exports = function createBackupHelper({ db, dbPath, backupDir }) {
  async function performDatabaseBackup() {
    try {
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
        console.log(`📦 Database backup created: ${backupName}`);
      } else {
        await fsp.copyFile(dbPath, backupPath);
        console.log(`📦 Database backup created: ${backupName}`);
      }

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
          console.log(`🗑 Deleted old backup: ${file}`);
        }
      }
    } catch (err) {
      console.error('Backup error:', err);
    }
  }

  return { performDatabaseBackup };
};
