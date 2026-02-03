ALTER TABLE users ADD COLUMN password_reset_token_hash TEXT;
ALTER TABLE users ADD COLUMN password_reset_token_expires_at TEXT;
ALTER TABLE users ADD COLUMN password_reset_token_used_at TEXT;
ALTER TABLE users ADD COLUMN password_reset_token_created_at TEXT;
ALTER TABLE users ADD COLUMN password_reset_token_created_by INTEGER;
ALTER TABLE users ADD COLUMN password_reset_org_id INTEGER;
