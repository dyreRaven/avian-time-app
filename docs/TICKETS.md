# Tickets
Generated: 2026-01-22

This file tracks the issues discovered in smoke testing. Each ticket lists priority, description, and acceptance criteria.

## P0 - Blockers (security and access)

### T-002 Upload security hardening
- Priority: P0
- Area: Uploads/Security
- Problem: Upload allowlist trusts client MIME/ext and files are served inline, enabling stored XSS via uploads.
- Status: Fixed (2026-01-22)
- Acceptance criteria:
  - Server-side content sniffing and strict type validation.
  - Uploaded files are served as attachments (not inline) unless explicitly safe.
  - Rejected files return structured JSON errors.
- Refs: lib/uploads.js, server.js:14540, server.js:14555

### T-003 Shipment payment docs gating
- Priority: P0
- Area: Shipments/Security
- Problem: Shipment payment documents are not gated by view_payroll.
- Status: Fixed (2026-01-22)
- Acceptance criteria:
  - view_payroll is required to list/download payment documents.
  - Non-payroll users receive 403 for payment docs; other doc categories still follow see_shipments.
- Refs: server.js:14457, docs/REBUILD_SPEC.md

### T-004 Kiosk admin GET device auth fails
- Priority: P0
- Area: Kiosk/Auth
- Problem: Kiosk device GET requests to admin endpoints fail because admin_id is read only from body, while kiosk admin client sends admin_id via query for GET.
- Status: Fixed (2026-01-22)
- Acceptance criteria:
  - Kiosk device GET endpoints accept admin_id from query and body.
  - Kiosk admin UI can fetch sessions/open punches with device auth.
- Refs: server.js:11807, server.js:10669, server.js:10728, public/kiosk-admin.js:253

### T-005 Production cookie settings are insecure
- Priority: P0
- Area: Security/Config
- Problem: .env sets COOKIE_SECURE=false and COOKIE_SAMESITE=lax while NODE_ENV=production.
- Status: Fixed (2026-01-22)
- Acceptance criteria:
  - Production config defaults to secure cookies (Secure + SameSite=Strict or explicit safe policy).
  - Documentation and .env.example reflect the intended production defaults.
- Refs: .env, server.js:60

### T-006 High-severity dependency vulnerabilities
- Priority: P0
- Area: Dependencies
- Problem: npm audit shows high-severity vulnerabilities in express/body-parser/qs and sqlite3/node-gyp/tar chain.
- Status: Accepted risk (build-time dependency chain) (2026-01-22). sqlite3/node-gyp/tar chain remains high severity (audit suggests downgrading sqlite3 to 5.0.2, which still leaves issues).
- Acceptance criteria:
  - Risk and mitigation documented (build-time chain; keep sqlite3 for now).
  - Re-evaluate when sqlite3/node-gyp/tar updates resolve the advisory or on driver migration.
- Refs: package.json, package-lock.json

## P1 - Reliability and offline

### T-007 PWA/offline caching broken
- Priority: P1
- Area: PWA/Offline
- Problem: Missing icons, service worker caches gated /kiosk-admin.html, and versioned asset mismatch cause cache.addAll failures.
- Status: Fixed (2026-01-22)
- Acceptance criteria:
  - Required icons exist and match manifest.
  - Service worker cache list excludes gated routes and matches versioned assets.
  - Offline kiosk mode loads reliably.
- Refs: public/service-worker.js, public/manifest.json, public/index.html, public/kiosk-admin.html

### T-008 Retention job scheduler overflow
- Priority: P1
- Area: Jobs/Retention
- Problem: setInterval with 30-day delay overflows, so jobs may not run.
- Status: Fixed (2026-01-22)
- Acceptance criteria:
  - Retention jobs scheduled with safe intervals or cron-like mechanism.
  - Logs confirm periodic execution.
- Refs: server.js:17400

### T-009 Restore tooling missing
- Priority: P1
- Area: Backup/Restore
- Problem: Backup exists but no restore script/tooling.
- Status: Implemented (2026-01-22), not yet validated.
- Acceptance criteria:
  - Provide a restore script and document its usage.
  - Restore tested against a backup artifact.
- Refs: docs/REBUILD_SPEC.md, docs/BUILD_PLAN.md

### T-010 Scripts do not load .env
- Priority: P1
- Area: Tooling/Config
- Problem: migrate/backup/bootstrap scripts do not load .env, causing missing config.
- Status: Fixed (2026-01-22)
- Acceptance criteria:
  - Scripts load .env or require explicit env inputs and validate required keys.
- Refs: scripts/migrate.js, scripts/backup-once.js, bootstrap-admin.js

### T-028 Kiosk offline storage gating
- Priority: P1
- Area: Kiosk/Offline
- Problem: Kiosk offline queue is disabled when IndexedDB is unavailable; localStorage fallback exists but offlineStorageSupported only checks IDB, blocking offline punches/PIN updates in those environments.
- Status: Fixed (2026-01-23)
- Acceptance criteria:
  - Offline support uses localStorage fallback when IndexedDB is unavailable.
  - Offline punches and PIN updates queue without IndexedDB (with clear warnings if storage is limited).
- Refs: public/kiosk.js, public/js/offline-store.js

### T-029 Notification recipient email override
- Priority: P2
- Area: Notifications
- Problem: Email notifications always send to the user login email. Non-superadmin users need a configurable notification email, while superadmins should always use their login email.
- Status: Fixed (2026-02-23)
- Acceptance criteria:
  - Add per-org notification email override (e.g., user_orgs.notification_email).
  - Super admins always receive emails at users.email.
  - Non-superadmins can set a notification email; fallback to users.email if unset.
  - Update UI to allow non-superadmins to set notification email.
- Refs: server.js, public/js/notifications.js, migrations

### T-030 Employees UI script fails to load
- Priority: P1
- Area: Admin UI/Employees
- Problem: employees.js has duplicate const declarations in setEmployeeInputsReadOnly, causing a syntax error and leaving loadEmployeesTable undefined; this breaks the Employees UI and surfaces errors after QBO sync.
- Status: Fixed (2026-01-23)
- Acceptance criteria:
  - Remove duplicate declarations; script loads without syntax errors.
  - Employees table loads; QBO sync refresh does not throw loadEmployeesTable undefined.
- Refs: public/js/employees.js, public/js/app.js

### T-033 Kiosk admin UI script fails to parse
- Priority: P1
- Area: Kiosk/Admin UI
- Problem: public/kiosk-admin.js contains an invalid regex literal (`/application\\/json/i`), causing a syntax error; kiosk admin UI scripts stop executing, so the project dropdown and timesheet creation never render.
- Status: Fixed (2026-01-23)
- Acceptance criteria:
  - Fix regex so kiosk-admin.js parses without errors.
  - Kiosk admin page shows project dropdown and allows starting a timesheet.
  - No console syntax errors on kiosk admin load.
- Refs: public/kiosk-admin.js:323, public/kiosk-admin.html

### T-035 Kiosk admin nav buttons unresponsive
- Priority: P1
- Area: Kiosk/Admin UI
- Problem: kiosk-admin.js redeclares CSRF_TOKEN_KEY while public/js/utils.js already declares it, causing a global `Identifier has already been declared` error and preventing kiosk-admin initialization (navbar buttons do nothing).
- Status: Fixed (2026-01-23)
- Acceptance criteria:
  - Remove duplicate global const so kiosk-admin initializes normally.
  - Navbar buttons switch views without console errors.
- Refs: public/kiosk-admin.js, public/js/utils.js, public/kiosk-admin.html

## P2 - Data and business logic

### T-011 Geofence validation ranges
- Priority: P2
- Area: Projects/Geofencing
- Problem: lat/lng out of range and negative radius are accepted.
- Status: Fixed (2026-01-22)
- Acceptance criteria:
  - Validate lat [-90, 90], lng [-180, 180], radius >= 0.
  - Reject invalid values with clear errors.
- Refs: server.js:6720, public/js/projects.js

### T-012 Geofence clock-out violation not persisted
- Priority: P2
- Area: Kiosk/Geofencing
- Problem: Clock-out geofence violation is not persisted in geo_violation, so time entry flags are missing.
- Status: Fixed (2026-01-22)
- Acceptance criteria:
  - Clock-out geofence violations set a persisted flag that feeds time-entry and kiosk admin views.
- Refs: server.js:10147, server.js:10280, server.js:8941, public/kiosk-admin.js:7073

### T-034 Kiosk offline punch button does not reflect open session
- Priority: P2
- Area: Kiosk/Offline UX
- Problem: When offline, the kiosk punch button always shows "Clock In" and does not indicate an employee's open punch. Selecting a worker with an open session doesn't show "Clock Out," which is confusing (even though the queued punch later closes the session).
- Status: Fixed (2026-01-23)
- Acceptance criteria:
  - Offline mode shows an explicit "Offline — will queue punch" state or last-known punch state.
  - If an open punch is known/cached, show "Clock Out" even while offline.
  - Avoid showing a misleading "Clock In" label for employees already clocked in.
- Refs: public/kiosk.js

### T-013 Payroll preflight hides unresolved exceptions
- Priority: P2
- Area: Payroll
- Problem: Preflight hides unresolved exceptions instead of blocking payroll creation.
- Status: Fixed (2026-01-22)
- Acceptance criteria:
  - Preflight blocks if any unresolved exceptions exist within the range (per spec).
- Refs: quickbooks.js:1500, server.js:3679

### T-042 Timesheet deletion requires empty entries
- Priority: P2
- Area: Timekeeping/Timesheets
- Problem: Timesheets can be deleted even when they contain entries, risking loss of time data.
- Status: Open
- Acceptance criteria:
  - Server blocks deletion when a timesheet has any entries.
  - UI prevents deletion or surfaces a clear error when blocked.

### T-014 Auth hardening gaps
- Priority: P2
- Area: Auth/Security
- Problem: No rate limiting, no session regeneration, CSRF allows Origin/Referer fallback and creates session token for unauth requests.
- Status: Fixed (2026-01-22)
- Acceptance criteria:
  - Rate limiting for auth endpoints.
  - Session ID rotated on login/privilege changes.
  - CSRF requires token for unsafe requests and does not create tokens for unauth sessions.
- Refs: lib/auth.js, server.js

### T-015 Password policy inconsistent
- Priority: P2
- Area: Auth
- Problem: Reset enforces min length but bootstrap/change/create do not.
- Status: Fixed (2026-01-22)
- Acceptance criteria:
  - Single password policy enforced across bootstrap, create, change, and reset.
- Refs: server.js:1855, server.js:2324, server.js:2398, server.js:2554

### T-016 bootstrap-admin.js schema mismatch
- Priority: P2
- Area: Tooling/Bootstrap
- Problem: bootstrap-admin.js inserts users.employee_id but schema has no such column.
- Status: Fixed (2026-01-22)
- Acceptance criteria:
  - Script inserts only valid columns and/or schema updated intentionally.
- Refs: bootstrap-admin.js, migrations/0001_foundations.sql

### T-017 ensureNameOnChecksColumns runs before migrations
- Priority: P2
- Area: Startup/Migrations
- Problem: ensureNameOnChecksColumns runs before migrations, logging errors on fresh DBs.
- Status: Fixed (2026-01-22)
- Acceptance criteria:
  - Ensure schema exists before running this helper, or defer to migrations.
- Refs: server.js:1201, quickbooks.js:66

### T-018 Session store shares main DB
- Priority: P2
- Area: Persistence
- Problem: Session store uses same SQLite DB as app data, increasing lock contention.
- Status: Fixed (2026-01-22)
- Acceptance criteria:
  - Sessions are stored in a separate SQLite DB or a more robust store.
- Refs: server.js, session-store.js

### T-019 QBO env validation and unused realm
- Priority: P2
- Area: QuickBooks
- Problem: QBO env validation is weak and QBO_REALM_ID is unused.
- Status: Fixed (2026-01-22)
- Acceptance criteria:
  - Validate required QBO envs for OAuth routes.
  - Remove or implement QBO_REALM_ID consistently.
- Refs: server.js, lib/config.js, .env.example

### T-020 Notifications configuration and APNs
- Priority: P2
- Area: Notifications
- Problem: SMTP/VAPID are unset and APNs sender is not implemented.
- Status: Fixed (2026-01-22)
- Acceptance criteria:
  - Config validation surfaces missing values.
  - APNs path implemented or explicitly removed/flagged as unsupported.
- Refs: server.js, lib/config.js

### T-021 Upload error handling
- Priority: P2
- Area: Uploads
- Problem: Invalid file types return 500 HTML rather than JSON.
- Status: Fixed (2026-01-22)
- Acceptance criteria:
  - Multer errors return structured JSON with 4xx codes.
- Refs: lib/uploads.js, server.js:14555

### T-022 Kiosk employees API exposes pin_hash
- Priority: P2
- Area: Kiosk/Security
- Problem: /api/kiosk/employees returns pin_hash to clients for offline PIN validation (per API contracts).
- Status: Accepted (required for offline kiosk mode).
- Acceptance criteria:
  - Device-auth or kiosk-admin access only; raw PINs never returned.
  - Documented in API contracts for offline validation.
- Refs: server.js:4970, rebuild/architecture/API_CONTRACTS_DETAILED.md

## P3 - Hygiene and docs

### T-023 Repo tracks DBs/backups/uploads
- Priority: P3
- Area: Repo Hygiene
- Problem: DBs/backups/uploads are tracked in git, risking leakage and bloat.
- Status: Fixed (2026-01-22). .gitignore updated; tracked artifacts removed from index.
- Acceptance criteria:
  - Update .gitignore; remove tracked artifacts after approval.
- Refs: .gitignore, backups, secure_uploads, public/uploads

### T-024 .env.example missing keys
- Priority: P3
- Area: Docs/Config
- Problem: .env.example omits NODE_ENV and BOOTSTRAP_ADMIN_*.
- Status: Fixed (2026-01-22)
- Acceptance criteria:
  - .env.example includes required keys with safe defaults.
- Refs: .env.example, bootstrap-admin.js

### T-025 Retention envs missing from .env
- Priority: P3
- Area: Config
- Problem: Retention envs are missing from .env.
- Status: Fixed (2026-01-22)
- Acceptance criteria:
  - Document and provide defaults for retention envs.
- Refs: .env, lib/config.js

### T-026 Docs/config env mismatch
- Priority: P3
- Area: Docs
- Problem: ARCHITECTURE.md lists env names not used in code.
- Status: Fixed (2026-01-22)
- Acceptance criteria:
  - Docs updated to match actual config keys.
- Refs: rebuild/architecture/ARCHITECTURE.md, lib/config.js

### T-027 Node version unpinned and unused deps
- Priority: P3
- Area: Tooling
- Problem: Node version is unpinned; bcryptjs is unused.
- Status: Fixed (2026-01-22)
- Acceptance criteria:
  - Pin Node version (e.g., .nvmrc/engines).
  - Remove unused deps.
- Refs: package.json, lib/config.js, server.js

### T-028 No lint/test scripts
- Priority: P3
- Area: Tooling
- Problem: No lint/test scripts defined.
- Status: Fixed (2026-01-22)
- Acceptance criteria:
  - Add minimal lint/test scripts or placeholders with documented usage.
- Refs: package.json

## Test gap tasks

### T-029 QuickBooks OAuth + live sync validation
- Priority: P3
- Area: Testing
- Problem: OAuth flow and live sync were not exercised.
- Acceptance criteria:
  - Execute OAuth connect, sync customers/projects/employees in a non-prod org.
  - Verify disconnect and reconnect behaviors.

### T-030 Email/web-push/APNs delivery validation
- Priority: P3
- Area: Testing
- Problem: Delivery for email/web-push/APNs not validated.
- Status: Validated for email + web-push (APNs unsupported) (2026-01-23)
- Acceptance criteria:
  - Send a test email and a test push with configured credentials.
  - Document results and any provider constraints.

### T-031 Offline kiosk queue/resync validation
- Priority: P3
- Area: Testing
- Problem: Offline kiosk queue and resync not fully exercised.
- Status: Validated (worker punches + kiosk-admin time-entry reviews) (2026-01-23)
- Acceptance criteria:
  - Simulate offline punches for worker kiosk and verify successful resync.
  - Simulate offline queues for kiosk-admin flows once admin UI loads.

### T-032 Restore workflow validation
- Priority: P3
- Area: Testing
- Problem: Restore workflow not tested because tooling is missing.
- Status: Validated in sandbox (DB + uploads) (2026-01-23)
- Acceptance criteria:
  - Restore script available and used to restore a backup into a clean DB.

### T-036 Kiosk punch double-click dedupe validation
- Priority: P3
- Area: Testing
- Problem: Double-clicking Clock Out (or rapid taps) may enqueue duplicate punches; behavior not validated.
- Status: Validated (2026-01-23)
- Acceptance criteria:
  - Rapid repeated taps on Clock Out only create one queued action and one punch record after sync.
  - UI prevents accidental double-submit or server de-dupes by idempotency.

### T-037 Kiosk admin shows closed punches as “in progress”
- Priority: P2
- Area: Kiosk admin
- Problem: `/api/kiosks/:id/open-punches` returns all punches for today (including closed), and kiosk-admin renders them as “in progress” rows.
- Status: Validated (2026-01-23)
- Acceptance criteria:
  - Open punches API (or client merge) only includes punches with `clock_out_ts` NULL.
  - Time entries view does not show duplicate “in progress” rows for closed punches.

### T-038 Punch-based time entries missing start/end times
- Priority: P2
- Area: Time entries
- Problem: Time entries created from kiosk punches omit start_time/end_time, so time entry tables show “—” for clock in/out times.
- Status: Validated (2026-01-23)
- Acceptance criteria:
  - Clock-out and auto clock-out create time_entries with start_time/end_time populated.
  - Exception review sync updates/creates time_entries with start_time/end_time.

### T-039 Overlapping punches detection
- Priority: P3
- Area: Timekeeping
- Problem: Overlapping punches for the same employee are not explicitly flagged.
- Status: Open
- Acceptance criteria:
  - Detect and flag overlapping punch windows for the same employee.
  - Surface in time exceptions or admin review UI.

### T-040 Offline punch max-age policy
- Priority: P3
- Area: Timekeeping
- Problem: Very old offline punches can sync without a max-age guard.
- Status: Open
- Acceptance criteria:
  - Define and enforce a max offline age (reject or flag).
  - Provide a clear admin-visible error or exception.

### T-041 Punch rate limiting
- Priority: P3
- Area: Timekeeping
- Problem: No throttling for excessive punch attempts per device/employee.
- Status: Open
- Acceptance criteria:
  - Add a soft rate limit for punch attempts to prevent spam/accidents.

## Notes/Decisions (no action)

### N-001 Super admin logins only
- Decision: Email/password logins are for super admins only; all other roles use PIN on kiosk devices.
