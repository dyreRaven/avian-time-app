PRAGMA foreign_keys = ON;

ALTER TABLE employees ADD COLUMN employee_photo_path TEXT;
ALTER TABLE employees ADD COLUMN employee_photo_uploaded_at TEXT;
ALTER TABLE employees ADD COLUMN employee_photo_uploaded_by INTEGER;
