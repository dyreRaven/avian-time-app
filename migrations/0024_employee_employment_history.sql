CREATE TABLE IF NOT EXISTS employee_employment_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  start_date TEXT,
  termination_date TEXT,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  recorded_by INTEGER
);

CREATE INDEX IF NOT EXISTS idx_employee_employment_history_org_employee
  ON employee_employment_history (org_id, employee_id);
