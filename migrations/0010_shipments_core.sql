PRAGMA foreign_keys = ON;

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
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (created_by) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_shipments_org_status
  ON shipments(org_id, status);
CREATE INDEX IF NOT EXISTS idx_shipments_org_project
  ON shipments(org_id, project_id);
CREATE INDEX IF NOT EXISTS idx_shipments_org_vendor
  ON shipments(org_id, vendor_id);
CREATE INDEX IF NOT EXISTS idx_shipments_org_tracking
  ON shipments(org_id, tracking_number);
CREATE INDEX IF NOT EXISTS idx_shipments_org_bol
  ON shipments(org_id, bol_number);
CREATE INDEX IF NOT EXISTS idx_shipments_org_created_at
  ON shipments(org_id, created_at);

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
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shipment_items_org_shipment
  ON shipment_items(org_id, shipment_id);

CREATE TABLE IF NOT EXISTS shipment_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  shipment_id INTEGER NOT NULL,
  old_status TEXT,
  new_status TEXT,
  note TEXT,
  changed_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shipment_status_history_org_shipment
  ON shipment_status_history(org_id, shipment_id);

CREATE TABLE IF NOT EXISTS shipment_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  shipment_id INTEGER NOT NULL,
  type TEXT,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'Pending',
  due_date TEXT,
  paid_date TEXT,
  invoice_number TEXT,
  notes TEXT,
  file_path TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_shipment_payments_org_shipment
  ON shipment_payments(org_id, shipment_id);

CREATE TABLE IF NOT EXISTS shipment_timeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  shipment_id INTEGER NOT NULL,
  event_type TEXT,
  old_status TEXT,
  new_status TEXT,
  note TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_shipment_timeline_org_shipment
  ON shipment_timeline(org_id, shipment_id);

CREATE TABLE IF NOT EXISTS shipment_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  shipment_id INTEGER NOT NULL,
  title TEXT,
  category TEXT,
  doc_type TEXT,
  doc_label TEXT,
  file_path TEXT,
  uploaded_by INTEGER,
  uploaded_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_shipment_documents_org_shipment
  ON shipment_documents(org_id, shipment_id);

CREATE TABLE IF NOT EXISTS shipment_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  shipment_id INTEGER NOT NULL,
  body TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_by INTEGER,
  deleted_at TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES employees(id),
  FOREIGN KEY (deleted_by) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_shipment_comments_org_shipment
  ON shipment_comments(org_id, shipment_id);

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
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (created_by) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_shipment_templates_org
  ON shipment_templates(org_id);

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

CREATE INDEX IF NOT EXISTS idx_shipment_template_items_org_template
  ON shipment_template_items(org_id, template_id);

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
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE (org_id, user_id),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);
