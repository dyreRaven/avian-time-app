// quickbooks.js
// Handles QuickBooks OAuth2 and basic query/sync helpers.

const db = require('./db');
const crypto = require('crypto');

const EXPENSE_ACCOUNT_NAME = '5000 - Direct Job Costs:5010 - Direct Labor';
const BANK_ACCOUNT_NAME = '1000 - Bank Accounts:1010 - Checking (Operating)';

require('dotenv').config();
const axios = require('axios');
const DEFAULT_QBO_HTTP_TIMEOUT_MS = 60000;
axios.defaults.timeout = DEFAULT_QBO_HTTP_TIMEOUT_MS;
const { normalizePayrollRules, applyOvertimeAllocations, roundCurrency } = require('./lib/payroll-utils');
const {
  APP_TIMEZONE,
  QBO_CLIENT_ID,
  QBO_CLIENT_SECRET,
  QBO_REDIRECT_URI,
  QBO_API_BASE,
  QBO_DEBUG,
  SESSION_SECRET,
  SESSION_ENCRYPTION_KEY
} = require('./lib/config');

const AUTH_BASE = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const API_BASE = QBO_API_BASE;
const refreshPromises = new Map(); // per-org refresh guards

const deriveEncKey = () => {
  const raw = SESSION_ENCRYPTION_KEY || SESSION_SECRET;
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

// Load toggleable time exception rules from org_settings
function loadExceptionRulesMap(orgId) {
  if (!orgId) return Promise.resolve(null);
  return new Promise(resolve => {
    db.get(
      'SELECT value FROM org_settings WHERE org_id = ? AND key = ?',
      [orgId, 'time_exception_rules'],
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

function loadPayrollRulesMap(orgId) {
  if (!orgId) return Promise.resolve(null);
  return new Promise(resolve => {
    db.get(
      'SELECT value FROM org_settings WHERE org_id = ? AND key = ?',
      [orgId, 'payroll_rules'],
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

function normalizeQboResults(data, key) {
  const raw = data && data.QueryResponse ? data.QueryResponse[key] : null;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function parseJsonArray(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stringifyJsonArray(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const unique = Array.from(new Set(values.filter(Boolean)));
  return unique.length ? JSON.stringify(unique) : null;
}

function normalizeString(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function normalizeEmail(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function normalizeMatchName(value) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  return cleaned ? cleaned : null;
}

function buildNameMatchKeys(value) {
  if (value === undefined || value === null) return [];
  const raw = String(value).trim();
  if (!raw) return [];
  const keys = new Set();
  const normalized = normalizeMatchName(raw);
  if (normalized) keys.add(normalized);

  const tokens = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length >= 2) {
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    if (first && last) {
      keys.add(`${first}${last}`);
      keys.add(`${last}${first}`);
    }
  }

  return Array.from(keys);
}

/* ───────── 1. AUTH URL (for "Connect to QuickBooks" button) ───────── */

function getAuthUrl(state) {
  if (!state) {
    throw new Error('OAuth state is required for QuickBooks connect.');
  }
  const params = new URLSearchParams({
    client_id: QBO_CLIENT_ID,
    redirect_uri: QBO_REDIRECT_URI,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    state,
    prompt: 'login'
  });

  return `${AUTH_BASE}?${params.toString()}`;
}

async function verifyQuickBooksConnection(orgId) {
  if (!orgId) {
    return {
      ok: false,
      status: null,
      reason: 'No organization id.',
      invalidate: false,
      capabilities: {
        companyInfo: false,
        employeeQuery: false
      },
      warnings: []
    };
  }

  try {
    await qboQuery(orgId, 'SELECT Id FROM CompanyInfo');

    const capabilities = { companyInfo: true, employeeQuery: false };
    let employeeWarning = null;

    try {
      await qboQuery(orgId, 'SELECT Id FROM Employee STARTPOSITION 1 MAXRESULTS 1');
      capabilities.employeeQuery = true;
    } catch (err) {
      const employeeStatus = err?.response?.status || null;
      const employeePayload = err?.response?.data || null;
      const employeeCode = extractQboQueryErrorCode(employeePayload);
      const employeeMessage =
        extractQboQueryErrorMessage(employeePayload) ||
        err?.message ||
        'Employee query check failed.';

      const isEmployeeReauthRequired = isQboReauthRequiredError({
        status: employeeStatus,
        message: employeeMessage,
        errorCode: employeeCode
      });
      if (isEmployeeReauthRequired) {
        return {
          ok: false,
          status: employeeStatus,
          reason: employeeMessage,
          invalidate: true,
          capabilities,
          warnings: []
        };
      }

      employeeWarning =
        employeeStatus === 403
          ? `Employee read check is limited (${employeeMessage})`
          : `Employee read check failed (${employeeMessage})`;
    }

    return {
      ok: true,
      status: null,
      reason: employeeWarning || null,
      invalidate: false,
      capabilities,
      warnings: employeeWarning ? [employeeWarning] : []
    };
  } catch (err) {
    const status = err?.response?.status || null;
    const payload = err?.response?.data || null;
    const code = extractQboQueryErrorCode(payload);
    const parsedMessage =
      extractQboQueryErrorMessage(payload) ||
      (typeof err?.message === 'string' ? err.message : null) ||
      'QuickBooks connection test failed.';
    const isCritical = isQboReauthRequiredError({
      status,
      message: parsedMessage,
      errorCode: code
    });
    const reason =
      isCritical && status === 403 && /ApplicationAuthorizationFailed/i.test(String(parsedMessage))
        ? `${parsedMessage}. Reconnect using a QuickBooks Account Admin.`
        : parsedMessage;

    return {
      ok: false,
      status,
      reason,
      invalidate: isCritical,
      capabilities: {
        companyInfo: false,
        employeeQuery: false
      },
      warnings: []
    };
  }
}

function extractQboQueryErrorCode(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const candidates = [
    payload.errorCode,
    payload.ErrorCode,
    payload.error_code,
    payload.code,
    payload.Code
  ];
  for (const value of candidates) {
    const text = typeof value === 'string' ? value.trim() : value == null ? null : String(value).trim();
    if (text) return text;
  }
  if (payload.error && typeof payload.error === 'object') {
    const nested = extractQboQueryErrorCode(payload.error);
    if (nested) return nested;
  }
  return null;
}

function isQboReauthRequiredError({ status = null, message = '', errorCode = '' } = {}) {
  const normalizedStatus = Number(status);
  const code = String(errorCode || '').trim();
  const normalizedMessage = String(message || '')
    .toLowerCase()
    .trim();

  if (normalizedStatus === 401) return true;
  if (normalizedStatus !== 403) return false;
  if (code && code === '003100') return true;
  if (code && code === '3200') return true;

  const genericForbiddenMessage =
    normalizedMessage.includes('request failed with status code 403') ||
    normalizedMessage.includes('status code 403') ||
    normalizedMessage.includes('http 403');

  if (genericForbiddenMessage) return true;

  return (
    normalizedMessage.includes('qbo_forbidden') ||
    normalizedMessage.includes('insufficient permissions') ||
    normalizedMessage.includes('permission to access the requested data is denied') ||
    normalizedMessage.includes('cannot perform the requested operation') ||
    normalizedMessage.includes('access to this resource is forbidden') ||
    normalizedMessage.includes('applicationauthorizationfailed') ||
    normalizedMessage.includes('quickbooks app authorization was rejected') ||
    normalizedMessage.includes('not valid for this company') ||
    normalizedMessage.includes('super admin access required') ||
    normalizedMessage.includes('superadmin access required') ||
    normalizedMessage.includes('account admin must reconnect') ||
    normalizedMessage.includes('invalid access token') ||
    normalizedMessage.includes('reconnect using a quickbooks account admin') ||
    normalizedMessage.includes('reconnect using a quickbooks company admin')
  );
}

function shouldClearQboTokensForError({ status = null, message = '', errorCode = '' }) {
  return isQboReauthRequiredError({ status, message, errorCode });
}

function isQboInvalidQueryError(err) {
  if (!err) return false;
  const status = Number(err?.response?.status || 0);
  if (status !== 400) return false;

  const payload = err?.response?.data || null;
  const code = String(extractQboQueryErrorCode(payload) || '').trim();
  const message = String(
    extractQboQueryErrorMessage(payload) ||
    err?.message ||
    ''
  )
    .toLowerCase()
    .trim();

  return code === '4001' || message.includes('invalid query');
}

async function qboQueryWithFallback(orgId, queries = []) {
  const list = Array.isArray(queries) ? queries.filter(Boolean) : [queries];
  if (!list.length) {
    throw new Error('QuickBooks query is required.');
  }

  let lastErr = null;
  for (let i = 0; i < list.length; i += 1) {
    const query = list[i];
    try {
      return await qboQuery(orgId, query);
    } catch (err) {
      lastErr = err;
      const canRetry = i < list.length - 1;
      if (!canRetry || !isQboInvalidQueryError(err)) {
        throw err;
      }
      if (QBO_DEBUG) {
        console.warn(`[QBO] Retrying query with fallback shape (${i + 2}/${list.length}).`);
      }
    }
  }

  throw lastErr || new Error('QuickBooks query failed.');
}

async function qboQueryAllWithFallback(
  orgId,
  baseQueries = [],
  entityKey,
  maxResults = 1000,
  orderBy = 'Id'
) {
  const list = Array.isArray(baseQueries) ? baseQueries.filter(Boolean) : [baseQueries];
  if (!list.length) {
    throw new Error('QuickBooks query is required.');
  }

  let lastErr = null;
  for (let i = 0; i < list.length; i += 1) {
    const baseQuery = list[i];
    try {
      return await qboQueryAll(orgId, baseQuery, entityKey, maxResults, orderBy);
    } catch (err) {
      lastErr = err;
      const canRetry = i < list.length - 1;
      if (!canRetry || !isQboInvalidQueryError(err)) {
        throw err;
      }
      if (QBO_DEBUG) {
        console.warn(`[QBO] Retrying ${entityKey} query with fallback shape (${i + 2}/${list.length}).`);
      }
    }
  }

  throw lastErr || new Error('QuickBooks query failed.');
}

/* ───────── 2. PAYROLL SETTINGS LOADER ───────── */

function getPayrollSettings(orgId) {
  return new Promise((resolve, reject) => {
    if (!orgId) {
      return resolve({
        bankAccountName: null,
        expenseAccountName: null,
        receiptExpenseAccountName: null,
        receiptClassName: null,
        memoTemplate: 'Payroll {start} – {end}',
        lineDescriptionTemplate: 'Labor {hours} hrs – {project}'
      });
    }
    db.get(
      `
        SELECT
          bank_account_name,
          expense_account_name,
          receipt_expense_account_name,
          receipt_class_name,
          default_memo,
          line_description_template
        FROM payroll_settings
        WHERE org_id = ?
        ORDER BY id DESC
        LIMIT 1
      `,
      [orgId],
      (err, row) => {
        if (err) return reject(err);

        const bankAccountName = row?.bank_account_name || null;
        const expenseAccountName = row?.expense_account_name || null;
        const receiptExpenseAccountName = row?.receipt_expense_account_name || null;
        const receiptClassName = row?.receipt_class_name || null;
        const memoTemplate = row?.default_memo || 'Payroll {start} – {end}';
        const lineDescriptionTemplate =
          row?.line_description_template || 'Labor {hours} hrs – {project}';

        resolve({
          bankAccountName,
          expenseAccountName,
          receiptExpenseAccountName,
          receiptClassName,
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

  const raw = String(dateInput).trim();
  const partsMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (partsMatch) {
    return `${partsMatch[2]}/${partsMatch[3]}/${partsMatch[1]}`;
  }

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw; // fallback

  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();

  return `${mm}/${dd}/${yyyy}`;
}

function shiftIsoDate(dateStr, deltaDays) {
  if (!dateStr) return dateStr;
  const parts = String(dateStr).split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return dateStr;
  const [year, month, day] = parts;
  const dt = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return dt.toISOString().slice(0, 10);
}

function makeWeekStartResolver(tz) {
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short'
  });

  const weekdayIndex = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6
  };

  return dateObj => {
    if (!dateObj || Number.isNaN(dateObj.getTime())) return null;
    const parts = dateFormatter.formatToParts(dateObj);
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const d = parts.find(p => p.type === 'day')?.value;
    if (!y || !m || !d) return null;
    const dateStr = `${y}-${m}-${d}`;
    const weekdayShort = weekdayFormatter.format(dateObj);
    const idx = weekdayIndex[weekdayShort];
    if (idx == null) return dateStr;
    return shiftIsoDate(dateStr, -idx);
  };
}

async function getOrgTimezone(orgId) {
  if (!orgId) return APP_TIMEZONE || 'UTC';
  return new Promise(resolve => {
    db.get('SELECT timezone FROM orgs WHERE id = ?', [orgId], (err, row) => {
      if (err || !row || !row.timezone) return resolve(APP_TIMEZONE || 'UTC');
      resolve(row.timezone);
    });
  });
}

async function loadWeeklyHoursExceptionCounts({
  orgId,
  start = null,
  end = null,
  orgTimezone = APP_TIMEZONE,
  weeklyHoursThreshold = null
}) {
  if (!orgId || !weeklyHoursThreshold) {
    return { perEntry: new Map(), overWeeks: new Set() };
  }

  const tz = orgTimezone || APP_TIMEZONE || 'UTC';
  const weekStart = makeWeekStartResolver(tz);
  const startRange = start ? shiftIsoDate(start, -7) : null;
  const endRange = end ? shiftIsoDate(end, 7) : null;

  const params = [orgId];
  let where =
    'WHERE org_id = ? AND clock_in_ts IS NOT NULL AND clock_out_ts IS NOT NULL';
  if (startRange) {
    where += ' AND clock_in_local_date >= ?';
    params.push(startRange);
  }
  if (endRange) {
    where += ' AND clock_in_local_date <= ?';
    params.push(endRange);
  }

  const punchRows = await new Promise((resolve, reject) => {
    db.all(
      `
        SELECT
          employee_id,
          time_entry_id,
          clock_in_ts,
          clock_out_ts,
          exception_review_status
        FROM time_punches
        ${where}
      `,
      params,
      (err, rows) => (err ? reject(err) : resolve(rows || []))
    );
  });

  const normalized = [];
  const weekTotals = new Map();

  for (const row of punchRows || []) {
    const startTs = row.clock_in_ts ? new Date(row.clock_in_ts) : null;
    const endTs = row.clock_out_ts ? new Date(row.clock_out_ts) : null;
    if (!startTs || !endTs) continue;
    if (Number.isNaN(startTs.getTime()) || Number.isNaN(endTs.getTime())) continue;
    const hours = (endTs - startTs) / (1000 * 60 * 60);
    if (!Number.isFinite(hours) || hours < 0) continue;
    const weekKey = weekStart(startTs);
    if (!weekKey) continue;

    const employeeKey = `${row.employee_id}|${weekKey}`;
    weekTotals.set(employeeKey, (weekTotals.get(employeeKey) || 0) + hours);

    normalized.push({
      employeeKey,
      entryId: Number(row.time_entry_id) || null,
      exceptionStatus: String(row.exception_review_status || '').toLowerCase()
    });
  }

  const overWeeks = new Set();
  weekTotals.forEach((hours, key) => {
    if (hours > weeklyHoursThreshold) {
      overWeeks.add(key);
    }
  });

  const perEntry = new Map();
  for (const row of normalized) {
    if (!row.entryId || !overWeeks.has(row.employeeKey)) continue;
    const current = perEntry.get(row.entryId) || { total: 0, unapproved: 0 };
    current.total += 1;
    if (!['approved', 'modified'].includes(row.exceptionStatus)) {
      current.unapproved += 1;
    }
    perEntry.set(row.entryId, current);
  }

  return { perEntry, overWeeks };
}

/* ───────── 4. LIST QUICKBOOKS CLASSES ───────── */

async function listClasses(orgId) {
  const token = await getAccessToken(orgId);
  if (!token) {
    throw new Error('Not connected to QuickBooks');
  }

  const data = await qboQuery(
    orgId,
    "SELECT Id, Name, FullyQualifiedName, Active " +
      "FROM Class " +
      "ORDER BY FullyQualifiedName"
  );

  const classes = data.QueryResponse?.Class || [];
  return classes;
}

/* ───────── 5. TOKEN STORAGE HELPERS (SQLite) ───────── */

async function saveTokens({
  orgId,
  access_token,
  refresh_token,
  expires_in,
  realm_id
}) {
  // expires_in = seconds from now
  if (!orgId) {
    throw new Error('orgId is required to save QuickBooks tokens.');
  }
  if (!access_token || !refresh_token) {
    throw new Error('Missing QuickBooks access token or refresh token.');
  }
  if (!Number.isFinite(Number(expires_in)) || Number(expires_in) <= 0) {
    throw new Error('Missing or invalid QuickBooks token expiration.');
  }
  const expiresAt = Date.now() + (Number(expires_in) - 60) * 1000; // minus 60s for safety

  const encAccess = encryptValue(access_token);
  const encRefresh = encryptValue(refresh_token);

  return new Promise((resolve, reject) => {
    db.run(
      `
        INSERT INTO qbo_tokens (org_id, access_token, refresh_token, expires_at, realm_id)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(org_id) DO UPDATE SET
          access_token  = excluded.access_token,
          refresh_token = excluded.refresh_token,
          expires_at    = excluded.expires_at,
          realm_id      = COALESCE(excluded.realm_id, qbo_tokens.realm_id)
      `,
      [orgId, encAccess, encRefresh, expiresAt, realm_id || null],
      err => (err ? reject(err) : resolve())
    );
  });
}

function getTokensFromDb(orgId) {
  return new Promise((resolve, reject) => {
    if (!orgId) return resolve(null);
    db.get('SELECT * FROM qbo_tokens WHERE org_id = ? LIMIT 1', [orgId], (err, row) => {
      if (err) return reject(err);
      if (!row) return resolve(null);
      const access = decryptValue(row.access_token) || row.access_token;
      const refresh = decryptValue(row.refresh_token) || row.refresh_token;
      resolve({ ...row, access_token: access, refresh_token: refresh });
    });
  });
}

function clearTokens(orgId) {
  return new Promise((resolve, reject) => {
    if (!orgId) return resolve();
    db.run('DELETE FROM qbo_tokens WHERE org_id = ?', [orgId], err =>
      err ? reject(err) : resolve()
    );
  });
}

function clearTokensForRealmId(realmId) {
  return new Promise((resolve, reject) => {
    if (!realmId) return resolve();
    db.run('DELETE FROM qbo_tokens WHERE realm_id = ?', [realmId], err =>
      err ? reject(err) : resolve()
    );
  });
}

/* ───────── 6. EXCHANGE / REFRESH TOKENS ───────── */

async function exchangeCodeForTokens(code, { orgId, realmId } = {}) {
  if (!code) {
    throw new Error('Missing OAuth authorization code.');
  }
  if (!orgId) {
    throw new Error('Missing organization for QuickBooks token exchange.');
  }
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
  const accessToken = res?.data?.access_token;
  const refreshToken = res?.data?.refresh_token;
  const expiresIn = res?.data?.expires_in;
  if (!accessToken || !refreshToken) {
    throw new Error('QuickBooks token exchange returned incomplete credentials.');
  }

  await saveTokens({
    orgId,
    realm_id: realmId || null,
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: expiresIn
  });
  return res.data;
}

async function refreshAccessToken(currentRefreshToken, orgId) {
  const basicAuth = Buffer.from(
    `${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`
  ).toString('base64');

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: currentRefreshToken
  });

  const res = await axios.post(TOKEN_URL, params.toString(), {
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });

  const existing = await getTokensFromDb(orgId);
  const accessToken = res?.data?.access_token;
  const nextRefreshToken = res?.data?.refresh_token;
  const expiresIn = res?.data?.expires_in;
  if (!accessToken || !nextRefreshToken) {
    throw new Error('QuickBooks token refresh returned incomplete credentials.');
  }

  await saveTokens({
    orgId,
    realm_id: existing?.realm_id || null,
    access_token: accessToken,
    refresh_token: nextRefreshToken,
    expires_in: expiresIn
  });
  return res.data;
}

/* ───────── 7. GET A VALID ACCESS TOKEN (refresh if needed) ───────── */

async function getAccessToken(orgId) {
  const row = await getTokensFromDb(orgId);
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

  const existingPromise = refreshPromises.get(orgId);
  const startedRefresh = !existingPromise;
  if (!existingPromise) {
    console.log('[QBO] Access token expired; refreshing…');
    const promise = refreshAccessToken(row.refresh_token, orgId).finally(() => {
      refreshPromises.delete(orgId);
    });
    refreshPromises.set(orgId, promise);
  } else {
    console.log('[QBO] Access token expired; waiting on existing refresh…');
  }

  try {
    const refreshed = await refreshPromises.get(orgId);
    return refreshed?.access_token || null;
  } catch (err) {
    if (startedRefresh) {
      console.error(
        '[QBO] Error refreshing token:',
        err.response?.status || err.message
      );

      const status = err.response?.status;
      const code = extractQboQueryErrorCode(err?.response?.data);
      const message = err?.message || '';
      const shouldClear = status === 400 || status === 401 || shouldClearQboTokensForError({
        status,
        message,
        errorCode: code
      });

      if (shouldClear) {
        console.warn('[QBO] Clearing stored tokens; please reconnect QuickBooks.');
        try {
          await clearTokens(orgId);
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

async function getRealmId(orgId) {
  const row = await getTokensFromDb(orgId);
  return row && row.realm_id ? row.realm_id : null;
}

/* ───────── 8. GENERIC QBO QUERY HELPER ───────── */

function extractQboQueryErrorMessage(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const asText = value => {
    if (typeof value === 'string') {
      const text = value.trim();
      if (text) return text;
    }
    return null;
  };

  const extractCode = source => {
    if (!source || typeof source !== 'object') return null;
    const codeCandidates = [
      source.errorCode,
      source.ErrorCode,
      source.error_code,
      source.code,
      source.Code
    ];
    for (const value of codeCandidates) {
      const text = asText(value);
      if (text) return text;
    }
    if (source.error && typeof source.error === 'object' && !Array.isArray(source.error)) {
      return extractCode(source.error);
    }
    return null;
  };

  const appendCode = (message, source) => {
    if (!message) return null;
    const code = extractCode(source || payload);
    if (!code) return message;
    const normalized = String(code).trim();
    if (!normalized) return message;
    return message.includes(`errorCode=${normalized}`) ? message : `${message} (errorCode=${normalized})`;
  };

  const candidates = [
    payload.error_description,
    payload.error,
    payload.message,
    payload.description,
    payload.details,
    payload.metaData && payload.metaData.Error
  ];
  for (const value of candidates) {
    const msg = asText(value);
    if (msg) return appendCode(msg, payload);
  }

  const firstItemMessage = list => {
    if (!Array.isArray(list) || !list.length) return null;
    const first = list[0];
    if (typeof first === 'string') return asText(first);
    if (first && typeof first === 'object') {
      const raw = (
        asText(first.Message) ||
        asText(first.message) ||
        asText(first.Detail) ||
        asText(first.LongMessage) ||
        asText(first.detail)
      );
      return appendCode(raw, first);
    }
    return null;
  };

  const directArrayMessage = firstItemMessage(payload.error) || firstItemMessage(payload.errors);
  if (directArrayMessage) return directArrayMessage;

  if (payload.error && typeof payload.error === 'object' && !Array.isArray(payload.error)) {
    const nested = appendCode(
      asText(payload.error.message) ||
        asText(payload.error.Message) ||
        asText(payload.error.error) ||
        asText(payload.error.error_description) ||
        asText(payload.error.detail) ||
        asText(payload.error.Detail),
      payload.error
    );
    if (nested) return nested;
  }

  const parseFault = fault => {
    if (!fault || typeof fault !== 'object') return null;
    const listMessage = firstItemMessage(fault.Error) || firstItemMessage(fault.errors) || firstItemMessage(fault.error);
    if (listMessage) return listMessage;
    return appendCode(asText(fault.Message) || asText(fault.message) || asText(fault.type), fault);
  };

  const faultMessage = parseFault(payload.Fault) || parseFault(payload.fault);
  if (faultMessage) {
    return faultMessage;
  }

  return null;
}

async function qboQuery(orgId, query) {
  if (QBO_DEBUG) {
    console.log('qboQuery called with query:', query);
  }

  const accessToken = await getAccessToken(orgId);
  if (!accessToken) {
    throw new Error('Not connected to QuickBooks (no access token).');
  }

  const realmId = await getRealmId(orgId);
  if (!realmId) {
    throw new Error('Not connected to QuickBooks (no realmId).');
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
    const status = err?.response ? err.response.status : null;
    const payload = err?.response?.data;
    const friendly = extractQboQueryErrorMessage(payload);
    const baseMessage = status
      ? `QuickBooks request failed (HTTP ${status}).`
      : 'QuickBooks request failed.';
    const fallbackMessage = friendly
      ? `${baseMessage} ${friendly}`
      : baseMessage;

    if (status) {
      const logParts = ['QBO query error:', status];
      if (payload && typeof payload === 'object') {
        if (friendly) {
          logParts.push(friendly);
        }
        if (QBO_DEBUG) {
          logParts.push(JSON.stringify(payload));
        }
      }
      console.error(logParts.join(' | '));
    } else {
      console.error('QBO query error:', err.message || baseMessage);
    }

    if (friendly) {
      err.message = friendly;
    } else if (!err.message && status) {
      err.message = fallbackMessage;
    }
    throw err;
  }
}

async function qboQueryAll(orgId, baseQuery, entityKey, maxResults = 1000, orderBy = 'Id') {
  const results = [];
  let startPosition = 1;
  const hasOrder = /\border\s+by\b/i.test(baseQuery);
  const orderedQuery = hasOrder ? baseQuery : `${baseQuery} ORDER BY ${orderBy}`;

  while (true) {
    const query = `${orderedQuery} STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
    const data = await qboQuery(orgId, query);
    const page = normalizeQboResults(data, entityKey);
    if (page.length) {
      results.push(...page);
    }
    if (page.length < maxResults) {
      break;
    }
    startPosition += maxResults;
  }

  return results;
}

/* ───────── 9. LIST PAYROLL ACCOUNTS (BANK & EXPENSE) ───────── */

async function listPayrollAccounts(orgId) {
  const token = await getAccessToken(orgId);
  if (!token) {
    throw new Error('Not connected to QuickBooks');
  }

  const accountQueries = [
    "SELECT Id, Name, FullyQualifiedName, AccountType, SubAccount " +
      "FROM Account " +
      "WHERE AccountType IN ('Bank','Expense','Cost of Goods Sold','Other Expense') " +
      "ORDER BY FullyQualifiedName",
    "SELECT Id, Name, FullyQualifiedName, AccountType " +
      "FROM Account " +
      "WHERE AccountType IN ('Bank','Expense','Cost of Goods Sold','Other Expense') " +
      "ORDER BY FullyQualifiedName",
    "SELECT Id, Name, FullyQualifiedName, AccountType " +
      "FROM Account " +
      "ORDER BY FullyQualifiedName"
  ];
  const data = await qboQueryWithFallback(orgId, accountQueries);

  const accounts = normalizeQboResults(data, 'Account');

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
async function syncVendors(orgId) {
  if (!orgId) {
    throw new Error('orgId is required for vendor sync.');
  }
  const active = await qboQueryAll(
    orgId,
    'SELECT Id, DisplayName, Active FROM Vendor WHERE Active = true',
    'Vendor'
  );
  const inactive = await qboQueryAll(
    orgId,
    'SELECT Id, DisplayName, Active FROM Vendor WHERE Active = false',
    'Vendor'
  );
  const vendorMap = new Map();
  [...active, ...inactive].forEach(vendor => {
    if (vendor && vendor.Id !== undefined && vendor.Id !== null) {
      vendorMap.set(String(vendor.Id), vendor);
    }
  });
  const vendors = Array.from(vendorMap.values());

  return new Promise((resolve, reject) => {
    db.serialize(() => {
      let finished = false;
      const rollback = err => {
        if (finished) return;
        finished = true;
        db.run('ROLLBACK', () => reject(err));
      };
      const commit = count => {
        if (finished) return;
        finished = true;
        db.run('COMMIT', err => (err ? reject(err) : resolve(count)));
      };
      db.run('BEGIN', err => {
        if (err) return rollback(err);
        // 1) Mark all QBO-backed vendors as inactive by default
        db.run(
          `UPDATE vendors SET active = 0 WHERE org_id = ? AND qbo_id IS NOT NULL`,
          [orgId],
          errUpdate => {
            if (errUpdate) return rollback(errUpdate);

            // 2) Upsert each vendor with the correct active flag from QBO
            const upsertSql = `
              INSERT INTO vendors (org_id, qbo_id, name, active)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(org_id, qbo_id) DO UPDATE SET
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

              stmt.run([orgId, String(v.Id), name, isActive], errRun => {
                if (errRun) return rollback(errRun);
              });
            });

            stmt.finalize(err2 => {
              if (err2) return rollback(err2);
              commit(vendors.length);
            });
          }
        );
      });
    });
  });
}

// Download Employees from QuickBooks and sync into employees table
async function syncEmployeesFromQuickBooks(orgId) {
  if (!orgId) {
    throw new Error('orgId is required for employee sync.');
  }
  const baseQueries = [
    'SELECT Id, DisplayName, GivenName, FamilyName, Active, PrintOnCheckName, PrimaryEmailAddr, MetaData FROM Employee',
    'SELECT Id, DisplayName, GivenName, FamilyName, Active, PrintOnCheckName, MetaData FROM Employee',
    'SELECT Id, DisplayName, GivenName, FamilyName, Active, PrintOnCheckName FROM Employee'
  ];
  const active = await qboQueryAllWithFallback(
    orgId,
    baseQueries.map(query => `${query} WHERE Active = true`),
    'Employee'
  );
  const inactive = await qboQueryAllWithFallback(
    orgId,
    baseQueries.map(query => `${query} WHERE Active = false`),
    'Employee'
  );
  const employeeMap = new Map();
  [...active, ...inactive].forEach(emp => {
    if (emp && emp.Id !== undefined && emp.Id !== null) {
      employeeMap.set(String(emp.Id), emp);
    }
  });
  const employees = Array.from(employeeMap.values());
  if (QBO_DEBUG) {
    console.log(`[QBO] Loaded ${employees.length} employees from QuickBooks.`);
  }

  return new Promise((resolve, reject) => {
    if (!employees.length) {
      return resolve(0);
    }

    db.serialize(() => {
      const updateSql = `
        UPDATE employees
        SET
          name = ?,
          given_name = ?,
          family_name = ?,
          name_on_checks = ?,
          name_on_checks_updated_at = ?,
          name_on_checks_qbo_updated_at = ?,
          qbo_last_seen_given_name = ?,
          qbo_last_seen_family_name = ?,
          qbo_last_seen_name_on_checks = ?,
          qbo_conflict_fields_json = ?,
          qbo_conflict_updated_at = ?,
          active = ?
        WHERE employee_qbo_id = ? AND org_id = ?
      `;
      const updateByIdSql = `
        UPDATE employees
        SET
          employee_qbo_id = ?,
          name = ?,
          given_name = ?,
          family_name = ?,
          name_on_checks = ?,
          name_on_checks_updated_at = ?,
          name_on_checks_qbo_updated_at = ?,
          qbo_last_seen_given_name = ?,
          qbo_last_seen_family_name = ?,
          qbo_last_seen_name_on_checks = ?,
          qbo_conflict_fields_json = ?,
          qbo_conflict_updated_at = ?,
          active = ?,
          needs_qbo_sync = 0
        WHERE id = ? AND org_id = ?
      `;

      const insertSql = `
        INSERT INTO employees (
          org_id,
          employee_qbo_id,
          name,
          given_name,
          family_name,
          nickname,
          name_on_checks,
          rate,
          active,
          pin_hash,
          language,
          worker_timekeeping,
          desktop_access,
          kiosk_admin_access,
          name_on_checks_updated_at,
          name_on_checks_qbo_updated_at,
          needs_qbo_sync,
          qbo_last_seen_given_name,
          qbo_last_seen_family_name,
          qbo_last_seen_name_on_checks,
          qbo_conflict_fields_json,
          qbo_conflict_updated_at
        )
        VALUES (?, ?, ?, ?, ?, NULL, ?, 0, ?, NULL, 'en', 1, 0, 0, ?, ?, 0, ?, ?, ?, ?, ?)
      `;

      const getRow = (sql, params) =>
        new Promise((resolve, reject) => {
          db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
        });
      const getRows = (sql, params) =>
        new Promise((resolve, reject) => {
          db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
        });
      const runSql = (sql, params) =>
        new Promise((resolve, reject) => {
          db.run(sql, params, err => (err ? reject(err) : resolve()));
        });

      const processEmployees = async () => {
        await runSql('BEGIN IMMEDIATE');
        let processed = 0;
        try {
          for (const emp of employees) {
            const qboId = String(emp.Id);
            const qboGiven = normalizeString(emp.GivenName);
            const qboFamily = normalizeString(emp.FamilyName);
            const qboDisplay =
              normalizeString(emp.DisplayName) ||
              [qboGiven, qboFamily].filter(Boolean).join(' ').trim() ||
              null;
            const qboPrintName =
              normalizeString(emp.PrintOnCheckName) || qboDisplay || null;
            const qboUpdatedIso =
              emp.MetaData && emp.MetaData.LastUpdatedTime
                ? new Date(emp.MetaData.LastUpdatedTime).toISOString()
                : null;
            const qboUpdatedMs = qboUpdatedIso ? Date.parse(qboUpdatedIso) : 0;

            const isActive =
              emp.Active === undefined || emp.Active === null
                ? 1
                : emp.Active === true || emp.Active === 'true'
                ? 1
                : 0;

            const row = await getRow(
              `
                SELECT
                  name,
                  given_name,
                  family_name,
                  name_on_checks,
                  name_on_checks_updated_at,
                  name_on_checks_qbo_updated_at,
                  qbo_dirty_fields_json,
                  qbo_last_seen_given_name,
                  qbo_last_seen_family_name,
                  qbo_last_seen_name_on_checks,
                  qbo_conflict_fields_json
                FROM employees
                WHERE employee_qbo_id = ? AND org_id = ?
                LIMIT 1
              `,
              [qboId, orgId]
            );

            const dirtyFields = row ? new Set(parseJsonArray(row.qbo_dirty_fields_json)) : new Set();
            const localGiven = normalizeString(row?.given_name);
            const localFamily = normalizeString(row?.family_name);
            const localNameOnChecks = normalizeString(row?.name_on_checks);
            const localName = normalizeString(row?.name);

            const nextGiven = dirtyFields.has('given_name') ? localGiven : qboGiven;
            const nextFamily = dirtyFields.has('family_name') ? localFamily : qboFamily;
            const combinedName = [nextGiven, nextFamily].filter(Boolean).join(' ').trim();
            const nextName = combinedName || localName || qboDisplay || null;
            const nextNameOnChecks = dirtyFields.has('name_on_checks')
              ? localNameOnChecks
              : (qboPrintName || combinedName || qboDisplay || null);

            const lastSeenGiven = normalizeString(row?.qbo_last_seen_given_name);
            const lastSeenFamily = normalizeString(row?.qbo_last_seen_family_name);
            const lastSeenChecks = normalizeString(row?.qbo_last_seen_name_on_checks);

            const conflicts = [];
            if (
              dirtyFields.has('given_name') &&
              qboGiven !== localGiven &&
              qboGiven !== lastSeenGiven
            ) {
              conflicts.push('given_name');
            }
            if (
              dirtyFields.has('family_name') &&
              qboFamily !== localFamily &&
              qboFamily !== lastSeenFamily
            ) {
              conflicts.push('family_name');
            }
            if (
              dirtyFields.has('name_on_checks') &&
              qboPrintName !== localNameOnChecks &&
              qboPrintName !== lastSeenChecks
            ) {
              conflicts.push('name_on_checks');
            }

            const conflictJson = stringifyJsonArray(conflicts);
            const conflictUpdatedAt = conflictJson ? new Date().toISOString() : null;

            const finalLocalUpdated = row?.name_on_checks_updated_at || null;
            const finalQboUpdated = dirtyFields.has('name_on_checks')
              ? (row?.name_on_checks_qbo_updated_at || null)
              : (qboUpdatedIso || row?.name_on_checks_qbo_updated_at || null);

            if (row) {
              await runSql(updateSql, [
                nextName,
                nextGiven,
                nextFamily,
                nextNameOnChecks,
                finalLocalUpdated,
                finalQboUpdated,
                qboGiven,
                qboFamily,
                qboPrintName,
                conflictJson,
                conflictUpdatedAt,
                isActive,
                qboId,
                orgId
              ]);
            } else {
              const candidateName = normalizeString(
                nextName || qboDisplay || qboPrintName || `Employee ${qboId}`
              );
              let matchedByName = null;
              if (candidateName) {
                matchedByName = await getRow(
                  `
                    SELECT id
                    FROM employees
                    WHERE org_id = ?
                      AND lower(trim(name)) = lower(trim(?))
                      AND (employee_qbo_id IS NULL OR employee_qbo_id = ?)
                    LIMIT 1
                  `,
                  [orgId, candidateName, qboId]
                );
              }
              if (matchedByName) {
                await runSql(updateByIdSql, [
                  qboId,
                  candidateName,
                  qboGiven,
                  qboFamily,
                  nextNameOnChecks || null,
                  null,
                  qboUpdatedIso || null,
                  qboGiven,
                  qboFamily,
                  qboPrintName,
                  null,
                  null,
                  isActive,
                  matchedByName.id,
                  orgId
                ]);
              } else {
                await runSql(insertSql, [
                  orgId,
                  qboId,
                  candidateName || null,
                  qboGiven,
                  qboFamily,
                  nextNameOnChecks || null,
                  isActive,
                  null,
                  qboUpdatedIso || null,
                  qboGiven,
                  qboFamily,
                  qboPrintName,
                  null,
                  null
                ]);
              }
            }
            processed += 1;
          }

          await runSql('COMMIT');
          resolve(processed);
        } catch (err) {
          try {
            await runSql('ROLLBACK');
          } catch (rollbackErr) {
            console.warn('[QBO] Employee sync rollback error:', rollbackErr.message || rollbackErr);
          }
          reject(err);
        }
      };

      processEmployees().catch(reject);
    });
  });
}

/* ───────── Shared helper: set PrintOnCheckName for a payee ───────── */
async function setPrintOnCheckName(payeeRef, desiredName, orgId) {
  if (!payeeRef || !payeeRef.value || !desiredName) {
    return { ok: false, error: 'Missing payeeRef or desired name.' };
  }

  const accessToken = await getAccessToken(orgId);
  const realmId = await getRealmId(orgId);
  if (!accessToken || !realmId) {
    return { ok: false, error: 'Not connected to QuickBooks.' };
  }

  const type = payeeRef.type === 'Vendor' ? 'Vendor' : 'Employee';

  try {
    const safeId = String(payeeRef.value).replace(/'/g, "\\'");
    const data = await qboQuery(
      orgId,
      `select Id, SyncToken, DisplayName, PrintOnCheckName from ${type} where Id = '${safeId}'`
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
    const status = err.response ? err.response.status : null;
    const payload = err.response ? err.response.data : null;
    let friendly = status ? `HTTP ${status}` : err.message;
    if (payload) {
      const fault = payload.Fault;
      const firstError =
        fault && Array.isArray(fault.Error) && fault.Error[0]
          ? fault.Error[0]
          : null;
      if (firstError) {
        if (firstError.Message) friendly = firstError.Message;
        if (firstError.Detail) friendly += ' – ' + firstError.Detail;
      }
    }
    const qboStatusMessage =
      payload && extractQboQueryErrorMessage(payload)
        ? extractQboQueryErrorMessage(payload)
        : friendly;
    const qboStatusCode = payload ? extractQboQueryErrorCode(payload) : '';
    const shouldClearTokens = shouldClearQboTokensForError({
      status,
      message: qboStatusMessage,
      errorCode: qboStatusCode
    });
    if (shouldClearTokens && orgId) {
      try {
        await clearTokens(orgId);
      } catch (clearErr) {
        console.warn('[QBO] Failed to clear tokens after auth error:', clearErr.message || clearErr);
      }
    }
    return { ok: false, error: qboStatusMessage, status };
  }
}

async function createEmployeeInQuickBooks({ displayName, givenName, familyName, orgId } = {}) {
  const accessToken = await getAccessToken(orgId);
  const realmId = await getRealmId(orgId);
  if (!accessToken || !realmId) {
    return { ok: false, error: 'Not connected to QuickBooks.' };
  }

  const finalDisplay =
    (displayName && String(displayName).trim()) ||
    `${givenName || ''} ${familyName || ''}`.trim();

  const payload = {
    DisplayName: finalDisplay,
    GivenName: givenName,
    FamilyName: familyName
  };

  try {
    const url = `${API_BASE}/${realmId}/employee`;
    const response = await axios.post(url, payload, {
      params: { minorversion: 62 },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }
    });

    const employee = response?.data?.Employee;
    if (!employee || !employee.Id) {
      return { ok: false, error: 'QuickBooks response missing employee id.' };
    }

    return {
      ok: true,
      employee_qbo_id: String(employee.Id),
      employee_qbo_name:
        employee.DisplayName ||
        employee.PrintOnCheckName ||
        finalDisplay
    };
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

async function updateEmployeeInQuickBooks({
  orgId,
  employeeQboId,
  givenName,
  familyName,
  printName
} = {}) {
  if (!orgId || !employeeQboId) {
    return { ok: false, error: 'Missing orgId or employeeQboId.' };
  }

  const accessToken = await getAccessToken(orgId);
  const realmId = await getRealmId(orgId);
  if (!accessToken || !realmId) {
    return { ok: false, error: 'Not connected to QuickBooks.' };
  }

  try {
    const safeId = String(employeeQboId).replace(/'/g, "\\'");
    const data = await qboQuery(
      orgId,
      `select Id, SyncToken, DisplayName, GivenName, FamilyName, PrintOnCheckName from Employee where Id = '${safeId}'`
    );
    const raw = data && data.QueryResponse && data.QueryResponse.Employee;
    const entity = Array.isArray(raw) ? raw[0] : raw;
    if (!entity || !entity.Id || typeof entity.SyncToken === 'undefined') {
      return { ok: false, error: 'Employee not found in QuickBooks.' };
    }

    const updatePayload = {
      sparse: true,
      Id: entity.Id,
      SyncToken: entity.SyncToken
    };

    const finalGiven = givenName !== undefined && givenName !== null ? givenName : entity.GivenName;
    const finalFamily = familyName !== undefined && familyName !== null ? familyName : entity.FamilyName;
    const combined = [finalGiven, finalFamily].filter(Boolean).join(' ').trim();

    const updatedFields = [];
    if (givenName !== undefined) {
      updatePayload.GivenName = givenName || null;
      updatedFields.push('given_name');
    }
    if (familyName !== undefined) {
      updatePayload.FamilyName = familyName || null;
      updatedFields.push('family_name');
    }
    if (combined) {
      updatePayload.DisplayName = combined;
    } else if (entity.DisplayName) {
      updatePayload.DisplayName = entity.DisplayName;
    }
    if (printName !== undefined) {
      updatePayload.PrintOnCheckName = printName || null;
      updatedFields.push('name_on_checks');
      if (!updatePayload.DisplayName && entity.DisplayName) {
        updatePayload.DisplayName = entity.DisplayName;
      }
    }

    const url = `${API_BASE}/${realmId}/employee`;
    await axios.post(url, updatePayload, {
      params: { minorversion: 62 },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }
    });

    return { ok: true, updatedFields };
  } catch (err) {
    const status = err.response ? err.response.status : null;
    const errorPayload = err.response ? err.response.data : null;
    let friendly = status ? `HTTP ${status}` : err.message;
    if (errorPayload) {
    const fault = errorPayload.Fault;
      const firstError =
        fault && Array.isArray(fault.Error) && fault.Error[0]
          ? fault.Error[0]
          : null;
      if (firstError) {
        if (firstError.Message) friendly = firstError.Message;
        if (firstError.Detail) friendly += ' – ' + firstError.Detail;
      }
    }
    const qboStatusCode = errorPayload ? extractQboQueryErrorCode(errorPayload) : '';
    const shouldClearTokens = orgId && shouldClearQboTokensForError({
      status,
      message: friendly,
      errorCode: qboStatusCode
    });
    if (shouldClearTokens) {
      try {
        await clearTokens(orgId);
      } catch (clearErr) {
        console.warn('[QBO] Failed to clear tokens after auth error:', clearErr.message || clearErr);
      }
    }
    return { ok: false, error: friendly, status };
  }
}





// Download Customers (used as projects/jobs) → store in projects table
async function syncProjects(orgId) {
  if (!orgId) {
    throw new Error('orgId is required for project sync.');
  }
  const baseQueries = [
    'SELECT Id, DisplayName, FullyQualifiedName, Active, ParentRef, Job, IsProject FROM Customer',
    'SELECT Id, DisplayName, FullyQualifiedName, Active, ParentRef, Job FROM Customer',
    'SELECT Id, DisplayName, FullyQualifiedName, Active, ParentRef FROM Customer'
  ];
  const active = await qboQueryAllWithFallback(
    orgId,
    baseQueries.map(query => `${query} WHERE Active = true`),
    'Customer'
  );
  const inactive = await qboQueryAllWithFallback(
    orgId,
    baseQueries.map(query => `${query} WHERE Active = false`),
    'Customer'
  );
  const customerMap = new Map();
  [...active, ...inactive].forEach(cust => {
    if (cust && cust.Id !== undefined && cust.Id !== null) {
      customerMap.set(String(cust.Id), cust);
    }
  });
  const customers = Array.from(customerMap.values());
  const asTruthy = value =>
    value === true || value === 1 || value === '1' || value === 'true';
  const projectCustomers = customers.filter(cust => {
    if (!cust) return false;
    const fq = String(cust.FullyQualifiedName || '');
    const hasHierarchy = fq.includes(':');
    const hasParentRef = !!(cust.ParentRef && (cust.ParentRef.value || cust.ParentRef.name));
    const isJob = asTruthy(cust.Job);
    const isProject = asTruthy(cust.IsProject);
    return isProject || isJob || hasParentRef || hasHierarchy;
  });
  const projectQboIds = new Set(
    projectCustomers
      .map(cust => (cust && cust.Id !== undefined && cust.Id !== null ? String(cust.Id) : ''))
      .filter(Boolean)
  );
  const topLevelCustomerIds = customers
    .map(cust => (cust && cust.Id !== undefined && cust.Id !== null ? String(cust.Id) : ''))
    .filter(qboId => qboId && !projectQboIds.has(qboId));
  const skippedTopLevelCustomers = Math.max(0, customers.length - projectCustomers.length);
  if (QBO_DEBUG) {
    console.log(
      `syncProjects: received ${customers.length} customers from QBO; ` +
      `syncing ${projectCustomers.length} project/job rows and skipping ${skippedTopLevelCustomers} top-level customers.`
    );
  }

  const upsertSql = `
    INSERT INTO projects (org_id, qbo_id, name, customer_name, active)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(org_id, qbo_id) DO UPDATE SET
      name = excluded.name,
      customer_name = excluded.customer_name,
      active = excluded.active
  `;

  await new Promise((resolve, reject) => {
    db.serialize(() => {
      let finished = false;
      const rollback = err => {
        if (finished) return;
        finished = true;
        db.run('ROLLBACK', () => reject(err));
      };
      const commit = () => {
        if (finished) return;
        finished = true;
        db.run('COMMIT', err => (err ? reject(err) : resolve()));
      };

      db.run('BEGIN', err => {
        if (err) return rollback(err);

        // 2) Mark all QBO-backed projects as inactive first
        db.run(
          `UPDATE projects SET active = 0 WHERE org_id = ? AND qbo_id IS NOT NULL`,
          [orgId],
          errUpdate => {
            if (errUpdate) return rollback(errUpdate);

            const upsertProjects = () => {
              // 3) Upsert only QBO projects/jobs (not top-level customers)
              const stmt = db.prepare(upsertSql);
              projectCustomers.forEach(cust => {
                const qboId = String(cust.Id);
                const fq = String(cust.FullyQualifiedName || '');
                const fqParts = fq ? fq.split(':').map(part => String(part || '').trim()).filter(Boolean) : [];
                const nameFromFq = fqParts.length ? fqParts[fqParts.length - 1] : '';
                const displayName = nameFromFq || cust.DisplayName || cust.CompanyName || '';
                const isActive =
                  cust.Active === undefined || cust.Active === null
                    ? 1
                    : cust.Active
                    ? 1
                    : 0;

                let customerName = null;
                if (cust.ParentRef && cust.ParentRef.name) {
                  customerName = String(cust.ParentRef.name || '').trim() || null;
                }
                if (!customerName && fqParts.length > 1) {
                  customerName = fqParts.slice(0, -1).join(':').trim() || null;
                }

                stmt.run(
                  [orgId, qboId, displayName, customerName, isActive],
                  errRun => {
                    if (errRun) return rollback(errRun);
                  }
                );
              });

              stmt.finalize(err2 => {
                if (err2) return rollback(err2);
                commit();
              });
            };

            if (topLevelCustomerIds.length > 0) {
              // Ensure previously imported top-level customers stay hidden from project lists.
              const placeholders = topLevelCustomerIds.map(() => '?').join(',');
              const resetSql = `
                UPDATE projects
                SET customer_name = NULL
                WHERE org_id = ?
                  AND qbo_id IN (${placeholders})
              `;
              db.run(resetSql, [orgId, ...topLevelCustomerIds], errReset => {
                if (errReset) return rollback(errReset);
                upsertProjects();
              });
              return;
            }

            upsertProjects();
          }
        );
      });
    });
  });

  if (QBO_DEBUG) {
    console.log('syncProjects: upsert complete.');
  }
  return {
    count: projectCustomers.length,
    skipped_top_level_customers: skippedTopLevelCustomers,
    total_qbo_customers: customers.length
  };
}

/* ───────── 11. ACCOUNT LOOKUP BY NAME ───────── */

async function getAccountIdByName(name, accessToken, realmId) {
  const safe = name.replace(/'/g, "\\'");
  const query = `select Id from Account where FullyQualifiedName='${safe}'`;
  const url = `${API_BASE}/${realmId}/query`;

  try {
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
  } catch (err) {
    const status = err.response?.status || null;
    const payload = err.response?.data || null;
    const qboMessage =
      payload ? extractQboQueryErrorMessage(payload) : (err.message || '');
    const qboCode = payload ? extractQboQueryErrorCode(payload) : '';
    const shouldClearTokens = realmId &&
      shouldClearQboTokensForError({ status, message: qboMessage, errorCode: qboCode });
    if (shouldClearTokens) {
      try {
        await clearTokensForRealmId(realmId);
      } catch (clearErr) {
        console.warn('[QBO] Failed to clear tokens after auth error:', clearErr.message || clearErr);
      }
    }
    throw err;
  }
}

async function getClassIdByName(name, accessToken, realmId) {
  const safe = name.replace(/'/g, "\\'");
  const query = `select Id from Class where FullyQualifiedName='${safe}'`;
  const url = `${API_BASE}/${realmId}/query`;

  try {
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
  } catch (err) {
    const status = err.response?.status || null;
    const payload = err.response?.data || null;
    const qboMessage =
      payload ? extractQboQueryErrorMessage(payload) : (err.message || '');
    const qboCode = payload ? extractQboQueryErrorCode(payload) : '';
    const shouldClearTokens = realmId &&
      shouldClearQboTokensForError({ status, message: qboMessage, errorCode: qboCode });
    if (shouldClearTokens) {
      try {
        await clearTokensForRealmId(realmId);
      } catch (clearErr) {
        console.warn('[QBO] Failed to clear tokens after auth error:', clearErr.message || clearErr);
      }
    }
    throw err;
  }
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

function normalizeReceiptVendorName(value) {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

function buildReceiptLineProjectId(projectId, vendorName) {
  const projectNum = Number(projectId) || 0;
  const vendor = normalizeReceiptVendorName(vendorName) || 'vendor';
  const vendorHash = crypto
    .createHash('sha1')
    .update(vendor.toLowerCase())
    .digest('hex')
    .slice(0, 8);
  return `receipt-${projectNum}-${vendorHash}`;
}

function appendReimbursementMemoSuffix(baseMemo, hasReimbursementLines) {
  if (!hasReimbursementLines) return baseMemo;
  const suffix = ' + Reimbursement';
  if (!baseMemo) return '+ Reimbursement';
  if (String(baseMemo).endsWith(suffix)) return baseMemo;
  return `${baseMemo}${suffix}`;
}

function buildReceiptReimbursementDescription(line) {
  const vendor = normalizeReceiptVendorName(line?.vendor_name) || 'Unknown Vendor';
  return `[${vendor}] Reimbursement`;
}

async function loadPendingReceiptReimbursementRollups({
  orgId,
  start,
  end,
  excludeEmployeeIds = [],
  onlyEmployeeIds = []
}) {
  if (!orgId || !start || !end) return [];

  let sql = `
    SELECT
      rr.employee_id,
      COALESCE(e.name, '(Unknown employee)') AS employee_name,
      e.name_on_checks AS employee_name_on_checks,
      e.vendor_qbo_id AS employee_vendor_qbo_id,
      e.employee_qbo_id AS employee_employee_qbo_id,
      rr.project_id,
      rr.vendor_name,
      COALESCE(p.name, '(No project)') AS project_name,
      COALESCE(p.name, '(No project)') AS project_name_raw,
      p.qbo_id AS project_qbo_id,
      p.customer_name AS project_customer_name,
      COUNT(rr.id) AS reimbursement_count,
      IFNULL(SUM(rr.amount), 0) AS reimbursement_amount
    FROM payroll_receipt_reimbursements rr
    JOIN employees e
      ON e.id = rr.employee_id
     AND e.org_id = rr.org_id
    LEFT JOIN projects p
      ON p.id = rr.project_id
     AND p.org_id = rr.org_id
    WHERE rr.org_id = ?
      AND rr.status = 'requested'
      AND rr.expense_date >= ?
      AND rr.expense_date <= ?
  `;
  const params = [orgId, start, end];

  const normalizedExclude = (Array.isArray(excludeEmployeeIds) ? excludeEmployeeIds : [])
    .map(Number)
    .filter(Number.isFinite);
  if (normalizedExclude.length) {
    sql += ` AND rr.employee_id NOT IN (${normalizedExclude.map(() => '?').join(',')})`;
    params.push(...normalizedExclude);
  }

  const normalizedOnly = (Array.isArray(onlyEmployeeIds) ? onlyEmployeeIds : [])
    .map(Number)
    .filter(Number.isFinite);
  if (normalizedOnly.length) {
    sql += ` AND rr.employee_id IN (${normalizedOnly.map(() => '?').join(',')})`;
    params.push(...normalizedOnly);
  }

  sql += `
    GROUP BY
      rr.employee_id,
      e.name,
      e.name_on_checks,
      e.vendor_qbo_id,
      e.employee_qbo_id,
      rr.project_id,
      rr.vendor_name,
      p.name,
      p.qbo_id,
      p.customer_name
    ORDER BY
      employee_name,
      project_name,
      rr.vendor_name
  `;

  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

/* ───────── 13. BUILD DRAFTS FROM time_entries (DB ONLY) ───────── */

async function buildCheckDrafts(start, end, options = {}) {
  const orgId = options.orgId;
  const {
    excludeEmployeeIds = [],
    onlyEmployeeIds = [],
    includeOvertime = true,
    includeReceiptReimbursements = true,
    reimbursementExpenseAccountName = null,
    receiptClassName = null
  } = options;
  const HOURS_EPSILON = 0.1; // keep in sync with payroll/time-entries endpoint
  const payrollRulesRaw = await loadPayrollRulesMap(orgId);
  const payrollRules = normalizePayrollRules(payrollRulesRaw);

  const rulesMap = await loadExceptionRulesMap(orgId);
  const isRuleEnabled = makeRuleChecker(rulesMap);

  const ruleMissingClockOut = isRuleEnabled('missing_clock_out');
  const ruleLongShift = isRuleEnabled('long_shift');
  const ruleMultiDay = isRuleEnabled('multi_day');
  const ruleCrossesMidnight = isRuleEnabled('crosses_midnight');
  const ruleNoProject = isRuleEnabled('no_project');
  const ruleProjectMismatch = isRuleEnabled('project_mismatch');
  const ruleTinyPunch = isRuleEnabled('tiny_punch');
  const ruleGeoIn = isRuleEnabled('geofence_clock_in');
  const ruleAutoClockOut = isRuleEnabled('auto_clock_out');
  const ruleManualNoPunches = isRuleEnabled('manual_no_punches');
  const ruleManualHoursMismatch = isRuleEnabled('manual_hours_mismatch');
  const ruleWeeklyHours = isRuleEnabled('weekly_hours');
  const rawWeeklyThreshold =
    rulesMap && rulesMap.weekly_hours_threshold != null
      ? Number(rulesMap.weekly_hours_threshold)
      : null;
  const weeklyHoursThreshold =
    Number.isFinite(rawWeeklyThreshold) && rawWeeklyThreshold > 0
      ? rawWeeklyThreshold
      : null;

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
  if (ruleGeoIn) {
    punchExceptionConditions.push(
      `(tp.geo_violation IS NOT NULL AND tp.geo_violation != 0)
       OR (ks.geo_violation IS NOT NULL AND ks.geo_violation != 0)`
    );
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
      `(tp.clock_in_local_date IS NOT NULL AND tp.clock_out_local_date IS NOT NULL
        AND tp.clock_in_local_date != tp.clock_out_local_date)`
    );
  }
  if (ruleTinyPunch) {
    punchExceptionConditions.push(
      `(tp.clock_in_ts IS NOT NULL AND tp.clock_out_ts IS NOT NULL
        AND ((julianday(tp.clock_out_ts) - julianday(tp.clock_in_ts)) * 24.0 * 60) < 5)`
    );
  }
  // Weekly hours exceptions are evaluated separately with org timezone rules.

  const guardedPunchExceptionConditions = punchExceptionConditions.map(
    c => `(tp.id IS NOT NULL AND (${c}))`
  );
  const punchExceptionCase = guardedPunchExceptionConditions.length
    ? `CASE ${guardedPunchExceptionConditions.map(c => `WHEN ${c} THEN 1`).join(' ')} ELSE 0 END`
    : '0';
  const punchExceptionUnapprovedCase = guardedPunchExceptionConditions.length
    ? `CASE ${guardedPunchExceptionConditions.map(c => `WHEN (${c}) AND LOWER(COALESCE(tp.exception_review_status, 'open')) NOT IN ('approved','modified') THEN 1`).join(' ')} ELSE 0 END`
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
        LEFT JOIN time_punches tp ON tp.time_entry_id = t.id AND tp.org_id = t.org_id
        LEFT JOIN kiosk_sessions ks ON ks.id = tp.kiosk_session_id AND ks.org_id = t.org_id
        WHERE t.org_id = ? AND t.start_date >= ? AND t.end_date <= ?
          AND LOWER(COALESCE(t.approval_status, 'pending')) = 'approved'
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
      JOIN employees e ON f.employee_id = e.id AND e.org_id = ?
      LEFT JOIN projects p ON f.project_id = p.id AND p.org_id = ?
      WHERE 1=1
    `;

  const params = [orgId, start, end, orgId, orgId];

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

  let rows = await new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

  // Payroll approval is authoritative for payroll eligibility.

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

  if (includeReceiptReimbursements) {
    const receiptRollups = await loadPendingReceiptReimbursementRollups({
      orgId,
      start,
      end,
      excludeEmployeeIds,
      onlyEmployeeIds
    });

    receiptRollups.forEach(row => {
      const employeeId = Number(row.employee_id || 0);
      const sourceProjectId = Number(row.project_id || 0);
      const vendorName = normalizeReceiptVendorName(row.vendor_name) || 'Unknown Vendor';
      if (!employeeId || !sourceProjectId) return;

      let draft = byEmployee.get(employeeId);
      if (!draft) {
        const displayName = row.employee_name_on_checks || row.employee_name || '(Unknown employee)';
        draft = {
          employee_id: employeeId,
          employee_name: displayName,
          employee_name_raw: row.employee_name || displayName,
          name_on_checks: row.employee_name_on_checks || null,
          vendor_qbo_id: row.employee_vendor_qbo_id || null,
          employee_qbo_id: row.employee_employee_qbo_id || null,
          total_hours: 0,
          total_pay: 0,
          lines: [],
          _lineMap: new Map()
        };
        byEmployee.set(employeeId, draft);
      }

      const lineKey = buildReceiptLineProjectId(sourceProjectId, vendorName);
      if (!draft._lineMap.has(lineKey)) {
        const baseLine = {
          project_id: lineKey,
          source_project_id: sourceProjectId,
          project_name: '',
          project_name_raw: '',
          project_qbo_id: null,
          project_customer_name: null,
          vendor_name: vendorName,
          project_hours: 0,
          project_pay: 0,
          is_receipt_reimbursement: true,
          reimbursement_count: 0,
          class_name: receiptClassName || null,
          expense_account_name: reimbursementExpenseAccountName || null,
          description_override: null
        };
        baseLine.description_override = buildReceiptReimbursementDescription(baseLine);
        draft._lineMap.set(lineKey, baseLine);
      }

      const line = draft._lineMap.get(lineKey);
      const rollupAmount = Number(row.reimbursement_amount || 0);
      const rollupCount = Number(row.reimbursement_count || 0);
      line.project_pay += rollupAmount;
      line.reimbursement_count += rollupCount;
      line.vendor_name = vendorName;
      line.description_override = buildReceiptReimbursementDescription(line);
      draft.total_pay += rollupAmount;
    });
  }

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
  const orgId = options.orgId;
  const excludeEmployeeIds = Array.isArray(options.excludeEmployeeIds)
    ? options.excludeEmployeeIds
    : [];
  const onlyEmployeeIds = Array.isArray(options.onlyEmployeeIds)
    ? options.onlyEmployeeIds.map(Number).filter(Number.isFinite)
    : [];
  const includeOvertime =
    typeof options.includeOvertime === 'boolean' ? options.includeOvertime : true;
  const includeReceiptReimbursements =
    typeof options.includeReceiptReimbursements === 'boolean'
      ? options.includeReceiptReimbursements
      : true;
  const allowNameOnChecksSync = options.allowNameOnChecksSync === true;
  const drafts = await buildCheckDrafts(start, end, {
    excludeEmployeeIds,
    onlyEmployeeIds,
    includeOvertime,
    includeReceiptReimbursements,
    orgId
  });

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
  const orgId = options.orgId;
  if (!orgId) {
    throw new Error('orgId is required for payroll check creation.');
  }
  const accessToken = await getAccessToken(orgId);
  const realmId = await getRealmId(orgId);
  const settings = await getPayrollSettings(orgId);
  const startUS = formatDateUS(start);
  const endUS = formatDateUS(end);
  const previewOnly = options.previewOnly === true;
  const runContext = options.runContext || {};
  const includeOvertime =
    typeof options.includeOvertime === 'boolean' ? options.includeOvertime : true;
  const includeReceiptReimbursements =
    typeof options.includeReceiptReimbursements === 'boolean'
      ? options.includeReceiptReimbursements
      : true;

  const bankName =
    options.bankAccountName || settings.bank_account_name || settings.bankAccountName || BANK_ACCOUNT_NAME;
  const expenseName =
    options.expenseAccountName || settings.expense_account_name || settings.expenseAccountName || EXPENSE_ACCOUNT_NAME;
  const reimbursementExpenseName =
    options.receiptExpenseAccountName ||
    settings.receipt_expense_account_name ||
    settings.receiptExpenseAccountName ||
    expenseName;
  const receiptClassName =
    options.receiptClassName ||
    settings.receipt_class_name ||
    settings.receiptClassName ||
    null;

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
          projectId: Number.isFinite(Number(l.projectId)) ? Number(l.projectId) : null
        }))
        .filter(l => l.employeeId && l.amount > 0)
    : [];
  const customProjectIds = [
    ...new Set(customLines.map(l => l.projectId).filter(id => Number.isFinite(id) && id > 0))
  ];
  const customProjectMap = new Map();
  if (customProjectIds.length) {
    const placeholders = customProjectIds.map(() => '?').join(',');
    const rows = await new Promise((resolve, reject) => {
      db.all(
        `
          SELECT id, qbo_id, name, customer_name
          FROM projects
          WHERE org_id = ? AND id IN (${placeholders})
        `,
        [orgId, ...customProjectIds],
        (err, rows) => (err ? reject(err) : resolve(rows || []))
      );
    });
    rows.forEach(row => {
      if (row && row.id != null) {
        customProjectMap.set(Number(row.id), row);
      }
    });
  }
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
    const drafts = await buildCheckDrafts(start, end, {
      excludeEmployeeIds,
      onlyEmployeeIds,
      includeOvertime,
      includeReceiptReimbursements,
      reimbursementExpenseAccountName: reimbursementExpenseName,
      receiptClassName,
      orgId
    });

    drafts.forEach(draft => {
      const extras = customLinesByEmployee.get(draft.employee_id) || [];
      extras.forEach(line => {
        const projectInfo = line.projectId ? customProjectMap.get(line.projectId) : null;
        draft.lines.push({
          project_id: line.projectId || `custom-${Date.now()}`,
          project_name: projectInfo?.name || line.description || '(Custom line)',
          project_customer_name: projectInfo?.customer_name || null,
          project_qbo_id: projectInfo?.qbo_id || null,
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
          ((line.is_custom ? null : overrideByLine.get(`${draft.employee_id}:${String(line.project_id)}`))?.description ||
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
      const memoBase = effectiveMemoTemplate
        .replace('{employee}', draft.employee_name || '')
        .replace('{start}', startUS)
        .replace('{end}', endUS)
        .replace('{dateRange}', `${startUS} – ${endUS}`);
      const hasReimbursementLines = (draft.lines || []).some(
        line => !!line?.is_receipt_reimbursement
      );
      draft.memo = appendReimbursementMemoSuffix(memoBase, hasReimbursementLines);
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

  const drafts = await buildCheckDrafts(start, end, {
    excludeEmployeeIds,
    onlyEmployeeIds,
    includeOvertime,
    includeReceiptReimbursements,
    reimbursementExpenseAccountName: reimbursementExpenseName,
    receiptClassName,
    orgId
  });

  // Attach any custom lines (UI-added)
  for (const draft of drafts) {
    const extras = customLinesByEmployee.get(draft.employee_id) || [];
    if (!extras.length) continue;
    extras.forEach(line => {
      const projectInfo = line.projectId ? customProjectMap.get(line.projectId) : null;
      draft.lines.push({
        project_id: line.projectId || `custom-${Date.now()}`,
        project_name: projectInfo?.name || line.description || '(Custom line)',
        project_customer_name: projectInfo?.customer_name || null,
        project_qbo_id: projectInfo?.qbo_id || null,
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

  const ensurePayeePrintName = (payeeRef, desiredName) =>
    setPrintOnCheckName(payeeRef, desiredName, orgId);

  // If we hit a "catastrophic" QBO error (network outage, 5xx, auth),
  // we stop sending further checks and just mark the remaining employees
  // as "not sent due to previous error".
  let fatalQboError = null;
  let clearedTokens = false;

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
      const lineOv = line.is_custom ? null : overrideByLine.get(lineKey);
      const expenseNameForLine =
        lineOv?.expenseAccountName || line.expense_account_name || effectiveExpenseName;
      const expenseIdForLine = await getExpenseAccountIdForName(expenseNameForLine);
      if (!expenseIdForLine) {
        lineErrors.push(`Expense account "${expenseNameForLine}" not found in QuickBooks.`);
        continue;
      }
      const classNameForLine = lineOv?.className || line.class_name || null;
      if (!classNameForLine) {
        lineErrors.push('Class is required for this line.');
        continue;
      }
      const classId = await getClassIdForName(classNameForLine);
      if (!classId) {
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
      if (!line.is_receipt_reimbursement && line.project_qbo_id) {
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
    const hasReimbursementLines = (draft.lines || []).some(
      line => !!line?.is_receipt_reimbursement
    );
    const finalMemoText = appendReimbursementMemoSuffix(
      baseMemoText,
      hasReimbursementLines
    );

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
    if (allowNameOnChecksSync && desiredPrintName) {
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
      PrivateNote: appendPayrollPrivateNote(finalMemoText, runContext),
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
      const payload = err.response ? err.response.data : null;
      const isNetworkLevel = !err.response; // no HTTP response at all
      const isServerError = status && status >= 500;
      const qboErrorCode = payload ? extractQboQueryErrorCode(payload) : '';
      const qboErrorMessage = payload
        ? extractQboQueryErrorMessage(payload)
        : (err.message || '');
      const isReauthError =
        status === 401 || shouldClearQboTokensForError({
          status,
          message: qboErrorMessage,
          errorCode: qboErrorCode
        });
      const isAuthOrRateLimit =
        isReauthError || status === 429;

      if (isReauthError && !clearedTokens) {
        clearedTokens = true;
        try {
          await clearTokens(orgId);
        } catch (clearErr) {
          console.warn('[QBO] Failed to clear tokens after auth error:', clearErr.message || clearErr);
        }
      }

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
  getRealmId,
  clearTokens,
  syncVendors,
  syncProjects,
  createChecksForPeriod,
  computePayrollDraftsSnapshot,
  syncEmployeesFromQuickBooks,
  listPayrollAccounts,
  listClasses,
  createEmployeeInQuickBooks,
  updateEmployeeInQuickBooks,
  isQboReauthRequiredError,
  setPrintOnCheckName,
  ensureNameOnChecksColumns,
  verifyQuickBooksConnection
};
