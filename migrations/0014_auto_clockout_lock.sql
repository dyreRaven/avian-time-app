PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS auto_clockout_lock (
  org_id INTEGER PRIMARY KEY,
  locked_by TEXT,
  locked_at INTEGER,
  locked_until INTEGER,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auto_clockout_lock_until
  ON auto_clockout_lock (locked_until);
