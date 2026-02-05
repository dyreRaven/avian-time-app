// server.js
// Main Express server for the Avian Time & Payroll app


/* ───────── 1. CORE SETUP (config, imports, globals) ───────── */

require('dotenv').config();
const express = require('express');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const webpush = require('web-push');
const nodemailer = require('nodemailer');

const db = require('./db'); // ensure DB initializes
const PDFDocument = require('pdfkit'); // PDF export for time-entries

const fs = require('fs');
const fsp = require('fs').promises;

const {
  DB_PATH,
  SESSION_DB_PATH,
  APP_TIMEZONE,
  NODE_ENV,
  SESSION_SECRET,
  SESSION_ENCRYPTION_KEY,
  COOKIE_SECURE,
  COOKIE_SAMESITE,
  ENABLE_IN_PROCESS_BACKUPS,
  PORT,
  QBO_CLIENT_ID,
  QBO_CLIENT_SECRET,
  QBO_REDIRECT_URI,
  APNS_KEY_PATH,
  APNS_KEY_ID,
  APNS_TEAM_ID,
  APNS_BUNDLE_ID,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
  NOTIFICATION_RETENTION_DAYS: NOTIFICATION_RETENTION_DAYS_ENV,
  PHOTO_RETENTION_DAYS: PHOTO_RETENTION_DAYS_ENV,
  IDEMPOTENCY_RETENTION_DAYS: IDEMPOTENCY_RETENTION_DAYS_ENV
} = require('./lib/config');
const dbPath = DB_PATH;
const backupDir = path.join(__dirname, 'backups');
const secureUploadsRoot = path.join(__dirname, 'secure_uploads');
const legacyUploadsRoot = path.join(__dirname, 'uploads');
const legacyPublicUploadsRoot = path.join(__dirname, 'public', 'uploads');
const session = require('express-session');
const bcrypt  = require('bcrypt');
const createSQLiteStore = require('./session-store');
const createDbHelpers = require('./lib/db-helpers');
const createAccessHelpers = require('./lib/access');
const { csrfGuard, requireAuth, makeRequireAdminAccess } = require('./lib/auth');
const createBackupHelper = require('./lib/backup');
const createShipmentUpload = require('./lib/uploads');
const createEmployeeMediaUpload = require('./lib/employee-media-uploads');
const createEmployeeDocsUpload = require('./lib/employee-docs-uploads');
const { normalizePayrollRules, applyOvertimeAllocations, roundCurrency } = require('./lib/payroll-utils');
const IS_PROD = NODE_ENV === 'production';
if (IS_PROD && SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be set to a strong value (32+ chars) in production.');
  process.exit(1);
}
const rawCookieSecure = String(COOKIE_SECURE || '').toLowerCase();
const cookieSecureFlag =
  rawCookieSecure === 'true'
    ? true
    : rawCookieSecure === 'false'
      ? false
      : IS_PROD;
const allowedSameSite = new Set(['lax', 'strict', 'none']);
const rawSameSite = String(
  COOKIE_SAMESITE || (IS_PROD ? 'strict' : 'lax')
).toLowerCase();
const cookieSameSite = allowedSameSite.has(rawSameSite) ? rawSameSite : 'strict';

const qboConfigMissing = [];
if (!QBO_CLIENT_ID) qboConfigMissing.push('QBO_CLIENT_ID');
if (!QBO_CLIENT_SECRET) qboConfigMissing.push('QBO_CLIENT_SECRET');
if (!QBO_REDIRECT_URI) qboConfigMissing.push('QBO_REDIRECT_URI');
const qboConfigured = qboConfigMissing.length === 0;

const apnsConfigured = !!(
  APNS_KEY_PATH &&
  APNS_KEY_ID &&
  APNS_TEAM_ID &&
  APNS_BUNDLE_ID
);

const smtpPortNum = Number(SMTP_PORT) || 0;
const smtpConfigured = !!(SMTP_HOST && smtpPortNum && SMTP_USER && SMTP_PASS);
const mailTransport = smtpConfigured
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: smtpPortNum,
      secure: smtpPortNum === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    })
  : null;
const mailFromAddress = SMTP_FROM || SMTP_USER || '';

const pushConfigured = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (pushConfigured) {
  const subject =
    VAPID_SUBJECT ||
    (SMTP_USER ? `mailto:${SMTP_USER}` : 'mailto:admin@aviangp.com');
  webpush.setVapidDetails(subject, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}
if (!qboConfigured) {
  console.warn(`[QBO] Missing env: ${qboConfigMissing.join(', ')}`);
}
if (!smtpConfigured) {
  console.warn('[Notify] SMTP not configured; email notifications disabled.');
}
if (!pushConfigured) {
  console.warn('[Notify] VAPID keys missing; web push disabled.');
}
if (apnsConfigured) {
  console.warn('[Notify] APNs config present but APNs sender is not implemented.');
}

const { dbAll, dbGet, dbRun } = createDbHelpers(db);
const {
  getAdminAccessPerms,
  loadExceptionRulesMap,
  getEmployeeAccessFlags,
  getOrgStatus
} = createAccessHelpers({ dbGet });
const getMembershipStatus = ({ userId, orgId }) => {
  if (!userId || !orgId) return null;
  return dbGet(
    'SELECT login_enabled FROM user_orgs WHERE user_id = ? AND org_id = ?',
    [userId, orgId]
  );
};
const requireAdminAccess = makeRequireAdminAccess(
  getAdminAccessPerms,
  getEmployeeAccessFlags,
  getOrgStatus,
  getMembershipStatus
);
const requireViewPayroll = requireAdminAccess(p => p.view_payroll);
const requireViewPayrollOrSeeShipments = requireAdminAccess(
  p => p.view_payroll || p.see_shipments
);
const requireModifyPayroll = requireAdminAccess(p => p.modify_payroll);
const requireViewTimeReports = requireAdminAccess(
  p => p.view_time_reports || p.view_payroll
);
const requireModifyTime = requireAdminAccess(p => p.modify_time);
const requireApproveTime = requireAdminAccess(p => p.approve_time);
const requireSeeShipments = requireAdminAccess(p => p.see_shipments);
const { performDatabaseBackup } = createBackupHelper({
  db,
  dbPath,
  backupDir,
  uploadsRoot: secureUploadsRoot,
  extraUploadsRoots: [
    { root: legacyUploadsRoot, label: 'uploads' },
    { root: legacyPublicUploadsRoot, label: 'public_uploads' }
  ]
});

const BACKUP_LOCK_TTL_MS = 4 * 60 * 60 * 1000;

async function runBackupWithLock({ requireLock = false } = {}) {
  const gotLock = await acquireJobLock('backup', BACKUP_LOCK_TTL_MS);
  if (!gotLock) {
    if (requireLock) {
      console.warn('Backup lock busy; skipping required backup.');
    }
    return { ok: false, reason: 'lock_busy' };
  }
  const refreshMs = Math.min(BACKUP_LOCK_TTL_MS / 2, 15 * 60 * 1000);
  let refreshTimer = null;
  try {
    refreshTimer = setInterval(
      () => refreshJobLock('backup', BACKUP_LOCK_TTL_MS),
      refreshMs
    );
    if (refreshTimer.unref) refreshTimer.unref();
    await performDatabaseBackup();
    return { ok: true };
  } catch (err) {
    console.error('Backup job failed:', err);
    return {
      ok: false,
      reason: 'error',
      error: err && err.message ? err.message : String(err)
    };
  } finally {
    if (refreshTimer) clearInterval(refreshTimer);
    await releaseJobLock('backup');
  }
}
const {
  upload: uploadShipmentDocs,
  resolveShipmentDocumentPath,
  uploadsRoot,
  allowedMimes: shipmentAllowedMimes,
  allowedExts: shipmentAllowedExts
} = createShipmentUpload(__dirname);
const {
  upload: uploadEmployeeMedia,
  resolveEmployeeIdPath,
  resolveEmployeePhotoPath,
  idAllowedMimes,
  idAllowedExts,
  photoAllowedMimes,
  photoAllowedExts
} = createEmployeeMediaUpload(__dirname);
const {
  upload: uploadEmployeeDocs,
  resolveEmployeeDocumentPath,
  allowedMimes: employeeDocsAllowedMimes,
  allowedExts: employeeDocsAllowedExts
} = createEmployeeDocsUpload(__dirname);

async function tableExists(tableName) {
  const row = await dbGet(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [tableName]
  );
  return !!row;
}

async function loadIdempotentResponse(orgId, scope, key) {
  if (!orgId || !scope || !key) return null;
  const row = await dbGet(
    `
      SELECT response_json
      FROM idempotency_keys
      WHERE org_id = ? AND scope = ? AND key = ?
      LIMIT 1
    `,
    [orgId, scope, key]
  );
  if (!row) return null;
  if (!row.response_json) return { ok: true };
  try {
    const parsed = JSON.parse(row.response_json);
    return parsed && typeof parsed === 'object' ? parsed : { ok: true };
  } catch {
    return { ok: true };
  }
}

async function storeIdempotentResponse(orgId, scope, key, response) {
  if (!orgId || !scope || !key) return;
  const payload =
    response && typeof response === 'object' ? JSON.stringify(response) : null;
  await dbRun(
    `
      INSERT OR IGNORE INTO idempotency_keys (org_id, scope, key, response_json)
      VALUES (?, ?, ?, ?)
    `,
    [orgId, scope, key, payload]
  );
}

// Payroll DB lock helpers
async function acquirePayrollLock(orgId, lockedBy = 'server') {
  try {
    if (!orgId) return false;
    const res = await dbRun(
      `
        INSERT INTO payroll_lock (org_id, locked_by, locked_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(org_id) DO NOTHING
      `,
      [orgId, lockedBy]
    );
    // If changes is 0, lock already held
    if (res && res.changes === 0) {
      return false;
    }
    return true;
  } catch (err) {
    console.error('Failed to acquire payroll lock:', err);
    return false;
  }
}

async function releasePayrollLock(orgId) {
  try {
    if (!orgId) return;
    await dbRun(`DELETE FROM payroll_lock WHERE org_id = ?`, [orgId]);
  } catch (err) {
    console.error('Failed to release payroll lock:', err);
  }
}

// Auto clock-out DB lock helpers (multi-instance safety)
const AUTO_CLOCKOUT_LOCK_TTL_MS = 5 * 60 * 1000;
const AUTO_CLOCKOUT_LOCKER_ID = `${os.hostname()}:${process.pid}`;
const JOB_LOCKER_ID = AUTO_CLOCKOUT_LOCKER_ID;
const JOB_LOCK_DEFAULT_TTL_MS = 10 * 60 * 1000;

async function acquireAutoClockOutLock(orgId, lockedBy = AUTO_CLOCKOUT_LOCKER_ID) {
  try {
    if (!orgId) return false;
    const nowMs = Date.now();
    const lockUntil = nowMs + AUTO_CLOCKOUT_LOCK_TTL_MS;
    const res = await dbRun(
      `
        INSERT INTO auto_clockout_lock (org_id, locked_by, locked_at, locked_until)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(org_id) DO UPDATE SET
          locked_by = excluded.locked_by,
          locked_at = excluded.locked_at,
          locked_until = excluded.locked_until
        WHERE auto_clockout_lock.locked_until IS NULL
          OR auto_clockout_lock.locked_until <= ?
      `,
      [orgId, lockedBy, nowMs, lockUntil, nowMs]
    );
    return !!(res && res.changes > 0);
  } catch (err) {
    console.error('Failed to acquire auto clock-out lock:', err);
    return false;
  }
}

async function releaseAutoClockOutLock(orgId, lockedBy = AUTO_CLOCKOUT_LOCKER_ID) {
  try {
    if (!orgId) return;
    await dbRun(
      `DELETE FROM auto_clockout_lock WHERE org_id = ? AND locked_by = ?`,
      [orgId, lockedBy]
    );
  } catch (err) {
    console.error('Failed to release auto clock-out lock:', err);
  }
}

async function refreshAutoClockOutLock(orgId, lockedBy = AUTO_CLOCKOUT_LOCKER_ID) {
  try {
    if (!orgId) return;
    const nowMs = Date.now();
    const lockUntil = nowMs + AUTO_CLOCKOUT_LOCK_TTL_MS;
    await dbRun(
      `
        UPDATE auto_clockout_lock
        SET locked_at = ?, locked_until = ?
        WHERE org_id = ? AND locked_by = ?
      `,
      [nowMs, lockUntil, orgId, lockedBy]
    );
  } catch (err) {
    console.error('Failed to refresh auto clock-out lock:', err);
  }
}

// General job lock helpers (multi-instance safety for schedulers)
async function acquireJobLock(jobKey, ttlMs = JOB_LOCK_DEFAULT_TTL_MS, lockedBy = JOB_LOCKER_ID) {
  try {
    if (!jobKey) return false;
    const nowMs = Date.now();
    const lockUntil = nowMs + (ttlMs || JOB_LOCK_DEFAULT_TTL_MS);
    const res = await dbRun(
      `
        INSERT INTO job_locks (job_key, locked_by, locked_at, locked_until)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(job_key) DO UPDATE SET
          locked_by = excluded.locked_by,
          locked_at = excluded.locked_at,
          locked_until = excluded.locked_until
        WHERE job_locks.locked_until IS NULL
          OR job_locks.locked_until <= ?
      `,
      [jobKey, lockedBy, nowMs, lockUntil, nowMs]
    );
    return !!(res && res.changes > 0);
  } catch (err) {
    console.error('Failed to acquire job lock:', err);
    return false;
  }
}

async function refreshJobLock(jobKey, ttlMs = JOB_LOCK_DEFAULT_TTL_MS, lockedBy = JOB_LOCKER_ID) {
  try {
    if (!jobKey) return;
    const nowMs = Date.now();
    const lockUntil = nowMs + (ttlMs || JOB_LOCK_DEFAULT_TTL_MS);
    await dbRun(
      `
        UPDATE job_locks
        SET locked_at = ?, locked_until = ?
        WHERE job_key = ? AND locked_by = ?
      `,
      [nowMs, lockUntil, jobKey, lockedBy]
    );
  } catch (err) {
    console.error('Failed to refresh job lock:', err);
  }
}

async function releaseJobLock(jobKey, lockedBy = JOB_LOCKER_ID) {
  try {
    if (!jobKey) return;
    await dbRun(`DELETE FROM job_locks WHERE job_key = ? AND locked_by = ?`, [
      jobKey,
      lockedBy
    ]);
  } catch (err) {
    console.error('Failed to release job lock:', err);
  }
}

// Global in-memory lock to prevent concurrent payroll runs
let isPayrollRunInProgress = false;
const QBO_SYNC_LOCK_TTL_MS = 15 * 60 * 1000;

function getQboSyncLockKey(scope, orgId) {
  if (!orgId) return null;
  return `qbo_sync:${orgId}`;
}

async function acquireQboSyncLock(scope, orgId) {
  const key = getQboSyncLockKey(scope, orgId);
  if (!key) return null;
  const gotLock = await acquireJobLock(key, QBO_SYNC_LOCK_TTL_MS);
  return gotLock ? key : null;
}

async function refreshQboSyncLock(lockKey) {
  if (!lockKey) return;
  await refreshJobLock(lockKey, QBO_SYNC_LOCK_TTL_MS);
}

async function releaseQboSyncLock(lockKey) {
  if (!lockKey) return;
  await releaseJobLock(lockKey);
}

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
    const orgId = req?.session?.orgId;
    if (!orgId) return;
    const { actorUserId, actorEmployeeId, actorName } =
      await getExceptionActor(req, null);
    await dbRun(
      `
        INSERT INTO time_exception_actions
          (org_id, source_type, source_id, action, actor_user_id, actor_employee_id, actor_name, note, changes_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        orgId,
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

function safeJsonStringify(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  try {
    return JSON.stringify(value);
  } catch (err) {
    console.warn('Failed to stringify audit payload:', err?.message || err);
    return null;
  }
}

async function logAuditEvent({
  req,
  orgId,
  action,
  entityType = null,
  entityId = null,
  before = null,
  after = null,
  note = null,
  actorUserId = null,
  actorEmployeeId = null,
  actorName = null
}) {
  try {
    if (!orgId || !action) return;
    let resolvedUserId = actorUserId;
    let resolvedEmployeeId = actorEmployeeId;
    let resolvedName = actorName;
    if (req && (resolvedUserId == null || resolvedEmployeeId == null || resolvedName == null)) {
      const actor = await getExceptionActor(req, resolvedName);
      if (resolvedUserId == null) resolvedUserId = actor.actorUserId;
      if (resolvedEmployeeId == null) resolvedEmployeeId = actor.actorEmployeeId;
      if (resolvedName == null) resolvedName = actor.actorName;
    }
    await dbRun(
      `
        INSERT INTO audit_log (
          org_id,
          actor_user_id,
          actor_employee_id,
          action,
          entity_type,
          entity_id,
          before_json,
          after_json,
          note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        orgId,
        resolvedUserId || null,
        resolvedEmployeeId || null,
        action,
        entityType || null,
        entityId || null,
        safeJsonStringify(before),
        safeJsonStringify(after),
        note || null
      ]
    );
  } catch (err) {
    console.warn('Audit log write failed:', err?.message || err);
  }
}

// ───────── SHIPMENT DOCUMENT UPLOADS ─────────
// (configured via lib/uploads.js → uploadsRoot, uploadShipmentDocs, resolveShipmentDocumentPath)

function detectMimeFromBuffer(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf.length >= 5 && buf.slice(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf';
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buf.length >= 6) {
    const sig = buf.slice(0, 6).toString('ascii');
    if (sig === 'GIF87a' || sig === 'GIF89a') return 'image/gif';
  }
  if (
    buf.length >= 12 &&
    buf.slice(0, 4).toString('ascii') === 'RIFF' &&
    buf.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

async function sniffMimeFromFile(filePath) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(12), 0, 12, 0);
    return detectMimeFromBuffer(buffer.slice(0, bytesRead));
  } finally {
    await handle.close();
  }
}

async function validateStoredUpload(filePath, allowedMimes, allowedExts) {
  const ext = path.extname(filePath || '').toLowerCase();
  const expectedMime = allowedExts[ext];
  if (!expectedMime) {
    return { ok: false, error: 'Unsupported file extension.' };
  }
  const sniffed = await sniffMimeFromFile(filePath);
  if (!sniffed || !allowedMimes.has(sniffed)) {
    return { ok: false, error: 'Unsupported file type.' };
  }
  if (sniffed !== expectedMime) {
    return { ok: false, error: 'File content does not match extension.' };
  }
  return { ok: true, mime: sniffed };
}

async function cleanupUploadedFiles(files) {
  for (const file of files || []) {
    if (!file || !file.path) continue;
    try {
      await fsp.unlink(file.path);
    } catch {}
  }
}

async function validateUploadedFiles(files, allowedMimes, allowedExts) {
  for (const file of files || []) {
    if (!file || !file.path) continue;
    const result = await validateStoredUpload(file.path, allowedMimes, allowedExts);
    if (!result.ok) {
      throw new Error(result.error || 'Unsupported file type.');
    }
  }
}

function employeeIdDocTypeLabel(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'drivers_license') return "Driver's license";
  if (v === 'passport') return 'Passport';
  if (v === 'other') return 'Other';
  return '';
}

function wrapUpload(middleware) {
  return (req, res, next) => {
    middleware(req, res, err => {
      if (!err) return next();
      const message = err && err.message ? err.message : 'Upload failed.';
      const isMulter = err && err.name === 'MulterError';
      const isClientError =
        isMulter ||
        /unsupported file|invalid file|file size|limit/i.test(message);
      const status = isClientError ? 400 : 500;
      return res
        .status(status)
        .json({ error: isClientError ? message : 'Upload failed.' });
    });
  };
}

// ───────── Payroll attempt helpers ─────────
async function recordPayrollAttempt({ orgId, payrollRunId = null, start, end, qbResult }) {
  const okFlag = (() => {
    if (!qbResult) return 0;
    const hasErrors =
      Array.isArray(qbResult.results) && qbResult.results.some(r => r && r.ok === false);
    return qbResult.fatalQboError || hasErrors ? 0 : 1;
  })();

  const attempt = await dbRun(
    `
      INSERT INTO payroll_run_attempts (
        org_id, payroll_run_id, start_date, end_date, ok, fatal_error
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
    [orgId, payrollRunId || null, start, end, okFlag, qbResult?.fatalQboError || null]
  );

  const attemptId = attempt.lastID;
  const results = Array.isArray(qbResult?.results) ? qbResult.results : [];
  for (const r of results) {
    await dbRun(
      `
        INSERT INTO payroll_attempt_results (
          org_id,
          attempt_id,
          employee_id,
          employee_name,
          total_hours,
          total_pay,
          ok,
          error,
          warning_codes,
          qbo_txn_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        orgId,
        attemptId,
        r?.employeeId || null,
        r?.employeeName || null,
        r ? Number(r.totalHours || 0) : null,
        r ? Number(r.totalPay || 0) : null,
        r && r.ok === false ? 0 : 1,
        r?.error || null,
        r?.warningCodes ? JSON.stringify(r.warningCodes) : null,
        r?.qboTxnId || null
      ]
    );
  }

  return attemptId;
}

async function updateAttemptRunId({ orgId, attemptId, payrollRunId }) {
  if (!orgId || !attemptId || !payrollRunId) return;
  await dbRun(
    `
      UPDATE payroll_run_attempts
      SET payroll_run_id = ?
      WHERE id = ? AND payroll_run_id IS NULL AND org_id = ?
    `,
    [payrollRunId, attemptId, orgId]
  );
}

async function getFailedEmployeeIdsForAttempt({ orgId, attemptId }) {
  if (!orgId || !attemptId) return [];
  const rows = await dbAll(
    `
      SELECT DISTINCT employee_id
      FROM payroll_attempt_results
      WHERE attempt_id = ?
        AND org_id = ?
        AND IFNULL(ok, 0) = 0
        AND employee_id IS NOT NULL
    `,
    [attemptId, orgId]
  );
  return rows.map(r => Number(r.employee_id)).filter(n => Number.isFinite(n));
}

// ───────── Name on checks retry queue ─────────
const NAME_ON_CHECKS_BACKOFF_MINUTES = [10, 60, 360, 1440];
const NAME_ON_CHECKS_MAX_AGE_DAYS = 7;

function getNameOnChecksBackoffMinutes(attempts) {
  if (!Number.isFinite(attempts) || attempts < 0) return NAME_ON_CHECKS_BACKOFF_MINUTES[0];
  if (attempts >= NAME_ON_CHECKS_BACKOFF_MINUTES.length) {
    return NAME_ON_CHECKS_BACKOFF_MINUTES[NAME_ON_CHECKS_BACKOFF_MINUTES.length - 1];
  }
  return NAME_ON_CHECKS_BACKOFF_MINUTES[attempts];
}

async function enqueueNameOnChecksRetry({ orgId, employeeId, desiredName, payeeRef, lastError }) {
  if (!orgId || !employeeId || !desiredName || !payeeRef || !payeeRef.value) return;
  await dbRun(
    `
      INSERT INTO name_on_checks_queue (
        org_id,
        employee_id,
        desired_name,
        payee_type,
        payee_id,
        last_error,
        attempts,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))
      ON CONFLICT(org_id, employee_id) DO UPDATE SET
        desired_name = excluded.desired_name,
        payee_type   = excluded.payee_type,
        payee_id     = excluded.payee_id,
        last_error   = excluded.last_error,
        attempts     = 0,
        created_at   = datetime('now'),
        updated_at   = datetime('now')
    `,
    [
      orgId,
      employeeId,
      desiredName,
      payeeRef.type || null,
      String(payeeRef.value || ''),
      lastError || null
    ]
  );
}

async function clearNameOnChecksRetry(orgId, employeeId) {
  if (!orgId || !employeeId) return;
  await dbRun('DELETE FROM name_on_checks_queue WHERE org_id = ? AND employee_id = ?', [
    orgId,
    employeeId
  ]);
}

let nameOnChecksJobRunning = false;

async function processNameOnChecksQueue() {
  if (nameOnChecksJobRunning) return;
  nameOnChecksJobRunning = true;
  const lockKey = 'name_on_checks_queue';
  const lockTtlMs = 10 * 60 * 1000;
  const gotLock = await acquireJobLock(lockKey, lockTtlMs);
  if (!gotLock) {
    nameOnChecksJobRunning = false;
    return;
  }

  try {
    const refreshIntervalMs = Math.max(30000, Math.floor(lockTtlMs / 2));
    let lastRefresh = Date.now();
    const refreshIfNeeded = async () => {
      const now = Date.now();
      if (now - lastRefresh >= refreshIntervalMs) {
        await refreshJobLock(lockKey, lockTtlMs);
        lastRefresh = now;
      }
    };

    const rows = await dbAll(
      `
        SELECT id, org_id, employee_id, desired_name, payee_type, payee_id,
               attempts, created_at, updated_at, last_error
        FROM name_on_checks_queue
        ORDER BY updated_at ASC
        LIMIT 25
      `
    );
    if (!rows.length) return;

    for (const row of rows) {
      await refreshIfNeeded();
      const createdMs = Date.parse(row.created_at || '');
      if (Number.isFinite(createdMs)) {
        const ageDays = (Date.now() - createdMs) / (1000 * 60 * 60 * 24);
        if (ageDays >= NAME_ON_CHECKS_MAX_AGE_DAYS) {
          if (!row.last_error || !String(row.last_error).includes('Stopped retrying')) {
            await dbRun(
              `
                UPDATE name_on_checks_queue
                SET last_error = ?, updated_at = datetime('now')
                WHERE id = ? AND org_id = ?
              `,
              ['Stopped retrying after 7 days.', row.id, row.org_id]
            );
          }
          continue;
        }
      }

      const lastAttemptMs = Date.parse(row.updated_at || row.created_at || '');
      if (Number.isFinite(lastAttemptMs)) {
        const elapsedMinutes = (Date.now() - lastAttemptMs) / (1000 * 60);
        const waitMinutes = getNameOnChecksBackoffMinutes(Number(row.attempts || 0));
        if (elapsedMinutes < waitMinutes) {
          continue;
        }
      }

      const accessToken = await getAccessToken(row.org_id);
      const realmId = await getRealmId(row.org_id);
      if (!accessToken || !realmId) {
        continue;
      }

      const payeeRef = row.payee_id
        ? { value: row.payee_id, type: row.payee_type || 'Employee' }
        : null;

      if (!payeeRef || !row.desired_name) {
        await dbRun('DELETE FROM name_on_checks_queue WHERE id = ?', [row.id]);
        continue;
      }

      const res = await setPrintOnCheckName(payeeRef, row.desired_name, row.org_id);
      if (res?.ok || res?.skipped) {
        await dbRun(
          'UPDATE employees SET name_on_checks_qbo_updated_at = datetime(\'now\') WHERE id = ? AND org_id = ?',
          [row.employee_id, row.org_id]
        );
        await dbRun('DELETE FROM name_on_checks_queue WHERE id = ? AND org_id = ?', [
          row.id,
          row.org_id
        ]);
      } else {
        if (res?.status === 401 || res?.status === 403) {
          continue;
        }
        await dbRun(
          `
            UPDATE name_on_checks_queue
            SET attempts = attempts + 1,
                last_error = ?,
                updated_at = datetime('now')
            WHERE id = ? AND org_id = ?
          `,
          [res?.error || 'Unknown error', row.id, row.org_id]
        );
      }
    }
  } catch (err) {
    console.error('Name-on-checks retry queue error:', err);
  } finally {
    nameOnChecksJobRunning = false;
    await releaseJobLock(lockKey);
  }
}

setInterval(processNameOnChecksQueue, 2 * 60 * 1000); // retry every 2 minutes

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

async function refreshKioskSessionGeofence({ orgId, projectId, geoLat, geoLng, geoRadius }) {
  if (!orgId || !projectId) return;
  const latNum = geoLat == null ? null : Number(geoLat);
  const lngNum = geoLng == null ? null : Number(geoLng);
  const radiusNum = geoRadius == null ? null : Number(geoRadius);
  const hasGeofence =
    latNum != null &&
    lngNum != null &&
    radiusNum != null &&
    !Number.isNaN(latNum) &&
    !Number.isNaN(lngNum) &&
    !Number.isNaN(radiusNum);

  if (!hasGeofence) {
    await dbRun(
      'UPDATE kiosk_sessions SET geo_violation = 0, geo_distance_m = NULL WHERE org_id = ? AND project_id = ?',
      [orgId, projectId]
    );
    return;
  }

  const sessions = await dbAll(
    `
      SELECT id, geo_lat, geo_lng
      FROM kiosk_sessions
      WHERE org_id = ? AND project_id = ? AND geo_violation != 0
        AND geo_lat IS NOT NULL AND geo_lng IS NOT NULL
    `,
    [orgId, projectId]
  );

  for (const session of sessions || []) {
    const sessLat = Number(session.geo_lat);
    const sessLng = Number(session.geo_lng);
    if (Number.isNaN(sessLat) || Number.isNaN(sessLng)) continue;
    const dist = distanceMeters(sessLat, sessLng, latNum, lngNum);
    const violation = dist > radiusNum ? 1 : 0;
    await dbRun(
      'UPDATE kiosk_sessions SET geo_distance_m = ?, geo_violation = ? WHERE id = ? AND org_id = ?',
      [dist, violation, session.id, orgId]
    );
  }
}

// YYYY-MM-DD → Date at midnight (or null on bad input)
function toDateOnly(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

const WEEKDAY_INDEX = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6
};

function shiftIsoDate(dateStr, deltaDays) {
  if (!dateStr) return dateStr;
  const parts = String(dateStr).split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return dateStr;
  const [year, month, day] = parts;
  const dt = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return dt.toISOString().slice(0, 10);
}

function getIsoDateInTimezone(dateInput, timeZone = APP_TIMEZONE) {
  const dateObj = dateInput instanceof Date ? dateInput : new Date(dateInput || Date.now());
  if (Number.isNaN(dateObj.getTime())) return null;
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || APP_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = fmt.formatToParts(dateObj);
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const d = parts.find(p => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch (err) {
    console.warn('Falling back to UTC date in getIsoDateInTimezone:', err.message || err);
  }
  return dateObj.toISOString().slice(0, 10);
}

function getIsoTimeInTimezone(dateInput, timeZone = APP_TIMEZONE) {
  if (!dateInput) return null;
  const dateObj = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(dateObj.getTime())) return null;
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || APP_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    });
    const parts = fmt.formatToParts(dateObj);
    const hh = parts.find(p => p.type === 'hour')?.value;
    const mm = parts.find(p => p.type === 'minute')?.value;
    if (hh && mm) return `${hh}:${mm}`;
  } catch (err) {
    console.warn('Falling back to UTC time in getIsoTimeInTimezone:', err.message || err);
  }
  return dateObj.toISOString().slice(11, 16);
}

// Today's date in 'YYYY-MM-DD' for a given timezone
function getTodayIsoDate(timeZone = APP_TIMEZONE) {
  return getIsoDateInTimezone(new Date(), timeZone) || new Date().toISOString().slice(0, 10);
}

function isFutureIsoDate(dateStr, timeZone = APP_TIMEZONE) {
  if (!dateStr) return false;
  const normalized = String(dateStr).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
  const today = getTodayIsoDate(timeZone);
  return normalized > today;
}

function getTimeZoneOffsetMs(dateObj, timeZone = APP_TIMEZONE) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || APP_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    });
    const parts = fmt.formatToParts(dateObj);
    const y = Number(parts.find(p => p.type === 'year')?.value);
    const m = Number(parts.find(p => p.type === 'month')?.value);
    const d = Number(parts.find(p => p.type === 'day')?.value);
    const hh = Number(parts.find(p => p.type === 'hour')?.value);
    const mm = Number(parts.find(p => p.type === 'minute')?.value);
    const ss = Number(parts.find(p => p.type === 'second')?.value);
    if ([y, m, d, hh, mm, ss].some(Number.isNaN)) return 0;
    const asUtc = Date.UTC(y, m - 1, d, hh, mm, ss);
    return asUtc - dateObj.getTime();
  } catch (err) {
    console.warn('Falling back to zero offset in getTimeZoneOffsetMs:', err.message || err);
    return 0;
  }
}

function getUtcTimestampForLocal(
  { year, month, day, hour = 0, minute = 0, second = 0 },
  timeZone = APP_TIMEZONE
) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  let offset = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
  let utc = utcGuess - offset;
  const offset2 = getTimeZoneOffsetMs(new Date(utc), timeZone);
  if (offset2 !== offset) {
    utc = utcGuess - offset2;
  }
  return utc;
}

function getLocalEndOfDayIso(dateStr, timeZone = APP_TIMEZONE) {
  if (!dateStr) return null;
  const parts = String(dateStr).split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [year, month, day] = parts;
  const utcMs = getUtcTimestampForLocal(
    { year, month, day, hour: 23, minute: 59, second: 59 },
    timeZone
  );
  const iso = new Date(utcMs + 999).toISOString();
  return iso;
}

function getDateForLocalIso(dateStr, timeZone = APP_TIMEZONE) {
  if (!dateStr) return null;
  const parts = String(dateStr).split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [year, month, day] = parts;
  const utcMs = getUtcTimestampForLocal({ year, month, day, hour: 12 }, timeZone);
  const dateObj = new Date(utcMs);
  return Number.isNaN(dateObj.getTime()) ? null : dateObj;
}

function makeWeekStartResolver(timeZone = APP_TIMEZONE) {
  const tz = timeZone || APP_TIMEZONE;
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

  return dateObj => {
    if (!dateObj || Number.isNaN(dateObj.getTime())) return null;
    const parts = dateFormatter.formatToParts(dateObj);
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const d = parts.find(p => p.type === 'day')?.value;
    if (!y || !m || !d) return null;
    const dateStr = `${y}-${m}-${d}`;
    const weekdayShort = weekdayFormatter.format(dateObj);
    const idx = WEEKDAY_INDEX[weekdayShort];
    if (idx == null) return dateStr;
    return shiftIsoDate(dateStr, -idx);
  };
}

async function getOrgTimezone(orgId) {
  if (!orgId) return APP_TIMEZONE;
  const row = await dbGet('SELECT timezone FROM orgs WHERE id = ?', [orgId]);
  return (row && row.timezone) ? row.timezone : APP_TIMEZONE;
}

/* ───────── BACKUP HELPER (implemented in ./lib/backup.js) ───────── */

const PAYROLL_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  FAILED: 'failed',
  COMPLETED: 'completed',
  PARTIAL: 'partial'
};

async function markPayrollRunStatus(orgId, runId, status, { lastError, lastAttemptId, idempotencyKey } = {}) {
  if (!orgId || !runId) return;
  const sets = ['status = ?'];
  const params = [status];

  if (typeof lastError !== 'undefined') {
    sets.push('last_error = ?');
    params.push(lastError || null);
  }

  if (typeof lastAttemptId !== 'undefined') {
    sets.push('last_attempt_id = ?');
    params.push(lastAttemptId || null);
  }

  if (idempotencyKey) {
    sets.push('idempotency_key = COALESCE(idempotency_key, ?)');
    params.push(idempotencyKey);
  }

  params.push(runId, orgId);

  await dbRun(
    `UPDATE payroll_runs SET ${sets.join(', ')} WHERE id = ? AND org_id = ?`,
    params
  );
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

const PAYROLL_PREFLIGHT_TTL_MINUTES = 30;

async function loadPayrollRulesMap(orgId) {
  if (!orgId) return null;
  try {
    const row = await dbGet(
      'SELECT value FROM org_settings WHERE org_id = ? AND key = ?',
      [orgId, 'payroll_rules']
    );
    if (!row || !row.value) return null;
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    console.warn('Failed to load payroll_rules from settings:', err);
    return null;
  }
}

function normalizePayrollPayload(raw = {}) {
  const normalizeString = value => {
    if (value === undefined || value === null) return null;
    const str = String(value).trim();
    return str ? str : null;
  };

  const normalizeId = value => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const normalizeIdList = list =>
    (Array.isArray(list) ? list : [])
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

  const overrides = (Array.isArray(raw.overrides) ? raw.overrides : [])
    .map(o => ({
      employeeId: normalizeId(o?.employeeId),
      expenseAccountName: normalizeString(o?.expenseAccountName),
      memo: normalizeString(o?.memo),
      lineDescriptionTemplate: normalizeString(o?.lineDescriptionTemplate)
    }))
    .filter(o => Number.isFinite(o.employeeId))
    .sort((a, b) => a.employeeId - b.employeeId);

  const lineOverrides = (Array.isArray(raw.lineOverrides) ? raw.lineOverrides : [])
    .map(o => ({
      employeeId: normalizeId(o?.employeeId),
      projectId: normalizeString(o?.projectId),
      expenseAccountName: normalizeString(o?.expenseAccountName),
      description: normalizeString(o?.description),
      className: normalizeString(o?.className),
      isCustom: o?.isCustom === true
    }))
    .filter(o => Number.isFinite(o.employeeId) && o.projectId)
    .sort((a, b) => {
      if (a.employeeId !== b.employeeId) return a.employeeId - b.employeeId;
      return String(a.projectId).localeCompare(String(b.projectId));
    });

  const customLines = (Array.isArray(raw.customLines) ? raw.customLines : [])
    .map(o => ({
      employeeId: normalizeId(o?.employeeId),
      amount: Number(o?.amount || 0),
      description: normalizeString(o?.description),
      expenseAccountName: normalizeString(o?.expenseAccountName),
      className: normalizeString(o?.className),
      projectId: normalizeString(o?.projectId)
    }))
    .filter(o => Number.isFinite(o.employeeId) && Number.isFinite(o.amount) && o.amount > 0)
    .sort((a, b) => {
      if (a.employeeId !== b.employeeId) return a.employeeId - b.employeeId;
      const projCompare = String(a.projectId || '').localeCompare(String(b.projectId || ''));
      if (projCompare !== 0) return projCompare;
      return String(a.description || '').localeCompare(String(b.description || ''));
    });

  const runType = raw.run_type === 'adjustment' ? 'adjustment' : 'standard';
  const includeOvertimeRaw =
    raw.includeOvertime !== undefined ? raw.includeOvertime : raw.include_overtime;
  const includeOvertime =
    includeOvertimeRaw === undefined || includeOvertimeRaw === null
      ? true
      : (
          includeOvertimeRaw === true ||
          includeOvertimeRaw === 'true' ||
          includeOvertimeRaw === 1 ||
          includeOvertimeRaw === '1'
        );

  return {
    start: normalizeString(raw.start),
    end: normalizeString(raw.end),
    bankAccountName: normalizeString(raw.bankAccountName),
    expenseAccountName: normalizeString(raw.expenseAccountName),
    memo: normalizeString(raw.memo),
    lineDescriptionTemplate: normalizeString(raw.lineDescriptionTemplate),
    overrides,
    lineOverrides,
    customLines,
    excludeEmployeeIds: normalizeIdList(raw.excludeEmployeeIds),
    onlyEmployeeIds: normalizeIdList(raw.onlyEmployeeIds),
    isRetry: raw.isRetry === true,
    originalPayrollRunId: normalizeId(raw.originalPayrollRunId),
    fromAttemptId: normalizeId(raw.fromAttemptId),
    idempotencyKey: normalizeString(raw.idempotencyKey),
    include_overtime: includeOvertime,
    run_type: runType,
    adjustment_reason: normalizeString(raw.adjustment_reason)
  };
}

function hashPayrollPayload(raw = {}) {
  const normalized = normalizePayrollPayload(raw);
  const payloadJson = JSON.stringify(normalized);
  const digest = crypto.createHash('sha256').update(payloadJson).digest('hex');
  return {
    normalized,
    payloadJson,
    payloadHash: `sha256:${digest}`
  };
}

async function storePayrollPreflight({
  orgId,
  normalized,
  payloadJson,
  payloadHash,
  snapshotHash,
  snapshotCount,
  actorEmployeeId
}) {
  const result = await dbRun(
    `
      INSERT INTO payroll_preflights (
        org_id,
        start_date,
        end_date,
        run_type,
        payload_hash,
        snapshot_hash,
        snapshot_count,
        payload_json,
        expires_at,
        created_by_employee_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?), ?)
    `,
    [
      orgId,
      normalized.start,
      normalized.end,
      normalized.run_type || 'standard',
      payloadHash,
      snapshotHash || null,
      Number.isFinite(snapshotCount) ? snapshotCount : null,
      payloadJson,
      `+${PAYROLL_PREFLIGHT_TTL_MINUTES} minutes`,
      actorEmployeeId || null
    ]
  );
  return result?.lastID || null;
}

async function loadPayrollPreflight({ orgId, preflightId }) {
  if (!orgId || !preflightId) return null;
  return dbGet(
    `
      SELECT id, payload_hash, payload_json, snapshot_hash, snapshot_count, expires_at
      FROM payroll_preflights
      WHERE id = ? AND org_id = ? AND expires_at > datetime('now')
    `,
    [preflightId, orgId]
  );
}

async function purgeExpiredPayrollPreflights() {
  try {
    const res = await dbRun(
      `DELETE FROM payroll_preflights WHERE expires_at <= datetime('now')`
    );
    if (res && res.changes) {
      console.log(`🧹 Payroll preflights purged: ${res.changes} expired rows.`);
    }
  } catch (err) {
    console.error('Payroll preflight purge error:', err);
  }
}

/* ───────── PAYROLL AUDIT LOG HELPER ───────── */

async function logPayrollEvent({
  orgId,
  event_type,
  payroll_run_id = null,
  actor_employee_id = null,
  message = '',
  details = null
}) {
  const detailsJson = details ? JSON.stringify(details) : null;

  if (!orgId) return;
  await dbRun(
    `
      INSERT INTO payroll_audit_log (
        org_id,
        event_type,
        payroll_run_id,
        actor_employee_id,
        message,
        details_json
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
    [orgId, event_type, payroll_run_id, actor_employee_id, message, detailsJson]
  );

  if (PAYROLL_NOTIFICATION_EVENTS.includes(event_type)) {
    const titleMap = {
      PAYROLL_RUN_DUE: 'Payroll run due',
      PAYROLL_RUN_STARTED: 'Payroll run started',
      PAYROLL_RUN_SUCCESS: 'Payroll run completed',
      PAYROLL_RUN_PARTIAL: 'Payroll run partially completed',
      PAYROLL_RUN_FAILURE: 'Payroll run failed',
      PAYROLL_FATAL_ERROR: 'Payroll fatal error',
      PAYROLL_QBO_ERROR: 'Payroll QuickBooks error',
      PAYROLL_UNPAY: 'Payroll marked unpaid'
    };
    const title = titleMap[event_type] || 'Payroll update';
    const bodyText = message || `Payroll event: ${event_type}`;
    try {
      await notifyPayrollEvent({
        orgId,
        eventType: event_type,
        title,
        body: bodyText,
        data: {
          payroll_run_id,
          actor_employee_id,
          details: details || null
        }
      });
    } catch (err) {
      console.warn('Payroll notification failed:', err.message || err);
    }
  }
}

/* ───────── QUICKBOOKS HELPERS ───────── */

const {
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
  setPrintOnCheckName,
  ensureNameOnChecksColumns
} = require('./quickbooks');

const QBO_OAUTH_STATE_TTL_MINUTES = 10;

async function createQboOAuthState({ orgId, userId }) {
  if (!orgId || !userId) {
    throw new Error('orgId and userId are required for OAuth state.');
  }
  const state = crypto.randomBytes(24).toString('hex');
  await dbRun(
    `
      INSERT INTO qbo_oauth_states (org_id, user_id, state, expires_at)
      VALUES (?, ?, ?, datetime('now', ?))
    `,
    [orgId, userId, state, `+${QBO_OAUTH_STATE_TTL_MINUTES} minutes`]
  );
  return state;
}

async function consumeQboOAuthState(state) {
  if (!state) return null;
  const row = await dbGet(
    `
      SELECT id, org_id, user_id
      FROM qbo_oauth_states
      WHERE state = ? AND expires_at > datetime('now')
      LIMIT 1
    `,
    [state]
  );
  if (!row) return null;
  await dbRun('DELETE FROM qbo_oauth_states WHERE id = ?', [row.id]);
  return row;
}

async function purgeExpiredQboOAuthStates() {
  try {
    const res = await dbRun(
      `DELETE FROM qbo_oauth_states WHERE expires_at <= datetime('now')`
    );
    if (res && res.changes) {
      console.log(`🧹 QBO OAuth states purged: ${res.changes} expired rows.`);
    }
  } catch (err) {
    console.error('QBO OAuth state purge error:', err);
  }
}

function requireQboConfig(res, { expose = false } = {}) {
  if (qboConfigured) return true;
  const message = 'QuickBooks is not configured.';
  if (expose) {
    res.status(500).json({ error: message, missing: qboConfigMissing });
  } else {
    res.status(500).send(message);
  }
  return false;
}

async function respondWithQboError(res, err, { orgId } = {}) {
  const status = err && err.response ? err.response.status : null;
  const retryAfter = err && err.response ? err.response.headers?.['retry-after'] : null;
  const message = err?.message || 'QuickBooks request failed.';

  if (message.includes('Not connected to QuickBooks')) {
    return res.status(400).json({ error: 'Not connected to QuickBooks.' });
  }

  if (status === 401 || status === 403) {
    if (orgId) {
      try {
        await clearTokens(orgId);
      } catch (wipeErr) {
        console.warn('Failed to clear QBO tokens after auth error:', wipeErr.message || wipeErr);
      }
    }
    return res.status(400).json({ error: 'Not connected to QuickBooks.' });
  }

  if (status === 429) {
    if (retryAfter) res.setHeader('Retry-After', retryAfter);
    return res.status(503).json({
      error: 'QuickBooks rate limit reached. Please retry after a short delay.',
      retryable: true
    });
  }

  if (status && status >= 500) {
    return res.status(503).json({
      error: 'QuickBooks is temporarily unavailable. Please retry later.',
      retryable: true
    });
  }

  return res.status(502).json({
    error: message,
    retryable: false
  });
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

function splitName(fullName) {
  const raw = String(fullName || '').trim();
  if (!raw) return { given: null, family: null };
  const parts = raw.split(/\s+/).filter(Boolean);
  if (!parts.length) return { given: null, family: null };
  if (parts.length === 1) return { given: parts[0], family: null };
  return { given: parts[0], family: parts.slice(1).join(' ') };
}

async function markEmployeeQboDirty({ orgId, employeeId, fields, actorEmployeeId, source }) {
  if (!orgId || !employeeId || !Array.isArray(fields) || !fields.length) return;
  const row = await dbGet(
    `SELECT qbo_dirty_fields_json FROM employees WHERE id = ? AND org_id = ? LIMIT 1`,
    [employeeId, orgId]
  );
  const current = new Set(parseJsonArray(row?.qbo_dirty_fields_json));
  fields.forEach(field => current.add(field));
  const json = stringifyJsonArray(Array.from(current));
  const nowIso = new Date().toISOString();
  await dbRun(
    `
      UPDATE employees
      SET
        qbo_dirty_fields_json = ?,
        qbo_dirty_updated_at = ?,
        qbo_dirty_by_employee_id = ?,
        qbo_dirty_source = ?
      WHERE id = ? AND org_id = ?
    `,
    [json, nowIso, actorEmployeeId || null, source || null, employeeId, orgId]
  );
}

async function loadQboDirtyConflicts({ orgId }) {
  if (!orgId) return [];
  const rows = await dbAll(
    `
      SELECT
        id,
        name,
        given_name,
        family_name,
        employee_qbo_id,
        vendor_qbo_id,
        qbo_dirty_fields_json,
        qbo_dirty_updated_at,
        qbo_dirty_by_employee_id,
        qbo_dirty_source,
        qbo_conflict_fields_json,
        qbo_conflict_updated_at
      FROM employees
      WHERE org_id = ?
        AND (employee_qbo_id IS NOT NULL OR vendor_qbo_id IS NOT NULL)
        AND (
          IFNULL(qbo_dirty_fields_json, '') NOT IN ('', '[]')
          OR IFNULL(qbo_conflict_fields_json, '') NOT IN ('', '[]')
        )
      ORDER BY name COLLATE NOCASE
    `,
    [orgId]
  );
  return rows || [];
}



/* ───────── KIOSK HELPERS ───────── */

const ENROLLMENT_CODE_KEY = 'kiosk_enrollment_code';

function normalizeEnrollmentCode(raw) {
  return String(raw || '').replace(/\D/g, '');
}

async function generateUniqueEnrollmentCode() {
  for (let i = 0; i < 10; i += 1) {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const existing = await dbGet(
      'SELECT org_id FROM org_settings WHERE key = ? AND value = ? LIMIT 1',
      [ENROLLMENT_CODE_KEY, code]
    );
    if (!existing) return code;
  }
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

async function upsertOrgSetting(orgId, key, value) {
  await dbRun(
    `
      INSERT INTO org_settings (org_id, key, value)
      VALUES (?, ?, ?)
      ON CONFLICT(org_id, key) DO UPDATE SET value = excluded.value
    `,
    [orgId, key, value]
  );
}

async function loadOrgSettingValue(orgId, key) {
  if (!orgId || !key) return null;
  const row = await dbGet(
    'SELECT value FROM org_settings WHERE org_id = ? AND key = ?',
    [orgId, key]
  );
  return row ? row.value : null;
}

async function loadOrgSyncStatus(orgId) {
  if (!orgId) {
    return {
      employees: null,
      vendors: null,
      projects: null,
      payroll_accounts: null
    };
  }

  const keys = [
    'qbo_last_sync_employees_at',
    'qbo_last_sync_vendors_at',
    'qbo_last_sync_projects_at',
    'qbo_last_sync_payroll_accounts_at',
    'qbo_last_sync_employee_updates_at'
  ];

  const rows = await dbAll(
    `
      SELECT key, value
      FROM org_settings
      WHERE org_id = ? AND key IN (${keys.map(() => '?').join(',')})
    `,
    [orgId, ...keys]
  );

  const map = Object.create(null);
  (rows || []).forEach(row => {
    map[row.key] = row.value;
  });

  return {
    employees: map.qbo_last_sync_employees_at || null,
    vendors: map.qbo_last_sync_vendors_at || null,
    projects: map.qbo_last_sync_projects_at || null,
    payroll_accounts: map.qbo_last_sync_payroll_accounts_at || null,
    employee_updates: map.qbo_last_sync_employee_updates_at || null
  };
}

async function loadEnrollmentCode(orgId, { createIfMissing = false } = {}) {
  const row = await dbGet(
    'SELECT value FROM org_settings WHERE org_id = ? AND key = ?',
    [orgId, ENROLLMENT_CODE_KEY]
  );
  if (row && row.value) return row.value;
  if (!createIfMissing) return null;
  const code = await generateUniqueEnrollmentCode();
  await upsertOrgSetting(orgId, ENROLLMENT_CODE_KEY, code);
  return code;
}

async function rotateEnrollmentCode(orgId) {
  const code = await generateUniqueEnrollmentCode();
  await upsertOrgSetting(orgId, ENROLLMENT_CODE_KEY, code);
  return code;
}

async function getClockInPhotoRequired(orgId) {
  const row = await dbGet(
    'SELECT value FROM org_settings WHERE org_id = ? AND key = ?',
    [orgId, 'clock_in_photo_required']
  );
  if (!row) return false;
  return String(row.value || '').trim() === '1';
}

function parseBase64Image(raw) {
  if (!raw) return null;
  const str = String(raw);
  const match = str.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
  let ext = 'jpg';
  let payload = str;
  if (match) {
    ext = match[1] === 'jpeg' ? 'jpg' : match[1].toLowerCase();
    payload = match[2];
  }
  try {
    const buffer = Buffer.from(payload, 'base64');
    if (!buffer.length) return null;
    return { buffer, ext };
  } catch {
    return null;
  }
}

async function saveClockInPhoto({ orgId, employeeId, deviceId, photoBase64, punchTime }) {
  const parsed = parseBase64Image(photoBase64);
  if (!parsed) return null;
  const datePart = (punchTime || new Date().toISOString()).slice(0, 10);
  const root = path.join(__dirname, 'secure_uploads', 'clock_in_photos');
  const dir = path.join(root, String(orgId), datePart);
  await fsp.mkdir(dir, { recursive: true });
  const suffix = crypto.randomBytes(4).toString('hex');
  const name = `emp_${employeeId || 'unknown'}_${Date.now()}_${suffix}.${parsed.ext}`;
  const fullPath = path.join(dir, name);
  await fsp.writeFile(fullPath, parsed.buffer);
  const rel = path.relative(path.join(__dirname, 'secure_uploads'), fullPath);
  return rel.replace(/\\\\/g, '/');
}

function getTodayForemanForDeviceAsync(deviceId, employeeId, todayOverride) {
  return new Promise((resolve, reject) => {
    getTodayForemanForDevice(deviceId, employeeId, (err, foremanId) => {
      if (err) return reject(err);
      resolve(foremanId);
    }, todayOverride);
  });
}

function getTodayForemanForDevice(deviceId, employeeIdOrCb, maybeCb, todayOverride) {
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

  const today = todayOverride || getTodayIsoDate();

  const sql = `
    SELECT
      k.id AS kiosk_id,
      k.org_id AS kiosk_org_id,
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
    if (!row || !row.kiosk_id || !row.kiosk_org_id || !employeeId) {
      return cb(null, null);
    }

    // No foreman yet for this kiosk/date: make THIS employee today's foreman.
    const insertSql = `
      INSERT INTO kiosk_foreman_days
        (org_id, kiosk_id, foreman_employee_id, date, set_by_employee_id)
      VALUES (?, ?, ?, ?, ?)
    `;

    db.run(
      insertSql,
      [row.kiosk_org_id, row.kiosk_id, employeeId, today, employeeId],
      function (err2) {
        if (err2) {
          const msg = String(err2.message || '');
          if (msg.includes('UNIQUE constraint failed')) {
            // Another request created the row at the same time.
            // Just re-read whatever is now stored.
            db.get(
              `SELECT foreman_employee_id
               FROM kiosk_foreman_days
               WHERE org_id = ? AND kiosk_id = ? AND date = ?`,
              [row.kiosk_org_id, row.kiosk_id, today],
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
const SERVER_PORT = PORT || 3000;

const BOOTSTRAP_TOKEN_COOKIE = 'bootstrap_token';
const BOOTSTRAP_TOKEN_TTL_MS = 1000 * 60 * 60 * 6;

app.use(express.json({ limit: '10mb' }));

const trustProxyFlag = String(process.env.TRUST_PROXY || '').toLowerCase();
const trustProxyEnabled = trustProxyFlag === 'true' || trustProxyFlag === '1';
if (trustProxyEnabled) {
  app.set('trust proxy', 1);
}

// Session middleware for login state
const sessionStore = createSQLiteStore(session, { dbPath: SESSION_DB_PATH || dbPath });
const activeSessionSecret =
  SESSION_SECRET ||
  crypto.randomBytes(48).toString('hex');

app.use(
  session({
    secret: activeSessionSecret,
    resave: false,
    saveUninitialized: false,
    proxy: trustProxyEnabled,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      sameSite: cookieSameSite,
      secure: cookieSecureFlag
    }
  })
);

function isLocalhostRequest(req) {
  const host = String(req && req.hostname ? req.hostname : '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function isNgrokRequest(req) {
  const host = String(req && req.hostname ? req.hostname : '').toLowerCase();
  return host.endsWith('.ngrok-free.dev') || host.endsWith('.ngrok.io');
}

function applySessionCookieOverrides(req) {
  if (!req || !req.session || !req.session.cookie) return;
  if (isLocalhostRequest(req)) {
    req.session.cookie.secure = false;
    req.session.cookie.sameSite = 'lax';
    return;
  }
  if (isNgrokRequest(req)) {
    req.session.cookie.sameSite = 'lax';
  }
}

function getBootstrapCookieOptions(req) {
  const sameSite =
    req && req.session && req.session.cookie && req.session.cookie.sameSite
      ? req.session.cookie.sameSite
      : cookieSameSite;
  const secure =
    req && req.session && req.session.cookie && typeof req.session.cookie.secure === 'boolean'
      ? req.session.cookie.secure
      : cookieSecureFlag;
  return {
    httpOnly: true,
    sameSite,
    secure,
    path: '/'
  };
}

function signBootstrapToken(userId) {
  const ts = Date.now();
  const payload = `${userId}:${ts}`;
  const sig = crypto
    .createHmac('sha256', activeSessionSecret)
    .update(payload)
    .digest('hex');
  return `${payload}:${sig}`;
}

function parseBootstrapToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split(':');
  if (parts.length !== 3) return null;
  const [userIdRaw, tsRaw, sigRaw] = parts;
  const userId = Number(userIdRaw);
  const ts = Number(tsRaw);
  if (!Number.isFinite(userId) || userId <= 0 || !Number.isFinite(ts) || ts <= 0) {
    return null;
  }
  const payload = `${userIdRaw}:${tsRaw}`;
  const expected = crypto
    .createHmac('sha256', activeSessionSecret)
    .update(payload)
    .digest('hex');
  try {
    const sigBuf = Buffer.from(sigRaw, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  } catch {
    return null;
  }
  if (Date.now() - ts > BOOTSTRAP_TOKEN_TTL_MS) return null;
  return { userId, ts };
}

function setBootstrapTokenCookie(req, res, userId) {
  if (!res || !userId) return;
  const token = signBootstrapToken(userId);
  const options = getBootstrapCookieOptions(req);
  options.maxAge = BOOTSTRAP_TOKEN_TTL_MS;
  res.cookie(BOOTSTRAP_TOKEN_COOKIE, token, options);
}

function clearBootstrapTokenCookie(req, res) {
  if (!res) return;
  const options = getBootstrapCookieOptions(req);
  res.clearCookie(BOOTSTRAP_TOKEN_COOKIE, options);
}

// Allow local HTTP during development even if COOKIE_SECURE is true.
app.use((req, res, next) => {
  applySessionCookieOverrides(req);
  next();
});

app.use(csrfGuard);

// Auth bootstrap status (first-time setup check)
app.get('/api/auth/bootstrap-status', async (req, res) => {
  try {
    const orgRow = await dbGet('SELECT COUNT(*) AS cnt FROM orgs');
    const userRow = await dbGet('SELECT COUNT(*) AS cnt FROM users');
    const orgCount = orgRow ? Number(orgRow.cnt || 0) : 0;
    const userCount = userRow ? Number(userRow.cnt || 0) : 0;
    let bootstrapEmail = null;
    const pendingUserId =
      req.session && req.session.pending_bootstrap_user_id
        ? Number(req.session.pending_bootstrap_user_id)
        : null;
    if (pendingUserId) {
      const pendingUser = await dbGet(
        'SELECT email FROM users WHERE id = ?',
        [pendingUserId]
      );
      if (pendingUser && pendingUser.email) {
        bootstrapEmail = pendingUser.email;
      }
    }
    return res.json({
      bootstrap_required: orgCount === 0,
      bootstrap_account_created: orgCount === 0 && userCount > 0,
      bootstrap_email: bootstrapEmail
    });
  } catch (err) {
    console.error('Bootstrap status error:', err);
    return res.status(500).json({ error: 'Failed to check bootstrap status.' });
  }
});

// Auth page (sign-in + bootstrap + org selection)
app.get('/auth', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'auth.html'));
});

// Admin console (desktop only)
app.get('/', async (req, res) => {
  const sessionUserId = req.session && req.session.userId;
  const sessionOrgId = req.session && req.session.orgId;
  const sessionEmpId = req.session && req.session.employeeId;
  const uiMode = req.session && req.session.ui_mode;
  const pendingBootstrapId =
    req.session && req.session.pending_bootstrap_user_id
      ? Number(req.session.pending_bootstrap_user_id)
      : null;

  if (sessionUserId && pendingBootstrapId && (!sessionOrgId || !sessionEmpId)) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }

  if (!sessionUserId || !sessionOrgId || !sessionEmpId) {
    return res.redirect('/auth');
  }

  try {
    const orgStatus = await getOrgStatus(sessionOrgId);
    if (orgStatus && orgStatus !== 'active') {
      req.session.destroy(() => {});
      return res.redirect('/auth');
    }
    const membership = await dbGet(
      'SELECT login_enabled FROM user_orgs WHERE user_id = ? AND org_id = ?',
      [sessionUserId, sessionOrgId]
    );
    if (!membership || !isTruthyFlag(membership.login_enabled)) {
      req.session.destroy(() => {});
      return res.redirect('/auth');
    }
    const access = await getEmployeeAccessFlags({
      employeeId: sessionEmpId,
      orgId: sessionOrgId
    });
    if (access && access.active && uiMode === 'kiosk') {
      return res.redirect('/kiosk');
    }

    if (access && access.active && access.desktop_access) {
      return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
    if (
      access &&
      access.active &&
      (access.kiosk_admin_access || access.worker_timekeeping)
    ) {
      return res.redirect('/kiosk');
    }
  } catch (err) {
    console.warn('Failed to resolve desktop access:', err.message);
  }

  req.session.destroy(() => {});
  return res.redirect('/auth');
});

// Kiosk admin shell (guarded by session or device auth)
app.get(['/kiosk-admin', '/kiosk-admin.html'], async (req, res) => {
  try {
    if (req.path === '/kiosk-admin.html') {
      const idx = req.originalUrl.indexOf('?');
      const query = idx >= 0 ? req.originalUrl.slice(idx) : '';
      return res.redirect(`/kiosk-admin${query}`);
    }

    const deviceId = ((req.query && req.query.device_id) || '').trim();
    if (!deviceId) {
      return res.redirect('/kiosk');
    }
    const access = await ensureKioskDevice(req);
    if (!access || !access.ok) {
      return res.redirect('/kiosk');
    }
    return res.sendFile(path.join(__dirname, 'public', 'kiosk-admin.html'));
  } catch (err) {
    console.warn('Kiosk admin guard failed:', err.message);
    return res.redirect('/kiosk');
  }
});

// Block legacy public uploads from direct access (serve via auth endpoints only)
app.use((req, res, next) => {
  if (req.path && req.path.startsWith('/uploads/')) {
    return res.status(404).send('Not found');
  }
  return next();
});

// Static assets (CSS, JS, etc.)
app.use(express.static(path.join(__dirname, 'public')));

/* ───────── KIOSK PAGE ───────── */

app.get('/kiosk', (req, res) => {
  // Treat visiting the kiosk page as a fresh state: end any existing session
  if (req.session) {
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.sendFile(path.join(__dirname, 'public', 'kiosk.html'));
    });
    return;
  }
  res.clearCookie('connect.sid');
  res.sendFile(path.join(__dirname, 'public', 'kiosk.html'));
});

/* ───────── AUTH: BOOTSTRAP & LOGIN ───────── */

// Helper to normalize emails
function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

const PASSWORD_SETUP_TTL_HOURS = 72;

function hashPasswordSetupToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function getRequestBaseUrl(req) {
  const protoHeader = req.headers['x-forwarded-proto'];
  const hostHeader = req.headers['x-forwarded-host'];
  const proto = (protoHeader ? String(protoHeader) : req.protocol || 'http').split(',')[0].trim();
  const host = (hostHeader ? String(hostHeader) : req.get('host') || '').split(',')[0].trim();
  if (!host) return '';
  return `${proto}://${host}`;
}

async function issuePasswordSetupToken({ userId, orgId, createdBy }) {
  if (!userId) return null;
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashPasswordSetupToken(rawToken);
  const expiresAt = new Date(Date.now() + PASSWORD_SETUP_TTL_HOURS * 60 * 60 * 1000).toISOString();
  await dbRun(
    `
      UPDATE users
      SET
        password_reset_token_hash = ?,
        password_reset_token_expires_at = ?,
        password_reset_token_used_at = NULL,
        password_reset_token_created_at = datetime('now'),
        password_reset_token_created_by = ?,
        password_reset_org_id = ?
      WHERE id = ?
    `,
    [tokenHash, expiresAt, createdBy || null, orgId || null, userId]
  );
  return { token: rawToken, expiresAt };
}

function isPasswordSetupTokenExpired(expiresAt) {
  if (!expiresAt) return false;
  const ts = Date.parse(expiresAt);
  if (Number.isNaN(ts)) return false;
  return ts < Date.now();
}

const PASSWORD_MIN_LENGTH = 8;
function validatePassword(password) {
  const value = String(password || '');
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  return null;
}

function ensureCsrfToken(req, res) {
  if (!req.session) return null;
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  if (res && req.session.csrfToken) {
    res.setHeader('X-CSRF-Token', req.session.csrfToken);
  }
  return req.session.csrfToken;
}

async function regenerateSession(req) {
  if (!req.session || typeof req.session.regenerate !== 'function') return;
  await new Promise((resolve, reject) => {
    req.session.regenerate(err => (err ? reject(err) : resolve()));
  });
  applySessionCookieOverrides(req);
}

async function saveSession(req) {
  if (!req.session || typeof req.session.save !== 'function') return;
  await new Promise((resolve, reject) => {
    req.session.save(err => (err ? reject(err) : resolve()));
  });
}

function createRateLimiter({ windowMs, max, keyFn }) {
  const hits = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key = typeof keyFn === 'function' ? keyFn(req) : req.ip || 'unknown';
    const entry = hits.get(key);
    if (!entry || now - entry.start >= windowMs) {
      hits.set(key, { start: now, count: 1 });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      const retryAfterSeconds = Math.ceil((entry.start + windowMs - now) / 1000);
      res.setHeader('Retry-After', String(Math.max(retryAfterSeconds, 1)));
      return res.status(429).json({ error: 'Too many requests. Please retry shortly.' });
    }

    return next();
  };
}

async function loadUserOrgs(userId) {
  return dbAll(
    `
      SELECT
        o.id,
        o.name,
        o.timezone,
        o.status,
        uo.employee_id,
        uo.is_super_admin,
        uo.login_enabled,
        e.active AS employee_active,
        e.desktop_access AS employee_desktop_access
      FROM user_orgs uo
      JOIN orgs o ON o.id = uo.org_id
      LEFT JOIN employees e
        ON e.id = uo.employee_id
        AND e.org_id = uo.org_id
      WHERE uo.user_id = ?
      ORDER BY o.name ASC
    `,
    [userId]
  );
}

function isTruthyFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function isActiveFlag(value) {
  if (value == null) return true;
  return isTruthyFlag(value);
}

function isEligibleSuperAdminOrg(org) {
  if (!org) return false;
  if (org.status && org.status !== 'active') return false;
  if (!isTruthyFlag(org.is_super_admin)) return false;
  if (!isTruthyFlag(org.login_enabled)) return false;
  if (!org.employee_id) return false;
  if (!isActiveFlag(org.employee_active)) return false;
  if (!isTruthyFlag(org.employee_desktop_access)) return false;
  return true;
}

function applyRememberCookie(req, remember) {
  if (!req.session) return;
  if (remember) {
    req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30;
    req.session.cookie.expires = new Date(
      Date.now() + req.session.cookie.maxAge
    );
  } else {
    req.session.cookie.maxAge = null;
    req.session.cookie.expires = false;
  }
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = String(forwarded).split(',')[0].trim();
    if (first) return first;
  }
  return req.ip || '';
}

function getKioskDeviceIdForRateLimit(req) {
  const bodyDeviceId = req.body && req.body.device_id;
  const queryDeviceId = req.query && req.query.device_id;
  const headerDeviceId = (req.get('x-kiosk-device-id') || '').trim();
  const cookieDeviceId = getCookieValue(req, 'kiosk_device_id');
  return (
    (bodyDeviceId || queryDeviceId || headerDeviceId || cookieDeviceId || '')
  ).trim();
}

const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyFn: (req) => `${getClientIp(req)}:login`
});

const kioskPinRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 20,
  keyFn: (req) => {
    const deviceId = getKioskDeviceIdForRateLimit(req);
    const adminId =
      (req.body && (req.body.admin_id || req.body.employee_id)) ||
      (req.query && (req.query.admin_id || req.query.employee_id)) ||
      'unknown';
    const keyBase = deviceId || getClientIp(req) || 'unknown';
    return `${keyBase}:${adminId}:kiosk-pin`;
  }
});

const bootstrapRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyFn: (req) => `${getClientIp(req)}:bootstrap`
});

const SESSION_ENC_PREFIX = 'enc:v1:';
const sessionCryptoKey = (() => {
  const raw = SESSION_ENCRYPTION_KEY || SESSION_SECRET;
  if (!raw) return null;
  return crypto.createHash('sha256').update(String(raw)).digest();
})();

function decryptSessionValue(value) {
  if (!value) return null;
  const raw = String(value);
  if (!sessionCryptoKey || !raw.startsWith(SESSION_ENC_PREFIX)) return raw;
  try {
    const body = raw.slice(SESSION_ENC_PREFIX.length);
    const [ivB64, tagB64, dataB64] = body.split(':');
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', sessionCryptoKey, iv);
    decipher.setAuthTag(tag);
    let dec = decipher.update(dataB64, 'base64', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  } catch {
    return null;
  }
}

async function revokeUserSessions({ userId, orgId }) {
  if (!userId) return 0;
  let rows = [];
  try {
    rows = await dbAll('SELECT sid, sess FROM sessions');
  } catch (err) {
    console.warn('Failed to load sessions for revocation:', err.message);
    return 0;
  }

  const sids = [];
  for (const row of rows || []) {
    const raw = decryptSessionValue(row.sess);
    if (!raw) continue;
    let sess;
    try {
      sess = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!sess || Number(sess.userId) !== Number(userId)) continue;
    if (orgId && sess.orgId && Number(sess.orgId) !== Number(orgId)) continue;
    sids.push(row.sid);
  }

  if (!sids.length) return 0;
  for (const sid of sids) {
    await dbRun('DELETE FROM sessions WHERE sid = ?', [sid]);
  }
  return sids.length;
}

async function requireActiveDesktopSession(req) {
  const userId = req.session?.userId;
  const orgId = req.session?.orgId;
  if (!userId || !orgId) {
    return { ok: false, status: 403, error: 'Org access denied.' };
  }

  const orgStatus = await getOrgStatus(orgId);
  if (orgStatus && orgStatus !== 'active') {
    return { ok: false, status: 403, error: 'Org access denied.' };
  }

  const membership = await dbGet(
    'SELECT login_enabled, employee_id FROM user_orgs WHERE user_id = ? AND org_id = ?',
    [userId, orgId]
  );
  if (!membership || !isTruthyFlag(membership.login_enabled)) {
    return { ok: false, status: 403, error: 'Login disabled.' };
  }

  const employeeId = membership.employee_id || req.session?.employeeId;
  if (!employeeId) {
    return { ok: false, status: 403, error: 'Org access denied.' };
  }

  const access = await getEmployeeAccessFlags({ employeeId, orgId });
  if (!access || !access.active || !access.desktop_access) {
    return { ok: false, status: 403, error: 'Org access denied.' };
  }

  req.session.employeeId = employeeId;
  return { ok: true, orgId, employeeId, access };
}

async function requireSuperAdmin(req, res, next) {
  const userId = req.session?.userId;
  const orgId = req.session?.orgId;
  if (!userId || !orgId) {
    return res.status(403).json({ error: 'Super admin access required.' });
  }

  const orgStatus = await getOrgStatus(orgId);
  if (orgStatus && orgStatus !== 'active') {
    return res.status(403).json({ error: 'Org access denied.' });
  }

  const membership = await dbGet(
    'SELECT is_super_admin, login_enabled, employee_id FROM user_orgs WHERE user_id = ? AND org_id = ?',
    [userId, orgId]
  );
  if (!membership || !membership.is_super_admin || !isTruthyFlag(membership.login_enabled)) {
    return res.status(403).json({ error: 'Super admin access required.' });
  }

  const employeeId = membership.employee_id || req.session?.employeeId;
  if (!employeeId) {
    return res.status(403).json({ error: 'Super admin access required.' });
  }
  const access = await getEmployeeAccessFlags({ employeeId, orgId });
  if (!access || !access.active || !access.desktop_access) {
    return res.status(403).json({ error: 'Super admin access required.' });
  }

  req.session.employeeId = employeeId;
  req.session.isSuperAdmin = 1;
  return next();
}

app.post('/api/auth/bootstrap-signup', bootstrapRateLimiter, async (req, res) => {
  const { email, password, password_confirm } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const normEmail = normalizeEmail(email);
  if (!normEmail) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  try {
    const orgRow = await dbGet('SELECT COUNT(*) AS cnt FROM orgs');
    const orgCount = orgRow ? Number(orgRow.cnt || 0) : 0;
    if (orgCount > 0) {
      return res.status(400).json({ error: 'Bootstrap already completed.' });
    }

    const countRow = await dbGet('SELECT COUNT(*) AS cnt FROM users');
    const userCount = countRow ? Number(countRow.cnt || 0) : 0;
    if (userCount > 0) {
      return res.status(400).json({
        error: 'Signup already completed. Please sign in to continue setup.'
      });
    }

    const passwordErr = validatePassword(password);
    if (passwordErr) {
      return res.status(400).json({ error: passwordErr });
    }

    if (password_confirm && password !== password_confirm) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }

    const existing = await dbGet(
      'SELECT id FROM users WHERE LOWER(email) = LOWER(?)',
      [normEmail]
    );
    if (existing) {
      return res.status(409).json({ error: 'Email already in use.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userRes = await dbRun(
      `
        INSERT INTO users (email, password_hash)
        VALUES (?, ?)
      `,
      [normEmail, passwordHash]
    );
    const userId = userRes.lastID;

    if (req.session) {
      try {
        await regenerateSession(req);
      } catch (err) {
        console.error('Session regeneration failed:', err);
        return res.status(500).json({ error: 'Sign up failed.' });
      }
      req.session.userId = userId;
      req.session.orgId = null;
      req.session.employeeId = null;
      req.session.isSuperAdmin = null;
      req.session.pending_bootstrap_user_id = userId;
      applyRememberCookie(req, true);
      ensureCsrfToken(req, res);
      setBootstrapTokenCookie(req, res, userId);
      try {
        await saveSession(req);
      } catch (err) {
        console.error('Session save failed:', err);
        return res.status(500).json({ error: 'Sign up failed.' });
      }
    }

    return res.json({ ok: true, userId, email: normEmail });
  } catch (err) {
    if (String(err.message || '').toLowerCase().includes('unique')) {
      return res.status(409).json({ error: 'Email already in use.' });
    }
    console.error('Bootstrap signup error:', err);
    return res.status(500).json({ error: 'Sign up failed.' });
  }
});

app.post('/api/auth/bootstrap', bootstrapRateLimiter, async (req, res) => {
  const { admin_name, org_name, org_timezone } = req.body || {};

  if (!admin_name || !org_name || !org_timezone) {
    return res.status(400).json({
      error: 'admin_name, org_name, and org_timezone are required.'
    });
  }

  try {
    const orgRow = await dbGet('SELECT COUNT(*) AS cnt FROM orgs');
    const orgCount = orgRow ? Number(orgRow.cnt || 0) : 0;
    if (orgCount > 0) {
      return res.status(400).json({ error: 'Bootstrap already completed.' });
    }

    const orgName = String(org_name).trim();
    const orgTimezone = String(org_timezone).trim();
    const adminName = String(admin_name).trim();

    if (!orgName || !orgTimezone || !adminName) {
      return res.status(400).json({
        error: 'org_name, org_timezone, and admin_name cannot be blank.'
      });
    }

    let pendingUserId = req.session?.pending_bootstrap_user_id;
    if (!pendingUserId && (!req.session || !req.session.userId)) {
      const token = getCookieValue(req, BOOTSTRAP_TOKEN_COOKIE);
      const parsed = parseBootstrapToken(token);
      if (parsed && parsed.userId) {
        pendingUserId = parsed.userId;
        if (req.session) {
          req.session.userId = pendingUserId;
          req.session.pending_bootstrap_user_id = pendingUserId;
        }
      }
    }
    if (!pendingUserId && req.session?.userId && orgCount === 0) {
      pendingUserId = req.session.userId;
      req.session.pending_bootstrap_user_id = pendingUserId;
    }
    if (!pendingUserId) {
      return res.status(403).json({ error: 'Sign up required before org setup.' });
    }

    const pendingUser = await dbGet(
      'SELECT id, email FROM users WHERE id = ?',
      [pendingUserId]
    );
    if (!pendingUser) {
      return res.status(403).json({ error: 'Sign up required before org setup.' });
    }

    const existingMembership = await dbGet(
      'SELECT 1 FROM user_orgs WHERE user_id = ? LIMIT 1',
      [pendingUserId]
    );
    if (existingMembership) {
      return res.status(400).json({ error: 'Account already linked to an organization.' });
    }

    await dbRun('BEGIN');

    const orgRes = await dbRun(
      `
        INSERT INTO orgs (name, timezone)
        VALUES (?, ?)
      `,
      [orgName, orgTimezone]
    );
    const orgId = orgRes.lastID;

    // Safety: ensure a brand-new org never inherits stale QBO tokens/states.
    await dbRun('DELETE FROM qbo_tokens WHERE org_id = ?', [orgId]);
    await dbRun('DELETE FROM qbo_oauth_states WHERE org_id = ?', [orgId]);

    const payrollRules = {
      pay_period_length_days: 7,
      pay_period_start_weekday: 1,
      pay_period_anchor_date: null,
      overtime_enabled: false,
      overtime_daily_threshold_hours: 8,
      overtime_weekly_threshold_hours: 40,
      overtime_multiplier: 1.5,
      double_time_enabled: false,
      double_time_daily_threshold_hours: 12,
      double_time_multiplier: 2.0
    };

    const timeExceptionRules = {
      weekly_hours_threshold: null,
      auto_clockout_daily_max_hours: null,
      auto_clockout_weekly_max_hours: null
    };

    const enrollmentCode = await generateUniqueEnrollmentCode();

    const settings = [
      ['company_name', orgName],
      ['company_email', null],
      ['storage_daily_late_fee_default', null],
      ['storage_container_daily_late_fee_default', null],
      ['clock_in_photo_required', 0],
      [ENROLLMENT_CODE_KEY, enrollmentCode],
      ['payroll_rules', JSON.stringify(payrollRules)],
      ['time_exception_rules', JSON.stringify(timeExceptionRules)],
      ['notifications', JSON.stringify({})],
      ['branding', JSON.stringify({})]
    ];

    for (const [key, value] of settings) {
      await dbRun(
        `
          INSERT INTO org_settings (org_id, key, value)
          VALUES (?, ?, ?)
        `,
        [orgId, key, value]
      );
    }

    const userId = pendingUser.id;
    const userEmail = pendingUser.email;

    const employeeRes = await dbRun(
      `
        INSERT INTO employees (
          org_id,
          name,
          email,
          worker_timekeeping,
          desktop_access,
          kiosk_admin_access,
          active,
          language
        ) VALUES (?, ?, ?, 1, 1, 1, 1, 'en')
      `,
      [orgId, adminName, userEmail]
    );
    const employeeId = employeeRes.lastID;

    const createTemplate = async (template) => {
      const res = await dbRun(
        `
          INSERT INTO permission_templates (
            org_id,
            name,
            role_title,
            access_json,
            permissions_json
          ) VALUES (?, ?, ?, ?, ?)
        `,
        [
          orgId,
          template.name,
          template.role_title || null,
          JSON.stringify(template.access || {}),
          JSON.stringify(template.permissions || {})
        ]
      );
      return res.lastID;
    };

    const superAdminAccess = {
      worker_timekeeping: true,
      desktop_access: true,
      kiosk_admin_access: true
    };
    const superAdminPerms = {
      see_shipments: true,
      modify_time: true,
      approve_time: true,
      view_time_reports: true,
      view_all_timesheets: true,
      assign_timesheets: true,
      view_payroll: true,
      modify_payroll: true,
      modify_pay_rates: true
    };
    const superAdminTemplateId = await createTemplate({
      name: 'Super Admin',
      role_title: 'Super Admin',
      access: superAdminAccess,
      permissions: superAdminPerms
    });

    await createTemplate({
      name: 'Payroll Manager',
      role_title: 'Payroll Manager',
      access: { worker_timekeeping: false, desktop_access: true, kiosk_admin_access: false },
      permissions: {
        see_shipments: true,
        modify_time: true,
        view_time_reports: true,
        view_all_timesheets: true,
        assign_timesheets: true,
        view_payroll: true,
        modify_payroll: true,
        modify_pay_rates: true
      }
    });

    await createTemplate({
      name: 'Payroll Approver',
      role_title: 'Payroll Approver',
      access: { worker_timekeeping: false, desktop_access: true, kiosk_admin_access: false },
      permissions: {
        see_shipments: false,
        modify_time: false,
        view_time_reports: false,
        view_all_timesheets: false,
        assign_timesheets: false,
        view_payroll: true,
        modify_payroll: false,
        modify_pay_rates: false
      }
    });

    await createTemplate({
      name: 'Time Reviewer',
      role_title: 'Time Reviewer',
      access: { worker_timekeeping: false, desktop_access: true, kiosk_admin_access: false },
      permissions: {
        see_shipments: false,
        modify_time: true,
        view_time_reports: true,
        view_all_timesheets: false,
        assign_timesheets: false,
        view_payroll: false,
        modify_payroll: false,
        modify_pay_rates: false
      }
    });

    await createTemplate({
      name: 'Shipments Admin',
      role_title: 'Shipments Admin',
      access: { worker_timekeeping: false, desktop_access: true, kiosk_admin_access: false },
      permissions: {
        see_shipments: true,
        modify_time: false,
        view_time_reports: false,
        view_all_timesheets: false,
        assign_timesheets: false,
        view_payroll: false,
        modify_payroll: false,
        modify_pay_rates: false
      }
    });

    await createTemplate({
      name: 'Kiosk Admin',
      role_title: 'Kiosk Admin',
      access: { worker_timekeeping: true, desktop_access: false, kiosk_admin_access: true },
      permissions: {
        see_shipments: true,
        modify_time: true,
        view_time_reports: true,
        view_all_timesheets: false,
        assign_timesheets: false,
        view_payroll: false,
        modify_payroll: false,
        modify_pay_rates: false
      }
    });

    await dbRun(
      `
        UPDATE employees
        SET permission_template_id = ?, role_title = ?
        WHERE id = ? AND org_id = ?
      `,
      [superAdminTemplateId, 'Super Admin', employeeId, orgId]
    );

    await dbRun(
      `
        INSERT INTO user_orgs (user_id, org_id, employee_id, is_super_admin, login_enabled)
        VALUES (?, ?, ?, 1, 1)
      `,
      [userId, orgId, employeeId]
    );

    await dbRun(
      `
        INSERT INTO employee_permissions (
          employee_id,
          see_shipments,
          modify_time,
          approve_time,
          view_time_reports,
          view_all_timesheets,
          assign_timesheets,
          view_payroll,
          modify_payroll,
          modify_pay_rates
        ) VALUES (?, 1, 1, 1, 1, 1, 1, 1, 1, 1)
      `,
      [employeeId]
    );

    await dbRun('COMMIT');

    await logAuditEvent({
      orgId,
      action: 'org.create',
      entityType: 'org',
      entityId: orgId,
      actorUserId: userId,
      actorEmployeeId: employeeId,
      after: {
        org_id: orgId,
        org_name: orgName,
        timezone: orgTimezone,
        created_by_user_id: userId,
        created_by_employee_id: employeeId
      }
    });

    if (req.session) {
      try {
        await regenerateSession(req);
      } catch (err) {
        console.error('Session regeneration failed:', err);
        return res.status(500).json({ error: 'Bootstrap failed.' });
      }
      req.session.userId = userId;
      req.session.orgId = orgId;
      req.session.employeeId = employeeId;
      req.session.isSuperAdmin = 1;
      req.session.pending_bootstrap_user_id = null;
      req.session.just_bootstrapped = true;
      applyRememberCookie(req, true);
      ensureCsrfToken(req, res);
      clearBootstrapTokenCookie(req, res);
      try {
        await saveSession(req);
      } catch (err) {
        console.error('Session save failed:', err);
        return res.status(500).json({ error: 'Bootstrap failed.' });
      }
    }

    return res.json({
      ok: true,
      userId,
      orgId,
      employeeId,
      is_super_admin: true
    });
  } catch (err) {
    try {
      await dbRun('ROLLBACK');
    } catch (rollbackErr) {
      console.warn('Bootstrap rollback failed:', rollbackErr.message);
    }
    console.error('Bootstrap error:', err);
    return res.status(500).json({ error: 'Bootstrap failed.' });
  }
});

app.get('/api/auth/password-setup', async (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!token) {
    return res.status(400).json({ error: 'Token is required.' });
  }

  try {
    const tokenHash = hashPasswordSetupToken(token);
    const user = await dbGet(
      `
        SELECT
          id,
          email,
          password_reset_token_expires_at AS expires_at,
          password_reset_token_used_at AS used_at
        FROM users
        WHERE password_reset_token_hash = ?
      `,
      [tokenHash]
    );

    if (!user) {
      return res.status(404).json({ error: 'Setup link is invalid or expired.' });
    }
    if (user.used_at) {
      return res.status(410).json({ error: 'Setup link has already been used.' });
    }
    if (isPasswordSetupTokenExpired(user.expires_at)) {
      return res.status(410).json({ error: 'Setup link has expired.' });
    }

    return res.json({ ok: true, email: user.email });
  } catch (err) {
    console.error('Password setup validation error:', err);
    return res.status(500).json({ error: 'Failed to validate setup link.' });
  }
});

app.post('/api/auth/password-setup', async (req, res) => {
  const { token, password, password_confirm } = req.body || {};
  const rawToken = String(token || '').trim();
  const nextPassword = String(password || '');
  const confirmPassword = String(password_confirm || '');

  if (!rawToken) {
    return res.status(400).json({ error: 'Token is required.' });
  }
  if (!nextPassword || !confirmPassword) {
    return res.status(400).json({ error: 'Password and confirmation are required.' });
  }
  if (nextPassword !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }
  const passwordErr = validatePassword(nextPassword);
  if (passwordErr) {
    return res.status(400).json({ error: passwordErr });
  }

  try {
    const tokenHash = hashPasswordSetupToken(rawToken);
    const user = await dbGet(
      `
        SELECT
          id,
          email,
          password_reset_token_expires_at AS expires_at,
          password_reset_token_used_at AS used_at,
          password_reset_org_id AS org_id
        FROM users
        WHERE password_reset_token_hash = ?
      `,
      [tokenHash]
    );

    if (!user) {
      return res.status(404).json({ error: 'Setup link is invalid or expired.' });
    }
    if (user.used_at) {
      return res.status(410).json({ error: 'Setup link has already been used.' });
    }
    if (isPasswordSetupTokenExpired(user.expires_at)) {
      return res.status(410).json({ error: 'Setup link has expired.' });
    }

    const hash = await bcrypt.hash(nextPassword, 10);
    await dbRun(
      `
        UPDATE users
        SET
          password_hash = ?,
          password_reset_token_used_at = datetime('now'),
          password_reset_token_hash = NULL,
          password_reset_token_expires_at = NULL,
          password_reset_token_created_at = NULL,
          password_reset_token_created_by = NULL,
          password_reset_org_id = NULL
        WHERE id = ?
      `,
      [hash, user.id]
    );

    await logAuditEvent({
      orgId: user.org_id || null,
      action: 'user.password.setup',
      entityType: 'user',
      entityId: user.id,
      note: 'Password set via setup link.'
    });

    return res.json({ ok: true, email: user.email });
  } catch (err) {
    console.error('Password setup error:', err);
    return res.status(500).json({ error: 'Failed to set password.' });
  }
});

app.post('/api/auth/login', loginRateLimiter, async (req, res) => {
  const { email, password, remember } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const normEmail = normalizeEmail(email);

  try {
    const user = await dbGet(
      `
        SELECT id, email, password_hash
        FROM users
        WHERE LOWER(email) = LOWER(?)
      `,
      [normEmail]
    );

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const orgs = await loadUserOrgs(user.id);
    if (!orgs || orgs.length === 0) {
      const orgRow = await dbGet('SELECT COUNT(*) AS cnt FROM orgs');
      const orgCount = orgRow ? Number(orgRow.cnt || 0) : 0;
      if (orgCount === 0) {
        if (req.session) {
          try {
            await regenerateSession(req);
          } catch (err) {
            console.error('Session regeneration failed:', err);
            return res.status(500).json({ error: 'Login failed.' });
          }
          req.session.userId = user.id;
          req.session.orgId = null;
          req.session.employeeId = null;
          req.session.isSuperAdmin = null;
          req.session.pending_bootstrap_user_id = user.id;
          applyRememberCookie(req, remember);
          ensureCsrfToken(req, res);
          setBootstrapTokenCookie(req, res, user.id);
          try {
            await saveSession(req);
          } catch (err) {
            console.error('Session save failed:', err);
            return res.status(500).json({ error: 'Login failed.' });
          }
        }
        return res.json({
          ok: true,
          userId: user.id,
          requires_org_setup: true,
          email: user.email
        });
      }
    }

    const activeOrgs = (orgs || []).filter(isEligibleSuperAdminOrg);
    if (!activeOrgs.length) {
      return res.status(403).json({
        error: 'No active desktop super admin membership found.'
      });
    }

    if (req.session) {
      try {
        await regenerateSession(req);
      } catch (err) {
        console.error('Session regeneration failed:', err);
        return res.status(500).json({ error: 'Login failed.' });
      }
      req.session.userId = user.id;
      req.session.orgId = null;
      req.session.employeeId = null;
      req.session.isSuperAdmin = null;
      req.session.pending_bootstrap_user_id = null;
      applyRememberCookie(req, remember);
      clearBootstrapTokenCookie(req, res);
      try {
        await saveSession(req);
      } catch (err) {
        console.error('Session save failed:', err);
        return res.status(500).json({ error: 'Login failed.' });
      }
    }

    if (activeOrgs.length > 1) {
      ensureCsrfToken(req, res);
      return res.json({
        ok: true,
        userId: user.id,
        orgs: activeOrgs.map(org => ({
          id: org.id,
          name: org.name,
          timezone: org.timezone
        })),
        requires_org_selection: true
      });
    }

    const membership = activeOrgs[0];
    if (req.session) {
      req.session.orgId = membership.id;
      req.session.employeeId = membership.employee_id || null;
      req.session.isSuperAdmin = membership.is_super_admin ? 1 : 0;
      ensureCsrfToken(req, res);
    }

    return res.json({
      ok: true,
      userId: user.id,
      orgId: membership.id,
      employeeId: membership.employee_id || null
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed.' });
  }
});

app.get('/api/auth/orgs', requireAuth, async (req, res) => {
  try {
    const orgs = await loadUserOrgs(req.session.userId);
    const activeOrgs = (orgs || []).filter(isEligibleSuperAdminOrg);
    return res.json({
      ok: true,
      orgs: activeOrgs.map(org => ({
        id: org.id,
        name: org.name,
        timezone: org.timezone
      }))
    });
  } catch (err) {
    console.error('auth/orgs error:', err);
    return res.status(500).json({ error: 'Failed to load orgs.' });
  }
});

app.post('/api/auth/select-org', requireAuth, async (req, res) => {
  const { org_id } = req.body || {};
  const orgId = Number(org_id);
  if (!orgId) {
    return res.status(400).json({ error: 'org_id is required.' });
  }

  try {
    const membership = await dbGet(
      `
        SELECT
          uo.org_id,
          uo.employee_id,
          uo.is_super_admin,
          uo.login_enabled,
          o.status,
          e.active AS employee_active,
          e.desktop_access AS employee_desktop_access
        FROM user_orgs uo
        JOIN orgs o ON o.id = uo.org_id
        LEFT JOIN employees e
          ON e.id = uo.employee_id
          AND e.org_id = uo.org_id
        WHERE uo.user_id = ? AND uo.org_id = ?
      `,
      [req.session.userId, orgId]
    );

    if (!membership) {
      return res.status(403).json({ error: 'Org access denied.' });
    }
    if (membership.status && membership.status !== 'active') {
      return res.status(403).json({ error: 'Org access denied.' });
    }
    if (!membership.is_super_admin || !isTruthyFlag(membership.login_enabled)) {
      return res.status(403).json({ error: 'Org access denied.' });
    }
    if (
      !membership.employee_id ||
      !isActiveFlag(membership.employee_active) ||
      !isTruthyFlag(membership.employee_desktop_access)
    ) {
      return res.status(403).json({ error: 'Org access denied.' });
    }

    const existingUserId = req.session.userId;
    const existingUiMode = req.session.ui_mode || null;
    const rememberMaxAge = req.session.cookie ? req.session.cookie.maxAge : null;

    try {
      await regenerateSession(req);
    } catch (err) {
      console.error('Session regeneration failed:', err);
      return res.status(500).json({ error: 'Failed to select org.' });
    }

    req.session.userId = existingUserId;
    req.session.orgId = membership.org_id;
    req.session.employeeId = membership.employee_id || null;
    req.session.isSuperAdmin = membership.is_super_admin ? 1 : 0;
    if (existingUiMode) {
      req.session.ui_mode = existingUiMode;
    }
    if (rememberMaxAge) {
      req.session.cookie.maxAge = rememberMaxAge;
      req.session.cookie.expires = new Date(Date.now() + rememberMaxAge);
    } else {
      req.session.cookie.maxAge = null;
      req.session.cookie.expires = false;
    }
    ensureCsrfToken(req, res);

    await logAuditEvent({
      req,
      orgId: membership.org_id,
      action: 'auth.login.success',
      entityType: 'user',
      entityId: existingUserId,
      after: {
        org_id: membership.org_id,
        employee_id: membership.employee_id || null
      }
    });

    return res.json({
      ok: true,
      orgId: membership.org_id,
      employeeId: membership.employee_id || null
    });
  } catch (err) {
    console.error('select-org error:', err);
    return res.status(500).json({ error: 'Failed to select org.' });
  }
});

app.post('/api/auth/ui-mode', requireAuth, async (req, res) => {
  const rawMode = String(req.body?.mode || '').trim().toLowerCase();
  const mode = rawMode === 'kiosk' ? 'kiosk' : rawMode === 'desktop' ? 'desktop' : null;
  if (!mode) {
    return res.status(400).json({ error: 'mode must be kiosk or desktop.' });
  }
  try {
    const status = await requireActiveDesktopSession(req);
    if (!status.ok) {
      if (req.session) {
        req.session.destroy(() => {});
      }
      return res.status(status.status || 403).json({ error: status.error });
    }
  } catch (err) {
    console.error('ui-mode auth error:', err);
    return res.status(500).json({ error: 'Failed to update UI mode.' });
  }
  if (req.session) {
    req.session.ui_mode = mode;
  }
  return res.json({ ok: true, mode });
});

app.post('/api/auth/logout', (req, res) => {
  if (req.session) {
    const orgId = req.session.orgId || null;
    const userId = req.session.userId || null;
    const employeeId = req.session.employeeId || null;
    void logAuditEvent({
      orgId,
      action: 'auth.logout',
      entityType: 'user',
      entityId: userId,
      actorUserId: userId,
      actorEmployeeId: employeeId
    });
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

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const orgId = req.session.orgId;

  try {
    const user = await dbGet('SELECT id, email FROM users WHERE id = ?', [
      userId
    ]);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found.' });
    }

    if (!orgId) {
      const pendingUserId = req.session?.pending_bootstrap_user_id;
      if (pendingUserId && Number(pendingUserId) === Number(userId)) {
        return res.json({
          ok: true,
          user: { id: user.id, email: user.email },
          pending_bootstrap: true,
          ui_mode: req.session && req.session.ui_mode ? req.session.ui_mode : 'desktop'
        });
      }

      const orgs = await loadUserOrgs(userId);
      const eligibleOrgs = (orgs || []).filter(isEligibleSuperAdminOrg);
      if (!eligibleOrgs.length) {
        if (req.session) {
          req.session.destroy(() => {});
        }
        return res.status(403).json({
          ok: false,
          error: 'No active desktop super admin membership found.'
        });
      }
      return res.status(409).json({
        ok: false,
        requires_org_selection: true,
        orgs: eligibleOrgs.map(org => ({
          id: org.id,
          name: org.name,
          timezone: org.timezone
        }))
      });
    }

    const org = await dbGet('SELECT id, name, timezone, status, created_at FROM orgs WHERE id = ?', [
      orgId
    ]);
    if (org && org.status && org.status !== 'active') {
      if (req.session) {
        req.session.destroy(() => {});
      }
      return res.status(403).json({ ok: false, error: 'Org access denied.' });
    }
    const membership = await dbGet(
      `
        SELECT is_super_admin, login_enabled, employee_id
        FROM user_orgs
        WHERE user_id = ? AND org_id = ?
      `,
      [userId, orgId]
    );
    if (
      !membership ||
      !membership.is_super_admin ||
      !isTruthyFlag(membership.login_enabled) ||
      !membership.employee_id
    ) {
      if (req.session) {
        req.session.destroy(() => {});
      }
      return res.status(403).json({ ok: false, error: 'Org access denied.' });
    }

    const employeeId = membership?.employee_id || null;
    let employee = null;
    if (employeeId) {
      employee = await dbGet(
        `
          SELECT id, name, desktop_access, kiosk_admin_access, worker_timekeeping, IFNULL(active, 1) AS active
          FROM employees
          WHERE id = ? AND org_id = ?
        `,
        [employeeId, orgId]
      );
    }
    if (!employee || !employee.desktop_access || !employee.active) {
      if (req.session) {
        req.session.destroy(() => {});
      }
      return res.status(403).json({ ok: false, error: 'Org access denied.' });
    }

    const permissions = employeeId
      ? await getAdminAccessPerms({ employeeId, orgId })
      : null;

    req.session.employeeId = employeeId;
    req.session.isSuperAdmin = membership?.is_super_admin ? 1 : 0;
    const justBootstrapped = !!(req.session && req.session.just_bootstrapped);
    if (req.session && req.session.just_bootstrapped) {
      req.session.just_bootstrapped = null;
    }

    return res.json({
      ok: true,
      user: { id: user.id, email: user.email },
      org: org
        ? {
            id: org.id,
            name: org.name,
            timezone: org.timezone,
            created_at: org.created_at || null
          }
        : null,
      membership: membership
        ? {
            is_super_admin: !!membership.is_super_admin,
            login_enabled: isTruthyFlag(membership.login_enabled)
          }
        : null,
      employee: employee
        ? {
            id: employee.id,
            name: employee.name,
            desktop_access: !!employee.desktop_access,
            kiosk_admin_access: !!employee.kiosk_admin_access,
            worker_timekeeping: !!employee.worker_timekeeping
          }
        : null,
      permissions,
      just_bootstrapped: justBootstrapped,
      ui_mode: req.session && req.session.ui_mode ? req.session.ui_mode : 'desktop'
    });
  } catch (err) {
    console.error('auth/me error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to load current user.' });
  }
});

app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body || {};

  if (!current_password || !new_password) {
    return res
      .status(400)
      .json({ error: 'Current password and new password are required.' });
  }
  const passwordErr = validatePassword(new_password);
  if (passwordErr) {
    return res.status(400).json({ error: passwordErr });
  }

  try {
    const status = await requireActiveDesktopSession(req);
    if (!status.ok) {
      if (req.session) {
        req.session.destroy(() => {});
      }
      return res.status(status.status || 403).json({ error: status.error });
    }

    const user = await dbGet(
      'SELECT id, password_hash FROM users WHERE id = ?',
      [req.session.userId]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const matches = await bcrypt.compare(current_password, user.password_hash);
    if (!matches) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    const newHash = await bcrypt.hash(new_password, 10);
    await dbRun(
      `
        UPDATE users
        SET
          password_hash = ?,
          password_reset_token_hash = NULL,
          password_reset_token_expires_at = NULL,
          password_reset_token_used_at = NULL,
          password_reset_token_created_at = NULL,
          password_reset_token_created_by = NULL,
          password_reset_org_id = NULL
        WHERE id = ?
      `,
      [newHash, user.id]
    );

    await logAuditEvent({
      req,
      orgId: req.session.orgId,
      action: 'auth.password.change',
      entityType: 'user',
      entityId: user.id
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ error: 'Failed to update password.' });
  }
});

app.post('/api/auth/change-email', requireAuth, async (req, res) => {
  const { current_password, new_email } = req.body || {};

  if (!current_password || !new_email) {
    return res
      .status(400)
      .json({ error: 'Current password and new email are required.' });
  }

  const normEmail = normalizeEmail(new_email);
  if (!normEmail) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  try {
    const status = await requireActiveDesktopSession(req);
    if (!status.ok) {
      if (req.session) {
        req.session.destroy(() => {});
      }
      return res.status(status.status || 403).json({ error: status.error || 'Access denied.' });
    }

    const userId = req.session.userId;
    const user = await dbGet('SELECT id, email, password_hash FROM users WHERE id = ?', [
      userId
    ]);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const matches = await bcrypt.compare(current_password, user.password_hash);
    if (!matches) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    if (normalizeEmail(user.email) === normEmail) {
      return res.json({ ok: true, email: user.email });
    }

    const existing = await dbGet(
      'SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id <> ?',
      [normEmail, userId]
    );
    if (existing) {
      return res.status(409).json({ error: 'Email already in use.' });
    }

    await dbRun('UPDATE users SET email = ? WHERE id = ?', [normEmail, userId]);
    await logAuditEvent({
      req,
      orgId: req.session.orgId,
      action: 'auth.email.change',
      entityType: 'user',
      entityId: userId,
      before: { email: user.email },
      after: { email: normEmail }
    });
    return res.json({ ok: true, email: normEmail });
  } catch (err) {
    console.error('Change email error:', err);
    return res.status(500).json({ error: 'Failed to update email.' });
  }
});

app.get('/api/auth/users', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const orgId = req.session.orgId;
    const rows = await dbAll(
      `
        SELECT
          u.id AS user_id,
          u.email,
          uo.employee_id,
          uo.is_super_admin,
          uo.login_enabled,
          CASE
            WHEN u.password_reset_token_hash IS NOT NULL
              AND u.password_reset_token_used_at IS NULL
              AND (
                u.password_reset_token_expires_at IS NULL
                OR u.password_reset_token_expires_at > datetime('now')
              )
            THEN 1
            ELSE 0
          END AS password_setup_pending,
          e.name AS employee_name,
          IFNULL(e.active, 1) AS employee_active,
          IFNULL(e.desktop_access, 0) AS desktop_access
        FROM user_orgs uo
        JOIN users u ON u.id = uo.user_id
        LEFT JOIN employees e ON e.id = uo.employee_id
        WHERE uo.org_id = ?
        ORDER BY u.email COLLATE NOCASE
      `,
      [orgId]
    );
    res.json({ ok: true, users: rows || [] });
  } catch (err) {
    console.error('Load users error:', err);
    res.status(500).json({ error: 'Failed to load users.' });
  }
});

app.post('/api/auth/users/:id/reset-password', requireAuth, requireSuperAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const { new_password } = req.body || {};

  if (!userId) {
    return res.status(400).json({ error: 'User id is required.' });
  }
  const passwordErr = validatePassword(new_password);
  if (passwordErr) {
    return res.status(400).json({ error: passwordErr });
  }

  try {
    const orgId = req.session.orgId;
    const membership = await dbGet(
      `
        SELECT id
        FROM user_orgs
        WHERE user_id = ? AND org_id = ?
      `,
      [userId, orgId]
    );
    if (!membership) {
      return res.status(404).json({ error: 'User not found in this org.' });
    }

    const hash = await bcrypt.hash(String(new_password), 10);
    await dbRun(
      `
        UPDATE users
        SET
          password_hash = ?,
          password_reset_token_hash = NULL,
          password_reset_token_expires_at = NULL,
          password_reset_token_used_at = NULL,
          password_reset_token_created_at = NULL,
          password_reset_token_created_by = NULL,
          password_reset_org_id = NULL
        WHERE id = ?
      `,
      [hash, userId]
    );

    const revoked = await revokeUserSessions({ userId });
    await logAuditEvent({
      req,
      orgId,
      action: 'user.password.reset',
      entityType: 'user',
      entityId: userId
    });
    return res.json({ ok: true, revoked_sessions: revoked });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ error: 'Failed to reset password.' });
  }
});

app.post('/api/auth/users/:id/disable', requireAuth, requireSuperAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  if (!userId) {
    return res.status(400).json({ error: 'User id is required.' });
  }

  try {
    const orgId = req.session.orgId;
    const membership = await dbGet(
      `
        SELECT id, is_super_admin, login_enabled
        FROM user_orgs
        WHERE user_id = ? AND org_id = ?
      `,
      [userId, orgId]
    );
    if (!membership) {
      return res.status(404).json({ error: 'User not found in this org.' });
    }

    if (membership.is_super_admin && isTruthyFlag(membership.login_enabled)) {
      const countRow = await dbGet(
        `
          SELECT COUNT(*) AS cnt
          FROM user_orgs
          WHERE org_id = ? AND is_super_admin = 1 AND login_enabled = 1
        `,
        [orgId]
      );
      const count = countRow ? Number(countRow.cnt || 0) : 0;
      if (count <= 1) {
        return res.status(409).json({
          error: 'Cannot disable the last super admin login for this org.'
        });
      }
    }

    await dbRun('BEGIN');
    await dbRun(
      `
        UPDATE user_orgs
        SET login_enabled = 0
        WHERE id = ?
      `,
      [membership.id]
    );
    const revoked = await revokeUserSessions({ userId, orgId });
    await dbRun('COMMIT');

    await logAuditEvent({
      req,
      orgId,
      action: 'user.login.disable',
      entityType: 'user',
      entityId: userId,
      note: 'Login disabled for org.'
    });

    return res.json({ ok: true, revoked_sessions: revoked });
  } catch (err) {
    try {
      await dbRun('ROLLBACK');
    } catch (rollbackErr) {
      console.warn('Disable login rollback failed:', rollbackErr.message);
    }
    console.error('Disable user login error:', err);
    return res.status(500).json({ error: 'Failed to disable login.' });
  }
});

app.post('/api/auth/users/:id/enable', requireAuth, requireSuperAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  if (!userId) {
    return res.status(400).json({ error: 'User id is required.' });
  }

  try {
    const orgId = req.session.orgId;
    const membership = await dbGet(
      `
        SELECT id, employee_id, is_super_admin, login_enabled
        FROM user_orgs
        WHERE user_id = ? AND org_id = ?
      `,
      [userId, orgId]
    );
    if (!membership) {
      return res.status(404).json({ error: 'User not found in this org.' });
    }

    if (!membership.employee_id) {
      return res.status(400).json({ error: 'Employee link required to enable login.' });
    }

    const employee = await dbGet(
      `
        SELECT id, IFNULL(active, 1) AS active, IFNULL(desktop_access, 0) AS desktop_access
        FROM employees
        WHERE id = ? AND org_id = ?
      `,
      [membership.employee_id, orgId]
    );
    if (!employee || !employee.active || !employee.desktop_access) {
      return res.status(400).json({
        error: 'Employee must be active with desktop access to enable login.'
      });
    }

    const updateFields = ['login_enabled = 1'];
    if (!membership.is_super_admin) {
      updateFields.push('is_super_admin = 1');
    }

    await dbRun(
      `
        UPDATE user_orgs
        SET ${updateFields.join(', ')}
        WHERE id = ?
      `,
      [membership.id]
    );

    if (membership.employee_id) {
      await ensureSuperAdminPerms({ orgId, employeeId: membership.employee_id });
    }

    await logAuditEvent({
      req,
      orgId,
      action: 'user.login.enable',
      entityType: 'user',
      entityId: userId,
      note: 'Login enabled for org.'
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('Enable user login error:', err);
    return res.status(500).json({ error: 'Failed to enable login.' });
  }
});

app.post('/api/auth/users', requireAuth, requireSuperAdmin, async (req, res) => {
  const { email, password, employee_id, send_invite } = req.body || {};

  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  const orgId = req.session.orgId;
  const normEmail = normalizeEmail(email);
  const employeeId = employee_id ? Number(employee_id) : null;
  const wantsInvite = !!send_invite && !password;
  const passwordErr = password ? validatePassword(password) : null;
  if (passwordErr) {
    return res.status(400).json({ error: passwordErr });
  }

  try {
    if (wantsInvite && (!smtpConfigured || !mailFromAddress)) {
      return res.status(400).json({
        error: 'Email is not configured. Set a password instead.'
      });
    }

    if (!employeeId) {
      return res.status(400).json({ error: 'employee_id is required.' });
    }

    const employee = await dbGet(
      `
        SELECT id, IFNULL(active, 1) AS active, IFNULL(desktop_access, 0) AS desktop_access
        FROM employees
        WHERE id = ? AND org_id = ?
      `,
      [employeeId, orgId]
    );
    if (!employee || !employee.active || !employee.desktop_access) {
      return res.status(400).json({
        error: 'Employee must be active with desktop access to create a login.'
      });
    }

    let user = await dbGet('SELECT id, email FROM users WHERE LOWER(email) = LOWER(?)', [
      normEmail
    ]);
    let createdUser = false;
    if (!user) {
      if (!password && !wantsInvite) {
        return res
          .status(400)
          .json({ error: 'Password is required for new users.' });
      }
      const nextPassword = password || crypto.randomBytes(24).toString('hex');
      const hash = await bcrypt.hash(nextPassword, 10);
      const userRes = await dbRun(
        'INSERT INTO users (email, password_hash) VALUES (?, ?)',
        [normEmail, hash]
      );
      user = { id: userRes.lastID, email: normEmail };
      createdUser = true;
    } else if (password) {
      const hash = await bcrypt.hash(password, 10);
      await dbRun(
        `
          UPDATE users
          SET
            password_hash = ?,
            password_reset_token_hash = NULL,
            password_reset_token_expires_at = NULL,
            password_reset_token_used_at = NULL,
            password_reset_token_created_at = NULL,
            password_reset_token_created_by = NULL,
            password_reset_org_id = NULL
          WHERE id = ?
        `,
        [hash, user.id]
      );
    }

    const existingForEmployee = await dbGet(
      `
        SELECT user_id
        FROM user_orgs
        WHERE org_id = ? AND employee_id = ?
      `,
      [orgId, employeeId]
    );
    if (existingForEmployee && existingForEmployee.user_id !== user.id) {
      return res
        .status(409)
        .json({ error: 'This employee is already linked to another user.' });
    }

    const existingMembership = await dbGet(
      `
        SELECT id
        FROM user_orgs
        WHERE user_id = ? AND org_id = ?
      `,
      [user.id, orgId]
    );

    if (existingMembership) {
      const updateFields = ['is_super_admin = ?', 'login_enabled = ?'];
      const updateValues = [1, 1];
      updateFields.push('employee_id = ?');
      updateValues.push(employeeId);

      updateValues.push(existingMembership.id);

      await dbRun(
        `
          UPDATE user_orgs
          SET ${updateFields.join(', ')}
          WHERE id = ?
        `,
        updateValues
      );
    } else {
      await dbRun(
        `
          INSERT INTO user_orgs (user_id, org_id, employee_id, is_super_admin, login_enabled)
          VALUES (?, ?, ?, ?, ?)
        `,
        [user.id, orgId, employeeId, 1, 1]
      );
    }

    await ensureSuperAdminPerms({ orgId, employeeId });

    await logAuditEvent({
      req,
      orgId,
      action: 'user.create',
      entityType: 'user',
      entityId: user.id,
      after: {
        user_id: user.id,
        org_id: orgId,
        employee_id: employeeId,
        login_enabled: 1
      }
    });

    let inviteResult = null;
    if (wantsInvite) {
      try {
        const tokenInfo = await issuePasswordSetupToken({
          userId: user.id,
          orgId,
          createdBy: req.session?.userId
        });
        if (!tokenInfo) {
          throw new Error('Failed to create setup link.');
        }
        const orgRow = await dbGet('SELECT name FROM orgs WHERE id = ?', [orgId]);
        const orgName = orgRow?.name || 'your organization';
        const baseUrl = getRequestBaseUrl(req);
        const setupUrl = baseUrl ? `${baseUrl}/auth?setup=${tokenInfo.token}` : '';
        const title = `${orgName} admin login setup`;
        const bodyLines = [
          `You have been invited to ${orgName} as an admin.`,
          '',
          setupUrl
            ? `Set your password using this link: ${setupUrl}`
            : 'Open the Avian sign-in page and use your setup link to set a password.',
          '',
          `This link expires in ${PASSWORD_SETUP_TTL_HOURS} hours.`
        ];
        inviteResult = await sendEmailNotification({
          userEmail: normEmail,
          title,
          body: bodyLines.join('\n')
        });
        if (inviteResult?.status !== 'sent') {
          throw new Error(inviteResult?.error || 'Email send failed.');
        }
        await logAuditEvent({
          req,
          orgId,
          action: createdUser ? 'user.invite.sent' : 'user.invite.resent',
          entityType: 'user',
          entityId: user.id,
          note: inviteResult?.status === 'sent' ? 'Setup link sent.' : inviteResult?.error || ''
        });
      } catch (inviteErr) {
        console.error('Invite send error:', inviteErr);
        await dbRun(
          `
            UPDATE users
            SET
              password_reset_token_hash = NULL,
              password_reset_token_expires_at = NULL,
              password_reset_token_used_at = NULL,
              password_reset_token_created_at = NULL,
              password_reset_token_created_by = NULL,
              password_reset_org_id = NULL
            WHERE id = ?
          `,
          [user.id]
        );
        return res.status(500).json({ error: 'Failed to send setup link.' });
      }
    }

    return res.json({ ok: true, userId: user.id, invite: inviteResult });
  } catch (err) {
    console.error('Create user error:', err);
    return res.status(500).json({ error: 'Failed to create user.' });
  }
});


/* ───────── 3. QUICKBOOKS STATUS & AUTH ───────── */

app.get('/api/status', requireAdminAccess(p => p.view_payroll), async (req, res) => {
  try {
    const orgId = req.session && req.session.orgId;
    const token = await getAccessToken(orgId);
    const realmId = await getRealmId(orgId);
    const qbConnected = !!token && !!realmId;
    const lastSync = await loadOrgSyncStatus(orgId);
    res.json({
      qbConnected,
      qbRealmId: realmId || null,
      lastSync
    });
  } catch (err) {
    console.error('Status error:', err.message);
    res.json({
      qbConnected: false,
      qbRealmId: null,
      lastSync: {
        employees: null,
        vendors: null,
        projects: null,
        payroll_accounts: null
      }
    });
  }
});

app.post('/api/qbo/connect', requireAdminAccess(p => p.view_payroll), requireSuperAdmin, async (req, res) => {
  try {
    const orgId = req.session && req.session.orgId;
    const userId = req.session && req.session.userId;
    if (!orgId || !userId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    if (!requireQboConfig(res, { expose: true })) {
      return;
    }
    const state = await createQboOAuthState({ orgId, userId });
    const url = getAuthUrl(state);
    return res.json({ ok: true, url });
  } catch (err) {
    console.error('QuickBooks auth error:', err.message || err);
    return res.status(500).json({ error: 'Failed to start QuickBooks auth.' });
  }
});

app.get('/auth/qbo', requireAdminAccess(p => p.view_payroll), requireSuperAdmin, async (req, res) => {
  return res.status(405).json({ error: 'Use POST /api/qbo/connect to start QuickBooks auth.' });
});

// QuickBooks OAuth callback
app.get('/quickbooks/oauth/callback', async (req, res) => {
  const { code, realmId, state, error } = req.query;

  if (error === 'access_denied') {
    return res.status(400).send('QuickBooks access was denied.');
  }

  if (!requireQboConfig(res)) {
    return;
  }

  if (!code || !state) {
    return res.status(400).send('Missing OAuth code or state.');
  }

  try {
    const stateRow = await consumeQboOAuthState(String(state));
    if (!stateRow) {
      return res.status(400).send('OAuth state is invalid or expired.');
    }
    if (!realmId) {
      return res.status(400).send('Missing realmId in callback URL.');
    }

    await exchangeCodeForTokens(code, {
      orgId: stateRow.org_id,
      realmId: String(realmId)
    });

    // Restore session from the OAuth state so strict SameSite cookies don't log the user out.
    let membership = null;
    if (req.session) {
      try {
        membership = await dbGet(
          'SELECT employee_id, is_super_admin FROM user_orgs WHERE user_id = ? AND org_id = ?',
          [stateRow.user_id, stateRow.org_id]
        );
        req.session.userId = stateRow.user_id;
        req.session.orgId = stateRow.org_id;
        req.session.employeeId = membership ? membership.employee_id : null;
        req.session.isSuperAdmin = membership && membership.is_super_admin ? 1 : 0;
        req.session.pending_bootstrap_user_id = null;
        applyRememberCookie(req, false);
        ensureCsrfToken(req, res);
        await saveSession(req);
      } catch (err) {
        console.warn('Failed to restore session after QBO auth:', err);
      }
    }

    await logAuditEvent({
      orgId: stateRow.org_id,
      action: 'qbo.connect',
      entityType: 'org',
      entityId: stateRow.org_id,
      actorUserId: stateRow.user_id,
      actorEmployeeId: membership ? membership.employee_id : null,
      note: 'QuickBooks connected.'
    });

    // Figure out base URL from redirect URI
    const redirectUri = QBO_REDIRECT_URI || '';
    const baseUrl = redirectUri.replace('/quickbooks/oauth/callback', '') || '/';

    let redirectTarget = baseUrl;
    try {
      const targetUrl = new URL(baseUrl);
      targetUrl.searchParams.set('qbo', 'connected');
      redirectTarget = targetUrl.toString();
    } catch {
      redirectTarget = baseUrl.includes('?')
        ? `${baseUrl}&qbo=connected`
        : `${baseUrl}?qbo=connected`;
    }

    return res.redirect(redirectTarget);
  } catch (err) {
    console.error('Callback error:', err.message);
    res.status(500).send('Error connecting to QuickBooks.');
  }
});

app.post('/api/qbo/disconnect', requireAdminAccess(p => p.view_payroll), requireSuperAdmin, async (req, res) => {
  try {
    const orgId = req.session && req.session.orgId;
    if (!orgId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    const adminId = req.session && req.session.employeeId;
    let perms = req.adminPerms;
    if (!perms && adminId) {
      perms = await getAdminAccessPerms({ employeeId: adminId, orgId });
    }
    const isSuperAdmin = adminId
      ? await isEmployeeSuperAdmin({ employeeId: adminId, orgId })
      : false;
    await clearTokens(orgId);
    await logAuditEvent({
      req,
      orgId,
      action: 'qbo.disconnect',
      entityType: 'org',
      entityId: orgId,
      note: 'QuickBooks disconnected.'
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('Error disconnecting QuickBooks:', err);
    return res.status(500).json({ error: 'Failed to disconnect QuickBooks.' });
  }
});

/* ───────── 4. PAYROLL SETTINGS & LOOKUPS ───────── */

// Get available QuickBooks accounts for payroll setup (bank + expense)
app.get('/api/payroll/account-options', requireAdminAccess(p => p.view_payroll), async (req, res) => {

  try {
    const orgId = req.session && req.session.orgId;
    const { bankAccounts, expenseAccounts } = await listPayrollAccounts(orgId);

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
    return respondWithQboError(res, err, { orgId: req.session && req.session.orgId });
  }
});

// Get QuickBooks Classes for use on payroll lines
app.get('/api/payroll/classes', requireAdminAccess(p => p.view_payroll), async (req, res) => {
  try {
    const orgId = req.session && req.session.orgId;
    const classes = await listClasses(orgId);

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
    return respondWithQboError(res, err, { orgId: req.session && req.session.orgId });
  }
});

// Get payroll defaults
app.get('/api/payroll/settings', requireAdminAccess(p => p.view_payroll), (req, res) => {
  const orgId = req.session && req.session.orgId;
  if (!orgId) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  db.get(
    `SELECT
       bank_account_name,
       expense_account_name,
       default_memo,
       line_description_template
     FROM payroll_settings
     WHERE org_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [orgId],
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
app.post('/api/payroll/settings', requireAdminAccess(p => p.modify_payroll), async (req, res) => {
  const {
    bank_account_name,
    expense_account_name,
    default_memo,
    line_description_template
  } = req.body || {};

  const orgId = req.session && req.session.orgId;
  if (!orgId) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  try {
    const beforeRow = await dbGet(
      `
        SELECT
          bank_account_name,
          expense_account_name,
          default_memo,
          line_description_template
        FROM payroll_settings
        WHERE org_id = ?
        ORDER BY id DESC
        LIMIT 1
      `,
      [orgId]
    );

    const nextRow = {
      bank_account_name: bank_account_name || null,
      expense_account_name: expense_account_name || null,
      default_memo: default_memo || null,
      line_description_template: line_description_template || null
    };

    const updateRes = await dbRun(
      `
        UPDATE payroll_settings
        SET bank_account_name = ?,
            expense_account_name = ?,
            default_memo = ?,
            line_description_template = ?
        WHERE org_id = ?
      `,
      [
        nextRow.bank_account_name,
        nextRow.expense_account_name,
        nextRow.default_memo,
        nextRow.line_description_template,
        orgId
      ]
    );

    if (!updateRes || updateRes.changes === 0) {
      await dbRun(
        `
          INSERT INTO payroll_settings
            (org_id, bank_account_name, expense_account_name, default_memo, line_description_template)
          VALUES (?, ?, ?, ?, ?)
        `,
        [
          orgId,
          nextRow.bank_account_name,
          nextRow.expense_account_name,
          nextRow.default_memo,
          nextRow.line_description_template
        ]
      );
    }

    const beforeAudit = beforeRow
      ? {
          bank_account_name: beforeRow.bank_account_name || null,
          expense_account_name: beforeRow.expense_account_name || null,
          default_memo: beforeRow.default_memo || null,
          line_description_template: beforeRow.line_description_template || null
        }
      : null;

    if (JSON.stringify(beforeAudit) !== JSON.stringify(nextRow)) {
      await logAuditEvent({
        req,
        orgId,
        action: 'settings.payroll.update',
        entityType: 'org',
        entityId: orgId,
        before: beforeAudit,
        after: nextRow
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('Error updating payroll_settings:', err);
    return res.status(500).json({ error: 'Failed to update payroll settings.' });
  }
});

// PAYROLL SUMMARY ENDPOINT (UNPAID ONLY)
app.get('/api/payroll-summary', requireAdminAccess(p => p.view_payroll), async (req, res) => {
  const { start, end, includePaid, includeOvertime } = req.query;
  const includePaidBool =
    includePaid === '1' ||
    includePaid === 'true' ||
    includePaid === true;
  const includeOvertimeBool =
    includeOvertime === undefined || includeOvertime === null
      ? true
      : (
          includeOvertime === '1' ||
          includeOvertime === 'true' ||
          includeOvertime === true
        );

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
    const orgId = req.session && req.session.orgId;
    if (!orgId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    const orgTimezone = await getOrgTimezone(orgId);

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
        t.employee_name_snapshot,
        t.project_name_snapshot,
        t.start_date,
        t.end_date,
        t.hours,
        t.total_pay,
        t.paid,
        t.paid_date,
        t.payroll_run_id,
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
      LEFT JOIN kiosk_sessions ks ON ks.id = tp.kiosk_session_id AND ks.org_id = tp.org_id
      WHERE t.org_id = ? AND t.start_date >= ? AND t.end_date <= ?
        ${paidClause}
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
        t.paid,
        t.paid_date,
        t.payroll_run_id,
        t.resolved_status
    ),
    eligible_entries AS (
      SELECT *
      FROM entry_flags f
      WHERE
        LOWER(COALESCE(f.resolved_status, 'open')) != 'rejected'
        AND
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
      f.id AS time_entry_id,
      f.employee_id,
      f.project_id,
      f.employee_name_snapshot,
      f.project_name_snapshot,
      f.start_date,
      f.end_date,
      f.hours,
      f.total_pay,
      f.paid,
      f.paid_date,
      f.payroll_run_id,
      COALESCE(e.name, f.employee_name_snapshot) AS employee_name,
      e.rate AS employee_rate,
      e.vendor_qbo_id AS employee_vendor_qbo_id,
      e.employee_qbo_id AS employee_employee_qbo_id,
      COALESCE(p.name, f.project_name_snapshot, '(No project)') AS project_name,
      p.qbo_id AS project_qbo_id,
      p.customer_name AS project_customer_name,
      COALESCE(p.name, f.project_name_snapshot, '(No project)') AS project_name_raw
    FROM eligible_entries f
    LEFT JOIN employees e ON f.employee_id = e.id AND e.org_id = ?
    LEFT JOIN projects p ON f.project_id = p.id AND p.org_id = ?
    ORDER BY
      employee_name,
      project_name,
      f.start_date,
      f.id
  `;

    const params = [orgId, start, end, orgId, orgId];

    const payrollRulesRaw = await loadPayrollRulesMap(orgId);
    const payrollRules = normalizePayrollRules(payrollRulesRaw);
    let rows = await dbAll(sql, params);

    if (ruleWeeklyHours && weeklyHoursThreshold && rows && rows.length) {
      const weeklyCounts = await loadWeeklyHoursExceptionCounts({
        orgId,
        start,
        end,
        orgTimezone,
        weeklyHoursThreshold
      });
      const eligibleRows = [];
      for (const row of rows) {
        const entryId = Number(row.time_entry_id || 0);
        if (!entryId) continue;
        const counts = weeklyCounts.perEntry.get(entryId);
        if (counts && counts.unapproved > 0) {
          continue;
        }
        eligibleRows.push(row);
      }
      rows = eligibleRows;
    }

    const entriesByEmployee = new Map();
    rows.forEach(row => {
      const hours = Number(row.hours || 0);
      const totalPay = Number(row.total_pay || 0);
      const employeeRate = Number(row.employee_rate || 0);
      const baseRate =
        hours > 0 && Number.isFinite(totalPay) && totalPay > 0
          ? totalPay / hours
          : employeeRate;
      const entry = {
        time_entry_id: row.time_entry_id,
        employee_id: row.employee_id,
        employee_name: row.employee_name,
        employee_vendor_qbo_id: row.employee_vendor_qbo_id,
        employee_employee_qbo_id: row.employee_employee_qbo_id,
        project_id: row.project_id,
        project_name: row.project_name,
        project_qbo_id: row.project_qbo_id,
        project_customer_name: row.project_customer_name,
        project_name_raw: row.project_name_raw,
        entry_date: row.start_date,
        hours,
        total_pay: totalPay,
        base_rate: Number.isFinite(baseRate) ? baseRate : 0,
        employee_rate: employeeRate,
        paid: row.paid ? 1 : 0,
        paid_date: row.paid_date,
        payroll_run_id: row.payroll_run_id
      };
      if (!entriesByEmployee.has(row.employee_id)) {
        entriesByEmployee.set(row.employee_id, []);
      }
      entriesByEmployee.get(row.employee_id).push(entry);
    });

    const employeeStatus = new Map();
    entriesByEmployee.forEach((entries, empId) => {
      applyOvertimeAllocations(entries, payrollRules, includeOvertimeBool);
      entries.forEach(entry => {
        const status = employeeStatus.get(empId) || {
          any_paid: false,
          payroll_run_id: null,
          last_paid_date: null
        };
        if (entry.paid) {
          status.any_paid = true;
          if (entry.payroll_run_id) {
            const currentRun = Number(status.payroll_run_id || 0);
            const nextRun = Number(entry.payroll_run_id || 0);
            status.payroll_run_id = nextRun > currentRun ? nextRun : status.payroll_run_id || nextRun;
          }
          if (!status.last_paid_date || (entry.paid_date && entry.paid_date > status.last_paid_date)) {
            status.last_paid_date = entry.paid_date;
          }
        }
        employeeStatus.set(empId, status);
      });
    });

    const lineMap = new Map();
    entriesByEmployee.forEach(entries => {
      entries.forEach(entry => {
        const key = `${entry.employee_id}:${entry.project_id || 'none'}`;
        if (!lineMap.has(key)) {
          lineMap.set(key, {
            employee_id: entry.employee_id,
            employee_name: entry.employee_name,
            employee_vendor_qbo_id: entry.employee_vendor_qbo_id,
            employee_employee_qbo_id: entry.employee_employee_qbo_id,
            project_id: entry.project_id,
            project_name: entry.project_name,
            project_qbo_id: entry.project_qbo_id,
            project_customer_name: entry.project_customer_name,
            project_name_raw: entry.project_name_raw,
            any_paid: 0,
            last_paid_date: null,
            payroll_run_id: null,
            line_paid: 0,
            line_paid_date: null,
            project_hours: 0,
            project_pay: 0
          });
        }
        const line = lineMap.get(key);
        line.project_hours += Number(entry.hours || 0);
        line.project_pay += Number(entry.adjusted_pay || 0);
        if (entry.paid) {
          line.line_paid = 1;
          if (!line.line_paid_date || (entry.paid_date && entry.paid_date > line.line_paid_date)) {
            line.line_paid_date = entry.paid_date;
          }
        }
      });
    });

    const response = Array.from(lineMap.values()).map(line => {
      const status = employeeStatus.get(line.employee_id) || {};
      return {
        ...line,
        any_paid: status.any_paid ? 1 : 0,
        last_paid_date: status.last_paid_date || null,
        payroll_run_id: status.payroll_run_id || null,
        project_hours: roundCurrency(line.project_hours),
        project_pay: roundCurrency(line.project_pay)
      };
    });

    res.json(response);
  } catch (err) {
    console.error('Error loading payroll summary:', err);
    return res.status(500).json({ error: err.message || 'Failed to load payroll summary.' });
  }
});
// Mark checks/time entries as unpaid for an employee in a period (to allow resend)
app.post('/api/payroll/unpay', requireAdminAccess(p => p.modify_payroll), async (req, res) => {
  const {
    payrollRunId,
    employeeId,
    reason,
    payrollCheckId: payrollCheckIdRaw
  } = req.body || {};
  const orgId = req.session && req.session.orgId;
  if (!orgId) {
    return res.status(401).json({ ok: false, error: 'Not authenticated.' });
  }
  const runId = Number(payrollRunId);
  const empIdNum = Number(employeeId);
  const payrollCheckId =
    payrollCheckIdRaw && Number.isFinite(Number(payrollCheckIdRaw))
      ? Number(payrollCheckIdRaw)
      : null;
  if (!runId || !empIdNum) {
    return res.status(400).json({ ok: false, error: 'payrollRunId and employeeId are required.' });
  }
  try {
    if (payrollCheckId) {
      await dbRun(
        `
          UPDATE payroll_checks
          SET paid = 0,
              paid_date = NULL,
              voided_at = datetime('now'),
              voided_reason = ?
          WHERE payroll_run_id = ?
            AND employee_id = ?
            AND id = ?
            AND org_id = ?
        `,
        [reason || 'manual unpay', runId, empIdNum, payrollCheckId, orgId]
      );
    } else {
      await dbRun(
        `
          UPDATE payroll_checks
          SET paid = 0,
              paid_date = NULL,
              voided_at = datetime('now'),
              voided_reason = ?
          WHERE payroll_run_id = ?
            AND employee_id = ?
            AND org_id = ?
        `,
        [reason || 'manual unpay', runId, empIdNum, orgId]
      );
    }

    // recalc totals for the run
    await dbRun(
      `
        UPDATE payroll_runs
        SET total_hours = (
              SELECT IFNULL(SUM(total_hours), 0)
              FROM payroll_checks
              WHERE payroll_run_id = ? AND org_id = ?
            ),
            total_pay = (
              SELECT IFNULL(SUM(total_pay), 0)
              FROM payroll_checks
              WHERE payroll_run_id = ? AND org_id = ?
            )
        WHERE id = ? AND org_id = ?
      `,
      [runId, orgId, runId, orgId, runId, orgId]
    );

    // unmark time entries as paid (run-scoped)
    await dbRun(
      `
        UPDATE time_entries
        SET paid = 0,
            paid_date = NULL,
            payroll_run_id = NULL,
            payroll_check_id = NULL,
            updated_at = ?
        WHERE employee_id = ?
          AND payroll_run_id = ?
          AND org_id = ?
      `,
      [new Date().toISOString(), empIdNum, runId, orgId]
    );

    await logPayrollEvent({
      orgId: req.session && req.session.orgId,
      actor_employee_id: req.session && req.session.employeeId ? req.session.employeeId : null,
      event_type: 'PAYROLL_UNPAY',
      payroll_run_id: runId,
      message: `Unlocked payroll for employee ${empIdNum} (run ${runId})`,
      details: { employeeId: empIdNum, payrollRunId: runId, reason: reason || null }
    });

    await logAuditEvent({
      req,
      orgId,
      action: 'payroll.unpay',
      entityType: 'payroll_run',
      entityId: runId,
      after: {
        employee_id: empIdNum,
        payroll_check_id: payrollCheckId,
        reason: reason || null
      }
    });

    return res.json({ ok: true, payrollRunId: runId });
  } catch (err) {
    console.error('Error unpaying payroll:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Failed to unpay payroll.' });
  }
});

// Get raw time entries for an employee in a date range (for payroll UI)
app.get('/api/payroll/time-entries', requireAdminAccess(p => p.view_payroll), async (req, res) => {
  const employeeId = parseInt(req.query.employeeId, 10);
  const { start, end } = req.query || {};
  const orgId = req.session && req.session.orgId;

  if (!employeeId || !start || !end) {
    return res
      .status(400)
      .json({ error: 'employeeId, start, and end are required.' });
  }
  if (!orgId) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  try {
    const rulesMap = await loadExceptionRulesMap(orgId);
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
    const ruleAutoClockOut = isRuleEnabled('auto_clock_out');
    const ruleManualNoPunches = isRuleEnabled('manual_no_punches');
    const ruleManualHoursMismatch = isRuleEnabled('manual_hours_mismatch');
    const rawWeeklyThreshold =
      rulesMap && rulesMap.weekly_hours_threshold != null
        ? Number(rulesMap.weekly_hours_threshold)
        : null;
    const weeklyHoursThreshold =
      Number.isFinite(rawWeeklyThreshold) && rawWeeklyThreshold > 0
        ? rawWeeklyThreshold
        : null;
    const orgTimezone = await getOrgTimezone(orgId);

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
      ); // geo violation already computed at punch time
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
      LEFT JOIN projects p ON t.project_id = p.id AND p.org_id = t.org_id
      LEFT JOIN time_punches tp ON tp.time_entry_id = t.id AND tp.org_id = t.org_id
      LEFT JOIN kiosk_sessions ks ON ks.id = tp.kiosk_session_id AND ks.org_id = tp.org_id
      LEFT JOIN kiosk_sessions ks ON ks.id = tp.kiosk_session_id AND ks.org_id = t.org_id
      WHERE t.employee_id = ?
        AND t.org_id = ?
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

    let rows = await dbAll(sql, [employeeId, orgId, start, end]);
    let weeklyBlocked = new Set();
    if (ruleWeeklyHours && weeklyHoursThreshold && rows && rows.length) {
      const weeklyCounts = await loadWeeklyHoursExceptionCounts({
        orgId,
        start,
        end,
        orgTimezone,
        weeklyHoursThreshold
      });
      weeklyBlocked = new Set(
        rows
          .map(r => Number(r.id || 0))
          .filter(id => id && weeklyCounts.perEntry.get(id)?.unapproved > 0)
      );
    }

    const HOURS_EPSILON = 0.1; // ~6 minutes

    const eligible = rows.filter(r => {
      const entryId = Number(r.id || 0);
      if (entryId && weeklyBlocked.has(entryId)) {
        return false;
      }
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
      if (status === 'rejected') {
        return false;
      }
      const isApproved = status === 'approved' || status === 'modified';
      const isReviewed = !!r.resolved || (status && status !== 'open');

      const hasPunchException =
        Number(r.punch_exception_count || 0) > 0;
      const punchExceptionsApproved =
        Number(r.punch_exception_unapproved_count || 0) === 0;

      const entryOk = entryException ? isApproved : isReviewed;
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

// Preview payroll checks (compatibility path; mirrors preflight behavior)
app.post('/api/payroll/preview-checks', requireAdminAccess(p => p.modify_payroll), async (req, res) => {
  const {
    start,
    end,
    bankAccountName,
    expenseAccountName,
    memo,
    lineDescriptionTemplate,
    overrides = [],
    excludeEmployeeIds = [],
    customLines = [],
    lineOverrides = [],
    onlyEmployeeIds = []
  } = req.body || {};

  try {
    await validatePayrollRangeServer(start, end);
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }

  const orgId = req.session && req.session.orgId;
  if (!orgId) {
    return res.status(401).json({ ok: false, error: 'Not authenticated.' });
  }
  const actorEmployeeId =
    req.session && req.session.employeeId ? req.session.employeeId : null;

  const qboChanges = await loadQboDirtyConflicts({ orgId });
  if (qboChanges.length) {
    return res.status(409).json({
      ok: false,
      error: 'QuickBooks employee changes must be synced before running payroll.',
      qbo_changes: qboChanges
    });
  }

  try {
    const pendingApprovals = await loadPendingTimeEntryApprovals({
      orgId,
      start,
      end
    });
    const pendingFieldReviews = await loadPendingTimeEntryFieldReviews({
      orgId,
      start,
      end
    });
    if (pendingFieldReviews.length) {
      return res.status(409).json({
        ok: false,
        error: 'Time entry field reviews are required before running payroll.',
        pending: pendingFieldReviews
      });
    }
    if (pendingApprovals.length) {
      return res.status(409).json({
        ok: false,
        error: 'Time entry approvals are required before running payroll.',
        pending: pendingApprovals
      });
    }
    const unresolved = await loadPayrollUnresolvedExceptions({
      orgId,
      start,
      end
    });
    if (unresolved.length) {
      return res.status(409).json({
        ok: false,
        error: 'Time exceptions must be reviewed before running payroll.',
        unresolved
      });
    }

    const qboChanges = await loadQboDirtyConflicts({ orgId });
    if (qboChanges.length) {
      return res.status(409).json({
        ok: false,
        error: 'QuickBooks employee changes must be synced before running payroll.',
        qbo_changes: qboChanges
      });
    }
  } catch (err) {
    console.error('Pending approvals check failed:', err);
  }

  try {
    const { normalized, payloadJson, payloadHash } = hashPayrollPayload(req.body || {});
    const snapshot = await computePayrollDraftsSnapshot(start, end, {
      excludeEmployeeIds: normalized.excludeEmployeeIds,
      onlyEmployeeIds: normalized.onlyEmployeeIds,
      includeOvertime: normalized.include_overtime,
      orgId
    });
    const qbResult = await createChecksForPeriod(start, end, {
      bankAccountName,
      expenseAccountName,
      memo,
      lineDescriptionTemplate,
      includeOvertime: normalized.include_overtime,
      overrides,
      lineOverrides,
      customLines,
      excludeEmployeeIds,
      onlyEmployeeIds,
      previewOnly: true,
      orgId
    });
    if (qbResult && qbResult.ok === false) {
      return res.json({ ...qbResult, preview: true });
    }
    const preflightId = await storePayrollPreflight({
      orgId,
      normalized,
      payloadJson,
      payloadHash,
      snapshotHash: snapshot.snapshot_hash,
      snapshotCount: snapshot.snapshot_count,
      actorEmployeeId: req.session && req.session.employeeId ? req.session.employeeId : null
    });
    await logAuditEvent({
      req,
      orgId,
      action: 'payroll.preflight',
      entityType: 'org',
      entityId: orgId,
      after: {
        preflight_id: preflightId,
        start,
        end,
        preview: true,
        snapshot_count: snapshot.snapshot_count
      }
    });
    return res.json({
      ...qbResult,
      preview: true,
      preflight_id: preflightId,
      payload_hash: payloadHash,
      snapshot_hash: snapshot.snapshot_hash,
      snapshot_count: snapshot.snapshot_count
    });
  } catch (err) {
    console.error('Preview checks error:', err);
    res.status(500).json({ error: err.message || 'Failed to preview checks.' });
  }
});

app.post('/api/payroll/preflight-checks', requireAdminAccess(p => p.modify_payroll), async (req, res) => {
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
    onlyEmployeeIds = []
  } = req.body || {};

  try {
    await validatePayrollRangeServer(start, end);
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }

  try {
    const orgId = req.session && req.session.orgId;
    if (!orgId) {
      return res.status(401).json({ ok: false, error: 'Not authenticated.' });
    }

    const pendingApprovals = await loadPendingTimeEntryApprovals({
      orgId,
      start,
      end
    });
    const pendingFieldReviews = await loadPendingTimeEntryFieldReviews({
      orgId,
      start,
      end
    });
    if (pendingFieldReviews.length) {
      return res.status(409).json({
        ok: false,
        error: 'Time entry field reviews are required before running payroll.',
        pending: pendingFieldReviews
      });
    }
    if (pendingApprovals.length) {
      return res.status(409).json({
        ok: false,
        error: 'Time entry approvals are required before running payroll.',
        pending: pendingApprovals
      });
    }
    const unresolved = await loadPayrollUnresolvedExceptions({
      orgId,
      start,
      end
    });
    if (unresolved.length) {
      return res.status(409).json({
        ok: false,
        error: 'Time exceptions must be reviewed before running payroll.',
        unresolved
      });
    }

    const qboChanges = await loadQboDirtyConflicts({ orgId });
    if (qboChanges.length) {
      return res.status(409).json({
        ok: false,
        error: 'QuickBooks employee changes must be synced before running payroll.',
        qbo_changes: qboChanges
      });
    }

    const { normalized, payloadJson, payloadHash } = hashPayrollPayload(req.body || {});
    const snapshot = await computePayrollDraftsSnapshot(start, end, {
      excludeEmployeeIds: normalized.excludeEmployeeIds,
      onlyEmployeeIds: normalized.onlyEmployeeIds,
      includeOvertime: normalized.include_overtime,
      orgId
    });
    const qbResult = await createChecksForPeriod(start, end, {
      bankAccountName,
      expenseAccountName,
      memo,
      lineDescriptionTemplate,
      includeOvertime: normalized.include_overtime,
      overrides,
      lineOverrides,
      customLines,
      excludeEmployeeIds,
      onlyEmployeeIds,
      previewOnly: true,
      orgId
    });
    if (qbResult && qbResult.ok === false) {
      return res.json({ ...qbResult, preview: true });
    }
    const preflightId = await storePayrollPreflight({
      orgId,
      normalized,
      payloadJson,
      payloadHash,
      snapshotHash: snapshot.snapshot_hash,
      snapshotCount: snapshot.snapshot_count,
      actorEmployeeId: req.session && req.session.employeeId ? req.session.employeeId : null
    });
    await logAuditEvent({
      req,
      orgId,
      action: 'payroll.preflight',
      entityType: 'org',
      entityId: orgId,
      after: {
        preflight_id: preflightId,
        start,
        end,
        preview: false,
        snapshot_count: snapshot.snapshot_count
      }
    });
    return res.json({
      ...qbResult,
      preview: true,
      preflight_id: preflightId,
      payload_hash: payloadHash,
      snapshot_hash: snapshot.snapshot_hash,
      snapshot_count: snapshot.snapshot_count
    });
  } catch (err) {
    console.error('Preflight checks error:', err);
    const orgId = req.session && req.session.orgId;
    return respondWithQboError(res, err, { orgId });
  }
});

app.post('/api/payroll/create-checks', requireAdminAccess(p => p.modify_payroll), async (req, res) => {
  let {
    preflight_id: preflightIdRaw,
    payload_hash: payloadHashRaw,
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
    onlyEmployeeIds = [],
    fromAttemptId = null,
    idempotencyKey: providedIdempotencyKey = null
  } = req.body || {};

  const preflightId = Number(preflightIdRaw);
  const payloadHash = payloadHashRaw ? String(payloadHashRaw) : null;
  const { normalized, payloadHash: computedPayloadHash } = hashPayrollPayload(req.body || {});
  const runType = normalized.run_type || 'standard';
  const adjustmentReason = normalized.adjustment_reason || null;

  if (!preflightId || !payloadHash) {
    return res.status(400).json({
      ok: false,
      error: 'preflight_id and payload_hash are required before creating checks.'
    });
  }
  if (!start || !end) {
    return res.status(400).json({
      ok: false,
      error: 'start and end dates are required before creating checks.'
    });
  }

  let idempotencyKey = providedIdempotencyKey || crypto.randomUUID();
  let payrollRunId = null;
  let backupWarning = null;

  const orgId = req.session && req.session.orgId;
  if (!orgId) {
    return res.status(401).json({ ok: false, error: 'Not authenticated.' });
  }
  const actorEmployeeId =
    req.session && req.session.employeeId ? req.session.employeeId : null;

  if (providedIdempotencyKey && !isRetry) {
    const existingByKey = await dbGet(
      `SELECT id, start_date, end_date, status FROM payroll_runs WHERE idempotency_key = ? AND org_id = ?`,
      [providedIdempotencyKey, orgId]
    );

    if (existingByKey) {
      if (existingByKey.start_date !== start || existingByKey.end_date !== end) {
        return res.status(400).json({
          ok: false,
          error: 'Idempotency key already used for a different payroll period.'
        });
      }

      const existingStatus = existingByKey.status || '';
      if (existingStatus === PAYROLL_STATUS.COMPLETED) {
        return res.status(200).json({
          ok: true,
          payrollRunId: existingByKey.id,
          status: existingStatus,
          idempotencyKey: providedIdempotencyKey,
          message:
            'Payroll already completed for this idempotency key. No new checks were created.'
        });
      }
      if (
        existingStatus === PAYROLL_STATUS.PENDING ||
        existingStatus === PAYROLL_STATUS.IN_PROGRESS
      ) {
        return res.status(409).json({
          ok: false,
          payrollRunId: existingByKey.id,
          status: existingStatus,
          error:
            'A payroll run is already in progress for this idempotency key. Please wait or use a new key.'
        });
      }
      return res.status(409).json({
        ok: false,
        payrollRunId: existingByKey.id,
        status: existingStatus,
        error:
          'A payroll run already exists for this idempotency key. Use retry for failed employees or start a new run with a new key.'
      });
    }
  }

  let preflightRow = null;
  try {
    preflightRow = await loadPayrollPreflight({ orgId, preflightId });
  } catch (err) {
    console.error('Failed to load payroll preflight:', err);
  }

  if (!preflightRow) {
    return res.status(400).json({
      ok: false,
      error: 'Preflight is missing or expired. Please re-run preflight checks.'
    });
  }

  if (payloadHash !== preflightRow.payload_hash) {
    return res.status(400).json({
      ok: false,
      error: 'Payload hash does not match the preflight snapshot.'
    });
  }

  if (computedPayloadHash !== preflightRow.payload_hash) {
    return res.status(400).json({
      ok: false,
      error: 'Payload changed since preflight. Please re-run preflight checks.'
    });
  }

  if (!preflightRow.snapshot_hash) {
    return res.status(400).json({
      ok: false,
      error: 'Preflight snapshot missing. Please re-run preflight checks.'
    });
  }

  const pendingApprovals = await loadPendingTimeEntryApprovals({
    orgId,
    start,
    end
  });
  if (pendingApprovals.length) {
    return res.status(409).json({
      ok: false,
      error: 'Time entry approvals are required before running payroll.',
      pending: pendingApprovals
    });
  }

  const currentSnapshot = await computePayrollDraftsSnapshot(start, end, {
    excludeEmployeeIds: normalized.excludeEmployeeIds,
    onlyEmployeeIds: normalized.onlyEmployeeIds,
    includeOvertime: normalized.include_overtime,
    orgId
  });
  if (currentSnapshot.snapshot_hash !== preflightRow.snapshot_hash) {
    return res.status(409).json({
      ok: false,
      error: 'Time entries changed since preflight. Please re-run preflight checks.',
      snapshot_hash: currentSnapshot.snapshot_hash,
      snapshot_count: currentSnapshot.snapshot_count
    });
  }

  if (runType === 'adjustment' && !adjustmentReason) {
    return res.status(400).json({
      ok: false,
      error: 'adjustment_reason is required for adjustment payroll runs.'
    });
  }

  if (fromAttemptId) {
    let failedIds = [];
    try {
      failedIds = await getFailedEmployeeIdsForAttempt({
        orgId,
        attemptId: Number(fromAttemptId)
      });
    } catch (err) {
      console.warn('Failed to load failed employees for attempt', fromAttemptId, err);
      return res.status(400).json({
        ok: false,
        error: 'Could not load failed employees for the retry attempt. Please re-run preflight.'
      });
    }

    const normalizedFailed = [...new Set(failedIds.map(Number).filter(Number.isFinite))].sort(
      (a, b) => a - b
    );
    const normalizedOnly = [...new Set((onlyEmployeeIds || []).map(Number).filter(Number.isFinite))].sort(
      (a, b) => a - b
    );

    if (!normalizedFailed.length) {
      return res.status(400).json({
        ok: false,
        error: 'No failed employees found for that attempt. Nothing to retry.'
      });
    }

    if (!normalizedOnly.length) {
      return res.status(409).json({
        ok: false,
        error:
          'Retrying failed employees requires a preflight for that subset. Re-run preflight with onlyEmployeeIds set to the failed employees, then retry.',
        failed_employee_ids: normalizedFailed
      });
    }

    const sameSet =
      normalizedOnly.length === normalizedFailed.length &&
      normalizedOnly.every((id, idx) => id === normalizedFailed[idx]);
    if (!sameSet) {
      return res.status(409).json({
        ok: false,
        error:
          'Retry employees do not match the approved preflight subset. Re-run preflight with onlyEmployeeIds matching the failed employees.',
        failed_employee_ids: normalizedFailed
      });
    }

    onlyEmployeeIds = normalizedOnly;
    isRetry = true;
  }

  // 🔒 DB-backed mutex: block concurrent payroll runs across processes
  const locker = `emp:${req.session && req.session.employeeId ? req.session.employeeId : 'unknown'}`;
  const gotLock = await acquirePayrollLock(orgId, locker);
  if (!gotLock) {
    return res.status(409).json({
      ok: false,
      error:
        'A payroll run is already in progress. Please wait for it to finish before starting another.'
    });
  }

  try {
    const existingByKey = idempotencyKey
      ? await dbGet(
          `SELECT id, start_date, end_date, status FROM payroll_runs WHERE idempotency_key = ? AND org_id = ?`,
          [idempotencyKey, orgId]
        )
      : null;

    if (existingByKey) {
      if (existingByKey.start_date !== start || existingByKey.end_date !== end) {
        return res.status(400).json({
          ok: false,
          error: 'Idempotency key already used for a different payroll period.'
        });
      }
      payrollRunId = existingByKey.id;
      idempotencyKey = existingByKey.idempotency_key || idempotencyKey;

      const existingStatus = existingByKey.status || '';
      if (!isRetry) {
        if (existingStatus === PAYROLL_STATUS.COMPLETED) {
          return res.status(200).json({
            ok: true,
            payrollRunId,
            status: existingStatus,
            idempotencyKey,
            message:
              'Payroll already completed for this idempotency key. No new checks were created.'
          });
        }
        if (
          existingStatus === PAYROLL_STATUS.PENDING ||
          existingStatus === PAYROLL_STATUS.IN_PROGRESS
        ) {
          return res.status(409).json({
            ok: false,
            payrollRunId,
            status: existingStatus,
            error:
              'A payroll run is already in progress for this idempotency key. Please wait or use a new key.'
          });
        }
        return res.status(409).json({
          ok: false,
          payrollRunId,
          status: existingStatus,
          error:
            'A payroll run already exists for this idempotency key. Use retry for failed employees or start a new run with a new key.'
        });
      }
    }

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
          'SELECT id, start_date, end_date FROM payroll_runs WHERE id = ? AND org_id = ?',
          [originalPayrollRunId, orgId]
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
            WHERE start_date = ? AND end_date = ? AND org_id = ?
            LIMIT 1
          `,
          [start, end, orgId]
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
        orgId,
        actor_employee_id: actorEmployeeId,
        event_type: 'RETRY_STARTED',
        message: `Retry payroll run for ${start} → ${end}`,
        payroll_run_id: payrollRunId,
        details: { start, end, originalPayrollRunId, onlyEmployeeIds }
      });
    } else {
      // ───────── NORMAL (FIRST) RUN PATH ─────────
      await validatePayrollRangeServer(start, end);

      if (runType !== 'adjustment') {
        const overlapping = await dbGet(
          `
            SELECT id, start_date, end_date
            FROM payroll_runs
            WHERE start_date <= ? AND end_date >= ? AND org_id = ?
            ORDER BY id DESC
            LIMIT 1
          `,
          [end, start, orgId]
        );
        if (overlapping && (!payrollRunId || overlapping.id !== payrollRunId)) {
          return res.status(400).json({
            ok: false,
            error:
              'A payroll run already exists for an overlapping period. Use retry/unpay for the same period, or create an adjustment run explicitly.'
          });
        }
      }

      if (!payrollRunId) {
        const runInsert = await dbRun(
          `
            INSERT INTO payroll_runs (
              org_id,
              start_date,
              end_date,
              created_at,
              total_hours,
              total_pay,
              status,
              include_overtime,
              run_type,
              adjustment_reason,
              idempotency_key,
              last_attempt_id,
              last_error
            ) VALUES (?, ?, ?, datetime('now'), 0, 0, ?, ?, ?, ?, ?, NULL, NULL)
          `,
          [
            orgId,
            start,
            end,
            PAYROLL_STATUS.PENDING,
            normalized.include_overtime ? 1 : 0,
            runType,
            adjustmentReason,
            idempotencyKey
          ]
        );
        payrollRunId = runInsert.lastID;
      } else {
        await markPayrollRunStatus(orgId, payrollRunId, PAYROLL_STATUS.PENDING, {
          idempotencyKey,
          lastError: null
        });
      }

      // 🔎 Audit log: run started
      await logPayrollEvent({
        orgId,
        actor_employee_id: actorEmployeeId,
        event_type: 'PAYROLL_RUN_STARTED',
        message: `Payroll run started for ${start} → ${end}`,
        details: {
          start,
          end,
          bankAccountName,
          expenseAccountName,
          onlyEmployeeIds,
          run_type: runType,
          adjustment_reason: adjustmentReason
        },
        payroll_run_id: payrollRunId
      });
    }

    if (payrollRunId) {
      const keyRow = await dbGet(
        `SELECT idempotency_key FROM payroll_runs WHERE id = ? AND org_id = ?`,
        [payrollRunId, orgId]
      );
      if (keyRow && keyRow.idempotency_key) {
        idempotencyKey = keyRow.idempotency_key;
      }
    }

    // Ensure the idempotency key is attached to any pre-existing run we found
    if (payrollRunId && idempotencyKey) {
      await markPayrollRunStatus(orgId, payrollRunId, PAYROLL_STATUS.PENDING, {
        idempotencyKey,
        lastError: null
      });
    }

    const backupResult = await runBackupWithLock({ requireLock: true });
    if (!backupResult.ok) {
      backupWarning = {
        code: backupResult.reason === 'lock_busy' ? 'backup_lock_busy' : 'backup_failed',
        message:
          backupResult.reason === 'lock_busy'
            ? 'Database backup skipped because another backup is already running.'
            : 'Database backup failed. Please run a backup as soon as possible.',
        error: backupResult.error || null
      };
      await logPayrollEvent({
        orgId,
        actor_employee_id: actorEmployeeId,
        event_type: 'PAYROLL_BACKUP_WARNING',
        message: backupWarning.message,
        details: {
          start,
          end,
          reason: backupResult.reason || null,
          error: backupResult.error || null
        },
        payroll_run_id: payrollRunId
      });
    }

    await markPayrollRunStatus(orgId, payrollRunId, PAYROLL_STATUS.IN_PROGRESS, {
      lastError: null,
      idempotencyKey
    });

    // 2) Call QuickBooks helper to actually build & create checks.
    const qbResult = await createChecksForPeriod(start, end, {
      bankAccountName,
      expenseAccountName,
      memo,
      lineDescriptionTemplate,
      includeOvertime: normalized.include_overtime,
      overrides,
      lineOverrides,
      customLines,
      excludeEmployeeIds,
      onlyEmployeeIds,
      runContext: {
        payrollRunId,
        runType,
        adjustmentReason,
        idempotencyKey
      },
      orgId
    });

    // 🔎 Audit log: QuickBooks call completed (basic info)
    await logPayrollEvent({
      orgId,
      actor_employee_id: actorEmployeeId,
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

    const attemptId = await recordPayrollAttempt({
      orgId,
      payrollRunId,
      start,
      end,
      qbResult
    });

    const fatalQboError = qbResult?.fatalQboError || null;
    if (fatalQboError) {
      await logPayrollEvent({
        orgId,
        actor_employee_id: actorEmployeeId,
        event_type: 'PAYROLL_QBO_ERROR',
        message: fatalQboError,
        details: {
          start,
          end,
          fatal: true,
          results: qbResult?.results || []
        },
        payroll_run_id: payrollRunId
      });
    }

    if (!qbResult || qbResult.ok === false) {
      const errorMsg =
        qbResult?.error ||
        qbResult?.reason ||
        'QuickBooks check creation failed.';

      if (
        qbResult?.reason &&
        qbResult.reason.includes('Not connected to QuickBooks')
      ) {
        const notConnectedMsg = 'Not connected to QuickBooks.';
        await logPayrollEvent({
          orgId,
          actor_employee_id: actorEmployeeId,
          event_type: 'PAYROLL_QBO_ERROR',
          message: notConnectedMsg,
          details: {
            start,
            end,
            results: qbResult?.results || []
          },
          payroll_run_id: payrollRunId
        });
        await markPayrollRunStatus(orgId, payrollRunId, PAYROLL_STATUS.FAILED, {
          lastError: notConnectedMsg,
          lastAttemptId: attemptId,
          idempotencyKey
        });
        return res.status(400).json({
          ok: false,
          error: notConnectedMsg,
          results: qbResult?.results || [],
          attempt_id: attemptId,
          warnings: backupWarning ? [backupWarning] : []
        });
      }

      // 🔎 Audit log: QuickBooks error
      await logPayrollEvent({
        orgId,
        actor_employee_id: actorEmployeeId,
        event_type: 'PAYROLL_QBO_ERROR',
        message: errorMsg,
        details: {
          start,
          end,
          results: qbResult?.results || []
        },
        payroll_run_id: payrollRunId
      });

      await markPayrollRunStatus(orgId, payrollRunId, PAYROLL_STATUS.FAILED, {
        lastError: errorMsg,
        lastAttemptId: attemptId,
        idempotencyKey
      });

      return res.status(500).json({
        ok: false,
        error: errorMsg,
        results: qbResult?.results || [],
        attempt_id: attemptId,
        warnings: backupWarning ? [backupWarning] : []
      });
    }

    const results = Array.isArray(qbResult.results) ? qbResult.results : [];
    const paidAt = new Date().toISOString().slice(0, 19).replace('T', ' ');

    // 3) Compute totals from the results (only successful checks) for response
    const successfulResults = results.filter(r => r && r.ok !== false);
    const failedResults = results.filter(r => r && r.ok === false);
    if (fatalQboError && successfulResults.length === 0) {
      await markPayrollRunStatus(orgId, payrollRunId, PAYROLL_STATUS.FAILED, {
        lastError: fatalQboError,
        lastAttemptId: attemptId,
        idempotencyKey
      });

      await logPayrollEvent({
        orgId,
        actor_employee_id: actorEmployeeId,
        event_type: 'PAYROLL_RUN_FAILURE',
        message: 'Payroll run failed due to a fatal QuickBooks error.',
        payroll_run_id: payrollRunId,
        details: {
          start,
          end,
          fatal_qbo_error: fatalQboError
        }
      });

      return res.status(500).json({
        ok: false,
        error: fatalQboError,
        results,
        attempt_id: attemptId,
        fatal_qbo_error: fatalQboError,
        warnings: backupWarning ? [backupWarning] : []
      });
    }

    const finalRunStatus =
      fatalQboError || failedResults.length > 0
        ? PAYROLL_STATUS.PARTIAL
        : PAYROLL_STATUS.COMPLETED;
    let batchHours = 0;
    let batchPay = 0;

    successfulResults.forEach(r => {
      batchHours += Number(r.totalHours || 0);
      batchPay   += Number(r.totalPay   || 0);
    });

    // 4) Persist this payroll run + checks in a transaction.
    const nextTotalPrice = canViewPayroll
      ? (total_price != null ? total_price : null)
      : existing.total_price;
    const nextPricePerItem = canViewPayroll
      ? (price_per_item != null ? price_per_item : null)
      : existing.price_per_item;

    await dbRun('BEGIN TRANSACTION');

    try {
      if (!payrollRunId) {
        // Safety fallback: create a pending run if none exists for this key
        const runInsert = await dbRun(
          `
            INSERT INTO payroll_runs (
              org_id,
              start_date,
              end_date,
              created_at,
              total_hours,
              total_pay,
              status,
              include_overtime,
              run_type,
              adjustment_reason,
              idempotency_key,
              last_attempt_id,
              last_error
            ) VALUES (?, ?, ?, datetime('now'), 0, 0, ?, ?, ?, ?, ?, ?, NULL)
          `,
          [
            orgId,
            start,
            end,
            PAYROLL_STATUS.IN_PROGRESS,
            normalized.include_overtime ? 1 : 0,
            runType,
            adjustmentReason,
            idempotencyKey,
            attemptId
          ]
        );
        payrollRunId = runInsert.lastID;
        await updateAttemptRunId({
          orgId,
          attemptId,
          payrollRunId
        });
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
                AND org_id         = ?
            `,
            [payrollRunId, r.employeeId, orgId]
          );
        }

        await dbRun(
          `
            INSERT INTO payroll_checks (
              org_id,
              payroll_run_id,
              employee_id,
              total_hours,
              total_pay,
              check_number,
              paid,
              paid_date,
              qbo_txn_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            orgId,
            payrollRunId,
            r.employeeId,
            Number(r.totalHours || 0),
            Number(r.totalPay   || 0),
            r.checkNumber || null,
            r.ok === false ? 0 : 1,
            r.ok === false ? null : paidAt,
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
                WHERE payroll_run_id = ? AND org_id = ?
              ),
              total_pay = (
                SELECT IFNULL(SUM(total_pay), 0)
                FROM payroll_checks
                WHERE payroll_run_id = ? AND org_id = ?
              )
          WHERE id = ? AND org_id = ?
        `,
        [payrollRunId, orgId, payrollRunId, orgId, payrollRunId, orgId]
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
          const checkRow = await dbGet(
            `
              SELECT id
              FROM payroll_checks
              WHERE payroll_run_id = ? AND employee_id = ? AND org_id = ?
              ORDER BY id DESC
              LIMIT 1
            `,
            [payrollRunId, empId, orgId]
          );
          const payrollCheckId = checkRow ? checkRow.id : null;
          await dbRun(
            `
              UPDATE time_entries
    SET paid      = 1,
        paid_date = ?,
        payroll_run_id = ?,
        payroll_check_id = ?,
        updated_at = ?
    WHERE employee_id = ?
      AND org_id = ?
      AND start_date  >= ?
      AND end_date    <= ?
      AND (paid IS NULL OR paid = 0)
  `,
  [paidAt, payrollRunId, payrollCheckId, new Date().toISOString(), empId, orgId, start, end]
);
        }

        console.log('✅ Marked time entries as paid for this payroll run.');
      } catch (markErr) {
        console.error('⚠️ Failed marking time entries as paid:', markErr);
        throw new Error('Failed marking time entries as paid: ' + markErr.message); // Force rollback so we never report success with unpaid entries
      }

      await markPayrollRunStatus(orgId, payrollRunId, finalRunStatus, {
        lastAttemptId: attemptId,
        lastError: fatalQboError || null,
        idempotencyKey
      });

      await dbRun('COMMIT');

      // 🔎 Audit log: DB commit success
      await logPayrollEvent({
        orgId,
        actor_employee_id: actorEmployeeId,
        event_type: isRetry
          ? 'RETRY_SUCCESS'
          : (finalRunStatus === PAYROLL_STATUS.PARTIAL ? 'PAYROLL_RUN_PARTIAL' : 'PAYROLL_RUN_SUCCESS'),
        message: 'Payroll run saved successfully.',
        payroll_run_id: payrollRunId,
        details: {
          start,
          end,
          payroll_run_id: payrollRunId,
          batchHours,
          batchPay,
          successfulEmployeeIds,
          failedEmployeeIds: failedResults
            .map(r => Number(r.employeeId))
            .filter(id => Number.isFinite(id)),
          fatal_qbo_error: fatalQboError || null
        }
      });

    } catch (dbErr) {
      await dbRun('ROLLBACK');
      console.error('Error saving payroll run/checks:', dbErr);

      await markPayrollRunStatus(orgId, payrollRunId, PAYROLL_STATUS.FAILED, {
        lastError: dbErr.message,
        lastAttemptId: attemptId,
        idempotencyKey
      });

      // 🔎 Audit log: DB failure
      await logPayrollEvent({
        orgId,
        actor_employee_id: actorEmployeeId,
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
        results,
        warnings: backupWarning ? [backupWarning] : []
      });
    }

  // 5) Respond with full details so the UI can show a summary and allow retry-later logic
  await logAuditEvent({
    req,
    orgId,
    action: isRetry ? 'payroll.run.retry' : 'payroll.run.create',
    entityType: 'payroll_run',
    entityId: payrollRunId,
    after: {
      start,
      end,
      status: finalRunStatus,
      total_hours: batchHours,
      total_pay: batchPay,
      result_count: Array.isArray(results) ? results.length : 0,
      failed_count: failedResults.length,
      attempt_id: attemptId,
      run_type: runType,
      adjustment_reason: adjustmentReason
    }
  });
  return res.json({
    ok: true,
    status: finalRunStatus,
    payrollRunId,
    start,
    end,
    totalHours: batchHours,  // just this batch, final totals are in payroll_runs table
    totalPay: batchPay,
    results,
    attempt_id: attemptId,
    idempotencyKey,
    fatal_qbo_error: fatalQboError || null,
    warnings: backupWarning ? [backupWarning] : []
  });

  } catch (err) {
    console.error('Create checks error:', err);

    const message = err.message || 'Failed to create checks.';

    if (payrollRunId) {
      await markPayrollRunStatus(orgId, payrollRunId, PAYROLL_STATUS.FAILED, {
        lastError: message,
        idempotencyKey
      });
    }

    // 🔎 Audit log: fatal error
    await logPayrollEvent({
      orgId,
      actor_employee_id: actorEmployeeId,
      event_type: 'PAYROLL_FATAL_ERROR',
      message,
      payroll_run_id: null,
      details: {
        start,
        end,
        stack: err.stack || null
      }
    });

    if (err && err.response) {
      return respondWithQboError(res, err, { orgId });
    }

    if (
      message.includes('required and must be valid') ||
      message.includes('End date must be on or after') ||
      message.includes('exceeds the allowed maximum') ||
      message.includes('already exists for this exact period') ||
      message.includes('overlaps with an existing payroll run')
    ) {
      return res.status(400).json({
        ok: false,
        error: message,
        warnings: backupWarning ? [backupWarning] : []
      });
    }

    return res.status(500).json({
      ok: false,
      error: message,
      warnings: backupWarning ? [backupWarning] : []
    });
  } finally {
    await releasePayrollLock(orgId);
  }
});

app.get('/api/payroll/audit-log', requireAdminAccess(p => p.view_payroll), async (req, res) => {
  try {
    const orgId = req.session && req.session.orgId;
    if (!orgId) {
      return res.status(401).json({ ok: false, error: 'Not authenticated.' });
    }
    const rows = await dbAll(`
      SELECT *
      FROM payroll_audit_log
      WHERE org_id = ?
      ORDER BY created_at DESC
      LIMIT 200
    `, [orgId]);

    res.json({ ok: true, logs: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ───────── 5. VENDORS & EMPLOYEES ───────── */

async function handleVendorUpdate(req, res, { allowPin }) {
  const orgId = req.session && req.session.orgId;
  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ error: 'Invalid vendor id.' });
  }

  const {
    pin,
    allowOverride,
    is_freight_forwarder,
    uses_timekeeping
  } = req.body || {};

  const freightFlag =
    typeof is_freight_forwarder === 'undefined'
      ? null
      : (is_freight_forwarder ? 1 : 0);

  // Vendor timekeeping is not supported; keep this false if sent.
  const timekeepingFlag =
    typeof uses_timekeeping === 'undefined'
      ? null
      : 0;

  try {
    const vendor = await dbGet(
      `
        SELECT id, name, is_freight_forwarder, uses_timekeeping, pin_hash
        FROM vendors
        WHERE id = ? AND org_id = ?
      `,
      [id, orgId]
    );
    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found.' });
    }

    const updates = [];
    const params = [];
    let pinUpdated = false;

    if (freightFlag !== null) {
      updates.push('is_freight_forwarder = ?');
      params.push(freightFlag);
    }
    if (timekeepingFlag !== null) {
      updates.push('uses_timekeeping = ?');
      params.push(timekeepingFlag);
    }

  const pinRaw = typeof pin === 'undefined' ? '' : String(pin || '').trim();
  const hasPin = allowPin && pinRaw.length > 0;
    if (allowPin) {
      if (hasPin) {
        if (!/^\d{4}$/.test(pinRaw)) {
          return res.status(400).json({ error: 'PIN must be a 4-digit number.' });
        }
        const override = allowOverride === true || allowOverride === 'true';
        if (!override && vendor.pin_hash) {
          return res.status(409).json({
            error: 'PIN already set for this vendor. Use allowOverride to change it.'
          });
        }
        const hash = await bcrypt.hash(pinRaw, 10);
        updates.push('pin_hash = ?');
        params.push(hash);
        pinUpdated = true;
      } else if (pin !== undefined && pin !== null && pinRaw === '') {
        return res.status(400).json({ error: 'PIN must be a 4-digit number.' });
      }
    }

    if (!updates.length) {
      return res.json({ ok: true });
    }

    params.push(id, orgId);

    const updateRes = await dbRun(
      `
        UPDATE vendors
        SET ${updates.join(', ')}
        WHERE id = ? AND org_id = ?
      `,
      params
    );

    if (updateRes && updateRes.changes) {
      const updated = await dbGet(
        `
          SELECT id, name, is_freight_forwarder, uses_timekeeping, pin_hash
          FROM vendors
          WHERE id = ? AND org_id = ?
        `,
        [id, orgId]
      );
      const beforeAudit = {
        name: vendor.name || null,
        is_freight_forwarder: vendor.is_freight_forwarder ? 1 : 0,
        uses_timekeeping: vendor.uses_timekeeping ? 1 : 0,
        has_pin: !!vendor.pin_hash
      };
      const afterAudit = updated
        ? {
            name: updated.name || null,
            is_freight_forwarder: updated.is_freight_forwarder ? 1 : 0,
            uses_timekeeping: updated.uses_timekeeping ? 1 : 0,
            has_pin: !!updated.pin_hash
          }
        : { ...beforeAudit };
      await logAuditEvent({
        req,
        orgId,
        action: 'vendor.update',
        entityType: 'vendor',
        entityId: id,
        before: beforeAudit,
        after: afterAudit,
        note: pinUpdated ? 'Vendor PIN updated.' : null
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('Error updating vendor:', err);
    return res.status(500).json({ error: 'Failed to update vendor.' });
  }
}

app.post('/api/vendors/:id', requireViewPayroll, async (req, res) => {
  return handleVendorUpdate(req, res, { allowPin: false });
});

app.post('/api/vendors/:id/pin', requireViewPayroll, async (req, res) => {
  return handleVendorUpdate(req, res, { allowPin: true });
});

app.get('/api/vendors', requireViewPayrollOrSeeShipments, (req, res) => {
  const orgId = req.session && req.session.orgId;
  const status = req.query.status || 'all'; // 'active' | 'inactive' | 'all'

  let where = 'WHERE org_id = ?';
  const params = [orgId];

  if (status === 'active') {
    where += ' AND IFNULL(active, 1) = 1';
  } else if (status === 'inactive') {
    where += ' AND IFNULL(active, 1) = 0';
  }

  const sql = `
    SELECT
      id,
      qbo_id,
      name,
      active,
      is_freight_forwarder,
      uses_timekeeping,
      CASE WHEN pin_hash IS NULL THEN 0 ELSE 1 END AS has_pin
    FROM vendors
    ${where}
    ORDER BY name COLLATE NOCASE
  `;

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.get('/api/employees', requireViewPayroll, (req, res) => {
  const orgId = req.session && req.session.orgId;
  const status = req.query.status || 'active'; // 'active' | 'inactive' | 'all' | 'pending'

  let where = 'WHERE e.org_id = ?';
  const params = [orgId];

  if (status === 'active') {
    where += ' AND IFNULL(e.active, 1) = 1';
  } else if (status === 'inactive') {
    where += ' AND IFNULL(e.active, 1) = 0';
  } else if (status === 'pending') {
    where +=
      ` AND IFNULL(e.active, 1) = 1
        AND (
          ((e.employee_qbo_id IS NULL OR e.employee_qbo_id = '')
            AND (e.vendor_qbo_id IS NULL OR e.vendor_qbo_id = ''))
          OR e.needs_qbo_sync = 1
          OR IFNULL(e.qbo_dirty_fields_json, '') NOT IN ('', '[]')
          OR IFNULL(e.qbo_conflict_fields_json, '') NOT IN ('', '[]')
        )`;
  }

  const sql = `
    SELECT
      e.id,
      e.employee_qbo_id,
      e.vendor_qbo_id,
      e.name,
      e.given_name,
      e.family_name,
      e.nickname,
      e.name_on_checks,
      e.rate,
      e.role_title,
      e.permission_template_id,
      e.worker_timekeeping,
      e.desktop_access,
      e.kiosk_admin_access,
      e.email,
      e.phone,
      e.language,
      e.needs_qbo_sync,
      e.qbo_dirty_fields_json,
      e.qbo_dirty_updated_at,
      e.qbo_dirty_by_employee_id,
      e.qbo_dirty_source,
      e.qbo_conflict_fields_json,
      e.qbo_conflict_updated_at,
      e.active,
      e.name_on_checks_updated_at,
      e.name_on_checks_qbo_updated_at,
      e.id_document_type,
      e.id_document_uploaded_at,
      e.employee_photo_uploaded_at,
      q.last_error AS name_on_checks_qbo_error,
      CASE
        WHEN q.created_at IS NOT NULL
          AND q.created_at < datetime('now', '-7 days')
        THEN 1
        ELSE 0
      END AS name_on_checks_qbo_warning,
      CASE WHEN e.pin_hash IS NULL THEN 0 ELSE 1 END AS has_pin,
      p.see_shipments,
      p.modify_time,
      p.approve_time,
      p.view_time_reports,
      p.view_all_timesheets,
      p.assign_timesheets,
      p.view_payroll,
      p.modify_payroll,
      p.modify_pay_rates,
      CASE
        WHEN uo.is_super_admin = 1 AND IFNULL(uo.login_enabled, 0) = 1 THEN 1
        ELSE 0
      END AS is_super_admin,
      ed.name AS qbo_dirty_by_name
    FROM employees e
    LEFT JOIN employee_permissions p
      ON p.employee_id = e.id
    LEFT JOIN user_orgs uo
      ON uo.employee_id = e.id
     AND uo.org_id = e.org_id
    LEFT JOIN name_on_checks_queue q
      ON q.org_id = e.org_id AND q.employee_id = e.id
    LEFT JOIN employees ed
      ON ed.id = e.qbo_dirty_by_employee_id
    ${where}
    ORDER BY e.name COLLATE NOCASE
  `;

  db.all(sql, params, async (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const resultRows = rows || [];
    resultRows.forEach(row => {
      if (isTruthyFlag(row.is_super_admin)) {
        applySuperAdminPermsToRow(row);
      }
    });
    if (status !== 'pending' || !resultRows.length) {
      return res.json(resultRows);
    }

    try {
      const qboRows = await dbAll(
        `
          SELECT
            id,
            employee_qbo_id,
            name,
            given_name,
            family_name,
            name_on_checks
          FROM employees
          WHERE org_id = ?
            AND employee_qbo_id IS NOT NULL
            AND employee_qbo_id != ''
        `,
        [orgId]
      );

      const index = new Map();
      for (const qboEmp of qboRows || []) {
        const qboName =
          [normalizeString(qboEmp.given_name), normalizeString(qboEmp.family_name)]
            .filter(Boolean)
            .join(' ')
            .trim() ||
          normalizeString(qboEmp.name) ||
          normalizeString(qboEmp.name_on_checks) ||
          null;
        if (!qboName) continue;
        const keys = buildNameMatchKeys(qboName);
        keys.forEach(key => {
          if (!key) return;
          const list = index.get(key) || [];
          list.push({
            employee_qbo_id: String(qboEmp.employee_qbo_id),
            name: qboName
          });
          index.set(key, list);
        });
      }

      resultRows.forEach(emp => {
        if (emp.employee_qbo_id || emp.vendor_qbo_id) {
          emp.qbo_suggestions = [];
          return;
        }
        const localName =
          [normalizeString(emp.given_name), normalizeString(emp.family_name)]
            .filter(Boolean)
            .join(' ')
            .trim() ||
          normalizeString(emp.name) ||
          null;
        if (!localName) {
          emp.qbo_suggestions = [];
          return;
        }

        const localNormalized = normalizeMatchName(localName);
        const keys = buildNameMatchKeys(localName);
        const candidates = new Map();
        keys.forEach(key => {
          const list = index.get(key) || [];
          list.forEach(item => {
            if (!item || !item.employee_qbo_id) return;
            if (!candidates.has(item.employee_qbo_id)) {
              candidates.set(item.employee_qbo_id, item);
            }
          });
        });

        const suggestions = Array.from(candidates.values()).map(item => {
          const candidateNormalized = normalizeMatchName(item.name);
          const confidence =
            localNormalized && candidateNormalized && localNormalized === candidateNormalized
              ? 'strong'
              : 'possible';
          return {
            employee_qbo_id: item.employee_qbo_id,
            name: item.name,
            confidence
          };
        });

        suggestions.sort((a, b) => {
          if (a.confidence !== b.confidence) {
            return a.confidence === 'strong' ? -1 : 1;
          }
          return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
        });

        emp.qbo_suggestions = suggestions.slice(0, 2);
      });
    } catch (suggestErr) {
      console.warn('Failed to compute QBO suggestions:', suggestErr.message || suggestErr);
      resultRows.forEach(emp => {
        emp.qbo_suggestions = [];
      });
    }

    return res.json(resultRows);
  });
});

// Public kiosk-friendly list (device auth or admin session; limited fields)
app.get('/api/kiosk/employees', async (req, res) => {
  const access = await ensureKioskDevice(req);
  if (!access.ok) {
    return res
      .status(access.status || 401)
      .json({ error: access.error || 'Not authenticated' });
  }

  const orgId =
    access.via === 'session'
      ? req.session && req.session.orgId
      : access.kiosk && access.kiosk.org_id;

  const sql = `
    SELECT
      id,
      name,
      name_on_checks,
      nickname,
      language,
      worker_timekeeping,
      kiosk_admin_access,
      pin_hash,
      p.see_shipments,
      p.modify_time,
      p.approve_time,
      p.view_time_reports,
      p.view_all_timesheets,
      p.assign_timesheets,
      p.view_payroll,
      p.modify_pay_rates
    FROM employees
    LEFT JOIN employee_permissions p
      ON p.employee_id = employees.id
    WHERE org_id = ?
      AND IFNULL(active, 1) = 1
      AND (
        IFNULL(worker_timekeeping, 0) = 1
        OR IFNULL(kiosk_admin_access, 0) = 1
      )
    ORDER BY name COLLATE NOCASE
  `;

  db.all(sql, [orgId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// Kiosk admin list with extended fields (admin-only)
app.get('/api/kiosk/admin/employees', async (req, res) => {
  const adminCtx = await resolveKioskAdmin(req);
  if (!adminCtx.ok) {
    return res
      .status(adminCtx.status || 401)
      .json({ error: adminCtx.error || 'Not authenticated' });
  }

  const orgId = adminCtx.orgId;
  const sql = `
    SELECT
      e.id,
      e.name,
      e.given_name,
      e.family_name,
      e.name_on_checks,
      e.nickname,
      e.email,
      e.rate,
      e.phone,
      e.language,
      e.worker_timekeeping,
      e.kiosk_admin_access,
      e.desktop_access,
      e.pin_hash,
      e.needs_qbo_sync,
      e.employee_qbo_id,
      e.vendor_qbo_id,
      e.active,
      e.id_document_type,
      e.id_document_uploaded_at,
      e.employee_photo_uploaded_at,
      e.start_date,
      e.termination_date,
      p.see_shipments,
      p.modify_time,
      p.approve_time,
      p.view_time_reports,
      p.view_all_timesheets,
      p.assign_timesheets,
      p.view_payroll,
      p.modify_pay_rates,
      CASE
        WHEN uo.is_super_admin = 1 AND IFNULL(uo.login_enabled, 0) = 1 THEN 1
        ELSE 0
      END AS is_super_admin
    FROM employees e
    LEFT JOIN employee_permissions p
      ON p.employee_id = e.id
    LEFT JOIN user_orgs uo
      ON uo.employee_id = e.id
     AND uo.org_id = e.org_id
    WHERE e.org_id = ?
    ORDER BY e.name COLLATE NOCASE
  `;

  db.all(sql, [orgId], async (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    try {
      const resultRows = rows || [];
      resultRows.forEach(row => {
        if (isTruthyFlag(row.is_super_admin)) {
          applySuperAdminPermsToRow(row);
        }
      });
      const perms = await getAdminAccessPerms({
        employeeId: adminCtx.adminId,
        orgId
      });
      const canViewPayroll = !!(perms && perms.view_payroll);
      if (canViewPayroll) {
        return res.json(resultRows);
      }
      const sanitized = resultRows.map(row => {
        const { rate, ...rest } = row;
        return rest;
      });
      return res.json(sanitized);
    } catch (permErr) {
      console.error('Error loading kiosk admin permissions:', permErr);
      return res.json(rows || []);
    }
  });
});

// Kiosk admin PIN verification (device auth or admin session)
app.post('/api/kiosk/admin/verify-pin', kioskPinRateLimiter, async (req, res) => {
  try {
    const adminCtx = await resolveKioskAdmin(req);
    if (!adminCtx.ok) {
      return res
        .status(adminCtx.status || 401)
        .json({ error: adminCtx.error || 'Not authenticated' });
    }

    const pin = (req.body && req.body.pin ? String(req.body.pin) : '').trim();
    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be a 4-digit number.' });
    }

    const admin = await dbGet(
      `
        SELECT id, pin_hash
        FROM employees
        WHERE id = ? AND org_id = ? AND IFNULL(kiosk_admin_access, 0) = 1
          AND IFNULL(active, 1) = 1
        LIMIT 1
      `,
      [adminCtx.adminId, adminCtx.orgId]
    );

    if (!admin) {
      return res.status(404).json({ error: 'Admin not found or not authorized.' });
    }
    if (!admin.pin_hash) {
      return res.status(403).json({ error: 'No PIN is set for this admin.' });
    }

    const pinOk = await bcrypt.compare(pin, admin.pin_hash);
    if (!pinOk) {
      return res.status(401).json({ error: 'Incorrect PIN.' });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('Error verifying kiosk admin PIN:', err);
    return res.status(500).json({ error: 'Failed to verify PIN.' });
  }
});

// Kiosk admin account info (mapped to the logged-in admin)
app.get('/api/kiosk/admin/account', async (req, res) => {
  try {
    const ctx = await resolveKioskAdminAccount(req);
    if (!ctx.ok) {
      return res.status(ctx.status || 403).json({ error: ctx.error || 'Not authorized' });
    }

    return res.json({
      ok: true,
      user: { id: ctx.user.id, email: ctx.user.email },
      employee: { id: ctx.employee.id, name: ctx.employee.name || '' }
    });
  } catch (err) {
    console.error('Error loading kiosk admin account:', err);
    return res.status(500).json({ error: 'Failed to load account.' });
  }
});

// Kiosk admin: update login email (current admin only)
app.post('/api/kiosk/admin/account/email', async (req, res) => {
  const { current_password, new_email } = req.body || {};

  if (!current_password || !new_email) {
    return res
      .status(400)
      .json({ error: 'Current password and new email are required.' });
  }

  const normEmail = normalizeEmail(new_email);
  if (!normEmail) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  try {
    const ctx = await resolveKioskAdminAccount(req);
    if (!ctx.ok) {
      return res.status(ctx.status || 403).json({ error: ctx.error || 'Not authorized' });
    }

    const matches = await bcrypt.compare(current_password, ctx.user.password_hash);
    if (!matches) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    if (normalizeEmail(ctx.user.email) === normEmail) {
      return res.json({ ok: true, email: ctx.user.email });
    }

    const existing = await dbGet(
      'SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id <> ?',
      [normEmail, ctx.user.id]
    );
    if (existing) {
      return res.status(409).json({ error: 'Email already in use.' });
    }

    await dbRun('UPDATE users SET email = ? WHERE id = ?', [normEmail, ctx.user.id]);
    await logAuditEvent({
      orgId: ctx.orgId,
      action: 'auth.email.change',
      entityType: 'user',
      entityId: ctx.user.id,
      actorUserId: ctx.user.id,
      actorEmployeeId: ctx.employee.id,
      before: { email: ctx.user.email },
      after: { email: normEmail }
    });
    return res.json({ ok: true, email: normEmail });
  } catch (err) {
    console.error('Kiosk admin change email error:', err);
    return res.status(500).json({ error: 'Failed to update email.' });
  }
});

// Kiosk admin: update login password (current admin only)
app.post('/api/kiosk/admin/account/password', async (req, res) => {
  const { current_password, new_password } = req.body || {};

  if (!current_password || !new_password) {
    return res
      .status(400)
      .json({ error: 'Current password and new password are required.' });
  }
  const passwordErr = validatePassword(new_password);
  if (passwordErr) {
    return res.status(400).json({ error: passwordErr });
  }

  try {
    const ctx = await resolveKioskAdminAccount(req);
    if (!ctx.ok) {
      return res.status(ctx.status || 403).json({ error: ctx.error || 'Not authorized' });
    }

    const matches = await bcrypt.compare(current_password, ctx.user.password_hash);
    if (!matches) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    const newHash = await bcrypt.hash(new_password, 10);
    await dbRun(
      `
        UPDATE users
        SET
          password_hash = ?,
          password_reset_token_hash = NULL,
          password_reset_token_expires_at = NULL,
          password_reset_token_used_at = NULL,
          password_reset_token_created_at = NULL,
          password_reset_token_created_by = NULL,
          password_reset_org_id = NULL
        WHERE id = ?
      `,
      [newHash, ctx.user.id]
    );
    await logAuditEvent({
      orgId: ctx.orgId,
      action: 'auth.password.change',
      entityType: 'user',
      entityId: ctx.user.id,
      actorUserId: ctx.user.id,
      actorEmployeeId: ctx.employee.id
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('Kiosk admin change password error:', err);
    return res.status(500).json({ error: 'Failed to update password.' });
  }
});

// Kiosk admin: create a pending employee with optional ID + photo uploads
app.post(
  '/api/kiosk/employees',
  wrapUpload(
    uploadEmployeeMedia.fields([
      { name: 'id_document', maxCount: 1 },
      { name: 'employee_photo', maxCount: 1 }
    ])
  ),
  async (req, res) => {
    const idFile = req.files && req.files.id_document ? req.files.id_document[0] : null;
    const photoFile = req.files && req.files.employee_photo ? req.files.employee_photo[0] : null;
    const uploadedFiles = [];
    if (idFile) uploadedFiles.push(idFile);
    if (photoFile) uploadedFiles.push(photoFile);

    const cleanupFiles = async () => {
      await cleanupUploadedFiles(uploadedFiles);
    };

    try {
      const adminCtx = await resolveKioskAdmin(req);
      if (!adminCtx.ok) {
        await cleanupFiles();
        return res
          .status(adminCtx.status || 401)
          .json({ error: adminCtx.error || 'Not authenticated' });
      }

      const name = String(req.body?.name || '').trim();
      if (!name) {
        await cleanupFiles();
        return res.status(400).json({ error: 'Name is required.' });
      }

      const derivedNames = splitName(name);
      const givenName = normalizeString(derivedNames.given);
      const familyName = normalizeString(derivedNames.family);

      const nickname = String(req.body?.nickname || '').trim() || null;
      const rawLang = String(req.body?.language || '').trim().toLowerCase();
      const allowedLanguages = ['en', 'es', 'ht'];
      const language = allowedLanguages.includes(rawLang) ? rawLang : 'en';

      const idType = String(req.body?.id_document_type || '').trim();
      const allowedTypes = new Set(['drivers_license', 'passport', 'other']);
      const hasIdFile = !!idFile;
      const hasIdType = !!idType;
      if (hasIdType && !allowedTypes.has(idType)) {
        await cleanupFiles();
        return res.status(400).json({
          error: 'id_document_type must be drivers_license, passport, or other.'
        });
      }
      if (hasIdFile && !hasIdType) {
        await cleanupFiles();
        return res.status(400).json({ error: 'Select an ID type for the uploaded ID.' });
      }
      if (hasIdType && !hasIdFile) {
        await cleanupFiles();
        return res.status(400).json({ error: 'Upload an ID image or clear the ID type.' });
      }

      try {
        if (idFile) {
          const result = await validateStoredUpload(idFile.path, idAllowedMimes, idAllowedExts);
          if (!result.ok) {
            await cleanupFiles();
            return res.status(400).json({ error: result.error || 'Unsupported file type.' });
          }
        }
        if (photoFile) {
          const result = await validateStoredUpload(photoFile.path, photoAllowedMimes, photoAllowedExts);
          if (!result.ok) {
            await cleanupFiles();
            return res.status(400).json({ error: result.error || 'Unsupported file type.' });
          }
        }
      } catch (err) {
        await cleanupFiles();
        return res.status(400).json({ error: err.message || 'Unsupported file type.' });
      }

      const idRelativePath = idFile ? `employee_ids/${idFile.filename}` : null;
      const photoRelativePath = photoFile ? `employee_photos/${photoFile.filename}` : null;
      const orgId = adminCtx.orgId;
      const uploadedAt = new Date().toISOString();
      const idUploadedAt = idFile ? uploadedAt : null;
      const photoUploadedAt = photoFile ? uploadedAt : null;

      const insertRes = await dbRun(
        `
          INSERT INTO employees (
            org_id,
            name,
            given_name,
            family_name,
            nickname,
            language,
            active,
            worker_timekeeping,
            desktop_access,
            kiosk_admin_access,
            needs_qbo_sync,
            id_document_type,
            id_document_path,
            id_document_uploaded_at,
            id_document_uploaded_by,
            employee_photo_path,
            employee_photo_uploaded_at,
            employee_photo_uploaded_by
          ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, 0, 0, 1, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          orgId,
          name,
          givenName,
          familyName,
          nickname,
          language,
          idFile ? idType : null,
          idRelativePath,
          idUploadedAt,
          idFile ? adminCtx.adminId : null,
          photoRelativePath,
          photoUploadedAt,
          photoFile ? adminCtx.adminId : null
        ]
      );

      const employeeId = insertRes.lastID;
      if ((employeeQboId || vendorQboId) && (finalGiven || finalFamily || nameOnChecks)) {
        const dirtyFields = [];
        if (finalGiven) dirtyFields.push('given_name');
        if (finalFamily) dirtyFields.push('family_name');
        if (nameOnChecks) dirtyFields.push('name_on_checks');
        if (dirtyFields.length) {
          await markEmployeeQboDirty({
            orgId,
            employeeId,
            fields: dirtyFields,
            actorEmployeeId: req.session && req.session.employeeId ? req.session.employeeId : null,
            source: 'desktop'
          });
        }
      }

      await dbRun(
        `
          INSERT INTO employee_permissions (
            employee_id,
            see_shipments,
            modify_time,
            approve_time,
            view_time_reports,
            view_all_timesheets,
            assign_timesheets,
            view_payroll,
            modify_payroll,
            modify_pay_rates
          ) VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0, 0)
          ON CONFLICT(employee_id) DO NOTHING
        `,
        [employeeId]
      );

      await logEmployeeAuditUpdate({
        req,
        orgId,
        employeeId,
        action: 'employee.create',
        note: 'Employee created via kiosk enrollment.',
        actorEmployeeId: adminCtx.adminId || null
      });

      if (idFile) {
        await logAuditEvent({
          req,
          orgId,
          action: 'employee.id_document.upload',
          entityType: 'employee',
          entityId: employeeId,
          actorEmployeeId: adminCtx.adminId || null,
          after: {
            id_document_type: idType || null,
            uploaded_at: idUploadedAt
          },
          note: 'ID document uploaded via kiosk enrollment.'
        });
      }

      if (photoFile) {
        await logAuditEvent({
          req,
          orgId,
          action: 'employee.photo.upload',
          entityType: 'employee',
          entityId: employeeId,
          actorEmployeeId: adminCtx.adminId || null,
          after: {
            uploaded_at: photoUploadedAt
          },
          note: 'Employee photo uploaded via kiosk enrollment.'
        });
      }

      return res.json({ ok: true, id: employeeId, needs_qbo_sync: 1 });
    } catch (err) {
      console.error('Error creating kiosk employee:', err);
      await cleanupFiles();
      return res.status(500).json({ error: 'Failed to create employee.' });
    }
  }
);

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

async function resolveKioskRateContext(req) {
  const deviceAccess = await ensureKioskDevice(req);
  if (!deviceAccess.ok) return deviceAccess;

  const orgId =
    deviceAccess.via === 'session'
      ? req.session && req.session.orgId
      : deviceAccess.kiosk && deviceAccess.kiosk.org_id;
  if (!orgId) {
    return { ok: false, status: 403, error: 'Not authorized.' };
  }

  const adminId = req.session && req.session.kioskRateAdminId;
  if (!isRateUnlockValid(req, adminId)) {
    return { ok: false, status: 403, error: 'Rates access is locked.' };
  }

  const deviceId = deviceAccess.kiosk && deviceAccess.kiosk.device_id
    ? String(deviceAccess.kiosk.device_id)
    : '';
  const sessionDeviceId = req.session && req.session.kioskRateDeviceId
    ? String(req.session.kioskRateDeviceId)
    : '';
  if (deviceId && sessionDeviceId && deviceId !== sessionDeviceId) {
    return { ok: false, status: 403, error: 'Rates access is locked.' };
  }

  const admin = await dbGet(
    `
      SELECT id
      FROM employees
      WHERE id = ? AND org_id = ? AND IFNULL(kiosk_admin_access, 0) = 1
        AND IFNULL(active, 1) = 1
      LIMIT 1
    `,
    [adminId, orgId]
  );
  if (!admin) {
    return { ok: false, status: 403, error: 'Admin not authorized.' };
  }

  const perms = await getAdminAccessPerms({ employeeId: adminId, orgId });
  if (!perms.modify_pay_rates || !perms.view_payroll) {
    return { ok: false, status: 403, error: 'This admin cannot modify pay rates.' };
  }

  return { ok: true, orgId, adminId, perms };
}

function parseTemplateJson(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeTemplateAccess(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    worker_timekeeping: input.worker_timekeeping === true || input.worker_timekeeping === 1 || input.worker_timekeeping === '1' || input.worker_timekeeping === 'true',
    desktop_access: input.desktop_access === true || input.desktop_access === 1 || input.desktop_access === '1' || input.desktop_access === 'true',
    kiosk_admin_access: input.kiosk_admin_access === true || input.kiosk_admin_access === 1 || input.kiosk_admin_access === '1' || input.kiosk_admin_access === 'true'
  };
}

function normalizeTemplatePerms(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const normalized = {
    see_shipments: input.see_shipments === true || input.see_shipments === 1 || input.see_shipments === '1' || input.see_shipments === 'true',
    modify_time: input.modify_time === true || input.modify_time === 1 || input.modify_time === '1' || input.modify_time === 'true',
    approve_time: input.approve_time === true || input.approve_time === 1 || input.approve_time === '1' || input.approve_time === 'true',
    view_time_reports: input.view_time_reports === true || input.view_time_reports === 1 || input.view_time_reports === '1' || input.view_time_reports === 'true',
    view_all_timesheets: input.view_all_timesheets === true || input.view_all_timesheets === 1 || input.view_all_timesheets === '1' || input.view_all_timesheets === 'true',
    assign_timesheets: input.assign_timesheets === true || input.assign_timesheets === 1 || input.assign_timesheets === '1' || input.assign_timesheets === 'true',
    view_payroll: input.view_payroll === true || input.view_payroll === 1 || input.view_payroll === '1' || input.view_payroll === 'true',
    modify_payroll: input.modify_payroll === true || input.modify_payroll === 1 || input.modify_payroll === '1' || input.modify_payroll === 'true',
    modify_pay_rates: input.modify_pay_rates === true || input.modify_pay_rates === 1 || input.modify_pay_rates === '1' || input.modify_pay_rates === 'true'
  };
  if (normalized.approve_time) {
    normalized.modify_time = true;
  }
  if (normalized.modify_pay_rates || normalized.modify_payroll) {
    normalized.view_payroll = true;
  }
  return normalized;
}

async function loadPermissionTemplate(orgId, templateId) {
  if (!orgId || !templateId) return null;
  const row = await dbGet(
    `
      SELECT id, org_id, name, role_title, access_json, permissions_json
      FROM permission_templates
      WHERE id = ? AND org_id = ?
      LIMIT 1
    `,
    [templateId, orgId]
  );
  if (!row) return null;
  const access = normalizeTemplateAccess(parseTemplateJson(row.access_json));
  const permissions = normalizeTemplatePerms(parseTemplateJson(row.permissions_json));
  return {
    id: row.id,
    name: row.name,
    role_title: row.role_title,
    access,
    permissions
  };
}

// Re-auth a kiosk admin (by PIN) to unlock rate editing, gated by access permissions
app.post('/api/kiosk/rates/unlock', kioskPinRateLimiter, async (req, res) => {
  try {
    const deviceAccess = await ensureKioskDevice(req);
    if (!deviceAccess.ok) {
      return res
        .status(deviceAccess.status || 401)
        .json({ error: deviceAccess.error || 'Not authenticated' });
    }

    const orgId =
      deviceAccess.via === 'session'
        ? req.session && req.session.orgId
        : deviceAccess.kiosk && deviceAccess.kiosk.org_id;
    if (!orgId) {
      return res.status(403).json({ error: 'Not authorized.' });
    }

    const adminId = req.body && req.body.admin_id ? Number(req.body.admin_id) : null;
    const pin = (req.body && req.body.pin ? String(req.body.pin) : '').trim();

    if (!adminId || !pin) {
      return res.status(400).json({ error: 'Admin id and PIN are required.' });
    }

    const admin = await dbGet(
      `
        SELECT id, name, pin_hash, kiosk_admin_access
        FROM employees
        WHERE id = ? AND org_id = ? AND IFNULL(kiosk_admin_access, 0) = 1
          AND IFNULL(active, 1) = 1
        LIMIT 1
      `,
      [adminId, orgId]
    );

    if (!admin) {
      return res.status(404).json({ error: 'Admin not found or not authorized.' });
    }

    const perms = await getAdminAccessPerms({ employeeId: admin.id, orgId });
    if (!perms.modify_pay_rates || !perms.view_payroll) {
      return res.status(403).json({ error: 'This admin cannot modify pay rates.' });
    }

    if (!admin.pin_hash) {
      return res.status(403).json({ error: 'No PIN is set for this admin.' });
    }
    const pinOk = await bcrypt.compare(pin, admin.pin_hash);
    if (!pinOk) {
      return res.status(401).json({ error: 'Incorrect PIN.' });
    }

    if (req.session) {
      req.session.kioskRateAdminId = admin.id;
      req.session.kioskRateUnlockedAt = Date.now();
      if (deviceAccess.kiosk && deviceAccess.kiosk.device_id) {
        req.session.kioskRateDeviceId = deviceAccess.kiosk.device_id;
      }
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
    const ctx = await resolveKioskRateContext(req);
    if (!ctx.ok) {
      return res
        .status(ctx.status || 403)
        .json({ error: ctx.error || 'Not authorized.' });
    }
    const orgId = ctx.orgId;

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
        WHERE org_id = ?
          AND IFNULL(active, 1) = 1
        ORDER BY name COLLATE NOCASE
      `,
      [orgId]
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
    const ctx = await resolveKioskRateContext(req);
    if (!ctx.ok) {
      return res
        .status(ctx.status || 403)
        .json({ error: ctx.error || 'Not authorized.' });
    }
    const orgId = ctx.orgId;

    const id = Number(req.params.id);
    const rate = req.body && req.body.rate !== undefined ? Number(req.body.rate) : null;
    if (!id || rate === null || Number.isNaN(rate)) {
      return res.status(400).json({ error: 'Valid rate is required.' });
    }

    const beforeRow = await dbGet(
      'SELECT rate FROM employees WHERE id = ? AND org_id = ?',
      [id, orgId]
    );

    const updateRes = await dbRun(
      'UPDATE employees SET rate = ? WHERE id = ? AND org_id = ?',
      [rate, id, orgId]
    );
    if (updateRes.changes === 0) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    // Refresh the unlock timer after a successful update
    req.session.kioskRateUnlockedAt = Date.now();

    await logAuditEvent({
      req,
      orgId,
      action: 'employee.rate.change',
      entityType: 'employee',
      entityId: id,
      actorEmployeeId: ctx.adminId || null,
      before: { rate: beforeRow ? beforeRow.rate : null },
      after: { rate }
    });

    res.json({ ok: true, rate });
  } catch (err) {
    console.error('Error updating rate from kiosk:', err);
    res.status(500).json({ error: 'Failed to update rate.' });
  }
});

app.post('/api/employees', requireViewPayroll, async (req, res) => {
  try {
    const orgId = req.session && req.session.orgId;
    const isSuperAdmin = req.session && req.session.isSuperAdmin;
    const body = req.body || {};
    const hasField = key => Object.prototype.hasOwnProperty.call(body, key);

    const id = body.id ? Number(body.id) : null;
    const name = hasField('name') ? String(body.name || '').trim() : null;
    const givenName = hasField('given_name') ? String(body.given_name || '').trim() : null;
    const familyName = hasField('family_name') ? String(body.family_name || '').trim() : null;
    const nickname = hasField('nickname') ? String(body.nickname || '').trim() : null;
    const nameOnChecks = hasField('name_on_checks')
      ? String(body.name_on_checks || '').trim()
      : null;
    const email = hasField('email') ? String(body.email || '').trim() : null;
    const phone = hasField('phone') ? String(body.phone || '').trim() : null;
    const startDate = hasField('start_date') ? String(body.start_date || '').trim() : null;
    const terminationDate = hasField('termination_date')
      ? String(body.termination_date || '').trim()
      : null;
    const rawRate = hasField('rate') ? body.rate : undefined;
    const rateValue =
      rawRate === undefined || rawRate === null || rawRate === ''
        ? null
        : Number(rawRate);

    const allowedLanguages = ['en', 'es', 'ht'];
    const normalizedLanguage = hasField('language')
      ? (() => {
          const raw = (body.language || '').toString().trim().toLowerCase();
          return allowedLanguages.includes(raw) ? raw : 'en';
        })()
      : null;

    const employeeQboId = hasField('employee_qbo_id')
      ? String(body.employee_qbo_id || '').trim() || null
      : undefined;
    const vendorQboId = hasField('vendor_qbo_id')
      ? String(body.vendor_qbo_id || '').trim() || null
      : undefined;

    const roleTitleProvided = hasField('role_title');
    const roleTitleRaw = roleTitleProvided ? String(body.role_title || '').trim() : null;

    const templateFieldProvided = hasField('permission_template_id');
    const templateRaw = templateFieldProvided ? body.permission_template_id : null;
    let templateId = null;
    if (templateFieldProvided) {
      if (templateRaw === null || templateRaw === '' || templateRaw === 0 || templateRaw === '0') {
        templateId = null;
      } else {
        const parsed = Number(templateRaw);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return res.status(400).json({ error: 'permission_template_id must be a valid id.' });
        }
        templateId = parsed;
      }
    }

    const accessFieldProvided =
      hasField('worker_timekeeping') ||
      hasField('desktop_access') ||
      hasField('kiosk_admin_access');
    const permFieldProvided =
      hasField('see_shipments') ||
      hasField('modify_time') ||
      hasField('approve_time') ||
      hasField('view_time_reports') ||
      hasField('view_all_timesheets') ||
      hasField('assign_timesheets') ||
      hasField('view_payroll') ||
      hasField('modify_payroll') ||
      hasField('modify_pay_rates');

    if (!isSuperAdmin && (accessFieldProvided || permFieldProvided || templateFieldProvided || roleTitleProvided)) {
      return res.status(403).json({ error: 'Super admin access required.' });
    }

    const perms = await getAdminAccessPerms({
      employeeId: req.session && req.session.employeeId,
      orgId
    });
    const canModifyRates = perms.modify_pay_rates === true;

    const toFlag = value => (value === true || value === 'true' || value === 1 || value === '1' ? 1 : 0);

    const template = templateId ? await loadPermissionTemplate(orgId, templateId) : null;
    if (templateId && !template) {
      return res.status(404).json({ error: 'Permission template not found.' });
    }

    const workerTimekeeping = hasField('worker_timekeeping')
      ? toFlag(body.worker_timekeeping)
      : template
        ? (template.access.worker_timekeeping ? 1 : 0)
        : null;
    const desktopAccess = hasField('desktop_access')
      ? toFlag(body.desktop_access)
      : template
        ? (template.access.desktop_access ? 1 : 0)
        : null;
    const kioskAdminAccess = hasField('kiosk_admin_access')
      ? toFlag(body.kiosk_admin_access)
      : template
        ? (template.access.kiosk_admin_access ? 1 : 0)
        : null;

    let permPayload = template ? { ...template.permissions } : null;
    if (permFieldProvided) {
      permPayload = {
        see_shipments: toFlag(body.see_shipments),
        modify_time: toFlag(body.modify_time),
        approve_time: toFlag(body.approve_time),
        view_time_reports: toFlag(body.view_time_reports),
        view_all_timesheets: toFlag(body.view_all_timesheets),
        assign_timesheets: toFlag(body.assign_timesheets),
        view_payroll: toFlag(body.view_payroll),
        modify_payroll: toFlag(body.modify_payroll),
        modify_pay_rates: toFlag(body.modify_pay_rates)
      };
    }
    if (permPayload && permPayload.approve_time) {
      permPayload.modify_time = 1;
    }

    const roleTitle = roleTitleProvided
      ? (roleTitleRaw || null)
      : (template && (template.role_title || template.name)) ? (template.role_title || template.name) : null;

    if (!id) {
      const derived = (!givenName && !familyName) ? splitName(name) : { given: givenName, family: familyName };
      const finalGiven = normalizeString(derived.given);
      const finalFamily = normalizeString(derived.family);
      const displayName = [finalGiven, finalFamily].filter(Boolean).join(' ').trim() || name;
      if (!displayName) {
        return res.status(400).json({ error: 'Name is required.' });
      }
      if (rateValue === null || Number.isNaN(rateValue)) {
        return res.status(400).json({ error: 'A numeric rate is required.' });
      }
      if (!canModifyRates) {
        return res.status(403).json({
          error: 'You do not have permission to set pay rates for new employees.'
        });
      }

      if (employeeQboId) {
        const dup = await dbGet(
          `
            SELECT id, name
            FROM employees
            WHERE org_id = ? AND employee_qbo_id = ?
            LIMIT 1
          `,
          [orgId, employeeQboId]
        );
        if (dup) {
          return res.status(409).json({
            error: 'QBO ID already linked.',
            linked_employee_id: dup.id,
            linked_employee_name: dup.name
          });
        }
      }
      if (vendorQboId) {
        const dup = await dbGet(
          `
            SELECT id, name
            FROM employees
            WHERE org_id = ? AND vendor_qbo_id = ?
            LIMIT 1
          `,
          [orgId, vendorQboId]
        );
        if (dup) {
          return res.status(409).json({
            error: 'QBO ID already linked.',
            linked_employee_id: dup.id,
            linked_employee_name: dup.name
          });
        }
      }

      const needsQboSync = employeeQboId || vendorQboId ? 0 : 1;

      const insertRes = await dbRun(
        `
          INSERT INTO employees (
            org_id,
            name,
            given_name,
            family_name,
            nickname,
            name_on_checks,
            rate,
            active,
            employee_qbo_id,
            vendor_qbo_id,
            email,
            phone,
            language,
            role_title,
            permission_template_id,
            needs_qbo_sync,
            worker_timekeeping,
            desktop_access,
            kiosk_admin_access,
            name_on_checks_updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          orgId,
          displayName,
          finalGiven,
          finalFamily,
          nickname || null,
          nameOnChecks || null,
          rateValue,
          employeeQboId || null,
          vendorQboId || null,
          email || null,
          phone || null,
          normalizedLanguage || 'en',
          roleTitle,
          templateFieldProvided ? templateId : null,
          needsQboSync ? 1 : 0,
          workerTimekeeping !== null ? workerTimekeeping : 1,
          desktopAccess !== null ? desktopAccess : 0,
          kioskAdminAccess !== null ? kioskAdminAccess : 0,
          nameOnChecks ? new Date().toISOString() : null
        ]
      );

      const employeeId = insertRes.lastID;
      await dbRun(
        `
        INSERT INTO employee_permissions (
          employee_id,
          see_shipments,
          modify_time,
          approve_time,
          view_time_reports,
          view_all_timesheets,
          assign_timesheets,
          view_payroll,
          modify_payroll,
          modify_pay_rates
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        employeeId,
        permPayload ? permPayload.see_shipments : 0,
        permPayload ? permPayload.modify_time : 0,
        permPayload ? permPayload.approve_time : 0,
        permPayload ? permPayload.view_time_reports : 0,
        permPayload ? permPayload.view_all_timesheets : 0,
        permPayload ? permPayload.assign_timesheets : 0,
        permPayload ? (permPayload.view_payroll || permPayload.modify_payroll || permPayload.modify_pay_rates ? 1 : 0) : 0,
        permPayload ? permPayload.modify_payroll : 0,
        permPayload ? permPayload.modify_pay_rates : 0
      ]
    );

      const auditSnapshot = await loadEmployeeAuditSnapshot({ orgId, employeeId });
      await logAuditEvent({
        req,
        orgId,
        action: 'employee.create',
        entityType: 'employee',
        entityId: employeeId,
        after: auditSnapshot
      });

      return res.json({ ok: true, id: employeeId, needs_qbo_sync: needsQboSync });
    }

    const existing = await dbGet(
      `
        SELECT
          id,
          name,
          given_name,
          family_name,
          rate,
          employee_qbo_id,
          vendor_qbo_id,
          name_on_checks,
          needs_qbo_sync,
          qbo_dirty_fields_json
        FROM employees
        WHERE id = ? AND org_id = ?
      `,
      [id, orgId]
    );
    if (!existing) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const beforeAudit = await loadEmployeeAuditSnapshot({ orgId, employeeId: id });

    const targetIsSuperAdmin = await isEmployeeSuperAdmin({ employeeId: id, orgId });
    if (targetIsSuperAdmin) {
      permPayload = getSuperAdminPerms();
    }

    if (hasField('rate')) {
      if (rateValue === null || Number.isNaN(rateValue)) {
        return res.status(400).json({ error: 'Rate must be numeric.' });
      }
      if (!canModifyRates) {
        return res.status(403).json({ error: 'You do not have permission to modify pay rates.' });
      }
    }

    if (employeeQboId) {
      const dup = await dbGet(
        `
          SELECT id, name
          FROM employees
          WHERE org_id = ? AND employee_qbo_id = ? AND id != ?
          LIMIT 1
        `,
        [orgId, employeeQboId, id]
      );
      if (dup) {
        return res.status(409).json({
          error: 'QBO ID already linked.',
          linked_employee_id: dup.id,
          linked_employee_name: dup.name
        });
      }
    }
    if (vendorQboId) {
      const dup = await dbGet(
        `
          SELECT id, name
          FROM employees
          WHERE org_id = ? AND vendor_qbo_id = ? AND id != ?
          LIMIT 1
        `,
        [orgId, vendorQboId, id]
      );
      if (dup) {
        return res.status(409).json({
          error: 'QBO ID already linked.',
          linked_employee_id: dup.id,
          linked_employee_name: dup.name
        });
      }
    }

    const updates = [];
    const params = [];

    const dirtyFields = [];
    let needsQboSyncUpdate = null;
    const normalizeNameValue = (val) => (val == null ? null : String(val).trim()) || null;
    const isDateString = (val) => /^\d{4}-\d{2}-\d{2}$/.test(String(val || '').trim());

    const deriveFromName =
      hasField('name') && !hasField('given_name') && !hasField('family_name');
    if (deriveFromName && !name) {
      return res.status(400).json({ error: 'Name is required.' });
    }

    let nextGiven = existing.given_name;
    let nextFamily = existing.family_name;
    if (hasField('given_name')) {
      nextGiven = normalizeString(givenName);
    }
    if (hasField('family_name')) {
      nextFamily = normalizeString(familyName);
    }
    if (deriveFromName) {
      const derived = splitName(name);
      nextGiven = normalizeString(derived.given);
      nextFamily = normalizeString(derived.family);
    }

    if (hasField('given_name') || hasField('family_name') || deriveFromName) {
      updates.push('given_name = ?');
      params.push(nextGiven || null);
      updates.push('family_name = ?');
      params.push(nextFamily || null);
      const combinedName =
        [nextGiven, nextFamily].filter(Boolean).join(' ').trim() ||
        normalizeNameValue(name) ||
        existing.name ||
        null;
      updates.push('name = ?');
      params.push(combinedName);
      if (normalizeNameValue(existing.given_name) !== normalizeNameValue(nextGiven)) {
        dirtyFields.push('given_name');
      }
      if (normalizeNameValue(existing.family_name) !== normalizeNameValue(nextFamily)) {
        dirtyFields.push('family_name');
      }
    }

    if (hasField('nickname')) {
      updates.push('nickname = ?');
      params.push(nickname || null);
    }
    if (hasField('name_on_checks')) {
      updates.push('name_on_checks = ?');
      params.push(nameOnChecks || null);
      updates.push('name_on_checks_updated_at = ?');
      params.push(nameOnChecks ? new Date().toISOString() : null);
      if (normalizeNameValue(existing.name_on_checks) !== normalizeNameValue(nameOnChecks)) {
        dirtyFields.push('name_on_checks');
      }
    }
    if (hasField('email')) {
      updates.push('email = ?');
      params.push(email || null);
    }
    if (hasField('phone')) {
      updates.push('phone = ?');
      params.push(phone || null);
    }
    if (hasField('start_date')) {
      if (startDate && !isDateString(startDate)) {
        return res.status(400).json({ error: 'start_date must be YYYY-MM-DD.' });
      }
      updates.push('start_date = ?');
      params.push(startDate || null);
    }
    if (hasField('termination_date')) {
      if (terminationDate && !isDateString(terminationDate)) {
        return res.status(400).json({ error: 'termination_date must be YYYY-MM-DD.' });
      }
      updates.push('termination_date = ?');
      params.push(terminationDate || null);
      if (terminationDate) {
        updates.push('active = 0');
      }
    }
    if (hasField('rate')) {
      updates.push('rate = ?');
      params.push(rateValue);
    }
    if (hasField('language')) {
      updates.push('language = ?');
      params.push(normalizedLanguage || 'en');
    }
    if (roleTitleProvided || (template && roleTitle)) {
      updates.push('role_title = ?');
      params.push(roleTitle || null);
    }
    if (templateFieldProvided) {
      updates.push('permission_template_id = ?');
      params.push(templateId);
    }
    if (hasField('employee_qbo_id')) {
      updates.push('employee_qbo_id = ?');
      params.push(employeeQboId || null);
    }
    if (hasField('vendor_qbo_id')) {
      updates.push('vendor_qbo_id = ?');
      params.push(vendorQboId || null);
    }
    if (workerTimekeeping !== null) {
      updates.push('worker_timekeeping = ?');
      params.push(workerTimekeeping);
    }
    if (desktopAccess !== null) {
      updates.push('desktop_access = ?');
      params.push(desktopAccess);
    }
    if (kioskAdminAccess !== null) {
      updates.push('kiosk_admin_access = ?');
      params.push(kioskAdminAccess);
    }

    if (hasField('employee_qbo_id') || hasField('vendor_qbo_id')) {
      const finalEmployeeQboId =
        hasField('employee_qbo_id') ? employeeQboId : existing.employee_qbo_id;
      const finalVendorQboId =
        hasField('vendor_qbo_id') ? vendorQboId : existing.vendor_qbo_id;
      const needsQboSync = finalEmployeeQboId || finalVendorQboId ? 0 : 1;
      needsQboSyncUpdate = needsQboSyncUpdate === 1 ? 1 : needsQboSync;
    }

    if (needsQboSyncUpdate !== null) {
      updates.push('needs_qbo_sync = ?');
      params.push(needsQboSyncUpdate);
    }

    if (updates.length) {
      params.push(id, orgId);
      await dbRun(
        `
          UPDATE employees
          SET ${updates.join(', ')}
          WHERE id = ? AND org_id = ?
        `,
        params
      );
    }

    if (dirtyFields.length) {
      await markEmployeeQboDirty({
        orgId,
        employeeId: id,
        fields: dirtyFields,
        actorEmployeeId: req.session && req.session.employeeId ? req.session.employeeId : null,
        source: 'desktop'
      });
    }

    if (permPayload) {
      const normalizedPerms = {
        ...permPayload,
        view_payroll:
          permPayload.view_payroll || permPayload.modify_payroll || permPayload.modify_pay_rates ? 1 : 0
      };
      if (normalizedPerms.approve_time) {
        normalizedPerms.modify_time = 1;
      }
      await dbRun(
        `
          INSERT INTO employee_permissions (
            employee_id,
            see_shipments,
            modify_time,
            approve_time,
            view_time_reports,
            view_all_timesheets,
            assign_timesheets,
            view_payroll,
            modify_payroll,
            modify_pay_rates
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(employee_id) DO UPDATE SET
            see_shipments = excluded.see_shipments,
            modify_time = excluded.modify_time,
            approve_time = excluded.approve_time,
            view_time_reports = excluded.view_time_reports,
            view_all_timesheets = excluded.view_all_timesheets,
            assign_timesheets = excluded.assign_timesheets,
            view_payroll = excluded.view_payroll,
            modify_payroll = excluded.modify_payroll,
            modify_pay_rates = excluded.modify_pay_rates
        `,
        [
          id,
          normalizedPerms.see_shipments,
          normalizedPerms.modify_time,
          normalizedPerms.approve_time,
          normalizedPerms.view_time_reports,
          normalizedPerms.view_all_timesheets,
          normalizedPerms.assign_timesheets,
          normalizedPerms.view_payroll,
          normalizedPerms.modify_payroll,
          normalizedPerms.modify_pay_rates
        ]
      );
    }

    const afterAudit = await loadEmployeeAuditSnapshot({ orgId, employeeId: id });
    const shouldAudit =
      beforeAudit && afterAudit
        ? JSON.stringify(beforeAudit) !== JSON.stringify(afterAudit)
        : !!afterAudit;
    if (shouldAudit) {
      await logAuditEvent({
        req,
        orgId,
        action: 'employee.update',
        entityType: 'employee',
        entityId: id,
        before: beforeAudit,
        after: afterAudit
      });
    }

    return res.json({ ok: true, id });
  } catch (err) {
    console.error('Error in /api/employees:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

app.post('/api/employees/:id/active', requireViewPayroll, async (req, res) => {

  const id = parseInt(req.params.id, 10);
  const active = req.body.active ? 1 : 0;
  const orgId = req.session && req.session.orgId;

  if (!id) {
    return res.status(400).json({ error: 'Invalid employee id.' });
  }

  try {
    const beforeSnapshot = await loadEmployeeAuditSnapshot({ orgId, employeeId: id });
    const result = await dbRun(
      'UPDATE employees SET active = ? WHERE id = ? AND org_id = ?',
      [active, id, orgId]
    );
    if (!result || result.changes === 0) {
      return res.status(404).json({ error: 'Employee not found.' });
    }
    await logEmployeeAuditUpdate({
      req,
      orgId,
      employeeId: id,
      action: active ? 'employee.activate' : 'employee.deactivate',
      beforeSnapshot
    });
    return res.json({ ok: true, active });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Link a locally-created employee to QuickBooks IDs (employee/vendor)
app.post('/api/employees/:id/link-qbo', requireViewPayroll, requireSuperAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { employee_qbo_id, vendor_qbo_id, allow_merge } = req.body || {};
  const orgId = req.session && req.session.orgId;

  if (!id) {
    return res.status(400).json({ error: 'Invalid employee id.' });
  }
  const employeeQboId = employee_qbo_id ? String(employee_qbo_id).trim() : '';
  const vendorQboId = vendor_qbo_id ? String(vendor_qbo_id).trim() : '';
  if (!employeeQboId && !vendorQboId) {
    return res.status(400).json({ error: 'Provide a QuickBooks Employee ID or Vendor ID.' });
  }

  try {
    const token = await getAccessToken(orgId);
    const realmId = await getRealmId(orgId);
    if (!token || !realmId) {
      return res.status(400).json({ error: 'Not connected to QuickBooks.' });
    }

    const emp = await dbGet(
      'SELECT id, name FROM employees WHERE id = ? AND org_id = ?',
      [id, orgId]
    );
    if (!emp) {
      return res.status(404).json({ error: 'Employee not found.' });
    }
    const beforeAudit = await loadEmployeeAuditSnapshot({ orgId, employeeId: id });

    if (employeeQboId) {
      const dup = await dbGet(
        `
          SELECT id, name
          FROM employees
          WHERE org_id = ? AND employee_qbo_id = ? AND id != ?
        `,
        [orgId, employeeQboId, id]
      );
      if (dup) {
        if (!allow_merge) {
          return res.status(409).json({
            error: 'QBO ID already linked.',
            linked_employee_id: dup.id,
            linked_employee_name: dup.name
          });
        }

        const hasTimeEntries = await dbGet(
          `SELECT 1 FROM time_entries WHERE org_id = ? AND employee_id = ? LIMIT 1`,
          [orgId, dup.id]
        );
        const hasPunches = await dbGet(
          `SELECT 1 FROM time_punches WHERE org_id = ? AND employee_id = ? LIMIT 1`,
          [orgId, dup.id]
        );
        if (hasTimeEntries || hasPunches) {
          return res.status(409).json({
            error: 'QBO ID is linked to an employee with history. Unlink first.',
            linked_employee_id: dup.id,
            linked_employee_name: dup.name
          });
        }

        const dupRow = await dbGet(
          `
            SELECT
              name,
              given_name,
              family_name,
              name_on_checks,
              active,
              name_on_checks_qbo_updated_at,
              qbo_last_seen_given_name,
              qbo_last_seen_family_name,
              qbo_last_seen_name_on_checks,
              qbo_conflict_fields_json,
              qbo_conflict_updated_at
            FROM employees
            WHERE org_id = ? AND id = ?
            LIMIT 1
          `,
          [orgId, dup.id]
        );

        await dbRun('BEGIN');
        try {
          await dbRun(
            `
              UPDATE employees
              SET
                employee_qbo_id = ?,
                needs_qbo_sync = 0,
                name = COALESCE(?, name),
                given_name = COALESCE(?, given_name),
                family_name = COALESCE(?, family_name),
                name_on_checks = COALESCE(?, name_on_checks),
                active = COALESCE(?, active),
                name_on_checks_qbo_updated_at = COALESCE(?, name_on_checks_qbo_updated_at),
                qbo_last_seen_given_name = COALESCE(?, qbo_last_seen_given_name),
                qbo_last_seen_family_name = COALESCE(?, qbo_last_seen_family_name),
                qbo_last_seen_name_on_checks = COALESCE(?, qbo_last_seen_name_on_checks),
                qbo_conflict_fields_json = COALESCE(?, qbo_conflict_fields_json),
                qbo_conflict_updated_at = COALESCE(?, qbo_conflict_updated_at)
              WHERE id = ? AND org_id = ?
            `,
            [
              employeeQboId,
              dupRow?.name || null,
              dupRow?.given_name || null,
              dupRow?.family_name || null,
              dupRow?.name_on_checks || null,
              dupRow?.active,
              dupRow?.name_on_checks_qbo_updated_at || null,
              dupRow?.qbo_last_seen_given_name || null,
              dupRow?.qbo_last_seen_family_name || null,
              dupRow?.qbo_last_seen_name_on_checks || null,
              dupRow?.qbo_conflict_fields_json || null,
              dupRow?.qbo_conflict_updated_at || null,
              id,
              orgId
            ]
          );

          await dbRun(
            `DELETE FROM employee_permissions WHERE employee_id = ?`,
            [dup.id]
          );
          await dbRun(
            `DELETE FROM name_on_checks_queue WHERE org_id = ? AND employee_id = ?`,
            [orgId, dup.id]
          );
          await dbRun(
            `DELETE FROM employees WHERE org_id = ? AND id = ?`,
            [orgId, dup.id]
          );
          await dbRun('COMMIT');
        } catch (mergeErr) {
          try {
            await dbRun('ROLLBACK');
          } catch (rollbackErr) {
            console.warn('QBO merge rollback failed:', rollbackErr.message || rollbackErr);
          }
          throw mergeErr;
        }

        await logEmployeeAuditUpdate({
          req,
          orgId,
          employeeId: id,
          action: 'qbo.link.merge',
          note: 'Merged duplicate employee during QBO link.',
          beforeSnapshot: beforeAudit
        });
        return res.json({ ok: true, warning: null, merged: true });
      }
    }
    if (vendorQboId) {
      const dup = await dbGet(
        `
          SELECT id, name
          FROM employees
          WHERE org_id = ? AND vendor_qbo_id = ? AND id != ?
        `,
        [orgId, vendorQboId, id]
      );
      if (dup) {
        return res.status(409).json({
          error: 'QBO ID already linked.',
          linked_employee_id: dup.id,
          linked_employee_name: dup.name
        });
      }
    }

    const warnings = [];

    if (employeeQboId) {
      const knownEmployee = await dbGet(
        `
          SELECT id
          FROM employees
          WHERE org_id = ? AND employee_qbo_id = ?
          LIMIT 1
        `,
        [orgId, employeeQboId]
      );
      if (!knownEmployee) {
        const lastSync = await loadOrgSettingValue(
          orgId,
          'qbo_last_sync_employees_at'
        );
        warnings.push(
          lastSync
            ? 'Employee ID not found in the last QuickBooks sync.'
            : 'No employee sync on record; ID could not be validated.'
        );
      }
    }

    if (vendorQboId) {
      const knownVendor = await dbGet(
        `
          SELECT id
          FROM vendors
          WHERE org_id = ? AND qbo_id = ?
          LIMIT 1
        `,
        [orgId, vendorQboId]
      );
      if (!knownVendor) {
        const lastSync = await loadOrgSettingValue(
          orgId,
          'qbo_last_sync_vendors_at'
        );
        warnings.push(
          lastSync
            ? 'Vendor ID not found in the last QuickBooks sync.'
            : 'No vendor sync on record; ID could not be validated.'
        );
      }
    }

    const sql = `
      UPDATE employees
      SET
        employee_qbo_id = COALESCE(?, employee_qbo_id),
        vendor_qbo_id   = COALESCE(?, vendor_qbo_id),
        needs_qbo_sync  = 0
      WHERE id = ? AND org_id = ?
    `;
    const result = await dbRun(sql, [
      employeeQboId || null,
      vendorQboId || null,
      id,
      orgId
    ]);
    if (!result || result.changes === 0) {
      return res.status(404).json({ error: 'Employee not found.' });
    }
    await logEmployeeAuditUpdate({
      req,
      orgId,
      employeeId: id,
      action: 'qbo.link',
      note: warnings.length ? warnings.join(' ') : null,
      beforeSnapshot: beforeAudit
    });
    res.json({ ok: true, warning: warnings.length ? warnings.join(' ') : null });
  } catch (err) {
    console.error('Error linking employee to QBO:', err);
    res.status(500).json({ error: 'Failed to link to QuickBooks.' });
  }
});

app.post('/api/employees/:id/qbo-create', requireViewPayroll, requireSuperAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const orgId = req.session && req.session.orgId;
  if (!id) {
    return res.status(400).json({ error: 'Invalid employee id.' });
  }

  const displayName = (req.body && req.body.display_name) ? String(req.body.display_name).trim() : '';
  const givenName = (req.body && req.body.given_name) ? String(req.body.given_name).trim() : '';
  const familyName = (req.body && req.body.family_name) ? String(req.body.family_name).trim() : '';

  try {
    const token = await getAccessToken(orgId);
    const realmId = await getRealmId(orgId);
    if (!token || !realmId) {
      return res.status(400).json({ error: 'Not connected to QuickBooks.' });
    }

    const lastSync = await loadOrgSettingValue(orgId, 'qbo_last_sync_employees_at');
    if (!lastSync) {
      return res.status(400).json({ error: 'Sync employees first.' });
    }

    const emp = await dbGet(
      `
        SELECT id, name, given_name, family_name, employee_qbo_id
        FROM employees
        WHERE id = ? AND org_id = ?
        LIMIT 1
      `,
      [id, orgId]
    );
    if (!emp) {
      return res.status(404).json({ error: 'Employee not found.' });
    }
    if (emp.employee_qbo_id) {
      return res.status(409).json({ error: 'Employee is already linked to QuickBooks.' });
    }

    const beforeAudit = await loadEmployeeAuditSnapshot({ orgId, employeeId: id });

    let finalGiven = normalizeString(givenName) || normalizeString(emp.given_name);
    let finalFamily = normalizeString(familyName) || normalizeString(emp.family_name);
    if (!finalGiven || !finalFamily) {
      const derived = splitName(emp.name);
      finalGiven = finalGiven || normalizeString(derived.given);
      finalFamily = finalFamily || normalizeString(derived.family);
    }
    if (!finalGiven || !finalFamily) {
      return res.status(400).json({ error: 'given_name and family_name are required.' });
    }

    const fullName = displayName || `${finalGiven} ${finalFamily}`.trim();
    const matches = await dbAll(
      `
        SELECT employee_qbo_id, name
        FROM employees
        WHERE org_id = ?
          AND employee_qbo_id IS NOT NULL
          AND (LOWER(name) = LOWER(?) AND ? <> '')
        ORDER BY name COLLATE NOCASE
      `,
      [orgId, fullName, fullName]
    );

    if (matches && matches.length) {
      return res.status(409).json({
        error: 'Potential duplicate in QuickBooks.',
        matches: matches.map(m => ({
          employee_qbo_id: m.employee_qbo_id,
          name: m.name
        }))
      });
    }

    const qboRes = await createEmployeeInQuickBooks({
      displayName: fullName,
      givenName: finalGiven,
      familyName: finalFamily,
      orgId
    });

    if (!qboRes || qboRes.ok !== true) {
      const message = qboRes && qboRes.error ? qboRes.error : 'QuickBooks create failed.';
      return res.status(400).json({ error: message });
    }

    const qboId = qboRes.employee_qbo_id;
    const qboName = qboRes.employee_qbo_name || fullName;

    await dbRun(
      `
        UPDATE employees
        SET employee_qbo_id = ?, needs_qbo_sync = 0
        WHERE id = ? AND org_id = ?
      `,
      [qboId, id, orgId]
    );

    await logEmployeeAuditUpdate({
      req,
      orgId,
      employeeId: id,
      action: 'qbo.create',
      beforeSnapshot: beforeAudit
    });

    return res.json({
      ok: true,
      employee_qbo_id: qboId,
      employee_qbo_name: qboName
    });
  } catch (err) {
    console.error('Error creating QBO employee:', err);
    return res.status(500).json({ error: 'Failed to create QuickBooks employee.' });
  }
});

app.post('/api/employees/:id/unlink-qbo', requireViewPayroll, requireSuperAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const orgId = req.session && req.session.orgId;
  const payload = req.body || {};

  if (!id) {
    return res.status(400).json({ error: 'Invalid employee id.' });
  }

  const unlinkEmployee =
    payload.employee === undefined ? true : !!payload.employee;
  const unlinkVendor =
    payload.vendor === undefined ? true : !!payload.vendor;

  if (!unlinkEmployee && !unlinkVendor) {
    return res.status(400).json({ error: 'Nothing to unlink.' });
  }

  const sets = [];
  if (unlinkEmployee) sets.push('employee_qbo_id = NULL');
  if (unlinkVendor) sets.push('vendor_qbo_id = NULL');
  sets.push('needs_qbo_sync = 1');

  try {
    const beforeAudit = await loadEmployeeAuditSnapshot({ orgId, employeeId: id });
    const result = await dbRun(
      `
        UPDATE employees
        SET ${sets.join(', ')}
        WHERE id = ? AND org_id = ?
      `,
      [id, orgId]
    );
    if (!result || result.changes === 0) {
      return res.status(404).json({ error: 'Employee not found.' });
    }
    await logEmployeeAuditUpdate({
      req,
      orgId,
      employeeId: id,
      action: 'qbo.unlink',
      beforeSnapshot: beforeAudit
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('Error unlinking employee from QBO:', err);
    return res.status(500).json({ error: 'Failed to unlink from QuickBooks.' });
  }
});

// Lightweight endpoint just to update language (used by kiosk admin)
app.post('/api/employees/:id/language', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ error: 'Invalid employee id.' });
  }

  const adminCtx = await resolveKioskAdmin(req);
  if (!adminCtx.ok) {
    return res
      .status(adminCtx.status || 401)
      .json({ error: adminCtx.error || 'Not authenticated' });
  }

  const orgId = adminCtx.orgId;

  const allowedLanguages = ['en', 'es', 'ht'];
  const raw = (req.body && req.body.language) || '';
  const lang = allowedLanguages.includes(String(raw).toLowerCase())
    ? String(raw).toLowerCase()
    : 'en';

  try {
    const beforeSnapshot = await loadEmployeeAuditSnapshot({ orgId, employeeId: id });
    const result = await dbRun(
      'UPDATE employees SET language = ? WHERE id = ? AND org_id = ?',
      [lang, id, orgId]
    );
    if (!result || result.changes === 0) {
      return res.status(404).json({ error: 'Employee not found.' });
    }
    await logEmployeeAuditUpdate({
      orgId,
      employeeId: id,
      action: 'employee.language.update',
      actorEmployeeId: adminCtx.adminId || null,
      beforeSnapshot
    });
    return res.json({ ok: true, language: lang });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Lightweight endpoint just to update name (used by kiosk admin)
app.post('/api/employees/:id/name', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ error: 'Invalid employee id.' });
  }

  const raw = (req.body && req.body.name) || '';
  const name = String(raw || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'Name is required.' });
  }

  try {
    const adminCtx = await resolveKioskAdmin(req);
    if (!adminCtx.ok) {
      return res
        .status(adminCtx.status || 401)
        .json({ error: adminCtx.error || 'Not authenticated' });
    }

    const orgId = adminCtx.orgId;
    const beforeSnapshot = await loadEmployeeAuditSnapshot({ orgId, employeeId: id });
    const empRow = await dbGet(
      `
        SELECT id, name, given_name, family_name
        FROM employees
        WHERE id = ? AND org_id = ?
        LIMIT 1
      `,
      [id, orgId]
    );

    if (!empRow) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const derived = splitName(name);
    const nextGiven = normalizeString(derived.given);
    const nextFamily = normalizeString(derived.family);
    const dirtyFields = [];
    if (normalizeString(empRow.given_name) !== nextGiven) dirtyFields.push('given_name');
    if (normalizeString(empRow.family_name) !== nextFamily) dirtyFields.push('family_name');

    await dbRun(
      `
        UPDATE employees
        SET
          name = ?,
          given_name = ?,
          family_name = ?
        WHERE id = ? AND org_id = ?
      `,
      [name, nextGiven || null, nextFamily || null, id, orgId]
    );

    if (dirtyFields.length) {
      await markEmployeeQboDirty({
        orgId,
        employeeId: id,
        fields: dirtyFields,
        actorEmployeeId: adminCtx.adminId || null,
        source: 'kiosk'
      });
    }

    await logEmployeeAuditUpdate({
      orgId,
      employeeId: id,
      action: 'employee.name.update',
      actorEmployeeId: adminCtx.adminId || null,
      beforeSnapshot
    });

    res.json({ ok: true, id, name });
  } catch (err) {
    console.error('Error updating name:', err);
    return res.status(500).json({ error: 'Failed to update name.' });
  }
});

// Lightweight endpoint just to update phone (used by kiosk admin)
app.post('/api/employees/:id/phone', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ error: 'Invalid employee id.' });
  }

  const raw = (req.body && req.body.phone) || '';
  const phone = String(raw || '').trim();
  const normalized = phone || null;

  try {
    const adminCtx = await resolveKioskAdmin(req);
    if (!adminCtx.ok) {
      return res
        .status(adminCtx.status || 401)
        .json({ error: adminCtx.error || 'Not authenticated' });
    }

    const orgId = adminCtx.orgId;
    const beforeSnapshot = await loadEmployeeAuditSnapshot({ orgId, employeeId: id });
    const result = await dbRun(
      `
        UPDATE employees
        SET phone = ?
        WHERE id = ? AND org_id = ?
      `,
      [normalized, id, orgId]
    );

    if (!result || result.changes === 0) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    await logEmployeeAuditUpdate({
      orgId,
      employeeId: id,
      action: 'employee.phone.update',
      actorEmployeeId: adminCtx.adminId || null,
      beforeSnapshot
    });

    res.json({ ok: true, id, phone: normalized });
  } catch (err) {
    console.error('Error updating phone:', err);
    return res.status(500).json({ error: 'Failed to update phone.' });
  }
});

// Lightweight endpoint to update worker_timekeeping (kiosk admin)
app.post('/api/employees/:id/worker-timekeeping', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ error: 'Invalid employee id.' });
  }

  try {
    const adminCtx = await resolveKioskAdmin(req);
    if (!adminCtx.ok) {
      return res
        .status(adminCtx.status || 401)
        .json({ error: adminCtx.error || 'Not authenticated' });
    }

    const orgId = adminCtx.orgId;
    const beforeSnapshot = await loadEmployeeAuditSnapshot({ orgId, employeeId: id });
    const raw = req.body && req.body.worker_timekeeping;
    const flag = raw === true || raw === 1 || raw === '1' || raw === 'true';

    const result = await dbRun(
      `
        UPDATE employees
        SET worker_timekeeping = ?
        WHERE id = ? AND org_id = ?
      `,
      [flag ? 1 : 0, id, orgId]
    );

    if (!result || result.changes === 0) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    await logEmployeeAuditUpdate({
      orgId,
      employeeId: id,
      action: 'employee.access.update',
      actorEmployeeId: adminCtx.adminId || null,
      beforeSnapshot
    });

    return res.json({ ok: true, worker_timekeeping: flag ? 1 : 0 });
  } catch (err) {
    console.error('Error updating worker_timekeeping:', err);
    return res.status(500).json({ error: 'Failed to update timekeeping.' });
  }
});

// Lightweight endpoint to update employment dates (kiosk admin)
app.post('/api/employees/:id/employment-dates', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ error: 'Invalid employee id.' });
  }

  try {
    const adminCtx = await resolveKioskAdmin(req);
    if (!adminCtx.ok) {
      return res
        .status(adminCtx.status || 401)
        .json({ error: adminCtx.error || 'Not authenticated' });
    }

    const orgId = adminCtx.orgId;
    const beforeSnapshot = await loadEmployeeAuditSnapshot({ orgId, employeeId: id });
    const startDate =
      req.body && req.body.start_date !== undefined
        ? String(req.body.start_date || '').trim()
        : '';
    const terminationDate =
      req.body && req.body.termination_date !== undefined
        ? String(req.body.termination_date || '').trim()
        : '';

    const isDateString = (val) => /^\d{4}-\d{2}-\d{2}$/.test(String(val || '').trim());
    if (startDate && !isDateString(startDate)) {
      return res.status(400).json({ error: 'start_date must be YYYY-MM-DD.' });
    }
    if (terminationDate && !isDateString(terminationDate)) {
      return res.status(400).json({ error: 'termination_date must be YYYY-MM-DD.' });
    }

    const updates = ['start_date = ?', 'termination_date = ?'];
    const params = [startDate || null, terminationDate || null];
    if (terminationDate) {
      updates.push('active = 0');
    }

    const result = await dbRun(
      `
        UPDATE employees
        SET ${updates.join(', ')}
        WHERE id = ? AND org_id = ?
      `,
      [...params, id, orgId]
    );

    if (!result || result.changes === 0) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    await logEmployeeAuditUpdate({
      orgId,
      employeeId: id,
      action: 'employee.employment.update',
      actorEmployeeId: adminCtx.adminId || null,
      beforeSnapshot
    });

    return res.json({
      ok: true,
      start_date: startDate || null,
      termination_date: terminationDate || null,
      active: terminationDate ? 0 : undefined
    });
  } catch (err) {
    console.error('Error updating employment dates:', err);
    return res.status(500).json({ error: 'Failed to update employment dates.' });
  }
});

// Reactivate an employee: move current employment dates into history and set a new start date
app.post('/api/employees/:id/reactivate', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ error: 'Invalid employee id.' });
  }

  try {
    const adminCtx = await resolveKioskAdmin(req);
    if (!adminCtx.ok) {
      return res
        .status(adminCtx.status || 401)
        .json({ error: adminCtx.error || 'Not authenticated' });
    }

    const orgId = adminCtx.orgId;
    const beforeSnapshot = await loadEmployeeAuditSnapshot({ orgId, employeeId: id });
    const startDate = req.body && req.body.start_date ? String(req.body.start_date || '').trim() : '';
    const isDateString = (val) => /^\d{4}-\d{2}-\d{2}$/.test(String(val || '').trim());
    if (!startDate || !isDateString(startDate)) {
      return res.status(400).json({ error: 'start_date must be YYYY-MM-DD.' });
    }

    const empRow = await dbGet(
      `
        SELECT id, start_date, termination_date
        FROM employees
        WHERE id = ? AND org_id = ?
        LIMIT 1
      `,
      [id, orgId]
    );

    if (!empRow) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    if (empRow.start_date || empRow.termination_date) {
      await dbRun(
        `
          INSERT INTO employee_employment_history (
            org_id,
            employee_id,
            start_date,
            termination_date,
            recorded_by
          ) VALUES (?, ?, ?, ?, ?)
        `,
        [
          orgId,
          id,
          empRow.start_date || null,
          empRow.termination_date || null,
          adminCtx.adminId || null
        ]
      );
    }

    const result = await dbRun(
      `
        UPDATE employees
        SET start_date = ?, termination_date = NULL, active = 1
        WHERE id = ? AND org_id = ?
      `,
      [startDate, id, orgId]
    );

    if (!result || result.changes === 0) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    await logEmployeeAuditUpdate({
      orgId,
      employeeId: id,
      action: 'employee.reactivate',
      actorEmployeeId: adminCtx.adminId || null,
      beforeSnapshot
    });

    return res.json({ ok: true, start_date: startDate, active: 1 });
  } catch (err) {
    console.error('Error reactivating employee:', err);
    return res.status(500).json({ error: 'Failed to reactivate employee.' });
  }
});

// Kiosk admin: employment history list
app.get('/api/kiosk/admin/employees/:id/employment-history', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ error: 'Invalid employee id.' });
  }

  const adminCtx = await resolveKioskAdmin(req);
  if (!adminCtx.ok) {
    return res
      .status(adminCtx.status || 401)
      .json({ error: adminCtx.error || 'Not authenticated' });
  }

  try {
    const rows = await dbAll(
      `
        SELECT start_date, termination_date, recorded_at
        FROM employee_employment_history
        WHERE employee_id = ? AND org_id = ?
        ORDER BY recorded_at DESC
      `,
      [id, adminCtx.orgId]
    );
    return res.json({ history: rows || [] });
  } catch (err) {
    console.error('Error loading employment history:', err);
    return res.status(500).json({ error: 'Failed to load employment history.' });
  }
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

  try {
    const adminCtx = await resolveKioskAdmin(req);
    if (!adminCtx.ok) {
      return res
        .status(adminCtx.status || 401)
        .json({ error: adminCtx.error || 'Not authenticated' });
    }

    const orgId = adminCtx.orgId;
    const beforeSnapshot = await loadEmployeeAuditSnapshot({ orgId, employeeId: id });
    const empRow = await dbGet(
      `
        SELECT id, name, name_on_checks, vendor_qbo_id, employee_qbo_id
        FROM employees
        WHERE id = ? AND org_id = ?
        LIMIT 1
      `,
      [id, orgId]
    );

    if (!empRow) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const normalizedExisting = empRow.name_on_checks ? String(empRow.name_on_checks).trim() : null;
    const dirtyFields = [];
    if (normalizedExisting !== normalized) {
      dirtyFields.push('name_on_checks');
    }

    await dbRun(
      `
        UPDATE employees
        SET
          name_on_checks = ?,
          name_on_checks_updated_at = ?
        WHERE id = ? AND org_id = ?
      `,
      [normalized, new Date().toISOString(), id, orgId]
    );

    if (dirtyFields.length) {
      await markEmployeeQboDirty({
        orgId,
        employeeId: id,
        fields: dirtyFields,
        actorEmployeeId: adminCtx.adminId || null,
        source: 'kiosk'
      });
    }

    await logEmployeeAuditUpdate({
      orgId,
      employeeId: id,
      action: 'employee.name_on_checks.update',
      actorEmployeeId: adminCtx.adminId || null,
      beforeSnapshot
    });

    res.json({ ok: true, id, name_on_checks: normalized, qbo_warning: null });
  } catch (err) {
    console.error('Error updating name_on_checks:', err);
    return res.status(500).json({ error: 'Failed to update name on checks.' });
  }
});

// Kiosk admin: list employee documents (photo/id + uploads)
app.get('/api/kiosk/admin/employees/:id/documents', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ error: 'Invalid employee id.' });
  }

  const adminCtx = await resolveKioskAdmin(req);
  if (!adminCtx.ok) {
    return res
      .status(adminCtx.status || 401)
      .json({ error: adminCtx.error || 'Not authenticated' });
  }

  try {
    const emp = await dbGet(
      `
        SELECT
          id,
          id_document_type,
          id_document_path,
          id_document_uploaded_at,
          employee_photo_path,
          employee_photo_uploaded_at
        FROM employees
        WHERE id = ? AND org_id = ?
        LIMIT 1
      `,
      [id, adminCtx.orgId]
    );

    if (!emp) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const docs = [];
    if (emp.employee_photo_path) {
      docs.push({
        doc_type: 'photo',
        doc_label: 'Photo',
        title: 'Photo',
        uploaded_at: emp.employee_photo_uploaded_at,
        url: `/api/kiosk/admin/employees/${id}/photo`
      });
    }
    if (emp.id_document_path) {
      const label = employeeIdDocTypeLabel(emp.id_document_type) || 'ID';
      docs.push({
        doc_type: 'id',
        doc_label: label,
        title: 'ID',
        uploaded_at: emp.id_document_uploaded_at,
        url: `/api/kiosk/admin/employees/${id}/id-document`
      });
    }

    const rows = await dbAll(
      `
        SELECT id, doc_type, doc_label, title, file_path, uploaded_at
        FROM employee_documents
        WHERE employee_id = ? AND org_id = ?
        ORDER BY uploaded_at DESC, id DESC
      `,
      [id, adminCtx.orgId]
    );

    const extra = (rows || []).map(doc => ({
      id: doc.id,
      doc_type: doc.doc_type,
      doc_label: doc.doc_label,
      title: doc.title,
      uploaded_at: doc.uploaded_at,
      file_path: doc.file_path,
      url: `/api/kiosk/admin/employees/documents/${doc.id}/download`
    }));

    res.json({ documents: [...docs, ...extra] });
  } catch (err) {
    console.error('Error loading employee documents:', err);
    res.status(500).json({ error: 'Failed to load documents.' });
  }
});

// Kiosk admin: upload employee photo
app.post(
  '/api/kiosk/admin/employees/:id/photo',
  wrapUpload(uploadEmployeeMedia.single('employee_photo')),
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) {
      return res.status(400).json({ error: 'Invalid employee id.' });
    }

    const adminCtx = await resolveKioskAdmin(req);
    if (!adminCtx.ok) {
      return res
        .status(adminCtx.status || 401)
        .json({ error: adminCtx.error || 'Not authenticated' });
    }

    const beforeRow = await dbGet(
      `
        SELECT employee_photo_path, employee_photo_uploaded_at
        FROM employees
        WHERE id = ? AND org_id = ?
      `,
      [id, adminCtx.orgId]
    );

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'Photo file is required.' });
    }

    try {
      const result = await validateStoredUpload(file.path, photoAllowedMimes, photoAllowedExts);
      if (!result.ok) {
        await cleanupUploadedFiles([file]);
        return res.status(400).json({ error: result.error || 'Unsupported file type.' });
      }

      const relPath = `employee_photos/${file.filename}`;
      await dbRun(
        `
          UPDATE employees
          SET
            employee_photo_path = ?,
            employee_photo_uploaded_at = datetime('now'),
            employee_photo_uploaded_by = ?
          WHERE id = ? AND org_id = ?
        `,
        [relPath, adminCtx.adminId || null, id, adminCtx.orgId]
      );

      await logAuditEvent({
        req,
        orgId: adminCtx.orgId,
        action: 'employee.photo.upload',
        entityType: 'employee',
        entityId: id,
        actorEmployeeId: adminCtx.adminId || null,
        before: {
          has_photo: !!beforeRow?.employee_photo_path,
          uploaded_at: beforeRow?.employee_photo_uploaded_at || null
        },
        after: {
          has_photo: true
        },
        note: 'Employee photo uploaded via kiosk admin.'
      });

      res.json({ ok: true });
    } catch (err) {
      console.error('Error uploading employee photo:', err);
      await cleanupUploadedFiles([file]);
      res.status(500).json({ error: 'Failed to upload photo.' });
    }
  }
);

// Kiosk admin: upload employee ID document
app.post(
  '/api/kiosk/admin/employees/:id/id-document',
  wrapUpload(uploadEmployeeMedia.single('id_document')),
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) {
      return res.status(400).json({ error: 'Invalid employee id.' });
    }

    const adminCtx = await resolveKioskAdmin(req);
    if (!adminCtx.ok) {
      return res
        .status(adminCtx.status || 401)
        .json({ error: adminCtx.error || 'Not authenticated' });
    }

    const beforeRow = await dbGet(
      `
        SELECT id_document_path, id_document_type, id_document_uploaded_at
        FROM employees
        WHERE id = ? AND org_id = ?
      `,
      [id, adminCtx.orgId]
    );

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'ID document file is required.' });
    }

    try {
      const result = await validateStoredUpload(file.path, idAllowedMimes, idAllowedExts);
      if (!result.ok) {
        await cleanupUploadedFiles([file]);
        return res.status(400).json({ error: result.error || 'Unsupported file type.' });
      }

      const rawType = (req.body && req.body.id_document_type) ? String(req.body.id_document_type).trim() : '';
      const allowedTypes = new Set(['drivers_license', 'passport', 'other']);
      const docType = allowedTypes.has(rawType) ? rawType : null;
      const relPath = `employee_ids/${file.filename}`;
      await dbRun(
        `
          UPDATE employees
          SET
            id_document_type = ?,
            id_document_path = ?,
            id_document_uploaded_at = datetime('now'),
            id_document_uploaded_by = ?
          WHERE id = ? AND org_id = ?
        `,
        [docType, relPath, adminCtx.adminId || null, id, adminCtx.orgId]
      );

      await logAuditEvent({
        req,
        orgId: adminCtx.orgId,
        action: 'employee.id_document.upload',
        entityType: 'employee',
        entityId: id,
        actorEmployeeId: adminCtx.adminId || null,
        before: {
          has_id_document: !!beforeRow?.id_document_path,
          id_document_type: beforeRow?.id_document_type || null,
          uploaded_at: beforeRow?.id_document_uploaded_at || null
        },
        after: {
          has_id_document: true,
          id_document_type: docType || null
        },
        note: 'ID document uploaded via kiosk admin.'
      });

      res.json({ ok: true });
    } catch (err) {
      console.error('Error uploading employee ID document:', err);
      await cleanupUploadedFiles([file]);
      res.status(500).json({ error: 'Failed to upload ID document.' });
    }
  }
);

// Kiosk admin: upload employee documents (worker authorization/other)
app.post(
  '/api/kiosk/admin/employees/:id/documents',
  wrapUpload(uploadEmployeeDocs.array('documents', 1)),
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) {
      return res.status(400).json({ error: 'Invalid employee id.' });
    }

    const adminCtx = await resolveKioskAdmin(req);
    if (!adminCtx.ok) {
      return res
        .status(adminCtx.status || 401)
        .json({ error: adminCtx.error || 'Not authenticated' });
    }

    const files = req.files || [];
    const file = files[0];
    if (!file) {
      return res.status(400).json({ error: 'Document file is required.' });
    }

    const rawType = (req.body && req.body.doc_type) ? String(req.body.doc_type).trim() : '';
    const lowerType = rawType.toLowerCase();
    let docType = null;
    if (lowerType === 'worker authorization' || lowerType === 'worker_authorization') {
      docType = 'worker_authorization';
    } else if (lowerType === 'other') {
      docType = 'other';
    }
    if (!docType) {
      await cleanupUploadedFiles([file]);
      return res.status(400).json({ error: 'Unsupported document type.' });
    }

    const docLabel = (req.body && req.body.doc_label) ? String(req.body.doc_label).trim() : '';
    if (docType === 'other' && !docLabel) {
      await cleanupUploadedFiles([file]);
      return res.status(400).json({ error: 'Document label is required for Other.' });
    }

    try {
      const result = await validateStoredUpload(file.path, employeeDocsAllowedMimes, employeeDocsAllowedExts);
      if (!result.ok) {
        await cleanupUploadedFiles([file]);
        return res.status(400).json({ error: result.error || 'Unsupported file type.' });
      }

      const relPath = `employee_docs/${file.filename}`;
      const title = file.originalname || 'Document';
      const insertRes = await dbRun(
        `
          INSERT INTO employee_documents (
            org_id,
            employee_id,
            doc_type,
            doc_label,
            title,
            file_path,
            uploaded_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          adminCtx.orgId,
          id,
          docType,
          docLabel || null,
          title,
          relPath,
          adminCtx.adminId || null
        ]
      );

      await logAuditEvent({
        req,
        orgId: adminCtx.orgId,
        action: 'employee.document.upload',
        entityType: 'employee',
        entityId: id,
        actorEmployeeId: adminCtx.adminId || null,
        after: {
          document_id: insertRes.lastID,
          doc_type: docType,
          doc_label: docLabel || null,
          title
        },
        note: 'Employee document uploaded via kiosk admin.'
      });

      res.json({
        ok: true,
        document: {
          id: insertRes.lastID,
          doc_type: docType,
          doc_label: docLabel || null,
          title,
          file_path: relPath,
          url: `/api/kiosk/admin/employees/documents/${insertRes.lastID}/download`
        }
      });
    } catch (err) {
      console.error('Error uploading employee document:', err);
      await cleanupUploadedFiles([file]);
      res.status(500).json({ error: 'Failed to upload document.' });
    }
  }
);

// Kiosk admin: download employee document
app.get('/api/kiosk/admin/employees/documents/:docId/download', async (req, res) => {
  const docId = parseInt(req.params.docId, 10);
  if (!docId) {
    return res.status(400).json({ error: 'Invalid document id.' });
  }

  const adminCtx = await resolveKioskAdmin(req);
  if (!adminCtx.ok) {
    return res
      .status(adminCtx.status || 401)
      .json({ error: adminCtx.error || 'Not authenticated' });
  }

  try {
    const doc = await dbGet(
      `
        SELECT id, file_path
        FROM employee_documents
        WHERE id = ? AND org_id = ?
        LIMIT 1
      `,
      [docId, adminCtx.orgId]
    );
    if (!doc || !doc.file_path) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    const absPath = resolveEmployeeDocumentPath(doc.file_path);
    if (!absPath) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    try {
      await fsp.access(absPath, fs.constants.R_OK);
    } catch {
      return res.status(404).json({ error: 'Document not found.' });
    }

    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.download(absPath, path.basename(absPath));
  } catch (err) {
    console.error('Error downloading employee document:', err);
    return res.status(500).json({ error: 'Failed to download document.' });
  }
});

// Kiosk admin: view employee ID document
app.get('/api/kiosk/admin/employees/:id/id-document', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ error: 'Invalid employee id.' });
  }

  const adminCtx = await resolveKioskAdmin(req);
  if (!adminCtx.ok) {
    return res
      .status(adminCtx.status || 401)
      .json({ error: adminCtx.error || 'Not authenticated' });
  }

  try {
    const row = await dbGet(
      `
        SELECT id_document_path
        FROM employees
        WHERE id = ? AND org_id = ?
        LIMIT 1
      `,
      [id, adminCtx.orgId]
    );
    if (!row || !row.id_document_path) {
      return res.status(404).json({ error: 'ID document not found.' });
    }

    const absPath = resolveEmployeeIdPath(row.id_document_path);
    if (!absPath) {
      return res.status(404).json({ error: 'ID document not found.' });
    }

    try {
      await fsp.access(absPath, fs.constants.R_OK);
    } catch {
      return res.status(404).json({ error: 'ID document not found.' });
    }

    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.download(absPath, path.basename(absPath));
  } catch (err) {
    console.error('Error loading kiosk admin ID document:', err);
    return res.status(500).json({ error: 'Failed to load ID document.' });
  }
});

// Kiosk admin: view employee photo
app.get('/api/kiosk/admin/employees/:id/photo', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ error: 'Invalid employee id.' });
  }

  const adminCtx = await resolveKioskAdmin(req);
  if (!adminCtx.ok) {
    return res
      .status(adminCtx.status || 401)
      .json({ error: adminCtx.error || 'Not authenticated' });
  }

  try {
    const row = await dbGet(
      `
        SELECT employee_photo_path
        FROM employees
        WHERE id = ? AND org_id = ?
        LIMIT 1
      `,
      [id, adminCtx.orgId]
    );
    if (!row || !row.employee_photo_path) {
      return res.status(404).json({ error: 'Employee photo not found.' });
    }

    const absPath = resolveEmployeePhotoPath(row.employee_photo_path);
    if (!absPath) {
      return res.status(404).json({ error: 'Employee photo not found.' });
    }

    try {
      await fsp.access(absPath, fs.constants.R_OK);
    } catch {
      return res.status(404).json({ error: 'Employee photo not found.' });
    }

    let mime = null;
    try {
      mime = await sniffMimeFromFile(absPath);
    } catch {}
    if (!mime) mime = 'application/octet-stream';

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(absPath)}"`);
    return res.sendFile(absPath);
  } catch (err) {
    console.error('Error loading kiosk admin employee photo:', err);
    return res.status(500).json({ error: 'Failed to load employee photo.' });
  }
});

// Kiosk admin: delete employee photo
app.delete('/api/kiosk/admin/employees/:id/photo', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ error: 'Invalid employee id.' });
  }

  const adminCtx = await resolveKioskAdmin(req);
  if (!adminCtx.ok) {
    return res
      .status(adminCtx.status || 401)
      .json({ error: adminCtx.error || 'Not authenticated' });
  }

  try {
    const row = await dbGet(
      `
        SELECT employee_photo_path
        FROM employees
        WHERE id = ? AND org_id = ?
        LIMIT 1
      `,
      [id, adminCtx.orgId]
    );
    if (!row) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    if (row.employee_photo_path) {
      const absPath = resolveEmployeePhotoPath(row.employee_photo_path);
      if (absPath) {
        try {
          await fsp.unlink(absPath);
        } catch {}
      }
    }

    await dbRun(
      `
        UPDATE employees
        SET
          employee_photo_path = NULL,
          employee_photo_uploaded_at = NULL,
          employee_photo_uploaded_by = NULL
        WHERE id = ? AND org_id = ?
      `,
      [id, adminCtx.orgId]
    );

    await logAuditEvent({
      orgId: adminCtx.orgId,
      action: 'employee.photo.delete',
      entityType: 'employee',
      entityId: id,
      actorEmployeeId: adminCtx.adminId || null,
      note: 'Employee photo deleted via kiosk admin.'
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting kiosk admin employee photo:', err);
    return res.status(500).json({ error: 'Failed to delete employee photo.' });
  }
});

app.get('/api/employees/:id/id-document', requireViewPayroll, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const orgId = req.session && req.session.orgId;
  if (!id) {
    return res.status(400).json({ error: 'Invalid employee id.' });
  }

  try {
    const row = await dbGet(
      `
        SELECT id_document_path
        FROM employees
        WHERE id = ? AND org_id = ?
        LIMIT 1
      `,
      [id, orgId]
    );
    if (!row || !row.id_document_path) {
      return res.status(404).json({ error: 'ID document not found.' });
    }

    const absPath = resolveEmployeeIdPath(row.id_document_path);
    if (!absPath) {
      return res.status(404).json({ error: 'ID document not found.' });
    }

    try {
      await fsp.access(absPath, fs.constants.R_OK);
    } catch {
      return res.status(404).json({ error: 'ID document not found.' });
    }

    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.download(absPath, path.basename(absPath));
  } catch (err) {
    console.error('Error loading ID document:', err);
    return res.status(500).json({ error: 'Failed to load ID document.' });
  }
});

app.delete('/api/employees/:id/id-document', requireViewPayroll, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const orgId = req.session && req.session.orgId;
  if (!id) {
    return res.status(400).json({ error: 'Invalid employee id.' });
  }

  try {
    const row = await dbGet(
      `
        SELECT id_document_path
        FROM employees
        WHERE id = ? AND org_id = ?
        LIMIT 1
      `,
      [id, orgId]
    );
    if (!row) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    if (row.id_document_path) {
      const absPath = resolveEmployeeIdPath(row.id_document_path);
      if (absPath) {
        try {
          await fsp.unlink(absPath);
        } catch {}
      }
    }

    await dbRun(
      `
        UPDATE employees
        SET
          id_document_type = NULL,
          id_document_path = NULL,
          id_document_uploaded_at = NULL,
          id_document_uploaded_by = NULL
        WHERE id = ? AND org_id = ?
      `,
      [id, orgId]
    );

    await logAuditEvent({
      req,
      orgId,
      action: 'employee.id_document.delete',
      entityType: 'employee',
      entityId: id
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting ID document:', err);
    return res.status(500).json({ error: 'Failed to delete ID document.' });
  }
});

app.get('/api/employees/:id/photo', requireViewPayroll, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const orgId = req.session && req.session.orgId;
  if (!id) {
    return res.status(400).json({ error: 'Invalid employee id.' });
  }

  try {
    const row = await dbGet(
      `
        SELECT employee_photo_path
        FROM employees
        WHERE id = ? AND org_id = ?
        LIMIT 1
      `,
      [id, orgId]
    );
    if (!row || !row.employee_photo_path) {
      return res.status(404).json({ error: 'Employee photo not found.' });
    }

    const absPath = resolveEmployeePhotoPath(row.employee_photo_path);
    if (!absPath) {
      return res.status(404).json({ error: 'Employee photo not found.' });
    }

    try {
      await fsp.access(absPath, fs.constants.R_OK);
    } catch {
      return res.status(404).json({ error: 'Employee photo not found.' });
    }

    let mime = null;
    try {
      mime = await sniffMimeFromFile(absPath);
    } catch {}
    if (!mime) mime = 'application/octet-stream';

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(absPath)}"`);
    return res.sendFile(absPath);
  } catch (err) {
    console.error('Error loading employee photo:', err);
    return res.status(500).json({ error: 'Failed to load employee photo.' });
  }
});

app.delete('/api/employees/:id/photo', requireViewPayroll, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const orgId = req.session && req.session.orgId;
  if (!id) {
    return res.status(400).json({ error: 'Invalid employee id.' });
  }

  try {
    const row = await dbGet(
      `
        SELECT employee_photo_path
        FROM employees
        WHERE id = ? AND org_id = ?
        LIMIT 1
      `,
      [id, orgId]
    );
    if (!row) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    if (row.employee_photo_path) {
      const absPath = resolveEmployeePhotoPath(row.employee_photo_path);
      if (absPath) {
        try {
          await fsp.unlink(absPath);
        } catch {}
      }
    }

    await dbRun(
      `
        UPDATE employees
        SET
          employee_photo_path = NULL,
          employee_photo_uploaded_at = NULL,
          employee_photo_uploaded_by = NULL
        WHERE id = ? AND org_id = ?
      `,
      [id, orgId]
    );

    await logAuditEvent({
      req,
      orgId,
      action: 'employee.photo.delete',
      entityType: 'employee',
      entityId: id,
      note: 'Employee photo deleted via admin.'
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting employee photo:', err);
    return res.status(500).json({ error: 'Failed to delete employee photo.' });
  }
});

app.post('/api/employees/:id/pin', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ error: 'Invalid employee id.' });
  }

  const { pin, allowOverride, device_id, device_secret, client_id } = req.body || {};

  // Allow either a normal logged-in session OR a registered kiosk device
  const hasSession = req.session && req.session.userId;
  const sessionOrgId = req.session && req.session.orgId;
  const sessionEmployeeId = req.session && req.session.employeeId;
  let kioskOk = false;
  let kioskOrgId = null;
  let adminAuthorized = false;
  let adminId = null;

  if (hasSession) {
    if (!sessionOrgId || !sessionEmployeeId) {
      return res.status(403).json({ error: 'Admin privileges required.' });
    }
    const access = await getEmployeeAccessFlags({
      employeeId: sessionEmployeeId,
      orgId: sessionOrgId
    });
    if (!access || !access.active || (!access.desktop_access && !access.kiosk_admin_access)) {
      return res.status(403).json({ error: 'Admin privileges required.' });
    }
    adminAuthorized = true;
    adminId = sessionEmployeeId;
  } else {
    const devId = (device_id || '').trim();
    const devSecret = (device_secret || '').trim();
    if (devId && devSecret) {
      try {
        const kioskRow = await dbGet(
          'SELECT id, device_secret, org_id FROM kiosks WHERE device_id = ? LIMIT 1',
          [devId]
        );
        if (kioskRow && kioskRow.device_secret && kioskRow.device_secret === devSecret) {
          kioskOk = true;
          kioskOrgId = kioskRow.org_id;
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

  const orgId = sessionOrgId || kioskOrgId;
  const clientId = client_id ? String(client_id).trim() : '';
  if (clientId) {
    const existing = await loadIdempotentResponse(orgId, 'employee_pin', clientId);
    if (existing) {
      return res.json({ ...existing, alreadyProcessed: true });
    }
  }

  const pinRaw = String(pin || '').trim();
  if (!/^\d{4}$/.test(pinRaw)) {
    return res.status(400).json({ error: 'PIN must be a 4-digit number.' });
  }

  const existing = await dbGet(
    `
      SELECT id, pin_hash
      FROM employees
      WHERE id = ? AND org_id = ?
    `,
    [id, orgId]
  );
  if (!existing) {
    return res.status(404).json({ error: 'Employee not found.' });
  }

  const overrideFlag = allowOverride === true || allowOverride === 'true';
  if (!overrideFlag && existing.pin_hash) {
    return res.status(409).json({
      error: 'PIN already set for this employee. Use allowOverride to change it.'
    });
  }
  if (overrideFlag && existing.pin_hash && !adminAuthorized) {
    const overrideAdminId = Number((req.body && req.body.admin_id) || 0);
    if (!overrideAdminId) {
      return res.status(403).json({ error: 'Admin privileges required.' });
    }
    const adminRow = await dbGet(
      `
        SELECT id, kiosk_admin_access, desktop_access, active
        FROM employees
        WHERE id = ? AND org_id = ?
        LIMIT 1
      `,
      [overrideAdminId, orgId]
    );
    if (
      !adminRow ||
      !isTruthyFlag(adminRow.active) ||
      (!isTruthyFlag(adminRow.kiosk_admin_access) && !isTruthyFlag(adminRow.desktop_access))
    ) {
      return res.status(403).json({ error: 'Admin privileges required.' });
    }
    adminAuthorized = true;
    adminId = overrideAdminId;
  }

  try {
    const hash = await bcrypt.hash(pinRaw, 10);
    const result = await dbRun(
      `
        UPDATE employees
        SET pin_hash = ?
        WHERE id = ? AND org_id = ?
      `,
      [hash, id, orgId]
    );

    if (!result || result.changes === 0) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const pinAction = existing.pin_hash ? 'employee.pin.reset' : 'employee.pin.set';
    await logAuditEvent({
      orgId,
      action: pinAction,
      entityType: 'employee',
      entityId: id,
      actorEmployeeId: adminAuthorized ? adminId : id,
      note: adminAuthorized ? 'PIN updated by admin.' : 'PIN set via kiosk.'
    });

    const response = { ok: true };
    if (clientId) {
      await storeIdempotentResponse(orgId, 'employee_pin', clientId, response);
    }

    return res.json(response);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Permission templates (super admin only)
app.get('/api/permission-templates', requireSuperAdmin, async (req, res) => {
  try {
    const orgId = req.session && req.session.orgId;
    const rows = await dbAll(
      `
        SELECT id, name, role_title, access_json, permissions_json, created_at, updated_at
        FROM permission_templates
        WHERE org_id = ?
        ORDER BY name COLLATE NOCASE
      `,
      [orgId]
    );

    const templates = (rows || []).map(row => ({
      id: row.id,
      name: row.name,
      role_title: row.role_title || null,
      access: normalizeTemplateAccess(parseTemplateJson(row.access_json)),
      permissions: normalizeTemplatePerms(parseTemplateJson(row.permissions_json)),
      created_at: row.created_at,
      updated_at: row.updated_at
    }));

    return res.json({ templates });
  } catch (err) {
    console.error('Error loading permission templates:', err);
    return res.status(500).json({ error: 'Failed to load permission templates.' });
  }
});

app.post('/api/permission-templates', requireSuperAdmin, async (req, res) => {
  try {
    const orgId = req.session && req.session.orgId;
    const body = req.body || {};
    const name = String(body.name || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'Template name is required.' });
    }

    const roleTitle = String(body.role_title || '').trim() || null;
    const access = normalizeTemplateAccess(body.access);
    const permissions = normalizeTemplatePerms(body.permissions);
    const accessJson = JSON.stringify(access);
    const permissionsJson = JSON.stringify(permissions);

    const insertRes = await dbRun(
      `
        INSERT INTO permission_templates (
          org_id,
          name,
          role_title,
          access_json,
          permissions_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `,
      [orgId, name, roleTitle, accessJson, permissionsJson]
    );

    await logAuditEvent({
      req,
      orgId,
      action: 'access.template.create',
      entityType: 'permission_template',
      entityId: insertRes.lastID,
      after: {
        name,
        role_title: roleTitle,
        access,
        permissions
      }
    });

    return res.json({ ok: true, id: insertRes.lastID });
  } catch (err) {
    console.error('Error creating permission template:', err);
    return res.status(500).json({ error: 'Failed to create permission template.' });
  }
});

app.put('/api/permission-templates/:id', requireSuperAdmin, async (req, res) => {
  try {
    const orgId = req.session && req.session.orgId;
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ error: 'Template id is required.' });
    }

    const body = req.body || {};
    const name = String(body.name || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'Template name is required.' });
    }

    const roleTitle = String(body.role_title || '').trim() || null;
    const access = normalizeTemplateAccess(body.access);
    const permissions = normalizeTemplatePerms(body.permissions);
    const accessJson = JSON.stringify(access);
    const permissionsJson = JSON.stringify(permissions);

    const beforeRow = await dbGet(
      `
        SELECT id, name, role_title, access_json, permissions_json
        FROM permission_templates
        WHERE id = ? AND org_id = ?
      `,
      [id, orgId]
    );
    if (!beforeRow) {
      return res.status(404).json({ error: 'Template not found.' });
    }

    const updateRes = await dbRun(
      `
        UPDATE permission_templates
        SET name = ?, role_title = ?, access_json = ?, permissions_json = ?, updated_at = datetime('now')
        WHERE id = ? AND org_id = ?
      `,
      [name, roleTitle, accessJson, permissionsJson, id, orgId]
    );
    if (updateRes.changes === 0) {
      return res.status(404).json({ error: 'Template not found.' });
    }

    await logAuditEvent({
      req,
      orgId,
      action: 'access.template.update',
      entityType: 'permission_template',
      entityId: id,
      before: {
        name: beforeRow.name,
        role_title: beforeRow.role_title,
        access: parseTemplateJson(beforeRow.access_json),
        permissions: parseTemplateJson(beforeRow.permissions_json)
      },
      after: {
        name,
        role_title: roleTitle,
        access,
        permissions
      }
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('Error updating permission template:', err);
    return res.status(500).json({ error: 'Failed to update permission template.' });
  }
});

app.delete('/api/permission-templates/:id', requireSuperAdmin, async (req, res) => {
  try {
    const orgId = req.session && req.session.orgId;
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ error: 'Template id is required.' });
    }

    const beforeRow = await dbGet(
      `
        SELECT id, name, role_title, access_json, permissions_json
        FROM permission_templates
        WHERE id = ? AND org_id = ?
      `,
      [id, orgId]
    );
    if (!beforeRow) {
      return res.status(404).json({ error: 'Template not found.' });
    }

    const deleteRes = await dbRun(
      `
        DELETE FROM permission_templates
        WHERE id = ? AND org_id = ?
      `,
      [id, orgId]
    );
    if (deleteRes.changes === 0) {
      return res.status(404).json({ error: 'Template not found.' });
    }

    await logAuditEvent({
      req,
      orgId,
      action: 'access.template.delete',
      entityType: 'permission_template',
      entityId: id,
      before: {
        name: beforeRow.name,
        role_title: beforeRow.role_title,
        access: parseTemplateJson(beforeRow.access_json),
        permissions: parseTemplateJson(beforeRow.permissions_json)
      }
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting permission template:', err);
    return res.status(500).json({ error: 'Failed to delete permission template.' });
  }
});

/* ───────── 5.5 SYNC (QuickBooks → SQLite ) ───────── */

app.post('/api/sync/vendors', requireViewPayroll, async (req, res) => {

  const orgId = req.session && req.session.orgId;
  let lockKey = null;
  let lockRefresh = null;
  try {
    const token = await getAccessToken(orgId);
    const realmId = await getRealmId(orgId);
    if (!token || !realmId) {
      return res.status(400).json({ error: 'Not connected to QuickBooks.' });
    }
    lockKey = await acquireQboSyncLock('vendors', orgId);
    if (!lockKey) {
      return res.status(409).json({ error: 'Sync already in progress.' });
    }
    lockRefresh = setInterval(() => {
      refreshQboSyncLock(lockKey);
    }, Math.floor(QBO_SYNC_LOCK_TTL_MS / 2));

    const count = await syncVendors(orgId);
    const syncedAt = new Date().toISOString();
    await upsertOrgSetting(orgId, 'qbo_last_sync_vendors_at', syncedAt);
    await logAuditEvent({
      req,
      orgId,
      action: 'qbo.sync.vendors',
      entityType: 'org',
      entityId: orgId,
      after: { count, synced_at: syncedAt },
      note: 'QuickBooks vendor sync completed.'
    });
    res.json({ ok: true, count, synced_at: syncedAt });
  } catch (err) {
    console.error('Sync vendors error:', err.message);
    return respondWithQboError(res, err, { orgId });
  } finally {
    if (lockRefresh) clearInterval(lockRefresh);
    if (lockKey) {
      await releaseQboSyncLock(lockKey);
    }
  }
});

app.post('/api/sync/employees', requireViewPayroll, async (req, res) => {

  const orgId = req.session && req.session.orgId;
  let lockKey = null;
  let lockRefresh = null;
  try {
    const token = await getAccessToken(orgId);
    const realmId = await getRealmId(orgId);
    if (!token || !realmId) {
      return res.status(400).json({ error: 'Not connected to QuickBooks.' });
    }
    lockKey = await acquireQboSyncLock('employees', orgId);
    if (!lockKey) {
      return res.status(409).json({ error: 'Sync already in progress.' });
    }
    lockRefresh = setInterval(() => {
      refreshQboSyncLock(lockKey);
    }, Math.floor(QBO_SYNC_LOCK_TTL_MS / 2));
    await ensureNameOnChecksColumns();
    const newEmployees = await syncEmployeesFromQuickBooks(orgId);
    const syncedAt = new Date().toISOString();
    await upsertOrgSetting(orgId, 'qbo_last_sync_employees_at', syncedAt);
    await logAuditEvent({
      req,
      orgId,
      action: 'qbo.sync.employees',
      entityType: 'org',
      entityId: orgId,
      after: { count: newEmployees, synced_at: syncedAt },
      note: 'QuickBooks employee sync completed.'
    });
    res.json({ ok: true, count: newEmployees, synced_at: syncedAt });
  } catch (err) {
    console.error('Sync employees error:', err.message);
    return respondWithQboError(res, err, { orgId });
  } finally {
    if (lockRefresh) clearInterval(lockRefresh);
    if (lockKey) {
      await releaseQboSyncLock(lockKey);
    }
  }
});

// Sync local employee name changes to QuickBooks (manual, super admin only)
app.post('/api/sync/qbo-employee-updates', requireViewPayroll, requireSuperAdmin, async (req, res) => {
  const orgId = req.session && req.session.orgId;
  let lockKey = null;
  let lockRefresh = null;
  try {
    const token = await getAccessToken(orgId);
    const realmId = await getRealmId(orgId);
    if (!token || !realmId) {
      return res.status(400).json({ error: 'Not connected to QuickBooks.' });
    }
    lockKey = await acquireQboSyncLock('employee_updates', orgId);
    if (!lockKey) {
      return res.status(409).json({ error: 'Sync already in progress.' });
    }
    lockRefresh = setInterval(() => {
      refreshQboSyncLock(lockKey);
    }, Math.floor(QBO_SYNC_LOCK_TTL_MS / 2));

    const requestedIds = Array.isArray(req.body?.employee_ids)
      ? req.body.employee_ids.map(Number).filter(Number.isFinite)
      : [];
    const idFilter = requestedIds.length
      ? `AND e.id IN (${requestedIds.map(() => '?').join(',')})`
      : '';
    const params = [orgId, ...requestedIds];

    const rows = await dbAll(
      `
        SELECT
          e.id,
          e.name,
          e.given_name,
          e.family_name,
          e.name_on_checks,
          e.employee_qbo_id,
          e.vendor_qbo_id,
          e.qbo_dirty_fields_json,
          e.qbo_conflict_fields_json,
          e.qbo_dirty_updated_at,
          e.qbo_dirty_source,
          e.qbo_dirty_by_employee_id
        FROM employees e
        WHERE e.org_id = ?
          AND IFNULL(e.qbo_dirty_fields_json, '') NOT IN ('', '[]')
          AND (e.employee_qbo_id IS NOT NULL OR e.vendor_qbo_id IS NOT NULL)
          ${idFilter}
        ORDER BY e.name COLLATE NOCASE
      `,
      params
    );

    const syncedAt = new Date().toISOString();
    const results = [];

    for (const row of rows || []) {
      const dirtySet = new Set(parseJsonArray(row.qbo_dirty_fields_json));
      const conflictSet = new Set(parseJsonArray(row.qbo_conflict_fields_json));
      const updatedFields = [];
      const failedFields = [];
      const errors = {};

      const wantsGiven = dirtySet.has('given_name');
      const wantsFamily = dirtySet.has('family_name');
      if (wantsGiven || wantsFamily) {
        if (!row.employee_qbo_id) {
          if (wantsGiven) {
            failedFields.push('given_name');
            errors.given_name = 'Missing QuickBooks employee link.';
          }
          if (wantsFamily) {
            failedFields.push('family_name');
            errors.family_name = 'Missing QuickBooks employee link.';
          }
        } else {
          const res = await updateEmployeeInQuickBooks({
            orgId,
            employeeQboId: row.employee_qbo_id,
            givenName: wantsGiven ? normalizeString(row.given_name) : undefined,
            familyName: wantsFamily ? normalizeString(row.family_name) : undefined
          });
          if (res?.ok) {
            if (wantsGiven) updatedFields.push('given_name');
            if (wantsFamily) updatedFields.push('family_name');
          } else {
            if (wantsGiven) {
              failedFields.push('given_name');
              errors.given_name = res?.error || 'QuickBooks update failed.';
            }
            if (wantsFamily) {
              failedFields.push('family_name');
              errors.family_name = res?.error || 'QuickBooks update failed.';
            }
          }
        }
      }

      if (dirtySet.has('name_on_checks')) {
        const desired = normalizeString(row.name_on_checks);
        const payeeRef = row.vendor_qbo_id
          ? { value: row.vendor_qbo_id, type: 'Vendor' }
          : (row.employee_qbo_id ? { value: row.employee_qbo_id, type: 'Employee' } : null);
        if (!desired) {
          failedFields.push('name_on_checks');
          errors.name_on_checks = 'Name on checks is required.';
        } else if (!payeeRef) {
          failedFields.push('name_on_checks');
          errors.name_on_checks = 'Missing QuickBooks payee link.';
        } else {
          const res = await setPrintOnCheckName(payeeRef, desired, orgId);
          if (res?.ok || res?.skipped) {
            updatedFields.push('name_on_checks');
          } else {
            failedFields.push('name_on_checks');
            errors.name_on_checks = res?.error || 'QuickBooks update failed.';
          }
        }
      }

      const remainingDirty = Array.from(dirtySet).filter(f => !updatedFields.includes(f));
      updatedFields.forEach(f => conflictSet.delete(f));
      const nextDirtyJson = stringifyJsonArray(remainingDirty);
      const nextConflictJson = stringifyJsonArray(Array.from(conflictSet));
      const nextConflictUpdatedAt = nextConflictJson ? syncedAt : null;

      if (updatedFields.length || remainingDirty.length !== Array.from(dirtySet).length) {
        const updates = [];
        const updateParams = [];

        if (updatedFields.includes('given_name')) {
          updates.push('qbo_last_seen_given_name = ?');
          updateParams.push(normalizeString(row.given_name));
        }
        if (updatedFields.includes('family_name')) {
          updates.push('qbo_last_seen_family_name = ?');
          updateParams.push(normalizeString(row.family_name));
        }
        if (updatedFields.includes('name_on_checks')) {
          updates.push('qbo_last_seen_name_on_checks = ?');
          updateParams.push(normalizeString(row.name_on_checks));
          updates.push('name_on_checks_qbo_updated_at = ?');
          updateParams.push(syncedAt);
        }

        if (!nextDirtyJson) {
          updates.push('qbo_dirty_fields_json = NULL');
          updates.push('qbo_dirty_updated_at = NULL');
          updates.push('qbo_dirty_by_employee_id = NULL');
          updates.push('qbo_dirty_source = NULL');
        } else if (updatedFields.length) {
          updates.push('qbo_dirty_fields_json = ?');
          updateParams.push(nextDirtyJson);
        }

        updates.push('qbo_conflict_fields_json = ?');
        updateParams.push(nextConflictJson);
        updates.push('qbo_conflict_updated_at = ?');
        updateParams.push(nextConflictUpdatedAt);

        if (updates.length) {
          updateParams.push(row.id, orgId);
          await dbRun(
            `
              UPDATE employees
              SET ${updates.join(', ')}
              WHERE id = ? AND org_id = ?
            `,
            updateParams
          );
        }
      }

      results.push({
        employee_id: row.id,
        employee_name: row.name,
        updated_fields: updatedFields,
        failed_fields: failedFields,
        errors: Object.keys(errors).length ? errors : null
      });
    }

    await upsertOrgSetting(orgId, 'qbo_last_sync_employee_updates_at', syncedAt);
    await logAuditEvent({
      req,
      orgId,
      action: 'qbo.sync.employee_updates',
      entityType: 'org',
      entityId: orgId,
      after: { synced_at: syncedAt, result_count: results.length },
      note: 'QuickBooks employee update sync completed.'
    });
    return res.json({ ok: true, synced_at: syncedAt, results });
  } catch (err) {
    console.error('Sync employee updates error:', err);
    return respondWithQboError(res, err, { orgId });
  } finally {
    if (lockRefresh) clearInterval(lockRefresh);
    if (lockKey) {
      await releaseQboSyncLock(lockKey);
    }
  }
});

/* ───────── 6. PROJECTS & TIME ENTRIES ───────── */

app.post('/api/sync/projects', requireViewPayroll, async (req, res) => {

  const orgId = req.session && req.session.orgId;
  let lockKey = null;
  let lockRefresh = null;
  try {
    const token = await getAccessToken(orgId);
    const realmId = await getRealmId(orgId);
    if (!token || !realmId) {
      return res.status(400).json({ error: 'Not connected to QuickBooks.' });
    }
    lockKey = await acquireQboSyncLock('projects', orgId);
    if (!lockKey) {
      return res.status(409).json({ error: 'Sync already in progress.' });
    }
    lockRefresh = setInterval(() => {
      refreshQboSyncLock(lockKey);
    }, Math.floor(QBO_SYNC_LOCK_TTL_MS / 2));

    const count = await syncProjects(orgId);
    const syncedAt = new Date().toISOString();
    await upsertOrgSetting(orgId, 'qbo_last_sync_projects_at', syncedAt);
    await logAuditEvent({
      req,
      orgId,
      action: 'qbo.sync.projects',
      entityType: 'org',
      entityId: orgId,
      after: { count, synced_at: syncedAt },
      note: 'QuickBooks project sync completed.'
    });
    res.json({ ok: true, count, synced_at: syncedAt });
  } catch (err) {
    console.error('Sync projects error:', err.message);
    return respondWithQboError(res, err, { orgId });
  } finally {
    if (lockRefresh) clearInterval(lockRefresh);
    if (lockKey) {
      await releaseQboSyncLock(lockKey);
    }
  }
});

// Sync payroll accounts (bank/expense) for settings dropdowns
app.post('/api/sync/payroll-accounts', requireViewPayroll, async (req, res) => {
  const orgId = req.session && req.session.orgId;
  let lockKey = null;
  let lockRefresh = null;
  try {
    const token = await getAccessToken(orgId);
    const realmId = await getRealmId(orgId);
    if (!token || !realmId) {
      return res.status(400).json({ error: 'Not connected to QuickBooks.' });
    }
    lockKey = await acquireQboSyncLock('payroll_accounts', orgId);
    if (!lockKey) {
      return res.status(409).json({ error: 'Sync already in progress.' });
    }
    lockRefresh = setInterval(() => {
      refreshQboSyncLock(lockKey);
    }, Math.floor(QBO_SYNC_LOCK_TTL_MS / 2));
    const { bankAccounts, expenseAccounts } = await listPayrollAccounts(orgId);
    const syncedAt = new Date().toISOString();
    if (orgId) {
      await upsertOrgSetting(orgId, 'qbo_last_sync_payroll_accounts_at', syncedAt);
    }
    await logAuditEvent({
      req,
      orgId,
      action: 'qbo.sync.payroll_accounts',
      entityType: 'org',
      entityId: orgId,
      after: {
        synced_at: syncedAt,
        bank_account_count: bankAccounts.length,
        expense_account_count: expenseAccounts.length
      },
      note: 'QuickBooks payroll accounts sync completed.'
    });
    res.json({
      ok: true,
      synced_at: syncedAt,
      message: `Loaded ${bankAccounts.length} bank and ${expenseAccounts.length} expense accounts from QuickBooks.`,
      bankAccounts,
      expenseAccounts
    });
  } catch (err) {
    console.error('Sync payroll accounts error:', err);
    return respondWithQboError(res, err, { orgId });
  } finally {
    if (lockRefresh) clearInterval(lockRefresh);
    if (lockKey) {
      await releaseQboSyncLock(lockKey);
    }
  }
});

app.post('/api/projects', requireViewPayroll, async (req, res) => {
  const {
    id,
    project_timezone,
    geo_lat,
    geo_lng,
    geo_radius
  } = req.body;
  const orgId = req.session && req.session.orgId;

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

  const isValidLat = (value) => value >= -90 && value <= 90;
  const isValidLng = (value) => value >= -180 && value <= 180;
  const isValidRadius = (value) => value >= 0;

  if (
    hasLatInput &&
    latInput !== null &&
    (Number.isNaN(latInput) || !isValidLat(latInput))
  ) {
    return res.status(400).json({ error: 'Invalid geofence latitude.' });
  }
  if (
    hasLngInput &&
    lngInput !== null &&
    (Number.isNaN(lngInput) || !isValidLng(lngInput))
  ) {
    return res.status(400).json({ error: 'Invalid geofence longitude.' });
  }
  if (
    hasRadiusInput &&
    radiusInput !== null &&
    (Number.isNaN(radiusInput) || !isValidRadius(radiusInput))
  ) {
    return res.status(400).json({ error: 'Invalid geofence radius.' });
  }

  try {
    if (id) {
      const existing = await dbGet(
        `SELECT geo_lat, geo_lng, geo_radius, project_timezone FROM projects WHERE id = ? AND org_id = ?`,
        [id, orgId]
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
        (finalLat !== null &&
          (Number.isNaN(finalLat) || !isValidLat(finalLat))) ||
        (finalLng !== null &&
          (Number.isNaN(finalLng) || !isValidLng(finalLng)))
      ) {
        return res.status(400).json({ error: 'Invalid geofence coordinates.' });
      }
      if (
        finalRadius !== null &&
        (Number.isNaN(finalRadius) || !isValidRadius(finalRadius))
      ) {
        return res.status(400).json({ error: 'Invalid geofence radius.' });
      }

      const updateRes = await dbRun(
        `
          UPDATE projects
          SET geo_lat = ?, geo_lng = ?, geo_radius = ?, project_timezone = ?
          WHERE id = ? AND org_id = ?
        `,
        [finalLat, finalLng, finalRadius, project_timezone || null, id, orgId]
      );

      if (!updateRes || updateRes.changes === 0) {
        return res.status(404).json({ error: 'Project not found.' });
      }

      try {
        await refreshKioskSessionGeofence({
          orgId,
          projectId: id,
          geoLat: finalLat,
          geoLng: finalLng,
          geoRadius: finalRadius
        });
      } catch (err) {
        console.warn('Failed to refresh kiosk session geofence flags:', err.message || err);
      }

      const beforeAudit = {
        geo_lat: existing.geo_lat,
        geo_lng: existing.geo_lng,
        geo_radius: existing.geo_radius,
        project_timezone: existing.project_timezone || null
      };
      const afterAudit = {
        geo_lat: finalLat,
        geo_lng: finalLng,
        geo_radius: finalRadius,
        project_timezone: project_timezone || null
      };
      if (JSON.stringify(beforeAudit) !== JSON.stringify(afterAudit)) {
        await logAuditEvent({
          req,
          orgId,
          action: 'project.update',
          entityType: 'project',
          entityId: id,
          before: beforeAudit,
          after: afterAudit,
          note: 'Project settings updated.'
        });
      }

      return res.json({ ok: true, id });
    }

    return res.status(400).json({ error: 'Project id is required.' });
  } catch (err) {
    console.error('Error saving project:', err);
    return res.status(500).json({ error: 'Failed to save project.' });
  }
});

// ───────── SETTINGS (APP-WIDE) ─────────
app.get('/api/settings', requireViewPayroll, async (req, res) => {
  try {
    const orgId = req.session && req.session.orgId;
    const rows = await dbAll(
      'SELECT key, value FROM org_settings WHERE org_id = ?',
      [orgId]
    );

    const data = {};
    (rows || []).forEach(r => {
      if (!r || !r.key) return;
      if (['payroll_rules', 'time_exception_rules', 'notifications', 'branding'].includes(r.key)) {
        try {
          data[r.key] = r.value ? JSON.parse(r.value) : null;
        } catch {
          data[r.key] = null;
        }
        return;
      }
      if (r.key === 'clock_in_photo_required') {
        data[r.key] = r.value === '1' || r.value === 1 || r.value === true || r.value === 'true';
        return;
      }
      if (r.key === 'storage_daily_late_fee_default') {
        data[r.key] = r.value === null || r.value === '' ? null : Number(r.value);
        return;
      }
      if (r.key === 'storage_container_daily_late_fee_default') {
        data[r.key] = r.value === null || r.value === '' ? null : Number(r.value);
        return;
      }
      if (r.key === 'audit_log_retention_days') {
        if (r.value === null || r.value === '') {
          data[r.key] = null;
        } else {
          const num = Number(r.value);
          data[r.key] = Number.isFinite(num) ? Math.floor(num) : null;
        }
        return;
      }
      data[r.key] = r.value;
    });

    res.json({ settings: data });
  } catch (err) {
    console.error('Error loading settings:', err);
    res.status(500).json({ error: 'Failed to load settings.' });
  }
});

app.post('/api/settings', requireViewPayroll, express.json(), async (req, res) => {
  try {
    const orgId = req.session && req.session.orgId;
    const isSuperAdmin = req.session && req.session.isSuperAdmin;
    const settings = req.body || {};

    if (
      !isSuperAdmin &&
      (settings.payroll_rules !== undefined ||
        settings.time_exception_rules !== undefined ||
        settings.clock_in_photo_required !== undefined ||
        settings.audit_log_retention_days !== undefined)
    ) {
      return res.status(403).json({ error: 'Super admin access required.' });
    }

    const updates = [];

    if (settings.company_name !== undefined) {
      updates.push(['company_name', String(settings.company_name || '').trim()]);
    }
    if (settings.company_email !== undefined) {
      updates.push(['company_email', String(settings.company_email || '').trim()]);
    }
    if (settings.storage_daily_late_fee_default !== undefined) {
      const raw = settings.storage_daily_late_fee_default;
      const val =
        raw === null || raw === '' || typeof raw === 'undefined'
          ? null
          : Number(raw);
      updates.push([
        'storage_daily_late_fee_default',
        val === null || Number.isNaN(val) ? null : String(val)
      ]);
    }
    if (settings.storage_container_daily_late_fee_default !== undefined) {
      const raw = settings.storage_container_daily_late_fee_default;
      const val =
        raw === null || raw === '' || typeof raw === 'undefined'
          ? null
          : Number(raw);
      updates.push([
        'storage_container_daily_late_fee_default',
        val === null || Number.isNaN(val) ? null : String(val)
      ]);
    }
    if (settings.clock_in_photo_required !== undefined) {
      const flag =
        settings.clock_in_photo_required === true ||
        settings.clock_in_photo_required === 'true' ||
        settings.clock_in_photo_required === 1 ||
        settings.clock_in_photo_required === '1';
      updates.push(['clock_in_photo_required', flag ? '1' : '0']);
    }
    if (settings.audit_log_retention_days !== undefined) {
      const raw = settings.audit_log_retention_days;
      let val = null;
      if (raw !== null && raw !== '' && typeof raw !== 'undefined') {
        const num = Number(raw);
        if (!Number.isFinite(num) || num < 0) {
          return res.status(400).json({
            error: 'audit_log_retention_days must be a non-negative number.'
          });
        }
        val = String(Math.floor(num));
      }
      updates.push(['audit_log_retention_days', val]);
    }
    if (settings.time_exception_rules !== undefined) {
      const raw = settings.time_exception_rules;
      const value =
        typeof raw === 'string' ? raw : JSON.stringify(raw || {});
      updates.push(['time_exception_rules', value]);
    }
    if (settings.payroll_rules !== undefined) {
      const raw = settings.payroll_rules;
      const value =
        typeof raw === 'string' ? raw : JSON.stringify(raw || {});
      updates.push(['payroll_rules', value]);
    }

    const updateKeys = updates.map(([key]) => key);
    const beforeMap = {};
    if (updateKeys.length) {
      const placeholders = updateKeys.map(() => '?').join(',');
      const beforeRows = await dbAll(
        `
          SELECT key, value
          FROM org_settings
          WHERE org_id = ? AND key IN (${placeholders})
        `,
        [orgId, ...updateKeys]
      );
      (beforeRows || []).forEach(row => {
        if (!row || !row.key) return;
        beforeMap[row.key] = normalizeOrgSettingValue(row.key, row.value);
      });
    }

    await Promise.all(
      updates.map(([key, value]) =>
        dbRun(
          `
            INSERT INTO org_settings (org_id, key, value)
            VALUES (?, ?, ?)
            ON CONFLICT(org_id, key) DO UPDATE SET value = excluded.value
          `,
          [orgId, key, value]
        )
      )
    );

    if (updateKeys.length) {
      const afterMap = {};
      updateKeys.forEach(key => {
        const update = updates.find(entry => entry[0] === key);
        const value = update ? update[1] : null;
        afterMap[key] = normalizeOrgSettingValue(key, value);
      });

      const changedKeys = updateKeys.filter(key => {
        const beforeVal = beforeMap[key] ?? null;
        const afterVal = afterMap[key] ?? null;
        return JSON.stringify(beforeVal) !== JSON.stringify(afterVal);
      });

      if (changedKeys.length) {
        const beforeAudit = {};
        const afterAudit = {};
        changedKeys.forEach(key => {
          beforeAudit[key] = beforeMap[key] ?? null;
          afterAudit[key] = afterMap[key] ?? null;
        });
        await logAuditEvent({
          req,
          orgId,
          action: 'settings.update',
          entityType: 'org',
          entityId: orgId,
          before: beforeAudit,
          after: afterAudit,
          note: `Updated settings: ${changedKeys.join(', ')}`
        });
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Error saving settings:', err);
    res.status(500).json({ error: 'Failed to save settings.' });
  }
});

app.post('/api/admin/backup', requireSuperAdmin, async (req, res) => {
  try {
    const orgId = req.session && req.session.orgId;
    const result = await runBackupWithLock({ requireLock: true });
    if (result.ok) {
      if (orgId) {
        await logAuditEvent({
          req,
          orgId,
          action: 'admin.backup.create',
          entityType: 'org',
          entityId: orgId,
          note: 'Manual backup created.'
        });
      }
      return res.json({ ok: true });
    }
    if (result.reason === 'lock_busy') {
      return res.status(409).json({ ok: false, error: 'Backup already running.' });
    }
    return res.status(500).json({ ok: false, error: 'Backup failed.' });
  } catch (err) {
    console.error('Manual backup failed:', err);
    return res.status(500).json({ ok: false, error: 'Backup failed.' });
  }
});

// Kiosk-safe settings fetch (no auth cookie needed)
app.get('/api/kiosk/settings', async (req, res) => {
  try {
    const access = await ensureKioskDevice(req);
    if (!access.ok) {
      return res
        .status(access.status || 401)
        .json({ error: access.error || 'Not authenticated' });
    }

    const orgId =
      access.via === 'session'
        ? req.session && req.session.orgId
        : access.kiosk && access.kiosk.org_id;

    const rows = await dbAll(
      `
        SELECT key, value
        FROM org_settings
        WHERE org_id = ? AND key IN ('clock_in_photo_required')
      `,
      [orgId]
    );
    const data = {};
    (rows || []).forEach(r => {
      if (!r || !r.key) return;
      if (r.key === 'clock_in_photo_required') {
        data[r.key] =
          r.value === '1' ||
          r.value === 1 ||
          r.value === true ||
          r.value === 'true';
      }
    });
    res.json({ settings: data });
  } catch (err) {
    console.error('Error loading kiosk settings:', err);
    res.status(500).json({ error: 'Failed to load settings.' });
  }
});

// Super admin: view/rotate kiosk enrollment code
app.get('/api/kiosks/enrollment-code', requireSuperAdmin, async (req, res) => {
  try {
    const orgId = req.session && req.session.orgId;
    const code = await loadEnrollmentCode(orgId, { createIfMissing: true });
    res.json({ code });
  } catch (err) {
    console.error('Error loading kiosk enrollment code:', err);
    res.status(500).json({ error: 'Failed to load enrollment code.' });
  }
});

app.post('/api/kiosks/enrollment-code/rotate', requireSuperAdmin, async (req, res) => {
  try {
    const orgId = req.session && req.session.orgId;
    const code = await rotateEnrollmentCode(orgId);
    await logAuditEvent({
      req,
      orgId,
      action: 'kiosk.enrollment.rotate',
      entityType: 'org',
      entityId: orgId,
      note: 'Kiosk enrollment code rotated.'
    });
    res.json({ code });
  } catch (err) {
    console.error('Error rotating kiosk enrollment code:', err);
    res.status(500).json({ error: 'Failed to rotate enrollment code.' });
  }
});


async function getExceptionActor(req, fallbackName) {
  const actorUserId = (req.session && req.session.userId) || null;
  const ctxEmployeeId =
    req && req.modifyTimeContext && req.modifyTimeContext.adminId
      ? req.modifyTimeContext.adminId
      : null;
  const actorEmployeeId =
    (req.session && req.session.employeeId) || ctxEmployeeId || null;
  const orgId =
    (req && req.modifyTimeContext && req.modifyTimeContext.orgId) ||
    (req.session && req.session.orgId) ||
    null;

  let actorName = fallbackName || null;

  if (!actorName && actorEmployeeId && orgId) {
    const emp = await dbGet(
      'SELECT name, name_on_checks, email FROM employees WHERE id = ? AND org_id = ?',
      [actorEmployeeId, orgId]
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

async function loadEmployeeAuditSnapshot({ orgId, employeeId }) {
  if (!orgId || !employeeId) return null;
  return dbGet(
    `
      SELECT
        e.id,
        e.name,
        e.given_name,
        e.family_name,
        e.nickname,
        e.name_on_checks,
        e.email,
        e.phone,
        e.rate,
        e.language,
        e.role_title,
        e.permission_template_id,
        e.worker_timekeeping,
        e.desktop_access,
        e.kiosk_admin_access,
        e.active,
        e.start_date,
        e.termination_date,
        e.employee_qbo_id,
        e.vendor_qbo_id,
        e.needs_qbo_sync,
        p.see_shipments,
        p.modify_time,
        p.approve_time,
        p.view_time_reports,
        p.view_all_timesheets,
        p.assign_timesheets,
        p.view_payroll,
        p.modify_payroll,
        p.modify_pay_rates
      FROM employees e
      LEFT JOIN employee_permissions p
        ON p.employee_id = e.id
      WHERE e.id = ? AND e.org_id = ?
      LIMIT 1
    `,
    [employeeId, orgId]
  );
}

async function logEmployeeAuditUpdate({
  req,
  orgId,
  employeeId,
  action = 'employee.update',
  note = null,
  beforeSnapshot = null,
  actorUserId = null,
  actorEmployeeId = null
}) {
  const afterSnapshot = await loadEmployeeAuditSnapshot({ orgId, employeeId });
  const shouldAudit =
    beforeSnapshot && afterSnapshot
      ? JSON.stringify(beforeSnapshot) !== JSON.stringify(afterSnapshot)
      : !!afterSnapshot;
  if (!shouldAudit) return;
  await logAuditEvent({
    req,
    orgId,
    action,
    entityType: 'employee',
    entityId: employeeId,
    before: beforeSnapshot,
    after: afterSnapshot,
    note,
    actorUserId,
    actorEmployeeId
  });
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

function parseTimestampMs(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function computeTimeEntryRequiresNote(row, ruleFlags = {}) {
  const {
    ruleManualNoPunches,
    ruleManualHoursMismatch,
    ruleHasPunchException
  } = ruleFlags;

  const HOURS_EPSILON = 0.1; // keep in sync with time exception rules
  const punchCount = Number(row.punch_count || 0);
  const punchHours =
    row.punch_hours != null && !Number.isNaN(Number(row.punch_hours))
      ? Number(row.punch_hours)
      : 0;
  const entryHours =
    row.hours != null && !Number.isNaN(Number(row.hours))
      ? Number(row.hours)
      : null;

  const manualNoPunches = ruleManualNoPunches && punchCount === 0;
  const manualHoursMismatch =
    ruleManualHoursMismatch &&
    entryHours != null &&
    Math.abs(punchHours - entryHours) >= HOURS_EPSILON;

  const hasDiscrepancy =
    manualNoPunches ||
    manualHoursMismatch ||
    (ruleHasPunchException && Number(row.punch_exception_count || 0) > 0);

  const lastEditMs = parseTimestampMs(row.last_manual_edit_at);
  const approvedMs = parseTimestampMs(row.approved_at);
  const manualEditSinceApproval =
    lastEditMs != null && (!approvedMs || lastEditMs > approvedMs);

  return hasDiscrepancy || manualEditSinceApproval;
}

function normalizeReviewStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function isFieldReviewComplete(row) {
  if (!row) return false;
  if (row.resolved) return true;
  const status = normalizeReviewStatus(row.resolved_status);
  return status !== '' && status !== 'open';
}

function isFieldReviewRejected(row) {
  if (!row) return false;
  return normalizeReviewStatus(row.resolved_status) === 'rejected';
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

  const tz = orgTimezone || APP_TIMEZONE;
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

  const punchRows = await dbAll(
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
    params
  );

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

async function loadTimeEntryApprovalRows({
  orgId,
  entryId = null,
  start = null,
  end = null,
  employeeId = null,
  projectId = null,
  adminId = null,
  perms = null,
  isSuperAdmin = null
}) {
  const rulesMap = await loadExceptionRulesMap(orgId);
  const isRuleEnabled = makeRuleChecker(rulesMap);

  const ruleManualNoPunches = isRuleEnabled('manual_no_punches');
  const ruleManualHoursMismatch = isRuleEnabled('manual_hours_mismatch');

  const ruleMissingClockOut = isRuleEnabled('missing_clock_out');
  const ruleLongShift = isRuleEnabled('long_shift');
  const ruleMultiDay = isRuleEnabled('multi_day');
  const ruleCrossesMidnight = isRuleEnabled('crosses_midnight');
  const ruleNoProject = isRuleEnabled('no_project');
  const ruleProjectMismatch = isRuleEnabled('project_mismatch');
  const ruleTinyPunch = isRuleEnabled('tiny_punch');
  const ruleGeoIn = isRuleEnabled('geofence_clock_in');
  const ruleAutoClockOut = isRuleEnabled('auto_clock_out');
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
  if (ruleAutoClockOut) {
    punchExceptionConditions.push('tp.auto_clock_out IS NOT NULL AND tp.auto_clock_out != 0');
  }
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

  const punchExceptionExpr = punchExceptionConditions.length
    ? `SUM(CASE WHEN ${punchExceptionConditions.join(' OR ')} THEN 1 ELSE 0 END)`
    : '0';

  const where = ['t.org_id = ?'];
  const params = [orgId];
  const visibility = buildTimeEntryVisibilityFilter({
    adminId,
    perms,
    isSuperAdmin,
    entryAlias: 't'
  });
  if (visibility.clause) {
    where.push(visibility.clause.trim());
    params.push(...visibility.params);
  }
  if (entryId) {
    where.push('t.id = ?');
    params.push(entryId);
  }
  if (start) {
    where.push('t.start_date >= ?');
    params.push(start);
  }
  if (end) {
    where.push('t.end_date <= ?');
    params.push(end);
  }
  if (employeeId) {
    where.push('t.employee_id = ?');
    params.push(employeeId);
  }
  if (projectId) {
    where.push('t.project_id = ?');
    params.push(projectId);
  }

  const sql = `
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
      t.approval_status,
      t.approved_at,
      t.approved_by_employee_id,
      t.updated_at,
      COUNT(tp.id) AS punch_count,
      SUM(
        CASE
          WHEN tp.clock_in_ts IS NOT NULL AND tp.clock_out_ts IS NOT NULL
          THEN (julianday(tp.clock_out_ts) - julianday(tp.clock_in_ts)) * 24.0
          ELSE 0
        END
      ) AS punch_hours,
      ${punchExceptionExpr} AS punch_exception_count,
      (
        SELECT MAX(created_at)
        FROM time_exception_actions tea
        WHERE tea.source_type = 'time_entry'
          AND tea.source_id = t.id
          AND tea.action = 'modify'
      ) AS last_manual_edit_at
    FROM time_entries t
    LEFT JOIN time_punches tp ON tp.time_entry_id = t.id AND tp.org_id = t.org_id
    LEFT JOIN kiosk_sessions ks ON ks.id = tp.kiosk_session_id AND ks.org_id = tp.org_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
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
      t.approval_status,
      t.approved_at,
      t.approved_by_employee_id,
      t.updated_at
  `;

  let rows = await dbAll(sql, params);

  if (ruleWeeklyHours && weeklyHoursThreshold && rows && rows.length) {
    const orgTimezone = await getOrgTimezone(orgId);
    const weeklyCounts = await loadWeeklyHoursExceptionCounts({
      orgId,
      start,
      end,
      orgTimezone,
      weeklyHoursThreshold
    });
    for (const row of rows) {
      const entryId = Number(row.id || 0);
      if (!entryId) continue;
      const counts = weeklyCounts.perEntry.get(entryId);
      if (counts && counts.total > 0) {
        row.punch_exception_count = Number(row.punch_exception_count || 0) + counts.total;
      }
    }
  }

  rows = rows || [];
  return {
    rows,
    ruleFlags: {
      ruleManualNoPunches,
      ruleManualHoursMismatch,
      ruleHasPunchException:
        punchExceptionConditions.length > 0 || (ruleWeeklyHours && weeklyHoursThreshold)
    }
  };
}

async function loadPendingTimeEntryApprovals({ orgId, start, end }) {
  const rows = await dbAll(
    `
      SELECT
        t.id,
        t.employee_id,
        COALESCE(e.name, t.employee_name_snapshot) AS employee_name,
        t.start_date,
        t.end_date,
        t.approval_status
      FROM time_entries t
      LEFT JOIN employees e ON e.id = t.employee_id AND e.org_id = t.org_id
      WHERE t.org_id = ?
        AND t.start_date >= ?
        AND t.end_date <= ?
        AND LOWER(COALESCE(t.resolved_status, 'open')) != 'rejected'
        AND LOWER(COALESCE(t.approval_status, 'pending')) != 'approved'
      ORDER BY t.start_date ASC, t.id ASC
    `,
    [orgId, start, end]
  );
  return rows || [];
}

async function loadPendingTimeEntryFieldReviews({ orgId, start, end }) {
  const rows = await dbAll(
    `
      SELECT
        t.id,
        t.employee_id,
        COALESCE(e.name, t.employee_name_snapshot) AS employee_name,
        t.start_date,
        t.end_date,
        t.resolved_status
      FROM time_entries t
      LEFT JOIN employees e ON e.id = t.employee_id AND e.org_id = t.org_id
      WHERE t.org_id = ?
        AND t.start_date >= ?
        AND t.end_date <= ?
        AND IFNULL(t.resolved, 0) = 0
        AND LOWER(COALESCE(t.resolved_status, 'open')) = 'open'
      ORDER BY t.start_date ASC, t.id ASC
    `,
    [orgId, start, end]
  );
  return rows || [];
}

async function loadPendingTimeEntryReviewCount({
  orgId,
  adminId = null,
  perms = null,
  isSuperAdmin = null
}) {
  if (!orgId) return 0;
  const visibility = buildTimeEntryVisibilityFilter({
    adminId,
    perms,
    isSuperAdmin,
    entryAlias: 't'
  });
  const where = [
    't.org_id = ?',
    'IFNULL(t.resolved, 0) = 0',
    "LOWER(COALESCE(t.resolved_status, 'open')) = 'open'"
  ];
  const params = [orgId];
  if (visibility.clause) {
    where.push(visibility.clause.trim());
    params.push(...visibility.params);
  }

  const row = await dbGet(
    `
      SELECT COUNT(*) AS pending_count
      FROM time_entries t
      WHERE ${where.join(' AND ')}
    `,
    params
  );
  return Number(row && row.pending_count ? row.pending_count : 0);
}

async function loadPendingTimeEntryReviewEntries({
  orgId,
  employeeId = null,
  projectId = null,
  limit = 200,
  adminId = null,
  perms = null,
  isSuperAdmin = null
}) {
  if (!orgId) return [];
  const params = [orgId];
  const where = ['t.org_id = ?'];
  where.push('IFNULL(t.resolved, 0) = 0');
  where.push("LOWER(COALESCE(t.resolved_status, 'open')) = 'open'");
  const visibility = buildTimeEntryVisibilityFilter({
    adminId,
    perms,
    isSuperAdmin,
    entryAlias: 't'
  });
  if (visibility.clause) {
    where.push(visibility.clause.trim());
    params.push(...visibility.params);
  }
  if (employeeId) {
    where.push('t.employee_id = ?');
    params.push(employeeId);
  }
  if (projectId) {
    where.push('t.project_id = ?');
    params.push(projectId);
  }

  const sql = `
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
      t.approval_status,
      t.approved_at,
      t.approved_by_employee_id,
      t.approval_note,
      t.resolved_status,
      t.resolved_note,
      t.verified,
      t.verified_at,
      t.verified_by_employee_id,
      t.resolved,
      t.resolved_at,
      t.resolved_by,
      t.updated_at,
      COALESCE(e.name, t.employee_name_snapshot) AS employee_name,
      COALESCE(p.name, t.project_name_snapshot) AS project_name,
      ap.name AS approved_by_name,
      COALESCE(MAX(CASE
        WHEN tp.geo_violation != 0 OR ks.geo_violation != 0 THEN 1
        ELSE 0
      END), 0) AS has_geo_violation,
      COALESCE(MAX(tp.auto_clock_out), 0)     AS has_auto_clock_out,
      COALESCE(MAX(tp.auto_clock_out_reason), '') AS auto_clock_out_reason,
      COALESCE(MAX(tp.exception_resolved), 0) AS punch_exception_resolved,
      COALESCE(SUM(CASE
        WHEN (
          (tp.geo_violation != 0 OR ks.geo_violation != 0 OR tp.auto_clock_out != 0)
          AND IFNULL(tp.exception_resolved, 0) = 0
        )
        THEN 1
        ELSE 0
      END), 0) AS punch_exception_unresolved,
      GROUP_CONCAT(DISTINCT CASE
        WHEN (
          (tp.geo_violation != 0 OR ks.geo_violation != 0 OR tp.auto_clock_out != 0)
          AND IFNULL(tp.exception_resolved, 0) = 0
        )
        THEN tp.id
        ELSE NULL
      END) AS punch_exception_ids,
      COUNT(tp.id) AS punch_count,
      SUM(
        CASE
          WHEN tp.clock_in_ts IS NOT NULL AND tp.clock_out_ts IS NOT NULL
          THEN (julianday(tp.clock_out_ts) - julianday(tp.clock_in_ts)) * 24.0
          ELSE 0
        END
      ) AS punch_hours
    FROM time_entries t
    LEFT JOIN employees e ON t.employee_id = e.id AND e.org_id = t.org_id
    LEFT JOIN projects  p ON t.project_id = p.id AND p.org_id = t.org_id
    LEFT JOIN time_punches tp ON tp.time_entry_id = t.id AND tp.org_id = t.org_id
    LEFT JOIN kiosk_sessions ks ON ks.id = tp.kiosk_session_id AND ks.org_id = tp.org_id
    LEFT JOIN employees ap ON ap.id = t.approved_by_employee_id AND ap.org_id = t.org_id
    WHERE ${where.join(' AND ')}
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
      t.approval_status,
      t.approved_at,
      t.approved_by_employee_id,
      t.approval_note,
      t.resolved_status,
      t.resolved_note,
      t.verified,
      t.verified_at,
      t.verified_by_employee_id,
      t.resolved,
      t.resolved_at,
      t.resolved_by,
      t.updated_at,
      e.name,
      p.name,
      ap.name,
      t.employee_name_snapshot,
      t.project_name_snapshot
    ORDER BY t.start_date DESC, t.id DESC
    LIMIT ?
  `;

  params.push(Number(limit) || 200);
  const rows = await dbAll(sql, params);
  return rows || [];
}

async function loadPayrollUnresolvedExceptions({ orgId, start, end }) {
  if (!orgId || !start || !end) return [];

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
  if (ruleAutoClockOut) {
    punchExceptionConditions.push('tp.auto_clock_out IS NOT NULL AND tp.auto_clock_out != 0');
  }
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

  const punchExceptionUnapprovedCase = punchExceptionConditions.length
    ? `CASE ${punchExceptionConditions.map(c => `WHEN (${c}) AND LOWER(COALESCE(tp.exception_review_status, 'open')) NOT IN ('approved','modified') THEN 1`).join(' ')} ELSE 0 END`
    : '0';

  const HOURS_EPSILON = 0.1; // keep in sync with payroll filtering
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
        t.employee_name_snapshot,
        t.project_name_snapshot,
        t.start_date,
        t.end_date,
        t.hours,
        t.resolved_status,
        COUNT(tp.id) AS punch_count,
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
      LEFT JOIN kiosk_sessions ks ON ks.id = tp.kiosk_session_id AND ks.org_id = tp.org_id
      WHERE t.org_id = ? AND t.start_date >= ? AND t.end_date <= ?
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
        t.resolved_status
    )
    SELECT
      f.*,
      COALESCE(e.name, f.employee_name_snapshot) AS employee_name,
      COALESCE(p.name, f.project_name_snapshot, '(No project)') AS project_name,
      CASE
        WHEN ${entryExceptionExpr} != 0
          AND LOWER(COALESCE(f.resolved_status, 'open')) NOT IN ('approved', 'modified')
        THEN 1 ELSE 0
      END AS entry_exception_unapproved,
      CASE
        WHEN IFNULL(f.punch_exception_unapproved_count, 0) > 0
        THEN 1 ELSE 0
      END AS punch_exception_unapproved
    FROM entry_flags f
    LEFT JOIN employees e ON f.employee_id = e.id AND e.org_id = ?
    LEFT JOIN projects p ON f.project_id = p.id AND p.org_id = ?
    WHERE
      LOWER(COALESCE(f.resolved_status, 'open')) != 'rejected'
      AND (
        (
          ${entryExceptionExpr} != 0
          AND LOWER(COALESCE(f.resolved_status, 'open')) NOT IN ('approved', 'modified')
        )
        OR IFNULL(f.punch_exception_unapproved_count, 0) > 0
      )
  `;

  const rows = await dbAll(sql, [orgId, start, end, orgId, orgId]);
  const flagged = new Map();

  for (const row of rows || []) {
    const reasons = [];
    if (row.entry_exception_unapproved) reasons.push('entry_exception');
    if (row.punch_exception_unapproved) reasons.push('punch_exception');
    flagged.set(row.id, {
      time_entry_id: row.id,
      employee_id: row.employee_id,
      employee_name: row.employee_name || row.employee_name_snapshot,
      project_id: row.project_id,
      project_name: row.project_name || row.project_name_snapshot,
      start_date: row.start_date,
      end_date: row.end_date,
      reasons
    });
  }

  if (ruleWeeklyHours && weeklyHoursThreshold) {
    const orgTimezone = await getOrgTimezone(orgId);
    const weeklyCounts = await loadWeeklyHoursExceptionCounts({
      orgId,
      start,
      end,
      orgTimezone,
      weeklyHoursThreshold
    });
    const weeklyIds = [];
    for (const [entryId, counts] of weeklyCounts.perEntry.entries()) {
      if (counts && counts.unapproved > 0) {
        weeklyIds.push(entryId);
      }
    }
    const missingIds = weeklyIds.filter(id => !flagged.has(id));
    if (missingIds.length) {
      const placeholders = missingIds.map(() => '?').join(',');
      const detailRows = await dbAll(
        `
          SELECT
            t.id,
            t.employee_id,
            t.project_id,
            t.employee_name_snapshot,
            t.project_name_snapshot,
            t.start_date,
            t.end_date,
            COALESCE(e.name, t.employee_name_snapshot) AS employee_name,
            COALESCE(p.name, t.project_name_snapshot, '(No project)') AS project_name
          FROM time_entries t
          LEFT JOIN employees e ON e.id = t.employee_id AND e.org_id = t.org_id
          LEFT JOIN projects p ON p.id = t.project_id AND p.org_id = t.org_id
          WHERE t.org_id = ?
            AND t.start_date >= ?
            AND t.end_date <= ?
            AND (t.paid IS NULL OR t.paid = 0)
            AND LOWER(COALESCE(t.resolved_status, 'open')) != 'rejected'
            AND t.id IN (${placeholders})
        `,
        [orgId, start, end, ...missingIds]
      );
      for (const row of detailRows || []) {
        flagged.set(row.id, {
          time_entry_id: row.id,
          employee_id: row.employee_id,
          employee_name: row.employee_name || row.employee_name_snapshot,
          project_id: row.project_id,
          project_name: row.project_name || row.project_name_snapshot,
          start_date: row.start_date,
          end_date: row.end_date,
          reasons: ['weekly_hours']
        });
      }
    }
    for (const entryId of weeklyIds) {
      const entry = flagged.get(entryId);
      if (entry && !entry.reasons.includes('weekly_hours')) {
        entry.reasons.push('weekly_hours');
      }
    }
  }

  return Array.from(flagged.values());
}

app.get('/api/time-exceptions', requireViewTimeReports, async (req, res) => {
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

    const orgId = req.session && req.session.orgId;
    if (!orgId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    const adminId = req.session && req.session.employeeId;
    let perms = req.adminPerms;
    if (!perms && adminId) {
      perms = await getAdminAccessPerms({ employeeId: adminId, orgId });
    }
    const isSuperAdmin = adminId
      ? await isEmployeeSuperAdmin({ employeeId: adminId, orgId })
      : false;

    const params = [orgId];
    let where = 'WHERE tp.org_id = ? ';

    // Date range using org-local clock-in date
    where +=
      'AND tp.clock_in_local_date >= ? AND tp.clock_in_local_date <= ? ';
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
    const punchVisibility = buildTimePunchVisibilityFilter({
      adminId,
      perms,
      isSuperAdmin,
      punchAlias: 'tp',
      sessionAlias: 'ks'
    });
    if (punchVisibility.clause) {
      where += `AND ${punchVisibility.clause} `;
      params.push(...punchVisibility.params);
    }

    // Pull punches + employee/project + geofence + exception info
    const rows = await dbAll(
      `
      SELECT
        tp.id,
        tp.time_entry_id,
        tp.employee_id,
        tp.project_id,
        tp.clock_in_ts,
        tp.clock_out_ts,
        tp.clock_in_local_date,
        tp.clock_out_local_date,
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
        ks.geo_violation AS session_geo_violation,
        tp.updated_at,

        COALESCE(e.name, tp.employee_name_snapshot) AS employee_name,
        COALESCE(p.name, tp.project_name_snapshot) AS project_name,
        p.customer_name,
        p.geo_lat,
        p.geo_lng,
        p.geo_radius
      FROM time_punches tp
      LEFT JOIN employees e ON tp.employee_id = e.id AND e.org_id = tp.org_id
      LEFT JOIN projects p ON tp.project_id = p.id AND p.org_id = tp.org_id
      LEFT JOIN kiosk_sessions ks ON ks.id = tp.kiosk_session_id AND ks.org_id = tp.org_id
      ${where}
      ORDER BY tp.clock_in_ts ASC
      `,
      params
    );

    let exceptionRules = null;
    try {
      const row = await dbGet(
        'SELECT value FROM org_settings WHERE org_id = ? AND key = ?',
        [orgId, 'time_exception_rules']
      );
      if (row && row.value) {
        const parsed = JSON.parse(row.value);
        if (parsed && typeof parsed === 'object') exceptionRules = parsed;
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

    const orgTimezone = await getOrgTimezone(orgId);
    const tz = orgTimezone || APP_TIMEZONE;
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
    const weekdayMap = {
      Mon: 0,
      Tue: 1,
      Wed: 2,
      Thu: 3,
      Fri: 4,
      Sat: 5,
      Sun: 6
    };
    const shiftIsoDate = (dateStr, deltaDays) => {
      const parts = String(dateStr || '').split('-').map(Number);
      if (parts.length !== 3 || parts.some(Number.isNaN)) return dateStr;
      const [year, month, day] = parts;
      const dt = new Date(Date.UTC(year, month - 1, day + deltaDays));
      return dt.toISOString().slice(0, 10);
    };
    // Helper to normalize a timestamp to the Monday that starts its week in org timezone
    const getWeekStart = dateObj => {
      if (!dateObj) return null;
      const parts = dateFormatter.formatToParts(dateObj);
      const year = parts.find(p => p.type === 'year')?.value;
      const month = parts.find(p => p.type === 'month')?.value;
      const day = parts.find(p => p.type === 'day')?.value;
      if (!year || !month || !day) return null;
      const dateStr = `${year}-${month}-${day}`;
      const weekdayShort = weekdayFormatter.format(dateObj);
      const weekdayIndex = weekdayMap[weekdayShort];
      if (weekdayIndex == null) return dateStr;
      return shiftIsoDate(dateStr, -weekdayIndex);
    };

    const rawWeeklyThreshold =
      exceptionRules && exceptionRules.weekly_hours_threshold != null
        ? Number(exceptionRules.weekly_hours_threshold)
        : null;
    const WEEKLY_HOURS_THRESHOLD =
      Number.isFinite(rawWeeklyThreshold) && rawWeeklyThreshold > 0
        ? rawWeeklyThreshold
        : null;
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
    if (WEEKLY_HOURS_THRESHOLD) {
      for (const [key, hours] of punchWeekTotals.entries()) {
        if (hours > WEEKLY_HOURS_THRESHOLD) {
          weeksOverThreshold.set(key, hours);
        }
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
        const startDateStr =
          r.clock_in_local_date || getIsoDateInTimezone(startTs, tz);
        const endDateStr =
          r.clock_out_local_date || getIsoDateInTimezone(endTs, tz);
        if (startDateStr && endDateStr && startDateStr !== endDateStr) {
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
      if (isRuleEnabled('tiny_punch') && durationHours !== null) {
        const minutes = durationHours * 60;
        if (minutes >= 0 && minutes < 5) {
          flags.push('Tiny punch (<5 min)');
        }
      }

      // 6b) Weekly overtime threshold
      if (weekKey) {
        const weeklyHours = weeksOverThreshold.get(`${r.employee_id}|${weekKey}`);
        if (weeklyHours && WEEKLY_HOURS_THRESHOLD && isRuleEnabled('weekly_hours')) {
          flags.push(
            `Week of ${weekKey} exceeds ${WEEKLY_HOURS_THRESHOLD}h (${weeklyHours.toFixed(2)}h)`
          );
        }
      }

      // 7) Geofence mismatch (kiosk clock-in + session check)
      if (isRuleEnabled('geofence_clock_in')) {
        if (r.geo_violation) {
          flags.push('Clock-in outside geofence');
        }
        if (r.session_geo_violation) {
          flags.push('Kiosk outside geofence (timesheet)');
        }
      }

      // 8) Auto clock-out (midnight job or any auto close)
      if (isRuleEnabled('auto_clock_out') && r.auto_clock_out) {
        const reason = r.auto_clock_out_reason || '';
        if (reason === 'midnight_auto') {
          flags.push('Auto clock-out (midnight job)');
        } else if (reason === 'catch_up_auto') {
          flags.push('Auto clock-out (catch-up job)');
        } else if (reason === 'daily_max') {
          flags.push('Auto clock-out (daily max)');
        } else if (reason === 'weekly_max') {
          flags.push('Auto clock-out (weekly max)');
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
        time_entry_id: r.time_entry_id || null,
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
        has_geo_violation: r.geo_violation || r.session_geo_violation ? 1 : 0,
        auto_clock_out: r.auto_clock_out ? 1 : 0,
        auto_clock_out_reason: r.auto_clock_out_reason || null,
        updated_at: r.updated_at || null
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

    const entryWhere = ['t.org_id = ?'];
    const entryParams = [orgId];

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
    const entryVisibility = buildTimeEntryVisibilityFilter({
      adminId,
      perms,
      isSuperAdmin,
      entryAlias: 't'
    });
    if (entryVisibility.clause) {
      entryWhere.push(entryVisibility.clause.trim());
      entryParams.push(...entryVisibility.params);
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
        t.updated_at,

        COALESCE(e.name, t.employee_name_snapshot) AS employee_name,
        COALESCE(p.name, t.project_name_snapshot) AS project_name,
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
      LEFT JOIN employees e ON t.employee_id = e.id AND e.org_id = t.org_id
      LEFT JOIN projects  p ON t.project_id  = p.id AND p.org_id = t.org_id
      LEFT JOIN time_punches tp ON tp.time_entry_id = t.id AND tp.org_id = t.org_id
      LEFT JOIN kiosk_sessions ks ON ks.id = tp.kiosk_session_id AND ks.org_id = tp.org_id
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
        customer_name,
        t.employee_name_snapshot,
        t.project_name_snapshot
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
        time_entry_id: te.id,

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
        updated_at: te.updated_at || null,

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



app.post('/api/time-exceptions/:id/review', requireModifyTimeAny, async (req, res) => {
  const exceptionId = Number(req.params.id);
  const {
    source,          // 'punch' | 'time_entry'
    action,          // 'approve' | 'modify' | 'reject'
    note,
    actor_name,
    updates = {},
    if_match_updated_at,
    client_id,
    resolve: resolveReview
  } = req.body || {};
  const ctx = req.modifyTimeContext;
  const orgId = ctx && ctx.orgId ? ctx.orgId : (req.session && req.session.orgId);
  const orgTimezone = await getOrgTimezone(orgId);
  const clientId = client_id ? String(client_id).trim() : '';

  // Small helpers for validation
  const toDate = value => {
    if (value == null) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const dateOnly = value => {
    const d = toDate(value);
    if (!d) return null;
    return getIsoDateInTimezone(d, orgTimezone) || d.toISOString().slice(0, 10);
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
  if ((!note || !note.trim()) && (action === 'modify' || action === 'reject' || action === 'approve')) {
    return res
      .status(400)
      .json({ ok: false, error: 'A note is required for this review action.' });
  }
  if (!orgId) {
    return res.status(401).json({ ok: false, error: 'Not authenticated.' });
  }
  const adminId = ctx && ctx.adminId ? ctx.adminId : (req.session && req.session.employeeId);
  const perms = ctx && ctx.perms
    ? ctx.perms
    : adminId
      ? await getAdminAccessPerms({ employeeId: adminId, orgId })
      : null;
  const isSuperAdmin = adminId
    ? await isEmployeeSuperAdmin({ employeeId: adminId, orgId })
    : false;
  const canSeeTarget = source === 'punch'
    ? await isTimePunchVisibleForAdmin({
        orgId,
        punchId: exceptionId,
        adminId,
        perms,
        isSuperAdmin
      })
    : await isTimeEntryVisibleForAdmin({
        orgId,
        entryId: exceptionId,
        adminId,
        perms,
        isSuperAdmin
      });
  if (!canSeeTarget) {
    return res.status(403).json({ ok: false, error: 'Not authorized.' });
  }
  if (clientId) {
    const cached = await loadIdempotentResponse(orgId, 'time_exception_review', clientId);
    if (cached) {
      return res.json({ ...cached, alreadyProcessed: true });
    }
  }

  try {
    const { actorUserId, actorEmployeeId, actorName } =
      await getExceptionActor(req, actor_name || null);

    const nowIso = new Date().toISOString();
    const shouldResolve = action !== 'modify' ? true : resolveReview !== false;
    const statusVal =
      action === 'approve'
        ? 'approved'
        : action === 'reject'
          ? 'rejected'
          : shouldResolve
            ? 'modified'
            : 'open';

    let before = {};
    let after = {};

    if (source === 'punch') {
      const punch = await dbGet(
        'SELECT * FROM time_punches WHERE id = ? AND org_id = ?',
        [exceptionId, orgId]
      );
      if (!punch) {
        return res.status(404).json({ ok: false, error: 'Punch not found.' });
      }

      if (if_match_updated_at && punch.updated_at && punch.updated_at !== if_match_updated_at) {
        return res.status(409).json({
          ok: false,
          error: 'Conflict: the punch was updated since you last loaded it.',
          current: pickFields(punch, [
            'id',
            'employee_id',
            'project_id',
            'clock_in_ts',
            'clock_out_ts',
            'clock_out_project_id',
            'updated_at'
          ])
        });
      }

      let linkedEntry = null;
      if (punch.time_entry_id) {
        linkedEntry = await dbGet(
          'SELECT * FROM time_entries WHERE id = ? AND org_id = ?',
          [punch.time_entry_id, orgId]
        );
      }
      if (action === 'modify' && linkedEntry && linkedEntry.paid) {
        return res.status(409).json({
          ok: false,
          error:
            'This time entry has already been paid and cannot be modified. Create an adjustment entry instead.'
        });
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
        const parseYmd = value => {
          if (value == null) return null;
          const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (!match) return null;
          const year = Number(match[1]);
          const month = Number(match[2]);
          const day = Number(match[3]);
          if ([year, month, day].some(Number.isNaN)) return null;
          if (month < 1 || month > 12) return null;
          const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
          if (day < 1 || day > maxDay) return null;
          return { year, month, day };
        };

        const toLocalIso = (dateStr, timeStr) => {
          const dateParts = parseYmd(dateStr);
          const minutes = parseHm(timeStr);
          if (!dateParts || minutes == null) return null;
          const hour = Math.floor(minutes / 60);
          const minute = minutes % 60;
          const utcMs = getUtcTimestampForLocal(
            {
              year: dateParts.year,
              month: dateParts.month,
              day: dateParts.day,
              hour,
              minute,
              second: 0
            },
            orgTimezone
          );
          return new Date(utcMs).toISOString();
        };

        const hasStartDate = updates.start_date !== undefined;
        const hasStartTime = updates.start_time !== undefined;
        const hasEndDate = updates.end_date !== undefined;
        const hasEndTime = updates.end_time !== undefined;

        const clockInOverride =
          updates.clock_in_ts !== undefined && updates.clock_in_ts !== ''
            ? updates.clock_in_ts
            : undefined;
        const clockOutOverride =
          updates.clock_out_ts !== undefined && updates.clock_out_ts !== ''
            ? updates.clock_out_ts
            : undefined;

        let finalClockIn = clockInOverride !== undefined ? clockInOverride : punch.clock_in_ts;
        let finalClockOut = clockOutOverride !== undefined ? clockOutOverride : punch.clock_out_ts;

        if (clockInOverride === undefined && (hasStartDate || hasStartTime)) {
          const fallbackDate = punch.clock_in_ts
            ? getIsoDateInTimezone(punch.clock_in_ts, orgTimezone)
            : null;
          const fallbackTime = punch.clock_in_ts
            ? getIsoTimeInTimezone(punch.clock_in_ts, orgTimezone)
            : null;
          const dateVal = hasStartDate ? String(updates.start_date || '').trim() : fallbackDate;
          const timeVal = hasStartTime ? String(updates.start_time || '').trim() : fallbackTime;
          if (!dateVal || !timeVal) {
            return res.status(400).json({
              ok: false,
              error: 'Clock-in date and time are required when modifying a punch.'
            });
          }
          const derived = toLocalIso(dateVal, timeVal);
          if (!derived) {
            return res.status(400).json({ ok: false, error: 'Invalid clock-in date or time.' });
          }
          finalClockIn = derived;
        }

        if (clockOutOverride === undefined && (hasEndDate || hasEndTime)) {
          const fallbackDate = punch.clock_out_ts
            ? getIsoDateInTimezone(punch.clock_out_ts, orgTimezone)
            : null;
          const fallbackTime = punch.clock_out_ts
            ? getIsoTimeInTimezone(punch.clock_out_ts, orgTimezone)
            : null;
          const dateVal = hasEndDate ? String(updates.end_date || '').trim() : fallbackDate;
          const timeVal = hasEndTime ? String(updates.end_time || '').trim() : fallbackTime;
          if (!dateVal || !timeVal) {
            return res.status(400).json({
              ok: false,
              error: 'Clock-out date and time are required when modifying a punch.'
            });
          }
          const derived = toLocalIso(dateVal, timeVal);
          if (!derived) {
            return res.status(400).json({ ok: false, error: 'Invalid clock-out date or time.' });
          }
          finalClockOut = derived;
        }

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
          if (
            (inDay && isFutureIsoDate(inDay, orgTimezone)) ||
            (outDay && isFutureIsoDate(outDay, orgTimezone))
          ) {
            return res.status(400).json({
              ok: false,
              error: 'Time entries cannot be set to a future date.'
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

        if (finalProjectId != null) {
          const projRow = await dbGet(
            'SELECT id FROM projects WHERE id = ? AND org_id = ?',
            [finalProjectId, orgId]
          );
          if (!projRow) {
            return res.status(400).json({
              ok: false,
              error: 'Project not found for this org.'
            });
          }
        }

        const finalClockInLocalDate = finalClockIn
          ? getIsoDateInTimezone(finalClockIn, orgTimezone)
          : null;
        const finalClockOutLocalDate = finalClockOut
          ? getIsoDateInTimezone(finalClockOut, orgTimezone)
          : null;

        sets.push('clock_in_ts = ?');
        params.push(finalClockIn || null);

        sets.push('clock_out_ts = ?');
        params.push(finalClockOut || null);

        sets.push('clock_in_local_date = ?');
        params.push(finalClockInLocalDate);

        sets.push('clock_out_local_date = ?');
        params.push(finalClockOutLocalDate);

        sets.push('project_id = ?');
        params.push(finalProjectId == null ? null : finalProjectId);

        sets.push('clock_out_project_id = ?');
        params.push(resolvedOutProjectId == null ? null : resolvedOutProjectId);
      }

      if (shouldResolve) {
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
      } else {
        sets.push('exception_resolved = 0');
        sets.push('exception_resolved_at = ?');
        params.push(null);

        sets.push('exception_resolved_by = ?');
        params.push(null);

        sets.push('exception_review_status = ?');
        params.push(statusVal);

        sets.push('exception_review_note = ?');
        params.push(note || null);

        sets.push('exception_reviewed_by = ?');
        params.push(null);

        sets.push('exception_reviewed_at = ?');
        params.push(null);
      }

      sets.push('updated_at = ?');
      params.push(nowIso);

      await dbRun(
        `
          UPDATE time_punches
          SET ${sets.join(', ')}
          WHERE id = ? AND org_id = ?
        `,
        [...params, exceptionId, orgId]
      );

      const updated = await dbGet(
        'SELECT * FROM time_punches WHERE id = ? AND org_id = ?',
        [exceptionId, orgId]
      );
      after = pickFields(updated, [
        'clock_in_ts',
        'clock_out_ts',
        'project_id',
        'clock_out_project_id'
      ]);

      const canSyncEntry = action !== 'reject';
      const hasCompletePunch =
        updated && updated.clock_in_ts && updated.clock_out_ts;
      if (canSyncEntry && hasCompletePunch) {
        const startTs = new Date(updated.clock_in_ts);
        const endTs = new Date(updated.clock_out_ts);
        if (!Number.isNaN(startTs.getTime()) && !Number.isNaN(endTs.getTime())) {
          const diffMs = endTs - startTs;
          let minutes = Math.ceil(diffMs / 60000);
          if (!Number.isFinite(minutes) || minutes < 0) minutes = 0;
          const hours = minutes / 60;
          const startDate =
            getIsoDateInTimezone(startTs, orgTimezone) ||
            startTs.toISOString().slice(0, 10);
          const endDate =
            getIsoDateInTimezone(endTs, orgTimezone) ||
            endTs.toISOString().slice(0, 10);
          const startTime =
            getIsoTimeInTimezone(startTs, orgTimezone) ||
            startTs.toISOString().slice(11, 16);
          const endTime =
            getIsoTimeInTimezone(endTs, orgTimezone) ||
            endTs.toISOString().slice(11, 16);

          const empRow = await dbGet(
            'SELECT rate, name FROM employees WHERE id = ? AND org_id = ?',
            [updated.employee_id, orgId]
          );
          if (!empRow) {
            return res.status(400).json({ ok: false, error: 'Employee not found.' });
          }

          const projRow = updated.project_id
            ? await dbGet('SELECT name FROM projects WHERE id = ? AND org_id = ?', [
                updated.project_id,
                orgId
              ])
            : null;

          const rate = Number(empRow.rate) || 0;
          const totalPay = rate * hours;
          const nowEntryIso = new Date().toISOString();

          let entryRow = null;
          if (updated.time_entry_id) {
            entryRow = await dbGet(
              'SELECT * FROM time_entries WHERE id = ? AND org_id = ?',
              [updated.time_entry_id, orgId]
            );
          }

          if (entryRow && action === 'modify') {
            await dbRun(
              `
                UPDATE time_entries
                SET project_id = ?,
                    start_date = ?,
                    end_date = ?,
                    start_time = ?,
                    end_time = ?,
                    hours = ?,
                    total_pay = ?,
                    foreman_employee_id = ?,
                    employee_name_snapshot = ?,
                    project_name_snapshot = ?,
                    approval_status = ?,
                    approved_at = ?,
                    approved_by_employee_id = ?,
                    approval_note = ?,
                    updated_at = ?
                WHERE id = ? AND org_id = ?
              `,
              [
                updated.project_id || null,
                startDate,
                endDate,
                startTime,
                endTime,
                hours,
                totalPay,
                updated.foreman_employee_id || null,
                empRow?.name || null,
                projRow?.name || null,
                'pending',
                null,
                null,
                null,
                nowEntryIso,
                entryRow.id,
                orgId
              ]
            );

            const afterEntry = await dbGet(
              'SELECT * FROM time_entries WHERE id = ? AND org_id = ?',
              [entryRow.id, orgId]
            );
            await logTimeEntryAudit({
              entryId: entryRow.id,
              action: 'modify',
              before: entryRow,
              after: afterEntry,
              note: note || null,
              req
            });
          } else if (!entryRow) {
            const entryRes = await dbRun(
              `
                INSERT INTO time_entries
                  (org_id, employee_id, project_id, start_date, end_date, start_time, end_time, hours, total_pay, foreman_employee_id, employee_name_snapshot, project_name_snapshot, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `,
              [
                orgId,
                updated.employee_id,
                updated.project_id || null,
                startDate,
                endDate,
                startTime,
                endTime,
                hours,
                totalPay,
                updated.foreman_employee_id || null,
                empRow?.name || null,
                projRow?.name || null,
                nowEntryIso
              ]
            );

            await dbRun(
              'UPDATE time_punches SET time_entry_id = ?, updated_at = ? WHERE id = ? AND org_id = ?',
              [entryRes.lastID, nowEntryIso, updated.id, orgId]
            );

            const createdEntry = await dbGet(
              'SELECT * FROM time_entries WHERE id = ? AND org_id = ?',
              [entryRes.lastID, orgId]
            );
            await logTimeEntryAudit({
              entryId: entryRes.lastID,
              action: 'create',
              before: null,
              after: createdEntry,
              note: note || null,
              req
            });
          }
        }
      }
    } else {
      const entry = await dbGet(
        'SELECT * FROM time_entries WHERE id = ? AND org_id = ?',
        [exceptionId, orgId]
      );
      if (!entry) {
        return res.status(404).json({ ok: false, error: 'Time entry not found.' });
      }

      if (if_match_updated_at && entry.updated_at && entry.updated_at !== if_match_updated_at) {
        return res.status(409).json({
          ok: false,
          error: 'Conflict: the time entry was updated since you last loaded it.',
          current: pickFields(entry, [
            'id',
            'employee_id',
            'project_id',
            'start_date',
            'end_date',
            'start_time',
            'end_time',
            'hours',
            'updated_at'
          ])
        });
      }

      if (action === 'modify' && entry.paid) {
        return res.status(409).json({
          ok: false,
          error:
            'This time entry has already been paid and cannot be modified. ' +
            'Create a new adjustment entry instead.'
        });
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
        if (isFutureIsoDate(finalStartDate, orgTimezone)) {
          return res.status(400).json({
            ok: false,
            error: 'Time entries cannot be set to a future date.'
          });
        }

        const hasStartOverride = updates.start_time !== undefined;
        const hasEndOverride = updates.end_time !== undefined;
        const hasHoursOverride = updates.hours !== undefined;
        const shouldValidateHours = hasStartOverride || hasEndOverride || hasHoursOverride;
        const finalStartTime = hasStartOverride ? updates.start_time : entry.start_time;
        const finalEndTime = hasEndOverride ? updates.end_time : entry.end_time;

        if (!finalStartTime || !finalEndTime) {
          return res.status(400).json({
            ok: false,
            error: 'Start and end times are required when modifying a time entry.'
          });
        }

        const startMinutes = parseHm(finalStartTime);
        const endMinutes = parseHm(finalEndTime);

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
        if (finalHours == null || Number.isNaN(finalHours)) {
          return res.status(400).json({ ok: false, error: 'Hours must be numeric.' });
        }
        if (finalHours != null && (finalHours < 0 || finalHours > 24)) {
          return res.status(400).json({
            ok: false,
            error: 'Hours must be between 0 and 24 when modifying a time entry.'
          });
        }
        if (shouldValidateHours && startMinutes != null && endMinutes != null) {
          const expectedHours = (endMinutes - startMinutes) / 60;
          if (Math.abs(expectedHours - finalHours) > 0.01) {
            return res.status(400).json({
              ok: false,
              error: 'Hours must match the provided start and end times.'
            });
          }
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
        const projRow = finalProjectId
          ? await dbGet('SELECT name FROM projects WHERE id = ? AND org_id = ?', [
              finalProjectId,
              orgId
            ])
          : null;
        if (finalProjectId != null && !projRow) {
          return res.status(400).json({ ok: false, error: 'Project not found.' });
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

        const empRow = await dbGet(
          'SELECT rate, name FROM employees WHERE id = ? AND org_id = ?',
          [entry.employee_id, orgId]
        );
        if (!empRow) {
          return res.status(400).json({ ok: false, error: 'Employee not found.' });
        }
        const rate = Number(empRow.rate) || 0;
        const totalPay = rate * (finalHours != null ? finalHours : 0);

        sets.push('total_pay = ?');
        params.push(totalPay);

        sets.push('employee_name_snapshot = ?');
        params.push(empRow?.name || entry.employee_name_snapshot || null);

        sets.push('project_name_snapshot = ?');
        params.push(projRow?.name || entry.project_name_snapshot || null);

        // Any edit resets approval to pending.
        sets.push('approval_status = ?');
        params.push('pending');
        sets.push('approved_at = ?');
        params.push(null);
        sets.push('approved_by_employee_id = ?');
        params.push(null);
        sets.push('approval_note = ?');
        params.push(null);
      }

      if (shouldResolve) {
        sets.push('resolved = 1');
        sets.push('resolved_at = ?');
        params.push(nowIso);

        sets.push('resolved_by = ?');
        params.push(actorName || 'admin');

        sets.push('resolved_status = ?');
        params.push(statusVal);

        sets.push('resolved_note = ?');
        params.push(note || null);
      } else {
        sets.push('resolved = 0');
        sets.push('resolved_at = ?');
        params.push(null);

        sets.push('resolved_by = ?');
        params.push(null);

        sets.push('resolved_status = ?');
        params.push(statusVal);

        sets.push('resolved_note = ?');
        params.push(note || null);
      }

      sets.push('updated_at = ?');
      params.push(nowIso);

      await dbRun(
        `
          UPDATE time_entries
          SET ${sets.join(', ')}
          WHERE id = ? AND org_id = ?
        `,
        [...params, exceptionId, orgId]
      );

      const updated = await dbGet(
        'SELECT * FROM time_entries WHERE id = ? AND org_id = ?',
        [exceptionId, orgId]
      );
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
          (org_id, source_type, source_id, action, actor_user_id, actor_employee_id, actor_name, note, changes_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        orgId,
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

    if (shouldResolve) {
      await notifyTimeEvent({
        orgId,
        eventType: 'TIME_EXCEPTION_REVIEWED',
        title: 'Time exception reviewed',
        body: `A ${source === 'punch' ? 'punch' : 'time entry'} exception was ${statusVal}.`,
        data: {
          exception_id: exceptionId,
          source,
          status: statusVal
        }
      });
    }

    const response = { ok: true, status: statusVal };
    if (clientId) {
      await storeIdempotentResponse(orgId, 'time_exception_review', clientId, response);
    }
    res.json(response);
  } catch (err) {
    console.error('Error reviewing time exception:', err);
    res.status(500).json({ ok: false, error: 'Failed to review exception.' });
  }
});

app.post('/api/time-exceptions/:id/resolve', requireModifyTimeAny, async (req, res) => {
  const punchId = Number(req.params.id);
  if (!punchId) {
    return res.status(400).json({ ok: false, error: 'Invalid punch ID.' });
  }

  try {
    const ctx = req.modifyTimeContext;
    const orgId = ctx && ctx.orgId ? ctx.orgId : (req.session && req.session.orgId);
    const adminId = ctx && ctx.adminId ? ctx.adminId : (req.session && req.session.employeeId);
    if (!orgId) {
      return res.status(401).json({ ok: false, error: 'Not authenticated.' });
    }
    const perms = ctx && ctx.perms
      ? ctx.perms
      : adminId
        ? await getAdminAccessPerms({ employeeId: adminId, orgId })
        : null;
    const isSuperAdmin = adminId
      ? await isEmployeeSuperAdmin({ employeeId: adminId, orgId })
      : false;
    const canSeePunch = await isTimePunchVisibleForAdmin({
      orgId,
      punchId,
      adminId,
      perms,
      isSuperAdmin
    });
    if (!canSeePunch) {
      return res.status(403).json({ ok: false, error: 'Not authorized.' });
    }

    const { note } = req.body || {};
    if (!note || !note.trim()) {
      return res.status(400).json({ ok: false, error: 'A note is required to resolve.' });
    }

    const { actorName } = await getExceptionActor(req, null);
    const punch = await dbGet(
      'SELECT id, exception_resolved FROM time_punches WHERE id = ? AND org_id = ?',
      [punchId, orgId]
    );

    if (!punch) {
      return res.status(404).json({ ok: false, error: 'Punch not found.' });
    }

    if (punch.exception_resolved) {
      return res.json({ ok: true, alreadyResolved: true });
    }

    const nowIso = new Date().toISOString();

    await dbRun(
      `
        UPDATE time_punches
        SET exception_resolved = 1,
            exception_resolved_at = ?,
            exception_resolved_by = ?,
            exception_review_status = 'approved',
            exception_review_note = ?,
            exception_reviewed_by = ?,
            exception_reviewed_at = ?,
            updated_at = ?
        WHERE id = ? AND org_id = ?
      `,
      [
        nowIso,
        actorName || 'admin',
        note || null,
        actorName || null,
        nowIso,
        nowIso,
        punchId,
        orgId
      ]
    );

    const afterPunch = await dbGet(
      'SELECT * FROM time_punches WHERE id = ? AND org_id = ?',
      [punchId, orgId]
    );

    await dbRun(
      `
        INSERT INTO time_exception_actions
          (org_id, source_type, source_id, action, actor_user_id, actor_employee_id, actor_name, note, changes_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        orgId,
        'punch',
        punchId,
        'resolve',
        (req.session && req.session.userId) || null,
        (req.session && req.session.employeeId) || null,
        actorName || null,
        note || null,
        JSON.stringify({
          before: pickFields(punch, ['id', 'exception_resolved', 'exception_review_status']),
          after: pickFields(afterPunch, ['id', 'exception_resolved', 'exception_review_status'])
        })
      ]
    );

    await notifyTimeEvent({
      orgId,
      eventType: 'TIME_EXCEPTION_RESOLVED',
      title: 'Time exception resolved',
      body: 'A punch exception was resolved.',
      data: {
        exception_id: punchId,
        source: 'punch'
      }
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Error resolving exception:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/time-punches/open', requireViewTimeReports, async (req, res) => {
  const orgId = req.session && req.session.orgId;
  const employeeId = req.session && req.session.employeeId;
  if (!orgId || !employeeId) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  let perms = req.adminPerms;
  if (!perms) {
    perms = await getAdminAccessPerms({ employeeId, orgId });
  }
  const isSuperAdmin = await isSessionSuperAdmin(req, orgId);
  const canViewAll = canViewAllTimesheets({ perms, isSuperAdmin });
  const shareExistsClause = buildTimesheetShareExistsClause('ks');
  const visibilityFilter = canViewAll
    ? ''
    : `
      AND ks.id IS NOT NULL
      AND (
        ${shareExistsClause}
        OR ks.assigned_to_employee_id = ?
        OR ks.created_by_employee_id = ?
        OR ks.created_by_employee_id IS NULL
      )
    `;

  const sql = `
    SELECT
      tp.id,
      tp.employee_id,
      COALESCE(e.name, tp.employee_name_snapshot) AS employee_name,
      tp.project_id,
      COALESCE(p.name, tp.project_name_snapshot) AS project_name,
      p.customer_name,
      tp.clock_in_ts
    FROM time_punches tp
    LEFT JOIN kiosk_sessions ks ON ks.id = tp.kiosk_session_id AND ks.org_id = tp.org_id
    LEFT JOIN employees e ON tp.employee_id = e.id AND e.org_id = tp.org_id
    LEFT JOIN projects p ON tp.project_id = p.id AND p.org_id = tp.org_id
    WHERE tp.org_id = ?
      AND tp.clock_out_ts IS NULL
      ${visibilityFilter}
    ORDER BY tp.clock_in_ts ASC
  `;

  const params = [orgId];
  if (!canViewAll) {
    params.push(employeeId);
    params.push(employeeId);
    params.push(employeeId);
  }

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/projects', requireViewPayrollOrSeeShipments, (req, res) => {
  const status = req.query.status || 'active'; // 'active' | 'inactive' | 'all'
  const orgId = req.session && req.session.orgId;

  let whereClause = 'WHERE org_id = ?';
  const params = [orgId];

  if (status === 'active') {
    whereClause += ' AND IFNULL(active, 1) = 1';
  } else if (status === 'inactive') {
    whereClause += ' AND IFNULL(active, 1) = 0';
  }

  const sql = `
    SELECT
      id,
      qbo_id,
      name,
      customer_name,
      project_timezone,
      geo_lat,
      geo_lng,
      geo_radius,
      active
    FROM projects
    ${whereClause}
    ORDER BY customer_name, name
  `;

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// Kiosk-friendly projects list (device_secret or admin session required)
app.get('/api/kiosk/projects', async (req, res) => {
  const access = await ensureKioskDevice(req);
  if (!access.ok) {
    return res
      .status(access.status || 401)
      .json({ error: access.error || 'Not authenticated' });
  }

  const orgId =
    access.via === 'session'
      ? req.session && req.session.orgId
      : access.kiosk && access.kiosk.org_id;

  const status = req.query.status || 'active'; // 'active' | 'inactive' | 'all'

  let whereClause = 'WHERE org_id = ?';
  const params = [orgId];

  if (status === 'active') {
    whereClause += ' AND IFNULL(active, 1) = 1';
  } else if (status === 'inactive') {
    whereClause += ' AND IFNULL(active, 1) = 0';
  }

  const sql = `
    SELECT
      id,
      name,
      customer_name,
      project_timezone,
      active
    FROM projects
    ${whereClause}
    ORDER BY customer_name, name
  `;

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.get('/api/time-entries', requireViewTimeReports, async (req, res) => {
  let { start, end, employee_id, project_id } = req.query;
  const limitRaw = req.query ? req.query.limit : null;
  const offsetRaw = req.query ? req.query.offset : null;
  const limit = Math.min(
    200,
    Math.max(1, Number(limitRaw || 50))
  );
  const offset = Math.max(0, Number(offsetRaw || 0));
  const allDates =
    req.query &&
    (req.query.all_dates === '1' ||
      req.query.all_dates === 'true' ||
      req.query.all_dates === 'yes');
  const hidePaid =
    req.query &&
    (req.query.hide_paid === '1' ||
      req.query.hide_paid === 'true' ||
      req.query.hide_paid === 'yes');
  const hideApproved =
    req.query &&
    (req.query.hide_payroll_approved === '1' ||
      req.query.hide_payroll_approved === 'true' ||
      req.query.hide_payroll_approved === 'yes');
  const orgId = req.session && req.session.orgId;

  if (!orgId) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  const orgTimezone = await getOrgTimezone(orgId);

  let canViewPayroll = false;
  let perms = req.adminPerms;
  const employeeId = req.session && req.session.employeeId;
  try {
    if (!perms && employeeId) {
      perms = await getAdminAccessPerms({ employeeId, orgId });
    }
    canViewPayroll = !!(perms && perms.view_payroll);
  } catch (err) {
    console.warn('Unable to load payroll permissions for time entries:', err.message);
  }
  const isSuperAdmin = employeeId
    ? await isEmployeeSuperAdmin({ employeeId, orgId })
    : false;

  // If nothing specified, default to "today" (unless all_dates is requested)
  if (!allDates && !start && !end && !employee_id && !project_id) {
    const today = getTodayIsoDate(orgTimezone);
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
      t.approval_status,
      t.approved_at,
      t.approved_by_employee_id,
      t.approval_note,
      t.resolved_status,
      t.resolved_note,
      t.verified,
      t.verified_at,
      t.verified_by_employee_id,
      t.resolved,
      t.resolved_at,
      t.resolved_by,
      t.updated_at,
      COALESCE(e.name, t.employee_name_snapshot) AS employee_name,
      COALESCE(p.name, t.project_name_snapshot) AS project_name,
      ap.name AS approved_by_name,

      -- Exception / flag info aggregated from punches
      COALESCE(MAX(CASE
        WHEN tp.geo_violation != 0 OR ks.geo_violation != 0 THEN 1
        ELSE 0
      END), 0) AS has_geo_violation,
      COALESCE(MAX(tp.auto_clock_out), 0)     AS has_auto_clock_out,
      COALESCE(MAX(tp.exception_resolved), 0) AS punch_exception_resolved,
      COALESCE(SUM(CASE
        WHEN (
          (tp.geo_violation != 0 OR ks.geo_violation != 0 OR tp.auto_clock_out != 0)
          AND IFNULL(tp.exception_resolved, 0) = 0
        )
        THEN 1
        ELSE 0
      END), 0) AS punch_exception_unresolved,
      GROUP_CONCAT(DISTINCT CASE
        WHEN (
          (tp.geo_violation != 0 OR ks.geo_violation != 0 OR tp.auto_clock_out != 0)
          AND IFNULL(tp.exception_resolved, 0) = 0
        )
        THEN tp.id
        ELSE NULL
      END) AS punch_exception_ids,
      COUNT(tp.id) AS punch_count,
      SUM(
        CASE
          WHEN tp.clock_in_ts IS NOT NULL AND tp.clock_out_ts IS NOT NULL
          THEN (julianday(tp.clock_out_ts) - julianday(tp.clock_in_ts)) * 24.0
          ELSE 0
        END
      ) AS punch_hours
    FROM time_entries t
    LEFT JOIN employees e ON t.employee_id = e.id AND e.org_id = t.org_id
    LEFT JOIN projects  p ON t.project_id = p.id AND p.org_id = t.org_id
    LEFT JOIN time_punches tp ON tp.time_entry_id = t.id AND tp.org_id = t.org_id
    LEFT JOIN kiosk_sessions ks ON ks.id = tp.kiosk_session_id AND ks.org_id = tp.org_id
    LEFT JOIN employees ap ON ap.id = t.approved_by_employee_id AND ap.org_id = t.org_id
  `;

  const where = ['t.org_id = ?'];
  const params = [orgId];

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
    if (hidePaid) {
      where.push('(t.paid IS NULL OR t.paid = 0)');
    }
    if (hideApproved) {
      where.push("LOWER(COALESCE(t.approval_status, 'pending')) != 'approved'");
    }
    const visibility = buildTimeEntryVisibilityFilter({
      adminId: employeeId,
      perms,
      isSuperAdmin,
      entryAlias: 't'
  });
  if (visibility.clause) {
    where.push(visibility.clause.trim());
    params.push(...visibility.params);
  }

  if (where.length) {
    sql += ' WHERE ' + where.join(' AND ');
  }

  const countSql = `
    SELECT COUNT(DISTINCT t.id) AS total
    FROM time_entries t
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
  `;

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
      t.approval_status,
      t.approved_at,
      t.approved_by_employee_id,
      t.approval_note,
      t.resolved_status,
      t.resolved_note,
      t.verified,
      t.verified_at,
      t.verified_by_employee_id,
      t.resolved,
      t.resolved_at,
      t.resolved_by,
      t.updated_at,
      e.name,
      p.name,
      ap.name,
      t.employee_name_snapshot,
      t.project_name_snapshot
    ORDER BY t.start_date DESC, t.id DESC
    LIMIT ? OFFSET ?
  `;

  try {
    const rows = await dbAll(sql, [...params, limit, offset]);
    const countRow = await dbGet(countSql, params);
    const total = countRow && Number.isFinite(Number(countRow.total))
      ? Number(countRow.total)
      : 0;

    const outRows = canViewPayroll
      ? (rows || [])
      : (rows || []).map(row => {
      const { total_pay, paid, paid_date, ...rest } = row;
      return rest;
    });

    const wantsPagination = limitRaw != null || offsetRaw != null;
    if (wantsPagination) {
      return res.json({
        rows: outRows,
        total,
        page: Math.floor(offset / limit) + 1,
        page_size: limit
      });
    }
    return res.json(outRows);
  } catch (err) {
    console.error('Error fetching time entries:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/time-entries/:id/changes', requireViewTimeReports, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ error: 'Invalid time entry id.' });
  }
  const orgId = req.session && req.session.orgId;
  const adminId = req.session && req.session.employeeId;
  if (!orgId || !adminId) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  let perms = req.adminPerms;
  if (!perms) {
    perms = await getAdminAccessPerms({ employeeId: adminId, orgId });
  }
  const isSuperAdmin = await isEmployeeSuperAdmin({ employeeId: adminId, orgId });
  const canSeeEntry = await isTimeEntryVisibleForAdmin({
    orgId,
    entryId: id,
    adminId,
    perms,
    isSuperAdmin
  });
  if (!canSeeEntry) {
    return res.status(403).json({ error: 'Not authorized.' });
  }

  try {
    const audit = await dbGet(
      `
        SELECT
          actor_name,
          note,
          changes_json,
          created_at
        FROM time_exception_actions
        WHERE org_id = ?
          AND source_type = 'time_entry'
          AND source_id = ?
          AND action = 'modify'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [orgId, id]
    );

    if (!audit) {
      return res.json({ ok: true, changes: null });
    }

    let changes = {};
    try {
      changes = audit.changes_json ? JSON.parse(audit.changes_json) : {};
    } catch {
      changes = {};
    }

    const before = changes.before || {};
    const after = changes.after || {};

    const fields = [];
    const addField = (label, beforeVal, afterVal) => {
      if (beforeVal == null && afterVal == null) return;
      const beforeStr = beforeVal == null ? '' : String(beforeVal);
      const afterStr = afterVal == null ? '' : String(afterVal);
      if (beforeStr === afterStr) return;
      fields.push({ label, before: beforeStr, after: afterStr });
    };

    const beforeProject =
      before.project_name_snapshot || before.project_name || before.project_id || '';
    const afterProject =
      after.project_name_snapshot || after.project_name || after.project_id || '';
    addField('Project', beforeProject, afterProject);
    addField('Date', before.start_date || '', after.start_date || '');
    addField('Clock in', before.start_time || '', after.start_time || '');
    addField('Clock out', before.end_time || '', after.end_time || '');
    addField('Hours', before.hours != null ? Number(before.hours).toFixed(2) : '', after.hours != null ? Number(after.hours).toFixed(2) : '');

    return res.json({
      ok: true,
      changes: {
        actor_name: audit.actor_name || null,
        created_at: audit.created_at || null,
        note: audit.note || null,
        fields
      }
    });
  } catch (err) {
    console.error('Error loading time entry changes:', err.message || err);
    return res.status(500).json({ error: 'Failed to load time entry changes.' });
  }
});

app.get('/api/time-entries/:id/punches', requireViewTimeReports, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ error: 'Invalid time entry id.' });
  }
  const orgId = req.session && req.session.orgId;
  const adminId = req.session && req.session.employeeId;
  if (!orgId || !adminId) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  let perms = req.adminPerms;
  if (!perms) {
    perms = await getAdminAccessPerms({ employeeId: adminId, orgId });
  }
  const isSuperAdmin = await isEmployeeSuperAdmin({ employeeId: adminId, orgId });
  const canSeeEntry = await isTimeEntryVisibleForAdmin({
    orgId,
    entryId: id,
    adminId,
    perms,
    isSuperAdmin
  });
  if (!canSeeEntry) {
    return res.status(403).json({ error: 'Not authorized.' });
  }

  try {
    const rows = await dbAll(
      `
        SELECT
          tp.id,
          tp.clock_in_ts,
          tp.clock_out_ts,
          tp.clock_in_local_date,
          tp.clock_out_local_date,
          tp.device_id,
          tp.clock_out_device_id,
          tp.kiosk_session_id,
          k.name AS kiosk_name,
          k.location AS kiosk_location
        FROM time_punches tp
        LEFT JOIN kiosk_sessions ks
          ON ks.id = tp.kiosk_session_id
         AND ks.org_id = tp.org_id
        LEFT JOIN kiosks k
          ON k.id = ks.kiosk_id
         AND k.org_id = tp.org_id
        WHERE tp.org_id = ?
          AND tp.time_entry_id = ?
        ORDER BY tp.clock_in_ts ASC
      `,
      [orgId, id]
    );
    return res.json(rows || []);
  } catch (err) {
    console.error('Error loading time entry punches:', err.message || err);
    return res.status(500).json({ error: 'Failed to load time entry punches.' });
  }
});

app.get('/api/time-entries/pending-count', requireViewTimeReports, async (req, res) => {
  try {
    const orgId = req.session && req.session.orgId;
    const adminId = req.session && req.session.employeeId;
    if (!orgId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    let perms = req.adminPerms;
    if (!perms && adminId) {
      perms = await getAdminAccessPerms({ employeeId: adminId, orgId });
    }
    const isSuperAdmin = adminId
      ? await isEmployeeSuperAdmin({ employeeId: adminId, orgId })
      : false;
    const pending = await loadPendingTimeEntryReviewCount({
      orgId,
      adminId,
      perms,
      isSuperAdmin
    });
    return res.json({ pending });
  } catch (err) {
    console.error('Error fetching pending time entry count:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to load pending count.' });
  }
});

app.get('/api/time-entries/pending', requireViewTimeReports, async (req, res) => {
  try {
    const orgId = req.session && req.session.orgId;
    const adminId = req.session && req.session.employeeId;
    if (!orgId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    const { employee_id, project_id, limit } = req.query || {};
    let perms = req.adminPerms;
    if (!perms && adminId) {
      perms = await getAdminAccessPerms({ employeeId: adminId, orgId });
    }
    const isSuperAdmin = adminId
      ? await isEmployeeSuperAdmin({ employeeId: adminId, orgId })
      : false;
    const rows = await loadPendingTimeEntryReviewEntries({
      orgId,
      employeeId: employee_id || null,
      projectId: project_id || null,
      limit: limit || 200,
      adminId,
      perms,
      isSuperAdmin
    });

    let canViewPayroll = false;
    try {
      canViewPayroll = !!(perms && perms.view_payroll);
    } catch (err) {
      console.warn('Unable to load payroll permissions for pending time entries:', err.message);
    }

    if (canViewPayroll) {
      return res.json(rows || []);
    }
    const sanitized = (rows || []).map(row => {
      const { total_pay, paid, paid_date, ...rest } = row;
      return rest;
    });
    return res.json(sanitized);
  } catch (err) {
    console.error('Error fetching pending time entries:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to load pending entries.' });
  }
});

// Kiosk-friendly time entries (device_secret auth instead of user session)
app.get('/api/kiosk/time-entries', async (req, res) => {
  try {
    const adminCtx = await resolveKioskAdmin(req);
    if (!adminCtx.ok) {
      return res
        .status(adminCtx.status || 401)
        .json({ error: adminCtx.error || 'Not authenticated' });
    }

    const orgId = adminCtx.orgId;
    const perms = await getAdminAccessPerms({
      employeeId: adminCtx.adminId,
      orgId
    });
    const isSuperAdmin = await isEmployeeSuperAdmin({
      employeeId: adminCtx.adminId,
      orgId
    });
    const canViewPayroll = !!(perms && perms.view_payroll);
    const canViewTime = !!(perms && (perms.view_time_reports || perms.view_payroll));
    if (!canViewTime) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const orgTimezone = await getOrgTimezone(orgId);

    let { start, end, employee_id, project_id } = req.query;

    if (!start && !end && !employee_id && !project_id) {
      const today = getTodayIsoDate(orgTimezone);
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
      t.approval_status,
      t.approved_at,
      t.approved_by_employee_id,
      t.approval_note,
      t.resolved_status,
      t.resolved_note,
      t.verified,
        t.verified_at,
        t.verified_by_employee_id,
        t.resolved,
        t.resolved_at,
        t.resolved_by,
        t.updated_at,
        COALESCE(e.name, t.employee_name_snapshot) AS employee_name,
        COALESCE(p.name, t.project_name_snapshot) AS project_name,
        ap.name AS approved_by_name,

        -- Exception / flag info aggregated from punches
        COALESCE(MAX(CASE
          WHEN tp.geo_violation != 0 OR ks.geo_violation != 0 THEN 1
          ELSE 0
        END), 0) AS has_geo_violation,
        COALESCE(MAX(tp.auto_clock_out), 0)     AS has_auto_clock_out,
        COALESCE(MAX(tp.auto_clock_out_reason), '') AS auto_clock_out_reason,
        COALESCE(MAX(tp.exception_resolved), 0) AS punch_exception_resolved,
        COALESCE(SUM(CASE
          WHEN (
            (tp.geo_violation != 0 OR ks.geo_violation != 0 OR tp.auto_clock_out != 0)
            AND IFNULL(tp.exception_resolved, 0) = 0
          )
          THEN 1
          ELSE 0
        END), 0) AS punch_exception_unresolved,
        GROUP_CONCAT(DISTINCT CASE
          WHEN (
            (tp.geo_violation != 0 OR ks.geo_violation != 0 OR tp.auto_clock_out != 0)
            AND IFNULL(tp.exception_resolved, 0) = 0
          )
          THEN tp.id
          ELSE NULL
        END) AS punch_exception_ids,
        COUNT(tp.id) AS punch_count,
        SUM(
          CASE
            WHEN tp.clock_in_ts IS NOT NULL AND tp.clock_out_ts IS NOT NULL
            THEN (julianday(tp.clock_out_ts) - julianday(tp.clock_in_ts)) * 24.0
            ELSE 0
          END
        ) AS punch_hours
      FROM time_entries t
      LEFT JOIN employees e ON t.employee_id = e.id AND e.org_id = t.org_id
      LEFT JOIN projects  p ON t.project_id = p.id AND p.org_id = t.org_id
      LEFT JOIN time_punches tp ON tp.time_entry_id = t.id AND tp.org_id = t.org_id
      LEFT JOIN kiosk_sessions ks ON ks.id = tp.kiosk_session_id AND ks.org_id = tp.org_id
      LEFT JOIN employees ap ON ap.id = t.approved_by_employee_id AND ap.org_id = t.org_id
    `;

    const where = ['t.org_id = ?'];
    const params = [orgId];

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
    const visibility = buildTimeEntryVisibilityFilter({
      adminId: adminCtx.adminId,
      perms,
      isSuperAdmin,
      entryAlias: 't'
    });
    if (visibility.clause) {
      where.push(visibility.clause.trim());
      params.push(...visibility.params);
    }

    sql += ' WHERE ' + where.join(' AND ');

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
      t.approval_status,
      t.approved_at,
      t.approved_by_employee_id,
      t.approval_note,
      t.resolved_status,
      t.resolved_note,
      t.verified,
        t.verified_at,
        t.verified_by_employee_id,
        t.resolved,
        t.resolved_at,
        t.resolved_by,
        t.updated_at,
        e.name,
        p.name,
        ap.name,
        t.employee_name_snapshot,
        t.project_name_snapshot
      ORDER BY t.start_date DESC, t.id DESC
      LIMIT 200
    `;

    db.all(sql, params, (err, rows) => {
      if (err) {
        console.error('Error fetching kiosk time entries:', err.message);
        return res.status(500).json({ error: err.message });
      }
      if (canViewPayroll) {
        return res.json(rows || []);
      }
      const sanitized = (rows || []).map(row => {
        const { total_pay, paid, paid_date, ...rest } = row;
        return rest;
      });
      return res.json(sanitized);
    });
  } catch (err) {
    console.error('Error fetching kiosk time entries:', err);
    res.status(500).json({ error: 'Error fetching time entries.' });
  }
});

app.get('/api/kiosk/time-entries/pending-count', async (req, res) => {
  try {
    const adminCtx = await resolveKioskAdmin(req);
    if (!adminCtx.ok) {
      return res
        .status(adminCtx.status || 401)
        .json({ error: adminCtx.error || 'Not authenticated' });
    }

    const orgId = adminCtx.orgId;
    const perms = await getAdminAccessPerms({
      employeeId: adminCtx.adminId,
      orgId
    });
    const isSuperAdmin = await isEmployeeSuperAdmin({
      employeeId: adminCtx.adminId,
      orgId
    });
    const canViewTime = !!(perms && (perms.view_time_reports || perms.view_payroll));
    if (!canViewTime) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const pending = await loadPendingTimeEntryReviewCount({
      orgId,
      adminId: adminCtx.adminId,
      perms,
      isSuperAdmin
    });
    return res.json({ pending });
  } catch (err) {
    console.error('Error fetching kiosk pending time entry count:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to load pending count.' });
  }
});

app.get('/api/kiosk/time-entries/pending', async (req, res) => {
  try {
    const adminCtx = await resolveKioskAdmin(req);
    if (!adminCtx.ok) {
      return res
        .status(adminCtx.status || 401)
        .json({ error: adminCtx.error || 'Not authenticated' });
    }

    const orgId = adminCtx.orgId;
    const perms = await getAdminAccessPerms({
      employeeId: adminCtx.adminId,
      orgId
    });
    const isSuperAdmin = await isEmployeeSuperAdmin({
      employeeId: adminCtx.adminId,
      orgId
    });
    const canViewPayroll = !!(perms && perms.view_payroll);
    const canViewTime = !!(perms && (perms.view_time_reports || perms.view_payroll));
    if (!canViewTime) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { employee_id, project_id, limit } = req.query || {};
    const rows = await loadPendingTimeEntryReviewEntries({
      orgId,
      employeeId: employee_id || null,
      projectId: project_id || null,
      limit: limit || 200,
      adminId: adminCtx.adminId,
      perms,
      isSuperAdmin
    });

    if (canViewPayroll) {
      return res.json(rows || []);
    }
    const sanitized = (rows || []).map(row => {
      const { total_pay, paid, paid_date, ...rest } = row;
      return rest;
    });
    return res.json(sanitized);
  } catch (err) {
    console.error('Error fetching kiosk pending time entries:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to load pending entries.' });
  }
});


// Only admins can create manual time entries
app.post('/api/time-entries', requireModifyTimeAny, async (req, res) => {
  const {
    employee_id,
    project_id,
    start_date,
    end_date,
    start_time,
    end_time,
    hours,
    note,
    client_id
  } = req.body || {};
  const ctx = req.modifyTimeContext;
  const orgId = ctx && ctx.orgId ? ctx.orgId : (req.session && req.session.orgId);

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

  if (!note || !note.trim()) {
    return res.status(400).json({ error: 'A note is required for manual time entries.' });
  }

  if (!orgId) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  if (startDate !== endDate) {
    return res.status(400).json({ error: 'Manual time entries must be single-day.' });
  }

  const parsedHours = parseFloat(hours);
  if (isNaN(parsedHours)) {
    return res.status(400).json({ error: 'Hours must be a number.' });
  }
  if (parsedHours < 0 || parsedHours > 24) {
    return res.status(400).json({ error: 'Hours must be between 0 and 24.' });
  }

  const parseHm = value => {
    const match = /^([0-1]?\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''));
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  };
  const startMinutes = parseHm(startTime);
  const endMinutes = parseHm(endTime);
  if (startMinutes == null || endMinutes == null) {
    return res.status(400).json({
      error: 'start_time and end_time must be in HH:MM (24-hour) format.'
    });
  }
  if (endMinutes < startMinutes) {
    return res.status(400).json({ error: 'end_time cannot be before start_time.' });
  }
  const expectedHours = (endMinutes - startMinutes) / 60;
  if (Math.abs(expectedHours - parsedHours) > 0.01) {
    return res.status(400).json({
      error: 'Hours must match the provided start and end times.'
    });
  }

  try {
    const clientId = client_id ? String(client_id).trim() : '';
    if (clientId) {
      const cached = await loadIdempotentResponse(orgId, 'time_entry_create', clientId);
      if (cached) {
        return res.json({ ...cached, alreadyProcessed: true });
      }
    }

    const orgTimezone = await getOrgTimezone(orgId);
    if (isFutureIsoDate(startDate, orgTimezone)) {
      return res.status(400).json({ error: 'Cannot create timesheets for future dates.' });
    }

    const isSuperAdmin = await resolveModifyTimeSuperAdmin(req, ctx);
    const punchStats = await getPunchHoursForEmployeeDate({
      orgId,
      employeeId: employee_id,
      dateStr: startDate
    });
    if (!isSuperAdmin && punchStats.count === 0) {
      return res.status(403).json({
        error: 'Super admin required to create a manual entry when no punches exist for that date.'
      });
    }
    if (!isSuperAdmin && punchStats.count > 0) {
      const diff = punchStats.hours - parsedHours;
      if (Math.abs(diff) >= MANUAL_ENTRY_GUARDRAIL_MISMATCH_HOURS) {
        return res.status(400).json({
          error:
            `Manual hours differ from punches by ${diff.toFixed(2)}h. ` +
            'Super admin approval is required for large mismatches.'
        });
      }
    }

    const empRow = await dbGet(
      'SELECT rate, name FROM employees WHERE id = ? AND org_id = ?',
      [employee_id, orgId]
    );
    if (!empRow) {
      return res.status(400).json({ error: 'Invalid employee_id.' });
    }
    const projRow = await dbGet(
      'SELECT name FROM projects WHERE id = ? AND org_id = ?',
      [project_id, orgId]
    );
    if (!projRow) {
      return res.status(400).json({ error: 'Invalid project_id.' });
    }

    const rate = parseFloat(empRow.rate || 0);
    const total_pay = rate * parsedHours;
    const nowIso = new Date().toISOString();

    const insert = await dbRun(
      `
        INSERT INTO time_entries
          (org_id, employee_id, project_id, start_date, end_date, start_time, end_time, hours, total_pay, employee_name_snapshot, project_name_snapshot, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        orgId,
        employee_id,
        project_id,
        startDate,
        endDate,
        startTime,
        endTime,
        parsedHours,
        total_pay,
        empRow?.name || null,
        projRow?.name || null,
        nowIso
      ]
    );

    const response = { ok: true, id: insert.lastID, total_pay };
    if (clientId) {
      await storeIdempotentResponse(orgId, 'time_entry_create', clientId, response);
    }

    await logTimeEntryAudit({
      entryId: insert.lastID,
      action: 'create',
      before: null,
      after: {
        employee_id,
        project_id,
        start_date: startDate,
        end_date: endDate,
        start_time: startTime,
        end_time: endTime,
        hours: parsedHours,
        total_pay
      },
      note: note || null,
      req
    });

    await notifyTimeEvent({
      orgId,
      eventType: 'TIME_ENTRY_MANUAL_CREATED',
      title: 'Manual time entry added',
      body: `Manual time entry added for ${empRow?.name || 'employee'} on ${startDate}.`,
      data: {
        time_entry_id: insert.lastID,
        employee_id,
        project_id,
        start_date: startDate
      }
    });

    const weeklyWindow = getWeekWindowForDate(startDate, orgTimezone);
    if (weeklyWindow) {
      const rulesMap = await loadExceptionRulesMap(orgId);
      const rawWeeklyThreshold =
        rulesMap && rulesMap.weekly_hours_threshold != null
          ? Number(rulesMap.weekly_hours_threshold)
          : null;
      const weeklyThreshold =
        Number.isFinite(rawWeeklyThreshold) && rawWeeklyThreshold > 0
          ? rawWeeklyThreshold
          : null;
      if (weeklyThreshold) {
        const weeklyTotal = await sumWeeklyHoursForEmployee({
          orgId,
          employeeId: employee_id,
          weekStart: weeklyWindow.weekStart,
          weekEnd: weeklyWindow.weekEnd
        });
        const ratio = weeklyTotal / weeklyThreshold;
        if (ratio >= 1) {
          await notifyTimeEventOnce({
            orgId,
            eventType: 'TIME_WEEKLY_THRESHOLD_EXCEEDED',
            title: 'Weekly hours exceeded',
            body: `${empRow?.name || 'Employee'} reached ${weeklyTotal.toFixed(2)}h this week (threshold ${weeklyThreshold}h).`,
            data: {
              employee_id,
              week_start: weeklyWindow.weekStart,
              week_end: weeklyWindow.weekEnd,
              weekly_hours: weeklyTotal,
              threshold_hours: weeklyThreshold
            },
            match: {
              employee_id,
              week_start: weeklyWindow.weekStart
            }
          });
        } else if (ratio >= WEEKLY_THRESHOLD_WARNING_RATIO) {
          await notifyTimeEventOnce({
            orgId,
            eventType: 'TIME_WEEKLY_THRESHOLD_NEAR',
            title: 'Weekly hours approaching limit',
            body: `${empRow?.name || 'Employee'} is at ${weeklyTotal.toFixed(2)}h this week (threshold ${weeklyThreshold}h).`,
            data: {
              employee_id,
              week_start: weeklyWindow.weekStart,
              week_end: weeklyWindow.weekEnd,
              weekly_hours: weeklyTotal,
              threshold_hours: weeklyThreshold
            },
            match: {
              employee_id,
              week_start: weeklyWindow.weekStart
            }
          });
        }
      }
    }

    res.json(response);
  } catch (err) {
    console.error('Error inserting time entry:', err);
    return res.status(500).json({ error: err.message || 'Failed to insert time entry.' });
  }
});

// Only admins can edit time entries
app.post('/api/time-entries/:id(\\d+)', requireModifyTimeAny, async (req, res) => {
  const id = Number(req.params.id);
  const {
    employee_id,
    project_id,
    start_date,
    end_date,
    start_time,
    end_time,
    hours,
    note,
    client_id,
    if_match_updated_at
  } = req.body || {};
  const ctx = req.modifyTimeContext;
  const orgId = ctx && ctx.orgId ? ctx.orgId : (req.session && req.session.orgId);

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
    !startTime ||
    !endTime ||
    Number.isNaN(hoursNum)
  ) {
    return res.status(400).json({
      error:
        'employee_id, project_id, start_date, end_date, start_time, end_time, and numeric hours are required.'
    });
  }
  if (!orgId) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  if (hoursNum < 0 || hoursNum > 24) {
    return res.status(400).json({ error: 'Hours must be between 0 and 24.' });
  }

  const parseHm = value => {
    const match = /^([0-1]?\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''));
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  };
  const startMinutes = parseHm(startTime);
  const endMinutes = parseHm(endTime);
  if (startMinutes == null || endMinutes == null) {
    return res.status(400).json({
      error: 'start_time and end_time must be in HH:MM (24-hour) format.'
    });
  }
  if (endMinutes < startMinutes) {
    return res.status(400).json({ error: 'end_time cannot be before start_time.' });
  }

  try {
    const clientId = client_id ? String(client_id).trim() : '';
    if (clientId) {
      const cached = await loadIdempotentResponse(orgId, 'time_entry_edit', clientId);
      if (cached) {
        return res.json({ ...cached, alreadyProcessed: true });
      }
    }

    const orgTimezone = await getOrgTimezone(orgId);
    if (isFutureIsoDate(startDate, orgTimezone)) {
      return res.status(400).json({ error: 'Time entries cannot be set to a future date.' });
    }

    const existingRow = await dbGet(
      'SELECT * FROM time_entries WHERE id = ? AND org_id = ?',
      [id, orgId]
    );
    if (!existingRow) {
      return res.status(404).json({ error: 'Time entry not found.' });
    }
    const adminId = ctx && ctx.adminId ? ctx.adminId : (req.session && req.session.employeeId);
    const perms = ctx && ctx.perms
      ? ctx.perms
      : adminId
        ? await getAdminAccessPerms({ employeeId: adminId, orgId })
        : null;
    const isSuperAdmin = adminId
      ? await isEmployeeSuperAdmin({ employeeId: adminId, orgId })
      : false;
    const canSeeEntry = await isTimeEntryVisibleForAdmin({
      orgId,
      entryId: id,
      adminId,
      perms,
      isSuperAdmin
    });
    if (!canSeeEntry) {
      return res.status(403).json({ error: 'Not authorized.' });
    }

    const startTimeChanged = String(startTime || '') !== String(existingRow.start_time || '');
    const endTimeChanged = String(endTime || '') !== String(existingRow.end_time || '');
    const existingHours =
      existingRow.hours != null && !Number.isNaN(Number(existingRow.hours))
        ? Number(existingRow.hours)
        : null;
    const hoursChanged =
      existingHours == null ? Number.isFinite(hoursNum) : Math.abs(existingHours - hoursNum) > 0.01;
    const shouldValidateHours = startTimeChanged || endTimeChanged || hoursChanged;
    if (shouldValidateHours) {
      const expectedHours = (endMinutes - startMinutes) / 60;
      if (Math.abs(expectedHours - hoursNum) > 0.01) {
        return res.status(400).json({
          error: 'Hours must match the provided start and end times.'
        });
      }
    }

    if (!note || !note.trim()) {
      return res.status(400).json({ error: 'A note is required for edits.' });
    }

    if (startDate !== endDate) {
      return res.status(400).json({ error: 'Time entry edits must be single-day.' });
    }

    if (existingRow.paid) {
      return res.status(409).json({
        error:
          'This time entry has already been paid as part of a payroll run and cannot be edited. ' +
          'To correct it, create a new manual time entry that adjusts the hours or pay.'
      });
    }

    if (if_match_updated_at && existingRow.updated_at && existingRow.updated_at !== if_match_updated_at) {
      return res.status(409).json({
        error: 'Conflict: this time entry was updated by someone else.',
        current: pickFields(existingRow, [
          'id',
          'employee_id',
          'project_id',
          'start_date',
          'end_date',
          'start_time',
          'end_time',
          'hours',
          'updated_at'
        ])
      });
    }

    const isModifySuperAdmin = await resolveModifyTimeSuperAdmin(req, ctx);
    let punchStats = await getPunchHoursForEntry({ orgId, entryId: id });
    if (punchStats.count === 0) {
      punchStats = await getPunchHoursForEmployeeDate({
        orgId,
        employeeId: empIdNum,
        dateStr: startDate
      });
    }
    if (!isModifySuperAdmin && punchStats.count === 0) {
      return res.status(403).json({
        error: 'Super admin required to edit an entry when no punches exist for that date.'
      });
    }
    if (!isModifySuperAdmin && punchStats.count > 0) {
      const diff = punchStats.hours - hoursNum;
      if (Math.abs(diff) >= MANUAL_ENTRY_GUARDRAIL_MISMATCH_HOURS) {
        return res.status(400).json({
          error:
            `Manual hours differ from punches by ${diff.toFixed(2)}h. ` +
            'Super admin approval is required for large mismatches.'
        });
      }
    }

    const empRow = await dbGet(
      'SELECT rate, name FROM employees WHERE id = ? AND org_id = ?',
      [empIdNum, orgId]
    );
    if (!empRow) {
      return res.status(400).json({ error: 'Employee not found.' });
    }
    const projRow = await dbGet(
      'SELECT name FROM projects WHERE id = ? AND org_id = ?',
      [projIdNum, orgId]
    );
    if (!projRow) {
      return res.status(400).json({ error: 'Project not found.' });
    }

    const rate = Number(empRow.rate) || 0;
    const totalPay = rate * hoursNum;
    const noteVal = typeof note === 'string' ? note.trim() : '';
    const nowIso = new Date().toISOString();

    const beforeRow = existingRow;
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
        employee_name_snapshot = ?,
        project_name_snapshot  = ?,
        approval_status = ?,
        approved_at = ?,
        approved_by_employee_id = ?,
        approval_note = ?,
        resolved = ?,
        resolved_at = ?,
        resolved_by = ?,
        resolved_status = ?,
        resolved_note = ?,
        updated_at = ?
      WHERE id = ? AND org_id = ?
    `;

    const params = [
      empIdNum,
      projIdNum,
      startDate,
      endDate,
      startTime,
      endTime,
      hoursNum,
      totalPay,
      empRow?.name || null,
      projRow?.name || null,
      'pending',
      null,
      null,
      null,
      0,
      null,
      null,
      'open',
      null,
      nowIso,
      id,
      orgId
    ];

    const updateRes = await dbRun(sql, params);
    if (!updateRes || updateRes.changes === 0) {
      return res.status(404).json({ error: 'Time entry not found.' });
    }

    const afterRow = await dbGet(
      'SELECT * FROM time_entries WHERE id = ? AND org_id = ?',
      [id, orgId]
    );
    await logTimeEntryAudit({
      entryId: id,
      action: 'modify',
      before: beforeRow,
      after: afterRow,
      note: note || null,
      req
    });

    await notifyTimeEvent({
      orgId,
      eventType: 'TIME_ENTRY_MANUAL_EDITED',
      title: 'Manual time entry updated',
      body: `Manual time entry updated for ${empRow?.name || 'employee'} on ${startDate}.`,
      data: {
        time_entry_id: id,
        employee_id: empIdNum,
        project_id: projIdNum,
        start_date: startDate
      }
    });

    const weeklyWindow = getWeekWindowForDate(startDate, orgTimezone);
    if (weeklyWindow) {
      const rulesMap = await loadExceptionRulesMap(orgId);
      const rawWeeklyThreshold =
        rulesMap && rulesMap.weekly_hours_threshold != null
          ? Number(rulesMap.weekly_hours_threshold)
          : null;
      const weeklyThreshold =
        Number.isFinite(rawWeeklyThreshold) && rawWeeklyThreshold > 0
          ? rawWeeklyThreshold
          : null;
      if (weeklyThreshold) {
        const weeklyTotal = await sumWeeklyHoursForEmployee({
          orgId,
          employeeId: empIdNum,
          weekStart: weeklyWindow.weekStart,
          weekEnd: weeklyWindow.weekEnd
        });
        const ratio = weeklyTotal / weeklyThreshold;
        if (ratio >= 1) {
          await notifyTimeEventOnce({
            orgId,
            eventType: 'TIME_WEEKLY_THRESHOLD_EXCEEDED',
            title: 'Weekly hours exceeded',
            body: `${empRow?.name || 'Employee'} reached ${weeklyTotal.toFixed(2)}h this week (threshold ${weeklyThreshold}h).`,
            data: {
              employee_id: empIdNum,
              week_start: weeklyWindow.weekStart,
              week_end: weeklyWindow.weekEnd,
              weekly_hours: weeklyTotal,
              threshold_hours: weeklyThreshold
            },
            match: {
              employee_id: empIdNum,
              week_start: weeklyWindow.weekStart
            }
          });
        } else if (ratio >= WEEKLY_THRESHOLD_WARNING_RATIO) {
          await notifyTimeEventOnce({
            orgId,
            eventType: 'TIME_WEEKLY_THRESHOLD_NEAR',
            title: 'Weekly hours approaching limit',
            body: `${empRow?.name || 'Employee'} is at ${weeklyTotal.toFixed(2)}h this week (threshold ${weeklyThreshold}h).`,
            data: {
              employee_id: empIdNum,
              week_start: weeklyWindow.weekStart,
              week_end: weeklyWindow.weekEnd,
              weekly_hours: weeklyTotal,
              threshold_hours: weeklyThreshold
            },
            match: {
              employee_id: empIdNum,
              week_start: weeklyWindow.weekStart
            }
          });
        }
      }
    }

    const response = { ok: true, id, total_pay: totalPay };
    if (clientId) {
      await storeIdempotentResponse(orgId, 'time_entry_edit', clientId, response);
    }

    res.json(response);
  } catch (err) {
    console.error('Error updating time entry:', err);
    return res.status(500).json({ error: err.message || 'Failed to update time entry.' });
  }
});

// Mark a time entry as "accuracy verified" (or clear verification)
// Only admins can verify time entries
app.post('/api/time-entries/:id/verify', requireModifyTimeAny, (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ error: 'Invalid time entry id.' });
  }

  const ctx = req.modifyTimeContext;
  const orgId = ctx && ctx.orgId ? ctx.orgId : (req.session && req.session.orgId);
  const adminId = ctx && ctx.adminId ? ctx.adminId : (req.session && req.session.employeeId);
  if (!orgId) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  const { verified, verified_by_employee_id, note } = req.body || {};
  const isVerified = !!verified;
  const verifierId = verified_by_employee_id
    ? Number(verified_by_employee_id)
    : (ctx && ctx.adminId ? Number(ctx.adminId) : null);

  if (!isVerified && (!note || !note.trim())) {
    return res.status(400).json({ error: 'A note is required to unverify.' });
  }

  // If marking verified, stamp now; if clearing, null out fields
  const verifiedAt = isVerified ? new Date().toISOString() : null;

  (async () => {
    const perms = ctx && ctx.perms
      ? ctx.perms
      : adminId
        ? await getAdminAccessPerms({ employeeId: adminId, orgId })
        : null;
    const isSuperAdmin = adminId
      ? await isEmployeeSuperAdmin({ employeeId: adminId, orgId })
      : false;
    const canSeeEntry = await isTimeEntryVisibleForAdmin({
      orgId,
      entryId: id,
      adminId,
      perms,
      isSuperAdmin
    });
    if (!canSeeEntry) {
      return res.status(403).json({ error: 'Not authorized.' });
    }

    return dbGet('SELECT * FROM time_entries WHERE id = ? AND org_id = ?', [id, orgId])
    .then(beforeRow => {
      db.run(
        `
        UPDATE time_entries
        SET
          verified = ?,
          verified_at = ?,
          verified_by_employee_id = ?,
          updated_at = ?
        WHERE id = ? AND org_id = ?
        `,
        [
          isVerified ? 1 : 0,
          verifiedAt,
          isVerified ? verifierId : null,
          new Date().toISOString(),
          id,
          orgId
        ],
        async function (err) {
          if (err) {
            console.error('Error updating verification for time entry:', err.message);
            return res.status(500).json({ error: err.message });
          }
          if (this.changes === 0) {
            return res.status(404).json({ error: 'Time entry not found.' });
          }

          const afterRow = await dbGet(
            'SELECT * FROM time_entries WHERE id = ? AND org_id = ?',
            [id, orgId]
          );
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
  })();
});

// Mark a time entry as "exception resolved" (admin/foreman)
// Only admins can resolve time entries
app.post('/api/time-entries/:id/resolve', requireModifyTimeAny, (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ error: 'Invalid time entry id.' });
  }

  const ctx = req.modifyTimeContext;
  const orgId = ctx && ctx.orgId ? ctx.orgId : (req.session && req.session.orgId);
  const adminId = ctx && ctx.adminId ? ctx.adminId : (req.session && req.session.employeeId);
  if (!orgId) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  const { resolved, resolved_by, note } = req.body || {};
  const isResolved = !!resolved;
  const resolvedBy = resolved_by || 'admin'; // UI override or fallback
  const resolvedAt = isResolved ? new Date().toISOString() : null;

  if (!note || !note.trim()) {
    return res.status(400).json({ error: 'A note is required to resolve/unresolve.' });
  }

  (async () => {
    const perms = ctx && ctx.perms
      ? ctx.perms
      : adminId
        ? await getAdminAccessPerms({ employeeId: adminId, orgId })
        : null;
    const isSuperAdmin = adminId
      ? await isEmployeeSuperAdmin({ employeeId: adminId, orgId })
      : false;
    const canSeeEntry = await isTimeEntryVisibleForAdmin({
      orgId,
      entryId: id,
      adminId,
      perms,
      isSuperAdmin
    });
    if (!canSeeEntry) {
      return res.status(403).json({ error: 'Not authorized.' });
    }

    return dbGet('SELECT * FROM time_entries WHERE id = ? AND org_id = ?', [id, orgId])
    .then(beforeRow => {
      db.run(
        `
          UPDATE time_entries
          SET
            resolved    = ?,
            resolved_at = ?,
            resolved_by = ?,
            resolved_note = ?,
            updated_at = ?
          WHERE id = ? AND org_id = ?
        `,
        [
          isResolved ? 1 : 0,
          resolvedAt,
          isResolved ? resolvedBy : null,
          note || null,
          new Date().toISOString(),
          id,
          orgId
        ],
        async function (err) {
          if (err) {
            console.error('Error resolving time entry:', err.message);
            return res.status(500).json({ error: err.message });
          }
          if (this.changes === 0) {
            return res.status(404).json({ error: 'Time entry not found.' });
          }

          const afterRow = await dbGet(
            'SELECT * FROM time_entries WHERE id = ? AND org_id = ?',
            [id, orgId]
          );
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
  })();
});

// Send a time entry back to field review (any admin)
app.post('/api/time-entries/:id/send-back', requireModifyTimeAny, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ error: 'Invalid time entry id.' });
  }

  const ctx = req.modifyTimeContext;
  const orgId = ctx && ctx.orgId ? ctx.orgId : (req.session && req.session.orgId);
  const adminId = ctx && ctx.adminId ? ctx.adminId : (req.session && req.session.employeeId);
  if (!orgId) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  const noteVal = String(req.body?.note || '').trim();
  const ifMatch = req.body?.if_match_updated_at;
  if (!noteVal) {
    return res.status(400).json({ error: 'A note is required to send back.' });
  }

  try {
    const perms = ctx && ctx.perms
      ? ctx.perms
      : adminId
        ? await getAdminAccessPerms({ employeeId: adminId, orgId })
        : null;
    const isSuperAdmin = adminId
      ? await isEmployeeSuperAdmin({ employeeId: adminId, orgId })
      : false;
    const canSeeEntry = await isTimeEntryVisibleForAdmin({
      orgId,
      entryId: id,
      adminId,
      perms,
      isSuperAdmin
    });
    if (!canSeeEntry) {
      return res.status(403).json({ error: 'Not authorized.' });
    }

    const beforeRow = await dbGet(
      'SELECT * FROM time_entries WHERE id = ? AND org_id = ?',
      [id, orgId]
    );
    if (!beforeRow) {
      return res.status(404).json({ error: 'Time entry not found.' });
    }
    if (beforeRow.paid) {
      return res.status(409).json({
        error: 'Paid time entries cannot be sent back. Unpay before making changes.'
      });
    }
    if (ifMatch && beforeRow.updated_at && beforeRow.updated_at !== ifMatch) {
      return res.status(409).json({
        error: 'Conflict: this time entry was updated by someone else.',
        current: pickFields(beforeRow, [
          'id',
          'employee_id',
          'project_id',
          'start_date',
          'end_date',
          'start_time',
          'end_time',
          'hours',
          'approval_status',
          'approved_at',
          'approved_by_employee_id',
          'resolved_status',
          'resolved',
          'updated_at'
        ])
      });
    }

    const nowIso = new Date().toISOString();
    await dbRun(
      `
        UPDATE time_entries
        SET
          approval_status = ?,
          approved_at = ?,
          approved_by_employee_id = ?,
          approval_note = ?,
          resolved = ?,
          resolved_at = ?,
          resolved_by = ?,
          resolved_status = ?,
          resolved_note = ?,
          updated_at = ?
        WHERE id = ? AND org_id = ?
      `,
      [
        'pending',
        null,
        null,
        null,
        0,
        null,
        null,
        'open',
        noteVal,
        nowIso,
        id,
        orgId
      ]
    );

    const afterRow = await dbGet(
      'SELECT * FROM time_entries WHERE id = ? AND org_id = ?',
      [id, orgId]
    );
    await logTimeEntryAudit({
      entryId: id,
      action: 'send_back',
      before: beforeRow,
      after: afterRow,
      note: noteVal,
      req
    });

    return res.json({
      ok: true,
      id,
      approval_status: 'pending',
      resolved_status: 'open'
    });
  } catch (err) {
    console.error('Error sending time entry back to review:', err);
    return res.status(500).json({ error: 'Failed to send back time entry.' });
  }
});

// Approve a single time entry (super admin only)
app.post('/api/time-entries/:id/approve', requireModifyTime, requireApproveTime, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ error: 'Invalid time entry id.' });
  }

  const orgId = req.session && req.session.orgId;
  const approverId = req.session && req.session.employeeId;
  if (!orgId || !approverId) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  const { note, if_match_updated_at } = req.body || {};
  const perms = req.adminPerms || await getAdminAccessPerms({ employeeId: approverId, orgId });
  const isSuperAdmin = await isEmployeeSuperAdmin({ employeeId: approverId, orgId });
  const canSeeEntry = await isTimeEntryVisibleForAdmin({
    orgId,
    entryId: id,
    adminId: approverId,
    perms,
    isSuperAdmin
  });
  if (!canSeeEntry) {
    return res.status(403).json({ error: 'Not authorized.' });
  }

  try {
    const { rows, ruleFlags } = await loadTimeEntryApprovalRows({
      orgId,
      entryId: id,
      adminId: approverId,
      perms,
      isSuperAdmin
    });
    const row = rows && rows[0];
    if (!row) {
      return res.status(404).json({ error: 'Time entry not found.' });
    }

    if (if_match_updated_at && row.updated_at && row.updated_at !== if_match_updated_at) {
      return res.status(409).json({
        error: 'Conflict: this time entry was updated by someone else.',
        current: pickFields(row, [
          'id',
          'employee_id',
          'project_id',
          'start_date',
          'end_date',
          'start_time',
          'end_time',
          'hours',
          'approval_status',
          'approved_at',
          'approved_by_employee_id',
          'updated_at'
        ])
      });
    }

    if (isFieldReviewRejected(row)) {
      return res.status(409).json({
        error: 'Rejected time entries cannot be approved for payroll.'
      });
    }

    const requiresNote = computeTimeEntryRequiresNote(row, ruleFlags);
    if (requiresNote && (!note || !note.trim())) {
      return res.status(400).json({
        error: 'A note is required to approve entries with discrepancies or manual edits.'
      });
    }

    if (row.approval_status === 'approved') {
      return res.json({
        ok: true,
        approval_status: 'approved',
        approved_at: row.approved_at,
        approved_by_employee_id: row.approved_by_employee_id
      });
    }

    const nowIso = new Date().toISOString();
    await dbRun(
      `
        UPDATE time_entries
        SET approval_status = ?,
            approved_at = ?,
            approved_by_employee_id = ?,
            approval_note = ?,
            updated_at = ?
        WHERE id = ? AND org_id = ?
      `,
      [
        'approved',
        nowIso,
        approverId,
        note && note.trim() ? note.trim() : null,
        nowIso,
        id,
        orgId
      ]
    );

    const afterRow = await dbGet(
      'SELECT * FROM time_entries WHERE id = ? AND org_id = ?',
      [id, orgId]
    );
    await logTimeEntryAudit({
      entryId: id,
      action: 'approve',
      before: row,
      after: afterRow,
      note: note || null,
      req
    });

    return res.json({
      ok: true,
      approval_status: 'approved',
      approved_at: nowIso,
      approved_by_employee_id: approverId
    });
  } catch (err) {
    console.error('Error approving time entry:', err);
    return res.status(500).json({ error: 'Failed to approve time entry.' });
  }
});

// Bulk approve clean time entries (super admin only)
app.post('/api/time-entries/approve', requireModifyTime, requireApproveTime, async (req, res) => {
  const { start, end, employee_id, project_id } = req.body || {};
  const orgId = req.session && req.session.orgId;
  const approverId = req.session && req.session.employeeId;

  if (!orgId || !approverId) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  if (!start || !end) {
    return res.status(400).json({ error: 'start and end are required.' });
  }

  try {
    const perms = req.adminPerms || await getAdminAccessPerms({ employeeId: approverId, orgId });
    const isSuperAdmin = await isEmployeeSuperAdmin({ employeeId: approverId, orgId });
    const { rows, ruleFlags } = await loadTimeEntryApprovalRows({
      orgId,
      start,
      end,
      employeeId: employee_id || null,
      projectId: project_id || null,
      adminId: approverId,
      perms,
      isSuperAdmin
    });

    if (!rows.length) {
      return res.json({ ok: true, approved_count: 0, skipped: [] });
    }

    const nowIso = new Date().toISOString();
    const skipped = [];
    let approvedCount = 0;

    await dbRun('BEGIN TRANSACTION');

    for (const row of rows) {
      if (row.approval_status === 'approved') {
        continue;
      }
      if (isFieldReviewRejected(row)) {
        skipped.push({ id: row.id, reason: 'rejected' });
        continue;
      }
      const requiresNote = computeTimeEntryRequiresNote(row, ruleFlags);
      if (requiresNote) {
        skipped.push({ id: row.id, reason: 'requires_note' });
        continue;
      }

      await dbRun(
        `
          UPDATE time_entries
          SET approval_status = ?,
              approved_at = ?,
              approved_by_employee_id = ?,
              approval_note = NULL,
              updated_at = ?
          WHERE id = ? AND org_id = ?
        `,
        ['approved', nowIso, approverId, nowIso, row.id, orgId]
      );

      await logTimeEntryAudit({
        entryId: row.id,
        action: 'approve',
        before: row,
        after: { ...row, approval_status: 'approved', approved_at: nowIso, approved_by_employee_id: approverId },
        note: null,
        req
      });

      approvedCount += 1;
    }

    await dbRun('COMMIT');

    return res.json({ ok: true, approved_count: approvedCount, skipped });
  } catch (err) {
    console.error('Error bulk approving time entries:', err);
    try {
      await dbRun('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    return res.status(500).json({ error: 'Failed to bulk approve time entries.' });
  }
});



/* ───────── 7. KIOSKS & KIOSK PUNCHES ───────── */

app.post('/api/kiosk/punch', async (req, res) => {
  const {
    client_id,
    employee_id,
    project_id,
    lat,
    lng,
    device_timestamp,
    photo_base64,
    device_id,
    device_secret
  } = req.body || {};
  const intendedMode = String(req.body && req.body.intended_mode || '').toLowerCase();

  const hasSession = req.session && req.session.userId;
  const deviceId = String(device_id || '').trim();
  const deviceSecret = String(device_secret || '').trim();

  if (!deviceId) {
    return res.status(400).json({ error: 'device_id is required.' });
  }

  if (!client_id || !employee_id) {
    return res
      .status(400)
      .json({ error: 'client_id and employee_id are required.' });
  }
  const employeeId = Number(employee_id);
  if (!employeeId) {
    return res.status(400).json({ error: 'employee_id must be a valid number.' });
  }

  if (!project_id) {
    return res
      .status(400)
      .json({ error: 'Project not set for this device. Have a supervisor set today’s project first.' });
  }

  const kioskRow = await dbGet(
    'SELECT id, org_id, device_secret, project_id FROM kiosks WHERE device_id = ? LIMIT 1',
    [deviceId]
  );
  if (kioskRow && kioskRow.org_id) {
    const orgRow = await dbGet(
      'SELECT status FROM orgs WHERE id = ? LIMIT 1',
      [kioskRow.org_id]
    );
    if (orgRow && orgRow.status && orgRow.status !== 'active') {
      return res.status(403).json({ error: 'Org access denied.' });
    }
  }

  if (!kioskRow) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  let sessionIsKioskAdmin = false;
  const sessionOrgId = req.session && req.session.orgId;
  const sessionEmployeeId = req.session && req.session.employeeId;
  if (hasSession && sessionOrgId && sessionEmployeeId) {
    try {
      const access = await getEmployeeAccessFlags({
        employeeId: sessionEmployeeId,
        orgId: sessionOrgId
      });
      sessionIsKioskAdmin = !!(access && access.kiosk_admin_access);
    } catch (err) {
      console.warn('Unable to resolve kiosk admin access:', err.message);
    }
  }

  if (!sessionIsKioskAdmin) {
    if (!deviceSecret) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!kioskRow.device_secret || kioskRow.device_secret !== deviceSecret) {
      return res.status(403).json({ error: 'Not authorized' });
    }
  }

  const orgId = sessionIsKioskAdmin ? sessionOrgId : kioskRow.org_id;
  if (!orgId) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  if (sessionIsKioskAdmin && kioskRow.org_id && Number(kioskRow.org_id) !== Number(orgId)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const requestedProjectId = Number(project_id);
  if (!Number.isFinite(requestedProjectId) || requestedProjectId <= 0) {
    return res.status(400).json({ error: 'project_id must be a valid number.' });
  }
  const projectId = requestedProjectId;

  const employeeRow = await dbGet(
    `
      SELECT id, active, worker_timekeeping, kiosk_admin_access
      FROM employees
      WHERE id = ? AND org_id = ?
      LIMIT 1
    `,
    [employeeId, orgId]
  );
  if (!employeeRow) {
    return res.status(403).json({ error: 'Employee not found or not authorized.' });
  }

  const canTimekeep =
    (employeeRow.worker_timekeeping || 0) === 1 ||
    (employeeRow.kiosk_admin_access || 0) === 1;

  const orgTimezone = await getOrgTimezone(orgId);
  const queuedAtRaw = req.body && req.body.queued_at;
  let queuedAt = null;
  if (queuedAtRaw) {
    const parsed = new Date(String(queuedAtRaw));
    if (!Number.isNaN(parsed.getTime())) {
      queuedAt = parsed;
    }
  }

  const nowIso = new Date().toISOString();
  let punchTime = device_timestamp || nowIso;
  if (!queuedAt) {
    punchTime = nowIso;
  }
  let punchDate = new Date(punchTime);
  if (Number.isNaN(punchDate.getTime())) {
    punchTime = new Date().toISOString();
    punchDate = new Date(punchTime);
  }

  const now = new Date();
  const futureSkewMs = 5 * 60 * 1000;
  if (punchDate.getTime() - now.getTime() > futureSkewMs) {
    return res.status(400).json({ error: 'device_timestamp is too far in the future.' });
  }

  const enforceActiveProject = !queuedAt;

  if (enforceActiveProject) {
    const activeProjectId =
      kioskRow.project_id && Number(kioskRow.project_id) > 0
        ? Number(kioskRow.project_id)
        : null;
    if (!activeProjectId) {
      return res.status(400).json({
        error: 'Project not set for this device. Have a supervisor set today’s project first.'
      });
    }
    if (requestedProjectId !== activeProjectId) {
      return res.status(409).json({
        error: 'Active project has changed. Punches must use the active timesheet.',
        active_project_id: activeProjectId
      });
    }
  }

  const clockInLocalDate = getIsoDateInTimezone(punchTime, orgTimezone);
  const sessionDate = clockInLocalDate || getTodayIsoDate(orgTimezone);

  const existing = await dbGet(
    'SELECT * FROM time_punches WHERE org_id = ? AND client_id = ? LIMIT 1',
    [orgId, client_id]
  );
  if (existing) {
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

  const open = await dbGet(
    `
      SELECT *
      FROM time_punches
      WHERE org_id = ?
        AND employee_id = ?
        AND clock_out_ts IS NULL
      ORDER BY clock_in_ts DESC
      LIMIT 1
    `,
    [orgId, employeeId]
  );

  if (open && intendedMode === 'clock_in') {
    const openTs = open.clock_in_ts ? new Date(open.clock_in_ts) : null;
    const requested = new Date(punchTime);
    if (openTs && !Number.isNaN(openTs.getTime()) && !Number.isNaN(requested.getTime())) {
      const deltaMs = Math.abs(requested.getTime() - openTs.getTime());
      if (deltaMs <= 15000) {
        return res.json({
          ok: true,
          alreadyProcessed: true,
          mode: 'clock_in',
          geofence_violation: !!open.geo_violation,
          geo_distance_m: open.geo_distance_m,
          geo_radius_m: null
        });
      }
    }
    return res.status(409).json({
      error: 'Already clocked in. Please clock out before starting a new shift.',
      open_punch_id: open.id
    });
  }

  if (!open && intendedMode === 'clock_out') {
    const recentClosed = await dbGet(
      `
        SELECT *
        FROM time_punches
        WHERE org_id = ?
          AND employee_id = ?
          AND device_id = ?
          AND clock_out_ts IS NOT NULL
        ORDER BY clock_out_ts DESC
        LIMIT 1
      `,
      [orgId, employeeId, deviceId]
    );
    if (recentClosed && recentClosed.clock_out_ts) {
      const recentOut = new Date(recentClosed.clock_out_ts);
      const requested = new Date(punchTime);
      if (!Number.isNaN(recentOut.getTime()) && !Number.isNaN(requested.getTime())) {
        const deltaMs = Math.abs(requested.getTime() - recentOut.getTime());
        if (deltaMs <= 15000) {
          return res.json({
            ok: true,
            alreadyProcessed: true,
            mode: 'clock_out',
            geofence_violation: !!recentClosed.geo_violation,
            geo_distance_m: recentClosed.geo_distance_m,
            geo_radius_m: null
          });
        }
      }
    }
    return res.status(409).json({ error: 'No open punch to clock out.' });
  }

  if (!open) {
    const sessionRow = await dbGet(
      `
        SELECT id
        FROM kiosk_sessions
        WHERE org_id = ?
          AND kiosk_id = ?
          AND date = ?
          AND project_id = ?
          AND datetime(created_at) <= datetime(?)
          AND (ended_at IS NULL OR datetime(ended_at) >= datetime(?))
        ORDER BY id DESC
        LIMIT 1
      `,
      [orgId, kioskRow.id, sessionDate, requestedProjectId, punchTime, punchTime]
    );
    if (!sessionRow) {
      return res.status(400).json({
        error: 'No active timesheet exists for this project on this device for the punch time.'
      });
    }
    const sessionId = sessionRow.id;

    if (!employeeRow.active || !canTimekeep) {
      return res.status(403).json({ error: 'Employee is not authorized to clock in.' });
    }
    const photoRequired = await getClockInPhotoRequired(orgId);
    if (photoRequired && !photo_base64) {
      return res.status(400).json({ error: 'Photo is required to clock in.' });
    }

    let geoDistance = null;
    let geoViolation = 0;
    let geoRadius = null;

    if (projectId && lat != null && lng != null) {
      const project = await dbGet(
        'SELECT geo_lat, geo_lng, geo_radius FROM projects WHERE id = ? AND org_id = ?',
        [projectId, orgId]
      );
      if (
        project &&
        project.geo_lat != null &&
        project.geo_lng != null &&
        project.geo_radius != null
      ) {
        const latNum = Number(lat);
        const lngNum = Number(lng);
        const projLat = Number(project.geo_lat);
        const projLng = Number(project.geo_lng);
        const radiusNum = Number(project.geo_radius);
        if (
          !Number.isNaN(latNum) &&
          !Number.isNaN(lngNum) &&
          !Number.isNaN(projLat) &&
          !Number.isNaN(projLng) &&
          !Number.isNaN(radiusNum)
        ) {
          geoRadius = radiusNum;
          const dist = distanceMeters(latNum, lngNum, projLat, projLng);
          geoDistance = dist;
          if (dist > radiusNum) geoViolation = 1;
        }
      }
    }

    let foremanId = null;
    try {
      foremanId = await getTodayForemanForDeviceAsync(deviceId, employeeId, sessionDate);
    } catch (err) {
      console.error('Error looking up foreman for device:', err);
    }

    let clockInPhotoPath = null;
    if (photo_base64) {
      try {
        clockInPhotoPath = await saveClockInPhoto({
          orgId,
          employeeId: employeeId,
          deviceId,
          photoBase64: photo_base64,
          punchTime
        });
      } catch (err) {
        console.error('Error saving clock-in photo:', err);
        if (photoRequired) {
          return res.status(500).json({ error: 'Failed to store clock-in photo.' });
        }
      }
    }

    const insertSql = `
      INSERT INTO time_punches
        (org_id,
         client_id,
         employee_id,
         project_id,
         clock_in_ts,
         clock_in_local_date,
         clock_in_lat,
         clock_in_lng,
         clock_in_photo_path,
         device_id,
         kiosk_session_id,
         foreman_employee_id,
         geo_distance_m,
         geo_violation,
         employee_name_snapshot,
         project_name_snapshot,
         updated_at)
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        (SELECT name FROM employees WHERE id = ? AND org_id = ?),
        (SELECT name FROM projects  WHERE id = ? AND org_id = ?),
        ?
      )
    `;

    try {
      const result = await dbRun(insertSql, [
        orgId,
        client_id,
        employeeId,
        projectId || null,
        punchTime,
        clockInLocalDate,
        lat ?? null,
        lng ?? null,
        clockInPhotoPath,
        deviceId || null,
        sessionId || null,
        foremanId || null,
        geoDistance,
        geoViolation,
        employeeId,
        orgId,
        projectId || null,
        orgId,
        punchTime
      ]);

      return res.json({
        ok: true,
        mode: 'clock_in',
        id: result.lastID,
        punch_id: result.lastID,
        geofence_violation: geoViolation === 1,
        geo_distance_m: geoDistance,
        geo_radius_m: geoRadius
      });
    } catch (err) {
      const msg = String(err.message || '');
      if (msg.includes('UNIQUE constraint failed: time_punches.org_id, time_punches.client_id')) {
        return res.json({
          ok: true,
          mode: 'clock_in',
          alreadyProcessed: true,
          geofence_violation: geoViolation === 1,
          geo_distance_m: geoDistance,
          geo_radius_m: geoRadius
        });
      }
      return res.status(500).json({ error: err.message });
    }
  }

  const clockOutLocalDate = getIsoDateInTimezone(punchTime, orgTimezone);
  const clockOutProjectId = open.project_id || projectId || null;

  let geoDistance = open.geo_distance_m != null ? Number(open.geo_distance_m) : null;
  let geoViolation = open.geo_violation ? 1 : 0;

  const updateSql = `
    UPDATE time_punches
    SET clock_out_ts = ?,
        clock_out_local_date = ?,
        clock_out_project_id = ?,
        clock_out_lat = ?,
        clock_out_lng = ?,
        geo_distance_m = ?,
        geo_violation = ?,
        clock_out_device_id = ?,
        updated_at = ?
    WHERE id = ? AND org_id = ? AND clock_out_ts IS NULL AND time_entry_id IS NULL
  `;

  try {
    const updateRes = await dbRun(updateSql, [
      punchTime,
      clockOutLocalDate,
      clockOutProjectId,
      lat ?? null,
      lng ?? null,
      geoDistance,
      geoViolation,
      deviceId || null,
      punchTime,
      open.id,
      orgId
    ]);
    if (!updateRes || !updateRes.changes) {
      return res.json({
        ok: true,
        alreadyProcessed: true,
        mode: 'clock_out',
        geofence_violation: !!geoViolation,
        geo_distance_m: geoDistance,
        geo_radius_m: null
      });
    }

    const startIso = open.clock_in_ts || punchTime;
    const start = new Date(startIso);
    const end = new Date(punchTime);
    const diffMs = end - start;
    let minutes = Math.ceil(diffMs / 60000);
    if (!Number.isFinite(minutes) || minutes < 0) minutes = 0;

    const hours = minutes / 60;
    const startDate = getIsoDateInTimezone(startIso || punchTime, orgTimezone);
    const endDate = getIsoDateInTimezone(punchTime || startIso, orgTimezone);
    const startTime = getIsoTimeInTimezone(startIso || punchTime, orgTimezone);
    const endTime = getIsoTimeInTimezone(punchTime || startIso, orgTimezone);

    const empRow = await dbGet(
      'SELECT rate, name FROM employees WHERE id = ? AND org_id = ?',
      [employeeId, orgId]
    );
    if (!empRow) {
      return res.status(400).json({ error: 'Invalid employee_id.' });
    }

    const rate = parseFloat(empRow.rate || 0);
    const total_pay = rate * hours;
    const finalProjectId = clockOutProjectId;
    const foremanId = open.foreman_employee_id || null;

    const timeEntrySql = `
      INSERT INTO time_entries
        (org_id,
         employee_id,
         project_id,
         start_date,
         end_date,
         start_time,
         end_time,
         hours,
         total_pay,
         foreman_employee_id,
         employee_name_snapshot,
         project_name_snapshot,
         updated_at)
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        (SELECT name FROM employees WHERE id = ? AND org_id = ?),
        (SELECT name FROM projects  WHERE id = ? AND org_id = ?),
        ?
      )
    `;

    const entryRes = await dbRun(timeEntrySql, [
      orgId,
      employeeId,
      finalProjectId,
      startDate,
      endDate,
      startTime,
      endTime,
      hours,
      total_pay,
      foremanId,
      employeeId,
      orgId,
      finalProjectId || null,
      orgId,
      punchTime
    ]);

    await dbRun(
      'UPDATE time_punches SET time_entry_id = ?, updated_at = ? WHERE id = ? AND org_id = ?',
      [entryRes.lastID, new Date().toISOString(), open.id, orgId]
    );

    const entryId = entryRes.lastID;
    const employeeName = empRow?.name || 'employee';
    let shiftEventType = null;
    if (hours >= MULTI_DAY_SHIFT_THRESHOLD_HOURS) {
      shiftEventType = 'TIME_SHIFT_MULTI_DAY';
    } else if (hours >= LONG_SHIFT_THRESHOLD_HOURS) {
      shiftEventType = 'TIME_SHIFT_LONG';
    }
    if (shiftEventType) {
      const shiftLabel =
        shiftEventType === 'TIME_SHIFT_MULTI_DAY' ? 'Multi-day shift' : 'Long shift';
      await notifyTimeEventOnce({
        orgId,
        eventType: shiftEventType,
        title: `${shiftLabel} completed`,
        body: `${employeeName} clocked out after ${hours.toFixed(2)}h.`,
        data: {
          time_entry_id: entryId,
          employee_id: employeeId,
          hours
        },
        match: {
          time_entry_id: entryId
        }
      });
    }

    const weeklyWindow = getWeekWindowForDate(startDate, orgTimezone);
    if (weeklyWindow) {
      const rulesMap = await loadExceptionRulesMap(orgId);
      const rawWeeklyThreshold =
        rulesMap && rulesMap.weekly_hours_threshold != null
          ? Number(rulesMap.weekly_hours_threshold)
          : null;
      const weeklyThreshold =
        Number.isFinite(rawWeeklyThreshold) && rawWeeklyThreshold > 0
          ? rawWeeklyThreshold
          : null;
      if (weeklyThreshold) {
        const weeklyTotal = await sumWeeklyHoursForEmployee({
          orgId,
          employeeId,
          weekStart: weeklyWindow.weekStart,
          weekEnd: weeklyWindow.weekEnd
        });
        const ratio = weeklyTotal / weeklyThreshold;
        if (ratio >= 1) {
          await notifyTimeEventOnce({
            orgId,
            eventType: 'TIME_WEEKLY_THRESHOLD_EXCEEDED',
            title: 'Weekly hours exceeded',
            body: `${employeeName} reached ${weeklyTotal.toFixed(2)}h this week (threshold ${weeklyThreshold}h).`,
            data: {
              employee_id: employeeId,
              week_start: weeklyWindow.weekStart,
              week_end: weeklyWindow.weekEnd,
              weekly_hours: weeklyTotal,
              threshold_hours: weeklyThreshold
            },
            match: {
              employee_id: employeeId,
              week_start: weeklyWindow.weekStart
            }
          });
        } else if (ratio >= WEEKLY_THRESHOLD_WARNING_RATIO) {
          await notifyTimeEventOnce({
            orgId,
            eventType: 'TIME_WEEKLY_THRESHOLD_NEAR',
            title: 'Weekly hours approaching limit',
            body: `${employeeName} is at ${weeklyTotal.toFixed(2)}h this week (threshold ${weeklyThreshold}h).`,
            data: {
              employee_id: employeeId,
              week_start: weeklyWindow.weekStart,
              week_end: weeklyWindow.weekEnd,
              weekly_hours: weeklyTotal,
              threshold_hours: weeklyThreshold
            },
            match: {
              employee_id: employeeId,
              week_start: weeklyWindow.weekStart
            }
          });
        }
      }
    }

    return res.json({
      ok: true,
      mode: 'clock_out',
      hours,
      total_pay,
      time_entry_id: entryId
    });
  } catch (err) {
    console.error('Error in clock-out flow:', err);
    return res.status(500).json({ error: err.message });
  }
});



app.get('/api/kiosks', async (req, res) => {
  const adminCtx = await getAdminContext(req, { requirePerm: 'view_payroll' });
  const deviceAccess = adminCtx ? { ok: false } : await ensureKioskDevice(req);
  const isAdmin = !!adminCtx;
  const orgId = isAdmin
    ? adminCtx.orgId
    : (deviceAccess && deviceAccess.kiosk && deviceAccess.kiosk.org_id);

  // Admins: list all kiosks; kiosk devices: only their own
  const baseSql = `
    SELECT
      k.id,
      k.name,
      k.location,
      k.device_id,
      k.project_id,
      k.created_at,
      p.name AS project_name,
      p.customer_name
    FROM kiosks k
    LEFT JOIN projects p ON k.project_id = p.id
  `;
  const sql = isAdmin
    ? `${baseSql} WHERE k.org_id = ? ORDER BY k.name`
    : `${baseSql} WHERE k.org_id = ? AND k.id = ? LIMIT 1`;
  const params = isAdmin
    ? [orgId]
    : [orgId, (deviceAccess && deviceAccess.kiosk && deviceAccess.kiosk.id) || 0];

  if (!isAdmin && (!deviceAccess || !deviceAccess.ok)) {
    return res.status(deviceAccess.status || 401).json({ error: deviceAccess.error || 'Not authorized' });
  }

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.post('/api/kiosks', async (req, res) => {
  const adminCtx = await getAdminContext(req, { requirePerm: 'view_payroll' });
  const deviceAccess = adminCtx ? { ok: false } : await ensureKioskDevice(req);
  const isAdmin = !!adminCtx;
  const orgId = isAdmin
    ? adminCtx.orgId
    : (deviceAccess && deviceAccess.kiosk && deviceAccess.kiosk.org_id);

  if (!isAdmin && (!deviceAccess || !deviceAccess.ok)) {
    return res.status(deviceAccess.status || 401).json({ error: deviceAccess.error || 'Not authorized' });
  }

  const {
    id,
    name,
    location,
    device_id,
    project_id
  } = req.body || {};

  if (!name) {
    return res.status(400).json({ error: 'Kiosk name is required.' });
  }

  const projectIdVal = project_id || null;

  try {
    if (id) {
      if (!isAdmin && deviceAccess && deviceAccess.kiosk && Number(deviceAccess.kiosk.id) !== Number(id)) {
        return res.status(403).json({ error: 'Not authorized to update this kiosk.' });
      }

      const beforeRow = await dbGet(
        `
          SELECT id, name, location, device_id, project_id
          FROM kiosks
          WHERE id = ? AND org_id = ?
        `,
        [id, orgId]
      );
      if (!beforeRow) {
        return res.status(404).json({ error: 'Kiosk not found.' });
      }

      const updateRes = await dbRun(
        `
          UPDATE kiosks
          SET name = ?, location = ?, device_id = ?, project_id = ?
          WHERE id = ? AND org_id = ?
        `,
        [name, location || null, device_id || null, projectIdVal, id, orgId]
      );

      if (!updateRes || updateRes.changes === 0) {
        return res.status(404).json({ error: 'Kiosk not found.' });
      }

      const afterRow = {
        id: Number(id),
        name,
        location: location || null,
        device_id: device_id || null,
        project_id: projectIdVal
      };

      const actorName =
        !isAdmin && deviceAccess && deviceAccess.kiosk && deviceAccess.kiosk.device_id
          ? `kiosk:${deviceAccess.kiosk.device_id}`
          : null;

      await logAuditEvent({
        req: isAdmin ? req : null,
        orgId,
        action: 'kiosk.update',
        entityType: 'kiosk',
        entityId: id,
        before: beforeRow,
        after: afterRow,
        actorName
      });

      return res.json({ ok: true, id });
    }

    if (!isAdmin) {
      return res.status(403).json({ error: 'Only admins can create new kiosks.' });
    }

    const insertRes = await dbRun(
      `
        INSERT INTO kiosks (org_id, name, location, device_id, project_id)
        VALUES (?, ?, ?, ?, ?)
      `,
      [orgId, name, location || null, device_id || null, projectIdVal]
    );

    const kioskId = insertRes.lastID;
    const newRow = await dbGet(
      `
        SELECT id, name, location, device_id, project_id
        FROM kiosks
        WHERE id = ? AND org_id = ?
      `,
      [kioskId, orgId]
    );

    await logAuditEvent({
      req,
      orgId,
      action: 'kiosk.create',
      entityType: 'kiosk',
      entityId: kioskId,
      after: newRow || {
        id: kioskId,
        name,
        location: location || null,
        device_id: device_id || null,
        project_id: projectIdVal
      }
    });

    return res.json({ ok: true, id: kioskId, message: 'Kiosk created.' });
  } catch (err) {
    console.error('Error saving kiosk:', err);
    return res.status(500).json({ error: 'Failed to save kiosk.' });
  }
});

app.post('/api/kiosks/register', async (req, res) => {
  const { device_id, device_secret, enrollment_code } = req.body || {};
  const deviceId = String(device_id || '').trim();
  const providedSecret = String(device_secret || '').trim();
  const enrollmentCode = normalizeEnrollmentCode(enrollment_code);
  let secretMismatch = false;
  let includeDeviceSecret = false;
  let usedEnrollment = false;

  if (!deviceId) {
    return res.status(400).json({ error: 'device_id is required.' });
  }

  if (!providedSecret && !enrollmentCode) {
    return res.status(400).json({ error: 'device_secret or enrollment_code is required.' });
  }

  let enrollmentOrgId = null;
  if (enrollmentCode) {
    const row = await dbGet(
      `
        SELECT os.org_id, o.status AS org_status
        FROM org_settings os
        JOIN orgs o ON o.id = os.org_id
        WHERE os.key = ? AND os.value = ?
        LIMIT 1
      `,
      [ENROLLMENT_CODE_KEY, enrollmentCode]
    );
    if (!row) {
      return res.status(400).json({ error: 'Invalid enrollment code.' });
    }
    if (row.org_status && row.org_status !== 'active') {
      return res.status(403).json({ error: 'Org access denied.' });
    }
    enrollmentOrgId = row.org_id;
    usedEnrollment = true;
  }

  let kioskRow = await dbGet(
    `
      SELECT k.*, o.timezone AS org_timezone
      FROM kiosks k
      LEFT JOIN orgs o ON o.id = k.org_id
      WHERE k.device_id = ?
      LIMIT 1
    `,
    [deviceId]
  );
  const wasNew = !kioskRow;

  if (kioskRow) {
    const orgStatus = await getOrgStatus(kioskRow.org_id);
    if (orgStatus && orgStatus !== 'active') {
      return res.status(403).json({ error: 'Org access denied.' });
    }
  }

  if (!kioskRow) {
    if (!enrollmentOrgId) {
      return res.status(400).json({ error: 'Enrollment code required for new devices.' });
    }

    const newSecret = crypto.randomBytes(24).toString('hex');
    const defaultName = `Kiosk ${deviceId.slice(-4)}`;
    const insertRes = await dbRun(
      `
        INSERT INTO kiosks (org_id, name, location, device_id, device_secret)
        VALUES (?, ?, ?, ?, ?)
      `,
      [enrollmentOrgId, defaultName, null, deviceId, newSecret]
    );

    kioskRow = await dbGet(
      `
        SELECT k.*, o.timezone AS org_timezone
        FROM kiosks k
        LEFT JOIN orgs o ON o.id = k.org_id
        WHERE k.id = ?
        LIMIT 1
      `,
      [insertRes.lastID]
    );
    includeDeviceSecret = true;
  } else {
    if (enrollmentOrgId && Number(enrollmentOrgId) !== Number(kioskRow.org_id)) {
      return res.status(409).json({ error: 'device_id already enrolled in another org.' });
    }

    if (enrollmentOrgId) {
      const newSecret = crypto.randomBytes(24).toString('hex');
      await dbRun('UPDATE kiosks SET device_secret = ? WHERE id = ?', [
        newSecret,
        kioskRow.id
      ]);
      kioskRow.device_secret = newSecret;
      includeDeviceSecret = true;
    } else {
      if (!providedSecret) {
        return res.status(400).json({ error: 'device_secret is required.' });
      }

      if (!kioskRow.device_secret) {
        return res.status(400).json({
          error: 'Device secret missing. Re-enroll this kiosk with the enrollment code.'
        });
      } else if (kioskRow.device_secret !== providedSecret) {
        secretMismatch = true;
        return res.status(403).json({
          error: 'Device secret mismatch. Re-enroll this kiosk with the enrollment code.'
        });
      }
    }
  }

  await dbRun('UPDATE kiosks SET last_seen_at = ? WHERE id = ?', [
    new Date().toISOString(),
    kioskRow.id
  ]);

  const orgTimezone =
    kioskRow.org_timezone || (await getOrgTimezone(kioskRow.org_id));
  const today = getTodayIsoDate(orgTimezone);

  const sessions = await dbAll(
    `
      SELECT ks.id,
             ks.project_id,
             ks.date,
             ks.created_at,
             ks.ended_at,
             ks.geo_distance_m,
             ks.geo_violation,
             p.name AS project_name,
             p.customer_name,
             p.geo_radius
      FROM kiosk_sessions ks
      LEFT JOIN projects p ON p.id = ks.project_id
      WHERE ks.org_id = ?
        AND ks.kiosk_id = ?
        AND ks.date = ?
      ORDER BY ks.created_at ASC
    `,
    [kioskRow.org_id, kioskRow.id, today]
  );

  const openSessions = (sessions || []).filter(s => !s.ended_at && s.project_id);
  let activeSession = null;
  if (kioskRow.project_id && Number(kioskRow.project_id) !== 0) {
    activeSession = openSessions
      .filter(s => Number(s.project_id) === Number(kioskRow.project_id))
      .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
      .pop() || null;
  }

  if (!activeSession) {
    const latestSession = openSessions
      .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
      .pop();

    if (latestSession) {
      activeSession = latestSession;
      if (Number(kioskRow.project_id) !== Number(latestSession.project_id)) {
        kioskRow.project_id = latestSession.project_id;
        await dbRun('UPDATE kiosks SET project_id = ? WHERE id = ?', [
          latestSession.project_id,
          kioskRow.id
        ]);
      }
    } else if (kioskRow.project_id) {
      kioskRow.project_id = null;
      await dbRun('UPDATE kiosks SET project_id = NULL WHERE id = ?', [
        kioskRow.id
      ]);
    }
  }

  const kioskResponse = { ...kioskRow };
  if (!includeDeviceSecret) {
    delete kioskResponse.device_secret;
  }

  if (includeDeviceSecret && kioskRow) {
    await logAuditEvent({
      orgId: kioskRow.org_id,
      action: wasNew ? 'kiosk.register' : 'kiosk.reenroll',
      entityType: 'kiosk',
      entityId: kioskRow.id,
      actorName: deviceId ? `kiosk:${deviceId}` : 'kiosk',
      after: {
        device_id: kioskRow.device_id || null,
        name: kioskRow.name || null,
        project_id: kioskRow.project_id || null,
        org_id: kioskRow.org_id
      },
      note: usedEnrollment ? 'Enrollment code used.' : null
    });
  }

  return res.json({
    ok: true,
    org_timezone: orgTimezone,
    kiosk: kioskResponse,
    sessions: sessions || [],
    active_session_id: activeSession ? activeSession.id : null
  });
});

app.get('/api/kiosks/:id/open-punches', async (req, res) => {
  const kioskId = parseInt(req.params.id, 10);
  if (!kioskId) {
    return res.status(400).json({ error: 'Invalid kiosk id.' });
  }

  const adminCtx = await resolveKioskAdmin(req);
  if (!adminCtx.ok) {
    return res
      .status(adminCtx.status || 401)
      .json({ error: adminCtx.error || 'Not authorized' });
  }

  const kioskRow = await dbGet(
    'SELECT id, device_id, org_id FROM kiosks WHERE id = ? AND org_id = ?',
    [kioskId, adminCtx.orgId]
  );
  if (!kioskRow || !kioskRow.device_id) {
    return res.json([]);
  }

  if (adminCtx.via === 'kiosk') {
    const deviceAccess = await ensureKioskDevice(req);
    if (!deviceAccess.ok || Number(deviceAccess.kiosk.id) !== Number(kioskId)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
  }

  const orgTimezone = await getOrgTimezone(adminCtx.orgId);
  const today = getTodayIsoDate(orgTimezone);
  const perms = await getAdminAccessPerms({
    employeeId: adminCtx.adminId,
    orgId: adminCtx.orgId
  });
  const isSuperAdmin = await isEmployeeSuperAdmin({
    employeeId: adminCtx.adminId,
    orgId: adminCtx.orgId
  });
  const canViewAll = canViewAllTimesheets({ perms, isSuperAdmin });
  const shareExistsClause = buildTimesheetShareExistsClause('ks');
  const visibilityFilter = canViewAll
    ? ''
    : `
      AND (
        tp.kiosk_session_id IS NULL
        OR ${shareExistsClause}
        OR ks.assigned_to_employee_id = ?
        OR ks.created_by_employee_id = ?
        OR ks.created_by_employee_id IS NULL
      )
    `;
  const sql = `
    SELECT
      tp.id,
      tp.employee_id,
      COALESCE(e.name, tp.employee_name_snapshot) AS employee_name,
      tp.project_id,
      COALESCE(p.name, tp.project_name_snapshot) AS project_name,
      p.customer_name,
      tp.clock_in_ts,
      tp.clock_out_ts
    FROM time_punches tp
    LEFT JOIN kiosk_sessions ks ON ks.id = tp.kiosk_session_id AND ks.org_id = tp.org_id
    LEFT JOIN employees e ON tp.employee_id = e.id
    LEFT JOIN projects p ON tp.project_id = p.id
    WHERE tp.org_id = ?
      AND tp.clock_out_ts IS NULL
      AND tp.clock_in_local_date = ?
      AND tp.device_id = ?
      ${visibilityFilter}
    ORDER BY tp.clock_in_ts ASC
  `;

  const params = [adminCtx.orgId, today, kioskRow.device_id];
  if (!canViewAll) {
    params.push(adminCtx.adminId);
    params.push(adminCtx.adminId);
    params.push(adminCtx.adminId);
  }

  db.all(sql, params, (err2, rows) => {
    if (err2) return res.status(500).json({ error: err2.message });
    res.json(rows || []);
  });
});

// List sessions for a kiosk (defaults to today)
app.get('/api/kiosks/:id/sessions', async (req, res) => {
  const kioskId = parseInt(req.params.id, 10);
  if (!kioskId) {
    return res.status(400).json({ error: 'Invalid kiosk id.' });
  }

  const adminCtx = await resolveKioskAdmin(req);
  if (!adminCtx.ok) {
    return res
      .status(adminCtx.status || 401)
      .json({ error: adminCtx.error || 'Not authorized' });
  }

  const kioskRow = await dbGet(
    'SELECT id, device_id FROM kiosks WHERE id = ? AND org_id = ?',
    [kioskId, adminCtx.orgId]
  );
  if (!kioskRow) return res.status(404).json({ error: 'Kiosk not found.' });

  if (adminCtx.via === 'kiosk') {
    const deviceAccess = await ensureKioskDevice(req);
    if (!deviceAccess.ok || Number(deviceAccess.kiosk.id) !== Number(kioskId)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
  }

  const orgTimezone = await getOrgTimezone(adminCtx.orgId);
  const date = req.query.date || getTodayIsoDate(orgTimezone);

  const shareExistsClause = buildTimesheetShareExistsClause('ks');
    const sql = `
      SELECT
        ks.id,
        ks.project_id,
        ks.date,
        ks.created_at,
        ks.ended_at,
        ks.created_by_employee_id,
        COALESCE(ks.assigned_to_employee_id, ks.created_by_employee_id) AS assigned_to_employee_id,
        0 AS shared_with_all,
        CASE
          WHEN ${shareExistsClause} THEN 1
          ELSE 0
        END AS shared_with_admins,
        ea.name AS created_by_name,
        COALESCE(eb.name, ea.name) AS assigned_to_name,
        p.name AS project_name,
        p.customer_name,
        COALESCE((
          SELECT COUNT(*)
          FROM time_punches tp
          WHERE tp.org_id = ks.org_id
            AND tp.project_id = ks.project_id
            AND tp.clock_in_local_date = ks.date
        ), 0) AS entry_count,
        COALESCE((
          SELECT COUNT(*)
          FROM time_punches tp
          WHERE tp.org_id = ks.org_id
            AND tp.clock_out_ts IS NULL
            AND tp.project_id = ks.project_id
            AND tp.clock_in_local_date = ks.date
        ), 0) AS open_count
        ,
        COALESCE((
          SELECT COUNT(*)
          FROM time_punches tp
          WHERE tp.org_id = ks.org_id
            AND tp.kiosk_session_id = ks.id
        ), 0) AS session_entry_count,
        COALESCE((
          SELECT COUNT(*)
          FROM time_punches tp
          WHERE tp.org_id = ks.org_id
            AND tp.kiosk_session_id = ks.id
            AND tp.clock_out_ts IS NULL
        ), 0) AS session_open_count,
        COALESCE((
          SELECT MIN(tp.clock_in_ts)
          FROM time_punches tp
          WHERE tp.org_id = ks.org_id
            AND tp.kiosk_session_id = ks.id
        ), NULL) AS first_clock_in_ts,
        COALESCE((
          SELECT MAX(tp.clock_out_ts)
          FROM time_punches tp
          WHERE tp.org_id = ks.org_id
            AND tp.kiosk_session_id = ks.id
            AND tp.clock_out_ts IS NOT NULL
        ), NULL) AS last_clock_out_ts,
        COALESCE((
          SELECT COUNT(*)
          FROM time_punches tp
          WHERE tp.org_id = ks.org_id
            AND tp.project_id = ks.project_id
            AND tp.clock_in_local_date = ks.date
            AND (
              (ks.device_id IS NULL AND tp.device_id IS NULL)
              OR tp.device_id = ks.device_id
            )
        ), 0) AS device_entry_count,
        COALESCE((
          SELECT COUNT(*)
          FROM time_punches tp
          WHERE tp.org_id = ks.org_id
            AND tp.clock_out_ts IS NULL
            AND tp.project_id = ks.project_id
            AND tp.clock_in_local_date = ks.date
            AND (
              (ks.device_id IS NULL AND tp.device_id IS NULL)
              OR tp.device_id = ks.device_id
            )
        ), 0) AS device_open_count
      FROM kiosk_sessions ks
      LEFT JOIN kiosks k ON k.id = ks.kiosk_id
      LEFT JOIN projects p ON p.id = ks.project_id
      LEFT JOIN employees ea ON ea.id = ks.created_by_employee_id
      LEFT JOIN employees eb ON eb.id = ks.assigned_to_employee_id
      WHERE ks.org_id = ?
        AND ks.kiosk_id = ?
        AND ks.date = ?
      ORDER BY ks.created_at ASC
    `;

    db.all(sql, [adminCtx.adminId || 0, adminCtx.orgId, kioskId, date], (err2, rows) => {
      if (err2) return res.status(500).json({ error: err2.message });
      const list = rows || [];
      const applyVisibilityFilter = async () => {
        const perms = await getAdminAccessPerms({
          employeeId: adminCtx.adminId,
          orgId: adminCtx.orgId
        });
        const isSuperAdmin = await isEmployeeSuperAdmin({
          employeeId: adminCtx.adminId,
          orgId: adminCtx.orgId
        });
        const canViewAll = canViewAllTimesheets({ perms, isSuperAdmin });
        if (canViewAll) {
          return list;
        }
        return list.filter(session =>
          isTimesheetVisible(session, {
            adminId: adminCtx.adminId,
            perms,
            isSuperAdmin
          })
        );
      };

      applyVisibilityFilter()
        .then(filtered => res.json(filtered))
        .catch(err => {
          console.error('Error filtering kiosk sessions:', err);
          res.status(500).json({ error: 'Failed to load timesheets.' });
        });
    });
});

// Create a new session and optionally make it active on the kiosk
app.post('/api/kiosks/:id/sessions', async (req, res) => {
  const kioskId = parseInt(req.params.id, 10);
  if (!kioskId) {
    return res.status(400).json({ error: 'Invalid kiosk id.' });
  }

  const adminCtx = await resolveKioskAdmin(req);
  if (!adminCtx.ok) {
    return res
      .status(adminCtx.status || 401)
      .json({ error: adminCtx.error || 'Not authorized' });
  }

  const {
    project_id,
    make_active,
    admin_id,
    clock_me_in,
    clock_in_payload,
    lat,
    lng,
    confirm_geo_mismatch
  } = req.body || {};
  if (!project_id) {
    return res.status(400).json({ error: 'project_id is required.' });
  }

  const kioskRow = await dbGet(
    'SELECT id, device_id FROM kiosks WHERE id = ? AND org_id = ?',
    [kioskId, adminCtx.orgId]
  );
  if (!kioskRow) return res.status(404).json({ error: 'Kiosk not found.' });

  if (adminCtx.via === 'kiosk') {
    const deviceAccess = await ensureKioskDevice(req);
    if (!deviceAccess.ok || Number(deviceAccess.kiosk.id) !== Number(kioskId)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
  }

  const orgTimezone = await getOrgTimezone(adminCtx.orgId);
  const today = getTodayIsoDate(orgTimezone);

  const existingSession = await dbGet(
    `
      SELECT id
      FROM kiosk_sessions
      WHERE org_id = ?
        AND kiosk_id = ?
        AND date = ?
        AND project_id = ?
        AND ended_at IS NULL
      LIMIT 1
    `,
    [adminCtx.orgId, kioskId, today, project_id]
  );
  if (existingSession && existingSession.id) {
    return res.status(409).json({
      error: 'A timesheet for this project is already open on this kiosk today.',
      existing_session_id: existingSession.id
    });
  }

  const creatorId =
    admin_id ||
    adminCtx.adminId ||
    (req.session && req.session.employeeId) ||
    null;

  if (clock_me_in) {
    if (!creatorId) {
      return res.status(400).json({ error: 'admin_id is required for clock_me_in.' });
    }
    const openPunch = await dbGet(
      `
        SELECT id
        FROM time_punches
        WHERE org_id = ? AND employee_id = ? AND clock_out_ts IS NULL
        LIMIT 1
      `,
      [adminCtx.orgId, creatorId]
    );
    if (openPunch) {
      return res.status(409).json({ error: 'Admin already clocked in.' });
    }
    const payload = clock_in_payload || {};
    const photoRequired = await getClockInPhotoRequired(adminCtx.orgId);
    if (photoRequired && !payload.photo_base64) {
      return res.status(400).json({ error: 'Photo is required to clock in.' });
    }
  }

  const hasLatInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'lat');
  const hasLngInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'lng');
  const confirmGeoMismatch =
    confirm_geo_mismatch === true ||
    confirm_geo_mismatch === 'true' ||
    confirm_geo_mismatch === 1 ||
    confirm_geo_mismatch === '1';
  const latInput =
    !hasLatInput || lat === '' || lat === null || lat === undefined
      ? null
      : Number(lat);
  const lngInput =
    !hasLngInput || lng === '' || lng === null || lng === undefined
      ? null
      : Number(lng);

  if ((latInput === null) !== (lngInput === null)) {
    return res.status(400).json({ error: 'Please provide both latitude and longitude, or leave both blank.' });
  }
  if (latInput !== null && (Number.isNaN(latInput) || latInput < -90 || latInput > 90)) {
    return res.status(400).json({ error: 'Invalid latitude.' });
  }
  if (lngInput !== null && (Number.isNaN(lngInput) || lngInput < -180 || lngInput > 180)) {
    return res.status(400).json({ error: 'Invalid longitude.' });
  }

  let sessionGeoDistance = null;
  let sessionGeoViolation = 0;
  const sessionGeoLat = latInput;
  const sessionGeoLng = lngInput;

  const projectRow = await dbGet(
    'SELECT geo_lat, geo_lng, geo_radius, name, customer_name FROM projects WHERE id = ? AND org_id = ?',
    [project_id, adminCtx.orgId]
  );
  if (!projectRow) {
    return res.status(404).json({ error: 'Project not found.' });
  }

  const existingOpenSession = await dbGet(
    `
      SELECT id
      FROM kiosk_sessions
      WHERE org_id = ?
        AND kiosk_id = ?
        AND date = ?
        AND project_id = ?
        AND ended_at IS NULL
      LIMIT 1
    `,
    [adminCtx.orgId, kioskId, today, project_id]
  );
  if (existingOpenSession) {
    return res.status(409).json({
      error: 'A timesheet for this project is already open on this tablet.',
      existing_session_id: existingOpenSession.id
    });
  }

  const hasProjectGeofence =
    projectRow.geo_lat != null &&
    projectRow.geo_lng != null &&
    projectRow.geo_radius != null &&
    !Number.isNaN(Number(projectRow.geo_lat)) &&
    !Number.isNaN(Number(projectRow.geo_lng)) &&
    !Number.isNaN(Number(projectRow.geo_radius));

  if (hasProjectGeofence && sessionGeoLat != null && sessionGeoLng != null) {
    const projLat = Number(projectRow.geo_lat);
    const projLng = Number(projectRow.geo_lng);
    const radiusNum = Number(projectRow.geo_radius);
    const dist = distanceMeters(sessionGeoLat, sessionGeoLng, projLat, projLng);
    sessionGeoDistance = dist;
    if (dist > radiusNum) {
      if (!confirmGeoMismatch) {
        const projectLabel =
          projectRow.customer_name && projectRow.name
            ? `${projectRow.customer_name} – ${projectRow.name}`
            : projectRow.name || `Project ${project_id}`;
        return res.status(409).json({
          error: 'Kiosk appears outside the project geofence. Confirm to proceed.',
          geofence_mismatch: true,
          project_name: projectLabel,
          geo_distance_m: dist,
          geo_radius_m: radiusNum
        });
      }
      sessionGeoViolation = 1;
    }
  }

  const countRow = await dbGet(
    'SELECT COUNT(*) AS cnt FROM kiosk_sessions WHERE org_id = ? AND kiosk_id = ? AND date = ?',
    [adminCtx.orgId, kioskId, today]
  );
  const isFirstToday = (countRow && Number(countRow.cnt)) === 0;

  const insertRes = await dbRun(
    `
      INSERT INTO kiosk_sessions
        (org_id, kiosk_id, device_id, project_id, date, created_by_employee_id, assigned_to_employee_id,
         geo_lat, geo_lng, geo_distance_m, geo_violation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      adminCtx.orgId,
      kioskId,
      kioskRow.device_id || null,
      project_id,
      today,
      creatorId,
      creatorId,
      sessionGeoLat,
      sessionGeoLng,
      sessionGeoDistance,
      sessionGeoViolation
    ]
  );

  const sessionId = insertRes.lastID;

  if (make_active) {
    await dbRun('UPDATE kiosks SET project_id = ? WHERE id = ? AND org_id = ?', [
      project_id,
      kioskId,
      adminCtx.orgId
    ]);
  }

  const session = await dbGet(
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
      WHERE ks.id = ? AND ks.org_id = ?
    `,
    [sessionId, adminCtx.orgId]
  );

  let clockedIn = false;
  let punchId = null;

  if (clock_me_in) {
    const payload = clock_in_payload || {};
    const punchLat = payload.lat != null ? payload.lat : sessionGeoLat;
    const punchLng = payload.lng != null ? payload.lng : sessionGeoLng;
    const clientId = payload.client_id || `start_${sessionId}_${Date.now()}`;
    const punchTime = payload.device_timestamp || new Date().toISOString();
    const clockInLocalDate = getIsoDateInTimezone(punchTime, orgTimezone);

    let geoDistance = null;
    let geoViolation = 0;
    let geoRadius = null;

    if (punchLat != null && punchLng != null) {
      const project = await dbGet(
        'SELECT geo_lat, geo_lng, geo_radius FROM projects WHERE id = ? AND org_id = ?',
        [project_id, adminCtx.orgId]
      );
      if (
        project &&
        project.geo_lat != null &&
        project.geo_lng != null &&
        project.geo_radius != null
      ) {
        const latNum = Number(punchLat);
        const lngNum = Number(punchLng);
        const projLat = Number(project.geo_lat);
        const projLng = Number(project.geo_lng);
        const radiusNum = Number(project.geo_radius);
        if (
          !Number.isNaN(latNum) &&
          !Number.isNaN(lngNum) &&
          !Number.isNaN(projLat) &&
          !Number.isNaN(projLng) &&
          !Number.isNaN(radiusNum)
        ) {
          geoRadius = radiusNum;
          const dist = distanceMeters(latNum, lngNum, projLat, projLng);
          geoDistance = dist;
          if (dist > radiusNum) geoViolation = 1;
        }
      }
    }

    let foremanId = null;
    try {
      foremanId = await getTodayForemanForDeviceAsync(
        kioskRow.device_id,
        creatorId,
        today
      );
    } catch (err) {
      console.error('Error looking up foreman for device:', err);
    }

    let clockInPhotoPath = null;
    if (payload.photo_base64) {
      try {
        clockInPhotoPath = await saveClockInPhoto({
          orgId: adminCtx.orgId,
          employeeId: creatorId,
          deviceId: kioskRow.device_id,
          photoBase64: payload.photo_base64,
          punchTime
        });
      } catch (err) {
        console.error('Error saving clock-in photo:', err);
      }
    }

    const punchRes = await dbRun(
      `
        INSERT INTO time_punches
          (org_id,
           client_id,
           employee_id,
           project_id,
           clock_in_ts,
           clock_in_local_date,
           clock_in_lat,
           clock_in_lng,
           clock_in_photo_path,
           device_id,
           kiosk_session_id,
           foreman_employee_id,
           geo_distance_m,
           geo_violation,
           employee_name_snapshot,
           project_name_snapshot)
        VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          (SELECT name FROM employees WHERE id = ? AND org_id = ?),
          (SELECT name FROM projects  WHERE id = ? AND org_id = ?)
        )
      `,
      [
        adminCtx.orgId,
        clientId,
        creatorId,
        project_id,
        punchTime,
        clockInLocalDate,
        punchLat ?? null,
        punchLng ?? null,
        clockInPhotoPath,
        kioskRow.device_id || null,
        sessionId || null,
        foremanId || null,
        geoDistance,
        geoViolation,
        creatorId,
        adminCtx.orgId,
        project_id,
        adminCtx.orgId
      ]
    );

    clockedIn = true;
    punchId = punchRes.lastID;
  }

  await logAuditEvent({
    req,
    orgId: adminCtx.orgId,
    action: 'kiosk.session.create',
    entityType: 'kiosk_session',
    entityId: sessionId,
    actorEmployeeId: creatorId || adminCtx.adminId || null,
    after: {
      kiosk_id: kioskId,
      project_id,
      date: today,
      make_active: !!make_active,
      clocked_in: clockedIn ? 1 : 0,
      punch_id: punchId
    }
  });

  res.json({
    ok: true,
    session,
    active_session_id: make_active ? sessionId : null,
    active_project_id: make_active ? Number(project_id) : null,
    first_session_today: isFirstToday,
    clocked_in: clockedIn,
    punch_id: punchId
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

    const adminCtx = await resolveKioskAdmin(req);
    if (!adminCtx.ok) {
      return res
        .status(adminCtx.status || 401)
        .json({ error: adminCtx.error || 'Not authorized' });
    }

    if (adminCtx.via === 'kiosk') {
      const deviceAccess = await ensureKioskDevice(req);
      if (!deviceAccess.ok || Number(deviceAccess.kiosk.id) !== Number(kioskId)) {
        return res.status(403).json({ error: 'Not authorized' });
      }
    }

    const adminId = req.body && req.body.admin_id ? Number(req.body.admin_id) : null;
    const pin = (req.body && req.body.pin ? String(req.body.pin) : '').trim();
    if (!adminId) {
      return res.status(400).json({ error: 'Admin id is required.' });
    }

    const admin = await dbGet(
      `
        SELECT id, name, pin_hash, kiosk_admin_access
        FROM employees
        WHERE id = ? AND org_id = ? AND IFNULL(kiosk_admin_access, 0) = 1
        LIMIT 1
      `,
      [adminId, adminCtx.orgId]
    );
    if (!admin) {
      return res.status(403).json({ error: 'Admin not authorized.' });
    }

    if (!admin.pin_hash) {
      return res.status(403).json({ error: 'No PIN set for this admin.' });
    }

    const pinOk = await bcrypt.compare(pin, admin.pin_hash);
    if (!pinOk) {
      return res.status(401).json({ error: 'Incorrect PIN.' });
    }

    const sessionRow = await dbGet(
      `
        SELECT id, kiosk_id, device_id, project_id, date
        FROM kiosk_sessions
        WHERE id = ? AND kiosk_id = ? AND org_id = ?
        LIMIT 1
      `,
      [sessionId, kioskId, adminCtx.orgId]
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
        WHERE tp.org_id = ?
          AND tp.kiosk_session_id = ?
      `,
      [
        adminCtx.orgId,
        sessionRow.id
      ]
    );

    const entryCount = counts && counts.entry_count ? Number(counts.entry_count) : 0;
    const openCount = counts && counts.open_count ? Number(counts.open_count) : 0;
    const perms = await getAdminAccessPerms({
      employeeId: admin.id,
      orgId: adminCtx.orgId
    });

    if (openCount > 0) {
      return res.status(409).json({
        error: 'Cannot delete a timesheet that has time entries.'
      });
    }

    if (entryCount > 0) {
      return res.status(409).json({
        error: 'Cannot delete a timesheet with time entries.'
      });
    }

    const delRes = await dbRun(
      'DELETE FROM kiosk_sessions WHERE id = ? AND kiosk_id = ? AND org_id = ?',
      [sessionId, kioskId, adminCtx.orgId]
    );
    if (!delRes || delRes.changes === 0) {
      return res.status(404).json({ error: 'Timesheet already removed.' });
    }

    // If this session was active for the kiosk, clear the project unless another session for it exists today
    const kioskRow = await dbGet(
      'SELECT project_id FROM kiosks WHERE id = ? AND org_id = ?',
      [kioskId, adminCtx.orgId]
    );
    if (kioskRow && kioskRow.project_id && Number(kioskRow.project_id) === Number(sessionRow.project_id)) {
      const other = await dbGet(
        `
          SELECT id
          FROM kiosk_sessions
          WHERE org_id = ?
            AND kiosk_id = ?
            AND date = ?
            AND project_id = ?
            AND id != ?
          LIMIT 1
        `,
        [adminCtx.orgId, kioskId, sessionRow.date, sessionRow.project_id, sessionId]
      );
      if (!other) {
        await dbRun('UPDATE kiosks SET project_id = NULL WHERE id = ? AND org_id = ?', [
          kioskId,
          adminCtx.orgId
        ]);
      }
    }

    await logAuditEvent({
      orgId: adminCtx.orgId,
      action: 'kiosk.session.delete',
      entityType: 'kiosk_session',
      entityId: sessionId,
      actorEmployeeId: admin.id,
      actorName: admin.name || null,
      before: {
        kiosk_id: sessionRow.kiosk_id,
        project_id: sessionRow.project_id,
        date: sessionRow.date
      },
      note: `Timesheet deleted (entry_count=${entryCount}).`
    });

    res.json({ ok: true, entry_count: entryCount });
  } catch (err) {
    console.error('Error deleting kiosk session:', err);
    res.status(500).json({ error: 'Failed to delete timesheet.' });
  }
});

// Set the active session (updates kiosk.project_id to that session’s project)
app.post('/api/kiosks/:id/active-session', async (req, res) => {
  const kioskId = parseInt(req.params.id, 10);
  if (!kioskId) {
    return res.status(400).json({ error: 'Invalid kiosk id.' });
  }

  const adminCtx = await resolveKioskAdmin(req);
  if (!adminCtx.ok) {
    return res
      .status(adminCtx.status || 401)
      .json({ error: adminCtx.error || 'Not authorized' });
  }

  if (adminCtx.via === 'kiosk') {
    const deviceAccess = await ensureKioskDevice(req);
    if (!deviceAccess.ok || Number(deviceAccess.kiosk.id) !== Number(kioskId)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
  }

  const { session_id } = req.body || {};
  if (!session_id) {
    return res.status(400).json({ error: 'session_id is required.' });
  }

  try {
    const session = await dbGet(
      `
        SELECT ks.project_id,
               ks.ended_at
        FROM kiosk_sessions ks
        WHERE ks.id = ?
          AND ks.kiosk_id = ?
          AND ks.org_id = ?
        LIMIT 1
      `,
      [session_id, kioskId, adminCtx.orgId]
    );
    if (!session) {
      return res.status(404).json({ error: 'Session not found for this kiosk.' });
    }
    if (session.ended_at) {
      return res.status(409).json({ error: 'Timesheet is already closed.' });
    }

    await dbRun(
      `UPDATE kiosks SET project_id = ? WHERE id = ? AND org_id = ?`,
      [session.project_id, kioskId, adminCtx.orgId]
    );

    await logAuditEvent({
      orgId: adminCtx.orgId,
      action: 'kiosk.session.activate',
      entityType: 'kiosk',
      entityId: kioskId,
      actorEmployeeId: adminCtx.adminId || null,
      after: {
        session_id,
        project_id: session.project_id
      }
    });

    return res.json({ ok: true, project_id: session.project_id });
  } catch (err) {
    console.error('Error setting active kiosk session:', err);
    return res.status(500).json({ error: 'Failed to set active session.' });
  }
});

async function isEmployeeSuperAdmin({ employeeId, orgId }) {
  if (!employeeId || !orgId) return false;
  const row = await dbGet(
    `
      SELECT is_super_admin, login_enabled
      FROM user_orgs
      WHERE org_id = ? AND employee_id = ?
      LIMIT 1
    `,
    [orgId, employeeId]
  );
  return !!(row && isTruthyFlag(row.is_super_admin) && isTruthyFlag(row.login_enabled));
}

async function isSessionSuperAdmin(req, orgId) {
  if (!req || !req.session || !orgId) return false;
  if (isTruthyFlag(req.session.isSuperAdmin)) return true;
  const userId = req.session.userId;
  if (!userId) return false;
  const row = await dbGet(
    `
      SELECT is_super_admin, login_enabled
      FROM user_orgs
      WHERE user_id = ? AND org_id = ?
      LIMIT 1
    `,
    [userId, orgId]
  );
  return !!(row && isTruthyFlag(row.is_super_admin) && isTruthyFlag(row.login_enabled));
}

function canViewAllTimesheets({ perms, isSuperAdmin }) {
  return (
    !!isSuperAdmin ||
    !!(perms && (isTruthyFlag(perms.view_payroll) || isTruthyFlag(perms.view_all_timesheets)))
  );
}

const SUPER_ADMIN_PERM_KEYS = [
  'see_shipments',
  'modify_time',
  'approve_time',
  'view_time_reports',
  'view_all_timesheets',
  'assign_timesheets',
  'view_payroll',
  'modify_payroll',
  'modify_pay_rates'
];

function getSuperAdminPerms() {
  return {
    see_shipments: 1,
    modify_time: 1,
    approve_time: 1,
    view_time_reports: 1,
    view_all_timesheets: 1,
    assign_timesheets: 1,
    view_payroll: 1,
    modify_payroll: 1,
    modify_pay_rates: 1
  };
}

function applySuperAdminPermsToRow(row) {
  if (!row) return;
  SUPER_ADMIN_PERM_KEYS.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      row[key] = 1;
    }
  });
}

async function ensureSuperAdminPerms({ orgId, employeeId }) {
  if (!orgId || !employeeId) return;
  const perms = getSuperAdminPerms();
  await dbRun(
    `
      INSERT INTO employee_permissions (
        employee_id,
        see_shipments,
        modify_time,
        approve_time,
        view_time_reports,
        view_all_timesheets,
        assign_timesheets,
        view_payroll,
        modify_payroll,
        modify_pay_rates
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(employee_id) DO UPDATE SET
        see_shipments = excluded.see_shipments,
        modify_time = excluded.modify_time,
        approve_time = excluded.approve_time,
        view_time_reports = excluded.view_time_reports,
        view_all_timesheets = excluded.view_all_timesheets,
        assign_timesheets = excluded.assign_timesheets,
        view_payroll = excluded.view_payroll,
        modify_payroll = excluded.modify_payroll,
        modify_pay_rates = excluded.modify_pay_rates
    `,
    [
      employeeId,
      perms.see_shipments,
      perms.modify_time,
      perms.approve_time,
      perms.view_time_reports,
      perms.view_all_timesheets,
      perms.assign_timesheets,
      perms.view_payroll,
      perms.modify_payroll,
      perms.modify_pay_rates
    ]
  );
}

function buildTimesheetShareExistsClause(sessionAlias = 'ks') {
  return `
    EXISTS (
      SELECT 1
      FROM kiosk_session_shares kss
      WHERE kss.org_id = ${sessionAlias}.org_id
        AND kss.kiosk_session_id = ${sessionAlias}.id
        AND kss.employee_id = ?
    )
  `;
}

function buildTimeEntryVisibilityFilter({ adminId, perms, isSuperAdmin, entryAlias = 't' }) {
  if (canViewAllTimesheets({ perms, isSuperAdmin })) {
    return { clause: '', params: [] };
  }
  if (!adminId) {
    return { clause: '1 = 0', params: [] };
  }
  const shareExistsClause = buildTimesheetShareExistsClause('ksv');
  return {
    clause: `
      (
        EXISTS (
          SELECT 1
          FROM time_punches tpv
          LEFT JOIN kiosk_sessions ksv
            ON ksv.id = tpv.kiosk_session_id
           AND ksv.org_id = tpv.org_id
          WHERE tpv.org_id = ${entryAlias}.org_id
            AND tpv.time_entry_id = ${entryAlias}.id
            AND ksv.id IS NOT NULL
            AND (
              ${shareExistsClause}
              OR ksv.assigned_to_employee_id = ?
              OR ksv.created_by_employee_id = ?
              OR ksv.created_by_employee_id IS NULL
            )
        )
        OR (
          NOT EXISTS (
            SELECT 1
            FROM time_punches tpm
            WHERE tpm.org_id = ${entryAlias}.org_id
              AND tpm.time_entry_id = ${entryAlias}.id
          )
          AND EXISTS (
            SELECT 1
            FROM time_exception_actions tea
            WHERE tea.org_id = ${entryAlias}.org_id
              AND tea.source_type = 'time_entry'
              AND tea.source_id = ${entryAlias}.id
              AND tea.action = 'create'
              AND tea.actor_employee_id = ?
          )
        )
      )
    `,
    params: [adminId, adminId, adminId, adminId]
  };
}

function buildTimePunchVisibilityFilter({
  adminId,
  perms,
  isSuperAdmin,
  punchAlias = 'tp',
  sessionAlias = 'ks'
}) {
  if (canViewAllTimesheets({ perms, isSuperAdmin })) {
    return { clause: '', params: [] };
  }
  if (!adminId) {
    return { clause: '1 = 0', params: [] };
  }
  const shareExistsClause = buildTimesheetShareExistsClause(sessionAlias);
  return {
    clause: `
      ${punchAlias}.kiosk_session_id IS NOT NULL
      AND (
        ${shareExistsClause}
        OR ${sessionAlias}.assigned_to_employee_id = ?
        OR ${sessionAlias}.created_by_employee_id = ?
        OR ${sessionAlias}.created_by_employee_id IS NULL
      )
    `,
    params: [adminId, adminId, adminId]
  };
}

async function isTimeEntryVisibleForAdmin({
  orgId,
  entryId,
  adminId,
  perms,
  isSuperAdmin
}) {
  if (canViewAllTimesheets({ perms, isSuperAdmin })) return true;
  if (!orgId || !entryId || !adminId) return false;
  const row = await dbGet(
    `
      SELECT 1
      WHERE (
        EXISTS (
          SELECT 1
          FROM time_punches tp
          LEFT JOIN kiosk_sessions ks
            ON ks.id = tp.kiosk_session_id
           AND ks.org_id = tp.org_id
          WHERE tp.org_id = ?
            AND tp.time_entry_id = ?
            AND ks.id IS NOT NULL
            AND (
              ${buildTimesheetShareExistsClause('ks')}
              OR ks.assigned_to_employee_id = ?
              OR ks.created_by_employee_id = ?
              OR ks.created_by_employee_id IS NULL
            )
        )
        OR (
          NOT EXISTS (
            SELECT 1
            FROM time_punches tpm
            WHERE tpm.org_id = ?
              AND tpm.time_entry_id = ?
          )
          AND EXISTS (
            SELECT 1
            FROM time_exception_actions tea
            WHERE tea.org_id = ?
              AND tea.source_type = 'time_entry'
              AND tea.source_id = ?
              AND tea.action = 'create'
              AND tea.actor_employee_id = ?
          )
        )
      )
      LIMIT 1
    `,
    [orgId, entryId, adminId, adminId, adminId, orgId, entryId, orgId, entryId, adminId]
  );
  return !!row;
}

async function isTimePunchVisibleForAdmin({
  orgId,
  punchId,
  adminId,
  perms,
  isSuperAdmin
}) {
  if (canViewAllTimesheets({ perms, isSuperAdmin })) return true;
  if (!orgId || !punchId || !adminId) return false;
  const row = await dbGet(
    `
      SELECT 1
      FROM time_punches tp
      LEFT JOIN kiosk_sessions ks
        ON ks.id = tp.kiosk_session_id
       AND ks.org_id = tp.org_id
      WHERE tp.org_id = ?
        AND tp.id = ?
        AND ks.id IS NOT NULL
        AND (
          ${buildTimesheetShareExistsClause('ks')}
          OR ks.assigned_to_employee_id = ?
          OR ks.created_by_employee_id = ?
          OR ks.created_by_employee_id IS NULL
        )
      LIMIT 1
    `,
    [orgId, punchId, adminId, adminId, adminId]
  );
  return !!row;
}

function isTimesheetVisible(session, { adminId, perms, isSuperAdmin }) {
  if (!session) return false;
  if (canViewAllTimesheets({ perms, isSuperAdmin })) return true;
  if (adminId && Array.isArray(session.shared_admin_ids)) {
    if (session.shared_admin_ids.some(id => Number(id) === Number(adminId))) return true;
  }
  if (adminId && Array.isArray(session.shared_admins)) {
    if (session.shared_admins.some(admin => Number(admin.id) === Number(adminId))) return true;
  }
  if (adminId && session.assigned_to_employee_id != null && Number(session.assigned_to_employee_id) === Number(adminId)) return true;
  if (session.created_by_employee_id == null) return true; // legacy sessions without creator
  if (adminId && Number(session.created_by_employee_id) === Number(adminId)) return true;
  return false;
}

async function resolveTimesheetAccess(req) {
  const status = await requireActiveDesktopSession(req);
  if (!status.ok) {
    return { ok: false, status: status.status || 403, error: status.error || 'Org access denied.' };
  }
  const orgId = status.orgId;
  const employeeId = status.employeeId;
  const perms = await getAdminAccessPerms({ employeeId, orgId });
  const isSuperAdmin = await isSessionSuperAdmin(req, orgId);
  return { ok: true, orgId, employeeId, perms, isSuperAdmin };
}

async function resolveTimesheetAssignAccess(req) {
  if (req.session && req.session.userId) {
    const status = await requireActiveDesktopSession(req);
    if (!status.ok) {
      return { ok: false, status: status.status || 403, error: status.error || 'Org access denied.' };
    }
    const orgId = status.orgId;
    const employeeId = status.employeeId;
    const perms = await getAdminAccessPerms({ employeeId, orgId });
    const isSuperAdmin = await isSessionSuperAdmin(req, orgId);
    const canAssign = isSuperAdmin || isTruthyFlag(perms.assign_timesheets);
    if (!canAssign) {
      return { ok: false, status: 403, error: 'Assign timesheets permission required.' };
    }
    return { ok: true, orgId, employeeId, perms, isSuperAdmin, via: 'session' };
  }

  const kioskCtx = await resolveKioskAdmin(req);
  if (!kioskCtx.ok) {
    return { ok: false, status: kioskCtx.status || 403, error: kioskCtx.error || 'Not authorized' };
  }
  const orgId = kioskCtx.orgId;
  const employeeId = kioskCtx.adminId;
  const perms = await getAdminAccessPerms({ employeeId, orgId });
  const isSuperAdmin = await isEmployeeSuperAdmin({ employeeId, orgId });
  const canAssign = isSuperAdmin || isTruthyFlag(perms.assign_timesheets);
  if (!canAssign) {
    return { ok: false, status: 403, error: 'Assign timesheets permission required.' };
  }
  return { ok: true, orgId, employeeId, perms, isSuperAdmin, via: kioskCtx.via };
}

// List all sessions for today across kiosks (admin console)
app.get('/api/kiosk-sessions/today', async (req, res) => {
  const access = await resolveTimesheetAccess(req);
  if (!access.ok) {
    return res.status(access.status || 403).json({ error: access.error || 'Not authorized' });
  }
  const orgId = access.orgId;
  const orgTimezone = await getOrgTimezone(orgId);
  const dateParam = req.query && req.query.date ? String(req.query.date).trim() : '';
  let date = getTodayIsoDate(orgTimezone);
  if (dateParam) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam) || !toDateOnly(dateParam)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD.' });
    }
    date = dateParam;
  }

  const shareExistsClause = buildTimesheetShareExistsClause('ks');
  const sessionsSql = `
    SELECT
      ks.id,
      ks.kiosk_id,
      ks.project_id,
      ks.device_id,
      ks.date,
      ks.created_at,
      ks.ended_at,
      ks.created_by_employee_id,
      COALESCE(ks.assigned_to_employee_id, ks.created_by_employee_id) AS assigned_to_employee_id,
      0 AS shared_with_all,
      CASE
        WHEN ${shareExistsClause} THEN 1
        ELSE 0
      END AS shared_with_admins,
      k.name AS kiosk_name,
      k.location AS kiosk_location,
      k.device_id AS kiosk_device_id,
      p.name AS project_name,
      p.customer_name,
      ea.name AS started_by_name,
      COALESCE(eb.name, ea.name) AS assigned_to_name
    FROM kiosk_sessions ks
    LEFT JOIN kiosks k ON k.id = ks.kiosk_id
    LEFT JOIN projects p ON p.id = ks.project_id
    LEFT JOIN employees ea ON ea.id = ks.created_by_employee_id
    LEFT JOIN employees eb ON eb.id = ks.assigned_to_employee_id
    WHERE ks.org_id = ?
      AND ks.date = ?
    ORDER BY k.name, ks.created_at
  `;

  try {
    const sessions = await dbAll(
      sessionsSql,
      [access.employeeId || 0, orgId, date]
    );
    const list = sessions || [];
    const canViewAll = canViewAllTimesheets({
      perms: access.perms,
      isSuperAdmin: access.isSuperAdmin
    });
    const filtered = canViewAll
      ? list
      : list.filter(session =>
          isTimesheetVisible(session, {
            adminId: access.employeeId,
            perms: access.perms,
            isSuperAdmin: access.isSuperAdmin
          })
        );

    const shareMap = new Map();
    const sessionIds = filtered.map(session => session.id).filter(Boolean);
    if (sessionIds.length) {
      const placeholders = sessionIds.map(() => '?').join(',');
      const shareRows = await dbAll(
        `
          SELECT
            kss.kiosk_session_id AS session_id,
            e.id,
            e.name
          FROM kiosk_session_shares kss
          JOIN employees e ON e.id = kss.employee_id
          WHERE kss.org_id = ?
            AND kss.kiosk_session_id IN (${placeholders})
          ORDER BY e.name COLLATE NOCASE
        `,
        [orgId, ...sessionIds]
      );
      (shareRows || []).forEach(row => {
        if (!shareMap.has(row.session_id)) shareMap.set(row.session_id, []);
        shareMap.get(row.session_id).push({ id: row.id, name: row.name });
      });
    }

    filtered.forEach(session => {
      session.shared_admins = shareMap.get(session.id) || [];
    });

    // Grab all open punches for the selected date and attach to matching sessions
    const punchesSql = `
      SELECT
        tp.id,
        tp.employee_id,
        tp.project_id,
        tp.device_id,
        tp.clock_in_ts,
        COALESCE(e.name, tp.employee_name_snapshot) AS employee_name,
        k.id AS kiosk_id
      FROM time_punches tp
      JOIN kiosks k ON k.device_id = tp.device_id
      LEFT JOIN employees e ON e.id = tp.employee_id
      WHERE tp.org_id = ?
        AND tp.clock_out_ts IS NULL
        AND tp.clock_in_local_date = ?
    `;

    const punches = await dbAll(punchesSql, [orgId, date]);
    const byKey = new Map();
    filtered.forEach(s => {
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

    return res.json(filtered);
  } catch (err) {
    console.error('Error loading timesheets:', err);
    return res.status(500).json({ error: 'Failed to load timesheets.' });
  }
});

// List assignable admins for timesheet assignment
app.get('/api/kiosk-sessions/assignees', async (req, res) => {
  const access = await resolveTimesheetAssignAccess(req);
  if (!access.ok) {
    return res.status(access.status || 403).json({ error: access.error || 'Not authorized' });
  }
  const orgId = access.orgId;
  try {
    const rows = await dbAll(
      `
        SELECT e.id, e.name
        FROM employees e
        WHERE e.org_id = ?
          AND IFNULL(e.active, 1) = 1
          AND (IFNULL(e.desktop_access, 0) = 1 OR IFNULL(e.kiosk_admin_access, 0) = 1)
        ORDER BY e.name COLLATE NOCASE
      `,
      [orgId]
    );
    return res.json({ admins: rows || [] });
  } catch (err) {
    console.error('Error loading timesheet assignees:', err);
    return res.status(500).json({ error: 'Failed to load assignees.' });
  }
});

// List shareable admins for timesheet sharing (super admin only)
app.get('/api/kiosk-sessions/shareable-admins', async (req, res) => {
  const access = await resolveTimesheetAssignAccess(req);
  if (!access.ok) {
    return res.status(access.status || 403).json({ error: access.error || 'Not authorized' });
  }
  if (!access.isSuperAdmin) {
    return res.status(403).json({ error: 'Super admin privileges required.' });
  }
  const orgId = access.orgId;
  try {
    const rows = await dbAll(
      `
        SELECT e.id, e.name
        FROM employees e
        WHERE e.org_id = ?
          AND IFNULL(e.active, 1) = 1
          AND (IFNULL(e.desktop_access, 0) = 1 OR IFNULL(e.kiosk_admin_access, 0) = 1)
        ORDER BY e.name COLLATE NOCASE
      `,
      [orgId]
    );
    return res.json({ admins: rows || [] });
  } catch (err) {
    console.error('Error loading shareable admins:', err);
    return res.status(500).json({ error: 'Failed to load shareable admins.' });
  }
});

// Assign/unassign a timesheet to a specific admin
app.post('/api/kiosk-sessions/:id/assign', async (req, res) => {
  const access = await resolveTimesheetAssignAccess(req);
  if (!access.ok) {
    return res.status(access.status || 403).json({ error: access.error || 'Not authorized' });
  }
  const orgId = access.orgId;
  const sessionId = Number(req.params.id);
  if (!sessionId) {
    return res.status(400).json({ error: 'Invalid timesheet id.' });
  }

  const raw = req.body && Object.prototype.hasOwnProperty.call(req.body, 'assigned_to_employee_id')
    ? req.body.assigned_to_employee_id
    : null;
  if (raw === null || raw === '' || raw === undefined) {
    return res.status(400).json({ error: 'assigned_to_employee_id is required.' });
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return res.status(400).json({ error: 'assigned_to_employee_id must be a valid id.' });
  }
  const assignedToId = parsed;

  try {
    const session = await dbGet(
      'SELECT id, ended_at FROM kiosk_sessions WHERE id = ? AND org_id = ? LIMIT 1',
      [sessionId, orgId]
    );
    if (!session) {
      return res.status(404).json({ error: 'Timesheet not found.' });
    }
    if (session.ended_at) {
      return res.status(409).json({ error: 'Timesheet is closed.' });
    }

    let assignedName = null;
    if (assignedToId) {
      const admin = await dbGet(
        `
          SELECT e.id, e.name
          FROM employees e
          WHERE e.id = ? AND e.org_id = ?
            AND IFNULL(e.active, 1) = 1
            AND (IFNULL(e.desktop_access, 0) = 1 OR IFNULL(e.kiosk_admin_access, 0) = 1)
          LIMIT 1
        `,
        [assignedToId, orgId]
      );
      if (!admin) {
        return res.status(404).json({ error: 'Assigned admin not found.' });
      }
      assignedName = admin.name || null;
    }

    await dbRun(
      'UPDATE kiosk_sessions SET assigned_to_employee_id = ? WHERE id = ? AND org_id = ?',
      [assignedToId, sessionId, orgId]
    );

    await logAuditEvent({
      orgId,
      action: 'kiosk.session.assign',
      entityType: 'kiosk_session',
      entityId: sessionId,
      actorEmployeeId: access.employeeId || null,
      after: {
        assigned_to_employee_id: assignedToId,
        assigned_to_name: assignedName
      }
    });

    return res.json({
      ok: true,
      assigned_to_employee_id: assignedToId,
      assigned_to_name: assignedName
    });
  } catch (err) {
    console.error('Error assigning timesheet:', err);
    return res.status(500).json({ error: 'Failed to assign timesheet.' });
  }
});

// Super admins can share a timesheet with specific admins
app.post('/api/kiosk-sessions/:id/share', async (req, res) => {
  const access = await resolveTimesheetAssignAccess(req);
  if (!access.ok) {
    return res.status(access.status || 403).json({ error: access.error || 'Not authorized' });
  }
  if (!access.isSuperAdmin) {
    return res.status(403).json({ error: 'Super admin privileges required.' });
  }

  const sessionId = Number(req.params.id);
  if (!sessionId) {
    return res.status(400).json({ error: 'Invalid timesheet id.' });
  }

  const rawList = req.body && req.body.shared_with_employee_ids;
  if (!Array.isArray(rawList)) {
    return res.status(400).json({ error: 'shared_with_employee_ids must be an array.' });
  }

  const orgId = access.orgId;
  const nextIds = Array.from(
    new Set(
      rawList
        .map(value => Number(value))
        .filter(value => Number.isFinite(value) && value > 0)
    )
  );

  try {
    const existing = await dbGet(
      'SELECT id, ended_at FROM kiosk_sessions WHERE id = ? AND org_id = ? LIMIT 1',
      [sessionId, orgId]
    );
    if (!existing) {
      return res.status(404).json({ error: 'Timesheet not found.' });
    }
    if (existing.ended_at) {
      return res.status(409).json({ error: 'Timesheet is closed.' });
    }

    let validAdmins = [];
    if (nextIds.length) {
      const placeholders = nextIds.map(() => '?').join(',');
      validAdmins = await dbAll(
        `
          SELECT e.id, e.name
          FROM employees e
          WHERE e.org_id = ?
            AND e.id IN (${placeholders})
            AND IFNULL(e.active, 1) = 1
            AND (IFNULL(e.desktop_access, 0) = 1 OR IFNULL(e.kiosk_admin_access, 0) = 1)
          ORDER BY e.name COLLATE NOCASE
        `,
        [orgId, ...nextIds]
      );
    }

    const validIds = new Set((validAdmins || []).map(row => Number(row.id)));
    const invalid = nextIds.filter(id => !validIds.has(Number(id)));
    if (invalid.length) {
      return res.status(400).json({ error: 'One or more admins are invalid for sharing.' });
    }

    await dbRun('BEGIN');
    await dbRun(
      'DELETE FROM kiosk_session_shares WHERE org_id = ? AND kiosk_session_id = ?',
      [orgId, sessionId]
    );
    for (const adminId of nextIds) {
      await dbRun(
        `
          INSERT INTO kiosk_session_shares (org_id, kiosk_session_id, employee_id)
          VALUES (?, ?, ?)
        `,
        [orgId, sessionId, adminId]
      );
    }
    await dbRun(
      'UPDATE kiosk_sessions SET shared_with_admins = 0 WHERE id = ? AND org_id = ?',
      [sessionId, orgId]
    );
    await dbRun('COMMIT');

    await logAuditEvent({
      orgId,
      action: 'kiosk.session.share',
      entityType: 'kiosk_session',
      entityId: sessionId,
      actorEmployeeId: access.employeeId || null,
      after: {
        shared_with_employee_ids: nextIds
      }
    });

    return res.json({
      ok: true,
      shared_with_employee_ids: nextIds,
      shared_admins: validAdmins || [],
      shared_with_all: 0
    });
  } catch (err) {
    console.error('Error updating timesheet sharing:', err);
    try {
      await dbRun('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Failed to rollback timesheet share update:', rollbackErr);
    }
    return res.status(500).json({ error: 'Failed to update timesheet sharing.' });
  }
});

// Close a timesheet (set ended_at + clear active project if needed)
app.post('/api/kiosk-sessions/:id/close', async (req, res) => {
  const sessionId = Number(req.params.id);
  if (!sessionId) {
    return res.status(400).json({ error: 'Invalid timesheet id.' });
  }

  const adminCtx = await resolveKioskAdmin(req);
  if (!adminCtx.ok) {
    return res
      .status(adminCtx.status || 401)
      .json({ error: adminCtx.error || 'Not authorized' });
  }

  const orgId = adminCtx.orgId;

  let kioskCtx = null;
  if (adminCtx.via === 'kiosk') {
    kioskCtx = await ensureKioskDevice(req);
    if (!kioskCtx.ok) {
      return res.status(kioskCtx.status || 403).json({ error: kioskCtx.error || 'Not authorized' });
    }
  }

  try {
    const shareExistsClause = buildTimesheetShareExistsClause('ks');
    const session = await dbGet(
      `
        SELECT id,
               org_id,
               kiosk_id,
               project_id,
               created_by_employee_id,
               assigned_to_employee_id,
               0 AS shared_with_all,
               CASE
                 WHEN ${shareExistsClause} THEN 1
                 ELSE 0
               END AS shared_with_admins,
               ended_at
        FROM kiosk_sessions ks
        WHERE id = ? AND org_id = ?
        LIMIT 1
      `,
      [adminCtx.adminId || 0, sessionId, orgId]
    );

    if (!session) {
      return res.status(404).json({ error: 'Timesheet not found.' });
    }

    if (adminCtx.via === 'kiosk' && kioskCtx?.kiosk?.id) {
      if (Number(session.kiosk_id) !== Number(kioskCtx.kiosk.id)) {
        return res.status(403).json({ error: 'Not authorized' });
      }
    }

    const perms = await getAdminAccessPerms({
      employeeId: adminCtx.adminId,
      orgId
    });
    const isSuperAdmin = await isEmployeeSuperAdmin({
      employeeId: adminCtx.adminId,
      orgId
    });
    if (
      adminCtx.adminId &&
      !isTimesheetVisible(session, {
        adminId: adminCtx.adminId,
        perms,
        isSuperAdmin
      })
    ) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (session.ended_at) {
      return res.json({
        ok: true,
        ended_at: session.ended_at,
        already_closed: true,
        cleared_active_project: false
      });
    }

    const openRow = await dbGet(
      `
        SELECT COUNT(*) AS cnt
        FROM time_punches
        WHERE org_id = ?
          AND kiosk_session_id = ?
          AND clock_out_ts IS NULL
      `,
      [orgId, sessionId]
    );
    if (Number(openRow?.cnt || 0) > 0) {
      return res.status(409).json({ error: 'Cannot close a timesheet with open punches.' });
    }

    const nowIso = new Date().toISOString();
    const updateRes = await dbRun(
      `
        UPDATE kiosk_sessions
        SET ended_at = ?
        WHERE id = ? AND org_id = ? AND ended_at IS NULL
      `,
      [nowIso, sessionId, orgId]
    );

    let endedAt = nowIso;
    if (!updateRes || !updateRes.changes) {
      const row = await dbGet(
        'SELECT ended_at FROM kiosk_sessions WHERE id = ? AND org_id = ? LIMIT 1',
        [sessionId, orgId]
      );
      endedAt = row?.ended_at || nowIso;
    }

    let cleared = false;
    if (session.kiosk_id && session.project_id != null) {
      const clearRes = await dbRun(
        'UPDATE kiosks SET project_id = NULL WHERE id = ? AND org_id = ? AND project_id = ?',
        [session.kiosk_id, orgId, session.project_id]
      );
      cleared = !!(clearRes && clearRes.changes);
    }

    await logAuditEvent({
      orgId,
      action: 'kiosk.session.close',
      entityType: 'kiosk_session',
      entityId: sessionId,
      actorEmployeeId: adminCtx.adminId || null,
      after: {
        ended_at: endedAt,
        cleared_active_project: cleared ? 1 : 0
      }
    });

    return res.json({
      ok: true,
      ended_at: endedAt,
      cleared_active_project: cleared
    });
  } catch (err) {
    console.error('Error closing timesheet:', err);
    return res.status(500).json({ error: 'Failed to close timesheet.' });
  }
});


app.get('/api/kiosks/:id/foreman-today', async (req, res) => {
  const kioskId = parseInt(req.params.id, 10);
  if (!kioskId) {
    return res.status(400).json({ error: 'Invalid kiosk id.' });
  }

  const adminCtx = await resolveKioskAdmin(req);
  if (!adminCtx.ok) {
    return res
      .status(adminCtx.status || 401)
      .json({ error: adminCtx.error || 'Not authorized' });
  }

  if (adminCtx.via === 'kiosk') {
    const deviceAccess = await ensureKioskDevice(req);
    if (!deviceAccess.ok || Number(deviceAccess.kiosk.id) !== Number(kioskId)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
  }

  const orgTimezone = await getOrgTimezone(adminCtx.orgId);
  const today = getTodayIsoDate(orgTimezone);

  const sql = `
    SELECT
      kf.foreman_employee_id,
      e.name AS foreman_name
    FROM kiosk_foreman_days kf
    LEFT JOIN employees e ON e.id = kf.foreman_employee_id
    WHERE kf.org_id = ?
      AND kf.kiosk_id = ?
      AND kf.date = ?
    LIMIT 1
  `;

  db.get(sql, [adminCtx.orgId, kioskId, today], (err, row) => {
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

app.post('/api/kiosks/:id/foreman-today', async (req, res) => {
  const kioskId = parseInt(req.params.id, 10);
  if (!kioskId) {
    return res.status(400).json({ error: 'Invalid kiosk id.' });
  }

  const adminCtx = await resolveKioskAdmin(req);
  if (!adminCtx.ok) {
    return res
      .status(adminCtx.status || 401)
      .json({ error: adminCtx.error || 'Not authorized' });
  }

  if (adminCtx.via === 'kiosk') {
    const deviceAccess = await ensureKioskDevice(req);
    if (!deviceAccess.ok || Number(deviceAccess.kiosk.id) !== Number(kioskId)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
  }

  const { foreman_employee_id, set_by_employee_id } = req.body || {};
  const orgTimezone = await getOrgTimezone(adminCtx.orgId);
  const today = getTodayIsoDate(orgTimezone);

  const sql = `
    INSERT INTO kiosk_foreman_days
      (org_id, kiosk_id, foreman_employee_id, date, set_by_employee_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(kiosk_id, date) DO UPDATE SET
      foreman_employee_id = excluded.foreman_employee_id,
      set_by_employee_id = excluded.set_by_employee_id,
      created_at = datetime('now')
  `;

  try {
    const beforeRow = await dbGet(
      `
        SELECT foreman_employee_id
        FROM kiosk_foreman_days
        WHERE org_id = ? AND kiosk_id = ? AND date = ?
        LIMIT 1
      `,
      [adminCtx.orgId, kioskId, today]
    );

    await dbRun(
      sql,
      [
        adminCtx.orgId,
        kioskId,
        foreman_employee_id || null,
        today,
        set_by_employee_id || null
      ]
    );

    await logAuditEvent({
      orgId: adminCtx.orgId,
      action: 'kiosk.foreman.set',
      entityType: 'kiosk',
      entityId: kioskId,
      actorEmployeeId: adminCtx.adminId || null,
      before: {
        foreman_employee_id: beforeRow ? beforeRow.foreman_employee_id : null,
        date: today
      },
      after: {
        foreman_employee_id: foreman_employee_id || null,
        date: today
      }
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('Error setting foreman:', err);
    return res.status(500).json({ error: 'Failed to set foreman.' });
  }
});

app.get('/api/kiosk/open-punch', async (req, res) => {
  const access = await ensureKioskDevice(req);
  if (!access.ok) {
    return res
      .status(access.status || 401)
      .json({ error: access.error || 'Not authenticated' });
  }

  const employeeId = parseInt(req.query.employee_id, 10);
  if (!employeeId) {
    return res.status(400).json({ error: 'employee_id is required.' });
  }

  const orgId =
    access.via === 'session'
      ? req.session && req.session.orgId
      : access.kiosk && access.kiosk.org_id;
  if (!orgId) {
    return res.status(403).json({ error: 'Not authorized' });
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
    WHERE tp.org_id = ?
      AND tp.employee_id = ?
      AND tp.clock_out_ts IS NULL
    ORDER BY tp.clock_in_ts DESC
    LIMIT 1
  `;

  db.get(sql, [orgId, employeeId], (err, row) => {
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
  'Cleared - Ready for Pickup',
  'Picked Up',
  'Archived'
];

async function getAdminContext(req, { requirePerm } = {}) {
  if (!req.session || !req.session.userId) return null;

  const orgId = req.session.orgId;
  if (!orgId) return null;

  const orgStatus = await getOrgStatus(orgId);
  if (orgStatus && orgStatus !== 'active') return null;

  const membership = await dbGet(
    'SELECT login_enabled FROM user_orgs WHERE user_id = ? AND org_id = ?',
    [req.session.userId, orgId]
  );
  if (!membership || !isTruthyFlag(membership.login_enabled)) return null;

  const user = await dbGet('SELECT id, email FROM users WHERE id = ?', [
    req.session.userId
  ]);
  if (!user) return null;

  const employeeId = req.session.employeeId;
  if (!employeeId) return null;

  const employee = await dbGet(
    `
      SELECT id, name, desktop_access, kiosk_admin_access, worker_timekeeping, active
      FROM employees
      WHERE id = ? AND org_id = ?
    `,
    [employeeId, orgId]
  );

  if (!employee || !employee.active || !employee.desktop_access) return null;

  const perms = await getAdminAccessPerms({ employeeId, orgId });
  if (requirePerm && !perms[requirePerm]) return null;

  return { user, employee, perms, orgId };
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

function coerceBooleanFlag(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  }
  return !!value;
}

async function ensureShipmentAccess(req) {
  // 1) Try session-based auth first (desktop admins with see_shipments)
  if (req.session && req.session.employeeId && req.session.orgId) {
    const employeeId = req.session.employeeId;
    const orgId = req.session.orgId;
    const orgStatus = await getOrgStatus(orgId);
    if (orgStatus && orgStatus !== 'active') {
      return { ok: false, status: 403, error: 'Org access denied.' };
    }

    const emp = await dbGet(
      `
        SELECT id, name, desktop_access, kiosk_admin_access, IFNULL(active, 1) AS active
        FROM employees
        WHERE id = ? AND org_id = ?
      `,
      [employeeId, orgId]
    );

    if (emp && emp.active && emp.desktop_access) {
      const perms = await getAdminAccessPerms({ employeeId, orgId });
      if (perms.see_shipments) {
        return { ok: true, employee: emp, perms, via: 'session', orgId };
      }
    }

    return { ok: false, status: 403, error: 'Not authorized' };
  }

  // 2) Fallback for kiosk/field devices: require employee_id + device credentials (must pre-exist)
  const empId = Number(
    (req.body && req.body.employee_id) ||
      (req.query && req.query.employee_id)
  );
  const headerDeviceId = (req.get('x-kiosk-device-id') || '').trim();
  const headerDeviceSecret = (req.get('x-kiosk-device-secret') || '').trim();
  const cookieDeviceId = getCookieValue(req, 'kiosk_device_id');
  const cookieDeviceSecret = getCookieValue(req, 'kiosk_device_secret');
  const deviceId = (
    (req.body && req.body.device_id) ||
    (req.query && req.query.device_id) ||
    headerDeviceId ||
    cookieDeviceId ||
    ''
  ).trim();
  const deviceSecret = (
    (req.body && req.body.device_secret) ||
    (req.query && req.query.device_secret) ||
    headerDeviceSecret ||
    cookieDeviceSecret ||
    ''
  ).trim();

  if (!empId || !deviceId || !deviceSecret) {
    return { ok: false, status: 401, error: 'Not authenticated' };
  }

  const kioskRow = await dbGet(
    'SELECT id, org_id, device_id, device_secret FROM kiosks WHERE device_id = ? LIMIT 1',
    [deviceId]
  );
  if (!kioskRow || !kioskRow.device_secret) {
    return { ok: false, status: 403, error: 'Not authorized' };
  }

  if (kioskRow.device_secret !== deviceSecret) {
    return { ok: false, status: 403, error: 'Not authorized' };
  }

  const kioskOrgStatus = await getOrgStatus(kioskRow.org_id);
  if (kioskOrgStatus && kioskOrgStatus !== 'active') {
    return { ok: false, status: 403, error: 'Org access denied.' };
  }

  const emp = await dbGet(
    `
      SELECT id, name, kiosk_admin_access, IFNULL(active, 1) AS active
      FROM employees
      WHERE id = ? AND org_id = ?
    `,
    [empId, kioskRow.org_id]
  );

  if (!emp || !emp.active || !emp.kiosk_admin_access) {
    return { ok: false, status: 403, error: 'Not authorized' };
  }

  const perms = await getAdminAccessPerms({
    employeeId: empId,
    orgId: kioskRow.org_id
  });

  if (!perms.see_shipments) {
    return { ok: false, status: 403, error: 'Not authorized' };
  }

  return {
    ok: true,
    employee: emp,
    perms,
    kiosk: kioskRow,
    via: 'kiosk',
    orgId: kioskRow.org_id
  };
}

const SHIPMENT_MONEY_FIELDS = [
  'total_price',
  'price_per_item',
  'vendor_paid',
  'vendor_paid_amount',
  'shipper_paid',
  'shipper_paid_amount',
  'shipper_paid_by',
  'customs_paid',
  'customs_paid_amount',
  'customs_paid_by',
  'storage_paid',
  'storage_paid_amount',
  'storage_paid_by',
  'total_paid',
  'storage_daily_late_fee'
];
const SHIPMENT_ITEM_MONEY_FIELDS = ['unit_price', 'line_total'];

function stripFields(obj, fields) {
  if (!obj) return obj;
  const clone = { ...obj };
  fields.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(clone, field)) {
      delete clone[field];
    }
  });
  return clone;
}

function stripShipmentMoney(shipment) {
  return stripFields(shipment, SHIPMENT_MONEY_FIELDS);
}

function stripShipmentItemsMoney(items) {
  return (items || []).map(item => stripFields(item, SHIPMENT_ITEM_MONEY_FIELDS));
}

function getCookieValue(req, name) {
  const header = req && req.headers ? req.headers.cookie || '' : '';
  if (!header) return '';
  const parts = header.split(';');
  const target = String(name || '').trim();
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = decodeURIComponent(part.slice(0, idx).trim());
    if (key !== target) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return '';
}

async function ensureKioskDevice(req) {
  const headerDeviceId = (req.get('x-kiosk-device-id') || '').trim();
  const headerDeviceSecret = (req.get('x-kiosk-device-secret') || '').trim();
  const cookieDeviceId = getCookieValue(req, 'kiosk_device_id');
  const cookieDeviceSecret = getCookieValue(req, 'kiosk_device_secret');
  const deviceId = (
    (req.body && req.body.device_id) ||
    (req.query && req.query.device_id) ||
    headerDeviceId ||
    cookieDeviceId ||
    ''
  ).trim();
  const deviceSecret = (
    (req.body && req.body.device_secret) ||
    (req.query && req.query.device_secret) ||
    headerDeviceSecret ||
    cookieDeviceSecret ||
    ''
  ).trim();

  const hasDeviceCreds = deviceId || deviceSecret;
  if (hasDeviceCreds) {
    if (!deviceId || !deviceSecret) {
      return { ok: false, status: 401, error: 'Not authenticated' };
    }

    const kioskRow = await dbGet(
      'SELECT id, org_id, device_id, device_secret FROM kiosks WHERE device_id = ? LIMIT 1',
      [deviceId]
    );
    if (!kioskRow || !kioskRow.device_secret) {
      return { ok: false, status: 403, error: 'Not authorized' };
    }

    if (kioskRow.device_secret !== deviceSecret) {
      return { ok: false, status: 403, error: 'Not authorized' };
    }

    const orgStatus = await getOrgStatus(kioskRow.org_id);
    if (orgStatus && orgStatus !== 'active') {
      return { ok: false, status: 403, error: 'Org access denied.' };
    }

    return { ok: true, kiosk: kioskRow, via: 'kiosk' };
  }

  if (req.session && req.session.userId && req.session.employeeId && req.session.orgId) {
    const orgId = req.session.orgId;
    const orgStatus = await getOrgStatus(orgId);
    if (orgStatus && orgStatus !== 'active') {
      return { ok: false, status: 403, error: 'Org access denied.' };
    }
    const membership = await dbGet(
      'SELECT login_enabled FROM user_orgs WHERE user_id = ? AND org_id = ?',
      [req.session.userId, orgId]
    );
    if (!membership || !isTruthyFlag(membership.login_enabled)) {
      return { ok: false, status: 403, error: 'Not authorized' };
    }
    const employeeId = req.session.employeeId;
    const emp = await dbGet(
      `
        SELECT id, kiosk_admin_access, IFNULL(active, 1) AS active
        FROM employees
        WHERE id = ? AND org_id = ?
        LIMIT 1
      `,
      [employeeId, orgId]
    );
    if (!emp || !emp.active || !emp.kiosk_admin_access) {
      return { ok: false, status: 403, error: 'Not authorized' };
    }
    return { ok: true, via: 'session', orgId, employee: emp };
  }

  return { ok: false, status: 401, error: 'Not authenticated' };
}

async function resolveKioskAdmin(req) {
  const access = await ensureKioskDevice(req);
  if (!access.ok) return access;

  const orgId =
    access.via === 'session'
      ? req.session && req.session.orgId
      : access.kiosk && access.kiosk.org_id;

  if (!orgId) {
    return { ok: false, status: 403, error: 'Not authorized' };
  }

  if (access.via === 'session') {
    const employeeId = req.session && req.session.employeeId;
    if (!employeeId) {
      return { ok: false, status: 403, error: 'Admin privileges required.' };
    }

    const empAccess = await getEmployeeAccessFlags({ employeeId, orgId });
    if (!empAccess || !empAccess.active || !empAccess.kiosk_admin_access) {
      return { ok: false, status: 403, error: 'Admin privileges required.' };
    }

    return { ok: true, orgId, adminId: employeeId, via: 'session' };
  }

  const adminId = Number(
    (req.body && (req.body.admin_id || req.body.employee_id)) ||
      (req.query && (req.query.admin_id || req.query.employee_id)) ||
      0
  );
  if (!adminId) {
    return { ok: false, status: 400, error: 'admin_id is required.' };
  }

  const admin = await dbGet(
    `
      SELECT id
      FROM employees
      WHERE id = ? AND org_id = ? AND IFNULL(kiosk_admin_access, 0) = 1
        AND IFNULL(active, 1) = 1
      LIMIT 1
    `,
    [adminId, orgId]
  );
  if (!admin) {
    return { ok: false, status: 403, error: 'Admin not authorized.' };
  }

  return { ok: true, orgId, adminId, via: 'kiosk' };
}

async function resolveKioskAdminAccount(req) {
  const adminCtx = await resolveKioskAdmin(req);
  if (!adminCtx.ok) return adminCtx;

  const orgId = adminCtx.orgId;
  const adminId = adminCtx.adminId;

  const membership = await dbGet(
    `
      SELECT user_id, login_enabled
      FROM user_orgs
      WHERE org_id = ? AND employee_id = ?
      LIMIT 1
    `,
    [orgId, adminId]
  );
  if (!membership || !membership.user_id) {
    return { ok: false, status: 404, error: 'No login account linked to this admin.' };
  }
  if (!isTruthyFlag(membership.login_enabled)) {
    return { ok: false, status: 403, error: 'Login is disabled for this account.' };
  }

  const employee = await dbGet(
    `
      SELECT id, name, IFNULL(active, 1) AS active, IFNULL(desktop_access, 0) AS desktop_access
      FROM employees
      WHERE id = ? AND org_id = ?
      LIMIT 1
    `,
    [adminId, orgId]
  );
  if (!employee || !isTruthyFlag(employee.active)) {
    return { ok: false, status: 403, error: 'Admin is inactive.' };
  }
  if (!isTruthyFlag(employee.desktop_access)) {
    return {
      ok: false,
      status: 403,
      error: 'Desktop access is required to update login details.'
    };
  }

  const user = await dbGet(
    'SELECT id, email, password_hash FROM users WHERE id = ?',
    [membership.user_id]
  );
  if (!user) {
    return { ok: false, status: 404, error: 'User account not found.' };
  }

  return { ok: true, orgId, adminId, user, employee };
}

async function resolveModifyTimeContext(req) {
  if (req.session && req.session.userId && req.session.orgId) {
    const status = await requireActiveDesktopSession(req);
    if (status.ok) {
      const orgId = status.orgId;
      const employeeId = status.employeeId;
      const perms = await getAdminAccessPerms({ employeeId, orgId });
      if (perms.modify_time) {
        return { ok: true, orgId, adminId: employeeId, via: 'session', perms };
      }
    } else if (status.error === 'Org access denied.') {
      return { ok: false, status: status.status || 403, error: status.error };
    }
  }

  const deviceAccess = await ensureKioskDevice(req);
  if (!deviceAccess.ok) return deviceAccess;

  const orgId = deviceAccess.kiosk && deviceAccess.kiosk.org_id;
  if (!orgId) {
    return { ok: false, status: 403, error: 'Not authorized' };
  }

  const adminIdRaw =
    (req.body && (req.body.admin_id || req.body.employee_id)) ||
    (req.query && (req.query.admin_id || req.query.employee_id)) ||
    0;
  const adminId = Number(adminIdRaw);
  if (!adminId) {
    return { ok: false, status: 400, error: 'admin_id is required.' };
  }

  const admin = await dbGet(
    `
      SELECT id
      FROM employees
      WHERE id = ? AND org_id = ? AND IFNULL(kiosk_admin_access, 0) = 1
        AND IFNULL(active, 1) = 1
      LIMIT 1
    `,
    [adminId, orgId]
  );
  if (!admin) {
    return { ok: false, status: 403, error: 'Admin not authorized.' };
  }

  const perms = await getAdminAccessPerms({ employeeId: adminId, orgId });
  if (!perms.modify_time) {
    return { ok: false, status: 403, error: 'Not authorized.' };
  }

  return { ok: true, orgId, adminId, via: 'kiosk', perms };
}

async function requireModifyTimeAny(req, res, next) {
  const ctx = await resolveModifyTimeContext(req);
  if (!ctx.ok) {
    return res
      .status(ctx.status || 403)
      .json({ error: ctx.error || 'Not authorized.' });
  }
  req.modifyTimeContext = ctx;
  return next();
}

async function resolveModifyTimeSuperAdmin(req, ctx) {
  if (req?.session && isTruthyFlag(req.session.isSuperAdmin)) return true;
  const orgId = ctx && ctx.orgId;
  const adminId = ctx && ctx.adminId;
  if (!orgId || !adminId) return false;
  return isEmployeeSuperAdmin({ employeeId: adminId, orgId });
}

async function getPunchHoursForEntry({ orgId, entryId }) {
  if (!orgId || !entryId) return { count: 0, hours: 0 };
  const row = await dbGet(
    `
      SELECT COUNT(tp.id) AS punch_count,
             SUM(
               CASE
                 WHEN tp.clock_in_ts IS NOT NULL AND tp.clock_out_ts IS NOT NULL
                 THEN (julianday(tp.clock_out_ts) - julianday(tp.clock_in_ts)) * 24.0
                 ELSE 0
               END
             ) AS punch_hours
      FROM time_punches tp
      WHERE tp.org_id = ?
        AND tp.time_entry_id = ?
    `,
    [orgId, entryId]
  );
  const count = Number(row?.punch_count || 0);
  const hours = Number(row?.punch_hours || 0);
  return {
    count: Number.isFinite(count) ? count : 0,
    hours: Number.isFinite(hours) ? hours : 0
  };
}

async function getPunchHoursForEmployeeDate({ orgId, employeeId, dateStr }) {
  if (!orgId || !employeeId || !dateStr) return { count: 0, hours: 0 };
  const row = await dbGet(
    `
      SELECT COUNT(tp.id) AS punch_count,
             SUM(
               CASE
                 WHEN tp.clock_in_ts IS NOT NULL AND tp.clock_out_ts IS NOT NULL
                 THEN (julianday(tp.clock_out_ts) - julianday(tp.clock_in_ts)) * 24.0
                 ELSE 0
               END
             ) AS punch_hours
      FROM time_punches tp
      WHERE tp.org_id = ?
        AND tp.employee_id = ?
        AND tp.clock_in_local_date = ?
    `,
    [orgId, employeeId, dateStr]
  );
  const count = Number(row?.punch_count || 0);
  const hours = Number(row?.punch_hours || 0);
  return {
    count: Number.isFinite(count) ? count : 0,
    hours: Number.isFinite(hours) ? hours : 0
  };
}

// Allow either an admin session or a kiosk device secret for kiosk-specific routes.
async function requireAdminOrKiosk(req, kioskId = null) {
  const adminCtx = await getAdminContext(req, { requirePerm: 'view_payroll' });
  if (adminCtx) {
    return { ok: true, via: 'admin', adminCtx };
  }

  const access = await ensureKioskDevice(req);
  if (!access.ok) return access;

  if (kioskId && access.kiosk && Number(access.kiosk.id) !== Number(kioskId)) {
    return { ok: false, status: 403, error: 'Not authorized for this kiosk' };
  }

  return { ok: true, via: 'kiosk', kiosk: access.kiosk };
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

function normalizeNotificationProjects(rawIds) {
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

const TIME_NOTIFICATION_EVENTS = [
  'TIME_EXCEPTION_OPEN',
  'TIME_EXCEPTION_REVIEWED',
  'TIME_EXCEPTION_RESOLVED',
  'TIME_ENTRY_MANUAL_CREATED',
  'TIME_ENTRY_MANUAL_EDITED',
  'TIME_SHIFT_LONG',
  'TIME_SHIFT_MULTI_DAY',
  'TIME_PUNCH_OPEN_LONG',
  'TIME_PUNCH_OPEN_MULTI_DAY',
  'TIME_WEEKLY_THRESHOLD_NEAR',
  'TIME_WEEKLY_THRESHOLD_EXCEEDED'
];
const PAYROLL_NOTIFICATION_EVENTS = [
  'PAYROLL_RUN_DUE',
  'PAYROLL_RUN_STARTED',
  'PAYROLL_RUN_SUCCESS',
  'PAYROLL_RUN_PARTIAL',
  'PAYROLL_RUN_FAILURE',
  'PAYROLL_FATAL_ERROR',
  'PAYROLL_QBO_ERROR',
  'PAYROLL_UNPAY'
];

const DEFAULT_NOTIFICATION_PREFS = {
  email_enabled: true,
  push_enabled: true,
  shipment_filters: {
    enabled: true,
    statuses: [],
    project_ids: []
  },
  payroll_filters: {
    enabled: true,
    event_types: [
      'PAYROLL_RUN_DUE',
      'PAYROLL_RUN_FAILURE',
      'PAYROLL_QBO_ERROR',
      'PAYROLL_FATAL_ERROR'
    ]
  },
  time_filters: {
    enabled: true,
    event_types: ['TIME_EXCEPTION_OPEN']
  },
  remind_time: '',
  remind_every_days: 1,
  clockout_enabled: false,
  clockout_time: ''
};

const LONG_SHIFT_THRESHOLD_HOURS = 12;
const MULTI_DAY_SHIFT_THRESHOLD_HOURS = 24;
const WEEKLY_THRESHOLD_WARNING_RATIO = 0.9;
const MANUAL_ENTRY_GUARDRAIL_MISMATCH_HOURS = 0.25;

function normalizeEventTypeList(raw, allowed) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  raw.forEach(item => {
    const val = String(item || '').trim();
    if (!val) return;
    if (allowed && allowed.length && !allowed.includes(val)) return;
    if (!out.includes(val)) out.push(val);
  });
  return out;
}

function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function mapNotificationPrefsRow(row) {
  if (!row) {
    return { ...DEFAULT_NOTIFICATION_PREFS };
  }

  const shipmentFilters = parseJsonObject(row.shipment_filters_json) || {};
  const payrollFilters = parseJsonObject(row.payroll_filters_json) || {};
  const timeFilters = parseJsonObject(row.time_filters_json) || {};

  return {
    email_enabled: row.email_enabled !== 0,
    push_enabled: row.push_enabled !== 0,
    shipment_filters: {
      enabled:
        shipmentFilters.enabled !== false &&
        shipmentFilters.enabled !== 0 &&
        shipmentFilters.enabled !== 'false',
      statuses: normalizeNotificationStatuses(shipmentFilters.statuses || []),
      project_ids: normalizeNotificationProjects(shipmentFilters.project_ids || [])
    },
    payroll_filters: {
      enabled:
        payrollFilters.enabled !== false &&
        payrollFilters.enabled !== 0 &&
        payrollFilters.enabled !== 'false',
      event_types: normalizeEventTypeList(
        payrollFilters.event_types || [],
        PAYROLL_NOTIFICATION_EVENTS
      )
    },
    time_filters: {
      enabled:
        timeFilters.enabled !== false &&
        timeFilters.enabled !== 0 &&
        timeFilters.enabled !== 'false',
      event_types: normalizeEventTypeList(
        timeFilters.event_types || [],
        TIME_NOTIFICATION_EVENTS
      )
    },
    remind_time: row.remind_time || '',
    remind_every_days:
      row.remind_every_days != null ? Number(row.remind_every_days) || 1 : 1,
    clockout_enabled: row.clockout_enabled === 1 || row.clockout_enabled === true,
    clockout_time: row.clockout_time || ''
  };
}

function normalizeNotificationPrefsPayload(body) {
  const payload = body && typeof body === 'object' ? body : {};
  const shipmentFilters = payload.shipment_filters || {};
  const payrollFilters = payload.payroll_filters || {};
  const timeFilters = payload.time_filters || {};

  const normalized = {
    email_enabled: payload.email_enabled !== false && payload.email_enabled !== 0,
    push_enabled: payload.push_enabled !== false && payload.push_enabled !== 0,
    shipment_filters: {
      enabled:
        shipmentFilters.enabled !== false &&
        shipmentFilters.enabled !== 0 &&
        shipmentFilters.enabled !== 'false',
      statuses: normalizeNotificationStatuses(shipmentFilters.statuses || []),
      project_ids: normalizeNotificationProjects(shipmentFilters.project_ids || [])
    },
    payroll_filters: {
      enabled:
        payrollFilters.enabled !== false &&
        payrollFilters.enabled !== 0 &&
        payrollFilters.enabled !== 'false',
      event_types: normalizeEventTypeList(
        payrollFilters.event_types || [],
        PAYROLL_NOTIFICATION_EVENTS
      )
    },
    time_filters: {
      enabled:
        timeFilters.enabled !== false &&
        timeFilters.enabled !== 0 &&
        timeFilters.enabled !== 'false',
      event_types: normalizeEventTypeList(
        timeFilters.event_types || [],
        TIME_NOTIFICATION_EVENTS
      )
    },
    remind_time: payload.remind_time ? normalizeNotifyTime(payload.remind_time) : '',
    remind_every_days: Number(payload.remind_every_days) || 1,
    clockout_enabled:
      payload.clockout_enabled === true ||
      payload.clockout_enabled === 1 ||
      payload.clockout_enabled === 'true',
    clockout_time: payload.clockout_time ? normalizeNotifyTime(payload.clockout_time) : ''
  };

  if (!Number.isFinite(normalized.remind_every_days) || normalized.remind_every_days < 1) {
    normalized.remind_every_days = 1;
  }

  return normalized;
}

async function loadNotificationPrefs(orgId, userId) {
  if (!orgId || !userId) return { ...DEFAULT_NOTIFICATION_PREFS };
  const row = await dbGet(
    `
      SELECT email_enabled, push_enabled, shipment_filters_json, payroll_filters_json,
             time_filters_json, remind_time, remind_every_days, clockout_enabled, clockout_time
      FROM notification_prefs
      WHERE org_id = ? AND user_id = ?
    `,
    [orgId, userId]
  );
  return mapNotificationPrefsRow(row);
}

async function upsertNotificationPrefs(orgId, userId, payload) {
  if (!orgId || !userId) return null;

  await dbRun(
    `
      INSERT INTO notification_prefs (
        org_id,
        user_id,
        email_enabled,
        push_enabled,
        shipment_filters_json,
        payroll_filters_json,
        time_filters_json,
        remind_time,
        remind_every_days,
        clockout_enabled,
        clockout_time,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(org_id, user_id) DO UPDATE SET
        email_enabled = excluded.email_enabled,
        push_enabled = excluded.push_enabled,
        shipment_filters_json = excluded.shipment_filters_json,
        payroll_filters_json = excluded.payroll_filters_json,
        time_filters_json = excluded.time_filters_json,
        remind_time = excluded.remind_time,
        remind_every_days = excluded.remind_every_days,
        clockout_enabled = excluded.clockout_enabled,
        clockout_time = excluded.clockout_time
    `,
    [
      orgId,
      userId,
      payload.email_enabled ? 1 : 0,
      payload.push_enabled ? 1 : 0,
      JSON.stringify(payload.shipment_filters || {}),
      JSON.stringify(payload.payroll_filters || {}),
      JSON.stringify(payload.time_filters || {}),
      payload.remind_time || null,
      payload.remind_every_days || 1,
      payload.clockout_enabled ? 1 : 0,
      payload.clockout_time || null
    ]
  );

  return payload;
}

async function loadNotificationPrefsMap(orgId) {
  if (!orgId) return new Map();
  const rows = await dbAll(
    `
      SELECT user_id, email_enabled, push_enabled, shipment_filters_json,
             payroll_filters_json, time_filters_json, remind_time, remind_every_days,
             clockout_enabled, clockout_time
      FROM notification_prefs
      WHERE org_id = ?
    `,
    [orgId]
  );
  const map = new Map();
  (rows || []).forEach(row => {
    map.set(row.user_id, mapNotificationPrefsRow(row));
  });
  return map;
}

async function loadNotificationRecipients(orgId) {
  if (!orgId) return [];
  const rows = await dbAll(
    `
      SELECT
        uo.user_id,
        uo.employee_id,
        uo.is_super_admin,
        u.email,
        e.name AS employee_name,
        e.desktop_access,
        e.active,
        p.see_shipments,
        p.modify_time,
        p.approve_time,
        p.view_time_reports,
        p.view_payroll,
        p.modify_payroll
      FROM user_orgs uo
      JOIN users u ON u.id = uo.user_id
      JOIN employees e ON e.id = uo.employee_id AND e.org_id = uo.org_id
      LEFT JOIN employee_permissions p ON p.employee_id = e.id
      WHERE uo.org_id = ?
        AND IFNULL(e.active, 1) = 1
        AND IFNULL(e.desktop_access, 0) = 1
        AND IFNULL(uo.login_enabled, 1) = 1
    `,
    [orgId]
  );
  return rows || [];
}

function mapRecipientPerms(row) {
  const isSuper = row && (row.is_super_admin === 1 || row.is_super_admin === true);
  if (isSuper) {
    return {
      see_shipments: true,
      modify_time: true,
      approve_time: true,
      view_time_reports: true,
      view_payroll: true,
      modify_payroll: true
    };
  }
  const toBool = val => val === 1 || val === true || val === 'true';
  return {
    see_shipments: toBool(row?.see_shipments),
    modify_time: toBool(row?.modify_time),
    approve_time: toBool(row?.approve_time),
    view_time_reports: toBool(row?.view_time_reports),
    view_payroll: toBool(row?.view_payroll),
    modify_payroll: toBool(row?.modify_payroll)
  };
}

function hasNotificationPerms(perms, category) {
  if (!perms) return false;
  if (category === 'shipment') return !!perms.see_shipments;
  if (category === 'time') {
    return !!(perms.modify_time || perms.view_time_reports || perms.view_payroll);
  }
  if (category === 'payroll') return !!perms.view_payroll;
  return false;
}

async function createNotificationRow({ orgId, userId, type, title, body, data }) {
  if (!orgId || !userId) return null;
  const dataJson = data ? JSON.stringify(data) : null;
  const res = await dbRun(
    `
      INSERT INTO notifications (org_id, user_id, type, title, body, data_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [orgId, userId, type || null, title || null, body || null, dataJson]
  );
  return res?.lastID || null;
}

async function recordNotificationDelivery({ orgId, notificationId, channel, status, error }) {
  if (!orgId || !notificationId || !channel) return;
  await dbRun(
    `
      INSERT INTO notification_deliveries (org_id, notification_id, channel, status, error)
      VALUES (?, ?, ?, ?, ?)
    `,
    [orgId, notificationId, channel, status || null, error || null]
  );
}

async function sendEmailNotification({ userEmail, title, body }) {
  if (!mailTransport || !mailFromAddress) {
    return { status: 'skipped', error: 'Email not configured.' };
  }
  if (!userEmail) {
    return { status: 'skipped', error: 'No email address on file.' };
  }

  try {
    await mailTransport.sendMail({
      from: mailFromAddress,
      to: userEmail,
      subject: title || 'Notification',
      text: body || ''
    });
    return { status: 'sent' };
  } catch (err) {
    return { status: 'error', error: err.message || 'Email send failed.' };
  }
}

async function sendPushNotification({ orgId, userId, title, body, data }) {
  if (!pushConfigured) {
    return { status: 'skipped', error: 'Push not configured.' };
  }
  if (!orgId || !userId) {
    return { status: 'skipped', error: 'Missing user context.' };
  }

  const subs = await dbAll(
    `
      SELECT id, endpoint, p256dh, auth
      FROM push_subscriptions
      WHERE org_id = ? AND user_id = ? AND revoked_at IS NULL
    `,
    [orgId, userId]
  );

  if (!subs || !subs.length) {
    return { status: 'skipped', error: 'No push subscription found.' };
  }

  const payload = JSON.stringify({
    title: title || 'Notification',
    body: body || '',
    data: data || {}
  });

  let sent = 0;
  let lastError = null;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth
          }
        },
        payload
      );
      sent += 1;
    } catch (err) {
      lastError = err.message || 'Push send failed.';
      const status = err?.statusCode || err?.status;
      if (status === 410 || status === 404) {
        await dbRun(
          `UPDATE push_subscriptions SET revoked_at = datetime('now') WHERE id = ?`,
          [sub.id]
        );
      }
    }
  }

  if (sent > 0) {
    return { status: 'sent' };
  }
  return { status: 'error', error: lastError || 'Push send failed.' };
}

function formatNotificationResult({ status, error } = {}) {
  const normalized = status || 'skipped';
  if (normalized === 'sent') return 'sent';
  return error ? `${normalized} (${error})` : normalized;
}

async function deliverNotificationToUser({
  orgId,
  userId,
  prefs,
  type,
  title,
  body,
  data,
  channels
}) {
  const notificationId = await createNotificationRow({
    orgId,
    userId,
    type,
    title,
    body,
    data
  });

  if (!notificationId) {
    return { ok: false, error: 'Failed to create notification.' };
  }

  await recordNotificationDelivery({
    orgId,
    notificationId,
    channel: 'in_app',
    status: 'stored'
  });

  const results = { in_app: 'sent' };
  const sendChannels = Array.isArray(channels) && channels.length
    ? channels
    : ['push', 'email'];

  if (sendChannels.includes('push')) {
    if (prefs && prefs.push_enabled) {
      const res = await sendPushNotification({ orgId, userId, title, body, data });
      results.push = formatNotificationResult(res);
      await recordNotificationDelivery({
        orgId,
        notificationId,
        channel: 'push',
        status: res.status,
        error: res.error || null
      });
    } else {
      results.push = formatNotificationResult({
        status: 'skipped',
        error: 'Push disabled.'
      });
      await recordNotificationDelivery({
        orgId,
        notificationId,
        channel: 'push',
        status: 'skipped',
        error: 'Push disabled.'
      });
    }
  }

  if (sendChannels.includes('email')) {
    if (prefs && prefs.email_enabled) {
      const userRow = await dbGet('SELECT email FROM users WHERE id = ?', [userId]);
      const res = await sendEmailNotification({
        userEmail: userRow?.email || null,
        title,
        body
      });
      results.email = formatNotificationResult(res);
      await recordNotificationDelivery({
        orgId,
        notificationId,
        channel: 'email',
        status: res.status,
        error: res.error || null
      });
    } else {
      results.email = formatNotificationResult({
        status: 'skipped',
        error: 'Email disabled.'
      });
      await recordNotificationDelivery({
        orgId,
        notificationId,
        channel: 'email',
        status: 'skipped',
        error: 'Email disabled.'
      });
    }
  }

  return { ok: true, notificationId, results };
}

async function notifyShipmentStatusChange({
  orgId,
  shipmentId,
  status,
  projectId,
  title,
  actorName
}) {
  if (!orgId || !shipmentId) return;
  const recipients = await loadNotificationRecipients(orgId);
  const prefsMap = await loadNotificationPrefsMap(orgId);

  const body = `Shipment "${title || 'Untitled'}" moved to ${status}.`;
  const payload = {
    shipment_id: Number(shipmentId),
    status,
    project_id: projectId || null,
    actor_name: actorName || null
  };

  for (const row of recipients) {
    const perms = mapRecipientPerms(row);
    if (!hasNotificationPerms(perms, 'shipment')) continue;

    const prefs = prefsMap.get(row.user_id) || { ...DEFAULT_NOTIFICATION_PREFS };
    const shipmentFilters = prefs.shipment_filters || DEFAULT_NOTIFICATION_PREFS.shipment_filters;
    if (!shipmentFilters.enabled) continue;

    if (
      shipmentFilters.statuses &&
      shipmentFilters.statuses.length &&
      !shipmentFilters.statuses.includes(status)
    ) {
      continue;
    }
    if (
      shipmentFilters.project_ids &&
      shipmentFilters.project_ids.length &&
      (!projectId || !shipmentFilters.project_ids.includes(Number(projectId)))
    ) {
      continue;
    }

    await deliverNotificationToUser({
      orgId,
      userId: row.user_id,
      prefs,
      type: 'shipment',
      title: 'Shipment status updated',
      body,
      data: payload
    });
  }
}

async function notifyShipmentComment({
  orgId,
  shipmentId,
  status,
  projectId,
  title,
  actorName,
  actorEmployeeId,
  commentBody,
  commentId,
  threadId
}) {
  if (!orgId || !shipmentId) return;
  const recipients = await loadNotificationRecipients(orgId);
  const prefsMap = await loadNotificationPrefsMap(orgId);

  const rawBody = commentBody ? String(commentBody).trim() : '';
  const snippet =
    rawBody.length > 140 ? `${rawBody.slice(0, 137)}...` : rawBody;
  const body = `${actorName || 'Someone'} commented on "${title || 'Untitled'}"${snippet ? `: ${snippet}` : '.'}`;
  const payload = {
    shipment_id: Number(shipmentId),
    status,
    project_id: projectId || null,
    actor_name: actorName || null,
    comment_id: commentId || null,
    thread_id: threadId || null
  };

  for (const row of recipients) {
    if (actorEmployeeId && Number(row.employee_id) === Number(actorEmployeeId)) {
      continue;
    }
    const perms = mapRecipientPerms(row);
    if (!hasNotificationPerms(perms, 'shipment')) continue;

    const prefs = prefsMap.get(row.user_id) || { ...DEFAULT_NOTIFICATION_PREFS };
    const shipmentFilters = prefs.shipment_filters || DEFAULT_NOTIFICATION_PREFS.shipment_filters;
    if (!shipmentFilters.enabled) continue;

    if (
      shipmentFilters.statuses &&
      shipmentFilters.statuses.length &&
      !shipmentFilters.statuses.includes(status)
    ) {
      continue;
    }
    if (
      shipmentFilters.project_ids &&
      shipmentFilters.project_ids.length &&
      (!projectId || !shipmentFilters.project_ids.includes(Number(projectId)))
    ) {
      continue;
    }

    await deliverNotificationToUser({
      orgId,
      userId: row.user_id,
      prefs,
      type: 'shipment_comment',
      title: 'Shipment comment',
      body,
      data: payload
    });
  }
}

async function notifyTimeEvent({ orgId, eventType, title, body, data }) {
  if (!orgId || !eventType) return;
  const recipients = await loadNotificationRecipients(orgId);
  const prefsMap = await loadNotificationPrefsMap(orgId);

  for (const row of recipients) {
    const perms = mapRecipientPerms(row);
    if (!hasNotificationPerms(perms, 'time')) continue;
    const prefs = prefsMap.get(row.user_id) || { ...DEFAULT_NOTIFICATION_PREFS };
    const timeFilters = prefs.time_filters || DEFAULT_NOTIFICATION_PREFS.time_filters;
    if (!timeFilters.enabled) continue;
    if (
      timeFilters.event_types &&
      timeFilters.event_types.length &&
      !timeFilters.event_types.includes(eventType)
    ) {
      continue;
    }

    await deliverNotificationToUser({
      orgId,
      userId: row.user_id,
      prefs,
      type: 'time',
      title,
      body,
      data: { ...(data || {}), event_type: eventType }
    });
  }
}

async function wasTimeEventSentForMatch({ orgId, userId, eventType, match = {} }) {
  if (!orgId || !userId || !eventType) return false;
  const where = [
    'org_id = ?',
    'user_id = ?',
    "type = 'time'",
    "json_extract(data_json, '$.event_type') = ?"
  ];
  const params = [orgId, userId, eventType];
  Object.entries(match).forEach(([key, value]) => {
    if (value == null) return;
    where.push(`json_extract(data_json, '$.${key}') = ?`);
    params.push(value);
  });
  const row = await dbGet(
    `
      SELECT id
      FROM notifications
      WHERE ${where.join(' AND ')}
      ORDER BY id DESC
      LIMIT 1
    `,
    params
  );
  return !!row;
}

async function notifyTimeEventOnce({ orgId, eventType, title, body, data, match = {} }) {
  if (!orgId || !eventType) return;
  const recipients = await loadNotificationRecipients(orgId);
  const prefsMap = await loadNotificationPrefsMap(orgId);

  for (const row of recipients) {
    const perms = mapRecipientPerms(row);
    if (!hasNotificationPerms(perms, 'time')) continue;
    const prefs = prefsMap.get(row.user_id) || { ...DEFAULT_NOTIFICATION_PREFS };
    const timeFilters = prefs.time_filters || DEFAULT_NOTIFICATION_PREFS.time_filters;
    if (!timeFilters.enabled) continue;
    if (
      timeFilters.event_types &&
      timeFilters.event_types.length &&
      !timeFilters.event_types.includes(eventType)
    ) {
      continue;
    }

    const alreadySent = await wasTimeEventSentForMatch({
      orgId,
      userId: row.user_id,
      eventType,
      match
    });
    if (alreadySent) continue;

    await deliverNotificationToUser({
      orgId,
      userId: row.user_id,
      prefs,
      type: 'time',
      title,
      body,
      data: { ...(data || {}), event_type: eventType }
    });
  }
}

function getWeekWindowForDate(dateStr, timeZone) {
  if (!dateStr) return null;
  const tz = timeZone || APP_TIMEZONE;
  const dateObj = getDateForLocalIso(dateStr, tz);
  if (!dateObj) return null;
  const weekStart = makeWeekStartResolver(tz)(dateObj);
  if (!weekStart) return null;
  const weekEnd = shiftIsoDate(weekStart, 6);
  return { weekStart, weekEnd };
}

async function sumWeeklyHoursForEmployee({ orgId, employeeId, weekStart, weekEnd }) {
  if (!orgId || !employeeId || !weekStart || !weekEnd) return null;
  const row = await dbGet(
    `
      SELECT SUM(hours) AS total_hours
      FROM time_entries
      WHERE org_id = ?
        AND employee_id = ?
        AND start_date >= ?
        AND start_date <= ?
    `,
    [orgId, employeeId, weekStart, weekEnd]
  );
  const total = Number(row?.total_hours || 0);
  return Number.isFinite(total) ? total : 0;
}

async function notifyPayrollEvent({ orgId, eventType, title, body, data }) {
  if (!orgId || !eventType) return;
  const recipients = await loadNotificationRecipients(orgId);
  const prefsMap = await loadNotificationPrefsMap(orgId);

  for (const row of recipients) {
    const perms = mapRecipientPerms(row);
    if (!hasNotificationPerms(perms, 'payroll')) continue;
    const prefs = prefsMap.get(row.user_id) || { ...DEFAULT_NOTIFICATION_PREFS };
    const payrollFilters = prefs.payroll_filters || DEFAULT_NOTIFICATION_PREFS.payroll_filters;
    if (!payrollFilters.enabled) continue;
    if (
      payrollFilters.event_types &&
      payrollFilters.event_types.length &&
      !payrollFilters.event_types.includes(eventType)
    ) {
      continue;
    }

    await deliverNotificationToUser({
      orgId,
      userId: row.user_id,
      prefs,
      type: 'payroll',
      title,
      body,
      data: { ...(data || {}), event_type: eventType }
    });
  }
}

function mapNotificationPrefRow(row) {
  if (!row) {
    return {
      enabled: false,
      statuses: [],
      project_ids: [],
      shipment_ids: [],
      notify_time: '',
      remind_every_days: 1
    };
  }

  let statuses = [];
  let shipmentIds = [];
  let projectIds = [];

  try {
    const parsed = JSON.parse(row.statuses_json || '[]');
    if (Array.isArray(parsed)) statuses = parsed;
  } catch {}

  try {
    const parsed = JSON.parse(row.shipment_ids_json || '[]');
    if (Array.isArray(parsed)) shipmentIds = parsed;
  } catch {}

  try {
    const parsed = JSON.parse(row.project_ids_json || '[]');
    if (Array.isArray(parsed)) projectIds = parsed;
  } catch {}

  return {
    enabled: !!row.enabled,
    statuses,
    project_ids: projectIds,
    shipment_ids: shipmentIds,
    notify_time: row.notify_time || '',
    remind_every_days:
      row.remind_every_days != null ? Number(row.remind_every_days) || 1 : 1
  };
}

// Per-admin shipment notification preferences
app.get('/api/shipments/notifications', requireSeeShipments, async (req, res) => {
  try {
    const ctx = await getAdminContext(req, { requirePerm: 'see_shipments' });
    if (!ctx) {
      return res
        .status(403)
        .json({ error: 'Admin privileges required to manage notifications.' });
    }

    const row = await dbGet(
      `
        SELECT statuses_json, shipment_ids_json, project_ids_json, notify_time,
               remind_every_days, enabled
        FROM shipment_notification_prefs
        WHERE org_id = ? AND user_id = ?
      `,
      [ctx.orgId, ctx.user.id]
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

app.put('/api/shipments/notifications', requireSeeShipments, async (req, res) => {
  try {
    const ctx = await getAdminContext(req, { requirePerm: 'see_shipments' });
    if (!ctx) {
      return res
        .status(403)
        .json({ error: 'Admin privileges required to manage notifications.' });
    }

    const beforeRow = await dbGet(
      `
        SELECT statuses_json, shipment_ids_json, project_ids_json, notify_time,
               remind_every_days, enabled
        FROM shipment_notification_prefs
        WHERE org_id = ? AND user_id = ?
      `,
      [ctx.orgId, ctx.user.id]
    );
    const beforePref = mapNotificationPrefRow(beforeRow);

    const {
      statuses = [],
      project_ids = [],
      shipment_ids = [],
      notify_time = '',
      remind_every_days = 1,
      enabled = true
    } = req.body || {};

    const normalizedStatuses  = normalizeNotificationStatuses(statuses);
    const normalizedShipments = normalizeNotificationShipments(shipment_ids);
    const normalizedProjects  = normalizeNotificationProjects(project_ids);
    const cleanTime           = notify_time ? normalizeNotifyTime(notify_time) : '';
    const remindEveryRaw = Number(remind_every_days);
    const remindEveryDays =
      Number.isFinite(remindEveryRaw) && remindEveryRaw >= 1
        ? Math.floor(remindEveryRaw)
        : 1;

    if (notify_time && cleanTime == null) {
      return res.status(400).json({
        error: 'Notification time must be in HH:MM (24-hour) format.'
      });
    }

    await dbRun(
      `
        INSERT INTO shipment_notification_prefs (
          org_id,
          user_id,
          employee_id,
          statuses_json,
          shipment_ids_json,
          project_ids_json,
          notify_time,
          remind_every_days,
          enabled,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(org_id, user_id) DO UPDATE SET
          employee_id       = excluded.employee_id,
          statuses_json     = excluded.statuses_json,
          shipment_ids_json = excluded.shipment_ids_json,
          project_ids_json  = excluded.project_ids_json,
          notify_time       = excluded.notify_time,
          remind_every_days = excluded.remind_every_days,
          enabled           = excluded.enabled,
          updated_at        = datetime('now')
      `,
      [
        ctx.orgId,
        ctx.user.id,
        ctx.employee.id,
        JSON.stringify(normalizedStatuses),
        JSON.stringify(normalizedShipments),
        JSON.stringify(normalizedProjects),
        cleanTime || null,
        remindEveryDays,
        enabled ? 1 : 0
      ]
    );

    const nextPref = {
      enabled: !!enabled,
      statuses: normalizedStatuses,
      project_ids: normalizedProjects,
      shipment_ids: normalizedShipments,
      notify_time: cleanTime || '',
      remind_every_days: remindEveryDays
    };

    if (JSON.stringify(beforePref) !== JSON.stringify(nextPref)) {
      await logAuditEvent({
        req,
        orgId: ctx.orgId,
        action: 'notification.shipment_pref.update',
        entityType: 'user',
        entityId: ctx.user.id,
        before: beforePref,
        after: nextPref
      });
    }

    res.json({
      ok: true,
      preference: nextPref
    });
  } catch (err) {
    console.error('Error saving shipment notification prefs:', err);
    res.status(500).json({
      error: 'Error saving shipment notification preferences.'
    });
  }
});

// In-app notifications feed
app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const orgId = req.session && req.session.orgId;
    const userId = req.session && req.session.userId;
    if (!orgId || !userId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    let limit = Number(req.query.limit || 50);
    if (!Number.isFinite(limit) || limit <= 0 || limit > 200) limit = 50;
    const beforeId = Number(req.query.before_id || 0);
    const unreadOnly =
      req.query.unread_only === '1' ||
      req.query.unread_only === 'true' ||
      req.query.unread_only === true;

    const params = [orgId, userId];
    let where = 'WHERE org_id = ? AND user_id = ?';

    if (beforeId) {
      where += ' AND id < ?';
      params.push(beforeId);
    }
    if (unreadOnly) {
      where += ' AND read_at IS NULL';
    }

    const rows = await dbAll(
      `
        SELECT id, type, title, body, data_json, read_at, created_at
        FROM notifications
        ${where}
        ORDER BY id DESC
        LIMIT ?
      `,
      [...params, limit]
    );

    const notifications = (rows || []).map(row => {
      let data = null;
      if (row.data_json) {
        try {
          data = JSON.parse(row.data_json);
        } catch {
          data = null;
        }
      }
      return {
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        data,
        read_at: row.read_at,
        created_at: row.created_at
      };
    });

    const nextBeforeId =
      notifications.length === limit
        ? notifications[notifications.length - 1].id
        : null;

    res.json({ notifications, next_before_id: nextBeforeId });
  } catch (err) {
    console.error('Error loading notifications:', err);
    res.status(500).json({ error: 'Failed to load notifications.' });
  }
});

app.post('/api/notifications/mark-read', requireAuth, async (req, res) => {
  try {
    const orgId = req.session && req.session.orgId;
    const userId = req.session && req.session.userId;
    if (!orgId || !userId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    const { ids = [], all = false } = req.body || {};
    let updated = 0;

    if (all) {
      const result = await dbRun(
        `
          UPDATE notifications
          SET read_at = datetime('now')
          WHERE org_id = ? AND user_id = ? AND read_at IS NULL
        `,
        [orgId, userId]
      );
      updated = result?.changes || 0;
    } else {
      const list = Array.isArray(ids) ? ids : [];
      const cleaned = list
        .map(id => Number(id))
        .filter(id => Number.isInteger(id) && id > 0);
      if (cleaned.length) {
        const placeholders = cleaned.map(() => '?').join(',');
        const result = await dbRun(
          `
            UPDATE notifications
            SET read_at = datetime('now')
            WHERE org_id = ? AND user_id = ? AND id IN (${placeholders})
          `,
          [orgId, userId, ...cleaned]
        );
        updated = result?.changes || 0;
      }
    }

    res.json({ ok: true, updated });
  } catch (err) {
    console.error('Error marking notifications read:', err);
    res.status(500).json({ error: 'Failed to update notifications.' });
  }
});

app.post('/api/notifications/test', requireAuth, async (req, res) => {
  try {
    const orgId = req.session && req.session.orgId;
    const userId = req.session && req.session.userId;
    if (!orgId || !userId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    const { channels = [], title, body } = req.body || {};
    const normalizedChannels = Array.isArray(channels)
      ? channels
          .map(c => String(c || '').trim().toLowerCase())
          .filter(Boolean)
      : [];
    const finalChannels = normalizedChannels.length
      ? normalizedChannels
      : ['in_app'];

    const prefs = await loadNotificationPrefs(orgId, userId);
    const result = await deliverNotificationToUser({
      orgId,
      userId,
      prefs,
      type: 'test',
      title: title || 'Test notification',
      body: body || 'This is a test notification from Avian.',
      data: { test: true },
      channels: finalChannels
    });

    await logAuditEvent({
      req,
      orgId,
      action: 'notification.test.sent',
      entityType: 'user',
      entityId: userId,
      after: {
        channels: finalChannels,
        title: title || 'Test notification'
      }
    });

    res.json({
      ok: true,
      results: result.results || { in_app: 'sent' }
    });
  } catch (err) {
    console.error('Error sending test notification:', err);
    res.status(500).json({ error: 'Failed to send test notification.' });
  }
});

app.get('/api/notifications/prefs', requireAuth, async (req, res) => {
  try {
    const orgId = req.session && req.session.orgId;
    const userId = req.session && req.session.userId;
    if (!orgId || !userId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    const prefs = await loadNotificationPrefs(orgId, userId);
    res.json({
      prefs,
      push_public_key: VAPID_PUBLIC_KEY || '',
      config: {
        email_configured: smtpConfigured,
        push_configured: pushConfigured,
        apns_configured: apnsConfigured,
        apns_supported: false
      }
    });
  } catch (err) {
    console.error('Error loading notification prefs:', err);
    res.status(500).json({ error: 'Failed to load notification prefs.' });
  }
});

app.put('/api/notifications/prefs', requireAuth, async (req, res) => {
  try {
    const orgId = req.session && req.session.orgId;
    const userId = req.session && req.session.userId;
    if (!orgId || !userId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    const beforePrefs = await loadNotificationPrefs(orgId, userId);
    const normalized = normalizeNotificationPrefsPayload(req.body || {});
    if (req.body?.remind_time && normalized.remind_time == null) {
      return res.status(400).json({
        error: 'remind_time must be in HH:MM (24-hour) format.'
      });
    }
    if (req.body?.clockout_time && normalized.clockout_time == null) {
      return res.status(400).json({
        error: 'clockout_time must be in HH:MM (24-hour) format.'
      });
    }

    const prefs = await upsertNotificationPrefs(orgId, userId, normalized);
    if (JSON.stringify(beforePrefs) !== JSON.stringify(prefs)) {
      await logAuditEvent({
        req,
        orgId,
        action: 'notification.pref.update',
        entityType: 'user',
        entityId: userId,
        before: beforePrefs,
        after: prefs
      });
    }
    res.json({ ok: true, prefs });
  } catch (err) {
    console.error('Error saving notification prefs:', err);
    res.status(500).json({ error: 'Failed to save notification prefs.' });
  }
});

app.post('/api/notifications/push/subscribe', requireAuth, async (req, res) => {
  try {
    const orgId = req.session && req.session.orgId;
    const userId = req.session && req.session.userId;
    const { endpoint, p256dh, auth, user_agent } = req.body || {};

    if (!orgId || !userId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({ error: 'endpoint, p256dh, and auth are required.' });
    }

    let endpointHost = null;
    try {
      endpointHost = new URL(endpoint).host || null;
    } catch {}

    await dbRun(
      `
        INSERT INTO push_subscriptions (
          org_id, user_id, endpoint, p256dh, auth, user_agent, created_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), NULL)
        ON CONFLICT(org_id, user_id, endpoint) DO UPDATE SET
          p256dh = excluded.p256dh,
          auth = excluded.auth,
          user_agent = excluded.user_agent,
          revoked_at = NULL
      `,
      [orgId, userId, endpoint, p256dh, auth, user_agent || null]
    );

    await logAuditEvent({
      req,
      orgId,
      action: 'notification.push.subscribe',
      entityType: 'user',
      entityId: userId,
      after: {
        endpoint_host: endpointHost,
        user_agent: user_agent || null
      }
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Error saving push subscription:', err);
    res.status(500).json({ error: 'Failed to save push subscription.' });
  }
});

app.post('/api/notifications/push/unsubscribe', requireAuth, async (req, res) => {
  try {
    const orgId = req.session && req.session.orgId;
    const userId = req.session && req.session.userId;
    const { endpoint } = req.body || {};

    if (!orgId || !userId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    if (!endpoint) {
      return res.status(400).json({ error: 'endpoint is required.' });
    }

    let endpointHost = null;
    try {
      endpointHost = new URL(endpoint).host || null;
    } catch {}

    await dbRun(
      `
        UPDATE push_subscriptions
        SET revoked_at = datetime('now')
        WHERE org_id = ? AND user_id = ? AND endpoint = ?
      `,
      [orgId, userId, endpoint]
    );

    await logAuditEvent({
      req,
      orgId,
      action: 'notification.push.unsubscribe',
      entityType: 'user',
      entityId: userId,
      after: {
        endpoint_host: endpointHost
      }
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Error removing push subscription:', err);
    res.status(500).json({ error: 'Failed to remove push subscription.' });
  }
});


app.post('/api/shipments', requireSeeShipments, async (req, res) => {
  let transactionStarted = false;
  try {
    const orgId = req.session && req.session.orgId;
    const createdBy = req.session && req.session.employeeId
      ? req.session.employeeId
      : null;
    const canViewPayroll = !!(req.adminPerms && req.adminPerms.view_payroll);

    if (!orgId) {
      return res.status(401).json({ error: 'Not authenticated.' });
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
      is_container,
      items,

      // STORAGE / PICKUP FIELDS
      storage_due_date,
      storage_daily_late_fee,
      picked_up_by,
      picked_up_date,

      // PAYMENT FLAGS + AMOUNTS (snake_case from client)
      vendor_paid,
      vendor_paid_amount,
      shipper_paid,
      shipper_paid_amount,
      shipper_paid_by,
      customs_paid,
      customs_paid_amount,
      customs_paid_by,
      storage_paid,
      storage_paid_amount,
      storage_paid_by,

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

    // Snapshot project/vendor names so shipments stay readable if QBO sync is unavailable
    const projectRow = await dbGet(
      'SELECT name FROM projects WHERE id = ? AND org_id = ? LIMIT 1',
      [project_id, orgId]
    );
    if (!projectRow) {
      return res.status(400).json({ error: 'Project not found.' });
    }
    const projectNameSnapshot = projectRow?.name || null;

    let finalVendorName = vendor_name || null;
    if (vendor_id) {
      const vendorRow = await dbGet(
        'SELECT name FROM vendors WHERE id = ? AND org_id = ? LIMIT 1',
        [vendor_id, orgId]
      );
      if (!vendorRow) {
        return res.status(400).json({ error: 'Vendor not found.' });
      }
      finalVendorName = vendorRow?.name || null;
    }

    let itemsVerifiedFlag;
    if (items_verified !== undefined && items_verified !== null) {
      itemsVerifiedFlag = coerceBooleanFlag(items_verified) ? 1 : 0;
    } else {
      itemsVerifiedFlag = computeItemsVerifiedFlagFromItems(items);
    }

    // Normalize status (allow custom statuses)
    let initialStatus = 'Pre-Order';
    if (status && typeof status === 'string') {
      const trimmed = status.trim();
      if (trimmed) initialStatus = trimmed;
    }

    const isContainerFlag = coerceBooleanFlag(is_container) ? 1 : 0;

    let resolvedStorageDailyLateFee = storage_daily_late_fee;
    if (resolvedStorageDailyLateFee == null) {
      const defaultKey = isContainerFlag
        ? 'storage_container_daily_late_fee_default'
        : 'storage_daily_late_fee_default';
      const defaultFeeRaw = await loadOrgSettingValue(orgId, defaultKey);
      const defaultFee = defaultFeeRaw != null ? Number(defaultFeeRaw) : NaN;
      resolvedStorageDailyLateFee =
        Number.isFinite(defaultFee) && defaultFee >= 0 ? defaultFee : null;
    }
    if (!canViewPayroll) {
      resolvedStorageDailyLateFee = null;
    }

    const normalizePaidBy = (val) => {
      if (val == null) return null;
      const s = String(val).trim();
      if (!s) return null;
      if (/^other\s*:?\s*$/i.test(s)) return null;
      return s;
    };

    const shipperPaidFlag = canViewPayroll && shipper_paid ? 1 : 0;
    const customsPaidFlag = canViewPayroll && customs_paid ? 1 : 0;
    const storagePaidFlag = canViewPayroll && storage_paid ? 1 : 0;
    const normalizedShipperPaidBy = normalizePaidBy(shipper_paid_by);
    const normalizedCustomsPaidBy = normalizePaidBy(customs_paid_by);
    const normalizedStoragePaidBy = normalizePaidBy(storage_paid_by);

    if (shipperPaidFlag && !normalizedShipperPaidBy) {
      return res.status(400).json({
        error: 'Freight forwarder paid by is required when marked paid.'
      });
    }

    if (customsPaidFlag && !normalizedCustomsPaidBy) {
      return res.status(400).json({
        error: 'Customs/Clearing paid by is required when marked paid.'
      });
    }
    if (storagePaidFlag && !normalizedStoragePaidBy) {
      return res.status(400).json({
        error: 'Storage fees paid by is required when marked paid.'
      });
    }



    // ───────── INSERT INTO shipments ─────────
    await dbRun('BEGIN TRANSACTION');
    transactionStarted = true;

    const result = await dbRun(
      `
            INSERT INTO shipments (
        org_id,
        title,
        po_number,
        vendor_id,
        destination,
        project_id,
        project_name_snapshot,
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
        is_container,
        storage_due_date,
        storage_daily_late_fee,
        picked_up_by,
        picked_up_date,
        picked_up_updated_by,
        picked_up_updated_at,
        vendor_paid,
        vendor_paid_amount,
        shipper_paid,
        shipper_paid_amount,
        shipper_paid_by,
        customs_paid,
        customs_paid_amount,
        customs_paid_by,
        storage_paid,
        storage_paid_amount,
        storage_paid_by,
        total_paid,
        items_verified,
        verified_by,
        verification_notes,
        website_url,
        notes,
        status,
        created_by,
        created_at,
        updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )

      `,
            [
        orgId,
        title,
        po_number || null,
        vendor_id || null,
        destination || null,
        project_id || null,
        projectNameSnapshot || null,
        sku || null,
        finalVendorName || null,
        freight_forwarder || null,
        quantity != null ? quantity : null,
        canViewPayroll && total_price != null ? total_price : null,
        canViewPayroll && price_per_item != null ? price_per_item : null,
        expected_ship_date || null,
        expected_arrival_date || null,
        tracking_number || null,
        bol_number || null,
        isContainerFlag,
        storage_due_date || null,
        canViewPayroll && resolvedStorageDailyLateFee != null ? resolvedStorageDailyLateFee : null,
        picked_up_by || null,
        picked_up_date || null,
        null,
        null,
        canViewPayroll && vendor_paid ? 1 : 0,
        canViewPayroll && vendor_paid_amount != null ? vendor_paid_amount : null,
        shipperPaidFlag,
        canViewPayroll && shipper_paid_amount != null ? shipper_paid_amount : null,
        shipperPaidFlag ? normalizedShipperPaidBy : null,
        customsPaidFlag,
        canViewPayroll && customs_paid_amount != null ? customs_paid_amount : null,
        customsPaidFlag ? normalizedCustomsPaidBy : null,
        storagePaidFlag,
        canViewPayroll && storage_paid_amount != null ? storage_paid_amount : null,
        storagePaidFlag ? normalizedStoragePaidBy : null,
        canViewPayroll && total_paid != null ? total_paid : null,
        itemsVerifiedFlag ? 1 : 0, 
        verified_by || null,
        verification_notes || null,
        website_url || null,
        notes || null,
        initialStatus,
        createdBy,
        new Date().toISOString(),
        new Date().toISOString()
      ]
    );

    const id = result.lastID;

        // ───────── INSERT LINE ITEMS ─────────
    if (Array.isArray(items) && items.length > 0) {
      for (const it of items) {
        await dbRun(
  `
    INSERT INTO shipment_items (
  org_id,
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
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
[
  orgId,
  id,
  it.description || null,
  it.sku || null,
  it.quantity != null ? it.quantity : 0,
  canViewPayroll && it.unit_price != null ? it.unit_price : null,
  canViewPayroll && it.line_total != null ? it.line_total : null,
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


    if (initialStatus === 'Archived') {
      await dbRun(
        `
          UPDATE shipments
          SET is_archived = 1,
              archived_at = datetime('now')
          WHERE id = ? AND org_id = ?
        `,
        [id, orgId]
      );
    }

    // ───────── STATUS HISTORY ─────────
    await dbRun(
      `
      INSERT INTO shipment_status_history (
        org_id, shipment_id, old_status, new_status, changed_at
      ) VALUES (?, ?, NULL, ?, datetime('now'))
      `,
      [orgId, id, initialStatus]
    );

    // ───────── TIMELINE ─────────
    await dbRun(
      `
      INSERT INTO shipment_timeline (
        org_id, shipment_id, event_type, old_status, new_status, note, created_by, created_at
      ) VALUES (?, ?, 'status_change', NULL, ?, 'Shipment created.', ?, datetime('now'))
      `,
      [orgId, id, initialStatus, createdBy]
    );

    // ───────── COMMIT ─────────
    await dbRun('COMMIT');
    transactionStarted = false;

    // ───────── RETURN ROW ─────────
    const row = await dbGet(
      'SELECT * FROM shipments WHERE id = ? AND org_id = ?',
      [id, orgId]
    );

    const auditAfter = row ? { ...row } : null;
    if (auditAfter && Array.isArray(items) && items.length) {
      auditAfter.items = items;
    }
    await logAuditEvent({
      req,
      orgId,
      action: 'shipment.create',
      entityType: 'shipment',
      entityId: id,
      after: auditAfter,
      note: 'Shipment created.'
    });

    const responseShipment = canViewPayroll ? row : stripShipmentMoney(row);
    res.json({ shipment: responseShipment });

  } catch (err) {
    if (transactionStarted) {
      try {
        await dbRun('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Shipment create rollback error:', rollbackErr);
      }
    }
    console.error('Error creating shipment:', err);
    res.status(500).json({ error: 'Error creating shipment.' });
  }
});


app.get('/api/shipments', requireSeeShipments, async (req, res) => {

  try {
    const {
      search = '',
      status = '',
      project_id = '',
      vendor_id = '',
      limit = ''
    } = req.query || {};

    const orgId = req.session && req.session.orgId;
    if (!orgId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    const params = [orgId];
    let where = 'WHERE s.org_id = ? ';

    const limitVal = Number.parseInt(limit, 10);
    const safeLimit =
      Number.isFinite(limitVal) && limitVal > 0
        ? Math.min(limitVal, 200)
        : null;

    if (status && status === 'Archived') {
      where += 'AND IFNULL(s.is_archived, 0) = 1 ';
    } else {
      where += 'AND IFNULL(s.is_archived, 0) = 0 ';
    }

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
    if (status && status !== 'Archived') {
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

    const limitClause = safeLimit ? ` LIMIT ${safeLimit}` : '';

    const rows = await dbAll(
      `
      SELECT
        s.*,
        COALESCE(s.vendor_name, v.name) AS vendor_name,
        COALESCE(s.project_name_snapshot, p.name) AS project_name,
        p.customer_name,
        EXISTS(
          SELECT 1
          FROM shipment_documents d
          WHERE d.shipment_id = s.id
            AND d.org_id = s.org_id
            AND (
              lower(trim(IFNULL(d.doc_type, ''))) IN (
                'shippers invoice',
                'shipper invoice',
                'shipper''s invoice'
              )
              OR lower(trim(IFNULL(d.doc_label, ''))) IN (
                'shippers invoice',
                'shipper invoice',
                'shipper''s invoice'
              )
            )
        ) AS has_shippers_invoice_doc,
        EXISTS(
          SELECT 1
          FROM shipment_documents d
          WHERE d.shipment_id = s.id
            AND d.org_id = s.org_id
            AND (
              lower(trim(IFNULL(d.doc_type, ''))) IN ('bol', 'bill of lading')
              OR lower(trim(IFNULL(d.doc_label, ''))) IN ('bol', 'bill of lading')
            )
        ) AS has_bol_doc
      FROM shipments s
      LEFT JOIN vendors  v ON v.id = s.vendor_id AND v.org_id = s.org_id
      LEFT JOIN projects p ON p.id = s.project_id AND p.org_id = s.org_id
      ${where}
      ORDER BY
        IFNULL(s.updated_at, s.created_at) DESC,
        s.created_at DESC
      ${limitClause}
      `,
      params
    );

    const canViewPayments = !!(req.adminPerms && req.adminPerms.view_payroll);
    const visibleRows = !canViewPayments
      ? (rows || []).map(row => stripShipmentMoney(row))
      : (rows || []);

    const shipmentsByStatus = {};
    let statuses = [];

    if (status && status === 'Archived') {
      shipmentsByStatus.Archived = visibleRows || [];
      statuses = ['Archived'];
    } else {
      // Initialize known columns from your constant, so empty columns still show
      SHIPMENT_STATUSES.forEach(st => {
        shipmentsByStatus[st] = [];
      });

      const extraStatuses = new Set();

      visibleRows.forEach(row => {
        const st = row.status || 'Pre-Order';

        if (!SHIPMENT_STATUSES.includes(st)) {
          extraStatuses.add(st);
          if (!shipmentsByStatus[st]) {
            shipmentsByStatus[st] = [];
          }
        }

        shipmentsByStatus[st].push(row);
      });

      statuses = [
        ...SHIPMENT_STATUSES,
        ...Array.from(extraStatuses).filter(s => !SHIPMENT_STATUSES.includes(s))
      ];
    }

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

app.put('/api/shipments/:id', requireSeeShipments, async (req, res) => {
  let transactionStarted = false;
  try {
    const id = req.params.id;
    const orgId = req.session && req.session.orgId;
    const actorId = req.session && req.session.employeeId
      ? req.session.employeeId
      : null;
    const canViewPayroll = !!(req.adminPerms && req.adminPerms.view_payroll);

    if (!orgId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    const body = req.body || {};

    const existing = await dbGet(
      'SELECT * FROM shipments WHERE id = ? AND org_id = ?',
      [id, orgId]
    );
    if (!existing) {
      return res.status(404).json({ error: 'Shipment not found.' });
    }

    const {
      client_id,
      if_match_updated_at,
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
      is_container,
      items,
      storage_due_date,
      storage_daily_late_fee,
      picked_up_by,
      picked_up_date,
      vendor_paid,
      vendor_paid_amount,
      shipper_paid,
      shipper_paid_amount,
      shipper_paid_by,
      customs_paid,
      customs_paid_amount,
      customs_paid_by,
      storage_paid,
      storage_paid_amount,
      storage_paid_by,
      total_paid,
      items_verified,
      verified_by,
      verification_notes,
      website_url,
      notes,
      status
    } = body;

    const clientId = client_id ? String(client_id).trim() : '';
    const itemsProvided = Object.prototype.hasOwnProperty.call(body, 'items');
    if (clientId) {
      const cached = await loadIdempotentResponse(orgId, 'shipment_update', clientId);
      if (cached) {
        return res.json({ ...cached, alreadyProcessed: true });
      }
    }

    if (if_match_updated_at && existing.updated_at && existing.updated_at !== if_match_updated_at) {
      return res.status(409).json({
        error: 'Conflict: the shipment was updated since you last loaded it.',
        current: pickFields(existing, [
          'id',
          'title',
          'status',
          'project_id',
          'vendor_id',
          'updated_at'
        ])
      });
    }

    // ───────── BASIC VALIDATION ─────────
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Shipment name/title is required.' });
    }

    if (!project_id) {
      return res.status(400).json({ error: 'Project is required.' });
    }

    // Snapshot project/vendor names to keep shipment readable when QBO data is unavailable
    const projectRow = project_id
      ? await dbGet('SELECT name FROM projects WHERE id = ? AND org_id = ? LIMIT 1', [
          project_id,
          orgId
        ])
      : null;
    if (!projectRow) {
      return res.status(400).json({ error: 'Project not found.' });
    }
    const projectNameSnapshot =
      projectRow?.name || existing.project_name_snapshot || null;

    const vendorIdProvided = Object.prototype.hasOwnProperty.call(
      body,
      'vendor_id'
    );
    const vendorNameProvided = Object.prototype.hasOwnProperty.call(
      body,
      'vendor_name'
    );
    const normalizedVendorId =
      vendor_id === undefined || vendor_id === null || vendor_id === ''
        ? null
        : vendor_id;
    const finalVendorId = vendorIdProvided
      ? normalizedVendorId
      : existing.vendor_id || null;

    let finalVendorName = vendorNameProvided ? (vendor_name || null) : null;
    if (finalVendorId) {
      const vendorRow = await dbGet(
        'SELECT name FROM vendors WHERE id = ? AND org_id = ? LIMIT 1',
        [finalVendorId, orgId]
      );
      if (!vendorRow) {
        return res.status(400).json({ error: 'Vendor not found.' });
      }
      finalVendorName = vendorRow?.name || null;
    }
    if (!vendorIdProvided && !vendorNameProvided && !finalVendorName) {
      finalVendorName = existing.vendor_name || null;
    }

    // ───────── STATUS NORMALIZATION ─────────
    const oldStatus = existing.status || null;

    let newStatus = existing.status || 'Pre-Order';
    if (status && typeof status === 'string') {
      const trimmed = status.trim();
      if (trimmed) {
        newStatus = trimmed;
      }
    }

    const isContainerProvided = Object.prototype.hasOwnProperty.call(
      body,
      'is_container'
    );
    const nextIsContainer = isContainerProvided
      ? (coerceBooleanFlag(is_container) ? 1 : 0)
      : (existing.is_container ? 1 : 0);

    const nowIso = new Date().toISOString();

    const normalizeText = (val) => {
      if (val === undefined || val === null) return null;
      const s = String(val).trim();
      return s === '' ? null : s;
    };
    const normalizePaidBy = (val) => {
      const s = normalizeText(val);
      if (!s) return null;
      if (/^other\s*:?\s*$/i.test(s)) return null;
      return s;
    };

    const vendorPaidProvided = Object.prototype.hasOwnProperty.call(
      body,
      'vendor_paid'
    );
    const storageDailyFeeProvided = Object.prototype.hasOwnProperty.call(
      body,
      'storage_daily_late_fee'
    );
    const vendorPaidAmountProvided = Object.prototype.hasOwnProperty.call(
      body,
      'vendor_paid_amount'
    );
    const shipperPaidProvided = Object.prototype.hasOwnProperty.call(
      body,
      'shipper_paid'
    );
    const shipperPaidAmountProvided = Object.prototype.hasOwnProperty.call(
      body,
      'shipper_paid_amount'
    );
    const customsPaidProvided = Object.prototype.hasOwnProperty.call(
      body,
      'customs_paid'
    );
    const customsPaidAmountProvided = Object.prototype.hasOwnProperty.call(
      body,
      'customs_paid_amount'
    );
    const storagePaidProvided = Object.prototype.hasOwnProperty.call(
      body,
      'storage_paid'
    );
    const storagePaidAmountProvided = Object.prototype.hasOwnProperty.call(
      body,
      'storage_paid_amount'
    );
    const totalPaidProvided = Object.prototype.hasOwnProperty.call(
      body,
      'total_paid'
    );

    const shipperPaidByProvided = Object.prototype.hasOwnProperty.call(
      body,
      'shipper_paid_by'
    );
    const customsPaidByProvided = Object.prototype.hasOwnProperty.call(
      body,
      'customs_paid_by'
    );
    const storagePaidByProvided = Object.prototype.hasOwnProperty.call(
      body,
      'storage_paid_by'
    );
    const resolvedShipperPaidBy = shipperPaidByProvided
      ? normalizePaidBy(shipper_paid_by)
      : existing.shipper_paid_by;
    const resolvedCustomsPaidBy = customsPaidByProvided
      ? normalizePaidBy(customs_paid_by)
      : existing.customs_paid_by;
    const resolvedStoragePaidBy = storagePaidByProvided
      ? normalizePaidBy(storage_paid_by)
      : existing.storage_paid_by;

    const hasPickedBy = Object.prototype.hasOwnProperty.call(body, 'picked_up_by');
    const hasPickedDate = Object.prototype.hasOwnProperty.call(body, 'picked_up_date');
    const updatingPickup = hasPickedBy || hasPickedDate;

    const nextPickedUpBy = hasPickedBy
      ? normalizeText(picked_up_by)
      : existing.picked_up_by;
    const nextPickedUpDate = hasPickedDate
      ? normalizeText(picked_up_date)
      : existing.picked_up_date;

    let pickupUpdaterName = null;
    let updatePickupMeta = false;
    if (updatingPickup && actorId) {
      const emp = await dbGet(
        `SELECT nickname, name FROM employees WHERE id = ? AND org_id = ?`,
        [actorId, orgId]
      );
      if (emp) {
        pickupUpdaterName = emp.nickname || emp.name || null;
        updatePickupMeta = true;
      }
    }

    const nextTotalPrice = canViewPayroll
      ? (total_price != null ? total_price : null)
      : existing.total_price;
    const nextPricePerItem = canViewPayroll
      ? (price_per_item != null ? price_per_item : null)
      : existing.price_per_item;
    let nextStorageDailyLateFee = canViewPayroll
      ? (storageDailyFeeProvided
        ? (storage_daily_late_fee != null ? storage_daily_late_fee : null)
        : existing.storage_daily_late_fee)
      : existing.storage_daily_late_fee;
    if (
      canViewPayroll &&
      !storageDailyFeeProvided &&
      isContainerProvided &&
      existing.storage_daily_late_fee == null
    ) {
      const defaultKey = nextIsContainer
        ? 'storage_container_daily_late_fee_default'
        : 'storage_daily_late_fee_default';
      const defaultFeeRaw = await loadOrgSettingValue(orgId, defaultKey);
      const defaultFee = defaultFeeRaw != null ? Number(defaultFeeRaw) : NaN;
      nextStorageDailyLateFee =
        Number.isFinite(defaultFee) && defaultFee >= 0 ? defaultFee : null;
    }
    const nextVendorPaid = canViewPayroll
      ? (vendorPaidProvided ? (vendor_paid ? 1 : 0) : existing.vendor_paid)
      : existing.vendor_paid;
    const nextVendorPaidAmount = canViewPayroll
      ? (vendorPaidAmountProvided
        ? (vendor_paid_amount != null ? vendor_paid_amount : null)
        : existing.vendor_paid_amount)
      : existing.vendor_paid_amount;
    const nextShipperPaid = canViewPayroll
      ? (shipperPaidProvided ? (shipper_paid ? 1 : 0) : existing.shipper_paid)
      : existing.shipper_paid;
    const nextShipperPaidAmount = canViewPayroll
      ? (shipperPaidAmountProvided
        ? (shipper_paid_amount != null ? shipper_paid_amount : null)
        : existing.shipper_paid_amount)
      : existing.shipper_paid_amount;
    const nextCustomsPaid = canViewPayroll
      ? (customsPaidProvided ? (customs_paid ? 1 : 0) : existing.customs_paid)
      : existing.customs_paid;
    const nextCustomsPaidAmount = canViewPayroll
      ? (customsPaidAmountProvided
        ? (customs_paid_amount != null ? customs_paid_amount : null)
        : existing.customs_paid_amount)
      : existing.customs_paid_amount;
    const nextStoragePaid = canViewPayroll
      ? (storagePaidProvided ? (storage_paid ? 1 : 0) : existing.storage_paid)
      : existing.storage_paid;
    const nextStoragePaidAmount = canViewPayroll
      ? (storagePaidAmountProvided
        ? (storage_paid_amount != null ? storage_paid_amount : null)
        : existing.storage_paid_amount)
      : existing.storage_paid_amount;
    const nextStoragePaidBy = canViewPayroll
      ? (storagePaidByProvided ? resolvedStoragePaidBy : existing.storage_paid_by)
      : existing.storage_paid_by;
    const nextShipperPaidBy = canViewPayroll
      ? (shipperPaidByProvided ? resolvedShipperPaidBy : existing.shipper_paid_by)
      : existing.shipper_paid_by;
    const nextCustomsPaidBy = canViewPayroll
      ? (customsPaidByProvided ? resolvedCustomsPaidBy : existing.customs_paid_by)
      : existing.customs_paid_by;
    const nextTotalPaid = canViewPayroll
      ? (totalPaidProvided ? (total_paid != null ? total_paid : null) : existing.total_paid)
      : existing.total_paid;

    const shouldValidateShipperPaidBy =
      shipperPaidProvided || shipperPaidAmountProvided || shipperPaidByProvided;
    const shouldValidateCustomsPaidBy =
      customsPaidProvided || customsPaidAmountProvided || customsPaidByProvided;
    const shouldValidateStoragePaidBy =
      storagePaidProvided || storagePaidAmountProvided || storagePaidByProvided;

    if (canViewPayroll && shouldValidateShipperPaidBy && nextShipperPaid && !nextShipperPaidBy) {
      return res.status(400).json({
        error: 'Freight forwarder paid by is required when marked paid.'
      });
    }

    if (canViewPayroll && shouldValidateCustomsPaidBy && nextCustomsPaid && !nextCustomsPaidBy) {
      return res.status(400).json({
        error: 'Customs/Clearing paid by is required when marked paid.'
      });
    }
    if (canViewPayroll && shouldValidateStoragePaidBy && nextStoragePaid && !nextStoragePaidBy) {
      return res.status(400).json({
        error: 'Storage fees paid by is required when marked paid.'
      });
    }

    let nextIsArchived = existing.is_archived ? 1 : 0;
    let nextArchivedAt = existing.archived_at || null;
    if (newStatus === 'Archived') {
      nextIsArchived = 1;
      nextArchivedAt = existing.archived_at || nowIso;
    } else if (existing.is_archived) {
      nextIsArchived = 0;
      nextArchivedAt = null;
    }

    // ───────── ITEMS_VERIFIED FLAG (initial value for UPDATE) ─────────
    let itemsVerifiedFlag;

    if (items_verified !== undefined && items_verified !== null) {
      // Explicit override from client
      itemsVerifiedFlag = coerceBooleanFlag(items_verified) ? 1 : 0;
    } else if (canViewPayroll && itemsProvided && Array.isArray(items) && items.length > 0) {
      // Infer from line items in this request (payroll-enabled editors only)
      itemsVerifiedFlag = computeItemsVerifiedFlagFromItems(items);
    } else {
      // No explicit value and no editable items → keep existing DB value
      itemsVerifiedFlag = existing.items_verified ? 1 : 0;
    }


    // ───────── UPDATE SHIPMENT CORE FIELDS ─────────

    await dbRun('BEGIN TRANSACTION');
    transactionStarted = true;

    await dbRun(
      `
        UPDATE shipments
        SET
          title                 = ?,
          po_number             = ?,
        vendor_id             = ?,
          destination           = ?,
          project_id            = ?,
          project_name_snapshot = ?,
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
          is_container          = ?,
          storage_due_date      = ?,
          storage_daily_late_fee = ?,
          picked_up_by          = ?,
          picked_up_date        = ?,
          picked_up_updated_by  = CASE WHEN ? THEN ? ELSE picked_up_updated_by END,
          picked_up_updated_at  = CASE WHEN ? THEN datetime('now') ELSE picked_up_updated_at END,
          vendor_paid           = ?,
          vendor_paid_amount    = ?,
          shipper_paid          = ?,
          shipper_paid_amount   = ?,
          shipper_paid_by       = ?,
          customs_paid          = ?,
          customs_paid_amount   = ?,
          customs_paid_by       = ?,
          storage_paid          = ?,
          storage_paid_amount   = ?,
          storage_paid_by       = ?,
          total_paid            = ?,
          items_verified        = ?,   -- initial value, may be auto-updated later
          verified_by           = ?,
          verification_notes    = ?,
          website_url           = ?,
          notes                 = ?,
          status                = ?,
          is_archived           = ?,
          archived_at           = ?,
          updated_at            = ?
        WHERE id = ? AND org_id = ?
      `,
      [
        title,
        po_number || null,
        finalVendorId,
        destination || null,
        project_id || null,
        projectNameSnapshot || null,
        sku || null,
        finalVendorName || null,
        freight_forwarder || null,
        quantity != null ? quantity : null,
        nextTotalPrice,
        nextPricePerItem,
        expected_ship_date || null,
        expected_arrival_date || null,
        tracking_number || null,
        bol_number || null,
        nextIsContainer,
        storage_due_date || null,
        nextStorageDailyLateFee,
        nextPickedUpBy,
        nextPickedUpDate,
        updatePickupMeta ? 1 : 0,
        pickupUpdaterName,
        updatePickupMeta ? 1 : 0,
        nextVendorPaid,
        nextVendorPaidAmount,
        nextShipperPaid,
        nextShipperPaidAmount,
        nextShipperPaidBy,
        nextCustomsPaid,
        nextCustomsPaidAmount,
        nextCustomsPaidBy,
        nextStoragePaid,
        nextStoragePaidAmount,
        nextStoragePaidBy,
        nextTotalPaid,
        itemsVerifiedFlag,
        verified_by || null,
        verification_notes || null,
        website_url || null,
        notes || null,
        newStatus,
        nextIsArchived,
        nextArchivedAt,
        nowIso,
        id,
        orgId
      ]
    );

    /* ───────── REPLACE LINE ITEMS ───────── */

    if (canViewPayroll && itemsProvided) {
      const normalizedItems = Array.isArray(items) ? items : [];
      //
      // 1. Remove existing items for this shipment
      //
      await dbRun(
        `DELETE FROM shipment_items WHERE shipment_id = ? AND org_id = ?`,
        [id, orgId]
      );

      //
      // 2. Insert the new items
      //
      let allVerified = true; // used for auto items_verified on parent

      if (normalizedItems.length > 0) {
        for (const it of normalizedItems) {
          const verificationObj = it.verification || null;
          const itemStatus = verificationObj?.status || '';

          // Track auto "items_verified" flag
          if (itemStatus !== 'verified') {
            allVerified = false;
          }

          await dbRun(
            `
             INSERT INTO shipment_items (
    org_id,
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
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
    orgId,
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
            WHERE id = ? AND org_id = ?
          `,
          [allVerified ? 1 : 0, id, orgId]
        );
      }
    }

    //
    // 3. Auto-update parent shipment.items_verified if needed
    //    (only when the client did NOT explicitly decide it)
    //
    if (items_verified == null && !canViewPayroll) {
      // Preserve existing items_verified when payroll access is not granted.
      await dbRun(
        `
          UPDATE shipments
          SET items_verified = ?
          WHERE id = ? AND org_id = ?
        `,
        [existing.items_verified ? 1 : 0, id, orgId]
      );
    }

    // ───────── STATUS HISTORY / TIMELINE IF STATUS CHANGED ─────────
    if (oldStatus !== newStatus) {
      await dbRun(
        `
          INSERT INTO shipment_status_history (
            org_id, shipment_id, old_status, new_status, changed_at
          ) VALUES (?, ?, ?, ?, datetime('now'))
        `,
        [orgId, id, oldStatus, newStatus]
      );

      await dbRun(
        `
          INSERT INTO shipment_timeline (
            org_id,
            shipment_id,
            event_type,
            old_status,
            new_status,
            note,
            created_by,
            created_at
          ) VALUES (?, ?, 'status_change', ?, ?, ?, ?, datetime('now'))
        `,
        [orgId, id, oldStatus, newStatus, 'Status changed via main edit form.', actorId]
      );
    }

    await dbRun('COMMIT');
    transactionStarted = false;

    // ───────── RETURN UPDATED ROW ─────────
    const row = await dbGet(
      `SELECT s.*,
        COALESCE(s.vendor_name, v.name) AS vendor_name,
        COALESCE(s.project_name_snapshot, p.name) AS project_name,
        p.customer_name
       FROM shipments s
       LEFT JOIN vendors  v ON v.id = s.vendor_id AND v.org_id = s.org_id
       LEFT JOIN projects p ON p.id = s.project_id AND p.org_id = s.org_id
       WHERE s.id = ? AND s.org_id = ?`,
      [id, orgId]
    );

    const auditAfter = row ? { ...row } : null;
    if (auditAfter && itemsProvided && Array.isArray(items)) {
      auditAfter.items = items;
    }
    await logAuditEvent({
      req,
      orgId,
      action: 'shipment.update',
      entityType: 'shipment',
      entityId: id,
      before: existing,
      after: auditAfter,
      note: itemsProvided ? 'Shipment updated (items replaced).' : 'Shipment updated.'
    });

    const response = { shipment: canViewPayroll ? row : stripShipmentMoney(row) };
    if (clientId) {
      await storeIdempotentResponse(orgId, 'shipment_update', clientId, response);
    }
    res.json(response);
  } catch (err) {
    if (transactionStarted) {
      try {
        await dbRun('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Shipment update rollback error:', rollbackErr);
      }
    }
    console.error('Error updating shipment:', err);
    res.status(500).json({ error: 'Error updating shipment.' });
  }
});


app.delete('/api/shipments/:id', requireSeeShipments, async (req, res) => {

  try {
    const id = req.params.id;
    const orgId = req.session && req.session.orgId;
    const actorId = req.session && req.session.employeeId
      ? req.session.employeeId
      : null;

    if (!orgId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    const existing = await dbGet(
      'SELECT * FROM shipments WHERE id = ? AND org_id = ?',
      [id, orgId]
    );
    if (!existing) {
      return res.status(404).json({ error: 'Shipment not found.' });
    }

    const nowIso = new Date().toISOString();
    const alreadyArchived =
      (existing.status && existing.status === 'Archived') ||
      (existing.is_archived && Number(existing.is_archived) === 1);

    await dbRun(
      `
        UPDATE shipments
        SET status = 'Archived',
            is_archived = 1,
            archived_at = COALESCE(archived_at, ?),
            updated_at = ?
        WHERE id = ? AND org_id = ?
      `,
      [nowIso, nowIso, id, orgId]
    );

    if (!alreadyArchived) {
      await dbRun(
        `
          INSERT INTO shipment_status_history (
            org_id, shipment_id, old_status, new_status, changed_at
          ) VALUES (?, ?, ?, 'Archived', datetime('now'))
        `,
        [orgId, id, existing.status || null]
      );

      await dbRun(
        `
          INSERT INTO shipment_timeline (
            org_id, shipment_id, event_type, old_status, new_status, note, created_by, created_at
          ) VALUES (?, ?, 'status_change', ?, 'Archived', ?, ?, datetime('now'))
        `,
        [
          orgId,
          id,
          existing.status || null,
          'Shipment archived.',
          actorId
        ]
      );
    }

    await logAuditEvent({
      req,
      orgId,
      action: 'shipment.archive',
      entityType: 'shipment',
      entityId: id,
      before: existing,
      after: {
        status: 'Archived',
        is_archived: 1,
        archived_at: alreadyArchived ? existing.archived_at || null : nowIso
      },
      note: alreadyArchived ? 'Shipment archive requested (already archived).' : 'Shipment archived.'
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting shipment:', err);
    res.status(500).json({ error: 'Error deleting shipment.' });
  }
});

app.get('/api/shipments/:id', requireSeeShipments, async (req, res) => {
    try {
    const id = req.params.id;
    const orgId = req.session && req.session.orgId;
    const canViewPayments = !!(req.adminPerms && req.adminPerms.view_payroll);

    if (!orgId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    const row = await dbGet(
      `SELECT s.*,
        COALESCE(s.vendor_name, v.name) AS vendor_name,
        COALESCE(s.project_name_snapshot, p.name) AS project_name,
        p.customer_name
       FROM shipments s
       LEFT JOIN vendors v ON v.id = s.vendor_id AND v.org_id = s.org_id
       LEFT JOIN projects p ON p.id = s.project_id AND p.org_id = s.org_id
       WHERE s.id = ? AND s.org_id = ?`,
      [id, orgId]
    );

    if (!row) return res.status(404).json({ error: 'Not found.' });

    const shipment = canViewPayments ? row : stripShipmentMoney(row);

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
    WHERE shipment_id = ? AND org_id = ?
    ORDER BY id ASC
  `,
  [id, orgId]
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

  const isObj =
    verification &&
    typeof verification === 'object' &&
    !Array.isArray(verification);
  const isEmptyObject = isObj && Object.keys(verification).length === 0;

  // fallback to legacy columns if nothing meaningful or bad type
  if (!isObj || isEmptyObject) {
    verification = {
      status: it.verified ? 'verified' : '',
      notes: it.notes || '',
      storage_override: '',
      history: []
    };
  }

  if (!verification.storage_override) {
    verification.storage_override = verification.storage_override || '';
  }
  if (!Array.isArray(verification.history)) {
    verification.history = [];
  }

  return {
    ...it,
    verification
  };
});



    const responseItems = canViewPayments
      ? normalizedItems
      : stripShipmentItemsMoney(normalizedItems);

    res.json({
      shipment,
      items: responseItems
    });


  } catch (err) {
    console.error('Error loading shipment:', err);
    res.status(500).json({ error: 'Error loading shipment.' });
  }
});

app.get('/api/shipments/:id/payments', requireViewPayroll, async (req, res) => {

  try {
    const orgId = req.session && req.session.orgId;
    if (!orgId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    const shipmentId = Number(req.params.id);
    if (!shipmentId) {
      return res.status(400).json({ error: 'Invalid shipment id.' });
    }
    const shipmentRow = await dbGet(
      'SELECT id FROM shipments WHERE id = ? AND org_id = ?',
      [shipmentId, orgId]
    );
    if (!shipmentRow) {
      return res.status(404).json({ error: 'Shipment not found.' });
    }
    const rows = await dbAll(
      `SELECT p.*, e.name AS created_by_name
       FROM shipment_payments p
       LEFT JOIN employees e ON e.id = p.created_by AND e.org_id = p.org_id
       WHERE p.shipment_id = ? AND p.org_id = ?
       ORDER BY p.created_at ASC`,
      [shipmentId, orgId]
    );
    res.json({ payments: rows });
  } catch (err) {
    console.error('Error loading shipment payments:', err);
    res.status(500).json({ error: 'Error loading payments.' });
  }
});

app.post('/api/shipments/:id/payments', requireViewPayroll, async (req, res) => {

  try {
    const orgId = req.session && req.session.orgId;
    const createdBy = req.session && req.session.employeeId
      ? req.session.employeeId
      : null;
    if (!orgId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    const shipmentId = Number(req.params.id);
    if (!shipmentId) {
      return res.status(400).json({ error: 'Invalid shipment id.' });
    }
    const shipmentRow = await dbGet(
      'SELECT id FROM shipments WHERE id = ? AND org_id = ?',
      [shipmentId, orgId]
    );
    if (!shipmentRow) {
      return res.status(404).json({ error: 'Shipment not found.' });
    }

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

    const insertRes = await dbRun(
      `INSERT INTO shipment_payments (
        org_id, shipment_id, type, amount, currency, status,
        due_date, paid_date, invoice_number, notes, created_by, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?, datetime('now'))`,
      [
        orgId,
        shipmentId,
        type || null,
        amount,
        currency || 'USD',
        status || 'Pending',
        due_date || null,
        paid_date || null,
        invoice_number || null,
        notes || null,
        createdBy
      ]
    );

    await logAuditEvent({
      req,
      orgId,
      action: 'shipment.payment.add',
      entityType: 'shipment',
      entityId: shipmentId,
      after: {
        payment_id: insertRes?.lastID || null,
        type: type || null,
        amount,
        currency: currency || 'USD',
        status: status || 'Pending',
        due_date: due_date || null,
        paid_date: paid_date || null,
        invoice_number: invoice_number || null
      },
      note: 'Shipment payment added.'
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Error creating shipment payment:', err);
    res.status(500).json({ error: 'Error creating payment.' });
  }
});

app.get('/api/shipments/:id/timeline', requireSeeShipments, async (req, res) => {

  try {
    const orgId = req.session && req.session.orgId;
    if (!orgId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    const rows = await dbAll(
      `SELECT t.*, e.name AS created_by_name
       FROM shipment_timeline t
       LEFT JOIN employees e ON e.id = t.created_by AND e.org_id = t.org_id
       WHERE t.shipment_id = ? AND t.org_id = ?
       ORDER BY t.created_at ASC`,
      [req.params.id, orgId]
    );
    res.json({ timeline: rows });
  } catch (err) {
    console.error('Error loading shipment timeline:', err);
    res.status(500).json({ error: 'Error loading timeline.' });
  }
});

async function getOrCreateShipmentCommentThread({
  orgId,
  shipmentId,
  createdBy,
  title = 'General',
  category = 'General'
}) {
  const existing = await dbGet(
    `SELECT id FROM shipment_comment_threads
     WHERE org_id = ? AND shipment_id = ? AND LOWER(title) = LOWER(?)
     ORDER BY id ASC
     LIMIT 1`,
    [orgId, shipmentId, title]
  );
  if (existing && existing.id) {
    return existing.id;
  }

  const insertRes = await dbRun(
    `INSERT INTO shipment_comment_threads (
      org_id, shipment_id, title, category, created_by, created_at, updated_at
    ) VALUES (?,?,?,?,?, datetime('now'), datetime('now'))`,
    [
      orgId,
      shipmentId,
      title,
      category || null,
      createdBy || null
    ]
  );

  return insertRes?.lastID || null;
}

app.get('/api/shipments/:id/comment-threads', async (req, res) => {
  try {
    const access = await ensureShipmentAccess(req);
    if (!access.ok) {
      return res
        .status(access.status || 403)
        .json({ error: access.error || 'Not authorized' });
    }
    const shipmentId = Number(req.params.id);
    if (!shipmentId) {
      return res.status(400).json({ error: 'Invalid shipment id.' });
    }
    const threadId = req.query && req.query.thread_id
      ? Number(req.query.thread_id)
      : null;
    const shipmentRow = await dbGet(
      'SELECT id, status, project_id, title FROM shipments WHERE id = ? AND org_id = ?',
      [shipmentId, access.orgId]
    );
    if (!shipmentRow) {
      return res.status(404).json({ error: 'Shipment not found.' });
    }

    const rows = await dbAll(
      `
        SELECT
          t.*,
          e.name AS created_by_name,
          CAST(strftime('%s', t.created_at) AS INTEGER) * 1000 AS created_at_ms,
          CAST(strftime('%s', t.updated_at) AS INTEGER) * 1000 AS updated_at_ms,
          (
            SELECT c.body
            FROM shipment_comments c
            WHERE c.thread_id = t.id
              AND c.org_id = t.org_id
              AND c.shipment_id = t.shipment_id
              AND IFNULL(c.is_deleted, 0) = 0
            ORDER BY c.created_at DESC, c.id DESC
            LIMIT 1
          ) AS last_comment_body,
          (
            SELECT c.created_at
            FROM shipment_comments c
            WHERE c.thread_id = t.id
              AND c.org_id = t.org_id
              AND c.shipment_id = t.shipment_id
              AND IFNULL(c.is_deleted, 0) = 0
            ORDER BY c.created_at DESC, c.id DESC
            LIMIT 1
          ) AS last_comment_at,
          (
            SELECT CAST(strftime('%s', c.created_at) AS INTEGER) * 1000
            FROM shipment_comments c
            WHERE c.thread_id = t.id
              AND c.org_id = t.org_id
              AND c.shipment_id = t.shipment_id
              AND IFNULL(c.is_deleted, 0) = 0
            ORDER BY c.created_at DESC, c.id DESC
            LIMIT 1
          ) AS last_comment_at_ms,
          (
            SELECT e2.name
            FROM shipment_comments c
            LEFT JOIN employees e2 ON e2.id = c.created_by AND e2.org_id = c.org_id
            WHERE c.thread_id = t.id
              AND c.org_id = t.org_id
              AND c.shipment_id = t.shipment_id
              AND IFNULL(c.is_deleted, 0) = 0
            ORDER BY c.created_at DESC, c.id DESC
            LIMIT 1
          ) AS last_comment_by_name
        FROM shipment_comment_threads t
        LEFT JOIN employees e ON e.id = t.created_by AND e.org_id = t.org_id
        WHERE t.shipment_id = ? AND t.org_id = ?
        ORDER BY COALESCE(last_comment_at, t.updated_at, t.created_at) DESC, t.id DESC
      `,
      [shipmentId, access.orgId]
    );

    res.json({ threads: rows });
  } catch (err) {
    console.error('Error loading shipment comment threads:', err);
    res.status(500).json({ error: 'Error loading comment threads.' });
  }
});

app.post('/api/shipments/:id/comment-threads', async (req, res) => {
  try {
    const { title, category, client_id } = req.body || {};
    const trimmedTitle = String(title || '').trim();
    if (!trimmedTitle) {
      return res.status(400).json({ error: 'Thread title required.' });
    }

    const access = await ensureShipmentAccess(req);
    if (!access.ok) {
      return res
        .status(access.status || 403)
        .json({ error: access.error || 'Not authorized' });
    }

    const shipmentId = Number(req.params.id);
    if (!shipmentId) {
      return res.status(400).json({ error: 'Invalid shipment id.' });
    }
    const threadId = req.query && req.query.thread_id
      ? Number(req.query.thread_id)
      : null;
    const shipmentRow = await dbGet(
      'SELECT id FROM shipments WHERE id = ? AND org_id = ?',
      [shipmentId, access.orgId]
    );
    if (!shipmentRow) {
      return res.status(404).json({ error: 'Shipment not found.' });
    }

    const clientId = client_id ? String(client_id).trim() : '';
    if (clientId) {
      const cached = await loadIdempotentResponse(
        access.orgId,
        'shipment_comment_thread',
        clientId
      );
      if (cached) {
        return res.json({ ...cached, alreadyProcessed: true });
      }
    }

    const createdBy = access.employee ? access.employee.id : null;
    const insertRes = await dbRun(
      `INSERT INTO shipment_comment_threads (
        org_id, shipment_id, title, category, created_by, created_at, updated_at
      ) VALUES (?,?,?,?,?, datetime('now'), datetime('now'))`,
      [
        access.orgId,
        shipmentId,
        trimmedTitle,
        category ? String(category).trim() : null,
        createdBy
      ]
    );

    await logAuditEvent({
      orgId: access.orgId,
      action: 'shipment.comment.thread.create',
      entityType: 'shipment',
      entityId: shipmentId,
      actorEmployeeId: createdBy || null,
      actorName: access.employee ? access.employee.name : null,
      after: {
        thread_id: insertRes?.lastID || null,
        title: trimmedTitle,
        category: category ? String(category).trim() : null
      }
    });

    const response = {
      ok: true,
      thread_id: insertRes?.lastID || null,
      thread: {
        id: insertRes?.lastID || null,
        shipment_id: shipmentId,
        org_id: access.orgId,
        title: trimmedTitle,
        category: category ? String(category).trim() : null,
        created_by: createdBy,
        created_at: new Date().toISOString()
      }
    };
    if (clientId) {
      await storeIdempotentResponse(
        access.orgId,
        'shipment_comment_thread',
        clientId,
        response
      );
    }
    res.json(response);
  } catch (err) {
    console.error('Error creating shipment comment thread:', err);
    res.status(500).json({ error: 'Error creating comment thread.' });
  }
});

app.patch('/api/shipments/:id/comment-threads/:threadId', async (req, res) => {
  try {
    const { title } = req.body || {};
    const trimmedTitle = String(title || '').trim();
    if (!trimmedTitle) {
      return res.status(400).json({ error: 'Thread title required.' });
    }

    const access = await ensureShipmentAccess(req);
    if (!access.ok) {
      return res
        .status(access.status || 403)
        .json({ error: access.error || 'Not authorized' });
    }

    const shipmentId = Number(req.params.id);
    const threadId = Number(req.params.threadId);
    if (!shipmentId || !threadId) {
      return res.status(400).json({ error: 'Invalid shipment or thread id.' });
    }

    const threadRow = await dbGet(
      `SELECT id, title, created_by
       FROM shipment_comment_threads
       WHERE id = ? AND shipment_id = ? AND org_id = ?`,
      [threadId, shipmentId, access.orgId]
    );
    if (!threadRow) {
      return res.status(404).json({ error: 'Thread not found.' });
    }

    const editorId = access.employee ? access.employee.id : null;
    if (!editorId || !threadRow.created_by ||
      Number(threadRow.created_by) !== Number(editorId)) {
      return res.status(403).json({ error: 'Only the thread creator can rename this thread.' });
    }

    await dbRun(
      `UPDATE shipment_comment_threads
       SET title = ?, updated_at = datetime('now')
       WHERE id = ? AND org_id = ?`,
      [trimmedTitle, threadId, access.orgId]
    );

    await logAuditEvent({
      orgId: access.orgId,
      action: 'shipment.comment_thread.update',
      entityType: 'shipment',
      entityId: shipmentId,
      actorEmployeeId: editorId,
      actorName: access.employee ? access.employee.name : null,
      before: {
        thread_id: threadId,
        title: threadRow.title || null
      },
      after: {
        thread_id: threadId,
        title: trimmedTitle
      }
    });

    res.json({ ok: true, thread_id: threadId, title: trimmedTitle });
  } catch (err) {
    console.error('Error updating shipment comment thread:', err);
    res.status(500).json({ error: 'Error updating comment thread.' });
  }
});

app.get('/api/shipments/:id/comments', async (req, res) => {

  try {
    const access = await ensureShipmentAccess(req);
    if (!access.ok) {
      return res
        .status(access.status || 403)
        .json({ error: access.error || 'Not authorized' });
    }
    const shipmentId = Number(req.params.id);
    if (!shipmentId) {
      return res.status(400).json({ error: 'Invalid shipment id.' });
    }
    const threadId = req.query && req.query.thread_id
      ? Number(req.query.thread_id)
      : null;
    const shipmentRow = await dbGet(
      'SELECT id FROM shipments WHERE id = ? AND org_id = ?',
      [shipmentId, access.orgId]
    );
    if (!shipmentRow) {
      return res.status(404).json({ error: 'Shipment not found.' });
    }

    if (threadId) {
      const threadRow = await dbGet(
        `SELECT id FROM shipment_comment_threads
         WHERE id = ? AND shipment_id = ? AND org_id = ?`,
        [threadId, shipmentId, access.orgId]
      );
      if (!threadRow) {
        return res.status(404).json({ error: 'Thread not found.' });
      }
    }

    const rows = await dbAll(
      `SELECT
         c.*,
         e.name AS created_by_name,
         CAST(strftime('%s', c.created_at) AS INTEGER) * 1000 AS created_at_ms
       FROM shipment_comments c
       LEFT JOIN employees e ON e.id = c.created_by AND e.org_id = c.org_id
       WHERE c.shipment_id = ? AND c.org_id = ? AND IFNULL(c.is_deleted, 0) = 0
       ${threadId ? 'AND c.thread_id = ?' : ''}
       ORDER BY c.created_at ASC`,
      threadId
        ? [shipmentId, access.orgId, threadId]
        : [shipmentId, access.orgId]
    );
    res.json({ comments: rows });
  } catch (err) {
    console.error('Error loading shipment comments:', err);
    res.status(500).json({ error: 'Error loading comments.' });
  }
});

app.post('/api/shipments/:id/comments', async (req, res) => {

  try {
    const { body, client_id, thread_id } = req.body;
    if (!body) {
      return res.status(400).json({ error: 'Comment text required.' });
    }

    const access = await ensureShipmentAccess(req);
    if (!access.ok) {
      return res
        .status(access.status || 403)
        .json({ error: access.error || 'Not authorized' });
    }

    const shipmentId = Number(req.params.id);
    if (!shipmentId) {
      return res.status(400).json({ error: 'Invalid shipment id.' });
    }
    const shipmentRow = await dbGet(
      'SELECT id FROM shipments WHERE id = ? AND org_id = ?',
      [shipmentId, access.orgId]
    );
    if (!shipmentRow) {
      return res.status(404).json({ error: 'Shipment not found.' });
    }

    const createdBy = access.employee ? access.employee.id : null;
    const clientId = client_id ? String(client_id).trim() : '';
    let threadId = thread_id ? Number(thread_id) : null;

    if (clientId) {
      const cached = await loadIdempotentResponse(access.orgId, 'shipment_comment', clientId);
      if (cached) {
        return res.json({ ...cached, alreadyProcessed: true });
      }
    }

    if (threadId) {
      const threadRow = await dbGet(
        `SELECT id FROM shipment_comment_threads
         WHERE id = ? AND shipment_id = ? AND org_id = ?`,
        [threadId, shipmentId, access.orgId]
      );
      if (!threadRow) {
        return res.status(404).json({ error: 'Thread not found.' });
      }
    } else {
      threadId = await getOrCreateShipmentCommentThread({
        orgId: access.orgId,
        shipmentId,
        createdBy,
        title: 'General',
        category: 'General'
      });
    }

    const insertRes = await dbRun(
      `INSERT INTO shipment_comments (
        org_id, shipment_id, thread_id, body, created_by, created_at
      ) VALUES (?,?,?,?,?, datetime('now'))`,
      [access.orgId, shipmentId, threadId, body, createdBy]
    );

    if (threadId) {
      await dbRun(
        `UPDATE shipment_comment_threads
         SET updated_at = datetime('now')
         WHERE id = ? AND org_id = ?`,
        [threadId, access.orgId]
      );
    }

    await logAuditEvent({
      orgId: access.orgId,
      action: 'shipment.comment.create',
      entityType: 'shipment',
      entityId: shipmentId,
      actorEmployeeId: createdBy || null,
      actorName: access.employee ? access.employee.name : null,
      after: {
        comment_id: insertRes?.lastID || null,
        thread_id: threadId || null,
        body
      }
    });

    try {
      await notifyShipmentComment({
        orgId: access.orgId,
        shipmentId,
        status: shipmentRow?.status || null,
        projectId: shipmentRow?.project_id || null,
        title: shipmentRow?.title || null,
        actorName: access.employee ? access.employee.name : null,
        actorEmployeeId: createdBy || null,
        commentBody: body,
        commentId: insertRes?.lastID || null,
        threadId
      });
    } catch (err) {
      console.warn('Failed to send shipment comment notification:', err?.message || err);
    }

    const response = { ok: true };
    if (clientId) {
      await storeIdempotentResponse(access.orgId, 'shipment_comment', clientId, response);
    }
    res.json(response);
  } catch (err) {
    console.error('Error creating shipment comment:', err);
    res.status(500).json({ error: 'Error creating comment.' });
  }
});

app.delete('/api/shipments/:id/comments/:commentId', async (req, res) => {
  try {
    const access = await ensureShipmentAccess(req);
    if (!access.ok) {
      return res
        .status(access.status || 403)
        .json({ error: access.error || 'Not authorized' });
    }

    const shipmentId = Number(req.params.id);
    const commentId = Number(req.params.commentId);
    if (!shipmentId || !commentId) {
      return res.status(400).json({ error: 'Invalid comment id.' });
    }

    const row = await dbGet(
      `SELECT id, body, created_by, created_at
       FROM shipment_comments
       WHERE id = ? AND shipment_id = ? AND org_id = ?`,
      [commentId, shipmentId, access.orgId]
    );
    if (!row) {
      return res.status(404).json({ error: 'Comment not found.' });
    }

    const actorId = access.employee ? access.employee.id : null;
    const isCreator = actorId && row.created_by &&
      Number(row.created_by) === Number(actorId);
    const isSuperAdmin = actorId
      ? await isEmployeeSuperAdmin({ employeeId: actorId, orgId: access.orgId })
      : false;
    if (!isCreator && !isSuperAdmin) {
      return res.status(403).json({ error: 'Only the comment author can delete this comment.' });
    }

    const createdAt = parseSqliteDateToUtc(row.created_at);
    if (createdAt) {
      const elapsedMs = Date.now() - createdAt.getTime();
      if (elapsedMs > 5 * 60 * 1000) {
        return res.status(403).json({
          error: 'Comments can only be deleted within 5 minutes of posting.'
        });
      }
    }

    await dbRun(
      `
        UPDATE shipment_comments
        SET is_deleted = 1,
            deleted_by = ?,
            deleted_at = datetime('now')
        WHERE id = ? AND shipment_id = ? AND org_id = ?
      `,
      [
        access.employee ? access.employee.id : null,
        commentId,
        shipmentId,
        access.orgId
      ]
    );

    await logAuditEvent({
      orgId: access.orgId,
      action: 'shipment.comment.delete',
      entityType: 'shipment',
      entityId: shipmentId,
      actorEmployeeId: access.employee ? access.employee.id : null,
      actorName: access.employee ? access.employee.name : null,
      before: {
        comment_id: commentId,
        body: row.body || null,
        created_by: row.created_by || null
      }
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting shipment comment:', err);
    res.status(500).json({ error: 'Error deleting comment.' });
  }
});

app.post('/api/shipments/:id/status', requireSeeShipments, async (req, res) => {

  try {
    const id = req.params.id;
    const { new_status, note } = req.body;

    const orgId = req.session && req.session.orgId;
    const actorId = req.session && req.session.employeeId
      ? req.session.employeeId
      : null;

    if (!orgId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    const nextStatus = String(new_status || '').trim();
    if (!nextStatus) {
      return res.status(400).json({ error: 'Invalid status.' });
    }

    const existing = await dbGet(
      `
        SELECT status, title, project_id, is_archived, archived_at
        FROM shipments
        WHERE id = ? AND org_id = ?
      `,
      [id, orgId]
    );
    if (!existing) {
      return res.status(404).json({ error: 'Shipment not found.' });
    }

    const nowIso = new Date().toISOString();
    let nextIsArchived = existing.is_archived ? 1 : 0;
    let nextArchivedAt = existing.archived_at || null;
    if (nextStatus === 'Archived') {
      nextIsArchived = 1;
      nextArchivedAt = existing.archived_at || nowIso;
    } else if (existing.is_archived) {
      nextIsArchived = 0;
      nextArchivedAt = null;
    }

    await dbRun(
      `UPDATE shipments
       SET status = ?, is_archived = ?, archived_at = ?, updated_at = datetime('now')
       WHERE id = ? AND org_id = ?`,
      [nextStatus, nextIsArchived, nextArchivedAt, id, orgId]
    );

    await dbRun(
      `INSERT INTO shipment_status_history (
         org_id, shipment_id, old_status, new_status, changed_at
       ) VALUES (?, ?, ?, ?, datetime('now'))`,
      [orgId, id, existing.status, nextStatus]
    );

    await dbRun(
      `INSERT INTO shipment_timeline (
         org_id, shipment_id, event_type, old_status, new_status, note, created_by, created_at
       ) VALUES (?, ?, 'status_change', ?, ?, ?, ?, datetime('now'))`,
      [orgId, id, existing.status, nextStatus, note || null, actorId]
    );

    let actorName = null;
    if (actorId) {
      const actor = await dbGet(
        'SELECT name FROM employees WHERE id = ? AND org_id = ?',
        [actorId, orgId]
      );
      actorName = actor?.name || null;
    }

    await notifyShipmentStatusChange({
      orgId,
      shipmentId: id,
      status: nextStatus,
      projectId: existing.project_id,
      title: existing.title,
      actorName
    });

    await logAuditEvent({
      req,
      orgId,
      action: 'shipment.status.update',
      entityType: 'shipment',
      entityId: id,
      before: {
        status: existing.status || null,
        is_archived: existing.is_archived ? 1 : 0,
        archived_at: existing.archived_at || null
      },
      after: {
        status: nextStatus,
        is_archived: nextIsArchived,
        archived_at: nextArchivedAt
      },
      note: note || null
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Error updating shipment status:', err);
    res.status(500).json({ error: 'Error updating status.' });
  }
});

function docTextForPaymentDetection(doc = {}) {
  return [
    doc.doc_type,
    doc.doc_label,
    doc.title,
    doc.category
  ]
    .map(v => (v || '').toString().toLowerCase())
    .filter(Boolean)
    .join(' ');
}

function docIsFreightPayment(doc = {}) {
  const text = docTextForPaymentDetection(doc);
  if (!text) return false;
  const paymenty =
    text.includes('payment') ||
    text.includes('paid') ||
    text.includes('receipt');
  const freighty =
    text.includes('freight') ||
    text.includes('forwarder') ||
    text.includes('shipper') ||
    text.includes('shipping') ||
    text.includes('logistics') ||
    text.includes('transport') ||
    text.includes('cargo') ||
    text.includes('ff');
  return paymenty && freighty;
}

function docIsClearingPayment(doc = {}) {
  const text = docTextForPaymentDetection(doc);
  if (!text) return false;
  const paymenty =
    text.includes('payment') ||
    text.includes('paid') ||
    text.includes('receipt');
  const clearingy =
    text.includes('customs') ||
    text.includes('clearing') ||
    text.includes('broker') ||
    text.includes('duty') ||
    text.includes('duties');
  return paymenty && clearingy;
}

function isPaymentDoc(doc = {}) {
  return docIsFreightPayment(doc) || docIsClearingPayment(doc);
}

async function loadShipmentDocumentForAccess(req, docId) {
  const access = await ensureShipmentAccess(req);
  if (!access.ok) {
    return {
      ok: false,
      status: access.status || 403,
      error: access.error || 'Not authorized'
    };
  }

  const doc = await dbGet(
    `
      SELECT id, shipment_id, title, category, doc_type, doc_label, file_path
      FROM shipment_documents
      WHERE id = ? AND org_id = ?
    `,
    [docId, access.orgId]
  );

  if (!doc) {
    return { ok: false, status: 404, error: 'Document not found.' };
  }

  const canViewPayroll = !!(access.perms && access.perms.view_payroll);
  if (!canViewPayroll && isPaymentDoc(doc)) {
    return { ok: false, status: 403, error: 'Not authorized' };
  }

  return { ok: true, doc };
}

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

    const shipmentRow = await dbGet(
      'SELECT id FROM shipments WHERE id = ? AND org_id = ?',
      [shipmentId, access.orgId]
    );
    if (!shipmentRow) {
      return res.status(404).json({ error: 'Shipment not found.' });
    }

    const docs = await dbAll(
      `
        SELECT id, shipment_id, title, category, doc_type, doc_label, file_path, uploaded_at
        FROM shipment_documents
        WHERE shipment_id = ? AND org_id = ?
        ORDER BY uploaded_at DESC, id DESC
      `,
      [shipmentId, access.orgId]
    );

    const canViewPayroll = !!(access.perms && access.perms.view_payroll);
    const visibleDocs = canViewPayroll ? docs : docs.filter(doc => !isPaymentDoc(doc));

    const withUrls = visibleDocs.map(doc => {
      const downloadUrl = `/api/shipments/documents/${doc.id}/download`;
      const viewUrl = `/api/shipments/documents/${doc.id}/view`;
      return {
        ...doc,
        download_url: downloadUrl,
        view_url: viewUrl,
        url: downloadUrl,
        file_path: downloadUrl
      };
    });

    res.json({ documents: withUrls });
  } catch (err) {
    console.error('Error loading shipment documents:', err);
    res.status(500).json({ error: 'Error loading shipment documents.' });
  }
});

app.get(
  '/api/shipments/documents/:docId/download',
  async (req, res) => {
    try {
      const docId = Number(req.params.docId);
      if (!docId) {
        return res.status(400).json({ error: 'Invalid document id.' });
      }

      const loaded = await loadShipmentDocumentForAccess(req, docId);
      if (!loaded.ok) {
        return res.status(loaded.status).json({ error: loaded.error });
      }
      const doc = loaded.doc;

      const absPath = resolveShipmentDocumentPath(doc.file_path);
      if (!absPath || !fs.existsSync(absPath)) {
        return res.status(404).json({ error: 'File not found on disk.' });
      }

      const filename = doc.title || path.basename(absPath);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.download(absPath, filename);
    } catch (err) {
      console.error('Error downloading shipment document:', err);
      return res.status(500).json({ error: 'Error downloading document.' });
    }
  }
);

app.get(
  '/api/shipments/documents/:docId/view',
  async (req, res) => {
    try {
      const docId = Number(req.params.docId);
      if (!docId) {
        return res.status(400).json({ error: 'Invalid document id.' });
      }

      const loaded = await loadShipmentDocumentForAccess(req, docId);
      if (!loaded.ok) {
        return res.status(loaded.status).json({ error: loaded.error });
      }
      const doc = loaded.doc;

      const absPath = resolveShipmentDocumentPath(doc.file_path);
      if (!absPath || !fs.existsSync(absPath)) {
        return res.status(404).json({ error: 'File not found on disk.' });
      }

      const filename = doc.title || path.basename(absPath);
      const safeName = String(filename).replace(/"/g, '');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
      return res.sendFile(absPath);
    } catch (err) {
      console.error('Error viewing shipment document:', err);
      return res.status(500).json({ error: 'Error viewing document.' });
    }
  }
);

// Upload one or more documents for a shipment
app.post(
  '/api/shipments/:id/documents',
  wrapUpload(uploadShipmentDocs.array('documents', 10)),
  async (req, res) => {
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

      const shipmentRow = await dbGet(
        'SELECT id FROM shipments WHERE id = ? AND org_id = ?',
        [shipmentId, access.orgId]
      );
      if (!shipmentRow) {
        return res.status(404).json({ error: 'Shipment not found.' });
      }

      const files = req.files || [];
      if (!files.length) {
        return res.json({ documents: [] });
      }

      try {
        await validateUploadedFiles(files, shipmentAllowedMimes, shipmentAllowedExts);
      } catch (err) {
        await cleanupUploadedFiles(files);
        return res.status(400).json({ error: err.message || 'Unsupported file type.' });
      }

      const docType = req.body.doc_type || null;
      const docLabel = req.body.doc_label || null;
      const canViewPayroll = !!(access.perms && access.perms.view_payroll);
      const uploadedById = access.employee ? access.employee.id : null;

      const docs = [];

      for (const file of files) {
        const candidateDoc = {
          doc_type: docType,
          doc_label: docLabel,
          title: file.originalname,
          category: null
        };
        if (!canViewPayroll && isPaymentDoc(candidateDoc)) {
          await cleanupUploadedFiles(files);
          return res.status(403).json({ error: 'Not authorized' });
        }
        const storedPath = `shipments/${file.filename}`;

        const result = await dbRun(
          `
            INSERT INTO shipment_documents (
              org_id,
              shipment_id,
              title,
              category,
              doc_type,
              doc_label,
              file_path,
              uploaded_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            access.orgId,
            shipmentId,
            file.originalname,
            null,          // keep category nullable
            docType,
            docLabel,
            storedPath,
            uploadedById
          ]
        );

        await logAuditEvent({
          orgId: access.orgId,
          action: 'shipment.doc.add',
          entityType: 'shipment',
          entityId: shipmentId,
          actorEmployeeId: uploadedById,
          actorName: access.employee ? access.employee.name : null,
          after: {
            document_id: result.lastID,
            title: file.originalname,
            doc_type: docType,
            doc_label: docLabel
          }
        });

        const downloadUrl = `/api/shipments/documents/${result.lastID}/download`;
        const viewUrl = `/api/shipments/documents/${result.lastID}/view`;

        docs.push({
          id: result.lastID,
          shipment_id: shipmentId,
          title: file.originalname,
          category: null,
          doc_type: docType,
          doc_label: docLabel,
          download_url: downloadUrl,
          view_url: viewUrl,
          file_path: downloadUrl,
          url: downloadUrl
        });
      }

      res.json({ documents: docs });
    } catch (err) {
      console.error('Error uploading shipment documents:', err);
      res.status(500).json({ error: 'Error uploading shipment documents.' });
    }
  }
);

// Update document metadata (type/label) for a shipment
app.put('/api/shipments/:shipmentId/documents/:docId', async (req, res) => {
  try {
    const shipmentId = Number(req.params.shipmentId);
    const docId = Number(req.params.docId);

    if (!shipmentId || !docId) {
      return res.status(400).json({ error: 'Invalid shipment or document id.' });
    }

    const access = await ensureShipmentAccess(req);
    if (!access.ok) {
      return res
        .status(access.status || 403)
        .json({ error: access.error || 'Not authorized' });
    }

    const doc = await dbGet(
      `
        SELECT id, shipment_id, title, category, doc_type, doc_label
        FROM shipment_documents
        WHERE id = ? AND shipment_id = ? AND org_id = ?
      `,
      [docId, shipmentId, access.orgId]
    );

    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    const canViewPayroll = !!(access.perms && access.perms.view_payroll);

    const payload = req.body || {};
    const hasType = Object.prototype.hasOwnProperty.call(payload, 'doc_type');
    const hasLabel = Object.prototype.hasOwnProperty.call(payload, 'doc_label');
    const nextType = hasType
      ? (typeof payload.doc_type === 'string' && payload.doc_type.trim()
          ? payload.doc_type.trim()
          : null)
      : doc.doc_type;
    const nextLabel = hasLabel
      ? (typeof payload.doc_label === 'string' && payload.doc_label.trim()
          ? payload.doc_label.trim()
          : null)
      : (hasType ? nextType : doc.doc_label);

    const nextDoc = { ...doc, doc_type: nextType, doc_label: nextLabel };
    if (!canViewPayroll && isPaymentDoc(nextDoc)) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await dbRun(
      `
        UPDATE shipment_documents
        SET doc_type = ?, doc_label = ?
        WHERE id = ? AND shipment_id = ? AND org_id = ?
      `,
      [nextType, nextLabel, docId, shipmentId, access.orgId]
    );

    await logAuditEvent({
      orgId: access.orgId,
      action: 'shipment.doc.update',
      entityType: 'shipment',
      entityId: shipmentId,
      actorEmployeeId: access.employee ? access.employee.id : null,
      actorName: access.employee ? access.employee.name : null,
      before: {
        document_id: doc.id,
        doc_type: doc.doc_type || null,
        doc_label: doc.doc_label || null
      },
      after: {
        document_id: doc.id,
        doc_type: nextType,
        doc_label: nextLabel
      }
    });

    const downloadUrl = `/api/shipments/documents/${doc.id}/download`;
    const viewUrl = `/api/shipments/documents/${doc.id}/view`;
    res.json({
      document: {
        ...doc,
        doc_type: nextType,
        doc_label: nextLabel,
        download_url: downloadUrl,
        view_url: viewUrl,
        file_path: downloadUrl,
        url: downloadUrl
      }
    });
  } catch (err) {
    console.error('Error updating shipment document:', err);
    res.status(500).json({ error: 'Error updating shipment document.' });
  }
});

// Delete a document for a shipment
app.delete(
  '/api/shipments/:shipmentId/documents/:docId',
  async (req, res) => {

  try {
    const shipmentId = Number(req.params.shipmentId);
    const docId = Number(req.params.docId);

    if (!shipmentId || !docId) {
      return res.status(400).json({ error: 'Invalid shipment or document id.' });
    }

    const access = await ensureShipmentAccess(req);
    if (!access.ok) {
      return res
        .status(access.status || 403)
        .json({ error: access.error || 'Not authorized' });
    }

    // Fetch the document to know the file path
    const doc = await dbGet(
      `
        SELECT id, shipment_id, file_path, title, category, doc_type, doc_label
        FROM shipment_documents
        WHERE id = ? AND shipment_id = ? AND org_id = ?
      `,
      [docId, shipmentId, access.orgId]
    );

    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }
    const canViewPayroll = !!(access.perms && access.perms.view_payroll);
    if (!canViewPayroll && isPaymentDoc(doc)) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Delete DB row
    await dbRun(
      `DELETE FROM shipment_documents WHERE id = ? AND shipment_id = ? AND org_id = ?`,
      [docId, shipmentId, access.orgId]
    );

    // Try to delete the physical file
    if (doc.file_path) {
      try {
        const absPath = resolveShipmentDocumentPath(doc.file_path);
        if (absPath) {
          await fsp.unlink(absPath);
        }
      } catch (err) {
        // If file is already gone, don't fail the whole request
        if (err.code !== 'ENOENT') {
          console.error('Error deleting shipment document file:', err);
        }
      }
    }

    await logAuditEvent({
      orgId: access.orgId,
      action: 'shipment.doc.delete',
      entityType: 'shipment',
      entityId: shipmentId,
      actorEmployeeId: access.employee ? access.employee.id : null,
      actorName: access.employee ? access.employee.name : null,
      before: {
        document_id: doc.id,
        title: doc.title || null,
        doc_type: doc.doc_type || null,
        doc_label: doc.doc_label || null
      }
    });

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
    const canViewPayroll = !!(access.perms && access.perms.view_payroll);

    const existing = await dbGet(
      `
        SELECT
          id,
          status,
          is_archived,
          archived_at,
          title,
          project_id,
          storage_due_date,
          storage_daily_late_fee,
          expected_arrival_date,
          picked_up_by,
          picked_up_date,
          picked_up_updated_by,
          picked_up_updated_at
        FROM shipments
        WHERE id = ? AND org_id = ?
      `,
      [shipmentId, access.orgId]
    );
    if (!existing) {
      return res.status(404).json({ error: 'Shipment not found.' });
    }
    const oldStatus = existing.status || null;

    const hasStorageDue = Object.prototype.hasOwnProperty.call(
      req.body || {},
      'storage_due_date'
    );
    const hasStorageFee = Object.prototype.hasOwnProperty.call(
      req.body || {},
      'storage_daily_late_fee'
    );
    if (hasStorageFee && !canViewPayroll) {
      return res.status(403).json({ error: 'Not authorized.' });
    }
    const hasExpectedArrival = Object.prototype.hasOwnProperty.call(
      req.body || {},
      'expected_arrival_date'
    );
    const hasPickedBy = Object.prototype.hasOwnProperty.call(
      req.body || {},
      'picked_up_by'
    );
    const hasPickedDate = Object.prototype.hasOwnProperty.call(
      req.body || {},
      'picked_up_date'
    );
    const updatingPickup = hasPickedBy || hasPickedDate;

    const normalizeText = (val) => {
      if (val === undefined || val === null) return null;
      const s = String(val).trim();
      return s === '' ? null : s;
    };

    const nextStorageDue = hasStorageDue
      ? normalizeText(storage_due_date)
      : existing.storage_due_date;
    const nextExpectedArrival = hasExpectedArrival
      ? normalizeText(expected_arrival_date)
      : existing.expected_arrival_date;
    const nextPickedBy = hasPickedBy
      ? normalizeText(picked_up_by)
      : existing.picked_up_by;
    const nextPickedDate = hasPickedDate
      ? normalizeText(picked_up_date)
      : existing.picked_up_date;

    let nextStatus = existing.status || null;
    let nextIsArchived = existing.is_archived ? 1 : 0;
    let nextArchivedAt = existing.archived_at || null;
    let statusChanged = false;
    const shouldMarkPickedUp = !!(nextPickedBy && nextPickedDate);
    if (shouldMarkPickedUp && existing.status !== 'Picked Up' && existing.status !== 'Archived') {
      nextStatus = 'Picked Up';
      statusChanged = true;
      nextIsArchived = 0;
      nextArchivedAt = null;
    }

    let feeVal = existing.storage_daily_late_fee;
    if (hasStorageFee) {
      const feeValStr =
        storage_daily_late_fee === undefined || storage_daily_late_fee === null
          ? ''
          : String(storage_daily_late_fee).trim();
      const feeValNum = feeValStr === '' ? null : Number(feeValStr);
      feeVal = Number.isFinite(feeValNum) ? feeValNum : null;
    }

    const updaterId = employee_id || (access.employee ? access.employee.id : null);
    let updaterName = null;
    if (updatingPickup && updaterId) {
      const emp = await dbGet(
        `SELECT nickname, name FROM employees WHERE id = ? AND org_id = ?`,
        [updaterId, access.orgId]
      );
      if (emp) updaterName = emp.nickname || emp.name || null;
    }

    await dbRun(
      `
        UPDATE shipments
        SET
          status = ?,
          is_archived = ?,
          archived_at = ?,
          storage_due_date = ?,
          storage_daily_late_fee = ?,
          expected_arrival_date = ?,
          picked_up_by = ?,
          picked_up_date = ?,
          picked_up_updated_by = CASE WHEN ? THEN ? ELSE picked_up_updated_by END,
          picked_up_updated_at = CASE WHEN ? THEN datetime('now') ELSE picked_up_updated_at END,
          updated_at = datetime('now')
        WHERE id = ? AND org_id = ?
      `,
      [
        nextStatus,
        nextIsArchived,
        nextArchivedAt,
        nextStorageDue,
        feeVal,
        nextExpectedArrival,
        nextPickedBy,
        nextPickedDate,
        updatingPickup ? 1 : 0,
        updaterName,
        updatingPickup ? 1 : 0,
        shipmentId,
        access.orgId
      ]
    );

    if (statusChanged) {
      await dbRun(
        `
          INSERT INTO shipment_status_history (
            org_id, shipment_id, old_status, new_status, changed_at
          ) VALUES (?, ?, ?, ?, datetime('now'))
        `,
        [access.orgId, shipmentId, oldStatus, nextStatus]
      );

      await dbRun(
        `
          INSERT INTO shipment_timeline (
            org_id,
            shipment_id,
            event_type,
            old_status,
            new_status,
            note,
            created_by,
            created_at
          ) VALUES (?, ?, 'status_change', ?, ?, ?, ?, datetime('now'))
        `,
        [
          access.orgId,
          shipmentId,
          oldStatus,
          nextStatus,
          'Pickup recorded.',
          updaterId || null
        ]
      );

      const actorName =
        updaterName ||
        (access.employee ? access.employee.name : null);

      await notifyShipmentStatusChange({
        orgId: access.orgId,
        shipmentId,
        status: nextStatus,
        projectId: existing.project_id,
        title: existing.title,
        actorName
      });
    }

    const row = await dbGet(
      `SELECT s.*,
        COALESCE(s.vendor_name, v.name) AS vendor_name,
        COALESCE(s.project_name_snapshot, p.name) AS project_name,
        p.customer_name
       FROM shipments s
       LEFT JOIN vendors  v ON v.id = s.vendor_id AND v.org_id = s.org_id
       LEFT JOIN projects p ON p.id = s.project_id AND p.org_id = s.org_id
       WHERE s.id = ? AND s.org_id = ?`,
      [shipmentId, access.orgId]
    );

    await logAuditEvent({
      orgId: access.orgId,
      action: 'shipment.storage.update',
      entityType: 'shipment',
      entityId: shipmentId,
      actorEmployeeId: access.employee ? access.employee.id : null,
      actorName: access.employee ? access.employee.name : null,
      before: {
        status: existing.status || null,
        is_archived: existing.is_archived ? 1 : 0,
        archived_at: existing.archived_at || null,
        storage_due_date: existing.storage_due_date || null,
        storage_daily_late_fee: existing.storage_daily_late_fee,
        expected_arrival_date: existing.expected_arrival_date || null,
        picked_up_by: existing.picked_up_by || null,
        picked_up_date: existing.picked_up_date || null
      },
      after: row
        ? {
            status: row.status || null,
            is_archived: row.is_archived ? 1 : 0,
            archived_at: row.archived_at || null,
            storage_due_date: row.storage_due_date || null,
            storage_daily_late_fee: row.storage_daily_late_fee,
            expected_arrival_date: row.expected_arrival_date || null,
            picked_up_by: row.picked_up_by || null,
            picked_up_date: row.picked_up_date || null
          }
        : null,
      note: statusChanged ? 'Pickup recorded.' : 'Storage details updated.'
    });

    res.json({
      shipment: canViewPayroll ? row : stripShipmentMoney(row)
    });
  } catch (err) {
    console.error('Error updating shipment storage from kiosk:', err);
    res.status(500).json({ error: 'Failed to update storage/pickup.' });
  }
});

// Update shipment notes (kiosk-friendly)
app.post('/api/shipments/:id/notes', async (req, res) => {
  try {
    const shipmentId = Number(req.params.id);
    if (!shipmentId) {
      return res.status(400).json({ error: 'Invalid shipment id.' });
    }

    const hasNotes = Object.prototype.hasOwnProperty.call(req.body || {}, 'notes');
    if (!hasNotes) {
      return res.status(400).json({ error: 'Notes are required.' });
    }

    const access = await ensureShipmentAccess(req);
    if (!access.ok) {
      return res
        .status(access.status || 403)
        .json({ error: access.error || 'Not authorized' });
    }
    const canViewPayroll = !!(access.perms && access.perms.view_payroll);

    const normalizeText = (val) => {
      if (val === undefined || val === null) return null;
      const s = String(val).trim();
      return s === '' ? null : s;
    };

    const nextNotes = normalizeText(req.body.notes);

    const existing = await dbGet(
      'SELECT id, notes FROM shipments WHERE id = ? AND org_id = ?',
      [shipmentId, access.orgId]
    );
    if (!existing) {
      return res.status(404).json({ error: 'Shipment not found.' });
    }

    await dbRun(
      `
        UPDATE shipments
        SET notes = ?,
            updated_at = datetime('now')
        WHERE id = ? AND org_id = ?
      `,
      [nextNotes, shipmentId, access.orgId]
    );

    const row = await dbGet(
      `SELECT s.*,
        COALESCE(s.vendor_name, v.name) AS vendor_name,
        COALESCE(s.project_name_snapshot, p.name) AS project_name,
        p.customer_name
       FROM shipments s
       LEFT JOIN vendors  v ON v.id = s.vendor_id AND v.org_id = s.org_id
       LEFT JOIN projects p ON p.id = s.project_id AND p.org_id = s.org_id
       WHERE s.id = ? AND s.org_id = ?`,
      [shipmentId, access.orgId]
    );

    await logAuditEvent({
      orgId: access.orgId,
      action: 'shipment.notes.update',
      entityType: 'shipment',
      entityId: shipmentId,
      actorEmployeeId: access.employee ? access.employee.id : null,
      actorName: access.employee ? access.employee.name : null,
      before: { notes: existing.notes || null },
      after: { notes: nextNotes }
    });

    res.json({
      shipment: canViewPayroll ? row : stripShipmentMoney(row)
    });
  } catch (err) {
    console.error('Error updating shipment notes from kiosk:', err);
    res.status(500).json({ error: 'Failed to update shipment notes.' });
  }
});

function resolveVerificationActor(req, access) {
  const actorUserId = (req.session && req.session.userId) || null;
  const actorEmployeeId =
    (req.session && req.session.employeeId) ||
    (access && access.employee ? access.employee.id : null);

  let actorName = null;
  if (access && access.employee && access.employee.name) {
    actorName = access.employee.name;
  }
  if (!actorName && actorEmployeeId) {
    actorName = `employee-${actorEmployeeId}`;
  }
  if (!actorName && actorUserId) {
    actorName = `user-${actorUserId}`;
  }
  if (!actorName) {
    actorName = 'unknown';
  }

  const via =
    access && access.via === 'kiosk'
      ? 'kiosk'
      : (req.session && req.session.userId ? 'session' : 'unknown');
  const actorDeviceId =
    access && access.via === 'kiosk' && access.kiosk
      ? access.kiosk.device_id || null
      : null;

  return {
    actorName,
    actorEmployeeId,
    actorUserId,
    actorDeviceId,
    via
  };
}

// Save verification for shipment items from kiosk-admin / field devices
app.post('/api/shipments/:id/verify-items', async (req, res) => {
  const shipmentId = Number(req.params.id);
  const { items, client_id } = req.body || {};
  let transactionStarted = false;

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

    const orgId = access.orgId;

    const shipmentRow = await dbGet(
      'SELECT id, status, is_archived FROM shipments WHERE id = ? AND org_id = ?',
      [shipmentId, orgId]
    );
    if (!shipmentRow) {
      return res.status(404).json({ error: 'Shipment not found.' });
    }

    if (client_id) {
      const cached = await loadIdempotentResponse(orgId, 'shipment_verify', client_id);
      if (cached) {
        return res.json({ ...cached, alreadyProcessed: true });
      }
    }

    const rawStatus = shipmentRow.status ? String(shipmentRow.status).toLowerCase().trim() : '';
    const isArchived =
      (shipmentRow.is_archived && Number(shipmentRow.is_archived) === 1) ||
      rawStatus.includes('archived');
    const isPickedUp = rawStatus.includes('picked') && rawStatus.includes('up');
    if (!isArchived && !isPickedUp) {
      return res.status(409).json({
        error: 'Items can only be reviewed after pickup is recorded.'
      });
    }

    const actor = resolveVerificationActor(req, access);
    const nowIso = new Date().toISOString();

    await dbRun('BEGIN TRANSACTION');
    transactionStarted = true;

    let storageLocationSet = false;

    for (const row of items) {
      const itemId = Number(row.shipment_item_id);
      if (!itemId) continue;

      const existing = await dbGet(
        `
          SELECT id, verification_json, verified, notes
          FROM shipment_items
          WHERE id = ? AND shipment_id = ? AND org_id = ?
        `,
        [itemId, shipmentId, orgId]
      );
      if (!existing) continue;

      let verification = null;
      if (existing.verification_json) {
        try {
          verification = JSON.parse(existing.verification_json);
        } catch {
          verification = null;
        }
      }

      const isObj =
        verification &&
        typeof verification === 'object' &&
        !Array.isArray(verification);
      if (!isObj || Object.keys(verification).length === 0) {
        verification = {
          status: existing.verified ? 'verified' : '',
          notes: existing.notes || '',
          storage_override: '',
          history: []
        };
      }

      if (!Array.isArray(verification.history)) {
        verification.history = [];
      }

      const payload = row.verification || {};
      const statusProvided = Object.prototype.hasOwnProperty.call(payload, 'status');
      const notesProvided = Object.prototype.hasOwnProperty.call(payload, 'notes');
      const storageProvided = Object.prototype.hasOwnProperty.call(payload, 'storage_override');
      const issueProvided = Object.prototype.hasOwnProperty.call(payload, 'issue_type');

      const newStatus = statusProvided
        ? String(payload.status || '').trim()
        : String(verification.status || '').trim();
      const newNotes = notesProvided
        ? String(payload.notes || '')
        : String(verification.notes || '');
      const newStorage = storageProvided
        ? String(payload.storage_override || '')
        : String(verification.storage_override || '');
      const newIssueType = issueProvided
        ? String(payload.issue_type || '')
        : String(verification.issue_type || '');

      const oldStatus = String(verification.status || '').trim();
      const oldStorage = String(verification.storage_override || '').trim();

      const normalizedStatus = newStatus.toLowerCase();
      const isVerified =
        normalizedStatus !== '' && normalizedStatus !== 'unverified';

      if (oldStatus !== newStatus) {
        verification.history.push({
          at: nowIso,
          from_status: oldStatus,
          to_status: newStatus,
          by_employee_id: actor.actorEmployeeId || null,
          by_name: actor.actorName || null,
          notes: newNotes || '',
          storage_override: newStorage || ''
        });
      }

      verification.status = newStatus;
      verification.notes = newNotes;
      verification.storage_override = newStorage || '';
      verification.issue_type = newIssueType || '';

      if (isVerified) {
        verification.verified_at = payload.verified_at || nowIso;
        verification.verified_by = actor.actorName || null;
        verification.verified_by_employee_id = actor.actorEmployeeId || null;
        verification.verified_by_user_id = actor.actorUserId || null;
        verification.verified_via = actor.via || null;
        verification.verified_device_id = actor.actorDeviceId || null;
      } else {
        verification.verified_at = null;
        verification.verified_by = null;
        verification.verified_by_employee_id = null;
        verification.verified_by_user_id = null;
        verification.verified_via = null;
        verification.verified_device_id = null;
      }

      if (!oldStorage && newStorage) {
        storageLocationSet = true;
      }

      await dbRun(
        `
          UPDATE shipment_items
          SET verification_json = ?,
              verified = ?,
              notes = ?
          WHERE id = ? AND shipment_id = ? AND org_id = ?
        `,
        [
          JSON.stringify(verification),
          isVerified ? 1 : 0,
          newNotes || null,
          itemId,
          shipmentId,
          orgId
        ]
      );
    }

    // Recompute items_verified flag (all items have a status other than empty/unverified)
    const uncheckedRow = await dbGet(
      `
        SELECT COUNT(*) AS cnt
        FROM shipment_items
        WHERE shipment_id = ? AND org_id = ?
          AND (
            (
              IFNULL(TRIM(verification_json), '') <> ''
              AND json_valid(verification_json)
              AND LOWER(TRIM(COALESCE(json_extract(verification_json, '$.status'), ''))) IN ('', 'unverified')
            )
            OR (
              (IFNULL(TRIM(verification_json), '') = '' OR NOT json_valid(verification_json))
              AND IFNULL(verified, 0) = 0
            )
          )
      `,
      [shipmentId, orgId]
    );

    const allVerified = uncheckedRow && uncheckedRow.cnt === 0;

    await dbRun(
      `
        UPDATE shipments
        SET items_verified = ?, updated_at = ?
        WHERE id = ? AND org_id = ?
      `,
      [allVerified ? 1 : 0, nowIso, shipmentId, orgId]
    );

    if (storageLocationSet) {
      await dbRun(
        `
          INSERT INTO shipment_timeline (
            org_id, shipment_id, event_type, note, created_by, created_at
          ) VALUES (?, ?, 'storage_location_set', NULL, ?, datetime('now'))
        `,
        [orgId, shipmentId, actor.actorEmployeeId || null]
      );
    }

    await dbRun('COMMIT');
    transactionStarted = false;

    const auditItems = items.map(row => {
      const payload = row && row.verification ? row.verification : {};
      return {
        shipment_item_id: row.shipment_item_id,
        status: payload.status || null,
        notes: payload.notes || null,
        storage_override: payload.storage_override || null,
        issue_type: payload.issue_type || null
      };
    });

    await logAuditEvent({
      orgId,
      action: 'shipment.items.verify',
      entityType: 'shipment',
      entityId: shipmentId,
      actorUserId: actor.actorUserId || null,
      actorEmployeeId: actor.actorEmployeeId || null,
      actorName: actor.actorName || null,
      after: {
        items: auditItems,
        items_verified: allVerified ? 1 : 0,
        storage_location_set: storageLocationSet ? 1 : 0
      }
    });

    const response = { ok: true, items_verified: allVerified };
    if (client_id) {
      await storeIdempotentResponse(orgId, 'shipment_verify', client_id, response);
    }

    res.json(response);
  } catch (err) {
    if (transactionStarted) {
      try {
        await dbRun('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Shipment verification rollback error:', rollbackErr);
      }
    }
    console.error('Error saving shipment verification from kiosk:', err);
    res.status(500).json({ error: 'Failed to save shipment verification.' });
  }
});


// Shipment templates
app.get('/api/shipments/templates', requireSeeShipments, async (req, res) => {
  try {
    const orgId = req.session && req.session.orgId;
    if (!orgId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    const canViewPayroll = !!(req.adminPerms && req.adminPerms.view_payroll);

    const rows = await dbAll(
      `
        SELECT
          t.*,
          v.name AS vendor_name,
          p.name AS project_name
        FROM shipment_templates t
        LEFT JOIN vendors v ON v.id = t.vendor_id AND v.org_id = t.org_id
        LEFT JOIN projects p ON p.id = t.project_id AND p.org_id = t.org_id
        WHERE t.org_id = ?
        ORDER BY t.created_at DESC, t.id DESC
      `,
      [orgId]
    );

    const templates = [];
    for (const row of rows || []) {
      const items = await dbAll(
        `
          SELECT description, sku, quantity, unit_price, line_total, vendor_name
          FROM shipment_template_items
          WHERE template_id = ? AND org_id = ?
          ORDER BY id ASC
        `,
        [row.id, orgId]
      );
      const template = canViewPayroll ? row : stripShipmentMoney(row);
      const safeItems = canViewPayroll ? (items || []) : stripShipmentItemsMoney(items || []);
      templates.push({
        ...template,
        items: safeItems
      });
    }

    res.json({ templates });
  } catch (err) {
    console.error('Error loading shipment templates:', err);
    res.status(500).json({ error: 'Failed to load shipment templates.' });
  }
});

app.post('/api/shipments/templates', requireSeeShipments, async (req, res) => {
  let transactionStarted = false;
  try {
    const orgId = req.session && req.session.orgId;
    const createdBy = req.session && req.session.employeeId
      ? req.session.employeeId
      : null;
    if (!orgId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    const canViewPayroll = !!(req.adminPerms && req.adminPerms.view_payroll);

    const {
      name,
      title,
      vendor_id,
      freight_forwarder,
      destination,
      project_id,
      sku,
      quantity,
      total_price,
      price_per_item,
      website_url,
      notes,
      items = []
    } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Template name is required.' });
    }

    if (vendor_id) {
      const vendorRow = await dbGet(
        'SELECT id FROM vendors WHERE id = ? AND org_id = ?',
        [vendor_id, orgId]
      );
      if (!vendorRow) {
        return res.status(400).json({ error: 'Vendor not found.' });
      }
    }

    if (project_id) {
      const projectRow = await dbGet(
        'SELECT id FROM projects WHERE id = ? AND org_id = ?',
        [project_id, orgId]
      );
      if (!projectRow) {
        return res.status(400).json({ error: 'Project not found.' });
      }
    }

    const nowIso = new Date().toISOString();
    await dbRun('BEGIN TRANSACTION');
    transactionStarted = true;
    const result = await dbRun(
      `
        INSERT INTO shipment_templates (
          org_id,
          name,
          title,
          vendor_id,
          freight_forwarder,
          destination,
          project_id,
          sku,
          quantity,
          total_price,
          price_per_item,
          website_url,
          notes,
          created_by,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        orgId,
        String(name).trim(),
        title || null,
        vendor_id || null,
        freight_forwarder || null,
        destination || null,
        project_id || null,
        sku || null,
        quantity != null ? quantity : null,
        canViewPayroll && total_price != null ? total_price : null,
        canViewPayroll && price_per_item != null ? price_per_item : null,
        website_url || null,
        notes || null,
        createdBy,
        nowIso,
        nowIso
      ]
    );

    const templateId = result?.lastID;

    if (Array.isArray(items) && items.length) {
      for (const it of items) {
        await dbRun(
          `
            INSERT INTO shipment_template_items (
              org_id,
              template_id,
              description,
              sku,
              quantity,
              unit_price,
              line_total,
              vendor_name,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          `,
          [
            orgId,
            templateId,
            it.description || null,
            it.sku || null,
            it.quantity != null ? it.quantity : 0,
            canViewPayroll && it.unit_price != null ? it.unit_price : null,
            canViewPayroll && it.line_total != null ? it.line_total : null,
            it.vendor_name || null
          ]
        );
      }
    }

    await dbRun('COMMIT');
    transactionStarted = false;

    await logAuditEvent({
      req,
      orgId,
      action: 'shipment.template.create',
      entityType: 'shipment_template',
      entityId: templateId,
      after: {
        name: String(name).trim(),
        title: title || null,
        vendor_id: vendor_id || null,
        project_id: project_id || null,
        item_count: Array.isArray(items) ? items.length : 0
      }
    });

    res.json({
      ok: true,
      template: {
        id: templateId,
        name: String(name).trim(),
        created_at: nowIso
      }
    });
  } catch (err) {
    if (transactionStarted) {
      try {
        await dbRun('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Shipment template create rollback error:', rollbackErr);
      }
    }
    console.error('Error creating shipment template:', err);
    res.status(500).json({ error: 'Failed to create shipment template.' });
  }
});

app.put('/api/shipments/templates/:id', requireSeeShipments, async (req, res) => {
  let transactionStarted = false;
  try {
    const orgId = req.session && req.session.orgId;
    const actorId = req.session && req.session.employeeId
      ? req.session.employeeId
      : null;
    if (!orgId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    const canViewPayroll = !!(req.adminPerms && req.adminPerms.view_payroll);

    const templateId = Number(req.params.id);
    if (!templateId) {
      return res.status(400).json({ error: 'Invalid template id.' });
    }

    const existing = await dbGet(
      `
        SELECT id, name, title, vendor_id, freight_forwarder, destination,
               project_id, sku, quantity, total_price, price_per_item,
               website_url, notes
        FROM shipment_templates
        WHERE id = ? AND org_id = ?
      `,
      [templateId, orgId]
    );
    if (!existing) {
      return res.status(404).json({ error: 'Template not found.' });
    }

    const {
      name,
      title,
      vendor_id,
      freight_forwarder,
      destination,
      project_id,
      sku,
      quantity,
      total_price,
      price_per_item,
      website_url,
      notes,
      items
    } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Template name is required.' });
    }

    const hasVendorId =
      vendor_id !== undefined && vendor_id !== null && vendor_id !== '';
    if (hasVendorId) {
      const vendorRow = await dbGet(
        'SELECT id FROM vendors WHERE id = ? AND org_id = ?',
        [vendor_id, orgId]
      );
      if (!vendorRow) {
        return res.status(400).json({ error: 'Vendor not found.' });
      }
    }

    const hasProjectId =
      project_id !== undefined && project_id !== null && project_id !== '';
    if (hasProjectId) {
      const projectRow = await dbGet(
        'SELECT id FROM projects WHERE id = ? AND org_id = ?',
        [project_id, orgId]
      );
      if (!projectRow) {
        return res.status(400).json({ error: 'Project not found.' });
      }
    }

    const totalPriceProvided = Object.prototype.hasOwnProperty.call(
      req.body || {},
      'total_price'
    );
    const pricePerItemProvided = Object.prototype.hasOwnProperty.call(
      req.body || {},
      'price_per_item'
    );
    const nextTotalPrice = canViewPayroll
      ? (totalPriceProvided
        ? (total_price != null ? total_price : null)
        : existing.total_price)
      : existing.total_price;
    const nextPricePerItem = canViewPayroll
      ? (pricePerItemProvided
        ? (price_per_item != null ? price_per_item : null)
        : existing.price_per_item)
      : existing.price_per_item;

    await dbRun('BEGIN TRANSACTION');
    transactionStarted = true;

    await dbRun(
      `
        UPDATE shipment_templates
        SET
          name = ?,
          title = ?,
          vendor_id = ?,
          freight_forwarder = ?,
          destination = ?,
          project_id = ?,
          sku = ?,
          quantity = ?,
          total_price = ?,
          price_per_item = ?,
          website_url = ?,
          notes = ?,
          created_by = COALESCE(created_by, ?),
          updated_at = datetime('now')
        WHERE id = ? AND org_id = ?
      `,
      [
        String(name).trim(),
        title || null,
        vendor_id || null,
        freight_forwarder || null,
        destination || null,
        project_id || null,
        sku || null,
        quantity != null ? quantity : null,
        nextTotalPrice,
        nextPricePerItem,
        website_url || null,
        notes || null,
        actorId,
        templateId,
        orgId
      ]
    );

    if (canViewPayroll && Array.isArray(items)) {
      await dbRun(
        `DELETE FROM shipment_template_items WHERE template_id = ? AND org_id = ?`,
        [templateId, orgId]
      );
      for (const it of items) {
        await dbRun(
          `
            INSERT INTO shipment_template_items (
              org_id,
              template_id,
              description,
              sku,
              quantity,
              unit_price,
              line_total,
              vendor_name,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          `,
          [
            orgId,
            templateId,
            it.description || null,
            it.sku || null,
            it.quantity != null ? it.quantity : 0,
            it.unit_price != null ? it.unit_price : 0,
            it.line_total != null ? it.line_total : 0,
            it.vendor_name || null
          ]
        );
      }
    }

    await dbRun('COMMIT');
    transactionStarted = false;

    await logAuditEvent({
      req,
      orgId,
      action: 'shipment.template.update',
      entityType: 'shipment_template',
      entityId: templateId,
      before: existing,
      after: {
        name: String(name).trim(),
        title: title || null,
        vendor_id: vendor_id || null,
        freight_forwarder: freight_forwarder || null,
        destination: destination || null,
        project_id: project_id || null,
        sku: sku || null,
        quantity: quantity != null ? quantity : null,
        total_price: nextTotalPrice,
        price_per_item: nextPricePerItem,
        website_url: website_url || null,
        notes: notes || null,
        item_count: Array.isArray(items) ? items.length : null
      }
    });

    res.json({ ok: true });
  } catch (err) {
    if (transactionStarted) {
      try {
        await dbRun('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Shipment template update rollback error:', rollbackErr);
      }
    }
    console.error('Error updating shipment template:', err);
    res.status(500).json({ error: 'Failed to update shipment template.' });
  }
});

app.delete('/api/shipments/templates/:id', requireSeeShipments, async (req, res) => {
  try {
    const orgId = req.session && req.session.orgId;
    if (!orgId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    const templateId = Number(req.params.id);
    if (!templateId) {
      return res.status(400).json({ error: 'Invalid template id.' });
    }

    const beforeRow = await dbGet(
      `
        SELECT id, name, title, vendor_id, project_id
        FROM shipment_templates
        WHERE id = ? AND org_id = ?
      `,
      [templateId, orgId]
    );

    await dbRun(
      `DELETE FROM shipment_template_items WHERE template_id = ? AND org_id = ?`,
      [templateId, orgId]
    );
    await dbRun(
      `DELETE FROM shipment_templates WHERE id = ? AND org_id = ?`,
      [templateId, orgId]
    );

    await logAuditEvent({
      req,
      orgId,
      action: 'shipment.template.delete',
      entityType: 'shipment_template',
      entityId: templateId,
      before: beforeRow
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting shipment template:', err);
    res.status(500).json({ error: 'Failed to delete shipment template.' });
  }
});


/* ───────── 9. REPORTS ───────── */

app.get('/api/time-entries/export/:format', requireViewTimeReports, async (req, res) => {
  const { format } = req.params;
  let { start, end, employee_id, project_id } = req.query;
  const orgId = req.session && req.session.orgId;
  if (!orgId) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  const orgTimezone = await getOrgTimezone(orgId);
  const allDates =
    req.query &&
    (req.query.all_dates === '1' ||
      req.query.all_dates === 'true' ||
      req.query.all_dates === 'yes');

  let canViewPayroll = false;
  let perms = req.adminPerms;
  const adminId = req.session && req.session.employeeId;
  try {
    if (!perms && adminId) {
      perms = await getAdminAccessPerms({ employeeId: adminId, orgId });
    }
    canViewPayroll = !!(perms && perms.view_payroll);
  } catch (err) {
    console.warn('Unable to load payroll permissions for export:', err.message);
  }
  const isSuperAdmin = adminId
    ? await isEmployeeSuperAdmin({ employeeId: adminId, orgId })
    : false;

  // Same default as normal endpoint: if no filters, default to "today"
  if (!allDates && !start && !end && !employee_id && !project_id) {
    const today = getTodayIsoDate(orgTimezone);
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
      COALESCE(e.name, t.employee_name_snapshot) AS employee_name,
      COALESCE(p.name, t.project_name_snapshot) AS project_name,
      COALESCE(MAX(CASE
        WHEN tp.geo_violation != 0 OR ks.geo_violation != 0 THEN 1
        ELSE 0
      END), 0) AS has_geo_violation,
      COALESCE(MAX(tp.auto_clock_out), 0) AS has_auto_clock_out
    FROM time_entries t
    LEFT JOIN employees   e ON t.employee_id = e.id AND e.org_id = t.org_id
    LEFT JOIN projects    p ON t.project_id = p.id AND p.org_id = t.org_id
    LEFT JOIN time_punches tp ON tp.time_entry_id = t.id AND tp.org_id = t.org_id
    LEFT JOIN kiosk_sessions ks ON ks.id = tp.kiosk_session_id AND ks.org_id = tp.org_id
    WHERE t.org_id = ?
  `;

  const params = [orgId];

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
  const visibility = buildTimeEntryVisibilityFilter({
    adminId,
    perms,
    isSuperAdmin,
    entryAlias: 't'
  });
  if (visibility.clause) {
    sql += ` AND ${visibility.clause.trim()}`;
    params.push(...visibility.params);
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
      p.name,
      t.employee_name_snapshot,
      t.project_name_snapshot
    ORDER BY t.start_date ASC, t.start_time ASC, t.id ASC
  `;

  try {
    const rows = await dbAll(sql, params);
    await logAuditEvent({
      req,
      orgId,
      action: 'report.export',
      entityType: 'org',
      entityId: orgId,
      after: {
        report: 'time_entries',
        format,
        start: start || null,
        end: end || null,
        employee_id: employee_id || null,
        project_id: project_id || null,
        row_count: rows.length
      }
    });
    const safeStart = start || 'all';
    const safeEnd   = end   || 'all';

    if (format === 'csv') {
      // ───────── CSV EXPORT ─────────
      const header = canViewPayroll
        ? [
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
          ]
        : [
            'Employee',
            'Project',
            'Start Date',
            'End Date',
            'Start Time',
            'End Time',
            'Hours',
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
      (rows || []).forEach(r => {
        const base = [
          r.employee_name || '',
          r.project_name || '',
          r.start_date || '',
          r.end_date || '',
          r.start_time || '',
          r.end_time || '',
          r.hours != null ? r.hours : ''
        ];
        const tail = canViewPayroll
          ? [
              r.total_pay != null ? r.total_pay : '',
              r.paid ? 'Yes' : 'No',
              r.paid_date || '',
              r.has_geo_violation ? 'Yes' : '',
              r.has_auto_clock_out ? 'Yes' : ''
            ]
          : [
              r.has_geo_violation ? 'Yes' : '',
              r.has_auto_clock_out ? 'Yes' : ''
            ];
        const rowArr = base.concat(tail);
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
        canViewPayroll
          ? 'Date        Time           Employee                     Project                          Hours   Paid'
          : 'Date        Time           Employee                     Project                          Hours',
        { underline: true }
      );
      doc.moveDown(0.3);

      (rows || []).forEach(r => {
        const date = r.start_date || '';
        const timeRange = `${r.start_time || ''}–${r.end_time || ''}`;
        const emp = (r.employee_name || '').slice(0, 26);
        const proj = (r.project_name || '').slice(0, 28);
        const hrs = r.hours != null ? r.hours.toFixed(2) : '';
        const paid = r.paid ? 'Yes' : 'No';

        const line = canViewPayroll
          ? `${date.padEnd(11)} ${timeRange.padEnd(13)} ${emp.padEnd(28)} ${proj.padEnd(30)} ${hrs.padEnd(7)} ${paid}`
          : `${date.padEnd(11)} ${timeRange.padEnd(13)} ${emp.padEnd(28)} ${proj.padEnd(30)} ${hrs}`;

        doc.fontSize(9).text(line);
      });

      doc.end();
      return;
    }

    // Unsupported format
    return res.status(400).json({ error: 'Unsupported export format.' });
  } catch (err) {
    console.error('Error exporting time entries:', err.message);
    return res.status(500).json({ error: err.message });
  }
});


app.get('/api/reports/payroll-runs', requireAdminAccess(p => p.view_payroll), (req, res) => {
  const orgId = req.session && req.session.orgId;
  if (!orgId) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  const sql = `
    SELECT
      pr.id,
      pr.start_date,
      pr.end_date,
      pr.created_at,
      pr.status,
      pr.run_type,
      pr.adjustment_reason,
      pr.last_error,
      pr.total_hours,
      pr.total_pay,
      COUNT(pc.id) AS check_count,
      SUM(CASE WHEN pc.paid = 1 THEN 1 ELSE 0 END) AS paid_checks
    FROM payroll_runs pr
    LEFT JOIN payroll_checks pc ON pc.payroll_run_id = pr.id AND pc.org_id = pr.org_id
    WHERE pr.org_id = ?
    GROUP BY pr.id
    ORDER BY pr.created_at DESC
  `;
  db.all(sql, [orgId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.get('/api/reports/payroll-audit', requireAdminAccess(p => p.view_payroll), (req, res) => {
  let limit = parseInt(req.query.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0 || limit > 500) {
    limit = 50;
  }
  const orgId = req.session && req.session.orgId;
  if (!orgId) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  const { start, end, actor } = req.query || {};
  const isYmd = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  if (start && !isYmd(start)) {
    return res.status(400).json({ error: 'start must be YYYY-MM-DD.' });
  }
  if (end && !isYmd(end)) {
    return res.status(400).json({ error: 'end must be YYYY-MM-DD.' });
  }

  const where = ['pal.org_id = ?'];
  const params = [orgId];

  if (start) {
    where.push(`date(pal.created_at) >= date(?)`);
    params.push(start);
  }
  if (end) {
    where.push(`date(pal.created_at) <= date(?)`);
    params.push(end);
  }
  if (actor) {
    const actorRaw = String(actor).trim();
    if (/^\d+$/.test(actorRaw)) {
      where.push('pal.actor_employee_id = ?');
      params.push(Number(actorRaw));
    } else {
      where.push('LOWER(e.name) LIKE ?');
      params.push(`%${actorRaw.toLowerCase()}%`);
    }
  }

  const sql = `
    SELECT
      pal.id,
      pal.event_type,
      pal.message,
      pal.details_json,
      pal.payroll_run_id,
      pal.created_at,
      pal.actor_employee_id,
      e.name AS actor_name
    FROM payroll_audit_log pal
    LEFT JOIN employees e ON e.id = pal.actor_employee_id AND e.org_id = pal.org_id
    WHERE ${where.join(' AND ')}
    ORDER BY pal.created_at DESC, pal.id DESC
    LIMIT ?
  `;

  db.all(sql, [...params, limit], (err, rows) => {
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
        details: parsedDetails,
        actor_employee_id: r.actor_employee_id,
        actor_name: r.actor_name || null
      };
    });

    res.json(mapped);
  });
});

app.get('/api/reports/time-entry-audit', requireViewTimeReports, async (req, res) => {
  try {
    const orgId = req.session && req.session.orgId;
    const adminId = req.session && req.session.employeeId;
    if (!orgId || !adminId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    let perms = req.adminPerms;
    if (!perms) {
      perms = await getAdminAccessPerms({ employeeId: adminId, orgId });
    }
    const isSuperAdmin = await isEmployeeSuperAdmin({ employeeId: adminId, orgId });

    const {
      start,
      end,
      employee_id,
      project_id,
      entry_id,
      actor,
      limit: limitRaw
    } = req.query || {};

    const isYmd = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
    if (start && !isYmd(start)) {
      return res.status(400).json({ error: 'start must be YYYY-MM-DD.' });
    }
    if (end && !isYmd(end)) {
      return res.status(400).json({ error: 'end must be YYYY-MM-DD.' });
    }

    let limit = parseInt(limitRaw, 10);
    if (!Number.isFinite(limit) || limit <= 0 || limit > 500) {
      limit = 200;
    }

    const where = [
      "tea.source_type = 'time_entry'",
      'tea.org_id = ?'
    ];
    const params = [orgId];

    if (start) {
      where.push('t.start_date >= ?');
      params.push(start);
    }
    if (end) {
      where.push('t.end_date <= ?');
      params.push(end);
    }
    if (employee_id) {
      const empId = Number(employee_id);
      if (!Number.isFinite(empId) || empId <= 0) {
        return res.status(400).json({ error: 'employee_id must be a valid id.' });
      }
      where.push('t.employee_id = ?');
      params.push(empId);
    }
    if (project_id) {
      const projId = Number(project_id);
      if (!Number.isFinite(projId) || projId <= 0) {
        return res.status(400).json({ error: 'project_id must be a valid id.' });
      }
      where.push('t.project_id = ?');
      params.push(projId);
    }
    if (entry_id) {
      const entryId = Number(entry_id);
      if (!Number.isFinite(entryId) || entryId <= 0) {
        return res.status(400).json({ error: 'entry_id must be a valid id.' });
      }
      where.push('t.id = ?');
      params.push(entryId);
    }
    if (actor) {
      const actorRaw = String(actor).trim();
      if (/^\d+$/.test(actorRaw)) {
        where.push('tea.actor_employee_id = ?');
        params.push(Number(actorRaw));
      } else {
        where.push('LOWER(tea.actor_name) LIKE ?');
        params.push(`%${actorRaw.toLowerCase()}%`);
      }
    }

    const visibility = buildTimeEntryVisibilityFilter({
      adminId,
      perms,
      isSuperAdmin,
      entryAlias: 't'
    });
    if (visibility.clause) {
      where.push(visibility.clause);
      params.push(...visibility.params);
    }

    const sql = `
      SELECT
        tea.id,
        tea.action,
        tea.actor_name,
        tea.actor_employee_id,
        tea.actor_user_id,
        tea.note,
        tea.changes_json,
        tea.created_at,
        t.id AS entry_id,
        t.employee_id,
        t.project_id,
        t.start_date,
        t.end_date,
        t.start_time,
        t.end_time,
        t.hours,
        COALESCE(e.name, t.employee_name_snapshot) AS employee_name,
        COALESCE(p.name, t.project_name_snapshot) AS project_name
      FROM time_exception_actions tea
      JOIN time_entries t
        ON t.id = tea.source_id
       AND t.org_id = tea.org_id
      LEFT JOIN employees e ON e.id = t.employee_id AND e.org_id = t.org_id
      LEFT JOIN projects p ON p.id = t.project_id AND p.org_id = t.org_id
      WHERE ${where.join(' AND ')}
      ORDER BY tea.created_at DESC, tea.id DESC
      LIMIT ?
    `;

    const rows = await dbAll(sql, [...params, limit]);
    const mapped = (rows || []).map(row => {
      let before = null;
      let after = null;
      if (row.changes_json) {
        try {
          const parsed = JSON.parse(row.changes_json);
          before = parsed && parsed.before ? parsed.before : null;
          after = parsed && parsed.after ? parsed.after : null;
        } catch {
          before = null;
          after = null;
        }
      }
      return {
        id: row.id,
        action: row.action,
        actor_name: row.actor_name || null,
        actor_employee_id: row.actor_employee_id || null,
        actor_user_id: row.actor_user_id || null,
        note: row.note || null,
        created_at: row.created_at || null,
        entry_id: row.entry_id,
        employee_id: row.employee_id,
        project_id: row.project_id,
        employee_name: row.employee_name || null,
        project_name: row.project_name || null,
        before,
        after
      };
    });

    return res.json({ rows: mapped });
  } catch (err) {
    console.error('Error loading time entry audit log:', err);
    return res.status(500).json({ error: 'Failed to load time entry audit log.' });
  }
});

app.get('/api/reports/audit-log', async (req, res) => {
  try {
    const ctx = await getAdminContext(req);
    if (!ctx) {
      return res.status(403).json({ error: 'Admin privileges required.' });
    }

    const orgId = ctx.orgId;
    const employeeId = ctx.employee.id;
    const isSuperAdmin = await isEmployeeSuperAdmin({ employeeId, orgId });

    const {
      domain = 'all',
      start,
      end,
      actor,
      entity_type,
      entity_id,
      limit: limitRaw
    } = req.query || {};

    const isYmd = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
    if (start && !isYmd(start)) {
      return res.status(400).json({ error: 'start must be YYYY-MM-DD.' });
    }
    if (end && !isYmd(end)) {
      return res.status(400).json({ error: 'end must be YYYY-MM-DD.' });
    }

    const domainConfig = {
      all: { superAdmin: true, prefixes: [] },
      access: {
        superAdmin: true,
        prefixes: ['auth.', 'user.', 'access.', 'employee.access.']
      },
      employees: {
        perm: 'view_payroll',
        prefixes: ['employee.'],
        excludePrefixes: ['employee.access.']
      },
      payroll: { perm: 'view_payroll', prefixes: ['payroll.'] },
      shipments: { perm: 'see_shipments', prefixes: ['shipment.'] },
      kiosks: { perm: 'view_payroll', prefixes: ['kiosk.'] },
      settings: {
        perm: 'view_payroll',
        prefixes: ['settings.', 'admin.backup.', 'org.']
      },
      notifications: { perm: 'view_payroll', prefixes: ['notification.'] },
      quickbooks: { superAdmin: true, prefixes: ['qbo.'] },
      projects: { perm: 'view_payroll', prefixes: ['project.', 'vendor.'] },
      reports: { perm: 'view_payroll', prefixes: ['report.'] }
    };

    const domainKey = String(domain || '').trim().toLowerCase();
    const config = domainConfig[domainKey];
    if (!config) {
      return res.status(400).json({ error: 'Invalid audit domain.' });
    }

    if (config.superAdmin && !isSuperAdmin) {
      return res.status(403).json({ error: 'Super admin privileges required.' });
    }
    if (config.perm && !ctx.perms[config.perm]) {
      return res.status(403).json({ error: 'Not authorized.' });
    }

    let limit = parseInt(limitRaw, 10);
    if (!Number.isFinite(limit) || limit <= 0 || limit > 500) {
      limit = 200;
    }

    const where = ['a.org_id = ?'];
    const params = [orgId];

    if (config.prefixes && config.prefixes.length) {
      where.push(
        `(${config.prefixes.map(() => 'a.action LIKE ?').join(' OR ')})`
      );
      config.prefixes.forEach(prefix => params.push(`${prefix}%`));
    }
    if (config.excludePrefixes && config.excludePrefixes.length) {
      config.excludePrefixes.forEach(prefix => {
        where.push('a.action NOT LIKE ?');
        params.push(`${prefix}%`);
      });
    }

    if (start) {
      where.push('date(a.created_at) >= date(?)');
      params.push(start);
    }
    if (end) {
      where.push('date(a.created_at) <= date(?)');
      params.push(end);
    }

    if (actor) {
      const actorRaw = String(actor).trim();
      if (/^\d+$/.test(actorRaw)) {
        where.push('(a.actor_employee_id = ? OR a.actor_user_id = ?)');
        params.push(Number(actorRaw), Number(actorRaw));
      } else {
        where.push('LOWER(COALESCE(e.name, u.email, \'\')) LIKE ?');
        params.push(`%${actorRaw.toLowerCase()}%`);
      }
    }

    if (entity_type) {
      where.push('a.entity_type = ?');
      params.push(String(entity_type).trim());
    }
    if (entity_id) {
      const entityId = Number(entity_id);
      if (!Number.isFinite(entityId) || entityId <= 0) {
        return res.status(400).json({ error: 'entity_id must be a valid id.' });
      }
      where.push('a.entity_id = ?');
      params.push(entityId);
    }

    const sql = `
      SELECT
        a.id,
        a.action,
        a.entity_type,
        a.entity_id,
        a.before_json,
        a.after_json,
        a.note,
        a.created_at,
        a.actor_employee_id,
        a.actor_user_id,
        e.name AS actor_employee_name,
        u.email AS actor_user_email
      FROM audit_log a
      LEFT JOIN employees e ON e.id = a.actor_employee_id AND e.org_id = a.org_id
      LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE ${where.join(' AND ')}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ?
    `;

    const rows = await dbAll(sql, [...params, limit]);
    const mapped = (rows || []).map(row => {
      let before = null;
      let after = null;
      if (row.before_json) {
        try {
          before = JSON.parse(row.before_json);
        } catch {
          before = null;
        }
      }
      if (row.after_json) {
        try {
          after = JSON.parse(row.after_json);
        } catch {
          after = null;
        }
      }
      const actorName =
        row.actor_employee_name ||
        row.actor_user_email ||
        (row.actor_employee_id ? `employee-${row.actor_employee_id}` : null) ||
        (row.actor_user_id ? `user-${row.actor_user_id}` : null) ||
        'system';

      return {
        id: row.id,
        action: row.action,
        entity_type: row.entity_type || null,
        entity_id: row.entity_id || null,
        note: row.note || null,
        created_at: row.created_at || null,
        actor_employee_id: row.actor_employee_id || null,
        actor_user_id: row.actor_user_id || null,
        actor_name: actorName,
        before,
        after
      };
    });

    return res.json({ rows: mapped });
  } catch (err) {
    console.error('Error loading audit log:', err);
    return res.status(500).json({ error: 'Failed to load audit log.' });
  }
});

app.get('/api/reports/payroll-runs/:id', requireAdminAccess(p => p.view_payroll), (req, res) => {
  const runId = parseInt(req.params.id, 10);
  if (Number.isNaN(runId)) {
    return res.status(400).json({ error: 'Invalid payroll run id.' });
  }
  const orgId = req.session && req.session.orgId;
  if (!orgId) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  const sql = `
    SELECT
      pc.id,
      COALESCE(e.name, '(Unknown employee)') AS employee_name,
      pc.total_hours,
      pc.total_pay,
      pc.check_number,
      pc.paid,
      pc.paid_date
    FROM payroll_checks pc
    LEFT JOIN employees e ON pc.employee_id = e.id AND e.org_id = pc.org_id
    WHERE pc.payroll_run_id = ?
      AND pc.org_id = ?
    ORDER BY e.name
  `;
  db.all(sql, [runId, orgId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.patch('/api/reports/checks/:id', requireAdminAccess(p => p.modify_payroll), async (req, res) => {
  const checkId = parseInt(req.params.id, 10);
  if (Number.isNaN(checkId)) {
    return res.status(400).json({ error: 'Invalid check id.' });
  }
  const orgId = req.session && req.session.orgId;
  if (!orgId) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  const { check_number, paid } = req.body || {};
  const updates = [];
  const params = [];
  const paidProvided = typeof paid === 'boolean';

  if (check_number !== undefined) {
    updates.push('check_number = ?');
    params.push(check_number);
  }

  const checkRow = await dbGet(
    `SELECT id, payroll_run_id, employee_id, paid, paid_date, check_number FROM payroll_checks WHERE id = ? AND org_id = ?`,
    [checkId, orgId]
  );
  if (!checkRow) {
    return res.status(404).json({ error: 'Payroll check not found.' });
  }

  let runRow = null;
  if (paidProvided) {
    runRow = await dbGet(
      `SELECT start_date, end_date FROM payroll_runs WHERE id = ? AND org_id = ?`,
      [checkRow.payroll_run_id, orgId]
    );
    if (!runRow) {
      return res.status(400).json({ error: 'Payroll run not found for this check.' });
    }
  }

  let paidAt = null;
  if (paidProvided) {
    if (paid) {
      paidAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
      updates.push('paid = 1');
      updates.push('paid_date = ?');
      updates.push('voided_at = NULL');
      updates.push('voided_reason = NULL');
      params.push(paidAt);
    } else {
      updates.push('paid = 0');
      updates.push('paid_date = NULL');
      updates.push('voided_at = datetime(\'now\')');
      updates.push('voided_reason = ?');
      params.push('manual unpay');
    }
  }

  if (!updates.length) {
    return res.status(400).json({ error: 'No fields to update.' });
  }

  try {
    await dbRun('BEGIN TRANSACTION');

    await dbRun(
      `UPDATE payroll_checks SET ${updates.join(', ')} WHERE id = ? AND org_id = ?`,
      [...params, checkId, orgId]
    );

    if (paidProvided) {
      if (paid) {
        await dbRun(
          `
            UPDATE time_entries
            SET paid = 1,
                paid_date = ?,
                payroll_run_id = ?,
                payroll_check_id = ?,
                updated_at = ?
            WHERE employee_id = ?
              AND org_id = ?
              AND start_date >= ?
              AND end_date <= ?
              AND (paid IS NULL OR paid = 0)
          `,
          [
            paidAt,
            checkRow.payroll_run_id,
            checkId,
            new Date().toISOString(),
            checkRow.employee_id,
            orgId,
            runRow.start_date,
            runRow.end_date
          ]
        );
      } else {
        await dbRun(
          `
            UPDATE time_entries
            SET paid = 0,
                paid_date = NULL,
                payroll_run_id = NULL,
                payroll_check_id = NULL,
                updated_at = ?
            WHERE employee_id = ?
              AND payroll_run_id = ?
              AND org_id = ?
          `,
          [new Date().toISOString(), checkRow.employee_id, checkRow.payroll_run_id, orgId]
        );
      }

      await dbRun(
        `
          UPDATE payroll_runs
          SET total_hours = (
                SELECT IFNULL(SUM(total_hours), 0)
              FROM payroll_checks
              WHERE payroll_run_id = ? AND org_id = ?
            ),
            total_pay = (
              SELECT IFNULL(SUM(total_pay), 0)
              FROM payroll_checks
              WHERE payroll_run_id = ? AND org_id = ?
            )
          WHERE id = ? AND org_id = ?
        `,
        [
          checkRow.payroll_run_id,
          orgId,
          checkRow.payroll_run_id,
          orgId,
          checkRow.payroll_run_id,
          orgId
        ]
      );
    }

    await dbRun('COMMIT');

    const afterAudit = {
      check_number:
        check_number !== undefined ? check_number : (checkRow.check_number || null),
      paid: paidProvided ? (paid ? 1 : 0) : (checkRow.paid ? 1 : 0),
      paid_date: paidProvided ? (paid ? paidAt : null) : (checkRow.paid_date || null)
    };
    await logAuditEvent({
      req,
      orgId,
      action: 'payroll.check.update',
      entityType: 'payroll_check',
      entityId: checkId,
      before: {
        check_number: checkRow.check_number || null,
        paid: checkRow.paid ? 1 : 0,
        paid_date: checkRow.paid_date || null
      },
      after: afterAudit,
      note: paidProvided ? (paid ? 'Payroll check marked paid.' : 'Payroll check marked unpaid.') : 'Payroll check updated.'
    });

    res.json({
      ok: true,
      paid: paidProvided ? (paid ? 1 : 0) : checkRow.paid,
      paid_date: paidProvided ? (paid ? paidAt : null) : undefined
    });
  } catch (err) {
    await dbRun('ROLLBACK');
    console.error('Error updating payroll check:', err);
    res.status(500).json({ error: err.message || 'Failed to update check.' });
  }
});

app.get('/api/reports/payroll-audit-log', requireAdminAccess(p => p.view_payroll), async (req, res) => {
  try {
    let limit = parseInt(req.query.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0 || limit > 1000) {
      limit = 200; // sensible default
    }
    const orgId = req.session && req.session.orgId;
    if (!orgId) {
      return res.status(401).json({ ok: false, error: 'Not authenticated.' });
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
        WHERE org_id = ?
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT ?
      `,
      [orgId, limit]
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
      end,
      include_archived
    } = req.query || {};

    const access = await ensureShipmentAccess(req);
    if (!access.ok) {
      return res
        .status(access.status || 403)
        .json({ error: access.error || 'Not authorized' });
    }
    const orgId = access.orgId;
    const orgTimezone = await getOrgTimezone(orgId);
    const canViewPayments = !!(access.perms && access.perms.view_payroll);

    let startDate = start ? String(start).trim() : '';
    let endDate = end ? String(end).trim() : '';
    if (!startDate) startDate = null;
    if (!endDate) endDate = null;
    const statusFilter = status ? String(status).trim() : '';
    const statusKey = statusFilter.toLowerCase();
    const includeArchived =
      statusKey === 'all'
        ? true
        : statusKey === 'active'
          ? false
          : coerceBooleanFlag(include_archived);

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
                COALESCE(s.project_name_snapshot, p.name) AS project_name,
                p.customer_name
           FROM shipments s
      LEFT JOIN vendors  v ON v.id = s.vendor_id AND v.org_id = s.org_id
      LEFT JOIN projects p ON p.id = s.project_id AND p.org_id = s.org_id
          WHERE s.id = ? AND s.org_id = ?`,
        [id, orgId]
      );

      if (!shipment) {
        return res.status(404).json({ error: 'Shipment not found.' });
      }

      if (!canViewPayments && shipment) {
        shipment.vendor_paid_amount = null;
        shipment.shipper_paid_amount = null;
        shipment.customs_paid_amount = null;
        shipment.storage_paid_amount = null;
        shipment.shipper_paid_by = null;
        shipment.customs_paid_by = null;
        shipment.total_paid = null;
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
            vendor_name,
            verified,
            notes,
            verification_json
          FROM shipment_items
          WHERE shipment_id = ? AND org_id = ?
          ORDER BY id ASC
        `,
        [id, orgId]
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

        const isObj =
          verification &&
          typeof verification === 'object' &&
          !Array.isArray(verification);

        if (!isObj || isEmptyObject) {
          verification = {
            status: it.verified ? 'verified' : '',
            notes: it.notes || '',
            storage_override: '',
            history: []
          };
        } else {
          // Ensure we always have an array for history
          if (!Array.isArray(verification.history)) {
            verification.history = [];
          }
        }

        if (!verification.storage_override) {
          verification.storage_override = verification.storage_override || '';
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
    let where = 'WHERE s.org_id = ? ';
    params.push(orgId);

    const isArchivedOnly = statusKey === 'archived';
    const isAllStatus = statusKey === 'all' || statusKey === 'active' || !statusFilter;

    if (isArchivedOnly) {
      where += 'AND IFNULL(s.is_archived, 0) = 1 ';
    } else if (!includeArchived) {
      where += 'AND IFNULL(s.is_archived, 0) = 0 ';
    }

    if (project_id) {
      where += 'AND s.project_id = ? ';
      params.push(project_id);
    }

    if (!isAllStatus && !isArchivedOnly) {
      where += 'AND s.status = ? ';
      params.push(statusFilter);
    }

    // "Ready for pickup" filter:
    //  - items_verified = 1 (all items verified)
    //  - picked_up_by IS NULL (not yet picked up)
    //  - status is "Cleared - Ready for Pickup" (adjust if you like)
    if (
      ready_for_pickup === '1' ||
      ready_for_pickup === 'true' ||
      ready_for_pickup === 'yes'
    ) {
      where += `
        AND s.items_verified = 1
        AND (s.picked_up_by IS NULL OR s.picked_up_by = '')
        AND s.status = 'Cleared - Ready for Pickup'
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
          COALESCE(s.project_name_snapshot, p.name) AS project_name,
          p.customer_name,
          s.items_verified,
          (
            SELECT COUNT(*) FROM shipment_items si
            WHERE si.shipment_id = s.id AND si.org_id = s.org_id
          ) AS items_total,
          (
            SELECT COUNT(*)
            FROM shipment_items si
            WHERE si.shipment_id = s.id AND si.org_id = s.org_id
              AND (
                (
                  IFNULL(TRIM(si.verification_json), '') <> ''
                  AND json_valid(si.verification_json)
                  AND LOWER(
                    TRIM(
                      COALESCE(
                        json_extract(si.verification_json, '$.status'),
                        ''
                      )
                    )
                  ) NOT IN ('', 'unverified')
                )
                OR (
                  (IFNULL(TRIM(si.verification_json), '') = '' OR NOT json_valid(si.verification_json))
                  AND IFNULL(si.verified, 0) = 1
                )
              )
          ) AS items_verified_count,
          s.picked_up_by,
          s.picked_up_date,
          s.picked_up_updated_by,
          s.picked_up_updated_at,
          s.notes,
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
          s.shipper_paid_by,
          s.customs_paid,
          s.customs_paid_amount,
          s.customs_paid_by,
          s.storage_paid,
          s.storage_paid_amount,
          s.storage_paid_by,
          s.total_paid,
          COALESCE(s.vendor_name, v.name) AS vendor_name,
          (
            SELECT COUNT(DISTINCT TRIM(IFNULL(si.vendor_name, '')))
            FROM shipment_items si
            WHERE si.shipment_id = s.id AND si.org_id = s.org_id
              AND TRIM(IFNULL(si.vendor_name, '')) <> ''
          ) AS distinct_item_vendors
        FROM shipments s
        LEFT JOIN vendors v ON v.id = s.vendor_id AND v.org_id = s.org_id
        LEFT JOIN projects p ON p.id = s.project_id AND p.org_id = s.org_id
        ${where}
        ORDER BY
          date(IFNULL(s.updated_at, s.created_at)) DESC,
          s.id DESC
      `,
      params
    );

    let filteredRows = rows || [];
    if (startDate || endDate) {
      filteredRows = filteredRows.filter(row => {
        const createdLocal =
          getIsoDateInTimezone(row.created_at, orgTimezone) ||
          (row.created_at ? String(row.created_at).slice(0, 10) : null);
        if (!createdLocal) return false;
        if (startDate && createdLocal < startDate) return false;
        if (endDate && createdLocal > endDate) return false;
        return true;
      });
    }

    let finalRows = filteredRows;
    if (!canViewPayments) {
      finalRows = filteredRows.map(row => ({
        ...row,
        vendor_paid_amount: null,
        shipper_paid_amount: null,
        customs_paid_amount: null,
        storage_paid_amount: null,
        shipper_paid_by: null,
        customs_paid_by: null,
        storage_paid_by: null,
        total_paid: null
      }));
    }

    return res.json({
      mode: 'summary',
      shipments: finalRows
    });
  } catch (err) {
    console.error('Error in /api/reports/shipment-verification:', err);
    res.status(500).json({ error: 'Failed to load shipment verification report.' });
  }
});

/* ───────── MIDNIGHT AUTO CLOCK-OUT JOB ───────── */

const autoClockOutTimers = new Map();
let autoClockOutJobRunning = false;

async function closePunchWithAutoClockOut({ punch, clockOutIso, reason }) {
  if (!punch || !punch.id || !punch.org_id) return;

  const nowIso = clockOutIso || new Date().toISOString();
  let transactionStarted = false;

  try {
    await dbRun('BEGIN IMMEDIATE');
    transactionStarted = true;

    const current = await dbGet(
      `
        SELECT id, org_id, employee_id, project_id, foreman_employee_id,
               clock_in_ts, clock_in_local_date, created_at, clock_out_ts, time_entry_id
        FROM time_punches
        WHERE id = ? AND org_id = ?
        LIMIT 1
      `,
      [punch.id, punch.org_id]
    );
    if (!current || current.clock_out_ts) {
      await dbRun('ROLLBACK');
      return;
    }

    const orgTimezone = await getOrgTimezone(current.org_id);
    let startIso = current.clock_in_ts || null;
    let start = startIso ? new Date(startIso) : null;
    if (!start || Number.isNaN(start.getTime())) {
      startIso = current.created_at || null;
      start = startIso ? new Date(startIso) : null;
    }
    if (!start || Number.isNaN(start.getTime())) {
      startIso = nowIso;
      start = new Date(startIso);
    }
    const end = new Date(nowIso);

    let diffMs = end - start;
    let minutes = Math.ceil(diffMs / 60000);
    if (!Number.isFinite(minutes) || minutes < 0) {
      minutes = 0;
    }

    const hours = minutes / 60;
    const startDate = getIsoDateInTimezone(startIso, orgTimezone);
    const endDate = getIsoDateInTimezone(nowIso, orgTimezone);
    const startTime = getIsoTimeInTimezone(startIso, orgTimezone);
    const endTime = getIsoTimeInTimezone(nowIso, orgTimezone);
    const clockOutLocalDate = getIsoDateInTimezone(nowIso, orgTimezone);
    const clockInLocalDate =
      current.clock_in_local_date || getIsoDateInTimezone(startIso, orgTimezone);

    const updateRes = await dbRun(
      `
        UPDATE time_punches
        SET clock_out_ts = ?,
            clock_out_local_date = ?,
            clock_in_local_date = COALESCE(clock_in_local_date, ?),
            auto_clock_out = 1,
            auto_clock_out_reason = ?,
            clock_out_project_id = ?,
            updated_at = ?
        WHERE id = ? AND org_id = ? AND clock_out_ts IS NULL
      `,
      [
        nowIso,
        clockOutLocalDate,
        clockInLocalDate,
        reason,
        current.project_id || null,
        nowIso,
        current.id,
        current.org_id
      ]
    );

    if (!updateRes || !updateRes.changes) {
      await dbRun('ROLLBACK');
      return;
    }

    if (current.time_entry_id) {
      await dbRun('COMMIT');
      return;
    }

    const emp = await dbGet(
      'SELECT rate FROM employees WHERE id = ? AND org_id = ?',
      [current.employee_id, current.org_id]
    );
    const rate = emp ? Number(emp.rate || 0) : 0;
    const totalPay = rate * hours;

    const insertEntry = await dbRun(
      `
        INSERT INTO time_entries
          (org_id,
           employee_id,
           project_id,
           start_date,
           end_date,
           start_time,
           end_time,
           hours,
           total_pay,
           foreman_employee_id,
           employee_name_snapshot,
           project_name_snapshot,
           updated_at)
        VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          (SELECT name FROM employees WHERE id = ? AND org_id = ?),
          (SELECT name FROM projects  WHERE id = ? AND org_id = ?),
          ?
        )
      `,
      [
        current.org_id,
        current.employee_id,
        current.project_id || null,
        startDate,
        endDate,
        startTime,
        endTime,
        hours,
        totalPay,
        current.foreman_employee_id || null,
        current.employee_id,
        current.org_id,
        current.project_id || null,
        current.org_id,
        nowIso
      ]
    );

    const entryId = insertEntry.lastID;

    await dbRun(
      `
        UPDATE time_punches
        SET time_entry_id = ?,
            updated_at = ?
        WHERE id = ? AND org_id = ?
      `,
      [entryId, nowIso, current.id, current.org_id]
    );

    await dbRun('COMMIT');
    transactionStarted = false;
  } catch (err) {
    if (transactionStarted) {
      try {
        await dbRun('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Auto clock-out rollback error:', rollbackErr);
      }
    }
    console.error('Auto clock-out close error:', err);
  }
}

async function autoClockOutStaleOpenPunchesForOrg({
  orgId,
  timeZone,
  reason = 'midnight_auto'
}) {
  if (!orgId) return;
  const tz = timeZone || (await getOrgTimezone(orgId));
  const gotLock = await acquireAutoClockOutLock(orgId);
  if (!gotLock) {
    return;
  }

  try {
    const refreshIntervalMs = Math.max(
      30000,
      Math.floor(AUTO_CLOCKOUT_LOCK_TTL_MS / 2)
    );
    let lastRefresh = Date.now();
    const refreshIfNeeded = async () => {
      const now = Date.now();
      if (now - lastRefresh >= refreshIntervalMs) {
        await refreshAutoClockOutLock(orgId);
        lastRefresh = now;
      }
    };

    const openPunches = await dbAll(
      `
        SELECT *
        FROM time_punches
        WHERE org_id = ?
          AND clock_out_ts IS NULL
      `,
      [orgId]
    );

    if (!openPunches || openPunches.length === 0) {
      console.log(`⏰ Auto clock-out (${reason}): no stale open punches for org ${orgId}.`);
      return;
    }

    const todayLocal = getTodayIsoDate(tz);
    const stalePunches = openPunches
      .map(p => {
        const localDate =
          p.clock_in_local_date ||
          getIsoDateInTimezone(p.clock_in_ts, tz) ||
          getIsoDateInTimezone(p.created_at, tz);
        return { punch: p, localDate };
      })
      .filter(({ punch, localDate }) => {
        if (!localDate) {
          console.warn(
            `⏰ Auto clock-out (${reason}): skipping punch ${punch?.id || 'unknown'} for org ${orgId} (missing local date).`
          );
          return false;
        }
        return localDate < todayLocal;
      });

    if (!stalePunches.length) {
      console.log(`⏰ Auto clock-out (${reason}): no stale open punches for org ${orgId}.`);
      return;
    }

    for (const { punch, localDate } of stalePunches) {
      const endOfDayIso = localDate ? getLocalEndOfDayIso(localDate, tz) : null;
      await closePunchWithAutoClockOut({
        punch,
        clockOutIso: endOfDayIso || new Date().toISOString(),
        reason
      });
      await refreshIfNeeded();
    }

    console.log(
      `⏰ Auto clock-out (${reason}): closed ${stalePunches.length} open punches for org ${orgId}.`
    );
  } catch (err) {
    console.error(`⏰ Auto clock-out (${reason}) error for org ${orgId}:`, err);
  } finally {
    await releaseAutoClockOutLock(orgId);
  }
}

async function autoClockOutThresholdPunchesForOrg({ orgId, timeZone }) {
  if (!orgId) return;
  const tz = timeZone || (await getOrgTimezone(orgId));
  const rulesMap = await loadExceptionRulesMap(orgId);
  const dailyMax = Number(rulesMap?.auto_clockout_daily_max_hours);
  const weeklyMax = Number(rulesMap?.auto_clockout_weekly_max_hours);

  const dailyThreshold =
    Number.isFinite(dailyMax) && dailyMax > 0 ? dailyMax : null;
  const weeklyThreshold =
    Number.isFinite(weeklyMax) && weeklyMax > 0 ? weeklyMax : null;

  if (!dailyThreshold && !weeklyThreshold) return;

  const gotLock = await acquireAutoClockOutLock(orgId);
  if (!gotLock) {
    return;
  }

  try {
    const refreshIntervalMs = Math.max(
      30000,
      Math.floor(AUTO_CLOCKOUT_LOCK_TTL_MS / 2)
    );
    let lastRefresh = Date.now();
    const refreshIfNeeded = async () => {
      const now = Date.now();
      if (now - lastRefresh >= refreshIntervalMs) {
        await refreshAutoClockOutLock(orgId);
        lastRefresh = now;
      }
    };

    const openPunches = await dbAll(
      `
        SELECT *
        FROM time_punches
        WHERE org_id = ?
          AND clock_out_ts IS NULL
      `,
      [orgId]
    );

    if (!openPunches || openPunches.length === 0) return;

    let weeklyTotals = new Map();
    let weekStartKey = null;
    if (weeklyThreshold) {
      const weekStartResolver = makeWeekStartResolver(tz);
      weekStartKey = weekStartResolver(new Date());
      if (weekStartKey) {
        const weekEndKey = shiftIsoDate(weekStartKey, 6);
        const windowStart = shiftIsoDate(weekStartKey, -1);
        const windowEnd = shiftIsoDate(weekEndKey, 1);
        const rows = await dbAll(
          `
            SELECT employee_id, clock_in_ts, clock_out_ts
            FROM time_punches
            WHERE org_id = ?
              AND clock_out_ts IS NOT NULL
              AND clock_in_local_date >= ?
              AND clock_in_local_date <= ?
          `,
          [orgId, windowStart, windowEnd]
        );

        for (const row of rows || []) {
          const startTs = row.clock_in_ts ? new Date(row.clock_in_ts) : null;
          const endTs = row.clock_out_ts ? new Date(row.clock_out_ts) : null;
          if (!startTs || !endTs) continue;
          if (Number.isNaN(startTs.getTime()) || Number.isNaN(endTs.getTime())) continue;
          const hours = (endTs - startTs) / (1000 * 60 * 60);
          if (!Number.isFinite(hours) || hours < 0) continue;
          const rowWeekKey = weekStartResolver(startTs);
          if (rowWeekKey !== weekStartKey) continue;
          const empKey = Number(row.employee_id);
          weeklyTotals.set(empKey, (weeklyTotals.get(empKey) || 0) + hours);
        }
      }
    }

    await refreshIfNeeded();

    for (const punch of openPunches) {
      const startIso = punch.clock_in_ts || null;
      if (!startIso) continue;
      const start = new Date(startIso);
      if (Number.isNaN(start.getTime())) continue;

      const nowIso = new Date().toISOString();
      const end = new Date(nowIso);
      let minutes = Math.ceil((end - start) / 60000);
      if (!Number.isFinite(minutes) || minutes < 0) {
        minutes = 0;
      }
      const hours = minutes / 60;

      let reason = null;
      if (dailyThreshold && hours >= dailyThreshold) {
        reason = 'daily_max';
      } else if (weeklyThreshold) {
        const total = weeklyTotals.get(Number(punch.employee_id)) || 0;
        if (total + hours > weeklyThreshold) {
          reason = 'weekly_max';
        }
      }

      if (!reason) continue;

      await closePunchWithAutoClockOut({
        punch,
        clockOutIso: nowIso,
        reason
      });
      await refreshIfNeeded();
    }
  } finally {
    await releaseAutoClockOutLock(orgId);
  }
}

async function autoClockOutStaleOpenPunchesAllOrgs(reason = 'catch_up_auto') {
  const orgs = await dbAll('SELECT id, timezone FROM orgs');
  for (const org of orgs || []) {
    await autoClockOutStaleOpenPunchesForOrg({
      orgId: org.id,
      timeZone: org.timezone || APP_TIMEZONE,
      reason
    });
  }
}

async function autoClockOutThresholdPunchesAllOrgs() {
  const orgs = await dbAll('SELECT id, timezone FROM orgs');
  for (const org of orgs || []) {
    await autoClockOutThresholdPunchesForOrg({
      orgId: org.id,
      timeZone: org.timezone || APP_TIMEZONE
    });
  }
}

function getNextMidnightUtc(timeZone) {
  const today = getTodayIsoDate(timeZone);
  const nextDate = shiftIsoDate(today, 1);
  const parts = String(nextDate).split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    return Date.now() + 24 * 60 * 60 * 1000;
  }
  const [year, month, day] = parts;
  return getUtcTimestampForLocal({ year, month, day, hour: 0, minute: 0, second: 0 }, timeZone);
}

async function scheduleOrgMidnightAutoClockOut(orgId, timeZone) {
  if (!orgId) return;
  const tz = timeZone || (await getOrgTimezone(orgId));
  const nextMidnightUtc = getNextMidnightUtc(tz);
  const delayMs = Math.max(1000, nextMidnightUtc - Date.now());

  const existingTimer = autoClockOutTimers.get(orgId);
  if (existingTimer && existingTimer.timerId) {
    clearTimeout(existingTimer.timerId);
  }

  const timerId = setTimeout(async () => {
    await autoClockOutStaleOpenPunchesForOrg({
      orgId,
      timeZone: tz,
      reason: 'midnight_auto'
    });
    const latestTz = await getOrgTimezone(orgId);
    scheduleOrgMidnightAutoClockOut(orgId, latestTz);
  }, delayMs);

  autoClockOutTimers.set(orgId, { timerId, timeZone: tz });
}

async function ensureOrgAutoClockOutSchedules() {
  const orgs = await dbAll('SELECT id, timezone FROM orgs');
  for (const org of orgs || []) {
    const tz = org.timezone || APP_TIMEZONE;
    const existingTimer = autoClockOutTimers.get(org.id);
    if (!existingTimer || existingTimer.timeZone !== tz) {
      scheduleOrgMidnightAutoClockOut(org.id, tz);
    }
  }
}

// Run a catch-up job on startup and hourly in case midnight was missed
function scheduleAutoClockOutCatchUp() {
  const runCatchUp = async () => {
    if (autoClockOutJobRunning) return;
    autoClockOutJobRunning = true;
    try {
      await ensureOrgAutoClockOutSchedules();
      await autoClockOutStaleOpenPunchesAllOrgs('catch_up_auto');
      await autoClockOutThresholdPunchesAllOrgs();
    } finally {
      autoClockOutJobRunning = false;
    }
  };
  runCatchUp();
  setInterval(runCatchUp, 60 * 60 * 1000); // hourly
}

/* ───────── NOTIFICATION SCHEDULER ───────── */

const NOTIFICATION_RETENTION_DAYS = NOTIFICATION_RETENTION_DAYS_ENV || 90;
const PHOTO_RETENTION_DAYS = PHOTO_RETENTION_DAYS_ENV || 30;
const IDEMPOTENCY_RETENTION_DAYS = IDEMPOTENCY_RETENTION_DAYS_ENV || 30;
let notificationsJobRunning = false;

function formatDateInTimeZone(dateObj, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(dateObj);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function parseSqliteDateToUtc(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(raw);
  const iso = hasTz ? raw : `${raw.replace(' ', 'T')}Z`;
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function getTimePartsInTimeZone(timeZone) {
  const now = new Date();
  const dateStr = formatDateInTimeZone(now, timeZone);
  const dateParts = dateStr ? dateStr.split('-').map(Number) : [];
  const year = dateParts[0] || 0;
  const month = dateParts[1] || 0;
  const day = dateParts[2] || 0;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short'
  }).formatToParts(now);
  const hour = Number(parts.find(p => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find(p => p.type === 'minute')?.value || 0);
  const weekdayStr = parts.find(p => p.type === 'weekday')?.value || 'Sun';
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    dateStr,
    year,
    month,
    day,
    hour,
    minute,
    weekday: weekdayMap[weekdayStr] ?? 0
  };
}

function parseTimeToMinutes(timeStr) {
  if (!timeStr) return null;
  const match = String(timeStr).trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

function normalizeOrgSettingValue(key, value) {
  if (value === null || typeof value === 'undefined') return null;
  if (['payroll_rules', 'time_exception_rules', 'notifications', 'branding'].includes(key)) {
    if (typeof value === 'string') {
      try {
        return value ? JSON.parse(value) : null;
      } catch {
        return null;
      }
    }
    return value;
  }
  if (key === 'clock_in_photo_required') {
    return value === '1' || value === 1 || value === true || value === 'true';
  }
  if (key === 'storage_daily_late_fee_default') {
    return value === '' ? null : Number(value);
  }
  if (key === 'storage_container_daily_late_fee_default') {
    return value === '' ? null : Number(value);
  }
  if (key === 'audit_log_retention_days') {
    const num = Number(value);
    return Number.isFinite(num) ? Math.floor(num) : null;
  }
  return value;
}

function ymdToUtcDays(dateStr) {
  if (!dateStr) return null;
  const parts = String(dateStr).split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return Math.floor(Date.UTC(parts[0], parts[1] - 1, parts[2]) / 86400000);
}

function utcDaysToYmd(days) {
  const dt = new Date(days * 86400000);
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function wasNotificationSentRecently({ orgId, userId, type, timeZone, minDays }) {
  const row = await dbGet(
    `
      SELECT created_at
      FROM notifications
      WHERE org_id = ? AND user_id = ? AND type = ?
      ORDER BY id DESC
      LIMIT 1
    `,
    [orgId, userId, type]
  );
  if (!row || !row.created_at) return false;
  const lastDateObj = parseSqliteDateToUtc(row.created_at);
  if (!lastDateObj) return false;
  const lastDate = formatDateInTimeZone(lastDateObj, timeZone);
  const nowDate = formatDateInTimeZone(new Date(), timeZone);
  const lastDays = ymdToUtcDays(lastDate);
  const nowDays = ymdToUtcDays(nowDate);
  if (lastDays == null || nowDays == null) return false;
  return nowDays - lastDays < (minDays || 1);
}

function computePayPeriodForDate(parts, rules) {
  const normalized = normalizePayrollRules(rules || {});
  const length = normalized.pay_period_length_days || 7;
  const startWeekday = normalized.pay_period_start_weekday || 1;
  const anchorStr = normalized.pay_period_anchor_date || null;

  const todayDays = ymdToUtcDays(`${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`);
  if (todayDays == null) return null;

  let startDays = todayDays;
  if (length > 7 && anchorStr) {
    const anchorDays = ymdToUtcDays(anchorStr);
    if (anchorDays != null) {
      const diff = todayDays - anchorDays;
      const periods = Math.floor(diff / length);
      startDays = anchorDays + periods * length;
    }
  } else {
    const diff = (parts.weekday - startWeekday + 7) % 7;
    startDays = todayDays - diff;
  }

  const endDays = startDays + length - 1;
  return { start: utcDaysToYmd(startDays), end: utcDaysToYmd(endDays) };
}

async function countOpenTimeExceptions(orgId, startDate, endDate) {
  const row = await dbGet(
    `
      SELECT COUNT(*) AS cnt
      FROM time_punches
      WHERE org_id = ?
        AND exception_resolved = 0
        AND clock_in_local_date >= ?
        AND clock_in_local_date <= ?
    `,
    [orgId, startDate, endDate]
  );
  return Number(row?.cnt || 0);
}

async function countOpenPunchesForOrg(orgId, todayLocalDate) {
  if (!orgId) return 0;
  const row = await dbGet(
    `
      SELECT COUNT(*) AS cnt
      FROM time_punches
      WHERE org_id = ?
        AND clock_out_ts IS NULL
        AND (
          clock_in_local_date IS NULL
          OR clock_in_local_date <= ?
        )
    `,
    [orgId, todayLocalDate || getTodayIsoDate()]
  );
  return Number(row?.cnt || 0);
}

async function countPayrollDueEntries(orgId, payPeriod) {
  if (!payPeriod) return 0;
  const row = await dbGet(
    `
      SELECT COUNT(*) AS cnt
      FROM time_entries
      WHERE org_id = ?
        AND start_date >= ?
        AND end_date <= ?
        AND (paid IS NULL OR paid = 0)
    `,
    [orgId, payPeriod.start, payPeriod.end]
  );
  return Number(row?.cnt || 0);
}

async function runShipmentRemindersForOrg(orgId, timeZone) {
  const prefsRows = await dbAll(
    `
      SELECT user_id, employee_id, statuses_json, shipment_ids_json,
             project_ids_json, notify_time, remind_every_days, enabled
      FROM shipment_notification_prefs
      WHERE org_id = ? AND enabled = 1 AND notify_time IS NOT NULL AND notify_time != ''
    `,
    [orgId]
  );
  if (!prefsRows || !prefsRows.length) return;

  const recipients = await loadNotificationRecipients(orgId);
  const recipientMap = new Map(recipients.map(r => [r.user_id, r]));
  const prefsMap = await loadNotificationPrefsMap(orgId);

  const nowParts = getTimePartsInTimeZone(timeZone);
  const nowMinutes = nowParts.hour * 60 + nowParts.minute;

  for (const row of prefsRows) {
    const notifyMinutes = parseTimeToMinutes(row.notify_time);
    if (notifyMinutes == null) continue;
    if (nowMinutes < notifyMinutes || nowMinutes >= notifyMinutes + 30) continue;

    const remindEvery = Number(row.remind_every_days) || 1;
    const alreadySent = await wasNotificationSentRecently({
      orgId,
      userId: row.user_id,
      type: 'shipment_reminder',
      timeZone,
      minDays: remindEvery
    });
    if (alreadySent) continue;

    const recipient = recipientMap.get(row.user_id);
    if (!recipient) continue;
    const perms = mapRecipientPerms(recipient);
    if (!hasNotificationPerms(perms, 'shipment')) continue;

    const userPrefs = prefsMap.get(row.user_id) || { ...DEFAULT_NOTIFICATION_PREFS };
    if (!userPrefs.shipment_filters?.enabled) continue;

    const prefParsed = mapNotificationPrefRow(row);
    let statuses = prefParsed.statuses || [];
    let projectIds = prefParsed.project_ids || [];
    const shipmentIds = prefParsed.shipment_ids || [];

    if (userPrefs.shipment_filters?.statuses?.length) {
      statuses = statuses.length
        ? statuses.filter(s => userPrefs.shipment_filters.statuses.includes(s))
        : userPrefs.shipment_filters.statuses.slice();
    }
    if (userPrefs.shipment_filters?.project_ids?.length) {
      projectIds = projectIds.length
        ? projectIds.filter(id => userPrefs.shipment_filters.project_ids.includes(id))
        : userPrefs.shipment_filters.project_ids.slice();
    }

    if (
      userPrefs.shipment_filters?.statuses?.length &&
      statuses.length === 0
    ) {
      continue;
    }

    const params = [orgId];
    let where = 'WHERE org_id = ? AND IFNULL(is_archived, 0) = 0';

    if (statuses.length) {
      where += ` AND status IN (${statuses.map(() => '?').join(',')})`;
      params.push(...statuses);
    }
    if (projectIds.length) {
      where += ` AND project_id IN (${projectIds.map(() => '?').join(',')})`;
      params.push(...projectIds);
    }
    if (shipmentIds.length) {
      where += ` AND id IN (${shipmentIds.map(() => '?').join(',')})`;
      params.push(...shipmentIds);
    }

    const countRow = await dbGet(
      `SELECT COUNT(*) AS cnt FROM shipments ${where}`,
      params
    );
    const count = Number(countRow?.cnt || 0);
    const body = count
      ? `${count} shipments match your reminder filters.`
      : 'No shipments currently match your notification filters.';

    await deliverNotificationToUser({
      orgId,
      userId: row.user_id,
      prefs: userPrefs,
      type: 'shipment_reminder',
      title: 'Shipment reminder',
      body,
      data: {
        count,
        statuses,
        project_ids: projectIds
      }
    });
  }
}

async function runDailySummaryForOrg(orgId, timeZone) {
  const prefsRows = await dbAll(
    `
      SELECT user_id, remind_time, remind_every_days
      FROM notification_prefs
      WHERE org_id = ? AND remind_time IS NOT NULL AND remind_time != ''
    `,
    [orgId]
  );
  if (!prefsRows || !prefsRows.length) return;

  const prefsMap = await loadNotificationPrefsMap(orgId);
  const recipients = await loadNotificationRecipients(orgId);
  const recipientMap = new Map(recipients.map(r => [r.user_id, r]));

  const nowParts = getTimePartsInTimeZone(timeZone);
  const nowMinutes = nowParts.hour * 60 + nowParts.minute;

  for (const row of prefsRows) {
    const prefs = prefsMap.get(row.user_id) || { ...DEFAULT_NOTIFICATION_PREFS };
    const remindMinutes = parseTimeToMinutes(prefs.remind_time);
    if (remindMinutes == null) continue;
    if (nowMinutes < remindMinutes || nowMinutes >= remindMinutes + 30) continue;

    const remindEvery = Number(prefs.remind_every_days) || 1;
    const alreadySent = await wasNotificationSentRecently({
      orgId,
      userId: row.user_id,
      type: 'daily_summary',
      timeZone,
      minDays: remindEvery
    });
    if (alreadySent) continue;

    const recipient = recipientMap.get(row.user_id);
    if (!recipient) continue;
    const perms = mapRecipientPerms(recipient);

    const summaryParts = [];
    let timeCount = null;
    let payrollCount = null;

    const includeTime =
      hasNotificationPerms(perms, 'time') &&
      prefs.time_filters?.enabled &&
      (!prefs.time_filters.event_types?.length ||
        prefs.time_filters.event_types.includes('TIME_EXCEPTION_OPEN'));

    const includePayroll =
      hasNotificationPerms(perms, 'payroll') &&
      prefs.payroll_filters?.enabled &&
      (!prefs.payroll_filters.event_types?.length ||
        prefs.payroll_filters.event_types.includes('PAYROLL_RUN_DUE'));

    if (includeTime) {
      const endDate = nowParts.dateStr;
      const endDays = ymdToUtcDays(endDate);
      const startDate = endDays != null ? utcDaysToYmd(endDays - 6) : endDate;
      timeCount = await countOpenTimeExceptions(orgId, startDate, endDate);
      summaryParts.push(`${timeCount} open time exceptions`);
    }

    if (includePayroll) {
      const rules = await loadPayrollRulesMap(orgId);
      const payPeriod = computePayPeriodForDate(nowParts, rules || {});
      payrollCount = await countPayrollDueEntries(orgId, payPeriod);
      summaryParts.push(`${payrollCount} unpaid entries in current pay period`);
    }

    if (!summaryParts.length) continue;

    const body = `Daily summary: ${summaryParts.join('; ')}.`;

    await deliverNotificationToUser({
      orgId,
      userId: row.user_id,
      prefs,
      type: 'daily_summary',
      title: 'Daily summary',
      body,
      data: {
        time_count: timeCount,
        payroll_count: payrollCount
      }
    });
  }
}

async function runClockoutRemindersForOrg(orgId, timeZone) {
  const prefsRows = await dbAll(
    `
      SELECT user_id, clockout_time, clockout_enabled
      FROM notification_prefs
      WHERE org_id = ? AND clockout_enabled = 1 AND clockout_time IS NOT NULL AND clockout_time != ''
    `,
    [orgId]
  );
  if (!prefsRows || !prefsRows.length) return;

  const prefsMap = await loadNotificationPrefsMap(orgId);
  const nowParts = getTimePartsInTimeZone(timeZone);
  const nowMinutes = nowParts.hour * 60 + nowParts.minute;
  const openCount = await countOpenPunchesForOrg(orgId, nowParts.dateStr);
  if (openCount <= 0) return;

  for (const row of prefsRows) {
    const prefs = prefsMap.get(row.user_id) || { ...DEFAULT_NOTIFICATION_PREFS };
    const targetMinutes = parseTimeToMinutes(prefs.clockout_time);
    if (targetMinutes == null) continue;
    if (nowMinutes < targetMinutes || nowMinutes >= targetMinutes + 30) continue;

    const alreadySent = await wasNotificationSentRecently({
      orgId,
      userId: row.user_id,
      type: 'clockout_reminder',
      timeZone,
      minDays: 1
    });
    if (alreadySent) continue;

    await deliverNotificationToUser({
      orgId,
      userId: row.user_id,
      prefs,
      type: 'clockout_reminder',
      title: 'Clock-out reminder',
      body: `Open punches: ${openCount}. Please review and clock out workers.`,
      data: {
        clockout_time: prefs.clockout_time || null,
        open_punch_count: openCount,
        open_punch_date: nowParts.dateStr || null
      }
    });
  }
}

async function runOpenPunchAlertsForOrg(orgId, timeZone) {
  if (!orgId) return;
  const openPunches = await dbAll(
    `
      SELECT tp.id,
             tp.employee_id,
             tp.clock_in_ts,
             tp.created_at,
             COALESCE(e.name, tp.employee_name_snapshot) AS employee_name
      FROM time_punches tp
      LEFT JOIN employees e ON e.id = tp.employee_id AND e.org_id = tp.org_id
      WHERE tp.org_id = ?
        AND tp.clock_out_ts IS NULL
    `,
    [orgId]
  );
  if (!openPunches || !openPunches.length) return;

  const now = new Date();
  for (const punch of openPunches) {
    const startIso = punch.clock_in_ts || punch.created_at;
    if (!startIso) continue;
    const start = new Date(startIso);
    if (Number.isNaN(start.getTime())) continue;
    const hours = (now - start) / (1000 * 60 * 60);
    if (!Number.isFinite(hours) || hours < 0) continue;

    let eventType = null;
    let label = null;
    if (hours >= MULTI_DAY_SHIFT_THRESHOLD_HOURS) {
      eventType = 'TIME_PUNCH_OPEN_MULTI_DAY';
      label = 'Open punch: multi-day shift';
    } else if (hours >= LONG_SHIFT_THRESHOLD_HOURS) {
      eventType = 'TIME_PUNCH_OPEN_LONG';
      label = 'Open punch: long shift';
    }
    if (!eventType) continue;

    const employeeName = punch.employee_name || 'employee';
    await notifyTimeEventOnce({
      orgId,
      eventType,
      title: label,
      body: `${employeeName} has been clocked in for ${hours.toFixed(2)}h.`,
      data: {
        punch_id: punch.id,
        employee_id: punch.employee_id,
        hours
      },
      match: {
        punch_id: punch.id
      }
    });
  }
}

async function purgeOldNotifications() {
  try {
    const notificationsExists = await tableExists('notifications');
    if (!notificationsExists) return;
    await dbRun(
      `DELETE FROM notifications WHERE created_at < datetime('now', ?)`,
      [`-${NOTIFICATION_RETENTION_DAYS} days`]
    );
    const deliveriesExists = await tableExists('notification_deliveries');
    if (!deliveriesExists) return;
    await dbRun(
      `DELETE FROM notification_deliveries WHERE created_at < datetime('now', ?)`,
      [`-${NOTIFICATION_RETENTION_DAYS} days`]
    );
  } catch (err) {
    console.warn('Notification purge failed:', err.message || err);
  }
}

async function purgeOldClockInPhotos() {
  try {
    const rows = await dbAll(
      `
        SELECT id, org_id, clock_in_photo_path
        FROM time_punches
        WHERE clock_in_photo_path IS NOT NULL
          AND clock_in_ts < datetime('now', ?)
      `,
      [`-${PHOTO_RETENTION_DAYS} days`]
    );
    if (!rows || !rows.length) return;

    const uploadsBase = path.join(__dirname, 'secure_uploads');

    for (const row of rows) {
      const relPath = row.clock_in_photo_path;
      if (relPath) {
        const fullPath = path.join(uploadsBase, relPath);
        try {
          await fsp.unlink(fullPath);
        } catch (err) {
          if (err.code !== 'ENOENT') {
            console.warn('Clock-in photo purge failed:', err.message || err);
          }
        }
      }

      await dbRun(
        `
          UPDATE time_punches
          SET clock_in_photo_path = NULL,
              updated_at = datetime('now')
          WHERE id = ? AND org_id = ?
        `,
        [row.id, row.org_id]
      );
    }
  } catch (err) {
    console.warn('Clock-in photo purge failed:', err.message || err);
  }
}

async function purgeOldAuditLogs() {
  try {
    const rows = await dbAll(
      `SELECT org_id, value
       FROM org_settings
       WHERE key = 'audit_log_retention_days'`
    );
    if (!rows || !rows.length) return;

    const tables = [
      'audit_log',
      'time_exception_actions',
      'payroll_audit_log'
    ];
    const existingTables = [];
    for (const table of tables) {
      const exists = await tableExists(table);
      if (exists) existingTables.push(table);
    }
    if (!existingTables.length) return;

    for (const row of rows) {
      const orgId = row.org_id;
      const days = Number(row.value);
      if (!orgId || !Number.isFinite(days) || days <= 0) continue;
      const cutoff = `-${Math.floor(days)} days`;
      for (const table of existingTables) {
        await dbRun(
          `DELETE FROM ${table} WHERE org_id = ? AND created_at < datetime('now', ?)`,
          [orgId, cutoff]
        );
      }
    }
  } catch (err) {
    console.warn('Audit log purge failed:', err.message || err);
  }
}

async function purgeOldIdempotencyKeys() {
  try {
    await dbRun(
      `DELETE FROM idempotency_keys WHERE created_at < datetime('now', ?)`,
      [`-${IDEMPOTENCY_RETENTION_DAYS} days`]
    );
  } catch (err) {
    console.warn('Idempotency key purge failed:', err.message || err);
  }
}

async function runNotificationSchedules() {
  if (notificationsJobRunning) return;
  notificationsJobRunning = true;
  const lockKey = 'notification_schedule';
  const lockTtlMs = 10 * 60 * 1000;
  const gotLock = await acquireJobLock(lockKey, lockTtlMs);
  if (!gotLock) {
    notificationsJobRunning = false;
    return;
  }
  try {
    const orgs = await dbAll(
      `SELECT id, timezone FROM orgs WHERE IFNULL(status, 'active') = 'active'`
    );
    for (const org of orgs || []) {
      const tz = org.timezone || APP_TIMEZONE;
      try {
        await runShipmentRemindersForOrg(org.id, tz);
        await runDailySummaryForOrg(org.id, tz);
        await runClockoutRemindersForOrg(org.id, tz);
        await runOpenPunchAlertsForOrg(org.id, tz);
      } catch (err) {
        console.warn(
          `Notification scheduler error for org ${org.id}:`,
          err?.message || err
        );
      } finally {
        await refreshJobLock(lockKey, lockTtlMs);
      }
    }
  } catch (err) {
    console.warn('Notification scheduler error:', err.message || err);
  } finally {
    notificationsJobRunning = false;
    await releaseJobLock(lockKey);
  }
}

function scheduleNotificationJobs() {
  runNotificationSchedules();
  setInterval(runNotificationSchedules, 5 * 60 * 1000);
}


/* ───────── 10. SERVER START & BACKUPS ───────── */

async function startServer() {
  if (db.ready) {
    await db.ready;
  }
  try {
    await ensureNameOnChecksColumns();
  } catch (err) {
    console.error('Error ensuring name_on_checks columns:', err);
  }

  app.listen(SERVER_PORT, () => {
    console.log(`Server running on http://localhost:${SERVER_PORT}`);

    tableExists('time_punches')
      .then(exists => {
        if (exists) {
          // Start per-org midnight scheduling and periodic catch-up
          ensureOrgAutoClockOutSchedules();
          scheduleAutoClockOutCatchUp();

          purgeOldClockInPhotos();
          setInterval(purgeOldClockInPhotos, 24 * 60 * 60 * 1000);
        } else {
          console.log('Skipping auto clock-out jobs (time_punches table missing).');
        }
      })
      .catch(err => {
        console.warn('Auto clock-out check failed:', err.message);
      });

    tableExists('payroll_preflights')
      .then(exists => {
        if (exists) {
          purgeExpiredPayrollPreflights();
          setInterval(purgeExpiredPayrollPreflights, 60 * 60 * 1000);
        } else {
          console.log('Skipping payroll preflight purge (table missing).');
        }
      })
      .catch(err => {
        console.warn('Payroll preflight check failed:', err.message);
      });

    tableExists('qbo_oauth_states')
      .then(exists => {
        if (exists) {
          purgeExpiredQboOAuthStates();
          setInterval(purgeExpiredQboOAuthStates, 60 * 60 * 1000);
        } else {
          console.log('Skipping QBO OAuth state purge (table missing).');
        }
      })
      .catch(err => {
        console.warn('QBO OAuth state check failed:', err.message);
      });

    tableExists('notification_prefs')
      .then(exists => {
        if (exists) {
          scheduleNotificationJobs();
        } else {
          console.log('Skipping notification scheduler (notification_prefs table missing).');
        }
      })
      .catch(err => {
        console.warn('Notification scheduler check failed:', err.message);
      });

    tableExists('notifications')
      .then(exists => {
        if (exists) {
          purgeOldNotifications();
          // Run daily to avoid setInterval overflow on large delays.
          setInterval(purgeOldNotifications, 24 * 60 * 60 * 1000);
        } else {
          console.log('Skipping notification purge (notifications table missing).');
        }
      })
      .catch(err => {
        console.warn('Notification purge check failed:', err.message);
      });

    tableExists('idempotency_keys')
      .then(exists => {
        if (exists) {
          purgeOldIdempotencyKeys();
          setInterval(purgeOldIdempotencyKeys, 7 * 24 * 60 * 60 * 1000);
        } else {
          console.log('Skipping idempotency key purge (table missing).');
        }
      })
      .catch(err => {
        console.warn('Idempotency purge check failed:', err.message);
      });

    purgeOldAuditLogs();
    // Run daily to avoid timer overflow on long intervals.
    setInterval(purgeOldAuditLogs, 24 * 60 * 60 * 1000);
  });

  if (ENABLE_IN_PROCESS_BACKUPS) {
    // Run a backup at startup
    runBackupWithLock();

    // Schedule daily backups every 24 hours
    setInterval(runBackupWithLock, 24 * 60 * 60 * 1000);
  } else {
    console.log(
      'Skipping in-process backups (ENABLE_IN_PROCESS_BACKUPS is false). Use scripts/backup-once.js or an external scheduler.'
    );
  }
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
