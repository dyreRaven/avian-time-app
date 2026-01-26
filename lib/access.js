// Admin access helpers and org-scoped settings loading.
module.exports = function createAccessHelpers({ dbGet }) {
  const ACCESS_DEFAULTS = {
    see_shipments: false,
    modify_time: false,
    view_time_reports: false,
    view_payroll: false,
    modify_payroll: false,
    modify_pay_rates: false
  };

  function coerceFlag(value) {
    return value === true || value === 1 || value === 'true' || value === '1';
  }

  async function getAdminAccessPerms({ employeeId, orgId }) {
    if (!employeeId || !orgId) return { ...ACCESS_DEFAULTS };

    const row = await dbGet(
      `
        SELECT
          e.org_id,
          p.see_shipments,
          p.modify_time,
          p.view_time_reports,
          p.view_payroll,
          p.modify_payroll,
          p.modify_pay_rates
        FROM employees e
        LEFT JOIN employee_permissions p
          ON p.employee_id = e.id
        WHERE e.id = ? AND e.org_id = ?
      `,
      [employeeId, orgId]
    );

    if (!row) return { ...ACCESS_DEFAULTS };

    return {
      ...ACCESS_DEFAULTS,
      see_shipments: coerceFlag(row.see_shipments),
      modify_time: coerceFlag(row.modify_time),
      view_time_reports: coerceFlag(row.view_time_reports),
      view_payroll: coerceFlag(row.view_payroll),
      modify_payroll: coerceFlag(row.modify_payroll),
      modify_pay_rates: coerceFlag(row.modify_pay_rates)
    };
  }

  async function loadExceptionRulesMap(orgId) {
    if (!orgId) return null;
    try {
      const row = await dbGet(
        'SELECT value FROM org_settings WHERE org_id = ? AND key = ?',
        [orgId, 'time_exception_rules']
      );
      if (!row || !row.value) return null;
      const parsed = JSON.parse(row.value);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) {
      console.warn('Failed to load exception rules map:', err.message);
      return null;
    }
  }

  async function getEmployeeAccessFlags({ employeeId, orgId }) {
    if (!employeeId || !orgId) return null;
    const row = await dbGet(
      `
        SELECT desktop_access, kiosk_admin_access, worker_timekeeping, active
        FROM employees
        WHERE id = ? AND org_id = ?
      `,
      [employeeId, orgId]
    );
    if (!row) return null;
    return {
      desktop_access: coerceFlag(row.desktop_access),
      kiosk_admin_access: coerceFlag(row.kiosk_admin_access),
      worker_timekeeping: coerceFlag(row.worker_timekeeping),
      active: row.active == null ? true : coerceFlag(row.active)
    };
  }

  async function getOrgStatus(orgId) {
    if (!orgId) return null;
    const row = await dbGet('SELECT status FROM orgs WHERE id = ?', [orgId]);
    return row ? row.status : null;
  }

  return {
    getAdminAccessPerms,
    loadExceptionRulesMap,
    getEmployeeAccessFlags,
    getOrgStatus
  };
};
