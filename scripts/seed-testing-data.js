#!/usr/bin/env node
// Populate rich local test fixtures across core app domains.

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const { DB_PATH } = require('../lib/config');

function printUsage() {
  console.log('Usage: node scripts/seed-testing-data.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --org-id <id>            Seed a specific org id (defaults to first org).');
  console.log('  --seed-tag <text>        Prefix for seeded names (default: Seed).');
  console.log('  --org-name <text>        Org name if a new org must be created.');
  console.log('  --org-timezone <tz>      Org timezone if a new org must be created.');
  console.log('  --admin-email <email>    Seed super-admin login email.');
  console.log('  --admin-password <pass>  Seed super-admin login password.');
  console.log('  --ops-email <email>      Secondary admin login email.');
  console.log('  --ops-password <pass>    Secondary admin login password.');
  console.log('  --allow-production       Allow running when NODE_ENV=production.');
  console.log('  --help, -h               Show this help.');
  console.log('');
  console.log('Example:');
  console.log('  node scripts/seed-testing-data.js --seed-tag Demo');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq !== -1) {
      const key = raw.slice(2, eq);
      const value = raw.slice(eq + 1);
      out[key] = value;
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

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'seed';
}

function splitName(fullName) {
  const trimmed = String(fullName || '').trim();
  if (!trimmed) return { given: null, family: null };
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (!parts.length) return { given: null, family: null };
  if (parts.length === 1) return { given: parts[0], family: null };
  return { given: parts[0], family: parts.slice(1).join(' ') };
}

function uniqueClientId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toYmd(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return fmt.format(date);
}

function toIsoAt(dateYmd, hhmmss = '00:00:00') {
  const safeDate = String(dateYmd || '').trim();
  const safeTime = String(hhmmss || '00:00:00').trim();
  return `${safeDate}T${safeTime}Z`;
}

function openDb(dbPath) {
  const resolved = path.resolve(dbPath || DB_PATH);
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(resolved, err => {
      if (err) {
        reject(err);
        return;
      }
      resolve({ db, resolved });
    });
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve({ changes: this.changes || 0, lastID: this.lastID || null });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row || null);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows || []);
    });
  });
}

async function ensureOrgSetting(db, orgId, key, value) {
  await run(
    db,
    `
      INSERT INTO org_settings (org_id, key, value)
      VALUES (?, ?, ?)
      ON CONFLICT(org_id, key) DO UPDATE SET value = excluded.value
    `,
    [orgId, key, value]
  );
}

async function ensurePermissionRow(db, employeeId, perms) {
  await run(
    db,
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
      perms.see_shipments ? 1 : 0,
      perms.modify_time ? 1 : 0,
      perms.approve_time ? 1 : 0,
      perms.view_time_reports ? 1 : 0,
      perms.view_all_timesheets ? 1 : 0,
      perms.assign_timesheets ? 1 : 0,
      perms.view_payroll ? 1 : 0,
      perms.modify_payroll ? 1 : 0,
      perms.modify_pay_rates ? 1 : 0
    ]
  );
}

async function ensureUser(db, { email, password }) {
  const normEmail = String(email || '').trim().toLowerCase();
  if (!normEmail) {
    throw new Error('User email is required.');
  }
  const hash = await bcrypt.hash(String(password || ''), 10);
  const existing = await get(db, 'SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [normEmail]);
  if (existing) {
    await run(
      db,
      `
        UPDATE users
        SET password_hash = ?,
            password_reset_token_hash = NULL,
            password_reset_token_expires_at = NULL,
            password_reset_token_used_at = NULL,
            password_reset_token_created_at = NULL,
            password_reset_token_created_by = NULL,
            password_reset_org_id = NULL
        WHERE id = ?
      `,
      [hash, existing.id]
    );
    return existing.id;
  }
  const insert = await run(
    db,
    'INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, datetime(\'now\'))',
    [normEmail, hash]
  );
  return insert.lastID;
}

async function ensureEmployee(db, orgId, spec) {
  let existing = null;
  const normEmail = String(spec.email || '').trim().toLowerCase();
  if (!existing) {
    existing = await get(
      db,
      `
        SELECT id
        FROM employees
        WHERE org_id = ? AND name = ? COLLATE NOCASE
        LIMIT 1
      `,
      [orgId, spec.name]
    );
  }
  if (!existing && Array.isArray(spec.match_names) && spec.match_names.length) {
    for (const altNameRaw of spec.match_names) {
      const altName = String(altNameRaw || '').trim();
      if (!altName) continue;
      existing = await get(
        db,
        `
          SELECT id
          FROM employees
          WHERE org_id = ? AND name = ? COLLATE NOCASE
          LIMIT 1
        `,
        [orgId, altName]
      );
      if (existing) break;
    }
  }
  if (!existing && normEmail) {
    existing = await get(
      db,
      `
        SELECT id
        FROM employees
        WHERE org_id = ? AND email = ? COLLATE NOCASE
        LIMIT 1
      `,
      [orgId, normEmail]
    );
  }

  const nameParts = splitName(spec.name);
  const payload = [
    spec.name,
    spec.given_name || nameParts.given,
    spec.family_name || nameParts.family,
    spec.nickname || null,
    spec.name_on_checks || null,
    spec.rate != null ? Number(spec.rate) : null,
    spec.active ? 1 : 0,
    spec.language || 'en',
    spec.role_title || null,
    spec.employee_qbo_id || null,
    spec.vendor_qbo_id || null,
    spec.needs_qbo_sync ? 1 : 0,
    spec.worker_timekeeping ? 1 : 0,
    spec.desktop_access ? 1 : 0,
    spec.kiosk_admin_access ? 1 : 0,
    spec.email || null,
    spec.phone || null,
    spec.start_date || null,
    spec.termination_date || null
  ];

  if (existing) {
    await run(
      db,
      `
        UPDATE employees
        SET name = ?,
            given_name = ?,
            family_name = ?,
            nickname = ?,
            name_on_checks = ?,
            rate = ?,
            active = ?,
            language = ?,
            role_title = ?,
            employee_qbo_id = ?,
            vendor_qbo_id = ?,
            needs_qbo_sync = ?,
            worker_timekeeping = ?,
            desktop_access = ?,
            kiosk_admin_access = ?,
            email = ?,
            phone = ?,
            start_date = ?,
            termination_date = ?
        WHERE id = ? AND org_id = ?
      `,
      [...payload, existing.id, orgId]
    );
    return existing.id;
  }

  const insert = await run(
    db,
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
        language,
        role_title,
        employee_qbo_id,
        vendor_qbo_id,
        needs_qbo_sync,
        worker_timekeeping,
        desktop_access,
        kiosk_admin_access,
        email,
        phone,
        start_date,
        termination_date,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `,
    [orgId, ...payload]
  );
  return insert.lastID;
}

async function ensureMembership(db, { userId, orgId, employeeId, isSuperAdmin, loginEnabled }) {
  const existing = await get(
    db,
    'SELECT id FROM user_orgs WHERE user_id = ? AND org_id = ? LIMIT 1',
    [userId, orgId]
  );
  if (existing) {
    await run(
      db,
      `
        UPDATE user_orgs
        SET employee_id = ?,
            is_super_admin = ?,
            login_enabled = ?
        WHERE id = ?
      `,
      [employeeId || null, isSuperAdmin ? 1 : 0, loginEnabled ? 1 : 0, existing.id]
    );
    return existing.id;
  }
  const insert = await run(
    db,
    `
      INSERT INTO user_orgs (
        user_id,
        org_id,
        employee_id,
        is_super_admin,
        login_enabled,
        created_at
      ) VALUES (?, ?, ?, ?, ?, datetime('now'))
    `,
    [userId, orgId, employeeId || null, isSuperAdmin ? 1 : 0, loginEnabled ? 1 : 0]
  );
  return insert.lastID;
}

async function ensureProject(db, orgId, spec) {
  let existing = await get(
    db,
    'SELECT id FROM projects WHERE org_id = ? AND name = ? COLLATE NOCASE LIMIT 1',
    [orgId, spec.name]
  );
  if (!existing && Array.isArray(spec.match_names) && spec.match_names.length) {
    for (const altNameRaw of spec.match_names) {
      const altName = String(altNameRaw || '').trim();
      if (!altName || altName === spec.name) continue;
      existing = await get(
        db,
        'SELECT id FROM projects WHERE org_id = ? AND name = ? COLLATE NOCASE LIMIT 1',
        [orgId, altName]
      );
      if (existing) break;
    }
  }
  if (existing) {
    await run(
      db,
      `
        UPDATE projects
        SET name = ?,
            customer_name = ?,
            project_timezone = ?,
            geo_lat = ?,
            geo_lng = ?,
            geo_radius = ?,
            active = ?
        WHERE id = ? AND org_id = ?
      `,
      [
        spec.name,
        spec.customer_name || null,
        spec.project_timezone || null,
        spec.geo_lat != null ? Number(spec.geo_lat) : null,
        spec.geo_lng != null ? Number(spec.geo_lng) : null,
        spec.geo_radius != null ? Number(spec.geo_radius) : null,
        spec.active ? 1 : 0,
        existing.id,
        orgId
      ]
    );
    return existing.id;
  }
  const insert = await run(
    db,
    `
      INSERT INTO projects (
        org_id,
        qbo_id,
        name,
        customer_name,
        project_timezone,
        geo_lat,
        geo_lng,
        geo_radius,
        active
      ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      orgId,
      spec.name,
      spec.customer_name || null,
      spec.project_timezone || null,
      spec.geo_lat != null ? Number(spec.geo_lat) : null,
      spec.geo_lng != null ? Number(spec.geo_lng) : null,
      spec.geo_radius != null ? Number(spec.geo_radius) : null,
      spec.active ? 1 : 0
    ]
  );
  return insert.lastID;
}

async function ensureVendor(db, orgId, spec) {
  const existing = await get(
    db,
    'SELECT id FROM vendors WHERE org_id = ? AND name = ? LIMIT 1',
    [orgId, spec.name]
  );
  if (existing) {
    await run(
      db,
      `
        UPDATE vendors
        SET active = ?,
            is_freight_forwarder = ?,
            uses_timekeeping = ?
        WHERE id = ? AND org_id = ?
      `,
      [
        spec.active ? 1 : 0,
        spec.is_freight_forwarder ? 1 : 0,
        spec.uses_timekeeping ? 1 : 0,
        existing.id,
        orgId
      ]
    );
    return existing.id;
  }
  const insert = await run(
    db,
    `
      INSERT INTO vendors (
        org_id,
        qbo_id,
        name,
        active,
        is_freight_forwarder,
        uses_timekeeping
      ) VALUES (?, NULL, ?, ?, ?, ?)
    `,
    [
      orgId,
      spec.name,
      spec.active ? 1 : 0,
      spec.is_freight_forwarder ? 1 : 0,
      spec.uses_timekeeping ? 1 : 0
    ]
  );
  return insert.lastID;
}

async function ensureKiosk(db, orgId, spec) {
  const existing = await get(
    db,
    'SELECT id FROM kiosks WHERE device_id = ? LIMIT 1',
    [spec.device_id]
  );
  if (existing) {
    await run(
      db,
      `
        UPDATE kiosks
        SET org_id = ?,
            name = ?,
            location = ?,
            device_secret = ?,
            project_id = ?,
            last_seen_at = datetime('now')
        WHERE id = ?
      `,
      [
        orgId,
        spec.name,
        spec.location || null,
        spec.device_secret,
        spec.project_id || null,
        existing.id
      ]
    );
    return existing.id;
  }
  const insert = await run(
    db,
    `
      INSERT INTO kiosks (
        org_id,
        name,
        location,
        device_id,
        device_secret,
        project_id,
        last_seen_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `,
    [
      orgId,
      spec.name,
      spec.location || null,
      spec.device_id,
      spec.device_secret,
      spec.project_id || null
    ]
  );
  return insert.lastID;
}

async function ensureKioskSession(db, orgId, spec) {
  const existing = await get(
    db,
    `
      SELECT id
      FROM kiosk_sessions
      WHERE org_id = ?
        AND kiosk_id = ?
        AND project_id = ?
        AND date = ?
        AND IFNULL(ended_at, '') = IFNULL(?, '')
      LIMIT 1
    `,
    [orgId, spec.kiosk_id, spec.project_id, spec.date, spec.ended_at || null]
  );
  if (existing) return existing.id;

  const insert = await run(
    db,
    `
      INSERT INTO kiosk_sessions (
        org_id,
        kiosk_id,
        device_id,
        project_id,
        date,
        created_by_employee_id,
        assigned_to_employee_id,
        geo_lat,
        geo_lng,
        geo_distance_m,
        geo_violation,
        created_at,
        ended_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      orgId,
      spec.kiosk_id,
      spec.device_id || null,
      spec.project_id,
      spec.date,
      spec.created_by_employee_id || null,
      spec.assigned_to_employee_id || null,
      spec.geo_lat != null ? spec.geo_lat : null,
      spec.geo_lng != null ? spec.geo_lng : null,
      spec.geo_distance_m != null ? spec.geo_distance_m : null,
      spec.geo_violation ? 1 : 0,
      spec.created_at || toIsoAt(spec.date, '08:00:00'),
      spec.ended_at || null
    ]
  );
  return insert.lastID;
}

async function ensureTimeEntry(db, orgId, spec) {
  const existing = await get(
    db,
    `
      SELECT id
      FROM time_entries
      WHERE org_id = ?
        AND employee_id = ?
        AND project_id = ?
        AND start_date = ?
        AND start_time = ?
        AND end_time = ?
      LIMIT 1
    `,
    [
      orgId,
      spec.employee_id,
      spec.project_id,
      spec.start_date,
      spec.start_time,
      spec.end_time
    ]
  );

  const payload = [
    spec.employee_id,
    spec.project_id,
    spec.start_date,
    spec.end_date,
    spec.start_time,
    spec.end_time,
    spec.hours,
    spec.total_pay,
    spec.foreman_employee_id || null,
    spec.paid ? 1 : 0,
    spec.paid_date || null,
    spec.payroll_run_id || null,
    spec.payroll_check_id || null,
    spec.approval_status || 'pending',
    spec.approved_at || null,
    spec.approved_by_employee_id || null,
    spec.approval_note || null,
    spec.resolved ? 1 : 0,
    spec.resolved_status || 'open',
    spec.resolved_note || null,
    spec.resolved_at || null,
    spec.resolved_by || null,
    spec.verified ? 1 : 0,
    spec.verified_at || null,
    spec.verified_by_employee_id || null,
    spec.employee_name_snapshot || null,
    spec.project_name_snapshot || null,
    spec.updated_at || new Date().toISOString()
  ];

  if (existing) {
    await run(
      db,
      `
        UPDATE time_entries
        SET employee_id = ?,
            project_id = ?,
            start_date = ?,
            end_date = ?,
            start_time = ?,
            end_time = ?,
            hours = ?,
            total_pay = ?,
            foreman_employee_id = ?,
            paid = ?,
            paid_date = ?,
            payroll_run_id = ?,
            payroll_check_id = ?,
            approval_status = ?,
            approved_at = ?,
            approved_by_employee_id = ?,
            approval_note = ?,
            resolved = ?,
            resolved_status = ?,
            resolved_note = ?,
            resolved_at = ?,
            resolved_by = ?,
            verified = ?,
            verified_at = ?,
            verified_by_employee_id = ?,
            employee_name_snapshot = ?,
            project_name_snapshot = ?,
            updated_at = ?
        WHERE id = ? AND org_id = ?
      `,
      [...payload, existing.id, orgId]
    );
    return existing.id;
  }

  const insert = await run(
    db,
    `
      INSERT INTO time_entries (
        org_id,
        employee_id,
        project_id,
        start_date,
        end_date,
        start_time,
        end_time,
        hours,
        total_pay,
        foreman_employee_id,
        paid,
        paid_date,
        payroll_run_id,
        payroll_check_id,
        approval_status,
        approved_at,
        approved_by_employee_id,
        approval_note,
        resolved,
        resolved_status,
        resolved_note,
        resolved_at,
        resolved_by,
        verified,
        verified_at,
        verified_by_employee_id,
        employee_name_snapshot,
        project_name_snapshot,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [orgId, ...payload]
  );
  return insert.lastID;
}

async function ensureTimePunch(db, orgId, spec) {
  const existing = await get(
    db,
    'SELECT id FROM time_punches WHERE org_id = ? AND client_id = ? LIMIT 1',
    [orgId, spec.client_id]
  );
  const payload = [
    spec.client_id,
    spec.employee_id,
    spec.project_id || null,
    spec.clock_in_ts,
    spec.clock_in_local_date,
    spec.clock_out_ts || null,
    spec.clock_out_local_date || null,
    spec.clock_out_project_id || null,
    spec.clock_in_lat != null ? spec.clock_in_lat : null,
    spec.clock_in_lng != null ? spec.clock_in_lng : null,
    spec.clock_out_lat != null ? spec.clock_out_lat : null,
    spec.clock_out_lng != null ? spec.clock_out_lng : null,
    spec.geo_distance_m != null ? spec.geo_distance_m : null,
    spec.geo_violation ? 1 : 0,
    spec.device_id || null,
    spec.clock_out_device_id || null,
    spec.kiosk_session_id || null,
    spec.foreman_employee_id || null,
    spec.auto_clock_out ? 1 : 0,
    spec.auto_clock_out_reason || null,
    spec.exception_review_status || 'open',
    spec.exception_review_note || null,
    spec.exception_reviewed_by || null,
    spec.exception_reviewed_at || null,
    spec.exception_resolved ? 1 : 0,
    spec.exception_resolved_at || null,
    spec.exception_resolved_by || null,
    spec.employee_name_snapshot || null,
    spec.project_name_snapshot || null,
    spec.time_entry_id || null,
    spec.updated_at || new Date().toISOString()
  ];

  if (existing) {
    await run(
      db,
      `
        UPDATE time_punches
        SET employee_id = ?,
            project_id = ?,
            clock_in_ts = ?,
            clock_in_local_date = ?,
            clock_out_ts = ?,
            clock_out_local_date = ?,
            clock_out_project_id = ?,
            clock_in_lat = ?,
            clock_in_lng = ?,
            clock_out_lat = ?,
            clock_out_lng = ?,
            geo_distance_m = ?,
            geo_violation = ?,
            device_id = ?,
            clock_out_device_id = ?,
            kiosk_session_id = ?,
            foreman_employee_id = ?,
            auto_clock_out = ?,
            auto_clock_out_reason = ?,
            exception_review_status = ?,
            exception_review_note = ?,
            exception_reviewed_by = ?,
            exception_reviewed_at = ?,
            exception_resolved = ?,
            exception_resolved_at = ?,
            exception_resolved_by = ?,
            employee_name_snapshot = ?,
            project_name_snapshot = ?,
            time_entry_id = ?,
            updated_at = ?
        WHERE id = ? AND org_id = ?
      `,
      [...payload.slice(1), existing.id, orgId]
    );
    return existing.id;
  }

  const insert = await run(
    db,
    `
      INSERT INTO time_punches (
        org_id,
        client_id,
        employee_id,
        project_id,
        clock_in_ts,
        clock_in_local_date,
        clock_out_ts,
        clock_out_local_date,
        clock_out_project_id,
        clock_in_lat,
        clock_in_lng,
        clock_out_lat,
        clock_out_lng,
        geo_distance_m,
        geo_violation,
        device_id,
        clock_out_device_id,
        kiosk_session_id,
        foreman_employee_id,
        auto_clock_out,
        auto_clock_out_reason,
        exception_review_status,
        exception_review_note,
        exception_reviewed_by,
        exception_reviewed_at,
        exception_resolved,
        exception_resolved_at,
        exception_resolved_by,
        employee_name_snapshot,
        project_name_snapshot,
        time_entry_id,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [orgId, ...payload]
  );
  return insert.lastID;
}

async function ensureShipment(db, orgId, spec) {
  const existing = await get(
    db,
    'SELECT id FROM shipments WHERE org_id = ? AND title = ? LIMIT 1',
    [orgId, spec.title]
  );

  const nowIso = new Date().toISOString();
  const payload = [
    spec.title,
    spec.po_number || null,
    spec.vendor_id || null,
    spec.vendor_name || null,
    spec.freight_forwarder || null,
    spec.destination || null,
    spec.project_id || null,
    spec.project_name_snapshot || null,
    spec.sku || null,
    spec.country_of_origin || null,
    spec.quantity != null ? spec.quantity : null,
    spec.total_price != null ? spec.total_price : null,
    spec.price_per_item != null ? spec.price_per_item : null,
    spec.expected_ship_date || null,
    spec.expected_arrival_date || null,
    spec.tracking_number || null,
    spec.bol_number || null,
    spec.requested_clearing ? 1 : 0,
    spec.requested_clearing_date || null,
    spec.is_container ? 1 : 0,
    spec.storage_due_date || null,
    spec.storage_daily_late_fee != null ? spec.storage_daily_late_fee : null,
    spec.picked_up_by || null,
    spec.picked_up_date || null,
    spec.picked_up_updated_by || null,
    spec.picked_up_updated_at || null,
    spec.vendor_paid ? 1 : 0,
    spec.vendor_paid_amount != null ? spec.vendor_paid_amount : null,
    spec.shipper_paid ? 1 : 0,
    spec.shipper_paid_amount != null ? spec.shipper_paid_amount : null,
    spec.shipper_paid_by || null,
    spec.customs_paid ? 1 : 0,
    spec.customs_paid_amount != null ? spec.customs_paid_amount : null,
    spec.customs_paid_by || null,
    spec.storage_paid ? 1 : 0,
    spec.storage_paid_amount != null ? spec.storage_paid_amount : null,
    spec.storage_paid_by || null,
    spec.total_paid != null ? spec.total_paid : null,
    spec.items_verified ? 1 : 0,
    spec.verified_by || null,
    spec.verification_notes || null,
    spec.website_url || null,
    spec.notes || null,
    spec.status || 'Pre-Order',
    spec.is_archived ? 1 : 0,
    spec.archived_at || null,
    spec.created_by || null
  ];

  if (existing) {
    await run(
      db,
      `
        UPDATE shipments
        SET po_number = ?,
            vendor_id = ?,
            vendor_name = ?,
            freight_forwarder = ?,
            destination = ?,
            project_id = ?,
            project_name_snapshot = ?,
            sku = ?,
            country_of_origin = ?,
            quantity = ?,
            total_price = ?,
            price_per_item = ?,
            expected_ship_date = ?,
            expected_arrival_date = ?,
            tracking_number = ?,
            bol_number = ?,
            requested_clearing = ?,
            requested_clearing_date = ?,
            is_container = ?,
            storage_due_date = ?,
            storage_daily_late_fee = ?,
            picked_up_by = ?,
            picked_up_date = ?,
            picked_up_updated_by = ?,
            picked_up_updated_at = ?,
            vendor_paid = ?,
            vendor_paid_amount = ?,
            shipper_paid = ?,
            shipper_paid_amount = ?,
            shipper_paid_by = ?,
            customs_paid = ?,
            customs_paid_amount = ?,
            customs_paid_by = ?,
            storage_paid = ?,
            storage_paid_amount = ?,
            storage_paid_by = ?,
            total_paid = ?,
            items_verified = ?,
            verified_by = ?,
            verification_notes = ?,
            website_url = ?,
            notes = ?,
            status = ?,
            is_archived = ?,
            archived_at = ?,
            updated_at = ?
        WHERE id = ? AND org_id = ?
      `,
      [...payload.slice(1, -1), nowIso, existing.id, orgId]
    );
    return existing.id;
  }

  const insert = await run(
    db,
    `
      INSERT INTO shipments (
        org_id,
        title,
        po_number,
        vendor_id,
        vendor_name,
        freight_forwarder,
        destination,
        project_id,
        project_name_snapshot,
        sku,
        country_of_origin,
        quantity,
        total_price,
        price_per_item,
        expected_ship_date,
        expected_arrival_date,
        tracking_number,
        bol_number,
        requested_clearing,
        requested_clearing_date,
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
        is_archived,
        archived_at,
        created_by,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    `,
    [orgId, ...payload, nowIso]
  );
  return insert.lastID;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printUsage();
    process.exit(0);
  }

  const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
  if (nodeEnv === 'production' && !args['allow-production']) {
    console.error('Refusing to run in production. Re-run with --allow-production if intentional.');
    process.exit(1);
  }

  const seedTag = String(args['seed-tag'] || 'Seed').trim() || 'Seed';
  const seedSlug = slugify(seedTag);
  const adminEmail = String(args['admin-email'] || 'seed.superadmin@example.com').trim().toLowerCase();
  const adminPassword = String(args['admin-password'] || 'SeedPass123!').trim();
  const opsEmail = String(args['ops-email'] || 'seed.opsadmin@example.com').trim().toLowerCase();
  const opsPassword = String(args['ops-password'] || 'SeedOps123!').trim();
  const seededEmployeeNames = {
    superAdmin: '♛ Lisett Rodriguez',
    opsAdmin: 'Mr. Krabs',
    kioskAdmin: 'John Johnson',
    workerAlpha: 'Mrs. Puff',
    workerBravo: 'Patrick Star',
    workerCharlie: 'Pearl Krabs'
  };
  const legacySeededEmployeeNames = {
    superAdmin: `${seedTag} Super Admin`,
    opsAdmin: `${seedTag} Ops Admin`,
    kioskAdmin: `${seedTag} Kiosk Admin`,
    workerAlpha: `${seedTag} Worker Alpha`,
    workerBravo: `${seedTag} Worker Bravo`,
    workerCharlie: `${seedTag} Worker Charlie`,
    workerInactive: `${seedTag} Worker Inactive`
  };
  const requestedOrgId = args['org-id'] ? Number(args['org-id']) : null;
  const requestedOrgName = String(args['org-name'] || process.env.BOOTSTRAP_ORG_NAME || `${seedTag} Org`).trim();
  const requestedOrgTimezone = String(
    args['org-timezone'] || process.env.BOOTSTRAP_ORG_TIMEZONE || process.env.APP_TIMEZONE || 'America/Puerto_Rico'
  ).trim();

  const { db, resolved } = await openDb(DB_PATH);
  console.log(`Using DB: ${resolved}`);
  await run(db, 'PRAGMA foreign_keys = ON');

  try {
    let org = null;
    if (requestedOrgId && Number.isFinite(requestedOrgId) && requestedOrgId > 0) {
      org = await get(db, 'SELECT id, name, timezone FROM orgs WHERE id = ? LIMIT 1', [requestedOrgId]);
      if (!org) {
        throw new Error(`Org not found: ${requestedOrgId}`);
      }
    } else {
      org = await get(db, 'SELECT id, name, timezone FROM orgs ORDER BY id ASC LIMIT 1');
    }

    if (!org) {
      const insertOrg = await run(
        db,
        'INSERT INTO orgs (name, timezone, status, created_at, updated_at) VALUES (?, ?, \'active\', datetime(\'now\'), datetime(\'now\'))',
        [requestedOrgName, requestedOrgTimezone]
      );
      org = {
        id: insertOrg.lastID,
        name: requestedOrgName,
        timezone: requestedOrgTimezone
      };
      console.log(`Created org ${org.id} (${org.name})`);
    } else {
      console.log(`Seeding org ${org.id} (${org.name})`);
    }

    const orgId = org.id;
    const orgTimezone = org.timezone || requestedOrgTimezone;

    const enrollmentCode = String(Math.floor(100000 + Math.random() * 900000));
    const payrollRules = JSON.stringify({
      pay_period_length_days: 7,
      pay_period_start_weekday: 1,
      pay_period_anchor_date: null,
      overtime_enabled: true,
      overtime_daily_threshold_hours: 8,
      overtime_weekly_threshold_hours: 40,
      overtime_multiplier: 1.5,
      double_time_enabled: true,
      double_time_daily_threshold_hours: 12,
      double_time_multiplier: 2
    });
    const timeExceptionRules = JSON.stringify({
      missing_clock_out: true,
      long_shift: true,
      multi_day: true,
      crosses_midnight: true,
      no_project: true,
      project_mismatch: true,
      tiny_punch: true,
      geofence_clock_in: true,
      auto_clock_out: true,
      manual_no_punches: true,
      manual_hours_mismatch: true,
      weekly_hours: true,
      weekly_hours_threshold: 45,
      auto_clockout_daily_max_hours: 13,
      auto_clockout_weekly_max_hours: 55,
      offline_punch_max_age_days: 14
    });

    await ensureOrgSetting(db, orgId, 'company_name', `${seedTag} Construction`);
    await ensureOrgSetting(db, orgId, 'company_email', `contact+${seedSlug}@example.com`);
    await ensureOrgSetting(db, orgId, 'storage_daily_late_fee_default', '15');
    await ensureOrgSetting(db, orgId, 'storage_container_daily_late_fee_default', '30');
    await ensureOrgSetting(db, orgId, 'clock_in_photo_required', '0');
    await ensureOrgSetting(db, orgId, 'kiosk_enrollment_code', enrollmentCode);
    await ensureOrgSetting(db, orgId, 'payroll_rules', payrollRules);
    await ensureOrgSetting(db, orgId, 'time_exception_rules', timeExceptionRules);
    await ensureOrgSetting(db, orgId, 'notifications', JSON.stringify({}));
    await ensureOrgSetting(db, orgId, 'branding', JSON.stringify({ theme: 'seed' }));
    await ensureOrgSetting(db, orgId, 'audit_log_retention_days', '365');

    const fullPerms = {
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

    const superAdminEmployeeId = await ensureEmployee(db, orgId, {
      name: seededEmployeeNames.superAdmin,
      match_names: [legacySeededEmployeeNames.superAdmin],
      given_name: 'Lisett',
      family_name: 'Rodriguez',
      nickname: 'Super',
      name_on_checks: seededEmployeeNames.superAdmin,
      rate: 65,
      active: true,
      language: 'en',
      role_title: 'Super Admin',
      needs_qbo_sync: true,
      worker_timekeeping: true,
      desktop_access: true,
      kiosk_admin_access: true,
      email: adminEmail,
      phone: '787-555-1000',
      start_date: toYmd(addDays(new Date(), -120), orgTimezone)
    });
    await ensurePermissionRow(db, superAdminEmployeeId, fullPerms);

    const superAdminUserId = await ensureUser(db, {
      email: adminEmail,
      password: adminPassword
    });
    await ensureMembership(db, {
      userId: superAdminUserId,
      orgId,
      employeeId: superAdminEmployeeId,
      isSuperAdmin: true,
      loginEnabled: true
    });

    const opsEmployeeId = await ensureEmployee(db, orgId, {
      name: seededEmployeeNames.opsAdmin,
      match_names: [legacySeededEmployeeNames.opsAdmin],
      given_name: 'Mr.',
      family_name: 'Krabs',
      nickname: 'Ops',
      name_on_checks: seededEmployeeNames.opsAdmin,
      rate: 52,
      active: true,
      language: 'es',
      role_title: 'Operations Admin',
      needs_qbo_sync: true,
      worker_timekeeping: true,
      desktop_access: true,
      kiosk_admin_access: true,
      email: opsEmail,
      phone: '787-555-1001',
      start_date: toYmd(addDays(new Date(), -90), orgTimezone)
    });
    await ensurePermissionRow(db, opsEmployeeId, {
      see_shipments: true,
      modify_time: true,
      approve_time: true,
      view_time_reports: true,
      view_all_timesheets: true,
      assign_timesheets: true,
      view_payroll: true,
      modify_payroll: true,
      modify_pay_rates: true
    });

    const opsUserId = await ensureUser(db, {
      email: opsEmail,
      password: opsPassword
    });
    await ensureMembership(db, {
      userId: opsUserId,
      orgId,
      employeeId: opsEmployeeId,
      isSuperAdmin: true,
      loginEnabled: true
    });

    const kioskAdminId = await ensureEmployee(db, orgId, {
      name: seededEmployeeNames.kioskAdmin,
      match_names: [legacySeededEmployeeNames.kioskAdmin],
      given_name: 'John',
      family_name: 'Johnson',
      nickname: 'Tablet',
      name_on_checks: seededEmployeeNames.kioskAdmin,
      rate: 38,
      active: true,
      language: 'ht',
      role_title: 'Kiosk Admin',
      needs_qbo_sync: true,
      worker_timekeeping: true,
      desktop_access: false,
      kiosk_admin_access: true,
      email: `${seedSlug}.kiosk.admin@example.com`,
      phone: '787-555-1002',
      start_date: toYmd(addDays(new Date(), -70), orgTimezone)
    });
    await ensurePermissionRow(db, kioskAdminId, {
      see_shipments: true,
      modify_time: true,
      approve_time: false,
      view_time_reports: true,
      view_all_timesheets: false,
      assign_timesheets: true,
      view_payroll: false,
      modify_payroll: false,
      modify_pay_rates: true
    });

    const workerAlphaId = await ensureEmployee(db, orgId, {
      name: seededEmployeeNames.workerAlpha,
      match_names: [legacySeededEmployeeNames.workerAlpha],
      given_name: 'Mrs.',
      family_name: 'Puff',
      nickname: 'Alpha',
      name_on_checks: seededEmployeeNames.workerAlpha,
      rate: 24,
      active: true,
      language: 'en',
      role_title: 'Lead Installer',
      needs_qbo_sync: true,
      worker_timekeeping: true,
      desktop_access: false,
      kiosk_admin_access: false,
      email: `${seedSlug}.worker.alpha@example.com`,
      phone: '787-555-1101',
      start_date: toYmd(addDays(new Date(), -60), orgTimezone)
    });
    await ensurePermissionRow(db, workerAlphaId, {
      see_shipments: false,
      modify_time: false,
      approve_time: false,
      view_time_reports: false,
      view_all_timesheets: false,
      assign_timesheets: false,
      view_payroll: false,
      modify_payroll: false,
      modify_pay_rates: false
    });

    const workerBravoId = await ensureEmployee(db, orgId, {
      name: seededEmployeeNames.workerBravo,
      match_names: [legacySeededEmployeeNames.workerBravo],
      given_name: 'Patrick',
      family_name: 'Star',
      nickname: 'Bravo',
      name_on_checks: seededEmployeeNames.workerBravo,
      rate: 21,
      active: true,
      language: 'es',
      role_title: 'Installer',
      needs_qbo_sync: true,
      worker_timekeeping: true,
      desktop_access: false,
      kiosk_admin_access: false,
      email: `${seedSlug}.worker.bravo@example.com`,
      phone: '787-555-1102',
      start_date: toYmd(addDays(new Date(), -50), orgTimezone)
    });
    await ensurePermissionRow(db, workerBravoId, {
      see_shipments: false,
      modify_time: false,
      approve_time: false,
      view_time_reports: false,
      view_all_timesheets: false,
      assign_timesheets: false,
      view_payroll: false,
      modify_payroll: false,
      modify_pay_rates: false
    });

    const workerCharlieId = await ensureEmployee(db, orgId, {
      name: seededEmployeeNames.workerCharlie,
      match_names: [legacySeededEmployeeNames.workerCharlie],
      given_name: 'Pearl',
      family_name: 'Krabs',
      nickname: 'Charlie',
      name_on_checks: seededEmployeeNames.workerCharlie,
      rate: 19,
      active: true,
      language: 'ht',
      role_title: 'Helper',
      needs_qbo_sync: true,
      worker_timekeeping: true,
      desktop_access: false,
      kiosk_admin_access: false,
      email: `${seedSlug}.worker.charlie@example.com`,
      phone: '787-555-1103',
      start_date: toYmd(addDays(new Date(), -40), orgTimezone)
    });
    await ensurePermissionRow(db, workerCharlieId, {
      see_shipments: false,
      modify_time: false,
      approve_time: false,
      view_time_reports: false,
      view_all_timesheets: false,
      assign_timesheets: false,
      view_payroll: false,
      modify_payroll: false,
      modify_pay_rates: false
    });

    const inactiveWorkerId = await ensureEmployee(db, orgId, {
      name: legacySeededEmployeeNames.workerInactive,
      nickname: 'Inactive',
      name_on_checks: legacySeededEmployeeNames.workerInactive,
      rate: 18,
      active: false,
      language: 'en',
      role_title: 'Former Worker',
      needs_qbo_sync: true,
      worker_timekeeping: true,
      desktop_access: false,
      kiosk_admin_access: false,
      email: `${seedSlug}.worker.inactive@example.com`,
      phone: '787-555-1104',
      start_date: toYmd(addDays(new Date(), -200), orgTimezone),
      termination_date: toYmd(addDays(new Date(), -10), orgTimezone)
    });
    await ensurePermissionRow(db, inactiveWorkerId, {
      see_shipments: false,
      modify_time: false,
      approve_time: false,
      view_time_reports: false,
      view_all_timesheets: false,
      assign_timesheets: false,
      view_payroll: false,
      modify_payroll: false,
      modify_pay_rates: false
    });

    const pins = [
      { id: superAdminEmployeeId, pin: '1111' },
      { id: opsEmployeeId, pin: '2222' },
      { id: kioskAdminId, pin: '3333' },
      { id: workerAlphaId, pin: '4444' },
      { id: workerBravoId, pin: '5555' },
      { id: workerCharlieId, pin: '6666' }
    ];
    for (const row of pins) {
      const pinHash = await bcrypt.hash(row.pin, 10);
      await run(db, 'UPDATE employees SET pin_hash = ? WHERE id = ? AND org_id = ?', [
        pinHash,
        row.id,
        orgId
      ]);
    }

    const templateAccessOps = JSON.stringify({
      worker_timekeeping: true,
      desktop_access: true,
      kiosk_admin_access: true
    });
    const templatePermsOps = JSON.stringify({
      see_shipments: true,
      modify_time: true,
      approve_time: true,
      view_time_reports: true,
      view_all_timesheets: true,
      assign_timesheets: true,
      view_payroll: true,
      modify_payroll: true,
      modify_pay_rates: true
    });
    await run(
      db,
      `
        INSERT INTO permission_templates (
          org_id, name, role_title, access_json, permissions_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT DO NOTHING
      `,
      [orgId, `${seedTag} Ops Template`, 'Operations Lead', templateAccessOps, templatePermsOps]
    );

    const templateAccessField = JSON.stringify({
      worker_timekeeping: true,
      desktop_access: false,
      kiosk_admin_access: true
    });
    const templatePermsField = JSON.stringify({
      see_shipments: true,
      modify_time: true,
      approve_time: false,
      view_time_reports: true,
      view_all_timesheets: false,
      assign_timesheets: true,
      view_payroll: false,
      modify_payroll: false,
      modify_pay_rates: true
    });
    await run(
      db,
      `
        INSERT INTO permission_templates (
          org_id, name, role_title, access_json, permissions_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT DO NOTHING
      `,
      [orgId, `${seedTag} Field Template`, 'Field Supervisor', templateAccessField, templatePermsField]
    );

    const projectAId = await ensureProject(db, orgId, {
      name: 'Bikini Bottom',
      match_names: [`${seedTag} Project A`, `${seedTag} Project B`],
      customer_name: `${seedTag} Customer`,
      project_timezone: orgTimezone,
      geo_lat: 18.4655,
      geo_lng: -66.1057,
      geo_radius: 120,
      active: true
    });
    const projectBId = await ensureProject(db, orgId, {
      name: 'Jellyfish Fields',
      match_names: [`${seedTag} Project B`, `${seedTag} Project A`],
      customer_name: `${seedTag} Customer`,
      project_timezone: orgTimezone,
      geo_lat: 18.468,
      geo_lng: -66.116,
      geo_radius: 140,
      active: true
    });
    const projectCId = await ensureProject(db, orgId, {
      name: `${seedTag} Project C`,
      customer_name: `${seedTag} Expansion`,
      project_timezone: orgTimezone,
      geo_lat: null,
      geo_lng: null,
      geo_radius: null,
      active: true
    });
    const projectDId = await ensureProject(db, orgId, {
      name: `${seedTag} Project Inactive`,
      customer_name: `${seedTag} Archived`,
      project_timezone: orgTimezone,
      geo_lat: null,
      geo_lng: null,
      geo_radius: null,
      active: false
    });

    const vendorAId = await ensureVendor(db, orgId, {
      name: `${seedTag} Vendor A`,
      active: true,
      is_freight_forwarder: true,
      uses_timekeeping: false
    });
    const vendorBId = await ensureVendor(db, orgId, {
      name: `${seedTag} Vendor B`,
      active: true,
      is_freight_forwarder: false,
      uses_timekeeping: false
    });
    const vendorCId = await ensureVendor(db, orgId, {
      name: `${seedTag} Vendor C`,
      active: true,
      is_freight_forwarder: false,
      uses_timekeeping: false
    });
    const vendorDId = await ensureVendor(db, orgId, {
      name: `${seedTag} Vendor Inactive`,
      active: false,
      is_freight_forwarder: false,
      uses_timekeeping: false
    });

    const kioskDeviceA = `${seedSlug}-kiosk-main-${orgId}`;
    const kioskDeviceB = `${seedSlug}-kiosk-yard-${orgId}`;

    const kioskAId = await ensureKiosk(db, orgId, {
      name: `${seedTag} Main Kiosk`,
      location: 'Warehouse Bay 1',
      device_id: kioskDeviceA,
      device_secret: crypto.randomBytes(24).toString('hex'),
      project_id: projectAId
    });
    const kioskBId = await ensureKiosk(db, orgId, {
      name: `${seedTag} Yard Kiosk`,
      location: 'Yard Office',
      device_id: kioskDeviceB,
      device_secret: crypto.randomBytes(24).toString('hex'),
      project_id: projectBId
    });

    const todayYmd = toYmd(new Date(), orgTimezone);
    const yesterdayYmd = toYmd(addDays(new Date(), -1), orgTimezone);
    const twoDaysAgoYmd = toYmd(addDays(new Date(), -2), orgTimezone);

    const sessionTodayAId = await ensureKioskSession(db, orgId, {
      kiosk_id: kioskAId,
      device_id: kioskDeviceA,
      project_id: projectAId,
      date: todayYmd,
      created_by_employee_id: kioskAdminId,
      assigned_to_employee_id: opsEmployeeId,
      geo_lat: 18.4656,
      geo_lng: -66.1058,
      geo_distance_m: 12,
      geo_violation: false,
      created_at: toIsoAt(todayYmd, '06:30:00'),
      ended_at: null
    });
    const sessionYesterdayAId = await ensureKioskSession(db, orgId, {
      kiosk_id: kioskAId,
      device_id: kioskDeviceA,
      project_id: projectAId,
      date: yesterdayYmd,
      created_by_employee_id: kioskAdminId,
      assigned_to_employee_id: kioskAdminId,
      geo_lat: 18.4656,
      geo_lng: -66.1058,
      geo_distance_m: 8,
      geo_violation: false,
      created_at: toIsoAt(yesterdayYmd, '06:45:00'),
      ended_at: toIsoAt(yesterdayYmd, '18:30:00')
    });
    await ensureKioskSession(db, orgId, {
      kiosk_id: kioskBId,
      device_id: kioskDeviceB,
      project_id: projectBId,
      date: todayYmd,
      created_by_employee_id: opsEmployeeId,
      assigned_to_employee_id: opsEmployeeId,
      geo_lat: 18.4681,
      geo_lng: -66.1161,
      geo_distance_m: 20,
      geo_violation: false,
      created_at: toIsoAt(todayYmd, '07:00:00'),
      ended_at: null
    });

    await run(
      db,
      `
        INSERT INTO kiosk_foreman_days (
          org_id, kiosk_id, foreman_employee_id, date, set_by_employee_id, created_at
        )
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(kiosk_id, date) DO UPDATE SET
          foreman_employee_id = excluded.foreman_employee_id,
          set_by_employee_id = excluded.set_by_employee_id,
          created_at = excluded.created_at
      `,
      [orgId, kioskAId, workerAlphaId, todayYmd, kioskAdminId]
    );

    const alphaRateRow = await get(db, 'SELECT rate, name FROM employees WHERE id = ? AND org_id = ?', [
      workerAlphaId,
      orgId
    ]);
    const bravoRateRow = await get(db, 'SELECT rate, name FROM employees WHERE id = ? AND org_id = ?', [
      workerBravoId,
      orgId
    ]);
    const charlieRateRow = await get(db, 'SELECT rate, name FROM employees WHERE id = ? AND org_id = ?', [
      workerCharlieId,
      orgId
    ]);
    const projectARow = await get(db, 'SELECT name FROM projects WHERE id = ? AND org_id = ?', [
      projectAId,
      orgId
    ]);
    const projectBRow = await get(db, 'SELECT name FROM projects WHERE id = ? AND org_id = ?', [
      projectBId,
      orgId
    ]);

    const alphaEntryId = await ensureTimeEntry(db, orgId, {
      employee_id: workerAlphaId,
      project_id: projectAId,
      start_date: todayYmd,
      end_date: todayYmd,
      start_time: '08:00',
      end_time: '16:15',
      hours: 8.25,
      total_pay: Number(alphaRateRow.rate || 0) * 8.25,
      foreman_employee_id: workerAlphaId,
      paid: false,
      approval_status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by_employee_id: superAdminEmployeeId,
      approval_note: 'Seed approval',
      resolved: true,
      resolved_status: 'approved',
      resolved_note: 'Seed resolved',
      resolved_at: new Date().toISOString(),
      resolved_by: 'admin',
      verified: true,
      verified_at: new Date().toISOString(),
      verified_by_employee_id: superAdminEmployeeId,
      employee_name_snapshot: alphaRateRow.name,
      project_name_snapshot: projectARow.name
    });

    await ensureTimePunch(db, orgId, {
      client_id: `${seedSlug}-alpha-closed`,
      employee_id: workerAlphaId,
      project_id: projectAId,
      clock_in_ts: toIsoAt(todayYmd, '08:00:00'),
      clock_in_local_date: todayYmd,
      clock_out_ts: toIsoAt(todayYmd, '16:15:00'),
      clock_out_local_date: todayYmd,
      clock_out_project_id: projectAId,
      clock_in_lat: 18.4705,
      clock_in_lng: -66.1225,
      clock_out_lat: 18.4705,
      clock_out_lng: -66.1225,
      geo_distance_m: 2500,
      geo_violation: true,
      device_id: kioskDeviceA,
      clock_out_device_id: kioskDeviceA,
      kiosk_session_id: sessionTodayAId,
      foreman_employee_id: workerAlphaId,
      auto_clock_out: false,
      exception_review_status: 'approved',
      exception_review_note: 'Seed reviewed',
      exception_reviewed_by: seededEmployeeNames.superAdmin,
      exception_reviewed_at: new Date().toISOString(),
      exception_resolved: true,
      exception_resolved_at: new Date().toISOString(),
      exception_resolved_by: seededEmployeeNames.superAdmin,
      employee_name_snapshot: alphaRateRow.name,
      project_name_snapshot: projectARow.name,
      time_entry_id: alphaEntryId
    });

    const bravoOpenClientId = `${seedSlug}-bravo-open`;
    await ensureTimePunch(db, orgId, {
      client_id: bravoOpenClientId,
      employee_id: workerBravoId,
      project_id: projectAId,
      clock_in_ts: toIsoAt(todayYmd, '09:10:00'),
      clock_in_local_date: todayYmd,
      clock_out_ts: null,
      clock_out_local_date: null,
      clock_out_project_id: null,
      clock_in_lat: 18.4654,
      clock_in_lng: -66.1056,
      geo_distance_m: 9,
      geo_violation: false,
      device_id: kioskDeviceA,
      clock_out_device_id: null,
      kiosk_session_id: sessionTodayAId,
      foreman_employee_id: workerAlphaId,
      auto_clock_out: false,
      exception_review_status: 'open',
      exception_review_note: null,
      exception_reviewed_by: null,
      exception_reviewed_at: null,
      exception_resolved: false,
      employee_name_snapshot: bravoRateRow.name,
      project_name_snapshot: projectARow.name,
      time_entry_id: null
    });

    const tinyEntryId = await ensureTimeEntry(db, orgId, {
      employee_id: workerCharlieId,
      project_id: projectAId,
      start_date: todayYmd,
      end_date: todayYmd,
      start_time: '16:20',
      end_time: '16:23',
      hours: 0.05,
      total_pay: Number(charlieRateRow.rate || 0) * 0.05,
      foreman_employee_id: workerAlphaId,
      paid: false,
      approval_status: 'pending',
      resolved: false,
      resolved_status: 'open',
      verified: false,
      employee_name_snapshot: charlieRateRow.name,
      project_name_snapshot: projectARow.name
    });

    await ensureTimePunch(db, orgId, {
      client_id: `${seedSlug}-charlie-tiny`,
      employee_id: workerCharlieId,
      project_id: projectAId,
      clock_in_ts: toIsoAt(todayYmd, '16:20:00'),
      clock_in_local_date: todayYmd,
      clock_out_ts: toIsoAt(todayYmd, '16:23:00'),
      clock_out_local_date: todayYmd,
      clock_out_project_id: projectAId,
      clock_in_lat: 18.4656,
      clock_in_lng: -66.1058,
      clock_out_lat: 18.4656,
      clock_out_lng: -66.1058,
      geo_distance_m: 11,
      geo_violation: false,
      device_id: kioskDeviceA,
      clock_out_device_id: kioskDeviceA,
      kiosk_session_id: sessionTodayAId,
      foreman_employee_id: workerAlphaId,
      auto_clock_out: false,
      exception_review_status: 'open',
      exception_resolved: false,
      employee_name_snapshot: charlieRateRow.name,
      project_name_snapshot: projectARow.name,
      time_entry_id: tinyEntryId
    });

    const mismatchEntryId = await ensureTimeEntry(db, orgId, {
      employee_id: workerBravoId,
      project_id: projectAId,
      start_date: yesterdayYmd,
      end_date: yesterdayYmd,
      start_time: '07:00',
      end_time: '13:00',
      hours: 6,
      total_pay: Number(bravoRateRow.rate || 0) * 6,
      foreman_employee_id: workerAlphaId,
      paid: false,
      approval_status: 'pending',
      resolved: false,
      resolved_status: 'open',
      verified: false,
      employee_name_snapshot: bravoRateRow.name,
      project_name_snapshot: projectARow.name
    });

    await ensureTimePunch(db, orgId, {
      client_id: `${seedSlug}-bravo-mismatch`,
      employee_id: workerBravoId,
      project_id: projectAId,
      clock_in_ts: toIsoAt(yesterdayYmd, '07:00:00'),
      clock_in_local_date: yesterdayYmd,
      clock_out_ts: toIsoAt(yesterdayYmd, '15:00:00'),
      clock_out_local_date: yesterdayYmd,
      clock_out_project_id: projectAId,
      clock_in_lat: 18.4655,
      clock_in_lng: -66.1057,
      clock_out_lat: 18.4655,
      clock_out_lng: -66.1057,
      geo_distance_m: 7,
      geo_violation: false,
      device_id: kioskDeviceA,
      clock_out_device_id: kioskDeviceA,
      kiosk_session_id: sessionYesterdayAId,
      foreman_employee_id: workerAlphaId,
      auto_clock_out: false,
      exception_review_status: 'open',
      exception_resolved: false,
      employee_name_snapshot: bravoRateRow.name,
      project_name_snapshot: projectARow.name,
      time_entry_id: mismatchEntryId
    });

    const autoClockEntryId = await ensureTimeEntry(db, orgId, {
      employee_id: workerCharlieId,
      project_id: projectAId,
      start_date: yesterdayYmd,
      end_date: yesterdayYmd,
      start_time: '10:00',
      end_time: '23:59',
      hours: 13.98,
      total_pay: Number(charlieRateRow.rate || 0) * 13.98,
      foreman_employee_id: workerAlphaId,
      paid: false,
      approval_status: 'pending',
      resolved: false,
      resolved_status: 'open',
      verified: false,
      employee_name_snapshot: charlieRateRow.name,
      project_name_snapshot: projectARow.name
    });

    await ensureTimePunch(db, orgId, {
      client_id: `${seedSlug}-charlie-auto`,
      employee_id: workerCharlieId,
      project_id: projectAId,
      clock_in_ts: toIsoAt(yesterdayYmd, '10:00:00'),
      clock_in_local_date: yesterdayYmd,
      clock_out_ts: toIsoAt(yesterdayYmd, '23:59:59'),
      clock_out_local_date: yesterdayYmd,
      clock_out_project_id: projectAId,
      clock_in_lat: 18.4656,
      clock_in_lng: -66.1058,
      clock_out_lat: null,
      clock_out_lng: null,
      geo_distance_m: null,
      geo_violation: false,
      device_id: kioskDeviceA,
      clock_out_device_id: null,
      kiosk_session_id: sessionYesterdayAId,
      foreman_employee_id: workerAlphaId,
      auto_clock_out: true,
      auto_clock_out_reason: 'midnight_auto',
      exception_review_status: 'open',
      exception_resolved: false,
      employee_name_snapshot: charlieRateRow.name,
      project_name_snapshot: projectARow.name,
      time_entry_id: autoClockEntryId
    });

    const manualEntryId = await ensureTimeEntry(db, orgId, {
      employee_id: workerAlphaId,
      project_id: projectBId,
      start_date: twoDaysAgoYmd,
      end_date: twoDaysAgoYmd,
      start_time: '08:30',
      end_time: '16:00',
      hours: 7.5,
      total_pay: Number(alphaRateRow.rate || 0) * 7.5,
      foreman_employee_id: null,
      paid: false,
      approval_status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by_employee_id: superAdminEmployeeId,
      approval_note: 'Manual approved',
      resolved: true,
      resolved_status: 'modified',
      resolved_note: 'Manual no-punch exception reviewed.',
      resolved_at: new Date().toISOString(),
      resolved_by: 'admin',
      verified: true,
      verified_at: new Date().toISOString(),
      verified_by_employee_id: superAdminEmployeeId,
      employee_name_snapshot: alphaRateRow.name,
      project_name_snapshot: projectBRow.name
    });

    const payrollReadyEntryId = await ensureTimeEntry(db, orgId, {
      employee_id: workerBravoId,
      project_id: projectBId,
      start_date: yesterdayYmd,
      end_date: yesterdayYmd,
      start_time: '14:00',
      end_time: '18:00',
      hours: 4,
      total_pay: Number(bravoRateRow.rate || 0) * 4,
      foreman_employee_id: workerAlphaId,
      paid: false,
      approval_status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by_employee_id: superAdminEmployeeId,
      approval_note: 'Seed payroll-ready approval',
      resolved: true,
      resolved_status: 'approved',
      resolved_note: 'Seed payroll-ready review',
      resolved_at: new Date().toISOString(),
      resolved_by: 'admin',
      verified: true,
      verified_at: new Date().toISOString(),
      verified_by_employee_id: superAdminEmployeeId,
      employee_name_snapshot: bravoRateRow.name,
      project_name_snapshot: projectBRow.name
    });

    await ensureTimePunch(db, orgId, {
      client_id: `${seedSlug}-bravo-ready`,
      employee_id: workerBravoId,
      project_id: projectBId,
      clock_in_ts: toIsoAt(yesterdayYmd, '14:00:00'),
      clock_in_local_date: yesterdayYmd,
      clock_out_ts: toIsoAt(yesterdayYmd, '18:00:00'),
      clock_out_local_date: yesterdayYmd,
      clock_out_project_id: projectBId,
      clock_in_lat: 18.4662,
      clock_in_lng: -66.1062,
      clock_out_lat: 18.4662,
      clock_out_lng: -66.1062,
      geo_distance_m: 10,
      geo_violation: false,
      device_id: kioskDeviceA,
      clock_out_device_id: kioskDeviceA,
      kiosk_session_id: sessionYesterdayAId,
      foreman_employee_id: workerAlphaId,
      auto_clock_out: false,
      exception_review_status: 'approved',
      exception_review_note: 'Seed payroll-ready punch',
      exception_reviewed_by: seededEmployeeNames.superAdmin,
      exception_reviewed_at: new Date().toISOString(),
      exception_resolved: true,
      exception_resolved_at: new Date().toISOString(),
      exception_resolved_by: seededEmployeeNames.superAdmin,
      employee_name_snapshot: bravoRateRow.name,
      project_name_snapshot: projectBRow.name,
      time_entry_id: payrollReadyEntryId
    });

    await run(
      db,
      `
        INSERT INTO time_exception_actions (
          org_id,
          source_type,
          source_id,
          action,
          actor_user_id,
          actor_employee_id,
          actor_name,
          note,
          changes_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `,
      [
        orgId,
        'time_entry',
        manualEntryId,
        'modify',
        superAdminUserId,
        superAdminEmployeeId,
        seededEmployeeNames.superAdmin,
        'Manual entry adjusted during exception review.',
        JSON.stringify({
          before: { hours: 8 },
          after: { hours: 7.5 }
        })
      ]
    );
    await run(
      db,
      `
        INSERT INTO time_exception_actions (
          org_id,
          source_type,
          source_id,
          action,
          actor_user_id,
          actor_employee_id,
          actor_name,
          note,
          changes_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `,
      [
        orgId,
        'punch',
        (await get(db, 'SELECT id FROM time_punches WHERE org_id = ? AND client_id = ? LIMIT 1', [
          orgId,
          `${seedSlug}-alpha-closed`
        ])).id,
        'approve',
        superAdminUserId,
        superAdminEmployeeId,
        seededEmployeeNames.superAdmin,
        'Geofence exception approved with note.',
        JSON.stringify({
          before: { exception_review_status: 'open' },
          after: { exception_review_status: 'approved' }
        })
      ]
    );

    await run(
      db,
      `
        INSERT INTO payroll_settings (
          org_id,
          bank_account_name,
          expense_account_name,
          default_memo,
          line_description_template
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING
      `,
      [
        orgId,
        `${seedTag} Payroll Checking`,
        `${seedTag} Payroll Expense`,
        `Payroll ${seedTag} {start} - {end}`,
        `${seedTag} labor {hours}h - {project}`
      ]
    );

    const payrollRunOne = await get(
      db,
      `
        SELECT id
        FROM payroll_runs
        WHERE org_id = ? AND start_date = ? AND end_date = ? AND run_type = 'standard'
        LIMIT 1
      `,
      [orgId, twoDaysAgoYmd, todayYmd]
    );

    let payrollRunOneId = payrollRunOne ? payrollRunOne.id : null;
    if (!payrollRunOneId) {
      const insertRun = await run(
        db,
        `
          INSERT INTO payroll_runs (
            org_id,
            start_date,
            end_date,
            created_by,
            created_at,
            total_hours,
            total_pay,
            status,
            include_overtime,
            run_type,
            adjustment_reason,
            idempotency_key,
            last_error
          ) VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?, 1, 'standard', ?, ?, NULL)
        `,
        [
          orgId,
          twoDaysAgoYmd,
          todayYmd,
          superAdminEmployeeId,
          15.75,
          (Number(alphaRateRow.rate || 0) * 8.25) + (Number(alphaRateRow.rate || 0) * 7.5),
          'COMPLETED',
          `${seedTag} seed payroll run`,
          uniqueClientId(`${seedSlug}-payroll`)
        ]
      );
      payrollRunOneId = insertRun.lastID;
    }

    const existingAlphaCheck = await get(
      db,
      `
        SELECT id
        FROM payroll_checks
        WHERE org_id = ? AND payroll_run_id = ? AND employee_id = ?
        LIMIT 1
      `,
      [orgId, payrollRunOneId, workerAlphaId]
    );
    let alphaCheckId = existingAlphaCheck ? existingAlphaCheck.id : null;
    if (!alphaCheckId) {
      const insertCheck = await run(
        db,
        `
          INSERT INTO payroll_checks (
            org_id,
            payroll_run_id,
            employee_id,
            total_hours,
            total_pay,
            qbo_txn_id,
            paid,
            paid_date,
            check_number
          ) VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), ?)
        `,
        [
          orgId,
          payrollRunOneId,
          workerAlphaId,
          15.75,
          (Number(alphaRateRow.rate || 0) * 8.25) + (Number(alphaRateRow.rate || 0) * 7.5),
          `SEED-QBO-${seedSlug.toUpperCase()}-001`,
          `SEED-${orgId}-1001`
        ]
      );
      alphaCheckId = insertCheck.lastID;
    }

    await run(
      db,
      `
        UPDATE time_entries
        SET paid = 1,
            paid_date = datetime('now'),
            payroll_run_id = ?,
            payroll_check_id = ?
        WHERE id IN (?, ?) AND org_id = ?
      `,
      [payrollRunOneId, alphaCheckId, alphaEntryId, manualEntryId, orgId]
    );

    const payrollRunTwo = await get(
      db,
      `
        SELECT id
        FROM payroll_runs
        WHERE org_id = ? AND start_date = ? AND end_date = ? AND run_type = 'retry'
        LIMIT 1
      `,
      [orgId, yesterdayYmd, todayYmd]
    );
    if (!payrollRunTwo) {
      await run(
        db,
        `
          INSERT INTO payroll_runs (
            org_id,
            start_date,
            end_date,
            created_by,
            created_at,
            total_hours,
            total_pay,
            status,
            include_overtime,
            run_type,
            adjustment_reason,
            idempotency_key,
            last_error
          ) VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?, 1, 'retry', ?, ?, ?)
        `,
        [
          orgId,
          yesterdayYmd,
          todayYmd,
          superAdminEmployeeId,
          6,
          Number(bravoRateRow.rate || 0) * 6,
          'PARTIAL',
          `${seedTag} retry run`,
          uniqueClientId(`${seedSlug}-payroll-retry`),
          'Seeded partial failure for retry testing.'
        ]
      );
    }

    await run(
      db,
      `
        INSERT INTO payroll_audit_log (
          org_id,
          payroll_run_id,
          event_type,
          actor_employee_id,
          message,
          details_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `,
      [
        orgId,
        payrollRunOneId,
        'PAYROLL_RUN_SUCCESS',
        superAdminEmployeeId,
        'Seed payroll run completed.',
        JSON.stringify({ source: 'seed', run_id: payrollRunOneId })
      ]
    );
    await run(
      db,
      `
        INSERT INTO payroll_audit_log (
          org_id,
          payroll_run_id,
          event_type,
          actor_employee_id,
          message,
          details_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `,
      [
        orgId,
        payrollRunOneId,
        'PAYROLL_UNPAY',
        superAdminEmployeeId,
        'Seed unpay event log row.',
        JSON.stringify({ source: 'seed', note: 'for report testing' })
      ]
    );

    const shipmentOneId = await ensureShipment(db, orgId, {
      title: `${seedTag} Shipment Pre-Order`,
      po_number: `${seedSlug.toUpperCase()}-PO-001`,
      vendor_id: vendorAId,
      vendor_name: `${seedTag} Vendor A`,
      freight_forwarder: `${seedTag} Forwarding`,
      destination: 'San Juan Main Warehouse',
      project_id: projectAId,
      project_name_snapshot: projectARow.name,
      sku: `${seedSlug.toUpperCase()}-SKU-001`,
      country_of_origin: 'US',
      quantity: 10,
      total_price: 1200,
      price_per_item: 120,
      expected_ship_date: todayYmd,
      expected_arrival_date: toYmd(addDays(new Date(), 3), orgTimezone),
      tracking_number: `${seedSlug.toUpperCase()}-TRK-001`,
      bol_number: `${seedSlug.toUpperCase()}-BOL-001`,
      requested_clearing: false,
      is_container: false,
      storage_due_date: toYmd(addDays(new Date(), 8), orgTimezone),
      storage_daily_late_fee: 15,
      vendor_paid: false,
      shipper_paid: false,
      customs_paid: false,
      storage_paid: false,
      items_verified: false,
      status: 'Pre-Order',
      is_archived: false,
      created_by: superAdminEmployeeId,
      notes: 'Initial seeded shipment.'
    });

    const shipmentTwoId = await ensureShipment(db, orgId, {
      title: `${seedTag} Shipment Ready Pickup`,
      po_number: `${seedSlug.toUpperCase()}-PO-002`,
      vendor_id: vendorBId,
      vendor_name: `${seedTag} Vendor B`,
      freight_forwarder: `${seedTag} Logistics`,
      destination: 'Arecibo Yard',
      project_id: projectBId,
      project_name_snapshot: projectBRow.name,
      sku: `${seedSlug.toUpperCase()}-SKU-002`,
      country_of_origin: 'CN',
      quantity: 30,
      total_price: 7200,
      price_per_item: 240,
      expected_ship_date: yesterdayYmd,
      expected_arrival_date: todayYmd,
      tracking_number: `${seedSlug.toUpperCase()}-TRK-002`,
      bol_number: `${seedSlug.toUpperCase()}-BOL-002`,
      requested_clearing: true,
      requested_clearing_date: yesterdayYmd,
      is_container: true,
      storage_due_date: toYmd(addDays(new Date(), 5), orgTimezone),
      storage_daily_late_fee: 30,
      vendor_paid: true,
      vendor_paid_amount: 4200,
      shipper_paid: true,
      shipper_paid_amount: 950,
      shipper_paid_by: 'Company',
      customs_paid: true,
      customs_paid_amount: 550,
      customs_paid_by: 'Company',
      storage_paid: false,
      total_paid: 5700,
      items_verified: true,
      verified_by: seededEmployeeNames.kioskAdmin,
      verification_notes: 'Seed verification complete.',
      status: 'Cleared - Ready for Pickup',
      is_archived: false,
      created_by: superAdminEmployeeId,
      notes: 'Ready for pickup seeded shipment.'
    });

    const shipmentThreeId = await ensureShipment(db, orgId, {
      title: `${seedTag} Shipment Picked Up`,
      po_number: `${seedSlug.toUpperCase()}-PO-003`,
      vendor_id: vendorCId,
      vendor_name: `${seedTag} Vendor C`,
      freight_forwarder: `${seedTag} Cargo`,
      destination: 'Ponce Site',
      project_id: projectCId,
      project_name_snapshot: `${seedTag} Project C`,
      sku: `${seedSlug.toUpperCase()}-SKU-003`,
      country_of_origin: 'MX',
      quantity: 12,
      total_price: 2600,
      price_per_item: 216.67,
      expected_ship_date: twoDaysAgoYmd,
      expected_arrival_date: yesterdayYmd,
      tracking_number: `${seedSlug.toUpperCase()}-TRK-003`,
      bol_number: `${seedSlug.toUpperCase()}-BOL-003`,
      requested_clearing: true,
      requested_clearing_date: twoDaysAgoYmd,
      is_container: false,
      storage_due_date: yesterdayYmd,
      storage_daily_late_fee: 18,
      picked_up_by: `${seedTag} Driver`,
      picked_up_date: todayYmd,
      picked_up_updated_by: seededEmployeeNames.opsAdmin,
      picked_up_updated_at: new Date().toISOString(),
      vendor_paid: true,
      vendor_paid_amount: 1500,
      shipper_paid: true,
      shipper_paid_amount: 450,
      shipper_paid_by: 'Other: Broker',
      customs_paid: true,
      customs_paid_amount: 160,
      customs_paid_by: 'Company',
      storage_paid: true,
      storage_paid_amount: 75,
      storage_paid_by: 'Company',
      total_paid: 2185,
      items_verified: true,
      verified_by: seededEmployeeNames.kioskAdmin,
      verification_notes: 'Picked up and checked.',
      status: 'Picked Up',
      is_archived: false,
      created_by: opsEmployeeId,
      notes: 'Picked up seeded shipment.'
    });

    const shipmentFourId = await ensureShipment(db, orgId, {
      title: `${seedTag} Shipment Archived`,
      po_number: `${seedSlug.toUpperCase()}-PO-004`,
      vendor_id: vendorDId,
      vendor_name: `${seedTag} Vendor Inactive`,
      freight_forwarder: `${seedTag} Freight`,
      destination: 'Archived Location',
      project_id: projectAId,
      project_name_snapshot: projectARow.name,
      sku: `${seedSlug.toUpperCase()}-SKU-004`,
      country_of_origin: 'US',
      quantity: 4,
      total_price: 500,
      price_per_item: 125,
      expected_ship_date: toYmd(addDays(new Date(), -20), orgTimezone),
      expected_arrival_date: toYmd(addDays(new Date(), -16), orgTimezone),
      tracking_number: `${seedSlug.toUpperCase()}-TRK-004`,
      bol_number: `${seedSlug.toUpperCase()}-BOL-004`,
      requested_clearing: false,
      is_container: false,
      storage_due_date: toYmd(addDays(new Date(), -10), orgTimezone),
      storage_daily_late_fee: 0,
      vendor_paid: true,
      vendor_paid_amount: 500,
      total_paid: 500,
      items_verified: true,
      verified_by: seededEmployeeNames.opsAdmin,
      status: 'Archived',
      is_archived: true,
      archived_at: new Date().toISOString(),
      created_by: superAdminEmployeeId,
      notes: 'Archived seeded shipment.'
    });

    const shipmentIds = [shipmentOneId, shipmentTwoId, shipmentThreeId, shipmentFourId];
    for (const shipmentId of shipmentIds) {
      const historyExists = await get(
        db,
        'SELECT id FROM shipment_status_history WHERE org_id = ? AND shipment_id = ? LIMIT 1',
        [orgId, shipmentId]
      );
      if (!historyExists) {
        const statusRow = await get(
          db,
          'SELECT status FROM shipments WHERE id = ? AND org_id = ?',
          [shipmentId, orgId]
        );
        await run(
          db,
          `
            INSERT INTO shipment_status_history (
              org_id, shipment_id, old_status, new_status, note, changed_at
            ) VALUES (?, ?, NULL, ?, 'Seed status insert', datetime('now'))
          `,
          [orgId, shipmentId, statusRow ? statusRow.status : 'Pre-Order']
        );
      }

      const timelineExists = await get(
        db,
        'SELECT id FROM shipment_timeline WHERE org_id = ? AND shipment_id = ? LIMIT 1',
        [orgId, shipmentId]
      );
      if (!timelineExists) {
        const statusRow = await get(
          db,
          'SELECT status FROM shipments WHERE id = ? AND org_id = ?',
          [shipmentId, orgId]
        );
        await run(
          db,
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
            ) VALUES (?, ?, 'status_change', NULL, ?, 'Shipment seeded.', ?, datetime('now'))
          `,
          [orgId, shipmentId, statusRow ? statusRow.status : 'Pre-Order', superAdminEmployeeId]
        );
      }
    }

    const shipmentItemsToSeed = [
      {
        shipment_id: shipmentOneId,
        rows: [
          { description: `${seedTag} Cabinets`, sku: 'CAB-01', coo: 'US', qty: 4, price: 120, vendor: `${seedTag} Vendor A`, verified: 0 },
          { description: `${seedTag} Hinges`, sku: 'HNG-02', coo: 'US', qty: 20, price: 8, vendor: `${seedTag} Vendor A`, verified: 0 }
        ]
      },
      {
        shipment_id: shipmentTwoId,
        rows: [
          {
            description: `${seedTag} Tiles`,
            sku: 'TIL-01',
            coo: 'CN',
            qty: 30,
            price: 90,
            vendor: `${seedTag} Vendor B`,
            verified: 1,
            verification: {
              status: 'verified',
              notes: 'All tiles verified.',
              verified_at: new Date().toISOString(),
              storage_override: 'Aisle B4',
              history: []
            }
          },
          {
            description: `${seedTag} Grout`,
            sku: 'GRT-03',
            coo: 'CN',
            qty: 10,
            price: 35,
            vendor: `${seedTag} Vendor B`,
            verified: 1,
            verification: {
              status: 'verified',
              notes: 'Packaging intact.',
              verified_at: new Date().toISOString(),
              storage_override: 'Aisle B5',
              history: []
            }
          }
        ]
      },
      {
        shipment_id: shipmentThreeId,
        rows: [
          {
            description: `${seedTag} Plumbing Fixtures`,
            sku: 'PLM-01',
            coo: 'MX',
            qty: 8,
            price: 120,
            vendor: `${seedTag} Vendor C`,
            verified: 1,
            verification: {
              status: 'verified',
              notes: 'Verified before pickup.',
              verified_at: new Date().toISOString(),
              storage_override: 'Container C2',
              history: [
                {
                  at: new Date().toISOString(),
                  from_status: '',
                  to_status: 'verified',
                  by_employee_id: kioskAdminId,
                  by_name: seededEmployeeNames.kioskAdmin,
                  notes: 'Verified',
                  storage_override: 'Container C2'
                }
              ]
            }
          }
        ]
      },
      {
        shipment_id: shipmentFourId,
        rows: [
          { description: `${seedTag} Archived Material`, sku: 'ARC-01', coo: 'US', qty: 4, price: 125, vendor: `${seedTag} Vendor Inactive`, verified: 1 }
        ]
      }
    ];

    for (const block of shipmentItemsToSeed) {
      const existingCount = await get(
        db,
        'SELECT COUNT(*) AS cnt FROM shipment_items WHERE org_id = ? AND shipment_id = ?',
        [orgId, block.shipment_id]
      );
      if (Number(existingCount && existingCount.cnt ? existingCount.cnt : 0) > 0) continue;
      for (const row of block.rows) {
        const lineTotal = row.qty * row.price;
        await run(
          db,
          `
            INSERT INTO shipment_items (
              org_id,
              shipment_id,
              description,
              sku,
              country_of_origin,
              quantity,
              unit_price,
              line_total,
              vendor_name,
              verified,
              notes,
              verification_json,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          `,
          [
            orgId,
            block.shipment_id,
            row.description,
            row.sku,
            row.coo || null,
            row.qty,
            row.price,
            lineTotal,
            row.vendor || null,
            row.verified ? 1 : 0,
            row.verification && row.verification.notes ? row.verification.notes : null,
            row.verification ? JSON.stringify(row.verification) : null
          ]
        );
      }
    }

    const paymentSeed = [
      {
        shipment_id: shipmentTwoId,
        type: 'Freight',
        amount: 950,
        status: 'Paid',
        due_date: yesterdayYmd,
        paid_date: todayYmd,
        invoice_number: `${seedSlug.toUpperCase()}-INV-FF-02`
      },
      {
        shipment_id: shipmentThreeId,
        type: 'Customs',
        amount: 160,
        status: 'Paid',
        due_date: yesterdayYmd,
        paid_date: todayYmd,
        invoice_number: `${seedSlug.toUpperCase()}-INV-CU-03`
      }
    ];
    for (const payment of paymentSeed) {
      const exists = await get(
        db,
        `
          SELECT id
          FROM shipment_payments
          WHERE org_id = ? AND shipment_id = ? AND invoice_number = ?
          LIMIT 1
        `,
        [orgId, payment.shipment_id, payment.invoice_number]
      );
      if (exists) continue;
      await run(
        db,
        `
          INSERT INTO shipment_payments (
            org_id,
            shipment_id,
            type,
            amount,
            currency,
            status,
            due_date,
            paid_date,
            invoice_number,
            notes,
            created_by,
            created_at
          ) VALUES (?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, datetime('now'))
        `,
        [
          orgId,
          payment.shipment_id,
          payment.type,
          payment.amount,
          payment.status,
          payment.due_date,
          payment.paid_date,
          payment.invoice_number,
          'Seeded payment row.',
          superAdminEmployeeId
        ]
      );
    }

    const threadTitle = `${seedTag} General`;
    const threadExists = await get(
      db,
      `
        SELECT id
        FROM shipment_comment_threads
        WHERE org_id = ? AND shipment_id = ? AND title = ?
        LIMIT 1
      `,
      [orgId, shipmentTwoId, threadTitle]
    );
    let threadId = threadExists ? threadExists.id : null;
    if (!threadId) {
      const ins = await run(
        db,
        `
          INSERT INTO shipment_comment_threads (
            org_id,
            shipment_id,
            title,
            category,
            created_by,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, 'General', ?, datetime('now'), datetime('now'))
        `,
        [orgId, shipmentTwoId, threadTitle, superAdminEmployeeId]
      );
      threadId = ins.lastID;
    }
    const commentExists = await get(
      db,
      `
        SELECT id
        FROM shipment_comments
        WHERE org_id = ? AND shipment_id = ? AND thread_id = ? AND body = ?
        LIMIT 1
      `,
      [orgId, shipmentTwoId, threadId, `${seedTag} seeded comment for shipment tracking.`]
    );
    if (!commentExists) {
      await run(
        db,
        `
          INSERT INTO shipment_comments (
            org_id,
            shipment_id,
            thread_id,
            body,
            created_by,
            is_deleted,
            created_at
          ) VALUES (?, ?, ?, ?, ?, 0, datetime('now'))
        `,
        [
          orgId,
          shipmentTwoId,
          threadId,
          `${seedTag} seeded comment for shipment tracking.`,
          superAdminEmployeeId
        ]
      );
    }

    await run(
      db,
      `
        INSERT INTO shipment_personal_notes (
          org_id,
          shipment_id,
          user_id,
          note,
          is_completed,
          completed_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, 0, NULL, datetime('now'), datetime('now'))
        ON CONFLICT(org_id, shipment_id, user_id) DO UPDATE SET
          note = excluded.note,
          is_completed = 0,
          completed_at = NULL,
          updated_at = datetime('now')
      `,
      [orgId, shipmentTwoId, superAdminUserId, `${seedTag} follow up with broker tomorrow.`]
    );

    const uploadsRoot = path.join(__dirname, '..', 'secure_uploads', 'shipments');
    fs.mkdirSync(uploadsRoot, { recursive: true });
    const pdfFile = `${seedSlug}-shipment-${shipmentTwoId}-invoice.pdf`;
    const bolFile = `${seedSlug}-shipment-${shipmentTwoId}-bol.pdf`;
    const pdfPath = path.join(uploadsRoot, pdfFile);
    const bolPath = path.join(uploadsRoot, bolFile);
    if (!fs.existsSync(pdfPath)) {
      fs.writeFileSync(
        pdfPath,
        Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
      );
    }
    if (!fs.existsSync(bolPath)) {
      fs.writeFileSync(
        bolPath,
        Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
      );
    }

    const docsSeed = [
      {
        shipment_id: shipmentTwoId,
        title: `${seedTag} Freight Payment Receipt.pdf`,
        doc_type: 'Freight Payment',
        doc_label: 'Forwarder payment receipt',
        file_path: `shipments/${pdfFile}`
      },
      {
        shipment_id: shipmentTwoId,
        title: `${seedTag} Bill of Lading.pdf`,
        doc_type: 'BOL',
        doc_label: 'Bill of lading',
        file_path: `shipments/${bolFile}`
      }
    ];
    for (const doc of docsSeed) {
      const exists = await get(
        db,
        `
          SELECT id
          FROM shipment_documents
          WHERE org_id = ? AND shipment_id = ? AND title = ?
          LIMIT 1
        `,
        [orgId, doc.shipment_id, doc.title]
      );
      if (exists) continue;
      await run(
        db,
        `
          INSERT INTO shipment_documents (
            org_id,
            shipment_id,
            title,
            category,
            doc_type,
            doc_label,
            file_path,
            uploaded_by,
            uploaded_at
          ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, datetime('now'))
        `,
        [
          orgId,
          doc.shipment_id,
          doc.title,
          doc.doc_type,
          doc.doc_label,
          doc.file_path,
          superAdminEmployeeId
        ]
      );
    }

    const templateName = `${seedTag} Kitchen Template`;
    const templateExists = await get(
      db,
      'SELECT id FROM shipment_templates WHERE org_id = ? AND name = ? LIMIT 1',
      [orgId, templateName]
    );
    let templateId = templateExists ? templateExists.id : null;
    if (!templateId) {
      const ins = await run(
        db,
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
            country_of_origin,
            quantity,
            total_price,
            price_per_item,
            website_url,
            notes,
            created_by,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `,
        [
          orgId,
          templateName,
          `${seedTag} Kitchen Package`,
          vendorAId,
          `${seedTag} Forwarding`,
          'Main warehouse',
          projectAId,
          `${seedSlug.toUpperCase()}-TMP-001`,
          'US',
          6,
          1800,
          300,
          'https://example.com/template',
          'Seeded shipment template.',
          superAdminEmployeeId
        ]
      );
      templateId = ins.lastID;
    }

    const templateItemExists = await get(
      db,
      'SELECT id FROM shipment_template_items WHERE org_id = ? AND template_id = ? LIMIT 1',
      [orgId, templateId]
    );
    if (!templateItemExists) {
      await run(
        db,
        `
          INSERT INTO shipment_template_items (
            org_id,
            template_id,
            description,
            sku,
            country_of_origin,
            quantity,
            unit_price,
            line_total,
            vendor_name,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `,
        [
          orgId,
          templateId,
          `${seedTag} Template Line Item`,
          `${seedSlug.toUpperCase()}-TMP-L1`,
          'US',
          6,
          300,
          1800,
          `${seedTag} Vendor A`
        ]
      );
    }

    await run(
      db,
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
        ON CONFLICT(org_id, user_id) DO UPDATE SET
          employee_id = excluded.employee_id,
          statuses_json = excluded.statuses_json,
          shipment_ids_json = excluded.shipment_ids_json,
          project_ids_json = excluded.project_ids_json,
          notify_time = excluded.notify_time,
          remind_every_days = excluded.remind_every_days,
          enabled = excluded.enabled,
          updated_at = datetime('now')
      `,
      [
        orgId,
        superAdminUserId,
        superAdminEmployeeId,
        JSON.stringify(['Cleared - Ready for Pickup', 'Picked Up']),
        JSON.stringify([shipmentTwoId, shipmentThreeId]),
        JSON.stringify([projectAId, projectBId]),
        '09:00',
        1
      ]
    );

    await run(
      db,
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
        ) VALUES (?, ?, 1, 1, ?, ?, ?, '08:30', 1, 1, '17:00', datetime('now'))
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
        superAdminUserId,
        JSON.stringify({ enabled: true, statuses: ['Cleared - Ready for Pickup'], project_ids: [projectAId] }),
        JSON.stringify({ enabled: true, event_types: ['PAYROLL_RUN_DUE', 'PAYROLL_RUN_FAILURE'] }),
        JSON.stringify({ enabled: true, event_types: ['TIME_EXCEPTION_OPEN', 'TIME_EXCEPTION_REVIEWED'] })
      ]
    );

    const notifRows = [
      {
        type: 'shipment',
        title: `${seedTag} shipment reminder`,
        body: `${seedTag} Shipment Ready Pickup is waiting.`,
        data: { shipment_id: shipmentTwoId, status: 'Cleared - Ready for Pickup' },
        read_at: null
      },
      {
        type: 'time',
        title: `${seedTag} time exception`,
        body: `${seededEmployeeNames.workerBravo} has an open punch.`,
        data: { employee_id: workerBravoId, source: 'punch' },
        read_at: null
      },
      {
        type: 'payroll',
        title: `${seedTag} payroll run complete`,
        body: `${seedTag} payroll run ${payrollRunOneId} completed successfully.`,
        data: { payroll_run_id: payrollRunOneId },
        read_at: new Date().toISOString()
      }
    ];
    for (const n of notifRows) {
      const exists = await get(
        db,
        `
          SELECT id
          FROM notifications
          WHERE org_id = ? AND user_id = ? AND title = ?
          LIMIT 1
        `,
        [orgId, superAdminUserId, n.title]
      );
      if (exists) continue;
      const inserted = await run(
        db,
        `
          INSERT INTO notifications (
            org_id,
            user_id,
            type,
            title,
            body,
            data_json,
            read_at,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `,
        [orgId, superAdminUserId, n.type, n.title, n.body, JSON.stringify(n.data), n.read_at]
      );
      await run(
        db,
        `
          INSERT INTO notification_deliveries (
            org_id,
            notification_id,
            channel,
            status,
            error,
            created_at
          ) VALUES (?, ?, 'in_app', 'sent', NULL, datetime('now'))
        `,
        [orgId, inserted.lastID]
      );
    }

    const auditSeed = [
      { action: 'employee.create', entity_type: 'employee', entity_id: workerAlphaId, note: 'Seed employee data created.' },
      { action: 'kiosk.create', entity_type: 'kiosk', entity_id: kioskAId, note: 'Seed kiosk created.' },
      { action: 'shipment.create', entity_type: 'shipment', entity_id: shipmentOneId, note: 'Seed shipment inserted.' },
      { action: 'settings.update', entity_type: 'org', entity_id: orgId, note: 'Seed settings update.' },
      { action: 'notification.pref.update', entity_type: 'user', entity_id: superAdminUserId, note: 'Seed notification preferences.' },
      { action: 'qbo.sync.employees', entity_type: 'org', entity_id: orgId, note: 'Seed qbo sync placeholder.' }
    ];
    for (const row of auditSeed) {
      const exists = await get(
        db,
        `
          SELECT id
          FROM audit_log
          WHERE org_id = ? AND action = ? AND entity_type = ? AND entity_id = ? AND note = ?
          LIMIT 1
        `,
        [orgId, row.action, row.entity_type, row.entity_id, row.note]
      );
      if (exists) continue;
      await run(
        db,
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
            note,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, datetime('now'))
        `,
        [
          orgId,
          superAdminUserId,
          superAdminEmployeeId,
          row.action,
          row.entity_type,
          row.entity_id,
          row.note
        ]
      );
    }

    const idempotencyKey = `${seedSlug}-sample-key`;
    await run(
      db,
      `
        INSERT INTO idempotency_keys (org_id, scope, key, response_json, created_at)
        VALUES (?, 'seed_demo', ?, ?, datetime('now'))
        ON CONFLICT(org_id, scope, key) DO UPDATE SET response_json = excluded.response_json
      `,
      [orgId, idempotencyKey, JSON.stringify({ ok: true, seed: seedTag })]
    );

    const counts = await all(
      db,
      `
        SELECT 'users' AS t, COUNT(*) AS c FROM users
        UNION ALL SELECT 'employees', COUNT(*) FROM employees WHERE org_id = ?
        UNION ALL SELECT 'projects', COUNT(*) FROM projects WHERE org_id = ?
        UNION ALL SELECT 'vendors', COUNT(*) FROM vendors WHERE org_id = ?
        UNION ALL SELECT 'kiosks', COUNT(*) FROM kiosks WHERE org_id = ?
        UNION ALL SELECT 'kiosk_sessions', COUNT(*) FROM kiosk_sessions WHERE org_id = ?
        UNION ALL SELECT 'time_punches', COUNT(*) FROM time_punches WHERE org_id = ?
        UNION ALL SELECT 'time_entries', COUNT(*) FROM time_entries WHERE org_id = ?
        UNION ALL SELECT 'payroll_runs', COUNT(*) FROM payroll_runs WHERE org_id = ?
        UNION ALL SELECT 'payroll_checks', COUNT(*) FROM payroll_checks WHERE org_id = ?
        UNION ALL SELECT 'shipments', COUNT(*) FROM shipments WHERE org_id = ?
        UNION ALL SELECT 'shipment_items', COUNT(*) FROM shipment_items WHERE org_id = ?
        UNION ALL SELECT 'notifications', COUNT(*) FROM notifications WHERE org_id = ?
        UNION ALL SELECT 'audit_log', COUNT(*) FROM audit_log WHERE org_id = ?
      `,
      [
        orgId,
        orgId,
        orgId,
        orgId,
        orgId,
        orgId,
        orgId,
        orgId,
        orgId,
        orgId,
        orgId,
        orgId,
        orgId
      ]
    );

    console.log('');
    console.log('Seed complete.');
    console.log(`Org: ${orgId} (${org.name || requestedOrgName})`);
    console.log(`Timezone: ${orgTimezone}`);
    console.log(`Enrollment code: ${enrollmentCode}`);
    console.log('');
    console.log('Seeded logins:');
    console.log(`  Super Admin: ${adminEmail} / ${adminPassword}`);
    console.log(`  Ops Admin:   ${opsEmail} / ${opsPassword}`);
    console.log('');
    console.log('Kiosk PINs:');
    console.log('  Super Admin PIN: 1111');
    console.log('  Ops Admin PIN:   2222');
    console.log('  Kiosk Admin PIN: 3333');
    console.log('  Worker Alpha PIN: 4444');
    console.log('  Worker Bravo PIN: 5555');
    console.log('  Worker Charlie PIN: 6666');
    console.log('');
    console.log('Key table counts:');
    for (const row of counts) {
      console.log(`  ${String(row.t).padEnd(14)} ${row.c}`);
    }
  } finally {
    db.close();
  }
}

main().catch(err => {
  console.error('Seed failed:', err.message || err);
  process.exit(1);
});
