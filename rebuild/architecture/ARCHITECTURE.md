# Rebuild Architecture Overview

## Intent
This folder defines the technical architecture for the rebuild. It complements `docs/REBUILD_SPEC.md`.

## Assumptions (initial)
- Backend: Node.js + Express.
- Database: SQLite for v1 with org_id scoping; schema kept portable for future Postgres.
- Frontend: static HTML/CSS/JS for Admin Console, Kiosk Worker, and Kiosk Admin.
- PWA + service worker for offline support and Web Push.

## Applications
- Admin Console (`/`): desktop admin UI.
- Kiosk Worker (`/kiosk`): clock in/out for workers.
- Kiosk Admin (`/kiosk-admin`): on-device admin tools.
- Service Worker: asset cache, offline queue, push notifications.

## Backend Services
- API server (REST JSON).
- QuickBooks integration (OAuth + sync + payroll checks).
- Notification service (in-app + Web Push + email).
- Scheduler jobs (auto clock-out, photo purge, QBO retry queue, backups).

## Deployment Notes
- Single server process initially; background jobs run in-process.
- Optional split later into API + worker processes.

## Configuration (env)
- `DB_PATH`, `APP_TIMEZONE`, `PORT`
- `SESSION_SECRET`, `SESSION_ENCRYPTION_KEY`, `COOKIE_SECURE`, `COOKIE_SAMESITE`
- `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI` (realm_id stored per org after OAuth)
- `QBO_API_BASE` (optional; defaults to production), `QBO_DEBUG` (optional QBO logging)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- `APNS_KEY_PATH`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`
- `NOTIFICATION_RETENTION_DAYS`, `PHOTO_RETENTION_DAYS`, `AUDIT_LOG_RETENTION_DAYS`, `IDEMPOTENCY_RETENTION_DAYS`
- `ENABLE_IN_PROCESS_BACKUPS`
