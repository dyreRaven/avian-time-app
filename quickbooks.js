// quickbooks.js
// Handles QuickBooks OAuth2 and basic query/sync helpers.

const db = require('./db');
const crypto = require('crypto');

const EXPENSE_ACCOUNT_NAME = '5000 - Direct Job Costs:5010 - Direct Labor';
const BANK_ACCOUNT_NAME = '1000 - Bank Accounts:1010 - Checking (Operating)';

require('dotenv').config();
const axios = require('axios');
const { normalizePayrollRules, applyOvertimeAllocations, roundCurrency } = require('./lib/payroll-utils');

const {
  QBO_CLIENT_ID,
  QBO_CLIENT_SECRET,
  QBO_REDIRECT_URI,
  QBO_REALM_ID
} = process.env;

const AUTH_BASE = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const API_BASE = 'https://sandbox-quickbooks.api.intuit.com/v3/company';
let refreshPromise = null; // serialize refresh attempts so we don't race/overwrite

const deriveEncKey = () => {
  const raw =
    process.env.SESSION_ENCRYPTION_KEY ||
    process.env.SESSION_SECRET;
  if (!raw) return null;
  return crypto.createHash('sha256').update(String(raw)).digest();
};

const ENC_PREFIX = 'enc:v1:';
function encryptValue(str) {
  const key = deriveEncKey();
  if (!key) return str;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let enc = cipher.update(String(str), 'utf8', 'base64');
  enc += cipher.final('base64');
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${enc}`;
}

function decryptValue(str) {
  const key = deriveEncKey();
  if (!key || !str || !str.startsWith(ENC_PREFIX)) return str;
  try {
    const body = str.slice(ENC_PREFIX.length);
    const [ivB64, tagB64, dataB64] = body.split(':');
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    let dec = decipher.update(dataB64, 'base64', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  } catch {
    return null;
  }
}

// Ensure Name-on-Checks timestamp columns exist
async function ensureNameOnChecksColumns() {
  const runPromise = (sql) =>
    new Promise((resolve, reject) => {
      db.run(sql, err => (err ? reject(err) : resolve()));
    });
  return new Promise((resolve, reject) => {
    db.all('PRAGMA table_info(employees)', async (err, rows) => {
      if (err) return reject(err);
      const cols = rows.map(r => r.name);
      const needed = [];
      if (!cols.includes('name_on_checks_updated_at')) {
        needed.push("ALTER TABLE employees ADD COLUMN name_on_checks_updated_at TEXT");
      }
      if (!cols.includes('name_on_checks_qbo_updated_at')) {
        needed.push("ALTER TABLE employees ADD COLUMN name_on_checks_qbo_updated_at TEXT");
      }
      try {
        for (const sql of needed) {
          await runPromise(sql);
        }
        resolve(true);
      } catch (e) {
        // If another process added it, ignore the duplicate column error
        if (String(e.message || '').includes('duplicate column')) {
          return resolve(true);
        }
        reject(e);
      }
    });
  });
}

// Load toggleable time exception rules from app_settings
function loadExceptionRulesMap() {
  return new Promise(resolve => {
    db.get(
      'SELECT value FROM app_settings WHERE key = ?',
      ['time_exception_rules'],
      (err, row) => {
        if (err || !row || !row.value) return resolve(null);
        try {
          const parsed = JSON.parse(row.value);
          resolve(parsed && typeof parsed === 'object' ? parsed : null);
        } catch {
          resolve(null);
        }
      }
    );
  });
}

function loadPayrollRulesMap() {
  return new Promise(resolve => {
    db.get(
      'SELECT value FROM app_settings WHERE key = ?',
      ['payroll_rules'],
      (err, row) => {
        if (err || !row || !row.value) return resolve(null);
        try {
          const parsed = JSON.parse(row.value);
          resolve(parsed && typeof parsed === 'object' ? parsed : null);
        } catch {
          resolve(null);
        }
      }
    );
  });
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

/* ───────── 1. AUTH URL (for "Connect to QuickBooks" button) ───────── */

function getAuthUrl() {
  const params = new URLSearchParams({
    client_id: QBO_CLIENT_ID,
    redirect_uri: QBO_REDIRECT_URI,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    state: 'xyz123' // you can randomize this later if you want
  });

  return `${AUTH_BASE}?${params.toString()}`;
}

/* ───────── 2. PAYROLL SETTINGS LOADER ───────── */

function getPayrollSettings() {
  return new Promise((resolve, reject) => {
    db.get(
      `
        SELECT
          bank_account_name,
          expense_account_name,
          default_memo,
          line_description_template
        FROM payroll_settings
        WHERE id = 1
      `,
      (err, row) => {
        if (err) return reject(err);

        const bankAccountName = row?.bank_account_name || null;
        const expenseAccountName = row?.expense_account_name || null;
        const memoTemplate = row?.default_memo || 'Payroll {start} – {end}';
        const lineDescriptionTemplate =
          row?.line_description_template || 'Labor {hours} hrs – {project}';

        resolve({
          bankAccountName,
          expenseAccountName,
          memoTemplate,
          lineDescriptionTemplate
        });
      }
    );
  });
}

/* ───────── 3. DATE HELPERS ───────── */

function formatDateUS(dateInput) {
  if (!dateInput) return '';

  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return dateInput; // fallback

  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();

  return `${mm}/${dd}/${yyyy}`;
}

/* ───────── 4. LIST QUICKBOOKS CLASSES ───────── */

async function listClasses() {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('Not connected to QuickBooks');
  }

  const data = await qboQuery(
    "SELECT Id, Name, FullyQualifiedName, Active " +
      "FROM Class " +
      "ORDER BY FullyQualifiedName"
  );

  const classes = data.QueryResponse?.Class || [];
  return classes;
}

/* ───────── 5. TOKEN STORAGE HELPERS (SQLite) ───────── */

function saveTokens({ access_token, refresh_token, expires_in }) {
  // expires_in = seconds from now
  const expiresAt = Date.now() + (expires_in - 60) * 1000; // minus 60s for safety

  const encAccess = encryptValue(access_token);
  const encRefresh = encryptValue(refresh_token);

  db.run(
    `
      INSERT INTO qbo_tokens (id, access_token, refresh_token, expires_at)
      VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        access_token  = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expires_at    = excluded.expires_at
    `,
    [encAccess, encRefresh, expiresAt]
  );
}

function getTokensFromDb() {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM qbo_tokens LIMIT 1', (err, row) => {
      if (err) return reject(err);
      if (!row) return resolve(null);
      const access = decryptValue(row.access_token) || row.access_token;
      const refresh = decryptValue(row.refresh_token) || row.refresh_token;
      resolve({ ...row, access_token: access, refresh_token: refresh });
    });
  });
}

function clearTokens() {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM qbo_tokens', err => (err ? reject(err) : resolve()));
  });
}

/* ───────── 6. EXCHANGE / REFRESH TOKENS ───────── */

async function exchangeCodeForTokens(code) {
  const basicAuth = Buffer.from(
    `${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`
  ).toString('base64');

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: QBO_REDIRECT_URI
  });

  const res = await axios.post(TOKEN_URL, params.toString(), {
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });

  saveTokens(res.data);
  return res.data;
}

async function refreshAccessToken(refreshToken) {
  const basicAuth = Buffer.from(
    `${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`
  ).toString('base64');

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });

  const res = await axios.post(TOKEN_URL, params.toString(), {
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });

  saveTokens(res.data);
  return res.data;
}

/* ───────── 7. GET A VALID ACCESS TOKEN (refresh if needed) ───────── */

async function getAccessToken() {
  const row = await getTokensFromDb();
  if (!row) {
    console.log('[QBO] No tokens found in qbo_tokens table');
    return null;
  }

  if (row.expires_at && row.expires_at > Date.now()) {
    return row.access_token;
  }

  if (!row.refresh_token) {
    console.log('[QBO] Token expired but no refresh_token stored');
    return null;
  }

  const startedRefresh = !refreshPromise;
  if (!refreshPromise) {
    console.log('[QBO] Access token expired; refreshing…');
    refreshPromise = refreshAccessToken(row.refresh_token).finally(() => {
      refreshPromise = null;
    });
  } else {
    console.log('[QBO] Access token expired; waiting on existing refresh…');
  }

  try {
    const refreshed = await refreshPromise;
    return refreshed?.access_token || null;
  } catch (err) {
    if (startedRefresh) {
      console.error(
        '[QBO] Error refreshing token:',
        err.response?.status || err.message
      );

      const status = err.response?.status;
      if (status === 400 || status === 401) {
        console.warn('[QBO] Clearing stored tokens; please reconnect QuickBooks.');
        try {
          await clearTokens();
        } catch (wipeErr) {
          console.warn(
            '[QBO] Failed to clear tokens after refresh error:',
            wipeErr.message || wipeErr
          );
        }
      }
    }
    return null;
  }
}

/* ───────── 8. GENERIC QBO QUERY HELPER ───────── */

async function qboQuery(query) {
  console.log('qboQuery called with query:', query);

  const accessToken = await getAccessToken();
  if (!accessToken) {
    throw new Error('Not connected to QuickBooks (no access token).');
  }

  const realmId = QBO_REALM_ID;
  if (!realmId) {
    throw new Error('QBO_REALM_ID is not set in .env');
  }

  const url = `${API_BASE}/${realmId}/query`;

  try {
    const res = await axios.get(url, {
      params: { query, minorversion: 62 },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    });
    return res.data;
  } catch (err) {
    if (err.response) {
      console.error(
        'QBO query error:',
        err.response.status,
        JSON.stringify(err.response.data, null, 2)
      );
    } else {
      console.error('QBO query error:', err.message);
    }
    throw err;
  }
}

/* ───────── 9. LIST PAYROLL ACCOUNTS (BANK & EXPENSE) ───────── */

async function listPayrollAccounts() {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('Not connected to QuickBooks');
  }

  const data = await qboQuery(
    "SELECT Id, Name, FullyQualifiedName, AccountType, SubAccount " +
      "FROM Account " +
      "WHERE AccountType IN ('Bank','Expense','Cost of Goods Sold','Other Expense') " +
      "ORDER BY FullyQualifiedName"
  );

  const accounts = data.QueryResponse?.Account || [];

  const bankAccounts = accounts.filter(a => a.AccountType === 'Bank');
  const expenseAccounts = accounts.filter(
    a =>
      a.AccountType === 'Expense' ||
      a.AccountType === 'Cost of Goods Sold' ||
      a.AccountType === 'Other Expense'
  );

  return { bankAccounts, expenseAccounts };
}

/* ───────── 10. SYNC HELPERS (VENDORS / PROJECTS / EMPLOYEES) ───────── */

// Download Vendors from QuickBooks → store in vendors table
async function syncVendors() {
  const data = await qboQuery('SELECT Id, DisplayName, Active FROM Vendor');
  const vendors = (data.QueryResponse && data.QueryResponse.Vendor) || [];

  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // 1) Mark all QBO-backed vendors as inactive by default
      db.run(
        `UPDATE vendors SET active = 0 WHERE qbo_id IS NOT NULL`,
        err => {
          if (err) return reject(err);

          // 2) Upsert each vendor with the correct active flag from QBO
          const upsertSql = `
            INSERT INTO vendors (qbo_id, name, active)
            VALUES (?, ?, ?)
            ON CONFLICT(qbo_id) DO UPDATE SET
              name = excluded.name,
              active = excluded.active
          `;

          const stmt = db.prepare(upsertSql);

          vendors.forEach(v => {
            const name = v.DisplayName || '';
            const isActive =
              v.Active === undefined || v.Active === null
                ? 1
                : v.Active
                ? 1
                : 0;

            stmt.run([String(v.Id), name, isActive]);
          });

          stmt.finalize(err2 => {
            if (err2) return reject(err2);
            resolve(vendors.length);
          });
        }
      );
    });
  });
}

// Download Employees from QuickBooks and sync into employees table
async function syncEmployeesFromQuickBooks() {
  // Pull employees from QuickBooks (only the fields we care about)
  const data = await qboQuery(
    'SELECT Id, DisplayName, GivenName, FamilyName, Active, PrimaryEmailAddr FROM Employee'
  );

  console.log(
    '[QBO RAW EMPLOYEE RESPONSE]',
    JSON.stringify(data, null, 2)
  );

  let raw = data.QueryResponse && data.QueryResponse.Employee;
  const employees = Array.isArray(raw)
    ? raw
    : raw
    ? [raw]
    : [];

  return new Promise((resolve, reject) => {
    if (!employees.length) {
      return resolve(0);
    }

    db.serialize(() => {
      const updateSql = `
        UPDATE employees
        SET
          name = ?,
          name_on_checks = ?,
          name_on_checks_updated_at = ?,
          name_on_checks_qbo_updated_at = ?,
          email = ?,
          active = ?
        WHERE employee_qbo_id = ?
      `;

      const insertSql = `
        INSERT INTO employees (
          employee_qbo_id,
          name,
          nickname,
          name_on_checks,
          rate,
          active,
          pin,
          require_photo,
          is_admin,
          uses_timekeeping,
          email,
          language,
          name_on_checks_updated_at,
          name_on_checks_qbo_updated_at
        )
        VALUES (?, ?, NULL, ?, 0, ?, NULL, 0, 0, 1, ?, 'en', ?, ?)
      `;

      let processed = 0;

      employees.forEach(emp => {
        const qboId = String(emp.Id);
        const qboPrintName = (emp.PrintOnCheckName || '').trim();
        const displayName =
          qboPrintName ||
          emp.DisplayName ||
          [emp.GivenName || '', emp.FamilyName || ''].join(' ').trim();
        const qboUpdatedIso =
          emp.MetaData && emp.MetaData.LastUpdatedTime
            ? new Date(emp.MetaData.LastUpdatedTime).toISOString()
            : null;
        const qboUpdatedMs = qboUpdatedIso ? Date.parse(qboUpdatedIso) : 0;

        const email =
          emp.PrimaryEmailAddr && emp.PrimaryEmailAddr.Address
            ? emp.PrimaryEmailAddr.Address.trim()
            : null;

        const isActive =
          emp.Active === true || emp.Active === 'true' ? 1 : 0;

        db.get(
          `
            SELECT
              name_on_checks,
              name_on_checks_updated_at,
              name_on_checks_qbo_updated_at
            FROM employees
            WHERE employee_qbo_id = ?
            LIMIT 1
          `,
          [qboId],
          (lookupErr, row) => {
            if (lookupErr) return reject(lookupErr);

            const localName = row ? (row.name_on_checks || '').trim() : '';
            const localUpdatedMs = row && row.name_on_checks_updated_at
              ? Date.parse(row.name_on_checks_updated_at)
              : 0;
            const localQboUpdatedMs = row && row.name_on_checks_qbo_updated_at
              ? Date.parse(row.name_on_checks_qbo_updated_at)
              : 0;

            const shouldTakeQbo =
              !localName ||
              (qboUpdatedMs && qboUpdatedMs > Math.max(localUpdatedMs, localQboUpdatedMs));

            const finalNameOnChecks = shouldTakeQbo
              ? (qboPrintName || displayName)
              : (row ? row.name_on_checks : (qboPrintName || displayName));

            const finalLocalUpdated = shouldTakeQbo
              ? row?.name_on_checks_updated_at || null
              : row?.name_on_checks_updated_at || null;
            const finalQboUpdated = qboUpdatedIso || row?.name_on_checks_qbo_updated_at || null;

            if (row) {
              db.run(
                updateSql,
                [
                  displayName,
                  finalNameOnChecks || null,
                  finalLocalUpdated,
                  finalQboUpdated,
                  email,
                  isActive,
                  qboId
                ],
                function (errUpdate) {
                  if (errUpdate) return reject(errUpdate);
                  processed++;
                  if (processed === employees.length) {
                    resolve(processed);
                  }
                }
              );
            } else {
              db.run(
                insertSql,
                [
                  qboId,
                  displayName,
                  finalNameOnChecks || null,
                  isActive,
                  email,
                  null,
                  qboUpdatedIso || null
                ],
                function (errInsert) {
                  if (errInsert) return reject(errInsert);
                  processed++;
                  if (processed === employees.length) {
                    resolve(processed);
                  }
                }
              );
            }
          }
        );
      });
    });
  });
}

/* ───────── Shared helper: set PrintOnCheckName for a payee ───────── */
async function setPrintOnCheckName(payeeRef, desiredName) {
  if (!payeeRef || !payeeRef.value || !desiredName) {
    return { ok: false, error: 'Missing payeeRef or desired name.' };
  }

  const accessToken = await getAccessToken();
  const realmId = QBO_REALM_ID;
  if (!accessToken || !realmId) {
    return { ok: false, error: 'Not connected to QuickBooks.' };
  }

  const type = payeeRef.type === 'Vendor' ? 'Vendor' : 'Employee';

  try {
    const data = await qboQuery(
      `select Id, SyncToken, DisplayName, PrintOnCheckName from ${type} where Id = '${payeeRef.value}'`
    );
    const raw = data && data.QueryResponse && data.QueryResponse[type];
    const entity = Array.isArray(raw) ? raw[0] : raw;
    if (!entity || !entity.Id || typeof entity.SyncToken === 'undefined') {
      return { ok: false, error: `${type} not found in QuickBooks.` };
    }

    const current = (entity.PrintOnCheckName || entity.DisplayName || '').trim();
    if (current === desiredName.trim()) {
      return { ok: true, skipped: true };
    }

    const url = `${API_BASE}/${realmId}/${type.toLowerCase()}`;
    const payload = {
      sparse: true,
      Id: entity.Id,
      SyncToken: entity.SyncToken,
      PrintOnCheckName: desiredName,
      DisplayName: entity.DisplayName || desiredName
    };

    await axios.post(url, payload, {
      params: { minorversion: 62 },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }
    });

    return { ok: true };
  } catch (err) {
    let friendly = err.response ? `HTTP ${err.response.status}` : err.message;
    if (err.response && err.response.data) {
      const fault = err.response.data.Fault;
      const firstError =
        fault && Array.isArray(fault.Error) && fault.Error[0]
          ? fault.Error[0]
          : null;
      if (firstError) {
        if (firstError.Message) friendly = firstError.Message;
        if (firstError.Detail) friendly += ' – ' + firstError.Detail;
      }
    }
    return { ok: false, error: friendly };
  }
}





// Download Customers (used as projects/jobs) → store in projects table
async function syncProjects() {
  // 1) Call QBO for active customers/jobs (projects)
  const data = await qboQuery('SELECT * FROM Customer WHERE Active = true');
  const customers =
    (data.QueryResponse && data.QueryResponse.Customer) || [];
  console.log(
    `syncProjects: received ${customers.length} active customers from QBO.`
  );

  // 2) Mark all QBO-backed projects as inactive first
  await new Promise((resolve, reject) => {
    db.run(
      `UPDATE projects SET active = 0 WHERE qbo_id IS NOT NULL`,
      err => (err ? reject(err) : resolve())
    );
  });

  // 3) Upsert each QBO customer as active=1
  const upsertSql = `
    INSERT INTO projects (qbo_id, name, customer_name, active)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(qbo_id) DO UPDATE SET
      name = excluded.name,
      customer_name = excluded.customer_name,
      active = 1
  `;

  await new Promise((resolve, reject) => {
    db.serialize(() => {
      const stmt = db.prepare(upsertSql);
customers.forEach(cust => {
  const qboId = String(cust.Id);
  const displayName = cust.DisplayName || cust.CompanyName || '';

  let customerName = null;
  const fq = cust.FullyQualifiedName || '';

  if (fq) {
    const parts = fq.split(':');

    if (parts.length > 1) {
      // Everything except the last segment = customer
      // Last segment = the job/project (which is already displayName)
      customerName = parts.slice(0, -1).join(':').trim();
    } else {
      // Top-level customer → don’t duplicate name in the customer column
      customerName = null;
    }
  }

  stmt.run(
    [qboId, displayName, customerName],
    err =>
      err && console.error('Project upsert error:', err.message)
  );
});

      stmt.finalize(err => (err ? reject(err) : resolve()));
    });
  });

  console.log('syncProjects: upsert complete.');
  return customers.length;
}

/* ───────── 11. ACCOUNT LOOKUP BY NAME ───────── */

async function getAccountIdByName(name, accessToken, realmId) {
  const safe = name.replace(/'/g, "\\'");
  const query = `select Id from Account where FullyQualifiedName='${safe}'`;
  const url = `${API_BASE}/${realmId}/query`;

  const res = await axios.get(url, {
    params: { query, minorversion: 62 },
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    }
  });

  const data = res.data;
  const acc = data?.QueryResponse?.Account?.[0];
  return acc?.Id || null;
}

async function getClassIdByName(name, accessToken, realmId) {
  const safe = name.replace(/'/g, "\\'");
  const query = `select Id from Class where FullyQualifiedName='${safe}'`;
  const url = `${API_BASE}/${realmId}/query`;

  const res = await axios.get(url, {
    params: { query, minorversion: 62 },
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    }
  });

  const data = res.data;
  const cls = data?.QueryResponse?.Class?.[0];
  return cls?.Id || null;
}

// Look for an already-queued (NeedToPrint) check for this payee so we can append lines
async function findExistingQueuedCheck(payeeRef, accessToken, realmId) {
  if (!payeeRef || !payeeRef.value) return null;

  const safeId = String(payeeRef.value).replace(/'/g, "\\'");
  const query =
    "SELECT * FROM Purchase " +
    "WHERE PaymentType = 'Check' " +
    "AND PrintStatus = 'NeedToPrint' " +
    `AND EntityRef = '${safeId}' ` +
    "ORDER BY MetaData.CreateTime DESC";

  const url = `${API_BASE}/${realmId}/query`;

  try {
    const res = await axios.get(url, {
      params: { query, minorversion: 62 },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    });

    const purchases = res.data?.QueryResponse?.Purchase;
    if (!purchases) return null;
    const existing = Array.isArray(purchases) ? purchases[0] : purchases;

    if (
      existing &&
      existing.EntityRef &&
      existing.EntityRef.value &&
      String(existing.EntityRef.value) !== String(payeeRef.value)
    ) {
      return null;
    }

    return existing || null;
  } catch (err) {
    console.warn(
      '[QBO] Failed to search for existing queued check:',
      err.response?.status || err.message
    );
    return null; // fall back to creating a new check
  }
}

/* ───────── 12. LINE DESCRIPTION HELPER ───────── */

function buildLineDescription(template, row, start, end) {
  if (!template) {
    return `Labor ${Number(row.project_hours || row.total_hours || 0).toFixed(
      2
    )} hrs – ${row.project_name || ''}`;
  }

  const startUS = formatDateUS(start);
  const endUS = formatDateUS(end);
  const dateRange = `${startUS} – ${endUS}`;

  return template
    .replace('{employee}', row.employee_name || '')
    .replace('{project}', row.project_name || '')
    .replace(
      '{hours}',
      Number(row.project_hours || row.total_hours || 0).toFixed(2)
    )
    .replace('{dateRange}', dateRange)
    .replace('{start}', startUS)
    .replace('{end}', endUS);
}

function appendPayrollPrivateNote(baseMemo, runContext = {}) {
  const parts = [];
  if (runContext.payrollRunId) {
    parts.push(`Run ${runContext.payrollRunId}`);
  }
  if (runContext.runType === 'adjustment') {
    parts.push('Adjustment');
  }
  if (runContext.adjustmentReason) {
    const trimmed = String(runContext.adjustmentReason).trim().slice(0, 120);
    if (trimmed) parts.push(`Reason: ${trimmed}`);
  }
  if (runContext.idempotencyKey) {
    parts.push(`Key ${runContext.idempotencyKey}`);
  }
  if (!parts.length) return baseMemo;
  return `${baseMemo} | ${parts.join(' | ')}`;
}

/* ───────── 13. BUILD DRAFTS FROM time_entries (DB ONLY) ───────── */

async function buildCheckDrafts(start, end, options = {}) {
  const { excludeEmployeeIds = [], includeOvertime = true } = options;
  const HOURS_EPSILON = 0.1; // keep in sync with payroll/time-entries endpoint
  const payrollRulesRaw = await loadPayrollRulesMap();
  const payrollRules = normalizePayrollRules(payrollRulesRaw);

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

  let sql = `
      WITH entry_flags AS (
        SELECT
          t.id,
          t.employee_id,
          t.project_id,
          t.employee_name_snapshot,
          t.project_name_snapshot,
          t.start_date,
          t.end_date,
          t.hours,
          t.total_pay,
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
          AND (t.paid IS NULL OR t.paid = 0)
        GROUP BY
          t.id,
          t.employee_id,
          t.project_id,
          t.employee_name_snapshot,
          t.project_name_snapshot,
          t.start_date,
          t.end_date,
          t.hours,
          t.total_pay,
          t.resolved_status
      )
      SELECT
        f.id AS time_entry_id,
        f.employee_id,
        f.project_id,
        f.employee_name_snapshot,
        f.project_name_snapshot,
        f.start_date,
        f.end_date,
        f.hours,
        f.total_pay,
        e.name AS employee_name,
        e.name_on_checks AS employee_name_on_checks,
        e.rate AS employee_rate,
        e.vendor_qbo_id,
        e.employee_qbo_id,
        COALESCE(p.name, f.project_name_snapshot, '(No project)') AS project_name,
        COALESCE(p.name, f.project_name_snapshot, '(No project)') AS project_name_raw,
        p.qbo_id AS project_qbo_id,
        p.customer_name AS project_customer_name
      FROM entry_flags f
      JOIN employees e ON f.employee_id = e.id
      LEFT JOIN projects p ON f.project_id = p.id
      WHERE
        (
          -- entry-level exception gate: allow when no exception OR approved
          ${entryExceptionExpr} = 0
          OR LOWER(COALESCE(f.resolved_status, 'open')) IN ('approved', 'modified')
        )
        AND (
          -- punch-level exceptions gate: allow when none OR all are approved
          IFNULL(f.punch_exception_count, 0) = 0
          OR IFNULL(f.punch_exception_unapproved_count, 0) = 0
        )
    `;

  const params = [start, end];

  if (excludeEmployeeIds.length) {
    const placeholders = excludeEmployeeIds.map(() => '?').join(',');
    sql += ` AND e.id NOT IN (${placeholders})`;
    params.push(...excludeEmployeeIds);
  }

  sql += `
      ORDER BY
        employee_name,
        project_name,
        f.start_date,
        f.id
    `;

  const rows = await new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

  const entriesByEmployee = new Map();
  for (const r of rows) {
    const hours = Number(r.hours || 0);
    const totalPay = Number(r.total_pay || 0);
    const employeeRate = Number(r.employee_rate || 0);
    const baseRate =
      hours > 0 && Number.isFinite(totalPay) && totalPay > 0
        ? totalPay / hours
        : employeeRate;
    const entry = {
      time_entry_id: r.time_entry_id,
      employee_id: r.employee_id,
      employee_name: r.employee_name || r.employee_name_snapshot,
      employee_name_raw: r.employee_name,
      name_on_checks: r.employee_name_on_checks || null,
      vendor_qbo_id: r.vendor_qbo_id,
      employee_qbo_id: r.employee_qbo_id,
      project_id: r.project_id,
      project_name: r.project_name,
      project_name_raw: r.project_name_raw,
      project_qbo_id: r.project_qbo_id,
      project_customer_name: r.project_customer_name,
      entry_date: r.start_date,
      hours,
      total_pay: totalPay,
      base_rate: Number.isFinite(baseRate) ? baseRate : 0,
      employee_rate: employeeRate
    };
    if (!entriesByEmployee.has(r.employee_id)) {
      entriesByEmployee.set(r.employee_id, []);
    }
    entriesByEmployee.get(r.employee_id).push(entry);
  }

  const byEmployee = new Map();
  entriesByEmployee.forEach(entries => {
    applyOvertimeAllocations(entries, payrollRules, includeOvertime);
    entries.forEach(entry => {
      let draft = byEmployee.get(entry.employee_id);
      if (!draft) {
        const displayName = entry.name_on_checks || entry.employee_name;
        draft = {
          employee_id: entry.employee_id,
          employee_name: displayName,
          employee_name_raw: entry.employee_name,
          name_on_checks: entry.name_on_checks || null,
          vendor_qbo_id: entry.vendor_qbo_id,
          employee_qbo_id: entry.employee_qbo_id,
          total_hours: 0,
          total_pay: 0,
          lines: [],
          _lineMap: new Map()
        };
        byEmployee.set(entry.employee_id, draft);
      }
      draft.total_hours += Number(entry.hours || 0);
      draft.total_pay += Number(entry.adjusted_pay || 0);

      const lineKey = entry.project_id || 'none';
      if (!draft._lineMap.has(lineKey)) {
        draft._lineMap.set(lineKey, {
          project_id: entry.project_id,
          project_name: entry.project_name,
          project_name_raw: entry.project_name_raw,
          project_qbo_id: entry.project_qbo_id,
          project_customer_name: entry.project_customer_name,
          project_hours: 0,
          project_pay: 0
        });
      }
      const line = draft._lineMap.get(lineKey);
      line.project_hours += Number(entry.hours || 0);
      line.project_pay += Number(entry.adjusted_pay || 0);
    });
  });

  const drafts = [];
  for (const draft of byEmployee.values()) {
    draft.lines = Array.from(draft._lineMap.values()).map(line => ({
      ...line,
      project_hours: roundCurrency(line.project_hours),
      project_pay: roundCurrency(line.project_pay)
    }));
    draft.total_hours = roundCurrency(draft.total_hours);
    draft.total_pay = roundCurrency(draft.total_pay);
    delete draft._lineMap;
    drafts.push(draft);
  }

  return drafts;
}

async function computePayrollDraftsSnapshot(start, end, options = {}) {
  const excludeEmployeeIds = Array.isArray(options.excludeEmployeeIds)
    ? options.excludeEmployeeIds
    : [];
  const onlyEmployeeIds = Array.isArray(options.onlyEmployeeIds)
    ? options.onlyEmployeeIds.map(Number).filter(Number.isFinite)
    : [];
  const includeOvertime =
    typeof options.includeOvertime === 'boolean' ? options.includeOvertime : true;
  const drafts = await buildCheckDrafts(start, end, { excludeEmployeeIds, includeOvertime });

  let finalDrafts = drafts;
  if (onlyEmployeeIds.length) {
    const idSet = new Set(onlyEmployeeIds);
    finalDrafts = drafts.filter(d => idSet.has(Number(d.employee_id)));
  }

  const normalizeAmount = value => Number(value || 0).toFixed(4);
  const snapshot = finalDrafts
    .map(d => ({
      employee_id: Number(d.employee_id),
      total_hours: normalizeAmount(d.total_hours),
      total_pay: normalizeAmount(d.total_pay),
      lines: (Array.isArray(d.lines) ? d.lines : [])
        .map(l => ({
          project_id: l.project_id,
          project_hours: normalizeAmount(l.project_hours),
          project_pay: normalizeAmount(l.project_pay)
        }))
        .sort((a, b) => String(a.project_id).localeCompare(String(b.project_id)))
    }))
    .sort((a, b) => a.employee_id - b.employee_id);

  const payload = JSON.stringify(snapshot);
  const digest = crypto.createHash('sha256').update(payload).digest('hex');

  return {
    snapshot_hash: `sha256:${digest}`,
    snapshot_count: snapshot.length
  };
}

/* ───────── 14. CREATE CHECKS FOR A PAY PERIOD ───────── */
/*  Note: this helper does NOT write payroll_runs or payroll_checks.
    The Express route (/api/payroll/create-checks) handles all DB writes
    and marks time_entries as paid. */

async function createChecksForPeriod(start, end, options = {}) {
  const accessToken = await getAccessToken();
  const realmId = QBO_REALM_ID;
  const settings = await getPayrollSettings();
  const startUS = formatDateUS(start);
  const endUS = formatDateUS(end);
  const previewOnly = options.previewOnly === true;
  const runContext = options.runContext || {};
  const includeOvertime =
    typeof options.includeOvertime === 'boolean' ? options.includeOvertime : true;

  const bankName =
    options.bankAccountName || settings.bank_account_name || settings.bankAccountName || BANK_ACCOUNT_NAME;
  const expenseName =
    options.expenseAccountName || settings.expense_account_name || settings.expenseAccountName || EXPENSE_ACCOUNT_NAME;

  const memoTemplate =
    options.memo || settings.memoTemplate || `Payroll {start} – {end}`;

  const lineTemplate =
    options.lineDescriptionTemplate ||
    settings.lineDescriptionTemplate ||
    `Labor {hours} hrs – {project}`;

  const excludeEmployeeIds = options.excludeEmployeeIds || [];
  const customLines = Array.isArray(options.customLines)
    ? options.customLines
        .map(l => ({
          employeeId: Number(l.employeeId),
          amount: Number(l.amount || 0),
          description: l.description || '',
          expenseAccountName: l.expenseAccountName || null,
          className: l.className || null,
          projectId: l.projectId || null
        }))
        .filter(l => l.employeeId && l.amount > 0)
    : [];
  const customLinesByEmployee = new Map();
  customLines.forEach(l => {
    if (!customLinesByEmployee.has(l.employeeId)) customLinesByEmployee.set(l.employeeId, []);
    customLinesByEmployee.get(l.employeeId).push(l);
  });
  const lineOverrides = Array.isArray(options.lineOverrides)
    ? options.lineOverrides.filter(l => l && l.employeeId && l.projectId)
    : [];
  const overrideByLine = new Map();
  lineOverrides.forEach(l => {
    const key = `${l.employeeId}:${String(l.projectId)}`;
    overrideByLine.set(key, {
      expenseAccountName: l.expenseAccountName || null,
      description: l.description || null,
      className: l.className || null
    });
  });

  // Optional: only process a specific set of employees (used for retry)
  const onlyEmployeeIds = Array.isArray(options.onlyEmployeeIds)
    ? options.onlyEmployeeIds.map(Number).filter(n => Number.isFinite(n))
    : null;

  /* ────────────────────────────────────────────────
     PER-EMPLOYEE OVERRIDES (expense/memo/description)
     options.overrides = [
       { employeeId, expenseAccountName, memo, lineDescriptionTemplate }
     ]
  ──────────────────────────────────────────────── */
  const overrideByEmployee = {};
  if (Array.isArray(options.overrides)) {
    for (const o of options.overrides) {
      if (!o || !o.employeeId) continue;
      overrideByEmployee[o.employeeId] = {
        expense: o.expenseAccountName || null,
        memo: o.memo || null,
        descTemplate: o.lineDescriptionTemplate || null
      };
    }
  }

  /* ────────────────────────────────────────────────
     NOT CONNECTED → return pure preview drafts
     (used by /api/payroll/preview-checks)
  ──────────────────────────────────────────────── */
  if (!accessToken || !realmId) {
    const drafts = await buildCheckDrafts(start, end, { excludeEmployeeIds, includeOvertime });

    drafts.forEach(draft => {
      const extras = customLinesByEmployee.get(draft.employee_id) || [];
      extras.forEach(line => {
        draft.lines.push({
          project_id: line.projectId || `custom-${Date.now()}`,
          project_name: line.description || '(Custom line)',
          project_hours: 0,
          project_pay: line.amount,
          is_custom: true,
          expense_account_name: line.expenseAccountName || null,
          class_name: line.className || null,
          description_override: line.description || null
        });
        draft.total_pay += Number(line.amount || 0);
      });
    });

    drafts.forEach(draft => {
      const empOv = overrideByEmployee[draft.employee_id] || {};
      const effectiveLineTemplate = empOv.descTemplate || lineTemplate;
      const effectiveMemoTemplate = empOv.memo || memoTemplate;
      const effectiveExpenseName = empOv.expense || expenseName;

      // Attach line descriptions using effective line template
      draft.lines = draft.lines.map(line => ({
        ...line,
        description:
          (overrideByLine.get(`${draft.employee_id}:${String(line.project_id)}`)?.description ||
            line.description_override ||
            buildLineDescription(
              effectiveLineTemplate,
              {
                employee_name: draft.employee_name,
                project_name: line.project_name,
                project_hours: line.project_hours
              },
              start,
              end
            ))
      }));

      // Also attach memo / expense used for this draft so UI can show them
      draft.memo = effectiveMemoTemplate
        .replace('{employee}', draft.employee_name || '')
        .replace('{start}', startUS)
        .replace('{end}', endUS)
        .replace('{dateRange}', `${startUS} – ${endUS}`);
      draft.expense_account_name = effectiveExpenseName;
    });

    return {
      ok: false,
      reason: 'Not connected to QuickBooks (no access token or realmId).',
      drafts,
      bankAccountName: bankName,
      expenseAccountName: expenseName,
      memoTemplate,
      lineDescriptionTemplate: lineTemplate
    };
  }

  /* ────────────────────────────────────────────────
     CONNECTED → resolve account IDs
  ──────────────────────────────────────────────── */
  const defaultExpenseAccountId = await getAccountIdByName(
    expenseName,
    accessToken,
    realmId
  );

  const bankAccountId = await getAccountIdByName(
    bankName,
    accessToken,
    realmId
  );

  if (!defaultExpenseAccountId || !bankAccountId) {
    throw new Error(
      'Could not find expense or bank account in QuickBooks. Check names in payroll settings.'
    );
  }

  // Cache for any override expense names we need to look up
  const expenseIdCache = { [expenseName]: defaultExpenseAccountId };
  async function getExpenseAccountIdForName(name) {
    if (!name || name === expenseName) {
      return defaultExpenseAccountId;
    }
    if (expenseIdCache[name]) {
      return expenseIdCache[name];
    }
    const id = await getAccountIdByName(name, accessToken, realmId);
    expenseIdCache[name] = id;
    return id;
  }

  const drafts = await buildCheckDrafts(start, end, { excludeEmployeeIds, includeOvertime });

  // Attach any custom lines (UI-added)
  for (const draft of drafts) {
    const extras = customLinesByEmployee.get(draft.employee_id) || [];
    if (!extras.length) continue;
    extras.forEach(line => {
      draft.lines.push({
        project_id: line.projectId || `custom-${Date.now()}`,
        project_name: line.description || '(Custom line)',
        project_hours: 0,
        project_pay: line.amount,
        is_custom: true,
        expense_account_name: line.expenseAccountName || null,
        class_name: line.className || null,
        description_override: line.description || null
      });
      draft.total_pay += Number(line.amount || 0);
    });
  }

  // If onlyEmployeeIds is specified, limit drafts to those employees only.
  let finalDrafts = drafts;
  if (onlyEmployeeIds && onlyEmployeeIds.length) {
    const idSet = new Set(onlyEmployeeIds.map(Number));
    finalDrafts = drafts.filter(d => idSet.has(Number(d.employee_id)));
  }

  const results = [];

  const ensurePayeePrintName = setPrintOnCheckName;

  // If we hit a "catastrophic" QBO error (network outage, 5xx, auth),
  // we stop sending further checks and just mark the remaining employees
  // as "not sent due to previous error".
  let fatalQboError = null;

  /* ────────────────────────────────────────────────
     CREATE REAL CHECKS IN QUICKBOOKS
     One check per employee, one line per project
  ──────────────────────────────────────────────── */
  for (const draft of finalDrafts) {
    const empOv = overrideByEmployee[draft.employee_id] || {};

    const effectiveExpenseName = empOv.expense || expenseName;
    const effectiveMemoTemplate = empOv.memo || memoTemplate;
    const effectiveLineTemplate = empOv.descTemplate || lineTemplate;

    draft._ok = false;
    draft.qbo_txn_id = null;

    // If a fatal error already happened, do NOT call QBO again for this employee.
    if (fatalQboError) {
      results.push({
        employeeId: draft.employee_id,
        employeeName: draft.employee_name,
        totalHours: Number(draft.total_hours || 0),
        totalPay: Number(draft.total_pay || 0),
        ok: false,
        error:
          'Not sent to QuickBooks because a previous error occurred: ' +
          fatalQboError
      });
      continue;
    }

    const payeeRef = draft.vendor_qbo_id
      ? { value: draft.vendor_qbo_id, type: 'Vendor' }
      : (draft.employee_qbo_id ? { value: draft.employee_qbo_id, type: 'Employee' } : null);
    const previewIssues = [];
    if (!payeeRef || !payeeRef.value) {
      previewIssues.push('No QuickBooks payee linked (vendor/employee ID missing).');
    }

    const lineItems = [];
    const classIdCache = {};
    async function getClassIdForName(name) {
      if (!name) return null;
      if (classIdCache[name]) return classIdCache[name];
      const id = await getClassIdByName(name, accessToken, realmId);
      classIdCache[name] = id;
      return id;
    }
    const lineErrors = [];

    for (const line of draft.lines) {
      const lineKey = `${draft.employee_id}:${String(line.project_id)}`;
      const lineOv = overrideByLine.get(lineKey);
      const expenseNameForLine = lineOv?.expenseAccountName || effectiveExpenseName;
      const expenseIdForLine = await getExpenseAccountIdForName(expenseNameForLine);
      if (!expenseIdForLine) {
        lineErrors.push(`Expense account "${expenseNameForLine}" not found in QuickBooks.`);
        continue;
      }
      const classNameForLine =
        lineOv?.className ||
        line.class_name ||
        line.project_name_raw ||
        line.project_name ||
        null;
      const classId = classNameForLine ? await getClassIdForName(classNameForLine) : null;
      if (classNameForLine && !classId) {
        lineErrors.push(`Class "${classNameForLine}" not found in QuickBooks.`);
        continue;
      }
      const description =
        lineOv?.description ||
        line.description_override ||
        buildLineDescription(
          effectiveLineTemplate,
          {
            employee_name: draft.employee_name,
            project_name: line.project_name,
            project_hours: line.project_hours
          },
          start,
          end
        );

      const detail = {
        AccountRef: { value: expenseIdForLine }
      };
      if (line.project_qbo_id) {
        detail.CustomerRef = { value: line.project_qbo_id };
      }
      if (classId) {
        detail.ClassRef = { value: classId };
      }

      lineItems.push({
        DetailType: 'AccountBasedExpenseLineDetail',
        Amount: roundCurrency(line.project_pay || 0),
        Description: description,
        AccountBasedExpenseLineDetail: detail
      });
    }

    const baseMemoText = effectiveMemoTemplate
      .replace('{employee}', draft.employee_name || '')
      .replace('{start}', startUS)
      .replace('{end}', endUS)
      .replace('{dateRange}', `${startUS} – ${endUS}`);

    const issues = [...previewIssues, ...lineErrors];
    if (!lineItems.length) {
      issues.push('No payable lines for this employee.');
    }

    if (previewOnly) {
      const ok = issues.length === 0;
      results.push({
        employeeId: draft.employee_id,
        employeeName: draft.employee_name,
        totalHours: Number(draft.total_hours || 0),
        totalPay: Number(draft.total_pay || 0),
        ok,
        error: ok ? null : issues.join(' '),
        warnings: [],
        warningCodes: [],
        previewOnly: true
      });
      continue;
    }

    if (issues.length) {
      results.push({
        employeeId: draft.employee_id,
        employeeName: draft.employee_name,
        totalHours: Number(draft.total_hours || 0),
        totalPay: Number(draft.total_pay || 0),
        ok: false,
        error: issues.join(' ')
      });
      continue;
    }

    const desiredPrintName = draft.name_on_checks || draft.employee_name || '';
    let nameWarning = null;
    if (desiredPrintName) {
      const nameRes = await ensurePayeePrintName(payeeRef, desiredPrintName);
      if (!nameRes?.ok && !nameRes?.skipped) {
        nameWarning = `Could not update print name in QuickBooks: ${nameRes.error || 'Unknown error'}`;
      }
    }

    const url = `${API_BASE}/${realmId}/purchase`;

    const payload = {
      PaymentType: 'Check',
      AccountRef: { value: bankAccountId },
      EntityRef: payeeRef,
      TxnDate: end,
      PrivateNote: appendPayrollPrivateNote(baseMemoText, runContext),
      PrintStatus: 'NeedToPrint',
      Line: lineItems
    };

    try {
      if (!payeeRef || !payeeRef.value) {
        results.push({
          employeeId: draft.employee_id,
          employeeName: draft.employee_name,
          totalHours: Number(draft.total_hours || 0),
          totalPay: Number(draft.total_pay || 0),
          ok: false,
          error: 'No QuickBooks payee linked (vendor/employee ID missing).'
        });
        console.warn('[PAYROLL/QBO] Missing payeeRef for employee', draft.employee_name, {
          vendor_qbo_id: draft.vendor_qbo_id,
          employee_qbo_id: draft.employee_qbo_id
        });
        continue;
      }

      const res = await axios.post(url, payload, {
        params: { minorversion: 62 },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        }
      });

      const resData = res && res.data ? res.data : null;
      const purchase = resData && resData.Purchase ? resData.Purchase : null;
      const qboTxnId = purchase && purchase.Id ? purchase.Id : null;

      draft._ok = true;
      draft.qbo_txn_id = qboTxnId;

      results.push({
        employeeId: draft.employee_id,
        employeeName: draft.employee_name,
        totalHours: Number(draft.total_hours || 0),
        totalPay: Number(draft.total_pay || 0),
        ok: true,
        qboTxnId,
        warnings: nameWarning ? [nameWarning] : [],
        warningCodes: nameWarning ? ['print_name_sync_failed'] : []
      });
    } catch (err) {
      let friendly = err.response ? `HTTP ${err.response.status}` : err.message;
      if (err.response && err.response.data) {
        const fault = err.response.data.Fault;
        const firstError =
          fault && Array.isArray(fault.Error) && fault.Error[0]
            ? fault.Error[0]
            : null;
        if (firstError) {
          if (firstError.Message) friendly = firstError.Message;
          if (firstError.Detail) friendly += ' – ' + firstError.Detail;
        }
      }

      draft._ok = false;
      draft.qbo_txn_id = null;

      results.push({
        employeeId: draft.employee_id,
        employeeName: draft.employee_name,
        totalHours: Number(draft.total_hours || 0),
        totalPay: Number(draft.total_pay || 0),
        ok: false,
        error: friendly,
        warnings: nameWarning ? [nameWarning] : [],
        warningCodes: nameWarning ? ['print_name_sync_failed'] : []
      });

      // Decide if this looks "catastrophic" (platform / network) vs per-employee.
      const status = err.response ? err.response.status : null;
      const isNetworkLevel = !err.response; // no HTTP response at all
      const isServerError = status && status >= 500;
      const isAuthOrRateLimit =
        status === 401 || status === 403 || status === 429;

      if (isNetworkLevel || isServerError || isAuthOrRateLimit) {
        fatalQboError = friendly;
        // Note: we do NOT throw here; the loop will continue,
        // but any remaining employees will be marked "not sent"
        // without additional QBO calls.
      }
    }
  }

  // No DB writes here; server.js handles payroll_runs/payroll_checks/time_entries

  return {
    ok: true,
    start,
    end,
    results,
    fatalQboError
  };
}

/* ───────── 15. EXPORTS ───────── */

module.exports = {
  getAuthUrl,
  exchangeCodeForTokens,
  getAccessToken,
  syncVendors,
  syncProjects,
  createChecksForPeriod,
  computePayrollDraftsSnapshot,
  syncEmployeesFromQuickBooks,
  listPayrollAccounts,
  listClasses,
  setPrintOnCheckName,
  ensureNameOnChecksColumns
};
