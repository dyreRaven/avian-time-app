-- Notifications system tables

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  type TEXT,
  title TEXT,
  body TEXT,
  data_json TEXT,
  read_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notification_prefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  email_enabled INTEGER NOT NULL DEFAULT 1,
  push_enabled INTEGER NOT NULL DEFAULT 1,
  shipment_filters_json TEXT,
  payroll_filters_json TEXT,
  time_filters_json TEXT,
  remind_time TEXT,
  remind_every_days INTEGER,
  clockout_enabled INTEGER NOT NULL DEFAULT 0,
  clockout_time TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  notification_id INTEGER NOT NULL,
  channel TEXT NOT NULL,
  status TEXT,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  revoked_at TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notifications_org_user
  ON notifications (org_id, user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (org_id, user_id, read_at, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_prefs_org_user
  ON notification_prefs (org_id, user_id);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_org
  ON notification_deliveries (org_id, notification_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_org_user_endpoint
  ON push_subscriptions (org_id, user_id, endpoint);
