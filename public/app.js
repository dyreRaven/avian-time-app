// public/app.js

// Helper to fetch JSON with basic error handling
async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || data.message || 'Request failed';
    throw new Error(msg);
  }
  return data;
}

function formatDateUS(iso) {
  if (!iso) return '';
  const parts = iso.split('-'); // [YYYY, MM, DD]
  if (parts.length !== 3) return iso;
  const [year, month, day] = parts;
  return `${month}/${day}/${year}`;
}


// For the employee modal and list
let editingEmployeeId = null;
let currentEmployeeIsActive = true;
let employeeListStatus = 'active'; // 'active' or 'inactive'

/* ───────── QUICKBOOKS STATUS & SYNC BUTTONS ───────── */

async function checkStatus() {
  try {
    const data = await fetchJSON('/api/status');
    const el = document.getElementById('qb-status');
    el.textContent = data.qbConnected
      ? '🔗 Connected to QuickBooks'
      : '❌ Not connected to QuickBooks';
  } catch (err) {
    document.getElementById('qb-status').textContent =
      'Error checking status: ' + err.message;
  }
}

/* ───────── SIDEBAR NAVIGATION ───────── */

function setupSidebarNavigation() {
  const buttons = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.section');

  function activateSection(key) {
    // highlight menu
    buttons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.section === key);
    });

    // show/hide sections
    sections.forEach(sec => {
      const secKey = sec.id.replace('section-', '');
      sec.classList.toggle('active', secKey === key);
    });
  }

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.section;
      activateSection(key);

      if (key === 'reports') {
        loadPayrollRuns();
      }
    });
  });

  // default section
  activateSection('employees');
}

/* ───────── QUICKBOOKS SYNC ROUTES ───────── */

async function syncRoute(route) {
  try {
    const data = await fetchJSON(route, { method: 'POST' });
    alert(data.message || 'Sync complete.');

    // After syncing from QuickBooks, reload what depends on it
    if (route === '/api/sync/vendors') {
      await loadEmployeesTable();
      await loadEmployeesForSelect();
    }
    if (route === '/api/sync/projects') {
      await loadProjectsForTimeEntries();
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

/* ───────── EMPLOYEES ───────── */

// Load employees into main table, filtered by employeeListStatus
async function loadEmployeesTable() {
  const tbody = document.getElementById('employees-table-body');
  if (!tbody) return;

  tbody.innerHTML =
    employeeListStatus === 'active'
      ? '<tr><td colspan="4">Loading active employees...</td></tr>'
      : '<tr><td colspan="4">Loading inactive employees...</td></tr>';

  try {
    const employees = await fetchJSON(
      `/api/employees?status=${encodeURIComponent(employeeListStatus)}`
    );

    if (!employees.length) {
      tbody.innerHTML =
        `<tr><td colspan="4">(no ${employeeListStatus} employees)</td></tr>`;
      return;
    }

    tbody.innerHTML = '';
    employees.forEach(emp => {
      const tr = document.createElement('tr');

      const nickname = emp.nickname || '';
      const nameOnChecks = emp.name_on_checks || '';

      tr.innerHTML = `
        <td>${emp.name}</td>
        <td>${nickname}</td>
        <td>${nameOnChecks}</td>
        <td>$${Number(emp.rate).toFixed(2)}</td>
      `;

      // Click row → open modal in VIEW mode
      tr.addEventListener('click', () => {
        openEmployeeModal(emp);
      });

      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading employees:', err.message);
    tbody.innerHTML =
      '<tr><td colspan="4">Error loading employees</td></tr>';
  }
}

// Load active employees into the time-entry dropdown
async function loadEmployeesForSelect() {
  const teEmployeeSelect = document.getElementById('te-employee');
  if (!teEmployeeSelect) return;

  teEmployeeSelect.innerHTML = '<option value="">(select employee)</option>';

  try {
    const employees = await fetchJSON('/api/employees?status=active');

    employees.forEach(emp => {
      const opt = document.createElement('option');
      opt.value = emp.id;
      opt.textContent = `${emp.name} ($${Number(emp.rate).toFixed(2)}/hr)`;
      teEmployeeSelect.appendChild(opt);
    });
  } catch (err) {
    console.error('Error loading employees for select:', err.message);
  }
}

// Save employee from the CREATE form (always creates a new record)
async function saveEmployee() {
  const nameInput = document.getElementById('employee-name');
  const nicknameInput = document.getElementById('employee-nickname');
  const nameOnChecksInput = document.getElementById('employee-name-on-checks');
  const rateInput = document.getElementById('employee-rate');
  const msgEl = document.getElementById('employee-message');

  const name = nameInput.value.trim();
  const nickname = nicknameInput.value.trim();
  const name_on_checks = nameOnChecksInput.value.trim();
  const rate = parseFloat(rateInput.value);

  if (!name || isNaN(rate)) {
    msgEl.textContent = 'Name and a numeric rate are required.';
    msgEl.style.color = 'red';
    return;
  }

  const payload = {
    name,
    rate,
    nickname: nickname || null,
    name_on_checks: name_on_checks || null
  };

  try {
    await fetchJSON('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    msgEl.textContent = 'Employee added.';
    msgEl.style.color = 'green';

    clearEmployeeForm();
    await loadEmployeesTable();
    await loadEmployeesForSelect();
  } catch (err) {
    msgEl.textContent = 'Error: ' + err.message;
    msgEl.style.color = 'red';
  }
}

function clearEmployeeForm() {
  const nameInput = document.getElementById('employee-name');
  const nicknameInput = document.getElementById('employee-nickname');
  const nameOnChecksInput = document.getElementById('employee-name-on-checks');
  const rateInput = document.getElementById('employee-rate');
  const msgEl = document.getElementById('employee-message');

  if (nameInput) nameInput.value = '';
  if (nicknameInput) nicknameInput.value = '';
  if (nameOnChecksInput) nameOnChecksInput.value = '';
  if (rateInput) rateInput.value = '';
  if (msgEl) msgEl.textContent = '';
}

/* ───────── EDIT EMPLOYEE MODAL (VIEW → EDIT → SAVE / MAKE INACTIVE) ───────── */

function setEmployeeInputsReadOnly(isReadOnly) {
  const nameInput = document.getElementById('edit-employee-name');
  const nicknameInput = document.getElementById('edit-employee-nickname');
  const nameOnChecksInput = document.getElementById(
    'edit-employee-name-on-checks'
  );
  const rateInput = document.getElementById('edit-employee-rate');

  [nameInput, nicknameInput, nameOnChecksInput, rateInput].forEach(input => {
    if (input) {
      input.readOnly = isReadOnly;
      input.style.backgroundColor = isReadOnly ? '#f9fafb' : '#ffffff';
    }
  });
}

function enterEmployeeViewMode() {
  const msgEl = document.getElementById('employee-edit-message');
  const editBtn = document.getElementById('employee-edit-edit');
  const saveBtn = document.getElementById('employee-edit-save');

  setEmployeeInputsReadOnly(true);

  if (msgEl) {
    msgEl.textContent = '';
    msgEl.style.color = 'black';
  }
  if (editBtn) editBtn.classList.remove('hidden');
  if (saveBtn) saveBtn.classList.add('hidden');
}

function enterEmployeeEditMode() {
  const msgEl = document.getElementById('employee-edit-message');
  const editBtn = document.getElementById('employee-edit-edit');
  const saveBtn = document.getElementById('employee-edit-save');

  setEmployeeInputsReadOnly(false);

  if (msgEl) {
    msgEl.textContent = 'Editing. Make changes and click "Save Changes".';
    msgEl.style.color = 'black';
  }
  if (editBtn) editBtn.classList.add('hidden');
  if (saveBtn) saveBtn.classList.remove('hidden');

  const nameInput = document.getElementById('edit-employee-name');
  if (nameInput) {
    nameInput.focus();
    nameInput.select();
  }
}

function updateActiveToggleButtonLabel() {
  const btn = document.getElementById('employee-edit-toggle-active');
  if (!btn) return;

  if (currentEmployeeIsActive) {
    btn.textContent = 'Make Inactive';
  } else {
    btn.textContent = 'Make Active';
  }
}

function openEmployeeModal(emp) {
  editingEmployeeId = emp.id;
  currentEmployeeIsActive = emp.active !== 0 && emp.active !== false;

  const modal = document.getElementById('employee-edit-modal');
  const backdrop = document.getElementById('employee-edit-backdrop');

  const titleEl = document.getElementById('employee-edit-title');
  const nameInput = document.getElementById('edit-employee-name');
  const nicknameInput = document.getElementById('edit-employee-nickname');
  const nameOnChecksInput = document.getElementById(
    'edit-employee-name-on-checks'
  );
  const rateInput = document.getElementById('edit-employee-rate');

  if (titleEl) {
    const statusTag = currentEmployeeIsActive ? '' : ' (inactive)';
    titleEl.textContent = `Employee: ${emp.name}${statusTag}`;
  }
  if (nameInput) nameInput.value = emp.name || '';
  if (nicknameInput) nicknameInput.value = emp.nickname || '';
  if (nameOnChecksInput) nameOnChecksInput.value = emp.name_on_checks || '';
  if (rateInput) rateInput.value = emp.rate != null ? emp.rate : '';

  enterEmployeeViewMode();
  updateActiveToggleButtonLabel();

  if (modal) modal.classList.remove('hidden');
  if (backdrop) backdrop.classList.remove('hidden');
}

function closeEmployeeEditModal() {
  editingEmployeeId = null;

  const modal = document.getElementById('employee-edit-modal');
  const backdrop = document.getElementById('employee-edit-backdrop');
  const msgEl = document.getElementById('employee-edit-message');

  if (modal) modal.classList.add('hidden');
  if (backdrop) backdrop.classList.add('hidden');
  if (msgEl) msgEl.textContent = '';

  // Reset to view mode for next time
  enterEmployeeViewMode();
}

// Save changes from the modal (edit mode)
async function saveEmployeeFromModal() {
  const nameInput = document.getElementById('edit-employee-name');
  const nicknameInput = document.getElementById('edit-employee-nickname');
  const nameOnChecksInput = document.getElementById(
    'edit-employee-name-on-checks'
  );
  const rateInput = document.getElementById('edit-employee-rate');
  const msgEl = document.getElementById('employee-edit-message');

  if (!editingEmployeeId) {
    if (msgEl) {
      msgEl.textContent = 'No employee selected to edit.';
      msgEl.style.color = 'red';
    }
    return;
  }

  const name = nameInput.value.trim();
  const nickname = nicknameInput.value.trim();
  const name_on_checks = nameOnChecksInput.value.trim();
  const rate = parseFloat(rateInput.value);

  if (!name || isNaN(rate)) {
    msgEl.textContent = 'Name and a numeric rate are required.';
    msgEl.style.color = 'red';
    return;
  }

  const payload = {
    id: editingEmployeeId,
    name,
    rate,
    nickname: nickname || null,
    name_on_checks: name_on_checks || null
  };

  try {
    await fetchJSON('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    msgEl.textContent = 'Employee updated.';
    msgEl.style.color = 'green';

    await loadEmployeesTable();
    await loadEmployeesForSelect();
    closeEmployeeEditModal();
  } catch (err) {
    msgEl.textContent = 'Error: ' + err.message;
    msgEl.style.color = 'red';
  }
}

// Toggle active / inactive from modal
async function toggleEmployeeActiveFromModal() {
  const msgEl = document.getElementById('employee-edit-message');

  if (!editingEmployeeId) {
    if (msgEl) {
      msgEl.textContent = 'No employee selected.';
      msgEl.style.color = 'red';
    }
    return;
  }

  const newActive = !currentEmployeeIsActive;

  try {
    await fetchJSON(`/api/employees/${editingEmployeeId}/active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: newActive })
    });

    currentEmployeeIsActive = newActive;

    if (msgEl) {
      msgEl.textContent = newActive
        ? 'Employee marked as active.'
        : 'Employee marked as inactive.';
      msgEl.style.color = 'green';
    }

    await loadEmployeesTable();
    await loadEmployeesForSelect();

    // If we just made them inactive and we're viewing active list, they disappear;
    // closing the modal avoids confusion.
    if (!newActive && employeeListStatus === 'active') {
      closeEmployeeEditModal();
    } else {
      updateActiveToggleButtonLabel();
    }
  } catch (err) {
    if (msgEl) {
      msgEl.textContent = 'Error updating employee status: ' + err.message;
      msgEl.style.color = 'red';
    }
  }
}

/* ───────── PROJECTS & TIME ENTRIES ───────── */

// Load projects into the time-entry project dropdown
async function loadProjectsForTimeEntries() {
  const select = document.getElementById('te-project');
  if (!select) return;

  select.innerHTML = '<option value="">(select project)</option>';

  try {
    const projects = await fetchJSON('/api/projects');
    if (!projects.length) return;

    projects.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      const label = p.customer_name
        ? `${p.customer_name} – ${p.name}`
        : p.name;
      opt.textContent = label;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error('Error loading projects:', err.message);
  }
}

// Load recent time entries into table
async function loadTimeEntriesTable() {
  const tbody = document.getElementById('time-table-body');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';

  try {
    const entries = await fetchJSON('/api/time-entries');

    if (!entries.length) {
      tbody.innerHTML =
        '<tr><td colspan="5">(no time entries yet)</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    entries.forEach(row => {
      const tr = document.createElement('tr');
    const dates =
      row.start_date === row.end_date
        ? formatDateUS(row.start_date)
        : `${formatDateUS(row.start_date)} → ${formatDateUS(row.end_date)}`;


      tr.innerHTML = `
        <td>${row.employee_name || ''}</td>
        <td>${row.project_name || ''}</td>
        <td>${dates}</td>
        <td>${Number(row.hours).toFixed(2)}</td>
        <td>$${Number(row.total_pay).toFixed(2)}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading time entries:', err.message);
    tbody.innerHTML =
      '<tr><td colspan="5">Error loading time entries</td></tr>';
  }
}

// Save a new time entry
async function saveTimeEntry() {
  const employeeSelect = document.getElementById('te-employee');
  const projectSelect = document.getElementById('te-project');
  const startInput = document.getElementById('te-start');
  const endInput = document.getElementById('te-end');
  const hoursInput = document.getElementById('te-hours');
  const msgEl = document.getElementById('time-message');

  const employee_id = parseInt(employeeSelect.value, 10);
  const project_id = parseInt(projectSelect.value, 10);
  const start_date = startInput.value;
  const end_date = endInput.value;
  const hours = parseFloat(hoursInput.value);

  if (!employee_id || !project_id || !start_date || !end_date || isNaN(hours)) {
    msgEl.textContent =
      'Employee, project, start date, end date, and numeric hours are required.';
    msgEl.style.color = 'red';
    return;
  }

  try {
    const result = await fetchJSON('/api/time-entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id,
        project_id,
        start_date,
        end_date,
        hours
      })
    });

    msgEl.textContent = `Time entry saved. Total pay: $${Number(
      result.total_pay
    ).toFixed(2)}`;
    msgEl.style.color = 'green';

    startInput.value = '';
    endInput.value = '';
    hoursInput.value = '';

    await loadTimeEntriesTable();
  } catch (err) {
    msgEl.textContent = 'Error: ' + err.message;
    msgEl.style.color = 'red';
  }
}

/* ───────── PAYROLL SUMMARY (PER EMPLOYEE) ───────── */

async function loadPayrollSummary() {
  const startInput = document.getElementById('pay-start');
  const endInput = document.getElementById('pay-end');
  const msgEl = document.getElementById('payroll-message');
  const tbody = document.getElementById('payroll-table-body');

  const start = startInput.value;
  const end = endInput.value;

  if (!start || !end) {
    msgEl.textContent = 'Please select both a start and end date.';
    msgEl.style.color = 'red';
    return;
  }

  msgEl.textContent = '';
  msgEl.style.color = 'black';
  tbody.innerHTML = '<tr><td colspan="4">Loading...</td></tr>';

  try {
    const summary = await fetchJSON(
      `/api/payroll-summary?start=${encodeURIComponent(
        start
      )}&end=${encodeURIComponent(end)}`
    );

    if (!summary.length) {
      tbody.innerHTML =
        '<tr><td colspan="4">(no time entries in this period)</td></tr>';
      return;
    }

    // Group by employee
    const byEmployee = new Map();

    summary.forEach(row => {
      const name = row.employee_name || 'Unknown';
      let emp = byEmployee.get(name);
      if (!emp) {
        emp = {
          employee_name: name,
          projects: [],
          total_hours: 0,
          total_pay: 0
        };
        byEmployee.set(name, emp);
      }

      const hours = Number(row.project_hours || 0);
      const pay = Number(row.project_pay || 0);

      emp.projects.push({
        project_name: row.project_name || '(No project)',
        hours,
        pay
      });

      emp.total_hours += hours;
      emp.total_pay += pay;
    });

    tbody.innerHTML = '';
    let grandHours = 0;
    let grandPay = 0;

    Array.from(byEmployee.values()).forEach(emp => {
      grandHours += emp.total_hours;
      grandPay += emp.total_pay;

      const tr = document.createElement('tr');

      const projectsHtml = emp.projects
        .map(
          p => `
          <div class="project-line">
            <span class="project-name">${p.project_name}</span>:
            ${p.hours.toFixed(2)} hrs ($${p.pay.toFixed(2)})
          </div>
        `
        )
        .join('');

      tr.innerHTML = `
        <td>${emp.employee_name}</td>
        <td>${projectsHtml}</td>
        <td>${emp.total_hours.toFixed(2)}</td>
        <td>$${emp.total_pay.toFixed(2)}</td>
      `;
      tbody.appendChild(tr);
    });

    const totalRow = document.createElement('tr');
    totalRow.innerHTML = `
      <td><strong>Total</strong></td>
      <td></td>
      <td><strong>${grandHours.toFixed(2)}</strong></td>
      <td><strong>$${grandPay.toFixed(2)}</strong></td>
    `;
    tbody.appendChild(totalRow);
  } catch (err) {
    console.error('Error loading payroll summary:', err.message);
    msgEl.textContent = 'Error: ' + err.message;
  }
}

/* ───────── REPORTS: PAYROLL RUNS & CHECKS ───────── */

let currentRunId = null;
let currentRunDetails = [];

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


/* ───────── CREATE CHECKS IN QUICKBOOKS ───────── */

async function createChecksInQuickBooks() {
  const startInput = document.getElementById('pay-start');
  const endInput = document.getElementById('pay-end');
  const msgEl = document.getElementById('payroll-message');

  const start = startInput.value;
  const end = endInput.value;

  if (!start || !end) {
    msgEl.textContent = 'Please select both a start and end date.';
    msgEl.style.color = 'red';
    return;
  }

  msgEl.textContent = 'Creating checks...';
  msgEl.style.color = 'black';

  try {
    const result = await fetchJSON('/api/payroll/create-checks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start, end })
    });

    if (!result.ok && result.reason) {
      msgEl.textContent =
        'Not connected to QuickBooks: ' +
        result.reason +
        ' (draft check data logged in console).';
      msgEl.style.color = 'red';
      console.log('Draft checks:', result.drafts);
      return;
    }

    const parts = [];
    (result.results || []).forEach(r => {
      if (r.ok) {
        parts.push(`✅ ${r.employee}`);
      } else {
        parts.push(`⚠️ ${r.employee}: ${r.error}`);
      }
    });

    msgEl.innerHTML = 'Create checks result:<br>' + parts.join('<br>');
    msgEl.style.color = 'black';
  } catch (err) {
    msgEl.textContent = 'Error creating checks: ' + err.message;
    msgEl.style.color = 'red';
  }
}

/* ───────── INITIALIZE ───────── */

document.addEventListener('DOMContentLoaded', () => {
  // Status + QuickBooks buttons
  checkStatus();

  document.getElementById('connect').onclick = () => {
    window.location = '/auth/qbo';
  };

  document.getElementById('sync-vendors').onclick = () =>
    syncRoute('/api/sync/vendors');

  document.getElementById('sync-projects').onclick = () =>
    syncRoute('/api/sync/projects');

  // Employees (create form)
  document.getElementById('save-employee').onclick = () => {
    saveEmployee();
  };

  const clearBtn = document.getElementById('employee-clear-edit');
  if (clearBtn) {
    clearBtn.onclick = () => {
      clearEmployeeForm();
    };
  }

  // Employee list active/inactive toggle
  const toggleBtn = document.getElementById('employee-toggle-inactive');
  if (toggleBtn) {
    toggleBtn.onclick = () => {
      employeeListStatus =
        employeeListStatus === 'active' ? 'inactive' : 'active';
      toggleBtn.textContent =
        employeeListStatus === 'active' ? 'Show Inactive' : 'Show Active';
      loadEmployeesTable();
    };
    // Ensure correct initial label
    toggleBtn.textContent = 'Show Inactive';
  }

  // Edit modal buttons
  const modalClose = document.getElementById('employee-edit-close');
  const modalCancel = document.getElementById('employee-edit-cancel');
  const modalSave = document.getElementById('employee-edit-save');
  const modalEdit = document.getElementById('employee-edit-edit');
  const modalToggleActive = document.getElementById(
    'employee-edit-toggle-active'
  );
  const modalBackdrop = document.getElementById('employee-edit-backdrop');

  if (modalClose) {
    modalClose.onclick = () => closeEmployeeEditModal();
  }
  if (modalCancel) {
    modalCancel.onclick = () => closeEmployeeEditModal();
  }
  if (modalBackdrop) {
    modalBackdrop.onclick = () => closeEmployeeEditModal();
  }
  if (modalEdit) {
    modalEdit.onclick = () => enterEmployeeEditMode();
  }
  if (modalSave) {
    modalSave.onclick = () => {
      saveEmployeeFromModal();
    };
  }
  if (modalToggleActive) {
    modalToggleActive.onclick = () => {
      toggleEmployeeActiveFromModal();
    };
  }

  // Time entries
  document.getElementById('save-time-entry').onclick = () => {
    saveTimeEntry();
  };

  // Payroll summary
  document.getElementById('load-payroll').onclick = () => {
    loadPayrollSummary();
  };

  // Create checks
  document.getElementById('create-checks').onclick = () => {
    createChecksInQuickBooks();
  };

  // Initial data loads
  loadEmployeesTable();
  loadProjectsForTimeEntries();
  loadTimeEntriesTable();
  loadPayrollRuns();
  setupReportsDownload();

  // Sidebar nav
  setupSidebarNavigation();


  // Sidebar nav
  setupSidebarNavigation();
});
