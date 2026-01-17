PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS orgs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS org_settings (
  org_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (org_id, key),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  nickname TEXT,
  name_on_checks TEXT,
  rate REAL,
  active INTEGER NOT NULL DEFAULT 1,
  pin_hash TEXT,
  language TEXT DEFAULT 'en',
  qbo_employee_id TEXT,
  qbo_vendor_id TEXT,
  needs_qbo_sync INTEGER NOT NULL DEFAULT 0,
  name_on_checks_updated_at TEXT,
  name_on_checks_qbo_updated_at TEXT,
  id_document_type TEXT,
  id_document_path TEXT,
  id_document_uploaded_at TEXT,
  id_document_uploaded_by INTEGER,
  worker_timekeeping INTEGER NOT NULL DEFAULT 1,
  desktop_access INTEGER NOT NULL DEFAULT 0,
  kiosk_admin_access INTEGER NOT NULL DEFAULT 0,
  email TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_orgs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  org_id INTEGER NOT NULL,
  employee_id INTEGER,
  is_super_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (user_id, org_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS employee_permissions (
  employee_id INTEGER PRIMARY KEY,
  see_shipments INTEGER NOT NULL DEFAULT 0,
  modify_time INTEGER NOT NULL DEFAULT 0,
  view_time_reports INTEGER NOT NULL DEFAULT 0,
  view_payroll INTEGER NOT NULL DEFAULT 0,
  modify_pay_rates INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  actor_user_id INTEGER,
  actor_employee_id INTEGER,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  before_json TEXT,
  after_json TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);
