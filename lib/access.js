// Admin access helpers and toggleable rule loading.
module.exports = function createAccessHelpers({ dbGet }) {
  const ACCESS_DEFAULTS = {
    see_shipments: true,
    modify_time: true,
    view_time_reports: true,
    view_payroll: true,
    modify_payroll: true,
    modify_pay_rates: false
  };

  async function loadAccessAdminMap() {
    const row = await dbGet('SELECT value FROM app_settings WHERE key = ?', ['access_admins']);
    if (!row || !row.value) return {};
    try {
      const parsed = JSON.parse(row.value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      console.warn('Failed to parse access_admins setting:', err.message);
      return {};
    }
  }

  async function getAdminAccessPerms(adminId) {
    const map = await loadAccessAdminMap();
    const raw = adminId ? map[adminId] || map[String(adminId)] : null;
    if (!raw) return { ...ACCESS_DEFAULTS };

    return {
      ...ACCESS_DEFAULTS,
      see_shipments: raw.see_shipments === true || raw.see_shipments === 'true',
      modify_time: raw.modify_time === true || raw.modify_time === 'true',
      view_time_reports: raw.view_time_reports === true || raw.view_time_reports === 'true',
      view_payroll: raw.view_payroll === true || raw.view_payroll === 'true',
      modify_payroll:
        raw.modify_payroll === true ||
        raw.modify_payroll === 'true' ||
        (raw.modify_payroll === undefined
          ? (raw.view_payroll === true || raw.view_payroll === 'true')
          : false),
      modify_pay_rates: raw.modify_pay_rates === true || raw.modify_pay_rates === 'true'
    };
  }

  async function loadExceptionRulesMap() {
    try {
      const row = await dbGet('SELECT value FROM app_settings WHERE key = ?', ['time_exception_rules']);
      if (!row || !row.value) return null;
      const parsed = JSON.parse(row.value);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) {
      console.warn('Failed to load exception rules map:', err.message);
      return null;
    }
  }

  return { getAdminAccessPerms, loadExceptionRulesMap };
};
