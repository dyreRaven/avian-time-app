const DEFAULT_RULES = {
  pay_period_start_weekday: 1,
  overtime_enabled: false,
  overtime_daily_threshold_hours: 8,
  overtime_weekly_threshold_hours: 40,
  overtime_multiplier: 1.5,
  double_time_enabled: false,
  double_time_daily_threshold_hours: 12,
  double_time_multiplier: 2.0
};

function toNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toBool(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return (
    value === true ||
    value === 'true' ||
    value === 1 ||
    value === '1'
  );
}

function normalizePayrollRules(raw = {}) {
  const parsed = raw && typeof raw === 'object' ? raw : {};
  const startWeekday = Math.floor(
    toNumber(parsed.pay_period_start_weekday, DEFAULT_RULES.pay_period_start_weekday)
  );
  const safeWeekday =
    startWeekday >= 0 && startWeekday <= 6
      ? startWeekday
      : DEFAULT_RULES.pay_period_start_weekday;

  return {
    pay_period_start_weekday: safeWeekday,
    overtime_enabled: toBool(parsed.overtime_enabled, DEFAULT_RULES.overtime_enabled),
    overtime_daily_threshold_hours: toNumber(
      parsed.overtime_daily_threshold_hours,
      DEFAULT_RULES.overtime_daily_threshold_hours
    ),
    overtime_weekly_threshold_hours: toNumber(
      parsed.overtime_weekly_threshold_hours,
      DEFAULT_RULES.overtime_weekly_threshold_hours
    ),
    overtime_multiplier: toNumber(
      parsed.overtime_multiplier,
      DEFAULT_RULES.overtime_multiplier
    ),
    double_time_enabled: toBool(parsed.double_time_enabled, DEFAULT_RULES.double_time_enabled),
    double_time_daily_threshold_hours: toNumber(
      parsed.double_time_daily_threshold_hours,
      DEFAULT_RULES.double_time_daily_threshold_hours
    ),
    double_time_multiplier: toNumber(
      parsed.double_time_multiplier,
      DEFAULT_RULES.double_time_multiplier
    )
  };
}

function roundCurrency(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

function formatLocalDate(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getWeekStart(dateStr, startWeekday) {
  if (!dateStr) return null;
  const base = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(base.getTime())) return null;
  const day = base.getDay();
  const diff = (day - startWeekday + 7) % 7;
  base.setDate(base.getDate() - diff);
  return formatLocalDate(base);
}

function allocateProportional(entries, totalHours, getBase, assign) {
  if (!entries.length || totalHours <= 0) return;
  const bases = entries.map(getBase);
  const totalBase = bases.reduce((sum, val) => sum + val, 0);
  if (totalBase <= 0) return;

  let remaining = totalHours;
  entries.forEach((entry, idx) => {
    if (idx === entries.length - 1) {
      assign(entry, remaining);
      return;
    }
    const share = totalHours * (bases[idx] / totalBase);
    assign(entry, share);
    remaining -= share;
  });
}

function applyOvertimeAllocations(entries, payrollRules, includeOvertime = true) {
  const rules = normalizePayrollRules(payrollRules);
  const overtimeOn = includeOvertime && rules.overtime_enabled;
  const doubleOn = overtimeOn && rules.double_time_enabled;
  const dailyThreshold =
    Number.isFinite(rules.overtime_daily_threshold_hours) &&
    rules.overtime_daily_threshold_hours > 0
      ? rules.overtime_daily_threshold_hours
      : null;
  const weeklyThreshold =
    Number.isFinite(rules.overtime_weekly_threshold_hours) &&
    rules.overtime_weekly_threshold_hours > 0
      ? rules.overtime_weekly_threshold_hours
      : null;
  const doubleThreshold =
    doubleOn &&
    Number.isFinite(rules.double_time_daily_threshold_hours) &&
    rules.double_time_daily_threshold_hours > 0
      ? rules.double_time_daily_threshold_hours
      : null;

  entries.forEach(entry => {
    const hours = Number(entry.hours || 0);
    const basePay = Number.isFinite(Number(entry.total_pay)) ? Number(entry.total_pay) : 0;
    const baseRateCandidate =
      Number.isFinite(Number(entry.base_rate))
        ? Number(entry.base_rate)
        : hours > 0
          ? basePay / hours
          : Number(entry.employee_rate || 0);
    const baseRate = Number.isFinite(baseRateCandidate) ? baseRateCandidate : 0;

    entry.hours = hours;
    entry.base_rate = baseRate;
    entry.regular_hours = hours;
    entry.daily_ot_hours = 0;
    entry.weekly_ot_hours = 0;
    entry.double_time_hours = 0;
    entry.adjusted_pay = roundCurrency(basePay || baseRate * hours);
  });

  if (!overtimeOn) {
    return entries;
  }

  const byDay = new Map();
  entries.forEach(entry => {
    const dateKey = entry.entry_date || entry.start_date || entry.end_date || null;
    if (!dateKey) return;
    if (!byDay.has(dateKey)) byDay.set(dateKey, []);
    byDay.get(dateKey).push(entry);
  });

  for (const dayEntries of byDay.values()) {
    const totalHours = dayEntries.reduce((sum, e) => sum + Number(e.hours || 0), 0);
    if (totalHours <= 0) continue;

    const dayBaseHours = doubleThreshold != null ? Math.min(totalHours, doubleThreshold) : totalHours;
    const doubleHours = doubleThreshold != null ? Math.max(0, totalHours - doubleThreshold) : 0;
    const dailyOtHours = dailyThreshold != null ? Math.max(0, dayBaseHours - dailyThreshold) : 0;

    allocateProportional(dayEntries, doubleHours, e => e.hours, (e, alloc) => {
      e.double_time_hours += alloc;
    });
    allocateProportional(dayEntries, dailyOtHours, e => e.hours, (e, alloc) => {
      e.daily_ot_hours += alloc;
    });

    dayEntries.forEach(e => {
      const used = e.double_time_hours + e.daily_ot_hours;
      e.regular_hours = Math.max(0, e.hours - used);
    });
  }

  if (weeklyThreshold != null) {
    const byWeek = new Map();
    entries.forEach(entry => {
      const dateKey = entry.entry_date || entry.start_date || entry.end_date || null;
      const weekKey = dateKey ? getWeekStart(dateKey, rules.pay_period_start_weekday) : null;
      if (!weekKey) return;
      if (!byWeek.has(weekKey)) byWeek.set(weekKey, []);
      byWeek.get(weekKey).push(entry);
    });

    for (const weekEntries of byWeek.values()) {
      const regularTotal = weekEntries.reduce((sum, e) => sum + Number(e.regular_hours || 0), 0);
      const weeklyOtHours = Math.max(0, regularTotal - weeklyThreshold);
      if (weeklyOtHours <= 0) continue;
      allocateProportional(weekEntries, weeklyOtHours, e => e.regular_hours, (e, alloc) => {
        e.weekly_ot_hours += alloc;
        e.regular_hours = Math.max(0, e.regular_hours - alloc);
      });
    }
  }

  entries.forEach(entry => {
    const overtimeHours = entry.daily_ot_hours + entry.weekly_ot_hours;
    const total =
      entry.base_rate *
      (entry.regular_hours +
        overtimeHours * rules.overtime_multiplier +
        entry.double_time_hours * rules.double_time_multiplier);
    entry.adjusted_pay = roundCurrency(total);
  });

  return entries;
}

module.exports = {
  normalizePayrollRules,
  applyOvertimeAllocations,
  getWeekStart,
  roundCurrency
};
