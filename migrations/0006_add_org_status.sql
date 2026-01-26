PRAGMA foreign_keys = ON;

ALTER TABLE orgs
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE orgs
  ADD COLUMN updated_at TEXT;

UPDATE orgs
SET status = COALESCE(status, 'active');

UPDATE orgs
SET updated_at = COALESCE(updated_at, created_at, datetime('now'));
