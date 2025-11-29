

/* ───────── 9. PAYROLL UI ───────── */

let lastPayrollResults = null;
let lastPayrollRunId = null;
let currentPayrollSettings = {
  bank_account_name: null,
  expense_account_name: null,
  default_memo: 'Payroll {start} – {end}',
  line_description_template: 'Labor {hours} hrs – {project}'
};
let currentPayrollRows = [];
let currentPayrollRange = { start: null, end: null };
let payrollOverrides = {};
let payrollExpenseAccounts = [];
let payrollLineOverrides = {};
let payrollClasses = [];
let currentRunId = null;
let currentRunDetails = [];

function findProjectDefaultClassName(projectName) {
  if (!projectName || !Array.isArray(payrollClasses) || !payrollClasses.length) {
    return '';
  }

  const projNorm = projectName.trim().toLowerCase();

  // Look for an exact name match in any of the common fields
  const match = payrollClasses.find(c => {
    const label = (
      c.fullName ||
      c.FullyQualifiedName ||
      c.name ||
      ''
    ).trim().toLowerCase();

    return label === projNorm;
  });

  if (!match) return '';

  // Prefer the most human-friendly label for the input
  return match.fullName || match.FullyQualifiedName || match.name || '';
}

function calculateHoursSameDay(start_time, end_time) {
  if (!start_time || !end_time) return null;

  // Expecting "HH:MM" or "HH:MM:SS"
  const [sh, sm] = start_time.split(':').map(Number);
  const [eh, em] = end_time.split(':').map(Number);

  if (
    Number.isNaN(sh) || Number.isNaN(sm) ||
    Number.isNaN(eh) || Number.isNaN(em)
  ) {
    return null;
  }

  const startMinutes = sh * 60 + sm;
  const endMinutes   = eh * 60 + em;
  const diffMinutes  = endMinutes - startMinutes;

  // Assume same day → end must be after start
  if (diffMinutes <= 0) return null;

  return diffMinutes / 60;
}

function buildPayrollPreviewDescription(template, employeeName, projectName, hours, start, end) {
  const safeHours = Number(hours || 0).toFixed(2);

  // If no template was provided, fall back to default format
  if (!template) {
    return `Labor ${safeHours} hrs – ${projectName || ''}`;
  }

  const startUS = formatDateUS(start);
  const endUS = formatDateUS(end);
  const dateRange = `${startUS || ''} – ${endUS || ''}`;

  return template
    .replace('{employee}', employeeName || '')
    .replace('{project}', projectName || '')
    .replace('{hours}', safeHours)
    .replace('{dateRange}', dateRange)
    .replace('{start}', startUS || '')
    .replace('{end}', endUS || '');
}

async function loadPayrollAuditLog(limit = 50) {
  const tbody = document.getElementById('reports-audit-body');
  if (!tbody) return;

  // Show loading state
  tbody.innerHTML = `
    <tr>
      <td colspan="4">Loading audit events…</td>
    </tr>
  `;

  try {
    const res = await fetch(`/api/reports/payroll-audit?limit=${encodeURIComponent(limit)}`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const events = await res.json();
    if (!Array.isArray(events) || !events.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4">(no audit events yet)</td>
        </tr>
      `;
      return;
    }

    const rowsHtml = events
      .map(ev => {
        const when = ev.created_at || '';
        const type = ev.event_type || '';
        const msg =
          (ev.message || '').length > 120
            ? ev.message.slice(0, 117) + '…'
            : (ev.message || '');
        const runId = ev.payroll_run_id || '';

        return `
          <tr>
            <td>${when}</td>
            <td>${type}</td>
            <td title="${ev.message ? ev.message.replace(/"/g, '&quot;') : ''}">${msg}</td>
            <td>${runId}</td>
          </tr>
        `;
      })
      .join('');

    tbody.innerHTML = rowsHtml;
  } catch (err) {
    console.error('Error loading payroll audit log:', err);
    tbody.innerHTML = `
      <tr>
        <td colspan="4">Error loading audit log.</td>
      </tr>
    `;
  }
}

function validatePayrollDates(start, end) {
  if (!start || !end) {
    alert('Please pick both a start and end date for the payroll period.');
    return false;
  }

  const startDate = new Date(start + 'T00:00:00');
  const endDate   = new Date(end + 'T00:00:00');

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    alert('One of the dates is invalid. Please re-select the dates.');
    return false;
  }

  // End must be on or after start (no backwards periods)
  if (endDate < startDate) {
    alert('End date must be on or after the start date.');
    return false;
  }

  // Hard maximum length of a payroll period (edit if you want 14/31/etc)
  const MAX_PAYROLL_DAYS = 31;
  const diffMs = endDate - startDate;
  const diffDays = diffMs / (1000 * 60 * 60 * 24) + 1; // inclusive

  if (diffDays > MAX_PAYROLL_DAYS) {
    alert(
      `This payroll period is ${Math.round(diffDays)} days long, which exceeds the maximum allowed of ${MAX_PAYROLL_DAYS} days.\n\n` +
      'Please choose a smaller billing period.'
    );
    return false;
  }

  return true;
}

async function loadPayrollSettings() {
  const bankSelect = document.getElementById('payroll-bank-account');
  const expenseSelect = document.getElementById('payroll-expense-account');
  const memoInput = document.getElementById('payroll-memo-template');
  const lineDescInput = document.getElementById('payroll-line-desc-template');

  try {
    // Load saved settings + QuickBooks account lists in parallel
    const [settingsRes, optsRes] = await Promise.all([
      fetch('/api/payroll/settings'),
      fetch('/api/payroll/account-options')
    ]);

    const settings = settingsRes.ok ? await settingsRes.json() : {};
    const opts = optsRes.ok ? await optsRes.json() : { bankAccounts: [], expenseAccounts: [] };
    // Keep a copy around for per-employee selects
    payrollExpenseAccounts = opts.expenseAccounts || [];


    currentPayrollSettings = {
      bank_account_name: settings.bank_account_name || null,
      expense_account_name: settings.expense_account_name || null,
      default_memo: settings.default_memo || 'Payroll {start} – {end}',
      line_description_template:
        settings.line_description_template || 'Labor {hours} hrs – {project}'
    };

    // Populate bank dropdown
    if (bankSelect) {
      bankSelect.innerHTML = '<option value="">(select bank account)</option>';
      (opts.bankAccounts || []).forEach(acc => {
        // server should send fullName or name
        const fullName = acc.fullName || acc.name || '';
        if (!fullName) return;

        const opt = document.createElement('option');
        opt.value = fullName;
        opt.textContent = fullName;
        if (fullName === currentPayrollSettings.bank_account_name) {
          opt.selected = true;
        }
        bankSelect.appendChild(opt);
      });
    }

    // Populate expense dropdown
    if (expenseSelect) {
      expenseSelect.innerHTML = '<option value="">(select expense account)</option>';
      (opts.expenseAccounts || []).forEach(acc => {
        const fullName = acc.fullName || acc.name || '';
        if (!fullName) return;

        const opt = document.createElement('option');
        opt.value = fullName;
        opt.textContent = fullName;
        if (fullName === currentPayrollSettings.expense_account_name) {
          opt.selected = true;
        }
        expenseSelect.appendChild(opt);
      });
    }

    // Memo + line description templates
    if (memoInput) {
      memoInput.value = currentPayrollSettings.default_memo;
    }
    if (lineDescInput) {
      lineDescInput.value = currentPayrollSettings.line_description_template;
    }
  } catch (err) {
    console.error('Error loading payroll settings/options:', err);

    // fall back to just settings if account options fail
    try {
      const res = await fetch('/api/payroll/settings');
      const data = res.ok ? await res.json() : {};

      currentPayrollSettings = {
        bank_account_name: data.bank_account_name || null,
        expense_account_name: data.expense_account_name || null,
        default_memo: data.default_memo || 'Payroll {start} – {end}',
        line_description_template:
          data.line_description_template || 'Labor {hours} hrs – {project}'
      };

      if (bankSelect) bankSelect.value = currentPayrollSettings.bank_account_name || '';
      if (expenseSelect) expenseSelect.value = currentPayrollSettings.expense_account_name || '';
      if (memoInput) memoInput.value = currentPayrollSettings.default_memo;
      if (lineDescInput) lineDescInput.value = currentPayrollSettings.line_description_template;
    } catch (err2) {
      console.error('Error loading fallback payroll settings:', err2);
    }
  }
}

async function loadPayrollClasses() {
  try {
    const data = await fetchJSON('/api/payroll/classes');
    if (data && data.ok && Array.isArray(data.classes)) {
      payrollClasses = data.classes;
    } else {
      payrollClasses = [];
    }
  } catch (err) {
    console.error('Error loading payroll classes:', err);
    payrollClasses = [];
  }
}

async function savePayrollSettings() {
  const bankSelect    = document.getElementById('payroll-bank-account');
  const expenseSelect = document.getElementById('payroll-expense-account');
  const memoInput     = document.getElementById('payroll-memo-template');
  const lineDescInput = document.getElementById('payroll-line-desc-template');

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
    alert('Failed to save payroll settings: ' + data.error);
    return;
  }

  // ✅ Save in memory
  currentPayrollSettings = payload;

  // ✅ Collapse the settings card after save
  const body   = document.getElementById('payroll-settings-body');
  const chev   = document.getElementById('payroll-settings-chevron');

  if (body && chev) {
    body.classList.add('hidden');  // hide the content
    chev.textContent = '▸';        // closed chevron
  }
}

async function loadPayrollSummary() {
  const startInput = document.getElementById('payroll-start');
  const endInput   = document.getElementById('payroll-end');

  const start = startInput?.value || '';
  const end   = endInput?.value || '';

  // 🔒 Validate dates BEFORE calling API
  if (!validatePayrollDates(start, end)) {
    return;
  }

  currentPayrollRange = { start, end };
  payrollOverrides = {}; // reset overrides for this range

  const params = new URLSearchParams({ start, end });
  const url = `/api/payroll-summary?${params.toString()}`;

  const res = await fetch(url);
  const rows = await res.json();

  currentPayrollRows = Array.isArray(rows) ? rows : [];
  renderPayrollSummaryTable();
  setupPayrollOverrideInputs();
}

function setupPayrollOverrideInputs() {
  document.querySelectorAll('.payroll-memo-input').forEach(input => {
    const empId = input.dataset.employeeId;
    if (!empId) return;

    function updateMemo() {
      payrollOverrides[empId] = payrollOverrides[empId] || {};
      payrollOverrides[empId].memo = input.value || null;
    }

    input.addEventListener('input', updateMemo);
    input.addEventListener('change', updateMemo);
  });

  // --- LINE-ITEM OVERRIDES (EXPENSE, DESCRIPTION, CLASS) ---
  document
    .querySelectorAll('.line-expense-select, .line-desc-input, .line-class-input')
    .forEach(el => {
      const empId = el.dataset.employeeId;
      const projectId = el.dataset.projectId;
      if (!empId || !projectId) return;

      const key = `${empId}:${projectId}`;

      function updateLineOverride() {
        const row = el.closest('tr');
        if (!row) return;

        const expenseSel = row.querySelector('.line-expense-select');
        const descInput = row.querySelector('.line-desc-input');
        const classInput = row.querySelector('.line-class-input');

        payrollLineOverrides[key] = {
          employeeId: Number(empId),
          projectId: Number(projectId),
          expenseAccountName: expenseSel?.value || null,
          description: descInput?.value || null,
          className: classInput?.value || null
        };
      }

      el.addEventListener('input', updateLineOverride);
      el.addEventListener('change', updateLineOverride);
    });
}

function closeTimeEntriesModal() {
  const modal = document.getElementById('time-entries-modal');
  const backdrop = document.getElementById('time-entries-backdrop');
  if (modal) modal.classList.add('hidden');
  if (backdrop) backdrop.classList.add('hidden');
}

async function openTimeEntriesModal(employeeId, employeeName) {
  const modal = document.getElementById('time-entries-modal');
  const backdrop = document.getElementById('time-entries-backdrop');
  const bodyEl = document.getElementById('time-entries-body');
  const titleEl = document.getElementById('time-entries-title');

  if (!modal || !backdrop || !bodyEl || !titleEl) return;

  const { start, end } = currentPayrollRange || {};
  if (!start || !end) {
    alert('Please select a start and end date first.');
    return;
  }

  // Format date range heading in US style
  const startUS = formatDateUS(start);
  const endUS = formatDateUS(end);

  titleEl.textContent = `Time Entries for ${employeeName} (${startUS} – ${endUS})`;

  bodyEl.innerHTML = '<p>Loading time entries…</p>';

  try {
    const params = new URLSearchParams({
      employeeId: String(employeeId),
      start,
      end
    });

    const res = await fetch('/api/payroll/time-entries?' + params.toString());
    const entries = await res.json();

    if (!Array.isArray(entries) || !entries.length) {
      bodyEl.innerHTML =
        '<p>No time entries for this employee in this date range.</p>';
    } else {
      const byProject = new Map();
      for (const e of entries) {
        const key = e.project_name || '(No project)';
        if (!byProject.has(key)) byProject.set(key, []);
        byProject.get(key).push(e);
      }

      let html = '';
      for (const [projectName, list] of byProject.entries()) {
        let totalHours = 0;
        let totalPay = 0;

        list.forEach(e => {
  totalHours += Number(e.hours || 0);
  totalPay += Number(e.total_pay || 0);
});

html += `
  <h4>${projectName}</h4>
  <table class="table nested-table">
    <thead>
      <tr>
        <th>Date</th>
        <th>Hours</th>
        <th>Rate</th>
        <th>Pay</th>
      </tr>
    </thead>
    <tbody>
      ${list
        .map(e => {
          const hours = Number(e.hours || 0);
          const rowPay = Number(e.total_pay || 0);

          // Rate calculation fallback
          const rate = Number(
            e.rate || (hours > 0 ? rowPay / hours : 0)
          );

          // ⭐ Format single or range dates in US format
          const startDateUS = formatDateUS(e.start_date);
          const endDateUS = formatDateUS(e.end_date);

          const dateLabel =
            e.start_date === e.end_date
              ? startDateUS
              : `${startDateUS} – ${endDateUS}`;

          return `
  <tr
    class="time-entry-row"
    data-entry-id="${e.id}"
    data-employee-id="${employeeId}"
    data-project-id="${e.project_id || ''}"
    data-start-date="${e.start_date || ''}"
    data-end-date="${e.end_date || ''}"
    data-hours="${hours.toFixed(2)}"
  >
    <td>${dateLabel}</td>
    <td>${hours.toFixed(2)}</td>
    <td>$${rate.toFixed(2)}/hr</td>
    <td>$${rowPay.toFixed(2)}</td>
  </tr>
`;

        })
        .join('')}
      <tr class="project-total-row">
        <td><strong>Project Total</strong></td>
        <td><strong>${formatHoursMinutes(totalHours)}</strong></td>
        <td></td>
        <td><strong>$${totalPay.toFixed(2)}</strong></td>
      </tr>
    </tbody>
  </table>
`;

      }

      bodyEl.innerHTML = html;
    }

    // Make each row clickable to edit that time entry
bodyEl.querySelectorAll('tr.time-entry-row').forEach(tr => {
  tr.addEventListener('click', () => {
    // Close the modal
    closeTimeEntriesModal();

    // Switch sidebar to the "Time Entries" section
    const timeNav = document.querySelector('.nav-item[data-section="time-entries"]');
    if (timeNav) {
      timeNav.click();
    }

    // After the section is active, load this entry into the edit form
    setTimeout(() => {
      if (typeof loadTimeEntryIntoFormFromRow === 'function') {
        loadTimeEntryIntoFormFromRow(tr);
      }
    }, 0);
  });
});


    // Show modal + backdrop
    modal.classList.remove('hidden');
    backdrop.classList.remove('hidden');
  } catch (err) {
    console.error('Failed to load time entries:', err);
    bodyEl.innerHTML = '<p>Failed to load time entries.</p>';
    modal.classList.remove('hidden');
    backdrop.classList.remove('hidden');
  }
}

function setupPayrollRowToggle() {
  const tbody = document.getElementById('payroll-summary-body');
  tbody.addEventListener('click', e => {
    let tr = e.target.closest('tr.payroll-row');
    if (!tr) return;

    const empId = tr.dataset.employeeId;
    const detailsRow = tbody.querySelector(
      `tr.payroll-details-row[data-employee-id="${empId}"]`
    );
    if (!detailsRow) return;

    detailsRow.classList.toggle('hidden');
  });
}

function setupViewTimeEntriesButtons() {
  const tbody = document.getElementById('payroll-summary-body');
  if (!tbody) return;

  tbody.addEventListener('click', e => {
    const btn = e.target.closest('.btn-view-time-entries');
    if (!btn) return;

    // Prevent the row click handler from toggling the details row
    e.stopPropagation();

    const empId = Number(btn.dataset.employeeId);
    const empName = btn.dataset.employeeName || '';
    if (!empId) return;

    openTimeEntriesModal(empId, empName);
  });
}

function setupPayrollSettingsCollapse() {
  const header = document.getElementById('payroll-settings-toggle');
  const body = document.getElementById('payroll-settings-body');
  const chev = document.getElementById('payroll-settings-chevron');

  header.addEventListener('click', () => {
    const isHidden = body.classList.toggle('hidden');
    chev.textContent = isHidden ? '▸' : '▾';
  });
}

async function createChecksForCurrentRange() {
  const { start, end } = currentPayrollRange || {};

  if (!validatePayrollDates(start, end)) {
    return;
  }

  // Build overrides payload from in-memory overrides
  const overridesArray = Object.entries(payrollOverrides || {}).map(
    ([employeeId, ov]) => ({
      employeeId: Number(employeeId),
      expenseAccountName: ov.expenseAccountName || null,
      memo: ov.memo || null,
      lineDescriptionTemplate: ov.lineDescriptionTemplate || null
    })
  );

  const payload = {
    start,
    end,
    bankAccountName: currentPayrollSettings.bank_account_name || null,
    expenseAccountName: currentPayrollSettings.expense_account_name || null,
    memo: currentPayrollSettings.default_memo || null,
    lineDescriptionTemplate:
      currentPayrollSettings.line_description_template || null,
    overrides: overridesArray,
    isRetry: false,
    originalPayrollRunId: null,
    onlyEmployeeIds: []
  };

  const createBtn = document.getElementById('payroll-create-checks');
  const retryBtn  = document.getElementById('payroll-retry-failed');

  // 🔒 Prevent double-clicks
  if (createBtn) createBtn.disabled = true;
  if (retryBtn)  retryBtn.disabled  = true;

  try {
    const confirmed = confirm(
      `Create QuickBooks checks for the period ${start} to ${end}?`
    );
    if (!confirmed) {
      return;
    }

    const res = await fetch('/api/payroll/create-checks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    console.log('Create checks result:', data);

    lastPayrollResults = data.results || null;
    lastPayrollRunId   = data.payrollRunId || null;

    if (!data.ok) {
      let msg = data.error || data.reason || 'Unknown error creating checks.';

      if (Array.isArray(data.results) && data.results.length) {
        const failed = data.results.filter(r => r && r.ok === false);
        if (failed.length) {
          msg += '\n\nFailed employees:\n' +
            failed
              .map(f => `• ${f.employeeName} – ${f.error || 'Unknown error'}`)
              .join('\n');
        }
      }

      alert('Could not create checks:\n\n' + msg);

      if (retryBtn) {
        const hasFailures =
          Array.isArray(lastPayrollResults) &&
          lastPayrollResults.some(r => r && r.ok === false);
        retryBtn.disabled = !hasFailures;
      }

      return;
    }

    const results = Array.isArray(data.results) ? data.results : [];
    const total   = results.length;
    const failed  = results.filter(r => r && r.ok === false);
    const okList  = results.filter(r => r && r.ok !== false);

    let msg = `Checks created successfully.\nPayroll run ID: ${data.payrollRunId || '(none)'}`;

    if (total) {
      msg += `\n\nSummary: ${okList.length} succeeded, ${failed.length} failed.`;
    }

    if (failed.length) {
      msg += '\n\nFailed employees:\n' +
        failed
          .map(f => `• ${f.employeeName} – ${f.error || 'Unknown error'}`)
          .join('\n');
    }

    alert(msg);

    if (retryBtn) {
      retryBtn.disabled = !failed.length;
    }

    if (typeof loadPayrollSummary === 'function') {
      loadPayrollSummary();
    }
  } catch (err) {
    console.error('Error calling /api/payroll/create-checks:', err);
    alert(
      'There was a problem contacting the server while creating checks.\n\n' +
      (err && err.message ? err.message : String(err))
    );
  } finally {
    if (createBtn) createBtn.disabled = false;
  }
}

async function retryFailedChecksForCurrentRun() {
  const { start, end } = currentPayrollRange || {};

  if (!validatePayrollDates(start, end)) {
    return;
  }

  if (!Array.isArray(lastPayrollResults) || !lastPayrollResults.length) {
    alert('There is no previous payroll run to retry.');
    return;
  }

  if (!lastPayrollRunId) {
    alert('Cannot retry: no original payroll run ID is available.');
    return;
  }

  // Filter out the employees that actually failed last time
  const failed = lastPayrollResults.filter(
    r => r && r.ok === false && r.employeeId
  );

  if (!failed.length) {
    alert('There are no failed employees to retry.');
    return;
  }

  const failedEmployeeIds = [
    ...new Set(
      failed
        .map(f => Number(f.employeeId))
        .filter(id => Number.isFinite(id))
    )
  ];

  if (!failedEmployeeIds.length) {
    alert('Could not determine which employees failed to retry.');
    return;
  }

  // Build overrides only for those failed employees
  const overridesArray = Object.entries(payrollOverrides || {})
    .map(([employeeId, ov]) => ({
      employeeId: Number(employeeId),
      expenseAccountName: ov.expenseAccountName || null,
      memo: ov.memo || null,
      lineDescriptionTemplate: ov.lineDescriptionTemplate || null
    }))
    .filter(o =>
      o.employeeId &&
      failedEmployeeIds.includes(o.employeeId) &&
      (o.expenseAccountName || o.memo || o.lineDescriptionTemplate)
    );

  const payload = {
    start,
    end,
    bankAccountName: currentPayrollSettings.bank_account_name || null,
    expenseAccountName: currentPayrollSettings.expense_account_name || null,
    memo: currentPayrollSettings.default_memo || null,
    lineDescriptionTemplate:
      currentPayrollSettings.line_description_template || null,
    overrides: overridesArray,
    isRetry: true,
    originalPayrollRunId: lastPayrollRunId,
    onlyEmployeeIds: failedEmployeeIds
  };

  const label =
    failedEmployeeIds.length === 1
      ? '1 failed employee'
      : `${failedEmployeeIds.length} failed employees`;

  if (!confirm(`Retry QuickBooks checks for ${label}?`)) {
    return;
  }

  const createBtn = document.getElementById('payroll-create-checks');
  const retryBtn  = document.getElementById('payroll-retry-failed');

  if (createBtn) createBtn.disabled = true;
  if (retryBtn)  retryBtn.disabled  = true;

  try {
    const res = await fetch('/api/payroll/create-checks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    console.log('Retry failed checks result:', data);

    lastPayrollResults = data.results || null;
    lastPayrollRunId   = data.payrollRunId || lastPayrollRunId;

    if (!data.ok) {
      let msg = data.error || data.reason || 'Unknown error.';

      if (Array.isArray(data.results) && data.results.length) {
        const stillFailed = data.results.filter(r => r && r.ok === false);
        if (stillFailed.length) {
          msg += '\n\nStill failing:\n' +
            stillFailed
              .map(f => `• ${f.employeeName} – ${f.error || 'Unknown error'}`)
              .join('\n');
        }
      }

      alert('Could not retry checks:\n\n' + msg);

      if (retryBtn) {
        const hasFailures =
          Array.isArray(lastPayrollResults) &&
          lastPayrollResults.some(r => r && r.ok === false);
        retryBtn.disabled = !hasFailures;
      }
      return;
    }

    const results = Array.isArray(data.results) ? data.results : [];
    const total   = results.length;
    const failedAgain  = results.filter(r => r && r.ok === false);
    const succeeded    = results.filter(r => r && r.ok !== false);

    let msg = `Retry complete.\nPayroll run ID: ${data.payrollRunId || lastPayrollRunId || '(none)'}`;

    if (total) {
      msg += `\n\nSummary: ${succeeded.length} succeeded, ${failedAgain.length} failed.`;
    }

    if (failedAgain.length) {
      msg += '\n\nStill failing:\n' +
        failedAgain
          .map(f => `• ${f.employeeName} – ${f.error || 'Unknown error'}`)
          .join('\n');
    }

    alert(msg);

    if (retryBtn) {
      retryBtn.disabled = !failedAgain.length;
    }

    if (typeof loadPayrollSummary === 'function') {
      loadPayrollSummary();
    }
  } catch (err) {
    console.error('Error calling /api/payroll/create-checks (retry):', err);
    alert(
      'There was a problem contacting the server while retrying failed checks.\n\n' +
      (err && err.message ? err.message : String(err))
    );

    if (retryBtn) {
      const hasFailures =
        Array.isArray(lastPayrollResults) &&
        lastPayrollResults.some(r => r && r.ok === false);
      retryBtn.disabled = !hasFailures;
    }
  } finally {
    if (createBtn) createBtn.disabled = false;
  }
}

function initPayrollTabIfNeeded() {
  // Only run once
  if (initPayrollTabIfNeeded._init) return;
  initPayrollTabIfNeeded._init = true;

  setupPayrollSettingsCollapse();
  setupPayrollRowToggle();

  // New: wire up "View Time Entries" buttons, if that helper exists
  if (typeof setupViewTimeEntriesButtons === 'function') {
    setupViewTimeEntriesButtons();
  }

  const settingsSaveBtn = document.getElementById('payroll-settings-save');
  if (settingsSaveBtn) {
    settingsSaveBtn.addEventListener('click', savePayrollSettings);
  }

  const refreshBtn = document.getElementById('payroll-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadPayrollSummary);
  }

  const createChecksBtn = document.getElementById('payroll-create-checks');
  if (createChecksBtn) {
    createChecksBtn.addEventListener('click', createChecksForCurrentRange);
  }

    const retryBtn = document.getElementById('payroll-retry-failed');
  if (retryBtn) {
    retryBtn.addEventListener('click', retryFailedChecksForCurrentRun);
  }


  // Time-entries modal close handlers (for View Time Entries)
  const closeBtn = document.getElementById('time-entries-close');
  const backdrop = document.getElementById('time-entries-backdrop');

  if (closeBtn && typeof closeTimeEntriesModal === 'function') {
    closeBtn.addEventListener('click', closeTimeEntriesModal);
  }
  if (backdrop && typeof closeTimeEntriesModal === 'function') {
    backdrop.addEventListener('click', (e) => {
      // only close if they clicked the dim background
      if (e.target === backdrop) {
        closeTimeEntriesModal();
      }
    });
  }

  // Default dates: today → today
  const today = new Date().toISOString().slice(0, 10);
  const startInput = document.getElementById('payroll-start');
  const endInput   = document.getElementById('payroll-end');

  if (startInput && !startInput.value) startInput.value = today;
  if (endInput && !endInput.value)     endInput.value   = today;

  // Load settings, classes, then initial summary
  Promise.all([loadPayrollSettings(), loadPayrollClasses()])
    .then(() => loadPayrollSummary())
    .catch(err => console.error('Error initializing payroll tab:', err));
}

function renderPayrollSummaryTable() {
  const tbody = document.getElementById('payroll-summary-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  // Group rows by employee
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

  // Nicely formatted dates for this payroll range
  const startUS = formatDateUS(currentPayrollRange.start);
  const endUS   = formatDateUS(currentPayrollRange.end);
  const dateRange = `${startUS || ''} – ${endUS || ''}`;

  const memoTemplate =
    (currentPayrollSettings && currentPayrollSettings.default_memo) ||
    'Payroll {start} – {end}';

  // Shared datalist for Class autocompletion
  const classDatalistId = 'qb-class-options';

  for (const agg of byEmployee.values()) {
    // Summary row
    const tr = document.createElement('tr');
    tr.classList.add('payroll-row');
    tr.dataset.employeeId = agg.employee_id;
    tr.dataset.employeeName = agg.employee_name || '';

    tr.innerHTML = `
      <td>${agg.employee_name || ''}</td>
      <td>(multiple)</td>
      <td>${agg.total_hours.toFixed(2)}</td>
      <td>$${agg.total_pay.toFixed(2)}</td>
      <td>
<button
  type="button"
  class="btn secondary btn-compact btn-view-time-entries"
  data-employee-id="${agg.employee_id}"
  data-employee-name="${agg.employee_name || ''}"
>
  View Time Entries
</button>


      </td>
    `;

    // Per-employee memo text
    const memoText = memoTemplate
      .replace('{employee}', agg.employee_name || '')
      .replace('{start}', startUS || '')
      .replace('{end}', endUS || '')
      .replace('{dateRange}', dateRange);

    // Details row
    const detailsTr = document.createElement('tr');
    detailsTr.classList.add('payroll-details-row', 'hidden');
    detailsTr.dataset.employeeId = agg.employee_id;

    const colCount = 5; // matches your new header

    detailsTr.innerHTML = `
      <td colspan="${colCount}">
        <div class="payroll-details">
          <div class="details-columns">
            <!-- LEFT: Check header + memo -->
            <div class="details-column">
              <h4>QuickBooks Check Preview</h4>
              <p><strong>Employee:</strong> ${agg.employee_name}</p>
              <p><strong>Check Date:</strong> ${formatDateUS(currentPayrollRange.end)}</p>
              <p><strong>Total Amount:</strong> $${agg.total_pay.toFixed(2)}</p>
              <p><strong>Bank Account:</strong> ${
                currentPayrollSettings.bank_account_name || '(not set)'
              }</p>

              <div class="form-field" style="margin-top: 0.75rem;">
                <label><strong>Default Memo</strong></label>
                <input
                  type="text"
                  class="payroll-memo-input"
                  data-employee-id="${agg.employee_id}"
                  value="${memoText}"
                />
              </div>
            </div>

            <!-- RIGHT: Line items, QuickBooks-style -->
            <div class="details-column">
              <h4>Line Items</h4>
              ${
                agg.projects && agg.projects.length
                  ? `
                    <table class="table nested-table">
                      <thead>
                        <tr>
                          <th>Expense Account</th>
                          <th>Description</th>
                          <th>Amount</th>
                          <th>Customer / Project</th>
                          <th>Class</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${
                          agg.projects
                            .map(p => {
                              const hours  = Number(p.hours || 0);
                              const amount = Number(p.total_pay || 0);

                              const lineDesc = buildPayrollPreviewDescription(
                                currentPayrollSettings.line_description_template,
                                agg.employee_name,
                                p.project_name,
                                hours,
                                currentPayrollRange.start,
                                currentPayrollRange.end
                              );

                              const defaultExpenseName =
                                currentPayrollSettings.expense_account_name || '';

                              const expenseOptions = (payrollExpenseAccounts || [])
                                .map(acc => {
                                  const fullName =
                                    acc.fullName ||
                                    acc.FullyQualifiedName ||
                                    acc.name ||
                                    '';
                                  if (!fullName) return '';
                                  const selected =
                                    fullName === defaultExpenseName ? ' selected' : '';
                                  return `<option value="${fullName}"${selected}>${fullName}</option>`;
                                })
                                .join('');

                              const defaultClassName =
                                p.class_name ||
                                findProjectDefaultClassName(p.project_name);

                              return `
                                <tr>
                                  <td>
                                    <select
                                      class="line-expense-select"
                                      data-employee-id="${agg.employee_id}"
                                      data-project-id="${p.project_id}"
                                    >
                                      <option value="">
                                        (Use default${
                                          defaultExpenseName
                                            ? ': ' + defaultExpenseName
                                            : ''
                                        })
                                      </option>
                                      ${expenseOptions}
                                    </select>
                                  </td>
                                  <td>
                                    <input
                                      type="text"
                                      class="line-desc-input"
                                      data-employee-id="${agg.employee_id}"
                                      data-project-id="${p.project_id}"
                                      value="${lineDesc}"
                                    />
                                  </td>
                                  <td>$${amount.toFixed(2)}</td>
                                  <td>${p.project_name || ''}</td>
                                  <td>
                                    <input
                                      type="text"
                                      class="line-class-input"
                                      list="${classDatalistId}"
                                      data-employee-id="${agg.employee_id}"
                                      data-project-id="${p.project_id}"
                                      value="${defaultClassName || ''}"
                                      placeholder="(none)"
                                    />
                                  </td>
                                </tr>
                              `;
                            })
                            .join('')
                        }
                      </tbody>
                    </table>
                    ${
                      payrollClasses && payrollClasses.length
                        ? `
                          <datalist id="${classDatalistId}">
                            ${
                              payrollClasses
                                .map(c => {
                                  const label = c.fullName || c.name || '';
                                  return label
                                    ? `<option value="${label}"></option>`
                                    : '';
                                })
                                .join('')
                            }
                          </datalist>
                        `
                        : ''
                    }
                  `
                  : '<p>No line items available.</p>'
              }
            </div>
          </div>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
    tbody.appendChild(detailsTr);
  }
}

async function loadPayrollRuns() {
  const tbody = document.getElementById('reports-runs-body');
  const msgEl = document.getElementById('reports-message');
  if (!tbody) return; // reports section not on this page

  tbody.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';

  try {
    const runs = await fetchJSON('/api/reports/payroll-runs');

    if (!runs.length) {
      tbody.innerHTML =
        '<tr><td colspan="5">(no payroll runs yet)</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    runs.forEach(run => {
      const tr = document.createElement('tr');
      const paidText = `${run.paid_checks || 0}/${run.check_count || 0}`;
      const period = `${run.start_date} → ${run.end_date}`;
      const created = run.created_at
        ? new Date(run.created_at).toLocaleString()
        : '';

      tr.innerHTML = `
        <td>${period}</td>
        <td>${created}</td>
        <td>${Number(run.total_hours || 0).toFixed(2)}</td>
        <td>$${Number(run.total_pay || 0).toFixed(2)}</td>
        <td>${paidText}</td>
      `;
      tr.dataset.runId = run.id;
      tr.addEventListener('click', () => {
        loadPayrollRunDetails(run.id);
      });
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading payroll runs:', err);
    msgEl.textContent = 'Error loading payroll runs: ' + err.message;
  }
}

async function loadPayrollRunDetails(runId) {
  const tbody = document.getElementById('reports-details-body');
  const downloadBtn = document.getElementById('reports-download');
  const msgEl = document.getElementById('reports-message');
  if (!tbody) return;

  currentRunId = runId;
  currentRunDetails = [];
  if (downloadBtn) downloadBtn.disabled = true;

  tbody.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';

  try {
    const details = await fetchJSON(`/api/reports/payroll-runs/${runId}`);
    currentRunDetails = details;

    if (!details.length) {
      tbody.innerHTML =
        '<tr><td colspan="5">(no checks recorded for this run)</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    if (downloadBtn) downloadBtn.disabled = false;

    details.forEach(row => {
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td>${row.employee_name}</td>
        <td>${Number(row.total_hours || 0).toFixed(2)}</td>
        <td>$${Number(row.total_pay || 0).toFixed(2)}</td>
        <td><input type="text" class="reports-check-input" value="${row.check_number || ''}" /></td>
        <td><input type="checkbox" class="reports-paid-input" ${row.paid ? 'checked' : ''}></td>
      `;

      const checkInput = tr.querySelector('.reports-check-input');
      const paidInput = tr.querySelector('.reports-paid-input');

      checkInput.addEventListener('change', () => {
        updateCheckRow(row.id, {
          check_number: checkInput.value,
          paid: paidInput.checked
        });
      });

      paidInput.addEventListener('change', () => {
        updateCheckRow(row.id, {
          check_number: checkInput.value,
          paid: paidInput.checked
        });
      });

      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading payroll run details:', err);
    msgEl.textContent = 'Error loading run details: ' + err.message;
  }
}

async function updateCheckRow(checkId, payload) {
  try {
    await fetchJSON(`/api/reports/checks/${checkId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    // Refresh header stats (paid / total counts)
    loadPayrollRuns();
  } catch (err) {
    alert('Error saving check info: ' + err.message);
  }
}

function setupReportsDownload() {
  const btn = document.getElementById('reports-download');
  if (!btn) return;

  btn.addEventListener('click', () => {
    if (!currentRunDetails.length) return;

    const header = ['Employee', 'Hours', 'Total Pay', 'Check Number', 'Paid'];
    const lines = [header.join(',')];

    currentRunDetails.forEach(row => {
      lines.push(
        [
          `"${row.employee_name}"`,
          Number(row.total_hours || 0).toFixed(2),
          Number(row.total_pay || 0).toFixed(2),
          `"${row.check_number || ''}"`,
          row.paid ? 'Yes' : 'No'
        ].join(',')
      );
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-run-${currentRunId || 'export'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
}
