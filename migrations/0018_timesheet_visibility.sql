PRAGMA foreign_keys = ON;

ALTER TABLE employee_permissions ADD COLUMN view_all_timesheets INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kiosk_sessions ADD COLUMN shared_with_admins INTEGER NOT NULL DEFAULT 0;
