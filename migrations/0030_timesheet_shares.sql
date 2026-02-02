PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS kiosk_session_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  kiosk_session_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (kiosk_session_id, employee_id),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (kiosk_session_id) REFERENCES kiosk_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_kiosk_session_shares_session
  ON kiosk_session_shares (kiosk_session_id);

CREATE INDEX IF NOT EXISTS idx_kiosk_session_shares_employee
  ON kiosk_session_shares (employee_id);
