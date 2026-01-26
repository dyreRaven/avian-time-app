# Time Entry Integrity

Non-negotiable requirement: every time entry must include both clock-in and
clock-out times. This is core to trust, auditability, and payroll accuracy.

## Required fields (all time entries)
- start_date (YYYY-MM-DD, org timezone)
- end_date (YYYY-MM-DD, org timezone; same-day for standard entries)
- start_time (HH:MM, 24-hour, org timezone)
- end_time (HH:MM, 24-hour, org timezone)
- hours (numeric, derived from start/end or punches)

## Safeguards
- Server-side validation must block creation/update of time entries without
  start_time and end_time (no "—" placeholders).
- Punch-based entries must derive start_time/end_time from clock_in_ts/clock_out_ts
  using the org timezone and persist them on insert.
- Exception review and auto clock-out flows must also populate start_time/end_time.
- Edits that change timestamps must re-derive hours and update start/end times.
- UI should surface a clear error if a time entry is missing either time field.

## Source of truth
- Raw timestamps live on punches (clock_in_ts/clock_out_ts).
- Time entries must preserve the derived HH:MM values so reports are consistent
  and do not depend on client formatting.
