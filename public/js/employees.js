/* ───────── 4. EMPLOYEES UI ───────── */


let editingEmployeeId = null;
let currentEmployeeIsActive = true;
let employeeListStatus = 'active'; // 'active' or 'inactive'
let employeesTableData = [];
let editingEmployeeOriginalRate = null;
let editingEmployeeOriginalNameOnChecks = '';
let pendingEmployees = [];
let pendingQboStatus = null;
let employeeMissingLanguageFilter = false;
let employeeMissingLanguageCount = 0;
let permissionTemplates = [];

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
function isEmployeeLanguageMissing(value) {
  const code = (value || '').toString().trim().toLowerCase();
  return !code || !SUPPORTED_EMP_LANGS.includes(code);
}

function updateMissingLanguageButton() {
  const btn = document.getElementById('employee-toggle-missing-language');
  if (!btn) return;
  const count = employeeMissingLanguageCount || 0;
  const label = employeeMissingLanguageFilter
    ? `Missing Language (${count}) ✓`
    : `Missing Language (${count})`;
  btn.textContent = label;
  if (employeeMissingLanguageFilter) {
    btn.classList.add('primary');
    btn.classList.remove('secondary');
    btn.disabled = false;
  } else {
    btn.classList.add('secondary');
    btn.classList.remove('primary');
    btn.disabled = count === 0;
  }
}

// Allow app.js to push updated access info once settings are fetched
function applyRateAccessToEmployees(perms = {}) {
  window.CURRENT_ACCESS_PERMS = {
    ...window.CURRENT_ACCESS_PERMS,
    modify_pay_rates: perms.modify_pay_rates === true || perms.modify_pay_rates === 'true'
  };
}

function applySuperAdminAccessToEmployees(isSuperAdmin) {
  const workerTime = document.getElementById('employee-worker-timekeeping');
  const desktopAccess = document.getElementById('employee-desktop-access');
  const kioskAdminAccess = document.getElementById('employee-kiosk-admin-access');
  const roleTitleInput = document.getElementById('employee-role-title');
  const templateSelect = document.getElementById('employee-permission-template');
  const modalRoleTitleInput = document.getElementById('edit-employee-role-title');
  const modalTemplateSelect = document.getElementById('edit-employee-template');
  const shouldLock = !isSuperAdmin;

  [workerTime, desktopAccess, kioskAdminAccess].forEach(el => {
    if (el) el.disabled = shouldLock;
  });
  [roleTitleInput, templateSelect, modalRoleTitleInput, modalTemplateSelect].forEach(el => {
    if (el) el.disabled = shouldLock;
  });
  if (isSuperAdmin) {
    loadPermissionTemplates({ force: true });
  }
}

function renderPermissionTemplateOptions() {
  const selects = [
    document.getElementById('employee-permission-template'),
    document.getElementById('edit-employee-template')
  ].filter(Boolean);
  selects.forEach(select => {
    select.innerHTML = '';
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = 'No template';
    select.appendChild(emptyOption);
    permissionTemplates.forEach(tpl => {
      const opt = document.createElement('option');
      opt.value = tpl.id;
      opt.textContent = tpl.name || 'Template';
      select.appendChild(opt);
    });
  });
}

async function loadPermissionTemplates({ force = false } = {}) {
  if (window.CURRENT_IS_SUPER_ADMIN !== true) {
    permissionTemplates = [];
    renderPermissionTemplateOptions();
    return permissionTemplates;
  }
  if (!force && permissionTemplates.length) return permissionTemplates;
  try {
    const data = await fetchJSON('/api/permission-templates');
    permissionTemplates = (data && data.templates) || [];
  } catch (err) {
    console.warn('Failed to load permission templates:', err.message || err);
    permissionTemplates = [];
  }
  renderPermissionTemplateOptions();
  return permissionTemplates;
}

function findPermissionTemplate(id) {
  if (!id) return null;
  const target = Number(id);
  return permissionTemplates.find(tpl => Number(tpl.id) === target) || null;
}

function applyTemplateToCreateForm(template) {
  if (!template) return;
  const roleTitleInput = document.getElementById('employee-role-title');
  const workerTime = document.getElementById('employee-worker-timekeeping');
  const desktopAccess = document.getElementById('employee-desktop-access');
  const kioskAdminAccess = document.getElementById('employee-kiosk-admin-access');

  if (roleTitleInput) {
    roleTitleInput.value = template.role_title || template.name || '';
  }
  if (workerTime) workerTime.checked = !!template.access?.worker_timekeeping;
  if (desktopAccess) desktopAccess.checked = !!template.access?.desktop_access;
  if (kioskAdminAccess) kioskAdminAccess.checked = !!template.access?.kiosk_admin_access;
}

function applyTemplateToEditForm(template) {
  if (!template) return;
  const roleTitleInput = document.getElementById('edit-employee-role-title');
  const workerTime = document.getElementById('edit-employee-worker-timekeeping');
  const desktopAccess = document.getElementById('edit-employee-desktop-access');
  const kioskAdminAccess = document.getElementById('edit-employee-kiosk-admin-access');
  const permSeeShipments = document.getElementById('edit-employee-perm-see-shipments');
  const permModifyTime = document.getElementById('edit-employee-perm-modify-time');
  const permViewTime = document.getElementById('edit-employee-perm-view-time-reports');
  const permViewAllTimesheets = document.getElementById('edit-employee-perm-view-all-timesheets');
  const permViewPayroll = document.getElementById('edit-employee-perm-view-payroll');
  const permModifyPayroll = document.getElementById('edit-employee-perm-modify-payroll');
  const permModifyRates = document.getElementById('edit-employee-perm-modify-pay-rates');

  if (roleTitleInput) {
    roleTitleInput.value = template.role_title || template.name || '';
  }
  if (workerTime) workerTime.checked = !!template.access?.worker_timekeeping;
  if (desktopAccess) desktopAccess.checked = !!template.access?.desktop_access;
  if (kioskAdminAccess) kioskAdminAccess.checked = !!template.access?.kiosk_admin_access;

  if (permSeeShipments) permSeeShipments.checked = !!template.permissions?.see_shipments;
  if (permModifyTime) permModifyTime.checked = !!template.permissions?.modify_time;
  if (permViewTime) permViewTime.checked = !!template.permissions?.view_time_reports;
  if (permViewAllTimesheets) permViewAllTimesheets.checked = !!template.permissions?.view_all_timesheets;
  if (permViewPayroll) permViewPayroll.checked = !!template.permissions?.view_payroll;
  if (permModifyPayroll) permModifyPayroll.checked = !!template.permissions?.modify_payroll;
  if (permModifyRates) permModifyRates.checked = !!template.permissions?.modify_pay_rates;
}

window.reloadPermissionTemplates = loadPermissionTemplates;

async function ensurePendingQboStatus({ force = false } = {}) {
  if (!force && window.QBO_STATUS) {
    pendingQboStatus = window.QBO_STATUS;
    return pendingQboStatus;
  }
  if (!force && pendingQboStatus) return pendingQboStatus;
  try {
    pendingQboStatus = await fetchJSON('/api/status');
    window.QBO_STATUS = pendingQboStatus;
  } catch (err) {
    console.warn('Failed to load QBO status for pending employees', err);
  }
  return pendingQboStatus;
}

function getQboCreateStatus() {
  const status = pendingQboStatus || window.QBO_STATUS;
  if (!status || !status.qbConnected) {
    return { enabled: false, reason: 'Connect to QuickBooks first.' };
  }
  if (!status.lastSync || !status.lastSync.employees) {
    return { enabled: false, reason: 'Sync employees first.' };
  }
  return { enabled: true, reason: '' };
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
const employeeToggleMissingLanguageBtn = document.getElementById(
  'employee-toggle-missing-language'
);

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

if (employeeToggleMissingLanguageBtn) {
  employeeToggleMissingLanguageBtn.addEventListener('click', () => {
    if (!employeeMissingLanguageFilter && employeeMissingLanguageCount === 0) {
      return;
    }
    employeeMissingLanguageFilter = !employeeMissingLanguageFilter;
    updateMissingLanguageButton();

    const searchInput = document.getElementById('employees-search');
    if (searchInput) searchInput.value = '';

    renderEmployeesTable('');
  });
}


if (employeeShowCreateBtn) {
  employeeShowCreateBtn.addEventListener('click', showCreateCard);
}
if (employeeHideCreateBtn) {
  employeeHideCreateBtn.addEventListener('click', hideCreateCard);
}

const employeeTemplateSelect = document.getElementById('employee-permission-template');
if (employeeTemplateSelect) {
  employeeTemplateSelect.addEventListener('change', () => {
    const template = findPermissionTemplate(employeeTemplateSelect.value);
    applyTemplateToCreateForm(template);
  });
}

const employeeEditTemplateSelect = document.getElementById('edit-employee-template');
if (employeeEditTemplateSelect) {
  employeeEditTemplateSelect.addEventListener('change', () => {
    const template = findPermissionTemplate(employeeEditTemplateSelect.value);
    applyTemplateToEditForm(template);
  });
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
    employeeMissingLanguageCount = employeesTableData.filter(emp =>
      isEmployeeLanguageMissing(emp.language)
    ).length;
    updateMissingLanguageButton();

    const searchInput = document.getElementById('employees-search');
    const term = searchInput ? searchInput.value : '';
    renderEmployeesTable(term);
  } catch (err) {
    console.error('Error loading employees:', err.message);
    employeesTableData = [];
    employeeMissingLanguageCount = 0;
    updateMissingLanguageButton();
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

  if (employeeMissingLanguageFilter) {
    rows = rows.filter(emp => isEmployeeLanguageMissing(emp.language));
  }

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
        : (employeeMissingLanguageFilter ? '(no employees missing language)' : '(no matching employees)');

    tbody.innerHTML = `<tr><td colspan="6">${label}</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  rows.forEach(emp => {
    const tr = document.createElement('tr');

    const nickname = emp.nickname || '';
    const nameOnChecks = emp.name_on_checks || '';
    const languageMissing = isEmployeeLanguageMissing(emp.language);
    const nameBadge = languageMissing
      ? ' <span class="pill pill-warn" title="Language missing; defaulting to English">Language missing</span>'
      : '';
    const displayName = `${emp.name || ''}${nameBadge}`;
    const qboStatus =
      emp.needs_qbo_sync || (!emp.employee_qbo_id && !emp.vendor_qbo_id)
        ? 'Needs link'
        : 'Linked';

    // default off if undefined/null (same as in the modal)
    const usesTimekeeping = !!emp.worker_timekeeping; // default false

tr.innerHTML = `
  <td>
    <div class="tk-tooltip-wrapper">
      <input
        type="checkbox"
        disabled
        ${usesTimekeeping ? 'checked' : ''}
        aria-label="Worker timekeeping"
        class="tk-checkbox"
      />
      <div class="tk-tooltip">
        Edit this employee to change their timekeeping settings
      </div>
    </div>
  </td>

  <td>${displayName}</td>
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
    await ensurePendingQboStatus({ force: true });
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

  const createStatus = getQboCreateStatus();
  const isSuperAdmin = window.CURRENT_IS_SUPER_ADMIN === true;

  body.innerHTML = '';
  pendingEmployees.forEach(emp => {
    const reason = emp.needs_qbo_sync
      ? 'Needs QBO sync'
      : 'Missing QBO IDs';
    const idLink = emp.id_document_uploaded_at
      ? `<a class="pending-id-link" href="/api/employees/${emp.id}/id-document" target="_blank" rel="noopener">View ID</a>`
      : '';
    const canCreate = isSuperAdmin && createStatus.enabled;
    const createReason = isSuperAdmin ? createStatus.reason : 'Super admin required.';
    const createButton = canCreate
      ? `<button class="btn secondary btn-sm pending-create-btn" data-emp-id="${emp.id}">Create in QBO</button>`
      : `<button class="btn secondary btn-sm pending-create-btn" data-emp-id="${emp.id}" disabled title="${createReason}">Create in QBO</button>`;
    const linkDisabledAttr = isSuperAdmin ? '' : 'disabled';
    const linkTitleAttr = isSuperAdmin ? '' : ' title="Super admin required."';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div>${emp.name || '(no name)'}</div>
        <div class="pending-sub">${reason}</div>
        ${idLink}
      </td>
      <td>$${Number(emp.rate || 0).toFixed(2)}</td>
      <td>${emp.nickname || ''}</td>
      <td>${emp.name_on_checks || ''}</td>
      <td class="pending-actions">
        <input type="text" placeholder="QBO Employee ID" data-emp-id="${emp.id}" class="pending-qbo-emp" ${linkDisabledAttr} />
        <input type="text" placeholder="QBO Vendor ID (optional)" data-emp-id="${emp.id}" class="pending-qbo-vendor" ${linkDisabledAttr} />
        <button class="btn primary btn-sm pending-link-btn" data-emp-id="${emp.id}" ${linkDisabledAttr}${linkTitleAttr}>Mark linked</button>
        ${createButton}
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
  const emailInput = document.getElementById('employee-email');
  const rateInput = document.getElementById('employee-rate');
  const roleTitleInput = document.getElementById('employee-role-title');
  const templateSelect = document.getElementById('employee-permission-template');
  const workerTimeCheckbox = document.getElementById('employee-worker-timekeeping');
  const desktopAccessCheckbox = document.getElementById('employee-desktop-access');
  const kioskAdminAccessCheckbox = document.getElementById('employee-kiosk-admin-access');
  const msgEl = document.getElementById('employee-message');

  const name = nameInput.value.trim();
  const nickname = nicknameInput.value.trim();
  const name_on_checks = nameOnChecksInput.value.trim();
  const email = emailInput ? emailInput.value.trim() : '';
  const rate = parseFloat(rateInput.value);
  const worker_timekeeping = workerTimeCheckbox ? workerTimeCheckbox.checked : false;
  const desktop_access = desktopAccessCheckbox ? desktopAccessCheckbox.checked : false;
  const kiosk_admin_access = kioskAdminAccessCheckbox ? kioskAdminAccessCheckbox.checked : false;
  const isSuperAdmin = window.CURRENT_IS_SUPER_ADMIN === true;
  const role_title = roleTitleInput ? roleTitleInput.value.trim() : '';
  const templateId =
    templateSelect && templateSelect.value ? Number(templateSelect.value) : null;

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
    email: email || null
  };

  if (isSuperAdmin) {
    payload.worker_timekeeping = worker_timekeeping ? 1 : 0;
    payload.desktop_access = desktop_access ? 1 : 0;
    payload.kiosk_admin_access = kiosk_admin_access ? 1 : 0;
    if (templateSelect) {
      payload.permission_template_id = templateId || null;
    }
    if (roleTitleInput) {
      payload.role_title = role_title || null;
    }
  }

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
  const emailInput = document.getElementById('employee-email');
  const rateInput = document.getElementById('employee-rate');
  const roleTitleInput = document.getElementById('employee-role-title');
  const templateSelect = document.getElementById('employee-permission-template');
  const workerTimeCheckbox = document.getElementById('employee-worker-timekeeping');
  const desktopAccessCheckbox = document.getElementById('employee-desktop-access');
  const kioskAdminAccessCheckbox = document.getElementById('employee-kiosk-admin-access');
  const msgEl = document.getElementById('employee-message');

  if (nameInput) nameInput.value = '';
  if (nicknameInput) nicknameInput.value = '';
  if (nameOnChecksInput) nameOnChecksInput.value = '';
  if (emailInput) emailInput.value = '';
  if (rateInput) rateInput.value = '';
  if (roleTitleInput) roleTitleInput.value = '';
  if (templateSelect) templateSelect.value = '';
  if (workerTimeCheckbox) workerTimeCheckbox.checked = true;  // default ON
  if (desktopAccessCheckbox) desktopAccessCheckbox.checked = false;       // default OFF
  if (kioskAdminAccessCheckbox) kioskAdminAccessCheckbox.checked = false; // default OFF
  if (msgEl) msgEl.textContent = '';
}

function setEmployeeInputsReadOnly(isReadOnly) {
  const nameInput = document.getElementById('edit-employee-name');
  const nicknameInput = document.getElementById('edit-employee-nickname');
  const roleTitleInput = document.getElementById('edit-employee-role-title');
  const nameOnChecksInput = document.getElementById(
    'edit-employee-name-on-checks'
  );
  const emailInput = document.getElementById('edit-employee-email');
  const rateInput = document.getElementById('edit-employee-rate');
  const templateSelect = document.getElementById('edit-employee-template');
  const workerTimeCheckbox = document.getElementById('edit-employee-worker-timekeeping');
  const desktopAccessCheckbox = document.getElementById('edit-employee-desktop-access');
  const kioskAdminAccessCheckbox = document.getElementById('edit-employee-kiosk-admin-access');
  const languageSelect = document.getElementById('edit-employee-language');
  const permSeeShipments = document.getElementById('edit-employee-perm-see-shipments');
  const permModifyTime = document.getElementById('edit-employee-perm-modify-time');
  const permViewTime = document.getElementById('edit-employee-perm-view-time-reports');
  const permViewAllTimesheets = document.getElementById('edit-employee-perm-view-all-timesheets');
  const permViewPayroll = document.getElementById('edit-employee-perm-view-payroll');
  const permModifyPayroll = document.getElementById('edit-employee-perm-modify-payroll');
  const permModifyRates = document.getElementById('edit-employee-perm-modify-pay-rates');
  const languageWarning = document.getElementById('employee-language-warning');
  const pinInput = document.getElementById('edit-employee-pin');
  const pinConfirmInput = document.getElementById('edit-employee-pin-confirm');

  const isSuperAdmin = window.CURRENT_IS_SUPER_ADMIN === true;

  // 🔓 App-controlled fields → toggle with edit mode
  if (nicknameInput) {
    nicknameInput.readOnly = isReadOnly;
    nicknameInput.style.backgroundColor = isReadOnly ? '#f9fafb' : '#ffffff';
  }
  if (emailInput) {
    emailInput.readOnly = isReadOnly;
    emailInput.style.backgroundColor = isReadOnly ? '#f9fafb' : '#ffffff';
  }
  if (nameInput) {
    nameInput.readOnly = isReadOnly;
    nameInput.style.backgroundColor = isReadOnly ? '#f9fafb' : '#ffffff';
  }
  if (nameOnChecksInput) {
    nameOnChecksInput.readOnly = isReadOnly;
    nameOnChecksInput.style.backgroundColor = isReadOnly ? '#f9fafb' : '#ffffff';
  }

  if (rateInput) {
    const lockRate = isReadOnly || !canCurrentAdminModifyPayRates();
    rateInput.readOnly = lockRate;
    rateInput.style.backgroundColor = lockRate ? '#f9fafb' : '#ffffff';
  }
  if (roleTitleInput) {
    const lockRole = isReadOnly || !isSuperAdmin;
    roleTitleInput.readOnly = lockRole;
    roleTitleInput.style.backgroundColor = lockRole ? '#f9fafb' : '#ffffff';
  }
  if (templateSelect) {
    templateSelect.disabled = isReadOnly || !isSuperAdmin;
  }

  // checkboxes use disabled instead of readOnly
  const accessLocked = isReadOnly || !isSuperAdmin;
  if (workerTimeCheckbox) workerTimeCheckbox.disabled = accessLocked;
  if (desktopAccessCheckbox) desktopAccessCheckbox.disabled = accessLocked;
  if (kioskAdminAccessCheckbox) kioskAdminAccessCheckbox.disabled = accessLocked;

  const permLocked = isReadOnly || !isSuperAdmin;
  if (permSeeShipments) permSeeShipments.disabled = permLocked;
  if (permModifyTime) permModifyTime.disabled = permLocked;
  if (permViewTime) permViewTime.disabled = permLocked;
  if (permViewAllTimesheets) permViewAllTimesheets.disabled = permLocked;
  if (permViewPayroll) permViewPayroll.disabled = permLocked;
  if (permModifyPayroll) permModifyPayroll.disabled = permLocked;
  if (permModifyRates) permModifyRates.disabled = permLocked;

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
  const roleTitleInput = document.getElementById('edit-employee-role-title');
  const nameOnChecksInput = document.getElementById('edit-employee-name-on-checks');
  const rateInput = document.getElementById('edit-employee-rate');
  const templateSelect = document.getElementById('edit-employee-template');
  const workerTimeCheckbox = document.getElementById('edit-employee-worker-timekeeping');
  const desktopAccessCheckbox = document.getElementById('edit-employee-desktop-access');
  const kioskAdminAccessCheckbox = document.getElementById('edit-employee-kiosk-admin-access');
  const languageSelect = document.getElementById('edit-employee-language');
  const permSeeShipments = document.getElementById('edit-employee-perm-see-shipments');
  const permModifyTime = document.getElementById('edit-employee-perm-modify-time');
  const permViewTime = document.getElementById('edit-employee-perm-view-time-reports');
  const permViewAllTimesheets = document.getElementById('edit-employee-perm-view-all-timesheets');
  const permViewPayroll = document.getElementById('edit-employee-perm-view-payroll');
  const permModifyPayroll = document.getElementById('edit-employee-perm-modify-payroll');
  const permModifyRates = document.getElementById('edit-employee-perm-modify-pay-rates');

  // PIN-related fields
  const pinInput = document.getElementById('edit-employee-pin');
  const pinConfirmInput = document.getElementById('edit-employee-pin-confirm');
  const pinStatusEl = document.getElementById('employee-edit-pin-status');
  const emailInput = document.getElementById('edit-employee-email');

  // Title with active/inactive tag
  if (titleEl) {
    const statusTag = currentEmployeeIsActive ? '' : ' (inactive)';
    titleEl.textContent = `Employee: ${emp.name || ''}${statusTag}`;
  }

  if (emailInput) {
    emailInput.value = emp.email || '';
  }

  // Basic fields
  if (nameInput) nameInput.value = emp.name || '';
  if (nicknameInput) nicknameInput.value = emp.nickname || '';
  if (roleTitleInput) roleTitleInput.value = emp.role_title || '';
  if (nameOnChecksInput) nameOnChecksInput.value = emp.name_on_checks || '';
  if (rateInput) rateInput.value = emp.rate != null ? emp.rate : '';
  editingEmployeeOriginalRate = emp.rate != null ? Number(emp.rate) : null;
  editingEmployeeOriginalNameOnChecks = emp.name_on_checks || '';

  if (workerTimeCheckbox) {
    const val = emp.worker_timekeeping;
    workerTimeCheckbox.checked =
      val === undefined || val === null ? true : !!val;
  }

  if (desktopAccessCheckbox) desktopAccessCheckbox.checked = !!emp.desktop_access;
  if (kioskAdminAccessCheckbox) kioskAdminAccessCheckbox.checked = !!emp.kiosk_admin_access;

  if (permSeeShipments) permSeeShipments.checked = !!emp.see_shipments;
  if (permModifyTime) permModifyTime.checked = !!emp.modify_time;
  if (permViewTime) permViewTime.checked = !!emp.view_time_reports;
  if (permViewAllTimesheets) permViewAllTimesheets.checked = !!emp.view_all_timesheets;
  if (permViewPayroll) permViewPayroll.checked = !!emp.view_payroll;
  if (permModifyPayroll) permModifyPayroll.checked = !!emp.modify_payroll;
  if (permModifyRates) permModifyRates.checked = !!emp.modify_pay_rates;

  if (templateSelect) {
    const setValue = () => {
      templateSelect.value = emp.permission_template_id || '';
    };
    if (!permissionTemplates.length) {
      loadPermissionTemplates().then(setValue);
    } else {
      setValue();
    }
  }

  if (languageSelect) {
    languageSelect.value = normalizeEmployeeLanguage(emp.language);
  }
  if (languageWarning) {
    languageWarning.classList.toggle('hidden', !isEmployeeLanguageMissing(emp.language));
  }

  // Clear PIN inputs every time modal opens
  if (pinInput) pinInput.value = '';
  if (pinConfirmInput) pinConfirmInput.value = '';
  if (pinStatusEl) {
    pinStatusEl.textContent = emp.has_pin
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
  const emailInput = document.getElementById('edit-employee-email');
  const rateInput = document.getElementById('edit-employee-rate');
  const workerTimeCheckbox = document.getElementById('edit-employee-worker-timekeeping');
  const desktopAccessCheckbox = document.getElementById('edit-employee-desktop-access');
  const kioskAdminAccessCheckbox = document.getElementById('edit-employee-kiosk-admin-access');
  const languageSelect = document.getElementById('edit-employee-language');
  const permSeeShipments = document.getElementById('edit-employee-perm-see-shipments');
  const permModifyTime = document.getElementById('edit-employee-perm-modify-time');
  const permViewTime = document.getElementById('edit-employee-perm-view-time-reports');
  const permViewAllTimesheets = document.getElementById('edit-employee-perm-view-all-timesheets');
  const permViewPayroll = document.getElementById('edit-employee-perm-view-payroll');
  const permModifyPayroll = document.getElementById('edit-employee-perm-modify-payroll');
  const permModifyRates = document.getElementById('edit-employee-perm-modify-pay-rates');

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
  const role_title = roleTitleInput ? roleTitleInput.value.trim() : '';
  const name_on_checks = nameOnChecksInput ? nameOnChecksInput.value.trim() : '';
  const email = emailInput ? emailInput.value.trim() : '';
  const incomingRate = rateInput ? parseFloat(rateInput.value) : NaN;
  const canEditRate = canCurrentAdminModifyPayRates();
  let rate = incomingRate;

  const worker_timekeeping = workerTimeCheckbox
    ? (workerTimeCheckbox.checked ? 1 : 0)
    : 1; // default ON if checkbox not found
  const desktop_access = desktopAccessCheckbox && desktopAccessCheckbox.checked ? 1 : 0;
  const kiosk_admin_access =
    kioskAdminAccessCheckbox && kioskAdminAccessCheckbox.checked ? 1 : 0;
  const language = languageSelect
    ? normalizeEmployeeLanguage(languageSelect.value)
    : 'en';
  const isSuperAdmin = window.CURRENT_IS_SUPER_ADMIN === true;
  const templateId =
    templateSelect && templateSelect.value ? Number(templateSelect.value) : null;


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
    email: email || null,
    language
  };

  if (isSuperAdmin) {
    payload.worker_timekeeping = worker_timekeeping;
    payload.desktop_access = desktop_access;
    payload.kiosk_admin_access = kiosk_admin_access;
    payload.see_shipments = permSeeShipments && permSeeShipments.checked ? 1 : 0;
    payload.modify_time = permModifyTime && permModifyTime.checked ? 1 : 0;
    payload.view_time_reports = permViewTime && permViewTime.checked ? 1 : 0;
    payload.view_all_timesheets = permViewAllTimesheets && permViewAllTimesheets.checked ? 1 : 0;
    payload.view_payroll = permViewPayroll && permViewPayroll.checked ? 1 : 0;
    payload.modify_payroll = permModifyPayroll && permModifyPayroll.checked ? 1 : 0;
    payload.modify_pay_rates = permModifyRates && permModifyRates.checked ? 1 : 0;
    if (roleTitleInput) {
      payload.role_title = role_title || null;
    }
    if (templateSelect) {
      payload.permission_template_id = templateId || null;
    }
  }

  try {
    // Save base employee fields
    await fetchJSON('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const nameOnChecksChanged =
      (editingEmployeeOriginalNameOnChecks || '') !== (name_on_checks || '');
    if (nameOnChecksChanged) {
      await fetchJSON(`/api/employees/${editingEmployeeId}/name-on-checks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name_on_checks })
      });
      editingEmployeeOriginalNameOnChecks = name_on_checks || '';
    }

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
  editingEmployeeOriginalNameOnChecks = '';

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

document.addEventListener("DOMContentLoaded", () => {
  clearEmployeeSearch();
  loadPermissionTemplates();
});
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
    const createBtn = e.target.closest('.pending-create-btn');
    if (createBtn) {
      const empId = createBtn.dataset.empId;
      const msg = document.getElementById('pending-employees-message');
      if (!empId) return;

      const emp = pendingEmployees.find(item => String(item.id) === String(empId));
      if (!emp) {
        if (msg) {
          msg.textContent = 'Employee not found.';
          msg.style.color = 'red';
        }
        return;
      }

      const fullName = String(emp.name || '').trim();
      const parts = fullName.split(/\s+/).filter(Boolean);
      if (parts.length < 2) {
        if (msg) {
          msg.textContent = 'Enter a first and last name before creating in QuickBooks.';
          msg.style.color = 'red';
        }
        return;
      }

      const givenName = parts[0];
      const familyName = parts.slice(1).join(' ');

      try {
        createBtn.disabled = true;
        if (msg) {
          msg.textContent = 'Creating QuickBooks employee...';
          msg.style.color = '#111827';
        }
        const resp = await fetch(`/api/employees/${empId}/qbo-create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getCsrfHeader() },
          body: JSON.stringify({
            display_name: fullName,
            given_name: givenName,
            family_name: familyName,
            email: emp.email || null
          })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          if (resp.status === 409 && Array.isArray(data.matches) && data.matches.length) {
            const matchList = data.matches
              .map(m => `${m.name || 'Unknown'}${m.employee_qbo_id ? ` (${m.employee_qbo_id})` : ''}`)
              .join(', ');
            throw new Error(`Potential duplicate in QuickBooks: ${matchList}`);
          }
          throw new Error(data.error || 'QuickBooks create failed.');
        }

        if (msg) {
          msg.textContent = 'Created in QuickBooks and linked.';
          msg.style.color = 'green';
        }
        await loadPendingEmployees();
        await loadEmployeesTable();
      } catch (err) {
        console.error('Create QBO error:', err);
        if (msg) {
          msg.textContent = 'Failed to create in QuickBooks: ' + (err.message || err);
          msg.style.color = 'red';
        }
      } finally {
        createBtn.disabled = false;
      }
      return;
    }

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
      const res = await fetchJSON(`/api/employees/${empId}/link-qbo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_qbo_id: qboEmpId || null,
          vendor_qbo_id: qboVendorId || null
        })
      });
      if (msg) {
        if (res && res.warning) {
          msg.textContent = `Linked with warning: ${res.warning}`;
          msg.style.color = '#b45309';
        } else {
          msg.textContent = 'Linked to QuickBooks. Pending list updated.';
          msg.style.color = 'green';
        }
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
