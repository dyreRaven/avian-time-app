PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  response_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (org_id, scope, key),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);
