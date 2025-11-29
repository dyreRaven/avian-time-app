/* ───────── 4. EMPLOYEES UI ───────── */


let editingEmployeeId = null;
let currentEmployeeIsActive = true;
let employeeListStatus = 'active'; // 'active' or 'inactive'
let employeesTableData = [];

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
    employeeShowCreateBtn.textContent = 'Add employee manually';
  }
  if (employeeHideCreateBtn) {
    employeeHideCreateBtn.classList.add('hidden');
  }

  clearEmployeeForm();
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
      ? '<tr><td colspan="5">Loading active employees...</td></tr>'
      : '<tr><td colspan="5">Loading inactive employees...</td></tr>';

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
      '<tr><td colspan="5">Error loading employees</td></tr>';
  }
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

    tbody.innerHTML = `<tr><td colspan="5">${label}</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  rows.forEach(emp => {
    const tr = document.createElement('tr');

    const nickname = emp.nickname || '';
    const nameOnChecks = emp.name_on_checks || '';

    // default off if undefined/null (same as in the modal)
const usesTimekeeping = !!emp.uses_timekeeping; // default false

    tr.innerHTML = `
      <td>
        <input
          type="checkbox"
          disabled
          ${usesTimekeeping ? 'checked' : ''}
          aria-label="Uses timekeeping"
        />
      </td>
      <td>${emp.name}</td>
      <td>${nickname}</td>
      <td>${nameOnChecks}</td>
      <td>$${Number(emp.rate).toFixed(2)}</td>
    `;

    tr.addEventListener('click', () => {
      openEmployeeModal(emp);
    });

    tbody.appendChild(tr);
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
        opt.textContent = `${emp.name} ($${Number(emp.rate).toFixed(2)}/hr)`;
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
  if (usesTimeCheckbox) usesTimeCheckbox.checked = false;  // default OFF
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
    rateInput.readOnly = isReadOnly;
    rateInput.style.backgroundColor = isReadOnly ? '#f9fafb' : '#ffffff';
  }

  // checkboxes use disabled instead of readOnly
  if (adminCheckbox) adminCheckbox.disabled = isReadOnly;
  if (timekeepingCheckbox) timekeepingCheckbox.disabled = isReadOnly;

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
    msgEl.textContent = 'Editing. Make changes and click "Save".';
    msgEl.style.color = 'black';
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

  // PIN-related fields
  const pinInput = document.getElementById('edit-employee-pin');
  const pinConfirmInput = document.getElementById('edit-employee-pin-confirm');
  const pinStatusEl = document.getElementById('employee-edit-pin-status');

  // Title with active/inactive tag
  if (titleEl) {
    const statusTag = currentEmployeeIsActive ? '' : ' (inactive)';
    titleEl.textContent = `Employee: ${emp.name || ''}${statusTag}`;
  }

  // Basic fields
  if (nameInput) nameInput.value = emp.name || '';
  if (nicknameInput) nicknameInput.value = emp.nickname || '';
  if (nameOnChecksInput) nameOnChecksInput.value = emp.name_on_checks || '';
  if (rateInput) rateInput.value = emp.rate != null ? emp.rate : '';

  // Admin flag
  if (adminCheckbox) adminCheckbox.checked = !!emp.is_admin;

  // Timekeeping flag (default ON if missing / null)
  if (timekeepingCheckbox) {
    const val = emp.uses_timekeeping;
    timekeepingCheckbox.checked =
      val === undefined || val === null ? true : !!val;
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
  const rate = rateInput ? parseFloat(rateInput.value) : NaN;

  const is_admin = adminCheckbox && adminCheckbox.checked ? 1 : 0;
  const uses_timekeeping = timekeepingCheckbox
    ? (timekeepingCheckbox.checked ? 1 : 0)
    : 1; // default ON if checkbox not found

  if (!name) {
    if (msgEl) {
      msgEl.textContent = 'Name is required.';
      msgEl.style.color = 'red';
    }
    return;
  }

  if (Number.isNaN(rate)) {
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
    uses_timekeeping
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
