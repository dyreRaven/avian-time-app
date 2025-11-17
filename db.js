// db.js
// Handles the SQLite database (a single .db file on disk)

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Store the database file in the project folder as "avian-time.db"
const dbPath = path.join(__dirname, 'avian-time.db');
const db = new sqlite3.Database(dbPath);

// Create tables if they don't exist yet
db.serialize(() => {
  // Vendors synced from QuickBooks
  db.run(`
    CREATE TABLE IF NOT EXISTS vendors (
      id INTEGER PRIMARY KEY,
      qbo_id TEXT UNIQUE,
      name TEXT
    )
  `);

  // Projects / jobs synced from QuickBooks
  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY,
      qbo_id TEXT UNIQUE,
      name TEXT,
      customer_name TEXT
    )
  `);

  // Employees & rates (optionally linked to a vendor)
db.run(`
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY,
    vendor_qbo_id TEXT,
    name TEXT NOT NULL,
    nickname TEXT,
    name_on_checks TEXT,
    rate REAL NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    pin TEXT,               
    require_photo INTEGER DEFAULT 0
  )
`);

  // Time entries for pay periods
  db.run(`
    CREATE TABLE IF NOT EXISTS time_entries (
      id INTEGER PRIMARY KEY,
      employee_id INTEGER,
      project_id INTEGER,
      start_date TEXT,
      end_date TEXT,
      hours REAL,
      total_pay REAL,
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

    // Per-employee clock in/out punches (source of truth for kiosk)
   db.run(`
    CREATE TABLE IF NOT EXISTS time_punches (
      id INTEGER PRIMARY KEY,
      client_id TEXT UNIQUE,           -- UUID from the kiosk, used for offline sync de-dupe
      employee_id INTEGER NOT NULL,
      project_id INTEGER,
      clock_in_ts TEXT NOT NULL,       -- ISO timestamp when employee clocks in
      clock_out_ts TEXT,               -- ISO timestamp when employee clocks out (null while open)
      clock_in_lat REAL,
      clock_in_lng REAL,
      clock_out_lat REAL,
      clock_out_lng REAL,
      clock_in_photo TEXT,             -- base64 photo captured at clock-in (optional)
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  

  // QuickBooks OAuth tokens (just one row)
  db.run(`
    CREATE TABLE IF NOT EXISTS qbo_tokens (
      id INTEGER PRIMARY KEY,
      access_token TEXT,
      refresh_token TEXT,
      expires_at INTEGER
    )
  `);
});

// Export the db so other files can use it
module.exports = db;
