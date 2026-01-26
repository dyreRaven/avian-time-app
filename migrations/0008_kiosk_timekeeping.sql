PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS kiosks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  location TEXT,
  device_id TEXT UNIQUE,
  device_secret TEXT,
  project_id INTEGER,
  last_seen_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS kiosk_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  kiosk_id INTEGER NOT NULL,
  device_id TEXT,
  project_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  created_by_employee_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  ended_at TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (kiosk_id) REFERENCES kiosks(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_employee_id) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS kiosk_foreman_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  kiosk_id INTEGER NOT NULL,
  foreman_employee_id INTEGER,
  date TEXT NOT NULL,
  set_by_employee_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (kiosk_id, date),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (kiosk_id) REFERENCES kiosks(id) ON DELETE CASCADE,
  FOREIGN KEY (foreman_employee_id) REFERENCES employees(id),
  FOREIGN KEY (set_by_employee_id) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS time_punches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  client_id TEXT,
  employee_id INTEGER NOT NULL,
  project_id INTEGER,
  clock_in_ts TEXT NOT NULL,
  clock_out_ts TEXT,
  clock_out_project_id INTEGER,
  clock_in_lat REAL,
  clock_in_lng REAL,
  clock_out_lat REAL,
  clock_out_lng REAL,
  geo_distance_m REAL,
  geo_violation INTEGER NOT NULL DEFAULT 0,
  clock_in_photo_path TEXT,
  device_id TEXT,
  foreman_employee_id INTEGER,
  auto_clock_out INTEGER NOT NULL DEFAULT 0,
  auto_clock_out_reason TEXT,
  exception_review_status TEXT DEFAULT 'open',
  exception_review_note TEXT,
  exception_reviewed_by TEXT,
  exception_reviewed_at TEXT,
  exception_resolved INTEGER NOT NULL DEFAULT 0,
  exception_resolved_at TEXT,
  exception_resolved_by TEXT,
  employee_name_snapshot TEXT,
  project_name_snapshot TEXT,
  time_entry_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (org_id, client_id),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  employee_id INTEGER,
  project_id INTEGER,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  hours REAL,
  total_pay REAL,
  foreman_employee_id INTEGER,
  paid INTEGER NOT NULL DEFAULT 0,
  paid_date TEXT,
  approval_status TEXT DEFAULT 'pending',
  approved_at TEXT,
  approved_by_employee_id INTEGER,
  approval_note TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  resolved_status TEXT DEFAULT 'open',
  resolved_note TEXT,
  resolved_at TEXT,
  resolved_by TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
  verified_by_employee_id INTEGER,
  employee_name_snapshot TEXT,
  project_name_snapshot TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS time_exception_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor_user_id INTEGER,
  actor_employee_id INTEGER,
  actor_name TEXT,
  note TEXT,
  changes_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kiosk_sessions_kiosk_date
  ON kiosk_sessions (kiosk_id, date);

CREATE INDEX IF NOT EXISTS idx_time_punches_employee_open
  ON time_punches (employee_id, clock_out_ts);

CREATE INDEX IF NOT EXISTS idx_time_entries_employee_start
  ON time_entries (employee_id, start_date);
