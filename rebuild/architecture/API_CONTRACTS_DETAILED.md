# API Contracts (Detailed)

## Conventions
- JSON request/response unless file download.
- `org_id` derived from session or kiosk device; only `/api/auth/select-org` accepts an explicit org id.
- Errors: `{ "error": "message" }` with HTTP status.
- Timestamps are ISO 8601.
- CSRF applies to session-backed state-changing requests; cross-origin clients must send `X-CSRF-Token` from a safe response header.

## Auth and Accounts
### POST /api/auth/bootstrap
Create the first super admin user if no users exist.
- Request: `{ "email": "...", "password": "...", "admin_name": "...", "org_name": "...", "org_timezone": "America/New_York" }`
- Response: `{ "ok": true, "userId": 1, "orgId": 1, "employeeId": 1, "is_super_admin": true }`
Note: creates org + org_settings, a user membership with `is_super_admin`, and an admin employee (name from admin_name) with desktop_access + kiosk_admin_access plus full permissions. Org timezone is stored on `orgs` (not duplicated in org_settings).

### POST /api/auth/login
- Request: `{ "email": "...", "password": "...", "remember": true }`
- Response (single org): `{ "ok": true, "userId": 1, "orgId": 2, "employeeId": 12 }`
- Response (multiple orgs): `{ "ok": true, "userId": 1, "orgs": [ { "id": 2, "name": "...", "timezone": "..." } ], "requires_org_selection": true }`
Note: when multiple orgs are returned, the client must call `/api/auth/select-org` to set the active org in session.

### POST /api/auth/logout
- Response: `{ "ok": true }`

### GET /api/auth/me
- Response: `{ "ok": true, "user": { ... }, "org": { "id": 2, "name": "...", "timezone": "..." }, "membership": { "is_super_admin": true }, "employee": { "id": 12, "name": "...", "desktop_access": true, "kiosk_admin_access": true, "worker_timekeeping": true }, "permissions": { "see_shipments": true, "modify_time": true, "view_time_reports": true, "view_payroll": true, "modify_pay_rates": true } }`

### GET /api/auth/orgs
- Response: `{ "ok": true, "orgs": [ { "id": 2, "name": "...", "timezone": "..." } ] }`

### POST /api/auth/select-org
- Request: `{ "org_id": 2 }`
- Response: `{ "ok": true, "orgId": 2, "employeeId": 12 }`

### POST /api/auth/change-password
- Request: `{ "current_password": "...", "new_password": "..." }`
- Response: `{ "ok": true }`

### POST /api/auth/users  [super admin]
Create a user and optionally link to an employee.
- Request: `{ "email": "...", "password": "...", "employee_id": 12, "is_super_admin": false }`
- Response: `{ "ok": true, "userId": 5 }`
Note: if the email already exists, add a membership for the active org instead of creating a new user; password is optional in that case.

## QuickBooks
### GET /api/status
- Response: `{ "qbConnected": true, "qbRealmId": "...", "lastSync": { "employees": "YYYY-MM-DDTHH:MM:SSZ", "vendors": "...", "projects": "...", "payroll_accounts": "..." } }`
Note: qbConnected is true when the active org has valid tokens + realm_id; if refresh fails, tokens are cleared and qbConnected becomes false.
Note: lastSync values are null when never synced; they update after each successful Sync Now or payroll-accounts fetch.

### GET /auth/qbo
- Requires view_payroll + super admin; redirects to Intuit OAuth.
Note: generates a server-stored OAuth state tied to org_id + user_id (10-minute TTL).

### GET /quickbooks/oauth/callback
- Public callback; validates OAuth state and redirects back to admin console with status.
Note: expects code + state (+ realmId); on success stores access_token, refresh_token, expires_at, and realm_id for the org.
Note: if error=access_denied or state is invalid/expired, return to admin with an error status and do not store tokens.

### POST /api/qbo/disconnect  [view_payroll + super admin]
- Response: `{ "ok": true }`
Note: clears qbo_tokens for the active org; existing QBO IDs remain but syncing/linking is disabled until reconnect.

### POST /api/sync/employees  [view_payroll]
- Response: `{ "ok": true, "count": 123, "synced_at": "YYYY-MM-DDTHH:MM:SSZ" }`
Note: sync is manual (admin-triggered "Sync Now"); no scheduled syncs.
Note: requires an active QBO connection; otherwise return 400 `{ "error": "Not connected to QuickBooks." }`.
Note: upserts by employee_qbo_id and updates name, email, active, name_on_checks, name_on_checks_qbo_updated_at. name_on_checks uses last-updated precedence (QBO wins when its LastUpdatedTime is newer than local name_on_checks_updated_at/name_on_checks_qbo_updated_at).
Note: preserves rate, access flags, PIN, language, worker_timekeeping, and local-only employees (no employee_qbo_id).
Note: new QBO employees default to rate=0, worker_timekeeping=true, language=en, active per QBO.
Note: sync is single-flight per org; return 409 `{ "error": "Sync already in progress." }` if another sync is running.
Note: for upstream QBO errors, return 502/503 with a retryable error; honor Retry-After on 429 and avoid auto-retry loops (manual retry after backoff).

### POST /api/sync/vendors  [view_payroll]
- Response: `{ "ok": true, "count": 45, "synced_at": "YYYY-MM-DDTHH:MM:SSZ" }`
Note: requires an active QBO connection; otherwise return 400 `{ "error": "Not connected to QuickBooks." }`.
Note: upserts by qbo_id and updates name + active; preserves freight_forwarder flag and PIN. Local-only vendors (no qbo_id) are untouched.
Note: sync is single-flight per org; return 409 `{ "error": "Sync already in progress." }` if another sync is running.
Note: for upstream QBO errors, return 502/503 with a retryable error; honor Retry-After on 429 and avoid auto-retry loops (manual retry after backoff).

### POST /api/sync/projects  [view_payroll]
- Response: `{ "ok": true, "count": 67, "synced_at": "YYYY-MM-DDTHH:MM:SSZ" }`
Note: requires an active QBO connection; otherwise return 400 `{ "error": "Not connected to QuickBooks." }`.
Note: syncs QBO Customers/Jobs and updates only qbo_id, name, customer_name, active; project_timezone and geofence fields are preserved.
Note: projects not returned by QBO are set inactive (qbo_id is retained).
Note: sync is single-flight per org; return 409 `{ "error": "Sync already in progress." }` if another sync is running.
Note: for upstream QBO errors, return 502/503 with a retryable error; honor Retry-After on 429 and avoid auto-retry loops (manual retry after backoff).

### POST /api/sync/payroll-accounts  [view_payroll]
- Response: `{ "ok": true, "synced_at": "YYYY-MM-DDTHH:MM:SSZ", "bankAccounts": [ { "id": "...", "name": "...", "fullName": "...", "type": "..." } ], "expenseAccounts": [ { "id": "...", "name": "...", "fullName": "...", "type": "..." } ] }`
Note: requires an active QBO connection; otherwise return 400 `{ "error": "Not connected to QuickBooks." }`. This is a live fetch for dropdowns; no DB writes.
Note: sync is single-flight per org; return 409 `{ "error": "Sync already in progress." }` if another sync is running.
Note: for upstream QBO errors, return 502/503 with a retryable error; honor Retry-After on 429 and avoid auto-retry loops (manual retry after backoff).

## Employees
### GET /api/employees?status=active|inactive|pending  [view_payroll]
- Response: `[ { "id": 1, "name": "...", ... } ]`
Note: `pending` returns active employees missing both QBO IDs or with needs_qbo_sync = 1 (including kiosk-added helpers). Response includes needs_qbo_sync so the UI can display the reason.

### GET /api/kiosk/employees  [kiosk]
- Response: `[ { "id": 1, "name": "...", "nickname": "...", "name_on_checks": "...", "language": "en", "worker_timekeeping": 1, "kiosk_admin_access": 0, "pin_hash": "..." } ]`
Note: requires kiosk device auth or admin session; returns active employees allowed on kiosk (worker_timekeeping or kiosk_admin_access); pin_hash is provided for offline validation only (raw PINs are never returned).

### POST /api/kiosk/employees  [kiosk admin]
Create a pending employee from the kiosk (no QBO link required).
- Request (multipart/form-data):
  - `name`: required
  - `nickname`: optional
  - `language`: optional (`en`/`es`/`ht`, default `en`)
  - `id_document_type`: `drivers_license` | `passport` | `other`
  - `id_document`: image file (required)
- Response: `{ "ok": true, "id": 123, "needs_qbo_sync": 1 }`
Note: stores the ID image securely and marks the employee as pending for desktop admin review and QBO linking (helpers/workers added on kiosk).

### POST /api/employees  [view_payroll]
Create or update.
- Request: `{ "id": 1, "name": "...", "rate": 12.5, "language": "en", "desktop_access": true, ... }`
- Response: `{ "ok": true, "id": 1 }`

### POST /api/employees/:id/active  [view_payroll]
- Request: `{ "active": true }`
- Response: `{ "ok": true, "active": 1 }`

### POST /api/employees/:id/pin  [view_payroll or kiosk device]
- Request: `{ "pin": "1234", "allowOverride": true, "device_id": "...", "device_secret": "...", "client_id": "..." }`
- Response: `{ "ok": true }`
Note: PIN must be a 4-digit numeric string; allowOverride is required to change an existing PIN (otherwise return 409). Kiosk devices must include device_id + device_secret.
Note: client_id is optional and used to dedupe offline retries.
Note: duplicate client_id returns ok=true with alreadyProcessed=true.

### POST /api/employees/:id/language  [kiosk device]
- Request: `{ "language": "es" }`
- Response: `{ "ok": true, "language": "es" }`
Note: allowed values are `en`, `es`, `ht`; unknown values default to `en`.
Note: this persists the employee default language; kiosk worker manual overrides do not call this endpoint.

### POST /api/employees/:id/name-on-checks  [view_payroll or kiosk device]
- Request: `{ "name_on_checks": "...", "device_id": "...", "device_secret": "..." }`
- Response: `{ "ok": true, "id": 1, "name_on_checks": "...", "qbo_warning": null }`
Note: if the QBO update fails, the server queues a retry and returns `qbo_warning`.

### DELETE /api/employees/:id/id-document  [view_payroll]
- Response: `{ "ok": true }`
Note: deletes the stored ID document file if present and clears id_document_type, id_document_path, id_document_uploaded_at, id_document_uploaded_by. Missing files do not fail the request.

### POST /api/employees/:id/link-qbo  [view_payroll]
- Request: `{ "employee_qbo_id": "...", "vendor_qbo_id": "..." }`
- Response: `{ "ok": true, "warning": null }`
Note: requires an active QBO connection; provide either ID (or both); updates only provided fields and clears needs_qbo_sync; reject if the provided QBO ID is already linked to another employee.
Note: on conflict, return 409 with `{ "error": "QBO ID already linked.", "linked_employee_id": 123, "linked_employee_name": "..." }`.
Note: linking does not create QBO records; if a manual ID is not in the last synced list, allow link but return a warning (client can display).

### POST /api/employees/:id/qbo-create  [view_payroll]
- Request: `{ "display_name": "...", "given_name": "...", "family_name": "...", "email": "..." }` (given_name + family_name required; display_name/email optional)
- Response: `{ "ok": true, "employee_qbo_id": "...", "employee_qbo_name": "..." }`
Note: requires an active QBO connection; creates a QBO Employee and links it to the local employee (sets employee_qbo_id, clears needs_qbo_sync).
Note: return 409 if the employee already has an employee_qbo_id.
Note: require at least one successful employees sync before create; if lastSync.employees is null, return 400 `{ "error": "Sync employees first." }`.
Note: if a duplicate candidate is detected among synced QBO employees (same email or exact name), return 409 `{ "error": "Potential duplicate in QuickBooks.", "matches": [ { "employee_qbo_id": "...", "name": "...", "email": "..." } ] }` and do not create.
Note: if QBO rejects the create (duplicate or validation), return 400 with the upstream error message and do not link.

### POST /api/employees/:id/unlink-qbo  [view_payroll]
- Request: `{ "employee": true, "vendor": true }` (both optional; default true if omitted)
- Response: `{ "ok": true }`
Note: clears the selected QBO ID fields and sets needs_qbo_sync=1. Does not require an active QBO connection. Return 400 if both employee and vendor are false.

## Permissions and Settings
### GET /api/settings  [view_payroll]
- Response: `{ "settings": { "company_name": "...", "company_email": "...", "storage_daily_late_fee_default": null, "clock_in_photo_required": true, "time_exception_rules": { ... }, "payroll_rules": { "pay_period_length_days": 7, "pay_period_start_weekday": 1, "pay_period_anchor_date": null, "overtime_enabled": false, "overtime_daily_threshold_hours": 8, "overtime_weekly_threshold_hours": 40, "overtime_multiplier": 1.5, "double_time_enabled": false, "double_time_daily_threshold_hours": 12, "double_time_multiplier": 2.0 }, ... } }`
Note: includes org-level settings such as clock_in_photo_required, payroll_rules, and time_exception_rules; only super admins can change access-control settings and payroll_rules. storage_daily_late_fee_default defaults to null/0 (late fees disabled) until set.
Note: time_exception_rules includes weekly_hours_threshold and auto_clockout_daily_max_hours/auto_clockout_weekly_max_hours (null/0 disables).
Note: when both daily and weekly thresholds are enabled, compute daily overtime first, then apply weekly overtime to remaining regular hours above the weekly threshold (no double counting). If double-time is enabled, apply double-time first, then overtime, then weekly.

### POST /api/settings  [view_payroll]
- Request: `{ "company_name": "...", "company_email": "...", "storage_daily_late_fee_default": null, "clock_in_photo_required": true, "time_exception_rules": { ... }, "payroll_rules": { ... } }`
- Response: `{ "ok": true }`
Note: clock_in_photo_required and payroll_rules may be set here by a super admin.

### GET /api/kiosk/settings
- Response: `{ "settings": { "clock_in_photo_required": true, ... } }`
Note: clock_in_photo_required is org-level and set by super admin in Settings.

## Vendors
### GET /api/vendors?status=active|inactive  [view_payroll]
- Response: `[ { "id": 1, "name": "..." } ]`

### POST /api/vendors/:id  [view_payroll]
- Request: `{ "is_freight_forwarder": true, "uses_timekeeping": false }`
- Response: `{ "ok": true }`
Note: name and QBO ID are read-only; vendor timekeeping is not supported, so `uses_timekeeping` should remain false.

### POST /api/vendors/:id/pin  [view_payroll]
- Request: `{ "pin": "1234", "allowOverride": true, "is_freight_forwarder": true, "uses_timekeeping": false }`
- Note: omit `pin` to update only freight/timekeeping flags.
- Response: `{ "ok": true }`
Note: PIN must be a 4-digit numeric string; allowOverride is required to change an existing PIN; `uses_timekeeping` is retained for legacy but should stay false.

## Projects
### GET /api/projects?status=active|inactive  [view_payroll]
- Response: `[ { "id": 1, "qbo_id": "...", "name": "...", "customer_name": "...", "project_timezone": "...", "geo_lat": 18.4, "geo_lng": -66.0, "geo_radius": 120, "active": 1 } ]`

### POST /api/projects  [view_payroll]
- Request: `{ "id": 1, "geo_lat": 18.4, "geo_lng": -66.0, "geo_radius": 150, "project_timezone": "America/Puerto_Rico" }`
- Response: `{ "ok": true, "id": 1 }`
Note: geo_lat and geo_lng must be provided together; omit both to disable geofence. geo_radius is in meters; if blank/null, default to 120m.
Note: this endpoint is used for geofence/timezone edits; qbo_id, name, customer_name, and active are QBO-owned and not editable here.

### GET /api/kiosk/projects
- Response: `[ { "id": 1, "name": "...", "customer_name": "...", "project_timezone": "...", "active": 1 } ]`

## Kiosks
### GET /api/kiosks  [view_payroll]
- Response: `[ { "id": 1, "name": "...", "location": "...", "device_id": "...", "project_id": 5, "created_at": "...", "project_name": "...", "customer_name": "..." } ]`

### POST /api/kiosks  [view_payroll]
- Request: `{ "id": 1, "name": "...", "location": "...", "device_id": "...", "project_id": 5 }`
- Response: `{ "ok": true, "id": 1 }`

### POST /api/kiosks/register  [enrollment code or device secret]
- Request (enroll): `{ "enrollment_code": "...", "device_id": "..." }`
- Request (refresh): `{ "device_id": "...", "device_secret": "..." }`
- Response: `{ "ok": true, "kiosk": { "id": 1, "name": "...", "device_id": "...", "device_secret": "...", "project_id": 5 }, "sessions": [ { "id": 10, "project_id": 5, "date": "YYYY-MM-DD" } ], "active_session_id": 10 }`
Note: no session required; enrollment code ties the device to the org and returns a device_secret for offline auth.
Note: device_id is client-generated and globally unique; if already enrolled in a different org, return 409.
Note: if the device is already enrolled in this org, return the existing kiosk + timesheets; enrollment_code is only required for first-time enrollment or device_secret rotation.
Note: unknown device_id without enrollment_code returns 400 (no placeholder kiosk creation).
Note: if device_secret mismatches for an enrolled device, return the canonical device_secret so the device can re-sync.
Note: `sessions` in the response are today's timesheets (kiosk_sessions).

### GET /api/kiosk-sessions/today  [view_payroll]
- Response: `[ { "id": 10, "kiosk_id": 2, "project_id": 5, "device_id": "...", "date": "YYYY-MM-DD", "created_at": "...", "kiosk_name": "...", "kiosk_location": "...", "project_name": "...", "customer_name": "...", "open_punches": [ { "id": 99, "employee_id": 7, "employee_name": "...", "project_id": 5, "device_id": "...", "clock_in_ts": "..." } ] } ]`
Note: Timesheets are stored as kiosk_sessions; the endpoint name remains `/api/kiosk-sessions/*`.

### GET /api/kiosks/:id/sessions  [view_payroll]
- Query: `date=YYYY-MM-DD` (defaults to today)
- Response: `[ { "id": 10, "project_id": 5, "date": "YYYY-MM-DD", "created_at": "...", "created_by_employee_id": 12, "created_by_name": "...", "project_name": "...", "customer_name": "...", "entry_count": 4, "open_count": 1, "device_entry_count": 3, "device_open_count": 1 } ]`

### POST /api/kiosks/:id/sessions  [kiosk admin]
- Request: `{ "project_id": 5, "make_active": true, "admin_id": 12, "clock_me_in": true, "clock_in_payload": { "client_id": "...", "device_timestamp": "...", "lat": 0, "lng": 0, "photo_base64": "..." } }`
- Response: `{ "ok": true, "session": { "id": 10, "project_id": 5, "date": "YYYY-MM-DD", "created_by_employee_id": 12, "created_by_name": "..." }, "active_session_id": 10, "active_project_id": 5, "first_session_today": false, "clocked_in": true, "punch_id": 99 }`
Note: `clock_me_in` creates an immediate clock-in for `admin_id` on the new session’s project. If photo is required and `photo_base64` is missing, return 400.
Note: if the admin already has an open punch, return 409 and do not create a new punch.
Note: `clock_me_in` defaults to false; `clock_in_payload` is optional and supports the same fields as `/api/kiosk/punch` (excluding project_id).

### DELETE /api/kiosks/:id/sessions/:sessionId  [kiosk admin]
- Request: `{ "admin_id": 12, "pin": "1234" }`
- Response: `{ "ok": true, "entry_count": 0 }`

### POST /api/kiosks/:id/active-session  [kiosk admin]
- Request: `{ "session_id": 10, "admin_id": 12 }`
- Response: `{ "ok": true, "active_session_id": 10, "project_id": 5 }`
Note: sets the active session for new punches only; it does not close other open sessions.

### GET /api/kiosks/:id/open-punches  [kiosk admin]
- Response: `[ { "id": 123, "employee_id": 7, "employee_name": "...", "project_id": 5, "project_name": "...", "customer_name": "...", "clock_in_ts": "...", "clock_out_ts": null } ]`
Note: returns today’s punches for this kiosk’s device (open + closed); used for live workers and clock-out alerts. Active workers are rows with `clock_out_ts = null`.

### GET /api/kiosk/open-punch  [kiosk]
- Query: `employee_id=123`
- Response: `{ "open": false }` or `{ "open": true, "punch_id": 55, "employee_id": 123, "project_id": 5, "project_name": "...", "customer_name": "...", "clock_in_ts": "..." }`
Note: requires kiosk device auth or admin session; used to set the clock-in/out button state.

### GET /api/kiosks/:id/foreman-today  [kiosk admin]
- Response: `{ "foreman_employee_id": 12, "foreman_name": "..." }`
Note: foreman is stored per kiosk + date and is attached to punches/time entries for reporting.

### POST /api/kiosks/:id/foreman-today  [kiosk admin]
- Request: `{ "foreman_employee_id": 12, "set_by_employee_id": 9 }`
- Response: `{ "ok": true }`
Note: if no foreman is set, the first employee to clock in auto-sets the foreman for that day.

## Kiosk Rate Unlock
### POST /api/kiosk/rates/unlock  [modify_pay_rates]
- Request: `{ "admin_id": 12, "pin": "1234" }`
- Response: `{ "ok": true, "expires_in_ms": 600000 }`
Note: unlock expires after 10 minutes or on sign-out; PIN must be 4 digits. Returns 401 for incorrect PIN, 403 if the admin lacks modify_pay_rates or has no PIN set.

### GET /api/kiosk/rates  [modify_pay_rates]
- Response: `{ "employees": [ { "id": 1, "name": "...", "rate": 12.5 } ] }`
Note: requires an active unlock; returns 403 if locked. Returns all active employees (including pending/unlinked).

### POST /api/kiosk/rates/:id  [modify_pay_rates]
- Request: `{ "rate": 15.0 }`
- Response: `{ "ok": true, "rate": 15.0 }`
Note: requires an active unlock; returns 403 if locked. Successful updates refresh the unlock timer.

## Timekeeping
### POST /api/kiosk/punch  [kiosk]
- Request: `{ "client_id": "...", "employee_id": 1, "project_id": 5, "lat": 0, "lng": 0, "device_timestamp": "...", "photo_base64": "...", "device_id": "...", "device_secret": "..." }`
- Response (clock_in): `{ "ok": true, "mode": "clock_in", "punch_id": 1, "geofence_violation": false, "geo_distance_m": 12.3, "geo_radius_m": 100 }`
- Response (clock_out): `{ "ok": true, "mode": "clock_out", "hours": 7.5, "total_pay": 90, "time_entry_id": 55 }`
- Response (already processed): `{ "ok": true, "alreadyProcessed": true, "mode": "clock_in", "geofence_violation": false, "geo_distance_m": 12.3, "geo_radius_m": 100 }`
Note: requires kiosk device auth (device_id + device_secret) or an admin session; server determines clock_in vs clock_out by open punch state.
Note: project_id must map to an active kiosk session for today on this device; otherwise return 400.
Note: client_id provides idempotency for offline retries; device_timestamp is used for punch time when provided.
Note: clock-out duration is computed from clock_in/out and rounded up to the next minute.
Note: photo_base64 is used for clock-in only and stored as clock_in_photo_path; it is ignored on clock-out.

### GET /api/time-punches/open  [view_time_reports or view_payroll]
- Response: `[ { "id": 1, "employee_id": 7, "employee_name": "...", "project_id": 5, "project_name": "...", "customer_name": "...", "clock_in_ts": "..." } ]`

### GET /api/time-entries  [view_time_reports or view_payroll]
- Query: `start=YYYY-MM-DD`, `end=YYYY-MM-DD`, `employee_id`, `project_id` (defaults to today if empty)
- Response: `[ { "id": 1, "employee_id": 7, "employee_name": "...", "project_id": 5, "project_name": "...", "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "start_time": "08:00", "end_time": "16:00", "hours": 8, "total_pay": 120, "paid": 0, "paid_date": null, "verified": 0, "verified_at": null, "verified_by_employee_id": null, "resolved": 0, "resolved_at": null, "resolved_by": null, "approval_status": "pending|approved", "approved_at": null, "approved_by_employee_id": null, "has_geo_violation": 0, "has_auto_clock_out": 0, "punch_exception_resolved": 0 } ]`
- Note: pay fields (`total_pay`, `paid`, `paid_date`) should be hidden unless `view_payroll` is granted.
Note: approval_status must be approved by a super admin before payroll can run; any edit resets approval to pending.
Note: defaults to today when no filters are provided; response is capped (legacy limit 200).

### GET /api/kiosk/time-entries  [kiosk admin + modify_time]
- Query: `start=YYYY-MM-DD`, `end=YYYY-MM-DD`, `employee_id`, `project_id` (defaults to today if empty)
- Response: same shape as `/api/time-entries`
- Note: pay fields should be hidden unless `view_payroll` is granted.

### POST /api/time-entries  [modify_time]
- Request: `{ "employee_id": 1, "project_id": 5, "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "start_time": "08:00", "end_time": "16:00", "hours": 8, "note": "...", "client_id": "..." }`
- Response: `{ "ok": true, "id": 1, "total_pay": 120 }`
Note: manual entries are single-day (start_date = end_date); hours should match the provided times. note is required for manual creation. total_pay is computed from the employee's current rate.
Note: creating or editing a time entry resets approval_status to pending.
Note: note requirements apply only to modify_time actions; view-only users cannot call this endpoint.
Note: client_id is optional and used to dedupe offline retries.
Note: duplicate client_id returns ok=true with alreadyProcessed=true.

### POST /api/time-entries/:id  [modify_time]
- Request: `{ "employee_id": 1, "project_id": 5, "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "start_time": "08:00", "end_time": "16:00", "hours": 8, "note": "...", "client_id": "...", "if_match_updated_at": "YYYY-MM-DDTHH:MM:SSZ" }`
- Response: `{ "ok": true, "id": 1, "total_pay": 120 }`
Note: note is required for edits; paid entries return 409 and must be corrected with a new adjustment entry. total_pay is recalculated using the current employee rate.
Note: editing a time entry resets approval_status to pending.
Note: note requirements apply only to modify_time actions; view-only users cannot call this endpoint.
Note: client_id is optional and used to dedupe offline retries.
Note: duplicate client_id returns ok=true with alreadyProcessed=true.
Note: if_match_updated_at is optional; when provided and stale, return 409 with the current time entry snapshot.

### POST /api/time-entries/:id/verify  [modify_time]
- Request: `{ "verified": true, "verified_by_employee_id": 12, "note": "..." }`
- Response: `{ "id": 1, "verified": 1, "verified_at": "...", "verified_by_employee_id": 12 }`
Note: verify/unverify is an accuracy check and is logged in the audit trail; it does not affect payroll eligibility. note is required when verified=false (unverify).

### POST /api/time-entries/:id/resolve  [modify_time]
- Request: `{ "resolved": true, "resolved_by": "...", "note": "..." }`
- Response: `{ "id": 1, "resolved": 1, "resolved_at": "...", "resolved_by": "admin" }`
Note: resolve/unresolve marks the entry as resolved without modifying times; use the exception review flow for approve/modify/reject workflows. note is required for resolve/unresolve.

### POST /api/time-entries/:id/approve  [modify_time + super admin]
- Request: `{ "note": "...", "actor_name": "...", "if_match_updated_at": "YYYY-MM-DDTHH:MM:SSZ" }`
- Response: `{ "ok": true, "approval_status": "approved", "approved_at": "YYYY-MM-DDTHH:MM:SSZ", "approved_by_employee_id": 12 }`
Note: note is required when the entry has discrepancies or was manually modified since last approval. Approvals are audited.
Note: if_match_updated_at is optional; when provided and stale, return 409 with the current time entry snapshot.

### POST /api/time-entries/approve  [modify_time + super admin]
- Request: `{ "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "employee_id": 1, "project_id": 5, "approve_all": true }`
- Response: `{ "ok": true, "approved_count": 42, "skipped": [ { "id": 123, "reason": "requires_note" } ] }`
Note: bulk approve is allowed only for clean entries (no discrepancies and no manual edits). Entries that require a note must be approved individually.

### GET /api/time-exceptions  [view_time_reports or view_payroll]
- Query: `start=YYYY-MM-DD`, `end=YYYY-MM-DD`, `employee_id`, `project_id`, `hide_resolved=true|false`
- Response: `[ { "id": 1, "source": "punch", "category": "geofence", "employee_id": 7, "employee_name": "...", "project_id": 5, "project_name": "...", "clock_in_ts": "...", "clock_out_ts": "...", "duration_hours": 8, "flags": [ "Clock-in outside geofence" ], "resolved": 0, "review_status": "open", "review_note": null, "review_by": null, "review_at": null, "has_geo_violation": 1, "auto_clock_out": 0, "auto_clock_out_reason": null } ]`
Note: start/end are required; results combine punch exceptions and time-entry vs punch discrepancies (categories include `time`, `geofence`, `auto_clock_out`, `time_vs_punch`).
Note: auto_clock_out_reason values: `midnight_auto`, `catch_up_auto`, `daily_max`, `weekly_max`.

### POST /api/time-exceptions/:id/review  [modify_time]
- Request: `{ "source": "punch|time_entry", "action": "approve|modify|reject", "note": "...", "actor_name": "...", "updates": { ... }, "if_match_updated_at": "YYYY-MM-DDTHH:MM:SSZ" }`
- Request (updates for punch): `{ "clock_in_ts": "...", "clock_out_ts": "...", "project_id": 5, "clock_out_project_id": 5 }`
- Request (updates for time_entry): `{ "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "start_time": "08:00", "end_time": "16:00", "hours": 8, "project_id": 5 }`
- Response: `{ "ok": true, "status": "approved|modified|rejected" }`
Note: note is required for approve on discrepancies (all time-exception rows) and for modify/reject. Punch edits must stay within a single day (<24h) and clock-in/out projects must match; time entry edits must stay within a single day with valid HH:MM times and hours 0–24. Review actions mark the exception resolved and are audited.
Note: if_match_updated_at is optional; when provided and stale, return 409 with the current exception snapshot.

### POST /api/time-exceptions/:id/resolve  [modify_time]
- Request: `{ "note": "...", "actor_name": "..." }`
- Response: `{ "ok": true, "alreadyResolved": false }`
Note: note is required; resolves punch exceptions without modifying times (equivalent to approve).

## Payroll
### GET /api/payroll/account-options  [view_payroll]
- Response: `{ "ok": true, "bankAccounts": [ { "id": "...", "name": "...", "fullName": "...", "type": "..." } ], "expenseAccounts": [ { "id": "...", "name": "...", "fullName": "...", "type": "..." } ] }`

### GET /api/payroll/classes  [view_payroll]
- Response: `{ "ok": true, "classes": [ { "id": "...", "name": "...", "fullName": "...", "active": true } ] }`

### GET /api/payroll/settings  [view_payroll]
- Response: `{ "bank_account_name": "...", "expense_account_name": "...", "default_memo": "...", "line_description_template": "..." }`

### POST /api/payroll/settings  [view_payroll]
- Request: `{ "bank_account_name": "...", "expense_account_name": "...", "default_memo": "...", "line_description_template": "..." }`
- Response: `{ "ok": true }`

### GET /api/payroll-summary  [view_payroll]
- Query: `start=YYYY-MM-DD`, `end=YYYY-MM-DD`, `includePaid=true|false`, `includeOvertime=true|false` (default true)
- Response: `[ { "employee_id": 1, "employee_name": "...", "project_id": 5, "project_name": "...", "project_hours": 40, "project_pay": 1200, "any_paid": 0, "last_paid_date": null, "payroll_run_id": 10 } ]`
Note: when overtime is enabled and includeOvertime=true, totals in the summary/check preview apply payroll_rules overtime; time_entries.total_pay remains base pay.

### GET /api/payroll/time-entries  [view_payroll]
- Query: `employeeId`, `start=YYYY-MM-DD`, `end=YYYY-MM-DD` (all required)
- Response: `[ { "id": 1, "employee_id": 7, "project_id": 5, "project_name": "...", "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "start_time": "08:00", "end_time": "16:00", "hours": 8, "total_pay": 120, "rate": 15, "resolved_status": "approved", "resolved_note": null, "punch_count": 2, "punch_exception_count": 0, "punch_exception_unapproved_count": 0, "punch_hours": 8 } ]`
- Note: returns only entries eligible for payroll (exceptions approved or none); hours/total_pay are rounded for display.
Note: total_pay reflects base pay for the entry; overtime adjustments are applied at payroll summary/run time.

### POST /api/payroll/preflight-checks  [modify_payroll]
- Request: `{ "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "bankAccountName": "...", "expenseAccountName": "...", "memo": "...", "lineDescriptionTemplate": "...", "includeOvertime": true, "overrides": [ { "employeeId": 1, "expenseAccountName": "...", "memo": "...", "lineDescriptionTemplate": "..." } ], "lineOverrides": [ { "employeeId": 1, "projectId": 5, "expenseAccountName": "...", "description": "...", "className": "..." } ], "customLines": [ { "employeeId": 1, "amount": 50, "description": "...", "expenseAccountName": "...", "className": "...", "projectId": 5 } ], "excludeEmployeeIds": [1, 2], "onlyEmployeeIds": [3] }`
- Response: `{ "ok": true, "preview": true, "preflight_id": 42, "payload_hash": "sha256:...", "snapshot_hash": "sha256:...", "snapshot_count": 12, "results": [ { "employeeId": 1, "employeeName": "...", "totalHours": 40, "totalPay": 1200, "ok": true, "error": null, "warnings": [], "warningCodes": [], "previewOnly": true } ], "fatalQboError": null }`
- Response (not connected): `{ "ok": false, "reason": "Not connected to QuickBooks (no access token or realmId).", "drafts": [ { "employee_id": 1, "employee_name": "...", "name_on_checks": "...", "vendor_qbo_id": "...", "employee_qbo_id": "...", "total_hours": 40, "total_pay": 1200, "memo": "...", "expense_account_name": "...", "lines": [ { "project_id": 5, "project_name": "...", "project_hours": 8, "project_pay": 240, "project_qbo_id": "...", "project_customer_name": "...", "description": "...", "is_custom": false } ] } ], "preview": true }`
Note: validates QBO connection, payee links, and account/class names; no QBO checks are created.
Note: preflight stores a short-lived snapshot (preflight_id, payload_hash, snapshot_hash) tied to the payload and eligible time entries; create-checks must reference it (default TTL 30 minutes).
Note: per-employee failures return ok=false with errors like missing payee, missing expense account/class, or no payable lines.
Note: class is optional; if provided and not found in QBO, the employee result is ok=false.
Note: validates start/end (YYYY-MM-DD) and enforces a max 31-day range.
Note: excludeEmployeeIds removes those employees from the draft set; onlyEmployeeIds further limits to a subset (useful for retry).
Note: missing QBO link yields ok=false with an error like "No QuickBooks payee linked"; UI should alert before create-checks.
Note: if any time entries in the period are not approved, return 409 with a list of pending approvals.

### POST /api/payroll/create-checks  [modify_payroll]
- Request: `{ "preflight_id": 42, "payload_hash": "sha256:...", "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "bankAccountName": "...", "expenseAccountName": "...", "memo": "...", "lineDescriptionTemplate": "...", "includeOvertime": true, "overrides": [ { "employeeId": 1, "expenseAccountName": "...", "memo": "...", "lineDescriptionTemplate": "..." } ], "lineOverrides": [ { "employeeId": 1, "projectId": 5, "expenseAccountName": "...", "description": "...", "className": "..." } ], "customLines": [ { "employeeId": 1, "amount": 50, "description": "...", "expenseAccountName": "...", "className": "...", "projectId": 5 } ], "excludeEmployeeIds": [1, 2], "onlyEmployeeIds": [3], "isRetry": false, "originalPayrollRunId": 10, "fromAttemptId": 5, "idempotencyKey": "...", "run_type": "standard|adjustment", "adjustment_reason": "..." }`
- Response: `{ "ok": true, "status": "COMPLETED|PARTIAL", "payrollRunId": 10, "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "totalHours": 40, "totalPay": 1200, "results": [ { "employeeId": 1, "employeeName": "...", "totalHours": 40, "totalPay": 1200, "ok": true, "error": null, "warnings": [], "warningCodes": [], "qboTxnId": "..." } ], "attempt_id": 5, "idempotencyKey": "...", "fatal_qbo_error": null }`
Note: returns 409 if a payroll run is already in progress (DB lock).
Note: if idempotencyKey was already completed for the same period and isRetry=false, returns ok=true with status=completed and no new checks.
Note: create-checks requires a valid preflight_id + payload_hash that match the request; return 400 if missing, stale, or mismatched.
Note: if the eligible time-entry snapshot changed since preflight, return 409 and require a new preflight.
Note: if any time entries in the period are not approved, return 409 with a list of pending approvals.
Note: standard runs reject overlapping periods; adjustment runs are allowed only with explicit run_type=adjustment + adjustment_reason.
Note: the system always creates new checks; it does not merge into existing queued checks.
Note: per-employee failures return ok=false with an error message; successful employees are marked paid, failed employees remain unpaid.
Note: includeOvertime is persisted on the payroll run (include_overtime) and must match the preflight payload/hash.
Note: missing expense account or class is a per-employee failure even during create-checks (no partial check creation).
Note: missing QBO link is a per-employee failure; link in QBO and retry those employees.
Note: warningCodes include print_name_sync_failed when QBO print name update fails (non-blocking).
Note: DB errors after QBO creation return ok=false and require manual review in QBO.
Note: non-retry runs validate start/end (max 31 days); retry runs only check date ordering and matching original period when originalPayrollRunId is provided.
Note: run status is PARTIAL when any employee fails; COMPLETED requires all ok.

### POST /api/payroll/preview-checks  [modify_payroll, deprecated]
Legacy endpoint; do not implement in the rebuild. If kept for compatibility, it must behave exactly like /api/payroll/preflight-checks (previewOnly) and never create QBO checks (including includeOvertime handling).

### POST /api/payroll/unpay  [modify_payroll]
- Request: `{ "payrollRunId": 10, "employeeId": 1, "reason": "...", "payrollCheckId": 123 }`
- Response: `{ "ok": true, "payrollRunId": 10 }`
Note: requires payrollRunId + employeeId. If payrollCheckId is provided, only that check is voided; otherwise all checks for the employee/run are voided.
Note: clears time_entries.paid and paid_date for entries tied to the payroll_run_id, sets payroll_checks.paid=0 with voided_at + voided_reason, and recalculates payroll_runs totals.

### GET /api/payroll/audit-log  [view_payroll]
- Response: `{ "ok": true, "logs": [ { "id": 1, "event_type": "PAYROLL_RUN_STARTED", "payroll_run_id": 10, "actor_employee_id": 12, "message": "...", "details_json": "{...}", "created_at": "..." } ] }`
Note: returns the latest 200 rows ordered by created_at DESC; no query params.
Note: raw log (details_json is a string, not parsed). Use /api/reports/payroll-audit for a parsed, UI-friendly view.

## Shipments
### GET /api/shipments  [see_shipments]
- Query: `search`, `status`, `project_id`, `vendor_id`
- Response: `{ "statuses": [ "Pre-Order", "Ordered", "..." ], "shipmentsByStatus": { "Pre-Order": [ { "id": 1, "title": "...", "status": "Pre-Order", "project_id": 5, "project_name": "...", "customer_name": "...", "vendor_name": "...", "items_verified": 0 } ] } }`
Note: excludes archived rows by default; if status=Archived is selected, return archived rows (is_archived=1) and only archived shipments.
Note: search applies to title, po_number, tracking_number, and bol_number (LIKE).
Note: vendor_id filter matches vendor_id or vendor_name.
Note: statuses includes the known status list plus any extra status values found in data.
Note: results are sorted by updated_at DESC (fallback created_at), then created_at DESC.

### GET /api/shipments/:id  [see_shipments]
- Response: `{ "shipment": { "id": 1, "title": "...", "status": "Arrived", "project_id": 5, "project_name": "...", "customer_name": "...", "vendor_name": "..." }, "items": [ { "id": 10, "shipment_id": 1, "description": "...", "sku": "...", "quantity": 2, "unit_price": 10, "line_total": 20, "vendor_name": "...", "verified": 1, "notes": "...", "verification": { "status": "verified", "notes": "...", "storage_override": "" } } ] }`
Note: returns the shipment regardless of is_archived. Items are sorted by id ASC.
Note: verification is parsed from verification_json when present; fallback uses legacy verified/notes with storage_override="". When present, verification may also include verified_by, verified_at, verified_by_employee_id, verified_by_user_id, verified_via, verified_device_id, issue_type, and history.

### POST /api/shipments  [see_shipments]
- Request: `{ "title": "...", "po_number": "...", "project_id": 1, "vendor_id": 2, "vendor_name": "...", "freight_forwarder": "...", "destination": "...", "sku": "...", "quantity": 10, "total_price": 1000, "price_per_item": 100, "expected_ship_date": "YYYY-MM-DD", "expected_arrival_date": "YYYY-MM-DD", "tracking_number": "...", "bol_number": "...", "storage_due_date": "YYYY-MM-DD", "storage_daily_late_fee": 25, "picked_up_by": "...", "picked_up_date": "YYYY-MM-DD", "vendor_paid": true, "vendor_paid_amount": 500, "shipper_paid": false, "customs_paid": false, "total_paid": 500, "items": [ { "description": "...", "sku": "...", "quantity": 1, "unit_price": 100, "line_total": 100, "vendor_name": "...", "verification": { "status": "verified", "notes": "...", "storage_override": "" } } ], "items_verified": true, "verified_by": "...", "verification_notes": "...", "website_url": "...", "notes": "...", "status": "Pre-Order" }`
- Response: `{ "shipment": { "id": 12, "title": "...", "status": "Pre-Order", "project_id": 1 } }`
Note: freight_forwarder is selected from vendors flagged as freight forwarders and stored as a name string.
Note: total_price is stored as provided; the UI defaults it to the sum of line_total but allows manual override (override does not change line items).
Note: required fields are title and project_id. Vendor_id is optional and is selected from the QBO-synced vendor list; no free-text vendor entry in the UI.
Note: storage_daily_late_fee defaults from org settings if omitted by the client.

### PUT /api/shipments/:id  [see_shipments]
- Request: same shape as `POST /api/shipments` (full update payload, items replaced)
- Response: `{ "shipment": { "id": 12, "title": "...", "status": "Sailed" } }`
Note: optional `if_match_updated_at` can be supplied to detect offline conflicts; when stale, return 409 with the current shipment snapshot.
Note: optional `client_id` can be supplied for idempotent offline retries.

### DELETE /api/shipments/:id  [see_shipments]
- Response: `{ "ok": true }`
Note: soft-archives the shipment (is_archived=1, archived_at set); rows remain accessible by id.

### POST /api/shipments/:id/status  [see_shipments]
- Request: `{ "new_status": "Sailed", "note": "..." }`
- Response: `{ "ok": true }`

### POST /api/shipments/:id/storage  [see_shipments]
- Request: `{ "storage_due_date": "YYYY-MM-DD", "storage_daily_late_fee": 25, "expected_arrival_date": "YYYY-MM-DD", "picked_up_by": "...", "picked_up_date": "YYYY-MM-DD", "employee_id": 12 }`
- Response: `{ "shipment": { "id": 12, "storage_due_date": "...", "picked_up_by": "..." } }`
Note: kiosk-friendly update for storage/pickup fields; does not change status or set storage location (per-item storage is handled in verify-items).
Note: blank strings are normalized to null; storage_daily_late_fee must be numeric or null.
Note: if employee_id is provided, picked_up_updated_by is set to the employee nickname/name and picked_up_updated_at is set to now.

### GET /api/shipments/:id/payments  [see_shipments]
- Response: `{ "payments": [ { "id": 1, "shipment_id": 12, "type": "vendor", "amount": 500, "currency": "USD", "status": "Pending", "due_date": "YYYY-MM-DD", "paid_date": null, "invoice_number": "...", "notes": "...", "file_path": null, "created_by": 9, "created_at": "..." } ] }`
Note: ordered by created_at ASC. Payments are a ledger only; they do not auto-update shipment paid flags or totals.
Note: type is freeform but recommended values are vendor/shipper/customs/other.
Note: status is freeform but recommended values are Pending/Paid/Partial/Void.

### POST /api/shipments/:id/payments  [see_shipments]
- Request: `{ "type": "vendor", "amount": 500, "currency": "USD", "status": "Pending", "due_date": "YYYY-MM-DD", "paid_date": null, "invoice_number": "...", "notes": "..." }`
- Response: `{ "ok": true }`
Note: amount is required. currency defaults to USD. status defaults to Pending.
Note: created_by is set from the current admin session (user/employee) when available.

### GET /api/shipments/:id/timeline  [see_shipments]
- Response: `{ "timeline": [ { "id": 1, "shipment_id": 12, "event_type": "status_change", "old_status": "Ordered", "new_status": "Sailed", "note": "...", "created_at": "..." } ] }`
Note: ordered by created_at ASC.
Note: event_type is "status_change" in legacy; note is optional.

### GET /api/shipments/:id/comments  [see_shipments]
- Response: `{ "comments": [ { "id": 1, "shipment_id": 12, "body": "...", "created_by": 12, "created_at": "..." } ] }`
Note: ordered by created_at ASC; soft-deleted comments are excluded.

### POST /api/shipments/:id/comments  [see_shipments]
- Request: `{ "body": "...", "client_id": "..." }`
- Response: `{ "ok": true }`
Note: body is required. created_by should be set from the current admin session in the rebuild.
Note: offline kiosk sync replays queued comments to this endpoint using device credentials (employee_id, device_id, device_secret).
Note: client_id is optional and used to dedupe offline retries.
Note: duplicate client_id returns ok=true with alreadyProcessed=true.

### DELETE /api/shipments/:id/comments/:commentId  [see_shipments]
- Response: `{ "ok": true }`
Note: soft delete only (set is_deleted=1, deleted_at, deleted_by); the row remains in the DB.
Note: deletion is online-only (not queued for offline sync).

### GET /api/shipments/:id/documents  [see_shipments]
- Response: `{ "documents": [ { "id": 1, "shipment_id": 12, "title": "...", "category": null, "doc_type": "...", "doc_label": "...", "file_path": "/api/shipments/documents/1/download", "uploaded_at": "...", "url": "/api/shipments/documents/1/download" } ] }`
Note: ordered by uploaded_at DESC, id DESC.
Note: documents are stored outside the public root; file_path/url are download URLs.
Note: callers without view_payroll should not receive payment/proof-of-payment documents.

### GET /api/shipments/documents/:docId/download  [see_shipments]
- Response: file download (inline)
Note: returns Content-Disposition inline with the original filename when possible.
Note: return 404 if the file is missing on disk.

### POST /api/shipments/:id/documents  [see_shipments]
- FormData: `documents[]`, optional `doc_type`, `doc_label`
- Response: `{ "documents": [ { "id": 1, "shipment_id": 12, "title": "...", "doc_type": "...", "doc_label": "...", "file_path": "/api/shipments/documents/1/download", "url": "/api/shipments/documents/1/download" } ] }`
Note: max 10 files per request, 10 MB per file; allowed types are PDF, JPEG/JPG, PNG, GIF, WEBP.
Note: if doc_type is "Other", doc_label is required for display.
Note: empty uploads return `{ "documents": [] }`.

### DELETE /api/shipments/:id/documents/:docId  [see_shipments]
- Response: `{ "success": true }`
Note: deletes the DB row and attempts to remove the file; missing files are ignored.

### POST /api/shipments/:id/verify-items  [see_shipments]
- Request: `{ "client_id": "...", "items": [ { "shipment_item_id": 1, "verification": { "status": "verified", "notes": "...", "verified_at": "YYYY-MM-DD", "storage_override": "", "issue_type": null, "history": [] } } ], "employee_id": 12, "device_id": "...", "device_secret": "..." }`
- Response: `{ "ok": true, "items_verified": true }`
Note: verification.status is one of verified/missing/damaged/wrong_item; empty or "unverified" means not checked.
Note: server writes verification_json and ignores client-supplied verified_by fields; it derives verified_by and verified_* metadata from the current session or kiosk auth.
Note: verified flag is set when status is non-empty and not "unverified". items_verified is recomputed as true when all items have status not empty/unverified.
Note: if status is cleared, verified_by and verified_at are cleared as well.
Note: server appends a verification history entry on each status change (including clearing) and stores it in verification_json.history[].
Note: history[] entry shape: `{ "at": "...", "from_status": "...", "to_status": "...", "by_employee_id": 12, "by_name": "...", "notes": "...", "storage_override": "..." }`.
Note: verification history lives only in verification_json.history[]; there is no separate audit log/report for item verification changes.
Note: storage_override is the per-line item storage location; when it is set for the first time on any item (empty -> non-empty), append a shipment timeline entry (event_type="storage_location_set").
Note: kiosk access requires employee_id + device_id + device_secret, and the employee must be admin or kiosk_can_view_shipments.
Note: client_id is optional and used to dedupe offline retries.
Note: duplicate client_id returns ok=true with alreadyProcessed=true.
Note: does not change shipment status or create timeline entries.

### GET /api/shipments/templates  [see_shipments]
- Response: `{ "templates": [ { "id": 1, "name": "...", "title": "...", "vendor_id": 2, "vendor_name": "...", "project_id": 5, "project_name": "...", "freight_forwarder": "...", "destination": "...", "sku": "...", "quantity": 10, "total_price": 1000, "price_per_item": 100, "website_url": "...", "notes": "...", "items": [ { "description": "...", "sku": "...", "quantity": 2, "unit_price": 100, "line_total": 200, "vendor_name": "..." } ], "created_at": "..." } ] }`
Note: templates are per-org. vendor_name and project_name are resolved for display (join or snapshot).

### POST /api/shipments/templates  [see_shipments]
- Request: `{ "name": "Kitchen default", "title": "...", "vendor_id": 2, "freight_forwarder": "...", "destination": "...", "project_id": 5, "sku": "...", "quantity": 10, "total_price": 1000, "price_per_item": 100, "website_url": "...", "notes": "...", "items": [ { "description": "...", "sku": "...", "quantity": 2, "unit_price": 100, "line_total": 200, "vendor_name": "..." } ] }`
- Response: `{ "ok": true, "template": { "id": 1, "name": "...", "created_at": "..." } }`
Note: name is required; other fields are optional and default to null. items is optional; when provided it replaces all existing items on update.

### PUT /api/shipments/templates/:id  [see_shipments]
- Request: same shape as POST (full update payload)
- Response: `{ "ok": true }`

### DELETE /api/shipments/templates/:id  [see_shipments]
- Response: `{ "ok": true }`

## Shipment Notifications
### GET /api/shipments/notifications  [see_shipments]
- Response: `{ "ok": true, "preference": { "enabled": true, "statuses": [ "Arrived", "Customs" ], "project_ids": [5], "shipment_ids": [1, 2], "notify_time": "09:00", "remind_every_days": 7 } }`
Note: per-admin (user_id) preference; if none exists, return defaults (enabled=false, empty arrays, notify_time="").
Note: empty statuses or project_ids means "all"; shipment_ids limits to explicit shipments if provided.
Note: reminders use the same filters (no fixed status); for status "Cleared - Ready for Release", reminders only fire when picked_up_by is blank.
Note: notify_time is HH:MM (24-hour) in org timezone; empty disables scheduled sends.

### PUT /api/shipments/notifications  [see_shipments]
- Request: `{ "enabled": true, "statuses": [ "Arrived", "Customs" ], "project_ids": [5], "shipment_ids": [1, 2], "notify_time": "09:00", "remind_every_days": 7 }`
- Response: `{ "ok": true, "preference": { "enabled": true, "statuses": [ "Arrived", "Customs" ], "project_ids": [5], "shipment_ids": [1, 2], "notify_time": "09:00", "remind_every_days": 7 } }`
Note: statuses are trimmed/unique (max 20). project_ids and shipment_ids are numeric and unique (max 200 each).
Note: remind_every_days defaults to 1; values < 1 are coerced to 1.
Note: notify_time must be HH:MM (24-hour) when provided.

## Reports
### GET /api/time-entries/export/:format  [view_time_reports or view_payroll]
- Query: `start=YYYY-MM-DD`, `end=YYYY-MM-DD`, `employee_id`, `project_id` (defaults to today if empty)
- Response: CSV or PDF file download (`format` is `csv` or `pdf`)
Note: CSV columns include Employee, Project, Start Date, End Date, Start Time, End Time, Hours, Total Pay, Paid, Paid Date, Geo Violation, Auto Clock-out.
Note: PDF includes Date, Time, Employee, Project, Hours, Paid.
Note: pay fields (Total Pay/Paid/Paid Date) are omitted entirely unless view_payroll is granted.

### GET /api/reports/payroll-runs  [view_payroll]
- Response: `[ { "id": 10, "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "status": "PENDING|IN_PROGRESS|PARTIAL|COMPLETED|FAILED", "created_at": "...", "total_hours": 40, "total_pay": 1200, "check_count": 8, "paid_checks": 7 } ]`
- Note: sorted by created_at DESC. `check_count` includes all checks for the run; `paid_checks` counts checks with `paid=1`.

### GET /api/reports/payroll-runs/:id  [view_payroll]
- Response: `[ { "id": 77, "employee_name": "...", "total_hours": 40, "total_pay": 1200, "check_number": "1024", "paid": 1, "paid_date": "YYYY-MM-DD HH:MM:SS" } ]`
- Note: sorted by employee name (A-Z). `paid` is stored as 0/1; `paid_date` may be null when unpaid.

### PATCH /api/reports/checks/:id  [modify_payroll]
- Request: `{ "check_number": "1024", "paid": true }`
- Response: `{ "ok": true, "paid": true, "paid_date": "YYYY-MM-DD HH:MM:SS" }`
- Note: if `paid` changes, update payroll_checks.paid/paid_date, update time_entries paid flags for the employee/run, and recalc payroll_runs totals. If only `check_number` is updated, do not touch paid or paid_date.

### GET /api/reports/payroll-audit  [view_payroll]
- Query: `limit=50` (default 50, max 500)
- Response: `[ { "id": 1, "event_type": "PAYROLL_RUN_STARTED", "message": "...", "payroll_run_id": 10, "created_at": "...", "details": { ... }, "actor_employee_id": 12 } ]`
- Note: sorted by created_at DESC, then id DESC. `details` is parsed from details_json; null if invalid JSON.
- Note: event_type values include PAYROLL_RUN_STARTED, PAYROLL_QBO_COMPLETE, PAYROLL_QBO_ERROR, PAYROLL_RUN_SUCCESS, PAYROLL_RUN_PARTIAL, PAYROLL_RUN_FAILURE, PAYROLL_FATAL_ERROR, RETRY_STARTED, RETRY_QBO_COMPLETE, RETRY_SUCCESS, PAYROLL_UNPAY.

### GET /api/reports/payroll-audit-log  [view_payroll]
- Query: `limit=200` (default 200, max 1000)
- Response: `{ "ok": true, "logs": [ { "id": 1, "event_type": "PAYROLL_RUN_STARTED", "payroll_run_id": 10, "actor_employee_id": 12, "message": "...", "details_json": "{...}", "created_at": "..." } ] }`
- Note: raw log; sorted by created_at DESC, then id DESC.

### GET /api/reports/shipment-verification  [see_shipments]
- Query: `shipment_id`, `project_id`, `status`, `ready_for_pickup`, `start=YYYY-MM-DD`, `end=YYYY-MM-DD`
- Note: summary mode excludes archived shipments by default; if status=Archived is selected, return archived shipments only.
- Note: sorted by updated_at DESC (fallback created_at), then id DESC.
- Note: `ready_for_pickup=1|true|yes` means items_verified=1, picked_up_by blank, and status="Cleared - Ready for Release".
- Note: UI defaults the date range to the last 30 days and leaves ready_for_pickup off unless toggled.
- Response (summary): `{ "mode": "summary", "shipments": [ { "id": 1, "title": "...", "bol_number": "...", "sku": "...", "tracking_number": "...", "freight_forwarder": "...", "status": "Cleared - Ready for Release", "project_id": 5, "project_name": "...", "customer_name": "...", "items_verified": 1, "items_total": 12, "items_verified_count": 12, "picked_up_by": null, "picked_up_date": null, "picked_up_updated_by": "...", "picked_up_updated_at": "...", "verified_by": "...", "expected_arrival_date": "...", "storage_due_date": "...", "storage_daily_late_fee": 25, "created_at": "...", "total_price": 1200, "vendor_paid": 1, "vendor_paid_amount": 600, "shipper_paid": 0, "shipper_paid_amount": 0, "customs_paid": 0, "customs_paid_amount": 0, "total_paid": 600, "vendor_name": "...", "distinct_item_vendors": 2 } ] }`
- Response (detail): `{ "mode": "detail", "shipment": { "id": 1, "title": "...", "status": "Arrived" }, "items": [ { "id": 1, "shipment_id": 1, "description": "...", "sku": "...", "quantity": 2, "unit_price": 100, "line_total": 200, "vendor_name": "...", "verified": 1, "notes": "...", "verification": { "status": "verified", "notes": "...", "verified_at": "...", "verified_by": "...", "verified_by_employee_id": 12, "verified_by_user_id": 9, "verified_via": "session", "verified_device_id": null, "storage_override": "", "history": [] } } ] }`
- Note: detail mode returns the same shipment shape as /api/shipments/:id, and items include `verification` parsed from verification_json. If verification_json is empty/invalid, fall back to `verified` and `notes`, with history defaulting to [].
Note: paid amount fields (vendor_paid_amount, shipper_paid_amount, customs_paid_amount, total_paid) are omitted or null unless the requester has view_payroll.

## Notifications (In-App)
### GET /api/notifications  [auth]
- Query: `limit=50` (default 50, max 200), `before_id` (pagination), `unread_only=1|true`
- Response: `{ "notifications": [ { "id": 1, "type": "shipment", "title": "...", "body": "...", "data": { ... }, "read_at": null, "created_at": "..." } ], "next_before_id": 1 }`
Note: sorted newest-first by id DESC. `data` is parsed from data_json; null if invalid JSON.

### POST /api/notifications/mark-read  [auth]
- Request: `{ "ids": [1, 2], "all": false }`
- Response: `{ "ok": true, "updated": 2 }`
Note: when all=true, ignore ids and mark all unread notifications as read.

### POST /api/notifications/test  [auth]
- Request: `{ "channels": [ "in_app", "push", "email" ], "title": "Test", "body": "..." }`
- Response: `{ "ok": true, "results": { "in_app": "sent", "push": "skipped", "email": "sent" } }`
Note: channels default to ["in_app"] when omitted. Push/email are skipped if disabled or missing subscription/email.

### GET /api/notifications/prefs  [auth]
- Response: `{ "prefs": { "email_enabled": true, "push_enabled": true, "shipment_filters": { ... }, "payroll_filters": { ... }, "time_filters": { ... }, "remind_time": "09:00", "remind_every_days": 1, "clockout_enabled": false, "clockout_time": "17:00" } }`
Note: shipment_filters/payroll_filters/time_filters are parsed from JSON blobs; empty objects when unset.
Note: if no prefs exist, return defaults (email_enabled=true, push_enabled=true, empty filters, remind_time="", remind_every_days=1, clockout_enabled=false, clockout_time="").
Note: recommended filter shapes:
- shipment_filters: `{ "enabled": true, "statuses": [], "project_ids": [] }`
- payroll_filters: `{ "enabled": true, "event_types": [] }`
- time_filters: `{ "enabled": true, "event_types": [] }`
Note: time event_types: TIME_EXCEPTION_OPEN, TIME_EXCEPTION_REVIEWED, TIME_EXCEPTION_RESOLVED, TIME_ENTRY_MANUAL_CREATED, TIME_ENTRY_MANUAL_EDITED.
Note: payroll event_types: PAYROLL_RUN_DUE, PAYROLL_RUN_STARTED, PAYROLL_RUN_SUCCESS, PAYROLL_RUN_PARTIAL, PAYROLL_RUN_FAILURE, PAYROLL_FATAL_ERROR, PAYROLL_QBO_ERROR, PAYROLL_UNPAY.

### PUT /api/notifications/prefs  [auth]
- Request: `{ "email_enabled": true, "push_enabled": true, "shipment_filters": { ... }, "payroll_filters": { ... }, "time_filters": { ... }, "remind_time": "09:00", "remind_every_days": 1, "clockout_enabled": false, "clockout_time": "17:00" }`
- Response: `{ "ok": true, "prefs": { ... } }`
Note: remind_time/clockout_time must be HH:MM (24-hour) when provided; remind_every_days coerced to >= 1.

### POST /api/notifications/push/subscribe  [auth]
- Request: `{ "endpoint": "...", "p256dh": "...", "auth": "...", "user_agent": "..." }`
- Response: `{ "ok": true }`
Note: upsert by endpoint+user_id; revoked_at is cleared on subscribe.

### POST /api/notifications/push/unsubscribe  [auth]
- Request: `{ "endpoint": "..." }`
- Response: `{ "ok": true }`
Note: sets revoked_at; rows are retained for audit.
