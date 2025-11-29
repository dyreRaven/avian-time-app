/* eslint-disable no-alert, no-console */

// Rebuilt payroll UI from scratch: summary, settings, send-to-QB toggle, custom lines,
// inline time-entry viewer/editor, and create-check payload wiring.

let currentPayrollSettings = {
  bank_account_name: null,
  expense_account_name: null,
  default_memo: 'Payroll {start} – {end}',
  line_description_template: 'Labor {hours} hrs – {project}'
};
let currentPayrollRows = [];
let currentPayrollRange = { start: null, end: null };
let payrollOverrides = {}; // per-employee memo/line overrides
let payrollExpenseAccounts = [];
let payrollClasses = [];
let additionalLinesByEmployee = {}; // { empId: [ { id, description, amount, expenseAccountName, className } ] }
let lastPayrollResults = null;
let lastPayrollRunId = null;
let lastTimeEntriesContext = null;

// Utils
function formatDateUS(dateInput) {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return dateInput;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function buildLineDescription(template, row, start, end) {
  if (!template) {
    return `Labor ${Number(row.project_hours || row.total_hours || 0).toFixed(2)} hrs – ${row.project_name || ''}`;
  }
  const startUS = formatDateUS(start);
  const endUS = formatDateUS(end);
  const dateRange = `${startUS} – ${endUS}`;
  return template
    .replace('{employee}', row.employee_name || '')
    .replace('{project}', row.project_name || '')
    .replace('{hours}', Number(row.project_hours || row.total_hours || 0).toFixed(2))
    .replace('{dateRange}', dateRange)
    .replace('{start}', startUS)
    .replace('{end}', endUS);
}

function setDefaultBillingCycleDates() {
  const startInput = document.getElementById('payroll-start');
  const endInput = document.getElementById('payroll-end');
  const today = new Date();
  const day = today.getDay(); // 0=Sun ... 5=Fri
  const diffToLastFriday = (day + 7 - 5) % 7;
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - diffToLastFriday);
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 6);
  const fmt = d => d.toISOString().slice(0, 10);
  if (startInput) startInput.value = fmt(startDate);
  if (endInput) endInput.value = fmt(endDate);
  currentPayrollRange = { start: fmt(startDate), end: fmt(endDate) };
}

function validatePayrollDates(start, end) {
  if (!start || !end) {
    alert('Please pick both a start and end date for the payroll period.');
    return false;
  }
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
    alert('One of the dates is invalid.');
    return false;
  }
  if (e < s) {
    alert('End date must be on or after the start date.');
    return false;
  }
  const diffDays = (e - s) / (1000 * 60 * 60 * 24) + 1;
  const MAX_DAYS = 31;
  if (diffDays > MAX_DAYS) {
    alert(`This payroll period is ${Math.round(diffDays)} days long, which exceeds the maximum allowed of ${MAX_DAYS} days.`);
    return false;
  }
  return true;
}

async function loadPayrollSettings() {
  const bankSelect = document.getElementById('payroll-bank-account');
  const expenseSelect = document.getElementById('payroll-expense-account');
  const memoInput = document.getElementById('payroll-memo-template');
  const lineDescInput = document.getElementById('payroll-line-desc-template');
  const statusEl = getPayrollSettingsStatusEl();
  try {
    const [settingsRes, optsRes, classesRes] = await Promise.all([
      fetch('/api/payroll/settings'),
      fetch('/api/payroll/account-options'),
      fetch('/api/payroll/classes')
    ]);
    const settings = settingsRes.ok ? await settingsRes.json() : {};
    const opts = optsRes.ok ? await optsRes.json() : { bankAccounts: [], expenseAccounts: [] };
    const classesPayload = classesRes.ok ? await classesRes.json() : { classes: [] };
    payrollExpenseAccounts = opts.expenseAccounts || [];
    payrollClasses = classesPayload.classes || [];
    // Do not preload defaults; force admin to select each visit
    currentPayrollSettings = {
      bank_account_name: null,
      expense_account_name: null,
      default_memo: '',
      line_description_template: ''
    };
    if (bankSelect) {
      bankSelect.innerHTML = '<option value="">(select bank account)</option>';
      (opts.bankAccounts || []).forEach(acc => {
        const fullName = acc.fullName || acc.name || '';
        if (!fullName) return;
        const opt = document.createElement('option');
        opt.value = fullName;
        opt.textContent = fullName;
        bankSelect.appendChild(opt);
      });
    }
    if (expenseSelect) {
      expenseSelect.innerHTML = '<option value="">(select expense account)</option>';
      (payrollExpenseAccounts || []).forEach(acc => {
        const fullName = acc.fullName || acc.name || '';
        if (!fullName) return;
        const opt = document.createElement('option');
        opt.value = fullName;
        opt.textContent = fullName;
        expenseSelect.appendChild(opt);
      });
    }
    if (memoInput) memoInput.value = '';
    if (lineDescInput) lineDescInput.value = '';
    if (statusEl) statusEl.textContent = '';
  } catch (err) {
    console.error('Error loading payroll settings/options:', err);
  }
}

async function savePayrollSettings() {
  const bankSelect = document.getElementById('payroll-bank-account');
  const expenseSelect = document.getElementById('payroll-expense-account');
  const memoInput = document.getElementById('payroll-memo-template');
  const lineDescInput = document.getElementById('payroll-line-desc-template');
  const statusEl = getPayrollSettingsStatusEl();
  const payload = {
    bank_account_name: bankSelect ? bankSelect.value || null : null,
    expense_account_name: expenseSelect ? expenseSelect.value || null : null,
    default_memo: memoInput ? memoInput.value || null : null,
    line_description_template: lineDescInput ? lineDescInput.value || null : null
  };
  const res = await fetch('/api/payroll/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!data.ok && data.error) {
    if (statusEl) {
      statusEl.textContent = 'Failed to save payroll settings: ' + data.error;
      statusEl.style.color = '#b91c1c';
    } else {
      alert('Failed to save payroll settings: ' + data.error);
    }
    return;
  }
  currentPayrollSettings = payload;
  const body = document.getElementById('payroll-settings-body');
  if (body) body.classList.add('hidden');
  const settingsSaveBtn = document.getElementById('payroll-settings-save');
  if (settingsSaveBtn) {
    const originalText = settingsSaveBtn.textContent || 'Save Payroll Settings';
    settingsSaveBtn.textContent = 'Saved';
    settingsSaveBtn.disabled = true;
    setTimeout(() => {
      settingsSaveBtn.textContent = originalText;
      settingsSaveBtn.disabled = false;
    }, 1200);
  }
  if (statusEl) {
    statusEl.textContent = 'Payroll settings saved.';
    statusEl.style.color = '#0f5132';
  }
}

function setupPayrollSettingsCollapse() {
  const header = document.getElementById('payroll-settings-toggle');
  const body = document.getElementById('payroll-settings-body');
  const chev = document.getElementById('payroll-settings-chevron');
  if (!header || !body) return;
  body.classList.add('hidden');
  if (chev) chev.textContent = '▸';
  header.addEventListener('click', () => {
    const hidden = body.classList.toggle('hidden');
    if (chev) chev.textContent = hidden ? '▸' : '▾';
  });
}

function getPayrollSettingsStatusEl() {
  let el = document.getElementById('payroll-settings-status');
  if (el) return el;
  const container = document.getElementById('payroll-settings-body') || document.getElementById('payroll-settings-card');
  if (!container) return null;
  el = document.createElement('div');
  el.id = 'payroll-settings-status';
  el.style.marginTop = '6px';
  el.style.fontSize = '0.85rem';
  el.style.color = '#0f5132';
  container.appendChild(el);
  return el;
}

function promptReuseSavedSettingsIfNeeded() {
  // No-op: defaults disabled per request.
}

function normalizeTimeValue(val) {
  if (!val) return '';
  const parts = String(val).split(':');
  if (parts.length >= 2) {
    const hh = parts[0].padStart(2, '0');
    const mm = parts[1].padStart(2, '0');
    return `${hh}:${mm}`;
  }
  return val;
}

function computeHoursFromDateTimes(startDate, startTime, endDate, endTime) {
  if (!startDate || !endDate || !startTime || !endTime) return null;
  const start = new Date(`${startDate}T${startTime}`);
  const end = new Date(`${endDate}T${endTime}`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const diff = end - start;
  if (diff <= 0) return null;
  return diff / (1000 * 60 * 60);
}

// Time entries modal
let timeEntriesCloseBound = false;

function closeTimeEntriesModal() {
  const modal = document.getElementById('time-entries-modal');
  const backdrop = document.getElementById('time-entries-backdrop');
  if (modal) modal.classList.add('hidden');
  if (backdrop) backdrop.classList.add('hidden');
}

function bindTimeEntriesCloseHandlers() {
  if (timeEntriesCloseBound) return;
  const closeBtn = document.getElementById('time-entries-close');
  const backdrop = document.getElementById('time-entries-backdrop');
  if (closeBtn) closeBtn.addEventListener('click', closeTimeEntriesModal);
  if (backdrop) {
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) closeTimeEntriesModal();
    });
  }
  timeEntriesCloseBound = true;
}

function hideInlineTimeEntryEditor() {
  const panel = document.getElementById('time-entry-edit');
  const errEl = document.getElementById('edit-entry-error');
  if (!panel) return;
  panel.classList.add('hidden');
  panel.dataset.entryId = '';
  if (errEl) errEl.textContent = '';
}

function openInlineTimeEntryEditor(row) {
  const panel = document.getElementById('time-entry-edit');
  if (!panel) return;
  const entryId = row.dataset.entryId;
  const startDate = row.dataset.startDate || '';
  const endDate = row.dataset.endDate || '';
  const startTime = row.dataset.startTime || '';
  const endTime = row.dataset.endTime || '';
  const hours = row.dataset.hours || '';
  const empId = row.dataset.employeeId || '';
  const projectId = row.dataset.projectId || '';
  panel.dataset.entryId = entryId || '';
  panel.dataset.employeeId = empId || '';
  panel.dataset.projectId = projectId || '';
  panel.classList.remove('hidden');
  const errEl = document.getElementById('edit-entry-error');
  if (errEl) errEl.textContent = '';
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  };
  setVal('edit-entry-start-date', startDate);
  setVal('edit-entry-end-date', endDate);
  setVal('edit-entry-start-time', startTime);
  setVal('edit-entry-end-time', endTime);
  setVal('edit-entry-hours', hours);
  const startTimeInput = document.getElementById('edit-entry-start-time');
  const endTimeInput = document.getElementById('edit-entry-end-time');
  const hoursInput = document.getElementById('edit-entry-hours');
  function recomputeHours() {
    const sd = document.getElementById('edit-entry-start-date')?.value || startDate;
    const ed = document.getElementById('edit-entry-end-date')?.value || endDate;
    const st = startTimeInput?.value || '';
    const et = endTimeInput?.value || '';
    const computed = computeHoursFromDateTimes(sd, st, ed, et);
    if (hoursInput) hoursInput.value = Number.isFinite(computed) ? computed.toFixed(2) : '';
  }
  ['change', 'input'].forEach(evt => {
    if (startTimeInput) startTimeInput.addEventListener(evt, recomputeHours);
    if (endTimeInput) endTimeInput.addEventListener(evt, recomputeHours);
  });
}

function bindInlineTimeEntryEditor() {
  const panel = document.getElementById('time-entry-edit');
  if (!panel) return;
  const saveBtn = document.getElementById('edit-entry-save');
  const cancelBtn = document.getElementById('edit-entry-cancel');
  const errEl = document.getElementById('edit-entry-error');
  function hidePanel() {
    hideInlineTimeEntryEditor();
  }
  if (cancelBtn && !cancelBtn._bound) {
    cancelBtn._bound = true;
    cancelBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      hidePanel();
    });
  }
  if (saveBtn && !saveBtn._bound) {
    saveBtn._bound = true;
    saveBtn.addEventListener('click', async () => {
      const entryId = panel.dataset.entryId;
      const empId = Number(panel.dataset.employeeId);
      const projId = Number(panel.dataset.projectId);
      if (!entryId || !empId || !projId) {
        if (errEl) errEl.textContent = 'Missing entry metadata (employee/project).';
        return;
      }
      const start_date = (document.getElementById('edit-entry-start-date')?.value || '').trim();
      const end_date = (document.getElementById('edit-entry-end-date')?.value || '').trim();
      const start_time = (document.getElementById('edit-entry-start-time')?.value || '').trim();
      const end_time = (document.getElementById('edit-entry-end-time')?.value || '').trim();
      const hoursVal = (document.getElementById('edit-entry-hours')?.value || '').trim();
      if (!start_date || !end_date || !start_time || !end_time) {
        if (errEl) errEl.textContent = 'Start/end date and time are required.';
        return;
      }
      const computedHours = computeHoursFromDateTimes(start_date, start_time, end_date, end_time);
      const hours = Number(computedHours ?? hoursVal);
      if (!Number.isFinite(hours) || hours <= 0) {
        if (errEl) errEl.textContent = 'Hours are invalid. Check start/end times.';
        return;
      }
      try {
        const res = await fetch(`/api/time-entries/${entryId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employee_id: empId,
            project_id: projId,
            start_date,
            end_date,
            start_time,
            end_time,
            hours
          })
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'Failed to save time entry.');
        hidePanel();
        if (lastTimeEntriesContext) {
          const { employeeId, employeeName, projectId, projectName } = lastTimeEntriesContext;
          openTimeEntriesModal(employeeId, employeeName, projectId, projectName);
        }
      } catch (err) {
        console.error('[PAYROLL] Save time entry error', err);
        if (errEl) errEl.textContent = err.message || 'Failed to save time entry.';
      }
    });
  }
}

async function openTimeEntriesModal(employeeId, employeeName, projectId = null, projectName = '') {
  lastTimeEntriesContext = { employeeId, employeeName, projectId, projectName };
  const modal = document.getElementById('time-entries-modal');
  const backdrop = document.getElementById('time-entries-backdrop');
  const bodyEl = document.getElementById('time-entries-body');
  const titleEl = document.getElementById('time-entries-title');
  bindTimeEntriesCloseHandlers();
  if (!modal || !backdrop || !bodyEl || !titleEl) return;
  const { start, end } = currentPayrollRange || {};
  if (!start || !end) {
    alert('Please select a start and end date first.');
    return;
  }
  const startUS = formatDateUS(start);
  const endUS = formatDateUS(end);
  const projectLabel = projectName ? ` – ${projectName}` : '';
  titleEl.textContent = `Time Entries for ${employeeName}${projectLabel} (${startUS} – ${endUS})`;
  bodyEl.innerHTML = '<p>Loading time entries…</p>';
  try {
    const params = new URLSearchParams({ employeeId: String(employeeId), start, end });
    const res = await fetch('/api/payroll/time-entries?' + params.toString());
    let entries = await res.json();
    if (projectId) {
      const pid = Number(projectId);
      entries = entries.filter(e => Number(e.project_id) === pid);
    }
    if (!Array.isArray(entries) || !entries.length) {
      bodyEl.innerHTML = '<p>No time entries for this employee in this date range.</p>';
    } else {
      const byProject = new Map();
      for (const e of entries) {
        const key = e.project_name || '(No project)';
        if (!byProject.has(key)) byProject.set(key, []);
        byProject.get(key).push(e);
      }
      let html = '';
      for (const [projName, list] of byProject.entries()) {
        let totalHours = 0;
        let totalPay = 0;
        list.forEach(e => {
          totalHours += Number(e.hours || 0);
          totalPay += Number(e.total_pay || 0);
        });
        html += `
  <h4>${projName}</h4>
  <table class="table nested-table">
    <thead>
      <tr>
        <th>Date</th>
        <th>Start</th>
        <th>End</th>
        <th>Hours</th>
        <th>Rate</h>
        <th>Pay</th>
      </tr>
    </thead>
    <tbody>
      ${list
        .map(e => {
          const hours = Number(e.hours || 0);
          const rowPay = Number(e.total_pay || 0);
          const rate = Number(e.rate || (hours > 0 ? rowPay / hours : 0));
          const startDateUS = formatDateUS(e.start_date);
          const endDateUS = formatDateUS(e.end_date);
          const dateLabel = e.start_date === e.end_date ? startDateUS : `${startDateUS} – ${endDateUS}`;
          const startTimeVal = normalizeTimeValue(e.start_time);
          const endTimeVal = normalizeTimeValue(e.end_time);
          return `
  <tr
    class="time-entry-row"
    data-entry-id="${e.id}"
    data-employee-id="${employeeId}"
    data-project-id="${e.project_id || ''}"
    data-start-date="${e.start_date || ''}"
    data-end-date="${e.end_date || ''}"
    data-start-time="${startTimeVal}"
    data-end-time="${endTimeVal}"
    data-hours="${hours.toFixed(2)}"
  >
    <td>${dateLabel}</td>
    <td>${startTimeVal || '<span class="missing-time">Missing</span>'}</td>
    <td>${endTimeVal || '<span class="missing-time">Missing</span>'}</td>
    <td>${hours.toFixed(2)}</td>
    <td>$${rate.toFixed(2)}/hr</td>
    <td>$${rowPay.toFixed(2)}</td>
  </tr>
`;
        })
        .join('')}
      <tr class="project-total-row">
        <td colspan="3"><strong>Project Total</strong></td>
        <td><strong>${totalHours.toFixed(2)}</strong></td>
        <td></td>
        <td><strong>$${totalPay.toFixed(2)}</strong></td>
      </tr>
    </tbody>
  </table>
`;
      }
      bodyEl.innerHTML = html;
      bodyEl.querySelectorAll('tr.time-entry-row').forEach(tr => {
        tr.addEventListener('click', () => openInlineTimeEntryEditor(tr));
      });
    }
    modal.classList.remove('hidden');
    backdrop.classList.remove('hidden');
  } catch (err) {
    console.error('Error loading time entries for payroll view:', err);
    bodyEl.innerHTML = '<p>Failed to load time entries.</p>';
    modal.classList.remove('hidden');
    backdrop.classList.remove('hidden');
  }
}

function setupViewTimeEntriesButtons() {
  const tbody = document.getElementById('payroll-summary-body');
  if (!tbody) return;
  tbody.addEventListener('click', e => {
    const btn = e.target.closest('.btn-view-time-entries');
    if (!btn) return;
    e.stopPropagation();
    const empId = Number(btn.dataset.employeeId);
    const empName = btn.dataset.employeeName || '';
    const projectId = btn.dataset.projectId || null;
    const projectName = btn.dataset.projectName || '';
    if (!empId) return;
    openTimeEntriesModal(empId, empName, projectId, projectName);
  });
}

function renderPayrollSummaryTable() {
  const tbody = document.getElementById('payroll-summary-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  const byEmployee = new Map();
  for (const row of currentPayrollRows) {
    const key = row.employee_id;
    if (!byEmployee.has(key)) {
      byEmployee.set(key, {
        employee_id: row.employee_id,
        employee_name: row.employee_name,
        total_hours: 0,
        total_pay: 0,
        projects: []
      });
    }
    const agg = byEmployee.get(key);
    agg.total_hours += Number(row.project_hours || 0);
    agg.total_pay += Number(row.project_pay || 0);
    agg.projects.push({
      project_id: row.project_id,
      project_name: row.project_name,
      hours: row.project_hours,
      total_pay: row.project_pay,
      class_name: row.class_name || ''
    });
  }
  const startUS = formatDateUS(currentPayrollRange.start);
  const endUS = formatDateUS(currentPayrollRange.end);
  const dateRange = `${startUS || ''} – ${endUS || ''}`;
  const memoTemplate = currentPayrollSettings.default_memo || 'Payroll {start} – {end}';
  const classDatalistId = 'qb-class-options';
  for (const agg of byEmployee.values()) {
    const customLines = additionalLinesByEmployee[agg.employee_id] || [];
    const customTotal = customLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
    const displayTotalPay = agg.total_pay + customTotal;
    const tr = document.createElement('tr');
    tr.classList.add('payroll-row');
    tr.dataset.employeeId = agg.employee_id;
    tr.dataset.employeeName = agg.employee_name || '';
    tr.innerHTML = `
      <td>${agg.employee_name || ''}</td>
      <td>(multiple)</td>
      <td>${agg.total_hours.toFixed(2)}</td>
      <td>$${displayTotalPay.toFixed(2)}</td>
      <td>
        <label class="checkbox-inline">
          <input type="checkbox" class="payroll-send-checkbox" data-employee-id="${agg.employee_id}" checked />
          Send to QB
        </label>
      </td>
    `;
    const memoText = memoTemplate
      .replace('{employee}', agg.employee_name || '')
      .replace('{start}', startUS || '')
      .replace('{end}', endUS || '')
      .replace('{dateRange}', dateRange);
    const detailsTr = document.createElement('tr');
    detailsTr.classList.add('payroll-details-row', 'hidden');
    detailsTr.dataset.employeeId = agg.employee_id;
    const colCount = 5;
    detailsTr.innerHTML = `
      <td colspan="${colCount}">
        <div class="payroll-details">
          <div class="details-column">
            <h4>QuickBooks Check Preview</h4>
            <div class="summary-grid">
              <div class="summary-item"><div class="label">Employee</div><div class="value">${agg.employee_name || ''}</div></div>
              <div class="summary-item"><div class="label">Check Date</div><div class="value">${formatDateUS(currentPayrollRange.end)}</div></div>
              <div class="summary-item"><div class="label">Total Amount</div><div class="value">$${displayTotalPay.toFixed(2)}</div></div>
              <div class="summary-item"><div class="label">Bank Account</div><div class="value">${currentPayrollSettings.bank_account_name || '(not set)'}</div></div>
            </div>
            <div class="form-field" style="margin-top: 0.75rem;">
              <label><strong>Default Memo</strong></label>
              <input type="text" class="payroll-memo-input" data-employee-id="${agg.employee_id}" value="${memoText}" />
            </div>
          </div>
          <div class="details-column payroll-line-items" style="margin-top: 1.25rem; padding-top: 1rem; border-top: 1px solid #e5e7eb;">
            <h4>Line Items</h4>
            <div class="line-items-box">
              ${agg.projects && agg.projects.length ? `
                  <table class="table nested-table">
                    <thead>
                      <tr>
                        <th>Expense Account</th><th>Description</th><th>Amount</th><th>Customer / Project</th><th>Class</th><th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${agg.projects.map(p => {
                        const hours = Number(p.hours || 0);
                        const amount = Number(p.total_pay || 0);
                        const lineDesc = buildLineDescription(currentPayrollSettings.line_description_template, { employee_name: agg.employee_name, project_name: p.project_name, project_hours: hours }, currentPayrollRange.start, currentPayrollRange.end);
                        const defaultExpenseName = currentPayrollSettings.expense_account_name || '';
                        const expenseOptions = (payrollExpenseAccounts || []).map(acc => {
                          const fullName = acc.fullName || acc.name || '';
                          if (!fullName) return '';
                          const selected = fullName === defaultExpenseName ? ' selected' : '';
                          return `<option value="${fullName}"${selected}>${fullName}</option>`;
                        }).join('');
                        const defaultClassName = p.class_name || p.project_name || '';
                        let classOptions = (payrollClasses || []).map(c => {
                          const name = c.fullName || c.name || '';
                          if (!name) return '';
                          const selected = name === defaultClassName ? ' selected' : '';
                          return `<option value="${name}"${selected}>${name}</option>`;
                        }).join('');
                        if (defaultClassName && !(payrollClasses || []).some(c => (c.fullName || c.name) === defaultClassName)) {
                          classOptions = `<option value="${defaultClassName}" selected>${defaultClassName}</option>` + classOptions;
                        }
                        return `
                          <tr>
                            <td><select class="line-expense-select" data-employee-id="${agg.employee_id}" data-project-id="${p.project_id}"><option value="">(Use default${defaultExpenseName ? ': ' + defaultExpenseName : ''})</option>${expenseOptions}</select></td>
                            <td><input type="text" class="line-desc-input" data-employee-id="${agg.employee_id}" data-project-id="${p.project_id}" value="${lineDesc}" /></td>
                            <td>$${amount.toFixed(2)}</td>
                            <td>${p.project_name || ''}</td>
                            <td><select class="line-class-select" data-employee-id="${agg.employee_id}" data-project-id="${p.project_id}"><option value="">(none)</option>${classOptions}</select></td>
                            <td><button type="button" class="btn secondary btn-compact btn-view-time-entries" data-employee-id="${agg.employee_id}" data-employee-name="${agg.employee_name || ''}" data-project-id="${p.project_id || ''}" data-project-name="${p.project_name || ''}">View Time Entries</button></td>
                          </tr>
                        `;
                      }).join('')}
                      ${customLines.map(line => {
                        const expenseOptions = (payrollExpenseAccounts || []).map(acc => {
                          const fullName = acc.fullName || acc.name || '';
                          if (!fullName) return '';
                          const selected = fullName === line.expenseAccountName ? ' selected' : '';
                          return `<option value="${fullName}"${selected}>${fullName}</option>`;
                        }).join('');
                        const classOptions = (payrollClasses || []).map(c => {
                          const name = c.fullName || c.name || '';
                          if (!name) return '';
                          const selected = name === (line.className || '') ? ' selected' : '';
                          return `<option value="${name}"${selected}>${name}</option>`;
                        }).join('');
                        return `
                          <tr class="custom-line-row" data-employee-id="${agg.employee_id}" data-line-id="${line.id}">
                            <td><select class="line-expense-select" data-employee-id="${agg.employee_id}" data-project-id="${line.id}" data-custom-line="true"><option value="">(Use default${currentPayrollSettings.expense_account_name ? ': ' + currentPayrollSettings.expense_account_name : ''})</option>${expenseOptions}</select></td>
                            <td><input type="text" class="line-desc-input" data-employee-id="${agg.employee_id}" data-project-id="${line.id}" data-custom-line="true" value="${line.description || ''}" placeholder="(custom description)" /></td>
                            <td><input type="number" step="0.01" min="0" class="line-amount-input" data-employee-id="${agg.employee_id}" data-project-id="${line.id}" data-custom-line="true" value="${Number(line.amount || 0).toFixed(2)}" /></td>
                            <td>(Custom)</td>
                            <td><select class="line-class-select" data-employee-id="${agg.employee_id}" data-project-id="${line.id}" data-custom-line="true"><option value="">(none)</option>${classOptions}</select></td>
                            <td><button type="button" class="btn tertiary btn-compact btn-remove-line" data-employee-id="${agg.employee_id}" data-line-id="${line.id}">Remove</button></td>
                          </tr>
                        `;
                      }).join('')}
                    </tbody>
                  </table>
                  <div class="mt-2"><button type="button" class="btn tertiary btn-add-line" data-employee-id="${agg.employee_id}">+ Add line item</button></div>
                ` : '<p>No line items available.</p>'}
            </div>
          </div>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
    tbody.appendChild(detailsTr);
  }
}

function setupPayrollRowToggle() {
  const tbody = document.getElementById('payroll-summary-body');
  if (!tbody) return;
  tbody.addEventListener('click', e => {
    if (e.target.closest('button') || e.target.closest('input')) return;
    const tr = e.target.closest('tr.payroll-row');
    if (!tr) return;
    const empId = tr.dataset.employeeId;
    const detailsRow = tbody.querySelector(`tr.payroll-details-row[data-employee-id="${empId}"]`);
    if (!detailsRow) return;
    detailsRow.classList.toggle('hidden');
  });
}

function setupPayrollOverrideInputs() {
  document.querySelectorAll('.payroll-memo-input').forEach(input => {
    const empId = input.dataset.employeeId;
    if (!empId) return;
    function updateMemo() {
      payrollOverrides[empId] = payrollOverrides[empId] || {};
      payrollOverrides[empId].employeeId = Number(empId);
      payrollOverrides[empId].memo = input.value || null;
    }
    input.addEventListener('input', updateMemo);
    input.addEventListener('change', updateMemo);
  });
  document.querySelectorAll('.line-expense-select, .line-desc-input, .line-class-select, .line-amount-input').forEach(el => {
    const empId = el.dataset.employeeId;
    const projectId = el.dataset.projectId;
    const isCustom = el.dataset.customLine === 'true';
    if (!empId || !projectId) return;
    const key = isCustom ? `custom:${empId}:${projectId}` : `${empId}:${projectId}`;
    function updateOverride() {
      if (isCustom) {
        const lines = additionalLinesByEmployee[empId] || [];
        const idx = lines.findIndex(l => String(l.id) === String(projectId));
        if (idx >= 0) {
          const row = el.closest('tr');
          const descInput = row?.querySelector('.line-desc-input');
          const amountInput = row?.querySelector('.line-amount-input');
          const expenseSel = row?.querySelector('.line-expense-select');
          const classInput = row?.querySelector('.line-class-select');
          lines[idx] = {
            ...lines[idx],
            description: descInput?.value || '',
            amount: Number(amountInput?.value || 0),
            expenseAccountName: expenseSel?.value || null,
            className: classInput?.value || null
          };
          additionalLinesByEmployee[empId] = lines;
        }
      } else {
        const row = el.closest('tr');
        if (!row) return;
        const expenseSel = row.querySelector('.line-expense-select');
        const descInput = row.querySelector('.line-desc-input');
        const classInput = row.querySelector('.line-class-select');
        payrollOverrides[key] = {
          employeeId: Number(empId),
          projectId: Number(projectId),
          expenseAccountName: expenseSel?.value || null,
          description: descInput?.value || null,
          className: classInput?.value || null
        };
      }
    }
    el.addEventListener('input', updateOverride);
    el.addEventListener('change', updateOverride);
  });
}

async function loadPayrollSummary() {
  const startInput = document.getElementById('payroll-start');
  const endInput = document.getElementById('payroll-end');
  if (!startInput?.value || !endInput?.value) setDefaultBillingCycleDates();
  const start = startInput?.value || '';
  const end = endInput?.value || '';
  if (!validatePayrollDates(start, end)) return;
  currentPayrollRange = { start, end };
  payrollOverrides = {};
  const params = new URLSearchParams({ start, end });
  const url = `/api/payroll-summary?${params.toString()}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    const rows = await res.json();
    currentPayrollRows = Array.isArray(rows) ? rows : [];
    renderPayrollSummaryTable();
    setupPayrollOverrideInputs();
    if (!currentPayrollRows.length) alert('No unpaid time entries found for this date range.');
  } catch (err) {
    console.error('[PAYROLL] loadPayrollSummary error', err);
    alert('Failed to load payroll summary: ' + (err.message || err));
  }
}

function addCustomLine(empId) {
  const lines = additionalLinesByEmployee[empId] || [];
  const newId = Date.now() + '-' + Math.round(Math.random() * 1e6);
  lines.push({ id: newId, description: '', amount: 0, expenseAccountName: null, className: null });
  additionalLinesByEmployee[empId] = lines;
  renderPayrollSummaryTable();
  setupPayrollOverrideInputs();
}

function removeCustomLine(empId, lineId) {
  const lines = additionalLinesByEmployee[empId] || [];
  additionalLinesByEmployee[empId] = lines.filter(l => String(l.id) !== String(lineId));
  renderPayrollSummaryTable();
  setupPayrollOverrideInputs();
}

function setupCustomLineButtons() {
  const tbody = document.getElementById('payroll-summary-body');
  if (!tbody) return;
  tbody.addEventListener('click', e => {
    const addBtn = e.target.closest('.btn-add-line');
    if (addBtn) {
      e.stopPropagation();
      const empId = addBtn.dataset.employeeId;
      if (empId) addCustomLine(empId);
      return;
    }
    const removeBtn = e.target.closest('.btn-remove-line');
    if (removeBtn) {
      e.stopPropagation();
      const empId = removeBtn.dataset.employeeId;
      const lineId = removeBtn.dataset.lineId;
      if (empId && lineId) removeCustomLine(empId, lineId);
      return;
    }
  });
}

async function createChecksForCurrentRange() {
  const { start, end } = currentPayrollRange || {};
  if (!validatePayrollDates(start, end)) return;
  // refresh in-memory settings from inputs
  const bankSelect = document.getElementById('payroll-bank-account');
  const expenseSelect = document.getElementById('payroll-expense-account');
  const memoInput = document.getElementById('payroll-memo-template');
  const lineDescInput = document.getElementById('payroll-line-desc-template');
  currentPayrollSettings.bank_account_name = bankSelect ? bankSelect.value || null : null;
  currentPayrollSettings.expense_account_name = expenseSelect ? expenseSelect.value || null : null;
  currentPayrollSettings.default_memo = memoInput ? memoInput.value || null : null;
  currentPayrollSettings.line_description_template = lineDescInput ? lineDescInput.value || null : null;
  const overridesArray = [];
  const lineOverrides = [];
  Object.entries(payrollOverrides || {}).forEach(([key, ov]) => {
    if (!ov) return;
    if (key.includes(':')) {
      const [empIdRaw, projectIdRaw] = key.split(':');
      const empId = Number(empIdRaw);
      if (!empId || !projectIdRaw) return;
      lineOverrides.push({
        employeeId: empId,
        projectId: projectIdRaw,
        expenseAccountName: ov.expenseAccountName || null,
        description: ov.description || null,
        className: ov.className || null,
        isCustom: ov.isCustom || false
      });
    } else {
      const empId = Number(ov.employeeId || key);
      if (!empId) return;
      overridesArray.push({
        employeeId: empId,
        expenseAccountName: ov.expenseAccountName || null,
        memo: ov.memo || null,
        lineDescriptionTemplate: ov.lineDescriptionTemplate || null
      });
    }
  });
  const customLines = Object.entries(additionalLinesByEmployee || {}).flatMap(([empId, lines]) =>
    (lines || [])
      .filter(l => Number(l.amount) > 0)
      .map(l => ({
        employeeId: Number(empId),
        description: l.description || '',
        amount: Number(l.amount),
        expenseAccountName: l.expenseAccountName || null,
        className: l.className || null,
        projectId: l.id
      }))
  );
  const unchecked = Array.from(document.querySelectorAll('.payroll-send-checkbox'))
    .filter(cb => !cb.checked)
    .map(cb => Number(cb.dataset.employeeId))
    .filter(n => Number.isFinite(n));
  // Basic pre-flight validation
  const errors = [];
  if (!currentPayrollSettings.bank_account_name) {
    errors.push('Bank account is not selected in payroll settings.');
  }
  if (!currentPayrollSettings.expense_account_name) {
    errors.push('Expense account is not selected in payroll settings.');
  }
  const missingLines = [];
  document.querySelectorAll('#payroll-summary-body .line-items-box tr').forEach(row => {
    const empId = row.closest('tr')?.dataset.employeeId || row.dataset.employeeId || '';
    const expense = row.querySelector('.line-expense-select')?.value || '';
    const desc = row.querySelector('.line-desc-input')?.value || '';
    const cls = row.querySelector('.line-class-select')?.value || '';
    if (!expense || !desc || !cls) {
      const projLabel = row.querySelector('td:nth-child(4)')?.textContent || '(project)';
      missingLines.push(`Employee ${empId} / ${projLabel} missing ${[
        !expense ? 'expense' : '',
        !desc ? 'description' : '',
        !cls ? 'class' : ''
      ].filter(Boolean).join(', ')}`);
    }
  });
  if (missingLines.length) errors.push('Line items incomplete:\n' + missingLines.join('\n'));
  if (errors.length) {
    alert('Please fix the following before creating checks:\n\n' + errors.join('\n'));
    return;
  }

  const payload = {
    start,
    end,
    bankAccountName: currentPayrollSettings.bank_account_name || null,
    expenseAccountName: currentPayrollSettings.expense_account_name || null,
    memo: currentPayrollSettings.default_memo || null,
    lineDescriptionTemplate: currentPayrollSettings.line_description_template || null,
    overrides: overridesArray,
    customLines,
    lineOverrides,
    excludeEmployeeIds: unchecked,
    isRetry: false,
    originalPayrollRunId: null,
    onlyEmployeeIds: []
  };
  const createBtn = document.getElementById('payroll-create-checks');
  const retryBtn = document.getElementById('payroll-retry-failed');
  if (createBtn) createBtn.disabled = true;
  if (retryBtn) retryBtn.disabled = true;
  try {
    if (!confirm(`Create QuickBooks checks for the period ${start} to ${end}?`)) return;
    const res = await fetch('/api/payroll/create-checks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const data = await res.json();
    lastPayrollResults = data.results || null;
    lastPayrollRunId = data.payrollRunId || null;
    if (!data.ok) {
      let msg = data.error || data.reason || 'Unknown error creating checks.';
      if (Array.isArray(data.results) && data.results.length) {
        const failed = data.results.filter(r => r && r.ok === false);
        if (failed.length) msg += '\n\nFailed:\n' + failed.map(f => `• ${f.employeeName} – ${f.error || 'Unknown error'}`).join('\n');
      }
      alert('Could not create checks:\n\n' + msg);
      if (retryBtn) retryBtn.disabled = !(data.results || []).some(r => r && r.ok === false);
      return;
    }
    const results = Array.isArray(data.results) ? data.results : [];
    const failed = results.filter(r => r && r.ok === false);
    const okList = results.filter(r => r && r.ok !== false);
    let msg = `Checks created successfully.\nPayroll run ID: ${data.payrollRunId || '(none)'}`;
    if (results.length) msg += `\n\nSummary: ${okList.length} succeeded, ${failed.length} failed.`;
    if (failed.length) msg += '\n\nFailed:\n' + failed.map(f => `• ${f.employeeName} – ${f.error || 'Unknown error'}`).join('\n');
    alert(msg);
    if (retryBtn) retryBtn.disabled = !failed.length;
    if (typeof loadPayrollSummary === 'function') loadPayrollSummary();
  } catch (err) {
    console.error('Error calling /api/payroll/create-checks:', err);
    alert('There was a problem contacting the server while creating checks.\n\n' + (err.message || err));
  } finally {
    if (createBtn) createBtn.disabled = false;
  }
}

async function retryFailedChecksForCurrentRun() {
  const { start, end } = currentPayrollRange || {};
  if (!validatePayrollDates(start, end)) return;
  if (!Array.isArray(lastPayrollResults) || !lastPayrollResults.length) {
    alert('There is no previous payroll run to retry.');
    return;
  }
  if (!lastPayrollRunId) {
    alert('Cannot retry: no original payroll run ID is available.');
    return;
  }
  const failed = lastPayrollResults.filter(r => r && r.ok === false && r.employeeId);
  if (!failed.length) {
    alert('There are no failed employees to retry.');
    return;
  }
  const failedEmployeeIds = [...new Set(failed.map(f => Number(f.employeeId)).filter(Number.isFinite))];
  const overridesArray = Object.entries(payrollOverrides || {})
    .map(([key, ov]) => ({
      employeeId: Number(ov.employeeId || key.split(':')[0]),
      expenseAccountName: ov.expenseAccountName || null,
      memo: ov.memo || null,
      lineDescriptionTemplate: ov.lineDescriptionTemplate || null
    }))
    .filter(o => o.employeeId && failedEmployeeIds.includes(o.employeeId));
  const payload = {
    start,
    end,
    bankAccountName: currentPayrollSettings.bank_account_name || null,
    expenseAccountName: currentPayrollSettings.expense_account_name || null,
    memo: currentPayrollSettings.default_memo || null,
    lineDescriptionTemplate: currentPayrollSettings.line_description_template || null,
    overrides: overridesArray,
    isRetry: true,
    originalPayrollRunId: lastPayrollRunId,
    onlyEmployeeIds: failedEmployeeIds
  };
  if (!confirm(`Retry QuickBooks checks for ${failedEmployeeIds.length} failed employees?`)) return;
  const createBtn = document.getElementById('payroll-create-checks');
  const retryBtn = document.getElementById('payroll-retry-failed');
  if (createBtn) createBtn.disabled = true;
  if (retryBtn) retryBtn.disabled = true;
  try {
    const res = await fetch('/api/payroll/create-checks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const data = await res.json();
    lastPayrollResults = data.results || null;
    lastPayrollRunId = data.payrollRunId || lastPayrollRunId;
    if (!data.ok) {
      let msg = data.error || data.reason || 'Unknown error.';
      if (Array.isArray(data.results) && data.results.length) {
        const stillFailed = data.results.filter(r => r && r.ok === false);
        if (stillFailed.length) msg += '\n\nStill failing:\n' + stillFailed.map(f => `• ${f.employeeName} – ${f.error || 'Unknown error'}`).join('\n');
      }
      alert('Could not retry checks:\n\n' + msg);
      if (retryBtn) retryBtn.disabled = !(data.results || []).some(r => r && r.ok === false);
      return;
    }
    const results = Array.isArray(data.results) ? data.results : [];
    const failedAgain = results.filter(r => r && r.ok === false);
    const succeeded = results.filter(r => r && r.ok !== false);
    let msg = `Retry complete.\nPayroll run ID: ${data.payrollRunId || lastPayrollRunId || '(none)'}`;
    if (results.length) msg += `\n\nSummary: ${succeeded.length} succeeded, ${failedAgain.length} failed.`;
    if (failedAgain.length) msg += '\n\nStill failing:\n' + failedAgain.map(f => `• ${f.employeeName} – ${f.error || 'Unknown error'}`).join('\n');
    alert(msg);
    if (retryBtn) retryBtn.disabled = !failedAgain.length;
    if (typeof loadPayrollSummary === 'function') loadPayrollSummary();
  } catch (err) {
    console.error('Error calling /api/payroll/create-checks (retry):', err);
    alert('There was a problem contacting the server while retrying failed checks.\n\n' + (err.message || err));
  } finally {
    if (createBtn) createBtn.disabled = false;
  }
}

function setupPayrollActions() {
  const createBtn = document.getElementById('payroll-create-checks');
  const retryBtn = document.getElementById('payroll-retry-failed');
  if (createBtn) createBtn.addEventListener('click', createChecksForCurrentRange);
  if (retryBtn) retryBtn.addEventListener('click', retryFailedChecksForCurrentRun);
}

function initPayrollUiTab() {
  if (window.payrollUiInitialized) return;
  window.payrollUiInitialized = true;
  setupPayrollSettingsCollapse();
  setupPayrollRowToggle();
  setupViewTimeEntriesButtons();
  bindInlineTimeEntryEditor();
  setupCustomLineButtons();
  const settingsSaveBtn = document.getElementById('payroll-settings-save');
  if (settingsSaveBtn) settingsSaveBtn.addEventListener('click', savePayrollSettings);
  const refreshBtn = document.getElementById('payroll-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', loadPayrollSummary);
  setDefaultBillingCycleDates();
  loadPayrollSettings();
  loadPayrollSummary();
  setupPayrollActions();
}

// Expose for nav hook in app.js
window.initPayrollUiTab = initPayrollUiTab;

document.addEventListener('DOMContentLoaded', () => {
  initPayrollUiTab();
});
