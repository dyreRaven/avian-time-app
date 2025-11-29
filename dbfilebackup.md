// db.js
// Handles the SQLite database (a single .db file on disk)

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Store the database file in the project folder as "avian-time.db"
const dbPath = path.join(__dirname, 'avian-time.db');
const db = new sqlite3.Database(dbPath);

// Create tables if they don't exist yet
db.serialize(() => {
  // Vendors synced from QuickBooks
  db.run(`
CREATE TABLE IF NOT EXISTS vendors (
      id INTEGER PRIMARY KEY,
      qbo_id TEXT UNIQUE,
      name TEXT,
      pin TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      is_freight_forwarder INTEGER NOT NULL DEFAULT 0
    )
  `);

    db.run(
    "ALTER TABLE vendors ADD COLUMN is_freight_forwarder INTEGER NOT NULL DEFAULT 0",
    err => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.log(
          'ALTER TABLE vendors ADD COLUMN is_freight_forwarder failed:',
          err.message
        );
      }
    }
  );


db.run(
    "ALTER TABLE vendors ADD COLUMN uses_timekeeping INTEGER NOT NULL DEFAULT 0",
    err => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.log(
          'ALTER TABLE vendors ADD COLUMN uses_timekeeping failed:',
          err.message
        );
      }
    }
  );


    db.run(
    "ALTER TABLE vendors ADD COLUMN active INTEGER NOT NULL DEFAULT 1",
    err => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.log(
          'ALTER TABLE vendors ADD COLUMN active failed:',
          err.message
        );
      }
    }
  );


  db.run(
    "ALTER TABLE vendors ADD COLUMN pin TEXT",
    err => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.log(
          'ALTER TABLE vendors ADD COLUMN pin failed:',
          err.message
        );
      }
    }
  );

  db.run(`
  CREATE TABLE IF NOT EXISTS payroll_audit_log (
    id              INTEGER PRIMARY KEY,
    event_type      TEXT NOT NULL,
    payroll_run_id  INTEGER,
    actor_employee_id INTEGER,
    message         TEXT,
    details_json    TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);


  // Projects / jobs synced from QuickBooks
db.run(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY,
    qbo_id TEXT UNIQUE,
    name TEXT,
    customer_name TEXT,
    geo_lat REAL,
    geo_lng REAL,
    active INTEGER NOT NULL DEFAULT 1,
    geo_radius REAL  -- radius in meters (or feet)
  )
`);

/* ───────── PAYROLL REPORT TABLES ───────── */

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS payroll_runs (
      id           INTEGER PRIMARY KEY,
      start_date   TEXT NOT NULL,
      end_date     TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      total_hours  REAL DEFAULT 0,
      total_pay    REAL DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS payroll_checks (
      id             INTEGER PRIMARY KEY,
      payroll_run_id INTEGER NOT NULL,
      employee_id    INTEGER NOT NULL,
      total_hours    REAL NOT NULL,
      total_pay      REAL NOT NULL,
      check_number   TEXT,
      paid           INTEGER DEFAULT 0,
      qbo_txn_id     TEXT,
      FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs(id),
      FOREIGN KEY (employee_id)    REFERENCES employees(id)
    )
  `);

  // 🔎 New: payroll audit log
  db.run(`
    CREATE TABLE IF NOT EXISTS payroll_audit_log (
      id                INTEGER PRIMARY KEY,
      event_type        TEXT NOT NULL,
      payroll_run_id    INTEGER,
      actor_employee_id INTEGER,
      message           TEXT,
      details_json      TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
});



db.run(
  "ALTER TABLE projects ADD COLUMN geo_radius REAL",
  err => {
    if (err && !String(err.message).includes('duplicate column name')) {
      console.log("ALTER TABLE projects ADD COLUMN geo_radius failed:", err.message);
    }
  }
);

db.run(
  "ALTER TABLE projects ADD COLUMN active INTEGER NOT NULL DEFAULT 1",
  err => {
    if (err && !String(err.message).includes('duplicate column name')) {
      console.log('ALTER TABLE projects ADD COLUMN active failed:', err.message);
    }
  }
);

// Payroll settings table
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS payroll_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      bank_account_name TEXT,
      expense_account_name TEXT,
      default_memo TEXT,
      line_description_template TEXT
    )
  `);

  // For existing DBs: try to add the column if it doesn't exist yet
  db.run(
    `ALTER TABLE payroll_settings ADD COLUMN line_description_template TEXT`,
    err => {
      if (err && !/duplicate column/i.test(err.message)) {
        console.error('Error adding line_description_template column:', err.message);
      }
    }
  );

  // Seed row if missing
  db.run(
    `INSERT OR IGNORE INTO payroll_settings
      (id, bank_account_name, expense_account_name, default_memo, line_description_template)
     VALUES (1, NULL, NULL, 'Payroll {start} – {end}', 'Labor {hours} hrs – {project}')`
  );

  // Backfill null template on existing DBs
  db.run(
    `UPDATE payroll_settings
       SET line_description_template = COALESCE(line_description_template, 'Labor {hours} hrs – {project}')
     WHERE id = 1`
  );
});


  // Employees & rates (optionally linked to a vendor)
  db.run(`
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY,
      vendor_qbo_id TEXT,
      name TEXT NOT NULL,
      nickname TEXT,
      name_on_checks TEXT,
      rate REAL NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      pin TEXT,
      require_photo INTEGER DEFAULT 0,
      is_admin INTEGER NOT NULL DEFAULT 0,
      uses_timekeeping INTEGER NOT NULL DEFAULT 1
    )
  `);

  // Migrations for existing DBs
  db.run(
    "ALTER TABLE employees ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
    err => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.log(
          'ALTER TABLE employees ADD COLUMN is_admin failed:',
          err.message
        );
      }
    }
  );

  db.run(
    "ALTER TABLE employees ADD COLUMN uses_timekeeping INTEGER NOT NULL DEFAULT 1",
    err => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.log(
          'ALTER TABLE employees ADD COLUMN uses_timekeeping failed:',
          err.message
        );
      }
    }
  );


  // Time entries for pay periods
  db.run(`
CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER,
  project_id INTEGER,
  start_date TEXT,
  end_date TEXT,
  start_time TEXT,
  end_time TEXT,
  hours REAL,
  total_pay REAL,
  foreman_employee_id INTEGER, 
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
)
  `);

// Add "paid" + "paid_date" columns to time_entries if missing
db.run(
  "ALTER TABLE time_entries ADD COLUMN paid INTEGER NOT NULL DEFAULT 0",
  err => {
    if (err && !String(err.message).includes('duplicate column name')) {
      console.log("ALTER TABLE time_entries ADD COLUMN paid failed:", err.message);
    }
  }
);

db.run(
  "ALTER TABLE time_entries ADD COLUMN paid_date TEXT",
  err => {
    if (err && !String(err.message).includes('duplicate column name')) {
      console.log("ALTER TABLE time_entries ADD COLUMN paid_date failed:", err.message);
    }
  }
);

// NEW: time fields
db.run(
  "ALTER TABLE time_entries ADD COLUMN start_time TEXT",
  err => {
    if (err && !String(err.message).includes('duplicate column name')) {
      console.log("ALTER TABLE time_entries ADD COLUMN start_time failed:", err.message);
    }
  }
);

db.run(
  "ALTER TABLE time_entries ADD COLUMN end_time TEXT",
  err => {
    if (err && !String(err.message).includes('duplicate column name')) {
      console.log("ALTER TABLE time_entries ADD COLUMN end_time failed:", err.message);
    }
  }
);

db.run(`
  ALTER TABLE time_entries
  ADD COLUMN resolved INTEGER DEFAULT 0
`, err => {});

db.run(`
  ALTER TABLE time_entries
  ADD COLUMN resolved_at TEXT
`, err => {});

db.run(`
  ALTER TABLE time_entries
  ADD COLUMN resolved_by TEXT
`, err => {});



    // Kiosks (physical devices / locations for the jobsite kiosk)
  db.run(`
    CREATE TABLE IF NOT EXISTS kiosks (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      location TEXT,
      device_id TEXT UNIQUE,           -- ID for the physical device/browser
      project_id INTEGER,              -- default project for this kiosk (optional)
      require_photo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);


    // Per-employee clock in/out punches (source of truth for kiosk)
   // Per-employee clock in/out punches (source of truth for kiosk)
db.run(`
  CREATE TABLE IF NOT EXISTS time_punches (
    id INTEGER PRIMARY KEY,
    client_id TEXT UNIQUE,
    employee_id INTEGER NOT NULL,
    project_id INTEGER,
    clock_in_ts TEXT NOT NULL,
    clock_out_ts TEXT,
    clock_in_lat REAL,
    clock_in_lng REAL,
    clock_out_lat REAL,
    clock_out_lng REAL,
    clock_in_photo TEXT,
    device_id TEXT,                   -- kiosk's device ID
    foreman_employee_id INTEGER,      -- NEW COLUMN
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (employee_id) REFERENCES employees(id),
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (foreman_employee_id) REFERENCES employees(id)
  )
`);


  
  db.run(`
  CREATE TABLE IF NOT EXISTS kiosk_foreman_days (
    id                 INTEGER PRIMARY KEY,
    kiosk_id           INTEGER NOT NULL,
    foreman_employee_id INTEGER,         -- NULL means "none"
    date               TEXT NOT NULL,    -- 'YYYY-MM-DD'
    set_by_employee_id INTEGER,          -- optional: who set this (admin)
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(kiosk_id, date)
  )
`);

 db.run(`CREATE TABLE IF NOT EXISTS shipments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  title            TEXT NOT NULL,
  po_number        TEXT,          -- purchase order number
  vendor_id        INTEGER,       -- FK to vendors.id (optional)
  vendor_name      TEXT,          -- optional free-text vendor label
  freight_forwarder TEXT,         -- or FK later if you make a table
  destination      TEXT,          -- free text or FK to destinations
  project_id       INTEGER,       -- FK to projects.id (nullable)
  sku              TEXT,
  quantity         REAL,
  total_price      REAL,
  price_per_item   REAL,

  expected_ship_date    TEXT,     -- ISO date string
  expected_arrival_date TEXT,     -- ISO date string
  tracking_number       TEXT,
  bol_number            TEXT,

  -- STORAGE (after pickup)
  storage_room      TEXT,        -- planned room/location
  storage_details   TEXT,
  picked_up_by      TEXT,
  picked_up_date    TEXT,

  -- SIMPLE PAYMENT FLAGS + AMOUNTS
  vendor_paid           INTEGER NOT NULL DEFAULT 0,
  vendor_paid_amount    REAL,
  shipper_paid          INTEGER NOT NULL DEFAULT 0,
  shipper_paid_amount   REAL,
  customs_paid          INTEGER NOT NULL DEFAULT 0,
  customs_paid_amount   REAL,

  website_url       TEXT,
  notes             TEXT,

  status            TEXT NOT NULL DEFAULT 'Pre-Order',  -- one of 13 statuses
  is_archived       INTEGER NOT NULL DEFAULT 0,
  archived_at       TEXT,         -- when auto/manual archived

  created_by        INTEGER,      -- employee/admin id
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT
);
`);


db.run(`
  CREATE TABLE IF NOT EXISTS shipment_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_id INTEGER NOT NULL,
    description TEXT,
    sku TEXT,
    quantity REAL,
    unit_price REAL,
    line_total REAL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (shipment_id) REFERENCES shipments(id)
  )
`);


  db.run(
    "ALTER TABLE shipments ADD COLUMN vendor_name TEXT",
    err => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.log(
          'ALTER TABLE shipments ADD COLUMN vendor_name failed:',
          err.message
        );
      }
    }
  );

    db.run(
    "ALTER TABLE shipments ADD COLUMN picked_up_by TEXT",
    err => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.log(
          'ALTER TABLE shipments ADD COLUMN picked_up_by failed:',
          err.message
        );
      }
    }
  );

  db.run(
    "ALTER TABLE shipments ADD COLUMN picked_up_date TEXT",
    err => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.log(
          'ALTER TABLE shipments ADD COLUMN picked_up_date failed:',
          err.message
        );
      }
    }
  );

  db.run(
    "ALTER TABLE shipments ADD COLUMN vendor_paid INTEGER NOT NULL DEFAULT 0",
    err => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.log(
          'ALTER TABLE shipments ADD COLUMN vendor_paid failed:',
          err.message
        );
      }
    }
  );

  db.run(
    "ALTER TABLE shipments ADD COLUMN vendor_paid_amount REAL",
    err => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.log(
          'ALTER TABLE shipments ADD COLUMN vendor_paid_amount failed:',
          err.message
        );
      }
    }
  );

  db.run(
    "ALTER TABLE shipments ADD COLUMN shipper_paid INTEGER NOT NULL DEFAULT 0",
    err => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.log(
          'ALTER TABLE shipments ADD COLUMN shipper_paid failed:',
          err.message
        );
      }
    }
  );

  db.run(
    "ALTER TABLE shipments ADD COLUMN shipper_paid_amount REAL",
    err => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.log(
          'ALTER TABLE shipments ADD COLUMN shipper_paid_amount failed:',
          err.message
        );
      }
    }
  );

  db.run(
    "ALTER TABLE shipments ADD COLUMN customs_paid INTEGER NOT NULL DEFAULT 0",
    err => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.log(
          'ALTER TABLE shipments ADD COLUMN customs_paid failed:',
          err.message
        );
      }
    }
  );

  db.run(
    "ALTER TABLE shipments ADD COLUMN customs_paid_amount REAL",
    err => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.log(
          'ALTER TABLE shipments ADD COLUMN customs_paid_amount failed:',
          err.message
        );
      }
    }
  );


  db.run(
  "ALTER TABLE shipments ADD COLUMN picked_up_by TEXT",
  err => {
    if (err && !String(err.message).includes('duplicate column name')) {
      console.log('ALTER TABLE shipments ADD COLUMN picked_up_by failed:', err.message);
    }
  }
);

db.run(
  "ALTER TABLE shipments ADD COLUMN picked_up_date TEXT",
  err => {
    if (err && !String(err.message).includes('duplicate column name')) {
      console.log('ALTER TABLE shipments ADD COLUMN picked_up_date failed:', err.message);
    }
  }
);

db.run(
  "ALTER TABLE shipments ADD COLUMN vendor_paid INTEGER NOT NULL DEFAULT 0",
  err => {
    if (err && !String(err.message).includes('duplicate column name')) {
      console.log('ALTER TABLE shipments ADD COLUMN vendor_paid failed:', err.message);
    }
  }
);

db.run(
  "ALTER TABLE shipments ADD COLUMN vendor_paid_amount REAL",
  err => {
    if (err && !String(err.message).includes('duplicate column name')) {
      console.log('ALTER TABLE shipments ADD COLUMN vendor_paid_amount failed:', err.message);
    }
  }
);

db.run(
  "ALTER TABLE shipments ADD COLUMN shipper_paid INTEGER NOT NULL DEFAULT 0",
  err => {
    if (err && !String(err.message).includes('duplicate column name')) {
      console.log('ALTER TABLE shipments ADD COLUMN shipper_paid failed:', err.message);
    }
  }
);

db.run(
  "ALTER TABLE shipments ADD COLUMN shipper_paid_amount REAL",
  err => {
    if (err && !String(err.message).includes('duplicate column name')) {
      console.log('ALTER TABLE shipments ADD COLUMN shipper_paid_amount failed:', err.message);
    }
  }
);

db.run(
  "ALTER TABLE shipments ADD COLUMN customs_paid INTEGER NOT NULL DEFAULT 0",
  err => {
    if (err && !String(err.message).includes('duplicate column name')) {
      console.log('ALTER TABLE shipments ADD COLUMN customs_paid failed:', err.message);
    }
  }
);

db.run(
  "ALTER TABLE shipments ADD COLUMN customs_paid_amount REAL",
  err => {
    if (err && !String(err.message).includes('duplicate column name')) {
      console.log('ALTER TABLE shipments ADD COLUMN customs_paid_amount failed:', err.message);
    }
  }
);


db.run(`
  CREATE TABLE IF NOT EXISTS shipment_status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_id INTEGER NOT NULL,
    old_status TEXT,
    new_status TEXT NOT NULL,
    changed_at TEXT NOT NULL DEFAULT (datetime('now')),
    note TEXT,
    FOREIGN KEY (shipment_id) REFERENCES shipments(id)
  )
`);


  db.run(`CREATE TABLE IF NOT EXISTS shipment_payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id  INTEGER NOT NULL,
  type         TEXT,             -- 'vendor', 'forwarder', 'customs', etc.
  amount       REAL NOT NULL,
  currency     TEXT DEFAULT 'USD',
  status       TEXT NOT NULL DEFAULT 'Pending',  -- Pending / Partial / Paid
  due_date     TEXT,
  paid_date    TEXT,
  invoice_number TEXT,
  notes        TEXT,
  file_path    TEXT,             -- link to uploaded invoice/receipt

  created_by   INTEGER,
  created_at   TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (shipment_id) REFERENCES shipments(id)
);
`);

  db.run(`CREATE TABLE IF NOT EXISTS shipment_timeline (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id  INTEGER NOT NULL,
  event_type   TEXT NOT NULL,    -- 'status_change', 'note', 'pickup', etc.
  old_status   TEXT,
  new_status   TEXT,
  note         TEXT,
  created_by   INTEGER,
  created_at   TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (shipment_id) REFERENCES shipments(id)
);
`);

  db.run(`CREATE TABLE IF NOT EXISTS shipment_documents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id  INTEGER NOT NULL,
  title        TEXT NOT NULL,
  category     TEXT,             -- Invoice, Packing List, BOL, etc.
  file_path    TEXT NOT NULL,    -- path or URL
  uploaded_by  INTEGER,
  uploaded_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (shipment_id) REFERENCES shipments(id)
);
`);


  db.run(`CREATE TABLE IF NOT EXISTS shipment_comments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id  INTEGER NOT NULL,
  body         TEXT NOT NULL,
  created_by   INTEGER,
  created_at   TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (shipment_id) REFERENCES shipments(id)
);
`);


db.run(`
CREATE TABLE IF NOT EXISTS shipment_templates (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  title        TEXT,
  vendor_id    INTEGER,
  freight_forwarder TEXT,
  destination  TEXT,
  project_id   INTEGER,
  sku          TEXT,
  quantity     REAL,
  total_price  REAL,
  price_per_item REAL,
  website_url  TEXT,
  notes        TEXT,
  created_by   INTEGER,
  created_at   TEXT DEFAULT (datetime('now'))
);
`);




  // QuickBooks OAuth tokens (just one row)
  db.run(`
    CREATE TABLE IF NOT EXISTS qbo_tokens (
      id INTEGER PRIMARY KEY,
      access_token TEXT,
      refresh_token TEXT,
      expires_at INTEGER
    )
  `);
});

 

// Export the db so other files can use it
module.exports = db;
