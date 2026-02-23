-- Payroll receipt reimbursement approval metadata
-- Adds super-admin approval tracking before reimbursements are eligible for payroll.

ALTER TABLE payroll_receipt_reimbursements
  ADD COLUMN approved_by_employee_id INTEGER;

ALTER TABLE payroll_receipt_reimbursements
  ADD COLUMN approved_at TEXT;
