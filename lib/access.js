// Admin access helpers and org-scoped settings loading.
module.exports = function createAccessHelpers({ dbGet }) {
  const ACCESS_DEFAULTS = {
    see_shipments: false,
    modify_time: false,
    approve_time: false,
    view_time_reports: false,
    view_all_timesheets: false,
    assign_timesheets: false,
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
          p.approve_time,
          p.view_time_reports,
          p.view_all_timesheets,
          p.assign_timesheets,
          p.view_payroll,
          p.modify_payroll,
          p.modify_pay_rates,
          uo.is_super_admin,
          uo.login_enabled
        FROM employees e
        LEFT JOIN employee_permissions p
          ON p.employee_id = e.id
        LEFT JOIN user_orgs uo
          ON uo.employee_id = e.id
         AND uo.org_id = e.org_id
        WHERE e.id = ? AND e.org_id = ?
      `,
      [employeeId, orgId]
    );

    if (!row) return { ...ACCESS_DEFAULTS };

    const isSuperAdmin = coerceFlag(row.is_super_admin) && coerceFlag(row.login_enabled);
    if (isSuperAdmin) {
      return {
        ...ACCESS_DEFAULTS,
        see_shipments: true,
        modify_time: true,
        approve_time: true,
        view_time_reports: true,
        view_all_timesheets: true,
        assign_timesheets: true,
        view_payroll: true,
        modify_payroll: true,
        modify_pay_rates: true
      };
    }

    const rawViewPayroll = coerceFlag(row.view_payroll);
    const rawModifyPayroll = coerceFlag(row.modify_payroll);
    const rawModifyPayRates = coerceFlag(row.modify_pay_rates);
    const viewPayroll = rawViewPayroll || rawModifyPayroll || rawModifyPayRates;
    const approveTime = coerceFlag(row.approve_time) || viewPayroll;
    const modifyTime = coerceFlag(row.modify_time) || approveTime;

    return {
      ...ACCESS_DEFAULTS,
      see_shipments: coerceFlag(row.see_shipments),
      modify_time: modifyTime,
      approve_time: approveTime,
      view_time_reports: coerceFlag(row.view_time_reports),
      view_all_timesheets: coerceFlag(row.view_all_timesheets),
      assign_timesheets: coerceFlag(row.assign_timesheets),
      view_payroll: viewPayroll,
      modify_payroll: rawModifyPayroll,
      modify_pay_rates: rawModifyPayRates
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
