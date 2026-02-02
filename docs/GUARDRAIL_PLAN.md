# Guardrail Plan (Time Exceptions)
Generated: 2026-01-28

Purpose: keep exception flags as the audit signal while adding guardrails that
reduce bad data entry. Geofence remains advisory only (do not block punches).

Legend:
- Implemented = already enforced in current code.
- Proposed = recommended guardrail to add.

## Missing clock-out (open punch)
- Implemented: single open punch per employee enforced server-side.
- Implemented: clock-out reminders only fire when open punches exist and include open-punch count.
- Implemented: “still clocked in” warning after long duration (soft prompt) at kiosk PIN entry.

## Long shift (>12h)
- Implemented: soft warning + confirm on clock-out when shift exceeds 12 hours.
- Implemented: time notification events for long shifts (TIME_SHIFT_LONG).

## Multi-day shift (>=24h)
- Implemented: auto clock-out closes prior-day open punches.
- Implemented: open-punch notifications for 24+ hours (TIME_PUNCH_OPEN_MULTI_DAY).

## Crosses midnight
- Implemented: auto clock-out avoids cross-day open punches at midnight.
- Implemented: manual edits enforce same-day punch constraint.

## No project selected
- Implemented: kiosk punches require an active timesheet/project.

## Clock-out project differs from clock-in
- Implemented: kiosk clock-out uses original project.
- Implemented: manual punch edits enforce same in/out project.

## Tiny punch (<5 min, including 0)
- Implemented: short-window dedupe to prevent double taps.
- Implemented: “confirm clock-out” if on-clock duration < 5 minutes.

## Clock-in outside geofence
- Implemented: advisory flag on punch; no blocking.
- Implemented: UI warning on clock-in if outside geofence.

## Kiosk outside geofence at timesheet start
- Implemented: admin confirmation required to proceed (advisory).
- Implemented: show persistent “outside geofence” banner on that timesheet.

## Weekly hours exceed threshold
- Implemented: warning as employee approaches threshold (TIME_WEEKLY_THRESHOLD_NEAR).
- Implemented: notify when exceeded (TIME_WEEKLY_THRESHOLD_EXCEEDED).
- Note: no blocking; this is an audit/scheduling concern.

## Manual time entry with no punches
- Implemented: note required on manual time entry.
- Implemented: require super-admin permission when no punches exist for that date.

## Manual hours mismatch (≥ 0.10h)
- Implemented: note required on manual edits; approvals required before payroll.
- Implemented: block save when mismatch ≥ 0.25h unless super admin approves.

## Auto clock-out occurred
- Implemented: record auto clock-out reason on punch + time entry.
- Implemented: surface reason prominently in review UI.

## Auto clock-out reasons
- Implemented: midnight + catch-up close prior-day open punches.
- Implemented: daily/weekly max close open punches when thresholds are configured.
