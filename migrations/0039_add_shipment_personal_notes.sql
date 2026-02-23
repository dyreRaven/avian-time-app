CREATE TABLE IF NOT EXISTS shipment_personal_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  shipment_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  note TEXT,
  is_completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(org_id, shipment_id, user_id),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shipment_personal_notes_lookup
  ON shipment_personal_notes (org_id, user_id, shipment_id);
