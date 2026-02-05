// bootstrap-admin.js
// One-time script to create the first org + super admin login.

require('dotenv').config();

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('./db');
const createDbHelpers = require('./lib/db-helpers');

const { dbGet, dbRun } = createDbHelpers(db);

const ADMIN_EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const ADMIN_NAME = process.env.BOOTSTRAP_ADMIN_NAME;
const ORG_NAME = process.env.BOOTSTRAP_ORG_NAME;
const ORG_TIMEZONE = process.env.BOOTSTRAP_ORG_TIMEZONE || process.env.APP_TIMEZONE;

const normEmail = (ADMIN_EMAIL || '').trim().toLowerCase();
const adminName = (ADMIN_NAME || '').trim();
const orgName = (ORG_NAME || '').trim();
const orgTimezone = (ORG_TIMEZONE || '').trim();

if (!normEmail || !ADMIN_PASSWORD || !adminName || !orgName || !orgTimezone) {
  console.error(
    'Set BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD, BOOTSTRAP_ADMIN_NAME, ' +
      'BOOTSTRAP_ORG_NAME, and BOOTSTRAP_ORG_TIMEZONE (or APP_TIMEZONE) before running.'
  );
  process.exit(1);
}

const ENROLLMENT_CODE_KEY = 'kiosk_enrollment_code';

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

async function bootstrap() {
  if (db.ready) {
    await db.ready;
  }

  const countRow = await dbGet('SELECT COUNT(*) AS cnt FROM users');
  const userCount = countRow ? Number(countRow.cnt || 0) : 0;
  if (userCount > 0) {
    console.error('Bootstrap already completed. Use the /auth bootstrap flow.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const enrollmentCode = await generateUniqueEnrollmentCode();

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

  try {
    await dbRun('BEGIN');

    const orgRes = await dbRun(
      `
        INSERT INTO orgs (name, timezone)
        VALUES (?, ?)
      `,
      [orgName, orgTimezone]
    );
    const orgId = orgRes.lastID;

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

    const userRes = await dbRun(
      `
        INSERT INTO users (email, password_hash)
        VALUES (?, ?)
      `,
      [normEmail, passwordHash]
    );
    const userId = userRes.lastID;

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
      [orgId, adminName, normEmail]
    );
    const employeeId = employeeRes.lastID;

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
          view_time_reports,
          view_payroll,
          modify_payroll,
          modify_pay_rates
        ) VALUES (?, 1, 1, 1, 1, 1, 1)
      `,
      [employeeId]
    );

    await dbRun('COMMIT');

    console.log('✅ Bootstrap completed.');
    console.log('   org id:   ', orgId);
    console.log('   user id:  ', userId);
    console.log('   email:    ', normEmail);
    console.log('   employee: ', employeeId);
  } catch (err) {
    try {
      await dbRun('ROLLBACK');
    } catch (rollbackErr) {
      console.warn('Bootstrap rollback failed:', rollbackErr.message);
    }
    console.error('Bootstrap failed:', err.message || err);
    process.exit(1);
  }
}

bootstrap()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Bootstrap failed:', err.message || err);
    process.exit(1);
  });
