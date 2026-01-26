PRAGMA foreign_keys = OFF;

ALTER TABLE employees RENAME COLUMN qbo_employee_id TO employee_qbo_id;
ALTER TABLE employees RENAME COLUMN qbo_vendor_id TO vendor_qbo_id;

PRAGMA foreign_keys = ON;
