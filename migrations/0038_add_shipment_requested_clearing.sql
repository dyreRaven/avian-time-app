ALTER TABLE shipments ADD COLUMN requested_clearing INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shipments ADD COLUMN requested_clearing_date TEXT;
