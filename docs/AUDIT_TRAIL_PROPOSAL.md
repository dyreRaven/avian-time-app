# Audit Trail Proposal (Draft)

Status: Implemented (audit logging + report views).
Owner: TBD

## Goals
- Provide a complete, professional-grade audit trail for privileged and sensitive actions.
- Make audits searchable and exportable with clear permissions and scope.
- Keep audit data append-only with retention aligned to policy.

## Principles
- Append-only: audit rows are never edited; only retention jobs purge by policy.
- Actor + subject: record who did it, what changed, and the target entity.
- Before/after snapshots for material changes (with redaction where needed).
- Reason required for high-risk actions (pay changes, payroll actions, access changes).
- Visible to the right roles: admins can only see audit domains they already have access to.

## Storage Model (Proposed)
Use existing specialized logs and add a consistent generic audit stream.

Existing tables (keep):
- `time_exception_actions`: **authoritative audit log for time entry changes** (all edits, reviews, approvals, verifies, resolves) with before/after + actor + note.
- `payroll_audit_log`: payroll run lifecycle + QBO errors.
- `shipment_timeline`: user-facing shipment status and key timeline events.
- `shipment_items.verification_json.history[]`: verification history.

Generic audit stream (use `audit_log`):
- `audit_log` stores cross-domain admin/security actions not covered above.
- Standardized `action` values (see taxonomy below).
- `before_json`/`after_json` for the fields that changed (redacted if needed).
- `note` used for user-provided reasons or required comments.

Proposed schema extension (optional but recommended):
- Add `metadata_json` to `audit_log` for request context:
  - ip, user_agent, device_id, source (desktop/kiosk/system), request_id, client_id
  - Avoid storing secrets or PINs.

## Audit Event Taxonomy (Proposed)
Format: `domain.action` for `audit_log.action`.
Examples:
- `auth.login.success`, `auth.login.failed`, `auth.logout`
- `user.create`, `user.disable`, `user.enable`, `user.reset_password`
- `employee.create`, `employee.update`, `employee.deactivate`, `employee.reactivate`
- `employee.rate.change`, `employee.pin.set`, `employee.pin.reset`
- `access.permissions.update`, `access.template.create`, `access.template.update`, `access.template.delete`
- `qbo.connect`, `qbo.disconnect`, `qbo.sync.start`, `qbo.sync.complete`, `qbo.link`, `qbo.unlink`
- `settings.update`, `settings.payroll_rules.update`, `settings.time_rules.update`
- `notification.pref.update`, `notification.push.subscribe`, `notification.push.unsubscribe`, `notification.test.sent`
- `kiosk.register`, `kiosk.update`, `kiosk.enrollment.rotate`
- `shipment.create`, `shipment.update`, `shipment.archive`, `shipment.payment.add`, `shipment.doc.add`, `shipment.comment.create`, `shipment.comment.thread.create`, `shipment.comment.delete`
- `report.export`

## Scope and Permissions
The goal is “professional app” coverage without overexposing data.

### Time Entry Audit Guarantees (Required)
- Every create/edit/verify/resolve/approve/send-back affecting a time entry is recorded.
- Each audit record includes: timestamp, actor (user/employee), action, before/after snapshot, and note when required.
- System-generated changes (auto clock-out, guardrails) are recorded with actor = system.
- Notes are never optional for actions that require justification (manual edits, unverify, resolve/unresolve, send-back).

Verification Checklist (for implementation QA):
- Create manual time entry → audit row includes before/after and note.
- Edit time entry → audit row includes before/after and note.
- Verify/unverify → audit row includes actor and note for unverify.
- Resolve/unresolve or send-back → audit row includes note and timestamps.
- Auto clock-out / guardrail changes → audit row with actor = system.

### 1) Auth & Security (audit_log)
Actions:
- Bootstrap signup + org creation
- Login success/failure, logout
- Password change/reset, email change
- Login enable/disable, session revocation
Permissions:
- Super admin only

### 2) Access & Permissions (audit_log)
Actions:
- Permission template create/update/delete
- Employee access toggles (desktop/kiosk/worker)
- Permissions changes (modify_time, view_payroll, etc.)
- Role title changes (if used for access labeling)
Permissions:
- Super admin only

### 3) Employee Data (audit_log)
Actions:
- Create/update/deactivate/reactivate
- Rate changes (requires reason)
- Name on checks changes (and QBO dirty fields)
- PIN set/reset (do not log PIN value)
- ID document upload/delete, photo upload/delete
- QBO link/unlink/create actions
Permissions:
- View payroll (for non-security changes)
- Super admin only for access changes and QBO link/unlink

### 4) Kiosk & Devices (audit_log)
Actions:
- Enrollment code rotate
- Kiosk register (device_id + enrollment)
- Kiosk create/update (name, location, project)
- Foreman-of-day set/unset
- Timesheet assign/share/close (optional: audit_log or time_exception_actions)
Permissions:
- View payroll for operational events
- Super admin for enrollment code rotation

### 5) Timekeeping (time_exception_actions + audit_log)
Requirement:
- **Every change to a time entry must be audited** with timestamp, actor, action, before/after snapshot, and note (when required by rules).
Actions:
- Manual time entry create/edit/verify/resolve/approve/send-back
- Exception review/resolve
- System auto clock-out or guardrail events (actor = system)
Permissions:
- View time reports or view payroll

### 6) Payroll (payroll_audit_log + audit_log)
Actions:
- Payroll run lifecycle (existing payroll_audit_log)
- Payroll settings updates (audit_log)
- Unpay/retry/override actions (audit_log + payroll_audit_log)
Permissions:
- View payroll for read access
- Modify payroll for action entries

### 7) Shipments (shipment_timeline + audit_log)
Actions:
- Create/update/archive/unarchive (audit_log)
- Status changes (shipment_timeline)
- Storage location set (timeline event + audit_log)
- Payments add/update/delete (audit_log)
- Documents upload/rename/delete (audit_log)
- Comments delete (audit_log)
- Item verification changes (verification_json.history)
Permissions:
- See shipments; view payroll required to see payment-related details

### 8) Settings & Notifications (audit_log)
Actions:
- org_settings changes (company name, email, storage defaults)
- time_exception_rules and payroll_rules changes
- notification prefs updates (optional)
- push subscribe/unsubscribe (optional)
Permissions:
- View payroll for settings; super admin for payroll/time rules

Notification Preferences (Proposed):
- Scope: per-admin user within an org. Preferences never affect global system alerts.
- Channels:
  - email_enabled (uses login email)
  - push_enabled (web push/APNs)
- Domains + filters:
  - shipments_enabled + shipment_statuses + shipment_projects (optional list)
  - time_enabled + time_event_types
  - payroll_enabled + payroll_event_types
- Schedules:
  - daily_summary_time (org-local time)
  - remind_every_days (integer)
  - clockout_reminders_enabled + clockout_time
- Audit payloads should capture before/after for the preference bundle with sensitive tokens redacted.

### 9) Reports & Exports (audit_log)
Actions:
- Export of time reports, payroll reports, shipment reports, audit reports
Payload:
- filters used, row count, export type (csv/pdf)
Permissions:
- Same as report permission

## Viewer Access
- Audit reports are separated into dedicated report pages (Time, Payroll, Operations, Security).
- Super admins: full audit log across domains (including access/security + QuickBooks).
- Non-super admins: limited audit views per domain based on existing permissions:
  - Time audits: view_time_reports or view_payroll
  - Payroll audits/actions: view_payroll
  - Shipments audits: see_shipments (payment details masked unless view_payroll)
- Payroll run audit log remains visible in Payroll Reports.

## Retention
- Audit logs are retained indefinitely by default.
- Each org can set `audit_log_retention_days` in Settings; when set to a positive integer, purge audit entries older than N days.
- Applies to `audit_log`, `time_exception_actions`, and `payroll_audit_log`. If unset/0, no purge occurs for audit logs.

## Redaction Guidelines
- Never store raw PINs, passwords, device secrets, or QBO tokens.
- For rate changes, store old/new numeric values but avoid embedding full employee records.
- For document actions, store file IDs and labels, not raw file contents.

## Implementation Sequence (Proposed)
Phase 1 (security + access):
- Implement `audit_log` helper with actor + metadata.
- Log auth/security and access/permission changes.

Phase 2 (core ops):
- Employee updates, kiosk/device ops, settings changes.
- Shipments updates outside timeline.

Phase 3 (reporting + exports):
- Audit log UI/report with filters + export.
- Export event logging.

## Open Items
- None (proposal accepted; proceed to implementation).
