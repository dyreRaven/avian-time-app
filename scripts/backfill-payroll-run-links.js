// Backfill payroll_run_id/payroll_check_id on time_entries from payroll_runs/payroll_checks.
// Usage: node scripts/backfill-payroll-run-links.js [--apply]

const path = require('path');
const db = require(path.join(__dirname, '..', 'db'));
const createDbHelpers = require(path.join(__dirname, '..', 'lib', 'db-helpers'));

const { dbAll, dbGet, dbRun } = createDbHelpers(db);

const apply = process.argv.includes('--apply');

async function main() {
  if (db.ready) {
    await db.ready;
  }

  const checks = await dbAll(
    `
      SELECT
        pc.id AS payroll_check_id,
        pc.employee_id AS employee_id,
        pr.id AS payroll_run_id,
        pr.start_date AS start_date,
        pr.end_date AS end_date
      FROM payroll_checks pc
      JOIN payroll_runs pr ON pr.id = pc.payroll_run_id
      ORDER BY pr.id ASC, pc.id ASC
    `
  );

  if (!checks.length) {
    console.log('No payroll checks found. Nothing to backfill.');
    return;
  }

  let totalCandidates = 0;
  let totalUpdated = 0;

  for (const row of checks) {
    const countRow = await dbGet(
      `
        SELECT COUNT(*) AS count
        FROM time_entries
        WHERE employee_id = ?
          AND payroll_run_id IS NULL
          AND paid = 1
          AND start_date >= ?
          AND end_date <= ?
      `,
      [row.employee_id, row.start_date, row.end_date]
    );
    const count = countRow ? Number(countRow.count || 0) : 0;
    totalCandidates += count;

    if (!apply || count === 0) continue;

    const res = await dbRun(
      `
        UPDATE time_entries
        SET payroll_run_id = ?,
            payroll_check_id = ?
        WHERE employee_id = ?
          AND payroll_run_id IS NULL
          AND paid = 1
          AND start_date >= ?
          AND end_date <= ?
      `,
      [
        row.payroll_run_id,
        row.payroll_check_id,
        row.employee_id,
        row.start_date,
        row.end_date
      ]
    );
    totalUpdated += res?.changes || 0;
  }

  if (apply) {
    console.log(`Backfill applied. Updated ${totalUpdated} time entries.`);
  } else {
    console.log(
      `Dry run: ${totalCandidates} time entries would be updated. Re-run with --apply to write changes.`
    );
  }

  const remaining = await dbGet(
    `
      SELECT COUNT(*) AS count
      FROM time_entries
      WHERE paid = 1 AND payroll_run_id IS NULL
    `
  );
  const remainingCount = remaining ? Number(remaining.count || 0) : 0;
  console.log(`Paid entries still missing payroll_run_id: ${remainingCount}`);
}

main()
  .catch(err => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    db.close();
  });
