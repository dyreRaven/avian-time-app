# Avian Time + Payroll Rebuild Spec

## Status
- Source of truth for the rebuild.
- Approved goals, open questions tracked in docs/OPEN_QUESTIONS.md.

## Goals
- Full QuickBooks flow: OAuth, sync, payroll checks, audit.
- Offline-first kiosk for workers and kiosk admins with sync on reconnect.
- Shipments remain a first-class module.
- Multi-tenant ready (org-level scoping from day one).
- Role-based access with kiosk admin and desktop admin separation.
- Notifications to phone via in-app + push; email via Google Workspace SMTP; no SMS by default.

## Constraints
- Kiosk must function without internet for clock-in/out and admin review.
- PINs are per employee and must be secure (4-digit numeric, legacy).
- Photos retained for 30 days only.
- Employees cannot self-register. Only super admins can create accounts (bootstrap allowed).

## Environment
- DB_PATH: SQLite file path for the rebuild DB (default `rebuild.db` in repo root).
- APP_TIMEZONE: server fallback timezone for app-level jobs (default America/Puerto_Rico).
- PORT: server port (default 3000).
- SESSION_SECRET: required in production (32+ chars) for sessions.
- SESSION_ENCRYPTION_KEY: optional; used to encrypt sessions and QBO tokens at rest (falls back to SESSION_SECRET if unset).
- COOKIE_SECURE: true/false to force secure cookies (default: true in prod).
- COOKIE_SAMESITE: lax/strict/none (default: strict in prod, lax in dev).
- ENABLE_IN_PROCESS_BACKUPS: true/false to run daily backups in the web process (default false).
- QuickBooks: QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI (realm_id is stored per org after OAuth); optional QBO_API_BASE (defaults to production) and QBO_DEBUG (logs QBO queries in dev).
- APNs: APNS_KEY_PATH, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID.
- There is no dev seed flow in the rebuild. Testing uses the production bootstrap flow.

## Definitions
- Organization (org): tenant boundary. All data is scoped by org_id.
- Orgs are created during bootstrap with name + timezone; orgs also carry status and timestamps. Org settings live in `org_settings`.
- Org status values: active | suspended | archived (default active).
- User: global account that can belong to multiple orgs via membership; active org is stored in the session.
- Desktop Admin: has access to the admin console at /.
- Kiosk Admin: has access to /kiosk-admin only.
- Worker: timekeeping only in /kiosk.
- UI mode: session flag (`desktop` | `kiosk`) that controls which UI a signed-in admin sees on a given device.

## Roles and Access
### Access Toggles and Membership Flags
- desktop_access: can log into admin console.
- kiosk_admin_access: can access kiosk admin dashboard.
- worker_timekeeping: can clock in/out in kiosk.
- is_super_admin: per-org membership flag (stored on user_orgs; grants/revokes permissions and manages org settings).
- login_enabled: per-org membership flag (stored on user_orgs) that controls whether a super admin login can sign in.

### Permissions (legacy set)
- see_shipments
- modify_time
- approve_time
- view_time_reports
- view_all_timesheets
- assign_timesheets
- view_payroll
- modify_payroll
- modify_pay_rates

### Rules
- Super Admin toggles these permissions per admin; templates are optional starting points and do not auto-sync after apply.
- Kiosk admin access is separate from desktop access.
- Role templates are per-org presets for access + permissions; applying a template copies values and remains editable afterward.
- Optional role_title can be stored per employee for labeling (e.g., Foreman, Superintendent).
- Settings page is visible to desktop admins; access-control section is visible to super admins only.
- All API endpoints are gated server-side by permissions.
- view_payroll is read-only for payroll screens; modify_payroll is required to run checks or unpay.
- Shipments access uses `see_shipments` for both desktop and kiosk admin; legacy `kiosk_can_view_shipments` is folded into this permission.
- Timesheet visibility: admins without `view_all_timesheets` or `view_payroll` only see timesheets they created or are assigned; payroll admins and super admins can see all timesheets, and super admins can share timesheets across admins.

## Routes
- /auth
- / (admin console)
- /kiosk
- /kiosk-admin
- /auth/qbo
- /quickbooks/oauth/callback

## Route Gating
- /auth: public; handles sign-in, bootstrap (first org only), and org selection.
- /: allows a signed-in bootstrap account with no org to complete org setup from the onboarding checklist.
- /: requires desktop_access and ui_mode=desktop; if ui_mode=kiosk, redirect to /kiosk.
- /kiosk: public shell; device must be enrolled to submit punches; worker PIN must have worker_timekeeping.
- /kiosk-admin: requires kiosk_admin_access (PIN-gated on device or session).
- /auth/qbo: requires a super admin session with view_payroll; callback validates OAuth state.
- /api/*: session + permissions or kiosk device secret as defined in API contracts; UI gating is not sufficient.

## Auth and Accounts
- Super Admin bootstrap: initial admin signs up when no orgs exist; signup finalizes the account before org setup.
- Org setup follows signup and collects org name + timezone + admin first/last name, then creates the initial org + org_settings defaults.
- If signup is complete but no org exists, the admin lands on the dashboard onboarding checklist to finish org setup.
- Bootstrap also creates an admin employee linked to the user membership, sets desktop_access + kiosk_admin_access to true, and sets worker_timekeeping to true; grants full permissions by default.
- Admins create and manage user accounts for others (no self-register for employees).
- If the email already exists, add the user to the active org instead of creating a new account.
- Login supports remember-me session.
- Remember-me sets a 30-day session cookie; otherwise use a browser session cookie.
- If a user belongs to multiple orgs, they pick the active org at login (org switcher in admin UI).
- When multiple orgs exist, login returns the org list and requires selection before continuing.
- If a bootstrap signup exists without an org, login returns a setup-required response to resume org creation.
- Org selection sets the active org in session (via `/api/auth/select-org`).
- Only super admins have email/password logins; kiosk admins sign in on devices using their PIN.
- Super admins can create logins for other super admins in Settings (requires linking to an active employee with desktop_access).
- Super admins can reset passwords and disable/enable logins (login_enabled) for other super admins in Settings.
- Users can change their own password in Settings.
- Users can be linked to employees per org for permissions and kiosk identity.
- Desktop access gates / (admin console); kiosk-only users are routed to /kiosk.
- UI mode defaults to kiosk on tablets (touch + small viewport) and desktop on non-tablet devices; super admins can explicitly switch to desktop mode on a tablet.

## Admin Console
### Admin Console Shell: Navigation
- Left sidebar with section groups and icons.
- Home: Admin Home.
- Default landing: Admin Home (if disabled, fall back to first permitted section).
- Operations: Employees, Vendors, Projects, Shipments.
- Time & Pay: Timesheets, Review Time Entries, Payroll.
- Reports: Time Entries Report, Payroll Reports, Shipment Verification Report.
- Settings: Settings.
- Nav items are visible but disabled when the user lacks permissions; tooltips explain required access.
- Gating: Employees/Vendors/Projects/Payroll/Payroll Reports require view_payroll; Payroll actions (create checks, unpay, retries) require modify_payroll; Review Time Entries + Time Entries Report require view_time_reports or view_payroll; Shipments + Shipment Verification Report require see_shipments; Settings requires view_payroll; Access-control panel inside Settings requires is_super_admin.
- Timesheets: super admins, view_payroll, and view_all_timesheets can see all timesheets; other admins only see timesheets they created or are assigned/shared to.
- Admin Home is available to any desktop_access user, but cards/actions hide or disable if the user lacks the underlying permission.

### QuickBooks Connection
- Global status card (connected/disconnected) and connect/refresh/disconnect action.
- Sync actions: employees, vendors, projects, payroll accounts (manual "Sync Now" only).
- Card behavior: shown only on Employees, Vendors, Projects, and Payroll tabs; hidden elsewhere.
- Actions by tab: Employees → Sync Employees; Vendors → Sync Vendors; Projects → Sync Projects; Payroll → Sync Payroll Accounts.
- Shows a syncing indicator while a sync request is in-flight; uses `/api/status` for connection state.
- Show "Last synced at" timestamps per list (employees/vendors/projects/payroll accounts) sourced from `/api/status.lastSync`.
- Show "Last synced at" per entity list; if never synced, show a warning and disable link/create actions with a "Sync Now" CTA.
- Requires view_payroll to view or use.
- Connect/disconnect are desktop-only and require super admin.
- OAuth uses a server-stored state tied to org_id + user_id (10-minute TTL); callback validates state.
- Callback stores access_token, refresh_token, expires_at, and realm_id in qbo_tokens for the org; failures keep the org disconnected.
- Disconnect clears qbo_tokens for the org; existing QBO IDs remain but linking/sync is disabled until reconnect.
- If refresh fails (401/400), tokens are cleared and status becomes disconnected.
- QBO linking: after a Sync Now, employees without QBO IDs show in the pending list for manual linking or "Create in QBO" (if connected).
  - After "Create in QBO", immediately link the local employee, clear needs_qbo_sync, and optionally refresh the list (Sync Now).
  - "Create in QBO" is disabled until at least one employee sync has completed; if a matching QBO employee exists (same email or exact name), block create and prompt to link instead.

### Admin Home
- To-do tiles: unresolved time exceptions, missing QBO links, shipments ready for pickup, payroll run due, kiosk offline alerts.
- Quick actions: sync QBO, run payroll, add shipment, create employee, create kiosk.
- Notifications feed (in-app).

#### Dashboard Tiles
- Time Exceptions: count of open/unreviewed exceptions; links to Review Time Entries; visible with view_time_reports or view_payroll.
- Missing QBO Links: count of employees/vendors/projects missing QBO IDs or flagged needs_qbo_sync; links to the relevant list; visible with view_payroll.
- Shipments Ready for Pickup: count of shipments in status "Cleared - Ready for Pickup"; links to Shipments board filtered; visible with see_shipments.
- Payroll Run Due: shows current pay period end date and count of unpaid entries; links to Payroll; visible with view_payroll.
- Kiosk Offline Alerts: kiosks with last_seen_at older than 30 minutes (or never seen) while a timesheet exists today; links to Timesheets; visible with view_payroll.
- Empty state: if no tiles are applicable, show "All clear" with only permitted quick actions.

### Employees
- Table with search and active/inactive toggle.
- Create/edit employee with: first name, last name, nickname, email, name_on_checks, rate, language (en/es/ht; default en), timekeeping access, desktop access, kiosk admin access, permission toggles.
- Language is required for every employee; if missing/invalid, the UI defaults to English and shows an admin warning until corrected.
- Employees list shows a missing-language count and a quick filter to view only employees with missing/invalid language.
- Kiosk shipments access if enabled.
- Rate changes require `modify_pay_rates` permission; viewing pay rates requires `view_payroll`; kiosk rate unlock is PIN + timeout gated (10-minute window).
- QBO linking and pending list: Sync Now pulls QBO employees into the list. Local-only employees (manual or kiosk-created) are flagged needs_qbo_sync and appear in a pending list (linking disabled unless QBO is connected).
- Pending list shows the reason: missing IDs vs local dirty fields vs conflicts (use qbo_dirty_fields_json + qbo_conflict_fields_json).
- Linking UI: searchable picker of synced QBO Employees/Vendors with manual ID entry fallback; suggested matches by name/email when available. If a manual ID is not found in the last sync list, show a warning but allow link. Optional "Create in QBO" creates the employee in QBO and links it.
- Pending list actions: Link, Create in QBO, Sync changes to QBO, or Mark Inactive; list shows reason tags and last synced state.
- QBO link/create/unlink actions are super admin only.
- Create in QBO button is shown only after an employees Sync Now has completed; if duplicate matches are returned, show them inline and require the admin to link instead of create.
- Create in QBO requires given_name + family_name; display_name optional. If a duplicate match is detected (exact name), return matches and require explicit linking instead of create.
- Duplicate protection: if a QBO ID is already linked to another employee, block linking with a clear error that names the conflicting employee; admin must unlink first.
- Unlinking: admins can clear employee/vendor QBO IDs, which sets needs_qbo_sync=1 and returns the employee to pending.
- Name_on_checks updates sync to QBO only when a desktop admin runs the manual “Sync changes to QBO”; vendor QBO ID takes precedence for payee selection when both IDs exist.
- PINs are 4-digit numeric and hashed server-side; kiosk verifies PIN locally when offline using cached hashes.
- Name on checks can be edited by kiosk admins; changes are marked dirty for desktop review and manual sync.
- Kiosk admin onboarding can create a pending employee (helpers/workers) with a manually entered name and captured ID image (driver’s license or passport); no parsing required.
- Pending helpers appear in the desktop pending list for super admin review and QBO linking before payroll.

#### Employee Profile (Admin)
- Identity: first name, last name, nickname, email, active/inactive.
- Pay: hourly rate (requires modify_pay_rates), name_on_checks (syncs to QBO on manual sync), payee linkage (employee/vendor QBO ID; vendor ID wins when both exist).
- Access: worker_timekeeping, desktop_access, kiosk_admin_access (super admin only).
- Permissions: see_shipments, modify_time, approve_time, view_time_reports, view_all_timesheets, assign_timesheets, view_payroll, modify_pay_rates (super admin only).
- Kiosk settings: PIN set/reset (override required if already set), language default (en/es/ht).
- QuickBooks: employee/vendor QBO IDs, needs_qbo_sync flag (missing links), qbo_dirty_fields_json/qbo_conflict_fields_json, link actions.
- Audit: show last_updated timestamps for name_on_checks sync and rate changes.
- Kiosk admin rate edit: requires modify_pay_rates + PIN unlock; unlock is per-admin session and expires after 10 minutes of inactivity or sign-out.
- ID document: store captured ID image (driver’s license or passport) with upload metadata; visible to desktop admins only.
- ID images are retained until manually deleted (no auto-purge on deactivation).
- Desktop admins can view ID images via `GET /api/employees/:id/id-document` (view_payroll only).

### Vendors
- QBO-synced list with search and active toggle.
- Vendor name and QBO ID are read-only (from sync); admins can edit freight forwarder flag and PIN.
- Freight forwarder flag: marks the vendor as a forwarder option in Shipments.
- Vendor timekeeping is not supported; `uses_timekeeping` is reserved for legacy compatibility and should remain off.
- Vendor PIN: 4-digit numeric, hashed, and reset requires allowOverride.

### Projects
- QBO-synced list with search and active/inactive toggle (QBO Customers/Jobs).
- QBO-owned fields are read-only: qbo_id, name, customer_name, active (active is driven by QBO).
- customer_name uses the QBO FullyQualifiedName parent; it may be blank for top-level customers.
- Projects are managed in QBO; admin cannot create/delete projects in-app (only edit geofence/timezone).
- Sync pulls active customers/jobs; projects not returned are marked inactive (not deleted).
- Editable fields: project_timezone, geo_lat, geo_lng, geo_radius (meters).
- project_timezone is optional; if blank, use org timezone for reporting and scheduling.
- QBO sync updates only QBO-owned fields and preserves project_timezone + geofence edits.
- Geofence is advisory only (flag violations, do not block punches).
- Geofence validation: lat/lng must be provided together; if radius is blank, default to 120m (~400ft).
- Geofence enforcement: runs on kiosk clock-ins and kiosk timesheet creation when a project has lat/lng/radius and GPS is available; violations create exception flags (clock-in outside geofence or kiosk outside geofence).

### Shipments
- Board with status columns and drag/drop.
- Filters: search, status, project, vendor.
- Search supports tracking number, BOL number, PO number, and title (partial match).
- Add shipment modal with core fields (PO, vendor, project, SKU/qty/pricing, dates, tracking/BOL, notes).
- Detail modal tabs: Overview, Payments, Timeline, Documents, Comments.
- Overview includes storage/pickup fields, daily late fee, and verification summary.
- Late fees auto-calc from storage due date using the org default daily fee (org_settings.storage_daily_late_fee_default; legacy daily_fee), editable per shipment. If the org default is null/0, late fees are disabled until set.
- Payments include summary flags (vendor/shipper/customs/total) and detailed ledger entries.
- Documents support type/label metadata and secure download.
- Item verification captures per-item status and notes.
- Admin notification preferences for shipment reminders by status/project (see Shipments Ops: Notifications).
- Templates optional.

### Time Exceptions
- Exceptions surface as flags inside Review Time Entries; there is no standalone exceptions report.
- Categories include auto clock-out, geofence, and time discrepancies (including time vs punch).
- Review modal for approve/modify/reject (modify_time required); this is the field-review step. Payroll approval is separate and requires approve_time (payroll permissions). Approve requires a note when the entry has discrepancies or was manually modified; modify/reject always require a note.
- All review actions recorded in an audit trail (who/when/what changed).
- Exceptions include punch-based flags and time-entry vs punch discrepancies.
- Manual-entry exceptions: no punches linked, or hours mismatch (>= 0.10h / ~6 min).
- Modify rules: punch edits must stay on the same day and <24h, and clock-in/out projects must match; time entry edits must be single-day with valid HH:MM times and hours between 0–24.
- Resolve/unresolve flows are tracked separately from verification.
- Payroll eligibility: all time entries require field review (resolved_status != open or resolved=1); entries with exceptions require approved/modified review. Payroll approval still requires approve_time (payroll permissions). Verify does not affect payroll eligibility.
- Audit trail storage: time_exception_actions with source_type `punch` or `time_entry`, action (approve/modify/reject/resolve), actor, note, and before/after snapshots; retained for 1 year.

### Review Time Entries
- Filters by employee, project, date range.
- Manual time entry create (single-day; start/end times required; hours computed from times) requires a change note.
- Manual time entry edit requires a change note; edits recalc total_pay using the current employee rate.
- All time entries must include start_time/end_time (HH:MM, org timezone). Punch-based entries must derive and persist these times (see docs/TIME_ENTRY_INTEGRITY.md).
- Export CSV/PDF using current filters (default to today when empty).
- CSV columns: Employee, Project, Start Date, End Date, Start Time, End Time, Hours, Total Pay, Paid, Paid Date, Geo Violation, Auto Clock-out.
- PDF columns: Date, Time, Employee, Project, Hours, Paid.
- Pay fields (Total Pay/Paid/Paid Date) are omitted entirely unless view_payroll is granted.
- Link entries to punches and show verification state.
- Show field review status (pending/approved/modified/rejected) with reviewer + reviewed_at, plus payroll approval status (pending/approved) with approver + approved_at in the report.
- Weekly approval required: after field review, a user with approve_time must approve all entries in the pay period before payroll can run.
- Approval actions live in Review Time Entries with per-row approve (only after field review).
- Approving clean entries requires no note; approving entries with discrepancies or manual edits requires a note.
- Any edit to a time entry (manual edit or exception modify) resets field review and payroll approval to pending and logs an audit record.
- All edits recorded in an audit trail with before/after snapshots.
- Paid entries are locked from edits; corrections require a new manual adjustment entry.
- Verification (accuracy check) is separate from exception resolution.
- Verify marks accuracy only (no note required); unverify requires a note and does not change hours or payroll eligibility.
- Resolve/unresolve require a note; they mark entry exceptions as resolved without editing times. Use Review Time Entries for approve/modify/reject workflows.
- Note requirements and note fields apply only to users with modify_time; view-only users cannot edit/verify/resolve or submit notes.
- Audit trail storage: time_exception_actions with source_type `time_entry`, action (create/modify/verify/unverify/resolve/unresolve), actor, note, and before/after snapshots; retained for 1 year.

### Time Entries Report
- Read-only report for viewing time entries using filters (employee, project, date range).
- No edit, approve, verify, or resolve actions.
- Pay fields (Total Pay/Paid/Paid Date) are omitted unless view_payroll is granted.
- Uses the same time-entry visibility rules as Review Time Entries.

### Payroll
- Settings: bank/expense accounts, memo/line templates.
- Date range selection (configurable by org).
- Default date range uses the org pay period rules; admins can override manually.
- When overtime is enabled, payroll totals apply the overtime rules (regular_hours * rate + overtime_hours * rate * overtime_multiplier).
- Overtime adjustments are computed at payroll summary/run time and do not rewrite stored time_entries.total_pay.
- Each payroll run can toggle "Include overtime" (default on); this flag is stored with the run and used for preflight/create-checks and payroll summary totals.
- Summary table with expandable details.
- Preflight checks are required before create-checks (server-enforced); they are preview-only and never create QBO checks.
- Preflight validates QBO connection, payee links, expense accounts/classes, and returns per-employee ok/error; it also stores a preflight snapshot (preflight_id + time-entry snapshot) for create-checks.
- Preflight surfaces missing QBO links (per-employee ok=false); UI must alert and list who is missing before running checks.
- Preflight blocks if any QBO-linked employees have local dirty/conflict fields; admin must sync changes to QBO before payroll.
- Payroll is blocked until all time entries in the selected period are approved by a user with approve_time (weekly approval requirement).
- Create checks requires a valid preflight_id and must match the preflight payload (start/end + overrides/lines); reject if expired or mismatched.
- Create checks validates that eligible time entries match the preflight snapshot; if changed, return a conflict and require a new preflight.
- Create checks uses a DB lock + idempotency key and runs a backup before sending to QBO; if the backup fails or is skipped due to a lock, the run proceeds but returns a warning and logs PAYROLL_BACKUP_WARNING in payroll_audit_log.
- Create checks always creates new checks (no merge into existing queued checks); include payroll_run_id in a QBO note/memo for reconciliation.
- Successful checks mark time_entries paid and attach payroll_run_id (and payroll_check_id when available); failed employees remain unpaid and can be retried.
- Historical backfill: only needed if importing legacy payroll runs/checks. Run `scripts/backfill-payroll-run-links.js --apply` once after the import to link paid time_entries to their payroll_run_id/payroll_check_id.
- Run status is COMPLETED only if all employees succeed; otherwise set PARTIAL with per-employee errors preserved.
- Fatal QBO errors stop further checks; run status is PARTIAL (or FAILED if none succeeded) and response includes fatal_qbo_error.
- Expense account + class are required on create-checks; if QBO no longer recognizes them at creation time, that employee fails (no check created).
- Missing QBO link is a per-employee failure (ok=false) and keeps those employees unpaid until linked and retried.
- Retry flow supports onlyEmployeeIds and fromAttemptId to resend failed employees for the same period; retries update the same payroll_run_id.
- Overlapping payroll runs are blocked by default. Corrections should use unpay + retry for the same period; optional adjustment runs (run_type=adjustment + reason) are allowed only with explicit intent.
- Legacy /api/payroll/preview-checks is deprecated; use /api/payroll/preflight-checks only.
- Support custom/additional payroll lines and memo overrides.
- Memo/line templates support tokens ({start}, {end}, {dateRange}, {employee}, {project}, {hours}).
- Payroll lock prevents concurrent runs; run attempts + audit log retained.
- Unpay flow for reversing runs where needed.
- Unpay is run-scoped (payroll_run_id + employee_id + optional payroll_check_id) and clears paid flags only for entries in that run; it marks payroll_checks paid=0 with voided_at/voided_reason and recalculates run totals.
- Paid entries are marked and excluded by default, with optional include-paid toggle and include-overtime toggle.

### Payroll Reports
- Payroll Runs table: pay period (start/end), status (PENDING/IN_PROGRESS/PARTIAL/COMPLETED/FAILED), created_at, total_hours, total_pay, checks (paid/total).
- Sorted newest-first by created_at.
- Selecting a run loads Run Details (checks in that run).
- Run Details columns: employee_name, total_hours, total_pay, check_number, paid_date, paid.
- Allow inline edits to check_number (metadata only) and paid (updates payroll_checks + time_entries, recalculates run totals).
- Paid Date is set when a check is marked paid and cleared when unpaid/voided.
- CSV download of run details (Employee, Hours, Total Pay, Check #, Paid Date, Paid).
- Payroll Audit Log shows recent events (default 50) with time, event_type, message, payroll_run_id, actor_employee_id, and parsed details.
- Audit log event_type values include: PAYROLL_RUN_STARTED, PAYROLL_QBO_COMPLETE, PAYROLL_QBO_ERROR, PAYROLL_RUN_SUCCESS, PAYROLL_RUN_PARTIAL, PAYROLL_RUN_FAILURE, PAYROLL_FATAL_ERROR, RETRY_STARTED, RETRY_QBO_COMPLETE, RETRY_SUCCESS, PAYROLL_UNPAY.
- Audit log is backed by payroll_audit_log (details_json is parsed for the user-facing log; raw log remains available).
- Raw audit log endpoint returns the latest 200 rows (details_json unparsed) for diagnostics.

### Shipments (Board/List/Detail)
- Board uses /api/shipments and groups shipments into status columns; unknown statuses appear as extra columns.
- Filters: search (title, PO number, tracking number, BOL), single status filter (shows one column), project filter, vendor filter.
- Sorting: updated_at DESC (fallback created_at), then created_at DESC.
- Drag and drop cards to change status via /api/shipments/:id/status (adds timeline/history).
- Clicking a card opens the shipment detail modal for full edit.
- Delete action is a soft archive (is_archived=1, archived_at set); board/list exclude archived rows by default.
- Status "Archived" is a normal status value for non-archived shipments; if status=Archived is selected, include archived rows (is_archived=1) and return archived shipments only.
- Archive action sets status="Archived", is_archived=1, and appends a status/timeline entry.
- Detail view shows overview, payments, timeline, documents, comments, and line item verification.
- Detail fetch uses /api/shipments/:id (shipment + items; verification_json parsed to verification, or fallback to verified/notes).
- Create requires title + project; default status Pre-Order; project/vendor name snapshot stored on the shipment.
- Create/edit fields include:
  - Header: title, project, vendor (QBO-synced list), PO number, freight forwarder (vendor flagged as freight_forwarder), destination, internal ref (sku).
  - Dates: expected_ship_date (when vendor expects to ship), expected_arrival_date, storage_due_date, picked_up_date.
  - Tracking: tracking_number, bol_number.
  - Line items: description, sku, quantity, unit_price, line_total, vendor_name.
  - Storage/pickup: picked_up_by (shipment-level). Storage location is per line item via verification.storage_override.
  - Payments summary: vendor_paid/vendor_paid_amount, shipper_paid/shipper_paid_amount/shipper_paid_by, customs_paid/customs_paid_amount/customs_paid_by, storage_paid/storage_paid_amount/storage_paid_by, total_paid (payroll-visible only).
  - Notes/links: website_url, notes.
- Total price defaults to the sum of line_total but can be manually overridden in the form; overrides do not change line items.
- Top-level quantity/price_per_item are legacy and unused in the UI.
- Create/edit defaults + validation:
  - Required: title, project_id. Vendor is optional (QBO-synced list); no free-text vendor entry.
  - Freight forwarder selector is limited to vendors flagged as freight_forwarders; it stores a name string.
  - PO number is optional but included in search and reports.
  - Items start with one blank row; empty rows are ignored on save. line_total is computed as quantity * unit_price.
  - storage_daily_late_fee defaults from org_settings.storage_daily_late_fee_default when blank; if the org default is null/0, treat as no late fee. Storage fee estimate is UI-only.
  - Paid flags default false; amount inputs are disabled when unchecked (storage fees remain editable to record unpaid fees); total_paid auto-sums paid amounts.
- Update replaces all items in the payload; items_verified can be explicitly set or inferred from items.

### Shipments Ops: Storage/Pickup
- Kiosk-friendly endpoint updates storage and pickup fields; when both picked_up_by and picked_up_date are set, status auto-moves to Picked Up.
- Fields: storage_due_date, storage_daily_late_fee, expected_arrival_date, picked_up_by, picked_up_date.
- Storage location is per line item and stored in verification.storage_override (edited in the item verification UI).
- Normalization: blank strings become null; storage_daily_late_fee must be numeric or null.
- picked_up_updated_by is set from employee_id (nickname or name) when provided; picked_up_updated_at is set to now.
- Auto status updates append status history + timeline entries and send shipment status notifications.

### Shipments Ops: Payments
- Payment summary fields live on the shipment record: vendor_paid, vendor_paid_amount, shipper_paid, shipper_paid_amount, shipper_paid_by, customs_paid, customs_paid_amount, customs_paid_by, storage_paid, storage_paid_amount, storage_paid_by, total_paid.
- Paid flags drive board/report displays; amounts and total_paid are visible only to admins with view_payroll (others see Paid/Unpaid only).
- When a paid flag is off, its amount should be null/blank; UI disables amount entry when unchecked.
- Paid-by fields capture who covered freight forwarder/customs/storage (Company, customer, or Other); required when the paid flag is on and hidden without view_payroll.
- total_paid is the sum of vendor/shipper/customs/storage paid amounts; computed client-side on save and stored for reporting.
- Proof-of-payment documents can auto-toggle paid flags:
  - Freight Forwarder Proof of Payment -> shipper_paid.
  - Customs & Clearing Proof of Payment -> customs_paid.
  - Removing the proof prompts to mark unpaid; vendor paid stays manual.
- Optional payment ledger entries (shipment_payments) support due/paid tracking per shipment.
- Payments tab lists ledger entries and allows add-only via /api/shipments/:id/payments (no edit/delete in legacy); endpoints require view_payroll.
- Ledger entries do not auto-update shipment paid flags/amounts; summary fields remain the canonical board/report values.
- Ledger entries are admin-only and online-only (not queued for offline sync).

### Shipments Ops: Documents
- Documents are stored outside the public root (secure_uploads/shipments) and served via /api/shipments/documents/:docId/download (download) or /api/shipments/documents/:docId/view (inline view).
- Uploads are only allowed after a shipment exists; no pre-save uploads.
- Upload constraints: max 10 files per request, 10 MB per file; allowed types are PDF, JPEG/JPG, PNG, GIF, WEBP.
- FormData fields: documents[] (required), doc_type (optional), doc_label (optional; required when doc_type is Other).
- Default doc_type list: Shippers Invoice, BOL, Country of Origin Certificate, Tally Sheet, Freight Forwarder Proof of Payment, Customs & Clearing Proof of Payment, Other.
- Shippers Invoice + BOL are required documents; show a warning on shipment cards and the Documents tab until both are uploaded (uploads can happen anytime after creation).
- Document list is sorted newest-first (uploaded_at DESC, id DESC); each doc includes title, doc_type, doc_label, uploaded_at, plus view_url and download_url (url/file_path remain download links).
- Deleting a document removes the DB row and attempts to delete the file; missing files do not fail the request.
- Payment-doc detection (by doc_type/doc_label/title keywords) auto-toggles shipper/customs paid flags and prompts to mark unpaid on delete.
- Users without view_payroll should not see payment-related documents (hide proofs/receipts); kiosk already filters these.
- Document uploads/downloads are online-only (no offline queue).

### Shipments Ops: Timeline/Comments
- Timeline is system-generated only; no manual timeline entries beyond status changes and initial storage location set.
- Entries are created on shipment creation and status changes (drag/drop status update or main edit form).
- When a line item storage location is set for the first time (verification.storage_override transitions from empty to non-empty), append a timeline entry.
- event_type is "status_change" in legacy; use "storage_location_set" for the initial storage location entry. note may be user-supplied (status endpoint) or system text (main edit form).
- Timeline list is ordered by created_at ASC.
- Comments are admin-only and grouped into threads. Thread titles are required; category is optional.
- The default "General" thread is created automatically if a comment is posted without a thread_id.
- Comment lists are ordered by created_at ASC (per thread).
- Comments can be soft-deleted (inactive) via DELETE /api/shipments/:id/comments/:commentId; delete hides from default lists but retains for audit (is_deleted, deleted_at, deleted_by).
- Rebuild should set created_by for comments/timeline when an admin session is present.
- Comment posting can be queued offline for kiosk admins and synced on reconnect; comment deletion is online-only; timeline is online-only.

### Shipments Ops: Notifications
- Preferences are per-admin (shipment_notification_prefs) and scoped by org.
- Filters: statuses[], project_ids[], optional shipment_ids[].
- Empty statuses or project_ids means "all"; shipment_ids limits to explicit shipments if provided (UI should default statuses to "Cleared - Ready for Pickup" to avoid noisy reminders).
- notify_time is HH:MM (24-hour) in org timezone; empty disables scheduled sends.
- Daily summary: at notify_time, send a summary notification of matching shipments.
- Reminders: at notify_time, notify for shipments matching filters; repeat every remind_every_days per shipment (default 1).
- For status "Cleared - Ready for Pickup", reminders only fire when picked_up_by is blank.
- Optional "new shipments" alert can fire on refresh for newly seen shipments that match filters (device-local).
- Channels: in-app + push; email optional; SMS disabled by default.
- Kiosk caches preferences locally per admin/device for offline use; server prefs are the source of truth when online.

### Shipments Ops: Verification
- Per-line verification only (no top-level shipment verified_by auto-fill).
- Allowed item statuses: verified, missing, damaged, wrong_item (empty/unverified = not verified).
- Verification payload fields: status, notes, verified_at, storage_override, issue_type, history[].
- storage_override is the per-line item storage location.
- Server writes verification_json, sets legacy verified flag (1 when status is not empty/unverified), and recomputes shipment.items_verified.
- If status is cleared/unverified, verified_by and verified_at are cleared.
- items_verified is true when all items have a status other than empty/unverified.
- Verified actor metadata is derived from the current session or kiosk auth: verified_by, verified_by_employee_id, verified_by_user_id, verified_via (session|kiosk), verified_device_id.
- Verification history log: append a history entry on each status change (including clearing). history[] entry fields: at, from_status, to_status, by_employee_id, by_name, notes, storage_override.
- Verification history is stored only in verification_json.history[] (no separate audit log/report for item verification).
- When storage_override is set for the first time on any item, append a shipment timeline entry (event_type="storage_location_set").
- Kiosk/field devices can post verification with device credentials + employee_id.
- UI allows verification only when status is Picked Up or Archived; server rejects verification updates otherwise.
- Inline verification updates are saved immediately via /api/shipments/:id/verify-items.

### Shipment Templates
- Legacy UI had a Templates tab stub but no backend; rebuild adds functional templates.
- Templates are per org and editable by admins with see_shipments.
- Save current shipment form as a template (name required).
- Stored fields: name, title, vendor_id, freight_forwarder, destination, project_id, sku, quantity, total_price, price_per_item, website_url, notes, plus optional line items.
- Line item fields: description, sku, quantity, unit_price, line_total, vendor_name.
- Applying a template pre-fills the new shipment form; it does not auto-create a shipment.
- Templates include line items when saved; they do not include payments, verification, storage, or documents.

### Shipment Verification Report
- Summary mode (no shipment_id): filters by project, status, and created_at date range.
- Archived shipments are excluded by default; if status=Archived is selected, return archived shipments only.
- Optional ready-for-pickup filter: items_verified=1, picked_up_by blank, status "Cleared - Ready for Pickup".
- Sorted newest-first by updated_at (fallback created_at), then id.
- Filters UI: start date, end date (created_at), status, project, and a Ready for Pickup toggle.
- Defaults: date range prefilled to the last 30 days; Ready for Pickup is off by default.
- Column picker with defaults and available fields (Details button is always included):
  - BOL -> bol_number.
  - Internal Ref # -> sku.
  - Project -> "{customer_name} - {project_name}".
  - Title -> title.
  - Status -> status.
  - Items Verified? -> items_verified (all items have status not empty/unverified).
  - Freight Forwarder Paid -> shipper_paid; Amount -> shipper_paid_amount.
  - Customs Paid -> customs_paid; Amount -> customs_paid_amount.
  - Vendor Paid -> vendor_paid; Amount -> vendor_paid_amount.
  - Total Paid -> total_paid.
  - Tracking # -> tracking_number.
  - Freight Forwarder -> freight_forwarder.
  - Vendor -> vendor_name.
  - Picked Up By -> picked_up_by.
  - Pickup Date -> picked_up_date.
- Amount columns (paid amounts + total_paid) are visible only with view_payroll; others see Paid/Unpaid only.
- Summary payload includes items_total and items_verified_count (count of items with status not empty/unverified).
- Detail mode (shipment_id): returns shipment + items with verification metadata (status, notes, verified_by, verified_at, storage_override, history array).
- Clicking a row toggles an inline details section with the item verification table.

### Settings
- Company info: company_name, company_email (used for branding + email sender).
- Password change.
- Access control matrix (super admin only).
- Time exception rules + thresholds (org_settings.time_exception_rules).
- Payroll rules (pay period + overtime; super admin only; org_settings.payroll_rules).
- Clock-in photo requirement (org-level, super admin only; org_settings.clock_in_photo_required; replaces legacy kiosk_require_photo).
- Audit log retention days (org-level, super admin only; org_settings.audit_log_retention_days; blank/0 = retain forever).
- Shipment settings (default daily late fee: org_settings.storage_daily_late_fee_default; default is null/0 until set).
- Notification settings.
- Kiosk enrollment code (super admin only): view/copy/rotate; rotation affects new enrollments only and does not invalidate existing devices.
- Enrollment code is stored in org_settings.kiosk_enrollment_code (6-digit numeric; normalize by stripping non-digits).
- Org settings store access rules, exception rule toggles, and org profile fields (name/email); org timezone is stored on `orgs`.
- Legacy settings workers_see_shipments/workers_see_time are removed; use permissions instead.

## Kiosk (Worker)
- Employee select with language selector; list includes workers with worker_timekeeping and kiosk admins (admins always shown).
- PIN flow (existing or create new 4-digit PIN; PIN is per employee across kiosks in the org).
- PIN validation uses cached pin_hash for offline use; incorrect PIN shows an error and returns to selection (no lockout).
- PIN creation requires enter + confirm (4 digits); attempt online save, else queue locally and allow punch; admin reset uses allowOverride.
- Language defaults to employee.language (fallback `en`); the language buttons apply a per-session override scoped to the selected employee.
- Manual overrides reset after a punch or when a different employee is selected; they do not persist unless updated in the employee profile.
- PIN changes after initial set require an admin reset.
- Photo capture is required on clock-in only when org setting is enabled by a super admin.
- If photo is required and the camera is unavailable, block the punch and show an error.
- Clock in/out uses a single action; mode is determined server-side by whether the employee already has an open punch.
- Kiosk UI may call `/api/kiosk/open-punch` to set button state; if offline, default to clock-in.
- Clock in/out requires an active kiosk timesheet for the punch date/time on this device + project (set by kiosk admin). Offline punches sync using the original project and are accepted if a timesheet was active at the punch time; later project switches do not block sync. If no matching timesheet exists, show an error and prompt for admin PIN; if the PIN is a kiosk admin, route to Start Day with an optional "clock me in" checkbox.
- Worker screen shows a prominent Active Project banner; when admins switch active timesheets, show a confirmation.
- Punch payload includes client_id (idempotency), device_timestamp (device clock), optional lat/lng + photo, and device_id + device_secret.
- Clock-in: create a time_punch, attach foreman-of-day if set, compute geofence distance for kiosk clock-ins and flag violations (never block); store photo (JPEG) as clock_in_photo_path when provided.
- Clock-out: close the open punch, capture clock-out lat/lng, and create a time entry using the employee rate; duration rounds up to the next minute; clock-out always uses the original punch project (no cross-project clock-out).
- Offline queue with sync on reconnect; duplicate client_id returns alreadyProcessed without side effects.
- Admin long-press entry to kiosk admin login.
- Kiosk admin login uses the admin’s employee PIN and requires kiosk_admin_access.
- Device registration: if the device is not enrolled, show the enrollment screen and require only the org enrollment code.
- Kiosk name/location are optional and can be set later by a super admin in the admin console.
- The kiosk ID/device_id is shown only in the kiosk Settings screen for reference.
- Enrollment is required to create a kiosk record; unknown device_id with no enrollment_code returns an error (no placeholder kiosk creation).
- If device_secret is missing or mismatches for an enrolled device, the server returns 400/403 and requires re-enrollment with the org enrollment code (device_secret is never returned on mismatch).
- Enrollment is blocked for orgs with status != active (return 403).
- device_id is generated locally and reused; device_secret is returned by the server and stored on the device for offline auth.
- Kiosk uses the org timezone returned by registration for all “today” calculations (timesheets, daily UI).
- The kiosk can re-check-in using device_id + device_secret to refresh kiosk config and timesheets; enrollment code is only needed for first-time enrollment or to re-key the device.
- device_id is globally unique; a device cannot be enrolled into multiple orgs.
- Pending PIN updates queued when offline.
- GPS use is optional; missing GPS never blocks clock-in/out.

### Worker Clock-In Flow (First-Time vs Returning)
- New kiosk enrollment (device not enrolled): show enrollment screen (org enrollment code only). Enrollment is required before any clock-in/out; offline enrollment is blocked.
- First-time worker (no PIN set): select name → create 4-digit PIN (enter + confirm) → if required, capture photo → clock-in/out button. If offline, queue PIN update locally and allow the punch.
- Returning worker: select name → enter PIN → if required, capture photo (clock-in only) → clock-in/out button. If offline, queue punch and sync on reconnect.
- If no active timesheet for today: show an error → prompt admin PIN → Start Day flow (project select + optional "clock me in" for kiosk admins).
- If offline and no cached active timesheet: block punch with a clear "Start Day requires online access" message.

## Kiosk Admin
### Timesheets
- Start new timesheet for device (select project); new timesheet becomes the active timesheet for new punches.
- Timesheets can only be started for today (past dates are blocked in kiosk admin).
- Starting a timesheet checks kiosk GPS against the project geofence when available; if outside, require confirmation and flag the session so all associated time entries show geofence exceptions.
- Optional "clock me in now" on Start Day creates the timesheet and immediately clocks the admin in.
- Multiple open timesheets can exist (one per project); starting a new one does not close earlier ones. Duplicate open timesheets for the same project on the same kiosk/day are rejected by the server.
- Admin can switch the active timesheet; switching only affects new punches.
- Admin can close a timesheet once all punches are clocked out; closing clears the kiosk’s active project and requires a new timesheet to resume work on that project.
- Closed timesheets are read-only (cannot be set active or reassigned); admins are prompted to close when the last punch clocks out.
- Active timesheet is highlighted and labeled "Active" in the list; switching prompts confirmation.
- If no open timesheet exists for today, kiosk refresh clears the active project so workers see "No active timesheet."
- Live workers table (per kiosk): list today’s punches for the kiosk device with clock-in/out times and “time on clock”.
- Live workers defaults to the active timesheet’s project; can view other projects with punches on this kiosk.
- Open punches (no clock_out_ts) are highlighted as “active”; previous-day open punches are flagged for admin follow-up.
- Timesheet filters (active, today, range).
- Foreman-of-day assignment (per kiosk + date), with set_by audit trail.
- If no foreman is set yet, the first employee to clock in auto-sets the foreman for that day.
- Foreman is stored on punches/time entries for reporting.
- Admin can view prior timesheets by date range.
- Timesheets record `created_by_employee_id` for audit.
- Timesheets can optionally store `assigned_to_employee_id` to track the admin responsible for the session.
Note: "Timesheet" is the UI name for a kiosk_session in the API/database.

### Time Entries
- Date range presets + custom.
- Approve/modify/reject entries.
- Paid entries locked from edits.
- Optional toggles for pay info and hide resolved.
- Requires modify_time permission; pay visibility requires view_payroll.

### Shipments
- Status/project filtered list.
- Item verification modal.
- Document viewer.
- Visible only for admins with see_shipments permission.
- Kiosk admin can verify items and optionally update pickup info if allowed.

### Settings
- Change PIN, language (en/es/ht), name on checks.
- Rate editor with PIN unlock (admin PIN; server-verified).
- Unlock applies to the current kiosk admin session and refreshes on each rate action.
- Rate edits are online-only (not queued offline).
- Kiosk rate editor lists all active employees (including pending/unlinked).
- Employee onboarding: capture ID image + name for new workers (no parsing).
- Notification preferences (shipment reminders + clock-out alerts + push/email toggles).
- Show kiosk ID/device_id in Settings (not in headers) for support and admin reference.
- Sign out.
- Rate unlock expires after 10 minutes of inactivity.

## Notifications
- In-app notifications feed (always on): stored in notifications; GET /api/notifications lists newest-first; mark-read updates read_at.
- Web Push (PWA) for phone notifications (VAPID keys + user opt-in).
- Email via Google Workspace SMTP (enabled at launch).
- SMS disabled by default.
- Event-driven notifications (shipments status changes, payroll runs, time exceptions) create in-app rows immediately; push/email send immediately if enabled.
- Per-admin preferences in notification_prefs (managed in Settings via /api/notifications/prefs). Use a single Notifications screen with global channel toggles + category filters:
  - Channel toggles: email_enabled, push_enabled.
  - Filters JSON (category toggles + optional filters):
    - shipment_filters_json: `{ enabled: true, statuses: [], project_ids: [] }`
    - payroll_filters_json: `{ enabled: true, event_types: [] }`
    - time_filters_json: `{ enabled: true, event_types: [] }`
  - Schedules: remind_time + remind_every_days (org timezone).
  - Clock-out alerts: clockout_enabled + clockout_time (org timezone).
- Shipment reminders use shipment_notification_prefs filters (status/project/shipment), but deliveries still respect email/push toggles and category filters from notification_prefs.
- Per-channel on/off toggles act as a global opt-out for that channel.
- Store push subscriptions per user/device; allow revoke from Settings; browser permission required for push alerts.
- GET /api/notifications/prefs returns push_public_key so clients can subscribe to push.
- notification_deliveries logs per-channel attempts and errors.
- Time notification event_types (time_filters_json): TIME_EXCEPTION_OPEN, TIME_EXCEPTION_REVIEWED, TIME_EXCEPTION_RESOLVED, TIME_ENTRY_MANUAL_CREATED, TIME_ENTRY_MANUAL_EDITED.
- Payroll notification event_types (payroll_filters_json): PAYROLL_RUN_DUE, PAYROLL_RUN_STARTED, PAYROLL_RUN_SUCCESS, PAYROLL_RUN_PARTIAL, PAYROLL_RUN_FAILURE, PAYROLL_FATAL_ERROR, PAYROLL_QBO_ERROR, PAYROLL_UNPAY.
- Daily summaries use remind_time/remind_every_days: send counts of open time exceptions and payroll runs due (if enabled in filters).
- Recommended defaults: time_filters enabled with TIME_EXCEPTION_OPEN; payroll_filters enabled with PAYROLL_RUN_DUE + PAYROLL_RUN_FAILURE + PAYROLL_QBO_ERROR + PAYROLL_FATAL_ERROR.

## Timekeeping Rules (legacy defaults)
- Missing clock-out.
- Long shift > 12h.
- Multi-day >= 24h.
- Crosses midnight.
- No project selected.
- Clock-out project differs.
- Tiny punch < 5 min.
- Weekly hours threshold default 50h (configurable per org; super admin can set or disable).
- Auto clock-out thresholds (configurable per org; super admin can set or disable):
  - daily_max_hours (auto clock-out + discrepancy flag when exceeded).
  - weekly_max_hours (auto clock-out + discrepancy flag when exceeded).
- Geofence clock-in mismatch and timesheet geofence mismatch (flag only; do not block punches).
- Auto clock-out (midnight job + hourly catch-up).
- Manual entry with no punches.
- Manual vs punches mismatch (epsilon 0.10h).

## Payroll Rules
- Stored in org_settings.payroll_rules (JSON).
- pay_period_length_days (int, default 7; max 31).
- pay_period_start_weekday (0=Sun..6=Sat) used when length_days == 7; default 1 (Monday).
- pay_period_anchor_date (YYYY-MM-DD) required when length_days > 7 (start of a known period).
- Payroll periods are computed in the org timezone; start/end dates are inclusive.
- Overtime rules are configurable per org and used to classify overtime hours.
- overtime_enabled (bool, default false).
- overtime_daily_threshold_hours (default 8) and overtime_weekly_threshold_hours (default 40) apply when enabled.
- overtime_multiplier (default 1.5) applies to overtime hours when enabled.
- Overtime calculation (when both daily + weekly are enabled): compute daily overtime first, then apply weekly overtime to remaining regular hours above the weekly threshold (no double counting).
- Optional double-time (org setting): double_time_enabled (default false), double_time_daily_threshold_hours (default 12), double_time_multiplier (default 2.0).
- Double-time hours supersede overtime hours (no double counting); apply double-time first, then overtime, then weekly.
- Super admins control payroll_rules in Settings.

## Time Exception Rules (Settings)
- Stored in org_settings.time_exception_rules (JSON).
- Toggle keys for each exception rule (missing_clock_out, long_shift, multi_day, crosses_midnight, no_project, project_mismatch, tiny_punch, geofence_clock_in, auto_clock_out, manual_no_punches, manual_hours_mismatch, weekly_hours).
- weekly_hours_threshold: numeric hours for weekly discrepancy flag; null/0 disables.
- auto_clockout_daily_max_hours: numeric hours for daily auto clock-out + discrepancy; null/0 disables.
- auto_clockout_weekly_max_hours: numeric hours for weekly auto clock-out + discrepancy; null/0 disables.
- If thresholds are unset, only midnight/catch-up auto clock-out runs.

## Shipments Statuses (legacy)
- Pre-Order
- Ordered
- In Transit to Forwarder
- Arrived at Forwarder
- Sailed
- Arrived at Port
- Awaiting Clearance
- Cleared - Ready for Pickup
- Picked Up
- Archived

## Offline Sync
- PWA + service worker for offline assets and cache updates (manifest + install support).
- Cache strategy: app shell + static assets with stale-while-revalidate; data caches include employees, projects, current timesheets, shipment summaries, last viewed shipment details.
- Cache TTL: mark data stale after 24h; show "stale data" banner when rendering cached lists.
- Offline indicator + pending-sync counter in kiosk/admin headers.
- If an org is suspended, kiosks block once they can reach the server; fully offline devices may continue using cached data until they reconnect.
- Queue storage: IndexedDB preferred; localStorage fallback for small queues.
- Queue: punches, PIN updates, time edits, shipment verification, shipment comments, settings changes.
- Offline storage requires IndexedDB on kiosk devices; if unavailable, block offline punches/PINs and show an error.
- Background sync attempts on reconnect + periodic retry (30s); exponential backoff per item.
- Idempotency: client_id per action; server dedupes using idempotency_keys (org_id + scope + client_id) and returns alreadyProcessed without side effects.
- Conflict resolution: updates that include if_match_updated_at and are stale return 409 + current server snapshot; client logs conflict and prompts for manual reapply.
- Push subscriptions cached per device for offline continuity.

### Offline Queues (Rebuild)
- Kiosk punches queue (`avian_kiosk_offline_punches_v1`): array of `{ client_id, employee_id, project_id, lat, lng, device_timestamp, photo_base64, device_id, device_secret, queued_at }` synced to `POST /api/kiosk/punch`.
- Kiosk pending PIN queue (`avian_kiosk_pending_pins_v1`): array of `{ client_id, employee_id, pin, created_at, device_id, device_secret }` synced to `POST /api/employees/:id/pin` with `allowOverride=true` (PIN is 4-digit numeric; clear locally after success).
- Kiosk time edit queue (`avian_kiosk_time_edit_queue_v1`): array of `{ client_id, time_entry_id, payload, queued_at, employee_id, device_id, device_secret }` synced to `POST /api/time-entries/:id` (payload matches the edit request; note required). If `time_entry_id` is blank, treat as a create and sync to `POST /api/time-entries`. `employee_id/device_id/device_secret` are included for kiosk-originated edits and may be omitted for session-based admin edits.
- Kiosk time exception review queue (`avian_kiosk_time_review_queue_v1`): array of `{ client_id, exception_id, payload, queued_at, employee_id, device_id, device_secret }` synced to `POST /api/time-exceptions/:id/review` (payload matches the review request; note required).
- Kiosk admin shipment verification queue (`avian_kiosk_verify_queue_v1`): array of `{ client_id, shipment_id, items: [ { shipment_item_id, verification } ], queued_at, employee_id, device_id, device_secret }` synced to `POST /api/shipments/:id/verify-items`.
- Kiosk shipment comments queue (`avian_kiosk_shipment_comment_queue_v1`): array of `{ client_id, shipment_id, body, queued_at, employee_id, device_id, device_secret }` synced to `POST /api/shipments/:id/comments`.
- Shipments admin update queue (`avian_shipments_update_queue`): array of `{ id, client_id, if_match_updated_at, payload, queued_at }` where `payload` matches `PUT /api/shipments/:id`; new shipment creation and document uploads are blocked while offline.
- Settings changes queue (`avian_settings_update_queue_v1`): array of `{ client_id, type, payload, queued_at }` where `type` is `notifications_prefs` or `shipments_notifications` and payload matches the corresponding `PUT /api/notifications/prefs` or `PUT /api/shipments/notifications`.
- Shipments board cache (`avian_shipments_board_cache`): `{ at, data }` snapshot used to render the board when offline.
- Sync behavior: attempt on `online` plus a 30s retry loop; remove on success; keep on network/auth errors; drop on hard validation errors (example: missing timesheet) to avoid blocking the queue.

## QuickBooks
- OAuth with token encryption and connection status endpoint.
- Tokens are stored per org (qbo_tokens) with realm_id from the OAuth callback.
- Access tokens refresh on demand; failures require reconnect.
- Disconnect clears tokens for the org (no automatic unlink of employees/vendors/projects).
- Sync is manual (Sync Now) and requires an active QBO connection; no scheduled syncs.
- Store last sync timestamps per entity in org_settings (qbo_last_sync_employees_at, qbo_last_sync_vendors_at, qbo_last_sync_projects_at, qbo_last_sync_payroll_accounts_at, qbo_last_sync_employee_updates_at).
- Sync is idempotent and safe to repeat; no background auto-retry for sync jobs.
- Sync operations are not atomic; partial updates can occur if a run fails mid-way (rerun to reconcile).
- Sync endpoints should be single-flight per org (DB-backed lock); concurrent sync requests return 409 "Sync already in progress".
- Error handling: if QBO returns 401/403, clear tokens and show disconnected; if 429 or 5xx, surface a retryable error and back off (example: 10s → 30s → 2m); honor Retry-After when present.
- Employee sync: upsert by employee_qbo_id; updates name, given_name, family_name, active, and name_on_checks; email is not synced from QBO. Preserves rate, access flags, PIN, language, and worker_timekeeping; new QBO employees default to rate 0, worker_timekeeping=true, language=en. Pulls active + inactive employees and paginates results. If local fields are dirty, skip overwrite and record conflicts when QBO changed since last sync.
- Vendor sync: upsert by qbo_id; updates name + active; preserves freight_forwarder flag and PIN; local-only vendors untouched. Pulls active + inactive vendors and paginates results.
- Project sync: upsert by qbo_id; updates name + customer_name + active; preserves geofence/timezone; QBO inactive or missing projects are set inactive. Pulls active + inactive customers/jobs and paginates results.
- Payroll account/class sync: live fetch for dropdowns; no DB writes.
- Create checks with per-employee error handling.
- Employee outbound updates: manual only (desktop admin runs “Sync changes to QBO”); pushes given_name, family_name, and name_on_checks. Conflicts must be resolved before payroll.
- Account options fetched for payroll settings (bank/expense).

## Security
- PINs hashed; only hashes returned to enrolled kiosks for offline validation; never return raw PINs.
- Server-side RBAC checks.
- Device secret required for kiosk endpoints.
- Uploads stored outside public root; allowlist PDF/images only.
- Sessions and QBO tokens encrypted at rest.
- Passwords hashed (bcrypt).
- Session cookies are httpOnly; sameSite strict in production (lax in dev); secure in production.
- CSRF for session-backed endpoints: cross-origin clients must echo `X-CSRF-Token` on state-changing requests; same-origin browser use should work without extra headers.
- ID document images stored outside public root; access limited to desktop admins.

## Retention
- Clock-in photos: 30 days (purge daily).
- Audit logs (audit_log, time_exception_actions, payroll_audit_log): retained indefinitely by default; per-org `org_settings.audit_log_retention_days` (positive integer) enables purging older entries; unset/0 means no purge (purge job runs daily only when set).
- In-app notifications + delivery logs: 90 days (configurable; purge monthly).
- Idempotency keys: 30 days (purge weekly).
- ID document images: retained until manually deleted; delete clears id_document_* fields even if the file is already missing.
- Shipment documents: retained until manually deleted; archiving does not remove docs; missing files return 404 on download and can be removed via delete.
- Retention windows are configurable via env: NOTIFICATION_RETENTION_DAYS, PHOTO_RETENTION_DAYS, IDEMPOTENCY_RETENTION_DAYS.

## System Jobs
- Auto clock-out at midnight with hourly catch-up.
- Auto clock-out behavior:
  - Runs at org-local midnight (orgs.timezone); catch-up runs hourly and on restart.
  - Closes open punches where clock_out_ts is null and clock_in_date is before today (org timezone).
  - If auto clock-out thresholds are set, also closes open punches that exceed daily_max_hours or push the employee over weekly_max_hours.
- For midnight/catch-up closes, sets clock_out_ts to org-local end-of-day (23:59:59) of the clock-in date to avoid cross-day entries; auto_clock_out=1, auto_clock_out_reason = "midnight_auto" or "catch_up_auto", and clock_out_project_id = project_id.
- For threshold-based closes, clock_out_ts is the job run time and auto_clock_out_reason = "daily_max" or "weekly_max".
  - Creates a time_entry linked to the punch (time_entry_id), with start_date/end_date from clock_in/clock_out dates, hours rounded up to the next minute, and total_pay from the employee rate.
  - Leaves lat/lng empty for auto clock-out; exceptions will include the auto clock-out flag.
  - Uses a per-org DB lock (auto_clockout_lock) with a short TTL to prevent concurrent runs across instances; the lock is refreshed during long runs and expires automatically if a job crashes.
- Name on checks retry queue processor (QBO sync):
  - Disabled for employee name fields; QBO updates happen only on explicit admin sync.
- Photo purge job: daily delete of clock-in photos older than 30 days; DB rows keep references but file_path becomes null if the file is missing.
- Payroll retry handling (manual):
  - No background retry job; admin triggers retry from Payroll UI.
  - Retry uses the same start/end period and attaches to originalPayrollRunId.
  - Use fromAttemptId to auto-retry only failed employees from a prior attempt; otherwise pass onlyEmployeeIds manually.
  - Retry preflight must match the failed-employee subset: when using fromAttemptId, the request must include onlyEmployeeIds matching the failed list (otherwise return 409 with the failed IDs).
  - Retries replace payroll_checks for the targeted employees and mark their time entries paid only on success.
  - If QBO auth fails (401/403), require reconnect before retry; if QBO is rate-limited or unavailable, show a retryable error and honor Retry-After when present.
- Backups (optional):
  - Daily full backup (server scheduler or external cron); run an on-demand backup before payroll create checks.
  - Retention default: keep last 30 daily backups plus 12 monthly snapshots (configurable).
  - Include DB + upload storage (shipment documents, ID images, clock-in photos).
  - Use SQLite backup API when available; otherwise fall back to VACUUM INTO. If both fail, the backup fails (no unsafe file copy).
  - Backup failures are logged; payroll create-checks continues but returns a warning if the pre-check backup fails.
  - Super admin can trigger a manual "Backup Now" from Settings (POST /api/admin/backup); it uses the same job lock and returns a lock-busy error if another backup is running.
  - Restore expectations: support a full restore into a new environment; restore is not partial per-tenant.
  - Verify backups monthly (test restore to a staging folder + integrity check).
- Job locking (multi-instance safety):
  - Scheduled jobs that can cause duplicate work (notifications, backups, name-on-checks retries) use a shared DB lock (job_locks) with TTL + refresh while running.

## Multi-Tenant
- All data scoped by org_id.
- Org-level settings for payroll rules, notifications, and branding (stored in `org_settings`); org timezone is stored on `orgs`.
- Super admins manage org membership.
- Users can belong to multiple orgs via membership; active org is selected at login.

## Migration Plan
- Export legacy DB.
- Map entities to new schema.
- Validate payroll totals and shipments.
- Migrate shipment-level storage_room/storage_details into each shipment item’s verification.storage_override (same value for all items), then drop the shipment-level fields.
- Parallel run for one payroll cycle.
- Cutover with backup.

## Screen Inventory (Legacy + Spec)
### Core Pages
- Auth: Sign In + Bootstrap (first org only) + Org selection (if multiple orgs) (/auth).
- Admin Console Shell (/).
- Kiosk Worker (/kiosk).
- Kiosk Admin (/kiosk-admin).

### Admin Console Sections (within /)
- Admin Home.
- Employees.
- Vendors.
- Projects.
- Kiosks (device list/detail; detail shows kiosk ID/device_id for super admins).
- Shipments Board.
- Review Time Entries.
- Time Entries Report.
- Timesheets (kiosk admin view).
- Payroll.
- Payroll Reports.
- Shipment Verification Report.
- Settings (company info, access control, admin accounts, payroll rules, time exception rules).

### Kiosk Worker Screens (/kiosk)
- Enrollment / device setup (enter enrollment code only; required if the device is not enrolled).
- Main clock-in/out screen (employee select + project status).
- PIN entry / PIN creation flow.
- Photo capture flow.
- Success/confirmation overlay.
- Admin login modal (long-press entry point).
- Offline sync status banner (implicit in flow).

### Kiosk Admin Screens (/kiosk-admin)
- Timesheets view (active timesheet selector + open timesheets + live workers).
- Time Entries report (filters + table + edit actions).
- Shipments list/verification view.
- Settings hub with sub-sections:
  - Language preferences
  - Change PIN
  - Name on checks
  - Rates unlock + editor
  - Notifications (shipments + clock-out alerts + email/push prefs)
  - Sign out

### Admin Console Modals / Overlays
- Employee detail/edit modal (profile: identity, access, permissions, PIN).
- Vendor edit/PIN modal.
- Project edit/geofence modal.
- Time Exception review modal.
- Time Entry detail/edit modal.
- Kiosk create/edit modal (allow rename).
- Shipment create modal.
- Shipment detail modal (Overview/Payments/Timeline/Documents/Comments).
- Shipment item verification modal.
- Success overlay.

### Kiosk Admin Modals / Overlays
- Shipment documents modal.
- Time entry action modal.
- Rate unlock modal.
- Start Day modal (project select, optional foreman, optional "clock me in").
- Return-to-kiosk confirmation modal.

### QuickBooks Flow
- QuickBooks connect status card (embedded on Employees/Vendors/Projects/Payroll).
- OAuth callback handling (server flow).
- Connect action redirects to Intuit OAuth and returns to the admin console with success/error status.

### Reports / Exports
- Time entries export (CSV/PDF).
- Payroll reports export (CSV) for the selected run (uses run details).
- Shipment verification report (custom columns).
