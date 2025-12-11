// server.js
// Main Express server for the Avian Time & Payroll app


/* ───────── 1. CORE SETUP (config, imports, globals) ───────── */

require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');

const db = require('./db'); // ensure DB initializes
const PDFDocument = require('pdfkit'); // PDF export for time-entries

const fs = require('fs');
const fsp = require('fs').promises;

const dbPath = path.join(__dirname, 'avian-time.db');
const backupDir = path.join(__dirname, 'backups');
const multer = require('multer');
const session = require('express-session');
const bcrypt  = require('bcrypt');
const createSQLiteStore = require('./session-store');
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/Puerto_Rico';

// Global in-memory lock to prevent concurrent payroll runs
let isPayrollRunInProgress = false;

// Helper: log time entry actions to time_exception_actions for auditing
async function logTimeEntryAudit({
  entryId,
  action,
  before = null,
  after = null,
  note = null,
  req
}) {
  try {
    const actorUserId = req?.session?.user?.id || null;
    const actorEmployeeId = req?.session?.user?.employee_id || null;
    const actorName = req?.session?.user?.email || req?.session?.user?.name || 'unknown';
    await dbRun(
      `
        INSERT INTO time_exception_actions
          (source_type, source_id, action, actor_user_id, actor_employee_id, actor_name, note, changes_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        'time_entry',
        entryId,
        action,
        actorUserId,
        actorEmployeeId,
        actorName,
        note || null,
        JSON.stringify({ before, after })
      ]
    );
  } catch (err) {
    console.error('Failed to write time entry audit log:', err);
  }
}

// ───────── SHIPMENT DOCUMENT UPLOADS ─────────

const uploadsRoot = path.join(__dirname, 'public', 'uploads', 'shipments');
fs.mkdirSync(uploadsRoot, { recursive: true });

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadsRoot);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${base}-${unique}${ext}`);
  }
});

const upload = multer({ storage });




/* ───────── DB PROMISE HELPERS (CANDIDATE: ./db-helpers.js) ───────── */

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this); // exposes lastID, changes, etc.
    });
  });
}

// Central access-control defaults for admins (settings.access_admins)
const ACCESS_DEFAULTS = {
  see_shipments: true,
  modify_time: true,
  view_time_reports: true,
  view_payroll: true,
  modify_pay_rates: false
};

async function loadAccessAdminMap() {
  const row = await dbGet(
    'SELECT value FROM app_settings WHERE key = ?',
    ['access_admins']
  );
  if (!row || !row.value) return {};
  try {
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.warn('Failed to parse access_admins setting:', err.message);
    return {};
  }
}

async function getAdminAccessPerms(adminId) {
  const map = await loadAccessAdminMap();
  const raw = adminId ? map[adminId] || map[String(adminId)] : null;
  if (!raw) return { ...ACCESS_DEFAULTS };

  return {
    ...ACCESS_DEFAULTS,
    see_shipments: raw.see_shipments === true || raw.see_shipments === 'true',
    modify_time: raw.modify_time === true || raw.modify_time === 'true',
    view_time_reports: raw.view_time_reports === true || raw.view_time_reports === 'true',
    view_payroll: raw.view_payroll === true || raw.view_payroll === 'true',
    modify_pay_rates: raw.modify_pay_rates === true || raw.modify_pay_rates === 'true'
  };
}

// Load toggleable time exception rules from app_settings
async function loadExceptionRulesMap() {
  try {
    const row = await dbGet(
      'SELECT value FROM app_settings WHERE key = ?',
      ['time_exception_rules']
    );
    if (!row || !row.value) return null;
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    console.warn('Failed to load exception rules map:', err.message);
    return null;
  }
}

function makeRuleChecker(rulesMap) {
  return key => {
    if (!rulesMap || typeof rulesMap !== 'object') return true;
    const val = rulesMap[key];
    return !(
      val === false ||
      val === 'false' ||
      val === 0 ||
      val === '0'
    );
  };
}


/* ───────── UTIL HELPERS (CANDIDATE: ./util.js) ───────── */

// Haversine distance in meters
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000; // meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// YYYY-MM-DD → Date at midnight (or null on bad input)
function toDateOnly(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

// Today's date in 'YYYY-MM-DD'
function getTodayIsoDate() {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: APP_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = fmt.formatToParts(new Date());
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const d = parts.find(p => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch (err) {
    console.warn('Falling back to UTC date in getTodayIsoDate:', err.message || err);
  }
  return new Date().toISOString().slice(0, 10);
}

/* ───────── BACKUP HELPER (CANDIDATE: ./backup.js) ───────── */

async function performDatabaseBackup() {
  try {
    await fsp.mkdir(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `avian-time-${timestamp}.db`;
    const backupPath = path.join(backupDir, backupName);

    await fsp.copyFile(dbPath, backupPath);
    console.log(`📦 Database backup created: ${backupName}`);

    // Keep only last 30 backups
    const files = await fsp.readdir(backupDir);
    const dbBackups = files
      .filter(f => f.startsWith('avian-time-'))
      .sort(
        (a, b) =>
          fs.statSync(path.join(backupDir, b)).mtime -
          fs.statSync(path.join(backupDir, a)).mtime
      );

    const MAX_BACKUPS = 30;
    if (dbBackups.length > MAX_BACKUPS) {
      const toDelete = dbBackups.slice(MAX_BACKUPS);
      for (const file of toDelete) {
        await fsp.unlink(path.join(backupDir, file));
        console.log(`🗑 Deleted old backup: ${file}`);
      }
    }
  } catch (err) {
    console.error('Backup error:', err);
  }
}


/* ───────── PAYROLL HELPERS (CANDIDATE: ./payroll-helpers.js) ───────── */

async function validatePayrollRangeServer(start, end) {
  const startDate = toDateOnly(start);
  const endDate   = toDateOnly(end);

  if (!startDate || !endDate) {
    throw new Error('Both start and end dates are required and must be valid YYYY-MM-DD values.');
  }

  if (endDate < startDate) {
    throw new Error('End date must be on or after the start date.');
  }

  const MAX_PAYROLL_DAYS = 31;
  const diffMs = endDate - startDate;
  const diffDays = diffMs / (1000 * 60 * 60 * 24) + 1;

  if (diffDays > MAX_PAYROLL_DAYS) {
    throw new Error(
      `Payroll period is ${Math.round(diffDays)} days, which exceeds the allowed maximum of ${MAX_PAYROLL_DAYS} days.`
    );
  }
  // Previously we blocked exact/overlapping runs; now allowed for reruns. Caller may log overlaps if needed.
}

/* ───────── PAYROLL AUDIT LOG HELPER ───────── */

async function logPayrollEvent({
  event_type,
  payroll_run_id = null,
  actor_employee_id = null,
  message = '',
  details = null
}) {
  const detailsJson = details ? JSON.stringify(details) : null;

  await dbRun(
    `
      INSERT INTO payroll_audit_log (
        event_type,
        payroll_run_id,
        actor_employee_id,
        message,
        details_json
      ) VALUES (?, ?, ?, ?, ?)
    `,
    [event_type, payroll_run_id, actor_employee_id, message, detailsJson]
  );
}

/* ───────── QUICKBOOKS HELPERS ───────── */

const {
  getAuthUrl,
  exchangeCodeForTokens,
  getAccessToken,
  syncVendors,
  syncProjects,
  createChecksForPeriod,
  syncEmployeesFromQuickBooks,
  listPayrollAccounts,
  listClasses,
  setPrintOnCheckName,
  ensureNameOnChecksColumns
} = require('./quickbooks');



/* ───────── KIOSK HELPERS ───────── */

function getTodayForemanForDevice(deviceId, employeeIdOrCb, maybeCb) {
  let employeeId;
  let cb;

  // Backwards-compatible:
  // - old calls: getTodayForemanForDevice(deviceId, cb)
  // - new calls: getTodayForemanForDevice(deviceId, employeeId, cb)
  if (typeof employeeIdOrCb === 'function') {
    cb = employeeIdOrCb;
    employeeId = null;
  } else {
    employeeId = employeeIdOrCb;
    cb = maybeCb;
  }

  if (!deviceId) {
    return cb(null, null); // no device context → no foreman
  }

  const today = getTodayIsoDate();

  const sql = `
    SELECT
      k.id AS kiosk_id,
      kf.foreman_employee_id
    FROM kiosks k
    LEFT JOIN kiosk_foreman_days kf
      ON kf.kiosk_id = k.id
     AND kf.date = ?
    WHERE k.device_id = ?
    LIMIT 1
  `;

  db.get(sql, [today, deviceId], (err, row) => {
    if (err) return cb(err);

    // If we already have a foreman for today, just return it.
    if (row && row.foreman_employee_id) {
      return cb(null, row.foreman_employee_id);
    }

    // No kiosk row or no employee provided to auto-set a foreman → nothing to do.
    if (!row || !row.kiosk_id || !employeeId) {
      return cb(null, null);
    }

    // No foreman yet for this kiosk/date: make THIS employee today's foreman.
    const insertSql = `
      INSERT INTO kiosk_foreman_days
        (kiosk_id, foreman_employee_id, date, set_by_employee_id)
      VALUES (?, ?, ?, ?)
    `;

    db.run(
      insertSql,
      [row.kiosk_id, employeeId, today, employeeId],
      function (err2) {
        if (err2) {
          const msg = String(err2.message || '');
          if (msg.includes('UNIQUE constraint failed')) {
            // Another request created the row at the same time.
            // Just re-read whatever is now stored.
            db.get(
              `SELECT foreman_employee_id
               FROM kiosk_foreman_days
               WHERE kiosk_id = ? AND date = ?`,
              [row.kiosk_id, today],
              (err3, row2) => {
                if (err3) return cb(err3);
                return cb(null, row2 ? row2.foreman_employee_id : null);
              }
            );
          } else {
            return cb(err2);
          }
        } else {
          // We successfully set this employee as foreman
          return cb(null, employeeId);
        }
      }
    );
  });
}

/* ───────── 2. EXPRESS APP & GLOBAL MIDDLEWARE ───────── */

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Session middleware for login state
const sessionStore = createSQLiteStore(session, { dbPath });

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // Honor explicit env toggle; default to false so local HTTP works
      secure: process.env.COOKIE_SECURE === 'true'
    }
  })
);

// Simple helper to require login (you can use on APIs later if you want)
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// Landing route: show login/register page if NOT logged in,
// otherwise show the main admin console (index.html).
app.get('/', (req, res) => {
  const file = req.session && req.session.userId
    ? 'index.html'
    : 'auth.html'; // new page we’ll create

  res.sendFile(path.join(__dirname, 'public', file));
});

// Static assets (CSS, JS, etc.)
app.use(express.static(path.join(__dirname, 'public')));

/* ───────── KIOSK PAGE ───────── */

app.get('/kiosk', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'kiosk.html'));
});

/* ───────── AUTH: REGISTER & LOGIN ───────── */


// Helper to normalize emails
function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

/* ───────── AUTH: REGISTER (must match a QuickBooks employee) ───────── */

app.post('/api/auth/register', (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const normEmail = normalizeEmail(email);

  db.serialize(() => {
    // 1) Check if user already exists
    db.get(
      'SELECT id FROM users WHERE LOWER(email) = LOWER(?)',
      [normEmail],
      (err, existing) => {
        if (err) {
          console.error('Register: error checking existing user:', err);
          return res.status(500).json({ error: 'Database error.' });
        }

        if (existing) {
          return res.status(409).json({
            error:
              'An account already exists for this email. Please sign in instead.'
          });
        }

        // 2) Look for a matching employee by email (QuickBooks sync)
        db.get(
          `
            SELECT id, name, name_on_checks, rate, email
            FROM employees
            WHERE LOWER(email) = LOWER(?)
              AND (active = 1 OR active IS NULL)
          `,
          [normEmail],
          (err2, emp) => {
            if (err2) {
              console.error('Register: error finding employee:', err2);
              return res.status(500).json({ error: 'Database error.' });
            }

            if (!emp) {
              // ❌ No QB employee with this email → DO NOT create user
              return res.status(400).json({
                error:
                  'We could not find a QuickBooks employee with that email. ' +
                  'Please speak with your QuickBooks administrator to get your email added, ' +
                  'then try again.'
              });
            }

            // 3) We have a matching employee → create user (not linked yet)
            const password_hash = bcrypt.hashSync(password, 10);

            db.run(
              `
                INSERT INTO users (email, password_hash, employee_id)
                VALUES (?, ?, NULL)
              `,
              [normEmail, password_hash],
              function (err3) {
                if (err3) {
                  console.error('Register: error inserting user:', err3);
                  return res.status(500).json({ error: 'Database error.' });
                }

                // Return candidate employee for the "Is this you?" step
                return res.json({
                  ok: true,
                  userId: this.lastID,
                  candidateEmployee: {
                    id: emp.id,
                    name: emp.name,
                    name_on_checks: emp.name_on_checks,
                    rate: emp.rate,
                    email: emp.email
                  }
                });
              }
            );
          }
        );
      }
    );
  });
});


/* ───────── AUTH: LINK EMPLOYEE (step 2 – after user confirms) ───────── */

app.post('/api/auth/link-employee', (req, res) => {
  const { userId, employeeId } = req.body || {};

  if (!userId || !employeeId) {
    return res.status(400).json({ error: 'userId and employeeId are required.' });
  }

  db.serialize(() => {
    db.get(
      'SELECT id, email, employee_id FROM users WHERE id = ?',
      [userId],
      (err, user) => {
        if (err) {
          console.error('Link employee: user lookup error:', err);
          return res.status(500).json({ error: 'Database error.' });
        }
        if (!user) {
          return res.status(404).json({ error: 'User not found.' });
        }

        db.get(
          'SELECT id, name, name_on_checks, rate, email FROM employees WHERE id = ?',
          [employeeId],
          (err2, emp) => {
            if (err2) {
              console.error('Link employee: employee lookup error:', err2);
              return res.status(500).json({ error: 'Database error.' });
            }
            if (!emp) {
              return res.status(404).json({ error: 'Employee not found.' });
            }

            // Optional safety: ensure emails match if both are set
            if (emp.email && user.email &&
                emp.email.toLowerCase() !== user.email.toLowerCase()) {
              console.warn(
                'Link employee: email mismatch between user and employee',
                user.email,
                emp.email
              );
              // You can block here if you want strict matching:
              // return res.status(400).json({ error: 'Email mismatch.' });
            }

            db.run(
              'UPDATE users SET employee_id = ? WHERE id = ?',
              [employeeId, userId],
              function (err3) {
                if (err3) {
                  console.error('Link employee: update error:', err3);
                  return res.status(500).json({ error: 'Database error.' });
                }

                // ✅ Log them in now that the account is linked
// ✅ Log them in now that the account is linked
if (req.session) {
  req.session.userId = user.id;
  req.session.employeeId = emp.id;

  // New accounts: give them a default "remember me" session
  // (30 days; adjust as desired)
  req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30;
}


                return res.json({
                  ok: true,
                  linkedEmployee: {
                    id: emp.id,
                    name: emp.name,
                    name_on_checks: emp.name_on_checks,
                    rate: emp.rate,
                    email: emp.email
                  }
                });
              }
            );
          }
        );
      }
    );
  });
});

/* ───────── AUTH: CANCEL REGISTRATION (delete user if they say "not me") ───────── */

app.post('/api/auth/cancel-register', (req, res) => {
  const { userId } = req.body || {};

  if (!userId) {
    return res.status(400).json({ error: 'userId is required.' });
  }

  db.run(
    'DELETE FROM users WHERE id = ?',
    [userId],
    function (err) {
      if (err) {
        console.error('Cancel register: delete error:', err);
        return res.status(500).json({ error: 'Database error.' });
      }

      // this.changes = number of rows deleted
      if (this.changes === 0) {
        return res
          .status(404)
          .json({ error: 'User not found or already removed.' });
      }

      return res.json({ ok: true, deleted: true });
    }
  );
});


// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const { email, password, remember } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const normEmail = normalizeEmail(email);

  db.get(
    `
      SELECT id, email, password_hash, employee_id
      FROM users
      WHERE LOWER(email) = LOWER(?)
    `,
    [normEmail],
    (err, user) => {
      if (err) {
        console.error('Login: DB error:', err);
        return res.status(500).json({ error: 'Database error.' });
      }

      if (!user) {
        return res
          .status(401)
          .json({ error: 'Invalid email or password.' });
      }

      const ok = bcrypt.compareSync(password, user.password_hash);
      if (!ok) {
        return res
          .status(401)
          .json({ error: 'Invalid email or password.' });
      }

      // Log the user in + apply remember-me cookie
      if (req.session) {
        req.session.userId = user.id;
        req.session.employeeId = user.employee_id || null;

        if (remember) {
          // 30 days
          req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30;
          req.session.cookie.expires = new Date(
            Date.now() + req.session.cookie.maxAge
          );
        } else {
          // Session cookie (dies when browser closes)
          req.session.cookie.maxAge = null;
          req.session.cookie.expires = false;
        }
      }

      return res.json({
        ok: true,
        userId: user.id,
        employeeId: user.employee_id || null
      });
    }
  );
});



/* ───────── AUTH: LOGOUT ───────── */

app.post('/api/auth/logout', (req, res) => {
  if (req.session) {
    req.session.destroy(err => {
      if (err) {
        console.error('Logout error:', err);
        return res.status(500).json({ error: 'Failed to log out.' });
      }
      return res.json({ ok: true });
    });
  } else {
    return res.json({ ok: true });
  }
});

// ───────── AUTH: CURRENT USER ─────────

app.get('/api/auth/me', async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ ok: false, error: 'Not authenticated' });
  }

  try {
    const user = await dbGet(
      'SELECT id, email, employee_id FROM users WHERE id = ?',
      [req.session.userId]
    );

    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found.' });
    }

    let employee = null;
    if (user.employee_id) {
      employee = await dbGet(
        'SELECT id, name, name_on_checks, is_admin FROM employees WHERE id = ?',
        [user.employee_id]
      );
    }

    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        employee_id: user.employee_id || null
      },
      employee: employee
        ? {
            id: employee.id,
            name: employee.name,
            display_name: employee.name_on_checks || employee.name,
            is_admin: !!employee.is_admin
          }
        : null
    });
  } catch (err) {
    console.error('auth/me error:', err);
    res.status(500).json({ ok: false, error: 'Failed to load current user.' });
  }
});

// ───────── AUTH: CHANGE PASSWORD ─────────
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body || {};

  if (!current_password || !new_password) {
    return res
      .status(400)
      .json({ error: 'Current password and new password are required.' });
  }

  if (String(new_password).length < 8) {
    return res
      .status(400)
      .json({ error: 'New password must be at least 8 characters long.' });
  }

  try {
    const user = await dbGet(
      'SELECT id, password_hash FROM users WHERE id = ?',
      [req.session.userId]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const matches = bcrypt.compareSync(current_password, user.password_hash);
    if (!matches) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    const newHash = bcrypt.hashSync(new_password, 10);
    await dbRun(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [newHash, user.id]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Failed to update password.' });
  }
});


/* ───────── 3. QUICKBOOKS STATUS & AUTH ───────── */

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

app.get('/auth/qbo', (req, res) => {
  const url = getAuthUrl();
  res.redirect(url);
});

// QuickBooks OAuth callback
app.get('/quickbooks/oauth/callback', async (req, res) => {
  const { code, realmId } = req.query;

  if (!code) {
    return res.status(400).send('Missing ?code= in callback URL.');
  }

  if (realmId) {
    console.log('QuickBooks realmId:', realmId);
  }

  try {
    await exchangeCodeForTokens(code);

    // Figure out base URL from redirect URI
    const redirectUri = process.env.QBO_REDIRECT_URI || '';
    const baseUrl = redirectUri.replace('/quickbooks/oauth/callback', '') || '/';

    return res.redirect(baseUrl);
  } catch (err) {
    console.error('Callback error:', err.message);
    res.status(500).send('Error connecting to QuickBooks.');
  }
});

/* ───────── 4. PAYROLL SETTINGS & LOOKUPS ───────── */

// Get available QuickBooks accounts for payroll setup (bank + expense)
app.get('/api/payroll/account-options', requireAuth, async (req, res) => {

  try {
    const { bankAccounts, expenseAccounts } = await listPayrollAccounts();

    res.json({
      ok: true,
      bankAccounts: bankAccounts.map(a => ({
        id: a.Id,
        name: a.Name,
        fullName: a.FullyQualifiedName,
        type: a.AccountType
      })),
      expenseAccounts: expenseAccounts.map(a => ({
        id: a.Id,
        name: a.Name,
        fullName: a.FullyQualifiedName,
        type: a.AccountType
      }))
    });
  } catch (err) {
    console.error('Error loading payroll account options:', err);

    const msg = err.message || 'Failed to load account options.';
    return res.status(500).json({
      ok: false,
      error: msg
    });
  }
});

// Get QuickBooks Classes for use on payroll lines
app.get('/api/payroll/classes', requireAuth, async (req, res) => {
  try {
    const classes = await listClasses();

    res.json({
      ok: true,
      classes: classes.map(c => ({
        id: c.Id,
        name: c.Name,
        fullName: c.FullyQualifiedName || c.Name,
        active: c.Active
      }))
    });
  } catch (err) {
    console.error('Error loading QuickBooks classes:', err);
    const msg = err.message || 'Failed to load QuickBooks classes.';
    res.status(500).json({ ok: false, error: msg });
  }
});

// Get payroll defaults
app.get('/api/payroll/settings', requireAuth, (req, res) => {
  db.get(
    `SELECT
       bank_account_name,
       expense_account_name,
       default_memo,
       line_description_template
     FROM payroll_settings
     WHERE id = 1`,
    (err, row) => {
      if (err) {
        console.error('Error reading payroll_settings:', err);
        return res.status(500).json({ error: 'Failed to load payroll settings.' });
      }
      res.json(
        row || {
          bank_account_name: null,
          expense_account_name: null,
          default_memo: 'Payroll {start} – {end}',
          line_description_template: 'Labor {hours} hrs – {project}'
        }
      );
    }
  );
});

// Update payroll defaults
app.post('/api/payroll/settings', requireAuth, (req, res) => {
  const {
    bank_account_name,
    expense_account_name,
    default_memo,
    line_description_template
  } = req.body || {};

  db.run(
    `
      UPDATE payroll_settings
      SET bank_account_name = ?,
          expense_account_name = ?,
          default_memo = ?,
          line_description_template = ?
      WHERE id = 1
    `,
    [
      bank_account_name || null,
      expense_account_name || null,
      default_memo || null,
      line_description_template || null
    ],
    err => {
      if (err) {
        console.error('Error updating payroll_settings:', err);
        return res.status(500).json({ error: 'Failed to update payroll settings.' });
      }
      res.json({ ok: true });
    }
  );
});

// PAYROLL SUMMARY ENDPOINT (UNPAID ONLY)
app.get('/api/payroll-summary', requireAuth, async (req, res) => {
  const { start, end, includePaid } = req.query;
  const includePaidBool =
    includePaid === '1' ||
    includePaid === 'true' ||
    includePaid === true;

  if (!start || !end) {
    return res
      .status(400)
      .json({ error: 'start and end query parameters are required.' });
  }

  // 🔒 enforce start <= end on the server as well
  if (end < start) {
    return res
      .status(400)
      .json({ error: 'end must be on or after start.' });
  }

  try {
    const rulesMap = await loadExceptionRulesMap();
    const isRuleEnabled = makeRuleChecker(rulesMap);

    const ruleMissingClockOut = isRuleEnabled('missing_clock_out');
    const ruleLongShift = isRuleEnabled('long_shift');
    const ruleMultiDay = isRuleEnabled('multi_day');
    const ruleCrossesMidnight = isRuleEnabled('crosses_midnight');
    const ruleNoProject = isRuleEnabled('no_project');
    const ruleProjectMismatch = isRuleEnabled('project_mismatch');
    const ruleTinyPunch = isRuleEnabled('tiny_punch');
    const ruleGeoIn = isRuleEnabled('geofence_clock_in');
    const ruleGeoOut = isRuleEnabled('geofence_clock_out');
    const ruleAutoClockOut = isRuleEnabled('auto_clock_out');
    const ruleManualNoPunches = isRuleEnabled('manual_no_punches');
    const ruleManualHoursMismatch = isRuleEnabled('manual_hours_mismatch');
    const ruleWeeklyHours = isRuleEnabled('weekly_hours');

    const punchExceptionConditions = [];
    if (ruleMissingClockOut) punchExceptionConditions.push('tp.clock_out_ts IS NULL');
    if (ruleNoProject) punchExceptionConditions.push('tp.project_id IS NULL');
    if (ruleProjectMismatch) {
      punchExceptionConditions.push(
        `tp.clock_out_project_id IS NOT NULL
         AND tp.project_id IS NOT NULL
         AND tp.clock_out_project_id != tp.project_id`
      );
    }
    if (ruleAutoClockOut) punchExceptionConditions.push('tp.auto_clock_out IS NOT NULL AND tp.auto_clock_out != 0');
    if (ruleGeoIn || ruleGeoOut) {
      punchExceptionConditions.push('tp.geo_violation IS NOT NULL AND tp.geo_violation != 0');
    }
    if (ruleLongShift) {
      punchExceptionConditions.push(
        `(tp.clock_in_ts IS NOT NULL AND tp.clock_out_ts IS NOT NULL
          AND ((julianday(tp.clock_out_ts) - julianday(tp.clock_in_ts)) * 24.0) > 12)`
      );
    }
    if (ruleMultiDay) {
      punchExceptionConditions.push(
        `(tp.clock_in_ts IS NOT NULL AND tp.clock_out_ts IS NOT NULL
          AND ((julianday(tp.clock_out_ts) - julianday(tp.clock_in_ts)) * 24.0) >= 24)`
      );
    }
    if (ruleCrossesMidnight) {
      punchExceptionConditions.push(
        `(tp.clock_in_ts IS NOT NULL AND tp.clock_out_ts IS NOT NULL
          AND date(tp.clock_in_ts) != date(tp.clock_out_ts))`
      );
    }
    if (ruleTinyPunch) {
      punchExceptionConditions.push(
        `(tp.clock_in_ts IS NOT NULL AND tp.clock_out_ts IS NOT NULL
          AND ((julianday(tp.clock_out_ts) - julianday(tp.clock_in_ts)) * 24.0 * 60) < 5)`
      );
    }
    if (ruleWeeklyHours) {
      punchExceptionConditions.push(
        `(tp.clock_in_ts IS NOT NULL AND tp.clock_out_ts IS NOT NULL
          AND (
            SELECT SUM((julianday(tp2.clock_out_ts) - julianday(tp2.clock_in_ts)) * 24.0)
            FROM time_punches tp2
            WHERE tp2.employee_id = tp.employee_id
              AND tp2.clock_in_ts IS NOT NULL
              AND tp2.clock_out_ts IS NOT NULL
              AND strftime('%Y-%W', tp2.clock_in_ts) = strftime('%Y-%W', tp.clock_in_ts)
          ) > 50)`
      );
    }

    const punchExceptionCase = punchExceptionConditions.length
      ? `CASE ${punchExceptionConditions.map(c => `WHEN ${c} THEN 1`).join(' ')} ELSE 0 END`
      : '0';
    const punchExceptionUnapprovedCase = punchExceptionConditions.length
      ? `CASE ${punchExceptionConditions.map(c => `WHEN (${c}) AND LOWER(COALESCE(tp.exception_review_status, 'open')) NOT IN ('approved','modified') THEN 1`).join(' ')} ELSE 0 END`
      : '0';

    const HOURS_EPSILON = 0.1; // keep in sync with payroll filtering
    const paidClause = includePaidBool ? '' : 'AND (t.paid IS NULL OR t.paid = 0)';

    const entryExceptionConditions = [];
    if (ruleManualNoPunches) entryExceptionConditions.push('f.punch_count = 0');
    if (ruleManualHoursMismatch) {
      entryExceptionConditions.push(
        `(f.hours IS NULL OR ABS(IFNULL(f.punch_hours, 0) - f.hours) >= ${HOURS_EPSILON})`
      );
    }
    const entryExceptionExpr = entryExceptionConditions.length
      ? `(${entryExceptionConditions.join(' OR ')})`
      : '0';

    const sql = `
    WITH entry_flags AS (
      SELECT
        t.id,
        t.employee_id,
        t.project_id,
        t.start_date,
        t.end_date,
        t.hours,
        t.total_pay,
        t.paid,
        t.paid_date,
        t.resolved_status,
        COUNT(tp.id) AS punch_count,
        SUM(${punchExceptionCase}) AS punch_exception_count,
        SUM(${punchExceptionUnapprovedCase}) AS punch_exception_unapproved_count,
        SUM(
          CASE
            WHEN tp.clock_in_ts IS NOT NULL AND tp.clock_out_ts IS NOT NULL
            THEN (julianday(tp.clock_out_ts) - julianday(tp.clock_in_ts)) * 24.0
            ELSE 0
          END
        ) AS punch_hours
      FROM time_entries t
      LEFT JOIN time_punches tp ON tp.time_entry_id = t.id
      WHERE t.start_date >= ? AND t.end_date <= ?
        ${paidClause}
      GROUP BY
        t.id,
        t.employee_id,
        t.project_id,
        t.start_date,
        t.end_date,
        t.hours,
        t.total_pay,
        t.paid,
        t.paid_date,
        t.resolved_status
    ),
    eligible_entries AS (
      SELECT *
      FROM entry_flags f
      WHERE
        (
          ${entryExceptionExpr} = 0
          OR LOWER(COALESCE(f.resolved_status, 'open')) IN ('approved', 'modified')
        )
        AND (
          IFNULL(f.punch_exception_count, 0) = 0
          OR IFNULL(f.punch_exception_unapproved_count, 0) = 0
        )
    )
    SELECT
      e.id AS employee_id,
      e.name AS employee_name,
      e.vendor_qbo_id AS employee_vendor_qbo_id,
      e.employee_qbo_id AS employee_employee_qbo_id,
      p.id AS project_id,
      COALESCE(p.name, '(No project)') AS project_name,
      p.qbo_id AS project_qbo_id,
      p.customer_name AS project_customer_name,
      p.name AS project_name_raw,
      MAX(COALESCE(t.paid, 0)) AS any_paid,
      MAX(t.paid_date) AS last_paid_date,
      MAX(COALESCE(t.paid, 0)) AS line_paid,
      MAX(t.paid_date) AS line_paid_date,
      SUM(t.hours)     AS project_hours,
      SUM(t.total_pay) AS project_pay
    FROM eligible_entries t
    JOIN employees e ON t.employee_id = e.id
    LEFT JOIN projects p ON t.project_id = p.id
    GROUP BY
      e.id, e.name,
      p.id, p.name
    ORDER BY
      e.name,
      project_name
  `;

    const params = [start, end];

    const rows = await dbAll(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Error loading payroll summary:', err);
    return res.status(500).json({ error: err.message || 'Failed to load payroll summary.' });
  }
});
// Mark checks/time entries as unpaid for an employee in a period (to allow resend)
app.post('/api/payroll/unpay', requireAuth, async (req, res) => {
  const {
    employeeId,
    start,
    end,
    reason,
    payrollCheckId: payrollCheckIdRaw
  } = req.body || {};
  const empIdNum = Number(employeeId);
  const payrollCheckId =
    payrollCheckIdRaw && Number.isFinite(Number(payrollCheckIdRaw))
      ? Number(payrollCheckIdRaw)
      : null;
  if (!empIdNum || !start || !end) {
    return res.status(400).json({ ok: false, error: 'employeeId, start, and end are required.' });
  }
  try {
    // find payroll_run_id if it exists for this period
    const run = await dbGet(
      `SELECT id FROM payroll_runs WHERE start_date = ? AND end_date = ? ORDER BY id DESC LIMIT 1`,
      [start, end]
    );
    const runId = run ? run.id : null;

    // mark payroll_checks as voided/unpaid for this employee/period
    if (runId) {
      if (payrollCheckId) {
        await dbRun(
          `
            UPDATE payroll_checks
            SET paid = 0,
                voided_at = datetime('now'),
                voided_reason = ?
            WHERE payroll_run_id = ?
              AND employee_id = ?
              AND id = ?
          `,
          [reason || 'manual unpay', runId, empIdNum, payrollCheckId]
        );
      } else {
        await dbRun(
          `
            UPDATE payroll_checks
            SET paid = 0,
                voided_at = datetime('now'),
                voided_reason = ?
            WHERE payroll_run_id = ?
              AND employee_id = ?
          `,
          [reason || 'manual unpay', runId, empIdNum]
        );
      }
      // recalc totals for the run
      await dbRun(
        `
          UPDATE payroll_runs
          SET total_hours = (
                SELECT IFNULL(SUM(total_hours), 0)
                FROM payroll_checks
                WHERE payroll_run_id = ?
              ),
              total_pay = (
                SELECT IFNULL(SUM(total_pay), 0)
                FROM payroll_checks
                WHERE payroll_run_id = ?
              )
          WHERE id = ?
        `,
        [runId, runId, runId]
      );
    }

    // unmark time entries as paid
    await dbRun(
      `
        UPDATE time_entries
        SET paid = 0,
            paid_date = NULL
        WHERE employee_id = ?
          AND start_date >= ?
          AND end_date   <= ?
      `,
      [empIdNum, start, end]
    );

    await logPayrollEvent({
      event_type: 'PAYROLL_UNPAY',
      payroll_run_id: runId,
      message: `Unlocked payroll for employee ${empIdNum} (${start}→${end})`,
      details: { employeeId: empIdNum, start, end, reason: reason || null }
    });

    return res.json({ ok: true, payrollRunId: runId });
  } catch (err) {
    console.error('Error unpaying payroll:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Failed to unpay payroll.' });
  }
});

// Get raw time entries for an employee in a date range (for payroll UI)
app.get('/api/payroll/time-entries', requireAuth, async (req, res) => {
  const employeeId = parseInt(req.query.employeeId, 10);
  const { start, end } = req.query || {};

  if (!employeeId || !start || !end) {
    return res
      .status(400)
      .json({ error: 'employeeId, start, and end are required.' });
  }

  try {
    const rulesMap = await loadExceptionRulesMap();
    const isRuleEnabled = makeRuleChecker(rulesMap);

    const ruleMissingClockOut = isRuleEnabled('missing_clock_out');
    const ruleLongShift = isRuleEnabled('long_shift');
    const ruleMultiDay = isRuleEnabled('multi_day');
    const ruleCrossesMidnight = isRuleEnabled('crosses_midnight');
    const ruleNoProject = isRuleEnabled('no_project');
    const ruleProjectMismatch = isRuleEnabled('project_mismatch');
    const ruleTinyPunch = isRuleEnabled('tiny_punch');
    const ruleWeeklyHours = isRuleEnabled('weekly_hours');
    const ruleGeoIn = isRuleEnabled('geofence_clock_in');
    const ruleGeoOut = isRuleEnabled('geofence_clock_out');
    const ruleAutoClockOut = isRuleEnabled('auto_clock_out');
    const ruleManualNoPunches = isRuleEnabled('manual_no_punches');
    const ruleManualHoursMismatch = isRuleEnabled('manual_hours_mismatch');

    const punchExceptionConditions = [];
    if (ruleMissingClockOut) punchExceptionConditions.push('tp.clock_out_ts IS NULL');
    if (ruleNoProject) punchExceptionConditions.push('tp.project_id IS NULL');
    if (ruleProjectMismatch) {
      punchExceptionConditions.push(
        `tp.clock_out_project_id IS NOT NULL
         AND tp.project_id IS NOT NULL
         AND tp.clock_out_project_id != tp.project_id`
      );
    }
    if (ruleAutoClockOut) punchExceptionConditions.push('tp.auto_clock_out IS NOT NULL AND tp.auto_clock_out != 0');
    if (ruleGeoIn) punchExceptionConditions.push('tp.geo_violation IS NOT NULL AND tp.geo_violation != 0'); // geo violation already computed at punch time
    if (ruleLongShift) {
      punchExceptionConditions.push(
        `(tp.clock_in_ts IS NOT NULL AND tp.clock_out_ts IS NOT NULL
          AND ((julianday(tp.clock_out_ts) - julianday(tp.clock_in_ts)) * 24.0) > 12)`
      );
    }
    if (ruleMultiDay) {
      punchExceptionConditions.push(
        `(tp.clock_in_ts IS NOT NULL AND tp.clock_out_ts IS NOT NULL
          AND ((julianday(tp.clock_out_ts) - julianday(tp.clock_in_ts)) * 24.0) >= 24)`
      );
    }
    if (ruleCrossesMidnight) {
      punchExceptionConditions.push(
        `(tp.clock_in_ts IS NOT NULL AND tp.clock_out_ts IS NOT NULL
          AND date(tp.clock_in_ts) != date(tp.clock_out_ts))`
      );
    }
    if (ruleTinyPunch) {
      punchExceptionConditions.push(
        `(tp.clock_in_ts IS NOT NULL AND tp.clock_out_ts IS NOT NULL
          AND ((julianday(tp.clock_out_ts) - julianday(tp.clock_in_ts)) * 24.0 * 60) < 5)`
      );
    }
    // Weekly overtime is handled in the time exception report only; not enforced per punch here

    const punchExceptionCase = punchExceptionConditions.length
      ? `CASE ${punchExceptionConditions.map(c => `WHEN ${c} THEN 1`).join(' ')} ELSE 0 END`
      : '0';
    const punchExceptionUnapprovedCase = punchExceptionConditions.length
      ? `CASE ${punchExceptionConditions.map(c => `WHEN (${c}) AND LOWER(COALESCE(tp.exception_review_status, 'open')) NOT IN ('approved','modified') THEN 1`).join(' ')} ELSE 0 END`
      : '0';

    const sql = `
      SELECT
        t.id,
        t.employee_id,
        t.project_id,
        COALESCE(p.name, '(No project)') AS project_name,
        t.start_date,
        t.end_date,
        t.start_time,
        t.end_time,
        t.hours,
        t.total_pay,
        t.resolved_status,
        t.resolved_note,
        COUNT(tp.id) AS punch_count,
        SUM(${punchExceptionCase}) AS punch_exception_count,
        SUM(${punchExceptionUnapprovedCase}) AS punch_exception_unapproved_count,
        SUM(
          CASE
            WHEN tp.clock_in_ts IS NOT NULL AND tp.clock_out_ts IS NOT NULL
            THEN (julianday(tp.clock_out_ts) - julianday(tp.clock_in_ts)) * 24.0
            ELSE 0
          END
        ) AS punch_hours
      FROM time_entries t
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN time_punches tp ON tp.time_entry_id = t.id
      WHERE t.employee_id = ?
        AND t.start_date >= ?
        AND t.end_date <= ?
      GROUP BY
        t.id,
        t.employee_id,
        t.project_id,
        project_name,
        t.start_date,
        t.end_date,
        t.start_time,
        t.end_time,
        t.hours,
        t.total_pay,
        t.resolved_status,
        t.resolved_note
      ORDER BY project_name, t.start_date, t.id
    `;

    const rows = await dbAll(sql, [employeeId, start, end]);

    const HOURS_EPSILON = 0.1; // ~6 minutes

    const eligible = rows.filter(r => {
      const punchCount = Number(r.punch_count || 0);
      const entryHours =
        r.hours != null && !Number.isNaN(Number(r.hours))
          ? Number(r.hours)
          : null;
      const punchHours =
        r.punch_hours != null && !Number.isNaN(Number(r.punch_hours))
          ? Number(r.punch_hours)
          : 0;

      const entryException =
        (ruleManualNoPunches && (!punchCount)) ||
        (ruleManualHoursMismatch &&
          (entryHours == null ||
            Math.abs(punchHours - entryHours) >= HOURS_EPSILON));

      const status = (r.resolved_status || '').toLowerCase();
      const isApproved = status === 'approved' || status === 'modified';

      const hasPunchException =
        Number(r.punch_exception_count || 0) > 0;
      const punchExceptionsApproved =
        Number(r.punch_exception_unapproved_count || 0) === 0;

      const entryOk = !entryException || isApproved;
      const punchesOk = !hasPunchException || punchExceptionsApproved;
      return entryOk && punchesOk;
    });

    const withRate = eligible.map(r => {
      const rawHours = Number(r.hours || 0);
      const rawTotalPay = Number(r.total_pay || 0);

      // Derive the effective hourly rate from the raw data
      const rate = rawHours > 0 ? rawTotalPay / rawHours : 0;

      // Round hours up to the nearest minute for DISPLAY
      let minutes = 0;
      if (rawHours > 0) {
        minutes = Math.ceil(rawHours * 60); // 60 minutes in an hour
      }

      const displayHours = minutes / 60;

      // Compute DISPLAY total pay from displayHours & rate, to the nearest cent
      const displayTotalPayCents = Math.round(displayHours * rate * 100);
      const displayTotalPay = displayTotalPayCents / 100;

      return {
        ...r,
        hours: displayHours,
        total_pay: displayTotalPay,
        rate
      };
    });

    res.json(withRate);
  } catch (err) {
    console.error('Error loading time entries for payroll view:', err);
    return res.status(500).json({ error: 'Failed to load time entries.' });
  }
});

// Preview payroll checks (no DB writes)
app.post('/api/payroll/preview-checks', requireAuth, async (req, res) => {
  const {
    start,
    end,
    bankAccountName,
    expenseAccountName,
    excludeEmployeeIds = [],
    memo,
    customLines = [],
    lineOverrides = []
  } = req.body || {};

  if (!start || !end) {
    return res
      .status(400)
      .json({ error: 'start and end are required in the request body.' });
  }

  try {
    const result = await createChecksForPeriod(start, end, {
      bankAccountName,
      expenseAccountName,
      excludeEmployeeIds,
      memo,
      customLines,
      lineOverrides
    });

    // If connected and ok, just echo a minimal preview payload
    if (result.ok) {
      return res.json({
        ok: true,
        start,
        end,
        bankAccountName,
        expenseAccountName
        // You could add summary info here later if you want
      });
    }

    // If not connected, pass through the draft result
    return res.json(result);
  } catch (err) {
    console.error('Preview checks error:', err);
    res.status(500).json({ error: err.message || 'Failed to preview checks.' });
  }
});

app.post('/api/payroll/create-checks', requireAuth, async (req, res) => {
  const {
    start,
    end,
    bankAccountName,
    expenseAccountName,
    memo,
    lineDescriptionTemplate,
    overrides = [],
    lineOverrides = [],
    customLines = [],
    excludeEmployeeIds = [],
    isRetry = false,
    originalPayrollRunId = null,
    onlyEmployeeIds = []
  } = req.body || {};

  // 🔒 Simple in-memory mutex: block concurrent payroll runs in this Node process
  if (isPayrollRunInProgress) {
    return res.status(409).json({
      ok: false,
      error:
        'A payroll run is already in progress. Please wait for it to finish before starting another.'
    });
  }

  isPayrollRunInProgress = true;

  try {
    // 🔒 Safety: backup DB right before creating checks
    await performDatabaseBackup();

    let payrollRunId = null;

    if (isRetry) {
      // ───────── RETRY PATH ─────────
      // Basic date sanity only
      const startDate = toDateOnly(start);
      const endDate   = toDateOnly(end);

      if (!startDate || !endDate) {
        return res.status(400).json({
          ok: false,
          error:
            'Both start and end dates are required and must be valid YYYY-MM-DD values.'
        });
      }

      if (endDate < startDate) {
        return res.status(400).json({
          ok: false,
          error: 'End date must be on or after the start date.'
        });
      }

      const MAX_PAYROLL_DAYS = 31;
      const diffMs = endDate - startDate;
      const diffDays = diffMs / (1000 * 60 * 60 * 24) + 1;
      if (diffDays > MAX_PAYROLL_DAYS) {
        return res.status(400).json({
          ok: false,
          error:
            `Payroll period is ${Math.round(diffDays)} days, which exceeds the allowed maximum of ${MAX_PAYROLL_DAYS} days.`
        });
      }

      // Find the existing payroll run to attach retries to
      if (originalPayrollRunId) {
        const existingById = await dbGet(
          'SELECT id, start_date, end_date FROM payroll_runs WHERE id = ?',
          [originalPayrollRunId]
        );
        if (!existingById) {
          return res.status(400).json({
            ok: false,
            error: 'Original payroll run not found for retry.'
          });
        }
        if (existingById.start_date !== start || existingById.end_date !== end) {
          return res.status(400).json({
            ok: false,
            error:
              'Retry dates do not match the original payroll run period. Please use the same start/end dates.'
          });
        }
        payrollRunId = existingById.id;
      } else {
        const existingExact = await dbGet(
          `
            SELECT id, start_date, end_date
            FROM payroll_runs
            WHERE start_date = ? AND end_date = ?
            LIMIT 1
          `,
          [start, end]
        );
        if (!existingExact) {
          return res.status(400).json({
            ok: false,
            error:
              'Cannot retry checks: no existing payroll run found for this period.'
          });
        }
        payrollRunId = existingExact.id;
      }

      // 🔎 Audit log: retry started
      await logPayrollEvent({
        event_type: 'RETRY_STARTED',
        message: `Retry payroll run for ${start} → ${end}`,
        payroll_run_id: payrollRunId,
        details: { start, end, originalPayrollRunId, onlyEmployeeIds }
      });
    } else {
      // ───────── NORMAL (FIRST) RUN PATH ─────────
      await validatePayrollRangeServer(start, end);

      // 🔎 Audit log: run started
    await logPayrollEvent({
      event_type: 'PAYROLL_RUN_STARTED',
      message: `Payroll run started for ${start} → ${end}`,
      details: { start, end, bankAccountName, expenseAccountName, onlyEmployeeIds },
      payroll_run_id: null
    });
    }

    // 2) Call QuickBooks helper to actually build & create checks.
    const qbResult = await createChecksForPeriod(start, end, {
      bankAccountName,
      expenseAccountName,
      memo,
      lineDescriptionTemplate,
      overrides,
      lineOverrides,
      customLines,
      excludeEmployeeIds,
      onlyEmployeeIds
    });

    // 🔎 Audit log: QuickBooks call completed (basic info)
    await logPayrollEvent({
      event_type: isRetry ? 'RETRY_QBO_COMPLETE' : 'PAYROLL_QBO_COMPLETE',
      message: 'QuickBooks check creation call completed.',
      details: {
        start,
        end,
        ok: qbResult && qbResult.ok,
        resultCount: Array.isArray(qbResult?.results)
          ? qbResult.results.length
          : 0
      },
      payroll_run_id: payrollRunId
    });

    if (!qbResult || qbResult.ok === false) {
      const errorMsg =
        qbResult?.error ||
        qbResult?.reason ||
        'QuickBooks check creation failed.';

      // 🔎 Audit log: QuickBooks error
      await logPayrollEvent({
        event_type: 'PAYROLL_QBO_ERROR',
        message: errorMsg,
        details: {
          start,
          end,
          results: qbResult?.results || []
        },
        payroll_run_id: payrollRunId
      });

      return res.status(500).json({
        ok: false,
        error: errorMsg,
        results: qbResult?.results || []
      });
    }

    const results = Array.isArray(qbResult.results) ? qbResult.results : [];

    // 3) Compute totals from the results (only successful checks) for response
    const successfulResults = results.filter(r => r && r.ok !== false);
    let batchHours = 0;
    let batchPay = 0;

    successfulResults.forEach(r => {
      batchHours += Number(r.totalHours || 0);
      batchPay   += Number(r.totalPay   || 0);
    });

    // 4) Persist this payroll run + checks in a transaction.
    await dbRun('BEGIN TRANSACTION');

    try {
      if (!isRetry) {
        // FIRST RUN: create a brand-new payroll_runs row (totals will be recalculated after inserts)
        const runInsert = await dbRun(
          `
            INSERT INTO payroll_runs (
              start_date,
              end_date,
              created_at,
              total_hours,
              total_pay
            ) VALUES (?, ?, datetime('now'), 0, 0)
          `,
          [start, end]
        );
        payrollRunId = runInsert.lastID;
      } else if (!payrollRunId) {
        // Safety fallback: retry requested but somehow no run id yet
        const existing = await dbGet(
          `
            SELECT id
            FROM payroll_runs
            WHERE start_date = ? AND end_date = ?
            LIMIT 1
          `,
          [start, end]
        );
        if (!existing) {
          throw new Error('Retry requested but no existing payroll_run found for this period.');
        }
        payrollRunId = existing.id;
      }

      // When retrying, delete all existing check rows for that employee in this run
      // before inserting the new attempt.
      for (const r of results) {
        if (!r || !r.employeeId) continue;

        if (isRetry) {
          await dbRun(
            `
              DELETE FROM payroll_checks
              WHERE payroll_run_id = ?
                AND employee_id    = ?
            `,
            [payrollRunId, r.employeeId]
          );
        }

        await dbRun(
          `
            INSERT INTO payroll_checks (
              payroll_run_id,
              employee_id,
              total_hours,
              total_pay,
              check_number,
              paid,
              qbo_txn_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          [
            payrollRunId,
            r.employeeId,
            Number(r.totalHours || 0),
            Number(r.totalPay   || 0),
            r.checkNumber || null,
            r.ok === false ? 0 : 1,
            r.qboTxnId || null
          ]
        );
      }

      // Recalculate totals from current payroll_checks rows
      await dbRun(
        `
          UPDATE payroll_runs
          SET total_hours = (
                SELECT IFNULL(SUM(total_hours), 0)
                FROM payroll_checks
                WHERE payroll_run_id = ?
              ),
              total_pay = (
                SELECT IFNULL(SUM(total_pay), 0)
                FROM payroll_checks
                WHERE payroll_run_id = ?
              )
          WHERE id = ?
        `,
        [payrollRunId, payrollRunId, payrollRunId]
      );

      // 🔒 Mark underlying time entries as PAID for successful employees in this date range
      const successfulEmployeeIds = [
        ...new Set(
          successfulResults
            .map(r => Number(r.employeeId))
            .filter(id => Number.isFinite(id))
        )
      ];

      try {
        for (const empId of successfulEmployeeIds) {
          await dbRun(
            `
              UPDATE time_entries
    SET paid      = 1,
        paid_date = datetime('now')
    WHERE employee_id = ?
      AND start_date  >= ?
      AND end_date    <= ?
      AND (paid IS NULL OR paid = 0)
  `,
  [empId, start, end]
);
        }

        console.log('✅ Marked time entries as paid for this payroll run.');
      } catch (markErr) {
        console.error('⚠️ Failed marking time entries as paid:', markErr);
        throw new Error('Failed marking time entries as paid: ' + markErr.message); // Force rollback so we never report success with unpaid entries
      }

      await dbRun('COMMIT');

      // 🔎 Audit log: DB commit success
      await logPayrollEvent({
        event_type: isRetry ? 'RETRY_SUCCESS' : 'PAYROLL_RUN_SUCCESS',
        message: 'Payroll run saved successfully.',
        payroll_run_id: payrollRunId,
        details: {
          start,
          end,
          payroll_run_id: payrollRunId,
          batchHours,
          batchPay,
          successfulEmployeeIds
        }
      });

    } catch (dbErr) {
      await dbRun('ROLLBACK');
      console.error('Error saving payroll run/checks:', dbErr);

      // 🔎 Audit log: DB failure
      await logPayrollEvent({
        event_type: 'PAYROLL_RUN_FAILURE',
        message: 'DB error during payroll run.',
        payroll_run_id: payrollRunId,
        details: {
          start,
          end,
          error: dbErr.message
        }
      });

      return res.status(500).json({
        ok: false,
        error:
          'Checks were created in QuickBooks, but saving the payroll run failed. Please review in QuickBooks and contact support with this error: ' +
          dbErr.message,
        results
      });
    }

    // 5) Respond with full details so the UI can show a summary and allow retry-later logic
    return res.json({
      ok: true,
      payrollRunId,
      start,
      end,
      totalHours: batchHours,  // just this batch, final totals are in payroll_runs table
      totalPay: batchPay,
      results
    });

  } catch (err) {
    console.error('Create checks error:', err);

    const message = err.message || 'Failed to create checks.';

    // 🔎 Audit log: fatal error
    await logPayrollEvent({
      event_type: 'PAYROLL_FATAL_ERROR',
      message,
      payroll_run_id: null,
      details: {
        start,
        end,
        stack: err.stack || null
      }
    });

    if (
      message.includes('required and must be valid') ||
      message.includes('End date must be on or after') ||
      message.includes('exceeds the allowed maximum') ||
      message.includes('already exists for this exact period') ||
      message.includes('overlaps with an existing payroll run')
    ) {
      return res.status(400).json({
        ok: false,
        error: message
      });
    }

    return res.status(500).json({
      ok: false,
      error: message
    });
  } finally {
    isPayrollRunInProgress = false;
  }
});

app.get('/api/payroll/audit-log', requireAuth, async (req, res) => {
  try {
    const rows = await dbAll(`
      SELECT *
      FROM payroll_audit_log
      ORDER BY created_at DESC
      LIMIT 200
    `);

    res.json({ ok: true, logs: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ───────── 5. VENDORS & EMPLOYEES ───────── */

app.post('/api/vendors/:id/pin', requireAuth, (req, res) => {

  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ error: 'Invalid vendor id.' });
  }

  const { pin, allowOverride, is_freight_forwarder, uses_timekeeping } = req.body || {};

  const freightFlag =
    typeof is_freight_forwarder === 'undefined'
      ? null
      : (is_freight_forwarder ? 1 : 0);

  const timekeepingFlag =
    typeof uses_timekeeping === 'undefined'
      ? null
      : (uses_timekeeping ? 1 : 0);

  // If pin is completely omitted, we only want to update flags.
  if (typeof pin === 'undefined') {
    if (freightFlag === null && timekeepingFlag === null) {
      return res.json({ ok: true }); // nothing to do
    }

    const parts = [];
    const params = [];

    if (freightFlag !== null) {
      parts.push('is_freight_forwarder = ?');
      params.push(freightFlag);
    }
    if (timekeepingFlag !== null) {
      parts.push('uses_timekeeping = ?');
      params.push(timekeepingFlag);
    }

    const sql = `UPDATE vendors SET ${parts.join(', ')} WHERE id = ?`;
    params.push(id);

    return db.run(sql, params, function (err) {
      if (err) return res.status(500).json({ error: err.message });
      return res.json({ ok: true });
    });
  }

  // Otherwise we're updating PIN (and optionally flags)
  const newPin = pin || null;

  let setParts = ['pin = ?'];
  const params = [newPin];

  if (freightFlag !== null) {
    setParts.push('is_freight_forwarder = ?');
    params.push(freightFlag);
  }
  if (timekeepingFlag !== null) {
    setParts.push('uses_timekeeping = ?');
    params.push(timekeepingFlag);
  }

  // We always include "id = id" workaround in the original code to keep SQL valid;
  // we don't need it now because setParts is guaranteed non-empty.
  let sql = `UPDATE vendors SET ${setParts.join(', ')} WHERE id = ?`;
  params.push(id);

  if (!allowOverride) {
    sql += ' AND pin IS NULL';
  }

  db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ error: err.message });

    if (this.changes === 0 && !allowOverride) {
      return res.status(409).json({
        error: 'PIN already set for this vendor. Use allowOverride to change it.'
      });
    }

    res.json({ ok: true });
  });
});

app.get('/api/vendors', requireAuth, (req, res) => {

  const status = req.query.status || 'all'; // 'active' | 'inactive' | 'all'

  let where = '';
  const params = [];

  if (status === 'active') {
    where = 'WHERE IFNULL(active, 1) = 1';
  } else if (status === 'inactive') {
    where = 'WHERE IFNULL(active, 1) = 0';
  } else {
    where = ''; // all
  }

  const sql = `
    SELECT *
    FROM vendors
    ${where}
    ORDER BY name
  `;

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.get('/api/employees', requireAuth, (req, res) => {
  const status = req.query.status || 'active'; // 'active' | 'inactive' | 'all'

  let where = '';
  if (status === 'active') {
    // Only show active QBO-backed employees
    where = 'WHERE IFNULL(active, 1) = 1 AND employee_qbo_id IS NOT NULL';
  } else if (status === 'inactive') {
    // Only show inactive QBO-backed employees
    where = 'WHERE IFNULL(active, 1) = 0 AND employee_qbo_id IS NOT NULL';
  } else {
    // "all" → all QBO-backed employees
    where = 'WHERE employee_qbo_id IS NOT NULL';
  }

const sql = `
  SELECT
    id,
    vendor_qbo_id,
    name,
    nickname,
    name_on_checks,
    rate,
    is_admin,
    pin,
    uses_timekeeping,
    email,
    language,
    employee_qbo_id,
    kiosk_can_view_shipments       -- 👈 NEW
  FROM employees
  ${where}
  ORDER BY name COLLATE NOCASE
`;


  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// Public kiosk-friendly list (no auth; limited fields)
app.get('/api/kiosk/employees', (req, res) => {
  const sql = `
    SELECT
      id,
      name,
      name_on_checks,
      nickname,
      is_admin,
      pin,
      uses_timekeeping,
      kiosk_can_view_shipments,
      language,
      IFNULL(active, 1) AS active
    FROM employees
    WHERE employee_qbo_id IS NOT NULL
      AND IFNULL(active, 1) = 1
    ORDER BY name COLLATE NOCASE
  `;

  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

const RATE_UNLOCK_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

function isRateUnlockValid(req, adminId) {
  if (!req.session) return false;
  const unlockedAt = req.session.kioskRateUnlockedAt;
  const unlockedFor = req.session.kioskRateAdminId;
  if (!unlockedAt || !unlockedFor) return false;
  if (Date.now() - unlockedAt > RATE_UNLOCK_MAX_AGE_MS) return false;
  if (adminId && Number(unlockedFor) !== Number(adminId)) return false;
  return true;
}

// Re-auth a kiosk admin (by PIN) to unlock rate editing, gated by access permissions
app.post('/api/kiosk/rates/unlock', async (req, res) => {
  try {
    const adminId = req.body && req.body.admin_id ? Number(req.body.admin_id) : null;
    const pin = (req.body && req.body.pin ? String(req.body.pin) : '').trim();

    if (!adminId || !pin) {
      return res.status(400).json({ error: 'Admin id and PIN are required.' });
    }

    const admin = await dbGet(
      `
        SELECT id, name, pin, is_admin
        FROM employees
        WHERE id = ? AND IFNULL(is_admin, 0) = 1
        LIMIT 1
      `,
      [adminId]
    );

    if (!admin) {
      return res.status(404).json({ error: 'Admin not found or not authorized.' });
    }

    const perms = await getAdminAccessPerms(admin.id);
    if (!perms.modify_pay_rates) {
      return res.status(403).json({ error: 'This admin cannot modify pay rates.' });
    }

    const currentPin = (admin.pin || '').trim();
    if (!currentPin) {
      return res.status(403).json({ error: 'No PIN is set for this admin.' });
    }
    if (pin !== currentPin) {
      return res.status(401).json({ error: 'Incorrect PIN.' });
    }

    if (req.session) {
      req.session.kioskRateAdminId = admin.id;
      req.session.kioskRateUnlockedAt = Date.now();
    }

    res.json({ ok: true, expires_in_ms: RATE_UNLOCK_MAX_AGE_MS });
  } catch (err) {
    console.error('Error unlocking rate access:', err);
    res.status(500).json({ error: 'Failed to unlock rate access.' });
  }
});

// Fetch employees + rates for kiosk editors (requires an active unlock session)
app.get('/api/kiosk/rates', async (req, res) => {
  try {
    const adminId = req.session && req.session.kioskRateAdminId;
    if (!isRateUnlockValid(req, adminId)) {
      return res.status(403).json({ error: 'Rates access is locked.' });
    }

    const perms = await getAdminAccessPerms(adminId);
    if (!perms.modify_pay_rates) {
      return res.status(403).json({ error: 'This admin cannot modify pay rates.' });
    }

    // Refresh the unlock timer while they are actively using it
    req.session.kioskRateUnlockedAt = Date.now();

    const rows = await dbAll(
      `
        SELECT
          id,
          name,
          nickname,
          name_on_checks,
          rate,
          IFNULL(active, 1) AS active
        FROM employees
        WHERE employee_qbo_id IS NOT NULL
        ORDER BY name COLLATE NOCASE
      `
    );

    res.json({ employees: rows || [] });
  } catch (err) {
    console.error('Error loading kiosk rates:', err);
    res.status(500).json({ error: 'Failed to load rates.' });
  }
});

// Update a single employee rate from kiosk (requires unlock + permission)
app.post('/api/kiosk/rates/:id', async (req, res) => {
  try {
    const adminId = req.session && req.session.kioskRateAdminId;
    if (!isRateUnlockValid(req, adminId)) {
      return res.status(403).json({ error: 'Rates access is locked.' });
    }

    const perms = await getAdminAccessPerms(adminId);
    if (!perms.modify_pay_rates) {
      return res.status(403).json({ error: 'This admin cannot modify pay rates.' });
    }

    const id = Number(req.params.id);
    const rate = req.body && req.body.rate !== undefined ? Number(req.body.rate) : null;
    if (!id || rate === null || Number.isNaN(rate)) {
      return res.status(400).json({ error: 'Valid rate is required.' });
    }

    const updateRes = await dbRun(
      'UPDATE employees SET rate = ? WHERE id = ?',
      [rate, id]
    );
    if (updateRes.changes === 0) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    // Refresh the unlock timer after a successful update
    req.session.kioskRateUnlockedAt = Date.now();

    res.json({ ok: true, rate });
  } catch (err) {
    console.error('Error updating rate from kiosk:', err);
    res.status(500).json({ error: 'Failed to update rate.' });
  }
});

app.post('/api/employees', requireAuth, async (req, res) => {
  try {
    const {
      id,
      rate,
      is_admin,
      uses_timekeeping,
      nickname,
      name_on_checks,
      kiosk_can_view_shipments,
      language
    } = req.body;

    // ✅ Block manual creation: require an id
    if (!id) {
      return res.status(400).json({
        error: 'Manual employee creation is disabled. Add employees in QuickBooks.'
      });
    }

    const existing = await dbGet(
      'SELECT id, rate FROM employees WHERE id = ?',
      [id]
    );
    if (!existing) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const perms = await getAdminAccessPerms(req.session && req.session.employeeId);
    const canModifyRates = perms.modify_pay_rates === true;

    const incomingRate =
      rate === undefined || rate === null ? null : Number(rate);

    const currentRate = existing.rate;

    if (!canModifyRates) {
      const rateChanged =
        incomingRate !== null &&
        !Number.isNaN(incomingRate) &&
        Number(incomingRate).toFixed(4) !== Number(currentRate || 0).toFixed(4);
      if (rateChanged) {
        return res
          .status(403)
          .json({ error: 'You do not have permission to modify pay rates.' });
      }
    }

    let safeRate = currentRate;
    if (canModifyRates && incomingRate !== null && !Number.isNaN(incomingRate)) {
      safeRate = incomingRate;
    }

    const allowedLanguages = ['en', 'es', 'ht'];
    const normalizedLanguage = (() => {
      const raw = (language || '').toString().trim().toLowerCase();
      return allowedLanguages.includes(raw) ? raw : 'en';
    })();

    const isAdminFlag = is_admin ? 1 : 0;
    const usesTimekeepingFlag =
      uses_timekeeping === undefined || uses_timekeeping === null
        ? 1 // default ON if missing
        : (uses_timekeeping ? 1 : 0);

    const viewShipmentsFlag =
      kiosk_can_view_shipments ? 1 : 0; 

    db.run(
      `
      UPDATE employees
      SET
        rate = ?,
        is_admin = ?,
        uses_timekeeping = ?,
        nickname = ?,          -- 🔹 new
        name_on_checks = ?,     -- 🔹 new (optional, but you're already sending it)
        kiosk_can_view_shipments = ?,    -- 👈 NEW
        language = ?
      WHERE id = ?
      `,
      [
        safeRate,
        isAdminFlag,
        usesTimekeepingFlag,
        nickname || null,
        name_on_checks || null,
        viewShipmentsFlag,
        normalizedLanguage,
        id
      ],
      function (err) {
        if (err) {
          console.error('Error updating employee:', err);
          return res.status(500).json({ error: 'Failed to update employee.' });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Employee not found.' });
        }
        return res.json({
          id,
          rate: safeRate,
          is_admin: isAdminFlag,
          uses_timekeeping: usesTimekeepingFlag,
          nickname: nickname || null,
          name_on_checks: name_on_checks || null,
          language: normalizedLanguage
        });
      }
    );
  } catch (err) {
    console.error('Error in /api/employees:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

app.post('/api/employees/:id/active', requireAuth, (req, res) => {

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

// Lightweight endpoint just to update language (used by kiosk admin)
// Note: kiosk admin is PIN-gated in the UI, so we allow unauthenticated here.
app.post('/api/employees/:id/language', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ error: 'Invalid employee id.' });
  }

  const allowedLanguages = ['en', 'es', 'ht'];
  const raw = (req.body && req.body.language) || '';
  const lang = allowedLanguages.includes(String(raw).toLowerCase())
    ? String(raw).toLowerCase()
    : 'en';

  db.run(
    'UPDATE employees SET language = ? WHERE id = ?',
    [lang, id],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Employee not found.' });
      }
      res.json({ ok: true, language: lang });
    }
  );
});

// Lightweight endpoint to update Name on Checks (kiosk admin)
// Auth rules:
//  - If there is a logged-in session, allow.
//  - Otherwise, allow if a kiosk device_id + device_secret match a known kiosk (same as PIN endpoint).
app.post('/api/employees/:id/name-on-checks', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ error: 'Invalid employee id.' });
  }

  try {
    await ensureNameOnChecksColumns();
  } catch (err) {
    console.error('Error ensuring name_on_checks columns:', err);
    return res.status(500).json({ error: 'Database migration failed.' });
  }

  const raw = (req.body && req.body.name_on_checks) || '';
  const name = String(raw || '').trim();
  const normalized = name ? name : null;

  // Auth check (session OR kiosk device secret)
  const hasSession = req.session && req.session.userId;
  let kioskOk = false;

  if (!hasSession) {
    const { device_id, device_secret } = req.body || {};
    const devId = (device_id || '').trim();
    const devSecret = (device_secret || '').trim();
    if (devId && devSecret) {
      try {
        const kioskRow = await dbGet(
          'SELECT id, device_secret FROM kiosks WHERE device_id = ? LIMIT 1',
          [devId]
        );
        if (kioskRow) {
          let expected = kioskRow.device_secret || '';
          if (!expected && devSecret) {
            expected = devSecret;
            try {
              await dbRun(
                'UPDATE kiosks SET device_secret = ? WHERE id = ?',
                [devSecret, kioskRow.id]
              );
            } catch (errUpdate) {
              console.error('Failed to backfill kiosk device_secret:', errUpdate);
            }
          }
          if (expected && expected === devSecret) {
            kioskOk = true;
          }
        }
      } catch (err) {
        console.error('Error looking up kiosk by device_id:', err);
        return res.status(500).json({ error: 'Internal server error.' });
      }
    }
  }

  if (!hasSession && !kioskOk) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const empRow = await dbGet(
      `
        SELECT id, name, name_on_checks, vendor_qbo_id, employee_qbo_id
        FROM employees
        WHERE id = ?
        LIMIT 1
      `,
      [id]
    );

    if (!empRow) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    await dbRun(
      `
        UPDATE employees
        SET
          name_on_checks = ?,
          name_on_checks_updated_at = datetime('now')
        WHERE id = ?
      `,
      [normalized, id]
    );

    // Try to push to QuickBooks immediately if we have a payee ref
    let qboWarning = null;
    const payeeRef = empRow.vendor_qbo_id
      ? { value: empRow.vendor_qbo_id, type: 'Vendor' }
      : (empRow.employee_qbo_id ? { value: empRow.employee_qbo_id, type: 'Employee' } : null);
    if (payeeRef && normalized) {
      const qboRes = await setPrintOnCheckName(payeeRef, normalized);
      if (!qboRes?.ok && !qboRes?.skipped) {
        qboWarning = qboRes.error || 'Could not update QuickBooks.';
        console.warn('[NameOnChecks/QBO] Immediate update failed', {
          employee_id: id,
          payeeRef,
          error: qboWarning
        });
      } else if (qboRes?.ok && !qboRes.skipped) {
        await dbRun(
          `
            UPDATE employees
            SET name_on_checks_qbo_updated_at = datetime('now')
            WHERE id = ?
          `,
          [id]
        );
      }
    }

    res.json({ ok: true, id, name_on_checks: normalized, qbo_warning: qboWarning });
  } catch (err) {
    console.error('Error updating name_on_checks:', err);
    return res.status(500).json({ error: 'Failed to update name on checks.' });
  }
});

app.post('/api/employees/:id/pin', async (req, res) => {

  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ error: 'Invalid employee id.' });
  }

  const { pin, allowOverride, require_photo, device_id, device_secret } = req.body || {};

  // Allow either a normal logged-in session OR a registered kiosk device
  const hasSession = req.session && req.session.userId;
  let kioskOk = false;

  if (!hasSession) {
    const devId = (device_id || '').trim();
    const devSecret = (device_secret || '').trim();
    if (devId && devSecret) {
      try {
        const kioskRow = await dbGet(
          'SELECT id, device_secret FROM kiosks WHERE device_id = ? LIMIT 1',
          [devId]
        );
        if (kioskRow) {
          let expected = kioskRow.device_secret || '';

          // Auto-backfill a missing secret the first time we see a valid one from this device
          if (!expected) {
            expected = devSecret;
            try {
              await dbRun(
                'UPDATE kiosks SET device_secret = ? WHERE id = ?',
                [devSecret, kioskRow.id]
              );
            } catch (errUpdate) {
              console.error('Failed to backfill kiosk device_secret:', errUpdate);
            }
          }

          if (expected && expected === devSecret) {
            kioskOk = true;
          }
        }
      } catch (err) {
        console.error('Error looking up kiosk by device_id:', err);
        return res.status(500).json({ error: 'Internal server error.' });
      }
    }
  }

  if (!hasSession && !kioskOk) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Build the SET clause dynamically so we can optionally include require_photo
  const setParts = [];
  const params = [];

  // PIN logic:
  // - If allowOverride is true, we always set pin (can be null to clear).
  // - If allowOverride is false/omitted, we only set pin if it is currently NULL.
  const overrideFlag = allowOverride === true || allowOverride === 'true';
  let whereExtra = '';
  setParts.push('pin = ?');
  params.push(pin || null);
  if (!overrideFlag) {
    // Don't overwrite an existing PIN unless explicitly allowed
    whereExtra = ' AND pin IS NULL';
  }

  // Optional require_photo toggle
  const hasRequirePhoto =
    typeof require_photo === 'boolean' ||
    require_photo === 1 ||
    require_photo === '1';
  if (hasRequirePhoto) {
    const requirePhotoFlag =
      require_photo === true || require_photo === 'true' || require_photo === 1;
    setParts.push('require_photo = ?');
    params.push(requirePhotoFlag ? 1 : 0);
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

  try {
    const result = await dbRun(sql, params);

    if (!result || result.changes === 0) {
      return res.status(409).json({
        error: 'PIN already set for this employee. Use allowOverride to change it.'
      });
    }

    res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/* ───────── 5.5 SYNC (QuickBooks → SQLite ) ───────── */

app.post('/api/sync/vendors', requireAuth, async (req, res) => {

  try {
    const count = await syncVendors();
    res.json({ ok: true, message: `Synced ${count} vendor(s).` });
  } catch (err) {
    console.error('Sync vendors error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/sync/employees', requireAuth, async (req, res) => {

  try {
    const newEmployees = await syncEmployeesFromQuickBooks();
    res.json({
      ok: true,
      message: `Synced ${newEmployees} employee(s) from QuickBooks.`
    });
  } catch (err) {
    console.error('Sync employees error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ───────── 6. PROJECTS & TIME ENTRIES ───────── */

app.post('/api/sync/projects', requireAuth, async (req, res) => {

  try {
    const count = await syncProjects();
    res.json({ ok: true, message: `Synced ${count} project(s).` });
  } catch (err) {
    console.error('Sync projects error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Sync payroll accounts (bank/expense) for settings dropdowns
app.post('/api/sync/payroll-accounts', requireAuth, async (req, res) => {
  try {
    const { bankAccounts, expenseAccounts } = await listPayrollAccounts();
    res.json({
      ok: true,
      message: `Loaded ${bankAccounts.length} bank and ${expenseAccounts.length} expense accounts from QuickBooks.`,
      bankAccounts,
      expenseAccounts
    });
  } catch (err) {
    console.error('Sync payroll accounts error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/projects', requireAuth, async (req, res) => {
  const {
    id,
    name,
    customer_name,
    project_timezone,
    geo_lat,
    geo_lng,
    geo_radius
  } = req.body;

  const DEFAULT_RADIUS = 120; // 120 meters ≈ 400 feet
  const hasLatInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'geo_lat');
  const hasLngInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'geo_lng');
  const hasRadiusInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'geo_radius');

  const latInput =
    !hasLatInput || geo_lat === '' || geo_lat === null || geo_lat === undefined
      ? null
      : Number(geo_lat);
  const lngInput =
    !hasLngInput || geo_lng === '' || geo_lng === null || geo_lng === undefined
      ? null
      : Number(geo_lng);
  const radiusInput =
    !hasRadiusInput || geo_radius === '' || geo_radius === null || geo_radius === undefined
      ? DEFAULT_RADIUS
      : Number(geo_radius);

  if (hasLatInput && latInput !== null && Number.isNaN(latInput)) {
    return res.status(400).json({ error: 'Invalid geofence latitude.' });
  }
  if (hasLngInput && lngInput !== null && Number.isNaN(lngInput)) {
    return res.status(400).json({ error: 'Invalid geofence longitude.' });
  }
  if (hasRadiusInput && radiusInput !== null && Number.isNaN(radiusInput)) {
    return res.status(400).json({ error: 'Invalid geofence radius.' });
  }

  try {
    if (id) {
      const existing = await dbGet(
        `SELECT geo_lat, geo_lng, geo_radius FROM projects WHERE id = ?`,
        [id]
      );
      if (!existing) {
        return res.status(404).json({ error: 'Project not found.' });
      }

      const finalLat = hasLatInput ? latInput : existing.geo_lat;
      const finalLng = hasLngInput ? lngInput : existing.geo_lng;
      const finalRadius =
        hasRadiusInput ? radiusInput : existing.geo_radius;

      if ((finalLat === null) !== (finalLng === null)) {
        return res.status(400).json({
          error: 'Please enter both latitude and longitude, or leave both blank.'
        });
      }
      if (
        (finalLat !== null && Number.isNaN(finalLat)) ||
        (finalLng !== null && Number.isNaN(finalLng))
      ) {
        return res.status(400).json({ error: 'Invalid geofence coordinates.' });
      }
      if (finalRadius !== null && Number.isNaN(finalRadius)) {
        return res.status(400).json({ error: 'Invalid geofence radius.' });
      }

      const updateRes = await dbRun(
        `
          UPDATE projects
          SET geo_lat = ?, geo_lng = ?, geo_radius = ?, project_timezone = ?
          WHERE id = ?
        `,
        [finalLat, finalLng, finalRadius, project_timezone || null, id]
      );

      if (!updateRes || updateRes.changes === 0) {
        return res.status(404).json({ error: 'Project not found.' });
      }

      return res.json({ ok: true, id });
    }

    // (Optional) manual project insert – here name IS required
    if (!name) {
      return res.status(400).json({ error: 'Project name is required.' });
    }

    const finalLat = hasLatInput ? latInput : null;
    const finalLng = hasLngInput ? lngInput : null;
    const finalRadius = hasRadiusInput ? radiusInput : DEFAULT_RADIUS;

    if ((finalLat === null) !== (finalLng === null)) {
      return res.status(400).json({
        error: 'Please enter both latitude and longitude, or leave both blank.'
      });
    }
    if (
      (finalLat !== null && Number.isNaN(finalLat)) ||
      (finalLng !== null && Number.isNaN(finalLng))
    ) {
      return res.status(400).json({ error: 'Invalid geofence coordinates.' });
    }
    if (finalRadius !== null && Number.isNaN(finalRadius)) {
      return res.status(400).json({ error: 'Invalid geofence radius.' });
    }

    const insert = await dbRun(
      `
        INSERT INTO projects (name, customer_name, project_timezone, geo_lat, geo_lng, geo_radius)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [name, customer_name || null, project_timezone || null, finalLat, finalLng, finalRadius]
    );

    return res.json({ ok: true, id: insert.lastID });
  } catch (err) {
    console.error('Error saving project:', err);
    return res.status(500).json({ error: 'Failed to save project.' });
  }
});

// ───────── SETTINGS (APP-WIDE) ─────────
app.get('/api/settings', requireAuth, async (req, res) => {
  try {
    const rows = await dbAll('SELECT key, value FROM app_settings', []);
    const data = {};
    (rows || []).forEach(r => {
      data[r.key] = r.value;
    });
    res.json({ settings: data });
  } catch (err) {
    console.error('Error loading settings:', err);
    res.status(500).json({ error: 'Failed to load settings.' });
  }
});

app.post('/api/settings', requireAuth, express.json(), async (req, res) => {
  try {
    const settings = req.body || {};
    const entries = Object.entries(settings);

    await Promise.all(
      entries.map(([key, value]) =>
        dbRun(
          `
            INSERT INTO app_settings (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
          `,
          [key, value == null ? '' : String(value)]
        )
      )
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Error saving settings:', err);
    res.status(500).json({ error: 'Failed to save settings.' });
  }
});

// Kiosk-safe settings fetch (no auth cookie needed)
app.get('/api/kiosk/settings', async (req, res) => {
  try {
    const rows = await dbAll('SELECT key, value FROM app_settings', []);
    const data = {};
    (rows || []).forEach(r => {
      data[r.key] = r.value;
    });
    res.json({ settings: data });
  } catch (err) {
    console.error('Error loading kiosk settings:', err);
    res.status(500).json({ error: 'Failed to load settings.' });
  }
});


async function getExceptionActor(req, fallbackName) {
  const actorUserId = (req.session && req.session.userId) || null;
  const actorEmployeeId = (req.session && req.session.employeeId) || null;

  let actorName = fallbackName || null;

  if (!actorName && actorEmployeeId) {
    const emp = await dbGet(
      'SELECT name, name_on_checks, email FROM employees WHERE id = ?',
      [actorEmployeeId]
    );
    if (emp) {
      actorName = emp.name_on_checks || emp.name || emp.email || actorName;
    }
  }

  if (!actorName && actorUserId) {
    const user = await dbGet(
      'SELECT email FROM users WHERE id = ?',
      [actorUserId]
    );
    actorName = (user && user.email) || actorName;
  }

  return { actorUserId, actorEmployeeId, actorName };
}

function pickFields(obj, keys = []) {
  if (!obj) return {};
  return keys.reduce((acc, key) => {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      acc[key] = obj[key];
    }
    return acc;
  }, {});
}

app.get('/api/time-exceptions', requireAuth, async (req, res) => {
  try {
    const {
      start,
      end,
      employee_id,
      project_id,
      hide_resolved
    } = req.query || {};

    if (!start || !end) {
      return res
        .status(400)
        .json({ error: 'start and end (YYYY-MM-DD) are required.' });
    }

    const params = [];
    let where = 'WHERE 1=1 ';

    // Date range using clock_in_ts
    where +=
      'AND date(tp.clock_in_ts) >= date(?) AND date(tp.clock_in_ts) <= date(?) ';
    params.push(start, end);

    if (employee_id) {
      where += 'AND tp.employee_id = ? ';
      params.push(employee_id);
    }
    if (project_id) {
      where += 'AND tp.project_id = ? ';
      params.push(project_id);
    }

    // 🔹 Optionally hide already-resolved exceptions
    if (
      hide_resolved === '1' ||
      hide_resolved === 'true' ||
      hide_resolved === 'yes'
    ) {
      where += 'AND IFNULL(tp.exception_resolved, 0) = 0 ';
    }

    // Pull punches + employee/project + geofence + exception info
    const rows = await dbAll(
      `
      SELECT
        tp.id,
        tp.employee_id,
        tp.project_id,
        tp.clock_in_ts,
        tp.clock_out_ts,
        tp.clock_out_project_id,
        tp.clock_in_lat,
        tp.clock_in_lng,
        tp.clock_out_lat,
        tp.clock_out_lng,

        -- exception-related fields
        tp.auto_clock_out,
        tp.auto_clock_out_reason,
        tp.exception_resolved,
        tp.exception_review_status,
        tp.exception_review_note,
        tp.exception_reviewed_by,
        tp.exception_reviewed_at,
        tp.geo_violation,

        e.name AS employee_name,
        p.name AS project_name,
        p.customer_name,
        p.geo_lat,
        p.geo_lng,
        p.geo_radius
      FROM time_punches tp
      JOIN employees e ON tp.employee_id = e.id
      LEFT JOIN projects p ON tp.project_id = p.id
      ${where}
      ORDER BY tp.clock_in_ts ASC
      `,
      params
    );

    // Load app-wide settings so we can honor disabled rules
    const settingsRows = await dbAll('SELECT key, value FROM app_settings', []);
    const settingsMap = {};
    (settingsRows || []).forEach(r => {
      settingsMap[r.key] = r.value;
    });

    let exceptionRules = null;
    try {
      if (settingsMap.time_exception_rules) {
        const parsed = JSON.parse(settingsMap.time_exception_rules);
        if (parsed && typeof parsed === 'object') {
          exceptionRules = parsed;
        }
      }
    } catch {
      exceptionRules = null;
    }

    const isRuleEnabled = key => {
      if (!exceptionRules || typeof exceptionRules !== 'object') return true;
      const val = exceptionRules[key];
      return !(
        val === false ||
        val === 'false' ||
        val === 0 ||
        val === '0'
      );
    };

    // Helper to normalize a timestamp to the Monday that starts its ISO week
    const getWeekStart = dateObj => {
      const d = new Date(
        Date.UTC(
          dateObj.getUTCFullYear(),
          dateObj.getUTCMonth(),
          dateObj.getUTCDate()
        )
      );
      const day = d.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
      const diff = day === 0 ? -6 : 1 - day;
      d.setUTCDate(d.getUTCDate() + diff);
      return d.toISOString().slice(0, 10);
    };

    const WEEKLY_HOURS_THRESHOLD = 50;
    const punchWeekTotals = new Map();

    // First pass: compute durations and weekly totals per employee
    const punchRows = rows.map(r => {
      const startTs = r.clock_in_ts ? new Date(r.clock_in_ts) : null;
      const endTs = r.clock_out_ts ? new Date(r.clock_out_ts) : null;

      const startValid = startTs && !Number.isNaN(startTs.getTime());
      const endValid = endTs && !Number.isNaN(endTs.getTime());

      let durationHours = null;
      if (startValid && endValid) {
        durationHours = (endTs - startTs) / (1000 * 60 * 60);
      }

      const weekKey = startValid ? getWeekStart(startTs) : null;
      if (weekKey && durationHours !== null) {
        const mapKey = `${r.employee_id}|${weekKey}`;
        punchWeekTotals.set(
          mapKey,
          (punchWeekTotals.get(mapKey) || 0) + durationHours
        );
      }

      return { row: r, startTs, endTs, durationHours, weekKey };
    });

    const weeksOverThreshold = new Map();
    for (const [key, hours] of punchWeekTotals.entries()) {
      if (hours > WEEKLY_HOURS_THRESHOLD) {
        weeksOverThreshold.set(key, hours);
      }
    }

    const flagged = [];

    for (const { row: r, startTs, endTs, durationHours, weekKey } of punchRows) {
      const flags = [];

      // 1) Missing clock-out
      if (isRuleEnabled('missing_clock_out') && !r.clock_out_ts) {
        flags.push('Missing clock-out');
      }

      // 2) Long shift (> 12h)
      if (isRuleEnabled('long_shift') && durationHours !== null && durationHours > 12) {
        flags.push('Long shift (>12h)');
      }

      // 3) Multi-day (>= 24h)
      if (isRuleEnabled('multi_day') && durationHours !== null && durationHours >= 24) {
        flags.push('Multi-day shift');
      }

      // 4) Crosses midnight
      if (isRuleEnabled('crosses_midnight') && startTs && endTs) {
        const startDateStr = startTs.toISOString().slice(0, 10);
        const endDateStr = endTs.toISOString().slice(0, 10);
        if (startDateStr !== endDateStr) {
          flags.push('Crosses midnight');
        }
      }

      // 5) No project
      if (isRuleEnabled('no_project') && r.project_id == null) {
        flags.push('No project selected');
      }

      // 5b) Clock-out project differs from clock-in
      if (
        isRuleEnabled('project_mismatch') &&
        r.clock_out_project_id != null &&
        r.project_id != null &&
        Number(r.clock_out_project_id) !== Number(r.project_id)
      ) {
        flags.push('Clock-out project differs from clock-in');
      }

      // 6) Tiny punch (< 5 minutes)
      if (isRuleEnabled('tiny_punch') && durationHours !== null && durationHours > 0) {
        const minutes = durationHours * 60;
        if (minutes < 5) {
          flags.push('Tiny punch (<5 min)');
        }
      }

      // 6b) Weekly overtime threshold
      if (weekKey) {
        const weeklyHours = weeksOverThreshold.get(`${r.employee_id}|${weekKey}`);
        if (weeklyHours && isRuleEnabled('weekly_hours')) {
          flags.push(
            `Week of ${weekKey} exceeds ${WEEKLY_HOURS_THRESHOLD}h (${weeklyHours.toFixed(2)}h)`
          );
        }
      }

      // 7) Geofence mismatch (in / out)
      const hasProjectGeofence =
        r.geo_lat != null &&
        r.geo_lng != null &&
        r.geo_radius != null &&
        !Number.isNaN(r.geo_lat) &&
        !Number.isNaN(r.geo_lng) &&
        !Number.isNaN(r.geo_radius);

      if (hasProjectGeofence) {
        // Clock-in geofence
        if (
          isRuleEnabled('geofence_clock_in') &&
          r.clock_in_lat != null &&
          r.clock_in_lng != null
        ) {
          const dIn = distanceMeters(
            Number(r.clock_in_lat),
            Number(r.clock_in_lng),
            Number(r.geo_lat),
            Number(r.geo_lng)
          );
          if (dIn > r.geo_radius) {
            flags.push('Clock-in outside geofence');
          }
        }

        // Clock-out geofence
        if (
          isRuleEnabled('geofence_clock_out') &&
          r.clock_out_lat != null &&
          r.clock_out_lng != null
        ) {
          const dOut = distanceMeters(
            Number(r.clock_out_lat),
            Number(r.clock_out_lng),
            Number(r.geo_lat),
            Number(r.geo_lng)
          );
          if (dOut > r.geo_radius) {
            flags.push('Clock-out outside geofence');
          }
        }
      }

      // 8) Auto clock-out (midnight job or any auto close)
      if (isRuleEnabled('auto_clock_out') && r.auto_clock_out) {
        const reason = r.auto_clock_out_reason || '';
        if (reason === 'midnight_auto') {
          flags.push('Auto clock-out (midnight job)');
        } else {
          flags.push('Auto clock-out');
        }
      }

            // Derive a coarse category for this exception row
      // (used for filters and grouping later)
      const hasGeoFlag = flags.some(f =>
        f.toLowerCase().includes('geofence')
      );

      let category = 'time';
      if (r.auto_clock_out) {
        category = 'auto_clock_out';
      } else if (hasGeoFlag) {
        category = 'geofence';
      } else {
        category = 'time';
      }


      if (!flags.length) continue;

         flagged.push({
        id: r.id,
        source: 'punch',   // this row is based on a single punch
        category,          // 👈 NEW
        employee_id: r.employee_id,
        employee_name: r.employee_name || '(Unknown)',
        project_id: r.project_id,
        project_name:
          r.customer_name && r.project_name
            ? `${r.customer_name} – ${r.project_name}`
            : r.project_name || '(No project)',
        clock_in_ts: r.clock_in_ts,
        clock_out_ts: r.clock_out_ts,
        duration_hours: durationHours,
        flags,
        resolved: r.exception_resolved ? 1 : 0,
        review_status: r.exception_review_status || 'open',
        review_note: r.exception_review_note || null,
        review_by: r.exception_reviewed_by || null,
        review_at: r.exception_reviewed_at || null,
        has_geo_violation: r.geo_violation ? 1 : 0,
        auto_clock_out: r.auto_clock_out ? 1 : 0,
        auto_clock_out_reason: r.auto_clock_out_reason || null
      });

    }

//
    // ───────── 2) TIME ENTRIES vs PUNCHES DISCREPANCIES ─────────
    //
    // For each time entry in the date range, compare:
    //   - t.hours            (what the timesheet says)
    //   - sum(punch hours)   (what the kiosk punches show)
    // and raise flags if they are far apart, or if there are
    // entries with no punches at all.
    //

    const entryWhere = [];
    const entryParams = [];

    // Date range for entries (simple assumption: entries are per-day)
    entryWhere.push('t.start_date >= ?');
    entryParams.push(start);
    entryWhere.push('t.end_date <= ?');
    entryParams.push(end);

    if (employee_id) {
      entryWhere.push('t.employee_id = ?');
      entryParams.push(employee_id);
    }

    if (project_id) {
      entryWhere.push('t.project_id = ?');
      entryParams.push(project_id);
    }

    // Respect hide_resolved for time entries, too
    if (
      hide_resolved === '1' ||
      hide_resolved === 'true' ||
      hide_resolved === 'yes'
    ) {
      entryWhere.push('IFNULL(t.resolved, 0) = 0');
    }

    const entrySql = `
      SELECT
        t.id,
        t.employee_id,
        t.project_id,
        t.start_date,
        t.end_date,
        t.start_time,
        t.end_time,
        t.hours,
        t.resolved,
        t.resolved_status,
        t.resolved_note,
        t.resolved_at,
        t.resolved_by,

        e.name AS employee_name,
        p.name AS project_name,
        p.customer_name,

        COUNT(tp.id) AS punch_count,

        -- sum of punch durations (in hours) for this entry
        SUM(
          CASE
            WHEN tp.clock_in_ts IS NOT NULL AND tp.clock_out_ts IS NOT NULL
            THEN (julianday(tp.clock_out_ts) - julianday(tp.clock_in_ts)) * 24.0
            ELSE 0
          END
        ) AS punch_hours

      FROM time_entries t
      LEFT JOIN employees e ON t.employee_id = e.id
      LEFT JOIN projects  p ON t.project_id  = p.id
      LEFT JOIN time_punches tp ON tp.time_entry_id = t.id
      ${entryWhere.length ? 'WHERE ' + entryWhere.join(' AND ') : ''}
      GROUP BY
        t.id,
        t.employee_id,
        t.project_id,
        t.start_date,
        t.end_date,
        t.start_time,
        t.end_time,
        t.hours,
        t.resolved,
        t.resolved_status,
        t.resolved_note,
        t.resolved_at,
        t.resolved_by,
        employee_name,
        project_name,
        customer_name
    `;

    const entryRows = await dbAll(entrySql, entryParams);

    // How far apart entry vs punches must be (in hours) before we flag it
    const HOURS_EPSILON = 0.10; // 0.10h ≈ 6 minutes

    for (const te of entryRows) {
      const entryFlags = [];

      const entryHours =
        te.hours != null && !Number.isNaN(Number(te.hours))
          ? Number(te.hours)
          : null;

      const punchHoursRaw =
        te.punch_hours != null && !Number.isNaN(Number(te.punch_hours))
          ? Number(te.punch_hours)
          : 0;

      const punchCount = te.punch_count || 0;

      if (isRuleEnabled('manual_no_punches') && !punchCount) {
        // Case A: manual timesheet entry, but no punches linked at all
        entryFlags.push('Manual time entry with no punches');
      } else if (isRuleEnabled('manual_hours_mismatch') && entryHours != null) {
        // Case B: both exist, but hours do not match
        const diff = punchHoursRaw - entryHours;
        if (Math.abs(diff) >= HOURS_EPSILON) {
          const fmtEntry  = entryHours.toFixed(2);
          const fmtPunch  = punchHoursRaw.toFixed(2);
          const fmtDiff   = diff.toFixed(2);
          entryFlags.push(
            `Manual hours ${fmtEntry}h vs punches ${fmtPunch}h (Δ ${fmtDiff}h)`
          );
        }
      }

      // Only add to Time Exceptions if we actually found a problem
      if (!entryFlags.length) continue;

      // Synthesize timestamps for display in the existing columns
      let syntheticStartTs = null;
      let syntheticEndTs = null;

      if (te.start_date) {
        const startTime = te.start_time || '00:00';
        syntheticStartTs = `${te.start_date}T${startTime}:00`;
      }

      if (te.end_date) {
        const endTime = te.end_time || te.start_time || '00:00';
        syntheticEndTs = `${te.end_date}T${endTime}:00`;
      }

      flagged.push({
        id: te.id,
        source: 'time_entry',           // 👈 NEW SOURCE TYPE
        category: 'time_vs_punch',      // 👈 NEW CATEGORY

        employee_id: te.employee_id,
        employee_name: te.employee_name || '(Unknown)',

        project_id: te.project_id,
        project_name:
          te.customer_name && te.project_name
            ? `${te.customer_name} – ${te.project_name}`
            : te.project_name || '(No project)',

        clock_in_ts: syntheticStartTs,
        clock_out_ts: syntheticEndTs,

        // Use the time entry's hours as the "duration"
        duration_hours: entryHours,

        flags: entryFlags,

        // Hook into the time_entries.resolved flag you already have
        resolved: te.resolved ? 1 : 0,
        review_status: te.resolved_status || 'open',
        review_note: te.resolved_note || null,
        review_by: te.resolved_by || null,
        review_at: te.resolved_at || null,

        // These exceptions are about hours mismatch, not geofence/auto
        has_geo_violation: 0,
        auto_clock_out: 0,
        auto_clock_out_reason: null
      });
    }

    res.json(flagged);
  } catch (err) {
    console.error('Error loading time exceptions:', err);
    res.status(500).json({ error: 'Failed to load time exceptions.' });
  }
});



app.post('/api/time-exceptions/:id/review', requireAuth, async (req, res) => {
  const exceptionId = Number(req.params.id);
  const {
    source,          // 'punch' | 'time_entry'
    action,          // 'approve' | 'modify' | 'reject'
    note,
    actor_name,
    updates = {}
  } = req.body || {};

  // Small helpers for validation
  const toDate = value => {
    if (value == null) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const dateOnly = value => {
    const d = toDate(value);
    return d ? d.toISOString().slice(0, 10) : null;
  };

  const parseHm = value => {
    if (value == null) return null;
    const m = /^([0-1]?\d|2[0-3]):([0-5]\d)$/.exec(String(value));
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  };

  const allowedSources = ['punch', 'time_entry'];
  const allowedActions = ['approve', 'modify', 'reject'];

  if (!exceptionId || !allowedSources.includes(source)) {
    return res.status(400).json({ ok: false, error: 'Invalid exception payload.' });
  }
  if (!allowedActions.includes(action)) {
    return res.status(400).json({ ok: false, error: 'Invalid action.' });
  }
  if ((action === 'modify' || action === 'reject') && (!note || !note.trim())) {
    return res
      .status(400)
      .json({ ok: false, error: 'A note is required when rejecting or modifying.' });
  }

  try {
    const { actorUserId, actorEmployeeId, actorName } =
      await getExceptionActor(req, note ? actor_name : actor_name || null);

    const nowIso = new Date().toISOString();
    const statusVal =
      action === 'approve'
        ? 'approved'
        : action === 'reject'
          ? 'rejected'
          : 'modified';

    let before = {};
    let after = {};

    if (source === 'punch') {
      const punch = await dbGet('SELECT * FROM time_punches WHERE id = ?', [
        exceptionId
      ]);
      if (!punch) {
        return res.status(404).json({ ok: false, error: 'Punch not found.' });
      }

      before = pickFields(punch, [
        'clock_in_ts',
        'clock_out_ts',
        'project_id',
        'clock_out_project_id'
      ]);


      const sets = [];
      const params = [];

      if (action === 'modify') {
        // ───────── Validation for punch modifications ─────────
        const finalClockIn =
          updates.clock_in_ts !== undefined && updates.clock_in_ts !== ''
            ? updates.clock_in_ts
            : punch.clock_in_ts;
        const finalClockOut =
          updates.clock_out_ts !== undefined && updates.clock_out_ts !== ''
            ? updates.clock_out_ts
            : punch.clock_out_ts;

        const clockInDate = finalClockIn ? toDate(finalClockIn) : null;
        const clockOutDate = finalClockOut ? toDate(finalClockOut) : null;

        if (finalClockIn && !clockInDate) {
          return res.status(400).json({ ok: false, error: 'Invalid clock-in timestamp.' });
        }
        if (finalClockOut && !clockOutDate) {
          return res.status(400).json({ ok: false, error: 'Invalid clock-out timestamp.' });
        }
        if (clockInDate && clockOutDate) {
          if (clockOutDate < clockInDate) {
            return res
              .status(400)
              .json({ ok: false, error: 'Clock-out cannot be before clock-in.' });
          }

          const inDay = dateOnly(clockInDate);
          const outDay = dateOnly(clockOutDate);
          if (inDay && outDay && inDay !== outDay) {
            return res.status(400).json({
              ok: false,
              error: 'Clock-in and clock-out must stay on the same day when modifying a punch.'
            });
          }

          const durationHours = (clockOutDate - clockInDate) / (1000 * 60 * 60);
          if (durationHours > 24) {
            return res.status(400).json({
              ok: false,
              error: 'A single punch cannot span more than 24 hours.'
            });
          }
        }

        const finalProjectIdRaw =
          updates.project_id !== undefined ? updates.project_id : punch.project_id;
        const finalOutProjectIdRaw =
          updates.clock_out_project_id !== undefined
            ? updates.clock_out_project_id
            : punch.clock_out_project_id !== undefined
              ? punch.clock_out_project_id
              : null;

        const finalProjectId =
          finalProjectIdRaw === '' || finalProjectIdRaw == null
            ? null
            : Number(finalProjectIdRaw);
        if (
          updates.project_id !== undefined &&
          finalProjectIdRaw !== '' &&
          finalProjectIdRaw != null &&
          Number.isNaN(finalProjectId)
        ) {
          return res
            .status(400)
            .json({ ok: false, error: 'Project must be a valid project ID.' });
        }

        const finalOutProjectId =
          finalOutProjectIdRaw === '' || finalOutProjectIdRaw == null
            ? null
            : Number(finalOutProjectIdRaw);
        if (
          updates.clock_out_project_id !== undefined &&
          finalOutProjectIdRaw !== '' &&
          finalOutProjectIdRaw != null &&
          Number.isNaN(finalOutProjectId)
        ) {
          return res.status(400).json({
            ok: false,
            error: 'Clock-out project must be a valid project ID.'
          });
        }

        if (finalOutProjectId != null && finalProjectId == null) {
          return res.status(400).json({
            ok: false,
            error: 'Cannot set a clock-out project without a clock-in project.'
          });
        }

        const resolvedOutProjectId =
          finalOutProjectId == null ? finalProjectId : finalOutProjectId;

        if (
          finalProjectId != null &&
          resolvedOutProjectId != null &&
          finalProjectId !== resolvedOutProjectId
        ) {
          return res.status(400).json({
            ok: false,
            error: 'Clock-in and clock-out projects must match when modifying a punch.'
          });
        }

        sets.push('clock_in_ts = ?');
        params.push(finalClockIn || null);

        sets.push('clock_out_ts = ?');
        params.push(finalClockOut || null);

        sets.push('project_id = ?');
        params.push(finalProjectId == null ? null : finalProjectId);

        sets.push('clock_out_project_id = ?');
        params.push(resolvedOutProjectId == null ? null : resolvedOutProjectId);
      }

      sets.push('exception_resolved = 1');
      sets.push('exception_resolved_at = ?');
      params.push(nowIso);

      sets.push('exception_resolved_by = ?');
      params.push(actorName || 'admin');

      sets.push('exception_review_status = ?');
      params.push(statusVal);

      sets.push('exception_review_note = ?');
      params.push(note || null);

      sets.push('exception_reviewed_by = ?');
      params.push(actorName || null);

      sets.push('exception_reviewed_at = ?');
      params.push(nowIso);

      await dbRun(
        `
          UPDATE time_punches
          SET ${sets.join(', ')}
          WHERE id = ?
        `,
        [...params, exceptionId]
      );

      const updated = await dbGet('SELECT * FROM time_punches WHERE id = ?', [
        exceptionId
      ]);
      after = pickFields(updated, [
        'clock_in_ts',
        'clock_out_ts',
        'project_id',
        'clock_out_project_id'
      ]);
    } else {
      const entry = await dbGet('SELECT * FROM time_entries WHERE id = ?', [
        exceptionId
      ]);
      if (!entry) {
        return res.status(404).json({ ok: false, error: 'Time entry not found.' });
      }

      before = pickFields(entry, [
        'start_date',
        'end_date',
        'start_time',
        'end_time',
        'hours',
        'project_id'
      ]);

      const sets = [];
      const params = [];

      if (action === 'modify') {
        const finalStartDate = updates.start_date || entry.start_date;
        const finalEndDate = updates.end_date || entry.end_date || finalStartDate;

        if (!finalStartDate || !finalEndDate) {
          return res.status(400).json({
            ok: false,
            error: 'Start and end dates are required when modifying a time entry.'
          });
        }

        if (finalStartDate !== finalEndDate) {
          return res.status(400).json({
            ok: false,
            error: 'Time entry modifications must stay within a single day.'
          });
        }

        const finalStartTime = updates.start_time !== undefined ? updates.start_time : entry.start_time;
        const finalEndTime = updates.end_time !== undefined ? updates.end_time : entry.end_time;

        const startMinutes = finalStartTime ? parseHm(finalStartTime) : null;
        const endMinutes = finalEndTime ? parseHm(finalEndTime) : null;

        if (finalStartTime && startMinutes == null) {
          return res.status(400).json({ ok: false, error: 'Invalid start time format.' });
        }
        if (finalEndTime && endMinutes == null) {
          return res.status(400).json({ ok: false, error: 'Invalid end time format.' });
        }
        if (startMinutes != null && endMinutes != null && endMinutes < startMinutes) {
          return res.status(400).json({
            ok: false,
            error: 'End time cannot be before start time.'
          });
        }
        if (startMinutes != null && endMinutes != null) {
          const durationHours = (endMinutes - startMinutes) / 60;
          if (durationHours > 24) {
            return res.status(400).json({
              ok: false,
              error: 'A single time entry cannot span more than 24 hours.'
            });
          }
        }

        const finalHours =
          updates.hours !== undefined
            ? Number(updates.hours)
            : entry.hours != null
              ? Number(entry.hours)
              : null;
        if (updates.hours !== undefined && Number.isNaN(finalHours)) {
          return res.status(400).json({ ok: false, error: 'Hours must be numeric.' });
        }
        if (finalHours != null && (finalHours < 0 || finalHours > 24)) {
          return res.status(400).json({
            ok: false,
            error: 'Hours must be between 0 and 24 when modifying a time entry.'
          });
        }

        const finalProjectIdRaw =
          updates.project_id !== undefined ? updates.project_id : entry.project_id;
        const finalProjectId =
          finalProjectIdRaw === '' || finalProjectIdRaw == null
            ? null
            : Number(finalProjectIdRaw);
        if (
          updates.project_id !== undefined &&
          finalProjectIdRaw !== '' &&
          finalProjectIdRaw != null &&
          Number.isNaN(finalProjectId)
        ) {
          return res
            .status(400)
            .json({ ok: false, error: 'Project must be a valid project ID.' });
        }

        sets.push('start_date = ?');
        params.push(finalStartDate);

        sets.push('end_date = ?');
        params.push(finalEndDate);

        sets.push('start_time = ?');
        params.push(finalStartTime || null);

        sets.push('end_time = ?');
        params.push(finalEndTime || null);

        sets.push('hours = ?');
        params.push(finalHours);

        sets.push('project_id = ?');
        params.push(finalProjectId == null ? null : finalProjectId);
      }

      sets.push('resolved = 1');
      sets.push('resolved_at = ?');
      params.push(nowIso);

      sets.push('resolved_by = ?');
      params.push(actorName || 'admin');

      sets.push('resolved_status = ?');
      params.push(statusVal);

      sets.push('resolved_note = ?');
      params.push(note || null);

      await dbRun(
        `
          UPDATE time_entries
          SET ${sets.join(', ')}
          WHERE id = ?
        `,
        [...params, exceptionId]
      );

      const updated = await dbGet('SELECT * FROM time_entries WHERE id = ?', [
        exceptionId
      ]);
      after = pickFields(updated, [
        'start_date',
        'end_date',
        'start_time',
        'end_time',
        'hours',
        'project_id'
      ]);
    }

    const changePayload = {
      action,
      status: statusVal,
      before,
      after,
      note: note || null
    };

    await dbRun(
      `
        INSERT INTO time_exception_actions
          (source_type, source_id, action, actor_user_id, actor_employee_id, actor_name, note, changes_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        source,
        exceptionId,
        action,
        actorUserId || null,
        actorEmployeeId || null,
        actorName || null,
        note || null,
        JSON.stringify(changePayload)
      ]
    );

    res.json({ ok: true, status: statusVal });
  } catch (err) {
    console.error('Error reviewing time exception:', err);
    res.status(500).json({ ok: false, error: 'Failed to review exception.' });
  }
});

app.post('/api/time-exceptions/:id/resolve', requireAuth, async (req, res) => {
  const punchId = Number(req.params.id);
  if (!punchId) {
    return res.status(400).json({ ok: false, error: 'Invalid punch ID.' });
  }

  try {
    const { actorName } = await getExceptionActor(req, null);
    const punch = await dbGet(
      'SELECT id, exception_resolved FROM time_punches WHERE id = ?',
      [punchId]
    );

    if (!punch) {
      return res.status(404).json({ ok: false, error: 'Punch not found.' });
    }

    if (punch.exception_resolved) {
      return res.json({ ok: true, alreadyResolved: true });
    }

    await dbRun(
      `
        UPDATE time_punches
        SET exception_resolved = 1,
            exception_resolved_at = datetime('now'),
            exception_resolved_by = ?,
            exception_review_status = 'approved',
            exception_reviewed_by = ?,
            exception_reviewed_at = datetime('now')
        WHERE id = ?
      `,
      [actorName || 'admin', actorName || null, punchId]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Error resolving exception:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/time-punches/open', requireAuth, (req, res) => {
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

app.get('/api/projects', requireAuth, (req, res) => {
  const status = req.query.status || 'active'; // 'active' | 'inactive' | 'all'

  let whereClause = '';
  const params = [];

  if (status === 'active') {
    whereClause = 'WHERE IFNULL(active, 1) = 1';
  } else if (status === 'inactive') {
    whereClause = 'WHERE IFNULL(active, 1) = 0';
  } else {
    // all → no where clause
    whereClause = '';
  }

  const sql = `
    SELECT *
    FROM projects
    ${whereClause}
    ORDER BY customer_name, name
  `;

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.get('/api/time-entries', requireAuth, (req, res) => {
  let { start, end, employee_id, project_id } = req.query;

  // If nothing specified, default to "today"
  if (!start && !end && !employee_id && !project_id) {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const today = `${yyyy}-${mm}-${dd}`;
    start = today;
    end = today;
  }

  let sql = `
    SELECT
      t.id,
      t.employee_id,
      t.project_id,
      t.start_date,
      t.end_date,
      t.start_time,
      t.end_time,
      t.hours,
      t.total_pay,
      t.paid,
      t.paid_date,
      t.verified,
      t.verified_at,
      t.verified_by_employee_id,
      t.resolved,
      t.resolved_at,
      t.resolved_by,
      e.name AS employee_name,
      p.name AS project_name,

      -- Exception / flag info aggregated from punches
      COALESCE(MAX(tp.geo_violation), 0)      AS has_geo_violation,
      COALESCE(MAX(tp.auto_clock_out), 0)     AS has_auto_clock_out,
      COALESCE(MAX(tp.exception_resolved), 0) AS punch_exception_resolved
    FROM time_entries t
    LEFT JOIN employees e ON t.employee_id = e.id
    LEFT JOIN projects  p ON t.project_id = p.id
    LEFT JOIN time_punches tp ON tp.time_entry_id = t.id
  `;

  const where = [];
  const params = [];

  if (start) {
    where.push('t.start_date >= ?');
    params.push(start);
  }
  if (end) {
    where.push('t.end_date <= ?');
    params.push(end);
  }
  if (employee_id) {
    where.push('t.employee_id = ?');
    params.push(employee_id);
  }
  if (project_id) {
    where.push('t.project_id = ?');
    params.push(project_id);
  }

  if (where.length) {
    sql += ' WHERE ' + where.join(' AND ');
  }

  sql += `
    GROUP BY
      t.id,
      t.employee_id,
      t.project_id,
      t.start_date,
      t.end_date,
      t.start_time,
      t.end_time,
      t.hours,
      t.total_pay,
      t.paid,
      t.paid_date,
      t.verified,
      t.verified_at,
      t.verified_by_employee_id,
      t.resolved,
      t.resolved_at,
      t.resolved_by,
      e.name,
      p.name
    ORDER BY t.start_date DESC, t.id DESC
    LIMIT 200
  `;

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('Error fetching time entries:', err.message);
      return res.status(500).json({ error: err.message });
    }
    res.json(rows || []);
  });
});


app.post('/api/time-entries', requireAuth, (req, res) => {
  const { employee_id, project_id, start_date, end_date, start_time, end_time, hours } = req.body;

  // Trim string inputs to block empty/whitespace-only dates/times
  const startDate = (start_date || '').trim();
  const endDate = (end_date || '').trim();
  const startTime = (start_time || '').trim();
  const endTime = (end_time || '').trim();

  if (!employee_id || !project_id || !startDate || !endDate || !startTime || !endTime || hours == null) {
    return res.status(400).json({
      error:
        'employee_id, project_id, start_date, end_date, start_time, end_time, and hours are required.'
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
    (employee_id, project_id, start_date, end_date, start_time, end_time, hours, total_pay)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  [employee_id, project_id, startDate, endDate, startTime, endTime, parsedHours, total_pay],
  function (err2) {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ ok: true, id: this.lastID, total_pay });
        }
      );
    }
  );
});

app.post('/api/time-entries/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const {
    employee_id,
    project_id,
    start_date,
    end_date,
    start_time,
    end_time,
    hours,
    note
  } = req.body || {};

  const startDate = (start_date || '').trim();
  const endDate = (end_date || '').trim();
  const startTime = (start_time || '').trim();
  const endTime = (end_time || '').trim();

  const empIdNum = Number(employee_id);
  const projIdNum = Number(project_id);
  const hoursNum = Number(hours);

  if (
    !id ||
    !empIdNum ||
    !projIdNum ||
    !startDate ||
    !endDate ||
    Number.isNaN(hoursNum)
  ) {
    return res.status(400).json({
      error:
        'employee_id, project_id, start_date, end_date, and numeric hours are required.'
    });
  }

  // 🔒 NEW: Block edits if this time entry is already paid
  db.get(
    'SELECT paid FROM time_entries WHERE id = ?',
    [id],
    (errExisting, existingRow) => {
      if (errExisting) {
        console.error('Error checking time entry paid status:', errExisting);
        return res.status(500).json({ error: errExisting.message });
      }

      if (!existingRow) {
        return res.status(404).json({ error: 'Time entry not found.' });
      }

      if (existingRow.paid) {
        return res.status(409).json({
          error:
            'This time entry has already been paid as part of a payroll run and cannot be edited. ' +
            'To correct it, create a new manual time entry that adjusts the hours or pay.'
        });
      }

      // 🔁 If it is NOT paid, proceed as before: recalc pay from employee rate
      db.get(
        'SELECT rate FROM employees WHERE id = ?',
        [empIdNum],
        async (err, row) => {
          if (err) {
            console.error('Error fetching employee rate:', err.message);
            return res.status(500).json({ error: err.message });
          }
          if (!row) {
            return res.status(400).json({ error: 'Employee not found.' });
          }

          const rate = Number(row.rate) || 0;
          const totalPay = rate * hoursNum;
          const noteVal = typeof note === 'string' ? note.trim() : '';

          const sql = `
            UPDATE time_entries
            SET
              employee_id = ?,
              project_id = ?,
              start_date = ?,
              end_date = ?,
              start_time = ?,
              end_time = ?,
              hours = ?,
              total_pay = ?,
              resolved_note = ?
            WHERE id = ?
          `;

          try {
            const beforeRow = await dbGet('SELECT * FROM time_entries WHERE id = ?', [id]);
            const params = [
              empIdNum,
              projIdNum,
              startDate,
              endDate,
              startTime,
              endTime,
              hoursNum,
              totalPay,
              noteVal || (beforeRow ? beforeRow.resolved_note : null) || null,
              id
            ];
            db.run(sql, params, async function (err2) {
              if (err2) {
                console.error('Error updating time entry:', err2.message);
                return res.status(500).json({ error: err2.message });
              }

              if (this.changes === 0) {
                // Should be rare since we already checked existence, but keep as extra guard
                return res.status(404).json({ error: 'Time entry not found.' });
              }

              const afterRow = await dbGet('SELECT * FROM time_entries WHERE id = ?', [id]);
              logTimeEntryAudit({
                entryId: id,
                action: 'modify',
                before: beforeRow,
                after: afterRow,
                note: note || null,
                req
              });

              res.json({ ok: true, id, total_pay: totalPay });
            });
          } catch (auditErr) {
            console.error('Error auditing time entry update:', auditErr);
            res.json({ ok: true, id, total_pay: totalPay });
          }
        }
      );
    }
  );
});

// Mark a time entry as "accuracy verified" (or clear verification)
app.post('/api/time-entries/:id/verify', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ error: 'Invalid time entry id.' });
  }

  const { verified, verified_by_employee_id, note } = req.body || {};
  const isVerified = !!verified;
  const verifierId = verified_by_employee_id ? Number(verified_by_employee_id) : null;

  // If marking verified, stamp now; if clearing, null out fields
  const verifiedAt = isVerified ? new Date().toISOString() : null;

  dbGet('SELECT * FROM time_entries WHERE id = ?', [id])
    .then(beforeRow => {
      db.run(
        `
        UPDATE time_entries
        SET
          verified = ?,
          verified_at = ?,
          verified_by_employee_id = ?
        WHERE id = ?
        `,
        [isVerified ? 1 : 0, verifiedAt, isVerified ? verifierId : null, id],
        async function (err) {
          if (err) {
            console.error('Error updating verification for time entry:', err.message);
            return res.status(500).json({ error: err.message });
          }
          if (this.changes === 0) {
            return res.status(404).json({ error: 'Time entry not found.' });
          }

          const afterRow = await dbGet('SELECT * FROM time_entries WHERE id = ?', [id]);
          logTimeEntryAudit({
            entryId: id,
            action: isVerified ? 'verify' : 'unverify',
            before: beforeRow,
            after: afterRow,
            note: note || null,
            req
          });

          return res.json({
            id,
            verified: isVerified ? 1 : 0,
            verified_at: verifiedAt,
            verified_by_employee_id: verifierId
          });
        }
      );
    })
    .catch(err => {
      console.error('Error auditing verification change:', err);
      return res.status(500).json({ error: 'Failed to update verification.' });
    });
});

// Mark a time entry as "exception resolved" (admin/foreman)
app.post('/api/time-entries/:id/resolve', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ error: 'Invalid time entry id.' });
  }

  const { resolved, resolved_by, note } = req.body || {};
  const isResolved = !!resolved;
  const resolvedBy = resolved_by || 'admin'; // later: use logged-in user
  const resolvedAt = isResolved ? new Date().toISOString() : null;

  dbGet('SELECT * FROM time_entries WHERE id = ?', [id])
    .then(beforeRow => {
      db.run(
        `
          UPDATE time_entries
          SET
            resolved    = ?,
            resolved_at = ?,
            resolved_by = ?
          WHERE id = ?
        `,
        [isResolved ? 1 : 0, resolvedAt, isResolved ? resolvedBy : null, id],
        async function (err) {
          if (err) {
            console.error('Error resolving time entry:', err.message);
            return res.status(500).json({ error: err.message });
          }
          if (this.changes === 0) {
            return res.status(404).json({ error: 'Time entry not found.' });
          }

          const afterRow = await dbGet('SELECT * FROM time_entries WHERE id = ?', [id]);
          logTimeEntryAudit({
            entryId: id,
            action: isResolved ? 'resolve' : 'unresolve',
            before: beforeRow,
            after: afterRow,
            note: note || null,
            req
          });

          return res.json({
            id,
            resolved: isResolved ? 1 : 0,
            resolved_at: resolvedAt,
            resolved_by: isResolved ? resolvedBy : null
          });
        }
      );
    })
    .catch(err => {
      console.error('Error auditing resolve change:', err);
      return res.status(500).json({ error: 'Failed to update resolve status.' });
    });
});



/* ───────── 7. KIOSKS & KIOSK PUNCHES ───────── */

app.post('/api/kiosk/punch', (req, res) => {
  const {
    client_id,
    employee_id,
    project_id,
    lat,
    lng,
    device_timestamp,
    photo_base64,
    device_id          // which kiosk/device this came from
  } = req.body || {};

  // Basic validation
  if (!client_id || !employee_id) {
    return res
      .status(400)
      .json({ error: 'client_id and employee_id are required.' });
  }
  if (!project_id) {
    return res
      .status(400)
      .json({ error: 'Project not set for this device. Have a supervisor set today’s project first.' });
  }

  // Ensure a timesheet exists for today for this device/project before allowing punches
  const today = getTodayIsoDate();
  const sessionSql = `
    SELECT id
    FROM kiosk_sessions
    WHERE date = ?
      AND project_id = ?
      AND (
        (device_id IS NULL AND ? IS NULL)
        OR device_id = ?
      )
    ORDER BY id DESC
    LIMIT 1
  `;

  const processPunch = () => {
    const punchTime = device_timestamp || new Date().toISOString();

    // 1) Check if this client_id was already processed (offline re-sync safety)
    db.get(
      'SELECT * FROM time_punches WHERE client_id = ?',
      [client_id],
      (err, existing) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        if (existing) {
          // Idempotent behavior: we already handled this punch
          const mode = existing.clock_out_ts ? 'clock_out' : 'clock_in';
          return res.json({
            ok: true,
            alreadyProcessed: true,
            mode,
            geofence_violation: !!existing.geo_violation,
            geo_distance_m: existing.geo_distance_m,
            geo_radius_m: null
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
          if (err2) {
            return res.status(500).json({ error: err2.message });
          }

          // ───── CASE A: CLOCK IN ─────
          if (!open) {
            // Geofence metrics for this punch (clock-in)
            let geoDistance = null;
            let geoViolation = 0;
            let geoRadius = null;

            const doClockIn = () => {
              getTodayForemanForDevice(
                device_id,
                employee_id,
                (errForeman, foremanId) => {
                  if (errForeman) {
                    console.error(
                      'Error looking up foreman for device:',
                      errForeman
                    );
                    foremanId = null;
                  }

                  const insertSql = `
                    INSERT INTO time_punches
                      (client_id,
                       employee_id,
                       project_id,
                       clock_in_ts,
                       clock_in_lat,
                       clock_in_lng,
                       clock_in_photo,
                       device_id,
                       foreman_employee_id,
                       geo_distance_m,
                       geo_violation)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 `;

                  db.run(
                    insertSql,
                    [
                      client_id,
                      employee_id,
                      project_id || null,
                      punchTime,
                      lat ?? null,
                      lng ?? null,
                      photo_base64 || null,
                      device_id || null,
                      foremanId || null,
                      geoDistance,
                      geoViolation
                    ],
                    function (err3) {
                      if (err3) {
                        if (
                          err3.message &&
                          err3.message.includes(
                            'UNIQUE constraint failed: time_punches.client_id'
                          )
                        ) {
                          return res.json({
                            ok: true,
                            mode: 'clock_in',
                            alreadyProcessed: true,
                            geofence_violation: geoViolation === 1,
                            geo_distance_m: geoDistance,
                            geo_radius_m: geoRadius
                          });
                        }

                        return res.status(500).json({ error: err3.message });
                      }

                      return res.json({
                        ok: true,
                        mode: 'clock_in',
                        id: this.lastID,
                        punch_id: this.lastID,
                        geofence_violation: geoViolation === 1,
                        geo_distance_m: geoDistance,
                        geo_radius_m: geoRadius
                      });
                    }
                  );
                }
              );
            };

            // If we have project + GPS → compute geofence, but DO NOT BLOCK
            if (project_id && lat != null && lng != null) {
              db.get(
                'SELECT geo_lat, geo_lng, geo_radius FROM projects WHERE id = ?',
                [project_id],
                (errProj, project) => {
                  if (errProj) {
                    console.error('Geofence lookup error:', errProj);
                    return doClockIn();
                  }

                  if (
                    project &&
                    project.geo_lat != null &&
                    project.geo_lng != null &&
                    project.geo_radius != null
                  ) {
                    const latNum    = Number(lat);
                    const lngNum    = Number(lng);
                    const projLat   = Number(project.geo_lat);
                    const projLng   = Number(project.geo_lng);
                    const radiusNum = Number(project.geo_radius);

                    if (
                      !Number.isNaN(latNum) &&
                      !Number.isNaN(lngNum) &&
                      !Number.isNaN(projLat) &&
                      !Number.isNaN(projLng) &&
                      !Number.isNaN(radiusNum)
                    ) {
                      geoRadius = radiusNum;
                      const dist = distanceMeters(
                        latNum,
                        lngNum,
                        projLat,
                        projLng
                      );
                      geoDistance = dist;
                      if (dist > radiusNum) {
                        geoViolation = 1;
                      }
                    }
                  }

                  return doClockIn();
                }
              );
            } else {
              return doClockIn();
            }
            return;
          }

          // ───── CASE B: CLOCK OUT ─────
          const updateSql = `
            UPDATE time_punches
            SET clock_out_ts = ?,
                clock_out_project_id = ?,
                clock_out_lat = ?,
                clock_out_lng = ?
            WHERE id = ?
          `;

          db.run(
            updateSql,
            [
              punchTime,
              project_id || null,
              lat ?? null,
              lng ?? null,
              open.id
            ],
            (err3) => {
              if (err3) {
                return res.status(500).json({ error: err3.message });
              }

              const startIso = open.clock_in_ts || punchTime;
              const start = new Date(startIso);
              const end = new Date(punchTime);
              const diffMs = end - start;

              let minutes = Math.ceil(diffMs / 60000);
              if (!Number.isFinite(minutes) || minutes < 0) minutes = 0;

              const hours = minutes / 60;
              const startDate = (startIso || punchTime).slice(0, 10);
              const endDate = (punchTime || startIso).slice(0, 10);

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
                    return res
                      .status(400)
                      .json({ error: 'Invalid employee_id.' });
                  }

                  const rate = parseFloat(row.rate || 0);
                  const total_pay = rate * hours;

                  const timeEntrySql = `
                    INSERT INTO time_entries
                      (employee_id, project_id, start_date, end_date, hours, total_pay, foreman_employee_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                  `;

                  const finalProjectId =
                    open.project_id || project_id || null;
                  const foremanId = open.foreman_employee_id || null;

                  db.run(
                    timeEntrySql,
                    [
                      employee_id,
                      finalProjectId,
                      startDate,
                      endDate,
                      hours,
                      total_pay,
                      foremanId
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

                      const entryId = this.lastID;

                      db.run(
                        `UPDATE time_punches
                         SET time_entry_id = ?
                         WHERE id = ?`,
                        [entryId, open.id],
                        (errLink) => {
                          if (errLink) {
                            console.error(
                              'Failed to link punch to time entry:',
                              errLink
                            );
                          }

                          return res.json({
                            ok: true,
                            mode: 'clock_out',
                            hours,
                            total_pay,
                            time_entry_id: entryId
                          });
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        });
      }
    );
  };

  db.get(
    sessionSql,
    [today, project_id, device_id || null, device_id || null],
    (errSession, sessionRow) => {
      if (errSession) {
        return res.status(500).json({ error: errSession.message });
      }
      if (!sessionRow) {
        return res.status(400).json({
          error: 'No timesheet exists for this project on this device today. Have a supervisor set a timesheet first.'
        });
      }
      processPunch();
    }
  );
});



app.get('/api/kiosks', (req, res) => {
  const sql = `
    SELECT
      k.id,
      k.name,
      k.location,
      k.device_id,
      k.project_id,
      k.require_photo,
      k.created_at,
      p.name AS project_name,
      p.customer_name
    FROM kiosks k
    LEFT JOIN projects p ON k.project_id = p.id
    ORDER BY k.name
  `;

  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.post('/api/kiosks', (req, res) => {
  const {
    id,
    name,
    location,
    device_id,
    project_id,
    require_photo
  } = req.body || {};

  if (!name) {
    return res.status(400).json({ error: 'Kiosk name is required.' });
  }

  const requirePhotoVal = require_photo ? 1 : 0;
  const projectIdVal = project_id || null;

  if (id) {
    // Update existing kiosk
    const sql = `
      UPDATE kiosks
      SET name = ?, location = ?, device_id = ?, project_id = ?, require_photo = ?
      WHERE id = ?
    `;
    db.run(
      sql,
      [name, location || null, device_id || null, projectIdVal, requirePhotoVal, id],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ ok: true, id });
      }
    );
  } else {
    // Create new kiosk
    const sql = `
      INSERT INTO kiosks (name, location, device_id, project_id, require_photo)
      VALUES (?, ?, ?, ?, ?)
    `;
    db.run(
      sql,
      [name, location || null, device_id || null, projectIdVal, requirePhotoVal],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ ok: true, id: this.lastID, message: 'Kiosk created.' });
      }
    );
  }
});

app.post('/api/kiosks/register', (req, res) => {
  const { device_id, device_secret } = req.body || {};
  const providedSecret = (device_secret || '').trim();

  if (!device_id) {
    return res.status(400).json({ error: 'device_id is required.' });
  }

  const selectSql = `
    SELECT
      k.*,
      p.name AS project_name,
      p.customer_name
    FROM kiosks k
    LEFT JOIN projects p ON k.project_id = p.id
    WHERE k.device_id = ?
  `;

  db.get(selectSql, [device_id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });

    if (row) {
      // Ensure every kiosk row has a secret; if missing, create/backfill it
      if (!row.device_secret) {
        row.device_secret =
          providedSecret || crypto.randomBytes(16).toString('hex');

        db.run(
          `UPDATE kiosks SET device_secret = ? WHERE id = ?`,
          [row.device_secret, row.id],
          errSecret => {
            if (errSecret) {
              console.error('Failed to backfill kiosk device_secret:', errSecret);
            }
          }
        );
      }

      const today = getTodayIsoDate();

      // Pull today’s sessions for this device
      const sessionsSql = `
        SELECT ks.id,
               ks.project_id,
               ks.date,
               ks.created_at,
               p.name AS project_name,
               p.customer_name
        FROM kiosk_sessions ks
        LEFT JOIN projects p ON p.id = ks.project_id
        WHERE ks.device_id = ?
          AND ks.date = ?
        ORDER BY ks.created_at ASC
      `;

      return db.all(sessionsSql, [device_id, today], (err2, sessions) => {
        if (err2) return res.status(500).json({ error: err2.message });

        // Prefer a session that matches the kiosk's saved project_id
        let activeSession = (sessions || [])
          .filter(
            s =>
              s.project_id &&
              row.project_id &&
              Number(s.project_id) === Number(row.project_id)
          )
          .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
          .pop() || null;

        // If the kiosk is missing a project but has sessions today, fall back to
        // the most recent session and backfill the kiosk project_id so workers
        // can clock in without being blocked.
        if (!activeSession && (!row.project_id || Number(row.project_id) === 0)) {
          const latestSession = (sessions || [])
            .filter(s => s.project_id)
            .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
            .pop();

          if (latestSession) {
            activeSession = latestSession;
            row.project_id = latestSession.project_id;

            // Persist the project on the kiosk record for future fetches
            db.run(
              `UPDATE kiosks SET project_id = ? WHERE id = ?`,
              [latestSession.project_id, row.id],
              errUpdate => {
                if (errUpdate) {
                  console.error('Failed to backfill kiosk project_id from session:', errUpdate);
                }
              }
            );
          }
        }

        return res.json({
          ok: true,
          kiosk: row,
          sessions: sessions || [],
          active_session_id: activeSession ? activeSession.id : null
        });
      });
    }

    // No kiosk yet for this device → create a placeholder row
    const insertSql = `
      INSERT INTO kiosks (name, location, device_id, require_photo, device_secret)
      VALUES (?, ?, ?, 0, ?)
    `;
    const name = 'New kiosk';
    const location = null;
    const newSecret = providedSecret || crypto.randomBytes(16).toString('hex');

    db.run(insertSql, [name, location, device_id, newSecret], function (err2) {
      if (err2) return res.status(500).json({ error: err2.message });

      const newId = this.lastID;
      db.get(
        `SELECT * FROM kiosks WHERE id = ?`,
        [newId],
        (err3, kioskRow) => {
          if (err3) return res.status(500).json({ error: err3.message });
          kioskRow.device_secret = newSecret;
          res.json({ ok: true, kiosk: kioskRow, sessions: [], active_session_id: null });
        }
      );
    });
  });
});

app.get('/api/kiosks/:id/open-punches', (req, res) => {
  const kioskId = parseInt(req.params.id, 10);
  if (!kioskId) {
    return res.status(400).json({ error: 'Invalid kiosk id.' });
  }

  // First, get this kiosk's device_id
  db.get(
    `SELECT device_id FROM kiosks WHERE id = ?`,
    [kioskId],
    (err, kiosk) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!kiosk || !kiosk.device_id) {
        return res.json([]); // no device tied or kiosk not found
      }

      const today = getTodayIsoDate();
      const sql = `
        SELECT
          tp.id,
          tp.employee_id,
          e.name AS employee_name,
          tp.project_id,
          p.name AS project_name,
          p.customer_name,
          tp.clock_in_ts,
          tp.clock_out_ts
        FROM time_punches tp
        JOIN employees e ON tp.employee_id = e.id
        LEFT JOIN projects p ON tp.project_id = p.id
        WHERE date(tp.clock_in_ts) = ?
          AND (
            (tp.device_id IS NULL AND ? IS NULL)
            OR tp.device_id = ?
          )
        ORDER BY (tp.clock_out_ts IS NULL) DESC, tp.clock_in_ts ASC
      `;

      db.all(sql, [today, kiosk.device_id, kiosk.device_id], (err2, rows) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json(rows || []);
      });
    }
  );
});

// List sessions for a kiosk (defaults to today)
app.get('/api/kiosks/:id/sessions', (req, res) => {
  const kioskId = parseInt(req.params.id, 10);
  if (!kioskId) {
    return res.status(400).json({ error: 'Invalid kiosk id.' });
  }

  const date = req.query.date || getTodayIsoDate();

  db.get(`SELECT device_id FROM kiosks WHERE id = ?`, [kioskId], (err, kiosk) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!kiosk) return res.status(404).json({ error: 'Kiosk not found.' });

    const sql = `
      SELECT
        ks.id,
        ks.project_id,
        ks.date,
        ks.created_at,
        ks.created_by_employee_id,
        ea.name AS created_by_name,
        p.name AS project_name,
        p.customer_name,
        COALESCE((
          SELECT COUNT(*)
          FROM time_punches tp
          WHERE tp.project_id = ks.project_id
            AND substr(tp.clock_in_ts, 1, 10) = ks.date
        ), 0) AS entry_count,
        COALESCE((
          SELECT COUNT(*)
          FROM time_punches tp
          WHERE tp.clock_out_ts IS NULL
            AND tp.project_id = ks.project_id
            AND substr(tp.clock_in_ts, 1, 10) = ks.date
        ), 0) AS open_count
      FROM kiosk_sessions ks
      LEFT JOIN kiosks k ON k.id = ks.kiosk_id
      LEFT JOIN projects p ON p.id = ks.project_id
      LEFT JOIN employees ea ON ea.id = ks.created_by_employee_id
      WHERE ks.kiosk_id = ?
        AND ks.date = ?
      ORDER BY ks.created_at ASC
    `;

    db.all(sql, [kioskId, date], (err2, rows) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json(rows || []);
    });
  });
});

// Create a new session and optionally make it active on the kiosk
app.post('/api/kiosks/:id/sessions', (req, res) => {
  const kioskId = parseInt(req.params.id, 10);
  if (!kioskId) {
    return res.status(400).json({ error: 'Invalid kiosk id.' });
  }

  const { project_id, make_active, admin_id } = req.body || {};
  if (!project_id) {
    return res.status(400).json({ error: 'project_id is required.' });
  }

  db.get(`SELECT id, device_id FROM kiosks WHERE id = ?`, [kioskId], (err, kiosk) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!kiosk) return res.status(404).json({ error: 'Kiosk not found.' });

    const today = getTodayIsoDate();
    const insertSql = `
      INSERT INTO kiosk_sessions (kiosk_id, device_id, project_id, date, created_by_employee_id)
      VALUES (?, ?, ?, ?, ?)
    `;

    // Check if this is the first timesheet for the kiosk today so we can surface it to the UI
    db.get(
      `SELECT COUNT(*) AS cnt FROM kiosk_sessions WHERE kiosk_id = ? AND date = ?`,
      [kioskId, today],
      (errCount, countRow) => {
        if (errCount) return res.status(500).json({ error: errCount.message });
        const isFirstToday = (countRow && Number(countRow.cnt)) === 0;

        db.run(
          insertSql,
          [kioskId, kiosk.device_id || null, project_id, today, admin_id || null],
          function (err2) {
            if (err2) return res.status(500).json({ error: err2.message });

            const sessionId = this.lastID;

            const afterInsert = () => {
              db.get(
                `
                  SELECT ks.id,
                         ks.project_id,
                         ks.date,
                         ks.created_at,
                         ks.created_by_employee_id,
                         ea.name AS created_by_name,
                         p.name AS project_name,
                         p.customer_name
                  FROM kiosk_sessions ks
                  LEFT JOIN projects p ON p.id = ks.project_id
                  LEFT JOIN employees ea ON ea.id = ks.created_by_employee_id
                  WHERE ks.id = ?
                `,
                [sessionId],
                (err3, session) => {
                  if (err3) return res.status(500).json({ error: err3.message });
                  res.json({
                    ok: true,
                    session,
                    active_project_id: make_active ? Number(project_id) : null,
                    first_session_today: isFirstToday
                  });
                }
              );
            };

            if (make_active) {
              db.run(
                `UPDATE kiosks SET project_id = ? WHERE id = ?`,
                [project_id, kioskId],
                (err4) => {
                  if (err4) return res.status(500).json({ error: err4.message });
                  afterInsert();
                }
              );
            } else {
              afterInsert();
            }
          }
        );
      }
    );
  });
});

// Delete a kiosk session (timesheet) with safety checks
app.delete('/api/kiosks/:id/sessions/:sessionId', async (req, res) => {
  try {
    const kioskId = parseInt(req.params.id, 10);
    const sessionId = parseInt(req.params.sessionId, 10);
    if (!kioskId || !sessionId) {
      return res.status(400).json({ error: 'Invalid kiosk or session id.' });
    }

    const adminId = req.body && req.body.admin_id ? Number(req.body.admin_id) : null;
    const pin = (req.body && req.body.pin ? String(req.body.pin) : '').trim();
    if (!adminId) {
      return res.status(400).json({ error: 'Admin id is required.' });
    }

    const admin = await dbGet(
      `
        SELECT id, name, pin, is_admin
        FROM employees
        WHERE id = ? AND IFNULL(is_admin, 0) = 1
        LIMIT 1
      `,
      [adminId]
    );
    if (!admin) {
      return res.status(403).json({ error: 'Admin not authorized.' });
    }

    const sessionRow = await dbGet(
      `
        SELECT id, kiosk_id, device_id, project_id, date
        FROM kiosk_sessions
        WHERE id = ? AND kiosk_id = ?
        LIMIT 1
      `,
      [sessionId, kioskId]
    );
    if (!sessionRow) {
      return res.status(404).json({ error: 'Timesheet not found for this kiosk.' });
    }

    const counts = await dbGet(
      `
        SELECT
          COUNT(*) AS entry_count,
          SUM(CASE WHEN tp.clock_out_ts IS NULL THEN 1 ELSE 0 END) AS open_count
        FROM time_punches tp
        WHERE tp.project_id = ?
          AND substr(tp.clock_in_ts, 1, 10) = ?
          AND (
            (? IS NULL AND tp.device_id IS NULL)
            OR tp.device_id = ?
          )
      `,
      [
        sessionRow.project_id,
        sessionRow.date,
        sessionRow.device_id || null,
        sessionRow.device_id || null
      ]
    );

    const entryCount = counts && counts.entry_count ? Number(counts.entry_count) : 0;
    const openCount = counts && counts.open_count ? Number(counts.open_count) : 0;
    const perms = await getAdminAccessPerms(admin.id);

    if (openCount > 0) {
      return res.status(409).json({
        error: 'Cannot delete this timesheet while workers are clocked in. Clock them out first.'
      });
    }

    if (entryCount > 0) {
      if (!perms.modify_time) {
        return res.status(403).json({ error: 'You do not have permission to modify time entries.' });
      }

      const currentPin = (admin.pin || '').trim();
      if (!currentPin) {
        return res.status(403).json({ error: 'A PIN is required to delete a timesheet with entries.' });
      }
      if (!pin) {
        return res.status(401).json({ error: 'PIN is required to delete this timesheet.' });
      }
      if (pin !== currentPin) {
        return res.status(401).json({ error: 'Incorrect PIN.' });
      }
    }

    const delRes = await dbRun(
      'DELETE FROM kiosk_sessions WHERE id = ? AND kiosk_id = ?',
      [sessionId, kioskId]
    );
    if (!delRes || delRes.changes === 0) {
      return res.status(404).json({ error: 'Timesheet already removed.' });
    }

    // If this session was active for the kiosk, clear the project unless another session for it exists today
    const kioskRow = await dbGet(
      'SELECT project_id FROM kiosks WHERE id = ?',
      [kioskId]
    );
    if (kioskRow && kioskRow.project_id && Number(kioskRow.project_id) === Number(sessionRow.project_id)) {
      const other = await dbGet(
        `
          SELECT id
          FROM kiosk_sessions
          WHERE kiosk_id = ?
            AND date = ?
            AND project_id = ?
            AND id != ?
          LIMIT 1
        `,
        [kioskId, sessionRow.date, sessionRow.project_id, sessionId]
      );
      if (!other) {
        await dbRun('UPDATE kiosks SET project_id = NULL WHERE id = ?', [kioskId]);
      }
    }

    res.json({ ok: true, entry_count: entryCount });
  } catch (err) {
    console.error('Error deleting kiosk session:', err);
    res.status(500).json({ error: 'Failed to delete timesheet.' });
  }
});

// Set the active session (updates kiosk.project_id to that session’s project)
app.post('/api/kiosks/:id/active-session', (req, res) => {
  const kioskId = parseInt(req.params.id, 10);
  if (!kioskId) {
    return res.status(400).json({ error: 'Invalid kiosk id.' });
  }

  const { session_id } = req.body || {};
  if (!session_id) {
    return res.status(400).json({ error: 'session_id is required.' });
  }

  db.get(
    `
      SELECT ks.project_id
      FROM kiosk_sessions ks
      WHERE ks.id = ?
        AND ks.kiosk_id = ?
      LIMIT 1
    `,
    [session_id, kioskId],
    (err, session) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!session) {
        return res.status(404).json({ error: 'Session not found for this kiosk.' });
      }

      db.run(
        `UPDATE kiosks SET project_id = ? WHERE id = ?`,
        [session.project_id, kioskId],
        (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ ok: true, project_id: session.project_id });
        }
      );
    }
  );
});

// List all sessions for today across kiosks (admin console)
app.get('/api/kiosk-sessions/today', (req, res) => {
  const date = getTodayIsoDate();

  const sessionsSql = `
    SELECT
      ks.id,
      ks.kiosk_id,
      ks.project_id,
      ks.device_id,
      ks.date,
      ks.created_at,
      k.name AS kiosk_name,
      k.location AS kiosk_location,
      k.device_id AS kiosk_device_id,
      p.name AS project_name,
      p.customer_name
    FROM kiosk_sessions ks
    LEFT JOIN kiosks k ON k.id = ks.kiosk_id
    LEFT JOIN projects p ON p.id = ks.project_id
    WHERE ks.date = ?
    ORDER BY k.name, ks.created_at
  `;

  db.all(sessionsSql, [date], (err, sessions) => {
    if (err) return res.status(500).json({ error: err.message });
    const list = sessions || [];

    // Grab all open punches for today and attach to matching sessions
    const punchesSql = `
      SELECT
        tp.id,
        tp.employee_id,
        tp.project_id,
        tp.device_id,
        tp.clock_in_ts,
        e.name AS employee_name,
        k.id AS kiosk_id
      FROM time_punches tp
      JOIN kiosks k ON k.device_id = tp.device_id
      LEFT JOIN employees e ON e.id = tp.employee_id
      WHERE tp.clock_out_ts IS NULL
        AND date(tp.clock_in_ts) = ?
    `;

    db.all(punchesSql, [date], (err2, punches) => {
      if (err2) return res.status(500).json({ error: err2.message });
      const byKey = new Map();
      list.forEach(s => {
        const devKey = `dev:${s.device_id || ''}|${s.project_id || ''}`;
        byKey.set(devKey, s);
        if (s.kiosk_id) {
          const kioskKey = `kiosk:${s.kiosk_id}|${s.project_id || ''}`;
          byKey.set(kioskKey, s);
        }
        s.open_punches = [];
      });

      (punches || []).forEach(p => {
        const devKey = `dev:${p.device_id || ''}|${p.project_id || ''}`;
        const kioskKey = `kiosk:${p.kiosk_id || ''}|${p.project_id || ''}`;
        const match = byKey.get(devKey) || byKey.get(kioskKey);
        if (match) {
          match.open_punches.push(p);
        }
      });

      return res.json(list);
    });
  });
});


app.get('/api/kiosks/:id/foreman-today', (req, res) => {
  const kioskId = parseInt(req.params.id, 10);
  if (!kioskId) {
    return res.status(400).json({ error: 'Invalid kiosk id.' });
  }

  const today = getTodayIsoDate();

  const sql = `
    SELECT
      kf.foreman_employee_id,
      e.name AS foreman_name
    FROM kiosk_foreman_days kf
    LEFT JOIN employees e ON e.id = kf.foreman_employee_id
    WHERE kf.kiosk_id = ?
      AND kf.date = ?
    LIMIT 1
  `;

  db.get(sql, [kioskId, today], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });

    if (!row) {
      return res.json({
        foreman_employee_id: null,
        foreman_name: null
      });
    }

    res.json({
      foreman_employee_id: row.foreman_employee_id,
      foreman_name: row.foreman_name || null
    });
  });
});

app.post('/api/kiosks/:id/foreman-today', (req, res) => {
  const kioskId = parseInt(req.params.id, 10);
  if (!kioskId) {
    return res.status(400).json({ error: 'Invalid kiosk id.' });
  }

  const { foreman_employee_id, set_by_employee_id } = req.body || {};
  const today = getTodayIsoDate();

  const sql = `
    INSERT INTO kiosk_foreman_days
      (kiosk_id, foreman_employee_id, date, set_by_employee_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(kiosk_id, date) DO UPDATE SET
      foreman_employee_id = excluded.foreman_employee_id,
      set_by_employee_id = excluded.set_by_employee_id,
      created_at = datetime('now')
  `;

  db.run(
    sql,
    [
      kioskId,
      foreman_employee_id || null,
      today,
      set_by_employee_id || null
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true });
    }
  );
});

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

/* ───────── 8. SHIPMENTS ───────── */

const SHIPMENT_STATUSES = [
  'Pre-Order',
  'Ordered',
  'In Transit to Forwarder',
  'Arrived at Forwarder',
  'Sailed',
  'Arrived at Port',
  'Awaiting Clearance',
  'Cleared - Ready for Release',
  'Picked Up',
  'Archived'
];

async function getAdminContext(req) {
  if (!req.session || !req.session.userId) return null;

  const user = await dbGet(
    'SELECT id, email, employee_id FROM users WHERE id = ?',
    [req.session.userId]
  );
  if (!user || !user.employee_id) return null;

  const employee = await dbGet(
    'SELECT id, name, is_admin FROM employees WHERE id = ?',
    [user.employee_id]
  );

  if (!employee || !employee.is_admin) return null;
  return { user, employee };
}

function computeItemsVerifiedFlagFromItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return 0;
  }

  const allVerified = items.every(
    it => it.verification && it.verification.status === 'verified'
  );

  return allVerified ? 1 : 0;
}

async function ensureShipmentAccess(req) {
  // 1) Try session-based auth first (employees with admin or kiosk shipment access)
  if (req.session && req.session.employeeId) {
    const emp = await dbGet(
      `
        SELECT id, is_admin, kiosk_can_view_shipments, IFNULL(active, 1) AS active
        FROM employees
        WHERE id = ?
      `,
      [req.session.employeeId]
    );

    if (emp && emp.active && (emp.is_admin || emp.kiosk_can_view_shipments)) {
      return { ok: true, employee: emp, via: 'session' };
    }
  }

  // 1b) Admin console session without a linked employee (e.g., bootstrap admin user)
  if (req.session && req.session.userId && !req.session.employeeId) {
    return { ok: true, via: 'session' };
  }

  // 2) Fallback for kiosk/field devices: require employee_id + device credentials
  const empId = Number(
    (req.body && req.body.employee_id) ||
      (req.query && req.query.employee_id)
  );
  const deviceId = (
    (req.body && req.body.device_id) ||
    (req.query && req.query.device_id) ||
    ''
  ).trim();
  const deviceSecret = (
    (req.body && req.body.device_secret) ||
    (req.query && req.query.device_secret) ||
    ''
  ).trim();

  if (!empId || !deviceId || !deviceSecret) {
    return { ok: false, status: 401, error: 'Not authenticated' };
  }

  const kioskRow = await dbGet(
    'SELECT id, device_secret FROM kiosks WHERE device_id = ? LIMIT 1',
    [deviceId]
  );
  if (!kioskRow) {
    return { ok: false, status: 403, error: 'Not authorized' };
  }

  let expectedSecret = kioskRow.device_secret || '';
  if (!expectedSecret && deviceSecret) {
    expectedSecret = deviceSecret;
    try {
      await dbRun(
        'UPDATE kiosks SET device_secret = ? WHERE id = ?',
        [deviceSecret, kioskRow.id]
      );
    } catch (err) {
      console.error('Failed to backfill kiosk device_secret (shipments):', err);
    }
  }

  if (!expectedSecret || expectedSecret !== deviceSecret) {
    return { ok: false, status: 403, error: 'Not authorized' };
  }

  const emp = await dbGet(
    `
      SELECT id, is_admin, kiosk_can_view_shipments, IFNULL(active, 1) AS active
      FROM employees
      WHERE id = ?
    `,
    [empId]
  );

  if (!emp || !emp.active || !(emp.is_admin || emp.kiosk_can_view_shipments)) {
    return { ok: false, status: 403, error: 'Not authorized' };
  }

  return { ok: true, employee: emp, kiosk: kioskRow, via: 'kiosk' };
}

function normalizeNotificationStatuses(rawStatuses) {
  const arr = Array.isArray(rawStatuses) ? rawStatuses : [];
  const out = [];

  arr.forEach(st => {
    const clean = String(st || '').trim();
    if (!clean) return;
    if (!out.includes(clean)) {
      out.push(clean.slice(0, 120));
    }
  });

  return out.slice(0, 20);
}

function normalizeNotificationShipments(rawIds) {
  if (!Array.isArray(rawIds)) return [];
  const out = [];

  rawIds.forEach(val => {
    const num = Number(val);
    if (Number.isInteger(num) && num > 0 && !out.includes(num)) {
      out.push(num);
    }
  });

  return out.slice(0, 200);
}

function normalizeNotifyTime(value) {
  if (!value) return '';
  const str = String(value).trim();
  const match = str.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (
    Number.isNaN(hours) || Number.isNaN(minutes) ||
    hours < 0 || hours > 23 ||
    minutes < 0 || minutes > 59
  ) {
    return null;
  }
  return `${match[1]}:${match[2]}`;
}

function mapNotificationPrefRow(row) {
  if (!row) {
    return {
      enabled: false,
      statuses: [],
      shipment_ids: [],
      notify_time: ''
    };
  }

  let statuses = [];
  let shipmentIds = [];

  try {
    const parsed = JSON.parse(row.statuses_json || '[]');
    if (Array.isArray(parsed)) statuses = parsed;
  } catch {}

  try {
    const parsed = JSON.parse(row.shipment_ids_json || '[]');
    if (Array.isArray(parsed)) shipmentIds = parsed;
  } catch {}

  return {
    enabled: !!row.enabled,
    statuses,
    shipment_ids: shipmentIds,
    notify_time: row.notify_time || ''
  };
}

// Per-admin shipment notification preferences
app.get('/api/shipments/notifications', requireAuth, async (req, res) => {
  try {
    const ctx = await getAdminContext(req);
    if (!ctx) {
      return res
        .status(403)
        .json({ error: 'Admin privileges required to manage notifications.' });
    }

    const row = await dbGet(
      `
        SELECT statuses_json, shipment_ids_json, notify_time, enabled
        FROM shipment_notification_prefs
        WHERE user_id = ?
      `,
      [ctx.user.id]
    );

    res.json({
      ok: true,
      preference: mapNotificationPrefRow(row)
    });
  } catch (err) {
    console.error('Error loading shipment notification prefs:', err);
    res.status(500).json({
      error: 'Error loading shipment notification preferences.'
    });
  }
});

app.put('/api/shipments/notifications', requireAuth, async (req, res) => {
  try {
    const ctx = await getAdminContext(req);
    if (!ctx) {
      return res
        .status(403)
        .json({ error: 'Admin privileges required to manage notifications.' });
    }

    const {
      statuses = [],
      shipment_ids = [],
      notify_time = '',
      enabled = true
    } = req.body || {};

    const normalizedStatuses  = normalizeNotificationStatuses(statuses);
    const normalizedShipments = normalizeNotificationShipments(shipment_ids);
    const cleanTime           = notify_time ? normalizeNotifyTime(notify_time) : '';

    if (notify_time && cleanTime == null) {
      return res.status(400).json({
        error: 'Notification time must be in HH:MM (24-hour) format.'
      });
    }

    await dbRun(
      `
        INSERT INTO shipment_notification_prefs (
          user_id,
          employee_id,
          statuses_json,
          shipment_ids_json,
          notify_time,
          enabled,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET
          employee_id       = excluded.employee_id,
          statuses_json     = excluded.statuses_json,
          shipment_ids_json = excluded.shipment_ids_json,
          notify_time       = excluded.notify_time,
          enabled           = excluded.enabled,
          updated_at        = datetime('now')
      `,
      [
        ctx.user.id,
        ctx.employee.id,
        JSON.stringify(normalizedStatuses),
        JSON.stringify(normalizedShipments),
        cleanTime || null,
        enabled ? 1 : 0
      ]
    );

    res.json({
      ok: true,
      preference: {
        enabled: !!enabled,
        statuses: normalizedStatuses,
        shipment_ids: normalizedShipments,
        notify_time: cleanTime || ''
      }
    });
  } catch (err) {
    console.error('Error saving shipment notification prefs:', err);
    res.status(500).json({
      error: 'Error saving shipment notification preferences.'
    });
  }
});


app.post('/api/shipments', requireAuth, async (req, res) => {

  try {
        const {
      title,
      po_number,
      vendor_id,
      vendor_name,
      freight_forwarder,
      destination,
      project_id,
      sku,
      quantity,
      total_price,
      price_per_item,
      expected_ship_date,
      expected_arrival_date,
      tracking_number,
      bol_number,
      items = [],

      // NEW STORAGE / PICKUP FIELDS
      storage_room,
      storage_details,
      storage_due_date,
      storage_daily_late_fee,
      picked_up_by,
      picked_up_date,

      // PAYMENT FLAGS + AMOUNTS (snake_case from client)
      vendor_paid,
      vendor_paid_amount,
      shipper_paid,
      shipper_paid_amount,
      customs_paid,
      customs_paid_amount,

      // Total paid (auto-calculated on the client)
      total_paid,

      // Verification
      items_verified,
      verified_by,
      verification_notes,

      website_url,
      notes,
      status
    } = req.body;

    // Compute auto items_verified from line items:
// true if we have items and ALL have verification.status === "verified"
// Compute auto items_verified from line items
const itemsVerifiedFlag = computeItemsVerifiedFlagFromItems(items);




    // ───────── VALIDATION ─────────
    if (!title || !title.trim()) {
      return res
        .status(400)
        .json({ error: 'Shipment name/title is required.' });
    }

    if (!project_id) {
      return res
        .status(400)
        .json({ error: 'Project is required.' });
    }

    // Normalize status to one of the known statuses
    let initialStatus = 'Pre-Order';
    if (status && SHIPMENT_STATUSES.includes(status.trim())) {
      initialStatus = status.trim();
    }



    // ───────── INSERT INTO shipments ─────────
    const result = await dbRun(
      `
            INSERT INTO shipments (
        title,
        po_number,
        vendor_id,
        destination,
        project_id,
        sku,
        vendor_name,
        freight_forwarder,
        quantity,
        total_price,
        price_per_item,
        expected_ship_date,
        expected_arrival_date,
        tracking_number,
        bol_number,
        storage_room,
        storage_details,
        storage_due_date,
        storage_daily_late_fee,
        picked_up_by,
        picked_up_date,
        vendor_paid,
        vendor_paid_amount,
        shipper_paid,
        shipper_paid_amount,
        customs_paid,
        customs_paid_amount,
        total_paid,
        items_verified,
        verified_by,
        verification_notes,
        website_url,
        notes,
        status
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )

      `,
            [
        title,
        po_number || null,
        vendor_id || null,
        destination || null,
        project_id || null,
        sku || null,
        vendor_name || null,
        freight_forwarder || null,
        quantity || null,
        total_price || null,
        price_per_item || null,
        expected_ship_date || null,
        expected_arrival_date || null,
        tracking_number || null,
        bol_number || null,
        storage_room || null,
        storage_details || null,
        storage_due_date || null,
        storage_daily_late_fee != null ? storage_daily_late_fee : null,
        picked_up_by || null,
        picked_up_date || null,
        vendor_paid ? 1 : 0,
        vendor_paid_amount != null ? vendor_paid_amount : null,
        shipper_paid ? 1 : 0,
        shipper_paid_amount != null ? shipper_paid_amount : null,
        customs_paid ? 1 : 0,
        customs_paid_amount != null ? customs_paid_amount : null,
        total_paid != null ? total_paid : null,
        itemsVerifiedFlag ? 1 : 0, 
        verified_by || null,
        verification_notes || null,
        website_url || null,
        notes || null,
        initialStatus
      ]
    );

    const id = result.lastID;

        // ───────── INSERT LINE ITEMS ─────────
    if (Array.isArray(items) && items.length > 0) {
      for (const it of items) {
        await dbRun(
  `
    INSERT INTO shipment_items (
  shipment_id,
  description,
  sku,
  quantity,
  unit_price,
  line_total,
  vendor_name,
  verified,
  notes,
  verification_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
[
  id,
  it.description || null,
  it.sku || null,
  it.quantity != null ? it.quantity : 0,
  it.unit_price != null ? it.unit_price : 0,
  it.line_total != null ? it.line_total : 0,
  it.vendor_name || null,

  // store verified flag for legacy UI
  it.verification?.status === "verified" ? 1 : 0,

  // simple notes fallback
  it.verification?.notes || null,

  // FULL JSON storage only when present
  it.verification ? JSON.stringify(it.verification) : null
]

);

      }
    }


    // ───────── STATUS HISTORY ─────────
    await dbRun(
      `
      INSERT INTO shipment_status_history (
        shipment_id, old_status, new_status, changed_at
      ) VALUES (?, NULL, ?, datetime('now'))
      `,
      [id, initialStatus]
    );

    // ───────── TIMELINE ─────────
    await dbRun(
      `
      INSERT INTO shipment_timeline (
        shipment_id, event_type, old_status, new_status, note, created_at
      ) VALUES (?, 'status_change', NULL, ?, 'Shipment created.', datetime('now'))
      `,
      [id, initialStatus]
    );

    // ───────── RETURN ROW ─────────
    const row = await dbGet('SELECT * FROM shipments WHERE id = ?', [id]);

    res.json({ shipment: row });

  } catch (err) {
    console.error('Error creating shipment:', err);
    res.status(500).json({ error: 'Error creating shipment.' });
  }
});


app.get('/api/shipments', requireAuth, async (req, res) => {

  try {
    const {
      search = '',
      status = '',
      project_id = '',
      vendor_id = ''
    } = req.query || {};

    const params = [];
    let where = 'WHERE IFNULL(s.is_archived, 0) = 0 ';

    // Text search (title, PO, tracking, BOL)
    if (search) {
      where += `
        AND (
          s.title          LIKE ?
          OR s.po_number   LIKE ?
          OR s.tracking_number LIKE ?
          OR s.bol_number  LIKE ?
        )
      `;
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }

    // Single-status filter (when you pick a specific status)
    if (status) {
      where += 'AND s.status = ? ';
      params.push(status);
    }

    // Project filter
    if (project_id) {
      where += 'AND s.project_id = ? ';
      params.push(project_id);
    }

    // Vendor filter (by id OR by name text if you ever pass that)
    if (vendor_id) {
      where += 'AND (s.vendor_id = ? OR s.vendor_name = ?) ';
      params.push(vendor_id, vendor_id);
    }

    const rows = await dbAll(
      `
      SELECT
        s.*,
        COALESCE(s.vendor_name, v.name) AS vendor_name,
        p.name AS project_name,
        p.customer_name
      FROM shipments s
      LEFT JOIN vendors  v ON v.id = s.vendor_id
      LEFT JOIN projects p ON p.id = s.project_id
      ${where}
      ORDER BY
        IFNULL(s.updated_at, s.created_at) DESC,
        s.created_at DESC
      `,
      params
    );

    // Build grouped data for the board
    const shipmentsByStatus = {};
    // Initialize known columns from your constant, so empty columns still show
    SHIPMENT_STATUSES.forEach(st => {
      shipmentsByStatus[st] = [];
    });

    const extraStatuses = new Set();

    rows.forEach(row => {
      const st = row.status || 'Pre-Order';

      if (!SHIPMENT_STATUSES.includes(st)) {
        extraStatuses.add(st);
        if (!shipmentsByStatus[st]) {
          shipmentsByStatus[st] = [];
        }
      }

      shipmentsByStatus[st].push(row);
    });

    const statuses = [
      ...SHIPMENT_STATUSES,
      ...Array.from(extraStatuses).filter(s => !SHIPMENT_STATUSES.includes(s))
    ];

    // Shape that the front-end expects
    res.json({
      statuses,
      shipmentsByStatus
    });
  } catch (err) {
    console.error('Error loading shipments:', err);
    res.status(500).json({ error: 'Error loading shipments.' });
  }
});

app.get('/api/shipments/board', requireAuth, async (req, res) => {

  try {
    const rows = await dbAll(
      `
      SELECT
        s.*,
        COALESCE(s.vendor_name, v.name) AS vendor_name,
        p.name AS project_name,
        p.customer_name
      FROM shipments s
      LEFT JOIN vendors  v ON v.id = s.vendor_id
      LEFT JOIN projects p ON p.id = s.project_id
      WHERE IFNULL(s.is_archived, 0) = 0
      ORDER BY
        IFNULL(s.updated_at, s.created_at) DESC,
        s.created_at DESC
      `
    );

    // Initialize board with all known statuses
    const board = {};
    SHIPMENT_STATUSES.forEach(st => {
      board[st] = [];
    });

    // Optional: separate bucket if something has a weird status
    board['Other'] = [];

    rows.forEach(r => {
      const col = SHIPMENT_STATUSES.includes(r.status)
        ? r.status
        : 'Other';
      board[col].push(r);
    });

    res.json({ board });
  } catch (err) {
    console.error('Error loading shipments board:', err);
    res.status(500).json({ error: 'Error loading shipments board.' });
  }
});

app.put('/api/shipments/:id', requireAuth, async (req, res) => {  try {
    const id = req.params.id;

    const existing = await dbGet(
      'SELECT * FROM shipments WHERE id = ?',
      [id]
    );
    if (!existing) {
      return res.status(404).json({ error: 'Shipment not found.' });
    }

    const {
      title,
      po_number,
      vendor_id,
      vendor_name,
      freight_forwarder,
      destination,
      project_id,
      sku,
      quantity,
      total_price,
      price_per_item,
      expected_ship_date,
      expected_arrival_date,
      tracking_number,
      bol_number,
      items = [],
      storage_room,
      storage_details,
      storage_due_date,
      storage_daily_late_fee,
      picked_up_by,
      picked_up_date,
      vendor_paid,
      vendor_paid_amount,
      shipper_paid,
      shipper_paid_amount,
      customs_paid,
      customs_paid_amount,
      total_paid,
      items_verified,
      verified_by,
      verification_notes,
      website_url,
      notes,
      status
    } = req.body || {};

    // ───────── BASIC VALIDATION ─────────
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Shipment name/title is required.' });
    }

    if (!project_id) {
      return res.status(400).json({ error: 'Project is required.' });
    }

    // ───────── STATUS NORMALIZATION ─────────
    const oldStatus = existing.status || null;

    let newStatus = existing.status || 'Pre-Order';
    if (status && typeof status === 'string') {
      const trimmed = status.trim();
      if (SHIPMENT_STATUSES.includes(trimmed)) {
        newStatus = trimmed;
      }
    }

    // ───────── ITEMS_VERIFIED FLAG (initial value for UPDATE) ─────────
let itemsVerifiedFlag;

if (items_verified !== undefined && items_verified !== null) {
  // Explicit override from client
  itemsVerifiedFlag = items_verified ? 1 : 0;
} else if (Array.isArray(items) && items.length > 0) {
  // Infer from line items in this request
  itemsVerifiedFlag = computeItemsVerifiedFlagFromItems(items);
} else {
  // No explicit value and no items → keep existing DB value
  itemsVerifiedFlag = existing.items_verified ? 1 : 0;
}


    // ───────── UPDATE SHIPMENT CORE FIELDS ─────────
    await dbRun(
      `
        UPDATE shipments
        SET
          title                 = ?,
          po_number             = ?,
          vendor_id             = ?,
          destination           = ?,
          project_id            = ?,
          sku                   = ?,
          vendor_name           = ?,
          freight_forwarder     = ?,
          quantity              = ?,
          total_price           = ?,
          price_per_item        = ?,
          expected_ship_date    = ?,
          expected_arrival_date = ?,
          tracking_number       = ?,
          bol_number            = ?,
          storage_room          = ?,
          storage_details       = ?,
          storage_due_date      = ?,
          storage_daily_late_fee = ?,
          picked_up_by          = ?,
          picked_up_date        = ?,
          vendor_paid           = ?,
          vendor_paid_amount    = ?,
          shipper_paid          = ?,
          shipper_paid_amount   = ?,
          customs_paid          = ?,
          customs_paid_amount   = ?,
          total_paid            = ?,
          items_verified        = ?,   -- initial value, may be auto-updated later
          verified_by           = ?,
          verification_notes    = ?,
          website_url           = ?,
          notes                 = ?,
          status                = ?,
          updated_at            = datetime('now')
        WHERE id = ?
      `,
      [
        title,
        po_number || null,
        vendor_id || null,
        destination || null,
        project_id || null,
        sku || null,
        vendor_name || null,
        freight_forwarder || null,
        quantity != null ? quantity : null,
        total_price != null ? total_price : null,
        price_per_item != null ? price_per_item : null,
        expected_ship_date || null,
        expected_arrival_date || null,
        tracking_number || null,
        bol_number || null,
        storage_room || null,
        storage_details || null,
        storage_due_date || null,
        storage_daily_late_fee != null ? storage_daily_late_fee : null,
        picked_up_by || null,
        picked_up_date || null,
        vendor_paid ? 1 : 0,
        vendor_paid_amount != null ? vendor_paid_amount : null,
        shipper_paid ? 1 : 0,
        shipper_paid_amount != null ? shipper_paid_amount : null,
        customs_paid ? 1 : 0,
        customs_paid_amount != null ? customs_paid_amount : null,
        total_paid != null ? total_paid : null,
        itemsVerifiedFlag,
        verified_by || null,
        verification_notes || null,
        website_url || null,
        notes || null,
        newStatus,
        id
      ]
    );

    /* ───────── REPLACE LINE ITEMS ───────── */

    //
    // 1. Remove existing items for this shipment
    //
    await dbRun(
      `DELETE FROM shipment_items WHERE shipment_id = ?`,
      [id]
    );

    //
    // 2. Insert the new items
    //
    let allVerified = true; // used for auto items_verified on parent

    if (Array.isArray(items) && items.length > 0) {
      for (const it of items) {
        const verificationObj = it.verification || null;
        const itemStatus = verificationObj?.status || '';

        // Track auto "items_verified" flag
        if (itemStatus !== 'verified') {
          allVerified = false;
        }

        await dbRun(
          `
           INSERT INTO shipment_items (
  shipment_id,
  description,
  sku,
  quantity,
  unit_price,
  line_total,
  vendor_name,
  verified,
  notes,
  verification_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
  id,
  it.description || null,
  it.sku || null,
  it.quantity != null ? it.quantity : 0,
  it.unit_price != null ? it.unit_price : 0,
  it.line_total != null ? it.line_total : 0,
  it.vendor_name || null,

  // legacy verified flag
  itemStatus === 'verified' ? 1 : 0,

  // simple notes
  verificationObj?.notes || null,

  // full JSON
  verificationObj ? JSON.stringify(verificationObj) : null
]
        );
      }
    } else {
      // No items → definitely not all verified
      allVerified = false;
    }

    //
    // 3. Auto-update parent shipment.items_verified if needed
    //    (only when the client did NOT explicitly decide it)
    //
    if (items_verified == null) {
      await dbRun(
        `
          UPDATE shipments
          SET items_verified = ?
          WHERE id = ?
        `,
        [allVerified ? 1 : 0, id]
      );
    }

    // ───────── STATUS HISTORY / TIMELINE IF STATUS CHANGED ─────────
    if (oldStatus !== newStatus) {
      await dbRun(
        `
          INSERT INTO shipment_status_history (
            shipment_id, old_status, new_status, changed_at
          ) VALUES (?, ?, ?, datetime('now'))
        `,
        [id, oldStatus, newStatus]
      );

      await dbRun(
        `
          INSERT INTO shipment_timeline (
            shipment_id,
            event_type,
            old_status,
            new_status,
            note,
            created_at
          ) VALUES (?, 'status_change', ?, ?, ?, datetime('now'))
        `,
        [id, oldStatus, newStatus, 'Status changed via main edit form.']
      );
    }

    // ───────── RETURN UPDATED ROW ─────────
    const row = await dbGet(
      `SELECT s.*,
        COALESCE(s.vendor_name, v.name) AS vendor_name,
        p.name AS project_name,
        p.customer_name
       FROM shipments s
       LEFT JOIN vendors  v ON v.id = s.vendor_id
       LEFT JOIN projects p ON p.id = s.project_id
       WHERE s.id = ?`,
      [id]
    );

    res.json({ shipment: row });
  } catch (err) {
    console.error('Error updating shipment:', err);
    res.status(500).json({ error: 'Error updating shipment.' });
  }
});


app.delete('/api/shipments/:id', requireAuth, async (req, res) => {

  try {
    const id = req.params.id;

    const existing = await dbGet(
      'SELECT * FROM shipments WHERE id = ?',
      [id]
    );
    if (!existing) {
      return res.status(404).json({ error: 'Shipment not found.' });
    }

    await dbRun(
      `
        UPDATE shipments
        SET is_archived = 1,
            archived_at = datetime('now')
        WHERE id = ?
      `,
      [id]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting shipment:', err);
    res.status(500).json({ error: 'Error deleting shipment.' });
  }
});

app.get('/api/shipments/:id', requireAuth, async (req, res) => {
    try {
    const id = req.params.id;

    const row = await dbGet(
      `SELECT s.*,
        COALESCE(s.vendor_name, v.name) AS vendor_name,
        p.name AS project_name,
        p.customer_name
       FROM shipments s
       LEFT JOIN vendors v ON v.id = s.vendor_id
       LEFT JOIN projects p ON p.id = s.project_id
       WHERE s.id = ?`,
      [id]
    );

    if (!row) return res.status(404).json({ error: 'Not found.' });

    const items = await dbAll(
  `
    SELECT
      id,
      shipment_id,
      description,
      sku,
      quantity,
      unit_price,
      line_total,
      vendor_name,
      verified,
      notes,
      verification_json
    FROM shipment_items
    WHERE shipment_id = ?
    ORDER BY id ASC
  `,
  [id]
);


// Convert verification_json → verification object
const normalizedItems = items.map(it => {
  let verification = null;

  if (it.verification_json) {
    try {
      verification = JSON.parse(it.verification_json);
    } catch {
      verification = null;
    }
  }

  const isEmptyObject =
    verification &&
    typeof verification === 'object' &&
    !Array.isArray(verification) &&
    Object.keys(verification).length === 0;

  // fallback to legacy columns if nothing meaningful
  if (!verification || isEmptyObject) {
    verification = {
      status: it.verified ? 'verified' : '',
      notes: it.notes || ''
    };
  }

  return {
    ...it,
    verification
  };
});



res.json({
  shipment: row,
  items: normalizedItems
});


  } catch (err) {
    console.error('Error loading shipment:', err);
    res.status(500).json({ error: 'Error loading shipment.' });
  }
});

app.get('/api/shipments/:id/payments', requireAuth, async (req, res) => {

  try {
    const rows = await dbAll(
      `SELECT * FROM shipment_payments WHERE shipment_id = ? ORDER BY created_at ASC`,
      [req.params.id]
    );
    res.json({ payments: rows });
  } catch (err) {
    console.error('Error loading shipment payments:', err);
    res.status(500).json({ error: 'Error loading payments.' });
  }
});

app.post('/api/shipments/:id/payments', requireAuth, async (req, res) => {

  try {
    const {
      type,
      amount,
      currency,
      status,
      due_date,
      paid_date,
      invoice_number,
      notes
    } = req.body;
    if (amount == null) {
      return res.status(400).json({ error: 'Amount required.' });
    }

    await dbRun(
      `INSERT INTO shipment_payments (
        shipment_id, type, amount, currency, status,
        due_date, paid_date, invoice_number, notes, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?, datetime('now'))`,
      [
        req.params.id,
        type || null,
        amount,
        currency || 'USD',
        status || 'Pending',
        due_date || null,
        paid_date || null,
        invoice_number || null,
        notes || null
      ]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Error creating shipment payment:', err);
    res.status(500).json({ error: 'Error creating payment.' });
  }
});

app.get('/api/shipments/:id/timeline', requireAuth, async (req, res) => {

  try {
    const rows = await dbAll(
      `SELECT * FROM shipment_timeline
       WHERE shipment_id = ?
       ORDER BY created_at ASC`,
      [req.params.id]
    );
    res.json({ timeline: rows });
  } catch (err) {
    console.error('Error loading shipment timeline:', err);
    res.status(500).json({ error: 'Error loading timeline.' });
  }
});

app.get('/api/shipments/:id/comments', requireAuth, async (req, res) => {

  try {
    const rows = await dbAll(
      `SELECT * FROM shipment_comments
       WHERE shipment_id = ?
       ORDER BY created_at ASC`,
      [req.params.id]
    );
    res.json({ comments: rows });
  } catch (err) {
    console.error('Error loading shipment comments:', err);
    res.status(500).json({ error: 'Error loading comments.' });
  }
});

app.post('/api/shipments/:id/comments', requireAuth, async (req, res) => {

  try {
    const { body } = req.body;
    if (!body) {
      return res.status(400).json({ error: 'Comment text required.' });
    }

    await dbRun(
      `INSERT INTO shipment_comments (shipment_id, body, created_at)
       VALUES (?,?, datetime('now'))`,
      [req.params.id, body]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Error creating shipment comment:', err);
    res.status(500).json({ error: 'Error creating comment.' });
  }
});

app.post('/api/shipments/:id/status', requireAuth, async (req, res) => {

  try {
    const id = req.params.id;
    const { new_status, note } = req.body;

    if (!SHIPMENT_STATUSES.includes(new_status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }

    const existing = await dbGet(
      'SELECT status FROM shipments WHERE id = ?',
      [id]
    );
    if (!existing) {
      return res.status(404).json({ error: 'Shipment not found.' });
    }

    await dbRun(
      `UPDATE shipments
       SET status = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [new_status, id]
    );

    await dbRun(
      `INSERT INTO shipment_timeline (shipment_id, event_type, old_status, new_status, note, created_at)
       VALUES (?, 'status_change', ?, ?, ?, datetime('now'))`,
      [id, existing.status, new_status, note || null]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Error updating shipment status:', err);
    res.status(500).json({ error: 'Error updating status.' });
  }
});

// List documents for a shipment
app.get('/api/shipments/:id/documents', async (req, res) => {

  try {
    const shipmentId = Number(req.params.id);
    if (!shipmentId) {
      return res.status(400).json({ error: 'Invalid shipment id.' });
    }

    const access = await ensureShipmentAccess(req);
    if (!access.ok) {
      return res
        .status(access.status || 403)
        .json({ error: access.error || 'Not authorized' });
    }

    const docs = await dbAll(
      `
        SELECT id, shipment_id, title, category, doc_type, doc_label, file_path, uploaded_at
        FROM shipment_documents
        WHERE shipment_id = ?
        ORDER BY uploaded_at DESC, id DESC
      `,
      [shipmentId]
    );

    res.json({ documents: docs });
  } catch (err) {
    console.error('Error loading shipment documents:', err);
    res.status(500).json({ error: 'Error loading shipment documents.' });
  }
});

// Upload one or more documents for a shipment
app.post(
  '/api/shipments/:id/documents',
  requireAuth,
  upload.array('documents', 10),
  async (req, res) => {
    try {
      const shipmentId = Number(req.params.id);
      if (!shipmentId) {
        return res.status(400).json({ error: 'Invalid shipment id.' });
      }

      const files = req.files || [];
      if (!files.length) {
        return res.json({ documents: [] });
      }

      const docType = req.body.doc_type || null;
      const docLabel = req.body.doc_label || null;
      const uploadedBy = null; // hook into auth/user later if you want

      const docs = [];

      for (const file of files) {
        // Relative URL used in the app
        const relPath = `/uploads/shipments/${file.filename}`;

        const result = await dbRun(
          `
            INSERT INTO shipment_documents (
              shipment_id,
              title,
              category,
              doc_type,
              doc_label,
              file_path,
              uploaded_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          [
            shipmentId,
            file.originalname,
            null,          // keep category nullable
            docType,
            docLabel,
            relPath,
            uploadedBy
          ]
        );

        docs.push({
          id: result.lastID,
          shipment_id: shipmentId,
          title: file.originalname,
          category: null,
          doc_type: docType,
          doc_label: docLabel,
          file_path: relPath
        });
      }

      res.json({ documents: docs });
    } catch (err) {
      console.error('Error uploading shipment documents:', err);
      res.status(500).json({ error: 'Error uploading shipment documents.' });
    }
  }
);

// Delete a document for a shipment
app.delete(
  '/api/shipments/:shipmentId/documents/:docId',
  requireAuth,
  async (req, res) => {

  try {
    const shipmentId = Number(req.params.shipmentId);
    const docId = Number(req.params.docId);

    if (!shipmentId || !docId) {
      return res.status(400).json({ error: 'Invalid shipment or document id.' });
    }

    // Fetch the document to know the file path
    const doc = await dbGet(
      `
        SELECT id, shipment_id, file_path
        FROM shipment_documents
        WHERE id = ? AND shipment_id = ?
      `,
      [docId, shipmentId]
    );

    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    // Delete DB row
    await dbRun(
      `DELETE FROM shipment_documents WHERE id = ? AND shipment_id = ?`,
      [docId, shipmentId]
    );

    // Try to delete the physical file
    if (doc.file_path) {
      try {
        const relPath = doc.file_path.replace(/^\/+/, ''); // remove leading slash
        const absPath = path.join(__dirname, 'public', relPath);
        await fsp.unlink(absPath);
      } catch (err) {
        // If file is already gone, don't fail the whole request
        if (err.code !== 'ENOENT') {
          console.error('Error deleting shipment document file:', err);
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting shipment document:', err);
    res.status(500).json({ error: 'Error deleting shipment document.' });
  }
});

// Update storage & pickup details for a shipment (kiosk-friendly)
app.post('/api/shipments/:id/storage', async (req, res) => {
  try {
    const shipmentId = Number(req.params.id);
    if (!shipmentId) {
      return res.status(400).json({ error: 'Invalid shipment id.' });
    }

    const {
      storage_due_date,
      storage_daily_late_fee,
      expected_arrival_date,
      storage_room,
      storage_details,
      picked_up_by,
      picked_up_date,
      employee_id
    } = req.body || {};

    const access = await ensureShipmentAccess(req);
    if (!access.ok) {
      return res
        .status(access.status || 403)
        .json({ error: access.error || 'Not authorized' });
    }

    const existing = await dbGet(
      `SELECT id FROM shipments WHERE id = ?`,
      [shipmentId]
    );
    if (!existing) {
      return res.status(404).json({ error: 'Shipment not found.' });
    }

    const normalizeText = (val) => {
      if (val === undefined || val === null) return null;
      const s = String(val).trim();
      return s === '' ? null : s;
    };

    const feeValStr =
      storage_daily_late_fee === undefined || storage_daily_late_fee === null
        ? ''
        : String(storage_daily_late_fee).trim();
    const feeValNum = feeValStr === '' ? null : Number(feeValStr);
    const feeVal = Number.isFinite(feeValNum) ? feeValNum : null;

    await dbRun(
      `
        UPDATE shipments
        SET
          storage_due_date = ?,
          storage_daily_late_fee = ?,
          expected_arrival_date = ?,
          storage_room = ?,
          storage_details = ?,
          picked_up_by = ?,
          picked_up_date = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `,
      [
        normalizeText(storage_due_date),
        feeVal,
        normalizeText(expected_arrival_date),
        normalizeText(storage_room),
        normalizeText(storage_details),
        normalizeText(picked_up_by),
        normalizeText(picked_up_date),
        shipmentId
      ]
    );

    const row = await dbGet(
      `SELECT s.*,
        COALESCE(s.vendor_name, v.name) AS vendor_name,
        p.name AS project_name,
        p.customer_name
       FROM shipments s
       LEFT JOIN vendors  v ON v.id = s.vendor_id
       LEFT JOIN projects p ON p.id = s.project_id
       WHERE s.id = ?`,
      [shipmentId]
    );

    res.json({ shipment: row });
  } catch (err) {
    console.error('Error updating shipment storage from kiosk:', err);
    res.status(500).json({ error: 'Failed to update storage/pickup.' });
  }
});

// Save verification for shipment items from kiosk-admin / field devices
app.post('/api/shipments/:id/verify-items', async (req, res) => {
  const shipmentId = Number(req.params.id);
  const { items } = req.body || {};

  if (!shipmentId || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'Missing shipment id or items.' });
  }

  try {
    const access = await ensureShipmentAccess(req);
    if (!access.ok) {
      return res
        .status(access.status || 403)
        .json({ error: access.error || 'Not authorized' });
    }

    const nowIso = new Date().toISOString();

    const stmt = db.prepare(`
      UPDATE shipment_items
      SET verification_json = json_set(
        COALESCE(verification_json, '{}'),
        '$.status', ?,
        '$.notes', ?,
        '$.verified_at', ?,
        '$.verified_by', ?
      )
      WHERE id = ?
        AND shipment_id = ?
    `);

    for (const row of items) {
      const vid = Number(row.shipment_item_id);
      if (!vid) continue;

      const v = row.verification || {};
      const verifiedAt = v.verified_at || nowIso;

      stmt.run(
        v.status || '',
        v.notes || '',
        verifiedAt,
        v.verified_by || null,
        vid,
        shipmentId
      );
    }

    stmt.finalize();

// Recompute items_verified flag (all items have a non-empty status)
const uncheckedRow = await dbGet(
  `
    SELECT COUNT(*) AS cnt
    FROM shipment_items
    WHERE shipment_id = ?
      AND COALESCE(json_extract(verification_json, '$.status'), '') = ''
  `,
  [shipmentId]
);

const allVerified = uncheckedRow && uncheckedRow.cnt === 0;

await dbRun(
  `
    UPDATE shipments
    SET items_verified = ?
    WHERE id = ?
  `,
  [allVerified ? 1 : 0, shipmentId]
);


    res.json({ ok: true, items_verified: allVerified });
  } catch (err) {
    console.error('Error saving shipment verification from kiosk:', err);
    res.status(500).json({ error: 'Failed to save shipment verification.' });
  }
});



/* ───────── 9. REPORTS ───────── */

app.get('/api/time-entries/export/:format', requireAuth, (req, res) => {
  const { format } = req.params;
  let { start, end, employee_id, project_id } = req.query;

  // Same default as normal endpoint: if no filters, default to "today"
  if (!start && !end && !employee_id && !project_id) {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const today = `${yyyy}-${mm}-${dd}`;
    start = today;
    end = today;
  }

  // Base query (very similar to /api/time-entries)
  let sql = `
    SELECT
      t.id,
      t.employee_id,
      t.project_id,
      t.start_date,
      t.end_date,
      t.start_time,
      t.end_time,
      t.hours,
      t.total_pay,
      t.paid,
      t.paid_date,
      e.name AS employee_name,
      p.name AS project_name,
      COALESCE(MAX(tp.geo_violation), 0)  AS has_geo_violation,
      COALESCE(MAX(tp.auto_clock_out), 0) AS has_auto_clock_out
    FROM time_entries t
    LEFT JOIN employees   e ON t.employee_id = e.id
    LEFT JOIN projects    p ON t.project_id = p.id
    LEFT JOIN time_punches tp ON tp.time_entry_id = t.id
    WHERE 1=1
  `;

  const params = [];

  if (start) {
    sql += ' AND t.start_date >= ?';
    params.push(start);
  }
  if (end) {
    sql += ' AND t.start_date <= ?';
    params.push(end);
  }
  if (employee_id) {
    sql += ' AND t.employee_id = ?';
    params.push(employee_id);
  }
  if (project_id) {
    sql += ' AND t.project_id = ?';
    params.push(project_id);
  }

  // GROUP BY + ORDER BY go *after* filters
  sql += `
    GROUP BY
      t.id,
      t.employee_id,
      t.project_id,
      t.start_date,
      t.end_date,
      t.start_time,
      t.end_time,
      t.hours,
      t.total_pay,
      t.paid,
      t.paid_date,
      e.name,
      p.name
    ORDER BY t.start_date ASC, t.start_time ASC, t.id ASC
  `;

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('Error exporting time entries:', err.message);
      return res.status(500).json({ error: err.message });
    }

    const safeStart = start || 'all';
    const safeEnd   = end   || 'all';

    if (format === 'csv') {
      // ───────── CSV EXPORT ─────────
      const header = [
        'Employee',
        'Project',
        'Start Date',
        'End Date',
        'Start Time',
        'End Time',
        'Hours',
        'Total Pay',
        'Paid',
        'Paid Date',
        'Geo Violation',
        'Auto Clock-out'
      ];

      function esc(value) {
        const s = value == null ? '' : String(value);
        if (/[",\n]/.test(s)) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      }

      const lines = [header.join(',')];
      rows.forEach(r => {
        const rowArr = [
          r.employee_name || '',
          r.project_name || '',
          r.start_date || '',
          r.end_date || '',
          r.start_time || '',
          r.end_time || '',
          r.hours != null ? r.hours : '',
          r.total_pay != null ? r.total_pay : '',
          r.paid ? 'Yes' : 'No',
          r.paid_date || '',
          r.has_geo_violation ? 'Yes' : '',
          r.has_auto_clock_out ? 'Yes' : ''
        ];
        lines.push(rowArr.map(esc).join(','));
      });

      const csv = lines.join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="time-entries-${safeStart}-${safeEnd}.csv"`
      );
      return res.send(csv);
    }

    if (format === 'pdf') {
      // ───────── PDF EXPORT ─────────
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="time-entries-${safeStart}-${safeEnd}.pdf"`
      );

      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      doc.pipe(res);

      doc.fontSize(16).text('Time Entries Report', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(10).text(
        `Range: ${start || '—'} to ${end || '—'}`,
        { align: 'center' }
      );
      doc.moveDown();

      // simple column headers
      doc.fontSize(9).text(
        'Date        Time           Employee                     Project                          Hours   Paid',
        { underline: true }
      );
      doc.moveDown(0.3);

      rows.forEach(r => {
        const date = r.start_date || '';
        const timeRange = `${r.start_time || ''}–${r.end_time || ''}`;
        const emp = (r.employee_name || '').slice(0, 26);
        const proj = (r.project_name || '').slice(0, 28);
        const hrs = r.hours != null ? r.hours.toFixed(2) : '';
        const paid = r.paid ? 'Yes' : 'No';

        doc.fontSize(9).text(
          `${date.padEnd(11)} ${timeRange.padEnd(13)} ${emp.padEnd(28)} ${proj.padEnd(30)} ${hrs.padEnd(7)} ${paid}`
        );
      });

      doc.end();
      return;
    }

    // Unsupported format
    return res.status(400).json({ error: 'Unsupported export format.' });
  });
});


app.get('/api/reports/payroll-runs', requireAuth, (req, res) => {
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

app.get('/api/reports/payroll-audit', requireAuth, (req, res) => {
  let limit = parseInt(req.query.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0 || limit > 500) {
    limit = 50;
  }

  const sql = `
    SELECT
      id,
      event_type,
      message,
      details_json,
      payroll_run_id,
      created_at,
      actor_employee_id
    FROM payroll_audit_log
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `;

  db.all(sql, [limit], (err, rows) => {
    if (err) {
      console.error('Error loading payroll audit log:', err);
      return res
        .status(500)
        .json({ error: 'Failed to load payroll audit log.' });
    }

    const mapped = (rows || []).map(r => {
      let parsedDetails = null;
      if (r.details_json) {
        try {
          parsedDetails = JSON.parse(r.details_json);
        } catch {
          parsedDetails = null;
        }
      }

      return {
        id: r.id,
        event_type: r.event_type,
        message: r.message,
        payroll_run_id: r.payroll_run_id,
        created_at: r.created_at,
        // these two are "extra" but safe to expose
        details: parsedDetails,
        actor_employee_id: r.actor_employee_id
      };
    });

    res.json(mapped);
  });
});

app.get('/api/reports/payroll-runs/:id', requireAuth, (req, res) => {
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

app.patch('/api/reports/checks/:id', requireAuth, (req, res) => {
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

app.get('/api/reports/payroll-audit-log', requireAuth, async (req, res) => {
  try {
    let limit = parseInt(req.query.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0 || limit > 1000) {
      limit = 200; // sensible default
    }

    const rows = await dbAll(
      `
        SELECT
          id,
          event_type,
          payroll_run_id,
          actor_employee_id,
          message,
          details_json,
          created_at
        FROM payroll_audit_log
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT ?
      `,
      [limit]
    );

    res.json({
      ok: true,
      logs: rows || []
    });
  } catch (err) {
    console.error('Error loading payroll audit log:', err);
    res.status(500).json({
      ok: false,
      error: 'Failed to load payroll audit log.'
    });
  }
});

// ───────── SHIPMENTS VERIFICATION REPORT ─────────
//
// Modes:
//  - Summary mode (no shipment_id): list shipments, filterable,
//    can show "ready for pickup" only.
//  - Detail mode (with shipment_id): single shipment + items +
//    per-item verification history.
//
app.get('/api/reports/shipment-verification', async (req, res) => {
  try {
    const {
      shipment_id,
      project_id,
      status,
      ready_for_pickup,
      start,
      end
    } = req.query || {};

    const access = await ensureShipmentAccess(req);
    if (!access.ok) {
      return res
        .status(access.status || 403)
        .json({ error: access.error || 'Not authorized' });
    }

    // ───── DETAIL MODE: single shipment with items + history ─────
    if (shipment_id) {
      const id = Number(shipment_id);
      if (!id) {
        return res.status(400).json({ error: 'Invalid shipment_id.' });
      }

      // Reuse the same shape as /api/shipments/:id
      const shipment = await dbGet(
        `SELECT s.*,
                COALESCE(s.vendor_name, v.name) AS vendor_name,
                p.name AS project_name,
                p.customer_name
           FROM shipments s
      LEFT JOIN vendors  v ON v.id = s.vendor_id
      LEFT JOIN projects p ON p.id = s.project_id
          WHERE s.id = ?`,
        [id]
      );

      if (!shipment) {
        return res.status(404).json({ error: 'Shipment not found.' });
      }

      const items = await dbAll(
        `
          SELECT
            id,
            shipment_id,
            description,
            sku,
            quantity,
            unit_price,
            line_total,
            verified,
            notes,
            verification_json
          FROM shipment_items
          WHERE shipment_id = ?
          ORDER BY id ASC
        `,
        [id]
      );

      const normalizedItems = items.map(it => {
        let verification = null;

        if (it.verification_json) {
          try {
            verification = JSON.parse(it.verification_json);
          } catch {
            verification = null;
          }
        }

        const isEmptyObject =
          verification &&
          typeof verification === 'object' &&
          !Array.isArray(verification) &&
          Object.keys(verification).length === 0;

        if (!verification || isEmptyObject) {
          verification = {
            status: it.verified ? 'verified' : '',
            notes: it.notes || '',
            history: []
          };
        } else {
          // Ensure we always have an array for history
          if (!Array.isArray(verification.history)) {
            verification.history = [];
          }
        }

        return {
          ...it,
          verification
        };
      });

      return res.json({
        mode: 'detail',
        shipment,
        items: normalizedItems
      });
    }

    // ───── SUMMARY MODE: list shipments (with filters) ─────
    const params = [];
    let where = 'WHERE IFNULL(s.is_archived, 0) = 0 ';

    if (project_id) {
      where += 'AND s.project_id = ? ';
      params.push(project_id);
    }

    if (status) {
      where += 'AND s.status = ? ';
      params.push(status);
    }

    // Optional date range on created_at
    if (start) {
      where += 'AND date(s.created_at) >= date(?) ';
      params.push(start);
    }
    if (end) {
      where += 'AND date(s.created_at) <= date(?) ';
      params.push(end);
    }

    // "Ready for pickup" filter:
    //  - items_verified = 1 (all items verified)
    //  - picked_up_by IS NULL (not yet picked up)
    //  - status is "Cleared - Ready for Release" (adjust if you like)
    if (
      ready_for_pickup === '1' ||
      ready_for_pickup === 'true' ||
      ready_for_pickup === 'yes'
    ) {
      where += `
        AND s.items_verified = 1
        AND (s.picked_up_by IS NULL OR s.picked_up_by = '')
        AND s.status = 'Cleared - Ready for Release'
      `;
    }

    const rows = await dbAll(
      `
        SELECT
          s.id,
          s.title,
          s.bol_number,
          s.sku,
          s.tracking_number,
          s.freight_forwarder,
          s.status,
          s.project_id,
          p.name AS project_name,
          p.customer_name,
          s.items_verified,
          (
            SELECT COUNT(*) FROM shipment_items si
            WHERE si.shipment_id = s.id
          ) AS items_total,
          (
            SELECT COUNT(*)
            FROM shipment_items si
            WHERE si.shipment_id = s.id
              AND LOWER(
                COALESCE(
                  NULLIF(json_extract(si.verification_json, '$.status'), ''),
                  CASE WHEN IFNULL(si.verified, 0) = 1 THEN 'verified' ELSE '' END
                )
              ) = 'verified'
          ) AS items_verified_count,
          s.picked_up_by,
          s.picked_up_date,
          s.verified_by,
          s.expected_arrival_date,
          s.storage_due_date,
          s.storage_daily_late_fee,
          s.created_at,
          s.total_price,
          s.vendor_paid,
          s.vendor_paid_amount,
          s.shipper_paid,
          s.shipper_paid_amount,
          s.customs_paid,
          s.customs_paid_amount,
          s.total_paid,
          s.vendor_paid,
          s.vendor_paid_amount,
          s.shipper_paid,
          s.shipper_paid_amount,
          s.customs_paid,
          s.customs_paid_amount,
          s.total_paid,
          COALESCE(s.vendor_name, v.name) AS vendor_name,
          (
            SELECT COUNT(DISTINCT TRIM(IFNULL(si.vendor_name, '')))
            FROM shipment_items si
            WHERE si.shipment_id = s.id
              AND TRIM(IFNULL(si.vendor_name, '')) <> ''
          ) AS distinct_item_vendors
        FROM shipments s
        LEFT JOIN vendors v ON v.id = s.vendor_id
        LEFT JOIN projects p ON p.id = s.project_id
        ${where}
        ORDER BY
          date(IFNULL(s.updated_at, s.created_at)) DESC,
          s.id DESC
      `,
      params
    );

    return res.json({
      mode: 'summary',
      shipments: rows
    });
  } catch (err) {
    console.error('Error in /api/reports/shipment-verification:', err);
    res.status(500).json({ error: 'Failed to load shipment verification report.' });
  }
});

/* ───────── MIDNIGHT AUTO CLOCK-OUT JOB ───────── */

async function autoClockOutStaleOpenPunches(reason = 'midnight_auto') {
  try {
    // Find any open punches that started on a prior calendar day
    const openPunches = await dbAll(
      `
        SELECT *
        FROM time_punches
        WHERE clock_out_ts IS NULL
          AND date(clock_in_ts) < date('now')
      `
    );

    if (!openPunches || openPunches.length === 0) {
      console.log(`⏰ Auto clock-out (${reason}): no stale open punches.`);
      return;
    }

    const nowIso = new Date().toISOString();

    for (const p of openPunches) {
      const startIso = p.clock_in_ts || nowIso;
      const start = new Date(startIso);
      const end   = new Date(nowIso);

      let diffMs = end - start;
      let minutes = Math.ceil(diffMs / 60000);

      if (!Number.isFinite(minutes) || minutes < 0) {
        minutes = 0;
      }

      const hours = minutes / 60;
      const startDate = startIso.slice(0, 10);
      const endDate   = nowIso.slice(0, 10);

      // 1) Close the punch and mark as auto
      await dbRun(
        `
          UPDATE time_punches
          SET clock_out_ts = ?,
              auto_clock_out = 1,
              auto_clock_out_reason = ?,
              clock_out_project_id = ?
          WHERE id = ?
        `,
        [nowIso, reason, p.project_id || null, p.id]
      );

      // 2) Compute total pay from employee rate
      const emp = await dbGet(
        'SELECT rate FROM employees WHERE id = ?',
        [p.employee_id]
      );
      const rate = emp ? Number(emp.rate || 0) : 0;
      const totalPay = rate * hours;

      // 3) Create a time_entry for payroll
const insertEntry = await dbRun(
  `
    INSERT INTO time_entries
      (employee_id,
       project_id,
       start_date,
       end_date,
       hours,
       total_pay,
       foreman_employee_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  [
    p.employee_id,
    p.project_id || null,
    startDate,
    endDate,
    hours,
    totalPay,
    p.foreman_employee_id || null
  ]
);

const entryId = insertEntry.lastID;

// 🔗 Link the auto-closed punch to its time entry
await dbRun(
  `
    UPDATE time_punches
    SET time_entry_id = ?
    WHERE id = ?
  `,
  [entryId, p.id]
);

    }

    console.log(
      `⏰ Auto clock-out (${reason}): closed ${openPunches.length} open punches.`
    );
  } catch (err) {
    console.error(`⏰ Auto clock-out (${reason}) error:`, err);
  }
}

// Schedule the job to run every local midnight
function scheduleMidnightAutoClockOut() {
  const now = new Date();
  const next = new Date(now);

  // Tomorrow at 00:00 local time
  next.setHours(24, 0, 0, 0);
  const delayMs = next.getTime() - now.getTime();

  console.log(
    `⏰ Scheduling midnight auto-clock-out in ${Math.round(
      delayMs / 1000
    )} seconds.`
  );

  setTimeout(async () => {
    await autoClockOutStaleOpenPunches('midnight_auto');
    // Re-schedule for the following midnight
    scheduleMidnightAutoClockOut();
  }, delayMs);
}

// Run a catch-up job on startup and hourly in case midnight was missed
function scheduleAutoClockOutCatchUp() {
  const runCatchUp = () => autoClockOutStaleOpenPunches('catch_up_auto');
  runCatchUp();
  setInterval(runCatchUp, 60 * 60 * 1000); // hourly
}


/* ───────── 10. SERVER START & BACKUPS ───────── */

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);

  // Start the midnight auto clock-out scheduler
  scheduleMidnightAutoClockOut();

  // Start periodic catch-up so stale punches are auto-closed after outages
  scheduleAutoClockOutCatchUp();
});

// Run a backup at startup
performDatabaseBackup();

// Schedule daily backups every 24 hours
setInterval(performDatabaseBackup, 24 * 60 * 60 * 1000);
