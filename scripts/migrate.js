const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const { DB_PATH } = require('../lib/config');
const { runMigrations } = require('../lib/migrations');

const db = new sqlite3.Database(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');

const migrationsDir = path.join(__dirname, '..', 'migrations');

runMigrations(db, migrationsDir)
  .then(({ applied, skipped }) => {
    console.log(
      `Migrations complete. Applied: ${applied}, skipped: ${skipped}.`
    );
    db.close();
  })
  .catch(err => {
    console.error('Migration failed:', err);
    db.close(() => process.exit(1));
  });
