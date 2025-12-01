/* ───────── 5. VENDORS UI ───────── */

let vendorListStatus = 'active';
let vendorsTableData = [];
let editingVendorId = null;
let vendorPinEditMode = false;

// Toggle between active / inactive vendors
const vendorToggleInactiveBtn = document.getElementById('vendor-toggle-inactive');

if (vendorToggleInactiveBtn) {
  vendorToggleInactiveBtn.addEventListener('click', async () => {
    // Flip the status
    vendorListStatus =
      vendorListStatus === 'active' ? 'inactive' : 'active';

    // Update button label
    vendorToggleInactiveBtn.textContent =
      vendorListStatus === 'active' ? 'Show Inactive' : 'Show Active';

    // Optional: clear search filter
    const searchInput = document.getElementById('vendors-search');
    if (searchInput) searchInput.value = '';

    // Reload the table with the new status
    await loadVendorsTable();
  });
}

async function loadVendorsTable() {
  const tbody = document.getElementById('vendors-table-body');
  if (!tbody) return; // vendors table not on this page

  tbody.innerHTML =
    vendorListStatus === 'active'
      ? '<tr><td colspan="2">Loading active vendors...</td></tr>'
      : '<tr><td colspan="2">Loading inactive vendors...</td></tr>';

  try {
    const vendors = await fetchJSON(
      `/api/vendors?status=${encodeURIComponent(vendorListStatus)}`
    );

    vendorsTableData = vendors || [];

    const searchInput = document.getElementById('vendors-search');
    const term = searchInput ? searchInput.value : '';
    renderVendorsTable(term);
  } catch (err) {
    console.error('Error loading vendors:', err.message);
    vendorsTableData = [];
    tbody.innerHTML =
      '<tr><td colspan="2">Error loading vendors</td></tr>';
  }
}

function renderVendorsTable(filterTerm = '') {
  const tbody = document.getElementById('vendors-table-body');
  if (!tbody) return;

  const term = filterTerm.trim().toLowerCase();
  let rows = vendorsTableData || [];

  if (term) {
    rows = rows.filter(v => {
      const name = (v.name || '').toLowerCase();
      return name.startsWith(term);
    });
  }

  if (!rows.length) {
    const label =
      vendorsTableData.length === 0
        ? `(no ${vendorListStatus} vendors)`
        : '(no matching vendors)';
    tbody.innerHTML = `<tr><td colspan="2">${label}</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  rows.forEach(v => {
    const tr = document.createElement('tr');
    const name = v.name || '';

    const usesTimekeeping = !!v.uses_timekeeping;

tr.innerHTML = `
  <td class="table-checkbox-col">
    <input
      type="checkbox"
      disabled
      ${usesTimekeeping ? 'checked' : ''}
    />
  </td>
  <td>${name}</td>
`;
o90


    // still clickable → opens vendor PIN/settings modal
    tr.classList.add('clickable-row');
    tr.addEventListener('click', () => openVendorModal(v));

    tbody.appendChild(tr);
  });
}

function enterVendorPinViewMode() {
  const pinInput = document.getElementById('edit-vendor-pin');
  const pinConfirmInput = document.getElementById('edit-vendor-pin-confirm');

  if (pinInput) pinInput.readOnly = true;
  if (pinConfirmInput) pinConfirmInput.readOnly = true;
}

function openVendorModal(vendor) {

  initVendorModalControls();
  
  if (!vendor) return;

  editingVendorId = vendor.id;

  const modal = document.getElementById('vendor-edit-modal');
  const backdrop = document.getElementById('vendor-edit-backdrop');

  const titleEl = document.getElementById('vendor-edit-title');
  const nameInput = document.getElementById('edit-vendor-name');
  const qboInput = document.getElementById('edit-vendor-qbo-id');
  const pinInput = document.getElementById('edit-vendor-pin');
  const pinConfirmInput = document.getElementById('edit-vendor-pin-confirm');
  const pinStatusEl = document.getElementById('vendor-edit-pin-status');
  const forwarderCheckbox = document.getElementById('edit-vendor-is-freight-forwarder');
  const usesTimekeepingCheckbox = document.getElementById('edit-vendor-uses-timekeeping');

  if (titleEl) {
    titleEl.textContent = `Vendor: ${vendor.name || ''}`;
  }
  if (nameInput) nameInput.value = vendor.name || '';
  if (qboInput) qboInput.value = vendor.qbo_id || '';

  if (forwarderCheckbox) {
    forwarderCheckbox.checked = !!vendor.is_freight_forwarder;
  }

  if (usesTimekeepingCheckbox) {
    usesTimekeepingCheckbox.checked = !!vendor.uses_timekeeping;
  }

  // Reset PIN inputs + status each time
  if (pinInput) pinInput.value = '';
  if (pinConfirmInput) pinConfirmInput.value = '';
  if (pinStatusEl) {
    pinStatusEl.textContent = vendor.pin
      ? 'PIN is currently set for this vendor.'
      : 'No PIN set yet for this vendor.';
  }
    enterVendorPinViewMode();

  if (modal) modal.classList.remove('hidden');
  if (backdrop) backdrop.classList.remove('hidden');
}

function closeVendorEditModal() {
  editingVendorId = null;
  const modal = document.getElementById('vendor-edit-modal');
  const backdrop = document.getElementById('vendor-edit-backdrop');
  const pinStatusEl = document.getElementById('vendor-edit-pin-status');

  if (modal) modal.classList.add('hidden');
  if (backdrop) backdrop.classList.add('hidden');
  if (pinStatusEl) pinStatusEl.textContent = '';
}

async function saveVendorPinFromModal() {
  const pinInput = document.getElementById('edit-vendor-pin');
  const pinConfirmInput = document.getElementById('edit-vendor-pin-confirm');
  const pinStatusEl = document.getElementById('vendor-edit-pin-status');
  const forwarderCheckbox = document.getElementById('edit-vendor-is-freight-forwarder');
  const usesTimekeepingCheckbox = document.getElementById('edit-vendor-uses-timekeeping');

  if (!editingVendorId) {
    if (pinStatusEl) {
      pinStatusEl.textContent = 'No vendor selected.';
    }
    return;
  }

  const pin = pinInput ? pinInput.value.trim() : '';
  const pin2 = pinConfirmInput ? pinConfirmInput.value.trim() : '';
  const hasPinChange = !!(pin || pin2);

  if (hasPinChange) {
    if (pin.length < 4) {
      if (pinStatusEl) pinStatusEl.textContent = 'PIN must be at least 4 digits.';
      return;
    }

    if (pin !== pin2) {
      if (pinStatusEl) pinStatusEl.textContent = 'PIN entries do not match.';
      return;
    }
  }

  const body = {
    is_freight_forwarder: forwarderCheckbox && forwarderCheckbox.checked ? 1 : 0,
    uses_timekeeping: usesTimekeepingCheckbox && usesTimekeepingCheckbox.checked ? 1 : 0
  };

  if (hasPinChange) {
    body.pin = pin;
    body.allowOverride = true;
  }

  try {
    await fetchJSON(`/api/vendors/${editingVendorId}/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (pinStatusEl) {
      pinStatusEl.textContent = 'Saved.';
    }

    await loadVendorsTable();
    closeVendorEditModal();
  } catch (err) {
    console.error('Error saving vendor:', err);
    if (pinStatusEl) {
      pinStatusEl.textContent = 'Error: ' + err.message;
    }
  }
}


function setVendorPinReadOnly(isReadOnly) {
  const inputs = [
    document.getElementById('edit-vendor-pin'),
    document.getElementById('edit-vendor-pin-confirm')
  ];

  inputs.forEach(input => {
    if (input) {
      input.readOnly = isReadOnly;
      input.style.backgroundColor = isReadOnly ? '#f9fafb' : '#ffffff';
    }
  });
}

function enterVendorPinEditMode() {
  vendorPinEditMode = true;

  setVendorPinReadOnly(false);

  // Save & Close is always visible now, so no need to toggle it
  const pinInput = document.getElementById('edit-vendor-pin');
  if (pinInput) {
    pinInput.focus();
    pinInput.select();
  }
}

async function saveVendorGeneralSettings() {
  if (!editingVendorId) return;

  const nameInput = document.getElementById('edit-vendor-name');
  const forwarderCheckbox = document.getElementById('edit-vendor-is-freight-forwarder');
  const usesTimekeepingCheckbox = document.getElementById('edit-vendor-uses-timekeeping');

  const body = {
    is_freight_forwarder: forwarderCheckbox && forwarderCheckbox.checked ? 1 : 0,
    uses_timekeeping: usesTimekeepingCheckbox && usesTimekeepingCheckbox.checked ? 1 : 0
  };

  if (nameInput && nameInput.value.trim()) {
    body.name = nameInput.value.trim();
  }

  try {
    await fetchJSON(`/api/vendors/${editingVendorId}/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    await loadVendorsTable();
    closeVendorEditModal();
  } catch (err) {
    console.error(err);
    alert('Error saving vendor: ' + err.message);
  }
}

function initVendorModalControls() {
  // Make this safe to call more than once
  if (initVendorModalControls._init) return;
  initVendorModalControls._init = true;

  const closeBtn  = document.getElementById('vendor-edit-close');   // X button
  const cancelBtn = document.getElementById('vendor-edit-cancel');  // footer Cancel
  const backdrop  = document.getElementById('vendor-edit-backdrop');
  const saveBtn   = document.getElementById('vendor-edit-save');    // "Save vendor" button

  // Close actions: X, Cancel, and clicking the backdrop
  [closeBtn, cancelBtn].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        closeVendorEditModal();
      });
    }
  });

  if (backdrop) {
    backdrop.addEventListener('click', () => {
      closeVendorEditModal();
    });
  }

  // Save action → uses your existing saveVendorPinFromModal()
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      saveVendorPinFromModal();
    });
  }
}

 // Live search for vendors
const vendorsSearchInput = document.getElementById('vendors-search');
if (vendorsSearchInput) {
  vendorsSearchInput.addEventListener('input', () => {
    renderVendorsTable(vendorsSearchInput.value);
  });
}
