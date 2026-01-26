# AGENTS.md

Repo-specific guidance for automated changes and reviews. This file summarizes
constraints and rules from existing project docs. It is not exhaustive; when
unsure, check the source docs listed below.

## Primary References
- docs/REBUILD_SPEC.md (source of truth for behavior)
- docs/DECISIONS.md (resolved product decisions)
- docs/BUILD_PLAN.md (milestones + QA plan)
- rebuild/architecture/ARCHITECTURE.md (tech stack overview)
- rebuild/architecture/API_CONTRACTS.md and rebuild/architecture/API_CONTRACTS_DETAILED.md (endpoints + permissions)
- rebuild/architecture/DATA_MODEL.md and rebuild/architecture/SCHEMA.sql (schema)
- README.md (security notes)
- docs/CHANGE_LOG.md (record behavior changes)
- docs/OPEN_QUESTIONS.md (track unresolved items)

## Core Product Constraints (Non-Negotiables)
- Multi-tenant from day one: all data is scoped by org_id; only /api/auth/select-org accepts an explicit org_id.
- Offline-first kiosk for worker and kiosk admin flows; sync on reconnect.
- Kiosk enrollment is required; device_id is globally unique; kiosk endpoints require device_secret.
- PINs are per-employee, 4-digit numeric (legacy); store hashes only and never return raw PINs.
- Employees cannot self-register; only super admins can create accounts (bootstrap for first user).
- Server-side RBAC checks are required; UI gating is not sufficient.
- Shipments remain first-class; shipments board uses GET /api/shipments (no /api/shipments/board).
- QuickBooks flow is required: OAuth per org, manual Sync Now only, single-flight syncs, connect/disconnect by super admin.
- Payroll requires approvals before running; preflight is required before create checks; modify_payroll required for create/unpay.
- Geofence is advisory only (flag violations, do not block punches).
- No dev seed flow; testing uses production bootstrap flow.

## Security and Data Handling
- CSRF: state-changing session endpoints require X-CSRF-Token from a safe response header.
- Sessions and QBO tokens are encrypted at rest via SESSION_ENCRYPTION_KEY or SESSION_SECRET.
- Session cookies: httpOnly, sameSite strict in prod (lax in dev), secure in prod.
- Uploads and ID images live outside public root; allowlist PDF/images only.
- APNs key file must live outside the repo; configure via env.

## Key Domain Rules (see REBUILD_SPEC for details)
- Access toggles: desktop_access, kiosk_admin_access, worker_timekeeping.
- Permissions: see_shipments, modify_time, view_time_reports, view_payroll, modify_payroll, modify_pay_rates.
- Time edits: single-day constraints, valid HH:MM times, and notes required for manual edits/exception actions.
- Payroll: approvals reset on edits; preflight must block on missing QBO links; retries are manual.
- Shipments: payment documents hidden from users without view_payroll; storage location is per line item.
- Retention: photos 30 days; audit logs 1 year; notifications 90 days; idempotency keys 30 days; docs/ID images manual delete.
- Jobs: auto clock-out at org-local midnight with catch-up; job locks prevent concurrent runs.

## Configuration (Environment)
- Core: DB_PATH, APP_TIMEZONE, PORT, SESSION_SECRET, SESSION_ENCRYPTION_KEY.
- Cookies: COOKIE_SECURE, COOKIE_SAMESITE.
- QuickBooks: QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI, optional QBO_API_BASE, QBO_DEBUG.
- Notifications: SMTP_* for email, WEB_PUSH_* for push, APNS_* for mobile push.
- Retention: NOTIFICATION_RETENTION_DAYS, PHOTO_RETENTION_DAYS, AUDIT_LOG_RETENTION_DAYS, IDEMPOTENCY_RETENTION_DAYS.

## Data Model and Migrations
- SQLite is v1 store; schema should remain portable to Postgres.
- When changing schema, update migrations, rebuild/architecture/SCHEMA.sql,
  and rebuild/architecture/DATA_MODEL.md.
- Keep org_settings as the home for org config (payroll rules, exception rules, branding).

## API and Permissions
- Follow API_CONTRACTS for endpoints and permission gates.
- Session-based endpoints must enforce CSRF; kiosk endpoints use device auth (headers preferred for GETs).
- UI mode gating: desktop admins can be forced to kiosk mode on tablets unless explicitly set.

## Testing Expectations (Smoke/QA)
- Use docs/BUILD_PLAN.md Test Plan as the baseline for smoke tests.
- Validate offline kiosk queues, payroll preflight + checks, QBO sync/linking, and shipments docs visibility.
- Verify retention jobs (photo purge, audit/notification cleanup) when touching jobs or storage.

## Documentation Updates
- Update docs/DECISIONS.md when behavior/product decisions change.
- Update docs/CHANGE_LOG.md for user-facing changes.
- Add unresolved items to docs/OPEN_QUESTIONS.md.
