ALTER TABLE kiosks ADD COLUMN registered_by_employee_id INTEGER;
ALTER TABLE kiosks ADD COLUMN registered_at TEXT;
ALTER TABLE kiosks ADD COLUMN last_enrolled_at TEXT;

UPDATE kiosks
SET registered_at = COALESCE(registered_at, created_at)
WHERE registered_at IS NULL;
