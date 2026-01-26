CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_org_qbo_id
  ON vendors(org_id, qbo_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_org_qbo_id
  ON projects(org_id, qbo_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_org_employee_qbo_id
  ON employees(org_id, employee_qbo_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_org_vendor_qbo_id
  ON employees(org_id, vendor_qbo_id);
