PRAGMA foreign_keys = ON;

ALTER TABLE time_punches ADD COLUMN clock_in_local_date TEXT;
ALTER TABLE time_punches ADD COLUMN clock_out_local_date TEXT;

UPDATE time_punches
SET
  clock_in_local_date = COALESCE(clock_in_local_date, substr(clock_in_ts, 1, 10)),
  clock_out_local_date = COALESCE(clock_out_local_date, CASE
    WHEN clock_out_ts IS NOT NULL THEN substr(clock_out_ts, 1, 10)
    ELSE NULL
  END);
