const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const createDbHelpers = require('../lib/db-helpers');
const { runMigrations } = require('../lib/migrations');
const {
  DB_PATH,
  SEED_ORG_NAME,
  SEED_ORG_TIMEZONE,
  SEED_ADMIN_NAME,
  SEED_COMPANY_EMAIL,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD
} = require('../lib/config');

const db = new sqlite3.Database(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');

const migrationsDir = path.join(__dirname, '..', 'migrations');
const { dbGet, dbRun } = createDbHelpers(db);

async function seed() {
  if (!SEED_ADMIN_EMAIL || !SEED_ADMIN_PASSWORD) {
    console.log(
      'Seed skipped. Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD to create the initial org and admin.'
    );
    return;
  }

  await runMigrations(db, migrationsDir);

  let org = await dbGet('SELECT id FROM orgs WHERE name = ?', [SEED_ORG_NAME]);
  let orgId = org ? org.id : null;
  if (!orgId) {
    const orgRes = await dbRun(
      `
        INSERT INTO orgs (name, timezone)
        VALUES (?, ?)
      `,
      [SEED_ORG_NAME, SEED_ORG_TIMEZONE]
    );
    orgId = orgRes.lastID;
  }

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

  const settings = [
    ['company_name', SEED_ORG_NAME],
    ['company_email', SEED_COMPANY_EMAIL || null],
    ['storage_daily_late_fee_default', null],
    ['clock_in_photo_required', 0],
    ['payroll_rules', JSON.stringify(payrollRules)],
    ['time_exception_rules', JSON.stringify(timeExceptionRules)],
    ['notifications', JSON.stringify({})],
    ['branding', JSON.stringify({})]
  ];

  for (const [key, value] of settings) {
    await dbRun(
      `
        INSERT OR IGNORE INTO org_settings (org_id, key, value)
        VALUES (?, ?, ?)
      `,
      [orgId, key, value]
    );
  }

  let user = await dbGet('SELECT id FROM users WHERE email = ?', [
    SEED_ADMIN_EMAIL
  ]);
  let userId = user ? user.id : null;
  if (!userId) {
    const passwordHash = await bcrypt.hash(SEED_ADMIN_PASSWORD, 10);
    const userRes = await dbRun(
      `
        INSERT INTO users (email, password_hash)
        VALUES (?, ?)
      `,
      [SEED_ADMIN_EMAIL, passwordHash]
    );
    userId = userRes.lastID;
  }

  let employee = await dbGet(
    `
      SELECT id
      FROM employees
      WHERE org_id = ? AND email = ?
    `,
    [orgId, SEED_ADMIN_EMAIL]
  );
  let employeeId = employee ? employee.id : null;
  if (!employeeId) {
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
      [orgId, SEED_ADMIN_NAME, SEED_ADMIN_EMAIL]
    );
    employeeId = employeeRes.lastID;
  }

  const membership = await dbGet(
    `
      SELECT id, employee_id
      FROM user_orgs
      WHERE user_id = ? AND org_id = ?
    `,
    [userId, orgId]
  );

  if (!membership) {
    await dbRun(
      `
        INSERT INTO user_orgs (user_id, org_id, employee_id, is_super_admin)
        VALUES (?, ?, ?, 1)
      `,
      [userId, orgId, employeeId]
    );
  } else {
    await dbRun(
      `
        UPDATE user_orgs
        SET is_super_admin = 1,
            employee_id = COALESCE(employee_id, ?)
        WHERE id = ?
      `,
      [employeeId, membership.id]
    );
  }

  await dbRun(
    `
      INSERT OR IGNORE INTO employee_permissions (
        employee_id,
        see_shipments,
        modify_time,
        view_time_reports,
        view_payroll,
        modify_pay_rates
      ) VALUES (?, 1, 1, 1, 1, 1)
    `,
    [employeeId]
  );

  console.log('Seed complete.');
}

seed()
  .then(() => db.close())
  .catch(err => {
    console.error('Seed failed:', err);
    db.close(() => process.exit(1));
  });
