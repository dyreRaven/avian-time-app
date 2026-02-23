-- Payroll receipt reimbursements + defaults
-- Adds receipt reimbursement tracking for payroll integration.

ALTER TABLE payroll_settings
  ADD COLUMN receipt_expense_account_name TEXT;

ALTER TABLE payroll_settings
  ADD COLUMN receipt_class_name TEXT;

CREATE TABLE IF NOT EXISTS payroll_receipt_reimbursements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  expense_date TEXT NOT NULL,
  note TEXT,
  file_path TEXT NOT NULL,
  original_filename TEXT,
  mime_type TEXT,
  status TEXT NOT NULL DEFAULT 'requested',
  requested_by_employee_id INTEGER,
  requested_at TEXT DEFAULT (datetime('now')),
  paid_date TEXT,
  payroll_run_id INTEGER,
  payroll_check_id INTEGER,
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (requested_by_employee_id) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_receipts_org_status_date
  ON payroll_receipt_reimbursements (org_id, status, expense_date);

CREATE INDEX IF NOT EXISTS idx_payroll_receipts_org_employee_date
  ON payroll_receipt_reimbursements (org_id, employee_id, expense_date);

CREATE INDEX IF NOT EXISTS idx_payroll_receipts_org_run_employee
  ON payroll_receipt_reimbursements (org_id, payroll_run_id, employee_id);
