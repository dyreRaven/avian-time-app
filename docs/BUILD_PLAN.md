# Build Plan and UX Wireframes

Reviewed `docs/REBUILD_SPEC.md` and aligned the build plan to the spec and requested sequencing.

## Milestone Plan
1. Foundations
   - Repo scaffolding, env config, org/multi-tenant primitives, `org_settings` storage, baseline migrations (no dev seed; use bootstrap for first org).
2. Auth/RBAC
   - Bootstrap (org + admin first/last name), login, org selection, session/CSRF, permission enforcement, admin/user management.
3. Core data model + CRUD
   - Employees/Vendors/Projects, QBO link fields, admin access toggles, settings UI wiring.
4. Kiosk + offline core
   - Device enrollment, timesheets (`kiosk_sessions`), worker PIN flow, offline queues/idempotency/conflicts, PWA shell.
5. Timekeeping + exceptions
   - Punches, time entries, exception rules/review, audit trails, exports/time reports.
6. Shipments module
   - Board/list/detail, templates, documents, verification, payments, reports, offline kiosk queues.
7. Payroll + QBO
   - OAuth/connect/disconnect, sync, payroll settings, preflight/create checks, retry flows, audit logs, reports.
8. Notifications system
   - In-app feed, push/email prefs, shipment/time/payroll triggers, scheduled reminders.
9. System jobs + retention/backups
   - Auto clock-out, QBO name retries, photo purge, backup schedule/restore checks.
10. QA + rollout
   - Test plan (offline, payroll, QBO), migration rehearsal, parallel run, cutover checklist.

## Audit Trail Implementation Plan (Proposed)
Phase 0: Scope lock
- Approve `docs/AUDIT_TRAIL_PROPOSAL.md` (taxonomy, viewer permissions, redaction rules).
- Decide whether to add `metadata_json` to `audit_log` (ip, user_agent, device_id, source, request_id).
- Audit retention: default indefinite; per-org setting `audit_log_retention_days` controls purge window.

Phase 1: Core audit infrastructure
- Implement a single audit helper (actor + action + entity + before/after + note + metadata).
- Add/upgrade indexes on `audit_log` (org_id, created_at, entity_type/entity_id, action).
- Ensure system actions can write audit entries with actor = system.

Phase 2: Security + access coverage
- Auth events: login success/failure, logout, password/email changes, reset password.
- Access control changes: user enable/disable, permission templates, employee access toggles.
- Kiosk enrollment code rotation.

Phase 3: Core operations coverage
- Employees: create/update/deactivate/reactivate, rate changes, PIN set/reset, ID/doc uploads/deletes.
- QBO: connect/disconnect, link/unlink, sync start/complete.
- Settings: org settings, payroll rules, time exception rules.
- Projects: geofence/timezone updates.
- Shipments: create/update/archive, payments, docs, comments delete, storage location set.

Phase 4: Timekeeping completeness
- Ensure every time entry mutation writes to `time_exception_actions` (before/after + actor + note).
- Add audit entries for automated changes (auto clock-out, guardrails).

Phase 5: Reporting + UX
- Build audit log report with filters by domain, actor, date range.
- Add exports (CSV/PDF) and log the export actions.
- Enforce viewer permissions (super admin full; others by existing domain perms).

Phase 6: Retention + monitoring
- Ensure audit retention jobs respect per-org `audit_log_retention_days` (unset/0 => no purge).
- Add failure logging for audit writes (do not block requests; flag for review).

## Admin Console Wireframes
```text
+------------------------------------------------------+
| Top bar: Org switcher | QBO status card | User menu  |
+-------------+----------------------------------------+
| Left Nav    | Section content                        |
| Home        |                                        |
| Employees   |                                        |
| Vendors     |                                        |
| Projects    |                                        |
| Shipments   |                                        |
| Timesheets  |                                        |
| Time Exceptions |                                    |
| Payroll     |                                        |
| Reports     |                                        |
| Settings    |                                        |
+-------------+----------------------------------------+
```

Admin Home
- To-do tiles: unresolved exceptions, missing QBO links, shipments ready, payroll due, kiosks offline.
- Quick actions: sync QBO, run payroll, add shipment, create employee, create kiosk.
- In-app notifications feed.

Employees/Vendors/Projects
- Searchable tables, active/inactive toggles.
- Edit modals with QBO link fields and access toggles.
- Pending QBO links list with link action and conflict warnings.

Shipments
- Board + list views, filters and search (tracking/BOL/PO/title).
- Detail modal tabs: Overview, Payments, Timeline, Documents, Comments, Verification.
- Templates for quick creation.

Time & Pay
- Timesheets: kiosk sessions + live workers.
- Time Exceptions: review modal (approve/modify/reject with notes).
- Time Entry Report: filters + manual edits (note required).
- Payroll: settings, preflight, create checks, retry failed, unpay.

Reports/Settings
- Payroll Runs + Run Details + Audit Log.
- Shipment Verification report (summary/detail).
- Settings for company, access control, payroll rules, time exception rules, clock-in photo requirement,
  storage daily fee default, notifications, kiosk enrollment code.

## Auth Wireframes
Bootstrap (first org only)
```text
+------------------------------+
| Create Admin Account         |
| Email                        |
| Password                     |
| Confirm password             |
| Sign up                      |
+------------------------------+
```

```text
+------------------------------+
| Create Your Org              |
| Org name                     |
| Timezone                     |
| Admin first name             |
| Admin last name              |
| Create Org                   |
+------------------------------+
```

Sign In
```text
+------------------------------+
| Email                        |
| Password                     |
| Sign In                      |
+------------------------------+
```

Org Selection (multi-org only)
```text
+------------------------------+
| Choose an Organization       |
| [Org A] [Org B] ...          |
+------------------------------+
```

## Kiosk Worker Wireframes
```text
+------------------------------+
| Kiosk Header (org)           |
+------------------------------+
| Active project / status      |
| Employee list + search       |
| Language toggle (en/es/ht)   |
| PIN entry / Create PIN       |
| Photo capture (if required)  |
| Clock In/Out button          |
| Offline + pending sync badge |
+------------------------------+
```

Worker flow
- Enrollment on first use (org code only).
- Employee select -> PIN verify/create -> photo (if required) -> clock in/out.
- Offline queue for punches and PIN changes; show pending sync count.

## Kiosk Admin Wireframes
```text
+------------------------------+
| Admin PIN login              |
+------------------------------+
| Timesheets / Live Workers    |
| Time Entries                 |
| Shipments                    |
| Settings                     |
+------------------------------+
```

Start Day modal
```text
+------------------------------+
| Start Day                    |
| Project select               |
| Foreman (optional)           |
| [x] Clock me in now          |
| Start Day button             |
+------------------------------+
```

Admin flow
- Start day (select project) with optional "clock me in" and foreman assignment.
- Multiple open timesheets; admin switches the active one for new punches.
- Live workers list + open punches highlight.
- Time entry edits with notes, verify/resolve.
- Shipments verification + documents.
- Helper onboarding: capture ID + name -> pending list for super admin.
- Settings shows kiosk ID/device_id for reference.

## Validation Checklist (UX)
- Permissions gating matches spec and API contracts.
- Permission guardrails are immediate (revoked access takes effect right away).
- Money-related UI is fully hidden for non-payroll users (no disabled/greyed items).
- Payroll preflight surfaces missing QBO links before create checks.
- Kiosk worker cannot punch without active timesheet; admin flow to start day is clear.
- Offline queues cover punches, PINs, time edits, shipment verify/comments, and settings changes.
- Audit log views respect viewer permissions and redact restricted fields.

## QA + Rollout Plan
### Test Plan (pre-release)
- Auth/RBAC
  - Bootstrap first org, then login and org selection (multi-org user).
  - Verify kiosk-only admins redirect to kiosk and cannot access admin console.
  - Verify CSRF token flow on state-changing requests.
  - Verify auth/security actions write audit entries (login, logout, reset, enable/disable).
- Kiosk offline (core)
  - Enroll kiosk with org enrollment code.
  - Start day -> set active timesheet -> clock me in.
  - Punches offline (with and without photos); confirm queue, idempotency, and sync on reconnect.
  - PIN create/validate offline; ensure hash checks pass and syncs back.
  - Offline conflicts for time edits with if_match_updated_at (expect 409 and manual reapply).
  - Timesheet guardrails: block past-date starts, prevent duplicate open timesheets per project/day, and clear active project when no open timesheet exists today.
  - Active project change: when the kiosk active project changes mid-punch, worker screen shows the "active project changed" message and refreshes.
- Timekeeping + exceptions
  - Exceptions flagged per rules and grouped by category.
  - Approvals required before payroll; approve all and individually; notes required only when rules apply.
  - Auto clock-out: midnight, catch-up, daily_max, weekly_max; check org timezone boundaries.
  - Verify every time entry change writes a time audit row (create/edit/verify/resolve/send-back/approve).
- Shipments
  - Board/list/detail with status transitions and filters (tracking number search).
  - Line-item storage location set and timeline entry on first storage set.
  - Verification flow (kiosk admin) and report filters (last 30 days default).
  - Documents upload/download/delete; verify permissions and 404 on missing files.
  - Payment docs and money fields hidden without view_payroll; access denied on direct URLs.
  - Verify shipment edits/payments/docs/comments generate audit entries.
- Payroll + QBO
  - OAuth connect/disconnect; sync employees/vendors/projects/accounts/classes.
  - Preflight -> create checks with idempotency; block when missing QBO links or approvals.
  - Retry flows for partial failures; unpay behavior resets paid flags and paid_date.
  - Name-on-checks sync: change name, verify QBO update, backoff retry, stop after 7 days.
  - Verify payroll settings changes and unpay/retry actions generate audit entries.
- Notifications
  - In-app feed, mark-read, unread-only.
  - Email and push (VAPID) preferences; test notification delivery.
  - Scheduled reminders (shipments, time exceptions, payroll due, clock-out).
- Retention/Backups
  - Photo purge after 30 days; audit/notification/idempotency purge cadence.
  - Daily backup contains DB + secure_uploads; monthly snapshot retained.
  - Restore drill on staging with integrity check.
  - Audit retention: org with `audit_log_retention_days` set purges older entries; unset/0 retains indefinitely.

### Migration Rehearsal (legacy -> rebuild)
- N/A until legacy data exists.

### Parallel Run
- Operate legacy + rebuild for one payroll period.
- Compare time entry totals, payroll totals, and QBO check outputs.
- Validate shipments tracking, verification, and reports match legacy.

### Cutover Checklist
- Freeze legacy edits; take final backup.
- Run final migration; validate counts and totals.
- Enable rebuild production; verify QBO auth and sync status.
- Communicate cutover to admins; disable legacy write access (read-only).
- Monitor jobs and error logs for 48 hours.
