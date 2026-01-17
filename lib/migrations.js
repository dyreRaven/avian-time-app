const fs = require('fs');
const path = require('path');

function exec(db, sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, err => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

async function runMigrations(db, migrationsDir) {
  await exec(db, 'PRAGMA foreign_keys = ON');
  await exec(
    db,
    `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT DEFAULT (datetime('now'))
      )
    `
  );

  const files = fs
    .readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();

  if (!files.length) {
    return { applied: 0, skipped: 0 };
  }

  const appliedRows = await all(db, 'SELECT name FROM schema_migrations');
  const appliedSet = new Set(appliedRows.map(row => row.name));

  let applied = 0;
  let skipped = 0;

  for (const file of files) {
    if (appliedSet.has(file)) {
      skipped += 1;
      continue;
    }

    const fullPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(fullPath, 'utf8').trim();

    await exec(db, 'BEGIN');
    try {
      if (sql) {
        await exec(db, sql);
      }
      await run(db, 'INSERT INTO schema_migrations (name) VALUES (?)', [file]);
      await exec(db, 'COMMIT');
      applied += 1;
    } catch (err) {
      await exec(db, 'ROLLBACK');
      throw err;
    }
  }

  return { applied, skipped };
}

module.exports = { runMigrations };
