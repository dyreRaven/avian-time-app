# Time Exceptions & Auto Clock-Out Smoke Plan
Generated: 2026-01-28

Goal: Verify every time exception flag is produced correctly, timestamps are set,
and auto clock-out behaves as specified (including config gating).

## Test Environment
- Use a temporary DB (copy or fresh) to avoid touching production data.
- Set APP_TIMEZONE explicitly for deterministic dates.
- Ensure `time_exception_rules` enables each rule unless testing disabled behavior.
- Use org-local dates for expected results.

## Global Prechecks
- Create org + admin via bootstrap on the temp DB.
- Create:
  - 1 project with geofence (lat/lng/radius).
  - 1 project without geofence.
  - 1 kiosk + kiosk session for today.
  - 1 employee (timekeeping enabled).

## Flag Coverage Matrix
Each row should appear in `/api/time-exceptions` with the expected flag text.
Also confirm time-entry aggregates (`has_geo_violation`, `has_auto_clock_out`) via
`/api/time-entries` where applicable.

### Punch-based flags
1) Missing clock-out
   - Setup: punch with `clock_out_ts` NULL and `clock_in_local_date = yesterday`.
   - Expected: "Missing clock-out" flag.
   - Auto clock-out: **Yes** at midnight/catch-up for stale open punches.

2) Long shift (>12h)
   - Setup: punch duration 12h + 1m.
   - Expected: "Long shift (>12h)".
   - Auto clock-out: **No**.

3) Multi-day (>=24h)
   - Setup: punch duration 24h + 1m.
   - Expected: "Multi-day shift".
   - Auto clock-out: **No**.

4) Crosses midnight
   - Setup: punch where `clock_in_local_date != clock_out_local_date`.
   - Expected: "Crosses midnight".
   - Auto clock-out: **No**.

5) No project selected
   - Setup: punch with `project_id` NULL.
   - Expected: "No project selected".
   - Auto clock-out: **No**.

6) Clock-out project differs
   - Setup: punch with `project_id != clock_out_project_id`.
   - Expected: "Clock-out project differs from clock-in".
   - Auto clock-out: **No**.

7) Tiny punch (<5 minutes, including 0)
   - Setup: punch duration 0–4m59s.
   - Expected: "Tiny punch (<5 min)".
   - Auto clock-out: **No**.

8) Geofence clock-in mismatch
   - Setup: punch outside project geofence (clock-in lat/lng).
   - Expected: "Clock-in outside geofence".
   - Auto clock-out: **No**.

9) Kiosk outside geofence (timesheet)
   - Setup: kiosk session lat/lng outside project geofence.
   - Expected: "Kiosk outside geofence (timesheet)".
   - Auto clock-out: **No**.

10) Weekly hours threshold
   - Setup: enable weekly_hours + threshold, create enough punches in same week to exceed.
   - Expected: "Week of YYYY-MM-DD exceeds Xh (...)"
   - Auto clock-out: **No**.

11) Auto clock-out flag (midnight/catch-up/daily/weekly)
   - Setup: see auto clock-out section below.
   - Expected: "Auto clock-out (...reason...)"
   - Auto clock-out: **Yes**.

### Time-entry vs punch flags
12) Manual time entry with no punches
   - Setup: time_entry with no linked punches.
   - Expected: "Manual time entry with no punches".
   - Auto clock-out: **No**.

13) Manual hours mismatch
   - Setup: time_entry hours differ from sum of linked punches by >= 0.10h.
   - Expected: "Manual hours Xh vs punches Yh (Δ Zh)".
   - Auto clock-out: **No**.

## Auto Clock-Out Coverage
Validate job closes open punches and creates time entries with correct fields:
- `clock_out_ts` set
- `auto_clock_out = 1`
- `auto_clock_out_reason` set
- `clock_out_project_id = project_id`
- time_entry created (start/end date/time, hours, total_pay, foreman if present)

### Reasons
1) Midnight auto (stale open punch from prior day)
2) Catch-up auto (same as above, triggered on startup/hourly)
3) Daily max threshold (config set)
4) Weekly max threshold (config set)

## Config Gating Tests
For each rule, set it to false in `time_exception_rules` and confirm the flag
does NOT appear.

## Timestamp Integrity
- Verify `clock_in_local_date` and `clock_out_local_date` are correct in org TZ.
- Verify `time_entries.start_time/end_time` are populated for all created entries.
- Verify `time_entries.hours` rounded up to the next minute where applicable.

## Outputs to Capture
- `/api/time-exceptions` response rows for each case.
- `/api/time-entries` aggregated flags for affected entries.
- DB snapshots for auto clock-out (before/after).
