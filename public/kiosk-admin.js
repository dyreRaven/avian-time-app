// kiosk-admin.js
// Lightweight foreman dashboard for a single kiosk device.

let kaDeviceId = null;
let kaKiosk = null;
let kaProjects = [];
let kaEmployees = [];
let kaStartMode = false;
let kaStartEmployeeId = null;
let kaCurrentView = 'live';
let kaCurrentAdmin = null;  // whoever opened kiosk-admin (via employee_id)
let kaAdminValidated = false;
let kaSelectedAdminId = null;
let kaSessions = [];
let kaActiveSessionId = null;
let kaSessionFilterMode = 'active'; // active | today | yesterday | range
let kaSessionRangeStart = null;
let kaSessionRangeEnd = null;
let kaShipmentItemsDirty = new Map(); // shipment_item_id -> verification payload
let kaShipmentDetail = null;
let kaItemsModalShipmentId = null;
let kaItemsFilterUnverifiedFirst = true;
let kaItemsFilterTerm = '';
const kaItemAutoSaveTimers = new Map();
let kaTimeRangeMode = 'today';
let kaTimeActionEntry = null;
let kaTimeActionMode = null;
let kaAccessPerms = {
  see_shipments: true,
  modify_time: true,
  view_time_reports: true,
  view_payroll: true,
  modify_pay_rates: false
};
let kaShipments = [];
let kaShowPayUI = true;
let kaShowApprovalsUI = true;
let kaShowHideResolved = true;
let kaRatesUnlockedAll = false;
const kaUnlockedRates = new Set();
const KA_DEVICE_SECRET_KEY = 'avian_kiosk_device_secret_v1';
let kaNewSessionVisible = false;
let kaFirstActiveSetShown = false;

const KA_VIEWS = ['live', 'shipments', 'time', 'settings'];
const KA_PENDING_PIN_KEY = 'avian_kiosk_pending_pins_v1';
const KA_OFFLINE_QUEUE_KEY = 'avian_kiosk_offline_punches_v1';
const KA_VERIFY_QUEUE_KEY = 'avian_kiosk_verify_queue_v1';
const KA_SHIPMENTS_CACHE_KEY = 'avian_kiosk_shipments_cache_v1';
const KA_APP_TIMEZONE = 'America/Puerto_Rico';
const KA_SHIPMENT_STATUSES = [
  'Pre-Order',
  'Ordered',
  'In Transit to Forwarder',
  'Arrived at Forwarder',
  'Sailed',
  'Arrived at Port',
  'Awaiting Clearance',
  'Cleared - Ready for Release',
  'Picked Up',
  'Archived'
];
const KA_NOTIFY_DEFAULT = {
  enabled: false,
  statuses: ['Cleared - Ready for Release'],
  project_ids: [],
  remind_every_days: 1,
  remind_time: '09:00'
};
let kaNotifyPref = { ...KA_NOTIFY_DEFAULT };
let kaNotifyTimer = null;
let kaNotifyLastKey = '';
let kaNotifiedShipments = new Set();
let kaReminderTimestamps = {};
let kaStatusLockUntil = 0;
let kaAdminOpenPunch = null;
let kaClockInPromptActive = false;
let kaLiveRefreshTimer = null;
let kaLiveRefreshInFlight = false;
let kaSessionRefreshInFlight = false;
let kaLiveProjectOverride = null;
let kaDialogsOverridden = false;


// --- Small helpers ---

function kaShowStatusMessage(message, variant = 'ok', lockMs = 0) {
  const el = document.getElementById('ka-kiosk-status');
  if (!el) return;
  el.textContent = message || '';
  let cls = 'ka-status';
  if (variant === 'ok') cls += ' ka-status-ok';
  if (variant === 'error') cls += ' ka-status-error';
  el.className = cls;
  if (lockMs && Number(lockMs) > 0) {
    kaStatusLockUntil = Date.now() + Number(lockMs);
  }
}

function kaShowInlineAlert(message, variant = 'error', lockMs = 8000) {
  kaShowStatusMessage(message, variant, lockMs);
}

function kaOverrideNativeDialogs() {
  if (kaDialogsOverridden) return;
  kaDialogsOverridden = true;
  const safeAlert = (msg) => {
    const text = msg === undefined || msg === null ? '' : String(msg);
    kaShowInlineAlert(text || 'Notice', 'error', 8000);
  };
  try {
    window.alert = safeAlert;
  } catch {
    // ignore override failures
  }
}
kaOverrideNativeDialogs();

async function fetchJSON(url, options = {}) {
  const opts = Object.assign({ credentials: 'include' }, options);
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.message || 'Request failed');
    err.status = res.status;
    err.statusText = res.statusText;
    throw err;
  }
  return data;
}

function kaClearStatusIfUnlocked() {
  if (Date.now() < kaStatusLockUntil) return;
  const el = document.getElementById('ka-kiosk-status');
  if (!el) return;
  el.textContent = '';
  el.className = 'ka-status';
}

function kaEnsureConfirmModal() {
  let backdrop = document.getElementById('ka-confirm-backdrop');
  if (backdrop) return backdrop;

  backdrop = document.createElement('div');
  backdrop.id = 'ka-confirm-backdrop';
  backdrop.className = 'ka-modal-backdrop hidden';
  backdrop.innerHTML = `
    <div class="ka-modal" role="dialog" aria-modal="true">
      <h3 id="ka-confirm-title">Confirm</h3>
      <p id="ka-confirm-message"></p>
      <div class="ka-modal-actions">
        <button type="button" class="btn secondary btn-sm" id="ka-confirm-cancel">Cancel</button>
        <button type="button" class="btn primary btn-sm" id="ka-confirm-yes">Yes</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  return backdrop;
}

function kaShowConfirmDialog(message, { okLabel = 'Yes', cancelLabel = 'Cancel', title = 'Confirm' } = {}) {
  const backdrop = kaEnsureConfirmModal();
  const msgEl = document.getElementById('ka-confirm-message');
  const titleEl = document.getElementById('ka-confirm-title');
  const yesBtn = document.getElementById('ka-confirm-yes');
  const cancelBtn = document.getElementById('ka-confirm-cancel');

  if (!backdrop || !msgEl || !yesBtn || !cancelBtn || !titleEl) {
    return Promise.resolve(window.confirm ? window.confirm(message) : true);
  }

  msgEl.textContent = message || '';
  titleEl.textContent = title || 'Confirm';
  yesBtn.textContent = okLabel || 'Yes';
  cancelBtn.textContent = cancelLabel || 'Cancel';
  backdrop.classList.remove('hidden');

  return new Promise(resolve => {
    const cleanup = (result) => {
      backdrop.classList.add('hidden');
      yesBtn.onclick = null;
      cancelBtn.onclick = null;
      backdrop.onclick = null;
      resolve(result);
    };

    yesBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
    backdrop.onclick = (e) => {
      if (e.target === backdrop) cleanup(false);
    };
  });
}

function kaCurrentLiveProjectId() {
  const overridePid = Number(kaLiveProjectOverride);
  if (Number.isFinite(overridePid)) return overridePid;

  const activeSession = kaComputeActiveSession(kaSessions || []);
  if (activeSession && activeSession.project_id !== undefined && activeSession.project_id !== null) {
    const pid = Number(activeSession.project_id);
    if (Number.isFinite(pid)) return pid;
  }

  if (kaKiosk && kaKiosk.project_id !== undefined && kaKiosk.project_id !== null) {
    const pid = Number(kaKiosk.project_id);
    if (Number.isFinite(pid)) return pid;
  }

  return null;
}

async function kaRefreshLiveData() {
  if (kaLiveRefreshInFlight) return;
  kaLiveRefreshInFlight = true;
  try {
    await Promise.all([kaLoadLiveWorkers(), kaLoadTimeEntries()]);
  } catch (err) {
    console.warn('Live refresh failed', err);
  } finally {
    kaLiveRefreshInFlight = false;
  }
}

function kaStartLiveRefresh() {
  if (kaLiveRefreshTimer) clearInterval(kaLiveRefreshTimer);
  // Kick off an immediate refresh so counts update right away
  kaRefreshLiveData();
  kaLiveRefreshTimer = setInterval(() => {
    kaRefreshLiveData();
  }, 15000);
}

function kaStopLiveRefresh() {
  if (kaLiveRefreshTimer) {
    clearInterval(kaLiveRefreshTimer);
    kaLiveRefreshTimer = null;
  }
}

async function kaRefreshSessionsAndLive() {
  if (kaSessionRefreshInFlight) return;
  kaSessionRefreshInFlight = true;
  try {
    await kaLoadSessions();
  } catch (err) {
    console.warn('Session refresh failed', err);
  } finally {
    kaSessionRefreshInFlight = false;
  }
}

async function kaRefreshAdminPunchStatus() {
  if (!kaCurrentAdmin || !kaCurrentAdmin.id) {
    kaAdminOpenPunch = null;
    return;
  }
  try {
    kaAdminOpenPunch = await fetchJSON(
      `/api/kiosk/open-punch?employee_id=${kaCurrentAdmin.id}`
    );
  } catch (err) {
    console.warn('Unable to refresh admin punch status', err);
    kaAdminOpenPunch = null;
  }
}

async function kaEnsureAdminClockInPrompt(preferProjectId = null) {
  if (kaClockInPromptActive) return;
  if (!kaCurrentAdmin || !kaCurrentAdmin.id) return;
  await kaRefreshAdminPunchStatus();
  if (kaAdminOpenPunch && kaAdminOpenPunch.open) return;

  const projectOptions = kaTodaySessionProjects();
  if (!projectOptions.length) return;

  const adminId = Number(kaCurrentAdmin.id);
  const adminName = (kaCurrentAdmin && (kaCurrentAdmin.nickname || kaCurrentAdmin.name)) || 'you';
  const projectId =
    preferProjectId ||
    (kaKiosk && kaKiosk.project_id) ||
    projectOptions[0].project_id;

  kaClockInPromptActive = true;
  const modalResult = await kaShowClockInModal({
    projectId,
    adminName,
    projectOptions
  });

  const showBanner = () => {
    kaShowClockInPrompt({
      projectId,
      adminId,
      adminName,
      message: `${adminName} is not clocked in. Clock in to a timesheet for today?`,
      projectOptions
    });
  };

  if (modalResult.action === 'yes') {
    const targetProjectId = modalResult.projectId || projectId;
    try {
      await fetchJSON('/api/kiosk/punch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: 'startday-' + Date.now().toString(36),
          employee_id: adminId,
          project_id: targetProjectId,
          lat: null,
          lng: null,
          device_timestamp: new Date().toISOString(),
          photo_base64: null,
          device_id: kaDeviceId
        })
      });
      await kaRefreshAdminPunchStatus();
      await kaRefreshSessionsAndLive();
      kaShowStatusMessage(
        'Timesheet set and you are clocked in on this project. You should now appear under Current Workers.',
        'ok',
        10000
      );
    } catch (err) {
      console.error('Error clocking admin in:', err);
      kaShowStatusMessage(
        'Timesheet set, but clock-in for admin failed. Please try clocking in manually.',
        'error',
        8000
      );
      showBanner();
    }
  } else {
    // Skip or dismiss → show banner reminder
    showBanner();
  }

  kaClockInPromptActive = false;
}

function kaMarkDayStarted() {
  const key = kaKioskDayKey();
  if (!key) return;
  try {
    localStorage.setItem(key, '1');
  } catch {}
}

function isKioskDayStarted() {
  const key = kaKioskDayKey();
  if (!key) return false;
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function kaKioskDayKey() {
  if (!kaDeviceId) return null;
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `avian_kiosk_day_started_${kaDeviceId}_${y}-${m}-${d}`;
}

function kaReadPendingPins() {
  try {
    const raw = localStorage.getItem(KA_PENDING_PIN_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function kaWritePendingPins(list) {
  try {
    localStorage.setItem(KA_PENDING_PIN_KEY, JSON.stringify(list || []));
  } catch {}
}

function kaTodaySessionProjects() {
  const today = kaTodayIso();
  const map = new Map();
  (kaSessions || []).forEach(s => {
    if ((s.date || '').slice(0, 10) === today && s.project_id) {
      const key = Number(s.project_id);
      if (!map.has(key)) {
        const label =
          kaProjectLabelById(s.project_id) ||
          s.project_name ||
          `Project ${s.project_id}`;
        map.set(key, { project_id: key, label });
      }
    }
  });
  return Array.from(map.values());
}

function kaAddPendingPinUpdate(update) {
  const list = kaReadPendingPins();
  list.push({
    employee_id: update.employee_id,
    pin: update.pin,
    device_id: update.device_id || kaDeviceId || null,
    device_secret: update.device_secret || kaGetDeviceSecret(),
    queued_at: new Date().toISOString()
  });
  kaWritePendingPins(list);
}

async function kaSyncPendingPins() {
  // Only attempt when online
  if (!navigator.onLine) return;
  const list = kaReadPendingPins();
  if (!list.length) return;

  const remaining = [];
  for (const item of list) {
    try {
      await fetchJSON(`/api/employees/${item.employee_id}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin: item.pin,
          allowOverride: true,
          device_id: item.device_id || kaDeviceId || null,
          device_secret: item.device_secret || kaGetDeviceSecret()
        })
      });
      const emp = (kaEmployees || []).find(e => Number(e.id) === Number(item.employee_id));
      if (emp) emp.pin = item.pin;
    } catch (err) {
      const msg = (err && err.message) ? err.message : '';
      const authLike = /auth|login|credential|session/i.test(msg);
      const netLike = /network|failed to fetch|offline/i.test(msg);
      // If auth or network error, keep the rest and stop trying for now
      remaining.push(item);
      if (authLike || netLike) break;
    }
  }

  kaWritePendingPins(remaining);
}

// Require a PIN check when opening kiosk-admin directly (prevents URL spoofing)
async function kaRequireAdminUnlock() {
  if (!kaCurrentAdmin || !kaCurrentAdmin.is_admin) return false;

  // Remember successful unlock for this admin in this tab so refreshes don’t prompt again
  const unlockKey = `ka_admin_unlocked_${kaCurrentAdmin.id || 'unknown'}`;
  try {
    if (sessionStorage.getItem(unlockKey) === '1') {
      kaAdminValidated = true;
      return true;
    }
  } catch (e) {
    // sessionStorage may be blocked; ignore and fall bacsamek to prompt
  }

  if (kaAdminValidated) return true;

  // If kiosk passed skip_pin=1 (we already validated PIN on kiosk), honor it
  const url = new URL(window.location.href);
  if (url.searchParams.get('skip_pin') === '1') {
    kaAdminValidated = true;
    try {
      sessionStorage.setItem(unlockKey, '1');
    } catch (e) {}
    return true;
  }

  const pin = (kaCurrentAdmin.pin || '').trim();
  if (!pin) {
    alert('This admin does not have a PIN set. Please unlock from the kiosk.');
    return false;
  }

  for (let i = 0; i < 3; i++) {
    const entered = window.prompt('Enter your admin PIN to unlock kiosk admin:');
    if (entered === null) break; // cancel
    if (entered.trim() === pin) {
      kaAdminValidated = true;
      try {
        sessionStorage.setItem(unlockKey, '1');
      } catch (e) {
        // ignore storage failures
      }
      return true;
    }
    alert('Incorrect PIN. Try again.');
  }

  alert('Admin PIN is required to use kiosk admin. Returning to kiosk.');
  window.location.href = '/kiosk';
  return false;
}

function kaToggleShipmentCard(card, shipmentId) {
  const detailEl = card.querySelector('.ka-ship-card-detail');
  if (!detailEl) return;

  const isOpen = card.classList.contains('open');

  if (isOpen) {
    // collapse
    const currentHeight = detailEl.scrollHeight;
    detailEl.style.maxHeight = currentHeight + 'px'; // set current height
    // force reflow to ensure the transition picks up
    void detailEl.offsetHeight;
    detailEl.style.maxHeight = '0px';
    detailEl.style.opacity = '0';
    card.classList.remove('open');
    const btn = card.querySelector('.ka-ship-expand');
    if (btn) {
      btn.textContent = '▾';
      btn.setAttribute('aria-expanded', 'false');
    }
    return;
  }

  // Optional: close other cards
  document.querySelectorAll('.ka-ship-card.open').forEach(c => {
    c.classList.remove('open');
    const d = c.querySelector('.ka-ship-card-detail');
    if (d) {
      d.style.maxHeight = '0px';
      d.style.opacity = '0';
    }
    const btn = c.querySelector('.ka-ship-expand');
    if (btn) {
      btn.textContent = '▾';
      btn.setAttribute('aria-expanded', 'false');
    }
  });

  card.classList.add('open');

  // Load details the first time we open
  if (!detailEl.dataset.loaded) {
    kaLoadShipmentDetailIntoCard(shipmentId, card, detailEl).then(() => {
      // After content is loaded, animate open
      detailEl.style.maxHeight = '1000px';
      detailEl.style.opacity = '1';
    });
  } else {
    detailEl.style.maxHeight = '1000px';
    detailEl.style.opacity = '1';
  }

  const expandBtn = card.querySelector('.ka-ship-expand');
  if (expandBtn) {
    expandBtn.textContent = '▴';
    expandBtn.setAttribute('aria-expanded', 'true');
  }
}

function kaInitials(name) {
  if (!name) return '';
  return String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part[0].toUpperCase())
    .join('')
    .slice(0, 2);
}

function kaAdminAuthId() {
  return kaCurrentAdmin && kaCurrentAdmin.id
    ? Number(kaCurrentAdmin.id)
    : null;
}

function kaDisableAutofill(el) {
  if (!el) return;
  el.setAttribute('autocomplete', 'one-time-code');
  el.setAttribute('autofill', 'off');
  el.setAttribute('inputmode', 'numeric');
  el.setAttribute('pattern', '[0-9]*');
  el.setAttribute('data-lpignore', 'true');
  el.setAttribute('data-1p-ignore', 'true');
  el.setAttribute('data-form-type', 'other');
  el.name = `pin-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function kaHardenPinInputs() {
  ['admin-login-pin', 'ka-pin-new', 'ka-pin-confirm', 'ka-rates-pin'].forEach(id => {
    kaDisableAutofill(document.getElementById(id));
  });
}

// Normalize docs responses (API returns { documents: [...] } but kiosk expects an array)
function kaNormalizeDocs(resp) {
  const list = Array.isArray(resp)
    ? resp
    : (resp && Array.isArray(resp.documents) ? resp.documents : []);

  return list
    .filter(Boolean)
    .map(doc => ({
      ...doc,
      url: doc.url || doc.file_path || null,
      label: doc.label || doc.doc_label || null,
      filename: doc.filename || doc.original_name || doc.title || null
    }));
}

function kaDocIsPayment(doc = {}) {
  const text = [
    doc.doc_type,
    doc.doc_label,
    doc.title,
    doc.label,
    doc.filename,
    doc.original_name
  ]
    .map(v => (v || '').toString().toLowerCase())
    .join(' ')
    .trim();

  if (!text) return false;
  return (
    text.includes('payment') ||
    text.includes('proof of payment') ||
    text.includes('invoice') ||
    text.includes('paid') ||
    text.includes('receipt')
  );
}

function kaFilterDocsForPermissions(docs) {
  const list = Array.isArray(docs) ? docs : [];
  if (kaCanViewPayroll()) return list;
  return list.filter(doc => !kaDocIsPayment(doc));
}

function kaFindDocByType(docs, typeMatch) {
  if (!Array.isArray(docs)) return null;
  const lower = typeMatch.toLowerCase();
  return docs.find(d => {
    const t = (d.doc_type || '').toLowerCase();
    const lbl = (d.doc_label || '').toLowerCase();
    return t === lower || lbl === lower || t.includes(lower) || lbl.includes(lower);
  }) || null;
}

function kaDocsByType(docs, typeMatch) {
  if (!Array.isArray(docs)) return [];
  const lower = typeMatch.toLowerCase();
  return docs.filter(d => {
    const t = (d.doc_type || '').toLowerCase();
    const lbl = (d.doc_label || '').toLowerCase();
    return t === lower || lbl === lower || t.includes(lower) || lbl.includes(lower);
  });
}

function kaRenderPaymentDocList(docs) {
  if (!Array.isArray(docs) || !docs.length) {
    return '<div class="ka-pay-docs ka-ship-muted">No documents uploaded</div>';
  }

  const items = docs.map(doc => {
    const href = doc.url || doc.file_path || '#';
    const label =
      doc.label ||
      doc.doc_label ||
      doc.title ||
      doc.filename ||
      doc.original_name ||
      'Document';
    const extra =
      doc.doc_type && doc.doc_label && doc.doc_label !== doc.doc_type
        ? ` (${doc.doc_type})`
        : '';
    return `<li><a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>${extra}</li>`;
  });

  return `<ul class="ka-pay-docs">${items.join('')}</ul>`;
}

async function kaHydrateShipmentCard(shipmentId, adminId) {
  try {
    const params = kaShipmentAuthParams();
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const resp = await fetchJSON(
      `/api/shipments/${shipmentId}/documents${suffix}`
    );
    const docs = kaFilterDocsForPermissions(kaNormalizeDocs(resp));
    const bolDoc = kaFindDocByType(docs, 'bol');
    kaSetBolLink(shipmentId, bolDoc);
  } catch (err) {
    // Quietly ignore; card will hydrate when expanded
    console.warn('Prefetch docs failed for shipment', shipmentId, err);
  }
}

function kaSetBolLink(shipmentId, doc) {
  const el = document.querySelector(`.ka-ship-bol[data-bol-for="${shipmentId}"]`);
  if (!el) return;
  if (!doc) {
    el.removeAttribute('href');
    el.removeAttribute('target');
    el.removeAttribute('rel');
    delete el.dataset.bolUrl;
    el.classList.add('disabled');
    return;
  }
  const href = doc.url || doc.file_path || '#';
  el.dataset.bolUrl = href;
  el.href = href;
  el.target = '_blank';
  el.rel = 'noopener noreferrer';
  el.classList.remove('disabled');
}

function kaShipmentAuthParams() {
  const params = new URLSearchParams();
  const adminId = kaAdminAuthId();
  if (adminId) params.set('employee_id', adminId);
  if (kaDeviceId) params.set('device_id', kaDeviceId);
  const secret = kaGetDeviceSecret();
  if (secret) params.set('device_secret', secret);
  return params;
}

function kaUpdateBolDetail(shipmentId, doc) {
  const detail = document.querySelector(`.ka-bol-detail[data-bol-detail-for="${shipmentId}"]`);
  if (!detail) return;
  // Keep detail hidden; BOL pill itself opens the link now
  detail.classList.remove('open');
  detail.innerHTML = '';
}

// --- Shipment notification helpers (per kiosk device/admin) ---

function kaNotifyStorageKey() {
  const adminPart = kaCurrentAdmin && kaCurrentAdmin.id
    ? `admin_${kaCurrentAdmin.id}`
    : 'admin_unknown';
  const devicePart = kaDeviceId ? `device_${kaDeviceId}` : 'device_unknown';
  return `avian_kiosk_ship_notify_${adminPart}_${devicePart}`;
}

function kaLoadNotifyPrefFromStorage() {
  if (!kaCurrentAdmin || !kaCurrentAdmin.id) return { ...KA_NOTIFY_DEFAULT };
  try {
    const raw = localStorage.getItem(kaNotifyStorageKey());
    if (!raw) return { ...KA_NOTIFY_DEFAULT };
    const parsed = JSON.parse(raw);

    // Migrate old frequency/day to every_days if present
    let migratedEvery = parsed.remind_every_days;
    if (migratedEvery == null && parsed.remind_frequency) {
      if (parsed.remind_frequency === 'weekly') migratedEvery = 7;
      else if (parsed.remind_frequency === 'biweekly') migratedEvery = 14;
      else migratedEvery = 1;
    }

    return {
      ...KA_NOTIFY_DEFAULT,
      ...parsed,
      statuses: Array.isArray(parsed.statuses) ? parsed.statuses : [],
      project_ids: Array.isArray(parsed.project_ids) ? parsed.project_ids : [],
      remind_every_days: Number(migratedEvery || parsed.remind_every_days || KA_NOTIFY_DEFAULT.remind_every_days),
      remind_time: parsed.remind_time || KA_NOTIFY_DEFAULT.remind_time
    };
  } catch {
    return { ...KA_NOTIFY_DEFAULT };
  }
}

function kaSaveNotifyPref(pref) {
  if (!kaCurrentAdmin || !kaCurrentAdmin.id) return;
  try {
    localStorage.setItem(kaNotifyStorageKey(), JSON.stringify(pref || KA_NOTIFY_DEFAULT));
  } catch {}
}

function kaNotifyStatusesSource() {
  return [...KA_SHIPMENT_STATUSES];
}

function kaRenderNotifyStatuses(statuses) {
  const menu = document.getElementById('ka-notify-statuses-menu');
  const labelEl = document.getElementById('ka-notify-statuses-label');
  if (!menu || !labelEl) return;

  const list = Array.isArray(statuses) && statuses.length ? statuses : KA_SHIPMENT_STATUSES;
  const selected = new Set(kaNotifyPref.statuses || []);
  const defaultChecked = selected.size === 0;

  menu.innerHTML = '';

  list.forEach(status => {
    if (!status) return;
    const lbl = document.createElement('label');
    const input = document.createElement('input');
    const span = document.createElement('span');
    input.type = 'checkbox';
    input.value = status;
    input.checked = defaultChecked || selected.has(status);
    span.textContent = status;
    lbl.appendChild(input);
    lbl.appendChild(span);
    menu.appendChild(lbl);
  });

  function updateLabel() {
    const picked = Array.from(
      menu.querySelectorAll('input[type="checkbox"]:checked')
    ).map(cb => cb.value);
    if (!picked.length) {
      labelEl.textContent = 'All statuses';
      labelEl.classList.add('placeholder');
    } else {
      labelEl.textContent = picked.length === list.length
        ? 'All statuses'
        : `${picked.length} selected`;
      labelEl.classList.remove('placeholder');
    }
    kaNotifyPref.statuses = picked;
    kaNotifiedShipments = new Set();
    kaReminderTimestamps = {};
    kaSaveNotifyPref(kaNotifyPref);
  }

  menu.onchange = updateLabel;
  updateLabel();
}

function kaRefreshNotifyProjectSelect() {
  const menu = document.getElementById('ka-notify-projects-menu');
  const labelEl = document.getElementById('ka-notify-projects-label');
  if (!menu || !labelEl) return;

  const selected = new Set(kaNotifyPref.project_ids || []);
  menu.innerHTML = '';

  if (!kaProjects || !kaProjects.length) {
    const p = document.createElement('p');
    p.className = 'ka-muted small';
    p.textContent = 'Projects will load soon.';
    menu.appendChild(p);
    labelEl.textContent = 'All projects';
    labelEl.classList.add('placeholder');
    return;
  }

  kaProjects
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .forEach(p => {
      const lbl = document.createElement('label');
      const input = document.createElement('input');
      const span = document.createElement('span');
      input.type = 'checkbox';
      input.value = p.id;
      input.checked = selected.size === 0 || selected.has(p.id);
      span.textContent = p.name || 'Project';
      lbl.appendChild(input);
      lbl.appendChild(span);
      menu.appendChild(lbl);
    });

  function updateLabel() {
    const picked = Array.from(
      menu.querySelectorAll('input[type="checkbox"]:checked')
    ).map(cb => Number(cb.value)).filter(Number.isFinite);

    if (!picked.length || picked.length === kaProjects.length) {
      labelEl.textContent = 'All projects';
      labelEl.classList.add('placeholder');
    } else {
      labelEl.textContent = `${picked.length} project${picked.length === 1 ? '' : 's'}`;
      labelEl.classList.remove('placeholder');
    }

    kaNotifyPref.project_ids = picked;
    kaNotifiedShipments = new Set();
    kaReminderTimestamps = {};
    kaSaveNotifyPref(kaNotifyPref);
  }

  menu.onchange = updateLabel;
  updateLabel();
}

function kaApplyNotifyPrefToUI(pref, statusesList) {
  kaNotifyPref = {
    ...KA_NOTIFY_DEFAULT,
    ...pref,
    statuses: Array.isArray(pref?.statuses) ? pref.statuses : [],
    project_ids: Array.isArray(pref?.project_ids) ? pref.project_ids : [],
    remind_every_days: Number(pref?.remind_every_days) || KA_NOTIFY_DEFAULT.remind_every_days,
    remind_time: pref?.remind_time || KA_NOTIFY_DEFAULT.remind_time
  };

  const enabledEl = document.getElementById('ka-notify-enabled');
  if (enabledEl) enabledEl.checked = !!kaNotifyPref.enabled;
  kaToggleNotifyFields(!!kaNotifyPref.enabled);
  const everyEl = document.getElementById('ka-notify-every-days');
  if (everyEl) {
    everyEl.value = Number(kaNotifyPref.remind_every_days) || 1;
  }
  const timeEl = document.getElementById('ka-notify-time');
  if (timeEl) {
    timeEl.value = kaNotifyPref.remind_time || '09:00';
  }

  kaRenderNotifyStatuses(statusesList || kaNotifyStatusesSource());
  kaRefreshNotifyProjectSelect();
}

function kaCollectNotifyForm() {
  const enabled = document.getElementById('ka-notify-enabled')?.checked || false;
  const everyVal = Number(document.getElementById('ka-notify-every-days')?.value || 1);
  const timeVal = document.getElementById('ka-notify-time')?.value || '09:00';

  const statuses = Array.from(
    document.querySelectorAll('#ka-notify-statuses-menu input[type="checkbox"]:checked')
  ).map(cb => cb.value);

  const projectIds = Array.from(
    document.querySelectorAll('#ka-notify-projects-menu input[type="checkbox"]:checked')
  ).map(cb => Number(cb.value)).filter(n => Number.isFinite(n));

  return {
    enabled,
    statuses,
    project_ids: projectIds,
    remind_every_days: everyVal > 0 ? everyVal : 1,
    remind_time: timeVal
  };
}

function kaToggleNotifyFields(enabled) {
  const body = document.getElementById('ka-notify-fields');
  if (body) body.classList.toggle('hidden', !enabled);
}

function kaShipStatusTone(status) {
  const st = (status || '').toLowerCase();
  if (st.includes('cleared') || st.includes('picked up') || st.includes('release')) {
    return 'is-green';
  }
  if (
    st.includes('await') ||
    st.includes('sail') ||
    st.includes('transit') ||
    st.includes('order') ||
    st.includes('arrived') ||
    st.includes('forwarder') ||
    st.includes('port')
  ) {
    return 'is-amber';
  }
  return 'is-gray';
}

function kaShipVerificationInfo(sh) {
  const total = Number(sh.items_total) || 0;
  const verified = Number(sh.items_verified_count) || 0;
  const percent = total ? Math.min(100, Math.round((verified / total) * 100)) : 0;

  if (!total) {
    return {
      total: 0,
      verified: 0,
      percent: 0,
      tone: 'none',
      label: 'No items added'
    };
  }

  if (verified >= total) {
    return {
      total,
      verified,
      percent: 100,
      tone: 'done',
      label: 'All items verified'
    };
  }

  if (verified > 0) {
    return {
      total,
      verified,
      percent,
      tone: 'partial',
      label: `${verified}/${total} verified`
    };
  }

  return {
    total,
    verified,
    percent,
    tone: 'none',
    label: `0/${total} verified`
  };
}

function kaStorageLateFees(dueDateStr, dailyFeeRaw) {
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

function kaFmtDateMMDDYYYY(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const y = d.getFullYear();
  return `${m}/${day}/${y}`;
}

function kaFmtCurrency(val) {
  const num = Number(val);
  if (!Number.isFinite(num)) return '—';
  return `$${num.toFixed(2)}`;
}

function kaRenderShipmentsList(list) {
  const wrap = document.getElementById('ka-shipments-list');
  if (!wrap) return;

  if (!Array.isArray(list) || !list.length) {
    wrap.innerHTML = '<div class="ka-ship-muted">(No shipments found for this filter.)</div>';
    return;
  }

  wrap.innerHTML = '';

  list.forEach(sh => {
    const title = sh.title || sh.reference || `Shipment #${sh.id || ''}`;
    const bol = sh.bol_number ? `BOL ${sh.bol_number}` : '';
    const project = sh.project_name ? sh.project_name : 'No project set';
    const verify = kaShipVerificationInfo(sh);
    const statusClass = kaShipStatusTone(sh.status);
    const shipperPaid = Number(sh.shipper_paid) === 1 ? 'paid' : 'unpaid';
    const clearingPaid = Number(sh.customs_paid) === 1 ? 'paid' : 'unpaid';
    const showPaymentDetails = kaCanViewPayroll();
    const late = kaStorageLateFees(sh.storage_due_date, sh.storage_daily_late_fee);
    const isOverdue = late.daysLate > 0 && late.estimate > 0;
    const overdueText = showPaymentDetails
      ? `Shipment overdue · Estimated charges: $${late.estimate.toFixed(2)}`
      : 'Shipment overdue';
    const shipperDocsAttr = showPaymentDetails ? `data-ka-docs-payment="shipper" data-ka-docs-id="${sh.id}"` : '';
    const clearingDocsAttr = showPaymentDetails ? `data-ka-docs-payment="clearing" data-ka-docs-id="${sh.id}"` : '';

    const card = document.createElement('div');
    card.className = 'ka-ship-card';
    card.dataset.shipmentId = sh.id;
    card.innerHTML = `
      ${isOverdue ? `<div class="ka-ship-overdue">${overdueText}</div>` : ''}
      <div class="ka-ship-card-header">
        <div class="ka-ship-card-titlewrap">
          <div class="ka-ship-title-row">
            <div class="ka-ship-title">${title} — ${project}</div>
          </div>
          <div class="ka-ship-meta-row">
            ${
              sh.storage_due_date
                ? `<span class="ka-ship-meta-text">Due for pickup: ${kaFmtDateMMDDYYYY(sh.storage_due_date)}</span>`
                : ''
            }
            ${
              sh.expected_arrival_date
                ? `<span class="ka-ship-meta-text">ETA ${kaFmtDateMMDDYYYY(sh.expected_arrival_date)}</span>`
                : ''
            }
          </div>
        </div>
        <div class="ka-ship-header-right">
          ${
            bol
              ? `<a class="ka-ship-bol-pill ka-ship-bol" data-bol-for="${sh.id}" href="javascript:void(0)">${bol}</a>`
              : ''
          }
          <button type="button" class="ka-docs-btn" data-ka-docs="${sh.id}" aria-label="View documents">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 3a1 1 0 0 0-1 1v9.586l-2.293-2.293a1 1 0 1 0-1.414 1.414l4 4a1 1 0 0 0 1.414 0l4-4a1 1 0 0 0-1.414-1.414L13 13.586V4a1 1 0 0 0-1-1Zm-7 14a1 1 0 0 0 0 2h14a1 1 0 1 0 0-2H5Z"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="ka-ship-verify-row">
        ${
          verify.total
            ? `<div class="ka-ship-verify-bar"><span style="width:${verify.percent}%;"></span></div>`
            : ''
        }
        <div class="ka-ship-verify-meta">
          <div class="ka-ship-verify-label ${verify.tone}">
            ${verify.tone === 'done' ? 'All items verified ✓' : verify.label}
          </div>
        </div>
      </div>

      <div class="ka-ship-payment-row">
        <span class="ka-ship-pay-badge ${shipperPaid}" ${shipperDocsAttr}>
          <span class="ka-pay-icon">${shipperPaid === 'paid' ? '✓' : '✕'}</span>
          Shipper ${shipperPaid === 'paid' ? 'Paid' : 'Unpaid'}
        </span>
        <span class="ka-ship-pay-badge ${clearingPaid}" ${clearingDocsAttr}>
          <span class="ka-pay-icon">${clearingPaid === 'paid' ? '✓' : '✕'}</span>
          Clearing ${clearingPaid === 'paid' ? 'Paid' : 'Unpaid'}
        </span>
      </div>

      <div class="ka-ship-card-actions">
        <div class="ka-ship-status-pill ${statusClass}">${sh.status || 'Status'}</div>
        <button type="button" class="btn secondary btn-sm" data-ka-open-items="${sh.id}">
          View & verify items
        </button>
      </div>
    `;
    wrap.appendChild(card);
  });

  if (!wrap.dataset.bound) {
    wrap.addEventListener('click', (e) => {
      const bolLink = e.target.closest('.ka-ship-bol');
      if (bolLink && bolLink.dataset.bolUrl) {
        return; // let the BOL link open normally when available
      }

      const docsBtn = e.target.closest('[data-ka-docs]');
      if (docsBtn) {
        const sid = Number(docsBtn.dataset.kaDocs);
        if (sid) {
          kaOpenDocsModal(sid, 'all');
        }
        return;
      }

      const payBtn = e.target.closest('[data-ka-docs-payment]');
      if (payBtn) {
        const sid = Number(payBtn.dataset.kaDocsId);
        const mode = payBtn.dataset.kaDocsPayment || 'all';
        if (sid) {
          kaOpenDocsModal(sid, mode);
        }
        return;
      }

      const btn = e.target.closest('[data-ka-open-items]');
      if (btn) {
        const sid = Number(btn.dataset.kaOpenItems);
        if (sid) {
          kaOpenItemsModal(sid);
        }
      }
    });
    wrap.dataset.bound = '1';
  }
}

async function kaLoadShipments() {
  const listEl = document.getElementById('ka-shipments-list');
  const statusSel = document.getElementById('ka-shipments-filter');
  const projSel = document.getElementById('ka-shipments-project');

  if (!kaCanViewShipments()) {
    if (listEl) listEl.innerHTML = '<div class="ka-ship-muted">You do not have shipments access.</div>';
    return;
  }

  if (listEl) {
    listEl.innerHTML = '<div class="ka-ship-muted">Loading shipments…</div>';
  }

  const params = kaShipmentAuthParams();

  const statusVal = statusSel ? statusSel.value : '';
  if (statusVal && statusVal !== 'all') {
    if (statusVal.startsWith('status:')) {
      params.set('status', statusVal.slice('status:'.length));
    }
  }

  const projVal = projSel ? projSel.value : '';
  if (projVal) params.set('project_id', projVal);

  const useCache = !navigator.onLine;

  if (useCache) {
    const cached = kaLoadShipmentsCache();
    if (cached) {
      kaShipments = cached.shipments || [];
      kaRenderShipmentsList(kaShipments);
      kaProcessNewShipmentsForAlert();
      kaStartNotifyTimer(true);
      if (listEl) {
        listEl.innerHTML = `<div class="ka-ship-muted">Offline – showing last downloaded shipments.</div>`;
      }
      return;
    }
  }

  try {
    const resp = await fetchJSON('/api/reports/shipment-verification?' + params.toString());
    const rows = Array.isArray(resp.shipments) ? resp.shipments : [];
    kaShipments = rows;
    kaSaveShipmentsCache(rows);
    kaRenderShipmentsList(rows);
    kaProcessNewShipmentsForAlert();
    kaStartNotifyTimer(true);
  } catch (err) {
    console.error('Error loading shipments:', err);
    const cached = kaLoadShipmentsCache();
    if (cached && Array.isArray(cached.shipments) && cached.shipments.length) {
      kaShipments = cached.shipments;
      kaRenderShipmentsList(kaShipments);
      kaProcessNewShipmentsForAlert();
      kaStartNotifyTimer(true);
      if (listEl) {
        listEl.innerHTML = `<div class="ka-ship-muted">Offline – showing last downloaded shipments (may be stale).</div>`;
      }
    } else if (listEl) {
      listEl.innerHTML = `<div class="ka-ship-muted">Error loading shipments: ${err.message || err}</div>`;
    }
  }
}

function kaSetNotifyMsg(text, color) {
  const el = document.getElementById('ka-notify-msg');
  if (!el) return;
  el.textContent = text || '';
  if (color) el.style.color = color;
}

async function kaEnsureNotifyPermission() {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  try {
    const perm = await Notification.requestPermission();
    return perm === 'granted';
  } catch (err) {
    console.warn('Kiosk notify permission failed:', err);
    return false;
  }
}

function kaShipmentsMatchingNotify(pref) {
  const statuses = Array.isArray(pref.statuses) && pref.statuses.length
    ? new Set(pref.statuses)
    : null;
  const projectIds = Array.isArray(pref.project_ids) && pref.project_ids.length
    ? new Set(pref.project_ids)
    : null;

  return (kaShipments || []).filter(sh => {
    const st = (sh.status || '').trim();
    if (statuses && !statuses.has(st)) return false;
    if (projectIds && !projectIds.has(Number(sh.project_id))) return false;
    return true;
  });
}

function kaToggleDayRow() {
  const row = document.getElementById('ka-notify-day-row');
  if (row) row.style.display = 'none';
}

async function kaTriggerShipmentNotification(force = false) {
  const pref = kaNotifyPref || KA_NOTIFY_DEFAULT;
  const matching = kaShipmentsMatchingNotify(pref);

  const title = force ? 'Test: Shipments alert' : 'Shipments alert';
  let body;

  if (!matching.length) {
    body = 'No shipments match your kiosk notification filters.';
  } else {
    const summary = matching.slice(0, 5).map(sh => {
      const st = sh.status || 'Status';
      const t = sh.title || `Shipment ${sh.id || ''}`.trim();
      return `${t} (${st})`;
    });
    const extra = matching.length > 5 ? ` + ${matching.length - 5} more` : '';
    body = `${summary.join(', ')}${extra}`;
  }

  const ok = await kaEnsureNotifyPermission();
  if (ok) {
    try {
      new Notification(title, { body });
    } catch (err) {
      console.warn('Kiosk notification failed:', err);
    }
  }

  kaSetNotifyMsg(body, matching.length ? 'green' : '#0f172a');
}

async function kaCheckNotifyWindow(forceNow = false) {
  if (!kaNotifyPref.enabled) return;

  await kaTriggerShipmentNotification(forceNow);
}

function kaProcessNewShipmentsForAlert() {
  if (!kaNotifyPref.enabled) return;
  const matches = kaShipmentsMatchingNotify(kaNotifyPref);
  const newOnes = matches.filter(sh => !kaNotifiedShipments.has(sh.id));
  if (!newOnes.length) return;

  const summary = newOnes.slice(0, 5).map(sh => {
    const st = sh.status || 'Status';
    const t = sh.title || `Shipment ${sh.id || ''}`.trim();
    return `${t} (${st})`;
  });
  const extra = newOnes.length > 5 ? ` + ${newOnes.length - 5} more` : '';
  kaEnsureNotifyPermission().then(ok => {
    if (ok) {
      try {
        new Notification('New shipments', {
          body: `${summary.join(', ')}${extra}`
        });
      } catch (err) {
        console.warn('Kiosk new shipment notify failed:', err);
      }
    }
  });

  newOnes.forEach(sh => kaNotifiedShipments.add(sh.id));
}

async function kaReminderCheck(forceNow = false) {
  if (!kaNotifyPref.enabled) return;
  const now = Date.now();
  const matches = kaShipmentsMatchingNotify(kaNotifyPref);

  const outstanding = matches.filter(sh =>
    (sh.status || '') === 'Cleared - Ready for Release' &&
    (!sh.picked_up_by || String(sh.picked_up_by).trim() === '')
  );

  const everyDays = Math.max(Number(kaNotifyPref.remind_every_days) || 1, 1);
  const today = new Date();
  const targetTime = (kaNotifyPref.remind_time || '09:00').match(/^(\d{2}):(\d{2})$/)
    ? kaNotifyPref.remind_time
    : '09:00';

  const [hh, mm] = targetTime.split(':').map(n => Number(n));
  const targetDate = new Date(today);
  targetDate.setHours(hh, mm, 0, 0);
  const targetMs = targetDate.getTime();

  const dayMs = 24 * 60 * 60 * 1000;

  const due = outstanding.filter(sh => {
    if (forceNow) return true;
    const last = kaReminderTimestamps[sh.id] || 0;

    // Only send once per scheduled day/time window
    const hasPastTarget = now >= targetMs;
    const alreadySentToday = last >= targetMs && last < targetMs + dayMs;
    if (!hasPastTarget || alreadySentToday) return false;

    // Enforce every N days spacing
    return now - last >= everyDays * dayMs;
  });

  if (!due.length) return;

  const summary = due.slice(0, 5).map(sh => sh.title || `Shipment ${sh.id || ''}`.trim());
  const extra = due.length > 5 ? ` + ${due.length - 5} more` : '';

  const ok = await kaEnsureNotifyPermission();
  if (ok) {
    try {
      new Notification('Ready for Release – Pickup Reminder', {
        body: `${summary.join(', ')}${extra}`
      });
    } catch (err) {
      console.warn('Kiosk reminder notification failed:', err);
    }
  }
  kaSetNotifyMsg('Reminder sent for ready-to-release shipments.', '#0f172a');

  due.forEach(sh => {
    kaReminderTimestamps[sh.id] = now;
    kaNotifiedShipments.add(sh.id);
  });
}

async function kaStartNotifyTimer(forcePing = false) {
  if (kaNotifyTimer) {
    clearInterval(kaNotifyTimer);
    kaNotifyTimer = null;
  }

  if (!kaNotifyPref.enabled) return;

  const perm = await kaEnsureNotifyPermission();
  if (!perm) {
    kaSetNotifyMsg('Allow browser notifications to receive shipment alerts.', '#b45309');
    return;
  }

  kaNotifyTimer = setInterval(() => {
    kaReminderCheck(false).catch(err => {
      console.warn('Kiosk notify tick failed:', err);
    });
  }, 30 * 60 * 1000); // check every 30 minutes

  if (forcePing) {
    kaReminderCheck(true).catch(err => {
      console.warn('Kiosk notify check failed:', err);
    });
  }
}

function kaInitNotifyPanel() {
  if (!kaCurrentAdmin || !kaCurrentAdmin.id) return;

  kaNotifiedShipments = new Set();
  kaReminderTimestamps = {};
  if (kaNotifyTimer) {
    clearInterval(kaNotifyTimer);
    kaNotifyTimer = null;
  }

  const saved = kaLoadNotifyPrefFromStorage();
  kaApplyNotifyPrefToUI(saved, kaNotifyStatusesSource());

  const statusBtn = document.getElementById('ka-notify-statuses-btn');
  const statusMenu = document.getElementById('ka-notify-statuses-menu');
  if (statusBtn && statusMenu) {
    statusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      statusMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!statusMenu.contains(e.target) && e.target !== statusBtn) {
        statusMenu.classList.add('hidden');
      }
    });
  }

  const projBtn = document.getElementById('ka-notify-projects-btn');
  const projMenu = document.getElementById('ka-notify-projects-menu');
  if (projBtn && projMenu) {
    projBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      projMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!projMenu.contains(e.target) && e.target !== projBtn) {
        projMenu.classList.add('hidden');
      }
    });
  }

  const enableEl = document.getElementById('ka-notify-enabled');
  if (enableEl) {
    enableEl.addEventListener('change', () => {
      kaNotifyPref.enabled = enableEl.checked;
      kaToggleNotifyFields(enableEl.checked);
      kaSaveNotifyPref(kaNotifyPref);
      kaStartNotifyTimer(true);
    });
  }

  const everyEl = document.getElementById('ka-notify-every-days');
  if (everyEl) {
    everyEl.addEventListener('change', () => {
      const val = Number(everyEl.value) || 1;
      kaNotifyPref.remind_every_days = val > 0 ? val : 1;
      kaSaveNotifyPref(kaNotifyPref);
      kaReminderTimestamps = {};
      kaStartNotifyTimer(true);
    });
  }

  const timeEl = document.getElementById('ka-notify-time');
  if (timeEl) {
    timeEl.addEventListener('change', () => {
      kaNotifyPref.remind_time = timeEl.value || '09:00';
      kaSaveNotifyPref(kaNotifyPref);
      kaReminderTimestamps = {};
    });
  }

  const saveBtn = document.getElementById('ka-notify-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const pref = kaCollectNotifyForm();
      kaNotifyPref = pref;
      kaSaveNotifyPref(pref);
      await kaStartNotifyTimer(true);
      kaReminderTimestamps = {};
      kaNotifiedShipments = new Set();
      kaSetNotifyMsg('Notification settings saved for this kiosk.', 'green');

      const statusMenu = document.getElementById('ka-notify-statuses-menu');
      if (statusMenu) statusMenu.classList.add('hidden');
      const projMenu = document.getElementById('ka-notify-projects-menu');
      if (projMenu) projMenu.classList.add('hidden');
      kaToggleNotifyFields(!!pref.enabled);
    });
  }

  const testBtn = document.getElementById('ka-notify-test');
  if (testBtn) {
    testBtn.addEventListener('click', () => {
      kaTriggerShipmentNotification(true);
    });
  }

}

function kaPerm(key) {
  return !!kaAccessPerms[key];
}

function kaCanViewShipments() {
  return kaPerm('see_shipments');
}

function kaCanViewTimeReports() {
  return kaPerm('view_time_reports');
}

function kaCanModifyTime() {
  return kaPerm('modify_time');
}

function kaCanViewPayroll() {
  return kaPerm('view_payroll');
}

function kaCanModifyPayRates() {
  return kaPerm('modify_pay_rates');
}

function kaApplyAccessUI() {
  const shipBtn = document.querySelector('.ka-bottom-nav button[data-ka-view=\"shipments\"]');
  if (shipBtn) shipBtn.style.display = kaCanViewShipments() ? '' : 'none';

  const timeBtn = document.querySelector('.ka-bottom-nav button[data-ka-view=\"time\"]');
  if (timeBtn) timeBtn.style.display = kaCanViewTimeReports() ? '' : 'none';

  const shipSection = document.getElementById('ka-view-shipments');
  if (shipSection) shipSection.classList.toggle('hidden', !kaCanViewShipments());

  const showNotify = kaCanViewShipments();
  const notifyTile = document.getElementById('ka-notify-settings-tile');
  if (notifyTile) notifyTile.style.display = showNotify ? '' : 'none';

  const timeSection = document.getElementById('ka-view-time');
  if (timeSection) timeSection.classList.toggle('hidden', !kaCanViewTimeReports());

  const verifyAllBtn = document.getElementById('ka-time-verify-all');
  if (verifyAllBtn) verifyAllBtn.style.display = kaCanModifyTime() ? '' : 'none';

  const payCols = document.querySelectorAll('.ka-pay-col');
  payCols.forEach(col => col.classList.toggle('hidden', !kaCanViewPayroll()));

  const approveCols = document.querySelectorAll('.ka-approve-col');
  approveCols.forEach(col => col.classList.toggle('hidden', !kaCanModifyTime()));

  const actionCols = document.querySelectorAll('.ka-actions-col');
  actionCols.forEach(col => col.classList.toggle('hidden', !kaCanModifyTime()));

  const ratesBlock = document.getElementById('ka-rates-block');
  const ratesEditor = document.getElementById('ka-rates-editor');
  const ratesTile = document.querySelector('[data-settings-section="rates"]');
  const canRates = kaCanModifyPayRates();
  if (ratesBlock) ratesBlock.classList.toggle('hidden', !canRates);
  if (ratesTile) ratesTile.classList.toggle('hidden', !canRates);
  if (!canRates) {
    kaRatesUnlocked = false;
    ratesEditor?.classList.add('hidden');
  }

  if (!kaCanViewShipments() && kaCurrentView === 'shipments') {
    kaShowView('live');
  } else if (!kaCanViewTimeReports() && kaCurrentView === 'time') {
    kaShowView('live');
  }
}

async function kaLoadAccessPerms() {
  const defaults = {
    see_shipments: true,
    modify_time: true,
    view_time_reports: true,
    view_payroll: true,
    modify_pay_rates: false
  };

  let nextPerms = { ...defaults };
  try {
    // Kiosk can call the public kiosk settings endpoint; fall back to the admin one if available
    let res = await fetchJSON('/api/kiosk/settings');
    // If kiosk endpoint failed (auth-required response or other), try the standard settings
    if (!res || res.error) {
      res = await fetchJSON('/api/settings');
    }
    const settings = res && res.settings ? res.settings : {};
    const raw =
      typeof settings.access_admins === 'string'
        ? JSON.parse(settings.access_admins || '{}')
        : (settings.access_admins || {});
    const adminId = kaCurrentAdmin && kaCurrentAdmin.id;
    if (adminId && raw && raw[adminId]) {
      const p = raw[adminId];
      nextPerms = {
        ...defaults,
        see_shipments: p.see_shipments === true || p.see_shipments === 'true',
        modify_time: p.modify_time === true || p.modify_time === 'true',
        view_time_reports: p.view_time_reports === true || p.view_time_reports === 'true',
        view_payroll: p.view_payroll === true || p.view_payroll === 'true',
        modify_pay_rates: p.modify_pay_rates === true || p.modify_pay_rates === 'true'
      };
    }
  } catch (err) {
    console.warn('Unable to load access permissions, using defaults', err);
  }

  kaAccessPerms = nextPerms;
  if (kaCurrentAdmin) {
    kaCurrentAdmin.kiosk_can_view_shipments = kaAccessPerms.see_shipments;
  }
  kaApplyAccessUI();
}

function kaUpdateShipmentCardDue(card, shipment) {
  if (!card || !shipment) return;
  const dueBox = card.querySelector('.ka-ship-due-inline');
  if (!dueBox) return;

  const valueEl = dueBox.querySelector('.value');
  const { daysLate, estimate } = kaCalcStorageLateFees(
    shipment.storage_due_date,
    shipment.storage_daily_late_fee
  );
  const showPaymentDetails = kaCanViewPayroll();
  const dueLabel = shipment.storage_due_date
    ? kaFormatDateIso(shipment.storage_due_date)
    : 'No due date set';
  if (valueEl) valueEl.textContent = dueLabel;

  dueBox.classList.toggle('late', daysLate > 0 && estimate > 0);
  dueBox.querySelectorAll('.late-text').forEach(el => el.remove());
  if (daysLate > 0 && estimate > 0) {
    const lt = document.createElement('span');
    lt.className = 'late-text';
    const baseText = `${daysLate} day${daysLate === 1 ? '' : 's'} past due`;
    lt.textContent = showPaymentDetails
      ? `${baseText} · Est. ${kaFmtMoney(estimate) || '$0.00'}`
      : baseText;
    dueBox.appendChild(lt);
  }
}

function kaRenderStorageSection(storageGrid, shipment, card) {
  if (!storageGrid || !shipment) return;
  const sid = shipment.id;
  const adminId = kaAdminAuthId();
  const canEdit = !!adminId && kaCanViewShipments();

  storageGrid.innerHTML = `
    <div class="ka-ship-info-row">
      <div class="ka-ship-info-label">Picked Up By</div>
      <div class="ka-ship-info-value">
        <input type="text" data-ka-storage-field="picked_by" placeholder="Name of pickup contact" ${canEdit ? '' : 'disabled'} />
      </div>
    </div>
    <div class="ka-ship-info-row">
      <div class="ka-ship-info-label">Picked Up Date</div>
      <div class="ka-ship-info-value">
        <input type="date" data-ka-storage-field="picked_date" ${canEdit ? '' : 'disabled'} />
      </div>
    </div>
    <div class="ka-ship-info-row wide">
      <div class="ka-ship-info-label"></div>
      <div class="ka-ship-info-value ka-storage-actions">
        <button class="btn primary btn-sm" data-ka-storage-save="${sid}" ${canEdit ? '' : 'disabled'}>Save storage & pickup</button>
        <span class="ka-status" data-ka-storage-status="${sid}">${canEdit ? '' : 'Log in as an admin to edit.'}</span>
      </div>
    </div>
  `;

  const getField = (name) =>
    storageGrid.querySelector(`[data-ka-storage-field="${name}"]`);
  const pickedByInput = getField('picked_by');
  const pickedDateInput = getField('picked_date');
  const statusEl = storageGrid.querySelector(
    `[data-ka-storage-status="${sid}"]`
  );
  const saveBtn = storageGrid.querySelector(
    `[data-ka-storage-save="${sid}"]`
  );

  const setStatus = (msg, type) => {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.className = 'ka-status';
    if (type === 'ok') statusEl.classList.add('ka-status-ok');
    if (type === 'error') statusEl.classList.add('ka-status-error');
  };

  const applyValues = (src) => {
    if (!src) return;
    if (pickedByInput) pickedByInput.value = src.picked_up_by || '';
    if (pickedDateInput) pickedDateInput.value = src.picked_up_date || '';
  };

  const adminMissingMsg = !adminId
    ? 'Identify yourself on this device to edit.'
    : 'You do not have shipments access.';
  if (!canEdit && statusEl) {
    setStatus(adminMissingMsg, 'error');
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      if (!canEdit) {
        setStatus(adminMissingMsg, 'error');
        return;
      }
      const payload = {
        picked_up_by: pickedByInput?.value ? pickedByInput.value.trim() : '',
        picked_up_date: pickedDateInput?.value || null,
        employee_id: adminId,
        device_id: kaDeviceId,
        device_secret: kaGetDeviceSecret()
      };

      setStatus('Saving storage & pickup…');
      saveBtn.disabled = true;
      try {
        const resp = await fetchJSON(
          `/api/shipments/${sid}/storage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }
        );
        applyValues(resp);
        setStatus('Storage & pickup updated.', 'ok');
      } catch (err) {
        console.error('Error saving storage data', err);
        setStatus('Error saving storage info.', 'error');
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  applyValues(shipment);
}

function kaCalcStorageLateFees(dueDateStr, dailyFeeRaw) {
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

  return {
    daysLate,
    estimate: daysLate > 0 ? dailyFee * daysLate : 0
  };
}

function kaFmtMoney(n) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) {
    return '';
  }
  return `$${Number(n).toFixed(2)}`;
}

function kaFormatDateIso(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}


function kaSetText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function kaSetOptionList(sel, rows, { placeholder = '(select)', valueKey = 'id', labelKey = 'name' } = {}) {
  if (!sel) return;
  sel.innerHTML = '';
  if (placeholder !== null) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = placeholder;
    sel.appendChild(opt);
  }
  (rows || []).forEach(r => {
    const opt = document.createElement('option');
    opt.value = r[valueKey];
    opt.textContent = r[labelKey] || '(Unnamed)';
    sel.appendChild(opt);
  });
}

function kaShowReturnPrompt(message) {
  const backdrop = document.getElementById('ka-return-backdrop');
  const msgEl = document.getElementById('ka-return-message');
  const titleEl = document.getElementById('ka-return-title');
  const yesBtn = document.getElementById('ka-return-yes');
  const noBtn = document.getElementById('ka-return-no');
  if (!backdrop || !msgEl || !yesBtn || !noBtn || !titleEl) return;

  msgEl.textContent = message || 'Project is set and you are clocked in.';
  titleEl.textContent = 'Return to worker clock-in page?';

  const close = () => backdrop.classList.add('hidden');

  yesBtn.onclick = () => {
    window.location.href = '/kiosk';
  };
  noBtn.onclick = () => {
    close();
  };
  backdrop.onclick = (e) => {
    if (e.target === backdrop) {
      close();
    }
  };

  backdrop.classList.remove('hidden');
}

function kaClearAdminUnlock() {
  if (!kaCurrentAdmin) return;
  const key = `ka_admin_unlocked_${kaCurrentAdmin.id || 'unknown'}`;
  try {
    sessionStorage.removeItem(key);
  } catch (e) {
    console.warn('Could not clear admin unlock cache', e);
  }
}

async function kaLogoutToKiosk() {
  const statusEl = document.getElementById('ka-logout-status');
  const setStatus = (msg, type) => {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.className = 'ka-status';
    if (type === 'ok') statusEl.classList.add('ka-status-ok');
    if (type === 'error') statusEl.classList.add('ka-status-error');
  };

  setStatus('Signing out and returning to clock-in…');
  kaForceCloseAllModals();
  kaClearAdminUnlock();
  if (kaNotifyTimer) {
    clearInterval(kaNotifyTimer);
    kaNotifyTimer = null;
  }

  kaAdminValidated = false;
  kaSelectedAdminId = null;
  kaAccessPerms = {
    see_shipments: false,
    modify_time: false,
    view_time_reports: false,
    view_payroll: false,
    modify_pay_rates: false
  };
  kaApplyAccessUI();

  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include'
    });
  } catch (err) {
    console.warn('Kiosk admin logout failed:', err);
  }

  setStatus('Redirecting…', 'ok');
  setTimeout(() => {
    window.location.href = '/kiosk';
  }, 150);
}

function kaAdminDisplayName() {
  if (kaCurrentAdmin) {
    return kaCurrentAdmin.nickname || kaCurrentAdmin.name || 'kiosk admin';
  }
  return 'kiosk admin';
}

function kaGetDeviceSecret() {
  try {
    let secret = localStorage.getItem(KA_DEVICE_SECRET_KEY);
    if (!secret) {
      // Note: kiosk-admin should usually be opened from the kiosk tab, so secret should already exist
      secret = Math.random().toString(36).slice(2);
      localStorage.setItem(KA_DEVICE_SECRET_KEY, secret);
    }
    return secret;
  } catch {
    return null;
  }
}

function kaTodayIso() {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: KA_APP_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = fmt.formatToParts(new Date());
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const d = parts.find(p => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch (err) {
    console.warn('Falling back to local date for kaTodayIso:', err);
  }
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function kaFmtDateMDY(input) {
  const dt = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(dt.getTime())) return '';
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const yy = dt.getFullYear();
  return `${mm}/${dd}/${yy}`;
}

function kaIsoOffsetDays(baseIso, deltaDays) {
  if (!baseIso) return '';
  const dt = new Date(baseIso + 'T00:00:00');
  if (Number.isNaN(dt.getTime())) return '';
  dt.setDate(dt.getDate() + Number(deltaDays || 0));
  return dt.toISOString().slice(0, 10);
}

function kaProjectLabelById(projectId) {
  if (!projectId || !Array.isArray(kaProjects)) return '';
  const p = kaProjects.find(proj => Number(proj.id) === Number(projectId));
  if (!p) return '(Inactive project)';
  return p.name || '(Unnamed project)';
}

function kaUpdateActiveProjectUI() {
  const startBtn = document.getElementById('ka-start-new-btn');
  const createBlock = document.getElementById('ka-session-create');

  const hasActive = !!(kaKiosk && kaKiosk.project_id);
  if (!hasActive) {
    kaNewSessionVisible = true;
  }

  if (startBtn) {
    startBtn.classList.toggle('hidden', !hasActive || kaNewSessionVisible);
  }

  if (createBlock) {
    createBlock.classList.toggle('hidden', hasActive && !kaNewSessionVisible);
  }
}

function kaLoadOfflinePunches() {
  try {
    const raw = localStorage.getItem(KA_OFFLINE_QUEUE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function kaLoadVerificationQueue() {
  try {
    const raw = localStorage.getItem(KA_VERIFY_QUEUE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function kaSaveVerificationQueue(list) {
  try {
    localStorage.setItem(KA_VERIFY_QUEUE_KEY, JSON.stringify(list || []));
  } catch {
    // ignore quota errors
  }
}

function kaQueueShipmentVerification(shipmentId, items = []) {
  if (!shipmentId || !Array.isArray(items) || !items.length) return;
  const queue = kaLoadVerificationQueue();
  let entry = queue.find(q => Number(q.shipment_id) === Number(shipmentId));
  if (!entry) {
    entry = { shipment_id: shipmentId, items: [], queued_at: new Date().toISOString() };
    queue.push(entry);
  }

  const byId = new Map((entry.items || []).map(it => [Number(it.shipment_item_id), it]));
  items.forEach(it => {
    const idNum = Number(it.shipment_item_id);
    if (!Number.isFinite(idNum)) return;
    byId.set(idNum, {
      shipment_item_id: idNum,
      verification: it.verification || {}
    });
  });

  entry.items = Array.from(byId.values());
  entry.queued_at = new Date().toISOString();
  kaSaveVerificationQueue(queue);
}

async function kaSyncVerificationQueue() {
  const queue = kaLoadVerificationQueue();
  if (!Array.isArray(queue) || !queue.length) return;

  const remaining = [];

  for (const job of queue) {
    if (!job || !job.shipment_id || !Array.isArray(job.items) || !job.items.length) continue;
    try {
      await fetchJSON(`/api/shipments/${job.shipment_id}/verify-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: job.items })
      });
    } catch (err) {
      console.warn('Failed to sync queued verification', err);
      remaining.push(job);
    }
  }

  kaSaveVerificationQueue(remaining);
}

function kaLoadShipmentsCache() {
  try {
    const raw = localStorage.getItem(KA_SHIPMENTS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.shipments)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function kaSaveShipmentsCache(shipments) {
  try {
    localStorage.setItem(
      KA_SHIPMENTS_CACHE_KEY,
      JSON.stringify({
        shipments: Array.isArray(shipments) ? shipments : [],
        cached_at: new Date().toISOString()
      })
    );
  } catch {
    // ignore quota errors
  }
}

function kaOfflinePunchToEntry(punch) {
  const emp = (kaEmployees || []).find(e => Number(e.id) === Number(punch.employee_id));
  const proj = (kaProjects || []).find(p => Number(p.id) === Number(punch.project_id));
  const dateStr = punch.device_timestamp ? String(punch.device_timestamp).slice(0, 10) : kaTodayIso();
  return {
    id: `offline-${punch.client_id || punch.device_timestamp || Date.now()}`,
    client_id: punch.client_id,
    employee_id: punch.employee_id,
    employee_name: emp ? (emp.nickname || emp.name || 'Employee') : 'Employee',
    project_id: punch.project_id,
    project_name: proj ? (proj.name || 'Project') : 'Project',
    start_date: dateStr,
    end_date: dateStr,
    hours: null,
    total_pay: null,
    paid: false,
    resolved: false,
    verified: false,
    has_geo_violation: false,
    has_auto_clock_out: false,
    _offline: true
  };
}

async function kaLoadLiveWorkers() {
  if (!kaKiosk) return;

  const tbody = document.getElementById('ka-live-body');
  const tag = document.getElementById('ka-live-count-tag');
  if (!tbody) return;

  // Loading row (4 columns: Employee | Clock In | Time on Clock | Clock Out)
  tbody.innerHTML = `
    <tr><td colspan="4" class="ka-muted">(loading…)</td></tr>
  `;

  try {
    const rows = await fetchJSON(`/api/kiosks/${kaKiosk.id}/open-punches`);
    const punchRows = Array.isArray(rows) ? rows : [];
    tbody.innerHTML = '';

    const hasOverride = kaLiveProjectOverride !== null && kaLiveProjectOverride !== undefined;
    const overrideProjectId = hasOverride ? Number(kaLiveProjectOverride) : null;
    let liveProjectId = kaCurrentLiveProjectId();
    const activeSession = kaComputeActiveSession(kaSessions || []);
    const activeProjectId =
      activeSession && activeSession.project_id !== undefined && activeSession.project_id !== null
        ? Number(activeSession.project_id)
        : (kaKiosk && kaKiosk.project_id !== undefined && kaKiosk.project_id !== null
            ? Number(kaKiosk.project_id)
            : null);

    const filterByProject = (pid) =>
      pid !== null && pid !== undefined
        ? punchRows.filter(r => Number(r.project_id) === Number(pid))
        : punchRows;

    let filteredRows = filterByProject(liveProjectId);

    // Auto-switch view to a project that actually has punches so counts show immediately on load
    if (!hasOverride && filteredRows.length === 0 && punchRows.length > 0) {
      const fallbackProjectId = Number(punchRows[0].project_id);
      if (Number.isFinite(fallbackProjectId)) {
        liveProjectId = fallbackProjectId;
        kaLiveProjectOverride = fallbackProjectId;
        filteredRows = filterByProject(liveProjectId);
      }
    }

    const liveSession =
      liveProjectId !== null
        ? (kaSessions || []).find(s => Number(s.project_id) === liveProjectId)
        : null;
    const projectLabel =
      (liveSession && (liveSession.project_name || kaProjectLabelById(liveSession.project_id))) ||
      (liveProjectId !== null && kaProjectLabelById(liveProjectId)) ||
      (punchRows[0] && punchRows[0].project_name) ||
      'Project not set';

    const finalActiveProjectId = Number.isFinite(activeProjectId) ? activeProjectId : null;
    const isNonActiveView =
      liveProjectId !== null &&
      finalActiveProjectId !== null &&
      liveProjectId !== finalActiveProjectId;

    const entryCount = filteredRows.length;
    const openCount = filteredRows.filter(r => !r.clock_out_ts).length;

    const liveTitle = document.getElementById('ka-live-title');
    if (liveTitle) {
      liveTitle.textContent = `Current Workers - ${projectLabel}`;
      if (isNonActiveView) {
        const tag = document.createElement('span');
        tag.className = 'ka-live-nonactive';
        tag.textContent = '(Non-Active)';
        liveTitle.appendChild(tag);
      } else if (liveProjectId !== null && finalActiveProjectId !== null && liveProjectId === finalActiveProjectId) {
        const tag = document.createElement('span');
        tag.className = 'ka-live-active';
        tag.textContent = '(Active)';
        liveTitle.appendChild(tag);
      }
    }
    const dateLabelEl = document.getElementById('ka-live-date-label');
    if (dateLabelEl) {
      const today = new Date();
      const dateStr = today.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      dateLabelEl.textContent = dateStr;
    }

    // ----- No workers currently clocked in/out today -----
    if (!punchRows.length || filteredRows.length === 0) {
      tbody.innerHTML = `
        <tr><td colspan="4" class="ka-muted">(${liveProjectId !== null ? 'no punches today on this project' : 'no punches today on this kiosk'})</td></tr>
      `;
      if (tag) {
        tag.textContent = '0 Active workers';
        tag.className = 'ka-tag gray';
      }
      return;
    }

    const todayStr = kaTodayIso();
    const now = new Date();
    let olderThanTodayCount = 0;

    // ----- Build rows: Employee | Clock In | Time on Clock -----
    filteredRows.forEach(r => {
      const tr = document.createElement('tr');

      let clockInLabel = '–';
      let durationLabel = '–';
      let clockOutLabel = '–';
      let isOlder = false;

      if (r.clock_in_ts) {
        const dt = new Date(r.clock_in_ts);

        // Clock In (local time)
        clockInLabel = dt.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        });

        // Time on Clock (duration)
        const end = r.clock_out_ts ? new Date(r.clock_out_ts) : now;
        const diffMs = end - dt;
        const totalMin = Math.max(0, Math.round(diffMs / 60000)); // nearest minute
        const hours = Math.floor(totalMin / 60);
        const minutes = totalMin % 60;
        durationLabel = `${hours} hr${hours === 1 ? '' : 's'} ${minutes} min`;

        if (r.clock_out_ts) {
          const out = new Date(r.clock_out_ts);
          clockOutLabel = out.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
          });
        }

        // Mark if from a previous day
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, '0');
        const d = String(dt.getDate()).padStart(2, '0');
        const dateStr = `${y}-${m}-${d}`;
        if (dateStr !== todayStr) {
          isOlder = true;
          olderThanTodayCount++;
        }
      }

      tr.innerHTML = `
        <td>${r.employee_name || '(Unknown employee)'}</td>
        <td>
          ${clockInLabel}
          ${
            isOlder
              ? '<span class="ka-tag orange" style="margin-left:4px;">Prev day</span>'
              : ''
          }
        </td>
        <td>${durationLabel}</td>
        <td>${clockOutLabel}</td>
      `;

      tbody.appendChild(tr);
    });

    // Update active count tag with live data (no extra refresh required)
    if (tag) {
      const count = openCount;
      tag.textContent = `${count} Active worker${count === 1 ? '' : 's'}`;
      tag.className = `ka-tag ${count > 0 ? 'green' : 'gray'}`;
    }

    // Optional warning about previous-day open punches
    const status = document.getElementById('ka-kiosk-status');
    if (status) {
      if (olderThanTodayCount > 0) {
        kaShowStatusMessage(
          `${olderThanTodayCount} worker(s) appear to still be clocked in from a previous day. ` +
          `Make sure they are clocked out in the main admin console.`,
          'error',
          8000
        );
      } else {
        kaClearStatusIfUnlocked();
      }
    }
  } catch (err) {
    console.error('Error loading live workers:', err);
    tbody.innerHTML = `
      <tr><td colspan="4" class="ka-muted">(error loading live workers)</td></tr>
    `;
    if (tag) {
      tag.textContent = 'Error';
      tag.className = 'ka-tag orange';
    }
  }
}



function kaUpdateTimesheetHeading() {
  const heading = document.getElementById('ka-timesheet-heading');
  if (!heading) return;
  const label = kaSessionFilterLabel();
  heading.textContent = `Current Timesheet — ${label.replace(/^Active /, '').replace(/[()]/g, '')}`;
}

// --- Timesheet helpers (sessions per kiosk) ---

function kaShowView(view) {
  if (!KA_VIEWS.includes(view)) return;
  KA_VIEWS.forEach(v => {
    const section = document.getElementById(`ka-view-${v}`);
    if (section) section.classList.toggle('hidden', v !== view);
  });

  document.querySelectorAll('.ka-bottom-nav button').forEach(btn => {
    const v = btn.getAttribute('data-ka-view');
    btn.classList.toggle('active', v === view);
  });

  if (view === 'time') {
    const orientation = document.getElementById('ka-time-orientation');
    if (orientation) {
      const isLandscape = window.innerWidth > window.innerHeight;
      orientation.style.display = isLandscape ? 'none' : 'block';
    }
  }
}

function kaParseUtcTimestamp(ts) {
  if (!ts) return null;
  const normalized = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
  const dt = new Date(normalized);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function kaSessionRowMeta(session) {
  const createdAt = kaParseUtcTimestamp(session.created_at);
  const dateLabel = kaFmtDateMDY(session.date || kaTodayIso());
  const timeLabel = createdAt
    ? createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '—';
  const createdBy = session.created_by_name || '—';
  const topLine = `${dateLabel} • Started ${timeLabel}`;
  const bottomLine = `Created by ${createdBy}`;
  return `${topLine}<br>${bottomLine}`;
}

function kaSessionRangeForMode() {
  if (kaSessionFilterMode === 'yesterday') {
    const today = kaTodayIso();
    const yesterday = kaIsoOffsetDays(today, -1);
    return { start: yesterday, end: yesterday, useServerToday: false };
  }
  if (kaSessionFilterMode === 'range') {
    const start = kaSessionRangeStart || kaTodayIso();
    const end = kaSessionRangeEnd || start;
    return { start, end, useServerToday: false };
  }
  // active & today → let the server decide "today" based on its timezone
  return { start: null, end: null, useServerToday: true };
}

function kaSortSessionsByRecency(list) {
  return (Array.isArray(list) ? [...list] : []).sort((a, b) => {
    const dateDiff = (b.date || '').localeCompare(a.date || '');
    if (dateDiff !== 0) return dateDiff;
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
}

function kaComputeActiveSession(sessions) {
  if (!Array.isArray(sessions) || !sessions.length) return null;
  const sorted = kaSortSessionsByRecency(sessions);
  const activeProjectId =
    kaKiosk && kaKiosk.project_id !== undefined && kaKiosk.project_id !== null
      ? Number(kaKiosk.project_id)
      : null;
  const preferredId =
    kaActiveSessionId !== undefined && kaActiveSessionId !== null
      ? Number(kaActiveSessionId)
      : null;
  const normalizedProjectId = Number.isFinite(activeProjectId) ? activeProjectId : null;
  const normalizedPreferredId = Number.isFinite(preferredId) ? preferredId : null;

  if (normalizedPreferredId !== null) {
    const existing = sorted.find(s => Number(s.id) === normalizedPreferredId);
    if (existing && (normalizedProjectId === null || Number(existing.project_id) === normalizedProjectId)) {
      return existing;
    }
  }

  if (normalizedProjectId !== null) {
    const projectMatch = sorted.find(s => Number(s.project_id) === normalizedProjectId);
    if (projectMatch) return projectMatch;
  }

  return sorted[0] || null;
}

function kaHasMultipleProjectSessions() {
  if (!Array.isArray(kaSessions)) return false;
  const ids = new Set();
  kaSessions.forEach(s => {
    if (!s) return;
    const pid = Number(s.project_id);
    if (Number.isFinite(pid)) ids.add(pid);
  });
  return ids.size > 1;
}

function kaSessionProjectLabel(session) {
  if (!session) return 'this project';
  return (
    session.project_name ||
    kaProjectLabelById(session.project_id) ||
    (session.project_id ? `Project ${session.project_id}` : 'this project')
  );
}

async function kaConfirmActiveSessionSwitch(targetSessionId) {
  if (!targetSessionId) return true;

  const activeSession = kaComputeActiveSession(kaSessions || []);
  if (activeSession && Number(activeSession.id) === Number(targetSessionId)) {
    return true;
  }

  if (!kaHasMultipleProjectSessions()) return true;

  const targetSession = (kaSessions || []).find(s => Number(s.id) === Number(targetSessionId));
  const projectLabel = kaSessionProjectLabel(targetSession);

  return kaShowConfirmDialog(
    `Set ${projectLabel} from this timesheet as the active project for this kiosk?`,
    { okLabel: 'Set active', cancelLabel: 'Cancel' }
  );
}

function kaSessionDatesBetween(start, end, maxDays = 14) {
  const dates = [];
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return [];
  if (s > e) return [];
  let cursor = new Date(s);
  while (cursor <= e && dates.length < maxDays) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function kaSessionFilterLabel() {
  const today = kaTodayIso();
  if (kaSessionFilterMode === 'active') return `Active (${kaFmtDateMDY(today)})`;
  if (kaSessionFilterMode === 'today') return `Today (${kaFmtDateMDY(today)})`;
  if (kaSessionFilterMode === 'yesterday') {
    const y = kaIsoOffsetDays(today, -1);
    return `Yesterday (${kaFmtDateMDY(y)})`;
  }
  if (kaSessionFilterMode === 'range') {
    const start = kaSessionRangeStart || today;
    const end = kaSessionRangeEnd || start;
    const sLbl = kaFmtDateMDY(start);
    const eLbl = kaFmtDateMDY(end);
    return start === end ? sLbl : `${sLbl} → ${eLbl}`;
  }
  return 'Timesheets';
}

function kaRenderSessions() {
  const list = document.getElementById('ka-session-list');
  if (!list) return;

  const sessions = Array.isArray(kaSessions) ? kaSessions : [];
  const activeSession = kaComputeActiveSession(sessions);
  const activeSessionId =
    activeSession && activeSession.id !== undefined && activeSession.id !== null
      ? Number(activeSession.id)
      : null;
  const activeProjectId =
    activeSession && activeSession.project_id !== undefined && activeSession.project_id !== null
      ? Number(activeSession.project_id)
      : (kaKiosk && kaKiosk.project_id ? Number(kaKiosk.project_id) : null);
  const normalizedActiveSessionId = Number.isFinite(activeSessionId) ? activeSessionId : null;
  const normalizedActiveProjectId = Number.isFinite(activeProjectId) ? activeProjectId : null;
  const hasExplicitActive =
    Number.isFinite(normalizedActiveSessionId) ||
    (kaKiosk && kaKiosk.project_id !== undefined && kaKiosk.project_id !== null);
  const isSessionActive = (s) => {
    if (!s) return false;
    if (normalizedActiveSessionId !== null) return Number(s.id) === normalizedActiveSessionId;
    if (normalizedActiveProjectId !== null) return Number(s.project_id) === normalizedActiveProjectId;
    return false;
  };
  const filtered =
    kaSessionFilterMode === 'active'
      ? sessions.filter(s => {
          const isActive = isSessionActive(s);
          if (isActive) return true;
          // If no active session is configured yet, still surface sessions with open punches
          if (!hasExplicitActive) {
            return Number(s.open_count || 0) > 0;
          }
          return false;
        })
      : sessions;

  // Sort by active first, then date desc, then created_at desc
  filtered.sort((a, b) => {
    const activeDiff = Number(isSessionActive(b)) - Number(isSessionActive(a));
    if (activeDiff !== 0) return activeDiff;
    const dateDiff = (b.date || '').localeCompare(a.date || '');
    if (dateDiff !== 0) return dateDiff;
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });

  if (!filtered.length) {
    list.innerHTML =
      `<div class="ka-status ka-status-error">No timesheets have been created today. Start one to set the active project.</div>`;
    return;
  }

  const liveProjectId = kaCurrentLiveProjectId();
  list.innerHTML = '';
  filtered.forEach(s => {
    const projName = s.project_name || kaProjectLabelById(s.project_id) || '(Project)';
    const isActive = isSessionActive(s);
    const projIdNum = Number(s.project_id);
    const showWorkersBtn = Number.isFinite(projIdNum);
    const row = document.createElement('div');
    row.className = 'ka-session-row';
    row.dataset.sessionId = s.id;

    const swipe = document.createElement('div');
    swipe.className = 'ka-session-swipe';

    const main = document.createElement('div');
    main.className = 'ka-session-main';

    const head = document.createElement('div');
    head.className = 'ka-session-head';
    head.innerHTML = `
      <div class="ka-session-info">
        <span class="ka-session-active-icon ${isActive ? 'is-active' : ''}"></span>
        <div>
          <div class="ka-session-label">${projName}</div>
          <div class="ka-session-meta">${kaSessionRowMeta(s)}</div>
        </div>
      </div>
      <div class="ka-session-meta ka-session-meta-right">
        <span class="ka-session-tag">Open punches: ${s.open_count || 0}</span>
        <span class="ka-session-tag">Entries today: ${s.entry_count || 0}</span>
        ${
          showWorkersBtn
            ? `<button type="button" class="ka-session-workers-btn" data-ka-session-workers="${projIdNum}" aria-label="View workers" title="View workers">
                <img src="/icons/worker.svg" class="ka-session-workers-icon" alt="" aria-hidden="true" />
              </button>`
            : ''
        }
      </div>
    `;

    main.appendChild(head);

    const del = document.createElement('button');
    del.className = 'ka-session-delete';
    del.dataset.kaDeleteSession = s.id;
    del.type = 'button';
    del.textContent = 'Delete';

    swipe.appendChild(main);
    swipe.appendChild(del);
    row.appendChild(swipe);
    list.appendChild(row);
  });
}

async function kaLoadSessions() {
  if (!kaKiosk || !kaKiosk.id) return;
  const status = document.getElementById('ka-session-status');
  if (status) {
    status.textContent = 'Loading timesheets…';
    status.className = 'ka-status';
  }

  try {
    const { start, end, useServerToday } = kaSessionRangeForMode();
    const dates = useServerToday ? [''] : kaSessionDatesBetween(start, end);
    if (!dates.length) {
      if (status) {
        status.textContent = 'Invalid date range.';
        status.className = 'ka-status ka-status-error';
      }
      return;
    }

    const allSessions = [];
    for (const dt of dates) {
      try {
        const url = dt
          ? `/api/kiosks/${kaKiosk.id}/sessions?date=${encodeURIComponent(dt)}`
          : `/api/kiosks/${kaKiosk.id}/sessions`;
        const sessions = await fetchJSON(url);
        (Array.isArray(sessions) ? sessions : []).forEach(s => {
          allSessions.push({ ...s, date: s.date || dt || kaTodayIso() });
        });
      } catch (err) {
        console.error('Error loading kiosk sessions for date', dt, err);
      }
    }
    kaSessions = allSessions;

    const activeSession = kaComputeActiveSession(kaSessions);
    kaActiveSessionId = activeSession ? activeSession.id : null;
    if (!kaKiosk.project_id && activeSession && activeSession.project_id) {
      kaKiosk.project_id = activeSession.project_id;
    }

    kaRenderSessions();
    kaUpdateActiveProjectUI();
    await kaRefreshAdminPunchStatus();
    await kaRefreshLiveData();
    if (status) {
      status.textContent = '';
      status.className = 'ka-status';
    }
  } catch (err) {
    console.error('Error loading kiosk sessions:', err);
    if (status) {
      status.textContent = 'Error loading timesheets.';
      status.className = 'ka-status ka-status-error';
    }
  }
}

async function kaAddSession() {
  if (!kaKiosk || !kaKiosk.id) return;
  const sel = document.getElementById('ka-project-select');
  const status = document.getElementById('ka-session-status');
  const projectId = sel && sel.value ? Number(sel.value) : null;
  const adminId = kaCurrentAdmin && kaCurrentAdmin.id ? Number(kaCurrentAdmin.id) : null;

  if (!projectId) {
    if (status) {
      status.textContent = 'Pick a project to start a timesheet.';
      status.className = 'ka-status ka-status-error';
    }
    return;
  }

  if (status) {
    status.textContent = 'Starting timesheet…';
    status.className = 'ka-status';
  }

  try {
    const resp = await fetchJSON(`/api/kiosks/${kaKiosk.id}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, make_active: true, admin_id: adminId })
    });

    let isFirstToday = !!(resp && resp.first_session_today);
    if (resp && resp.session && resp.session.id) {
      kaActiveSessionId = resp.session.id;
    }

    if (resp && resp.active_project_id) {
      kaKiosk.project_id = resp.active_project_id;
    } else {
      kaKiosk.project_id = projectId;
    }
    kaLiveProjectOverride = null;
    kaNewSessionVisible = false;

    await kaLoadSessions();

    // Fallback detection: if server flag missing but this is the only session today
    if (!isFirstToday) {
      const today = kaTodayIso();
      const todaysSessions = (kaSessions || []).filter(
        s => (s.date || '').slice(0, 10) === today
      );
      if (todaysSessions.length === 1) {
        isFirstToday = true;
      }
    }

    // Always refresh admin punch status after creating a session
    await kaRefreshAdminPunchStatus();

    // Clock-in handling for current admin
    const adminOpen = kaAdminOpenPunch && kaAdminOpenPunch.open;
    const adminName = (kaCurrentAdmin && (kaCurrentAdmin.nickname || kaCurrentAdmin.name)) || 'you';
    if (!adminOpen && adminId) {
      await kaEnsureAdminClockInPrompt(projectId);
    } else if (adminOpen && adminId) {
      const currentProjId = kaAdminOpenPunch.project_id;
      const currentLabel =
        kaProjectLabelById(currentProjId) ||
        (kaAdminOpenPunch.project_name || `Project ${currentProjId}`);
      if (Number(currentProjId) !== Number(projectId)) {
        const projectLabel = kaProjectLabelById(projectId) || `Project ${projectId}`;
        const res = await kaShowClockInModal({
          projectId,
          adminName,
          message: `${adminName} is clocked in on ${currentLabel}. Switch to ${projectLabel}?`
        });
        if (res.action === 'yes') {
          try {
            await kaSwitchAdminProject(currentProjId, projectId);
            kaShowStatusMessage(
              `Switched from ${currentLabel} to ${projectLabel} for ${adminName}.`,
              'ok',
              10000
            );
          } catch (err) {
            console.error('Error switching admin project:', err);
            kaShowStatusMessage(
              'Switch failed. Please try again or clock out/in manually.',
              'error',
              8000
            );
          }
        } else if (res.action === 'dismiss') {
          kaShowClockInPrompt({
            projectId,
            adminId,
            adminName,
            message: `${adminName} is clocked in on ${currentLabel}. Switch to another timesheet?`
          });
        }
      }
    }

    if (status) {
      status.textContent = 'Timesheet started and set active.';
      status.className = 'ka-status ka-status-ok';
    }
    kaRenderProjectsSelect();
    kaUpdateActiveProjectUI();
    await kaRefreshLiveData();
    kaMarkDayStarted();

    // First active project of the day → offer to return to clock-in
    if (!kaFirstActiveSetShown && isKioskDayStarted() === false) {
      kaFirstActiveSetShown = true;
      kaShowReturnPrompt('Project set for today. Lock it in and return to clock-in?');
    }
  } catch (err) {
    console.error('Error creating timesheet:', err);
    if (status) {
      status.textContent = err && err.message ? err.message : 'Error starting timesheet.';
      status.className = 'ka-status ka-status-error';
    }
  }
}

async function kaSetActiveSession(sessionId) {
  if (!kaKiosk || !kaKiosk.id || !sessionId) return;
  const status = document.getElementById('ka-session-status');
  if (status) {
    status.textContent = 'Setting active timesheet…';
    status.className = 'ka-status';
  }

  try {
    const resp = await fetchJSON(`/api/kiosks/${kaKiosk.id}/active-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId })
    });
    kaActiveSessionId = sessionId;
    kaLiveProjectOverride = null;
    if (resp && resp.project_id) {
      kaKiosk.project_id = resp.project_id;
    }
    kaRenderProjectsSelect();
    kaRenderSessions();
    kaUpdateActiveProjectUI();
    kaMarkDayStarted();
    await kaRefreshLiveData();
    if (status) {
      status.textContent = 'Active project updated for this kiosk.';
      status.className = 'ka-status ka-status-ok';
    }
  } catch (err) {
    console.error('Error setting active session:', err);
    if (status) {
      status.textContent = err && err.message ? err.message : 'Error setting active session.';
      status.className = 'ka-status ka-status-error';
    }
  }
}

function kaShowSessionDelete(row) {
  if (!row) return;
  row.classList.add('show-delete');
}

// ─── Clock-in prompt helpers ───────────────────────────────────────────────

function kaShowClockInPrompt({ projectId, adminId, adminName, message, projectOptions, onYes, onSkip }) {
  const prompt = document.getElementById('ka-clockin-prompt');
  const text = document.getElementById('ka-clockin-prompt-text');
  const yesBtn = document.getElementById('ka-clockin-yes');
  const skipBtn = document.getElementById('ka-clockin-skip');
  const projectSel = document.getElementById('ka-clockin-project-select');
  if (!prompt || !text || !yesBtn || !skipBtn) return;

  const projectLabel = projectId ? (kaProjectLabelById(projectId) || 'this project') : 'this project';
  const dateLabel = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  text.textContent =
    message ||
    `Timesheet created for ${projectLabel} (${dateLabel}). Clock in ${adminName} as well?`;

  if (projectSel) {
    projectSel.innerHTML = '';
    if (projectOptions && projectOptions.length > 0) {
      projectOptions.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.project_id;
        opt.textContent = p.label;
        projectSel.appendChild(opt);
      });
      projectSel.style.display = 'inline-block';
    } else {
      projectSel.style.display = 'none';
    }
  }

  const cleanup = () => {
    prompt.classList.remove('show');
    yesBtn.onclick = null;
    skipBtn.onclick = null;
    if (projectSel) {
      projectSel.onchange = null;
      projectSel.innerHTML = '';
      projectSel.style.display = 'none';
    }
  };

  yesBtn.onclick = async () => {
    const targetProjectId = projectSel && projectSel.style.display !== 'none' && projectSel.value
      ? Number(projectSel.value)
      : projectId;
    try {
      if (typeof onYes === 'function') {
        await onYes(targetProjectId);
      } else {
        await fetchJSON('/api/kiosk/punch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: 'startday-' + Date.now().toString(36),
            employee_id: adminId,
            project_id: targetProjectId,
            lat: null,
            lng: null,
            device_timestamp: new Date().toISOString(),
            photo_base64: null,
            device_id: kaDeviceId
          })
        });
        await kaRefreshAdminPunchStatus();
        await kaRefreshSessionsAndLive();
        kaShowStatusMessage(
          'Timesheet set and you are clocked in on this project. You should now appear under Current Workers.',
          'ok',
          10000
        );
      }
    } catch (err) {
      console.error('Error handling clock-in prompt action:', err);
      if (!onYes) {
        kaShowStatusMessage(
          'Timesheet set, but clock-in for admin failed. Please try clocking in manually.',
          'error',
          8000
        );
      }
    } finally {
      cleanup();
    }
  };

  skipBtn.onclick = () => {
    if (typeof onSkip === 'function') {
      onSkip();
    } else {
      kaShowStatusMessage('Timesheet set. You chose not to clock in.', 'ok', 6000);
    }
    cleanup();
  };

  prompt.classList.add('show');
}

function kaShowClockInModal({ projectId, adminName, message, projectOptions }) {
  const backdrop = document.getElementById('ka-clockin-modal-backdrop');
  const text = document.getElementById('ka-clockin-modal-text');
  const title = document.getElementById('ka-clockin-modal-title');
  const closeBtn = document.getElementById('ka-clockin-modal-close');
  const yesBtn = document.getElementById('ka-clockin-modal-yes');
  const skipBtn = document.getElementById('ka-clockin-modal-skip');
  const projWrap = document.getElementById('ka-clockin-modal-project-wrap');
  const projSel = document.getElementById('ka-clockin-modal-project');
  if (!backdrop || !text || !title || !closeBtn || !yesBtn || !skipBtn) {
    return Promise.resolve({ action: 'dismiss', projectId });
  }

  const projectLabel = projectId ? (kaProjectLabelById(projectId) || 'this project') : 'this project';
  const dateLabel = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  title.textContent = 'Clock in?';
  text.textContent =
    message || `Timesheet created for ${projectLabel} (${dateLabel}). Clock in ${adminName} as well?`;

  if (projSel && projWrap) {
    projSel.innerHTML = '';
    if (projectOptions && projectOptions.length > 0) {
      projectOptions.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.project_id;
        opt.textContent = p.label;
        projSel.appendChild(opt);
      });
      projWrap.style.display = 'block';
    } else {
      projWrap.style.display = 'none';
    }
  }

  backdrop.classList.remove('hidden');

  return new Promise(resolve => {
    const cleanup = (result) => {
      backdrop.classList.add('hidden');
      yesBtn.onclick = null;
      skipBtn.onclick = null;
      closeBtn.onclick = null;
      backdrop.onclick = null;
      resolve(result);
    };

    yesBtn.onclick = () => {
      const targetProjectId =
        projSel && projWrap && projWrap.style.display !== 'none' && projSel.value
          ? Number(projSel.value)
          : projectId;
      cleanup({ action: 'yes', projectId: targetProjectId });
    };
    skipBtn.onclick = () => cleanup({ action: 'skip', projectId });
    closeBtn.onclick = () => cleanup({ action: 'dismiss', projectId });
    backdrop.onclick = (e) => {
      if (e.target === backdrop) cleanup({ action: 'dismiss', projectId });
    };
  });
}

async function kaSwitchAdminProject(fromProjectId, toProjectId) {
  if (!kaCurrentAdmin || !kaCurrentAdmin.id || !toProjectId) return;
  const adminId = Number(kaCurrentAdmin.id);
  const targetProjectId = Number(toProjectId);
  const sourceProjectId =
    fromProjectId !== undefined && fromProjectId !== null
      ? Number(fromProjectId)
      : null;

  // 1) Refresh current status
  await kaRefreshAdminPunchStatus();
  const open =
    kaAdminOpenPunch && kaAdminOpenPunch.open ? kaAdminOpenPunch : null;

  // If already on target, just refresh UI
  if (open && Number(open.project_id) === targetProjectId) {
    await kaRefreshSessionsAndLive();
    return;
  }

  // 2) If clocked in elsewhere, clock out first
  if (open) {
    const outProjectId =
      sourceProjectId !== null ? sourceProjectId : open.project_id;
    await fetchJSON('/api/kiosk/punch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: 'switch-out-' + Date.now().toString(36),
        employee_id: adminId,
        project_id: outProjectId,
        lat: null,
        lng: null,
        device_timestamp: new Date().toISOString(),
        photo_base64: null,
        device_id: kaDeviceId
      })
    });
    await kaRefreshAdminPunchStatus();
    if (
      kaAdminOpenPunch &&
      kaAdminOpenPunch.open &&
      Number(kaAdminOpenPunch.project_id) !== targetProjectId
    ) {
      throw new Error('Could not clock out of previous project. Please clock out manually.');
    }
  }

  // 3) Clock in to the target project
  await fetchJSON('/api/kiosk/punch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: 'switch-in-' + Date.now().toString(36),
      employee_id: adminId,
      project_id: targetProjectId,
      lat: null,
      lng: null,
      device_timestamp: new Date().toISOString(),
      photo_base64: null,
      device_id: kaDeviceId
    })
  });
  await kaRefreshAdminPunchStatus();
  await kaRefreshSessionsAndLive();
}

function kaHideSessionDelete(row) {
  if (!row) return;
  row.classList.remove('show-delete');
}

async function kaDeleteSession(sessionId) {
  if (!kaKiosk || !kaKiosk.id || !sessionId || !kaCurrentAdmin) return;
  const status = document.getElementById('ka-session-status');
  const session = kaSessions.find(s => Number(s.id) === Number(sessionId));
  let pin = '';

  if (session && Number(session.entry_count || 0) > 0) {
    pin = window.prompt('Enter your admin PIN to delete this timesheet (entries exist):') || '';
    if (!pin) return;
  }

  if (status) {
    status.textContent = 'Deleting timesheet…';
    status.className = 'ka-status';
  }

  try {
    await fetchJSON(`/api/kiosks/${kaKiosk.id}/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_id: kaCurrentAdmin.id, pin })
    });
    kaSessions = kaSessions.filter(s => Number(s.id) !== Number(sessionId));
    if (kaActiveSessionId && Number(kaActiveSessionId) === Number(sessionId)) {
      kaActiveSessionId = null;
    }
    if (session && kaKiosk.project_id && Number(session.project_id) === Number(kaKiosk.project_id)) {
      kaKiosk.project_id = null;
    }
    kaRenderProjectsSelect();
    kaRenderSessions();
    await kaRefreshLiveData();
    if (status) {
      status.textContent = 'Timesheet deleted.';
      status.className = 'ka-status ka-status-ok';
    }
  } catch (err) {
    console.error('Error deleting timesheet:', err);
    if (status) {
      status.textContent = err && err.message ? err.message : 'Error deleting timesheet.';
      status.className = 'ka-status ka-status-error';
    }
  }
}

function kaHandleSessionTouchStart(e) {
  const row = e.target.closest('.ka-session-row');
  if (!row || !e.touches || !e.touches.length) return;
  row.dataset.touchStartX = String(e.touches[0].clientX);
}

function kaHandleSessionTouchEnd(e) {
  const row = e.target.closest('.ka-session-row');
  if (!row) return;
  const startX = Number(row.dataset.touchStartX || 0);
  const endX = e.changedTouches && e.changedTouches.length ? e.changedTouches[0].clientX : startX;
  const delta = endX - startX;
  if (delta < -40) {
    kaShowSessionDelete(row);
  } else if (Math.abs(delta) < 10) {
    kaHideSessionDelete(row);
  }
}

// --- INIT ---

async function kaInit() {
  const params = new URLSearchParams(window.location.search);
  kaDeviceId = params.get('device_id');
  kaStartMode = params.get('start') === '1';
  kaStartEmployeeId = params.get('employee_id');

  kaHardenPinInputs();

  if (!kaDeviceId) {
    alert('Missing kiosk device ID in URL (device_id).');
    kaSetText('ka-kiosk-name', kaAdminDisplayName());
    return;
  }

  if (!kaStartEmployeeId) {
    alert('Open kiosk admin from the kiosk login screen so your admin PIN is verified.');
    window.location.href = '/kiosk';
    return;
  }

  kaUpdateTimesheetHeading();

  // Back to kiosk button
  const backBtn = document.getElementById('ka-back-to-kiosk');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = '/kiosk';
    });
  }

  // Safety: ensure all modal backdrops start hidden so they don't block clicks
  document.querySelectorAll('.ka-modal-backdrop').forEach(el => el.classList.add('hidden'));
  // Force close any lingering modals that could block interaction
  kaForceCloseAllModals();

  // Save settings (generic save)
  document
    .getElementById('ka-save-kiosk-settings')
    ?.addEventListener('click', kaSaveKioskSettings);
  document
    .getElementById('ka-pin-save')
    ?.addEventListener('click', kaHandlePinChange);
  document
    .getElementById('ka-lang-save')
    ?.addEventListener('click', kaHandleLanguageChange);
  document
    .getElementById('ka-lang-employee')
    ?.addEventListener('change', kaSyncLanguageChoice);
  document
    .getElementById('ka-namechecks-employee')
    ?.addEventListener('change', kaSyncNameOnChecksInput);
  document
    .getElementById('ka-admin-select')
    ?.addEventListener('change', kaHandleAdminChange);
  document
    .getElementById('ka-rates-pin-submit')
    ?.addEventListener('click', kaUnlockRatesWithPin);
  document
    .getElementById('ka-rates-pin-cancel')
    ?.addEventListener('click', () => kaResetRatesUI());
  document
    .getElementById('ka-rates-body')
    ?.addEventListener('click', kaHandleRateSaveClick);
  document
    .getElementById('ka-logout-btn')
    ?.addEventListener('click', kaLogoutToKiosk);
  document
    .getElementById('ka-namechecks-save')
    ?.addEventListener('click', kaHandleNameOnChecksSave);
  window.addEventListener('online', () => kaSyncPendingPins());
  window.addEventListener('online', () => kaSyncVerificationQueue());
  kaResetRatesUI();
  kaInitSettingsToggles();

  // Start-of-day button (foreman “save & clock me in”)
  document
    .getElementById('ka-start-day-btn')
    ?.addEventListener('click', kaStartDayAndClockIn);

  // Items modal controls
  document.getElementById('ka-items-modal-close')?.addEventListener('click', async () => {
    await kaCloseItemsModal();
  });
  document.getElementById('ka-items-modal-cancel')?.addEventListener('click', async () => {
    await kaCloseItemsModal();
  });
  document.getElementById('ka-items-modal-save')?.addEventListener('click', async () => {
    kaClearItemAutoSaves();
    let ok = true;
    if (kaItemsModalShipmentId) {
      ok = await kaSaveShipmentVerificationFor(kaItemsModalShipmentId);
    }
    if (ok) {
      await kaCloseItemsModal();
    }
  });

  // Docs modal controls
  const docsBackdrop = document.getElementById('ka-docs-backdrop');
  document.getElementById('ka-docs-close')?.addEventListener('click', kaCloseDocsModal);
  if (docsBackdrop) {
    docsBackdrop.addEventListener('click', (e) => {
      if (e.target === docsBackdrop) kaCloseDocsModal();
    });
  }
  const docsBody = document.getElementById('ka-docs-body');
  if (docsBody && !docsBody.dataset.bound) {
    docsBody.addEventListener('click', (e) => {
      const dl = e.target.closest('.ka-doc-download');
      if (dl && dl.href) {
        e.preventDefault();
        e.stopPropagation();
        window.open(dl.href, '_blank');
      }
    });
    docsBody.dataset.bound = '1';
  }

  // Overview upload handlers (bound on render too)
  kaBindOverviewUpload();

  // ────────────────────────────────────────────────
  // Change-project (mid-day) button
  // This SHOULD NOT clock everyone out.
  // It only updates kiosk project settings.
  // ────────────────────────────────────────────────
  const changeBtn = document.getElementById('ka-change-project-btn');
  if (changeBtn) {
    changeBtn.addEventListener('click', async () => {
      const status = document.getElementById('ka-kiosk-status');
      if (status) {
        status.textContent = 'Saving kiosk project for this tablet…';
        status.className = 'ka-status';
      }

      await kaSaveKioskSettings();

      if (status) {
        status.textContent =
          'Project updated for this tablet. Workers stay clocked in.';
        status.className = 'ka-status ka-status-ok';
      }

      // Optional refresh of active data
      kaRefreshLiveData();
    });
  }

  // Time entries date range + refresh + verify-all
  const startInput = document.getElementById('ka-time-start');
  const endInput = document.getElementById('ka-time-end');

  if (startInput && endInput) {
    const today = kaTodayIso();
    startInput.value = today;
    endInput.value = today;
  }

  document
    .getElementById('ka-time-refresh')
    ?.addEventListener('click', () => {
      kaSetTimeRange('custom');
      kaLoadTimeEntries();
    });
  document
    .getElementById('ka-time-run')
    ?.addEventListener('click', () => kaLoadTimeEntries());
  document
    .getElementById('ka-time-hide-resolved')
    ?.addEventListener('change', () => kaLoadTimeEntries());
  document
    .getElementById('ka-time-employee')
    ?.addEventListener('change', () => kaLoadTimeEntries());
  document
    .getElementById('ka-time-project')
    ?.addEventListener('change', () => kaLoadTimeEntries());
  const payToggle = document.getElementById('ka-time-show-pay');
  const approvalsToggle = document.getElementById('ka-time-show-approvals');
  const hideResolvedLabel = document.querySelector('.ka-hide-resolved');
  if (payToggle) {
    const saved = localStorage.getItem('ka_show_pay_ui');
    if (saved !== null) kaShowPayUI = saved === '1';
    payToggle.checked = kaShowPayUI;
    payToggle.addEventListener('change', () => {
      kaShowPayUI = !!payToggle.checked;
      localStorage.setItem('ka_show_pay_ui', kaShowPayUI ? '1' : '0');
      kaLoadTimeEntries();
    });
  }
  if (approvalsToggle) {
    const saved = localStorage.getItem('ka_show_approvals_ui');
    if (saved !== null) kaShowApprovalsUI = saved === '1';
    approvalsToggle.checked = kaShowApprovalsUI;
    approvalsToggle.addEventListener('change', () => {
      kaShowApprovalsUI = !!approvalsToggle.checked;
      localStorage.setItem('ka_show_approvals_ui', kaShowApprovalsUI ? '1' : '0');
      if (hideResolvedLabel) {
        hideResolvedLabel.style.display = kaShowApprovalsUI ? 'inline-flex' : 'none';
      }
      kaLoadTimeEntries();
    });
  }

  // Show/hide the toggles based on permissions
  if (payToggle) {
    payToggle.closest('label').style.display = kaCanViewPayroll() ? 'inline-flex' : 'none';
  }
  if (approvalsToggle) {
    approvalsToggle.closest('label').style.display = kaCanModifyTime() ? 'inline-flex' : 'none';
  }
  if (hideResolvedLabel) {
    hideResolvedLabel.style.display = kaShowApprovalsUI && kaCanModifyTime() ? 'inline-flex' : 'none';
    const hideResolved = document.getElementById('ka-time-hide-resolved');
    if (hideResolved) hideResolved.checked = false;
  }

  // Rate unlock modal buttons
  document.getElementById('ka-rate-cancel')?.addEventListener('click', kaCloseRateModal);
  document.getElementById('ka-rate-unlock-one')?.addEventListener('click', () => kaHandleRateUnlock(false));
  document.getElementById('ka-rate-unlock-all')?.addEventListener('click', () => kaHandleRateUnlock(true));

  document
    .getElementById('ka-time-range')
    ?.addEventListener('change', (e) => {
      const mode = e.target.value || 'today';
      kaSetTimeRange(mode);
      if (mode !== 'custom') {
        kaLoadTimeEntries();
      }
    });

  document
    .getElementById('ka-time-verify-all')
    ?.addEventListener('click', () => kaVerifyAllTimeEntriesVisible());

  kaSetTimeRange('today');

  document
    .getElementById('ka-time-action-cancel')
    ?.addEventListener('click', () => {
      document.getElementById('ka-time-action-backdrop')?.classList.add('hidden');
    });
  document
    .getElementById('ka-time-action-submit')
    ?.addEventListener('click', () => kaHandleTimeActionSubmit());

  // 🔹 Shipments tab: refresh list
  document
    .getElementById('ka-shipments-refresh')
    ?.addEventListener('click', () => kaLoadShipments());

      // 🔹 Shipments filter: change mode (ready vs all)
  document
    .getElementById('ka-shipments-filter')
    ?.addEventListener('change', () => kaLoadShipments());
  document
    .getElementById('ka-shipments-project')
    ?.addEventListener('change', () => kaLoadShipments());


  // 🔹 Bottom nav click handler
  const bottomNav = document.querySelector('.ka-bottom-nav');
  if (bottomNav) {
    bottomNav.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-ka-view]');
      if (!btn) return;
      const view = btn.getAttribute('data-ka-view');
      if (!view || !KA_VIEWS.includes(view)) return;
      kaShowView(view);
    });
  }

  // Timesheets: add + set active
  document.getElementById('ka-add-session-btn')?.addEventListener('click', kaAddSession);
  const startNewBtn = document.getElementById('ka-start-new-btn');
  if (startNewBtn) {
    startNewBtn.addEventListener('click', () => {
      kaNewSessionVisible = true;
      kaUpdateActiveProjectUI();
      const sel = document.getElementById('ka-project-select');
      if (sel) sel.focus();
    });
  }
  const sessionFilter = document.getElementById('ka-session-filter');
  const sessionRange = document.getElementById('ka-session-range');
  const rangeStart = document.getElementById('ka-session-range-start');
  const rangeEnd = document.getElementById('ka-session-range-end');
  const rangeApply = document.getElementById('ka-session-apply');

  if (rangeStart && rangeEnd) {
    const today = kaTodayIso();
    rangeStart.value = today;
    rangeEnd.value = today;
  }

  function syncRangeVisibility(mode) {
    if (sessionRange) sessionRange.classList.toggle('hidden', mode !== 'range');
    const activeOpt = sessionFilter?.querySelector('option[value="active"]');
    if (activeOpt) activeOpt.textContent = `Active (${kaFmtDateMDY(kaTodayIso())})`;
  }

  if (sessionFilter) {
    const activeOpt = sessionFilter.querySelector('option[value="active"]');
    if (activeOpt) activeOpt.textContent = `Active (${kaFmtDateMDY(kaTodayIso())})`;
    sessionFilter.value = kaSessionFilterMode;
    sessionFilter.addEventListener('change', () => {
      kaSessionFilterMode = sessionFilter.value || 'active';
      syncRangeVisibility(kaSessionFilterMode);
      kaUpdateTimesheetHeading();
      if (kaSessionFilterMode !== 'range') {
        kaLoadSessions();
      }
    });
  }

  if (rangeApply) {
    rangeApply.addEventListener('click', () => {
      if (!rangeStart || !rangeEnd) return;
      const startVal = rangeStart.value;
      const endVal = rangeEnd.value;
      if (!startVal || !endVal) {
        const status = document.getElementById('ka-session-status');
        if (status) {
          status.textContent = 'Pick both start and end dates.';
          status.className = 'ka-status ka-status-error';
        }
        return;
      }
      const dayMs = 24 * 60 * 60 * 1000;
      const spanDays =
        Math.floor((new Date(endVal).getTime() - new Date(startVal).getTime()) / dayMs) + 1;
      if (spanDays > 14) {
        const status = document.getElementById('ka-session-status');
        if (status) {
          status.textContent = 'Please choose a range of 14 days or less.';
          status.className = 'ka-status ka-status-error';
        }
        return;
      }
      const dates = kaSessionDatesBetween(startVal, endVal);
      if (!dates.length) {
        const status = document.getElementById('ka-session-status');
        if (status) {
          status.textContent = 'Invalid date range.';
          status.className = 'ka-status ka-status-error';
        }
        return;
      }
      kaSessionRangeStart = startVal;
      kaSessionRangeEnd = endVal;
      kaUpdateTimesheetHeading();
      kaLoadSessions();
    });
  }

  const sessionList = document.getElementById('ka-session-list');
  if (sessionList) {
    sessionList.addEventListener('click', async (e) => {
      const deleteBtn = e.target.closest('[data-ka-delete-session]');
      if (deleteBtn) {
        const id = Number(deleteBtn.dataset.kaDeleteSession);
        if (id) kaDeleteSession(id);
        return;
      }
      const workersBtn = e.target.closest('[data-ka-session-workers]');
      if (workersBtn) {
        const projectId = Number(workersBtn.dataset.kaSessionWorkers);
        if (Number.isFinite(projectId)) {
          kaLiveProjectOverride = projectId;
          kaRenderSessions();
          await kaLoadLiveWorkers();
        }
        return;
      }
      const row = e.target.closest('.ka-session-row');
      if (row && row.dataset.sessionId) {
        const id = Number(row.dataset.sessionId);
        if (id) {
          const confirmed = await kaConfirmActiveSessionSwitch(id);
          if (!confirmed) return;
          await kaSetActiveSession(id);
        }
      }
    });
    sessionList.addEventListener('touchstart', kaHandleSessionTouchStart, { passive: true });
    sessionList.addEventListener('touchend', kaHandleSessionTouchEnd);
  }

  // 3) Load core data in parallel
  try {
    const [kiosks, projects, employees] = await Promise.all([
      fetchJSON('/api/kiosks'),
      fetchJSON('/api/projects'),
      fetchJSON('/api/kiosk/employees'),
    ]);

    // Only keep active projects for kiosk use
    kaProjects = (projects || []).filter(
      p => p.active === undefined || p.active === null || Number(p.active) === 1
    );
    kaEmployees = employees || [];

    // Figure out which employee is running kiosk-admin (from URL ?employee_id=)
    if (kaStartEmployeeId) {
      kaCurrentAdmin =
        kaEmployees.find(
          (e) => String(e.id) === String(kaStartEmployeeId)
        ) || null;
    }

    if (!kaCurrentAdmin || !kaCurrentAdmin.is_admin) {
      alert('Admin access required. Launch kiosk admin from the kiosk login.');
      window.location.href = '/kiosk';
      return;
    }

    const unlocked = await kaRequireAdminUnlock();
    if (!unlocked) return;

    // Treat the logged-in admin as the active admin for settings by default
    if (kaCurrentAdmin && kaCurrentAdmin.id) {
      kaSelectedAdminId = String(kaCurrentAdmin.id);
    }

    // Load shipment notification UI now that we know which admin is logged in
    kaInitNotifyPanel();

    await kaLoadAccessPerms();
    kaRenderTimeFilters();
    // find kiosk by device id
    kaKiosk = (kiosks || []).find(
      (k) => String(k.device_id || '') === String(kaDeviceId)
    );

    if (!kaKiosk) {
      kaSetText('ka-kiosk-name', kaAdminDisplayName());
      kaSetText('ka-kiosk-device-id', kaDeviceId);
      const statusEl = document.getElementById('ka-kiosk-status');
      if (statusEl) {
        statusEl.textContent =
          'This device is not tied to any kiosk yet. Use the desktop admin console to assign it.';
        statusEl.classList.add('ka-status-error');
      }

      // If kiosk isn't linked, show the Settings view by default
      kaShowView('settings');
      return;
    }

    kaRenderKioskHeader();
    kaRenderProjectsSelect();
    kaRenderPinStatus();
    kaRenderAdminSelect();
    kaRenderSettingsForm();
    kaSetupStartOfDayUI();
    await kaLoadSessions();

    await Promise.all([
      kaLoadForeman(),
      kaLoadLiveWorkers(),
      kaLoadTimeEntries(),
    ]);
    kaApplyPayrollVisibility();
    kaStartLiveRefresh();
    // Preload shipments project filter
    const shipProjSel = document.getElementById('ka-shipments-project');
    if (shipProjSel) {
      shipProjSel.innerHTML = '<option value="">All projects</option>';
      (kaProjects || []).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name || '(Unnamed project)';
        shipProjSel.appendChild(opt);
      });
    }
    kaRefreshNotifyProjectSelect();

    // Hide Shipments tab for admins who don't have access
    if (!kaCanViewShipments()) {
      const shipBtn = document.querySelector(
        '.ka-bottom-nav button[data-ka-view="shipments"]'
      );
      if (shipBtn) {
        shipBtn.style.display = 'none';
      }
    }

    // 🔹 Initial shipments load (so the tab isn't empty) – only if allowed
    if (kaCanViewShipments()) {
      await kaLoadShipments();
    }

    // Try to sync any offline PIN updates now that we are loaded
    await kaSyncPendingPins();
    await kaSyncVerificationQueue();

    // Default view → Live Workers
    kaShowView('live');
  } catch (err) {
    console.error('Error initializing kiosk admin:', err);
    const msg = err && err.message ? String(err.message) : 'Error loading kiosk admin data.';
    kaShowInlineAlert(msg, 'error', 10000);
    if (/auth|login|credential/i.test(msg)) {
      setTimeout(() => {
        const next = encodeURIComponent(window.location.href);
        window.location.href = `/auth.html?next=${next}`;
      }, 400);
    }
  }
}





// --- start ---

document.addEventListener('DOMContentLoaded', kaInit);

function kaVerificationQueueHasShipment(shipmentId) {
  if (!shipmentId) return kaLoadVerificationQueue().length > 0;
  return kaLoadVerificationQueue().some(
    job => Number(job.shipment_id) === Number(shipmentId) && Array.isArray(job.items) && job.items.length
  );
}

function kaHasUnsavedItems(shipmentId) {
  const dirtyMap = kaShipmentItemsDirty.size > 0;
  const pendingTimers = kaItemAutoSaveTimers.size > 0;
  const queued = kaVerificationQueueHasShipment(shipmentId);
  return dirtyMap || pendingTimers || queued;
}

async function kaCloseItemsModal(opts = {}) {
  const force = opts.force === true;
  const shipmentId = kaItemsModalShipmentId;

  if (!force && kaHasUnsavedItems(shipmentId)) {
    const proceed = await kaShowConfirmDialog(
      'You have unsent item changes. Save all updates before closing?',
      {
        okLabel: 'Save & close',
        cancelLabel: 'Keep working',
        title: 'Unsaved item updates'
      }
    );
    if (!proceed) return;
    if (shipmentId) {
      await kaSaveShipmentVerificationFor(shipmentId, { silent: true });
    }
  }

  const modal = document.getElementById('ka-items-modal');
  if (modal) modal.classList.add('hidden');
  document.body.classList.remove('ka-modal-open');
  document.documentElement.classList.remove('ka-modal-open');
  kaClearItemAutoSaves();
  kaShipmentItemsDirty.clear();
  kaItemsFilterTerm = '';
  kaItemsFilterUnverifiedFirst = true;
  kaItemsModalShipmentId = null;
}

function kaClearItemAutoSaves() {
  kaItemAutoSaveTimers.forEach(timer => clearTimeout(timer));
  kaItemAutoSaveTimers.clear();
}

function kaForceCloseAllModals() {
  const ids = [
    'ka-return-backdrop',
    'ka-time-action-backdrop',
    'ka-confirm-backdrop'
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  kaCloseItemsModal({ force: true });
}

function kaSetItemsTab(tab) {
  const panels = document.querySelectorAll('[data-ka-items-panel]');
  const buttons = document.querySelectorAll('[data-ka-items-tab]');
  panels.forEach(panel => {
    const match = (panel.dataset.kaItemsPanel || '') === tab;
    panel.classList.toggle('active', match);
    panel.hidden = !match;
  });
  buttons.forEach(btn => {
    const match = (btn.dataset.kaItemsTab || '') === tab;
    btn.classList.toggle('active', match);
    btn.setAttribute('aria-pressed', match ? 'true' : 'false');
  });
}

function kaItemStatusLabel(status) {
  const map = {
    verified: 'Verified',
    missing: 'Missing',
    damaged: 'Damaged',
    wrong_item: 'Wrong item',
    '': 'Unverified'
  };
  return map[status] || map[''];
}

function kaFindShipmentItem(itemId) {
  if (!kaShipmentDetail || !Array.isArray(kaShipmentDetail.items)) return null;
  return kaShipmentDetail.items.find(it => Number(it.id) === Number(itemId)) || null;
}

function kaNormalizeVerification(raw, fallbackNotes = '') {
  let v = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      v = null;
    }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    v = {};
  }
  const notes = v.notes ?? fallbackNotes ?? '';
  const storage = v.storage_override ?? v.storage ?? '';
  return {
    status: v.status || '',
    notes,
    storage_override: storage || '',
    verified_at: v.verified_at ?? v.verifiedAt ?? '',
    verified_by: v.verified_by ?? v.verifiedBy ?? '',
    issue_type: v.issue_type ?? v.issueType ?? '',
    history: Array.isArray(v.history) ? v.history : []
  };
}

function kaNormalizeShipmentItems(items = []) {
  return (items || []).map(it => {
    const verification = kaNormalizeVerification(
      it.verification || it.verification_json || null,
      it.notes
    );
    return { ...it, verification };
  });
}

function kaCurrentItemState(item) {
  if (!item) return null;
  const verification = kaNormalizeVerification(item.verification || {}, item.notes);
  const pending = kaShipmentItemsDirty.get(item.id);
  if (pending) Object.assign(verification, pending);
  return { ...item, verification };
}

function kaUpdateLocalItemVerification(itemId, verification) {
  if (!kaShipmentDetail || !Array.isArray(kaShipmentDetail.items)) return;
  const idx = kaShipmentDetail.items.findIndex(it => Number(it.id) === Number(itemId));
  if (idx === -1) return;
  const existing = kaShipmentDetail.items[idx];
  const base = existing.verification || {};
  kaShipmentDetail.items[idx] = { ...existing, verification: { ...base, ...verification } };
}

function kaComputeItemSummary(items = []) {
  const counts = {
    verified: 0,
    missing: 0,
    damaged: 0,
    wrong_item: 0,
    unverified: 0
  };
  items.forEach(item => {
    const current = kaCurrentItemState(item);
    if (!current) return;
    const status = (current.verification.status || '').toLowerCase();
    const key = status || 'unverified';
    if (counts[key] !== undefined) counts[key] += 1;
  });
  return counts;
}

function kaUpdateItemsSummaryUI() {
  const wrap = document.getElementById('ka-items-summary');
  if (!wrap || !kaShipmentDetail || !kaShipmentDetail.items) return;
  const counts = kaComputeItemSummary(kaShipmentDetail.items || []);
  wrap.querySelectorAll('[data-ka-item-count]').forEach(el => {
    const key = el.dataset.kaItemCount || '';
    const val = counts[key] || 0;
    const countEl = el.querySelector('.ka-summary-count');
    if (countEl) countEl.textContent = val;
  });
}

function kaUpdateItemsSavebar() {
  const bar = document.getElementById('ka-items-savebar');
  const countEl = document.getElementById('ka-items-savebar-count');
  const unsaved = kaShipmentItemsDirty.size;
  if (countEl) countEl.textContent = unsaved;
  if (bar) {
    bar.classList.toggle('hidden', unsaved === 0);
    bar.dataset.unsaved = String(unsaved);
  }
}

function kaCloseDocsModal() {
  document.getElementById('ka-docs-backdrop')?.classList.add('hidden');
}

function kaDocMatchesShipper(doc) {
  const t = (doc.doc_type || doc.doc_label || doc.title || '').toLowerCase();
  return (
    t.includes('freight') ||
    t.includes('forwarder') ||
    t.includes('shipping') ||
    t.includes('ff') ||
    t.includes('shipper')
  );
}

function kaDocMatchesClearing(doc) {
  const t = (doc.doc_type || doc.doc_label || doc.title || '').toLowerCase();
  return (
    t.includes('customs') ||
    t.includes('clearing') ||
    t.includes('broker') ||
    t.includes('duties')
  );
}

function kaRenderDocsList(docs) {
  const list = kaFilterDocsForPermissions(docs);
  if (!Array.isArray(list) || !list.length) {
    return '<div class="ka-ship-muted">(No documents uploaded)</div>';
  }
  const items = list.map(doc => {
    const href = doc.url || doc.file_path || '#';
    const label =
      doc.label || doc.doc_label || doc.title || doc.filename || 'Document';
    const downloadName =
      doc.filename || doc.original_name || doc.title || doc.label || 'document';
    const type = doc.doc_type || doc.doc_label || '';
    const extra = type ? `<span class="ka-doc-type">${type}</span>` : '';
    return `
      <li class="ka-doc-row">
        <div class="ka-doc-line">
          <a class="ka-doc-name" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>
          ${extra}
        </div>
        <a class="ka-doc-download" href="${href}" target="_blank" rel="noopener noreferrer" download="${downloadName}" aria-label="Download document">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 3a1 1 0 0 0-1 1v9.586l-2.293-2.293a1 1 0 1 0-1.414 1.414l4 4a1 1 0 0 0 1.414 0l4-4a1 1 0 0 0-1.414-1.414L13 13.586V4a1 1 0 0 0-1-1Zm-7 14a1 1 0 0 0 0 2h14a1 1 0 1 0 0-2H5Z"/>
          </svg>
        </a>
      </li>
    `;
  });
  return `<ul>${items.join('')}</ul>`;
}

function kaBindOverviewUpload() {
  const uploadBtn = document.getElementById('ka-docs-upload-btn');
  const fileInput = document.getElementById('ka-docs-upload-files');
  const typeSelect = document.getElementById('ka-docs-upload-type');
  const statusEl = document.getElementById('ka-docs-upload-status');
  const chooseBtn = document.getElementById('ka-docs-upload-choose');
  const filenameEl = document.getElementById('ka-docs-upload-filename');

  if (!uploadBtn || !fileInput) return;

  if (chooseBtn) {
    chooseBtn.onclick = () => fileInput.click();
  }

  if (fileInput && filenameEl) {
    const updateName = () => {
      if (fileInput.files && fileInput.files.length) {
        const names = Array.from(fileInput.files).map(f => f.name).join(', ');
        filenameEl.textContent = names;
      } else {
        filenameEl.textContent = 'No Files Selected';
      }
    };
    fileInput.onchange = updateName;
    updateName();
  }

  uploadBtn.onclick = async () => {
    if (!kaItemsModalShipmentId) return;
    const files = fileInput.files;
    if (!files || !files.length) {
      if (statusEl) {
        statusEl.textContent = 'Select at least one file.';
        statusEl.className = 'ka-status ka-status-error';
      }
      return;
    }
    const form = new FormData();
    Array.from(files).forEach(f => form.append('documents', f));
    if (typeSelect && typeSelect.value) {
      form.append('doc_type', typeSelect.value);
      form.append('doc_label', typeSelect.value);
    }

    if (statusEl) {
      statusEl.textContent = 'Uploading…';
      statusEl.className = 'ka-status';
    }

    try {
      const resp = await fetch(`/api/shipments/${kaItemsModalShipmentId}/documents`, {
        method: 'POST',
        body: form,
        credentials: 'include',
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.error || data.message || 'Upload failed');
      }

      await kaReloadDocsForOverview(kaItemsModalShipmentId);
      fileInput.value = '';
      if (statusEl) {
        statusEl.textContent = 'Uploaded.';
        statusEl.className = 'ka-status ka-status-ok';
      }
    } catch (err) {
      console.error('Upload failed', err);
      if (statusEl) {
        statusEl.textContent = err.message || 'Upload failed.';
        statusEl.className = 'ka-status ka-status-error';
      }
    }
  };
}

async function kaReloadDocsForOverview(shipmentId) {
  try {
    const params = kaShipmentAuthParams();
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const resp = await fetchJSON(`/api/shipments/${shipmentId}/documents${suffix}`);
    const documents = kaFilterDocsForPermissions(kaNormalizeDocs(resp));
    if (kaShipmentDetail) {
      kaShipmentDetail.documents = documents;
      const overviewEl = document.getElementById('ka-items-overview');
      if (overviewEl) {
        const items = (kaShipmentDetail && kaShipmentDetail.items) || [];
        const shipment = (kaShipmentDetail && kaShipmentDetail.shipment) || {};
        overviewEl.innerHTML = kaRenderShipmentOverview(shipment, documents, items);
        kaBindOverviewUpload();
        kaBindPickupControls(shipment);
      }
    }
  } catch (err) {
    console.warn('Reload docs failed', err);
  }
}

function kaPickupAdminOptions() {
  return (kaEmployees || []).filter(emp => emp.is_admin).map(emp => ({
    id: emp.id,
    label: emp.nickname || emp.name || `Admin ${emp.id}`
  }));
}

function kaBindPickupControls(shipment) {
  const select = document.getElementById('ka-pickup-by');
  const otherRow = document.getElementById('ka-pickup-other-row');
  const otherInput = document.getElementById('ka-pickup-other');
  const dateInput = document.getElementById('ka-pickup-date');
  const saveBtn = document.getElementById('ka-pickup-save');
  const statusEl = document.getElementById('ka-pickup-status');
  const metaEl = document.getElementById('ka-pickup-meta');
  const modalToast = document.getElementById('ka-modal-toast');
  const updaterName = kaCurrentAdmin
    ? (kaCurrentAdmin.nickname || kaCurrentAdmin.name || 'Admin')
    : '';

  if (!select || !dateInput || !saveBtn) return;

  const admins = kaPickupAdminOptions();
  const currentName = (shipment && shipment.picked_up_by) ? String(shipment.picked_up_by).trim() : '';
  const currentDate = shipment && shipment.picked_up_date ? shipment.picked_up_date : '';
  const lastBy = shipment && shipment.picked_up_updated_by ? shipment.picked_up_updated_by : '';
  const lastAt = shipment && shipment.picked_up_updated_at ? shipment.picked_up_updated_at : '';

  // Populate select
  select.innerHTML = '<option value="">Select admin</option>';
  admins.forEach(a => {
    const opt = document.createElement('option');
    opt.value = String(a.id);
    opt.textContent = a.label;
    select.appendChild(opt);
  });
  const otherOpt = document.createElement('option');
  otherOpt.value = '__other__';
  otherOpt.textContent = 'Other';
  select.appendChild(otherOpt);

  const matchedAdmin = admins.find(a => a.label === currentName);
  if (matchedAdmin) {
    select.value = String(matchedAdmin.id);
  } else if (currentName) {
    select.value = '__other__';
    if (otherInput) otherInput.value = currentName;
  } else {
    select.value = '';
  }

  if (dateInput && currentDate) {
    dateInput.value = currentDate.slice(0, 10);
  }

  const toggleOther = () => {
    if (otherRow) {
      otherRow.classList.toggle('hidden', select.value !== '__other__');
    }
  };
  toggleOther();

  select.onchange = () => {
    toggleOther();
  };

  saveBtn.onclick = async () => {
    const adminId = kaAdminAuthId();
    const pickedVal =
      select.value === '__other__'
        ? (otherInput?.value || '').trim()
        : (admins.find(a => String(a.id) === select.value)?.label || '');
    const pickedDate = dateInput.value || '';

    if (!pickedVal) {
      if (statusEl) {
        statusEl.textContent = 'Choose or enter a pickup name.';
        statusEl.className = 'ka-status ka-status-error';
      }
      return;
    }

    const existingName = currentName;
    const existingDate = currentDate ? currentDate.slice(0, 10) : '';
    const changingExisting =
      (existingName && existingName !== pickedVal) ||
      (existingDate && existingDate !== pickedDate);

    if (changingExisting && (existingName || existingDate)) {
      const confirmMsg = `Pickup info was last set by ${lastBy || 'someone'}${lastAt ? ` on ${lastAt}` : ''}.\nDo you want to overwrite it with your changes?`;
      const ok = await kaShowConfirmDialog(confirmMsg, { okLabel: 'Overwrite', cancelLabel: 'Cancel', title: 'Update pickup' });
      if (!ok) return;
    }

    if (statusEl) {
      statusEl.textContent = 'Saving pickup…';
      statusEl.className = 'ka-status';
    }
    saveBtn.disabled = true;

    try {
      const payload = {
        picked_up_by: pickedVal,
        picked_up_date: pickedDate || null,
        employee_id: adminId,
        device_id: kaDeviceId,
        device_secret: kaGetDeviceSecret()
      };
      const resp = await fetchJSON(
        `/api/shipments/${shipment.id}/storage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }
      );
      const saved = resp && resp.shipment ? resp.shipment : resp;
      if (kaShipmentDetail && kaShipmentDetail.shipment) {
        kaShipmentDetail.shipment.picked_up_by = saved.picked_up_by || pickedVal;
        kaShipmentDetail.shipment.picked_up_date = saved.picked_up_date || pickedDate;
        kaShipmentDetail.shipment.picked_up_updated_by = saved.picked_up_updated_by || updaterName || '';
        kaShipmentDetail.shipment.picked_up_updated_at = saved.picked_up_updated_at || '';
      }
      if (statusEl) {
        statusEl.textContent = 'Pickup saved.';
        statusEl.className = 'ka-status ka-status-ok';
      }
      if (metaEl) {
        metaEl.textContent = `Last updated by ${kaShipmentDetail.shipment.picked_up_updated_by || updaterName || '—'}${kaShipmentDetail.shipment.picked_up_updated_at ? ` on ${kaShipmentDetail.shipment.picked_up_updated_at}` : ''}`;
      }
      kaShowModalToast('Pickup updated successfully.', 'ok');
      // Refresh overview to reflect updates
      const overviewEl = document.getElementById('ka-items-overview');
      if (overviewEl && kaShipmentDetail) {
        overviewEl.innerHTML = kaRenderShipmentOverview(
          kaShipmentDetail.shipment,
          kaShipmentDetail.documents || [],
          kaShipmentDetail.items || []
        );
        kaBindOverviewUpload();
        kaBindPickupControls(kaShipmentDetail.shipment);
      }
    } catch (err) {
      console.error('Pickup save failed', err);
      if (statusEl) {
        statusEl.textContent = err.message || 'Error saving pickup.';
        statusEl.className = 'ka-status ka-status-error';
      }
    } finally {
      saveBtn.disabled = false;
    }
  };
}

function kaShowModalToast(message, variant = 'ok', duration = 2500) {
  const el = document.getElementById('ka-modal-toast');
  if (!el) return;
  el.textContent = message || '';
  el.classList.remove('hidden', 'error');
  if (variant === 'error') el.classList.add('error');
  el.style.opacity = '1';
  setTimeout(() => {
    el.style.opacity = '0';
  }, duration);
  setTimeout(() => {
    el.classList.add('hidden');
    el.style.opacity = '1';
  }, duration + 300);
}

async function kaOpenDocsModal(shipmentId, mode = 'all') {
  const backdrop = document.getElementById('ka-docs-backdrop');
  const body = document.getElementById('ka-docs-body');
  const titleEl = document.getElementById('ka-docs-title');
  if (!backdrop || !body) return;

  body.innerHTML = '<div class="ka-ship-muted">(loading…)</div>';
  backdrop.classList.remove('hidden');

  try {
    const params = kaShipmentAuthParams();
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const resp = await fetchJSON(`/api/shipments/${shipmentId}/documents${suffix}`);
    const docs = kaFilterDocsForPermissions(kaNormalizeDocs(resp));

    let filtered = docs;
    if (mode === 'shipper') filtered = docs.filter(kaDocMatchesShipper);
    if (mode === 'clearing') filtered = docs.filter(kaDocMatchesClearing);

    if (titleEl) {
      const titles = {
        shipper: 'Shipper proof of payment',
        clearing: 'Clearing proof of payment',
        all: 'Shipment documents'
      };
      titleEl.textContent = titles[mode] || titles.all;
    }

    body.innerHTML = filtered.length
      ? kaRenderDocsList(filtered)
      : '<div class="ka-ship-muted">(No documents found for this category.)</div>';
  } catch (err) {
    console.error('Failed to load documents', err);
    body.innerHTML = `<div class="ka-ship-muted">(Error loading documents: ${err.message || err})</div>`;
  }
}

function kaRenderShipmentOverview(shipment, docs = [], items = []) {
  if (!shipment) {
    return '<div class="ka-ship-muted">(No shipment details)</div>';
  }

  const statusClass = kaShipStatusTone(shipment.status);
  const bolLabel = shipment.bol_number ? `BOL ${shipment.bol_number}` : '';
  const project = shipment.project_name || 'No project set';
  const vendor = shipment.vendor_name || '';
  const tracking = shipment.tracking_number || '';
  const freight = shipment.freight_forwarder || '';
  const poNumber = shipment.po_number || '—';
  const internalRef = shipment.reference || '—';
  const canViewPayments = kaCanViewPayroll();
  const expectedShip = kaFmtDateMMDDYYYY(shipment.expected_ship_date) || '—';
  const expectedArrival = kaFmtDateMMDDYYYY(shipment.expected_arrival_date) || '—';
  const pickupDate = kaFmtDateMMDDYYYY(shipment.picked_up_date) || '—';
  const pickupUpdatedBy = shipment.picked_up_updated_by || '';
  const pickupUpdatedAt = shipment.picked_up_updated_at || '';
  const storageDue = kaFmtDateMMDDYYYY(shipment.storage_due_date) || '—';
  const paidShipper = Number(shipment.shipper_paid) === 1 ? 'Paid' : 'Unpaid';
  const paidCustoms = Number(shipment.customs_paid) === 1 ? 'Paid' : 'Unpaid';
  const paidVendor = Number(shipment.vendor_paid) === 1 ? 'Paid' : 'Unpaid';
  const amountVendor = kaFmtCurrency(shipment.vendor_paid_amount);
  const amountShipper = kaFmtCurrency(shipment.shipper_paid_amount);
  const amountCustoms = kaFmtCurrency(shipment.customs_paid_amount);
  const totalPaid =
    shipment.total_paid !== undefined && shipment.total_paid !== null
      ? kaFmtCurrency(shipment.total_paid)
      : kaFmtCurrency(
          (Number(shipment.vendor_paid_amount) || 0) +
          (Number(shipment.shipper_paid_amount) || 0) +
          (Number(shipment.customs_paid_amount) || 0)
        );

  const verify = kaShipVerificationInfo(shipment);
  const normalizedDocs = kaFilterDocsForPermissions(kaNormalizeDocs(docs));
  const paymentRows = [
    { label: 'Vendor Paid', status: paidVendor, amount: amountVendor },
    { label: 'Freight Forwarder Paid', status: paidShipper, amount: amountShipper },
    { label: 'Customs Paid', status: paidCustoms, amount: amountCustoms }
  ];
  const paymentTotalsRow = canViewPayments
    ? `<div class="ka-items-overview-pair"><span>Total Paid</span><strong>${totalPaid}</strong></div>`
    : '';
  const paymentsHtml = paymentRows
    .map(row => {
      const amountPart = canViewPayments && row.amount !== '—' ? ` (${row.amount})` : '';
      return `<div class="ka-items-overview-pair"><span>${row.label}</span><strong>${row.status}${amountPart}</strong></div>`;
    })
    .join('');
  const bolDoc = kaFindDocByType(normalizedDocs, 'bol');
  const bolHref = bolDoc ? (bolDoc.url || bolDoc.file_path || null) : null;
  const otherDocs = normalizedDocs.filter(d => !bolDoc || d !== bolDoc);

  const docItems = [];
  if (bolDoc) {
    const href = bolDoc.url || bolDoc.file_path || '#';
    const label =
      bolDoc.label || bolDoc.doc_label || bolDoc.title || bolDoc.filename || 'BOL';
    docItems.push(
      `<li><a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a> (BOL)</li>`
    );
  }
  otherDocs.forEach(doc => {
    const href = doc.url || doc.file_path || '#';
    const label = doc.label || doc.doc_label || doc.title || doc.filename || 'Document';
    docItems.push(
      `<li><a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a></li>`
    );
  });

  const docsHtml = docItems.length
    ? `<ul>${docItems.join('')}</ul>`
    : '<div class="ka-ship-muted">(No documents uploaded)</div>';

  return `
    <div class="ka-items-overview-grid">
      <div class="ka-items-overview-card">
        <div class="ka-items-overview-label">Shipment</div>
        <div class="ka-items-overview-pair"><span>Status</span><strong class="ka-ship-status-pill ${statusClass}">${shipment.status || 'Status'}</strong></div>
        <div class="ka-items-overview-pair"><span>Project</span><strong>${project}</strong></div>
        ${
          bolLabel
            ? `<div class="ka-items-overview-pair"><span>BOL</span>${
                bolHref
                  ? `<a class="ka-ship-bol-pill" href="${bolHref}" target="_blank" rel="noopener noreferrer">${bolLabel}</a>`
                  : `<strong class="ka-ship-bol-pill">${bolLabel}</strong>`
              }</div>`
            : ''
        }
        <div class="ka-items-overview-pair"><span>PO #</span><strong>${poNumber}</strong></div>
        <div class="ka-items-overview-pair"><span>Internal Ref #</span><strong>${internalRef}</strong></div>
        <div class="ka-items-overview-pair"><span>Freight Forwarder</span><strong>${freight || '—'}</strong></div>
        <div class="ka-items-overview-pair"><span>Website / Order URL</span><strong>${shipment.website_url || '—'}</strong></div>
      </div>

      <div class="ka-items-overview-card">
        <div class="ka-items-overview-label">Dates & Tracking</div>
        <div class="ka-items-overview-pair"><span>Expected Ship Date</span><strong>${expectedShip || '—'}</strong></div>
        <div class="ka-items-overview-pair"><span>Expected Arrival</span><strong>${expectedArrival || '—'}</strong></div>
        <div class="ka-items-overview-pair"><span>Due for Pickup</span><strong>${storageDue || '—'}</strong></div>
        <div class="ka-items-overview-pair"><span>Tracking #</span><strong>${tracking || '—'}</strong></div>
      </div>

      <div class="ka-items-overview-card">
        <div class="ka-items-overview-label">Pickup</div>
        <div class="ka-pickup-row">
          <label for="ka-pickup-by">Picked Up By</label>
          <select id="ka-pickup-by"></select>
        </div>
        <div class="ka-pickup-row hidden" id="ka-pickup-other-row">
          <label for="ka-pickup-other">Other name</label>
          <input type="text" id="ka-pickup-other" placeholder="Enter name" />
        </div>
        <div class="ka-pickup-row">
          <label for="ka-pickup-date">Pickup Date</label>
          <input type="date" id="ka-pickup-date" />
        </div>
        <div class="ka-pickup-actions">
          <button type="button" class="btn primary btn-sm" id="ka-pickup-save">Save pickup</button>
          <span class="ka-status" id="ka-pickup-status"></span>
        </div>
        ${
          pickupUpdatedBy || pickupUpdatedAt
            ? `<div class="ka-pickup-meta" id="ka-pickup-meta">Last updated by ${pickupUpdatedBy || '—'}${pickupUpdatedAt ? ` on ${pickupUpdatedAt}` : ''}</div>`
            : `<div class="ka-pickup-meta" id="ka-pickup-meta"></div>`
        }
      </div>

      <div class="ka-items-overview-card">
        <div class="ka-items-overview-label">Payments</div>
        ${paymentsHtml}
        ${paymentTotalsRow}
      </div>

    </div>

    ${
      shipment.notes
        ? `<div class="ka-items-notes"><div class="ka-items-overview-label">Notes</div><p>${shipment.notes}</p></div>`
        : ''
    }

    <div class="ka-items-docs">
      <h4>Documents</h4>
      <div class="ka-docs-list-wrap">
        ${docsHtml}
      </div>
      <div class="ka-doc-upload-block">
        <div class="ka-doc-upload">
          <div class="ka-doc-upload-file">
            <button type="button" class="btn secondary btn-sm" id="ka-docs-upload-choose">Choose Files</button>
            <span id="ka-docs-upload-filename" class="ka-doc-file-name">No Files Selected</span>
            <input type="file" id="ka-docs-upload-files" multiple class="ka-doc-hidden-input" />
          </div>
          <label class="ka-doc-upload-type">
            <select id="ka-docs-upload-type">
              <option value="">Select type…</option>
              <option value="Shippers Invoice">Shippers Invoice</option>
              <option value="BOL">BOL</option>
              <option value="Country of Origin Certificate">Country of Origin Certificate</option>
              <option value="Tally Sheet">Tally Sheet</option>
              <option value="Freight Forwarder Proof of Payment">Freight Forwarder Proof of Payment</option>
              <option value="Customs & Clearing Proof of Payment">Customs & Clearing Proof of Payment</option>
              <option value="Other">Other</option>
            </select>
          </label>
          <button type="button" class="btn primary btn-sm" id="ka-docs-upload-btn">Upload</button>
        </div>
        <div id="ka-docs-upload-status" class="ka-status"></div>
      </div>
    </div>
  `;
}

async function kaOpenItemsModal(shipmentId) {
  const modal = document.getElementById('ka-items-modal');
  const body = document.getElementById('ka-items-modal-body');
  const titleEl = document.getElementById('ka-items-modal-title');
  const subEl = document.getElementById('ka-items-modal-sub');
  const overviewEl = document.getElementById('ka-items-overview');
  if (!modal || !body || !titleEl || !overviewEl) return;

  document.body.classList.add('ka-modal-open');
  document.documentElement.classList.add('ka-modal-open');

  kaShipmentItemsDirty.clear();
  kaClearItemAutoSaves();
  kaItemsModalShipmentId = shipmentId;
  kaSetItemsTab('items');

  if (!modal.dataset.tabsBound) {
    const tabBtns = modal.querySelectorAll('[data-ka-items-tab]');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.kaItemsTab || 'items';
        kaSetItemsTab(tab);
      });
    });
    modal.dataset.tabsBound = '1';
  }

  // Always load fresh detail for this shipment
  let shipment = null;
  let items = [];
  let documents = [];
  try {
    const params = kaShipmentAuthParams();
    params.set('shipment_id', shipmentId);
    const report = await fetchJSON(
      '/api/reports/shipment-verification?' + params.toString()
    );
    shipment = report.shipment || {};
    items = kaNormalizeShipmentItems(Array.isArray(report.items) ? report.items : []);
    kaShipmentDetail = { shipment, items };
  } catch (err) {
    console.error('Failed to load shipment for items modal', err);
    body.innerHTML = '<div class="ka-ship-muted">(Error loading items)</div>';
    overviewEl.innerHTML = '<div class="ka-ship-muted">(Error loading overview)</div>';
    modal.classList.remove('hidden');
    return;
  }

  try {
    const docParams = kaShipmentAuthParams();
    const suffix = docParams.toString() ? `?${docParams.toString()}` : '';
    const resp = await fetchJSON(`/api/shipments/${shipmentId}/documents${suffix}`);
    documents = kaFilterDocsForPermissions(kaNormalizeDocs(resp));
  } catch (err) {
    console.warn('Failed to load shipment documents', err);
    documents = [];
  }

  kaShipmentDetail = { shipment, items, documents };

  const bolDoc = kaFindDocByType(documents, 'bol');
  kaSetBolLink(shipmentId, bolDoc);

  titleEl.textContent =
    (shipment.title || shipment.reference || `Shipment #${shipment.id || shipmentId || ''}`);
  if (subEl) {
    subEl.textContent = '';
  }

  overviewEl.innerHTML = kaRenderShipmentOverview(shipment, documents, items);
  kaBindOverviewUpload();
  kaBindPickupControls(shipment);

  const hasItems = Array.isArray(items) && items.length > 0;

  body.innerHTML = `
    <div class="ka-items-toolbar">
      <div class="ka-items-summary" id="ka-items-summary">
        <div class="ka-summary-pill status-verified" data-ka-item-count="verified">
          <span class="ka-summary-label">Verified</span>
          <span class="ka-summary-count">0</span>
        </div>
        <div class="ka-summary-pill status-missing" data-ka-item-count="missing">
          <span class="ka-summary-label">Missing</span>
          <span class="ka-summary-count">0</span>
        </div>
        <div class="ka-summary-pill status-damaged" data-ka-item-count="damaged">
          <span class="ka-summary-label">Damaged</span>
          <span class="ka-summary-count">0</span>
        </div>
        <div class="ka-summary-pill status-wrong_item" data-ka-item-count="wrong_item">
          <span class="ka-summary-label">Wrong</span>
          <span class="ka-summary-count">0</span>
        </div>
        <div class="ka-summary-pill status-unverified" data-ka-item-count="unverified">
          <span class="ka-summary-label">Unverified</span>
          <span class="ka-summary-count">0</span>
        </div>
      </div>
      <div class="ka-items-actions">
        <input type="search" id="ka-items-search" placeholder="Search description or SKU" value="${kaItemsFilterTerm}" />
      </div>
    </div>

    <div id="ka-items-list" class="ka-items-list">
      ${hasItems ? '' : '<div class="ka-ship-muted">(No items on this shipment)</div>'}
    </div>

    <div class="ka-items-bottom-actions">
      <button type="button" class="btn primary btn-sm" id="ka-items-save-close">Save & close</button>
    </div>

    <div id="ka-items-savebar" class="ka-items-savebar hidden">
      <div class="ka-items-savebar-text"><span id="ka-items-savebar-count">0</span> unsaved changes</div>
      <div class="ka-items-savebar-actions">
        <button type="button" class="btn secondary btn-sm" id="ka-items-undo">Undo changes</button>
        <button type="button" class="btn primary btn-sm" id="ka-items-save-now">Save now</button>
      </div>
    </div>
  `;

  if (hasItems) {
    kaRenderItemsList(shipmentId);
  }
  kaUpdateItemsSummaryUI();
  kaUpdateItemsSavebar();

  const searchEl = document.getElementById('ka-items-search');
  if (searchEl && !searchEl.dataset.bound) {
    searchEl.addEventListener('input', () => {
      kaItemsFilterTerm = searchEl.value || '';
      kaRenderItemsList(shipmentId);
    });
    searchEl.dataset.bound = '1';
  }

  const saveNowBtn = document.getElementById('ka-items-save-now');
  if (saveNowBtn && !saveNowBtn.dataset.bound) {
    saveNowBtn.addEventListener('click', () => {
      kaClearItemAutoSaves();
      kaSaveShipmentVerificationFor(shipmentId);
    });
    saveNowBtn.dataset.bound = '1';
  }

  const saveCloseBtn = document.getElementById('ka-items-save-close');
  if (saveCloseBtn && !saveCloseBtn.dataset.bound) {
    saveCloseBtn.addEventListener('click', async () => {
      kaClearItemAutoSaves();
      let ok = true;
      if (shipmentId) {
        ok = await kaSaveShipmentVerificationFor(shipmentId);
      }
      if (ok) {
        kaCloseItemsModal();
      }
    });
    saveCloseBtn.dataset.bound = '1';
  }

  const undoBtn = document.getElementById('ka-items-undo');
  if (undoBtn && !undoBtn.dataset.bound) {
    undoBtn.addEventListener('click', () => {
      kaClearItemAutoSaves();
      kaShipmentItemsDirty.clear();
      kaOpenItemsModal(shipmentId);
    });
    undoBtn.dataset.bound = '1';
  }

  modal.classList.remove('hidden');
}

function kaRenderItemsList(shipmentId) {
  const listEl = document.getElementById('ka-items-list');
  if (!listEl || !kaShipmentDetail) return;

  const baseItems = Array.isArray(kaShipmentDetail.items) ? [...kaShipmentDetail.items] : [];
  if (!baseItems.length) {
    listEl.innerHTML = '<div class="ka-ship-muted">(No items on this shipment)</div>';
    return;
  }

  const term = (kaItemsFilterTerm || '').toLowerCase().trim();
  let items = baseItems
    .map(kaCurrentItemState)
    .filter(Boolean)
    .filter(item => {
      if (!term) return true;
      const hay = [
        item.description || '',
        item.sku || '',
        item.verification?.notes || '',
      ].join(' ').toLowerCase();
      return hay.includes(term);
    });

  if (kaItemsFilterUnverifiedFirst) {
    const order = {
      '': 0,
      unverified: 0,
      missing: 1,
      damaged: 2,
      wrong_item: 3,
      verified: 4
    };
    items.sort((a, b) => {
      const aStatus = (a.verification.status || '').toLowerCase();
      const bStatus = (b.verification.status || '').toLowerCase();
      const aRank = order[aStatus] ?? 99;
      const bRank = order[bStatus] ?? 99;
      if (aRank !== bRank) return aRank - bRank;
      return Number(a.id) - Number(b.id);
    });
  }

  listEl.innerHTML = '';

  if (!items.length) {
    listEl.innerHTML = '<div class="ka-ship-muted">(No items match this search)</div>';
    return;
  }

  items.forEach(item => {
    const row = kaRenderItemRow(item, shipmentId);
    if (row) listEl.appendChild(row);
  });

  kaUpdateItemsSummaryUI();
}

function kaRenderItemRow(item, shipmentId) {
  if (!item) return null;
  const verification = item.verification || {};
  const status = (verification.status || '').toLowerCase();
  const notes = verification.notes || '';
  const storage = verification.storage_override || '';
  const lastBy = verification.verified_by || '';
  const lastAt = verification.verified_at ? verification.verified_at.slice(0, 10) : '';
  const qty = item.quantity !== undefined ? item.quantity : '';
  const unit = item.unit || '';
  const sku = item.sku || '';
  const vendorName = item.vendor_name || '';

  const row = document.createElement('div');
  row.className = 'ka-item-row';
  row.dataset.itemId = item.id;
  row.classList.add(status ? `status-${status}` : 'status-unverified');
  if (kaShipmentItemsDirty.has(Number(item.id))) row.classList.add('is-unsaved');

  const statuses = [
    { val: '', label: 'Unverified' },
    { val: 'verified', label: 'Verified' },
    { val: 'missing', label: 'Missing' },
    { val: 'damaged', label: 'Damaged' },
    { val: 'wrong_item', label: 'Wrong item' }
  ];

  const hasNotesOpen = !!notes || !!storage;
  const statusLabel = kaItemStatusLabel(status);

  row.innerHTML = `
    <div class="ka-item-row-head">
      <div>
        <div class="ka-item-title">${item.description || '(No description)'}</div>
        <div class="ka-item-meta-line">
          <span>Qty: ${qty}${unit ? ` ${unit}` : ''}</span>
          ${sku ? `<span class="ka-item-meta-dot">•</span><span>SKU: ${sku}</span>` : ''}
          ${vendorName ? `<span class="ka-item-meta-dot">•</span><span>Vendor: ${vendorName}</span>` : ''}
        </div>
      </div>
      <div class="ka-item-head-right">
        <span class="ka-item-status-chip">${statusLabel}</span>
        <button type="button" class="ka-item-collapse" data-ka-collapse="${item.id}" aria-label="Collapse item">⌄</button>
      </div>
    </div>
    <div class="ka-item-body">
      <div class="ka-item-meta-line meta-right">
        <span>Qty: ${qty}${unit ? ` ${unit}` : ''}</span>
        ${sku ? `<span class="ka-item-meta-dot">•</span><span>SKU: ${sku}</span>` : ''}
        ${vendorName ? `<span class="ka-item-meta-dot">•</span><span>Vendor: ${vendorName}</span>` : ''}
      </div>
      <div class="ka-item-divider"></div>

      <div class="ka-item-status-group" data-ka-status-buttons="${item.id}">
        ${statuses
          .map(
            s => `<button type="button"
              class="ka-item-status-btn ${status === s.val ? 'active' : ''} status-${s.val || 'unverified'}"
              data-ka-item-status="${s.val}">${s.label}</button>`
          )
          .join('')}
      </div>

      <div class="ka-item-note-toggle">
        <button type="button" class="ka-note-toggle-btn" data-ka-toggle-notes="${item.id}">
          <span class="ka-note-label">${hasNotesOpen ? 'Hide notes' : 'Notes & storage'}</span>
          <span class="ka-note-chevron">${hasNotesOpen ? '▴' : '▾'}</span>
        </button>
      </div>

      <div class="ka-item-row-notes ${hasNotesOpen ? 'open' : ''}" data-ka-notes="${item.id}">
        <label>
          <span>Notes</span>
          <textarea rows="2" data-ship-item-notes-id="${item.id}">${notes}</textarea>
        </label>
        <label>
          <span>Storage details</span>
          <textarea rows="2" data-ship-item-storage-id="${item.id}">${storage}</textarea>
        </label>
      </div>

      <div class="ka-item-row-footer">
        <div class="ka-item-last">
          <span class="ka-item-unsaved-dot ${kaShipmentItemsDirty.has(Number(item.id)) ? '' : 'hidden'}" aria-hidden="true">●</span>
          <span class="ka-item-last-meta">${
            lastBy || lastAt ? `${lastBy || ''}${lastAt ? ` · ${lastAt}` : ''}` : 'Not verified yet'
          }</span>
        </div>
        <div class="ka-item-row-actions">
          <button type="button" class="btn secondary btn-sm" data-ka-save-item="${item.id}">Save now</button>
        </div>
      </div>
    </div>
  `;

  const statusButtons = Array.from(row.querySelectorAll('[data-ka-item-status]'));
  const notesEl = row.querySelector(`textarea[data-ship-item-notes-id="${item.id}"]`);
  const storageEl = row.querySelector(`textarea[data-ship-item-storage-id="${item.id}"]`);
  const toggleBtn = row.querySelector(`[data-ka-toggle-notes="${item.id}"]`);
  const saveBtn = row.querySelector(`[data-ka-save-item="${item.id}"]`);
  const notesWrap = row.querySelector(`[data-ka-notes="${item.id}"]`);
  const statusChip = row.querySelector('.ka-item-status-chip');
  const collapseBtn = row.querySelector(`[data-ka-collapse="${item.id}"]`);
  const unsavedDot = row.querySelector('.ka-item-unsaved-dot');
  const lastMeta = row.querySelector('.ka-item-last-meta');

  const applyStatusStyle = (val) => {
    const allStatuses = ['verified', 'missing', 'damaged', 'wrong_item', 'unverified'];
    allStatuses.forEach(s => row.classList.remove(`status-${s}`));
    row.classList.add(`status-${val || 'unverified'}`);
  };

  const setActiveStatus = (val) => {
    statusButtons.forEach(btn => {
      const match = (btn.dataset.kaItemStatus || '') === val;
      btn.classList.toggle('active', match);
    });
    applyStatusStyle(val);
    if (statusChip) statusChip.textContent = kaItemStatusLabel(val);
  };

  const buildPayload = (statusOverride = null) => {
    const nowIso = new Date().toISOString();
    const admin = kaCurrentAdmin || {};
    const verifiedBy = admin.nickname || admin.name || 'Field Admin';
    const activeBtn = statusButtons.find(btn => btn.classList.contains('active'));
    const newStatus =
      statusOverride !== null ? statusOverride : (activeBtn ? activeBtn.dataset.kaItemStatus || '' : '');

    return {
      status: newStatus,
      notes: notesEl ? notesEl.value || '' : '',
      storage_override: storageEl ? storageEl.value || '' : '',
      verified_at: nowIso,
      verified_by: verifiedBy,
    };
  };

  const refreshUnsavedState = (isDirty) => {
    if (isDirty) {
      row.classList.add('is-unsaved');
      unsavedDot?.classList.remove('hidden');
    } else {
      row.classList.remove('is-unsaved');
      unsavedDot?.classList.add('hidden');
    }
  };

  const scheduleAutoSave = () => {
    const itemIdNum = Number(item.id);
    const existing = kaItemAutoSaveTimers.get(itemIdNum);
    if (existing) clearTimeout(existing);
    kaItemAutoSaveTimers.set(
      itemIdNum,
      setTimeout(async () => {
        await kaSaveShipmentVerificationFor(shipmentId, { onlyItemId: itemIdNum, silent: true });
      }, 900)
    );
  };

  const markDirty = (statusOverride = null, { skipAuto = false } = {}) => {
    const payload = buildPayload(statusOverride);
    const itemIdNum = Number(item.id);
    const existingTimer = kaItemAutoSaveTimers.get(itemIdNum);
    if (existingTimer) {
      clearTimeout(existingTimer);
      kaItemAutoSaveTimers.delete(itemIdNum);
    }
    kaShipmentItemsDirty.set(itemIdNum, payload);
    kaUpdateLocalItemVerification(itemIdNum, payload);
    kaUpdateItemsSavebar();
    kaUpdateItemsSummaryUI();
    refreshUnsavedState(true);
    if (statusChip) statusChip.textContent = kaItemStatusLabel(payload.status || '');

    if (lastMeta) {
      lastMeta.textContent = `${payload.verified_by || ''}${
        payload.verified_at ? ` · ${payload.verified_at.slice(0, 10)}` : ''
      }`;
    }

    if (!skipAuto) scheduleAutoSave();
  };

  statusButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.kaItemStatus || '';
      setActiveStatus(val);
      markDirty(val);
    });
  });

  notesEl?.addEventListener('blur', () => markDirty(null));
  storageEl?.addEventListener('blur', () => markDirty(null));

  if (toggleBtn && notesWrap) {
    toggleBtn.addEventListener('click', () => {
      const nowOpen = notesWrap.classList.toggle('open');
      const chevron = toggleBtn.querySelector('.ka-note-chevron');
      const label = toggleBtn.querySelector('.ka-note-label');
      if (label) label.textContent = nowOpen ? 'Hide notes' : 'Notes & storage';
      if (chevron) chevron.textContent = nowOpen ? '▴' : '▾';
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const itemIdNum = Number(item.id);
      markDirty(null, { skipAuto: true });
      const ok = await kaSaveShipmentVerificationFor(shipmentId, { onlyItemId: itemIdNum });
      if (ok) {
        refreshUnsavedState(false);
        row.classList.add('collapsed');
      }
    });
  }

  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      const collapsed = row.classList.toggle('collapsed');
      // arrow stays the same; rotation handled in CSS when collapsed
    });
  }

  return row;
}

function kaMarkAllItemsVerified(shipmentId) {
  if (!kaShipmentDetail || !Array.isArray(kaShipmentDetail.items)) return;
  const nowIso = new Date().toISOString();
  const admin = kaCurrentAdmin || {};
  const verifiedBy = admin.nickname || admin.name || 'Field Admin';

  kaShipmentDetail.items.forEach(item => {
    const existing = kaCurrentItemState(item) || { verification: {} };
    const payload = {
      status: 'verified',
      notes: existing.verification.notes || '',
      storage_override: existing.verification.storage_override || '',
      verified_at: nowIso,
      verified_by: verifiedBy,
    };
    kaShipmentItemsDirty.set(Number(item.id), payload);
    kaUpdateLocalItemVerification(item.id, payload);
  });

  kaRenderItemsList(shipmentId);
  kaUpdateItemsSavebar();
  kaUpdateItemsSummaryUI();
}

async function kaSaveShipmentVerificationFor(shipmentId, opts = {}) {
  const { onlyItemId = null, silent = false } = opts || {};
  if (!shipmentId) return false;

  const items = [];
  kaShipmentItemsDirty.forEach((verification, key) => {
    const idNum = Number(key);
    if (onlyItemId !== null && Number(onlyItemId) !== idNum) return;
    items.push({
      shipment_item_id: idNum,
      verification
    });
  });

  if (!items.length) return true;

  try {
    const res = await fetchJSON(`/api/shipments/${shipmentId}/verify-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items })
    });

    items.forEach(row => {
      kaShipmentItemsDirty.delete(Number(row.shipment_item_id));
      kaUpdateLocalItemVerification(row.shipment_item_id, row.verification || {});
      kaSetItemSavedUI(row.shipment_item_id);
    });

    kaUpdateItemsSavebar();
    kaUpdateItemsSummaryUI();

    if (res && res.items_verified && kaShipments && kaItemsModalShipmentId) {
      const match = kaShipments.find(s => Number(s.id) === Number(kaItemsModalShipmentId));
      if (match) match.items_verified = 1;
    }

    return true;
  } catch (err) {
    console.error('Failed to save shipment verification', err);
    const offlineLikely =
      !navigator.onLine ||
      (err && typeof err.status === 'number' && err.status === 0);

    if (offlineLikely) {
      kaQueueShipmentVerification(shipmentId, items);
      items.forEach(row => {
        kaShipmentItemsDirty.delete(Number(row.shipment_item_id));
        kaUpdateLocalItemVerification(row.shipment_item_id, row.verification || {});
        kaSetItemSavedUI(row.shipment_item_id);
      });
      kaUpdateItemsSavebar();
      kaUpdateItemsSummaryUI();

      if (!silent) {
        kaShowInlineAlert('Offline: verification saved locally and will sync when online.', 'error', 6000);
      }
      return true;
    }

    if (!silent) {
      const msg = err && err.message ? err.message : 'Failed to save verification.';
      kaShowInlineAlert(msg, 'error', 8000);
    }
    return false;
  }
}

function kaSetItemSavedUI(itemId) {
  const row = document.querySelector(`.ka-item-row[data-item-id="${itemId}"]`);
  const item = kaFindShipmentItem(itemId);
  const current = kaCurrentItemState(item);
  const status = current && current.verification ? (current.verification.status || '').toLowerCase() : '';

  if (row) {
    row.classList.remove('is-unsaved');
    row.classList.remove(
      'status-verified',
      'status-missing',
      'status-damaged',
      'status-wrong_item',
      'status-unverified'
    );
    row.classList.add(`status-${status || 'unverified'}`);
    const dot = row.querySelector('.ka-item-unsaved-dot');
    if (dot) dot.classList.add('hidden');
    const lastMeta = row.querySelector('.ka-item-last-meta');
    if (lastMeta && current && current.verification) {
      const lastBy = current.verification.verified_by || '';
      const lastAt = current.verification.verified_at ? current.verification.verified_at.slice(0, 10) : '';
      lastMeta.textContent = lastBy || lastAt ? `${lastBy || ''}${lastAt ? ` · ${lastAt}` : ''}` : 'Not verified yet';
    }
  }
}


function kaSetupStartOfDayUI() {
  const btn = document.getElementById("ka-start-day-btn");
  const greetingEl = document.getElementById("ka-startday-greeting");

  const changeBtn = document.getElementById("ka-change-project-btn");
  const warningEl = document.getElementById("ka-project-change-warning");

  if (!btn || !greetingEl) return;

  if (!kaStartMode) {
    // Mid-day admin mode:
    // - Hide start-of-day button & greeting
    // - Show mid-day change-project warning/button
    btn.style.display = "none";
    greetingEl.textContent = "";

    if (changeBtn) changeBtn.style.display = "inline-flex";
    if (warningEl) warningEl.style.display = "block";

    return;
  }

  // Start-of-day mode:
  // - Show "Save Project & Clock Me In"
  // - Hide mid-day warning/button
  btn.style.display = "inline-flex";
  if (changeBtn) changeBtn.style.display = "none";
  if (warningEl) warningEl.style.display = "none";

  // No greeting banner
  greetingEl.textContent = '';
}


async function kaStartDayAndClockIn() {
  if (!kaKiosk) return;

  const sel = document.getElementById('ka-project-select');
  const status = document.getElementById('ka-kiosk-status');

  const projectId = sel && sel.value ? Number(sel.value) : null;

  if (!projectId) {
    if (status) {
      status.textContent = 'Select today\'s project before starting the day.';
      status.className = 'ka-status ka-status-error';
    }
    return;
  }

  if (!kaStartEmployeeId) {
    if (status) {
      status.textContent = 'No foreman employee was provided in the URL.';
      status.className = 'ka-status ka-status-error';
    }
    return;
  }

  if (status) {
    kaShowStatusMessage('Starting day and clocking you in…', 'ok', 6000);
  }

  try {
    // 1) Save kiosk settings (same as kaSaveKioskSettings)
    await fetchJSON('/api/kiosks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: kaKiosk.id,
        name: kaKiosk.name,
        location: kaKiosk.location,
        device_id: kaKiosk.device_id,
        project_id: projectId
      })
    });

    kaKiosk.project_id = projectId;

    // 1b) Log a kiosk session and make it active so the worker screen is locked in
    let firstSessionToday = false;
    try {
      const sessionResp = await fetchJSON(`/api/kiosks/${kaKiosk.id}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          make_active: true,
          admin_id: Number(kaStartEmployeeId)
        })
      });
      firstSessionToday = !!(sessionResp && sessionResp.first_session_today);
      if (sessionResp && sessionResp.session && sessionResp.session.id) {
        kaActiveSessionId = sessionResp.session.id;
      }
      await kaLoadSessions();
      // Fallback detection in case the server did not flag it
      const today = kaTodayIso();
      const todaysSessions = (kaSessions || []).filter(
        s => (s.date || '').slice(0, 10) === today
      );
      if (!firstSessionToday && todaysSessions.length === 1) {
        firstSessionToday = true;
      }
    } catch (e) {
      console.warn('Could not log kiosk session', e);
    }

    // 2) Ask the admin if they want to clock in on this timesheet
    const adminId = Number(kaStartEmployeeId);
    await kaRefreshAdminPunchStatus();
    const adminOpen = kaAdminOpenPunch && kaAdminOpenPunch.open;
    const adminName = (kaCurrentAdmin && (kaCurrentAdmin.nickname || kaCurrentAdmin.name)) || 'you';
    if (!adminOpen) {
      const projectOptions = kaTodaySessionProjects();
      kaShowClockInPrompt({
        projectId,
        adminId,
        adminName,
        message: `${adminName} is not clocked in. Clock in to a timesheet for today?`,
        projectOptions
      });
    } else if (adminOpen) {
      const currentProjId = kaAdminOpenPunch.project_id;
      const currentLabel =
        kaProjectLabelById(currentProjId) ||
        (kaAdminOpenPunch.project_name || `Project ${currentProjId}`);
      if (Number(currentProjId) !== Number(projectId)) {
        const projectLabel = kaProjectLabelById(projectId) || `Project ${projectId}`;
        kaShowClockInPrompt({
          projectId,
          adminId,
          adminName,
          message: `${adminName} is clocked in on ${currentLabel}. Clock out of that and clock in to ${projectLabel}?`,
          onYes: async () => {
            try {
              await kaSwitchAdminProject(currentProjId, projectId);
              kaShowStatusMessage(
                `Switched from ${currentLabel} to ${projectLabel} for ${adminName}.`,
                'ok',
                10000
              );
            } catch (err) {
              console.error('Error switching admin project:', err);
              kaShowStatusMessage(
                'Switch failed. Please try again or clock out/in manually.',
                'error',
                8000
              );
            }
          },
          onSkip: () => {
            kaShowStatusMessage('No changes made to your clock-in.', 'ok', 5000);
          }
        });
      }
    }

    // 3) Optionally tell the server this employee is the foreman for today
    //    (Adjust this to match your existing API if it's named differently)
    try {
      await fetchJSON(`/api/kiosks/${kaKiosk.id}/foreman-today`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    foreman_employee_id: Number(kaStartEmployeeId),
    set_by_employee_id: Number(kaStartEmployeeId),
  }),
});
    } catch (e) {
      console.warn('Foreman assignment API failed or not implemented (optional):', e);
    }

    // 4) Mark day started in localStorage
    kaMarkDayStarted();

    // 5) Update UI / hint
    if (status) {
      kaShowStatusMessage('Timesheet set.', 'ok', 10000);
    }
    // Offer to return to the kiosk so workers can start clocking in immediately
    kaShowReturnPrompt('Project set and you are clocked in. Go back to the worker clock-in screen?');

    // Hide the start-of-day button so they don't repeat it
    const btn = document.getElementById('ka-start-day-btn');
    if (btn) btn.style.display = 'none';

    // Refresh live workers table so you show up there
    await kaRefreshLiveData();
  } catch (err) {
    console.error('Error starting day and clocking in foreman:', err);
    if (status) {
      status.textContent = 'Error starting day. Please try again.';
      status.className = 'ka-status ka-status-error';
    }
  }
}



// --- Render header + project + photo toggle ---

function kaRenderKioskHeader() {
  kaSetText('ka-kiosk-name', kaAdminDisplayName());
  kaSetText('ka-kiosk-device-id', kaKiosk.device_id || '(none)');
}

function kaRenderProjectsSelect() {
  const sel = document.getElementById('ka-project-select');
  if (!sel) return;

  const projects = Array.isArray(kaProjects) ? kaProjects : [];
  const activeProjects = projects.filter(
    p => p.active === undefined || p.active === null || Number(p.active) === 1
  );

  // If nothing was returned from the server, show a clear placeholder
  if (!activeProjects.length) {
    sel.innerHTML = '<option value="">(No projects available)</option>';
    return;
  }

  sel.innerHTML = '<option value="">(Select a project)</option>';

  activeProjects.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name || '(Unnamed project)';
    sel.appendChild(opt);
  });

  if (kaKiosk.project_id) {
    const hasActiveOption = sel.querySelector(`option[value="${kaKiosk.project_id}"]`);
    if (hasActiveOption) {
      sel.value = String(kaKiosk.project_id);
    } else {
      // Keep showing the current project even if it became inactive
      const opt = document.createElement('option');
      opt.value = kaKiosk.project_id;
      opt.textContent = '(Inactive project)';
      opt.selected = true;
      sel.appendChild(opt);
    }
  }

}

function kaRenderTimeFilters() {
  const empSel = document.getElementById('ka-time-employee');
  const projSel = document.getElementById('ka-time-project');

  if (empSel) {
    const prev = empSel.value;
    empSel.innerHTML = '<option value="">All employees</option>';
    const sortedEmps = Array.isArray(kaEmployees)
      ? [...kaEmployees].sort((a, b) => {
          const aName = (a.nickname || a.name || '').toLowerCase();
          const bName = (b.nickname || b.name || '').toLowerCase();
          return aName.localeCompare(bName);
        })
      : [];
    sortedEmps.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = e.nickname || e.name || '(Employee)';
      empSel.appendChild(opt);
    });
    if (prev) empSel.value = prev;
  }

  if (projSel) {
    const prev = projSel.value;
    projSel.innerHTML = '<option value="">All projects</option>';
    const sortedProjs = Array.isArray(kaProjects)
      ? [...kaProjects].sort((a, b) => {
          const aName = (a.name || '').toLowerCase();
          const bName = (b.name || '').toLowerCase();
          return aName.localeCompare(bName);
        })
      : [];
    sortedProjs.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name || '(Project)';
      projSel.appendChild(opt);
    });
    if (prev) projSel.value = prev;
  }
}

function kaToggleAdminSettingsVisibility(adminId) {
  const block = document.getElementById('ka-admin-settings-block');
  const hasAdmin = true; // kiosk admin is already validated
  if (block) block.classList.toggle('hidden', !hasAdmin);

  const toggleEls = [
    document.getElementById('ka-lang-employee'),
    document.getElementById('ka-pin-employee'),
    document.getElementById('ka-lang-choice'),
    document.getElementById('ka-pin-new'),
    document.getElementById('ka-pin-confirm'),
    document.getElementById('ka-pin-save'),
    document.getElementById('ka-lang-save'),
    document.getElementById('ka-namechecks-employee'),
    document.getElementById('ka-namechecks-input'),
    document.getElementById('ka-namechecks-save')
  ];
  toggleEls.forEach(el => {
    if (el) el.disabled = !hasAdmin;
  });
}

function kaRenderAdminSelect() {
  // Selection no longer needed; admin is already authenticated to access this page.
  kaSelectedAdminId =
    (kaCurrentAdmin && kaCurrentAdmin.id) ? String(kaCurrentAdmin.id) : null;
  kaToggleAdminSettingsVisibility(kaSelectedAdminId);
}

function kaHandleAdminChange() {
  // No-op: admin context is fixed to the logged-in admin.
}

function kaRenderSettingsForm() {
  const pinSelect = document.getElementById('ka-pin-employee');
  const langSelect = document.getElementById('ka-lang-employee');
  const nameChecksSelect = document.getElementById('ka-namechecks-employee');
  // Always show settings; do not gate on admin selection
  kaToggleAdminSettingsVisibility(true);

  // Force dropdowns to start at the placeholder
  if (pinSelect) pinSelect.value = '';
  if (langSelect) langSelect.value = '';
  if (nameChecksSelect) nameChecksSelect.value = '';

  const fillSelect = (selectEl) => {
    if (!selectEl) return;
    const prev = selectEl.value || '';
    selectEl.innerHTML = '<option value="">Select an employee</option>';
    (kaEmployees || []).forEach(emp => {
      const label = `${emp.nickname || emp.name || 'Unnamed'} (${emp.is_admin ? 'Admin' : 'Employee'})`;
      const opt = document.createElement('option');
      opt.value = emp.id;
      opt.textContent = label;
      if (prev && String(prev) === String(emp.id)) opt.selected = true;
      selectEl.appendChild(opt);
    });
  };

  fillSelect(pinSelect);
  fillSelect(langSelect);
  fillSelect(nameChecksSelect);

  kaSyncLanguageChoice();
  kaSyncNameOnChecksInput();
}

function kaInitSettingsToggles() {
  document.querySelectorAll('.ka-settings-tile').forEach(tile => {
    const toggle = tile.querySelector('.ka-settings-toggle');
    const content = tile.querySelector('.ka-settings-content');
    if (!toggle || !content) return;
    const isCollapsed = tile.classList.contains('collapsed');
    toggle.setAttribute('aria-expanded', String(!isCollapsed));
    toggle.addEventListener('click', () => {
      const nowCollapsed = tile.classList.toggle('collapsed');
      toggle.setAttribute('aria-expanded', String(!nowCollapsed));
    });
  });
}

async function kaSaveKioskSettings() {
  if (!kaKiosk) return;

  const sel = document.getElementById('ka-project-select');
  const status = document.getElementById('ka-kiosk-status');

  const prevProjectId = kaKiosk.project_id || null;
  const projectId = sel && sel.value ? Number(sel.value) : null;

  if (status) {
    status.textContent = 'Saving kiosk settings…';
    status.className = 'ka-status';
  }

  try {
    // POST /api/kiosks update (re-use existing route)
    await fetchJSON('/api/kiosks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: kaKiosk.id,
        name: kaKiosk.name,
        location: kaKiosk.location,
        device_id: kaKiosk.device_id,
        project_id: projectId
      })
    });

    kaKiosk.project_id = projectId;

    // Log a session for today and set it active so the worker screen updates
    if (projectId) {
      try {
        const sessionResp = await fetchJSON(`/api/kiosks/${kaKiosk.id}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_id: projectId,
            make_active: true
          })
        });
        if (sessionResp && sessionResp.session && sessionResp.session.id) {
          kaActiveSessionId = sessionResp.session.id;
        }
        await kaLoadSessions();
      } catch (e) {
        console.warn('Could not log kiosk session', e);
        // fallback: just set active session to existing match
        const match = kaSessions.find(s => Number(s.project_id) === Number(projectId));
        if (match) {
          await kaSetActiveSession(match.id);
        }
      }
    } else if (prevProjectId && !projectId) {
      kaActiveSessionId = null;
    }

    if (status) {
      status.textContent = 'Kiosk settings saved.';
      status.className = 'ka-status ka-status-ok';
    }
  } catch (err) {
    console.error('Error saving kiosk settings:', err);
    if (status) {
      status.textContent = 'Error saving kiosk settings: ' + (err.message || err);
      status.className = 'ka-status ka-status-error';
    }
  }
}

// --- Foreman + Live workers ---

async function kaLoadForeman() {
  if (!kaKiosk) return;
  const el = document.getElementById('ka-foreman-line');
  if (!el) return;

  try {
    const data = await fetchJSON(`/api/kiosks/${kaKiosk.id}/foreman-today`);
    if (data && data.foreman_name) {
      el.textContent = `Today's foreman: ${data.foreman_name}`;
    } else {
      el.textContent = `(foreman not set yet for today)`;
    }
  } catch (err) {
    console.error('Error loading foreman:', err);
    el.textContent = '(could not load foreman info)';
  }
}

// --- PIN status ---

function kaRenderPinStatus() {
  const tbody = document.getElementById('ka-pin-body');
  if (!tbody) return;

  const needingPin = (kaEmployees || []).filter(e => {
    if (e.uses_timekeeping === 0) return false;
    if (e.active === 0) return false;
    const pin = (e.pin || '').trim();
    return !pin;
  });

  tbody.innerHTML = '';

  if (!needingPin.length) {
    tbody.innerHTML =
      '<tr><td colspan="2" class="ka-muted">(all active timekeeping employees have a PIN)</td></tr>';
    return;
  }

  needingPin.forEach(e => {
    const tr = document.createElement('tr');
    const rate = e.rate != null ? Number(e.rate).toFixed(2) : '0.00';
    tr.innerHTML = `
      <td>${e.nickname || e.name}</td>
      <td class="ka-right">$${rate}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function kaHandlePinChange() {
  const sel = document.getElementById('ka-pin-employee');
  const pin1 = document.getElementById('ka-pin-new');
  const pin2 = document.getElementById('ka-pin-confirm');
  const status = document.getElementById('ka-pin-status');
  const deviceSecret = kaGetDeviceSecret();

  if (!sel || !pin1 || !pin2 || !status) return;

  const id = sel.value ? Number(sel.value) : null;
  const p1 = (pin1.value || '').trim();
  const p2 = (pin2.value || '').trim();

  status.textContent = '';
  status.className = 'ka-status';

  if (!id) {
    status.textContent = 'Pick an employee or admin first.';
    status.classList.add('ka-status-error');
    return;
  }

  if (!/^[0-9]{4}$/.test(p1) || !/^[0-9]{4}$/.test(p2)) {
    status.textContent = 'PIN must be exactly 4 digits.';
    status.classList.add('ka-status-error');
    return;
  }

  if (p1 !== p2) {
    status.textContent = 'PIN entries do not match.';
    status.classList.add('ka-status-error');
    return;
  }

  try {
    status.textContent = 'Saving PIN…';
    await fetchJSON(`/api/employees/${id}/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: p1,
        allowOverride: true,
        device_id: kaDeviceId || null,
        device_secret: deviceSecret
      })
    });

    const emp = (kaEmployees || []).find(e => Number(e.id) === Number(id));
    if (emp) emp.pin = p1;

    status.textContent = 'PIN updated.';
    status.classList.add('ka-status-ok');
    pin1.value = '';
    pin2.value = '';
  } catch (err) {
    console.error('Error updating PIN (primary endpoint)', err);
    // Try a fallback with allowOverride in the querystring (some backends expect this)
    try {
      await fetchJSON(`/api/employees/${id}/pin?allowOverride=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin: p1,
          device_id: kaDeviceId || null,
          device_secret: deviceSecret
        })
      });
      const emp = (kaEmployees || []).find(e => Number(e.id) === Number(id));
      if (emp) emp.pin = p1;
      status.textContent = 'PIN updated.';
      status.classList.add('ka-status-ok');
      pin1.value = '';
      pin2.value = '';
      return;
    } catch (err2) {
      console.error('PIN fallback attempt failed', err2);
      const msg = err2 && err2.message ? err2.message : (err && err.message) || 'Error updating PIN. Please try again.';

      // If it's an auth/network issue, queue locally so the user can still clock in
      const authLike = /auth|login|credential|session/i.test(msg);
      const netLike = /network|failed to fetch|offline/i.test(msg);
      if (authLike || netLike) {
        const emp = (kaEmployees || []).find(e => Number(e.id) === Number(id));
        if (emp) emp.pin = p1;
        kaAddPendingPinUpdate({ employee_id: id, pin: p1 });
        status.textContent = 'PIN saved locally; will sync when online/authenticated.';
        status.classList.add('ka-status-ok');
        pin1.value = '';
        pin2.value = '';
      } else {
        status.textContent = msg;
        status.classList.add('ka-status-error');
      }
    }
  }
}

async function kaHandleLanguageChange() {
  const sel = document.getElementById('ka-lang-employee');
  const langSel = document.getElementById('ka-lang-choice');
  const status = document.getElementById('ka-lang-status');

  if (!sel || !langSel || !status) return;

  const id = sel.value ? Number(sel.value) : null;
  const lang = langSel.value || 'en';

  status.textContent = '';
  status.className = 'ka-status';

  if (!id) {
    status.textContent = 'Pick an employee or admin first.';
    status.classList.add('ka-status-error');
    return;
  }

  try {
    status.textContent = 'Saving language…';
    await fetchJSON(`/api/employees/${id}/language`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: lang })
    });

    const emp = (kaEmployees || []).find(e => Number(e.id) === Number(id));
    if (emp) emp.language = lang;

    status.textContent = 'Language updated.';
    status.classList.add('ka-status-ok');
  } catch (err) {
    console.error('Error updating language', err);
    // Fallback: try generic employee update with language included
    try {
      const emp = (kaEmployees || []).find(e => Number(e.id) === Number(id));
      if (!emp) throw err;
      const payload = {
        id: emp.id,
        name: emp.name,
        rate: emp.rate,
        nickname: emp.nickname || null,
        name_on_checks: emp.name_on_checks || emp.name || null,
        is_admin: emp.is_admin ? 1 : 0,
        uses_timekeeping: emp.uses_timekeeping ? 1 : 0,
        kiosk_can_view_shipments: emp.kiosk_can_view_shipments ? 1 : 0,
        language: lang
      };
      await fetchJSON('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      emp.language = lang;
      status.textContent = 'Language updated.';
      status.classList.add('ka-status-ok');
    } catch (err2) {
      console.error('Language fallback failed', err2);
      status.textContent = 'Error updating language. Please try again.';
      status.classList.add('ka-status-error');
    }
  }
}

function kaSyncLanguageChoice() {
  const sel = document.getElementById('ka-lang-employee');
  const langSel = document.getElementById('ka-lang-choice');
  if (!sel || !langSel) return;
  const id = sel.value ? Number(sel.value) : null;
  const emp = id ? (kaEmployees || []).find(e => Number(e.id) === Number(id)) : null;
  if (emp && emp.language) {
    langSel.value = emp.language;
  } else {
    langSel.value = 'en';
  }
}

function kaSyncNameOnChecksInput() {
  const sel = document.getElementById('ka-namechecks-employee');
  const input = document.getElementById('ka-namechecks-input');
  const status = document.getElementById('ka-namechecks-status');
  if (status) {
    status.textContent = '';
    status.className = 'ka-status';
  }
  if (!sel || !input) return;
  const id = sel.value ? Number(sel.value) : null;
  const emp = id ? (kaEmployees || []).find(e => Number(e.id) === Number(id)) : null;
  input.value = emp ? (emp.name_on_checks || emp.name || '') : '';
}

async function kaHandleNameOnChecksSave() {
  const sel = document.getElementById('ka-namechecks-employee');
  const input = document.getElementById('ka-namechecks-input');
  const status = document.getElementById('ka-namechecks-status');

  if (status) {
    status.textContent = '';
    status.className = 'ka-status';
  }

  const id = sel && sel.value ? Number(sel.value) : null;
  const value = input ? (input.value || '').trim() : '';
  if (!id) {
    if (status) {
      status.textContent = 'Pick an employee or admin first.';
      status.classList.add('ka-status-error');
    }
    return;
  }

  const emp = (kaEmployees || []).find(e => Number(e.id) === Number(id));
  if (!emp) {
    if (status) {
      status.textContent = 'Employee not found.';
      status.classList.add('ka-status-error');
    }
    return;
  }

  try {
    if (status) {
      status.textContent = 'Saving name on checks…';
      status.className = 'ka-status';
    }
    const deviceSecret = kaGetDeviceSecret();
    const res = await fetchJSON(`/api/employees/${id}/name-on-checks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name_on_checks: value || null,
        device_id: kaDeviceId || null,
        device_secret: deviceSecret
      })
    });
    emp.name_on_checks = value || null;
    if (status) {
      const warning = res && res.qbo_warning;
      status.textContent = warning
        ? `Updated locally. QuickBooks warning: ${warning}`
        : 'Name on checks updated.';
      status.classList.add(warning ? 'ka-status-error' : 'ka-status-ok');
    }
  } catch (err) {
    console.error('Error updating name on checks', err);
    if (status) {
      status.textContent = 'Error updating name on checks.';
      status.classList.add('ka-status-error');
    }
  }
}

function kaResetRatesUI(message = '') {
  const status = document.getElementById('ka-rates-status');
  const editor = document.getElementById('ka-rates-editor');
  const tbody = document.getElementById('ka-rates-body');
  const pinRow = document.getElementById('ka-rates-pin-row');
  const pinInput = document.getElementById('ka-rates-pin');

  kaRatesUnlocked = false;
  pinRow?.classList.remove('hidden');
  editor?.classList.add('hidden');
  if (pinInput) pinInput.value = '';

  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="4" class="ka-muted">(locked)</td></tr>';
  }

  if (status) {
    status.textContent = message || '';
    status.className = 'ka-status' + (message ? ' ka-status-error' : '');
  }
}

function kaRenderRatesTable(rows = []) {
  const tbody = document.getElementById('ka-rates-body');
  if (!tbody) return;

  if (!kaRatesUnlocked) {
    tbody.innerHTML = '<tr><td colspan="4" class="ka-muted">(locked)</td></tr>';
    return;
  }

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="ka-muted">(no employees available)</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  rows.forEach(emp => {
    const rate = emp.rate != null ? Number(emp.rate).toFixed(2) : '0.00';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${emp.nickname || emp.name || '(Unnamed)'}</td>
      <td class="ka-right">$${rate}</td>
      <td class="ka-right">
        <input
          type="number"
          step="0.01"
          min="0"
          class="ka-rate-input"
          data-rate-id="${emp.id}"
          value="${rate}"
        />
      </td>
      <td class="ka-right">
        <button class="btn secondary btn-sm" data-rate-save="${emp.id}">Save</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function kaLoadRatesTable() {
  const tbody = document.getElementById('ka-rates-body');
  const status = document.getElementById('ka-rates-status');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="4" class="ka-muted">(loading rates…)</td></tr>';
  if (status) {
    status.textContent = 'Unlocking rate view…';
    status.className = 'ka-status';
  }

  try {
    const res = await fetchJSON('/api/kiosk/rates');
    kaRatesData = Array.isArray(res.employees) ? res.employees : [];
    kaRenderRatesTable(kaRatesData);
    if (status) {
      status.textContent = 'Unlocked. Rates are visible for 10 minutes.';
      status.className = 'ka-status ka-status-ok';
    }
  } catch (err) {
    const msg = err && err.message ? err.message : 'Failed to load rates.';
    if (status) {
      status.textContent = msg;
      status.className = 'ka-status ka-status-error';
    }
    // If the server says access is locked, force a reset
    if (/lock|permission/i.test(msg)) {
      kaResetRatesUI('Rates access is locked. Re-enter your PIN.');
    } else {
      tbody.innerHTML = `<tr><td colspan="4" class="ka-muted">(${msg})</td></tr>`;
    }
  }
}

async function kaUnlockRatesWithPin() {
  const status = document.getElementById('ka-rates-status');
  const pinInput = document.getElementById('ka-rates-pin');
  const pinRow = document.getElementById('ka-rates-pin-row');
  const editor = document.getElementById('ka-rates-editor');

  if (!kaCanModifyPayRates()) {
    kaResetRatesUI('You do not have permission to modify pay rates.');
    return;
  }

  if (!kaCurrentAdmin || !kaCurrentAdmin.id) {
    kaResetRatesUI('Admin identity missing; reload and try again.');
    return;
  }

  const pin = pinInput ? (pinInput.value || '').trim() : '';
  if (!/^[0-9]{4}$/.test(pin)) {
    if (status) {
      status.textContent = 'Enter your 4-digit PIN to unlock rates.';
      status.className = 'ka-status ka-status-error';
    }
    return;
  }

  try {
    if (status) {
      status.textContent = 'Verifying PIN…';
      status.className = 'ka-status';
    }
    await fetchJSON('/api/kiosk/rates/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_id: kaCurrentAdmin.id, pin })
    });
    kaRatesUnlocked = true;
    if (status) {
      status.textContent = 'Unlocked. Rates are visible for 10 minutes.';
      status.className = 'ka-status ka-status-ok';
    }
    pinRow?.classList.add('hidden');
    editor?.classList.remove('hidden');
    if (pinInput) pinInput.value = '';
    await kaLoadRatesTable();
  } catch (err) {
    kaRatesUnlocked = false;
    if (status) {
      status.textContent = err.message || 'Unable to unlock rates.';
      status.className = 'ka-status ka-status-error';
    }
    if (pinInput) pinInput.value = '';
  }
}

function kaHandleRatesToggleChange() {
  const pinRow = document.getElementById('ka-rates-pin-row');
  const pinInput = document.getElementById('ka-rates-pin');
  const editor = document.getElementById('ka-rates-editor');

  // Directly show the PIN prompt; unlock happens via button click
  if (pinRow) pinRow.classList.remove('hidden');
  if (editor) editor.classList.add('hidden');
  if (pinInput) pinInput.value = '';
}

async function kaHandleRateSaveClick(evt) {
  const btn = evt.target.closest('[data-rate-save]');
  if (!btn) return;

  const empId = Number(btn.dataset.rateSave);
  const input = document.querySelector(`input[data-rate-id="${empId}"]`);
  const status = document.getElementById('ka-rates-status');

  if (!kaRatesUnlocked) {
    kaResetRatesUI('Rates access expired. Re-enter your PIN.');
    return;
  }

  const rateVal = input ? Number(input.value) : NaN;
  if (!input || Number.isNaN(rateVal)) {
    if (status) {
      status.textContent = 'Enter a numeric rate before saving.';
      status.className = 'ka-status ka-status-error';
    }
    return;
  }

  try {
    if (status) {
      status.textContent = 'Saving rate…';
      status.className = 'ka-status';
    }
    await fetchJSON(`/api/kiosk/rates/${empId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rate: rateVal })
    });
    if (status) {
      status.textContent = 'Rate updated.';
      status.className = 'ka-status ka-status-ok';
    }
    const match = (kaRatesData || []).find(e => Number(e.id) === Number(empId));
    if (match) match.rate = rateVal;
    kaRenderRatesTable(kaRatesData);
  } catch (err) {
    const msg = err && err.message ? err.message : 'Error updating rate.';
    if (status) {
      status.textContent = msg;
      status.className = 'ka-status ka-status-error';
    }
    if (/lock|permission/i.test(msg)) {
      kaResetRatesUI('Rates access expired. Re-enter your PIN.');
    }
  }
}

// --- Time entries (approvals + editing) ---

function kaRangeForMode(mode = 'today') {
  const todayIso = kaTodayIso();
  const toIso = (dt) => {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  const today = new Date(todayIso + 'T00:00:00');
  if (mode === 'yesterday') {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    return { start: toIso(y), end: toIso(y) };
  }

  if (mode === 'last7') {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { start: toIso(start), end: toIso(today) };
  }

  // default → today
  return { start: toIso(today), end: toIso(today) };
}

function kaSetTimeRange(mode) {
  kaTimeRangeMode = mode;
  const { start, end } = mode === 'custom'
    ? { start: document.getElementById('ka-time-start')?.value || kaTodayIso(),
        end: document.getElementById('ka-time-end')?.value || kaTodayIso() }
    : kaRangeForMode(mode);

  const startInput = document.getElementById('ka-time-start');
  const endInput = document.getElementById('ka-time-end');
  if (startInput) startInput.value = start;
  if (endInput) endInput.value = end;

  const customWrap = document.getElementById('ka-time-custom');
  if (customWrap) {
    customWrap.classList.toggle('hidden', mode !== 'custom');
  }
}

function kaEntryStatusBadges(entry) {
  const flagged = entry.has_geo_violation || entry.has_auto_clock_out;
  if (flagged) {
    return '<span class="ka-tag orange">Pending review</span>';
  }
  return '<span class="ka-tag green">Approved as-is</span>';
}

function kaEntryDetailMeta(entry) {
  const meta = [];
  if (entry.has_geo_violation) meta.push('Geofence flag');
  if (entry.has_auto_clock_out) meta.push('Auto clock-out flag');

  const approvedBy =
    entry.verified_by_employee_id || entry.verified_by || entry.resolved_by;
  const approvedAt = entry.verified_at || entry.resolved_at;
  if (approvedBy || approvedAt) {
    meta.push(
      `Reviewed by ${approvedBy || 'admin'}${approvedAt ? ` on ${new Date(approvedAt).toLocaleString()}` : ''}`
    );
  }

  if (entry.resolved_by) {
    meta.push(entry.resolved_by);
  }

  return meta.length
    ? `<div class="ka-detail-row">${meta.join(' • ')}</div>`
    : '<div class="ka-detail-row ka-muted">No additional notes</div>';
}

function kaReviewerName(raw) {
  if (!raw) return '—';
  let name = String(raw);
  if (name.includes('•')) name = name.split('•')[0];
  if (name.includes(':')) name = name.split(':')[0];
  if (name.includes('-')) name = name.split('-')[0];
  name = name.trim();
  return name || '—';
}

let kaRateUnlockTarget = null;

function kaOpenRateModal(entryId) {
  kaRateUnlockTarget = entryId;
  const backdrop = document.getElementById('ka-rate-backdrop');
  const pin = document.getElementById('ka-rate-pin');
  const status = document.getElementById('ka-rate-status');
  if (!backdrop || !pin || !status) return;
  status.textContent = '';
  status.className = 'ka-status';
  pin.value = '';
  backdrop.classList.remove('hidden');
  pin.focus();
}

function kaCloseRateModal() {
  const backdrop = document.getElementById('ka-rate-backdrop');
  const status = document.getElementById('ka-rate-status');
  if (backdrop) backdrop.classList.add('hidden');
  if (status) status.textContent = '';
  kaRateUnlockTarget = null;
}

function kaHandleRateUnlock(all) {
  const pinInput = document.getElementById('ka-rate-pin');
  const status = document.getElementById('ka-rate-status');
  if (!pinInput || !status) return;
  const entered = (pinInput.value || '').trim();
  const adminPin = (kaCurrentAdmin && kaCurrentAdmin.pin || '').trim();
  if (!entered) {
    status.textContent = 'Enter your PIN.';
    status.className = 'ka-status ka-status-error';
    return;
  }
  if (!adminPin || entered !== adminPin) {
    status.textContent = 'PIN is incorrect.';
    status.className = 'ka-status ka-status-error';
    return;
  }

  if (all) {
    kaRatesUnlockedAll = true;
  } else if (kaRateUnlockTarget != null) {
    kaUnlockedRates.add(Number(kaRateUnlockTarget));
  }
  kaCloseRateModal();
  kaLoadTimeEntries();
}

function kaApplyPayrollVisibility() {
  const viewTime = document.getElementById('ka-view-time');
  if (viewTime) {
    viewTime.classList.toggle('ka-hide-pay', !kaCanViewPayroll());
  }
}

async function kaLoadTimeEntries() {
  const tbody = document.getElementById('ka-time-body');
  const status = document.getElementById('ka-time-status');
  const startInput = document.getElementById('ka-time-start');
  const endInput = document.getElementById('ka-time-end');
  const hideResolvedEl = document.getElementById('ka-time-hide-resolved');
  const empFilter = document.getElementById('ka-time-employee');
  const projFilter = document.getElementById('ka-time-project');
  const showPay = kaCanViewPayroll();
  const showActions = kaCanModifyTime();
  const showApproved = showActions;
  const payEnabled = showPay && kaShowPayUI;
  const actionsEnabled = showActions && kaShowApprovalsUI;
  const colCount = 6 + (payEnabled ? 3 : 0) + (actionsEnabled ? 3 : 0);

  if (!tbody || !startInput || !endInput) return;

  document.querySelectorAll('.ka-pay-col').forEach(el => {
    el.classList.toggle('ka-col-hidden', !payEnabled);
  });
  document.querySelectorAll('.ka-paystatus-col').forEach(el => {
    el.classList.toggle('ka-col-hidden', !payEnabled);
  });
  document.querySelectorAll('.ka-rate-col').forEach(el => {
    el.classList.toggle('ka-col-hidden', !payEnabled);
  });
  document.querySelectorAll('.ka-approve-col').forEach(el => {
    el.classList.toggle('ka-col-hidden', !actionsEnabled);
  });
  document.querySelectorAll('.ka-actions-col').forEach(el => {
    el.classList.toggle('ka-col-hidden', !actionsEnabled);
  });
  document.querySelectorAll('.ka-status-col').forEach(el => {
    el.classList.toggle('ka-col-hidden', !actionsEnabled);
  });

  if (!kaCanViewTimeReports()) {
    tbody.innerHTML =
      `<tr><td colspan="${colCount}" class="ka-muted">(no access to time entries)</td></tr>`;
    if (status) {
      status.textContent = 'You do not have access to Time Entries.';
      status.className = 'ka-status ka-status-error';
    }
    return;
  }

  const start = startInput.value || kaTodayIso();
  const end = endInput.value || start;
  const employeeId = empFilter ? empFilter.value : '';
  const projectId = projFilter ? projFilter.value : '';

  tbody.innerHTML =
    `<tr><td colspan="${colCount}" class="ka-muted">(loading time entries…)</td></tr>`;
  if (status) {
    status.textContent = '';
    status.className = 'ka-status';
  }

  try {
    const params = new URLSearchParams();
    params.set('start', start);
    params.set('end', end);
    if (employeeId) params.set('employee_id', employeeId);
    if (projectId) params.set('project_id', projectId);

    const entries = await fetchJSON(`/api/time-entries?${params.toString()}`);

    tbody.innerHTML = '';

    const hideResolved = hideResolvedEl && hideResolvedEl.checked;
    const filtered = (entries || []).filter(t => {
      if (!hideResolved) return true;
      return !(t.resolved || t.verified);
    });

    // Merge in offline punches (deduped by client_id)
    const offlinePunches = kaLoadOfflinePunches().filter(p => {
      const d = p.device_timestamp ? p.device_timestamp.slice(0, 10) : '';
      if (!d || d < start || d > end) return false;
      if (employeeId && String(p.employee_id) !== String(employeeId)) return false;
      if (projectId && String(p.project_id) !== String(projectId)) return false;
      return true;
    });
    const offlineEntries = offlinePunches.map(kaOfflinePunchToEntry);

    const combinedMap = new Map();
    filtered.forEach(e => {
      const key = e.id ? `srv-${e.id}` : JSON.stringify(e);
      combinedMap.set(key, e);
    });
    offlineEntries.forEach(e => {
      const key = e.client_id ? `off-${e.client_id}` : e.id;
      if (!combinedMap.has(key)) combinedMap.set(key, e);
    });

    const combined = Array.from(combinedMap.values());

    if (!combined.length) {
      tbody.innerHTML =
        `<tr><td colspan="${colCount || 6}" class="ka-muted">(no time entries for this date range)</td></tr>`;
      return;
    }

    combined.forEach(t => {
      const isOffline = !!t._offline;
      const tr = document.createElement('tr');
      tr.dataset.entryId = t.id;
      tr.dataset.verified = t.verified ? '1' : '0';
      tr._entry = t; // stash full row for actions

    const emp = t.employee_name || '(Unknown)';
    const proj = t.project_name || '(No project)';
    const dateLabel = t.start_date || t.end_date || '';
    const hours = t.hours != null ? Number(t.hours).toFixed(2) : '0.00';
    const rawRate = (() => {
      if (t.rate != null) return Number(t.rate);
      if (t.hourly_rate != null) return Number(t.hourly_rate);
      if (t.pay_rate != null) return Number(t.pay_rate);
      if (t.employee_rate != null) return Number(t.employee_rate);
      const hrsNum = Number(t.hours);
      const payNum = Number(t.total_pay);
      if (!Number.isNaN(hrsNum) && hrsNum > 0 && !Number.isNaN(payNum)) {
        return payNum / hrsNum;
      }
      return null;
    })();
    const rateDisplay = payEnabled
      ? (kaRatesUnlockedAll || kaUnlockedRates.has(t.id)
          ? (rawRate != null ? `$${rawRate.toFixed(2)}` : '—')
          : '••••')
      : '';
    const pay = t.total_pay != null ? Number(t.total_pay).toFixed(2) : '0.00';
    const paid = t.paid ? 'Paid' : 'Unpaid';
    const payTagClass = t.paid ? 'green' : 'orange';
    const detailMeta = kaEntryDetailMeta(t);
    const flagged = !!(t.has_geo_violation || t.has_auto_clock_out);
    const resolved = !!t.resolved;
    const isApproved = resolved && !!t.verified;
    const isRejected = resolved && !t.verified;
    const statusLabel = (() => {
      if (!showActions) return '';
      if (isRejected) return '<span class="ka-tag orange">Rejected</span>';
      if (isApproved && flagged) return '<span class="ka-tag green">Approved</span>';
      if (isApproved && !flagged) return '<span class="ka-tag green">Approved as-is</span>';
      if (flagged) return '<span class="ka-tag orange">Pending review</span>';
      return '<span class="ka-tag gray">Pending review</span>';
    })();
    const approvedBy = kaReviewerName(
      t.resolved_by || t.verified_by || t.verified_by_employee_id
    );
    let actionLabel = 'Actions ▾';
    let actionClass = '';
    if (isRejected) {
      actionLabel = 'Rejected ▾';
      actionClass = 'rejected';
    } else if (isApproved && flagged) {
      actionLabel = 'Approved ▾';
      actionClass = 'approved';
    } else if (isApproved && !flagged) {
      actionLabel = 'Approved as-is ▾';
      actionClass = 'approved-asis';
    }
    const actionsCell = !showActions
      ? '<span class="ka-muted">View only</span>'
      : isOffline
        ? '<span class="ka-muted">Pending sync</span>'
        : `
            <div class="ka-time-row-actions dropdown">
              <button class="btn secondary btn-sm ka-actions-toggle ${actionClass || (!flagged ? 'ka-muted' : '')}" data-ka-time-menu>${actionLabel}</button>
              <div class="ka-actions-menu hidden">
                <button class="ka-actions-item" data-ka-time-action="approve">Approve</button>
                <button class="ka-actions-item" data-ka-time-action="modify">Modify</button>
                <button class="ka-actions-item" data-ka-time-action="reject">Reject</button>
              </div>
            </div>
          `;

    let rowHtml = `
      <td>${emp}</td>
      <td>${proj}</td>
      <td>${dateLabel}</td>
      <td>${t.start_time || '—'}</td>
      <td>${t.end_time || '—'}</td>
      <td class="ka-right">${hours}</td>
    `;
    rowHtml += `
      <td class="ka-right ka-pay-col ka-rate-col ${payEnabled ? '' : 'ka-col-hidden'}" data-rate-entry="${t.id}">${payEnabled ? rateDisplay : ''}</td>
      <td class="ka-right ka-pay-col ${payEnabled ? '' : 'ka-col-hidden'}">${payEnabled ? `$${pay}` : ''}</td>
      <td class="ka-right ka-pay-col ka-paystatus-col ${payEnabled ? '' : 'ka-col-hidden'}">
        ${payEnabled ? `<span class="ka-tag ${payTagClass}">${paid}</span>` : ''}
      </td>
      <td class="ka-actions-cell ${actionsEnabled ? '' : 'ka-col-hidden'}">${actionsEnabled ? statusLabel : ''}</td>
      <td class="ka-approve-col ${actionsEnabled ? '' : 'ka-col-hidden'}">${actionsEnabled ? approvedBy : ''}</td>
      <td class="ka-actions-cell ka-actions-col ${actionsEnabled ? '' : 'ka-col-hidden'}">${actionsEnabled ? actionsCell : ''}</td>
    `;

    tr.innerHTML = rowHtml;

  tbody.appendChild(tr);

    // Attach rate click handler for masking/unlocking
    if (payEnabled) {
      tr.querySelectorAll('[data-rate-entry]').forEach(cell => {
        cell.style.cursor = 'pointer';
        cell.addEventListener('click', () => {
          const id = Number(cell.getAttribute('data-rate-entry'));
          kaOpenRateModal(id);
        });
      });
    }

    // Detail row (hidden until the main row is clicked)
  const detailTr = document.createElement('tr');
    detailTr.className = 'ka-time-detail-row hidden';
    detailTr.innerHTML = `
      <td colspan="${colCount}" class="ka-time-detail">
        ${detailMeta}
      </td>
    `;
      tbody.appendChild(detailTr);
    });

    // Wire up per-row actions
    tbody.querySelectorAll('[data-ka-time-action]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const action = btn.getAttribute('data-ka-time-action');
        const row = e.target.closest('tr');
        if (!row || !row._entry) return;
        e.stopPropagation();
        if (row._entry._offline) return; // skip actions for offline pending
        kaOpenTimeActionModal(row._entry, action);
        // Close menu after click
        const menu = btn.closest('.ka-actions-menu');
        if (menu) menu.classList.add('hidden');
      });
    });
    tbody.querySelectorAll('[data-ka-time-menu]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = btn.parentElement?.querySelector('.ka-actions-menu');
        if (menu) menu.classList.toggle('hidden');
      });
    });
    // Row click to toggle details
    const rows = Array.from(tbody.querySelectorAll('tr')).filter(r => !r.classList.contains('ka-time-detail-row'));
    rows.forEach((row, idx) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.ka-actions-toggle') || e.target.closest('.ka-actions-menu')) return;
        const detail = tbody.querySelectorAll('.ka-time-detail-row')[idx];
        if (detail) detail.classList.toggle('hidden');
      });
    });
    // Close any open menus when clicking outside table
    document.addEventListener('click', (e) => {
      if (!tbody.contains(e.target)) {
        tbody.querySelectorAll('.ka-actions-menu').forEach(m => m.classList.add('hidden'));
      }
    });
  } catch (err) {
    console.error('Error loading time entries:', err);
    tbody.innerHTML =
      `<tr><td colspan="${colCount}" class="ka-muted">(error loading time entries)</td></tr>`;
    if (status) {
      status.textContent = 'Error loading time entries.';
      status.className = 'ka-status ka-status-error';
    }
  }
}
    if (metaEl) {
      metaEl.textContent = '';
    }
