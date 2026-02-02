PRAGMA foreign_keys = ON;

ALTER TABLE employee_permissions ADD COLUMN assign_timesheets INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kiosk_sessions ADD COLUMN assigned_to_employee_id INTEGER;
