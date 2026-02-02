-- Add paid-by tracking for storage fees on shipments
ALTER TABLE shipments ADD COLUMN storage_paid_by TEXT;
