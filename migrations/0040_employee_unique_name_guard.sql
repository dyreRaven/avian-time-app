-- Enforce one employee display name per org (case-insensitive, trimmed).
-- Before adding the unique index, normalize any existing duplicate rows so
-- migration can complete without dropping employee history.

UPDATE employees
SET name = 'Employee ' || id
WHERE trim(COALESCE(name, '')) = '';

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY org_id, lower(trim(name))
      ORDER BY id ASC
    ) AS rn
  FROM employees
)
UPDATE employees
SET name = trim(name) || ' #' || id
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_org_name_unique
  ON employees(org_id, lower(trim(name)));
