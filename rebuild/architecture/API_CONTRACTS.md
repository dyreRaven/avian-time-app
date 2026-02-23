# API Contracts (v1)

## Conventions
- All responses are JSON unless file download.
- Auth via session cookie; kiosk endpoints accept device_id + device_secret.
- Each endpoint is scoped to org_id from the session or kiosk device; only `/api/auth/select-org` accepts an explicit org id.
- Permissions required are listed in brackets.
- CSRF applies to session-backed state-changing requests; cross-origin clients must send `X-CSRF-Token` from a safe response header.

## Auth and Accounts
- POST `/api/auth/bootstrap-signup` (first admin signup if no orgs exist)
- POST `/api/auth/bootstrap` (org setup after signup if no orgs exist)
- POST `/api/auth/login`
- POST `/api/auth/logout`
- GET  `/api/auth/me`
- GET  `/api/auth/orgs`
- POST `/api/auth/select-org`
- POST `/api/auth/ui-mode`
- POST `/api/auth/change-password`
- POST `/api/auth/change-email`
- GET  `/api/auth/password-setup` (public setup link validation)
- POST `/api/auth/password-setup` (public setup link completion)
- GET  `/api/kiosk/admin/account` [kiosk admin]
- POST `/api/kiosk/admin/account/email` [kiosk admin]
- POST `/api/kiosk/admin/account/password` [kiosk admin]
- GET  `/api/auth/users` [super admin]
- POST `/api/auth/users` [super admin] (create user / send setup link)
- POST `/api/auth/users/:id/reset-password` [super admin]
- POST `/api/auth/users/:id/disable` [super admin]
- POST `/api/auth/users/:id/enable` [super admin]

## QuickBooks
- GET  `/api/status`
- Note: /api/status returns lastSync timestamps for employees/vendors/projects/payroll_accounts/employee_updates.
- POST `/api/qbo/connect` [super admin]
- GET  `/quickbooks/oauth/callback` [public callback]
- POST `/api/qbo/disconnect` [super admin]
- POST `/api/sync/employees` [view_payroll]
- POST `/api/sync/vendors` [view_payroll]
- POST `/api/sync/projects` [view_payroll]
- POST `/api/sync/payroll-accounts` [view_payroll]
- POST `/api/sync/qbo-employee-updates` [view_payroll + super admin]
- Note: sync endpoints return synced_at timestamps.

## Employees
- GET  `/api/employees?status=active|inactive|pending` [view_payroll]
- POST `/api/employees` [view_payroll]
- POST `/api/employees/:id/active` [view_payroll]
- POST `/api/employees/:id/pin` [view_payroll or kiosk device]
- POST `/api/employees/:id/language` [kiosk device]
- POST `/api/employees/:id/name` [kiosk device]
- POST `/api/employees/:id/phone` [kiosk device]
- POST `/api/employees/:id/worker-timekeeping` [kiosk device]
- POST `/api/employees/:id/employment-dates` [kiosk device]
- POST `/api/employees/:id/reactivate` [kiosk device]
- POST `/api/employees/:id/name-on-checks` [view_payroll or kiosk device]
- GET  `/api/employees/:id/id-document` [view_payroll]
- DELETE `/api/employees/:id/id-document` [view_payroll]
- GET  `/api/employees/:id/photo` [view_payroll]
- DELETE `/api/employees/:id/photo` [view_payroll]
- POST `/api/employees/:id/link-qbo` [view_payroll + super admin]
- POST `/api/employees/:id/qbo-create` [view_payroll + super admin]
- POST `/api/employees/:id/unlink-qbo` [view_payroll + super admin]
- GET  `/api/kiosk/employees` [kiosk]
- GET  `/api/kiosk/admin/employees` [kiosk admin]
- POST `/api/kiosk/employees` [kiosk admin]
- GET  `/api/kiosk/admin/employees/:id/documents` [kiosk admin]
- POST `/api/kiosk/admin/employees/:id/documents` [kiosk admin]
- GET  `/api/kiosk/admin/employees/:id/employment-history` [kiosk admin]
- GET  `/api/kiosk/admin/employees/documents/:docId/download` [kiosk admin]
- GET  `/api/kiosk/admin/employees/:id/photo` [kiosk admin]
- POST `/api/kiosk/admin/employees/:id/photo` [kiosk admin]
- DELETE `/api/kiosk/admin/employees/:id/photo` [kiosk admin]
- GET  `/api/kiosk/admin/employees/:id/id-document` [kiosk admin]
- POST `/api/kiosk/admin/employees/:id/id-document` [kiosk admin]

## Permissions and Settings
- GET  `/api/permission-templates` [super admin]
- POST `/api/permission-templates` [super admin]
- PUT  `/api/permission-templates/:id` [super admin]
- DELETE `/api/permission-templates/:id` [super admin]
- GET  `/api/settings` [view_payroll]
- POST `/api/settings` [view_payroll]
- GET  `/api/kiosk/settings` [kiosk]

## Vendors
- GET  `/api/vendors?status=active|inactive` [view_payroll or see_shipments]
- POST `/api/vendors/:id` [view_payroll]
- POST `/api/vendors/:id/pin` [view_payroll]

## Projects
- GET  `/api/projects?status=active|inactive` [view_payroll or see_shipments]
- POST `/api/projects` [view_payroll]
- GET  `/api/kiosk/projects` [kiosk]

## Kiosks
- Note: Timesheets are stored as kiosk_sessions; endpoints keep the `/kiosk-sessions` naming.
- GET  `/api/kiosks/enrollment-code` [super admin]
- POST `/api/kiosks/enrollment-code/rotate` [super admin]
- GET  `/api/kiosks/registry` [super admin]
- GET  `/api/kiosks` [view_payroll]
- POST `/api/kiosks` [view_payroll]
- POST `/api/kiosks/register` [enrollment code]
- GET  `/api/kiosks/:id/sessions` [view_payroll]
- POST `/api/kiosks/:id/sessions` [kiosk admin] (supports `clock_me_in`)
- DELETE `/api/kiosks/:id/sessions/:sessionId` [kiosk admin]
- POST `/api/kiosks/:id/active-session` [kiosk admin] (sets active session for new punches only)
- GET  `/api/kiosk-sessions/today?date=YYYY-MM-DD` [view_payroll]
- GET  `/api/kiosk-sessions/assignees` [assign_timesheets or super admin]
- GET  `/api/kiosk-sessions/shareable-admins` [super admin]
- GET  `/api/kiosks/:id/foreman-today` [kiosk admin]
- POST `/api/kiosks/:id/foreman-today` [kiosk admin]
- GET  `/api/kiosk/open-punch` [kiosk]
- GET  `/api/kiosks/:id/open-punches` [kiosk admin]
- POST `/api/kiosk/admin/verify-pin` [kiosk admin]
- POST `/api/kiosk-sessions/:id/share` [super admin]
- POST `/api/kiosk-sessions/:id/assign` [assign_timesheets or super admin]
- POST `/api/kiosk-sessions/:id/close` [kiosk admin]

## Kiosk Rate Unlock
- POST `/api/kiosk/rates/unlock` [kiosk admin + modify_pay_rates]
- GET  `/api/kiosk/rates` [kiosk admin + modify_pay_rates]
- POST `/api/kiosk/rates/:id` [kiosk admin + modify_pay_rates]

## Timekeeping
- POST `/api/kiosk/punch` [kiosk]
- GET  `/api/time-punches/open` [view_time_reports or view_payroll]
- GET  `/api/time-entries` [view_time_reports or view_payroll]
- GET  `/api/time-entries/pending-count` [view_time_reports or view_payroll]
- GET  `/api/time-entries/pending` [view_time_reports or view_payroll]
- POST `/api/time-entries` [modify_time]
- POST `/api/time-entries/:id` [modify_time]
- POST `/api/time-entries/:id/verify` [modify_time]
- POST `/api/time-entries/:id/resolve` [modify_time]
- POST `/api/time-entries/:id/send-back` [modify_time]
- POST `/api/time-entries/:id/approve` [modify_time + approve_time]
- POST `/api/time-entries/approve` [modify_time + approve_time]
- GET  `/api/time-entries/export/:format` [view_time_reports or view_payroll]
- GET  `/api/time-exceptions` [view_time_reports or view_payroll]
- POST `/api/time-exceptions/:id/review` [modify_time]
- POST `/api/time-exceptions/:id/resolve` [modify_time]
- GET  `/api/kiosk/time-entries` [kiosk admin + view_time_reports or view_payroll]
- GET  `/api/kiosk/time-entries/pending-count` [kiosk admin + view_time_reports or view_payroll]
- GET  `/api/kiosk/time-entries/pending` [kiosk admin + view_time_reports or view_payroll]

## Payroll
- GET  `/api/payroll/account-options` [super admin]
- GET  `/api/payroll/classes` [super admin]
- GET  `/api/payroll/settings` [super admin]
- POST `/api/payroll/settings` [super admin]
- GET  `/api/payroll/reimbursements` [super admin]
- POST `/api/payroll/reimbursements` [super admin]
- POST `/api/payroll/reimbursements/:id/approve` [super admin]
- GET  `/api/payroll/reimbursements/:id/receipt` [super admin]
- GET  `/api/payroll-summary` [super admin]
- GET  `/api/payroll/time-entries` [super admin]
- POST `/api/payroll/preflight-checks` [super admin]
- POST `/api/payroll/preview-checks` [super admin, deprecated]
- POST `/api/payroll/create-checks` [super admin]
- POST `/api/payroll/unpay` [super admin]
- GET  `/api/payroll/audit-log` [super admin]

## Shipments
- GET  `/api/shipments` [see_shipments]
- GET  `/api/shipments/:id` [see_shipments]
- POST `/api/shipments` [see_shipments]
- PUT  `/api/shipments/:id` [see_shipments]
- DELETE `/api/shipments/:id` [see_shipments]
- POST `/api/shipments/:id/status` [see_shipments]
- POST `/api/shipments/:id/storage` [see_shipments]
- POST `/api/shipments/:id/notes` [see_shipments]
- GET  `/api/shipments/:id/personal-note` [see_shipments]
- PUT  `/api/shipments/:id/personal-note` [see_shipments]
- DELETE `/api/shipments/:id/personal-note` [see_shipments]
- GET  `/api/shipments/:id/payments` [view_payroll]
- POST `/api/shipments/:id/payments` [view_payroll]
- GET  `/api/shipments/:id/timeline` [see_shipments]
- GET  `/api/shipments/:id/comment-threads` [see_shipments]
- POST `/api/shipments/:id/comment-threads` [see_shipments]
- PATCH `/api/shipments/:id/comment-threads/:threadId` [see_shipments]
- GET  `/api/shipments/:id/comments` [see_shipments]
- POST `/api/shipments/:id/comments` [see_shipments]
- DELETE `/api/shipments/:id/comments/:commentId` [see_shipments]
- GET  `/api/shipments/:id/documents` [see_shipments]
- POST `/api/shipments/:id/documents` [see_shipments]
- PUT  `/api/shipments/:id/documents/:docId` [see_shipments]
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
- GET  `/api/reports/payroll-runs` [super admin]
- GET  `/api/reports/payroll-runs/:id` [super admin]
- PATCH `/api/reports/checks/:id` [super admin]
- GET  `/api/reports/payroll-audit` [super admin]
- GET  `/api/reports/payroll-audit-log` [super admin]
- GET  `/api/reports/time-entry-audit` [view_time_reports or view_payroll]
- GET  `/api/reports/audit-log` [admin; domain-specific perms]
- GET  `/api/reports/shipment-verification` [see_shipments]

## Notifications (In-App)
- GET  `/api/notifications` [auth]
- POST `/api/notifications/mark-read` [auth]
- POST `/api/notifications/test` [auth]
- GET  `/api/notifications/prefs` [auth]
- PUT  `/api/notifications/prefs` [auth]
- POST `/api/notifications/push/subscribe` [auth]
- POST `/api/notifications/push/unsubscribe` [auth]
