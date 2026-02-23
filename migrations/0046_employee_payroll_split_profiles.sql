CREATE TABLE IF NOT EXISTS employee_payroll_split_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  effective_start_date TEXT NOT NULL,
  created_by_employee_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_employee_id) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_employee_payroll_split_profiles_lookup
  ON employee_payroll_split_profiles(org_id, employee_id, effective_start_date, id);

CREATE TABLE IF NOT EXISTS employee_payroll_split_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  profile_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  percentage REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES employee_payroll_split_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_payroll_split_lines_unique
  ON employee_payroll_split_lines(profile_id, project_id);

CREATE INDEX IF NOT EXISTS idx_employee_payroll_split_lines_profile
  ON employee_payroll_split_lines(org_id, profile_id);
