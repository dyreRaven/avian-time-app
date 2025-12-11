// db.js
// Central SQLite database schema for Avian Time & Payroll

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Store the database file in the project folder as "avian-time.db"
const dbPath = path.join(__dirname, 'avian-time.db');
const db = new sqlite3.Database(dbPath);

// If you ever want to strictly enforce foreign keys, you can uncomment this:
// db.exec('PRAGMA foreign_keys = ON');

// Run all setup in a single serialize block so it’s deterministic
db.serialize(() => {
  /* ───────── 1. CORE MASTER DATA: VENDORS, PROJECTS, EMPLOYEES ───────── */

  // Vendors synced from QuickBooks
  db.run(`
    CREATE TABLE IF NOT EXISTS vendors (
      id                   INTEGER PRIMARY KEY,
      qbo_id               TEXT UNIQUE,
      name                 TEXT,
      pin                  TEXT,
      active               INTEGER NOT NULL DEFAULT 1,
      is_freight_forwarder INTEGER NOT NULL DEFAULT 0,
      uses_timekeeping     INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Projects / jobs synced from QuickBooks
  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id            INTEGER PRIMARY KEY,
      qbo_id        TEXT UNIQUE,
      name          TEXT,
      customer_name TEXT,
      project_timezone TEXT,
      geo_lat       REAL,
      geo_lng       REAL,
      active        INTEGER NOT NULL DEFAULT 1,
      geo_radius    REAL   -- radius in meters
    )
  `);

  // App-wide settings key/value store
  db.run(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Employees & rates (optionally linked to a vendor)
db.run(`
  CREATE TABLE IF NOT EXISTS employees (
    id               INTEGER PRIMARY KEY,
    vendor_qbo_id    TEXT,
    employee_qbo_id  TEXT,                -- <-- add this line
    name             TEXT NOT NULL,
    nickname         TEXT,
    name_on_checks   TEXT,
    rate             REAL,
    active           INTEGER NOT NULL DEFAULT 1,
    pin              TEXT,
    require_photo    INTEGER NOT NULL DEFAULT 0,
    is_admin         INTEGER NOT NULL DEFAULT 0,
    uses_timekeeping INTEGER NOT NULL DEFAULT 1,
    email            TEXT,
    language         TEXT DEFAULT 'en',
    kiosk_can_view_shipments INTEGER NOT NULL DEFAULT 0  -- 👈 NEW
  )
`);

  db.run(
    `ALTER TABLE employees ADD COLUMN kiosk_can_view_shipments INTEGER NOT NULL DEFAULT 0`,
    err => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error(
          'Error adding kiosk_can_view_shipments column:',
          err.message
        );
      }
    }
  );


  // For existing databases that were created before employee_qbo_id existed:
  db.run(
    `ALTER TABLE employees ADD COLUMN employee_qbo_id TEXT`,
    err => {
      // Ignore "duplicate column name" for databases created with the new schema
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error('Error adding employee_qbo_id column:', err.message);
      }
    }
  );

  db.run(
    `ALTER TABLE projects ADD COLUMN project_timezone TEXT`,
    err => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error('Error adding project_timezone column:', err.message);
      }
    }
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    )`,
    err => {
      if (err) {
        console.error('Error ensuring app_settings table:', err.message);
      }
    }
  );

    // For existing databases that were created before employee_qbo_id existed:
  db.run(
    `ALTER TABLE employees ADD COLUMN employee_qbo_id TEXT`,
    err => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error('Error adding employee_qbo_id column:', err.message);
      }
    }
  );

  // For existing databases that were created before email existed:
  db.run(
    `ALTER TABLE employees ADD COLUMN email TEXT`,
    err => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error('Error adding employees.email column:', err.message);
      }
    }
  );

  db.run(
    `ALTER TABLE employees ADD COLUMN language TEXT DEFAULT 'en'`,
    err => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error('Error adding employees.language column:', err.message);
      }
    }
  );


  // Simple admin users for login
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      employee_id   INTEGER,
      created_at    TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(
    `ALTER TABLE users ADD COLUMN employee_id INTEGER`,
    err => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error('Error adding users.employee_id column:', err.message);
      }
    }
  );



  /* ───────── 2. TIMEKEEPING: KIOSKS, PUNCHES, TIME ENTRIES ───────── */

  // Kiosks (physical devices / locations for the jobsite kiosk)
  db.run(`
    CREATE TABLE IF NOT EXISTS kiosks (
      id            INTEGER PRIMARY KEY,
      name          TEXT NOT NULL,
      location      TEXT,
      device_id     TEXT UNIQUE,           -- ID for the physical device/browser
      device_secret TEXT,                  -- per-kiosk shared secret for offline auth
      project_id    INTEGER,               -- default project for this kiosk (optional)
      require_photo INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  // Add device_secret to existing kiosks tables
  db.run(
    `ALTER TABLE kiosks ADD COLUMN device_secret TEXT`,
    err => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error('Error adding kiosks.device_secret column:', err.message);
      }
    }
  );

  // Per-device project sessions (so admins can swap projects mid-day without clocking everyone out)
  db.run(`
    CREATE TABLE IF NOT EXISTS kiosk_sessions (
      id          INTEGER PRIMARY KEY,
      kiosk_id    INTEGER NOT NULL,
      device_id   TEXT,
      project_id  INTEGER NOT NULL,
      date        TEXT NOT NULL,              -- 'YYYY-MM-DD'
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (kiosk_id)   REFERENCES kiosks(id),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  // Per-employee clock in/out punches (source of truth for kiosk)
    db.run(`
    CREATE TABLE IF NOT EXISTS time_punches (
      id                    INTEGER PRIMARY KEY,
      client_id             TEXT UNIQUE,          -- offline queue id from kiosk
      employee_id           INTEGER NOT NULL,
      project_id            INTEGER,
      clock_in_ts           TEXT NOT NULL,       -- ISO timestamp
      clock_out_ts          TEXT,                -- ISO timestamp
      clock_out_project_id  INTEGER,             -- project selected at clock-out (may differ)
      clock_in_lat          REAL,
      clock_in_lng          REAL,
      clock_out_lat         REAL,
      clock_out_lng         REAL,
      clock_in_photo        TEXT,                -- base64 image if captured
      device_id             TEXT,                -- kiosk/device id
      foreman_employee_id   INTEGER,             -- foreman at time of clock-in
      created_at            TEXT DEFAULT (datetime('now')),

      -- Geofence info at clock-in
      geo_distance_m        REAL,                -- meters from project center
      geo_violation         INTEGER NOT NULL DEFAULT 0,  -- 1 = outside radius

      -- Auto clock-out metadata
      auto_clock_out        INTEGER NOT NULL DEFAULT 0,  -- 1 = server/app auto-closed it
      auto_clock_out_reason TEXT,                        -- 'max_shift', 'idle_timeout', etc.

      -- Exception resolution (punch-level)
      exception_resolved    INTEGER NOT NULL DEFAULT 0,
      exception_resolved_at TEXT,
      exception_resolved_by TEXT,    -- later could be an employee_id
      exception_review_status TEXT DEFAULT 'open', -- approved | modified | rejected | open
      exception_review_note   TEXT,
      exception_reviewed_by   TEXT,
      exception_reviewed_at   TEXT,

      FOREIGN KEY (employee_id)         REFERENCES employees(id),
      FOREIGN KEY (project_id)          REFERENCES projects(id),
      FOREIGN KEY (foreman_employee_id) REFERENCES employees(id)
    )
  `);

// Link punches to their flattened time entry (for reports/exceptions)
db.run(
  `ALTER TABLE time_punches ADD COLUMN time_entry_id INTEGER`,
  err => {
    if (err && !/duplicate column name/i.test(err.message)) {
      console.error('Error adding time_punches.time_entry_id column:', err.message);
    }
  }
);



    // For existing databases that were created before geo_* columns existed:
  db.run(
    `ALTER TABLE time_punches ADD COLUMN geo_distance_m REAL`,
    err => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error('Error adding time_punches.geo_distance_m column:', err.message);
      }
    }
  );

  db.run(
    `ALTER TABLE time_punches ADD COLUMN geo_violation INTEGER NOT NULL DEFAULT 0`,
    err => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error('Error adding time_punches.geo_violation column:', err.message);
      }
    }
  );

  // Track project chosen at clock-out (if different from clock-in)
  db.run(
    `ALTER TABLE time_punches ADD COLUMN clock_out_project_id INTEGER`,
    err => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error('Error adding time_punches.clock_out_project_id column:', err.message);
      }
    }
  );

  db.run(
    `ALTER TABLE time_punches ADD COLUMN exception_review_status TEXT DEFAULT 'open'`,
    err => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error('Error adding time_punches.exception_review_status column:', err.message);
      }
    }
  );

  db.run(
    `ALTER TABLE time_punches ADD COLUMN exception_review_note TEXT`,
    err => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error('Error adding time_punches.exception_review_note column:', err.message);
      }
    }
  );

  db.run(
    `ALTER TABLE time_punches ADD COLUMN exception_reviewed_by TEXT`,
    err => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error('Error adding time_punches.exception_reviewed_by column:', err.message);
      }
    }
  );

  db.run(
    `ALTER TABLE time_punches ADD COLUMN exception_reviewed_at TEXT`,
    err => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error('Error adding time_punches.exception_reviewed_at column:', err.message);
      }
    }
  );


  // One foreman per kiosk per day
  db.run(`
    CREATE TABLE IF NOT EXISTS kiosk_foreman_days (
      id                  INTEGER PRIMARY KEY,
      kiosk_id            INTEGER NOT NULL,
      foreman_employee_id INTEGER,          -- NULL means "none"
      date                TEXT NOT NULL,    -- 'YYYY-MM-DD'
      set_by_employee_id  INTEGER,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (kiosk_id, date),
      FOREIGN KEY (kiosk_id)            REFERENCES kiosks(id),
      FOREIGN KEY (foreman_employee_id) REFERENCES employees(id),
      FOREIGN KEY (set_by_employee_id)  REFERENCES employees(id)
    )
  `);

  // Time entries for pay periods (what payroll works off of)
db.run(`
CREATE TABLE IF NOT EXISTS time_entries (
  id                  INTEGER PRIMARY KEY,
  employee_id         INTEGER,
  project_id          INTEGER,
  start_date          TEXT,  -- 'YYYY-MM-DD'
  end_date            TEXT,  -- 'YYYY-MM-DD'
  start_time          TEXT,  -- 'HH:MM' (optional / manual entries)
  end_time            TEXT,  -- 'HH:MM' (optional / manual entries)
  hours               REAL,
  total_pay           REAL,
  foreman_employee_id INTEGER,
  paid                INTEGER NOT NULL DEFAULT 0,
  paid_date           TEXT,

  -- Entry-level resolution (used by current /api/time-exceptions/:id/resolve)
  resolved            INTEGER NOT NULL DEFAULT 0,
  resolved_at         TEXT,
  resolved_by         TEXT,
  resolved_status     TEXT DEFAULT 'open', -- approved | modified | rejected | open
  resolved_note       TEXT,

  -- Accuracy verification (kiosk admin / foreman)
  verified                INTEGER NOT NULL DEFAULT 0,
  verified_at             TEXT,
  verified_by_employee_id INTEGER,

  FOREIGN KEY (employee_id)              REFERENCES employees(id),
  FOREIGN KEY (project_id)               REFERENCES projects(id),
  FOREIGN KEY (foreman_employee_id)      REFERENCES employees(id),
  FOREIGN KEY (verified_by_employee_id)  REFERENCES employees(id)
)

  `);

  // Enforce that every time_entry carries both dates (defense-in-depth)
  db.run(`
    CREATE TRIGGER IF NOT EXISTS trg_time_entries_require_dates_insert
    BEFORE INSERT ON time_entries
    WHEN NEW.start_date IS NULL OR NEW.start_date = '' OR NEW.end_date IS NULL OR NEW.end_date = ''
    BEGIN
      SELECT RAISE(ABORT, 'time_entries requires start_date and end_date');
    END;
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS trg_time_entries_require_dates_update
    BEFORE UPDATE ON time_entries
    WHEN NEW.start_date IS NULL OR NEW.start_date = '' OR NEW.end_date IS NULL OR NEW.end_date = ''
    BEGIN
      SELECT RAISE(ABORT, 'time_entries requires start_date and end_date');
    END;
  `);

  // Backfill newer resolution columns for time_entries
  db.run(
    `ALTER TABLE time_entries ADD COLUMN resolved_status TEXT DEFAULT 'open'`,
    err => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error('Error adding time_entries.resolved_status column:', err.message);
      }
    }
  );

  db.run(
    `ALTER TABLE time_entries ADD COLUMN resolved_note TEXT`,
    err => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error('Error adding time_entries.resolved_note column:', err.message);
      }
    }
  );

  // Audit log of admin decisions on time exceptions
  db.run(`
    CREATE TABLE IF NOT EXISTS time_exception_actions (
      id                INTEGER PRIMARY KEY,
      source_type       TEXT NOT NULL, -- 'punch' | 'time_entry'
      source_id         INTEGER NOT NULL,
      action            TEXT NOT NULL, -- approve | modify | reject
      actor_user_id     INTEGER,
      actor_employee_id INTEGER,
      actor_name        TEXT,
      note              TEXT,
      changes_json      TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  /* ───────── 3. PAYROLL: RUNS, CHECKS, SETTINGS, AUDIT LOG ───────── */

  // Summary of each payroll run
  db.run(`
    CREATE TABLE IF NOT EXISTS payroll_runs (
      id          INTEGER PRIMARY KEY,
      start_date  TEXT NOT NULL,  -- 'YYYY-MM-DD'
      end_date    TEXT NOT NULL,  -- 'YYYY-MM-DD'
      created_at  TEXT NOT NULL,  -- datetime('now')
      total_hours REAL DEFAULT 0,
      total_pay   REAL DEFAULT 0
    )
  `);

  // Individual checks per employee for a given run
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
      voided_at      TEXT,
      voided_reason  TEXT,
      FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs(id),
      FOREIGN KEY (employee_id)    REFERENCES employees(id)
    )
  `);

  // Backfill newer payroll_checks columns
  db.run(
    `ALTER TABLE payroll_checks ADD COLUMN voided_at TEXT`,
    err => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error('Error adding payroll_checks.voided_at column:', err.message);
      }
    }
  );

  db.run(
    `ALTER TABLE payroll_checks ADD COLUMN voided_reason TEXT`,
    err => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error('Error adding payroll_checks.voided_reason column:', err.message);
      }
    }
  );

  // Payroll audit log (events when creating/retrying checks, etc.)
  db.run(`
    CREATE TABLE IF NOT EXISTS payroll_audit_log (
      id                INTEGER PRIMARY KEY,
      event_type        TEXT NOT NULL,
      payroll_run_id    INTEGER,
      actor_employee_id INTEGER,
      message           TEXT,
      details_json      TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (payroll_run_id)    REFERENCES payroll_runs(id),
      FOREIGN KEY (actor_employee_id) REFERENCES employees(id)
    )
  `);

  // Payroll settings (bank/expense account, default memo, etc.)
  db.run(`
    CREATE TABLE IF NOT EXISTS payroll_settings (
      id                        INTEGER PRIMARY KEY CHECK (id = 1),
      bank_account_name         TEXT,
      expense_account_name      TEXT,
      default_memo              TEXT,
      line_description_template TEXT
    )
  `);

  // Seed default settings row
  db.run(`
    INSERT OR IGNORE INTO payroll_settings (
      id,
      bank_account_name,
      expense_account_name,
      default_memo,
      line_description_template
    ) VALUES (
      1,
      NULL,
      NULL,
      'Payroll {start} – {end}',
      'Labor {hours} hrs – {project}'
    )
  `);

  /* ───────── 4. SHIPMENTS & LOGISTICS ───────── */

  // Main shipments table
    // Main shipments table
  db.run(`
    CREATE TABLE IF NOT EXISTS shipments (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      title               TEXT NOT NULL,
      po_number           TEXT,
      vendor_id           INTEGER,
      vendor_name         TEXT,
      freight_forwarder   TEXT,
      destination         TEXT,
      project_id          INTEGER,
      sku                 TEXT,
      quantity            REAL,
      total_price         REAL,
      price_per_item      REAL,

      expected_ship_date    TEXT,
      expected_arrival_date TEXT,
      tracking_number       TEXT,
      bol_number            TEXT,

      -- STORAGE (after pickup)
      storage_room       TEXT,
      storage_details    TEXT,
      storage_due_date   TEXT,
      storage_daily_late_fee REAL,
      picked_up_by       TEXT,
      picked_up_date     TEXT,
      picked_up_updated_by TEXT,
      picked_up_updated_at TEXT,

      -- SIMPLE PAYMENT FLAGS + AMOUNTS
      vendor_paid         INTEGER NOT NULL DEFAULT 0,
      vendor_paid_amount  REAL,
      shipper_paid        INTEGER NOT NULL DEFAULT 0,
      shipper_paid_amount REAL,
      customs_paid        INTEGER NOT NULL DEFAULT 0,
      customs_paid_amount REAL,
      total_paid          REAL,

      -- ITEM VERIFICATION
      items_verified      INTEGER NOT NULL DEFAULT 0,
      verified_by         TEXT,
      verification_notes  TEXT,

      website_url        TEXT,
      notes              TEXT,

      status             TEXT NOT NULL DEFAULT 'Pre-Order',
      is_archived        INTEGER NOT NULL DEFAULT 0,
      archived_at        TEXT,

      created_by         INTEGER,
      created_at         TEXT DEFAULT (datetime('now')),
      updated_at         TEXT,
      FOREIGN KEY (vendor_id)  REFERENCES vendors(id),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  // Add storage due date + daily fee to existing databases
  db.run(
    `ALTER TABLE shipments ADD COLUMN storage_due_date TEXT`,
    err => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error('Error adding shipments.storage_due_date column:', err.message);
      }
    }
  );

  db.run(
    `ALTER TABLE shipments ADD COLUMN storage_daily_late_fee REAL`,
    err => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error('Error adding shipments.storage_daily_late_fee column:', err.message);
      }
    }
  );

  db.run(
    `ALTER TABLE shipments ADD COLUMN picked_up_updated_by TEXT`,
    err => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error('Error adding shipments.picked_up_updated_by column:', err.message);
      }
    }
  );

  db.run(
    `ALTER TABLE shipments ADD COLUMN picked_up_updated_at TEXT`,
    err => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error('Error adding shipments.picked_up_updated_at column:', err.message);
      }
    }
  );


  // Shipment line items
      // Shipment line items
db.run(`
  CREATE TABLE IF NOT EXISTS shipment_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_id INTEGER NOT NULL,
    description TEXT,
    sku         TEXT,
    quantity    REAL,
    unit_price  REAL,
    line_total  REAL,
    vendor_name TEXT,
    verified    INTEGER NOT NULL DEFAULT 0,
    notes       TEXT,
    verification_json TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (shipment_id) REFERENCES shipments(id)
  )
`);



  // 🔹 New: rich per-item verification JSON (status, verified_by, date, etc.)
  db.run(
    `ALTER TABLE shipment_items ADD COLUMN verification_json TEXT`,
    err => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error('Error adding shipment_items.verification_json column:', err.message);
      }
    }
  );

// New per-item vendor name column (for existing DBs)
db.run(
  `ALTER TABLE shipment_items ADD COLUMN vendor_name TEXT`,
  err => {
    if (err && !/duplicate column name/i.test(err.message)) {
      console.error('Error adding shipment_items.vendor_name column:', err.message);
    }
  }
);


  // Shipment status history
  db.run(`
    CREATE TABLE IF NOT EXISTS shipment_status_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      shipment_id INTEGER NOT NULL,
      old_status  TEXT,
      new_status  TEXT NOT NULL,
      changed_at  TEXT NOT NULL DEFAULT (datetime('now')),
      note        TEXT,
      FOREIGN KEY (shipment_id) REFERENCES shipments(id)
    )
  `);

  // Shipment payments (optional detail breakdown)
  db.run(`
    CREATE TABLE IF NOT EXISTS shipment_payments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      shipment_id    INTEGER NOT NULL,
      type           TEXT,
      amount         REAL NOT NULL,
      currency       TEXT DEFAULT 'USD',
      status         TEXT NOT NULL DEFAULT 'Pending',
      due_date       TEXT,
      paid_date      TEXT,
      invoice_number TEXT,
      notes          TEXT,
      file_path      TEXT,
      created_by     INTEGER,
      created_at     TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (shipment_id) REFERENCES shipments(id)
    )
  `);

  // Shipment timeline of events
  db.run(`
    CREATE TABLE IF NOT EXISTS shipment_timeline (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      shipment_id INTEGER NOT NULL,
      event_type  TEXT NOT NULL,
      old_status  TEXT,
      new_status  TEXT,
      note        TEXT,
      created_by  INTEGER,
      created_at  TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (shipment_id) REFERENCES shipments(id)
    )
  `);

  // Shipment attached documents
  db.run(`
    CREATE TABLE IF NOT EXISTS shipment_documents (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      shipment_id INTEGER NOT NULL,
      title       TEXT NOT NULL,
      category    TEXT,
      doc_type    TEXT,
      doc_label   TEXT,
      file_path   TEXT NOT NULL,
      uploaded_by INTEGER,
      uploaded_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (shipment_id) REFERENCES shipments(id)
    )
  `);

  db.run(
    `ALTER TABLE shipment_documents ADD COLUMN doc_type TEXT`,
    err => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error('Error adding shipment_documents.doc_type column:', err.message);
      }
    }
  );

  db.run(
    `ALTER TABLE shipment_documents ADD COLUMN doc_label TEXT`,
    err => {
      if (err && !/duplicate column name/i.test(err.message)) {
        console.error('Error adding shipment_documents.doc_label column:', err.message);
      }
    }
  );

  // Shipment comments / notes
  db.run(`
    CREATE TABLE IF NOT EXISTS shipment_comments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      shipment_id INTEGER NOT NULL,
      body        TEXT NOT NULL,
      created_by  INTEGER,
      created_at  TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (shipment_id) REFERENCES shipments(id)
    )
  `);

  // Shipment templates (for quickly creating new shipments)
  db.run(`
    CREATE TABLE IF NOT EXISTS shipment_templates (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      title           TEXT,
      vendor_id       INTEGER,
      freight_forwarder TEXT,
      destination     TEXT,
      project_id      INTEGER,
      sku             TEXT,
      quantity        REAL,
      total_price     REAL,
      price_per_item  REAL,
      website_url     TEXT,
      notes           TEXT,
      created_by      INTEGER,
      created_at      TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (vendor_id)  REFERENCES vendors(id),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  // Per-admin shipment notification preferences
  db.run(`
    CREATE TABLE IF NOT EXISTS shipment_notification_prefs (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL UNIQUE,
      employee_id       INTEGER,
      statuses_json     TEXT,
      shipment_ids_json TEXT,
      notify_time       TEXT,
      enabled           INTEGER NOT NULL DEFAULT 1,
      created_at        TEXT DEFAULT (datetime('now')),
      updated_at        TEXT
    )
  `);

  /* ───────── 5. QUICKBOOKS OAUTH TOKENS ───────── */

  db.run(`
    CREATE TABLE IF NOT EXISTS qbo_tokens (
      id            INTEGER PRIMARY KEY,
      access_token  TEXT,
      refresh_token TEXT,
      expires_at    INTEGER
    )
  `);
});



// Export the db so other files can use it
module.exports = db;
