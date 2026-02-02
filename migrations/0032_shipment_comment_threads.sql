CREATE TABLE IF NOT EXISTS shipment_comment_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  shipment_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  category TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_shipment_comment_threads_org_shipment
  ON shipment_comment_threads(org_id, shipment_id);

ALTER TABLE shipment_comments ADD COLUMN thread_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_shipment_comments_thread
  ON shipment_comments(thread_id);

INSERT INTO shipment_comment_threads (
  org_id,
  shipment_id,
  title,
  category,
  created_by,
  created_at,
  updated_at
)
SELECT
  c.org_id,
  c.shipment_id,
  'General' AS title,
  'General' AS category,
  MIN(c.created_by) AS created_by,
  MIN(c.created_at) AS created_at,
  MAX(c.created_at) AS updated_at
FROM shipment_comments c
LEFT JOIN shipment_comment_threads t
  ON t.org_id = c.org_id AND t.shipment_id = c.shipment_id
WHERE t.id IS NULL
GROUP BY c.org_id, c.shipment_id;

UPDATE shipment_comments
SET thread_id = (
  SELECT t.id
  FROM shipment_comment_threads t
  WHERE t.org_id = shipment_comments.org_id
    AND t.shipment_id = shipment_comments.shipment_id
  ORDER BY t.id ASC
  LIMIT 1
)
WHERE thread_id IS NULL;
