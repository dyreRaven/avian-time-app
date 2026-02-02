ALTER TABLE employee_permissions
ADD COLUMN approve_time INTEGER NOT NULL DEFAULT 0;

-- Super admins should retain full time approval access.
UPDATE employee_permissions
SET approve_time = 1
WHERE employee_id IN (
  SELECT employee_id
  FROM user_orgs
  WHERE is_super_admin = 1
    AND login_enabled = 1
    AND employee_id IS NOT NULL
);

-- Ensure approve_time implies modify_time.
UPDATE employee_permissions
SET modify_time = 1
WHERE approve_time = 1;
