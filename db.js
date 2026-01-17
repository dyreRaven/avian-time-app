// db.js
// Rebuild database connection + migrations

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const { DB_PATH } = require('./lib/config');
const { runMigrations } = require('./lib/migrations');

const db = new sqlite3.Database(DB_PATH);

db.exec('PRAGMA foreign_keys = ON');

const migrationsDir = path.join(__dirname, 'migrations');

db.ready = runMigrations(db, migrationsDir).catch(err => {
  console.error('Database migrations failed:', err);
  process.exit(1);
});

module.exports = db;
