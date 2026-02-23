-- Payroll receipt reimbursement vendor name
-- Adds required-at-write vendor_name metadata used for reimbursement descriptions.

ALTER TABLE payroll_receipt_reimbursements
  ADD COLUMN vendor_name TEXT;
