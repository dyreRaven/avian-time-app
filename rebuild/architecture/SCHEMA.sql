PRAGMA foreign_keys = ON;

-- Orgs
CREATE TABLE IF NOT EXISTS orgs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS org_settings (
  org_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (org_id, key),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

-- Users / Employees / Permissions
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  nickname TEXT,
  name_on_checks TEXT,
  rate REAL,
  active INTEGER NOT NULL DEFAULT 1,
  pin_hash TEXT,
  language TEXT DEFAULT 'en',
  qbo_employee_id TEXT,
  qbo_vendor_id TEXT,
  needs_qbo_sync INTEGER NOT NULL DEFAULT 0,
  name_on_checks_updated_at TEXT,
  name_on_checks_qbo_updated_at TEXT,
  id_document_type TEXT,
  id_document_path TEXT,
  id_document_uploaded_at TEXT,
  id_document_uploaded_by INTEGER,
  worker_timekeeping INTEGER NOT NULL DEFAULT 1,
  desktop_access INTEGER NOT NULL DEFAULT 0,
  kiosk_admin_access INTEGER NOT NULL DEFAULT 0,
  email TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_orgs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  org_id INTEGER NOT NULL,
  employee_id INTEGER,
  is_super_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (user_id, org_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS employee_permissions (
  employee_id INTEGER PRIMARY KEY,
  see_shipments INTEGER NOT NULL DEFAULT 0,
  modify_time INTEGER NOT NULL DEFAULT 0,
  view_time_reports INTEGER NOT NULL DEFAULT 0,
  view_payroll INTEGER NOT NULL DEFAULT 0,
  modify_pay_rates INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  actor_user_id INTEGER,
  actor_employee_id INTEGER,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  before_json TEXT,
  after_json TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

-- Kiosks and Timekeeping
CREATE TABLE IF NOT EXISTS kiosks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  location TEXT,
  device_id TEXT UNIQUE,
  device_secret TEXT,
  project_id INTEGER,
  last_seen_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS kiosk_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  kiosk_id INTEGER NOT NULL,
  device_id TEXT,
  project_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  created_by_employee_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  ended_at TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (kiosk_id) REFERENCES kiosks(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_employee_id) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS kiosk_foreman_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  kiosk_id INTEGER NOT NULL,
  foreman_employee_id INTEGER,
  date TEXT NOT NULL,
  set_by_employee_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (kiosk_id, date),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (kiosk_id) REFERENCES kiosks(id) ON DELETE CASCADE,
  FOREIGN KEY (foreman_employee_id) REFERENCES employees(id),
  FOREIGN KEY (set_by_employee_id) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS time_punches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  client_id TEXT UNIQUE,
  employee_id INTEGER NOT NULL,
  project_id INTEGER,
  clock_in_ts TEXT NOT NULL,
  clock_out_ts TEXT,
  clock_out_project_id INTEGER,
  clock_in_lat REAL,
  clock_in_lng REAL,
  clock_out_lat REAL,
  clock_out_lng REAL,
  geo_distance_m REAL,
  geo_violation INTEGER NOT NULL DEFAULT 0,
  clock_in_photo_path TEXT,
  device_id TEXT,
  foreman_employee_id INTEGER,
  auto_clock_out INTEGER NOT NULL DEFAULT 0,
  auto_clock_out_reason TEXT,
  exception_review_status TEXT DEFAULT 'open',
  exception_review_note TEXT,
  exception_reviewed_by TEXT,
  exception_reviewed_at TEXT,
  exception_resolved INTEGER NOT NULL DEFAULT 0,
  exception_resolved_at TEXT,
  exception_resolved_by TEXT,
  employee_name_snapshot TEXT,
  project_name_snapshot TEXT,
  time_entry_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  employee_id INTEGER,
  project_id INTEGER,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  hours REAL,
  total_pay REAL,
  foreman_employee_id INTEGER,
  paid INTEGER NOT NULL DEFAULT 0,
  paid_date TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  resolved_status TEXT DEFAULT 'open',
  resolved_note TEXT,
  resolved_at TEXT,
  resolved_by TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
  verified_by_employee_id INTEGER,
  employee_name_snapshot TEXT,
  project_name_snapshot TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS time_exception_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor_user_id INTEGER,
  actor_employee_id INTEGER,
  actor_name TEXT,
  note TEXT,
  changes_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  qbo_id TEXT,
  name TEXT NOT NULL,
  customer_name TEXT,
  project_timezone TEXT,
  geo_lat REAL,
  geo_lng REAL,
  geo_radius REAL,
  active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

-- Vendors
CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  qbo_id TEXT,
  name TEXT,
  pin_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  is_freight_forwarder INTEGER NOT NULL DEFAULT 0,
  uses_timekeeping INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

-- Payroll
CREATE TABLE IF NOT EXISTS payroll_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  bank_account_name TEXT,
  expense_account_name TEXT,
  default_memo TEXT,
  line_description_template TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  total_hours REAL DEFAULT 0,
  total_pay REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  idempotency_key TEXT,
  last_attempt_id INTEGER,
  last_error TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payroll_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  payroll_run_id INTEGER NOT NULL,
  employee_id INTEGER,
  total_hours REAL,
  total_pay REAL,
  qbo_txn_id TEXT,
  paid INTEGER NOT NULL DEFAULT 0,
  paid_date TEXT,
  check_number TEXT,
  voided_at TEXT,
  voided_reason TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payroll_run_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  payroll_run_id INTEGER,
  start_date TEXT,
  end_date TEXT,
  ok INTEGER NOT NULL DEFAULT 0,
  fatal_error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payroll_attempt_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  attempt_id INTEGER NOT NULL,
  employee_id INTEGER,
  employee_name TEXT,
  total_hours REAL,
  total_pay REAL,
  ok INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  warning_codes TEXT,
  qbo_txn_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payroll_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  payroll_run_id INTEGER,
  event_type TEXT,
  actor_employee_id INTEGER,
  message TEXT,
  details_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payroll_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  org_id INTEGER NOT NULL,
  locked_by TEXT,
  locked_at TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS name_on_checks_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  desired_name TEXT NOT NULL,
  payee_type TEXT,
  payee_id TEXT,
  last_error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

-- Shipments
CREATE TABLE IF NOT EXISTS shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  po_number TEXT,
  vendor_id INTEGER,
  vendor_name TEXT,
  freight_forwarder TEXT,
  destination TEXT,
  project_id INTEGER,
  project_name_snapshot TEXT,
  sku TEXT,
  quantity REAL,
  total_price REAL,
  price_per_item REAL,
  expected_ship_date TEXT,
  expected_arrival_date TEXT,
  tracking_number TEXT,
  bol_number TEXT,
  storage_due_date TEXT,
  storage_daily_late_fee REAL,
  picked_up_by TEXT,
  picked_up_date TEXT,
  picked_up_updated_by TEXT,
  picked_up_updated_at TEXT,
  vendor_paid INTEGER NOT NULL DEFAULT 0,
  vendor_paid_amount REAL,
  shipper_paid INTEGER NOT NULL DEFAULT 0,
  shipper_paid_amount REAL,
  customs_paid INTEGER NOT NULL DEFAULT 0,
  customs_paid_amount REAL,
  total_paid REAL,
  items_verified INTEGER NOT NULL DEFAULT 0,
  verified_by TEXT,
  verification_notes TEXT,
  website_url TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'Pre-Order',
  is_archived INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shipment_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  shipment_id INTEGER NOT NULL,
  description TEXT,
  sku TEXT,
  quantity REAL,
  unit_price REAL,
  line_total REAL,
  vendor_name TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  verification_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shipment_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  shipment_id INTEGER NOT NULL,
  old_status TEXT,
  new_status TEXT NOT NULL,
  note TEXT,
  changed_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shipment_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  shipment_id INTEGER NOT NULL,
  type TEXT,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'Pending',
  due_date TEXT,
  paid_date TEXT,
  invoice_number TEXT,
  notes TEXT,
  file_path TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shipment_timeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  shipment_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  old_status TEXT,
  new_status TEXT,
  note TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shipment_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  shipment_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  category TEXT,
  doc_type TEXT,
  doc_label TEXT,
  file_path TEXT NOT NULL,
  uploaded_by INTEGER,
  uploaded_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shipment_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  shipment_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_by INTEGER,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_by INTEGER,
  deleted_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shipment_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  title TEXT,
  vendor_id INTEGER,
  freight_forwarder TEXT,
  destination TEXT,
  project_id INTEGER,
  sku TEXT,
  quantity REAL,
  total_price REAL,
  price_per_item REAL,
  website_url TEXT,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shipment_template_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  template_id INTEGER NOT NULL,
  description TEXT,
  sku TEXT,
  quantity REAL,
  unit_price REAL,
  line_total REAL,
  vendor_name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES shipment_templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shipment_notification_prefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  employee_id INTEGER,
  statuses_json TEXT,
  shipment_ids_json TEXT,
  project_ids_json TEXT,
  notify_time TEXT,
  remind_every_days INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

-- QuickBooks tokens
CREATE TABLE IF NOT EXISTS qbo_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  expires_at INTEGER,
  realm_id TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

-- Notifications
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
