#!/usr/bin/env node
// Reset local app data for testing and local onboarding/flow validation.

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { DB_PATH, SESSION_DB_PATH } = require('../lib/config');

const args = process.argv.slice(2);
let force = false;
let fullReset = false;
let orgId = null;

function usage() {
  console.log('Usage: node scripts/reset-testing-data.js [--all] [--org-id <orgId>] [--force]');
  console.log('Examples:');
  console.log('  node scripts/reset-testing-data.js --all --force');
  console.log('  node scripts/reset-testing-data.js --org-id 3 --force');
  console.log('Options:');
  console.log('  --all        Delete all app data except migration history.');
  console.log('  --org-id     Delete all rows tied to one organization (recommended for replaying bootstrap).');
  console.log('  --force      Required to execute the reset.');
}

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--help' || arg === '-h') {
    usage();
    process.exit(0);
  }
  if (arg === '--force') {
    force = true;
    continue;
  }
  if (arg === '--all') {
    fullReset = true;
    continue;
  }
  if (arg === '--org-id') {
    const parsed = Number(args[i + 1]);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      console.error('Invalid --org-id value.');
      process.exit(1);
    }
    orgId = parsed;
    i += 1;
    continue;
  }
}

if (!force) {
  console.error('Reset aborted: pass --force to run this tool.');
  usage();
  process.exit(1);
}

if (!fullReset && !orgId) {
  console.error('Reset target required: pass --all or --org-id.');
  usage();
  process.exit(1);
}

if (fullReset && orgId) {
  console.warn('Both --all and --org-id were provided; using full reset.');
  orgId = null;
}

if ((process.env.NODE_ENV || '').toLowerCase() === 'production') {
  console.error('Refusing to run test reset in production environment.');
  process.exit(1);
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) {
        reject(err);
        return;
      }
      resolve({ changes: this.changes, lastID: this.lastID });
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

async function openDb(dbPath) {
  const resolvedPath = path.resolve(dbPath || DB_PATH);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Database not found: ${resolvedPath}`);
  }
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(resolvedPath, err => {
      if (err) {
        reject(err);
        return;
      }
      resolve(db);
    });
  });
}

async function clearSessionDb() {
  const resolvedSessionPath = path.resolve(SESSION_DB_PATH);
  if (!fs.existsSync(resolvedSessionPath)) {
    console.log('Session DB not found, skipping.');
    return;
  }

  const sessionDb = await openDb(resolvedSessionPath);
  try {
    const tables = await all(
      sessionDb,
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';`
    );
    for (const row of tables) {
      const table = row && row.name;
      if (!table) continue;
      const q = quoteIdent(table);
      const { changes } = await run(sessionDb, `DELETE FROM ${q}`);
      console.log(`Session table cleared: ${table} (${changes || 0} rows)`);
    }
  } finally {
    sessionDb.close();
  }
}

async function tableHasColumn(db, table, column) {
  const columns = await all(db, `PRAGMA table_info(${quoteIdent(table)})`);
  return columns.some((row) => row && row.name === column);
}

async function clearMainDb() {
  const db = await openDb(DB_PATH);
  try {
    await run(db, 'PRAGMA foreign_keys = OFF');
    await run(db, 'BEGIN IMMEDIATE');

    const tables = await all(
      db,
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';`
    );
    const dataTables = tables
      .map(row => row && row.name)
      .filter(name => !!name && name !== 'schema_migrations');

    const memberRows = (!fullReset && orgId)
      ? await all(db, 'SELECT user_id FROM user_orgs WHERE org_id = ?', [orgId])
      : [];
    const orgUserIds = Array.from(
      new Set(
        memberRows
          .map(r => Number(r && r.user_id))
          .filter(id => Number.isInteger(id) && id > 0)
      )
    );
    const userPlaceholders = orgUserIds.map(() => '?').join(',');
    let totalChanges = 0;

    for (const table of dataTables) {
      const q = quoteIdent(table);
      const hasOrg = await tableHasColumn(db, table, 'org_id');
      const hasUser = await tableHasColumn(db, table, 'user_id');

      if (fullReset) {
        const result = await run(db, `DELETE FROM ${q}`);
        totalChanges += result.changes || 0;
        console.log(`Cleared table: ${table} (${result.changes || 0} rows)`);
        continue;
      }

      if (hasOrg) {
        const result = await run(db, `DELETE FROM ${q} WHERE org_id = ?`, [orgId]);
        totalChanges += result.changes || 0;
        if (result.changes) {
          console.log(`Deleted org rows: ${table} (${result.changes} rows)`);
        }
        continue;
      }

      if (hasUser && orgUserIds.length) {
        const result = await run(
          db,
          `DELETE FROM ${q} WHERE user_id IN (${userPlaceholders})`,
          orgUserIds
        );
        totalChanges += result.changes || 0;
        if (result.changes) {
          console.log(`Deleted user rows: ${table} (${result.changes} rows)`);
        }
      }
    }

    if (!fullReset && orgId && orgUserIds.length) {
      const result = await run(db, `DELETE FROM users WHERE id IN (${userPlaceholders})`, orgUserIds);
      if (result.changes) {
        console.log(`Deleted users: ${result.changes}`);
        totalChanges += result.changes;
      }
    }

    if (fullReset) {
      const seqRows = await all(
        db,
        "SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence';"
      );
      if (seqRows.length) {
        await run(db, 'DELETE FROM sqlite_sequence');
        console.log('Cleared sqlite_sequence.');
      }
    }

    await run(db, 'COMMIT');
    console.log(`Main DB reset complete. Total rows affected: ${totalChanges}`);
  } catch (err) {
    await run(db, 'ROLLBACK');
    throw err;
  } finally {
    await run(db, 'PRAGMA foreign_keys = ON');
    db.close();
  }
}

async function main() {
  const target = fullReset ? 'all app data' : `org ${orgId}`;
  console.log(`Resetting ${target}...`);

  await clearMainDb();
  await clearSessionDb();
  console.log('Reset finished.');
  console.log(
    'Reminder: clear browser localStorage onboarding keys (console snippet below) before re-running setup:'
  );
  console.log(
    'Object.keys(localStorage).filter(k => k.startsWith("avian_")).forEach(k => localStorage.removeItem(k));'
  );
  process.exit(0);
}

main().catch(err => {
  console.error('Reset failed:', err.message || err);
  process.exit(1);
});
