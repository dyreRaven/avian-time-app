-- Add storage fee payment tracking to shipments
ALTER TABLE shipments ADD COLUMN storage_paid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shipments ADD COLUMN storage_paid_amount REAL;
