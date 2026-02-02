-- Add QBO sync tracking + split names on employees
ALTER TABLE employees ADD COLUMN given_name TEXT;
ALTER TABLE employees ADD COLUMN family_name TEXT;
ALTER TABLE employees ADD COLUMN qbo_dirty_fields_json TEXT;
ALTER TABLE employees ADD COLUMN qbo_dirty_updated_at TEXT;
ALTER TABLE employees ADD COLUMN qbo_dirty_by_employee_id INTEGER;
ALTER TABLE employees ADD COLUMN qbo_dirty_source TEXT;
ALTER TABLE employees ADD COLUMN qbo_last_seen_given_name TEXT;
ALTER TABLE employees ADD COLUMN qbo_last_seen_family_name TEXT;
ALTER TABLE employees ADD COLUMN qbo_last_seen_name_on_checks TEXT;
ALTER TABLE employees ADD COLUMN qbo_conflict_fields_json TEXT;
ALTER TABLE employees ADD COLUMN qbo_conflict_updated_at TEXT;
