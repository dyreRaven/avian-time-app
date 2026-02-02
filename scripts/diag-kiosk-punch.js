#!/usr/bin/env node
/* eslint-disable no-console */

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { DB_PATH, APP_TIMEZONE } = require('../lib/config');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith('--')) continue;
    const eqIdx = raw.indexOf('=');
    if (eqIdx !== -1) {
      const key = raw.slice(2, eqIdx);
      const value = raw.slice(eqIdx + 1);
      out[key] = value === '' ? true : value;
      continue;
    }
    const key = raw.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
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
    // fallback below
  }
  return dateObj.toISOString().slice(0, 10);
}

function parseBoolean(val) {
  if (val === true) return true;
  if (val == null) return false;
  const str = String(val).trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(str);
}

function toNumber(val) {
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

function formatRow(row) {
  if (!row) return null;
  return { ...row };
}

function openDb() {
  const resolved = path.resolve(DB_PATH);
  return new sqlite3.Database(resolved, sqlite3.OPEN_READONLY);
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

async function listKiosks(db) {
  const rows = await dbAll(
    db,
    'SELECT id, name, device_id, project_id, org_id FROM kiosks ORDER BY id'
  );
  console.table(rows);
}

async function listEmployees(db, orgId = null) {
  const params = [];
  let sql = `
    SELECT id, name, active, worker_timekeeping, kiosk_admin_access, org_id
    FROM employees
  `;
  if (orgId) {
    sql += ' WHERE org_id = ?';
    params.push(orgId);
  }
  sql += ' ORDER BY id';
  const rows = await dbAll(db, sql, params);
  console.table(rows);
}

async function listSessions(db, orgId, deviceId, dateOverride) {
  let date = dateOverride;
  if (!date && orgId) {
    const orgRow = await dbGet(db, 'SELECT timezone FROM orgs WHERE id = ?', [orgId]);
    date = getIsoDateInTimezone(new Date(), orgRow?.timezone || APP_TIMEZONE);
  }
  const params = [];
  let sql = `
    SELECT id, kiosk_id, device_id, project_id, date, created_at, ended_at
    FROM kiosk_sessions
  `;
  const where = [];
  if (date) {
    where.push('date = ?');
    params.push(date);
  }
  if (deviceId) {
    where.push('device_id = ?');
    params.push(deviceId);
  }
  if (orgId) {
    where.push('org_id = ?');
    params.push(orgId);
  }
  if (where.length) {
    sql += ` WHERE ${where.join(' AND ')}`;
  }
  sql += ' ORDER BY id DESC';
  const rows = await dbAll(db, sql, params);
  console.table(rows);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const help =
    args.help ||
    args.h ||
    args['list-kiosks'] ||
    args['list-employees'] ||
    args['list-sessions'];

  const db = openDb();

  try {
    if (args['list-kiosks']) {
      await listKiosks(db);
      return;
    }

    if (args['list-employees']) {
      const orgId = toNumber(args['org-id']);
      await listEmployees(db, orgId);
      return;
    }

    if (args['list-sessions']) {
      const orgId = toNumber(args['org-id']);
      const deviceId = args['device-id'] ? String(args['device-id']).trim() : null;
      const dateOverride = args.date ? String(args.date).trim() : null;
      await listSessions(db, orgId, deviceId, dateOverride);
      return;
    }

    const deviceId = args['device-id'] ? String(args['device-id']).trim() : '';
    const employeeIdRaw = args['employee-id'];
    const projectIdRaw = args['project-id'];
    const clientId = args['client-id'] ? String(args['client-id']).trim() : null;
    const intendedModeRaw = args['intended-mode'] ? String(args['intended-mode']).trim().toLowerCase() : '';
    const deviceSecret = args['device-secret'] ? String(args['device-secret']).trim() : '';
    const deviceTimestampRaw = args['device-timestamp'] ? String(args['device-timestamp']).trim() : '';
    const queuedAtRaw = args['queued-at'] ? String(args['queued-at']).trim() : '';
    const lat = toNumber(args.lat);
    const lng = toNumber(args.lng);
    const photoProvided =
      parseBoolean(args.photo) ||
      parseBoolean(args['photo-base64']) ||
      parseBoolean(args['has-photo']);

    if (help || !deviceId || !employeeIdRaw || !projectIdRaw) {
      console.log('Usage:');
      console.log('  node scripts/diag-kiosk-punch.js --device-id <id> --employee-id <id> --project-id <id> [options]');
      console.log('');
      console.log('Options:');
      console.log('  --device-secret <secret>     Device secret if using kiosk auth.');
      console.log('  --client-id <id>             Client id for idempotency checks.');
      console.log('  --intended-mode <clock_in|clock_out>');
      console.log('  --device-timestamp <iso>     Device timestamp (only used when --queued-at is set).');
      console.log('  --queued-at <iso>            Marks this as an offline queued punch.');
      console.log('  --lat <num> --lng <num>       Optional GPS for geofence info.');
      console.log('  --photo                       Indicates a clock-in photo is present.');
      console.log('  --list-kiosks                 List kiosks with device ids.');
      console.log('  --list-employees [--org-id]   List employees (optionally filtered by org).');
      console.log('  --list-sessions [--org-id] [--device-id] [--date YYYY-MM-DD]');
      process.exit(help ? 0 : 1);
    }

    const employeeId = toNumber(employeeIdRaw);
    const projectId = toNumber(projectIdRaw);

    const blockers = [];
    const warnings = [];
    const info = [];

    const kioskRow = await dbGet(
      db,
      'SELECT id, org_id, device_secret, project_id FROM kiosks WHERE device_id = ? LIMIT 1',
      [deviceId]
    );
    if (!kioskRow) {
      blockers.push('Device not enrolled (kiosks.device_id not found).');
    }

    let orgRow = null;
    if (kioskRow?.org_id) {
      orgRow = await dbGet(
        db,
        'SELECT id, status, timezone FROM orgs WHERE id = ? LIMIT 1',
        [kioskRow.org_id]
      );
      if (orgRow && orgRow.status && orgRow.status !== 'active') {
        blockers.push('Org status is not active.');
      }
    }

    if (deviceSecret) {
      if (!kioskRow?.device_secret || kioskRow.device_secret !== deviceSecret) {
        blockers.push('device_secret mismatch for this device.');
      }
    } else {
      warnings.push('No device_secret provided; kiosk auth would fail unless a kiosk-admin session is used.');
    }

    if (!clientId) {
      warnings.push('No client_id provided; idempotency duplicate checks skipped.');
    }

    if (!employeeId) {
      blockers.push('employee_id must be a valid number.');
    }

    if (!projectId) {
      blockers.push('project_id must be a valid number.');
    }

    const nowIso = new Date().toISOString();
    let punchTime = deviceTimestampRaw || nowIso;
    let queuedAt = null;
    if (queuedAtRaw) {
      const qd = new Date(queuedAtRaw);
      if (!Number.isNaN(qd.getTime())) queuedAt = qd;
    }
    if (!queuedAt) {
      if (deviceTimestampRaw) {
        warnings.push('device_timestamp is ignored for online punches; server uses current time.');
      }
      punchTime = nowIso;
    }
    let punchDate = new Date(punchTime);
    if (Number.isNaN(punchDate.getTime())) {
      warnings.push('device_timestamp is invalid; server would fall back to current time.');
      punchTime = nowIso;
      punchDate = new Date(punchTime);
    }

    const futureSkewMs = 5 * 60 * 1000;
    if (punchDate.getTime() - new Date().getTime() > futureSkewMs) {
      blockers.push('device_timestamp is too far in the future (>5 minutes).');
    }

    if (kioskRow && !queuedAt) {
      const activeProjectId =
        kioskRow.project_id && Number(kioskRow.project_id) > 0
          ? Number(kioskRow.project_id)
          : null;
      if (!activeProjectId) {
        blockers.push('Project not set for this device (kiosks.project_id is null).');
      } else if (projectId && Number(projectId) !== Number(activeProjectId)) {
        blockers.push(`Active project mismatch (device uses project_id ${activeProjectId}).`);
      }
    }

    const orgId = kioskRow?.org_id || null;
    const orgTimezone = orgRow?.timezone || APP_TIMEZONE;
    const sessionDate = getIsoDateInTimezone(punchTime, orgTimezone);

    const existing = clientId && orgId
      ? await dbGet(
          db,
          'SELECT id, clock_out_ts, geo_violation, geo_distance_m FROM time_punches WHERE org_id = ? AND client_id = ? LIMIT 1',
          [orgId, clientId]
        )
      : null;
    if (existing) {
      info.push(`Existing punch found for client_id (${existing.clock_out_ts ? 'clock_out' : 'clock_in'}).`);
    }

    const openPunch = orgId && employeeId
      ? await dbGet(
          db,
          `
            SELECT id, clock_in_ts, project_id, time_entry_id, geo_violation, geo_distance_m
            FROM time_punches
            WHERE org_id = ? AND employee_id = ? AND clock_out_ts IS NULL
            ORDER BY clock_in_ts DESC
            LIMIT 1
          `,
          [orgId, employeeId]
        )
      : null;

    if (openPunch) {
      info.push(`Open punch exists (id ${openPunch.id}).`);
      if (intendedModeRaw === 'clock_in') {
        const openTs = openPunch.clock_in_ts ? new Date(openPunch.clock_in_ts) : null;
        const requested = new Date(punchTime);
        if (
          openTs &&
          !Number.isNaN(openTs.getTime()) &&
          !Number.isNaN(requested.getTime()) &&
          Math.abs(requested.getTime() - openTs.getTime()) <= 15000
        ) {
          warnings.push('Open punch is within 15s; server would return alreadyProcessed=clock_in.');
        } else {
          blockers.push('Already clocked in; intended_mode=clock_in would be rejected.');
        }
      }
    } else if (intendedModeRaw === 'clock_out') {
      const recentClosed = orgId && employeeId
        ? await dbGet(
            db,
            `
              SELECT id, clock_out_ts
              FROM time_punches
              WHERE org_id = ? AND employee_id = ? AND device_id = ?
                AND clock_out_ts IS NOT NULL
              ORDER BY clock_out_ts DESC
              LIMIT 1
            `,
            [orgId, employeeId, deviceId]
          )
        : null;
      if (recentClosed?.clock_out_ts) {
        const recentOut = new Date(recentClosed.clock_out_ts);
        const requested = new Date(punchTime);
        if (
          !Number.isNaN(recentOut.getTime()) &&
          !Number.isNaN(requested.getTime()) &&
          Math.abs(requested.getTime() - recentOut.getTime()) <= 15000
        ) {
          warnings.push('Recent clock-out within 15s; server would return alreadyProcessed=clock_out.');
        } else {
          blockers.push('No open punch; intended_mode=clock_out would be rejected.');
        }
      } else {
        blockers.push('No open punch; intended_mode=clock_out would be rejected.');
      }
    }

    if (!openPunch && orgId && kioskRow && projectId) {
      const sessionRow = await dbGet(
        db,
        `
          SELECT id, created_at, ended_at
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
        [orgId, kioskRow.id, sessionDate, projectId, punchTime, punchTime]
      );
      if (!sessionRow) {
        blockers.push('No active timesheet (kiosk_session) for this project/device at punch time.');
      } else {
        info.push(`Active kiosk session found (id ${sessionRow.id}).`);
      }
    }

    const employeeRow = orgId && employeeId
      ? await dbGet(
          db,
          `
            SELECT id, active, worker_timekeeping, kiosk_admin_access
            FROM employees
            WHERE id = ? AND org_id = ?
            LIMIT 1
          `,
          [employeeId, orgId]
        )
      : null;
    if (!employeeRow && orgId && employeeId) {
      blockers.push('Employee not found for this org.');
    }

    if (!openPunch && employeeRow) {
      const canTimekeep =
        (employeeRow.worker_timekeeping || 0) === 1 ||
        (employeeRow.kiosk_admin_access || 0) === 1;
      if (!employeeRow.active || !canTimekeep) {
        blockers.push('Employee is not authorized to clock in (inactive or no worker_timekeeping).');
      }
    }

    if (!openPunch && orgId) {
      const photoRow = await dbGet(
        db,
        'SELECT value FROM org_settings WHERE org_id = ? AND key = ?',
        [orgId, 'clock_in_photo_required']
      );
      const photoRequired = photoRow && String(photoRow.value || '').trim() === '1';
      if (photoRequired && !photoProvided) {
        blockers.push('Clock-in photo is required but not provided.');
      } else if (photoRequired) {
        info.push('Clock-in photo is required and marked as present.');
      }
    }

    if (lat != null && lng != null) {
      info.push(`GPS provided (lat ${lat}, lng ${lng}).`);
    }

    console.log('--- Punch Diagnostic ---');
    console.log({
      db_path: path.resolve(DB_PATH),
      device_id: deviceId,
      employee_id: employeeId,
      project_id: projectId,
      client_id: clientId || null,
      intended_mode: intendedModeRaw || null,
      queued_at: queuedAtRaw || null,
      device_timestamp: deviceTimestampRaw || null,
      effective_punch_time: punchTime,
      org_id: orgId,
      org_timezone: orgTimezone,
      session_date: sessionDate
    });

    if (blockers.length) {
      console.log('');
      console.log('Blockers:');
      blockers.forEach((msg, idx) => {
        console.log(`  ${idx + 1}. ${msg}`);
      });
    } else {
      console.log('');
      console.log('No blocking conditions detected based on current DB state.');
    }

    if (warnings.length) {
      console.log('');
      console.log('Warnings:');
      warnings.forEach((msg, idx) => {
        console.log(`  ${idx + 1}. ${msg}`);
      });
    }

    if (info.length) {
      console.log('');
      console.log('Info:');
      info.forEach((msg, idx) => {
        console.log(`  ${idx + 1}. ${msg}`);
      });
    }
  } finally {
    db.close();
  }
}

main().catch(err => {
  console.error('Diagnostic failed:', err);
  process.exit(1);
});
