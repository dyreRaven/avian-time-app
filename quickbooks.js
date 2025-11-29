// quickbooks.js
// Handles QuickBooks OAuth2 and basic query/sync helpers.

const db = require('./db');

const EXPENSE_ACCOUNT_NAME = '5000 - Direct Job Costs:5010 - Direct Labor';
const BANK_ACCOUNT_NAME = '1000 - Bank Accounts:1010 - Checking (Operating)';

require('dotenv').config();
const axios = require('axios');

const {
  QBO_CLIENT_ID,
  QBO_CLIENT_SECRET,
  QBO_REDIRECT_URI,
  QBO_REALM_ID
} = process.env;

const AUTH_BASE = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const API_BASE = 'https://sandbox-quickbooks.api.intuit.com/v3/company';

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

  db.serialize(() => {
    // Only one row – wipe old, insert new
    db.run('DELETE FROM qbo_tokens');
    db.run(
      'INSERT INTO qbo_tokens (access_token, refresh_token, expires_at) VALUES (?,?,?)',
      [access_token, refresh_token, expiresAt]
    );
  });
}

function getTokensFromDb() {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM qbo_tokens LIMIT 1', (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
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

  console.log('[QBO] Access token expired; refreshing…');
  try {
    const refreshed = await refreshAccessToken(row.refresh_token);
    return refreshed.access_token;
  } catch (err) {
    console.error(
      '[QBO] Error refreshing token:',
      err.response?.status || err.message
    );
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
          name           = ?,
          name_on_checks = ?,
          email          = ?,
          active         = ?
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
          email
        )
        VALUES (?, ?, NULL, ?, 0, ?, NULL, 0, 0, 1, ?)
      `;

      let processed = 0;

      employees.forEach(emp => {
        const qboId = String(emp.Id);
        const displayName = emp.DisplayName || [
          emp.GivenName || '',
          emp.FamilyName || ''
        ].join(' ').trim();

        const email =
          emp.PrimaryEmailAddr && emp.PrimaryEmailAddr.Address
            ? emp.PrimaryEmailAddr.Address.trim()
            : null;

        const isActive =
          emp.Active === true || emp.Active === 'true' ? 1 : 0;

        // 1) Try to update existing employee (keep rate/admin/pin flags)
        db.run(
          updateSql,
          [displayName, displayName, email, isActive, qboId],
          function (err) {
            if (err) return reject(err);

            if (this.changes && this.changes > 0) {
              processed++;
              if (processed === employees.length) {
                resolve(processed);
              }
              return;
            }

            // 2) If no row updated, insert a new employee
            db.run(
              insertSql,
              [qboId, displayName, displayName, isActive, email],
              function (err2) {
                if (err2) return reject(err2);

                processed++;
                if (processed === employees.length) {
                  resolve(processed);
                }
              }
            );
          }
        );
      });
    });
  });
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

/* ───────── 13. BUILD DRAFTS FROM time_entries (DB ONLY) ───────── */

function buildCheckDrafts(start, end, options = {}) {
  const { excludeEmployeeIds = [] } = options;

  return new Promise((resolve, reject) => {
    let sql = `
      SELECT
        e.id AS employee_id,
        e.name AS employee_name,
        e.vendor_qbo_id,
        p.id AS project_id,
        COALESCE(p.name, '(No project)') AS project_name,
        SUM(t.hours)     AS project_hours,
        SUM(t.total_pay) AS project_pay
      FROM time_entries t
      JOIN employees e ON t.employee_id = e.id
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE t.start_date >= ? AND t.end_date <= ?
        AND (t.paid IS NULL OR t.paid = 0)
    `;

    const params = [start, end];

    if (excludeEmployeeIds.length) {
      const placeholders = excludeEmployeeIds.map(() => '?').join(',');
      sql += ` AND e.id NOT IN (${placeholders})`;
      params.push(...excludeEmployeeIds);
    }

    sql += `
      GROUP BY
        e.id, e.name, e.vendor_qbo_id,
        p.id, p.name
      ORDER BY
        e.name,
        project_name
    `;

    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);

      // Group rows by employee to build one draft per employee
      const byEmployee = new Map();

      for (const r of rows) {
        let draft = byEmployee.get(r.employee_id);
        if (!draft) {
          draft = {
            employee_id: r.employee_id,
            employee_name: r.employee_name,
            vendor_qbo_id: r.vendor_qbo_id,
            total_hours: 0,
            total_pay: 0,
            lines: []
          };
          byEmployee.set(r.employee_id, draft);
        }

        const projectHours = Number(r.project_hours || 0);
        const projectPay = Number(r.project_pay || 0);

        draft.total_hours += projectHours;
        draft.total_pay += projectPay;

        draft.lines.push({
          project_id: r.project_id,
          project_name: r.project_name,
          project_hours: projectHours,
          project_pay: projectPay
          // later we can add project_qbo_customer_id, class_qbo_id, etc.
        });
      }

      resolve(Array.from(byEmployee.values()));
    });
  });
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
    const drafts = await buildCheckDrafts(start, end, { excludeEmployeeIds });

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

  const drafts = await buildCheckDrafts(start, end, { excludeEmployeeIds });

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

    const expenseAccountId = await getExpenseAccountIdForName(
      effectiveExpenseName
    );

    const lineItems = [];
    const classIdCache = {};
    async function getClassIdForName(name) {
      if (!name) return null;
      if (classIdCache[name]) return classIdCache[name];
      const id = await getClassIdByName(name, accessToken, realmId);
      classIdCache[name] = id;
      return id;
    }

    for (const line of draft.lines) {
      const lineKey = `${draft.employee_id}:${String(line.project_id)}`;
      const lineOv = overrideByLine.get(lineKey);
      const expenseNameForLine = lineOv?.expenseAccountName || effectiveExpenseName;
      const expenseIdForLine = await getExpenseAccountIdForName(expenseNameForLine);
      const classNameForLine = lineOv?.className || line.class_name || null;
      const classId = classNameForLine ? await getClassIdForName(classNameForLine) : null;
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
      if (classId) {
        detail.ClassRef = { value: classId };
      }

      lineItems.push({
        DetailType: 'AccountBasedExpenseLineDetail',
        Amount: Number(line.project_pay || 0),
        Description: description,
        AccountBasedExpenseLineDetail: detail
      });
    }

    const memoText = effectiveMemoTemplate
      .replace('{employee}', draft.employee_name || '')
      .replace('{start}', startUS)
      .replace('{end}', endUS)
      .replace('{dateRange}', `${startUS} – ${endUS}`);

    const payload = {
      PaymentType: 'Check',
      AccountRef: { value: bankAccountId },
      EntityRef: { value: draft.vendor_qbo_id, type: 'Vendor' },
      TxnDate: end,
      PrivateNote: memoText,
      PrintStatus: 'NeedToPrint',
      Line: lineItems
    };

    const url = `${API_BASE}/${realmId}/purchase`;

    try {
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
        qboTxnId
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
        error: friendly
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
  syncEmployeesFromQuickBooks,
  listPayrollAccounts,
  listClasses
};
