ALTER TABLE payroll_receipt_reimbursements
  ADD COLUMN file_sha256 TEXT;

CREATE INDEX IF NOT EXISTS idx_payroll_receipts_org_file_sha256
  ON payroll_receipt_reimbursements(org_id, file_sha256);

CREATE INDEX IF NOT EXISTS idx_payroll_receipts_org_dup_guard
  ON payroll_receipt_reimbursements(org_id, employee_id, expense_date, vendor_name, amount);

CREATE TABLE IF NOT EXISTS payroll_reimbursement_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  reimbursement_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  actor_employee_id INTEGER,
  actor_source TEXT,
  reason TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (reimbursement_id) REFERENCES payroll_receipt_reimbursements(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_employee_id) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_reimbursement_history_org_reimbursement_created
  ON payroll_reimbursement_status_history(org_id, reimbursement_id, created_at);

CREATE INDEX IF NOT EXISTS idx_reimbursement_history_org_status_created
  ON payroll_reimbursement_status_history(org_id, status, created_at);

INSERT INTO payroll_reimbursement_status_history (
  org_id,
  reimbursement_id,
  status,
  actor_employee_id,
  actor_source,
  reason,
  meta_json,
  created_at
)
SELECT
  rr.org_id,
  rr.id,
  'requested',
  rr.requested_by_employee_id,
  'request',
  NULL,
  NULL,
  COALESCE(rr.requested_at, rr.updated_at, datetime('now'))
FROM payroll_receipt_reimbursements rr;

INSERT INTO payroll_reimbursement_status_history (
  org_id,
  reimbursement_id,
  status,
  actor_employee_id,
  actor_source,
  reason,
  meta_json,
  created_at
)
SELECT
  rr.org_id,
  rr.id,
  'approved',
  rr.approved_by_employee_id,
  'review',
  NULL,
  NULL,
  rr.approved_at
FROM payroll_receipt_reimbursements rr
WHERE rr.approved_at IS NOT NULL;

INSERT INTO payroll_reimbursement_status_history (
  org_id,
  reimbursement_id,
  status,
  actor_employee_id,
  actor_source,
  reason,
  meta_json,
  created_at
)
SELECT
  rr.org_id,
  rr.id,
  'cancelled',
  rr.approved_by_employee_id,
  'review',
  NULL,
  NULL,
  COALESCE(rr.updated_at, rr.approved_at, rr.requested_at, datetime('now'))
FROM payroll_receipt_reimbursements rr
WHERE rr.status = 'cancelled';

INSERT INTO payroll_reimbursement_status_history (
  org_id,
  reimbursement_id,
  status,
  actor_employee_id,
  actor_source,
  reason,
  meta_json,
  created_at
)
SELECT
  rr.org_id,
  rr.id,
  'paid',
  rr.approved_by_employee_id,
  'payroll',
  NULL,
  NULL,
  COALESCE(rr.paid_date, rr.updated_at, rr.approved_at, rr.requested_at, datetime('now'))
FROM payroll_receipt_reimbursements rr
WHERE rr.paid_date IS NOT NULL OR rr.status = 'paid';
