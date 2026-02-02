PRAGMA foreign_keys = ON;

ALTER TABLE shipments ADD COLUMN shipper_paid_by TEXT;
ALTER TABLE shipments ADD COLUMN customs_paid_by TEXT;
