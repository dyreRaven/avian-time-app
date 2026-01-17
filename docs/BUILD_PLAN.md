# Build Plan and UX Wireframes

Reviewed `docs/REBUILD_SPEC.md` and aligned the build plan to the spec and requested sequencing.

## Milestone Plan
1. Foundations
   - Repo scaffolding, env config, org/multi-tenant primitives, `org_settings` storage, baseline migrations/seeding.
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
Bootstrap (first user only)
```text
+------------------------------+
| Create Your Org              |
| Org name                     |
| Timezone                     |
| Admin first name             |
| Admin last name              |
| Email                        |
| Password                     |
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
- Payroll preflight surfaces missing QBO links before create checks.
- Kiosk worker cannot punch without active timesheet; admin flow to start day is clear.
- Offline queues cover punches, PINs, time edits, shipment verify/comments, and settings changes.
