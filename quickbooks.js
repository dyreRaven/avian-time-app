// quickbooks.js
// Handles QuickBooks OAuth2 and basic query/sync helpers.

const db = require('./db');

const EXPENSE_ACCOUNT_NAME = '5000 - Direct Job Costs:5010 - Direct Labor';
const BANK_ACCOUNT_NAME = '1000 - Bank Accounts:1010 - Checking (Operating)';
require('dotenv').config();
const axios = require('axios');   // ← ADD THIS

const {
  QBO_CLIENT_ID,
  QBO_CLIENT_SECRET,
  QBO_REDIRECT_URI,
  QBO_REALM_ID
} = process.env;

const AUTH_BASE = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const API_BASE = 'https://quickbooks.api.intuit.com/v3/company';

/* ───────── AUTH URL (for "Connect to QuickBooks" button) ───────── */

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

/* ───────── TOKEN STORAGE HELPERS (SQLite) ───────── */

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

/* ───────── EXCHANGE / REFRESH TOKENS ───────── */

async function exchangeCodeForTokens(code) {
  const basicAuth = Buffer.from(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`).toString('base64');

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
  const basicAuth = Buffer.from(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`).toString('base64');

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

/* ───────── GET A VALID ACCESS TOKEN (refresh if needed) ───────── */

async function getAccessToken() {
  const row = await getTokensFromDb();
  if (!row) return null;

  // still valid?
  if (row.expires_at && row.expires_at > Date.now()) {
    return row.access_token;
  }

  // need to refresh
  if (!row.refresh_token) {
    return null;
  }

  const refreshed = await refreshAccessToken(row.refresh_token);
  return refreshed.access_token;
}

/* ───────── GENERIC QBO QUERY HELPER ───────── */

async function qboQuery(query) {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    throw new Error('Not connected to QuickBooks (no access token).');
  }

  const realmId = QBO_REALM_ID;
  if (!realmId) {
    throw new Error('QBO_REALM_ID is not set in .env');
  }

  const url = `${API_BASE}/${realmId}/query`;

  const res = await axios.get(url, {
    params: {
      query,
      minorversion: 62
    },
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    }
  });

  return res.data;
}

/* ───────── SYNC HELPERS (VENDORS / PROJECTS) ───────── */

// Download Vendors from QuickBooks → store in vendors table
async function syncVendors() {
  const data = await qboQuery('SELECT Id, DisplayName FROM Vendor');
  const vendors = (data.QueryResponse && data.QueryResponse.Vendor) || [];

  return new Promise((resolve, reject) => {
    const stmt = db.prepare(
      'INSERT OR IGNORE INTO vendors (qbo_id, name) VALUES (?, ?)'
    );

    db.serialize(() => {
      vendors.forEach(v => {
        const name = v.DisplayName || '';
        stmt.run(v.Id, name);
      });

      stmt.finalize(err => {
        if (err) return reject(err);
        resolve(vendors.length);
      });
    });
  });
}

// Download Customers (used as projects/jobs) → store in projects table
async function syncProjects() {
  const data = await qboQuery('SELECT Id, DisplayName, ParentRef FROM Customer');
  const customers = (data.QueryResponse && data.QueryResponse.Customer) || [];

  return new Promise((resolve, reject) => {
    const stmt = db.prepare(
      'INSERT OR IGNORE INTO projects (qbo_id, name, customer_name) VALUES (?, ?, ?)'
    );

    db.serialize(() => {
      customers.forEach(c => {
        const name = c.DisplayName || '';
        const customerName = c.ParentRef ? (c.ParentRef.name || '') : '';
        stmt.run(c.Id, name, customerName);
      });

      stmt.finalize(err => {
        if (err) return reject(err);
        resolve(customers.length);
      });
    });
  });
}

async function getAccountIdByName(name, accessToken, realmId) {
  const safe = name.replace(/'/g, "\\'");
  const query = `select Id from Account where FullyQualifiedName='${safe}'`;
  const url = `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(
    query
  )}&minorversion=62`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    }
  });
  const text = await res.text();
  if (!res.ok) {
    console.error('Account lookup failed:', res.status, text);
    throw new Error('Failed to look up account in QuickBooks.');
  }
  const data = JSON.parse(text);
  const acc = data?.QueryResponse?.Account?.[0];
  return acc?.Id || null;
}

async function createChecksForPeriod(start, end) {
  const accessToken = await getAccessToken();
  const realmId = process.env.QBO_REALM_ID;

  if (!accessToken || !realmId) {
    // Still useful: show what would be created
    const drafts = await buildCheckDrafts(start, end);
    return {
      ok: false,
      reason: 'Not connected to QuickBooks (no access token or realmId).',
      drafts
    };
  }

  // Look up the bank & expense accounts once
  const expenseAccountId = await getAccountIdByName(
    EXPENSE_ACCOUNT_NAME,
    accessToken,
    realmId
  );
  const bankAccountId = await getAccountIdByName(
    BANK_ACCOUNT_NAME,
    accessToken,
    realmId
  );

  if (!expenseAccountId || !bankAccountId) {
    throw new Error(
      'Could not find expense or bank account in QuickBooks. Check names in constants.'
    );
  }

  // Build check drafts from local DB (grouped by employee)
  const drafts = await buildCheckDrafts(start, end);

    const results = [];
  for (const draft of drafts) {
    if (!draft.vendor_qbo_id) {
      results.push({
        employee: draft.employee_name,
        ok: false,
        error:
          'Employee is not linked to a QuickBooks Vendor (vendor_qbo_id is null).'
      });
      continue;
    }

    const payload = {
      PaymentType: 'Check',
      AccountRef: { value: bankAccountId }, // bank
      EntityRef: { value: draft.vendor_qbo_id, type: 'Vendor' },
      TxnDate: end, // use end of pay period
      PrintStatus: 'NeedToPrint',
      Line: [
        {
          DetailType: 'AccountBasedExpenseLineDetail',
          Amount: draft.total_pay,
          Description: `Payroll ${start} – ${end}`,
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: expenseAccountId }
            // You could add ClassRef or CustomerRef here later
          }
        }
      ]
    };

    const url = `https://quickbooks.api.intuit.com/v3/company/${realmId}/purchase?minorversion=62`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const text = await res.text();
      if (res.ok) {
        results.push({
          employee: draft.employee_name,
          ok: true,
          response: JSON.parse(text)
        });
      } else {
        let friendly = `HTTP ${res.status}`;
        try {
          const parsed = JSON.parse(text);
          const err = parsed?.Fault?.Error?.[0];
          if (err) {
            friendly = err.Message || friendly;
            if (err.Detail) friendly += ' – ' + err.Detail;
          }
        } catch (_) {
          friendly = `HTTP ${res.status} – ${text.slice(0, 180)}`;
        }

        results.push({
          employee: draft.employee_name,
          ok: false,
          error: friendly
        });
      }
    } catch (err) {
      console.error('Check send error for', draft.employee_name, err);
      results.push({
        employee: draft.employee_name,
        ok: false,
        error: err.message
      });
    }
  }

  // 🔹 NEW: record this payroll run + checks for Reports
  const payrollRunId = await savePayrollRun(start, end, drafts);

  return {
    ok: true,
    start,
    end,
    payrollRunId,
    results
  };
}

function buildCheckDrafts(start, end) {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT
        e.id AS employee_id,
        e.name AS employee_name,
        e.vendor_qbo_id,
        SUM(t.hours)     AS total_hours,
        SUM(t.total_pay) AS total_pay
      FROM time_entries t
      JOIN employees e ON t.employee_id = e.id
      WHERE t.start_date >= ? AND t.end_date <= ?
      GROUP BY e.id, e.name, e.vendor_qbo_id
      ORDER BY e.name
    `;
    db.all(sql, [start, end], (err, rows) => {
      if (err) return reject(err);
      resolve(
        rows.map(r => ({
          employee_id: r.employee_id,
          employee_name: r.employee_name,
          vendor_qbo_id: r.vendor_qbo_id,
          total_hours: Number(r.total_hours || 0),
          total_pay: Number(r.total_pay || 0)
        }))
      );
    });
  });
}

async function savePayrollRun(start, end, drafts) {
  if (!drafts || !drafts.length) {
    return null;
  }

  const totalHours = drafts.reduce(
    (sum, d) => sum + (Number(d.total_hours) || 0),
    0
  );
  const totalPay = drafts.reduce(
    (sum, d) => sum + (Number(d.total_pay) || 0),
    0
  );
  const createdAt = new Date().toISOString();

  // Insert into payroll_runs
  const runId = await new Promise((resolve, reject) => {
    db.run(
      `
        INSERT INTO payroll_runs (start_date, end_date, created_at, total_hours, total_pay)
        VALUES (?, ?, ?, ?, ?)
      `,
      [start, end, createdAt, totalHours, totalPay],
      function (err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });

  // Insert rows into payroll_checks
  await new Promise((resolve, reject) => {
    const stmt = db.prepare(
      `
        INSERT INTO payroll_checks
          (payroll_run_id, employee_id, total_hours, total_pay, check_number, paid, qbo_txn_id)
        VALUES (?, ?, ?, ?, NULL, 0, NULL)
      `
    );

    for (const draft of drafts) {
      stmt.run(
        runId,
        draft.employee_id,
        Number(draft.total_hours || 0),
        Number(draft.total_pay || 0)
      );
    }

    stmt.finalize(err => {
      if (err) return reject(err);
      resolve();
    });
  });

  return runId;
}



module.exports = {
  getAuthUrl,
  exchangeCodeForTokens,
  getAccessToken,
  syncVendors,
  syncProjects,
  createChecksForPeriod
};
