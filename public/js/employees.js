/* ───────── 4. EMPLOYEES UI ───────── */


let editingEmployeeId = null;
let currentEmployeeIsActive = true;
let employeeListStatus = 'active'; // 'active' or 'inactive'
let employeesTableData = [];
let editingEmployeeOriginalRate = null;
let pendingEmployees = [];

// Track current admin access that may be injected by app.js after settings load
window.CURRENT_ACCESS_PERMS = window.CURRENT_ACCESS_PERMS || {};

function canCurrentAdminModifyPayRates() {
  const perms = window.CURRENT_ACCESS_PERMS || {};
  return perms.modify_pay_rates === true || perms.modify_pay_rates === 'true';
}

const SUPPORTED_EMP_LANGS = ['en', 'es', 'ht'];
function normalizeEmployeeLanguage(value) {
  const code = (value || '').toString().trim().toLowerCase();
  return SUPPORTED_EMP_LANGS.includes(code) ? code : 'en';
}

// Allow app.js to push updated access info once settings are fetched
function applyRateAccessToEmployees(perms = {}) {
  window.CURRENT_ACCESS_PERMS = {
    ...window.CURRENT_ACCESS_PERMS,
    modify_pay_rates: perms.modify_pay_rates === true || perms.modify_pay_rates === 'true'
  };
}

const employeeFormCard = document.getElementById('employee-create-card');
const employeeShowCreateBtn = document.getElementById('employee-show-create');
const employeeHideCreateBtn = document.getElementById('employee-hide-create');

function showCreateCard() {
  if (!employeeFormCard) return;
  employeeFormCard.classList.remove('hidden');

  if (employeeShowCreateBtn) {
    employeeShowCreateBtn.classList.add('hidden');
  }
  if (employeeHideCreateBtn) {
    employeeHideCreateBtn.classList.remove('hidden');
  }

  // optional: focus first field
  const nameInput = document.getElementById('employee-name');
  if (nameInput) nameInput.focus();
}

function hideCreateCard() {
  if (!employeeFormCard) return;
  employeeFormCard.classList.add('hidden');

  if (employeeShowCreateBtn) {
    employeeShowCreateBtn.classList.remove('hidden');
    employeeShowCreateBtn.textContent = 'New employee';
  }
  if (employeeHideCreateBtn) {
    employeeHideCreateBtn.classList.add('hidden');
  }

  clearEmployeeForm();
}

// Toggle between active / inactive employees
const employeeToggleInactiveBtn = document.getElementById('employee-toggle-inactive');

if (employeeToggleInactiveBtn) {
  employeeToggleInactiveBtn.addEventListener('click', async () => {
    // Flip the status
    employeeListStatus =
      employeeListStatus === 'active' ? 'inactive' : 'active';

    // Update button label
    employeeToggleInactiveBtn.textContent =
      employeeListStatus === 'active' ? 'Show Inactive' : 'Show Active';

    // Optional: clear search so you see the full list
    const searchInput = document.getElementById('employees-search');
    if (searchInput) searchInput.value = '';

    // Reload the table with the new status
    await loadEmployeesTable();
  });
}


if (employeeShowCreateBtn) {
  employeeShowCreateBtn.addEventListener('click', showCreateCard);
}
if (employeeHideCreateBtn) {
  employeeHideCreateBtn.addEventListener('click', hideCreateCard);
}

async function loadEmployeesTable() {
  const tbody = document.getElementById('employees-table-body');
  if (!tbody) return;

  tbody.innerHTML =
    employeeListStatus === 'active'
      ? '<tr><td colspan="6">Loading active employees...</td></tr>'
      : '<tr><td colspan="6">Loading inactive employees...</td></tr>';

  try {
    const employees = await fetchJSON(
      `/api/employees?status=${encodeURIComponent(employeeListStatus)}`
    );

    employeesTableData = employees || [];

    const searchInput = document.getElementById('employees-search');
    const term = searchInput ? searchInput.value : '';
    renderEmployeesTable(term);
  } catch (err) {
    console.error('Error loading employees:', err.message);
    employeesTableData = [];
    tbody.innerHTML =
      '<tr><td colspan="6">Error loading employees</td></tr>';
  }

  // Refresh pending list alongside the main table
  loadPendingEmployees();
}

function renderEmployeesTable(filterTerm = '') {
  const tbody = document.getElementById('employees-table-body');
  if (!tbody) return;

  const term = filterTerm.trim().toLowerCase();
  let rows = employeesTableData || [];

  if (term) {
    rows = rows.filter(emp => {
      const fields = [
        emp.name || '',
        emp.nickname || '',
        emp.name_on_checks || ''
      ].map(s => s.toLowerCase());

      // match “starts with” on any of those fields
      return fields.some(f => f.startsWith(term));
    });
  }

  if (!rows.length) {
    const label =
      employeesTableData.length === 0
        ? `(no ${employeeListStatus} employees)`
        : '(no matching employees)';

    tbody.innerHTML = `<tr><td colspan="6">${label}</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  rows.forEach(emp => {
    const tr = document.createElement('tr');

    const nickname = emp.nickname || '';
    const nameOnChecks = emp.name_on_checks || '';
    const qboStatus = emp.employee_qbo_id || emp.vendor_qbo_id ? 'Linked' : 'Needs link';

    // default off if undefined/null (same as in the modal)
const usesTimekeeping = !!emp.uses_timekeeping; // default false

tr.innerHTML = `
  <td>
    <div class="tk-tooltip-wrapper">
      <input
        type="checkbox"
        disabled
        ${usesTimekeeping ? 'checked' : ''}
        aria-label="Uses timekeeping"
        class="tk-checkbox"
      />
      <div class="tk-tooltip">
        Edit this employee to change their timekeeping settings
      </div>
    </div>
  </td>

  <td>${emp.name}</td>
  <td>${nickname}</td>
  <td>${nameOnChecks}</td>
  <td>$${Number(emp.rate || 0).toFixed(2)}</td>
  <td>
    <span class="${qboStatus === 'Linked' ? 'pill pill-good' : 'pill pill-warn'}">
      ${qboStatus}
    </span>
  </td>
`;


    tr.addEventListener('click', () => {
      openEmployeeModal(emp);
    });

    tbody.appendChild(tr);
  });
}

async function loadPendingEmployees() {
  const card = document.getElementById('pending-employees-card');
  const body = document.getElementById('pending-employees-body');
  const message = document.getElementById('pending-employees-message');
  const badge = document.getElementById('pending-employees-count');
  if (!card || !body) return;

  body.innerHTML = '<tr><td colspan="5">Loading…</td></tr>';
  try {
    const res = await fetchJSON('/api/employees?status=pending');
    pendingEmployees = Array.isArray(res) ? res : [];
    renderPendingEmployees();

    if (badge) {
      badge.textContent = pendingEmployees.length ? `(${pendingEmployees.length})` : '';
    }
    if (pendingEmployees.length) {
      card.classList.remove('hidden');
    } else {
      card.classList.add('hidden');
    }
    if (message) message.textContent = '';
  } catch (err) {
    console.error('Error loading pending employees:', err);
    if (body) body.innerHTML = '<tr><td colspan="5">Failed to load pending employees.</td></tr>';
    if (message) {
      message.textContent = 'Could not load pending employees.';
      message.style.color = 'red';
    }
  }
}

function renderPendingEmployees() {
  const body = document.getElementById('pending-employees-body');
  if (!body) return;

  if (!pendingEmployees.length) {
    body.innerHTML = '<tr><td colspan="5">(no pending employees)</td></tr>';
    return;
  }

  body.innerHTML = '';
  pendingEmployees.forEach(emp => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${emp.name || '(no name)'}</td>
      <td>$${Number(emp.rate || 0).toFixed(2)}</td>
      <td>${emp.nickname || ''}</td>
      <td>${emp.name_on_checks || ''}</td>
      <td class="pending-actions">
        <input type="text" placeholder="QBO Employee ID" data-emp-id="${emp.id}" class="pending-qbo-emp" />
        <input type="text" placeholder="QBO Vendor ID (optional)" data-emp-id="${emp.id}" class="pending-qbo-vendor" />
        <button class="btn primary btn-sm pending-link-btn" data-emp-id="${emp.id}">Mark linked</button>
      </td>
    `;
    body.appendChild(tr);
  });
}

async function loadEmployeesForSelect() {
  const teEmployeeSelect = document.getElementById('te-employee');
  const filterEmployeeSelect = document.getElementById('te-filter-employee');

  if (!teEmployeeSelect && !filterEmployeeSelect) return;

  if (teEmployeeSelect) {
    teEmployeeSelect.innerHTML = '<option value="">(select employee)</option>';
  }
  if (filterEmployeeSelect) {
    filterEmployeeSelect.innerHTML = '<option value="">(all employees)</option>';
  }

  try {
    const employees = await fetchJSON('/api/employees?status=active');

    employees.forEach(emp => {
      if (teEmployeeSelect) {
        const opt = document.createElement('option');
        opt.value = emp.id;
        opt.textContent = `${emp.name} ($${Number(emp.rate || 0).toFixed(2)}/hr)`;
        teEmployeeSelect.appendChild(opt);
      }

      if (filterEmployeeSelect) {
        const opt2 = document.createElement('option');
        opt2.value = emp.id;
        opt2.textContent = emp.name;
        filterEmployeeSelect.appendChild(opt2);
      }
    });
  } catch (err) {
    console.error('Error loading employees for select:', err.message);
  }
}

async function saveEmployee() {
  const nameInput = document.getElementById('employee-name');
  const nicknameInput = document.getElementById('employee-nickname');
  const nameOnChecksInput = document.getElementById('employee-name-on-checks');
  const rateInput = document.getElementById('employee-rate');
  const usesTimeCheckbox = document.getElementById('employee-uses-timekeeping');
  const adminCheckbox = document.getElementById('employee-is-admin');
  const msgEl = document.getElementById('employee-message');

  const name = nameInput.value.trim();
  const nickname = nicknameInput.value.trim();
  const name_on_checks = nameOnChecksInput.value.trim();
  const rate = parseFloat(rateInput.value);
  const uses_timekeeping = usesTimeCheckbox ? usesTimeCheckbox.checked : false;
  const is_admin = adminCheckbox && adminCheckbox.checked ? 1 : 0;

  if (!name || isNaN(rate)) {
    msgEl.textContent = 'Name and a numeric rate are required.';
    msgEl.style.color = 'red';
    return;
  }

  const payload = {
    name,
    rate,
    nickname: nickname || null,
    name_on_checks: name_on_checks || null,
    uses_timekeeping: uses_timekeeping ? 1 : 0,
    is_admin
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

    // 🔑 Clear the employees search filter so the new employee is always visible
    const empSearch = document.getElementById('employees-search');
    if (empSearch) empSearch.value = '';

    await loadEmployeesTable();
    await loadEmployeesForSelect();
    await loadPendingEmployees();
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
  const usesTimeCheckbox = document.getElementById('employee-uses-timekeeping');
  const adminCheckbox = document.getElementById('employee-is-admin');
  const msgEl = document.getElementById('employee-message');

  if (nameInput) nameInput.value = '';
  if (nicknameInput) nicknameInput.value = '';
  if (nameOnChecksInput) nameOnChecksInput.value = '';
  if (rateInput) rateInput.value = '';
  if (usesTimeCheckbox) usesTimeCheckbox.checked = true;  // default ON
  if (adminCheckbox) adminCheckbox.checked = false;       // default OFF
  if (msgEl) msgEl.textContent = '';
}

function setEmployeeInputsReadOnly(isReadOnly) {
  const nameInput = document.getElementById('edit-employee-name');
  const nicknameInput = document.getElementById('edit-employee-nickname');
  const nameOnChecksInput = document.getElementById(
    'edit-employee-name-on-checks'
  );
  const rateInput = document.getElementById('edit-employee-rate');
  const adminCheckbox = document.getElementById('edit-employee-is-admin');
  const timekeepingCheckbox = document.getElementById('edit-employee-uses-timekeeping');
  const languageSelect = document.getElementById('edit-employee-language');
  const viewShipmentsCheckbox = document.getElementById('edit-employee-can-view-shipments'); // 👈 NEW
  const pinInput = document.getElementById('edit-employee-pin');
  const pinConfirmInput = document.getElementById('edit-employee-pin-confirm');

  // 🔒 QBO-owned fields → ALWAYS read-only
  [nameInput, nameOnChecksInput].forEach(input => {
    if (input) {
      input.readOnly = true;
      input.style.backgroundColor = '#f9fafb';
    }
  });

  // 🔓 App-controlled fields → toggle with edit mode
  if (nicknameInput) {
    nicknameInput.readOnly = isReadOnly;
    nicknameInput.style.backgroundColor = isReadOnly ? '#f9fafb' : '#ffffff';
  }

  if (rateInput) {
    const lockRate = isReadOnly || !canCurrentAdminModifyPayRates();
    rateInput.readOnly = lockRate;
    rateInput.style.backgroundColor = lockRate ? '#f9fafb' : '#ffffff';
  }

  // checkboxes use disabled instead of readOnly
  if (adminCheckbox) adminCheckbox.disabled = isReadOnly;
  if (timekeepingCheckbox) timekeepingCheckbox.disabled = isReadOnly;
  if (viewShipmentsCheckbox) viewShipmentsCheckbox.disabled = isReadOnly; // 👈 NEW
  if (languageSelect) languageSelect.disabled = isReadOnly;
  if (languageSelect) {
    languageSelect.style.backgroundColor = isReadOnly ? '#f9fafb' : '#ffffff';
  }

  // PIN fields follow the same pattern as rate
  [pinInput, pinConfirmInput].forEach(input => {
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
  const toggleBtn = document.getElementById('employee-edit-toggle-active');

  setEmployeeInputsReadOnly(true);

  if (msgEl) {
    msgEl.textContent = '';
    msgEl.style.color = 'black';
  }

  // Single button UI: this button is "Edit" in view mode
  if (editBtn) {
    editBtn.classList.remove('hidden');
    editBtn.textContent = 'Edit';
  }

  // We won't actually use the separate Save button anymore
  if (saveBtn) saveBtn.classList.add('hidden');

  // Only show Make Inactive when editing
  if (toggleBtn) toggleBtn.classList.add('hidden');
}

function enterEmployeeEditMode() {
  const msgEl = document.getElementById('employee-edit-message');
  const editBtn = document.getElementById('employee-edit-edit');
  const saveBtn = document.getElementById('employee-edit-save');
  const toggleBtn = document.getElementById('employee-edit-toggle-active');

  setEmployeeInputsReadOnly(false);

  if (msgEl) {
    if (canCurrentAdminModifyPayRates()) {
      msgEl.textContent = 'Editing. Make changes and click "Save".';
      msgEl.style.color = 'black';
    } else {
      msgEl.textContent = 'Editing. Pay rates are locked for your account.';
      msgEl.style.color = '#b45309';
    }
  }

  // Same button now becomes "Save"
  if (editBtn) {
    editBtn.classList.remove('hidden');
    editBtn.textContent = 'Save';
  }

  // Keep the dedicated Save button hidden
  if (saveBtn) saveBtn.classList.add('hidden');

  // Show Make Inactive only in edit mode
  if (toggleBtn) toggleBtn.classList.remove('hidden');

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
  initEmployeeModalControls();
  
  if (!emp) return;

  editingEmployeeId = emp.id;
  currentEmployeeIsActive = emp.active !== 0 && emp.active !== false;

  const modal = document.getElementById('employee-edit-modal');
  const backdrop = document.getElementById('employee-edit-backdrop');

  const titleEl = document.getElementById('employee-edit-title');
  const nameInput = document.getElementById('edit-employee-name');
  const nicknameInput = document.getElementById('edit-employee-nickname');
  const nameOnChecksInput = document.getElementById('edit-employee-name-on-checks');
  const rateInput = document.getElementById('edit-employee-rate');
  const adminCheckbox = document.getElementById('edit-employee-is-admin');
  const timekeepingCheckbox = document.getElementById('edit-employee-uses-timekeeping');
  const languageSelect = document.getElementById('edit-employee-language');

  // PIN-related fields
  const pinInput = document.getElementById('edit-employee-pin');
  const pinConfirmInput = document.getElementById('edit-employee-pin-confirm');
  const pinStatusEl = document.getElementById('employee-edit-pin-status');
  const emailInput = document.getElementById('edit-employee-email');
  const viewShipmentsCheckbox = document.getElementById('edit-employee-can-view-shipments');

  // Title with active/inactive tag
  if (titleEl) {
    const statusTag = currentEmployeeIsActive ? '' : ' (inactive)';
    titleEl.textContent = `Employee: ${emp.name || ''}${statusTag}`;
  }

  if (emailInput) {
    emailInput.value = emp.email || '';
    emailInput.readOnly = true;
    emailInput.style.backgroundColor = '#f9fafb';
  }

  // Basic fields
  if (nameInput) nameInput.value = emp.name || '';
  if (nicknameInput) nicknameInput.value = emp.nickname || '';
  if (nameOnChecksInput) nameOnChecksInput.value = emp.name_on_checks || '';
  if (rateInput) rateInput.value = emp.rate != null ? emp.rate : '';
  editingEmployeeOriginalRate = emp.rate != null ? Number(emp.rate) : null;

  // Admin flag
  if (adminCheckbox) adminCheckbox.checked = !!emp.is_admin;

if (timekeepingCheckbox) {
  const val = emp.uses_timekeeping;
  timekeepingCheckbox.checked =
    val === undefined || val === null ? true : !!val;
}

// NEW: Shipments flag (default false if missing)
if (viewShipmentsCheckbox) {
  viewShipmentsCheckbox.checked = !!emp.kiosk_can_view_shipments;
}

  if (languageSelect) {
    languageSelect.value = normalizeEmployeeLanguage(emp.language);
  }

  // Clear PIN inputs every time modal opens
  if (pinInput) pinInput.value = '';
  if (pinConfirmInput) pinConfirmInput.value = '';
  if (pinStatusEl) {
    pinStatusEl.textContent = emp.pin
      ? 'PIN is currently set for this employee.'
      : 'No PIN set yet for this employee.';
  }

  // Start in view mode
  enterEmployeeViewMode();
  updateActiveToggleButtonLabel();

  if (modal) modal.classList.remove('hidden');
  if (backdrop) backdrop.classList.remove('hidden');
}

async function saveEmployeeFromModal() {
  const msgEl = document.getElementById('employee-edit-message');
  const nameInput = document.getElementById('edit-employee-name');
  const nicknameInput = document.getElementById('edit-employee-nickname');
  const nameOnChecksInput = document.getElementById(
    'edit-employee-name-on-checks'
  );
  const rateInput = document.getElementById('edit-employee-rate');
  const adminCheckbox = document.getElementById('edit-employee-is-admin');
  const timekeepingCheckbox = document.getElementById('edit-employee-uses-timekeeping');
  const languageSelect = document.getElementById('edit-employee-language');

  // PIN fields
  const pinInput = document.getElementById('edit-employee-pin');
  const pinConfirmInput = document.getElementById('edit-employee-pin-confirm');
  const pinStatusEl = document.getElementById('employee-edit-pin-status');

  if (!editingEmployeeId) {
    if (msgEl) {
      msgEl.textContent = 'No employee selected to edit.';
      msgEl.style.color = 'red';
    }
    return;
  }

  const name = nameInput ? nameInput.value.trim() : '';
  const nickname = nicknameInput ? nicknameInput.value.trim() : '';
  const name_on_checks = nameOnChecksInput ? nameOnChecksInput.value.trim() : '';
  const incomingRate = rateInput ? parseFloat(rateInput.value) : NaN;
  const canEditRate = canCurrentAdminModifyPayRates();
  let rate = incomingRate;

  const is_admin = adminCheckbox && adminCheckbox.checked ? 1 : 0;
  const uses_timekeeping = timekeepingCheckbox
    ? (timekeepingCheckbox.checked ? 1 : 0)
    : 1; // default ON if checkbox not found
  const language = languageSelect
    ? normalizeEmployeeLanguage(languageSelect.value)
    : 'en';

    const view_shipments = (() => {
  const cb = document.getElementById('edit-employee-can-view-shipments');
  return cb && cb.checked ? 1 : 0;
})();


  if (!name) {
    if (msgEl) {
      msgEl.textContent = 'Name is required.';
      msgEl.style.color = 'red';
    }
    return;
  }

  if (!canEditRate) {
    const original = editingEmployeeOriginalRate;
    const rateProvided = !Number.isNaN(incomingRate);
    const changed =
      rateProvided &&
      (original === null ||
        Number(incomingRate).toFixed(4) !== Number(original || 0).toFixed(4));
    if (changed) {
      if (msgEl) {
        msgEl.textContent = 'You do not have permission to modify pay rates.';
        msgEl.style.color = 'red';
      }
      if (rateInput && original !== null) {
        rateInput.value = Number(original).toFixed(2);
      }
      return;
    }
    rate = original;
  } else if (Number.isNaN(incomingRate)) {
    if (msgEl) {
      msgEl.textContent = 'Hourly rate must be a number.';
      msgEl.style.color = 'red';
    }
    return;
  }

  const payload = {
    id: editingEmployeeId,
    name,
    rate,
    nickname: nickname || null,
    name_on_checks: name_on_checks || null,
    is_admin,
    uses_timekeeping,
    kiosk_can_view_shipments: view_shipments,
    language
  };

  try {
    // Save base employee fields
    await fetchJSON('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    // Handle PIN (optional)
    const pin = pinInput ? pinInput.value.trim() : '';
    const pinConfirm = pinConfirmInput ? pinConfirmInput.value.trim() : '';

    if (pin || pinConfirm) {
      if (pin !== pinConfirm) {
        throw new Error('PIN entries do not match.');
      }

      if (!/^\d{4}$/.test(pin)) {
        throw new Error('PIN must be exactly 4 digits.');
      }

      await fetchJSON(`/api/employees/${editingEmployeeId}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin,
          allowOverride: true
        })
      });

      if (pinStatusEl) {
        pinStatusEl.textContent = 'PIN updated for this employee.';
      }
    }

    if (msgEl) {
      msgEl.textContent = 'Employee updated.';
      msgEl.style.color = 'green';
    }

    // 🔑 Clear the employees search filter so we don't end up with "(no matching employees)"
    const empSearch = document.getElementById('employees-search');
    if (empSearch) empSearch.value = '';

    await loadEmployeesTable();
    await loadEmployeesForSelect();
    closeEmployeeEditModal();
  } catch (err) {
    if (msgEl) {
      msgEl.textContent = 'Error: ' + err.message;
      msgEl.style.color = 'red';
    }
  }
}

function closeEmployeeEditModal() {
  editingEmployeeId = null;
  editingEmployeeOriginalRate = null;

  const modal = document.getElementById('employee-edit-modal');
  const backdrop = document.getElementById('employee-edit-backdrop');
  const msgEl = document.getElementById('employee-edit-message');
  const pinStatusEl = document.getElementById('employee-edit-pin-status');

  if (modal) modal.classList.add('hidden');
  if (backdrop) backdrop.classList.add('hidden');

  // Clear messages
  if (msgEl) {
    msgEl.textContent = '';
    msgEl.style.color = 'black';
  }
  if (pinStatusEl) {
    pinStatusEl.textContent = '';
  }

  // Reset modal back to view mode for next time
  enterEmployeeViewMode();
}

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

    // 🔑 Clear the employees search filter before reloading
    const empSearch = document.getElementById('employees-search');
    if (empSearch) empSearch.value = '';

    await loadEmployeesTable();
    await loadEmployeesForSelect();

    if (!newActive && employeeListStatus === 'active') {
      // Just made them inactive while viewing the active list → they disappear from the table.
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

function initEmployeeModalControls() {
  // Make this safe to call more than once
  if (initEmployeeModalControls._init) return;
  initEmployeeModalControls._init = true;

  const closeBtn    = document.getElementById('employee-edit-close');
  const xBtn        = document.getElementById('employee-edit-x');       // top-right X
  const cancelBtn   = document.getElementById('employee-edit-cancel');  // footer cancel, if you have one
  const backdrop    = document.getElementById('employee-edit-backdrop');

  const editBtn     = document.getElementById('employee-edit-edit');    // main Edit/Save button
  const saveBtn     = document.getElementById('employee-edit-save');    // if you still have a separate Save button
  const toggleBtn   = document.getElementById('employee-edit-toggle-active');

  // Close actions
  [closeBtn, xBtn, cancelBtn].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        closeEmployeeEditModal();
      });
    }
  });

  if (backdrop) {
    backdrop.addEventListener('click', () => {
      closeEmployeeEditModal();
    });
  }

  // Edit / Save behavior (single button that toggles)
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      // We’re using the same button as Edit and Save based on its label
      if (editBtn.textContent.trim() === 'Edit') {
        enterEmployeeEditMode();
      } else {
        // label is "Save"
        saveEmployeeFromModal();
      }
    });
  }

  // If you still keep a separate Save button, wire it too
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      saveEmployeeFromModal();
    });
  }

  // Active / inactive toggle
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      toggleEmployeeActiveFromModal();
    });
  }
}

function clearEmployeeSearch() {
  const f = document.getElementById("employees-search");
  if (f) f.value = "";
}

document.addEventListener("DOMContentLoaded", clearEmployeeSearch);
window.addEventListener("load", () => {
  setTimeout(clearEmployeeSearch, 10);   // Chrome sneaky autofill pass #1
  setTimeout(clearEmployeeSearch, 150);  // Chrome sneaky autofill pass #2
});

// Also clear when switching TO the Employees tab
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".nav-item");
  if (btn && btn.dataset.section === "employees") {
    setTimeout(clearEmployeeSearch, 30);
  }
});

// ───────── FINAL AUTOFILL KILL SWITCH FOR EMPLOYEE SEARCH ─────────
(function () {
  function reallyClearEmployeeSearch() {
    const f = document.getElementById('employees-search');
    if (!f) return;
    f.value = '';
  }

  document.addEventListener('DOMContentLoaded', () => {
    const f = document.getElementById('employees-search');
    if (!f) return;

    // Temporarily make it read-only so Chrome won't autofill it
    f.readOnly = true;
    f.value = '';

    // After a short delay, re-enable typing and clear again
    setTimeout(() => {
      f.readOnly = false;
      reallyClearEmployeeSearch();
    }, 500);

    // Extra safety passes in case autofill fires late
    setTimeout(reallyClearEmployeeSearch, 1000);
    setTimeout(reallyClearEmployeeSearch, 2000);
  });
})();

// Position fixed tooltip near hovered checkbox
document.addEventListener("mouseover", (e) => {
  const wrapper = e.target.closest(".tk-tooltip-wrapper");
  if (!wrapper) return;

  const tooltip = wrapper.querySelector(".tk-tooltip");
  if (!tooltip) return;

  const rect = wrapper.getBoundingClientRect();

  tooltip.style.left = rect.left + rect.width / 2 + "px";
  tooltip.style.top = rect.top - 10 + "px"; // position above
});

// Live search for employees
const employeesSearchInput = document.getElementById('employees-search');
if (employeesSearchInput) {
  employeesSearchInput.addEventListener('input', () => {
    renderEmployeesTable(employeesSearchInput.value);
  });
}

const pendingCard = document.getElementById('pending-employees-card');
if (pendingCard) {
  pendingCard.addEventListener('click', async e => {
    const btn = e.target.closest('.pending-link-btn');
    if (!btn) return;
    const empId = btn.dataset.empId;
    const row = btn.closest('tr');
    const empInput = row ? row.querySelector('.pending-qbo-emp') : null;
    const vendorInput = row ? row.querySelector('.pending-qbo-vendor') : null;
    const qboEmpId = empInput ? empInput.value.trim() : '';
    const qboVendorId = vendorInput ? vendorInput.value.trim() : '';
    const msg = document.getElementById('pending-employees-message');

    if (!empId) return;
    if (!qboEmpId && !qboVendorId) {
      if (msg) {
        msg.textContent = 'Enter a QuickBooks Employee or Vendor ID.';
        msg.style.color = 'red';
      }
      return;
    }

    try {
      btn.disabled = true;
      await fetchJSON(`/api/employees/${empId}/link-qbo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_qbo_id: qboEmpId || null,
          vendor_qbo_id: qboVendorId || null
        })
      });
      if (msg) {
        msg.textContent = 'Linked to QuickBooks. Pending list updated.';
        msg.style.color = 'green';
      }
      await loadPendingEmployees();
      await loadEmployeesTable();
    } catch (err) {
      console.error('Link QBO error:', err);
      if (msg) {
        msg.textContent = 'Failed to link: ' + (err.message || err);
        msg.style.color = 'red';
      }
    } finally {
      btn.disabled = false;
    }
  });
}
