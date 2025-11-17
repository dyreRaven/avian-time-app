// server.js
// Main Express server for the Avian Time & Payroll app

require('dotenv').config();
const express = require('express');
const path = require('path');

const db = require('./db'); // ensure DB initializes

// Import ALL QuickBooks helpers in one place
const {
  getAuthUrl,
  exchangeCodeForTokens,
  getAccessToken,
  syncVendors,
  syncProjects,
  createChecksForPeriod // <-- needed for /api/payroll/create-checks
} = require('./quickbooks');

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
});


const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies
app.use(express.json());

// Serve frontend from /public
app.use(express.static(path.join(__dirname, 'public')));

/* ───────── KIOSK PAGE ───────── */

app.get('/kiosk', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'kiosk.html'));
});


/* ───────── QUICKBOOKS STATUS ───────── */

app.get('/api/status', async (req, res) => {
  try {
    const token = await getAccessToken();
    const qbConnected = !!token;
    res.json({ qbConnected });
  } catch (err) {
    console.error('Status error:', err.message);
    res.json({ qbConnected: false });
  }
});

/* ───────── AUTH: Start QuickBooks OAuth ───────── */

app.get('/auth/qbo', (req, res) => {
  const url = getAuthUrl();
  res.redirect(url);
});

/* ───────── AUTH: QuickBooks callback ───────── */

// AUTH: QuickBooks callback (PRODUCTION)
app.get('/quickbooks/oauth/callback', async (req, res) => {
  const { code, realmId } = req.query;

  if (!code) {
    return res.status(400).send('Missing ?code= in callback URL.');
  }

  if (realmId) {
    console.log('QuickBooks realmId:', realmId);
    // Copy this value into QBO_REALM_ID in your .env file after first connect
  }

  try {
    await exchangeCodeForTokens(code);

    res.send(`
      <h2>QuickBooks connected ✅</h2>
      <p>You can close this window and go back to the app.</p>
    `);
  } catch (err) {
    console.error('Callback error:', err.message);
    res.status(500).send('Error connecting to QuickBooks.');
  }
});


/* ───────── SYNC ENDPOINTS (vendors & projects) ───────── */

// Sync vendors from QuickBooks → SQLite
app.post('/api/sync/vendors', async (req, res) => {
  try {
    const count = await syncVendors();
    res.json({ ok: true, message: `Synced ${count} vendor(s).` });
  } catch (err) {
    console.error('Sync vendors error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Sync customers/projects from QuickBooks → SQLite
app.post('/api/sync/projects', async (req, res) => {
  try {
    const count = await syncProjects();
    res.json({ ok: true, message: `Synced ${count} project(s).` });
  } catch (err) {
    console.error('Sync projects error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ───────── EMPLOYEES & VENDORS ENDPOINTS ───────── */

// Get all vendors (synced from QuickBooks)
app.get('/api/vendors', (req, res) => {
  db.all('SELECT * FROM vendors ORDER BY name', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Get employees (with active/inactive filter)
app.get('/api/employees', (req, res) => {
  const status = req.query.status || 'active'; // 'active' | 'inactive' | 'all'

  let where = '';
  if (status === 'active') {
    where = 'WHERE IFNULL(active, 1) = 1';
  } else if (status === 'inactive') {
    where = 'WHERE IFNULL(active, 1) = 0';
  } else {
    where = ''; // all
  }

  const sql = `
    SELECT
      id,
      vendor_qbo_id,
      name,
      nickname,
      name_on_checks,
      rate,
      pin,
      require_photo,
      IFNULL(active, 1) AS active
    FROM employees
    ${where}
    ORDER BY name
  `;


  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// Add or update an employee (core fields only; active handled separately)
app.post('/api/employees', (req, res) => {
  const {
    id,
    vendor_qbo_id,
    name,
    nickname,
    name_on_checks,
    rate
  } = req.body;

  if (!name || rate == null) {
    return res.status(400).json({ error: 'Name and rate are required.' });
  }

  if (id) {
    // UPDATE existing employee
    db.run(
      `UPDATE employees
       SET vendor_qbo_id = ?,
           name = ?,
           nickname = ?,
           name_on_checks = ?,
           rate = ?
       WHERE id = ?`,
      [
        vendor_qbo_id || null,
        name,
        nickname || null,
        name_on_checks || null,
        rate,
        id
      ],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Employee not found.' });
        }
        res.json({ ok: true });
      }
    );
  } else {
    // INSERT new employee (active defaults to 1 in schema)
    db.run(
      `INSERT INTO employees
       (vendor_qbo_id, name, nickname, name_on_checks, rate)
       VALUES (?, ?, ?, ?, ?)`,
      [
        vendor_qbo_id || null,
        name,
        nickname || null,
        name_on_checks || null,
        rate
      ],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ ok: true, id: this.lastID });
      }
    );
  }
});

// Toggle employee active/inactive
app.post('/api/employees/:id/active', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const active = req.body.active ? 1 : 0;

  if (!id) {
    return res.status(400).json({ error: 'Invalid employee id.' });
  }

  db.run(
    'UPDATE employees SET active = ? WHERE id = ?',
    [active, id],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Employee not found.' });
      }
      res.json({ ok: true, active });
    }
  );
});

// Set or update an employee's PIN and photo requirement.
// This will be used by both the admin UI and the kiosk (via foreman mode later).
// Body:
//   { pin: "1234" | null, allowOverride?: boolean, require_photo?: boolean }
app.post('/api/employees/:id/pin', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ error: 'Invalid employee id.' });
  }

  const { pin, allowOverride, require_photo } = req.body || {};

  // Build the SET clause dynamically so we can optionally include require_photo
  const setParts = [];
  const params = [];

  // PIN logic:
  // - If allowOverride is true, we always set pin (can be null to clear).
  // - If allowOverride is false/omitted, we only set pin if it is currently NULL.
  let whereExtra = '';
  setParts.push('pin = ?');
  params.push(pin || null);
  if (!allowOverride) {
    // Don't overwrite an existing PIN unless explicitly allowed
    whereExtra = ' AND pin IS NULL';
  }

  // Optional require_photo toggle
  if (typeof require_photo === 'boolean') {
    setParts.push('require_photo = ?');
    params.push(require_photo ? 1 : 0);
  }

  if (setParts.length === 0) {
    return res.status(400).json({ error: 'Nothing to update.' });
  }

  const sql = `
    UPDATE employees
    SET ${setParts.join(', ')}
    WHERE id = ?${whereExtra}
  `;
  params.push(id);

  db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ error: err.message });

    if (this.changes === 0) {
      return res.status(409).json({
        error: 'PIN already set for this employee. Use allowOverride to change it.'
      });
    }

    res.json({ ok: true });
  });
});


/* ───────── PROJECTS & TIME ENTRIES ENDPOINTS ───────── */

/* ───────── KIOSK CLOCK-IN/CLOCK-OUT ENDPOINT ───────── */
/**
 * This endpoint is designed for the iPad kiosk.
 *
 * It expects:
 *  - client_id:   unique ID from the device (UUID string) for offline sync de-dupe
 *  - employee_id: which employee is clocking in/out
 *  - project_id:  optional, which project they are working on
 *  - lat, lng:    optional GPS coordinates
 *  - device_timestamp: ISO string when the tap happened on the device
 *
 * Behavior:
 *  - If no open punch for that employee → CLOCK IN (insert new row in time_punches)
 *  - If there is an open punch → CLOCK OUT (update time_punches, create time_entries row)
 *  - If a punch with the same client_id already exists → idempotent "alreadyProcessed" response
 */
app.post('/api/kiosk/punch', (req, res) => {
  const {
    client_id,
    employee_id,
    project_id,
    lat,
    lng,
    device_timestamp,
    photo_base64  
  } = req.body || {};

  if (!client_id || !employee_id) {
    return res
      .status(400)
      .json({ error: 'client_id and employee_id are required.' });
  }

  const punchTime = device_timestamp || new Date().toISOString();

  // 1) Check if this client_id was already processed (offline re-sync safety)
  db.get(
    'SELECT * FROM time_punches WHERE client_id = ?',
    [client_id],
    (err, existing) => {
      if (err) return res.status(500).json({ error: err.message });

      if (existing) {
        // Idempotent behavior: we already handled this punch
        const mode = existing.clock_out_ts ? 'clock_out' : 'clock_in';
        return res.json({
          ok: true,
          alreadyProcessed: true,
          mode
        });
      }

      // 2) Look for an open punch for this employee (no clock_out_ts yet)
      const openSql = `
        SELECT *
        FROM time_punches
        WHERE employee_id = ?
          AND clock_out_ts IS NULL
        ORDER BY clock_in_ts DESC
        LIMIT 1
      `;

      db.get(openSql, [employee_id], (err2, open) => {
        if (err2) return res.status(500).json({ error: err2.message });

        // ───── CASE A: CLOCK IN ─────
        if (!open) {
          const insertSql = `
          INSERT INTO time_punches
            (client_id, employee_id, project_id,
            clock_in_ts, clock_in_lat, clock_in_lng,
            clock_in_photo)
          VALUES (?, ?, ?, ?, ?, ?, ?)

          `;
          db.run(
            insertSql,
            [
              client_id,
              employee_id,
              project_id || null,
              punchTime,
              lat || null,
              lng || null,
              photo_base64 || null
            ],
            function (err3) {
              if (err3) {
                // In case of a late-arriving duplicate client_id
                if (
                  err3.message &&
                  err3.message.includes(
                    'UNIQUE constraint failed: time_punches.client_id'
                  )
                ) {
                  return res.json({
                    ok: true,
                    mode: 'clock_in',
                    alreadyProcessed: true
                  });
                }
                return res.status(500).json({ error: err3.message });
              }

              return res.json({
                ok: true,
                mode: 'clock_in',
                punch_id: this.lastID
              });
            }
          );
          return;
        }

        // ───── CASE B: CLOCK OUT ─────
        const updateSql = `
          UPDATE time_punches
          SET clock_out_ts = ?,
              clock_out_lat = ?,
              clock_out_lng = ?
          WHERE id = ?
        `;

        db.run(
          updateSql,
          [punchTime, lat || null, lng || null, open.id],
          err3 => {
            if (err3) return res.status(500).json({ error: err3.message });

            // Compute hours from clock_in_ts → punchTime
            const start = new Date(open.clock_in_ts);
            const end = new Date(punchTime);
            let hours = (end - start) / 1000 / 60 / 60;

            if (!isFinite(hours) || hours < 0) {
              hours = 0;
            }

            const startDate = open.clock_in_ts.slice(0, 10); // "YYYY-MM-DD"
            const endDate = punchTime.slice(0, 10);

            // Look up employee rate to compute total_pay (same pattern as /api/time-entries)
            db.get(
              'SELECT rate FROM employees WHERE id = ?',
              [employee_id],
              (err4, row) => {
                if (err4) {
                  console.error('Rate lookup error in kiosk punch:', err4);
                  return res.json({
                    ok: true,
                    mode: 'clock_out',
                    hours,
                    warning:
                      'Clocked out, but failed to compute pay (rate lookup error).'
                  });
                }
                if (!row) {
                  return res.status(400).json({
                    error: 'Invalid employee_id.'
                  });
                }

                const rate = parseFloat(row.rate || 0);
                const total_pay = rate * hours;

                const timeEntrySql = `
                  INSERT INTO time_entries
                    (employee_id, project_id, start_date, end_date, hours, total_pay)
                  VALUES (?, ?, ?, ?, ?, ?)
                `;

                const finalProjectId =
                  open.project_id || project_id || null;

                db.run(
                  timeEntrySql,
                  [
                    employee_id,
                    finalProjectId,
                    startDate,
                    endDate,
                    hours,
                    total_pay
                  ],
                  function (err5) {
                    if (err5) {
                      console.error(
                        'Failed to insert time_entry from kiosk punch:',
                        err5
                      );
                      return res.json({
                        ok: true,
                        mode: 'clock_out',
                        hours,
                        total_pay,
                        warning:
                          'Clocked out, but failed to create time entry in DB.'
                      });
                    }

                    return res.json({
                      ok: true,
                      mode: 'clock_out',
                      hours,
                      total_pay,
                      time_entry_id: this.lastID
                    });
                  }
                );
              }
            );
          }
        );
      });
    }
  );
});

// Get all currently open punches (no clock_out_ts yet).
// Used for admin "who is clocked in" live view.
app.get('/api/time-punches/open', (req, res) => {
  const sql = `
    SELECT
      tp.id,
      tp.employee_id,
      e.name AS employee_name,
      tp.project_id,
      p.name AS project_name,
      p.customer_name,
      tp.clock_in_ts
    FROM time_punches tp
    JOIN employees e ON tp.employee_id = e.id
    LEFT JOIN projects p ON tp.project_id = p.id
    WHERE tp.clock_out_ts IS NULL
    ORDER BY tp.clock_in_ts ASC
  `;

  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});


// Check if a single employee has an open punch.
// Used by the kiosk to decide whether to show "Clock In" or "Clock Out".
app.get('/api/kiosk/open-punch', (req, res) => {
  const employeeId = parseInt(req.query.employee_id, 10);
  if (!employeeId) {
    return res.status(400).json({ error: 'employee_id is required.' });
  }

  const sql = `
    SELECT
      tp.id,
      tp.employee_id,
      tp.project_id,
      tp.clock_in_ts,
      p.name AS project_name,
      p.customer_name
    FROM time_punches tp
    LEFT JOIN projects p ON tp.project_id = p.id
    WHERE tp.employee_id = ?
      AND tp.clock_out_ts IS NULL
    ORDER BY tp.clock_in_ts DESC
    LIMIT 1
  `;

  db.get(sql, [employeeId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });

    if (!row) {
      return res.json({ open: false });
    }

    res.json({
      open: true,
      punch_id: row.id,
      employee_id: row.employee_id,
      project_id: row.project_id,
      project_name: row.project_name,
      customer_name: row.customer_name,
      clock_in_ts: row.clock_in_ts
    });
  });
});



// Get all projects (synced from QuickBooks)
app.get('/api/projects', (req, res) => {
  db.all(
    'SELECT * FROM projects ORDER BY customer_name, name',
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Get time entries (optionally filtered by date range)
app.get('/api/time-entries', (req, res) => {
  const { start, end } = req.query;

  let where = '';
  const params = [];

  if (start && end) {
    where = 'WHERE t.start_date >= ? AND t.end_date <= ?';
    params.push(start, end);
  }

  const sql = `
    SELECT
      t.id,
      t.start_date,
      t.end_date,
      t.hours,
      t.total_pay,
      e.name AS employee_name,
      p.name AS project_name
    FROM time_entries t
    LEFT JOIN employees e ON t.employee_id = e.id
    LEFT JOIN projects p ON t.project_id = p.id
    ${where}
    ORDER BY t.start_date DESC, t.id DESC
    LIMIT 200
  `;

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Add a new time entry
app.post('/api/time-entries', (req, res) => {
  const { employee_id, project_id, start_date, end_date, hours } = req.body;

  if (!employee_id || !project_id || !start_date || !end_date || hours == null) {
    return res.status(400).json({
      error:
        'employee_id, project_id, start_date, end_date, and hours are required.'
    });
  }

  const parsedHours = parseFloat(hours);
  if (isNaN(parsedHours)) {
    return res.status(400).json({ error: 'Hours must be a number.' });
  }

  // Look up the employee's rate to compute total_pay
  db.get(
    'SELECT rate FROM employees WHERE id = ?',
    [employee_id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) {
        return res.status(400).json({ error: 'Invalid employee_id.' });
      }

      const rate = parseFloat(row.rate || 0);
      const total_pay = rate * parsedHours;

      db.run(
        `
        INSERT INTO time_entries
          (employee_id, project_id, start_date, end_date, hours, total_pay)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [employee_id, project_id, start_date, end_date, parsedHours, total_pay],
        function (err2) {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ ok: true, id: this.lastID, total_pay });
        }
      );
    }
  );
});

/* ───────── PAYROLL SUMMARY ENDPOINT ───────── */

// Summarize total hours and pay per employee in a date range
app.get('/api/payroll-summary', (req, res) => {
  const { start, end } = req.query;

  if (!start || !end) {
    return res
      .status(400)
      .json({ error: 'start and end query parameters are required.' });
  }

   const sql = `
    SELECT
      e.id AS employee_id,
      e.name AS employee_name,
      p.id AS project_id,
      COALESCE(p.name, '(No project)') AS project_name,
      SUM(t.hours) AS project_hours,
      SUM(t.total_pay) AS project_pay
    FROM time_entries t
    JOIN employees e ON t.employee_id = e.id
    LEFT JOIN projects p ON t.project_id = p.id
    WHERE t.start_date >= ? AND t.end_date <= ?
    GROUP BY e.id, e.name, p.id, p.name
    ORDER BY e.name, project_name
  `;

  db.all(sql, [start, end], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

/* ───────── PAYROLL → CREATE CHECKS IN QUICKBOOKS ───────── */

app.post('/api/payroll/create-checks', async (req, res) => {
  const { start, end } = req.body || {};

  if (!start || !end) {
    return res
      .status(400)
      .json({ error: 'start and end are required in the request body.' });
  }

  try {
    const result = await createChecksForPeriod(start, end);
    // result will contain either:
    // - ok: true, results: [...]
    // - ok: false, reason: 'Not connected', drafts: [...]
    res.json(result);
  } catch (err) {
    console.error('Create checks error:', err);
    res
      .status(500)
      .json({ error: err.message || 'Failed to create checks.' });
  }
});

/* ───────── REPORTS: PAYROLL RUNS & CHECKS ───────── */

// List all payroll runs (for Reports main table)
app.get('/api/reports/payroll-runs', (req, res) => {
  const sql = `
    SELECT
      pr.id,
      pr.start_date,
      pr.end_date,
      pr.created_at,
      pr.total_hours,
      pr.total_pay,
      COUNT(pc.id) AS check_count,
      SUM(CASE WHEN pc.paid = 1 THEN 1 ELSE 0 END) AS paid_checks
    FROM payroll_runs pr
    LEFT JOIN payroll_checks pc ON pc.payroll_run_id = pr.id
    GROUP BY pr.id
    ORDER BY pr.created_at DESC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// Get details for a single run (checks per employee)
app.get('/api/reports/payroll-runs/:id', (req, res) => {
  const runId = parseInt(req.params.id, 10);
  if (Number.isNaN(runId)) {
    return res.status(400).json({ error: 'Invalid payroll run id.' });
  }

  const sql = `
    SELECT
      pc.id,
      e.name AS employee_name,
      pc.total_hours,
      pc.total_pay,
      pc.check_number,
      pc.paid
    FROM payroll_checks pc
    JOIN employees e ON pc.employee_id = e.id
    WHERE pc.payroll_run_id = ?
    ORDER BY e.name
  `;
  db.all(sql, [runId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// Update check number / paid status for a single check row
app.patch('/api/reports/checks/:id', (req, res) => {
  const checkId = parseInt(req.params.id, 10);
  if (Number.isNaN(checkId)) {
    return res.status(400).json({ error: 'Invalid check id.' });
  }

  const { check_number, paid } = req.body || {};
  const updates = [];
  const params = [];

  if (check_number !== undefined) {
    updates.push('check_number = ?');
    params.push(check_number);
  }

  if (typeof paid === 'boolean') {
    updates.push('paid = ?');
    params.push(paid ? 1 : 0);
  }

  if (!updates.length) {
    return res.status(400).json({ error: 'No fields to update.' });
  }

  const sql = `UPDATE payroll_checks SET ${updates.join(', ')} WHERE id = ?`;
  params.push(checkId);

  db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  });
});


/* ───────── START SERVER ───────── */

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
