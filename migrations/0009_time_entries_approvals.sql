PRAGMA foreign_keys = ON;

ALTER TABLE time_punches ADD COLUMN updated_at TEXT;

ALTER TABLE time_entries ADD COLUMN payroll_run_id INTEGER;
ALTER TABLE time_entries ADD COLUMN payroll_check_id INTEGER;
ALTER TABLE time_entries ADD COLUMN updated_at TEXT;

UPDATE time_punches
SET updated_at = COALESCE(updated_at, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

UPDATE time_entries
SET updated_at = COALESCE(updated_at, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
