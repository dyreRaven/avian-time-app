# Smoke Test Report
Generated: 2026-01-22

## Scope
- Environment and config (.env loading, required secrets, Node/runtime)
- Dependencies and startup (npm install, npm start, server boot)
- Database and migrations (schema up to date, basic CRUD sanity)
- Auth/session/CSRF (login, session persistence, CSRF flow)
- Core timekeeping and payroll (clock in/out, timesheet, payroll calc)
- Admin and permissions (role gating, access toggles)
- Kiosk and desktop access (kiosk routes and gating)
- QuickBooks integration (auth/connection smoke)
- Notifications (email, web-push, APNs)
- File uploads and storage (multer, secure uploads)
- Reports and PDF export (PDF generation path)
- Static UI/assets (main pages load, critical JS/CSS)
- Backup/restore scripts (backup runs; restore missing)
- Geofencing (project geofence edits, geofence flags)

## Summary
All listed sections were smoke-tested at least at the API/surface level. Fixes completed after the smoke run are marked below; remaining findings are still open.

## Notes
- Email/password login is intended for super admins only; all other roles use PIN on kiosk devices (per product decision).

## Findings (prioritized)

### P0 - Blockers (security and access)
- Fixed: Upload security: file allowlist trusts client MIME/ext and uploads are served inline, enabling stored XSS. Refs: lib/uploads.js, server.js:14540, server.js:14555
- Fixed: Upload path resolution now guards against path traversal for shipment/ID documents. Refs: lib/uploads.js, lib/id-uploads.js
- Fixed: Shipment payment documents are not gated by view_payroll. Refs: server.js:14457, docs/REBUILD_SPEC.md
- Fixed: Kiosk device GET calls to admin endpoints fail because admin_id is only read from the request body, while kiosk admin client sends it via query for GET. Refs: server.js:11807, server.js:10669, server.js:10728, public/kiosk-admin.js:253
- Fixed: Production cookies are configured as insecure in .env (COOKIE_SECURE=false, COOKIE_SAMESITE=lax) with NODE_ENV=production. Refs: .env, server.js:60
- Accepted risk: High-severity dependency vulnerabilities remain in the sqlite3/node-gyp/tar chain (build-time only; keep sqlite3 for now and re-evaluate on upstream fixes). Refs: package.json, package-lock.json, docs/DECISIONS.md

### P1 - Reliability and offline
- Fixed: PWA/offline caching broken: missing icons, service worker caches gated /kiosk-admin.html, and versioned assets mismatch. Refs: public/service-worker.js, public/manifest.json, public/index.html, public/kiosk-admin.html
- Fixed: 30-day setInterval overflows in Node, so retention jobs may not run reliably. Refs: server.js:17400
- Validated: backup-once creates snapshots and restore script restores DB + secure/public uploads in an isolated sandbox (no overwrite of live dirs). Refs: scripts/backup-once.js, scripts/restore.js
- Fixed: Scripts (migrate/backup/bootstrap) do not load .env, so required config may be missing outside server.js. Refs: scripts/migrate.js, scripts/backup-once.js, bootstrap-admin.js
- Fixed: Kiosk offline queue now uses localStorage fallback when IndexedDB is unavailable, so offline punches/PIN updates can still be queued. Refs: public/kiosk.js, public/js/offline-store.js
- Validated: Offline kiosk punch queue/resync works for worker punches (Wi-Fi off, queued clock-out synced on reconnect). Refs: public/kiosk.js, server.js
- Validated: Kiosk-admin offline time-entry review queue syncs on reconnect (approve action queued offline, synced online, persisted in time_exception_actions + time_entries). Refs: public/kiosk-admin.js, server.js
- Fixed: Employees UI script loads after removing duplicate const declarations, restoring loadEmployeesTable and QBO sync refresh behavior. Refs: public/js/employees.js, public/js/app.js
- Fixed: Kiosk admin UI script parses correctly; project dropdown and timesheet creation render. Refs: public/kiosk-admin.js, public/kiosk-admin.html
- Fixed: Kiosk admin nav buttons were unresponsive due to duplicate CSRF_TOKEN_KEY declaration between utils.js and kiosk-admin.js. Refs: public/kiosk-admin.js, public/js/utils.js
- Validated: Kiosk admin can create a timesheet and workers can clock in/out with correct button state (Clock Out shown for open punch). Refs: public/kiosk.js, public/kiosk-admin.js

### P2 - Data and business logic
- Fixed: Geofence validation is incomplete: lat/lng out of range and negative radius accepted. Refs: server.js:6720, public/js/projects.js
- Fixed: Clock-out geofence violations are not persisted into geo_violation, so time entry and kiosk admin views miss geofence flags. Refs: server.js:10147, server.js:10280, server.js:8941, public/kiosk-admin.js:7073
- Validated: Kiosk admin time entries no longer show closed punches as “in progress”; open-punches API only returns open punches. Refs: server.js:11290, public/kiosk-admin.js:7512
- Fixed: Punch-based time entries do not populate start_time/end_time, so time entries show “—” for clock in/out times. Refs: server.js:10898, server.js:17122, server.js:8859
- Validated: Rapid/double taps on kiosk Clock Out do not create duplicate punches/time entries. Refs: public/kiosk.js, server.js
- Fix applied: Kiosk punch safeguards added (intended-mode validation, server time for online punches, in-flight lock). Refs: public/kiosk.js, server.js
- Fixed: Payroll preflight blocks on unresolved exceptions (entry/punch/weekly hours) instead of silently filtering them out. Refs: server.js:3679, server.js:7605
- Fixed: Auth hardening gaps: added auth rate limits, session regeneration on login/org selection, and token-only CSRF without unauth token creation. Refs: lib/auth.js, server.js
- Fixed: Password policy inconsistent: reset enforces min length, bootstrap/change/create do not. Refs: server.js:1855, server.js:2324, server.js:2398, server.js:2554
- Fixed: bootstrap-admin.js inserts users.employee_id, but schema has no such column. Refs: bootstrap-admin.js, migrations/0001_foundations.sql
- Fixed: ensureNameOnChecksColumns runs before migrations, so fresh DBs can error/log until tables exist. Refs: server.js:1201, quickbooks.js:66
- Fixed: Session store uses separate SQLite DB (SESSION_DB_PATH) to reduce lock contention. Refs: server.js, lib/config.js
- Fixed: QuickBooks OAuth routes validate required envs; removed unused QBO_REALM_ID from config. Refs: server.js, lib/config.js, .env.example
- Validated: QuickBooks OAuth callback and live sync (sandbox). Sync counts: employees=4, vendors=31, projects=38, payroll accounts loaded (2 bank/49 expense). Refs: server.js, quickbooks.js
- Fixed: Notification config status is surfaced and APNs is explicitly flagged as unsupported. Refs: server.js, lib/config.js
- Validated: In-app, email (Google Workspace SMTP), and web-push delivery via Notifications test. Refs: server.js, .env
- Validated: Time entries PDF export returns application/pdf with attachment filename; PDF header is valid. Refs: server.js, public/js/app.js
- Fixed: Invalid upload types return 500 HTML (no multer error handler for JSON). Refs: lib/uploads.js, server.js:14555
- Intended: Kiosk employees API returns pin_hash for offline PIN validation (device-auth or kiosk-admin only). Refs: server.js:4970, rebuild/architecture/API_CONTRACTS_DETAILED.md
- Fixed: Kiosk offline punch button uses cached open status and shows offline messaging instead of always showing Clock In. Refs: public/kiosk.js

### P3 - Hygiene and docs
- Fixed: Repo tracked DBs/backups/uploads; .gitignore updated and tracked artifacts removed from git index. Refs: .gitignore, backups, secure_uploads, public/uploads
- Fixed: .env.example omits NODE_ENV and BOOTSTRAP_ADMIN_* settings. Refs: .env.example, bootstrap-admin.js
- Fixed: Retention envs (NOTIFICATION_RETENTION_DAYS, PHOTO_RETENTION_DAYS, AUDIT_LOG_RETENTION_DAYS, IDEMPOTENCY_RETENTION_DAYS) are missing from .env. Refs: .env, lib/config.js
- Fixed: Docs/config mismatch for env names (WEB_PUSH_* vs VAPID_*, UPLOADS_ROOT, ORG_DEFAULT_TIMEZONE). Refs: rebuild/architecture/ARCHITECTURE.md, lib/config.js
- Fixed: Node version pinned, bcryptjs removed, and DB_PATH resolved to absolute paths in config. Refs: package.json, .nvmrc, lib/config.js
- Fixed: Placeholder lint/test scripts added. Refs: package.json, README.md
- Validated: Static UI assets serve with 200 (auth/kiosk pages, core JS/CSS). Kiosk-admin routes redirect to /kiosk without device auth (expected). Refs: server.js, public/index.html, public/kiosk.html, public/kiosk-admin.html

### File uploads & storage
- Validated: Shipment "Edit" now opens the edit form and document uploads work (user-verified). Refs: public/js/shipments.js

## Testing gaps
- QuickBooks OAuth callback + live sync validated (sandbox).
- APNs delivery not validated (APNs unsupported).
- Offline kiosk queue/resync validated for worker punches and kiosk-admin time-entry review actions.
- Restore workflow validated in sandbox (DB + uploads).
- Kiosk punch double-click dedupe validated (rapid taps did not enqueue duplicate punches in follow-up validation).

## Recommendation (rebuild vs cleanup)
Cleanup is recommended. Core flows exist; the highest risks are access control, security hardening, environment/config, and a few logic gaps (geofence and payroll gating). Targeted fixes are likely lower risk and faster than a full rewrite.

## Test artifacts created (not cleaned)
- tmp-admin-perms-smoke.db
- tmp-admin-perms-smoke.log
- cookies-admin-3004.txt
- cookies-limited-3004.txt
- tmp-admin-cookies.txt
- tmp-qbo-smoke.db
- tmp-qbo-smoke.log
- cookies-qbo-admin.txt
- tmp-qbo-smoke-20260122135209.db
- tmp-qbo-smoke-20260122135209-sessions.db
- tmp-qbo-smoke-20260122135209.log
- tmp-qbo-smoke-20260122135209.pid
- tmp-qbo-bootstrap-20260122135209.json
- tmp-qbo-bootstrap-headers-20260122135209.txt
- tmp-qbo-auth-headers-20260122135209.txt
- tmp-qbo-oauth-state-20260122135209.txt
- cookies-qbo-admin-20260122135209.txt
- tmp-qbo-smoke-20260122135308.db
- tmp-qbo-smoke-20260122135308-sessions.db
- tmp-qbo-smoke-20260122135308.log
- tmp-qbo-smoke-20260122135308.pid
- tmp-qbo-bootstrap-20260122135308.json
- tmp-qbo-bootstrap-headers-20260122135308.txt
- tmp-qbo-auth-headers-20260122135308.txt
- tmp-qbo-oauth-state-20260122135308.txt
- cookies-qbo-admin-20260122135308.txt
- tmp-qbo-live-sync-login-20260123103645.json
- tmp-qbo-live-sync-login-headers-20260123103645.txt
- tmp-qbo-live-sync-cookies-20260123103645.txt
- tmp-qbo-live-sync-employees-20260123103645.json
- tmp-qbo-live-sync-vendors-20260123103645.json
- tmp-qbo-live-sync-projects-20260123103645.json
- tmp-qbo-live-sync-accounts-20260123103645.json
- tmp-qbo-live-sync-status-20260123103645.json
- cookies-qbo-limited.txt
- tmp-notify-smoke.db
- tmp-notify-smoke.log
- cookies-notify-admin.txt
- tmp-notify-smoke-20260122135440.db
- tmp-notify-smoke-20260122135440-sessions.db
- tmp-notify-smoke-20260122135440.log
- tmp-notify-smoke-20260122135440.pid
- tmp-notify-bootstrap-20260122135440.json
- tmp-notify-bootstrap-headers-20260122135440.txt
- tmp-notify-prefs-20260122135440.json
- tmp-notify-test-20260122135440.json
- cookies-notify-admin-20260122135440.txt
- tmp-uploads-smoke.db
- tmp-uploads-smoke.log
- cookies-uploads-admin.txt
- secure_uploads/shipments/logo-1769040394183-408037844.png
- secure_uploads/employee_ids/2-1769040430057-504807728.jpg
- tmp-pdf-smoke.db
- tmp-pdf-smoke.log
- cookies-pdf-admin.txt
- cookies-pdf-emp.txt
- tmp-pdf-smoke-20260123121343.db
- tmp-pdf-smoke-20260123121343-sessions.db
- tmp-pdf-smoke-20260123121343.log
- tmp-pdf-smoke-20260123121343.pid
- tmp-pdf-smoke-20260123121343-migrate.log
- tmp-pdf-smoke-20260123121343-bootstrap.log
- tmp-pdf-smoke-20260123121343-login.json
- tmp-pdf-smoke-20260123121343-login-status.txt
- tmp-pdf-smoke-20260123121343-headers.txt
- tmp-pdf-smoke-20260123121343-cookies.txt
- tmp-pdf-smoke-20260123121343.pdf
- tmp-static-smoke.db
- tmp-static-smoke.log
- tmp-static-smoke-20260123121754.db
- tmp-static-smoke-20260123121754-sessions.db
- tmp-static-smoke-20260123121754.log
- tmp-static-smoke-20260123121754.pid
- tmp-static-smoke-20260123121754-migrate.log
- tmp-static-smoke-20260123121754-bootstrap.log
- tmp-backup-smoke.db
- secure_uploads/backup-smoke/test.txt
- public/uploads/backup-smoke/test-public.txt
- backups/daily/2026-01-22/tmp-backup-smoke.db
- backups/daily/2026-01-22/secure_uploads
- backups/daily/2026-01-22/public_uploads
- tmp-backup-restore-smoke-20260123122214.db
- tmp-backup-restore-smoke-20260123122214-migrate.log
- tmp-backup-restore-smoke-20260123122214-bootstrap.log
- tmp-backup-restore-smoke-20260123122214-backup.log
- tmp-backup-restore-smoke-20260123122214-restore.log
- tmp-backup-restore-smoke-20260123122214-restore-20260123122341.log
- backups/daily/2026-01-23/tmp-backup-restore-smoke-20260123122214.db
- backups/daily/2026-01-23/secure_uploads
- backups/daily/2026-01-23/public_uploads
- tmp-restore-smoke-20260122134529.db
- backups/daily/2026-01-22/tmp-restore-smoke-20260122134529.db
- backups/tmp-restore-db-only-20260122134529
- tmp-geo-smoke.db
- tmp-geo-smoke.log
- tmp-geo-smoke.pid
- tmp-geo-bootstrap.json
- tmp-geo-headers.txt
- cookies-geo-admin.txt
- tmp-kiosk-smoke.db
- tmp-kiosk-smoke.log
- tmp-kiosk-smoke.pid
- tmp-kiosk-bootstrap.json
- tmp-kiosk-headers.txt
- tmp-kiosk-register.json
- tmp-kiosk-register-refresh.json
- tmp-kiosk-session.json
- tmp-kiosk-employees.json
- cookies-kiosk-admin.txt
- tmp-migrate-smoke.db
- tmp-payroll-smoke-1.db
