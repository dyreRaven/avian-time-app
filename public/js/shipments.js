/* ───────── 11. SHIPMENTS UI ───────── */

let shipmentsBoardData = {
  statuses: [],
  shipmentsByStatus: {}
};
let currentStatusFilter = "";
let draggingShipmentId = null;
let currentVerificationRow = null;


const SHIPMENT_STATUS_ICONS = {
  "Pre-Order": "/icons/shipments/preorder.svg",
  "Ordered": "/icons/shipments/ordered.svg",
  "In Transit to Forwarder": "/icons/shipments/transit.svg",
  "Arrived at Forwarder": "/icons/shipments/forwarder.svg",
  "Sailed": "/icons/shipments/ship.svg",
  "Arrived at Port": "/icons/shipments/port.svg",
  "Awaiting Clearance": "/icons/shipments/customs.svg",
  "Cleared - Ready for Release": "/icons/shipments/pickup.svg",
  "Picked Up": "/icons/shipments/done.svg",
  "Archived": "/icons/shipments/archived.svg"
};

// ───────── CURRENT USER / EMPLOYEE CONTEXT ─────────
let CURRENT_USER = null;
let CURRENT_EMPLOYEE = null;

const DEFAULT_NOTIFICATION_PREF = {
  enabled: false,
  statuses: [],
  shipment_ids: [],
  notify_time: ''
};
let shipmentNotificationPref = { ...DEFAULT_NOTIFICATION_PREF };
let shipmentNotificationTimer = null;
let lastShipmentNotificationKey = '';
let itemVerificationEditMode = false;

// Fire once on load; result is cached in global vars above.
async function loadCurrentUserContext() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) return; // not logged in, kiosk mode, etc.

    const data = await res.json();
    if (!data || !data.ok) return;

    CURRENT_USER = data.user || null;
    CURRENT_EMPLOYEE = data.employee || null;

    console.log('[SHIPMENTS] Current user:', CURRENT_USER, CURRENT_EMPLOYEE);
  } catch (err) {
    console.warn('[SHIPMENTS] Failed to load current user:', err);
  }
}

// Kick this off immediately; we don't need to await it
loadCurrentUserContext();

function isCurrentUserAdmin() {
  return !!(CURRENT_EMPLOYEE && CURRENT_EMPLOYEE.is_admin);
}

function normalizeClientNotificationPref(pref) {
  return {
    enabled: !!(pref && pref.enabled),
    statuses: Array.isArray(pref?.statuses) ? pref.statuses : [],
    shipment_ids: Array.isArray(pref?.shipment_ids) ? pref.shipment_ids : [],
    notify_time: pref && pref.notify_time ? pref.notify_time : ''
  };
}

function showNotificationMessage(text, color) {
  const msg = document.getElementById('shipment-notify-message');
  if (!msg) return;
  msg.textContent = text || '';
  if (color) msg.style.color = color;
}

function renderNotificationStatusCheckboxes(statuses = []) {
  const container = document.getElementById('shipment-notify-statuses');
  if (!container) return;

  const uniqueStatuses = Array.from(new Set((statuses || []).filter(Boolean)));
  const selected = new Set(shipmentNotificationPref.statuses || []);
  const defaultChecked = selected.size === 0;

  container.innerHTML = '';

  if (!uniqueStatuses.length) {
    const p = document.createElement('p');
    p.className = 'small-muted';
    p.textContent = 'Statuses will load after shipments finish loading.';
    container.appendChild(p);
    return;
  }

  uniqueStatuses.forEach(status => {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    const span = document.createElement('span');

    checkbox.type = 'checkbox';
    checkbox.value = status;
    checkbox.checked = defaultChecked || selected.has(status);
    span.textContent = status;

    label.appendChild(checkbox);
    label.appendChild(span);
    container.appendChild(label);
  });

  container.onchange = () => {
    const picked = Array.from(
      container.querySelectorAll('input[type="checkbox"]:checked')
    ).map(cb => cb.value);
    shipmentNotificationPref.statuses = picked;
  };
}

function refreshShipmentNotificationOptions() {
  const select = document.getElementById('shipment-notify-shipments');
  if (!select) return;

  const allShipments = [];
  const byStatus = shipmentsBoardData?.shipmentsByStatus || {};

  Object.entries(byStatus).forEach(([status, list]) => {
    (list || []).forEach(sh => {
      allShipments.push({
        id: sh.id,
        title: sh.title || 'Shipment',
        status: sh.status || status || ''
      });
    });
  });

  const selected = new Set(shipmentNotificationPref.shipment_ids || []);

  select.innerHTML = '';

  if (!allShipments.length) {
    const opt = document.createElement('option');
    opt.disabled = true;
    opt.textContent = '(shipments will appear once loaded)';
    select.appendChild(opt);
    return;
  }

  allShipments
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    .forEach(row => {
      const opt = document.createElement('option');
      opt.value = row.id;
      opt.textContent = `${row.title} — ${row.status || 'Status unknown'}`;
      opt.selected = selected.has(row.id);
      select.appendChild(opt);
    });

  select.onchange = () => {
    const ids = Array.from(select.selectedOptions || [])
      .map(opt => Number(opt.value))
      .filter(n => Number.isFinite(n));
    shipmentNotificationPref.shipment_ids = ids;
  };
}

function collectShipmentNotificationForm() {
  const enabled = document.getElementById('shipment-notify-enabled')?.checked || false;
  const time = document.getElementById('shipment-notify-time')?.value || '';

  const statuses = Array.from(
    document.querySelectorAll('#shipment-notify-statuses input[type="checkbox"]:checked')
  ).map(cb => cb.value);

  const shipmentIds = Array.from(
    document.getElementById('shipment-notify-shipments')?.selectedOptions || []
  ).map(opt => Number(opt.value)).filter(n => Number.isFinite(n));

  return {
    enabled,
    statuses,
    shipment_ids: shipmentIds,
    notify_time: time
  };
}

function applyShipmentNotificationPrefToUI(pref) {
  const normalized = normalizeClientNotificationPref(pref);
  shipmentNotificationPref = normalized;

  const enabledToggle = document.getElementById('shipment-notify-enabled');
  const timeInput     = document.getElementById('shipment-notify-time');

  if (enabledToggle) enabledToggle.checked = !!normalized.enabled;
  if (timeInput) timeInput.value = normalized.notify_time || '';

  // Re-render statuses with the current selection baked in
  const sourceStatuses =
    (shipmentsBoardData && Array.isArray(shipmentsBoardData.statuses) && shipmentsBoardData.statuses.length)
      ? shipmentsBoardData.statuses
      : Object.keys(SHIPMENT_STATUS_ICONS);

  renderNotificationStatusCheckboxes(sourceStatuses);
  refreshShipmentNotificationOptions();
}

async function ensureNotificationPermission() {
  if (typeof Notification === 'undefined') return false;

  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  try {
    const perm = await Notification.requestPermission();
    return perm === 'granted';
  } catch (err) {
    console.warn('Notification permission request failed:', err);
    return false;
  }
}

function getShipmentsMatchingNotification(pref) {
  const map = shipmentsBoardData?.shipmentsByStatus || {};
  const statuses = Array.isArray(pref.statuses) && pref.statuses.length
    ? new Set(pref.statuses)
    : new Set(Object.keys(map));

  const limitToIds =
    Array.isArray(pref.shipment_ids) && pref.shipment_ids.length > 0;
  const ids = new Set(pref.shipment_ids || []);

  const results = [];

  Object.entries(map).forEach(([statusKey, list]) => {
    (list || []).forEach(sh => {
      const status = sh.status || statusKey || '';
      if (statuses.size && !statuses.has(status)) return;
      if (limitToIds && !ids.has(sh.id)) return;
      results.push(sh);
    });
  });

  return results;
}

async function triggerShipmentNotification(force = false) {
  const pref = shipmentNotificationPref || DEFAULT_NOTIFICATION_PREF;
  const matching = getShipmentsMatchingNotification(pref);
  const title = force ? 'Test: Shipments alert' : 'Shipments alert';

  let body;
  if (!matching.length) {
    body = 'No shipments currently match your notification filters.';
  } else {
    const summary = matching.slice(0, 4).map(sh => {
      const status = sh.status || 'Status';
      const titleText = sh.title || `Shipment ${sh.id || ''}`.trim();
      return `${titleText} (${status})`;
    });
    const remainder = matching.length > 4
      ? ` + ${matching.length - 4} more`
      : '';
    body = `${summary.join(', ')}${remainder}`;
  }

  const permissionOk = await ensureNotificationPermission();
  if (permissionOk) {
    try {
      new Notification(title, { body });
    } catch (err) {
      console.warn('Browser notification failed:', err);
    }
  }

  showNotificationMessage(
    force ? `Test notification sent. ${body}` : body,
    matching.length ? 'green' : '#0f172a'
  );
}

async function checkShipmentNotificationWindow(forceNow = false) {
  if (!shipmentNotificationPref.enabled) return;

  if (!forceNow) {
    const target = shipmentNotificationPref.notify_time;
    if (!target) return;

    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const current = `${hh}:${mm}`;

    if (current !== target) return;

    const key = `${now.toISOString().slice(0, 10)}-${target}`;
    if (lastShipmentNotificationKey === key) return;
    lastShipmentNotificationKey = key;
  }

  await triggerShipmentNotification(forceNow);
}

async function maybeStartShipmentNotificationTimer(forcePing = false) {
  if (shipmentNotificationTimer) {
    clearInterval(shipmentNotificationTimer);
    shipmentNotificationTimer = null;
  }

  if (!shipmentNotificationPref.enabled || !shipmentNotificationPref.notify_time) {
    return;
  }

  const ok = await ensureNotificationPermission();
  if (!ok) {
    showNotificationMessage(
      'Enable browser notifications to receive shipment alerts.',
      '#b45309'
    );
    return;
  }

  shipmentNotificationTimer = setInterval(() => {
    checkShipmentNotificationWindow(false).catch(err => {
      console.warn('Notification tick failed:', err);
    });
  }, 30000);

  if (forcePing) {
    checkShipmentNotificationWindow(true).catch(err => {
      console.warn('Notification check failed:', err);
    });
  }
}

async function loadShipmentNotificationPrefs() {
  const panel = document.getElementById('shipments-notify-panel');
  if (panel) {
    panel.classList.add('hidden');
  }
  // Notifications are not used in the web app; skip loading entirely.
  return;

  try {
    const res = await fetch('/api/shipments/notifications');
    const data = await res.json().catch(() => ({}));

    if (res.status === 403) {
      panel.classList.add('hidden');
      return;
    }

    if (!res.ok) {
      throw new Error(data.error || 'Failed to load notification preferences.');
    }

    applyShipmentNotificationPrefToUI(data.preference || DEFAULT_NOTIFICATION_PREF);
    await maybeStartShipmentNotificationTimer(false);
  } catch (err) {
    console.error('Error loading shipment notification prefs:', err);
    showNotificationMessage(err.message, 'crimson');
  }
}

async function saveShipmentNotificationPrefs() {
  const payload = collectShipmentNotificationForm();
  const btn = document.getElementById('shipment-notify-save');

  try {
    if (btn) btn.disabled = true;
    showNotificationMessage('Saving notification preferences...', '');

    const res = await fetch('/api/shipments/notifications', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || 'Failed to save notification preferences.');
    }

    applyShipmentNotificationPrefToUI(
      data.preference || payload
    );
    await maybeStartShipmentNotificationTimer(true);
    showNotificationMessage('Notification preferences saved.', 'green');
  } catch (err) {
    console.error('Error saving shipment notification prefs:', err);
    showNotificationMessage(err.message, 'crimson');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function getInitialsFromName(name) {
  if (!name) return '';
  const parts = String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return '';

  const first = parts[0][0] || '';
  const last  = (parts.length > 1 ? parts[parts.length - 1][0] : '') || '';

  return (first + last).toUpperCase();
}

function clearVendorFromItemRows() {
  const rows = document.querySelectorAll('.shipment-item-row');
  rows.forEach(row => {
    const input = row.querySelector('.shipment-item-vendor');
    if (!input) return;

    // For now: clear every per-row vendor
    input.value = '';
  });
}


function applyVendorToItemRowsIfNeeded() {
  const vendorSelect = document.getElementById('shipment-vendor');
  const applyAll     = document.getElementById('shipment-vendor-apply-all');
  if (!vendorSelect || !applyAll || !applyAll.checked) return;

  const idx = vendorSelect.selectedIndex;
  if (idx <= 0) return;

  const vendorText = vendorSelect.options[idx].textContent.trim();
  if (!vendorText) return;

  const rows = document.querySelectorAll('.shipment-item-row');
  rows.forEach(row => {
    const input = row.querySelector('.shipment-item-vendor');
    if (!input) return;

    // Only fill blanks so manual overrides are preserved
    if (!input.value.trim()) {
      input.value = vendorText;
    }
  });
}

function setVendorOnAllItemRows(vendorText) {
  if (!vendorText) return;
  const rows = document.querySelectorAll('.shipment-item-row');
  rows.forEach(row => {
    const input = row.querySelector('.shipment-item-vendor');
    if (input) {
      input.value = vendorText;
    }
  });
}

function syncVendorApplyAllFromItems(shipmentVendorName, items = []) {
  const applyAll = document.getElementById('shipment-vendor-apply-all');
  if (!applyAll) return;

  const headerVendor = (shipmentVendorName || '').trim();
  const vendors = new Set();
  let blanks = 0;

  (items || []).forEach(it => {
    const v = (it.vendor_name || '').trim();
    if (v) vendors.add(v);
    else blanks += 1;
  });

  const singleVendorMatchesHeader =
    vendors.size === 1 && headerVendor && vendors.has(headerVendor);

  // Only auto-check when every non-blank vendor matches the header vendor
  applyAll.checked = singleVendorMatchesHeader;

  // If apply-all is checked, push header vendor name into any blank vendor cells
  if (applyAll.checked && headerVendor) {
    const rows = document.querySelectorAll('.shipment-item-row');
    rows.forEach(row => {
      const input = row.querySelector('.shipment-item-vendor');
      if (input && !input.value.trim()) {
        input.value = headerVendor;
      }
    });
  }
}


function syncVendorApplyAllCheckbox() {
  const vendorSelect = document.getElementById('shipment-vendor');
  const applyAll     = document.getElementById('shipment-vendor-apply-all');
  if (!vendorSelect || !applyAll || !applyAll.checked) return;

  const idx = vendorSelect.selectedIndex;
  if (idx <= 0) {
    applyAll.checked = false;
    return;
  }

  const expected = (vendorSelect.options[idx].textContent || '').trim();
  if (!expected) {
    applyAll.checked = false;
    return;
  }

  const rows = document.querySelectorAll('.shipment-item-row');
  for (const row of rows) {
    const input = row.querySelector('.shipment-item-vendor');
    if (!input) continue;

    const val = (input.value || '').trim();
    if (val !== expected) {
      applyAll.checked = false;
      break;
    }
  }
}

function updateVerifierTagForRow(row) {
  if (!row) return;
  const span = row.querySelector('.shipment-item-verifier-tag');
  if (!span) return;

  const v = row._verification || {};

  // whatever you stored as verified_by (usually name or email)
  const raw = v.verified_by || '';

  // initials from that value
  const initials = raw ? getInitialsFromName(raw) : '';

  span.textContent = initials || '';
  span.dataset.fullLabel = raw || '';        // <-- full name/email for tooltip

  // show/hide styling
  span.classList.toggle('has-initials', !!initials);
}

function rowStatusCellHtml(verification) {
  const status = (verification && verification.status) || '';
  const selected = (val) => (status === val ? ' selected' : '');

  return `
    <select class="shipment-item-status">
      <option value="">Status…</option>
      <option value="verified"${selected('verified')}>Verified</option>
      <option value="missing"${selected('missing')}>Missing</option>
      <option value="damaged"${selected('damaged')}>Damaged</option>
      <option value="wrong_item"${selected('wrong_item')}>Wrong item</option>
    </select>
    <span class="shipment-item-verifier-tag"></span>
  `;
}




 

function populateStatusDropdown(statuses) {
  const menu = document.getElementById('status-dropdown-menu');
  const label = document.getElementById('status-dropdown-label');
  const icon = document.getElementById('status-dropdown-icon');

  menu.innerHTML = '';

  // Default
  const defaultOption = document.createElement('div');
  defaultOption.innerHTML = `<img src="" class="dropdown-icon"><span>All statuses</span>`;
  defaultOption.addEventListener('click', () => {
    label.textContent = "All statuses";
    icon.src = "";
    currentStatusFilter = "";
    loadShipmentsBoard();
    menu.classList.add('hidden');
  });
  menu.appendChild(defaultOption);

  // Each status
  statuses.forEach(st => {
    const row = document.createElement('div');
    const src = SHIPMENT_STATUS_ICONS[st] || "";

    row.innerHTML = `
      <img src="${src}" class="dropdown-icon">
      <span>${st}</span>
    `;

    row.addEventListener('click', () => {
      label.textContent = st;
      icon.src = src;
      currentStatusFilter = st;
      loadShipmentsBoard();
      menu.classList.add('hidden');
    });

    menu.appendChild(row);
  });
}

function canVerifyItems(status) {
  if (!status) return false;
  const s = status.trim().toLowerCase();
  return (
    s === 'cleared - ready for release' ||
    s === 'picked up' ||
    s === 'archived'
  );
}

function closeItemVerificationModal() {
  const backdrop = document.getElementById('item-verification-backdrop');
  const modal    = document.getElementById('item-verification-modal');
  if (backdrop) backdrop.classList.add('hidden');
  if (modal)    modal.classList.add('hidden');
  currentVerificationRow = null;
}

function appendVerificationHistory(vMeta, prevStatus, newStatus) {
  if (prevStatus === newStatus) return;

  vMeta.history = Array.isArray(vMeta.history) ? vMeta.history : [];

  const emp = CURRENT_EMPLOYEE || {};
  const currentEmpId =
    emp.employee_id ||
    emp.id ||
    null;

  const currentName =
    emp.display_name ||
    emp.name ||
    emp.email ||
    null;

  vMeta.history.push({
    at: new Date().toISOString(),
    from_status: prevStatus || '',
    to_status: newStatus || '',
    by_employee_id: currentEmpId,
    by_name: currentName,
    notes: vMeta.notes || null   // best-effort; may be null
  });
}


function getCurrentVerifierInfo() {
  // Try employee first, then user
  const emp = CURRENT_EMPLOYEE || CURRENT_USER || null;
  if (!emp) {
    return { id: null, name: null };
  }

  const id =
    emp.employee_id ||
    emp.id ||
    null;

  const name =
    emp.display_name ||
    emp.name ||
    emp.email ||
    null;

  return { id, name };
}



// Auto-fill the top-level "Shipment verified by" if it's empty
function autoFillShipmentVerifiedByIfEmpty() {
// Intentionally blank: we now track verification per line only
}

function setupItemVerificationModal() {
  const closeBtn   = document.getElementById('item-verification-close');
  const cancelBtn  = document.getElementById('item-verification-cancel');
  const saveBtn    = document.getElementById('item-verification-save');
  const deleteBtn  = document.getElementById('item-verification-delete');
  const statusSel  = document.getElementById('item-verification-status');
  const inlineSave = document.getElementById('item-verification-edit-status');

  if (closeBtn)  closeBtn.addEventListener('click', closeItemVerificationModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeItemVerificationModal);

  // Pretty dropdown UI
  initItemVerificationStatusUI();

  if (statusSel) {
    statusSel.addEventListener('change', () => {
      const dateInput  = document.getElementById('item-verification-date');
      const byInput    = document.getElementById('item-verification-verified-by');
      const historyList = document.getElementById('item-verification-history');
      const { name: currentEmpName } = getCurrentVerifierInfo();

      if (statusSel.value) {
        if (dateInput) {
          dateInput.value = new Date().toISOString().slice(0, 10);
        }
        if (byInput) {
          byInput.value = currentEmpName || byInput.value || '';
        }
      }

      applyItemStatusStyle(statusSel);
      syncItemVerificationStatusUI(statusSel.value);
      const v = currentVerificationRow ? currentVerificationRow._verification || {} : {};
      renderItemVerificationHistory(v, historyList);
    });
  }

  if (inlineSave) {
    inlineSave.addEventListener('click', (e) => {
      e.preventDefault();
      if (inlineSave.disabled) return;

      const isEditing = inlineSave.dataset.editing === '1';

      if (!isEditing) {
        // First click: unlock fields for override/edit without closing modal
        setVerificationInputsDisabled(false);
        inlineSave.dataset.editing = '1';
        inlineSave.textContent = 'Click here to save updated verification information';
        inlineSave.classList.add('inline-save-active');
        inlineSave.classList.remove('override-state');
        return;
      }

      // Second click: commit via main save button
      const saveButton = document.getElementById('item-verification-save');
      if (saveButton) saveButton.click();
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      if (!currentVerificationRow) {
        closeItemVerificationModal();
        return;
      }

      const byInput    = document.getElementById('item-verification-verified-by');
      const dateInput  = document.getElementById('item-verification-date');
      const storageInp = document.getElementById('item-verification-storage');
      const notesArea  = document.getElementById('item-verification-notes');
      const issueSel   = document.getElementById('item-verification-issue-type');
      const rowStatus  = currentVerificationRow.querySelector('.shipment-item-status');

      const v = currentVerificationRow._verification || {};
const oldStatus = v.status || '';

const newStatus = statusSel ? (statusSel.value || '') : '';

const manualName = byInput ? byInput.value.trim() : '';
const manualDate = dateInput ? dateInput.value : '';

const storageOverride = storageInp ? storageInp.value.trim() : null;
const notes           = notesArea ? notesArea.value.trim() : null;
const issueType       = issueSel ? (issueSel.value || null) : null;

const { id: currentEmpId, name: currentEmpName } = getCurrentVerifierInfo();

// Decide what name to store for this "current" verification
const finalName =
  manualName ||
  v.verified_by ||
  currentEmpName ||
  null;

// 🆕 If the status changed, always reset the date to "today"
//    Otherwise, respect what the user typed in the date box.
const statusChanged = newStatus !== oldStatus;
let finalDate;

if (statusChanged && newStatus) {
  // date-only for the <input type="date">
  finalDate = new Date().toISOString().slice(0, 10);
} else if (manualDate) {
  finalDate = manualDate;
} else {
  finalDate = v.verified_at || null;
}

// Update the "current state" of verification
v.status           = newStatus;
v.verified_by      = newStatus ? finalName : null;
v.verified_at      = newStatus ? finalDate : null;
v.storage_override = storageOverride;
v.notes            = notes;
v.issue_type       = issueType;
      // Maintain a history trail for this item
      if (!Array.isArray(v.history)) {
        v.history = [];
      }

      const nowIso = new Date().toISOString();

v.history.push({
  at: nowIso,
  from_status: oldStatus || '',
  to_status: newStatus || '',
  by_employee_id: currentEmpId || null,
  by_name: finalName || null,
  notes: notes || null
});


      currentVerificationRow._verification = v;

      if (rowStatus) {
        rowStatus.value = v.status || '';
        applyItemStatusStyle(rowStatus);
        // keep top-level verified-by in sync if empty
        if (v.status) {
          autoFillShipmentVerifiedByIfEmpty();
        }
      }

      // Update initials tag for this row based on verification meta
      updateVerifierTagForRow(currentVerificationRow);

      // After save, re-lock fields and reset edit button
      setVerificationInputsDisabled(false);
      const inlineSaveBtn = document.getElementById('item-verification-edit-status');
      if (inlineSaveBtn) inlineSaveBtn.textContent = 'Edit verification info';
      itemVerificationEditMode = false;

      closeItemVerificationModal();

    });
  }

  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      if (!currentVerificationRow) {
        closeItemVerificationModal();
        return;
      }
      const ok = window.confirm('Delete this item from the shipment?');
      if (!ok) return;

      currentVerificationRow.remove();
      currentVerificationRow = null;
      recalcShipmentItemsTotal();
      closeItemVerificationModal();
    });
  }
}


function formatMoneyInput(el) {
  if (!el) return;
  let v = parseFloat(el.value);
  if (isNaN(v)) {
    el.value = "";
    return;
  }
  el.value = v.toFixed(2);
}


function applyItemStatusStyle(selectEl) {
  if (!selectEl) return;

  selectEl.classList.remove(
    'item-status-verified',
    'item-status-damaged',
    'item-status-issue',
    'item-status-missing',
    'item-status-wrong_item'
  );

  switch (selectEl.value) {
    case 'verified':
      selectEl.classList.add('item-status-verified');
      break;
    case 'issue':
      selectEl.classList.add('item-status-damaged');
      break;
    case 'damaged':
      selectEl.classList.add('item-status-damaged');
      break;
    case 'missing':
      selectEl.classList.add('item-status-missing');
      break;
    case 'wrong_item':
      selectEl.classList.add('item-status-wrong_item');
      break;
  }
}

function openItemVerificationModal(row) {
  currentVerificationRow = row;

  const modal = document.getElementById('item-verification-modal');
  if (!modal) return;

  const desc = row.querySelector('.shipment-item-desc')?.value || '';
  const sku  = row.querySelector('.shipment-item-sku')?.value || '';

  const header = document.getElementById('item-verification-header');
  if (header) {
    header.textContent = desc
      ? `Verify item: ${desc}`
      : (sku ? `Verify item: ${sku}` : 'Verify item');
  }

  const statusSel = document.getElementById('item-verification-status');
  const rowStatus = row.querySelector('.shipment-item-status');

  const v = row._verification || {};

  // Status dropdown
  if (statusSel) {
    statusSel.value = v.status || rowStatus?.value || '';
    applyItemStatusStyle(statusSel);
    syncItemVerificationStatusUI(statusSel.value);
  }

  // Inputs inside modal
  const byInput    = document.getElementById('item-verification-verified-by');
  const dateInput  = document.getElementById('item-verification-date');
  const storageInp = document.getElementById('item-verification-storage');
  const notesInput = document.getElementById('item-verification-notes');
  const issueSel   = document.getElementById('item-verification-issue-type');
  const editStatusBtn = document.getElementById('item-verification-edit-status');
  const historyList = document.getElementById('item-verification-history');
  const historyToggle = document.getElementById('item-verification-toggle-history');
  const historyPanel = document.getElementById('item-verification-history-panel');
  const historyClose = document.getElementById('item-verification-history-close');

  // Default "verified by" = existing value or current logged-in employee
  const { name: currentEmpName } = getCurrentVerifierInfo();
  const defaultName =
    v.verified_by ||
    currentEmpName ||
    '';

  if (byInput)   byInput.value   = defaultName;
  if (dateInput) dateInput.value = v.verified_at || '';
  if (storageInp) storageInp.value = v.storage_override || '';
  if (notesInput) notesInput.value = v.notes || '';
  if (issueSel)  issueSel.value  = v.issue_type || '';
  const itemLabel = desc || sku || '';
  renderItemVerificationHistory(v, historyList, itemLabel);

  if (historyToggle) {
    historyToggle.textContent = 'View log';
    historyToggle.onclick = () => {
      if (!historyList || !historyPanel) return;
      const itemLabel = desc || sku || '';
      renderItemVerificationHistory(v, historyList, itemLabel);
      historyPanel.classList.remove('hidden');
    };
  }

  if (historyClose && historyPanel) {
    historyClose.onclick = () => {
      historyPanel.classList.add('hidden');
    };
  }

  if (editStatusBtn) {
    const locked = !!(v.status && v.status.trim());
    editStatusBtn.classList.remove('hidden');
    editStatusBtn.disabled = false;
    editStatusBtn.textContent = locked
      ? 'Shipment already verified — click here to override'
      : 'Edit verification info';
    editStatusBtn.dataset.editing = '0';
    if (locked) {
      editStatusBtn.classList.remove('inline-save-active');
      editStatusBtn.classList.remove('override-state');
    } else {
      editStatusBtn.classList.remove('override-state');
      editStatusBtn.classList.remove('inline-save-active');
    }
  }
  // Lock editing if already verified; allow when empty.
  const locked = !!(v.status && v.status.trim());
  setVerificationInputsDisabled(locked);

  modal.classList.remove('hidden');
}

function renderItemVerificationHistory(vMeta = {}, listEl, itemLabel = '') {
  if (!listEl) return;
  listEl.innerHTML = '';

  const history = Array.isArray(vMeta.history) ? vMeta.history.slice() : [];

  // Add header row
  const header = document.createElement('li');
  header.className = 'verification-history-header-row';
  header.innerHTML = `
    <span>Item</span>
    <span>Status</span>
    <span>By</span>
    <span>Date</span>
    <span>Notes</span>
  `;
  listEl.appendChild(header);

  if (history.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No history yet.';
    li.className = 'small-muted';
    listEl.appendChild(li);
    return;
  }

  history
    .slice()
    .reverse()
    .forEach(entry => {
      const li = document.createElement('li');
      const when = entry.at ? new Date(entry.at).toLocaleString() : '';
      const status = entry.to_status || '(unknown)';
      const by = entry.by_name || 'Unknown';
      const note = entry.notes && entry.notes.trim() ? entry.notes : '—';
      const statusClass = status
        ? `hist-status-${status.replace(/\s+/g, '_').toLowerCase()}`
        : 'hist-status-unknown';

      li.className = 'verification-history-row';
      li.innerHTML = `
        <span class="hist-item">${itemLabel || '(Item)'}</span>
        <span class="hist-status ${statusClass}">${status}</span>
        <span class="hist-meta hist-by">${by}</span>
        <span class="hist-meta hist-date">${when || ''}</span>
        <span class="hist-notes">${note}</span>
      `;
      listEl.appendChild(li);
    });
}



// ───────── ITEM VERIFICATION STATUS CUSTOM UI ─────────

function getItemVerificationStatusUIElements() {
  const root = document.getElementById('item-verification-status-ui');
  if (!root) return {};
  return {
    root,
    trigger: root.querySelector('.select-trigger'),
    label: root.querySelector('.select-label'),
    menu: root.querySelector('.select-menu'),
    options: Array.from(root.querySelectorAll('.select-option'))
  };
}

function syncItemVerificationStatusUI(value) {
  const statusSel = document.getElementById('item-verification-status');
  const { root, label, options } = getItemVerificationStatusUIElements();
  if (!root || !label || !options || !options.length || !statusSel) return;

  const val = value || '';
  const match =
    options.find(btn => (btn.dataset.value || '') === val) || options[0];

  // Update visible label text
  label.textContent = match.textContent.trim();

  // Highlight active option
  options.forEach(btn => {
    btn.classList.toggle('active', btn === match);
  });
}

function initItemVerificationStatusUI() {
  if (initItemVerificationStatusUI._init) return;
  initItemVerificationStatusUI._init = true;

  const statusSel = document.getElementById('item-verification-status');
  const { root, trigger, label, menu, options } =
    getItemVerificationStatusUIElements();

  if (!root || !trigger || !menu || !options || !options.length || !statusSel) {
    return;
  }

  // Toggle menu open/close
  trigger.addEventListener('click', () => {
    menu.classList.toggle('hidden');
  });

  // Option clicks: update hidden select + UI + existing logic
  options.forEach(btn => {
    btn.addEventListener('click', () => {
      const value = btn.dataset.value || '';
      statusSel.value = value;

      // Fire existing change handler so applyItemStatusStyle still runs
      statusSel.dispatchEvent(new Event('change', { bubbles: true }));

      syncItemVerificationStatusUI(value);
      menu.classList.add('hidden');
    });
  });

  // Close when clicking outside
  document.addEventListener('click', evt => {
    if (!root.contains(evt.target)) {
      menu.classList.add('hidden');
    }
  });

  // Initial sync
  syncItemVerificationStatusUI(statusSel.value || '');
}


function setVerificationInputsDisabled(disabled) {
  const controls = [
    document.getElementById('item-verification-status'),
    document.getElementById('item-verification-date'),
    document.getElementById('item-verification-verified-by'),
    document.getElementById('item-verification-storage'),
    document.getElementById('item-verification-notes'),
    document.getElementById('item-verification-issue-type')
  ];

  controls.forEach(el => {
    if (!el) return;
    el.disabled = disabled;
    if (el.id === 'item-verification-verified-by' || el.id === 'item-verification-date') {
      el.readOnly = true;
    } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.readOnly = disabled;
    }
  });

  const statusUI = document.getElementById('item-verification-status-ui');
  if (statusUI) statusUI.classList.toggle('disabled', disabled);
}


function toggleShipmentVerificationSection(statusValue) {
  const section = document.getElementById('shipment-items-verification');
  if (!section) return;

  const allowed = canVerifyItems(statusValue);

  // Show/hide the little "All items verified / Verified by / notes" strip
  section.classList.toggle('hidden', !allowed);

  // IMPORTANT: do NOT clear verification values when status changes.
  // We want them to persist if the shipment is moved backwards.
}



function initShipmentVerificationControls() {
  // ✅ Prevent double-binding when modal is opened multiple times
  if (initShipmentVerificationControls._init) return;
  initShipmentVerificationControls._init = true;

  const verifyAll = document.getElementById('shipment-verify-all');
  if (!verifyAll) return;

  verifyAll.addEventListener('change', () => {
    const selects = Array.from(
      document.querySelectorAll('.shipment-item-status')
    );

    if (!selects.length) return;

    const { name: currentEmpName } = getCurrentVerifierInfo();

    if (verifyAll.checked) {
      // ✅ CHECKED → mark every item as verified
      selects.forEach(sel => {
        const row = sel.closest('.shipment-item-row');
        if (!row) return;

        row._verification = row._verification || {};
        const prevStatus = row._verification.status || '';
        const newStatus  = 'verified';

        sel.value = newStatus;
        row._verification.status = newStatus;

        if (currentEmpName) {
          row._verification.verified_by = currentEmpName;
          row._verification.verified_at = new Date().toISOString().slice(0, 10);
        }

        if (typeof appendVerificationHistory === 'function') {
          appendVerificationHistory(row._verification, prevStatus, newStatus);
        }

        updateVerifierTagForRow(row);
        applyItemStatusStyle(sel);
      });

      if (typeof autoFillShipmentVerifiedByIfEmpty === 'function') {
        autoFillShipmentVerifiedByIfEmpty();
      }
    } else {
      // ✅ UNCHECKED → clear statuses & verifier info
      selects.forEach(sel => {
        const row = sel.closest('.shipment-item-row');
        if (!row) return;

        row._verification = row._verification || {};
        const prevStatus = row._verification.status || '';
        const newStatus  = '';

        sel.value = '';
        row._verification.status      = '';
        row._verification.verified_by = null;
        row._verification.verified_at = null;
        // (keep notes / storage_override / issue_type if you want)

        if (typeof appendVerificationHistory === 'function') {
          appendVerificationHistory(row._verification, prevStatus, newStatus);
        }

        updateVerifierTagForRow(row);
        applyItemStatusStyle(sel);
      });
    }

    // Sync after all modifications
    syncVerifyAllCheckboxState();
  });

  // Initial sync when page loads / modal opens
  syncVerifyAllCheckboxState();
}







function recalcShipmentItemsTotal() {
  const rows = Array.from(document.querySelectorAll('.shipment-item-row'));
  let total = 0;

  rows.forEach(row => {
    const qtyInput = row.querySelector('.shipment-item-qty');
    const unitInput = row.querySelector('.shipment-item-unit');
    const lineDisplay = row.querySelector('.shipment-item-total');

const qty = parseFloat(qtyInput?.value || '0') || 0;
const unit = parseFloat(unitInput?.value || '0') || 0;
const lineTotal = qty * unit;

if (lineDisplay) {
  lineDisplay.textContent = formatMoney(lineTotal);
}


    total += lineTotal;
  });

  const totalDisplay = document.getElementById('shipment-items-total-display');
  const totalHidden = document.getElementById('shipment-total-price');

  if (totalDisplay) {
    totalDisplay.textContent = formatMoney(total);
  }
  if (totalHidden) {
    totalHidden.value = total ? total.toFixed(2) : '';
  }
}

function addShipmentItemRow(initial) {
  const container = document.getElementById('shipment-items-rows');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'shipment-item-row';
  row.dataset.itemId = initial && initial.id ? String(initial.id) : '';

  const desc = (initial && initial.description) || '';
  const sku  = (initial && initial.sku) || '';
  const qty  =
    initial && typeof initial.quantity === 'number'
      ? initial.quantity
      : '';
  const unit =
    initial && typeof initial.unit_price === 'number'
      ? initial.unit_price
      : '';
  const lineTotal =
    initial && typeof initial.line_total === 'number'
      ? initial.line_total
      : 0;

  // Figure out default vendor for this row (header vendor + "apply to all")
  const vendorSelect   = document.getElementById('shipment-vendor');
  const vendorApplyAll = document.getElementById('shipment-vendor-apply-all');

  let vendorValue =
    initial && typeof initial.vendor_name === 'string'
      ? initial.vendor_name
      : '';

  // If no per-item vendor yet and "apply to all" is on, copy header vendor name
  if (!vendorValue && vendorSelect && vendorApplyAll && vendorApplyAll.checked) {
    const idx = vendorSelect.selectedIndex;
    if (idx > 0) {
      vendorValue = vendorSelect.options[idx].textContent.trim();
    }
  }

  row.innerHTML = `
  <div>
    <input
      type="text"
      class="shipment-item-desc"
      placeholder="Description"
      value="${escapeHTML(desc)}"
    />
  </div>
  <div>
    <input
      type="text"
      class="shipment-item-sku"
      placeholder="SKU / Ref"
      value="${escapeHTML(sku)}"
    />
  </div>
  <div>
    <input
      type="text"
      class="shipment-item-vendor"
      placeholder="Vendor"
      value="${escapeHTML(vendorValue || '')}"
    />
  </div>
  <div>
    <input
      type="number"
      min="0"
      step="0.01"
      class="shipment-item-qty"
      value="${qty !== '' ? qty : ''}"
    />
  </div>
  <div>
    <input
      type="number"
      min="0"
      step="0.01"
      class="shipment-item-unit"
      value="${unit !== '' ? unit : ''}"
    />
  </div>
  <div>
    <span class="shipment-item-total">${formatMoney(lineTotal)}</span>
  </div>
  <div class="shipment-item-status-cell">
    ${rowStatusCellHtml(initial && initial.verification)}
  </div>
  <div class="shipment-item-actions">
    <button
      type="button"
      class="icon-button shipment-item-edit"
      title="Verify / edit"
    >
      ✎
    </button>
  </div>
`;


  // Hook up events
  const qtyInput     = row.querySelector('.shipment-item-qty');
  const unitInput    = row.querySelector('.shipment-item-unit');
  const statusSelect = row.querySelector('.shipment-item-status');
  const editBtn      = row.querySelector('.shipment-item-edit');
  const vendorInput  = row.querySelector('.shipment-item-vendor');
  const deleteBtn    = row.querySelector('.shipment-item-delete');

  // Verification meta
  const baseVerification = (initial && initial.verification) || {};
  if (!Array.isArray(baseVerification.history)) {
    baseVerification.history = [];
  }
  row._verification = baseVerification;

  // Initialize initials tag from existing verification (if any)
  updateVerifierTagForRow(row);

  const recalc = () => recalcShipmentItemsTotal();

  qtyInput?.addEventListener('input', recalc);
  unitInput?.addEventListener('input', recalc);

  // Format money for unit price on blur
  unitInput?.addEventListener('blur', () => {
    formatMoneyInput(unitInput);
    recalcShipmentItemsTotal();
  });

  if (vendorInput) {
    vendorInput.addEventListener('input', () => {
      syncVendorApplyAllCheckbox();
    });
  }

  if (statusSelect) {
    // If row already has a verification status, load it
    if (row._verification && row._verification.status) {
      statusSelect.value = row._verification.status;
    }
    applyItemStatusStyle(statusSelect);

    statusSelect.addEventListener('change', () => {
      row._verification = row._verification || {};

      const prevStatus = row._verification.status || '';
      const newStatus  = statusSelect.value || '';

      // Update status
      row._verification.status = newStatus;

      if (newStatus) {
        const { name: currentName } = getCurrentVerifierInfo();

        // Only use the current logged-in person
        const finalName = currentName || null;

        if (finalName) {
          row._verification.verified_by = finalName;
        }

        // Store date-only so it fits the date input
        row._verification.verified_at = new Date().toISOString().slice(0, 10);
      } else {
        // Status cleared → clear verifier info
        row._verification.verified_by = null;
        row._verification.verified_at = null;
      }

      // History
      if (typeof appendVerificationHistory === 'function') {
        appendVerificationHistory(row._verification, prevStatus, newStatus);
      }

      // Update initials tag
      updateVerifierTagForRow(row);

      // UI updates
      applyItemStatusStyle(statusSelect);
      syncVerifyAllCheckboxState();

      if (
        newStatus &&
        typeof autoFillShipmentVerifiedByIfEmpty === 'function'
      ) {
        autoFillShipmentVerifiedByIfEmpty();
      }
    });
  }

  if (editBtn) {
    editBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openItemVerificationModal(row);
    });
  }

  if (deleteBtn) {
    deleteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const ok = window.confirm('Delete this item from the shipment?');
      if (!ok) return;

      row.remove();
      recalcShipmentItemsTotal();
      syncVerifyAllCheckboxState();
    });
  }

  container.appendChild(row);
  recalcShipmentItemsTotal();
  syncVerifyAllCheckboxState();
  syncVendorApplyAllCheckbox();
}


function applyItemVerificationLockForStatus(statusValue) {
  const allowed = canVerifyItems(statusValue);
  const rows = document.querySelectorAll('.shipment-item-row');

  rows.forEach(row => {
    const statusSel = row.querySelector('.shipment-item-status');
    const editBtn   = row.querySelector('.shipment-item-edit');

    // Only lock/unlock verification bits, nothing else
    if (statusSel) {
      statusSel.disabled = !allowed;
    }

    if (editBtn) {
      editBtn.disabled = !allowed;
      // optional visual cue
      editBtn.classList.toggle('verification-locked', !allowed);
    }
  });
}




function syncVerifyAllCheckboxState() {
  const verifyAll = document.getElementById('shipment-verify-all');
  if (!verifyAll) return;

  const selects = Array.from(
    document.querySelectorAll('.shipment-item-status')
  );

  if (!selects.length) {
    verifyAll.checked = false;
    return;
  }

  const allVerified = selects.every(sel => sel.value === 'verified');
  verifyAll.checked = allVerified;
}




function initShipmentItemsSection() {
  const container = document.getElementById('shipment-items-rows');
  const totalDisplay = document.getElementById('shipment-items-total-display');
  const totalHidden = document.getElementById('shipment-total-price');
  const vendorApplyAll = document.getElementById('shipment-vendor-apply-all');

  if (container) container.innerHTML = '';
  if (totalDisplay) totalDisplay.textContent = '$0.00';
  if (totalHidden) totalHidden.value = '';
  if (vendorApplyAll) vendorApplyAll.checked = false;

  // Always start with one blank row
  addShipmentItemRow();
}

function collectShipmentItemsFromForm() {
  const rows = Array.from(document.querySelectorAll('.shipment-item-row'));
  const items = [];

  // If "apply to all" is checked, we'll fall back to the header vendor
  const headerVendorSelect = document.getElementById('shipment-vendor');
  const applyAll = document.getElementById('shipment-vendor-apply-all');
  const headerVendorText =
    headerVendorSelect && headerVendorSelect.selectedIndex > 0
      ? headerVendorSelect.options[headerVendorSelect.selectedIndex].textContent.trim()
      : '';
  const applyAllChecked = !!(applyAll && applyAll.checked);

  rows.forEach(row => {
    const desc = row.querySelector('.shipment-item-desc')?.value.trim() || '';
    const sku  = row.querySelector('.shipment-item-sku')?.value.trim() || '';
    const qty  =
      parseFloat(row.querySelector('.shipment-item-qty')?.value || '0') || 0;
    const unit =
      parseFloat(row.querySelector('.shipment-item-unit')?.value || '0') || 0;

    const statusSel   = row.querySelector('.shipment-item-status');
    const status      = statusSel ? statusSel.value : '';
    const vendorInput = row.querySelector('.shipment-item-vendor');
    let vendor_name = vendorInput ? vendorInput.value.trim() : '';
    if (applyAllChecked && headerVendorText) {
      // When apply-all is on, override item vendor with header vendor
      vendor_name = headerVendorText;
      if (vendorInput && vendorInput.value.trim() !== headerVendorText) {
        vendorInput.value = headerVendorText; // keep UI in sync
      }
    }

    const vMeta = row._verification || {};

    // Skip completely empty rows (including vendor)
    if (!desc && !sku && !qty && !unit && !vendor_name) return;

    const line_total = qty * unit;

    // Build verification object
    const verification = {
      status: status || vMeta.status || '',
      verified_by: vMeta.verified_by || null,
      verified_at: vMeta.verified_at || null,
      storage_override: vMeta.storage_override || null,
      notes: vMeta.notes || null,
      issue_type: vMeta.issue_type || null,
      history: Array.isArray(vMeta.history) ? vMeta.history : []
    };

    // If we have a status but no date yet, fill it at save time
    if (verification.status && !verification.verified_at) {
      verification.verified_at = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    }

    items.push({
      description: desc || null,
      sku: sku || null,
      quantity: qty,
      unit_price: unit,
      line_total,
      vendor_name: vendor_name || null,
      verification
    });
  });

  return items;
}



async function loadShipmentDocuments(shipmentId) {
  const listEl = document.getElementById('shipment-docs-list');
  const notesSection = document.querySelector('.shipment-notes-section');
  if (!listEl || !shipmentId) return;

  // Show loading
  listEl.innerHTML = '<li class="shipment-docs-empty small-muted">Loading documents…</li>';

  try {
    const res = await fetchJSON(
      `/api/shipments/${encodeURIComponent(shipmentId)}/documents`
    );

    const docs = (res && res.documents) || [];

    // No docs → message + full-width notes
    if (!docs.length) {
      listEl.innerHTML =
        '<li class="shipment-docs-empty small-muted">(No documents uploaded yet.)</li>';

      if (notesSection) notesSection.classList.remove('notes-shifted');
      return;
    }

    // ✅ listEl *is* the <ul>, so we just fill it with <li>s
    listEl.innerHTML = '';

    docs.forEach(doc => {
      const li = document.createElement('li');
      li.className = 'shipment-docs-list-item';
      li.dataset.docId = doc.id;

      // Left side: link + meta
      const mainSpan = document.createElement('span');
      mainSpan.className = 'shipment-docs-main';

      const a = document.createElement('a');
      a.className = 'shipment-docs-link';
      a.href = doc.url || doc.file_path || '#';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = doc.title || doc.doc_label || doc.original_name || 'Document';
      mainSpan.appendChild(a);

      const typeLabel = doc.doc_label || doc.doc_type;
      if (typeLabel) {
        const tag = document.createElement('span');
        tag.className = 'shipment-docs-tag';
        tag.textContent = typeLabel;
        if (doc.doc_type && doc.doc_label && doc.doc_label !== doc.doc_type) {
          tag.title = `Type: ${doc.doc_type}`;
        }
        mainSpan.appendChild(tag);
      }

      li.appendChild(mainSpan);

      // Right side: small red X button
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'icon-button shipment-docs-delete';
      deleteBtn.title = 'Delete document';
      deleteBtn.textContent = '×';

      deleteBtn.addEventListener('click', async (evt) => {
        evt.preventDefault();
        evt.stopPropagation();

        const ok = window.confirm(
          'Delete this document? This cannot be undone and the file will be removed.'
        );
        if (!ok) return;

        try {
          await fetchJSON(
            `/api/shipments/${encodeURIComponent(shipmentId)}/documents/${encodeURIComponent(doc.id)}`,
            { method: 'DELETE' }
          );
          await loadShipmentDocuments(shipmentId);
        } catch (err) {
          console.error('Error deleting shipment document:', err);
          alert('Error deleting document: ' + err.message);
        }
      });

      li.appendChild(deleteBtn);
      listEl.appendChild(li);
    });

    // Add border/scroll state class if needed
    if (listEl.scrollHeight > listEl.clientHeight + 1) {
      listEl.classList.add('is-scrollable');
    } else {
      listEl.classList.remove('is-scrollable');
    }

    // ✅ Docs exist → shift notes into left column
    if (notesSection) {
      notesSection.classList.add('notes-shifted');
    }
  } catch (err) {
    console.error('Error loading shipment documents', err);
    listEl.innerHTML =
      '<li class="shipment-docs-empty small-muted" style="color: crimson;">Error loading documents.</li>';
  }
}

// ───────── OFFLINE SUPPORT FOR SHIPMENTS (LIGHTWEIGHT) ─────────

const SHIPMENTS_CACHE_KEY = 'avian_shipments_board_cache';
const SHIPMENTS_QUEUE_KEY = 'avian_shipments_update_queue';

// Report column configuration
const SHIP_REPORT_COLUMNS = [
  { key: 'bol', label: 'BOL', default: true },
  { key: 'sku', label: 'Internal Ref #', default: true },
  { key: 'project', label: 'Project', default: true },
  { key: 'title', label: 'Title', default: true },
  { key: 'status', label: 'Status', default: true },
  { key: 'verified', label: 'Items Verified?', default: true },
  { key: 'eta', label: 'Freight Forwarder Paid', default: true },
  { key: 'ready', label: 'Customs Paid', default: true },
  { key: 'tracking', label: 'Tracking #', default: false },
  { key: 'forwarder', label: 'Freight Forwarder', default: false },
  { key: 'vendor', label: 'Vendor', default: false },
  { key: 'vendor_paid', label: 'Vendor Paid', default: false },
  { key: 'vendor_paid_amt', label: 'Vendor Paid Amount', default: false },
  { key: 'ff_paid', label: 'Freight Forwarder Paid', default: true },
  { key: 'ff_paid_amt', label: 'Freight Forwarder Paid Amount', default: false },
  { key: 'customs_paid', label: 'Customs Paid', default: true },
  { key: 'customs_paid_amt', label: 'Customs Paid Amount', default: false },
  { key: 'total_paid', label: 'Total Paid', default: false },
  { key: 'picked_by', label: 'Picked Up By', default: false },
  { key: 'picked_date', label: 'Pickup Date', default: false }
];
let shipmentsReportData = [];

function isOnline() {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

// --- Board cache (for loading shipments when offline) ---

function saveShipmentsBoardCache(data) {
  try {
    localStorage.setItem(SHIPMENTS_CACHE_KEY, JSON.stringify({
      at: new Date().toISOString(),
      data
    }));
  } catch {}
}

function loadShipmentsBoardCache() {
  try {
    const raw = localStorage.getItem(SHIPMENTS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.data ? parsed.data : null;
  } catch {
    return null;
  }
}

// --- Update queue (for saving verification while offline) ---

function getShipmentsUpdateQueue() {
  try {
    const raw = localStorage.getItem(SHIPMENTS_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveShipmentsUpdateQueue(queue) {
  try {
    localStorage.setItem(SHIPMENTS_QUEUE_KEY, JSON.stringify(queue));
  } catch {}
}

// Add/replace a pending update for a given shipment id
function queueShipmentUpdate(shipmentId, payload) {
  const q = getShipmentsUpdateQueue();

  // For simplicity, keep only the latest update per shipment
  const without = q.filter(entry => entry.id !== shipmentId);
  without.push({
    id: shipmentId,
    payload,
    queued_at: new Date().toISOString()
  });

  saveShipmentsUpdateQueue(without);
}

async function syncShipmentsUpdateQueue() {
  if (!isOnline()) return;

  let q = getShipmentsUpdateQueue();
  if (!q.length) return;

  const remaining = [];

  for (const entry of q) {
    const { id, payload } = entry;
    if (!id) continue;

    try {
      await fetchJSON(`/api/shipments/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      // If we get here, that entry synced successfully → do not re-add
    } catch (err) {
      console.warn('[SHIPMENTS OFFLINE] Failed to sync shipment', id, err);
      // keep it in the queue to try again later
      remaining.push(entry);
    }
  }

  saveShipmentsUpdateQueue(remaining);

  // Optionally reload board if anything changed
  if (remaining.length === 0 && typeof loadShipmentsBoard === 'function') {
    try {
      await loadShipmentsBoard();
    } catch {}
  }
}

// Whenever the browser comes back online, try to flush queue
window.addEventListener('online', () => {
  syncShipmentsUpdateQueue();
});


async function loadShipmentsSection() {
  await Promise.all([
    loadShipmentsBoard(),
    loadShipmentsFilters()
  ]);
}

async function loadShipmentsFilters() {
  try {
    const [vendors, projects] = await Promise.all([
      fetchJSON('/api/vendors?status=active'),
      fetchJSON('/api/projects?status=active')
    ]);

    // Top-of-board filters
    const vendorFilter  = document.getElementById('shipments-filter-vendor');
    const projectFilter = document.getElementById('shipments-filter-project');

    if (vendorFilter) {
      vendorFilter.options.length = 1; // keep "All vendors"
      vendors.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.name;
        vendorFilter.appendChild(opt);
      });
    }

    if (projectFilter) {
      projectFilter.options.length = 1; // keep "All projects"
      projects.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.customer_name
          ? `${p.customer_name} – ${p.name}`
          : p.name;
        projectFilter.appendChild(opt);
      });
    }

    // Create-shipment modal selects
    // Create-shipment modal selects
const projectSelect = document.getElementById('shipment-project');
const forwarderSelect = document.getElementById('shipment-forwarder');
    const vendorSelect    = document.getElementById('shipment-vendor');

    // Project select (modal)
    if (projectSelect) {
      projectSelect.innerHTML = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Select project…';
      projectSelect.appendChild(placeholder);

      projects.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.customer_name
          ? `${p.customer_name} – ${p.name}`
          : p.name;
        projectSelect.appendChild(opt);
      });
    }

    // Vendor select (modal)
    if (vendorSelect) {
      vendorSelect.innerHTML = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Select vendor…';
      vendorSelect.appendChild(placeholder);

      vendors.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.name;
        vendorSelect.appendChild(opt);
      });
    }

    // Freight forwarder select (modal)
    if (forwarderSelect) {
      forwarderSelect.innerHTML = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Select forwarder…';
      forwarderSelect.appendChild(placeholder);

      vendors
        .filter(v => v.is_freight_forwarder)
        .forEach(v => {
          const opt = document.createElement('option');
          opt.value = v.name; // store name as text
          opt.textContent = v.name;
          forwarderSelect.appendChild(opt);
        });
    }
  } catch (err) {
    console.error('Error loading shipment filters:', err);
  }
}

function updateShipmentsStatusFilter(statuses) {
  const select = document.getElementById('shipments-filter-status');
  if (!select || !Array.isArray(statuses)) return;

  // Remember the currently selected value (if any)
  const previousValue = select.value;

  // Rebuild options, keeping a default "All statuses"
  select.innerHTML = '';
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'All statuses';
  select.appendChild(defaultOpt);

  statuses.forEach(status => {
    const opt = document.createElement('option');
    opt.value = status;
    opt.textContent = status;
    select.appendChild(opt);
  });

  // Restore selection if it still exists in the new list
  if (previousValue && statuses.includes(previousValue)) {
    select.value = previousValue;
  }
}

async function loadShipmentsBoard() {
  const msgEl = document.getElementById('shipments-board-message');
  const boardEl = document.getElementById('shipments-board');
  if (!boardEl) return;

  boardEl.innerHTML = '';
  if (msgEl) {
    msgEl.textContent = isOnline()
      ? 'Loading shipments…'
      : 'Offline – showing last downloaded shipments.';
    msgEl.style.color = isOnline() ? '' : '#b45309'; // amber-ish
  }

  const search =
    document.getElementById('shipments-search')?.value || '';
  const statusFilter = currentStatusFilter || '';
  const projectFilter =
    document.getElementById('shipments-filter-project')?.value || '';
  const vendorFilter =
    document.getElementById('shipments-filter-vendor')?.value || '';

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (statusFilter) params.set('status', statusFilter);
  if (projectFilter) params.set('project_id', projectFilter);
  if (vendorFilter) params.set('vendor_id', vendorFilter);

  // If offline, skip fetch and use cache if available
  if (!isOnline()) {
    const cached = loadShipmentsBoardCache();
    if (cached) {
      shipmentsBoardData = cached;
      updateShipmentsStatusFilter(cached.statuses || []);
      if (cached.statuses) {
        populateStatusDropdown(cached.statuses);
      }
      renderNotificationStatusCheckboxes(cached.statuses || []);
      refreshShipmentNotificationOptions();
      renderShipmentsBoard();
      return;
    }
    // fall through to normal behavior → will show error message
  }

  try {
    const data = await fetchJSON('/api/shipments?' + params.toString());
    shipmentsBoardData = data;

    // Save fresh copy for offline use
    saveShipmentsBoardCache(data);

    updateShipmentsStatusFilter(data.statuses || []);
    if (data.statuses) {
      populateStatusDropdown(data.statuses);
    }
    renderNotificationStatusCheckboxes(data.statuses || []);
    refreshShipmentNotificationOptions();

    renderShipmentsBoard();
    if (msgEl) {
      msgEl.textContent = '';
      msgEl.style.color = '';
    }
  } catch (err) {
    console.error('Error loading shipments:', err.message);
    boardEl.innerHTML = '';
    if (msgEl) {
      msgEl.textContent = 'Error loading shipments: ' + err.message;
      msgEl.style.color = 'red';
    }

    // If fetch failed but we *do* have a cache, use it as a fallback
    const cached = loadShipmentsBoardCache();
    if (cached) {
      shipmentsBoardData = cached;
      updateShipmentsStatusFilter(cached.statuses || []);
      if (cached.statuses) {
        populateStatusDropdown(cached.statuses);
      }
      renderNotificationStatusCheckboxes(cached.statuses || []);
      refreshShipmentNotificationOptions();
      renderShipmentsBoard();
      if (msgEl) {
        msgEl.textContent =
          'Offline – showing last downloaded shipments (may be stale).';
        msgEl.style.color = '#b45309';
      }
    }
  }
}


async function runShipmentsSummaryReport(e) {
  if (e) e.preventDefault();

  const projectId = document.getElementById('shipments-report-project')?.value || '';
  const start     = document.getElementById('shipments-report-start')?.value || '';
  const end       = document.getElementById('shipments-report-end')?.value || '';
  const status    = document.getElementById('shipments-report-status')?.value || '';

  const params = new URLSearchParams();
  if (projectId) params.set('project_id', projectId);
  if (start)     params.set('start', start);
  if (end)       params.set('end', end);
  if (status)    params.set('status', status);

  const tbody = document.getElementById('shipments-report-table-body');
  const msgEl = document.getElementById('shipments-report-message');

  clearInlineReportDetail();

  if (msgEl) {
    msgEl.textContent = 'Loading report…';
    msgEl.style.color = '';
  }

  try {
    const data = await fetchJSON(`/api/reports/shipment-verification?${params.toString()}`);
    shipmentsReportData = data.shipments || [];

    renderShipmentsReportTable();
    if (msgEl) msgEl.textContent = '';
  } catch (err) {
    console.error('Error loading shipment verification report:', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="8" style="color: crimson;">Error: ${err.message || 'Failed to load report'}</td></tr>`;
    }
    clearInlineReportDetail();
    if (msgEl) {
      msgEl.textContent = 'Error loading report. Please try again.';
      msgEl.style.color = 'crimson';
    }
  }
}

let currentInlineReportDetail = null;

function clearInlineReportDetail() {
  const existing = document.querySelector('.shipment-report-detail-row');
  if (existing) existing.remove();

  if (currentInlineReportDetail && currentInlineReportDetail.btn) {
    currentInlineReportDetail.btn.textContent = 'View Details';
    currentInlineReportDetail.btn.classList.remove('details-open');
  }
  currentInlineReportDetail = null;
}

function renderShipmentVerificationDetail(detail, btn) {
  clearInlineReportDetail();

  if (!detail || !detail.shipment || !btn) return;

  const shipment = detail.shipment || {};
  const items = Array.isArray(detail.items) ? detail.items : [];
  const table = document.getElementById('shipments-report-table');
  const colspan = table?.querySelectorAll('thead th').length || 9;

  const detailRow = document.createElement('tr');
  detailRow.className = 'shipment-report-detail-row';
  detailRow.innerHTML = `
    <td colspan="${colspan}">
      <div class="shipment-report-detail">
        <div class="shipment-report-detail-body">
          <table class="subtable">
            <thead>
              <tr>
                <th>Item</th>
                <th>SKU</th>
                <th>Qty</th>
                <th>Status</th>
                <th class="narrow-cell">Verified By</th>
                <th class="small-cell">Verified At</th>
                <th class="wide-notes">Notes</th>
                <th>Storage Info</th>
              </tr>
            </thead>
            <tbody>
              ${
                items.length
                  ? items.map(it => {
                      const v = it.verification || {};
                      return `
                        <tr>
                          <td>${it.description || ''}</td>
                          <td>${it.sku || ''}</td>
                          <td>${it.quantity != null ? it.quantity : ''}</td>
                          <td>${v.status || ''}</td>
                          <td class="narrow-cell">${v.verified_by || ''}</td>
                          <td class="small-cell">${v.verified_at || ''}</td>
                          <td class="wide-notes">${v.notes || ''}</td>
                          <td>${v.storage_override || ''}</td>
                        </tr>
                      `;
                    }).join('')
                  : `<tr><td colspan="8">(no items found for this shipment)</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>
    </td>
  `;

  const parentRow = btn.closest('tr');
  if (parentRow && parentRow.parentElement) {
    parentRow.insertAdjacentElement('afterend', detailRow);
  }

  btn.textContent = 'Hide Details';
  btn.classList.add('details-open');
  currentInlineReportDetail = { btn, detailRow };
}

function getSelectedReportColumns() {
  const picked = [];
  SHIP_REPORT_COLUMNS.forEach(col => {
    const checkbox = document.querySelector(`input[data-report-col="${col.key}"]`);
    if (checkbox ? checkbox.checked : col.default) {
      picked.push(col.key);
    }
  });
  // Ensure details button always present
  if (!picked.includes('details')) picked.push('details');
  return picked;
}

function renderShipmentsReportTable() {
  const tbody = document.getElementById('shipments-report-table-body');
  const thead = document.querySelector('#shipments-report-table thead tr');
  if (!tbody || !thead) return;

  clearInlineReportDetail();

  const rows = shipmentsReportData || [];
  const selected = getSelectedReportColumns();

  // Build header
  thead.innerHTML = '';
  selected.forEach(key => {
    const colDef = SHIP_REPORT_COLUMNS.find(c => c.key === key);
    const th = document.createElement('th');
    th.textContent = colDef ? colDef.label : key;
    thead.appendChild(th);
  });

  // Build body
  tbody.innerHTML = '';
  if (!rows.length) {
    const colCount = selected.length || 1;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="${colCount}">(no shipments found for this filter)</td>`;
    tbody.appendChild(tr);
    return;
  }

  rows.forEach(row => {
    const tr = document.createElement('tr');
    const readyFlag =
      row.items_verified &&
      !row.picked_up_by &&
      row.status === 'Cleared - Ready for Release';

    selected.forEach(key => {
      const td = document.createElement('td');
      switch (key) {
        case 'bol':
          td.textContent = row.bol_number || '—';
          break;
        case 'sku':
          td.textContent = row.sku || '';
          break;
        case 'project':
          td.textContent = `${row.customer_name || ''} – ${row.project_name || ''}`;
          break;
        case 'title':
          td.textContent = row.title || '';
          break;
        case 'status':
          td.textContent = row.status || '';
          break;
        case 'verified':
          td.textContent = row.items_verified ? 'Yes' : 'No';
          break;
        case 'eta':
          td.textContent = row.shipper_paid ? 'Paid' : 'Unpaid';
          break;
        case 'ready':
          td.textContent = row.customs_paid ? 'Paid' : 'Unpaid';
          break;
        case 'tracking':
          td.textContent = row.tracking_number || '';
          break;
        case 'forwarder':
          td.textContent = row.freight_forwarder || '';
          break;
        case 'vendor':
          td.textContent = row.vendor_name || '';
          break;
        case 'vendor_paid':
          td.textContent = row.vendor_paid ? 'Paid' : 'Unpaid';
          break;
        case 'vendor_paid_amt':
          td.textContent =
            row.vendor_paid_amount != null
              ? `$${Number(row.vendor_paid_amount).toFixed(2)}`
              : '';
          break;
        case 'ff_paid':
          td.textContent = row.shipper_paid ? 'Paid' : 'Unpaid';
          break;
        case 'ff_paid_amt':
          td.textContent =
            row.shipper_paid_amount != null
              ? `$${Number(row.shipper_paid_amount).toFixed(2)}`
              : '';
          break;
        case 'customs_paid':
          td.textContent = row.customs_paid ? 'Paid' : 'Unpaid';
          break;
        case 'customs_paid_amt':
          td.textContent =
            row.customs_paid_amount != null
              ? `$${Number(row.customs_paid_amount).toFixed(2)}`
              : '';
          break;
        case 'total_paid':
          td.textContent =
            row.total_paid != null ? `$${Number(row.total_paid).toFixed(2)}` : '';
          break;
        case 'picked_by':
          td.textContent = row.picked_up_by || '';
          break;
        case 'picked_date':
          td.textContent = row.picked_up_date || '';
          break;
        case 'details': {
          const btn = document.createElement('button');
          btn.className = 'btn btn-sm secondary';
          btn.dataset.shipmentId = row.id;
          btn.textContent = 'View Details';
          td.appendChild(btn);
          break;
        }
        default:
          td.textContent = '';
      }
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}

function initShipmentsReportUI() {
  const form = document.getElementById('shipments-report-form');
  if (form) {
    form.addEventListener('submit', runShipmentsSummaryReport);
  }

  // Column picker
  const colToggle = document.getElementById('report-columns-toggle');
  const colMenu   = document.getElementById('report-columns-menu');
  document.querySelectorAll('input[data-report-col]').forEach(cb => {
    cb.addEventListener('change', renderShipmentsReportTable);
  });
  if (colToggle && colMenu) {
    colToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      colMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!colMenu.contains(e.target) && !colToggle.contains(e.target)) {
        colMenu.classList.add('hidden');
      }
    });
  }

  // Set initial label
  const colLabel = document.getElementById('report-columns-label');
  if (colLabel) {
    colLabel.textContent = 'Default columns';
  }

  // Click → load detail report for that shipment
  const tbody = document.getElementById('shipments-report-table-body');
  if (tbody) {
    tbody.addEventListener('click', async evt => {
      const btn = evt.target.closest('button[data-shipment-id]');
      if (!btn) return;
      const shipmentId = btn.dataset.shipmentId;
      if (!shipmentId) return;

      // Toggle hide if already open
      if (btn.classList.contains('details-open')) {
        clearInlineReportDetail();
        return;
      }

      try {
        const detail = await fetchJSON(
          `/api/reports/shipment-verification?shipment_id=${encodeURIComponent(
            shipmentId
          )}`
        );
        renderShipmentVerificationDetail(detail, btn);

        // reset other buttons
        tbody.querySelectorAll('button[data-shipment-id]').forEach(b => {
          if (b !== btn) {
            b.textContent = 'View Details';
            b.classList.remove('details-open');
          }
        });
      } catch (err) {
        console.error('Error loading shipment verification detail:', err);
        alert('Error loading shipment details: ' + err.message);
      }
    });
  }
}


function openShipmentCreateModal() {
  // 🔒 BLOCK AUTOFILL ON SHIPMENTS SEARCH WHILE MODAL IS OPEN
  const shipmentsSearch = document.getElementById('shipments-search');
  if (shipmentsSearch) {
    shipmentsSearch.setAttribute('autocomplete', 'off');
    shipmentsSearch.setAttribute('autocorrect', 'off');
    shipmentsSearch.setAttribute('autocapitalize', 'off');
    shipmentsSearch.setAttribute('spellcheck', 'false');
    shipmentsSearch.setAttribute('name', 'shipments-search-no-autofill');
    shipmentsSearch.value = '';
    shipmentsSearch.setAttribute('disabled', 'true');
  }

  const modal    = document.getElementById('shipment-create-modal');
  const backdrop = document.getElementById('shipment-create-backdrop');
  const form     = document.getElementById('shipment-create-form');
  const msgEl    = document.getElementById('shipment-create-status');
  const idInput  = document.getElementById('shipment-id');
  const storageDueInput     = document.getElementById('shipment-storage-due-date');
  const storageDailyInput   = document.getElementById('shipment-storage-daily-fee');
  const storageEstimate     = document.getElementById('shipment-storage-fees-estimate');
  const storageEstimateHelp = document.getElementById('shipment-storage-fees-helper');
  const header   = modal ? modal.querySelector('h3') : null;

  // NEW fields for post-pickup + payments
  const pickedUpByInput   = document.getElementById('shipment-picked-up-by');
  const pickedUpDateInput = document.getElementById('shipment-picked-up-date');
  const vendorPaidChk     = document.getElementById('shipment-vendor-paid');
  const vendorPaidAmt     = document.getElementById('shipment-vendor-paid-amount');
  const shipperPaidChk    = document.getElementById('shipment-shipper-paid');
  const shipperPaidAmt    = document.getElementById('shipment-shipper-paid-amount');
  const customsPaidChk    = document.getElementById('shipment-customs-paid');
  const customsPaidAmt    = document.getElementById('shipment-customs-paid-amount');

  if (form) form.reset();

  // Reset total paid display + hidden numeric
  const totalPaidDisplay = document.getElementById('shipment-total-paid-display');
  const totalPaidHidden  = document.getElementById('shipment-total-paid');

  if (totalPaidDisplay) totalPaidDisplay.value = '';
  if (totalPaidHidden)  totalPaidHidden.value  = '';

  // Reset message
  if (msgEl) {
    msgEl.textContent = '';
    msgEl.style.color = 'black';
  }

  // Reset storage due date / fees
  if (storageDueInput) storageDueInput.value = '';
  if (storageDailyInput) storageDailyInput.value = storageDailyInput.value || '';
  if (storageEstimate) storageEstimate.value = '$0.00';
  if (storageEstimateHelp) {
    storageEstimateHelp.textContent = '';
    storageEstimateHelp.style.display = 'none';
  }

  if (idInput) idInput.value = '';
  if (header) header.textContent = 'New Shipment';

  // NEW shipment → show docs placeholder + reset doc input
  if (typeof showDocsPlaceholder === 'function') showDocsPlaceholder();

  const docsInput = document.getElementById('shipment-documents');
  if (docsInput) docsInput.value = '';

  // Clear validation styling
  const titleInput     = document.getElementById('shipment-title');
  const projectInput   = document.getElementById('shipment-project');
  const vendorSelect   = document.getElementById('shipment-vendor');
  const trackingHelper = document.getElementById('shipment-tracking-helper');

  if (trackingHelper) trackingHelper.textContent = '';
  titleInput?.classList.remove('field-error');
  projectInput?.classList.remove('field-error');
  vendorSelect?.classList.remove('field-error');

  // Reset pickup fields
  if (pickedUpByInput)   pickedUpByInput.value   = '';
  if (pickedUpDateInput) pickedUpDateInput.value = '';

  // Reset payment fields
  if (vendorPaidChk)  vendorPaidChk.checked = false;
  if (vendorPaidAmt)  vendorPaidAmt.value   = '';
  if (shipperPaidChk) shipperPaidChk.checked = false;
  if (shipperPaidAmt) shipperPaidAmt.value   = '';
  if (customsPaidChk) customsPaidChk.checked = false;
  if (customsPaidAmt) customsPaidAmt.value   = '';

  // Pre-select project based on board filter
  const boardProjectFilter  = document.getElementById('shipments-filter-project');
  const createProjectSelect = document.getElementById('shipment-project');
  if (boardProjectFilter && createProjectSelect && boardProjectFilter.value) {
    createProjectSelect.value = boardProjectFilter.value;
  }

  // Load statuses into dropdown
  const statusSelect = document.getElementById('shipment-status');
  if (statusSelect && shipmentsBoardData && Array.isArray(shipmentsBoardData.statuses)) {
    statusSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select status…';
    statusSelect.appendChild(placeholder);

    shipmentsBoardData.statuses.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      statusSelect.appendChild(opt);
    });

    // Default to Pre-Order
    if (shipmentsBoardData.statuses.includes('Pre-Order')) {
      statusSelect.value = 'Pre-Order';
    }

    applyStatusColorToSelect(statusSelect);

    // --- IMPORTANT: Verification lock handling ---
    statusSelect.onchange = () => {
      applyStatusColorToSelect(statusSelect);
      toggleShipmentVerificationSection(statusSelect.value);
      applyItemVerificationLockForStatus(statusSelect.value);
    };

    toggleShipmentVerificationSection(statusSelect.value || '');
    applyItemVerificationLockForStatus(statusSelect.value || '');
  }

  // Reset items section + one blank row
  initShipmentItemsSection();

  // Wire up header-level "verify all"
  initShipmentVerificationControls();

  // Keep vendor apply-all unchecked by default; item vendors will be populated on edit
  const vendorApplyAll = document.getElementById('shipment-vendor-apply-all');
  if (vendorApplyAll) vendorApplyAll.checked = false;

  updateStorageFeeEstimate();

  // Show modal
  if (modal)    modal.classList.remove('hidden');
  if (backdrop) backdrop.classList.remove('hidden');
}

async function saveShipmentFromModal() {
  const msgEl   = document.getElementById('shipment-create-status');
  const idInput = document.getElementById('shipment-id');
  const shipmentId = idInput && idInput.value ? idInput.value : null;

  if (msgEl) {
    msgEl.textContent = '';
    msgEl.style.color = 'black';
  }

  // Collect items and compute total
  const items = collectShipmentItemsFromForm();
  const itemsTotal = items.reduce((sum, it) => sum + (Number(it.line_total) || 0), 0);

  // Required fields
  const titleInput   = document.getElementById('shipment-title');
  const projectInput = document.getElementById('shipment-project');
  const vendorSelect = document.getElementById('shipment-vendor');
  const statusInput  = document.getElementById('shipment-status');

  const title        = titleInput?.value.trim() || '';
  const projectIdRaw = projectInput?.value || '';
  const vendorIdRaw  = vendorSelect?.value || '';
  const vendorName =
    vendorSelect && vendorSelect.selectedIndex > 0
      ? vendorSelect.options[vendorSelect.selectedIndex].textContent.trim()
      : '';
  const statusRaw = statusInput?.value || '';

  // Optional website
  const websiteRaw =
    document.getElementById('shipment-website-url')?.value.trim() || '';

  // NEW: post-pickup + payments fields
  const storageRoomInput    = document.getElementById('shipment-storage-room');
  const storageDetInput     = document.getElementById('shipment-storage-details');
  const storageDueInput     = document.getElementById('shipment-storage-due-date');
  const storageDailyInput   = document.getElementById('shipment-storage-daily-fee');
  const pickedUpByInput     = document.getElementById('shipment-picked-up-by');
  const pickedUpDateInput   = document.getElementById('shipment-picked-up-date');

  const vendorPaidChk       = document.getElementById('shipment-vendor-paid');
  const vendorPaidAmtInput  = document.getElementById('shipment-vendor-paid-amount');
  const shipperPaidChk      = document.getElementById('shipment-shipper-paid');
  const shipperPaidAmtInput = document.getElementById('shipment-shipper-paid-amount');
  const customsPaidChk      = document.getElementById('shipment-customs-paid');
  const customsPaidAmtInput = document.getElementById('shipment-customs-paid-amount');

  const storageRoom    = storageRoomInput?.value.trim() || '';
  const storageDetails = storageDetInput?.value.trim() || '';
  const storageDueDate = storageDueInput?.value || '';
  const storageDailyFeeRaw = storageDailyInput?.value || '';
  const storageDailyFee =
    storageDailyFeeRaw !== '' && !Number.isNaN(Number(storageDailyFeeRaw))
      ? Number(storageDailyFeeRaw)
      : null;
  const pickedUpBy     = pickedUpByInput?.value.trim() || '';
  const pickedUpDate   = pickedUpDateInput?.value || '';

  const vendorPaid       = vendorPaidChk && vendorPaidChk.checked ? 1 : 0;
  const vendorPaidAmount =
    vendorPaidAmtInput && vendorPaidAmtInput.value
      ? Number(vendorPaidAmtInput.value)
      : null;

  const shipperPaid       = shipperPaidChk && shipperPaidChk.checked ? 1 : 0;
  const shipperPaidAmount =
    shipperPaidAmtInput && shipperPaidAmtInput.value
      ? Number(shipperPaidAmtInput.value)
      : null;

  const customsPaid       = customsPaidChk && customsPaidChk.checked ? 1 : 0;
  const customsPaidAmount =
    customsPaidAmtInput && customsPaidAmtInput.value
      ? Number(customsPaidAmtInput.value)
      : null;

  // 🔹 Auto-calculated total from hidden input
  const totalPaidInput = document.getElementById('shipment-total-paid');
  const totalPaid =
    totalPaidInput && totalPaidInput.value
      ? Number(totalPaidInput.value)
      : null;

  // 🔹 Verification fields
  const verifyAllChk          = document.getElementById('shipment-verify-all');
  const verifiedByInput       = document.getElementById('shipment-verified-by');
  const verificationNotesArea = document.getElementById('shipment-verification-notes');

  const itemsVerified     = verifyAllChk && verifyAllChk.checked ? 1 : 0;
  const verifiedBy        = verifiedByInput?.value.trim() || '';
  const verificationNotes = verificationNotesArea?.value.trim() || '';

  // 🔹 Clear old errors
  titleInput?.classList.remove('field-error');
  projectInput?.classList.remove('field-error');
  vendorSelect?.classList.remove('field-error');

  let hasError = false;

  if (!title) {
    titleInput?.classList.add('field-error');
    hasError = true;
  }
  if (!projectIdRaw) {
    projectInput?.classList.add('field-error');
    hasError = true;
  }

  if (hasError) {
    if (msgEl) {
      msgEl.textContent = 'Please fill in the required fields.';
      msgEl.style.color = 'crimson';
    }
    return;
  }

  // Build final payload
  const payload = {
    title,
    po_number:
      document.getElementById('shipment-po-number')?.value.trim() || '',
    vendor_id: vendorIdRaw || null,
    vendor_name: vendorName || null,
    freight_forwarder:
      document.getElementById('shipment-forwarder')?.value || null,
    destination:
      document.getElementById('shipment-destination')?.value.trim() || '',
    project_id: projectIdRaw || null,

    items,                               // <--- send the array
    items_total: itemsTotal || null, 

    // ⭐ INTERNAL REF FIXED HERE ⭐
    sku: document.getElementById('shipment-sku')?.value.trim() || null,
    quantity: null,
    price_per_item: null,

    total_price: itemsTotal ? itemsTotal.toFixed(2) : null,
    expected_ship_date:
      document.getElementById('shipment-expected-ship-date')?.value || '',
    expected_arrival_date:
      document.getElementById('shipment-expected-arrival-date')?.value || '',
    tracking_number:
      document.getElementById('shipment-tracking-number')?.value.trim() || '',
    bol_number:
      document.getElementById('shipment-bol-number')?.value.trim() || '',

    // Storage + pickup
    storage_room:    storageRoom || null,
    storage_details: storageDetails || null,
    storage_due_date: storageDueDate || null,
    storage_daily_late_fee: storageDailyFee != null ? storageDailyFee : null,
    picked_up_by:    pickedUpBy || null,
    picked_up_date:  pickedUpDate || null,

    // Payments
    vendor_paid:          vendorPaid,
    vendor_paid_amount:   vendorPaidAmount,
    shipper_paid:         shipperPaid,
    shipper_paid_amount:  shipperPaidAmount,
    customs_paid:         customsPaid,
    customs_paid_amount:  customsPaidAmount,
    total_paid:           totalPaid,

    // Verification
    items_verified:       itemsVerified,
    verification_notes:   verificationNotes || null,

    website_url: websiteRaw || null,
    notes: document.getElementById('shipment-notes')?.value.trim() || '',
    status: statusRaw,
  };
 // 🔹 If offline and this is a *new* shipment → block (too messy to safely create)
  if (!isOnline() && !shipmentId) {
    if (msgEl) {
      msgEl.textContent =
        'You are offline. New shipments must be created while online.';
      msgEl.style.color = 'crimson';
    }
    return;
  }

  // 🔹 If offline and editing an existing shipment → queue update
  if (!isOnline() && shipmentId) {
    queueShipmentUpdate(shipmentId, payload);

    if (msgEl) {
      msgEl.textContent =
        'Offline: changes saved on this device and will sync when back online.';
      msgEl.style.color = '#b45309'; // amber
    }

    // Optionally close modal & refresh board from cache
    closeShipmentCreateModal();
    return;
  }

  // 🔹 Normal ONLINE path (unchanged except small addition at end)
  try {
    if (msgEl) {
      msgEl.textContent = 'Saving...';
      msgEl.style.color = 'black';
    }

    const url = shipmentId
      ? `/api/shipments/${encodeURIComponent(shipmentId)}`
      : '/api/shipments';
    const method = shipmentId ? 'PUT' : 'POST';

    const result = await fetchJSON(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const savedShipment = result && result.shipment;
    const finalId = shipmentId || (savedShipment && savedShipment.id);

    // Upload docs after shipment creation
    if (finalId) {
      await uploadShipmentDocuments(finalId);
    }

    if (msgEl) {
      msgEl.textContent = shipmentId ? 'Shipment updated.' : 'Shipment created.';
      msgEl.style.color = 'green';
    }

    closeShipmentCreateModal();

    // 🔹 Refresh board & cache after a successful save
    await loadShipmentsBoard();

  } catch (err) {
    if (msgEl) {
      msgEl.textContent = 'Error saving shipment: ' + err.message;
      msgEl.style.color = 'red';
    }
  }
}


function openShipmentEditModal(shipment, items = []) {
  // Start clean — disables/clears search etc.
  openShipmentCreateModal();

  const modal    = document.getElementById('shipment-create-modal');
  const backdrop = document.getElementById('shipment-create-backdrop');
  const idInput  = document.getElementById('shipment-id');
  const header   = modal ? modal.querySelector('h3') : null;

  if (idInput) idInput.value = shipment.id;
  if (header) header.textContent = 'Edit Shipment';

  // Enable documents UI
  if (typeof showDocsUI === "function") showDocsUI();

  // Reset docs list
  const docsInput = document.getElementById('shipment-documents');
  if (docsInput) docsInput.value = '';
  const docsList = document.getElementById('shipment-docs-list');
  if (docsList) docsList.innerHTML = '<p class="small-muted">Loading documents…</p>';

  // Basic fields
  const titleInput       = document.getElementById('shipment-title');
  const poInput          = document.getElementById('shipment-po-number');
  const vendorSelect     = document.getElementById('shipment-vendor');
  const destInput        = document.getElementById('shipment-destination');
  const projectSelect    = document.getElementById('shipment-project');
  const statusSelect     = document.getElementById('shipment-status');
  const skuInput         = document.getElementById('shipment-sku');
  const forwarderSelect  = document.getElementById('shipment-forwarder');
  const websiteInput     = document.getElementById('shipment-website-url');
  const notesInput       = document.getElementById('shipment-notes');
  const expShipInput     = document.getElementById('shipment-expected-ship-date');
  const expArriveInput   = document.getElementById('shipment-expected-arrival-date');
  const trackingInput    = document.getElementById('shipment-tracking-number');
  const bolInput         = document.getElementById('shipment-bol-number');
  const storageRoomInput = document.getElementById('shipment-storage-room');
  const storageDetInput  = document.getElementById('shipment-storage-details');
  const storageDueInput  = document.getElementById('shipment-storage-due-date');
  const storageDailyInput= document.getElementById('shipment-storage-daily-fee');

  // Payments + pickup
  const pickedUpByInput   = document.getElementById('shipment-picked-up-by');
  const pickedUpDateInput = document.getElementById('shipment-picked-up-date');
  const vendorPaidChk     = document.getElementById('shipment-vendor-paid');
  const vendorPaidAmt     = document.getElementById('shipment-vendor-paid-amount');
  const shipperPaidChk    = document.getElementById('shipment-shipper-paid');
  const shipperPaidAmt    = document.getElementById('shipment-shipper-paid-amount');
  const customsPaidChk    = document.getElementById('shipment-customs-paid');
  const customsPaidAmt    = document.getElementById('shipment-customs-paid-amount');
  const verifyAllChk      = document.getElementById('shipment-verify-all');
  const verifiedByInput   = document.getElementById('shipment-verified-by');
  const verificationNotesArea = document.getElementById('shipment-verification-notes');

  // Fill basics
  if (titleInput) titleInput.value = shipment.title || '';
  if (poInput)    poInput.value    = shipment.po_number || '';
  if (destInput)  destInput.value  = shipment.destination || '';
  if (projectSelect) {
    projectSelect.value =
      shipment.project_id != null ? String(shipment.project_id) : '';
  }

  // Vendor
  if (vendorSelect) {
    if (shipment.vendor_id != null) {
      vendorSelect.value = String(shipment.vendor_id);
    } else if (shipment.vendor_name) {
      const match = Array.from(vendorSelect.options).find(
        opt => opt.textContent.trim() === shipment.vendor_name.trim()
      );
      vendorSelect.value = match ? match.value : '';
    } else {
      vendorSelect.value = '';
    }
  }

  // Vendor apply-all: restore checkbox state from items (all match header)
  const vendorApplyAll = document.getElementById('shipment-vendor-apply-all');
  if (vendorApplyAll) {
    const headerVendorText =
      vendorSelect && vendorSelect.selectedIndex > 0
        ? vendorSelect.options[vendorSelect.selectedIndex].textContent.trim()
        : shipment.vendor_name || '';
    syncVendorApplyAllFromItems(headerVendorText, items);
  }

  // Status + verification lock handler
  if (statusSelect) {
    if (shipment.status) statusSelect.value = shipment.status;
    applyStatusColorToSelect(statusSelect);
    toggleShipmentVerificationSection(statusSelect.value);

    statusSelect.onchange = () => {
      applyStatusColorToSelect(statusSelect);
      toggleShipmentVerificationSection(statusSelect.value);
      applyItemVerificationLockForStatus(statusSelect.value);
    };
  }

  if (skuInput)         skuInput.value         = shipment.sku || '';
  if (forwarderSelect)  forwarderSelect.value  = shipment.freight_forwarder || '';
  if (websiteInput)     websiteInput.value     = shipment.website_url || '';
  if (notesInput)       notesInput.value       = shipment.notes || '';
  if (expShipInput)     expShipInput.value     = shipment.expected_ship_date || '';
  if (expArriveInput)   expArriveInput.value   = shipment.expected_arrival_date || '';
  if (trackingInput)    trackingInput.value    = shipment.tracking_number || '';
  if (bolInput)         bolInput.value         = shipment.bol_number || '';
  if (storageRoomInput) storageRoomInput.value = shipment.storage_room || '';
  if (storageDetInput)  storageDetInput.value  = shipment.storage_details || '';
  if (storageDueInput)  storageDueInput.value  = shipment.storage_due_date || '';
  if (storageDailyInput)
    storageDailyInput.value =
      shipment.storage_daily_late_fee != null
        ? Number(shipment.storage_daily_late_fee).toFixed(2)
        : '';

  // Post-pickup + payments
  if (pickedUpByInput)   pickedUpByInput.value   = shipment.picked_up_by || '';
  if (pickedUpDateInput) pickedUpDateInput.value = shipment.picked_up_date || '';
  if (vendorPaidChk) vendorPaidChk.checked = !!shipment.vendor_paid;
if (vendorPaidAmt)
  vendorPaidAmt.value =
    shipment.vendor_paid_amount != null
      ? Number(shipment.vendor_paid_amount).toFixed(2)
      : '';

  if (shipperPaidChk) shipperPaidChk.checked = !!shipment.shipper_paid;
if (shipperPaidAmt)
  shipperPaidAmt.value =
    shipment.shipper_paid_amount != null
      ? Number(shipment.shipper_paid_amount).toFixed(2)
      : '';
  if (customsPaidChk) customsPaidChk.checked = !!shipment.customs_paid;
if (customsPaidAmt)
  customsPaidAmt.value =
    shipment.customs_paid_amount != null
      ? Number(shipment.customs_paid_amount).toFixed(2)
      : '';

  updateStorageFeeEstimate();

  // Verification header fields
  if (verifyAllChk) verifyAllChk.checked = !!shipment.items_verified;
  if (verifiedByInput) verifiedByInput.value = '';
  if (verificationNotesArea) verificationNotesArea.value = shipment.verification_notes || '';

  // --- Build item rows from DB ---
  const rowsContainer = document.getElementById('shipment-items-rows');
  if (rowsContainer) {
    rowsContainer.innerHTML = '';

    if (Array.isArray(items) && items.length > 0) {
  items.forEach(it => {
    addShipmentItemRow({
      description: it.description,
      sku: it.sku,
      quantity: it.quantity,
      unit_price: it.unit_price != null ? Number(it.unit_price) : '',
      vendor_name: it.vendor_name || '',
      verification: it.verification || {
        status: it.verified ? 'verified' : '',
        notes: it.notes || null
      }
    });
  });
} else {
  addShipmentItemRow();
}
  }

  // Sync apply-all checkbox based on existing items/vendors
  if (vendorSelect) {
    const headerVendorText =
      vendorSelect.selectedIndex > 0
        ? vendorSelect.options[vendorSelect.selectedIndex].textContent.trim()
        : '';
    syncVendorApplyAllFromItems(headerVendorText, items);
  }

  // Totals & checkbox sync
  recalcShipmentItemsTotal();
  syncVerifyAllCheckboxState();

  // Apply verification lock AFTER rows exist
  applyItemVerificationLockForStatus(
    shipment.status || (statusSelect && statusSelect.value) || ''
  );

  updateShipmentTotalPaid();
  initShipmentVerificationControls();

  if (typeof updateShipmentTrackingHelper === 'function') {
    updateShipmentTrackingHelper();
  }

  if (shipment.id && typeof loadShipmentDocuments === 'function') {
    loadShipmentDocuments(shipment.id);
  }

  if (backdrop) backdrop.classList.remove('hidden');
  if (modal)    modal.classList.remove('hidden');
}


function closeShipmentCreateModal() {
  const modal    = document.getElementById('shipment-create-modal');
  const backdrop = document.getElementById('shipment-create-backdrop');
  if (modal) modal.classList.add('hidden');
  if (backdrop) backdrop.classList.add('hidden');

  // 🔓 Re-enable shipments search and keep it blank
  const shipmentsSearch = document.getElementById('shipments-search');
  if (shipmentsSearch) {
    shipmentsSearch.removeAttribute('disabled');
    shipmentsSearch.value = '';
  }
}



async function uploadShipmentDocuments(shipmentId) {
  const input = document.getElementById('shipment-documents');
  const docTypeSel = document.getElementById('shipment-doc-type');
  const docLabelInput = document.getElementById('shipment-doc-label');
  if (!input || !input.files || !input.files.length) return;

  const docType = docTypeSel?.value || '';
  const docLabel = (docLabelInput?.value || '').trim();

  const formData = new FormData();
  if (docType) formData.append('doc_type', docType);
  if (docLabel) formData.append('doc_label', docLabel);

  // The field name 'documents' must match the `name` and the multer config
  for (const file of input.files) {
    formData.append('documents', file);
  }

  try {
    await fetch(`/api/shipments/${encodeURIComponent(shipmentId)}/documents`, {
      method: 'POST',
      body: formData
      // No Content-Type header on purpose – browser sets multipart boundary
    });
  } catch (err) {
    console.error('Error uploading shipment documents:', err);
  }
}

async function uploadShipmentDocumentsFromModal() {
  const idInput = document.getElementById('shipment-id');
  const msgEl   = document.getElementById('shipment-create-status');
  const docTypeSel = document.getElementById('shipment-doc-type');
  const docLabelInput = document.getElementById('shipment-doc-label');
  const docLabelWrapper = document.getElementById('shipment-doc-label-wrapper');
  const shipmentId = idInput?.value;

  if (!shipmentId) {
    if (msgEl) {
      msgEl.textContent = 'Save the shipment first, then upload documents.';
      msgEl.style.color = 'crimson';
    } else {
      alert('Save the shipment first, then upload documents.');
    }
    return;
  }

  const docType = docTypeSel?.value || '';
  const docLabel = (docLabelInput?.value || '').trim();

  if (!docType) {
    if (msgEl) {
      msgEl.textContent = 'Select a document type before uploading.';
      msgEl.style.color = 'crimson';
    }
    return;
  }

  if (docType === 'Other' && !docLabel) {
    if (msgEl) {
      msgEl.textContent = 'Enter a label for “Other” document type.';
      msgEl.style.color = 'crimson';
    }
    return;
  }

  try {
    if (msgEl) {
      msgEl.textContent = 'Uploading documents...';
      msgEl.style.color = 'black';
    }

    await uploadShipmentDocuments(shipmentId);

    // Refresh the list so new files appear immediately
    if (typeof loadShipmentDocuments === 'function') {
      await loadShipmentDocuments(shipmentId);
    }

    const docsInput = document.getElementById('shipment-documents');
    if (docsInput) docsInput.value = '';
    if (docTypeSel) docTypeSel.value = '';
    if (docLabelInput) {
      docLabelInput.value = '';
      docLabelInput.disabled = true;
    }
    if (docLabelWrapper) {
      docLabelWrapper.hidden = true;
    }

    if (msgEl) {
      msgEl.textContent = 'Documents uploaded.';
      msgEl.style.color = 'green';
    }
  } catch (err) {
    if (msgEl) {
      msgEl.textContent = 'Error uploading documents: ' + err.message;
      msgEl.style.color = 'red';
    }
  }
}

function renderShipmentsBoard() {
  const boardEl = document.getElementById('shipments-board');
  if (!boardEl) return;

  const { statuses, shipmentsByStatus } = shipmentsBoardData;
  boardEl.innerHTML = '';

  // 🔹 FILTERED MODE: a single status is selected
  if (currentStatusFilter) {
    boardEl.classList.add('shipments-board--single');

    const list = shipmentsByStatus[currentStatusFilter] || [];

    if (!list.length) {
      boardEl.innerHTML = `<div class="empty-state">No shipments with status "${currentStatusFilter}".</div>`;
      return;
    }

    // Cards are direct children of #shipments-board
    list.forEach(sh => {
      const card = document.createElement('div');
      // add status-* class so CSS colors border + header
      // 🔹 use the shipment's own status first, fall back to the filter
      const className = shipmentStatusClass(sh.status || currentStatusFilter);
      card.className = `shipment-card ${className}`;

      card.draggable = true;
      card.dataset.id = sh.id;
      card.dataset.status = currentStatusFilter;

      const projLabel = sh.customer_name
        ? `${sh.customer_name} – ${sh.project_name || ''}`
        : (sh.project_name || '');

      const rawEta = sh.expected_arrival_date;
      const eta = rawEta ? formatDateUS(rawEta) : '';

card.innerHTML = `
  <div class="shipment-card-header">
    ${sh.title || '(no title)'}
  </div>
  <div class="shipment-card-body">
   <div><strong>BOL #:</strong> ${sh.bol_number || '—'}</div>
   <div><strong>Project:</strong> ${projLabel || '—'}</div>
    <div><strong>Vendor:</strong> ${sh.vendor_name || '—'}</div>
    
   
  </div>
`;

      card.addEventListener('click', async () => {
  try {
    const data = await fetchJSON(`/api/shipments/${sh.id}`);
    if (data && data.shipment) {
      openShipmentEditModal(data.shipment, data.items || []);
    }
  } catch (err) {
    alert('Error loading shipment: ' + err.message);
  }
});

      card.addEventListener('dragstart', onShipmentDragStart);
      card.addEventListener('dragend', onShipmentDragEnd);

      boardEl.appendChild(card);
    });

    return; // ✅ done in filtered mode
  }

  // 🔹 KANBAN MODE: no status filter → show all columns
  boardEl.classList.remove('shipments-board--single');

  statuses.forEach(status => {
    const col = document.createElement('div');
    col.className = 'shipments-column ' + shipmentStatusClass(status);
    col.dataset.status = status;

    const list = shipmentsByStatus[status] || [];

    col.innerHTML = `
      <div class="shipments-column-header">
        <div class="shipments-column-title">${status}</div>
        <div class="shipments-column-count">${list.length}</div>
      </div>
      <div class="shipments-column-body"></div>
    `;

    const body = col.querySelector('.shipments-column-body');

    col.addEventListener('dragover', (evt) => {
      evt.preventDefault();
      if (evt.dataTransfer) {
        evt.dataTransfer.dropEffect = 'move';
      }
    });

    col.addEventListener('drop', (evt) => {
      const newStatus = col.dataset.status;
      onShipmentDrop(evt, newStatus);
    });

    list.forEach(sh => {
      const card = document.createElement('div');
      // again, add status-* class for color
      card.className = `shipment-card ${shipmentStatusClass(status)}`;
      card.draggable = true;
      card.dataset.id = sh.id;
      card.dataset.status = status;

      const projLabel = sh.customer_name
        ? `${sh.customer_name} – ${sh.project_name || ''}`
        : (sh.project_name || '');

      const rawEta = sh.expected_arrival_date;
      const eta = rawEta ? formatDateUS(rawEta) : '';

card.innerHTML = `
  <div class="shipment-card-header">
    ${sh.title || '(no title)'}
  </div>
  <div class="shipment-card-body">
  <div><strong>BOL #:</strong> ${sh.bol_number || '—'}</div>
  <div><strong>Project:</strong> ${projLabel || '—'}</div>
    <div><strong>Vendor:</strong> ${sh.vendor_name || '—'}</div>
    
    
  </div>
`;

      card.addEventListener('click', async () => {
        try {
          const data = await fetchJSON(`/api/shipments/${sh.id}`);
          if (data && data.shipment) {
            openShipmentEditModal(data.shipment, data.items || []);
          }
        } catch (err) {
          alert('Error loading shipment: ' + err.message);
        }
      });

      card.addEventListener('dragstart', onShipmentDragStart);
      card.addEventListener('dragend', onShipmentDragEnd);

      body.appendChild(card);
    });

    boardEl.appendChild(col);
  });
}

function shipmentStatusClass(status) {
  if (!status) return '';

  const raw = String(status).toLowerCase().trim();
  const contains = (s) => raw.includes(s);

  // Examples based on your likely statuses:
  // "Pre-Order"
  if (contains('pre-order') || raw === 'preorder') {
    return 'status-preorder';
  }

  // "Ordered"
  if (raw === 'ordered') {
    return 'status-ordered';
  }

  // "In Transit to Forwarder"
  if (contains('in transit') || contains('transit')) {
    return 'status-transit';
  }

  // "Arrived at Forwarder"
  if (contains('forwarder')) {
    return 'status-forwarder';
  }

  // "Sailed"
  if (contains('sailed') || contains('on water')) {
    return 'status-sailed';
  }

  // "Arrived at Port", "Arrived on Island"
  if (contains('arrived at port') || (contains('arrived') && !contains('forwarder'))) {
    return 'status-arrived';
  }

  // "Awaiting Clearance", "Customs Clearance"
  if (contains('awaiting clearance') || contains('customs') || contains('clearance')) {
    return 'status-clearance';
  }

  // "Cleared - Ready for Release", "Ready for Pickup"
  if (contains('ready') && (contains('release') || contains('pickup'))) {
    return 'status-ready';
  }

  // "Picked Up"
  if (contains('picked') && contains('up')) {
    return 'status-pickedup';
  }

  // "Archived"
  if (contains('archived') || contains('closed')) {
    return 'status-archived';
  }

  return '';
}

function applyStatusColorToSelect(selectEl) {
  if (!selectEl) return;

  // remove any old status-* classes
  selectEl.classList.remove(
    'status-preorder',
    'status-ordered',
    'status-transit',
    'status-forwarder',
    'status-sailed',
    'status-arrived',
    'status-clearance',
    'status-ready',
    'status-pickedup',
    'status-archived'
  );

  const cls = shipmentStatusClass(selectEl.value);
  if (cls) {
    selectEl.classList.add(cls);
  }
}

function onShipmentDragStart(evt) {
  const id = evt.currentTarget.dataset.id;
  draggingShipmentId = id;
  evt.dataTransfer.effectAllowed = 'move';
}

function onShipmentDragEnd() {
  draggingShipmentId = null;
}

async function onShipmentDrop(evt, newStatus) {
  evt.preventDefault();
  if (!draggingShipmentId) return;

  try {
    await fetchJSON(`/api/shipments/${draggingShipmentId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        new_status: newStatus
        // you could also send a note here
      })
    });

    await loadShipmentsBoard();
  } catch (err) {
    alert('Error updating status: ' + err.message);
  }
}

function initVerifierTooltip() {
  // Create one floating tooltip div for the whole app
  let tooltip = document.getElementById('verifier-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'verifier-tooltip';
    tooltip.className = 'verifier-tooltip';
    tooltip.style.display = 'none';
    document.body.appendChild(tooltip);
  }

  // Show on hover
  document.addEventListener('mouseover', (evt) => {
    const tag = evt.target.closest('.shipment-item-verifier-tag.has-initials');
    if (!tag) return;

    const text = tag.dataset.fullLabel || '';
    if (!text) return;

    tooltip.textContent = text;
    tooltip.style.display = 'block';

    const rect = tag.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    // position just above/right of initials
    tooltip.style.left = (rect.left + scrollX) + 'px';
    tooltip.style.top  = (rect.top + scrollY - tooltip.offsetHeight - 6) + 'px';
  });

  // Hide as soon as you leave the initials
  document.addEventListener('mouseout', (evt) => {
    const tag = evt.target.closest('.shipment-item-verifier-tag.has-initials');
    if (!tag) return;
    tooltip.style.display = 'none';
  });
}


function setupShipmentsUI() {
  const search = document.getElementById('shipments-search');
  if (search) {
    // Hard-disable autofill as much as possible at runtime too
    search.setAttribute('autocomplete', 'off');
    search.setAttribute('autocorrect', 'off');
    search.setAttribute('autocapitalize', 'off');
    search.setAttribute('spellcheck', 'false');
    // Unique-ish name to prevent browser remembering previous value
    search.setAttribute('name', `shipments-search-${Date.now()}`);
    // Clear any prefill the browser might have applied on load
    search.value = '';
    search.dataset.userCleared = 'false';

    search.addEventListener('focus', () => {
      // If browser auto-filled before focus, wipe it once
      if (search.dataset.userCleared === 'false' && search.value) {
        search.value = '';
        search.dataset.userCleared = 'true';
      }
    });

    search.addEventListener('input', () => {
      // If the shipment modal is open, ignore any “mystery” input (autofill)
      const backdrop = document.getElementById('shipment-create-backdrop');
      const modalOpen =
        backdrop && !backdrop.classList.contains('hidden');

      if (modalOpen) {
        // Ignore autofill while editing a shipment
        return;
      }

      loadShipmentsBoard();
    });
  }

  // Project + vendor filters (top of board)
  ['shipments-filter-project', 'shipments-filter-vendor']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => loadShipmentsBoard());
    });

  // Notification UI wiring
  renderNotificationStatusCheckboxes(
    (shipmentsBoardData.statuses && shipmentsBoardData.statuses.length)
      ? shipmentsBoardData.statuses
      : Object.keys(SHIPMENT_STATUS_ICONS)
  );

  const notifyToggle = document.getElementById('shipment-notify-enabled');
  if (notifyToggle) {
    notifyToggle.addEventListener('change', () => {
      shipmentNotificationPref.enabled = notifyToggle.checked;
      maybeStartShipmentNotificationTimer(true);
    });
  }

  const notifyTime = document.getElementById('shipment-notify-time');
  if (notifyTime) {
    notifyTime.addEventListener('change', () => {
      shipmentNotificationPref.notify_time = notifyTime.value || '';
    });
  }

  const notifySaveBtn = document.getElementById('shipment-notify-save');
  if (notifySaveBtn) {
    notifySaveBtn.addEventListener('click', () => {
      saveShipmentNotificationPrefs();
    });
  }

  const notifyTestBtn = document.getElementById('shipment-notify-test');
  if (notifyTestBtn) {
    notifyTestBtn.addEventListener('click', () => {
      triggerShipmentNotification(true);
    });
  }

  const notifyShipmentsSelect = document.getElementById('shipment-notify-shipments');
  if (notifyShipmentsSelect) {
    notifyShipmentsSelect.addEventListener('change', () => {
      const ids = Array.from(notifyShipmentsSelect.selectedOptions || [])
        .map(opt => Number(opt.value))
        .filter(n => Number.isFinite(n));
      shipmentNotificationPref.shipment_ids = ids;
    });
  }

  loadShipmentNotificationPrefs();

  // Custom status dropdown
  const statusBtn = document.getElementById('status-dropdown-btn');
  const statusMenu = document.getElementById('status-dropdown-menu');

  if (statusBtn && statusMenu) {
    statusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      statusMenu.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
      if (
        !statusMenu.contains(e.target) &&
        !statusBtn.contains(e.target)
      ) {
        statusMenu.classList.add('hidden');
      }
    });
  }

  // Tabs (Board / Analytics / Templates)
  const tabButtons = document.querySelectorAll('.shipments-tab');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view || 'board';
      tabButtons.forEach(b => b.classList.toggle('active', b === btn));
      document.getElementById('shipments-view-board')?.classList.toggle(
        'hidden',
        view !== 'board'
      );
      document.getElementById('shipments-view-analytics')?.classList.toggle(
        'hidden',
        view !== 'analytics'
      );
      document.getElementById('shipments-view-templates')?.classList.toggle(
        'hidden',
        view !== 'templates'
      );
    });
  });

  // 🔹 Docs upload button
  const docsBtn = document.getElementById('shipment-upload-docs-btn');
  if (docsBtn) {
    docsBtn.addEventListener('click', uploadShipmentDocumentsFromModal);
  }

  // 🔹 Document type → toggle custom label input
  const docTypeSel = document.getElementById('shipment-doc-type');
  const docLabelInput = document.getElementById('shipment-doc-label');
  const docLabelWrapper = document.getElementById('shipment-doc-label-wrapper');
  if (docTypeSel && docLabelInput) {
    docTypeSel.addEventListener('change', () => {
      const v = docTypeSel.value || '';
      const needsLabel = v === 'Other';
      docLabelInput.disabled = !needsLabel;
      if (docLabelWrapper) docLabelWrapper.hidden = !needsLabel;
      if (!needsLabel) {
        docLabelInput.value = '';
      }
    });
  }

  // 🔹 Header-level vendor → apply-to-all wiring
const headerVendorSelect   = document.getElementById('shipment-vendor');
const headerVendorApplyAll = document.getElementById('shipment-vendor-apply-all');

if (headerVendorSelect && headerVendorApplyAll) {
  // When "apply to all items" is toggled:
  headerVendorApplyAll.addEventListener('change', () => {
    const idx = headerVendorSelect.selectedIndex;
    const headerVendorText =
      idx > 0
        ? headerVendorSelect.options[idx].textContent.trim()
        : '';

    if (headerVendorApplyAll.checked) {
      // If there are existing vendor entries, ask before overwriting
      const rows = Array.from(document.querySelectorAll('.shipment-item-row'));
      const hasAnyVendor = rows.some(row => {
        const input = row.querySelector('.shipment-item-vendor');
        return input && input.value.trim();
      });

      if (hasAnyVendor && headerVendorText) {
        const ok = window.confirm(
          'Overwrite all item vendor fields with the selected vendor?'
        );
        if (!ok) {
          headerVendorApplyAll.checked = false;
          return;
        }
        setVendorOnAllItemRows(headerVendorText);
      } else {
        // No existing vendor entries → only fill blanks
        applyVendorToItemRowsIfNeeded();
      }
    } else {
      // OFF → clear vendor fields from item rows
      clearVendorFromItemRows();
    }
  });

  // Track last vendor selection to allow reverting if user cancels overwrite
  headerVendorSelect.dataset.prevValue = headerVendorSelect.value || '';
  headerVendorSelect.dataset.prevText =
    headerVendorSelect.selectedIndex > 0
      ? headerVendorSelect.options[headerVendorSelect.selectedIndex].textContent.trim()
      : '';

  // When header vendor changes:
  headerVendorSelect.addEventListener('change', () => {
    const idx = headerVendorSelect.selectedIndex;

    const prevValue = headerVendorSelect.dataset.prevValue || '';
    const prevText = headerVendorSelect.dataset.prevText || '';
    const newValue = headerVendorSelect.value || '';
    const newText =
      idx > 0
        ? headerVendorSelect.options[idx].textContent.trim()
        : '';

    if (idx <= 0) {
      // Vendor cleared → uncheck and clear all per-row vendors
      headerVendorApplyAll.checked = false;
      clearVendorFromItemRows();
      headerVendorSelect.dataset.prevValue = '';
      headerVendorSelect.dataset.prevText = '';
      return;
    }

    // If "use on all items" is on, ask before overwriting existing vendors
    if (headerVendorApplyAll.checked) {
      const rows = Array.from(document.querySelectorAll('.shipment-item-row'));
      const hasAnyVendor = rows.some(row => {
        const input = row.querySelector('.shipment-item-vendor');
        return input && input.value.trim();
      });

      if (hasAnyVendor) {
        const ok = window.confirm(
          'Overwrite all item vendor fields with the selected vendor?'
        );
        if (!ok) {
          // Revert selection
          headerVendorSelect.value = prevValue;
          return;
        }
        setVendorOnAllItemRows(newText);
      } else {
        applyVendorToItemRowsIfNeeded();
      }
    }

    // Store new selection as previous for future cancels
    headerVendorSelect.dataset.prevValue = newValue;
    headerVendorSelect.dataset.prevText = newText;
  });

  // Optional: on initial load, if checkbox is already checked, apply once
  if (headerVendorApplyAll.checked) {
    applyVendorToItemRowsIfNeeded();
  }
}


  // Payments + verification UI
  setupStorageLateFeeListeners();
  setupShipmentPaymentListeners();
  setupItemVerificationModal();
  initVerifierTooltip();
}



async function openShipmentDetail(id) {
  const backdrop = document.getElementById('shipment-detail-backdrop');
  const titleEl = document.getElementById('shipment-detail-title');
  const overviewEl = document.getElementById('ship-detail-overview');
  if (!backdrop || !overviewEl) return;

  overviewEl.innerHTML = 'Loading…';

try {
    const data = await fetchJSON(`/api/shipments/${id}`);
    const s = data.shipment;

    const trackingHtml = buildTrackingLink(
      s.tracking_number,
      s.freight_forwarder,
      s.website_url
    );

    const expectedShip = s.expected_ship_date
      ? formatDateUS(s.expected_ship_date)
      : '—';

    const expectedArrival = s.expected_arrival_date
      ? formatDateUS(s.expected_arrival_date)
      : '—';


    if (titleEl) {
      titleEl.textContent = `${s.title || 'Shipment'} · ${s.status}`;
    }

    overviewEl.innerHTML = `
      <div class="form-grid">
        <div class="form-field">
          <label>Vendor</label>
          <div>${s.vendor_name || '—'}</div>
        </div>
        <div class="form-field">
          <label>Forwarder</label>
          <div>${s.freight_forwarder || '—'}</div>
        </div>
        <div class="form-field">
          <label>Destination</label>
          <div>${s.destination || '—'}</div>
        </div>
        <div class="form-field">
          <label>Project</label>
          <div>${s.customer_name ? (s.customer_name + ' – ') : ''}${s.project_name || ''}</div>
        </div>
                <div class="form-field">
          <label>Tracking #</label>
          <div>${trackingHtml}</div>
        </div>
        <div class="form-field">
          <label>BOL #</label>
          <div>${s.bol_number || '—'}</div>
        </div>
        <div class="form-field">
          <label>Expected ship</label>
          <div>${expectedShip}</div>
        </div>
        <div class="form-field">
          <label>Expected arrival</label>
          <div>${expectedArrival}</div>
        </div>

                <div class="form-field">
          <label>Storage</label>
          <div>${s.storage_room || '—'}<br>${s.storage_details || ''}</div>
        </div>
        <div class="form-field">
  <label>Verification</label>
  <div>
    ${s.items_verified ? '✅ All line items marked Verified' : '— (see line items)'}
  </div>
</div>

        <div class="form-field">
          <label>Website</label>
          <div>${s.website_url ? `<a href="${s.website_url}" target="_blank">${s.website_url}</a>` : '—'}</div>
        </div>

        <div class="form-field" style="grid-column:1 / -1;">
          <label>Notes</label>
          <div>${s.notes || '—'}</div>
        </div>
      </div>
    `;

    backdrop.classList.remove('hidden');
  } catch (err) {
    overviewEl.innerHTML = 'Error loading shipment: ' + err.message;
  }
}

function updateShipmentTrackingHelper() {
  const tnInput   = document.getElementById('shipment-tracking-number');
  const fwdSelect = document.getElementById('shipment-forwarder');
  const websiteEl = document.getElementById('shipment-website-url');
  const helper    = document.getElementById('shipment-tracking-helper');

  if (!tnInput || !helper) return;

  const tn  = tnInput.value || '';
  const fwd = fwdSelect ? fwdSelect.value : '';
  const url = websiteEl ? websiteEl.value : '';

  const linkHtml = buildTrackingLink(tn, fwd, url);

  if (!tn.trim() || linkHtml === '—') {
    helper.textContent = '';
  } else {
    const trackingUrl = buildTrackingLink(tn, fwd, url);

// trackingUrl contains <a>…TRACKINGNUMBER…</a>
// but we ONLY want the href value
const hrefMatch = trackingUrl.match(/href="([^"]+)"/);
const href = hrefMatch ? hrefMatch[1] : null;

if (href) {
  helper.innerHTML = `<a href="${href}" target="_blank" rel="noopener noreferrer">Track Shipment</a>`;
} else {
  helper.textContent = '';
}
  }
}

function buildTrackingLink(trackingNumber, forwarder, websiteUrl) {
  if (!trackingNumber) return '—';

  const tn = String(trackingNumber).trim();
  if (!tn) return '—';

  const fwd = (forwarder || '').toLowerCase();
  const url = (websiteUrl || '').toLowerCase();

  let carrier = '';

  // Detect from forwarder name / URL
  if (fwd.includes('ups') || url.includes('ups.com') || tn.toUpperCase().startsWith('1Z')) {
    carrier = 'ups';
  } else if (fwd.includes('fedex') || url.includes('fedex.com')) {
    carrier = 'fedex';
  } else if (fwd.includes('usps') || url.includes('usps.com') || /^[A-Z]{2}\d{9}US$/i.test(tn)) {
    carrier = 'usps';
  } else if (fwd.includes('dhl') || url.includes('dhl.com')) {
    carrier = 'dhl';
  } else if (fwd.includes('amazon') || url.includes('amazon.com')) {
    carrier = 'amazon';
  }

  let trackingUrl;

  switch (carrier) {
    case 'ups':
      trackingUrl = `https://www.ups.com/track?loc=en_US&tracknum=${encodeURIComponent(tn)}`;
      break;
    case 'fedex':
      trackingUrl = `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(tn)}`;
      break;
    case 'usps':
      trackingUrl = `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(tn)}`;
      break;
    case 'dhl':
      trackingUrl = `https://www.dhl.com/en/express/tracking.html?AWB=${encodeURIComponent(tn)}&brand=DHL`;
      break;
    case 'amazon':
      // Amazon is messy, so just search for it
      trackingUrl = `https://www.google.com/search?q=${encodeURIComponent('track ' + tn + ' amazon')}`;
      break;
    default:
      // Fallback: let the user’s browser open a Google search for "track <number>"
      trackingUrl = `https://www.google.com/search?q=${encodeURIComponent('track ' + tn)}`;
      break;
  }

  return `<a href="${trackingUrl}" target="_blank" rel="noopener noreferrer">${tn}</a>`;
}

function showDocsPlaceholder() {
  const section       = document.getElementById("shipment-docs-section");
  const placeholder   = document.getElementById("shipment-docs-placeholder");
  const uploadArea    = document.getElementById("shipment-docs-upload-area");
  const listContainer = document.getElementById("shipment-docs-list-container");

  if (section) section.classList.remove("hidden");

  if (placeholder)   placeholder.style.display = "block";
  if (uploadArea)    uploadArea.classList.add("hidden");
  if (listContainer) listContainer.classList.add("hidden");
}

function showDocsUI() {
  const section       = document.getElementById("shipment-docs-section");
  const placeholder   = document.getElementById("shipment-docs-placeholder");
  const uploadArea    = document.getElementById("shipment-docs-upload-area");
  const listContainer = document.getElementById("shipment-docs-list-container");

  if (section) section.classList.remove("hidden");

  if (placeholder)   placeholder.style.display = "none";
  if (uploadArea)    uploadArea.classList.remove("hidden");
  if (listContainer) listContainer.classList.remove("hidden");
}

function calculateStorageLateFees(dueDateStr, dailyFeeRaw) {
  const dailyFee = Number(dailyFeeRaw);
  if (!dueDateStr || Number.isNaN(dailyFee) || dailyFee < 0) {
    return { daysLate: 0, estimate: 0 };
  }

  const due = new Date(`${dueDateStr}T00:00:00`);
  if (Number.isNaN(due.getTime())) {
    return { daysLate: 0, estimate: 0 };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffDays = Math.floor((today - due) / 86400000);
  const daysLate = diffDays > 0 ? diffDays : 0;
  const estimate = daysLate > 0 ? dailyFee * daysLate : 0;

  return { daysLate, estimate };
}

function updateStorageFeeEstimate() {
  const dueInput = document.getElementById('shipment-storage-due-date');
  const feeInput = document.getElementById('shipment-storage-daily-fee');
  const estimateDisplay = document.getElementById('shipment-storage-fees-estimate');
  const helper = document.getElementById('shipment-storage-fees-helper');

  const dueDate = dueInput?.value || '';
  const dailyFeeRaw = feeInput?.value || '';
  const { daysLate, estimate } = calculateStorageLateFees(dueDate, dailyFeeRaw);

  if (estimateDisplay) {
    estimateDisplay.value = `$${estimate.toFixed(2)}`;
  }

  if (helper) {
    if (daysLate > 0) {
      helper.textContent = `${daysLate} day${daysLate === 1 ? '' : 's'} past due`;
      helper.style.display = 'block';
    } else {
      helper.textContent = '';
      helper.style.display = 'none';
    }
  }
}

function setupStorageLateFeeListeners() {
  const dueInput = document.getElementById('shipment-storage-due-date');

  if (dueInput) {
    dueInput.addEventListener('change', updateStorageFeeEstimate);
  }
}


function updateShipmentTotalPaid() {
  const vendorAmtEl  = document.getElementById('shipment-vendor-paid-amount');
  const shipperAmtEl = document.getElementById('shipment-shipper-paid-amount');
  const customsAmtEl = document.getElementById('shipment-customs-paid-amount');

  const displayEl = document.getElementById('shipment-total-paid-display'); // visible UI
  const hiddenEl  = document.getElementById('shipment-total-paid');         // hidden numeric

  const vendorAmt  = vendorAmtEl  ? parseFloat(vendorAmtEl.value)  || 0 : 0;
  const shipperAmt = shipperAmtEl ? parseFloat(shipperAmtEl.value) || 0 : 0;
  const customsAmt = customsAmtEl ? parseFloat(customsAmtEl.value) || 0 : 0;

  const total = vendorAmt + shipperAmt + customsAmt;

  // Pretty string in UI
  if (displayEl) {
    displayEl.value = `$${total.toFixed(2)}`;
  }

  // Clean numeric value used when saving
  if (hiddenEl) {
    hiddenEl.value = total ? total.toFixed(2) : '';
  }
}

function setupShipmentPaymentListeners() {
  [
    'shipment-vendor-paid-amount',
    'shipment-shipper-paid-amount',
    'shipment-customs-paid-amount'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      // live update total while typing
      el.addEventListener('input', updateShipmentTotalPaid);

      // normalize to 2 decimals when leaving field
      el.addEventListener('blur', () => {
        formatMoneyInput(el);
        updateShipmentTotalPaid();
      });
    }
  });
}


document.addEventListener('click', async (evt) => {
  const deleteBtn = evt.target.closest && evt.target.closest('#shipment-delete-btn');
  if (!deleteBtn) return;

  const idInput    = document.getElementById('shipment-id');
  const shipmentId = idInput && idInput.value ? idInput.value : null;
  const msgEl      = document.getElementById('shipment-create-status');

  if (!shipmentId) {
    if (msgEl) {
      msgEl.textContent = 'This shipment has not been saved yet.';
      msgEl.style.color = 'crimson';
    }
    return;
  }

  const ok = window.confirm('Delete (archive) this shipment?');
  if (!ok) return;

  try {
    await fetchJSON(`/api/shipments/${encodeURIComponent(shipmentId)}`, {
      method: 'DELETE'
    });

    if (msgEl) {
      msgEl.textContent = 'Shipment deleted.';
      msgEl.style.color = 'green';
    }

    closeShipmentCreateModal();
    await loadShipmentsBoard();
  } catch (err) {
    if (msgEl) {
      msgEl.textContent = 'Error deleting shipment: ' + err.message;
      msgEl.style.color = 'crimson';
    }
  }
});
