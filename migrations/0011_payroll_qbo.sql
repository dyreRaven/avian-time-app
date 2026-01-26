-- Payroll + QuickBooks schema (milestone 7)
-- Keep all org-scoped tables keyed by org_id.

CREATE TABLE IF NOT EXISTS payroll_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  bank_account_name TEXT,
  expense_account_name TEXT,
  default_memo TEXT,
  line_description_template TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  total_hours REAL DEFAULT 0,
  total_pay REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  include_overtime INTEGER NOT NULL DEFAULT 0,
  run_type TEXT DEFAULT 'standard',
  adjustment_reason TEXT,
  idempotency_key TEXT,
  last_attempt_id INTEGER,
  last_error TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payroll_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  payroll_run_id INTEGER NOT NULL,
  employee_id INTEGER,
  total_hours REAL,
  total_pay REAL,
  qbo_txn_id TEXT,
  paid INTEGER NOT NULL DEFAULT 0,
  paid_date TEXT,
  check_number TEXT,
  voided_at TEXT,
  voided_reason TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payroll_run_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  payroll_run_id INTEGER,
  start_date TEXT,
  end_date TEXT,
  ok INTEGER NOT NULL DEFAULT 0,
  fatal_error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payroll_attempt_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  attempt_id INTEGER NOT NULL,
  employee_id INTEGER,
  employee_name TEXT,
  total_hours REAL,
  total_pay REAL,
  ok INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  warning_codes TEXT,
  qbo_txn_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payroll_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  payroll_run_id INTEGER,
  event_type TEXT,
  actor_employee_id INTEGER,
  message TEXT,
  details_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payroll_lock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL UNIQUE,
  locked_by TEXT,
  locked_at TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS name_on_checks_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  desired_name TEXT NOT NULL,
  payee_type TEXT,
  payee_id TEXT,
  last_error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payroll_preflights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  run_type TEXT DEFAULT 'standard',
  payload_hash TEXT NOT NULL,
  snapshot_hash TEXT,
  snapshot_count INTEGER,
  payload_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_by_employee_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS qbo_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL UNIQUE,
  access_token TEXT,
  refresh_token TEXT,
  expires_at INTEGER,
  realm_id TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS qbo_oauth_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  state TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_org_dates
  ON payroll_runs (org_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_payroll_checks_run_emp
  ON payroll_checks (payroll_run_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_checks_org_run
  ON payroll_checks (org_id, payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_attempts_org
  ON payroll_run_attempts (org_id, payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_attempt_results_org
  ON payroll_attempt_results (org_id, attempt_id);
CREATE INDEX IF NOT EXISTS idx_payroll_audit_org
  ON payroll_audit_log (org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payroll_preflights_org_expires
  ON payroll_preflights (org_id, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_name_on_checks_queue_org_employee
  ON name_on_checks_queue (org_id, employee_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_qbo_oauth_states_state
  ON qbo_oauth_states (state);
