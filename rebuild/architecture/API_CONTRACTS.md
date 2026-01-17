# API Contracts (v1)

## Conventions
- All responses are JSON unless file download.
- Auth via session cookie; kiosk endpoints accept device_id + device_secret.
- Each endpoint is scoped to org_id from the session or kiosk device; only `/api/auth/select-org` accepts an explicit org id.
- Permissions required are listed in brackets.
- CSRF applies to session-backed state-changing requests; cross-origin clients must send `X-CSRF-Token` from a safe response header.

## Auth and Accounts
- POST `/api/auth/bootstrap` (if no users exist)
- POST `/api/auth/login`
- POST `/api/auth/logout`
- GET  `/api/auth/me`
- GET  `/api/auth/orgs`
- POST `/api/auth/select-org`
- POST `/api/auth/change-password`
- POST `/api/auth/users` [super admin] (create user)

## QuickBooks
- GET  `/api/status`
- Note: /api/status returns lastSync timestamps for employees/vendors/projects/payroll_accounts.
- GET  `/auth/qbo` [view_payroll + super admin]
- GET  `/quickbooks/oauth/callback` [public callback]
- POST `/api/qbo/disconnect` [view_payroll + super admin]
- POST `/api/sync/employees` [view_payroll]
- POST `/api/sync/vendors` [view_payroll]
- POST `/api/sync/projects` [view_payroll]
- POST `/api/sync/payroll-accounts` [view_payroll]
- Note: sync endpoints return synced_at timestamps.

## Employees
- GET  `/api/employees?status=active|inactive|pending` [view_payroll]
- POST `/api/employees` [view_payroll]
- POST `/api/employees/:id/active` [view_payroll]
- POST `/api/employees/:id/pin` [view_payroll or kiosk device]
- POST `/api/employees/:id/language` [kiosk device]
- POST `/api/employees/:id/name-on-checks` [view_payroll or kiosk device]
- DELETE `/api/employees/:id/id-document` [view_payroll]
- POST `/api/employees/:id/link-qbo` [view_payroll]
- POST `/api/employees/:id/qbo-create` [view_payroll]
- POST `/api/employees/:id/unlink-qbo` [view_payroll]
- GET  `/api/kiosk/employees` [kiosk]
- POST `/api/kiosk/employees` [kiosk admin]

## Permissions and Settings
- GET  `/api/settings` [view_payroll]
- POST `/api/settings` [view_payroll]
- GET  `/api/kiosk/settings` [kiosk]

## Vendors
- GET  `/api/vendors?status=active|inactive` [view_payroll]
- POST `/api/vendors/:id` [view_payroll]
- POST `/api/vendors/:id/pin` [view_payroll]

## Projects
- GET  `/api/projects?status=active|inactive` [view_payroll]
- POST `/api/projects` [view_payroll]
- GET  `/api/kiosk/projects` [kiosk]

## Kiosks
- Note: Timesheets are stored as kiosk_sessions; endpoints keep the `/kiosk-sessions` naming.
- GET  `/api/kiosks` [view_payroll]
- POST `/api/kiosks` [view_payroll]
- POST `/api/kiosks/register` [enrollment code]
- GET  `/api/kiosks/:id/sessions` [view_payroll]
- POST `/api/kiosks/:id/sessions` [kiosk admin] (supports `clock_me_in`)
- DELETE `/api/kiosks/:id/sessions/:sessionId` [kiosk admin]
- POST `/api/kiosks/:id/active-session` [kiosk admin] (sets active session for new punches only)
- GET  `/api/kiosk-sessions/today` [view_payroll]
- GET  `/api/kiosks/:id/foreman-today` [kiosk admin]
- POST `/api/kiosks/:id/foreman-today` [kiosk admin]
- GET  `/api/kiosk/open-punch` [kiosk]
- GET  `/api/kiosks/:id/open-punches` [kiosk admin]

## Kiosk Rate Unlock
- POST `/api/kiosk/rates/unlock` [modify_pay_rates]
- GET  `/api/kiosk/rates` [modify_pay_rates]
- POST `/api/kiosk/rates/:id` [modify_pay_rates]

## Timekeeping
- POST `/api/kiosk/punch` [kiosk]
- GET  `/api/time-punches/open` [view_time_reports or view_payroll]
- GET  `/api/time-entries` [view_time_reports or view_payroll]
- POST `/api/time-entries` [modify_time]
- POST `/api/time-entries/:id` [modify_time]
- POST `/api/time-entries/:id/verify` [modify_time]
- POST `/api/time-entries/:id/resolve` [modify_time]
- GET  `/api/time-entries/export/:format` [view_time_reports or view_payroll]
- GET  `/api/time-exceptions` [view_time_reports or view_payroll]
- POST `/api/time-exceptions/:id/review` [modify_time]
- POST `/api/time-exceptions/:id/resolve` [modify_time]
- GET  `/api/kiosk/time-entries` [kiosk admin + modify_time]

## Payroll
- GET  `/api/payroll/account-options` [view_payroll]
- GET  `/api/payroll/classes` [view_payroll]
- GET  `/api/payroll/settings` [view_payroll]
- POST `/api/payroll/settings` [view_payroll]
- GET  `/api/payroll-summary` [view_payroll]
- GET  `/api/payroll/time-entries` [view_payroll]
- POST `/api/payroll/preflight-checks` [modify_payroll]
- POST `/api/payroll/preview-checks` [modify_payroll, deprecated]
- POST `/api/payroll/create-checks` [modify_payroll]
- POST `/api/payroll/unpay` [modify_payroll]
- GET  `/api/payroll/audit-log` [view_payroll]

## Shipments
- GET  `/api/shipments` [see_shipments]
- GET  `/api/shipments/:id` [see_shipments]
- POST `/api/shipments` [see_shipments]
- PUT  `/api/shipments/:id` [see_shipments]
- DELETE `/api/shipments/:id` [see_shipments]
- POST `/api/shipments/:id/status` [see_shipments]
- POST `/api/shipments/:id/storage` [see_shipments]
- GET  `/api/shipments/:id/payments` [see_shipments]
- POST `/api/shipments/:id/payments` [see_shipments]
- GET  `/api/shipments/:id/timeline` [see_shipments]
- GET  `/api/shipments/:id/comments` [see_shipments]
- POST `/api/shipments/:id/comments` [see_shipments]
- DELETE `/api/shipments/:id/comments/:commentId` [see_shipments]
- GET  `/api/shipments/:id/documents` [see_shipments]
- POST `/api/shipments/:id/documents` [see_shipments]
- DELETE `/api/shipments/:id/documents/:docId` [see_shipments]
- GET  `/api/shipments/documents/:docId/download` [see_shipments]
- POST `/api/shipments/:id/verify-items` [see_shipments]
- GET  `/api/shipments/templates` [see_shipments]
- POST `/api/shipments/templates` [see_shipments]
- PUT  `/api/shipments/templates/:id` [see_shipments]
- DELETE `/api/shipments/templates/:id` [see_shipments]

## Shipment Notifications
- GET  `/api/shipments/notifications` [see_shipments]
- PUT  `/api/shipments/notifications` [see_shipments]

## Reports
- GET  `/api/reports/payroll-runs` [view_payroll]
- GET  `/api/reports/payroll-runs/:id` [view_payroll]
- PATCH `/api/reports/checks/:id` [modify_payroll]
- GET  `/api/reports/payroll-audit` [view_payroll]
- GET  `/api/reports/payroll-audit-log` [view_payroll]
- GET  `/api/reports/shipment-verification` [see_shipments]

## Notifications (In-App)
- GET  `/api/notifications` [auth]
- POST `/api/notifications/mark-read` [auth]
- POST `/api/notifications/test` [auth]
- GET  `/api/notifications/prefs` [auth]
- PUT  `/api/notifications/prefs` [auth]
- POST `/api/notifications/push/subscribe` [auth]
- POST `/api/notifications/push/unsubscribe` [auth]
