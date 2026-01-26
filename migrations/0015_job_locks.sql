PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS job_locks (
  job_key TEXT PRIMARY KEY,
  locked_by TEXT,
  locked_at INTEGER,
  locked_until INTEGER
);

CREATE INDEX IF NOT EXISTS idx_job_locks_until
  ON job_locks (locked_until);
