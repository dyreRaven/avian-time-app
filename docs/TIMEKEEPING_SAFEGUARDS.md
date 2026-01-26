# Timekeeping Safeguards

This checklist captures the core safeguards expected in a professional
timekeeping system and the current implementation status for this app.

## Implemented (core)
- Server-authoritative time for online punches (device time used only for offline sync).
- Kiosk punch idempotency via client_id plus short-window dedupe to prevent double taps.
- Intended-mode validation: clock-in requests do not auto-clock-out when an open punch exists.
- Clock-out requires an open punch; recent closed punches return already-processed.
- Single open punch per employee enforced by server open-punch checks.
- Active timesheet required for punches on a kiosk device (project match).
- Clock-in photo requirement enforced when configured.
- Geofence violations flagged on kiosk clock-ins and timesheet geofence checks (never block punches).
- Auto clock-out for stale/threshold punches to prevent unbounded open shifts.
- Manual time entry create/edit requires start/end times, hours match, and a note.
- Paid time entries are locked; edits reset approvals and are audited.
- Exception review actions are logged with before/after snapshots.
- RBAC and CSRF protection for session-based admin endpoints.

## Implemented (data integrity)
- Time entries created from punches populate start_time/end_time (HH:MM, org timezone).
- Hours are derived from punch duration and rounded up to the next minute.
- Time entry edits are constrained to single-day entries.
- Idempotency keys for manual time entry create/edit.

## Follow-ups (recommended)
- Detect and flag overlapping punches for the same employee.
- Add a max-age policy for offline punches (e.g., reject or flag entries older than N days).
- Add per-device punch rate limiting (soft throttle on excessive attempts).
- Backfill utility to repair legacy time_entries missing start/end times.
