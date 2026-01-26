PRAGMA foreign_keys = ON;

ALTER TABLE kiosk_sessions ADD COLUMN geo_lat REAL;
ALTER TABLE kiosk_sessions ADD COLUMN geo_lng REAL;
ALTER TABLE kiosk_sessions ADD COLUMN geo_distance_m REAL;
ALTER TABLE kiosk_sessions ADD COLUMN geo_violation INTEGER NOT NULL DEFAULT 0;

ALTER TABLE time_punches ADD COLUMN kiosk_session_id INTEGER;
