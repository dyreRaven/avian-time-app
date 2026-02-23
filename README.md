## Containerized Deployment

- Copy `.env.docker.example` to `.env` and fill required secrets:
  - `cp .env.docker.example .env`

- Build and start:
  - `docker compose build`
  - `docker compose up -d`
- Stop:
  - `docker compose down`
- Validate section toggles for a quick smoke check:
  - `npm run check:section-toggle`

Section bundles are controlled with `ENABLED_SECTIONS` in `docker-compose.yml`/env:

- Clock-in only:
  - `ENABLED_SECTIONS=clock docker compose up -d`
- Clock-in + Payroll:
  - `ENABLED_SECTIONS=clock,payroll docker compose up -d`
- Clock-in + Shipments:
  - `ENABLED_SECTIONS=clock,shipments docker compose up -d`
- All modules:
  - `ENABLED_SECTIONS=all docker compose up -d`

If you prefer a shell command override:

- `ENABLED_SECTIONS=clock,payroll docker compose up -d`

For repeatable app-store style bundles, use the profile patterns in
`docs/SECTION_PROFILES.md` (clock-only, clock+payroll, clock+shipments).

Defaults in the shipped compose:

- `ENABLED_SECTIONS=all`
- `DB_PATH=/app/data/rebuild.db`
- `SESSION_DB_PATH=/app/data/sessions.db`

## Security Notes

- **CSRF**: For any cross-origin client, read the `X-CSRF-Token` response header from a safe request (GET/HEAD/OPTIONS) and send it back in `X-CSRF-Token` on all state-changing requests (POST/PUT/PATCH/DELETE). Same-origin browser use should work without changes.
- **Sessions & tokens**: Sessions and QuickBooks tokens are encrypted at rest using `SESSION_ENCRYPTION_KEY` (or `SESSION_SECRET` fallback). Keep these secrets private in `.env`.
- **APNs key**: Keep the `.p8` file outside the repo (e.g., `/Users/dyreraven/secrets/...`) and set `APNS_KEY_PATH`, `APNS_KEY_ID`, `APNS_TEAM_ID`, and `APNS_BUNDLE_ID` in `.env`.
- **Git history**: History was rewritten to remove keys/DBs. If others consume this repo, they must re-clone or hard-reset to the current `main`.
- **Admin gating**: UI routes are gated by access toggles (desktop_access, kiosk_admin_access); API routes are gated by permissions listed in `rebuild/architecture/API_CONTRACTS.md`.

## Backups

- One-off backup: `node scripts/backup-once.js`
- Backup health check: `npm run backup:health -- --max-age-hours 30`
- Restore snapshot: `node scripts/restore.js --date YYYY-MM-DD --force` (stop server first)
- Backup behavior is configurable with:
  - `ENABLE_IN_PROCESS_BACKUPS`
  - `BACKUP_RUN_ON_STARTUP`
  - `BACKUP_INTERVAL_HOURS`
  - `BACKUP_DAILY_RETENTION_COUNT`
  - `BACKUP_MONTHLY_RETENTION_COUNT`
  - `BACKUP_DIR`
- Production runbook: `docs/BACKUP_RUNBOOK.md`

## Scripts

- Quick test reset (development only):
  - `npm run reset:test-data -- --all --force` (wipes app/session data for a fresh bootstrap test run, keeps migration history).
  - `npm run reset:test-data -- --org-id <id> --force` (removes all rows tied to a single org and related users).
  - After reset, in the browser console run:

    `Object.keys(localStorage).filter(k => k.startsWith('avian_')).forEach(k => localStorage.removeItem(k));`

- Comprehensive local fixtures:
  - `npm run seed:test-data` (adds/updates broad test data in the first org, including users/employees, kiosks/sessions, time entries/exceptions, shipments, payroll history, notifications, and audit rows).
  - Optional targeting/customization:
    - `npm run seed:test-data -- --org-id 1 --seed-tag Demo`
    - `npm run seed:test-data -- --admin-email demo.super@example.com --admin-password 'StrongPass123!'`

- `npm run lint` (placeholder; no lint configured yet).
- `npm test` (placeholder; no tests configured yet).
