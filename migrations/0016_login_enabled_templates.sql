PRAGMA foreign_keys = ON;

ALTER TABLE user_orgs ADD COLUMN login_enabled INTEGER NOT NULL DEFAULT 1;

UPDATE user_orgs
SET login_enabled = 1
WHERE login_enabled IS NULL;

ALTER TABLE employees ADD COLUMN role_title TEXT;
ALTER TABLE employees ADD COLUMN permission_template_id INTEGER;

CREATE TABLE IF NOT EXISTS permission_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  role_title TEXT,
  access_json TEXT,
  permissions_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_permission_templates_org
  ON permission_templates (org_id);
