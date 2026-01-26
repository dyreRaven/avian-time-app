PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  qbo_id TEXT,
  name TEXT NOT NULL,
  customer_name TEXT,
  project_timezone TEXT,
  geo_lat REAL,
  geo_lng REAL,
  geo_radius REAL,
  active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  qbo_id TEXT,
  name TEXT,
  pin_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  is_freight_forwarder INTEGER NOT NULL DEFAULT 0,
  uses_timekeeping INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);
