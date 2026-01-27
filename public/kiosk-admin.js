// kiosk-admin.js
// Lightweight foreman dashboard for a single kiosk device.

let kaDeviceId = null;
let kaKiosk = null;
let kaProjects = [];
let kaEmployees = [];
let kaStartMode = false;
let kaStartEmployeeId = null;
let kaCurrentView = 'timesheets';
let kaCurrentAdmin = null;  // whoever opened kiosk-admin (via employee_id)
let kaAdminValidated = false;
let kaSelectedAdminId = null;
let kaSessions = [];
let kaActiveSessionId = null;
let kaSessionFilterMode = 'all'; // active | all | inactive
let kaShipmentItemsDirty = new Map(); // shipment_item_id -> verification payload
let kaShipmentDetail = null;
let kaShipmentDetailDocs = [];
let kaItemsModalShipmentId = null;
let kaTimesheetDate = '';
let kaTimesheetSearchQuery = '';
let kaShipmentsLoading = false;
let kaShipmentsReloadPending = false;
let kaItemsFilterUnverifiedFirst = true;
let kaItemsFilterTerm = '';
let kaItemsStatusFilter = 'unverified';
let kaItemsActiveTab = 'items';
const kaItemAutoSaveTimers = new Map();
const kaSavedItemStatuses = new Map();
const kaExpandedItems = new Set();
const kaRecentlySavedItems = new Map(); // itemId -> timeout id
const KA_ITEM_SAVE_FLASH_MS = 2500;
const KA_ITEMS_AUTO_SAVE_ENABLED = false; // keep items from autosaving/reordering mid-edit
let kaTimeRangeMode = 'today';
let kaTimeActionEntry = null;
let kaTimeActionMode = null;
const kaOpenDetailEntries = new Set();
let kaAccessPerms = {
  see_shipments: true,
  modify_time: true,
  view_time_reports: true,
  view_all_timesheets: false,
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
let kaClockInPhotoRequired = false;
let kaTimesheetWorkersSheetState = { open: false, dragging: false, startY: 0, currentY: 0 };
let kaDocViewObjectUrl = null;
let kaDocViewCurrentUrl = null;

const KA_VIEWS = ['timesheets', 'workers', 'shipments', 'time', 'account', 'settings'];
const KA_PENDING_PIN_KEY = 'avian_kiosk_pending_pins_v1';
const KA_OFFLINE_QUEUE_KEY = 'avian_kiosk_offline_punches_v1';
const KA_VERIFY_QUEUE_KEY = 'avian_kiosk_verify_queue_v1';
const KA_SHIPMENT_NOTES_QUEUE_KEY = 'avian_kiosk_shipment_notes_queue_v1';
const KA_TIME_REVIEW_QUEUE_KEY = 'avian_kiosk_time_review_queue_v1';
const KA_SHIPMENTS_CACHE_KEY = 'avian_kiosk_shipments_cache_v1';
const KA_DOC_CACHE_NAME = 'avian_doc_cache_v1';
const KA_ORG_TIMEZONE_KEY = 'avian_kiosk_org_timezone_v1';
const KA_DEFAULT_TIMEZONE = 'America/Puerto_Rico';
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
  enabled: false, // legacy flag for shipments alerts
  shipments_enabled: false,
  statuses: ['Cleared - Ready for Release'],
  project_ids: [],
  remind_every_days: 1,
  remind_time: '19:00',
  clockout_enabled: false,
  clockout_time: '19:00',
  notify_phone: '',
  notify_phone_enabled: false,
  notify_email: '',
  notify_email_enabled: false
};
let kaNotifyPref = { ...KA_NOTIFY_DEFAULT };
let kaNotifyTimer = null;
let kaNotifyLastKey = '';
let kaNotifiedShipments = new Set();
let kaReminderTimestamps = {};
let kaClockoutAlertedDay = '';
let kaStatusLockUntil = 0;
let kaOrgTimezone = null;
let kaAdminOpenPunch = null;
let kaClockInPromptActive = false;
let kaLiveRefreshTimer = null;
let kaLiveRefreshInFlight = false;
let kaSessionRefreshInFlight = false;
let kaLiveProjectOverride = null;
let kaDialogsOverridden = false;
let kaTimeOrientationListenerBound = false;
let kaBottomNavPositionBound = false;
let kaLiveCountTagHome = null;
let kaAccountBound = false;
let kaAccountAuthed = false;

const KA_CSRF_TOKEN_KEY = 'avian_csrf_token_v1';
let kaCsrfToken = null;

function kaLoadCsrfToken() {
  if (kaCsrfToken) return kaCsrfToken;
  try {
    const stored = localStorage.getItem(KA_CSRF_TOKEN_KEY);
    if (stored) kaCsrfToken = stored;
  } catch {
    // ignore storage failures
  }
  return kaCsrfToken;
}

function kaStoreCsrfToken(token) {
  if (!token) return;
  kaCsrfToken = token;
  try {
    localStorage.setItem(KA_CSRF_TOKEN_KEY, token);
  } catch {
    // ignore storage failures
  }
}

function kaGetCsrfHeader() {
  const token = kaLoadCsrfToken();
  if (!token) return {};
  return { 'X-CSRF-Token': token };
}


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

function kaShowSessionInlineMessage(row, message, variant = 'error', duration = 7000) {
  if (!row) return;
  let msgEl = row.querySelector('.ka-session-inline-msg');
  if (!msgEl) {
    msgEl = document.createElement('div');
    msgEl.className = 'ka-session-inline-msg';
    msgEl.setAttribute('role', 'alert');
    row.appendChild(msgEl);
  }
  msgEl.textContent = message || 'Notice';
  if (variant === 'error') {
    msgEl.classList.add('error');
  } else {
    msgEl.classList.remove('error');
  }
  msgEl.classList.remove('hidden');
  if (msgEl._kaHideTimer) {
    clearTimeout(msgEl._kaHideTimer);
  }
  msgEl._kaHideTimer = setTimeout(() => {
    msgEl.classList.add('hidden');
  }, duration);
}

function kaShowSessionFlash(message, variant = 'error', duration = 10000) {
  const list = document.getElementById('ka-session-list');
  if (!list) return;
  let flash = document.getElementById('ka-session-flash');
  if (!flash) {
    flash = document.createElement('div');
    flash.id = 'ka-session-flash';
    flash.className = 'ka-session-flash';
    list.parentElement?.insertBefore(flash, list);
  }
  flash.textContent = message || 'Notice';
  flash.classList.toggle('error', variant === 'error');
  flash.classList.remove('hidden');
  flash.setAttribute('role', 'alert');
  flash.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (flash._kaHideTimer) clearTimeout(flash._kaHideTimer);
  flash._kaHideTimer = setTimeout(() => {
    flash.classList.add('hidden');
  }, duration);
}

function kaOfflineQueueCount() {
  const punches = kaLoadOfflinePunches().length;
  const pins = kaReadPendingPins().length;
  const verify = kaLoadVerificationQueue().length;
  const notes = kaLoadShipmentNotesQueue().length;
  const reviews = kaLoadTimeReviewQueue().length;
  return punches + pins + verify + notes + reviews;
}

function kaUpdateOfflineIndicator() {
  const connectionEl = document.getElementById('ka-connection-status');
  const syncEl = document.getElementById('ka-sync-status');
  const online = navigator.onLine;
  if (connectionEl) {
    connectionEl.textContent = online ? 'Online' : 'Offline';
    connectionEl.classList.toggle('is-offline', !online);
  }
  if (syncEl) {
    const count = kaOfflineQueueCount();
    syncEl.textContent = count ? `Sync ${count}` : 'Synced';
    syncEl.classList.toggle('has-pending', count > 0);
  }
}

function kaSessionCounts(session) {
  const openCount = Number(session && (session.device_open_count ?? session.open_count ?? 0));
  const entryCount = Number(session && (session.device_entry_count ?? session.entry_count ?? 0));
  return { openCount, entryCount };
}

function kaNotifySessionDeleteBlocked(message, row = null) {
  const msg = message || 'Cannot delete this timesheet.';
  if (row) kaShowSessionDelete(row);
  // Surface a single clear dialog so it is impossible to miss
  kaShowConfirmDialog(msg, {
    okLabel: 'OK',
    cancelLabel: 'Close',
    title: 'Cannot delete timesheet'
  }).then(() => {
    if (row) {
      kaHideSessionDelete(row);
    }
  });
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

function kaStoreGet(key, fallback) {
  if (window.AVIAN_STORE && typeof window.AVIAN_STORE.get === 'function') {
    return window.AVIAN_STORE.get(key, fallback);
  }
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function kaStoreSet(key, value) {
  if (window.AVIAN_STORE && typeof window.AVIAN_STORE.set === 'function') {
    window.AVIAN_STORE.set(key, value);
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

const kaPinThrottleState = {
  admin: { fails: 0, nextAllowedAt: 0, timer: null },
  rate: { fails: 0, nextAllowedAt: 0, timer: null }
};

const KA_PIN_THROTTLE_START_AFTER = 3;
const KA_PIN_THROTTLE_BASE_MS = 1000;
const KA_PIN_THROTTLE_MAX_MS = 8000;
const KA_PIN_CRYPTO_VERSION = 'v1';
const KA_PIN_CRYPTO_SALT = 'avian-kiosk-pin-v1';
const KA_PIN_CRYPTO_ITERATIONS = 50000;

function kaComputePinThrottleDelay(fails) {
  if (fails < KA_PIN_THROTTLE_START_AFTER) return 0;
  const step = Math.min(fails - KA_PIN_THROTTLE_START_AFTER, 3);
  const delay = KA_PIN_THROTTLE_BASE_MS * Math.pow(2, step);
  return Math.min(delay, KA_PIN_THROTTLE_MAX_MS);
}

function kaGetPinThrottleRemaining(kind) {
  const state = kaPinThrottleState[kind];
  if (!state) return 0;
  const remaining = state.nextAllowedAt - Date.now();
  return remaining > 0 ? remaining : 0;
}

function kaSchedulePinThrottle(kind, elements, delayMs) {
  const state = kaPinThrottleState[kind];
  if (!state || delayMs <= 0) return;
  if (state.timer) clearTimeout(state.timer);
  elements.forEach(el => {
    if (el) el.disabled = true;
  });
  state.timer = setTimeout(() => {
    elements.forEach(el => {
      if (el) el.disabled = false;
    });
    state.timer = null;
  }, delayMs);
}

function kaRegisterPinFailure(kind, elements = []) {
  const state = kaPinThrottleState[kind];
  if (!state) return 0;
  state.fails += 1;
  const delay = kaComputePinThrottleDelay(state.fails);
  if (delay > 0) {
    state.nextAllowedAt = Date.now() + delay;
    kaSchedulePinThrottle(kind, elements, delay);
  }
  return delay;
}

function kaResetPinFailures(kind) {
  const state = kaPinThrottleState[kind];
  if (!state) return;
  state.fails = 0;
  state.nextAllowedAt = 0;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

function kaEnforcePinThrottle(kind, elements = []) {
  const remaining = kaGetPinThrottleRemaining(kind);
  if (remaining <= 0) return false;
  kaSchedulePinThrottle(kind, elements, remaining);
  return true;
}

async function kaWaitForPinThrottle(kind) {
  const remaining = kaGetPinThrottleRemaining(kind);
  if (remaining <= 0) return;
  alert('Please wait a moment and try again.');
  await new Promise(resolve => setTimeout(resolve, remaining));
}

const kaPinCryptoKeyCache = {
  secret: null,
  promise: null
};

function kaBytesToBase64(bytes) {
  let binary = '';
  bytes.forEach(b => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function kaBase64ToBytes(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function kaGetPinCryptoKey(secret) {
  if (!secret || !window.crypto || !window.crypto.subtle) return null;
  if (kaPinCryptoKeyCache.secret === secret && kaPinCryptoKeyCache.promise) {
    return kaPinCryptoKeyCache.promise;
  }
  const enc = new TextEncoder();
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  const keyPromise = window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(KA_PIN_CRYPTO_SALT),
      iterations: KA_PIN_CRYPTO_ITERATIONS,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  kaPinCryptoKeyCache.secret = secret;
  kaPinCryptoKeyCache.promise = keyPromise;
  return keyPromise;
}

async function kaEncryptPinForStore(pin, secret) {
  if (!pin || !secret || !window.crypto || !window.crypto.subtle) return null;
  const key = await kaGetPinCryptoKey(secret);
  if (!key) return null;
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const cipherBuf = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(String(pin))
  );
  const cipherBytes = new Uint8Array(cipherBuf);
  return `${KA_PIN_CRYPTO_VERSION}:${kaBytesToBase64(iv)}:${kaBytesToBase64(cipherBytes)}`;
}

async function kaDecryptPinFromStore(token, secret) {
  if (!token || !secret || !window.crypto || !window.crypto.subtle) return null;
  const parts = String(token).split(':');
  if (parts.length !== 3 || parts[0] !== KA_PIN_CRYPTO_VERSION) return null;
  const key = await kaGetPinCryptoKey(secret);
  if (!key) return null;
  try {
    const iv = kaBase64ToBytes(parts[1]);
    const data = kaBase64ToBytes(parts[2]);
    const plainBuf = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );
    if (window.TextDecoder) {
      return new TextDecoder().decode(plainBuf);
    }
    const bytes = new Uint8Array(plainBuf);
    return Array.from(bytes).map(b => String.fromCharCode(b)).join('');
  } catch {
    return null;
  }
}

async function fetchJSON(url, options = {}) {
  const opts = Object.assign({ credentials: 'include' }, options);
  const method = (opts.method || 'GET').toUpperCase();
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const headers = new Headers(opts.headers || {});
  const token = kaLoadCsrfToken();
  if (unsafe && token && !headers.get('X-CSRF-Token')) {
    headers.set('X-CSRF-Token', token);
  }
  opts.headers = headers;

  // Auto-attach kiosk device auth for kiosk endpoints when no session is present.
  const needsKioskAuth =
    url.startsWith('/api/kiosk') || url.startsWith('/api/kiosks');
  const needsShipmentAuth =
    url.startsWith('/api/shipments') ||
    url.startsWith('/api/reports/shipment-verification');
  const needsTimeAuth =
    url.startsWith('/api/time-exceptions') || url.startsWith('/api/time-entries');
  const deviceId = kaDeviceId || null;
  const deviceSecret = kaGetDeviceSecret();
  const adminId = kaAdminAuthId() || (kaStartEmployeeId ? Number(kaStartEmployeeId) : null);

  const needsDeviceAuth = needsKioskAuth || needsShipmentAuth || needsTimeAuth;

  if (needsDeviceAuth && deviceId && deviceSecret) {
    if (!headers.get('X-Kiosk-Device-Id')) headers.set('X-Kiosk-Device-Id', deviceId);
    if (!headers.get('X-Kiosk-Device-Secret')) headers.set('X-Kiosk-Device-Secret', deviceSecret);

    if (method === 'GET') {
      const u = new URL(url, window.location.origin);
      if ((needsKioskAuth || needsTimeAuth) && adminId && !u.searchParams.get('admin_id')) {
        u.searchParams.set('admin_id', adminId);
      }
      if (needsShipmentAuth && adminId && !u.searchParams.get('employee_id')) {
        u.searchParams.set('employee_id', adminId);
      }
      url = u.pathname + u.search;
    } else {
      const contentType = headers.get('Content-Type') || headers.get('content-type') || '';
      const isJson = /application\/json/i.test(contentType);
      if (isJson) {
        let body = {};
        if (opts.body) {
          try {
            body = JSON.parse(opts.body);
          } catch {
            body = {};
          }
        }
        if (!body.device_id) body.device_id = deviceId;
        if (!body.device_secret) body.device_secret = deviceSecret;
        if ((needsKioskAuth || needsTimeAuth) && adminId && !body.admin_id) body.admin_id = adminId;
        if (needsShipmentAuth && adminId && !body.employee_id) body.employee_id = adminId;
        opts.body = JSON.stringify(body);
      }
    }
  }

  const res = await fetch(url, opts);
  const nextToken = res.headers.get('X-CSRF-Token');
  if (nextToken) kaStoreCsrfToken(nextToken);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.message || 'Request failed');
    err.status = res.status;
    err.statusText = res.statusText;
    err.data = data;
    throw err;
  }
  return data;
}

function kaGetBcrypt() {
  if (window.dcodeIO && window.dcodeIO.bcrypt) return window.dcodeIO.bcrypt;
  if (window.bcrypt) return window.bcrypt;
  return null;
}

function kaVerifyPinHash(pin, hash) {
  const bcrypt = kaGetBcrypt();
  if (!bcrypt || !hash) return false;
  try {
    return bcrypt.compareSync(String(pin || '').trim(), String(hash));
  } catch {
    return false;
  }
}

function kaHashPin(pin) {
  const bcrypt = kaGetBcrypt();
  if (!bcrypt) return null;
  try {
    const salt = bcrypt.genSaltSync(10);
    return bcrypt.hashSync(String(pin || '').trim(), salt);
  } catch {
    return null;
  }
}

async function kaVerifyAdminPinWithServer(adminId, pin) {
  if (!adminId || !pin) return false;
  try {
    const res = await fetchJSON('/api/kiosk/admin/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_id: adminId, pin })
    });
    return !!(res && res.ok);
  } catch {
    return false;
  }
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
        <button type="button" class="btn danger btn-sm" id="ka-confirm-alt" hidden>Discard</button>
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
  const altBtn = document.getElementById('ka-confirm-alt');

  if (!backdrop || !msgEl || !yesBtn || !cancelBtn || !titleEl) {
    return Promise.resolve(window.confirm ? window.confirm(message) : true);
  }

  msgEl.textContent = message || '';
  titleEl.textContent = title || 'Confirm';
  yesBtn.textContent = okLabel || 'Yes';
  cancelBtn.textContent = cancelLabel || 'Cancel';
  if (altBtn) {
    altBtn.hidden = true;
    altBtn.onclick = null;
  }
  backdrop.classList.remove('hidden');

  return new Promise(resolve => {
    const cleanup = (result) => {
      backdrop.classList.add('hidden');
      yesBtn.onclick = null;
      cancelBtn.onclick = null;
      if (altBtn) altBtn.onclick = null;
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

function kaShowChoiceDialog(
  message,
  { okLabel = 'OK', cancelLabel = 'Cancel', altLabel = null, title = 'Confirm' } = {}
) {
  const backdrop = kaEnsureConfirmModal();
  const msgEl = document.getElementById('ka-confirm-message');
  const titleEl = document.getElementById('ka-confirm-title');
  const yesBtn = document.getElementById('ka-confirm-yes');
  const cancelBtn = document.getElementById('ka-confirm-cancel');
  const altBtn = document.getElementById('ka-confirm-alt');

  if (!backdrop || !msgEl || !yesBtn || !cancelBtn || !titleEl || !altBtn) {
    return Promise.resolve('cancel');
  }

  msgEl.textContent = message || '';
  titleEl.textContent = title || 'Confirm';
  yesBtn.textContent = okLabel || 'OK';
  cancelBtn.textContent = cancelLabel || 'Cancel';
  altBtn.textContent = altLabel || 'Option';
  altBtn.hidden = !altLabel;
  backdrop.classList.remove('hidden');

  return new Promise(resolve => {
    const cleanup = (result) => {
      backdrop.classList.add('hidden');
      yesBtn.onclick = null;
      cancelBtn.onclick = null;
      altBtn.onclick = null;
      backdrop.onclick = null;
      if (altBtn) altBtn.hidden = true;
      resolve(result);
    };

    yesBtn.onclick = () => cleanup('ok');
    cancelBtn.onclick = () => cleanup('cancel');
    altBtn.onclick = () => cleanup('alt');
    backdrop.onclick = (e) => {
      if (e.target === backdrop) cleanup('cancel');
    };
  });
}

function kaCurrentLiveProjectId() {
  if (kaLiveProjectOverride !== null && kaLiveProjectOverride !== undefined) {
    const overridePid = Number(kaLiveProjectOverride);
    if (Number.isFinite(overridePid)) return overridePid;
  }

  const activeSession = kaExplicitActiveSession(kaSessions || []);
  if (activeSession && activeSession.project_id !== undefined && activeSession.project_id !== null) {
    const pid = Number(activeSession.project_id);
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
    kaUpdateOfflineIndicator();
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
    kaUpdateSidebarClockedIn();
    return;
  }
  try {
    kaAdminOpenPunch = await fetchJSON(
      `/api/kiosk/open-punch?employee_id=${kaCurrentAdmin.id}`
    );
  } catch (err) {
    console.warn('Unable to refresh admin punch status', err);
    kaAdminOpenPunch = null;
  } finally {
    kaUpdateSidebarClockedIn();
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
      if (kaClockInPhotoRequired) {
        kaShowStatusMessage(
          'Photo is required to clock in. Please clock in from the worker screen.',
          'error',
          8000
        );
        showBanner();
      } else {
        const pos = await kaGetPosition();
        await fetchJSON('/api/kiosk/punch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: 'startday-' + Date.now().toString(36),
            employee_id: adminId,
            project_id: targetProjectId,
            intended_mode: 'clock_in',
            lat: pos?.lat ?? null,
            lng: pos?.lng ?? null,
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
  const today = kaTodayIso();
  return `avian_kiosk_day_started_${kaDeviceId}_${today}`;
}

function kaReadPendingPins() {
  const list = kaStoreGet(KA_PENDING_PIN_KEY, []);
  return Array.isArray(list) ? list : [];
}

function kaWritePendingPins(list) {
  kaStoreSet(KA_PENDING_PIN_KEY, list || []);
  kaUpdateOfflineIndicator();
}

async function kaMigratePendingPins() {
  const list = kaReadPendingPins();
  if (!list.length) return;
  let changed = false;
  for (const item of list) {
    if (item && item.pin && !item.pin_cipher) {
      const secret =
        (item.device_secret || '').trim() ||
        kaGetDeviceSecret();
      try {
        const cipher = await kaEncryptPinForStore(item.pin, secret);
        if (cipher) {
          item.pin_cipher = cipher;
          delete item.pin;
          changed = true;
        }
      } catch {
        // ignore encryption failures
      }
    }
  }
  if (changed) kaWritePendingPins(list);
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

function kaActiveProjectOptions() {
  const projects = Array.isArray(kaProjects) ? kaProjects : [];
  const activeId =
    kaKiosk && kaKiosk.project_id !== undefined && kaKiosk.project_id !== null
      ? Number(kaKiosk.project_id)
      : null;
  const options = projects
    .filter(p => p.active === undefined || p.active === null || Number(p.active) === 1)
    .map(p => ({
      project_id: Number(p.id),
      label: p.name || '(Unnamed project)'
    }));
  if (Number.isFinite(activeId)) {
    options.sort((a, b) => {
      const aActive = Number(a.project_id) === activeId;
      const bActive = Number(b.project_id) === activeId;
      if (aActive === bActive) return 0;
      return aActive ? -1 : 1;
    });
  }
  return options;
}

async function kaAddPendingPinUpdate(update) {
  const list = kaReadPendingPins();
  const deviceId = update.device_id || kaDeviceId || null;
  const deviceSecret = update.device_secret || kaGetDeviceSecret();
  let pinCipher = null;
  try {
    const secret = deviceSecret || '';
    pinCipher = await kaEncryptPinForStore(update.pin, secret);
  } catch {
    pinCipher = null;
  }
  list.push({
    client_id: update.client_id || `pin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`,
    employee_id: update.employee_id,
    ...(pinCipher ? { pin_cipher: pinCipher } : { pin: update.pin }),
    device_id: deviceId,
    device_secret: deviceSecret,
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
    const secret =
      (item.device_secret || '').trim() ||
      kaGetDeviceSecret();
    const pin = item.pin || (await kaDecryptPinFromStore(item.pin_cipher, secret));
    if (!pin) {
      remaining.push(item);
      continue;
    }
    try {
      await fetchJSON(`/api/employees/${item.employee_id}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin,
          allowOverride: true,
          client_id: item.client_id,
          device_id: item.device_id || kaDeviceId || null,
          device_secret: item.device_secret || kaGetDeviceSecret()
        })
      });
      const emp = (kaEmployees || []).find(e => Number(e.id) === Number(item.employee_id));
      if (emp) {
        const pinHash = kaHashPin(pin);
        if (pinHash) {
          emp.pin_hash = pinHash;
          emp.pin = '';
        } else {
          emp.pin = pin;
        }
      }
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

function kaIsConnectionIssue(err) {
  const msg = err && err.message ? String(err.message) : '';
  return !navigator.onLine || /network|failed to fetch|offline/i.test(msg);
}

function kaGetPosition() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

async function kaCreateSessionWithGeo({
  projectId,
  makeActive,
  adminId,
  clockMeIn,
  clockInPayload,
  lat,
  lng
}) {
  if (!kaKiosk || !kaKiosk.id) return null;
  const payload = {
    project_id: projectId,
    make_active: !!makeActive
  };
  if (adminId) payload.admin_id = adminId;
  if (clockMeIn) {
    payload.clock_me_in = true;
    payload.clock_in_payload = clockInPayload || {};
  }
  if (lat != null && lng != null) {
    payload.lat = lat;
    payload.lng = lng;
  }

  try {
    return await fetchJSON(`/api/kiosks/${kaKiosk.id}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    const data = err && err.data ? err.data : null;
    if (err && err.status === 409 && data && data.geofence_mismatch) {
      const distanceNum = Number(data.geo_distance_m);
      const radiusNum = Number(data.geo_radius_m);
      const distanceLabel = Number.isFinite(distanceNum) ? `${Math.round(distanceNum)}m` : null;
      const radiusLabel = Number.isFinite(radiusNum) ? `${Math.round(radiusNum)}m` : null;
      const projectLabel = data.project_name || 'this project';
      const message = distanceLabel && radiusLabel
        ? `Kiosk is ~${distanceLabel} from ${projectLabel} (radius ${radiusLabel}). Start timesheet anyway?`
        : `Kiosk appears outside the geofence for ${projectLabel}. Start timesheet anyway?`;
      const confirmed = await kaShowConfirmDialog(message, {
        okLabel: 'Start anyway',
        cancelLabel: 'Cancel',
        title: 'Outside geofence'
      });
      if (!confirmed) return null;
      const retryPayload = {
        ...payload,
        confirm_geo_mismatch: true
      };
      return await fetchJSON(`/api/kiosks/${kaKiosk.id}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(retryPayload)
      });
    }
    throw err;
  }
}

async function kaSyncOfflinePunches() {
  if (!navigator.onLine) return;
  let queue = kaLoadOfflinePunches();
  if (!Array.isArray(queue) || !queue.length) return;

  let updated = false;
  queue = queue.map(punch => {
    if (!punch) return punch;
    let next = punch;
    if (!next.client_id) {
      updated = true;
      next = {
        ...next,
        client_id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
      };
    }
    if (!next.queued_at) {
      updated = true;
      next = { ...next, queued_at: new Date().toISOString() };
    }
    return next;
  });
  if (updated) {
    kaSaveOfflinePunches(queue);
  }

  const remaining = [];
  const deviceId = kaDeviceId || null;
  const deviceSecret = kaGetDeviceSecret();

  for (const punch of queue) {
    if (!punch) continue;
    try {
      const payload = {
        ...punch,
        device_id: deviceId || punch.device_id || null,
        device_secret: deviceSecret || punch.device_secret || null
      };
      await fetchJSON('/api/kiosk/punch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      if (kaIsConnectionIssue(err) || (err && (err.status === 401 || err.status === 403))) {
        remaining.push(punch);
        break;
      }
      remaining.push(punch);
    }
  }

  kaSaveOfflinePunches(remaining);
}

async function kaSyncTimeReviewQueue() {
  if (!navigator.onLine) return;
  const queue = kaLoadTimeReviewQueue();
  if (!Array.isArray(queue) || !queue.length) return;

  const remaining = [];

  for (const entry of queue) {
    if (!entry || !entry.exception_id || !entry.payload) continue;
    try {
      await fetchJSON(`/api/time-exceptions/${entry.exception_id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry.payload)
      });
    } catch (err) {
      if (kaIsConnectionIssue(err) || (err && (err.status === 401 || err.status === 403))) {
        remaining.push(entry);
        break;
      }
      remaining.push(entry);
    }
  }

  kaSaveTimeReviewQueue(remaining);
}

let kaOfflineSyncTimerId = null;
let kaOfflineSyncInFlight = false;

function kaHasOfflineDataToSync() {
  try {
    const pins = kaReadPendingPins();
    const verify = kaLoadVerificationQueue();
    const notes = kaLoadShipmentNotesQueue();
    const punches = kaLoadOfflinePunches();
    const reviews = kaLoadTimeReviewQueue();
    return (Array.isArray(pins) && pins.length > 0) ||
      (Array.isArray(verify) && verify.length > 0) ||
      (Array.isArray(notes) && notes.length > 0) ||
      (Array.isArray(punches) && punches.length > 0) ||
      (Array.isArray(reviews) && reviews.length > 0);
  } catch {
    return false;
  }
}

async function kaSyncOfflineData(trigger = 'manual') {
  if (kaOfflineSyncInFlight) return;
  if (!navigator.onLine && !kaHasOfflineDataToSync()) return;

  kaOfflineSyncInFlight = true;
  try {
    await kaSyncPendingPins();
    await kaSyncShipmentNotesQueue();
    await kaSyncVerificationQueue();
    await kaSyncOfflinePunches();
    await kaSyncTimeReviewQueue();
  } catch (err) {
    console.warn('Offline sync failed', trigger, err);
  } finally {
    kaOfflineSyncInFlight = false;
    kaUpdateOfflineIndicator();
  }
}

function kaStartOfflineSyncLoop() {
  if (kaOfflineSyncTimerId) clearInterval(kaOfflineSyncTimerId);
  kaOfflineSyncTimerId = setInterval(() => {
    if (!kaHasOfflineDataToSync()) return;
    kaSyncOfflineData('interval');
  }, 30000);
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

  const storedHash = kaCurrentAdmin.pin_hash || '';
  const storedPin = (kaCurrentAdmin.pin || '').trim();
  if (!storedHash && !storedPin) {
    alert('This admin does not have a PIN set. Please unlock from the kiosk.');
    return false;
  }

  for (let i = 0; i < 3; i++) {
    await kaWaitForPinThrottle('admin');
    const entered = window.prompt('Enter your admin PIN to unlock kiosk admin:');
    if (entered === null) break; // cancel
    let pinOk = storedHash
      ? kaVerifyPinHash(entered, storedHash)
      : entered.trim() === storedPin;
    if (!pinOk && navigator.onLine) {
      pinOk = await kaVerifyAdminPinWithServer(kaCurrentAdmin.id, entered);
    }
    if (pinOk) {
      kaResetPinFailures('admin');
      kaAdminValidated = true;
      try {
        sessionStorage.setItem(unlockKey, '1');
      } catch (e) {
        // ignore storage failures
      }
      return true;
    }
    kaRegisterPinFailure('admin');
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
  ['admin-login-pin', 'ka-pin-new', 'ka-pin-confirm', 'ka-rates-pin', 'ka-rate-pin'].forEach(id => {
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
    const href = kaAppendShipmentAuth(doc.url || doc.file_path || '#');
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

async function kaHydrateShipmentCard(shipmentId) {
  try {
    const params = kaShipmentAuthParams();
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const resp = await fetchJSON(
      `/api/shipments/${shipmentId}/documents${suffix}`
    );
    const docs = kaFilterDocsForPermissions(kaNormalizeDocs(resp));
    const bolDoc = kaFindDocByType(docs, 'bol');
    kaSetBolLink(shipmentId, bolDoc);
    return bolDoc || null;
  } catch (err) {
    // Quietly ignore; card will hydrate when expanded
    console.warn('Prefetch docs failed for shipment', shipmentId, err);
    return null;
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
  const rawHref = doc.url || doc.file_path || '#';
  const href = kaAppendShipmentAuth(rawHref);
  el.dataset.bolUrl = href;
  el.href = href;
  el.removeAttribute('target');
  el.removeAttribute('rel');
  el.classList.remove('disabled');
}

function kaShipmentAuthParams() {
  const params = new URLSearchParams();
  const adminId = kaAdminAuthId() || (kaStartEmployeeId ? Number(kaStartEmployeeId) : null);
  if (adminId) params.set('employee_id', adminId);
  return params;
}

function kaShipmentAuthMeta() {
  const adminId = kaAdminAuthId() || (kaStartEmployeeId ? Number(kaStartEmployeeId) : null);
  return {
    employee_id: adminId || null,
    device_id: kaDeviceId || null,
    device_secret: kaGetDeviceSecret() || null
  };
}

function kaAppendShipmentAuth(url) {
  const params = kaShipmentAuthParams();
  if (!params.toString() || !url || url === '#') return url;
  try {
    const u = new URL(url, window.location.origin);
    params.forEach((value, key) => {
      if (!u.searchParams.get(key)) u.searchParams.set(key, value);
    });
    return u.pathname + u.search;
  } catch {
    return url;
  }
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

function kaFormatPhoneValue(val) {
  const digits = String(val || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function kaLoadNotifyPrefFromStorage() {
  if (!kaCurrentAdmin || !kaCurrentAdmin.id) return { ...KA_NOTIFY_DEFAULT };
  try {
    const raw = localStorage.getItem(kaNotifyStorageKey());
    if (!raw) return { ...KA_NOTIFY_DEFAULT };
    const parsed = JSON.parse(raw);

    const shipmentsEnabled =
      parsed.shipments_enabled !== undefined
        ? parsed.shipments_enabled
        : (parsed.enabled !== undefined ? parsed.enabled : KA_NOTIFY_DEFAULT.shipments_enabled);
    const clockoutEnabled =
      parsed.clockout_enabled !== undefined
        ? parsed.clockout_enabled
        : KA_NOTIFY_DEFAULT.clockout_enabled;
    const clockoutTime = parsed.clockout_time || KA_NOTIFY_DEFAULT.clockout_time;
    const notifyPhone = typeof parsed.notify_phone === 'string' ? parsed.notify_phone : '';
    const notifyPhoneEnabled =
      parsed.notify_phone_enabled !== undefined
        ? !!parsed.notify_phone_enabled
        : !!notifyPhone;
    const notifyEmail = typeof parsed.notify_email === 'string' ? parsed.notify_email : '';
    const notifyEmailEnabled =
      parsed.notify_email_enabled !== undefined
        ? !!parsed.notify_email_enabled
        : !!notifyEmail;

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
      remind_time: parsed.remind_time || KA_NOTIFY_DEFAULT.remind_time,
      shipments_enabled: !!shipmentsEnabled,
      enabled: !!shipmentsEnabled,
      clockout_enabled: !!clockoutEnabled,
      clockout_time: clockoutTime,
      notify_phone: notifyPhone,
      notify_phone_enabled: notifyPhoneEnabled,
      notify_email: notifyEmail,
      notify_email_enabled: notifyEmailEnabled
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
  const alertTime =
    pref?.remind_time ||
    pref?.clockout_time ||
    KA_NOTIFY_DEFAULT.remind_time;

  kaNotifyPref = {
    ...KA_NOTIFY_DEFAULT,
    ...pref,
    statuses: Array.isArray(pref?.statuses) ? pref.statuses : [],
    project_ids: Array.isArray(pref?.project_ids) ? pref.project_ids : [],
    remind_every_days: Number(pref?.remind_every_days) || KA_NOTIFY_DEFAULT.remind_every_days,
    remind_time: alertTime,
    shipments_enabled:
      pref?.shipments_enabled !== undefined
        ? pref.shipments_enabled
        : (pref?.enabled !== undefined ? pref.enabled : KA_NOTIFY_DEFAULT.shipments_enabled),
    clockout_enabled: pref?.clockout_enabled !== undefined ? pref.clockout_enabled : KA_NOTIFY_DEFAULT.clockout_enabled,
    clockout_time: alertTime,
    notify_phone: pref?.notify_phone || '',
    notify_phone_enabled: !!pref?.notify_phone_enabled,
    notify_email: pref?.notify_email || '',
    notify_email_enabled: !!pref?.notify_email_enabled,
    enabled:
      pref?.shipments_enabled !== undefined
        ? pref.shipments_enabled
        : (pref?.enabled !== undefined ? pref.enabled : KA_NOTIFY_DEFAULT.shipments_enabled)
  };

  const shipToggle = document.getElementById('ka-notify-shipments-enabled');
  if (shipToggle) shipToggle.checked = !!kaNotifyPref.shipments_enabled;
  kaToggleShipmentFields(!!kaNotifyPref.shipments_enabled);

  const clockToggle = document.getElementById('ka-notify-clockout-enabled');
  if (clockToggle) clockToggle.checked = !!kaNotifyPref.clockout_enabled;
  const clockBody = document.getElementById('ka-notify-clockout-body');
  if (clockBody) clockBody.classList.toggle('hidden', !kaNotifyPref.clockout_enabled);

  const everyEl = document.getElementById('ka-notify-every-days');
  if (everyEl) {
    everyEl.value = Number(kaNotifyPref.remind_every_days) || 1;
  }
  const alertTimeEl = document.getElementById('ka-notify-alert-time');
  if (alertTimeEl) {
    alertTimeEl.value = kaNotifyPref.remind_time || KA_NOTIFY_DEFAULT.remind_time;
  }
  const phoneEl = document.getElementById('ka-notify-phone');
  const phoneToggle = document.getElementById('ka-notify-phone-enabled');
  if (phoneToggle) {
    phoneToggle.checked = !!kaNotifyPref.notify_phone_enabled;
    phoneToggle.addEventListener('change', () => {
      kaNotifyPref.notify_phone_enabled = phoneToggle.checked;
      if (!phoneToggle.checked) kaNotifyPref.notify_phone = '';
      if (phoneEl) {
        phoneEl.classList.toggle('hidden', !phoneToggle.checked);
        if (!phoneToggle.checked) phoneEl.value = '';
      }
      kaSaveNotifyPref(kaNotifyPref);
    });
  }
  if (phoneEl) {
    phoneEl.value = kaFormatPhoneValue(kaNotifyPref.notify_phone || '');
    phoneEl.classList.toggle('hidden', !kaNotifyPref.notify_phone_enabled);
    phoneEl.addEventListener('input', () => {
      const formatted = kaFormatPhoneValue(phoneEl.value);
      phoneEl.value = formatted;
      kaNotifyPref.notify_phone = formatted;
      kaSaveNotifyPref(kaNotifyPref);
    });
  }
  const emailEl = document.getElementById('ka-notify-email');
  const emailToggle = document.getElementById('ka-notify-email-enabled');
  if (emailToggle) {
    emailToggle.checked = !!kaNotifyPref.notify_email_enabled;
    emailToggle.addEventListener('change', () => {
      kaNotifyPref.notify_email_enabled = emailToggle.checked;
      if (!emailToggle.checked) kaNotifyPref.notify_email = '';
      if (emailEl) {
        emailEl.classList.toggle('hidden', !emailToggle.checked);
        if (!emailToggle.checked) emailEl.value = '';
      }
      kaSaveNotifyPref(kaNotifyPref);
    });
  }
  if (emailEl) {
    emailEl.value = kaNotifyPref.notify_email || '';
    emailEl.classList.toggle('hidden', !kaNotifyPref.notify_email_enabled);
  }

  kaRenderNotifyStatuses(statusesList || kaNotifyStatusesSource());
  kaRefreshNotifyProjectSelect();
}

function kaCollectNotifyForm() {
  const shipmentsEnabled = document.getElementById('ka-notify-shipments-enabled')?.checked || false;
  const clockoutEnabled = document.getElementById('ka-notify-clockout-enabled')?.checked || false;
  const everyVal = Number(document.getElementById('ka-notify-every-days')?.value || 1);
  const alertTimeVal = document.getElementById('ka-notify-alert-time')?.value || KA_NOTIFY_DEFAULT.remind_time;
  const phoneVal = (document.getElementById('ka-notify-phone')?.value || '').trim();
  const phoneEnabled = document.getElementById('ka-notify-phone-enabled')?.checked || false;
  const emailVal = (document.getElementById('ka-notify-email')?.value || '').trim();
  const emailEnabled = document.getElementById('ka-notify-email-enabled')?.checked || false;

  const statuses = Array.from(
    document.querySelectorAll('#ka-notify-statuses-menu input[type="checkbox"]:checked')
  ).map(cb => cb.value);

  const projectIds = Array.from(
    document.querySelectorAll('#ka-notify-projects-menu input[type="checkbox"]:checked')
  ).map(cb => Number(cb.value)).filter(n => Number.isFinite(n));

  return {
    enabled: shipmentsEnabled, // legacy
    shipments_enabled: shipmentsEnabled,
    clockout_enabled: clockoutEnabled,
    clockout_time: alertTimeVal,
    notify_phone: phoneEnabled ? phoneVal : '',
    notify_phone_enabled: phoneEnabled,
    notify_email: emailEnabled ? emailVal : '',
    notify_email_enabled: emailEnabled,
    statuses,
    project_ids: projectIds,
    remind_every_days: everyVal > 0 ? everyVal : 1,
    remind_time: alertTimeVal
  };
}

function kaToggleShipmentFields(enabled) {
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
    const title = sh.title || sh.sku || `Shipment #${sh.id || ''}`;
    const bol = sh.bol_number ? `BOL ${sh.bol_number}` : '';
    const project = sh.project_name ? sh.project_name : 'No project set';
    const verify = kaShipVerificationInfo(sh);
    const late = kaStorageLateFees(sh.storage_due_date, sh.storage_daily_late_fee);
    const isOverdue = late.daysLate > 0 && late.estimate > 0;
    const showPaymentDetails = kaCanViewPayroll();
    const overdueText = showPaymentDetails
      ? `Shipment overdue · Estimated charges: $${late.estimate.toFixed(2)}`
      : 'Shipment overdue';

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
          </div>
        </div>
        <div class="ka-ship-header-right">
          ${
            bol
              ? `<a class="ka-ship-bol-pill ka-ship-bol" data-bol-for="${sh.id}" href="javascript:void(0)">${bol}</a>`
              : ''
          }
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

      <div class="ka-ship-card-actions">
        <button type="button" class="btn secondary btn-sm" data-ka-open-items="${sh.id}">
          View & verify items
        </button>
        <button type="button" class="ka-ship-chevron-btn" data-ka-open-overview="${sh.id}" aria-label="View shipment details">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </button>
      </div>
    `;
    wrap.appendChild(card);
  });

  if (!wrap.dataset.bound) {
    wrap.addEventListener('click', (e) => {
      const bolLink = e.target.closest('.ka-ship-bol');
      if (bolLink) {
        e.preventDefault();
        e.stopPropagation();
        const shipmentId =
          Number(bolLink.dataset.bolFor) ||
          Number(bolLink.closest('.ka-ship-card')?.dataset.shipmentId);
        const bolName = (bolLink.textContent || '').trim() || 'BOL';
        const openWithUrl = (url) => {
          if (!url) return false;
          kaOpenDocViewer({ url, name: bolName, type: 'BOL' });
          return true;
        };
        if (bolLink.dataset.bolUrl) {
          openWithUrl(bolLink.dataset.bolUrl);
          return;
        }
        if (!shipmentId) return;
        kaHydrateShipmentCard(shipmentId).then(() => {
          if (bolLink.dataset.bolUrl) {
            openWithUrl(bolLink.dataset.bolUrl);
          } else {
            kaShowInlineAlert('No BOL document uploaded for this shipment.', 'error');
          }
        }).catch(err => {
          console.warn('Failed to load BOL document', err);
          kaShowInlineAlert('Unable to load the BOL document.', 'error');
        });
        return;
      }

      const overviewBtn = e.target.closest('[data-ka-open-overview]');
      if (overviewBtn) {
        const sid = Number(overviewBtn.dataset.kaOpenOverview);
        if (sid) {
          kaOpenItemsModal(sid, { tab: 'overview' });
        }
        return;
      }

      const btn = e.target.closest('[data-ka-open-items]');
      if (btn) {
        const sid = Number(btn.dataset.kaOpenItems);
        if (sid) {
          kaOpenItemsModal(sid, { tab: 'items' });
        }
      }
    });
    wrap.dataset.bound = '1';
  }
}

async function kaLoadShipments(opts = {}) {
  const { forceFresh = false } = opts || {};
  if (kaShipmentsLoading) {
    kaShipmentsReloadPending = kaShipmentsReloadPending || forceFresh;
    return;
  }
  kaShipmentsLoading = true;
  const listEl = document.getElementById('ka-shipments-list');
  const statusSel = document.getElementById('ka-shipments-filter');
  const projSel = document.getElementById('ka-shipments-project');

  if (!kaCanViewShipments()) {
    if (listEl) listEl.innerHTML = '<div class="ka-ship-muted">You do not have shipments access.</div>';
    kaShipmentsLoading = false;
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
  params.set('_', Date.now()); // cache buster to avoid stale responses

  const cached = kaLoadShipmentsCache();
  const offline = !navigator.onLine;
  if (offline) {
    if (cached && Array.isArray(cached.shipments) && cached.shipments.length) {
      kaShipments = cached.shipments;
      kaRenderShipmentsList(kaShipments);
      if (listEl) listEl.innerHTML = `<div class="ka-ship-muted">Offline – showing last downloaded shipments.</div>`;
      kaShipmentsLoading = false;
      return;
    }
    if (listEl) listEl.innerHTML = `<div class="ka-ship-muted">Offline and no cached shipments available.</div>`;
    kaShipmentsLoading = false;
    return;
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
    if (cached && Array.isArray(cached.shipments) && cached.shipments.length) {
      kaShipments = cached.shipments;
      kaRenderShipmentsList(kaShipments);
      kaProcessNewShipmentsForAlert();
      kaStartNotifyTimer(true);
      if (listEl) {
        listEl.innerHTML = `<div class="ka-ship-muted">Showing cached shipments (may be stale).</div>`;
      }
    } else if (listEl) {
      listEl.innerHTML = `<div class="ka-ship-muted">Error loading shipments: ${err.message || err}</div>`;
    }
  } finally {
    kaShipmentsLoading = false;
    if (kaShipmentsReloadPending) {
      kaShipmentsReloadPending = false;
      // Ensure the queued refresh uses fresh data
      kaLoadShipments({ forceFresh: true });
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
  if (!kaNotifyPref.shipments_enabled) return;

  await kaTriggerShipmentNotification(forceNow);
}

function kaProcessNewShipmentsForAlert() {
  if (!kaNotifyPref.shipments_enabled) return;
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
  if (!kaNotifyPref.shipments_enabled) return;
  const now = Date.now();
  const matches = kaShipmentsMatchingNotify(kaNotifyPref);

  const outstanding = matches.filter(sh =>
    (sh.status || '') === 'Cleared - Ready for Release' &&
    (!sh.picked_up_by || String(sh.picked_up_by).trim() === '')
  );

  const everyDays = Math.max(Number(kaNotifyPref.remind_every_days) || 1, 1);
  const today = new Date();
  const targetTime = (kaNotifyPref.remind_time || KA_NOTIFY_DEFAULT.remind_time).match(/^(\d{2}):(\d{2})$/)
    ? kaNotifyPref.remind_time
    : KA_NOTIFY_DEFAULT.remind_time;

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

async function kaClockoutAlertCheck(forceNow = false) {
  if (!kaNotifyPref.clockout_enabled || !kaKiosk) return;

  const timeStr =
    (kaNotifyPref.clockout_time || KA_NOTIFY_DEFAULT.clockout_time).match(/^(\d{2}):(\d{2})$/)
      ? kaNotifyPref.clockout_time
      : KA_NOTIFY_DEFAULT.clockout_time;

  const [hh, mm] = timeStr.split(':').map(n => Number(n));
  const target = new Date();
  target.setHours(hh, mm, 0, 0);
  const now = new Date();
  const todayKey = kaTodayIso();

  if (!forceNow) {
    if (now.getTime() < target.getTime()) return;
    if (kaClockoutAlertedDay === todayKey) return;
  }

  let rows = [];
  try {
    const res = await fetchJSON(`/api/kiosks/${kaKiosk.id}/open-punches`);
    rows = Array.isArray(res) ? res : [];
  } catch (err) {
    console.warn('Clock-out alert fetch failed:', err);
    return;
  }

  const open = rows.filter(r => !r.clock_out_ts);
  if (!open.length) {
    if (forceNow) {
      kaSetNotifyMsg('No workers currently on the clock for clock-out alert.', '#0f172a');
    }
    return;
  }

  const names = open.slice(0, 5).map(r => r.employee_name || 'Worker');
  const extra = open.length > 5 ? ` + ${open.length - 5} more` : '';
  const body = `${names.join(', ')}${extra}`;

  const ok = await kaEnsureNotifyPermission();
  if (ok) {
    try {
      new Notification('Workers still clocked in', {
        body: `Still on the clock past ${timeStr} — ${body}`
      });
    } catch (err) {
      console.warn('Kiosk clock-out notification failed:', err);
    }
  }

  kaSetNotifyMsg(`Clock-out alert sent for workers still on the clock past ${timeStr}.`, '#0f172a');
  kaClockoutAlertedDay = todayKey;
}

async function kaStartNotifyTimer(forcePing = false) {
  if (kaNotifyTimer) {
    clearInterval(kaNotifyTimer);
    kaNotifyTimer = null;
  }

  if (!kaNotifyPref.shipments_enabled && !kaNotifyPref.clockout_enabled) return;

  const perm = await kaEnsureNotifyPermission();
  if (!perm) {
    kaSetNotifyMsg('Allow browser notifications to receive alerts.', '#b45309');
    return;
  }

  kaNotifyTimer = setInterval(() => {
    kaReminderCheck(false).catch(err => {
      console.warn('Kiosk notify tick failed:', err);
    });
    kaClockoutAlertCheck(false).catch(err => {
      console.warn('Kiosk clock-out alert failed:', err);
    });
  }, 30 * 60 * 1000); // check every 30 minutes

  if (forcePing) {
    kaReminderCheck(true).catch(err => {
      console.warn('Kiosk notify check failed:', err);
    });
    kaClockoutAlertCheck(true).catch(err => {
      console.warn('Kiosk clock-out check failed:', err);
    });
  }
}

function kaInitNotifyPanel() {
  if (!kaCurrentAdmin || !kaCurrentAdmin.id) return;

  kaNotifiedShipments = new Set();
  kaReminderTimestamps = {};
  kaClockoutAlertedDay = '';
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

  const shipToggle = document.getElementById('ka-notify-shipments-enabled');
  if (shipToggle) {
    shipToggle.addEventListener('change', () => {
      kaNotifyPref.shipments_enabled = shipToggle.checked;
      kaNotifyPref.enabled = shipToggle.checked; // legacy
      kaToggleShipmentFields(shipToggle.checked);
      kaReminderTimestamps = {};
      kaNotifiedShipments = new Set();
      kaSaveNotifyPref(kaNotifyPref);
      kaStartNotifyTimer(true);
    });
  }

  const clockToggle = document.getElementById('ka-notify-clockout-enabled');
  if (clockToggle) {
    clockToggle.addEventListener('change', () => {
      kaNotifyPref.clockout_enabled = clockToggle.checked;
      kaClockoutAlertedDay = '';
      const clockBody = document.getElementById('ka-notify-clockout-body');
      if (clockBody) clockBody.classList.toggle('hidden', !clockToggle.checked);
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

  const alertTimeEl = document.getElementById('ka-notify-alert-time');
  if (alertTimeEl) {
    alertTimeEl.addEventListener('change', () => {
      const val = alertTimeEl.value || KA_NOTIFY_DEFAULT.remind_time;
      kaNotifyPref.remind_time = val;
      kaNotifyPref.clockout_time = val;
      kaClockoutAlertedDay = '';
      kaReminderTimestamps = {};
      kaSaveNotifyPref(kaNotifyPref);
      kaStartNotifyTimer(true);
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
      kaClockoutAlertedDay = '';
      kaSetNotifyMsg('Notification settings saved for this kiosk.', 'green');

      const statusMenu = document.getElementById('ka-notify-statuses-menu');
      if (statusMenu) statusMenu.classList.add('hidden');
      const projMenu = document.getElementById('ka-notify-projects-menu');
      if (projMenu) projMenu.classList.add('hidden');
      kaToggleShipmentFields(!!pref.shipments_enabled);
    });
  }

  const testBtn = document.getElementById('ka-notify-test');
  if (testBtn) {
    testBtn.addEventListener('click', () => {
      const tests = [];
      if (kaNotifyPref.shipments_enabled) tests.push(kaTriggerShipmentNotification(true));
      if (kaNotifyPref.clockout_enabled) tests.push(kaClockoutAlertCheck(true));
      if (!tests.length) {
        kaSetNotifyMsg('Enable a notification type to send a test.', '#b45309');
        return;
      }
      Promise.allSettled(tests);
    });
  }

  kaStartNotifyTimer(true);
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
    kaShowView('timesheets');
  } else if (!kaCanViewTimeReports() && kaCurrentView === 'time') {
    kaShowView('timesheets');
  }

  kaUpdateBottomNavDiamond();
}

async function kaLoadAccessPerms() {
  const defaults = {
    see_shipments: true,
    modify_time: true,
    view_time_reports: true,
    view_all_timesheets: false,
    view_payroll: true,
    modify_pay_rates: false
  };

  let nextPerms = { ...defaults };
  try {
    // Kiosk can call the public kiosk settings endpoint for clock-in photo requirement
    const res = await fetchJSON('/api/kiosk/settings');
    const settings = res && res.settings ? res.settings : {};
    kaClockInPhotoRequired = !!settings.clock_in_photo_required;
  } catch (err) {
    console.warn('Unable to load access permissions, using defaults', err);
  }

  const coerceFlag = (value, fallback) => {
    if (value === undefined || value === null) return fallback;
    return value === true || value === 1 || value === 'true';
  };

  const admin = kaCurrentAdmin || {};
  nextPerms = {
    ...defaults,
    see_shipments: coerceFlag(admin.see_shipments, defaults.see_shipments),
    modify_time: coerceFlag(admin.modify_time, defaults.modify_time),
    view_time_reports: coerceFlag(admin.view_time_reports, defaults.view_time_reports),
    view_all_timesheets: coerceFlag(admin.view_all_timesheets, defaults.view_all_timesheets),
    view_payroll: coerceFlag(admin.view_payroll, defaults.view_payroll),
    modify_pay_rates: coerceFlag(admin.modify_pay_rates, defaults.modify_pay_rates)
  };

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
    view_all_timesheets: false,
    view_payroll: false,
    modify_pay_rates: false
  };
  kaApplyAccessUI();

  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: kaGetCsrfHeader()
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

function kaUpdateSidebarClockedIn() {
  const statusTextEl = document.getElementById('ka-sidebar-clocked-status-text');
  const statusEl = document.getElementById('ka-sidebar-clocked-status');
  const icon = document.getElementById('ka-sidebar-clocked-icon');
  if (!statusTextEl) return;

  const isClockedIn = !!(kaAdminOpenPunch && kaAdminOpenPunch.open);
  const statusLabel = isClockedIn ? 'Clocked In' : 'Not Clocked In';
  let projectLabel = 'Project N/A';
  if (isClockedIn) {
    const projectName = kaAdminOpenPunch.project_name;
    const projectId = kaAdminOpenPunch.project_id;
    projectLabel = projectName || (projectId ? `Project ${projectId}` : 'Project N/A');
  }
  statusTextEl.textContent = `${statusLabel} - ${projectLabel}`;

  if (statusEl) {
    statusEl.classList.toggle('is-active', isClockedIn);
  }

  if (icon) {
    icon.classList.toggle('is-active', isClockedIn);
  }
}

function kaSetInlineStatus(el, message, variant = '') {
  if (!el) return;
  el.textContent = message || '';
  let cls = 'ka-status';
  if (variant === 'ok') cls += ' ka-status-ok';
  if (variant === 'error') cls += ' ka-status-error';
  el.className = cls;
}

function kaSetAccountDisabled(disabled) {
  const fields = [
    'ka-account-email-current',
    'ka-account-email-new',
    'ka-account-email-confirm',
    'ka-account-email-password',
    'ka-account-password-current',
    'ka-account-password-new',
    'ka-account-password-confirm'
  ];
  fields.forEach((id) => {
    const field = document.getElementById(id);
    if (field) field.disabled = !!disabled;
  });
  const buttons = ['ka-account-email-save', 'ka-account-password-save'];
  buttons.forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !!disabled;
  });
}

async function kaLoadAccountInfo() {
  const authStatusEl = document.getElementById('ka-account-auth-status');
  const emailCurrent = document.getElementById('ka-account-email-current');
  const emailStatus = document.getElementById('ka-account-email-status');
  const passwordStatus = document.getElementById('ka-account-password-status');

  kaSetInlineStatus(emailStatus, '');
  kaSetInlineStatus(passwordStatus, '');
  kaSetAccountDisabled(true);

  try {
    const me = await fetchJSON('/api/auth/me');
    kaAccountAuthed = !!me?.ok;
    if (emailCurrent) {
      emailCurrent.value = me?.user?.email || '';
    }
    kaSetInlineStatus(authStatusEl, '');
    kaSetAccountDisabled(!kaAccountAuthed);
  } catch (err) {
    kaAccountAuthed = false;
    if (emailCurrent) emailCurrent.value = '';
    kaSetInlineStatus(
      authStatusEl,
      'Sign in to the Admin Console to update your account.',
      'error'
    );
    kaSetAccountDisabled(true);
  }
}

function kaBindAccountActions() {
  if (kaAccountBound) return;
  kaAccountBound = true;

  const emailSave = document.getElementById('ka-account-email-save');
  const emailStatus = document.getElementById('ka-account-email-status');
  const emailCurrent = document.getElementById('ka-account-email-current');
  const emailNew = document.getElementById('ka-account-email-new');
  const emailConfirm = document.getElementById('ka-account-email-confirm');
  const emailPassword = document.getElementById('ka-account-email-password');

  if (emailSave) {
    emailSave.addEventListener('click', async () => {
      if (!kaAccountAuthed) {
        kaSetInlineStatus(emailStatus, 'Sign in to update your email.', 'error');
        return;
      }
      const currentEmail = String(emailCurrent?.value || '').trim();
      const nextEmail = String(emailNew?.value || '').trim();
      const confirmEmail = String(emailConfirm?.value || '').trim();
      const currentPassword = String(emailPassword?.value || '');

      if (!nextEmail || !confirmEmail || !currentPassword) {
        kaSetInlineStatus(emailStatus, 'Fill out email and password fields to update.', 'error');
        return;
      }
      if (nextEmail !== confirmEmail) {
        kaSetInlineStatus(emailStatus, 'New email and confirmation do not match.', 'error');
        return;
      }
      if (currentEmail && nextEmail.toLowerCase() === currentEmail.toLowerCase()) {
        kaSetInlineStatus(emailStatus, 'New email matches your current email.', 'error');
        return;
      }

      const original = emailSave.textContent || 'Update Email';
      emailSave.disabled = true;
      emailSave.textContent = 'Updating…';
      kaSetInlineStatus(emailStatus, 'Updating email…');

      try {
        const res = await fetchJSON('/api/auth/change-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            current_password: currentPassword,
            new_email: nextEmail
          })
        });
        const updatedEmail = res?.email || nextEmail;
        if (emailCurrent) emailCurrent.value = updatedEmail;
        if (emailNew) emailNew.value = '';
        if (emailConfirm) emailConfirm.value = '';
        if (emailPassword) emailPassword.value = '';
        kaSetInlineStatus(emailStatus, 'Email updated.', 'ok');
      } catch (err) {
        console.error('Kiosk admin email update error:', err);
        kaSetInlineStatus(emailStatus, err?.message || 'Failed to update email.', 'error');
      } finally {
        emailSave.disabled = false;
        emailSave.textContent = original;
      }
    });
  }

  const passwordSave = document.getElementById('ka-account-password-save');
  const passwordStatus = document.getElementById('ka-account-password-status');
  const passwordCurrent = document.getElementById('ka-account-password-current');
  const passwordNew = document.getElementById('ka-account-password-new');
  const passwordConfirm = document.getElementById('ka-account-password-confirm');

  if (passwordSave) {
    passwordSave.addEventListener('click', async () => {
      if (!kaAccountAuthed) {
        kaSetInlineStatus(passwordStatus, 'Sign in to update your password.', 'error');
        return;
      }
      const current = String(passwordCurrent?.value || '');
      const next = String(passwordNew?.value || '');
      const confirm = String(passwordConfirm?.value || '');

      if (!current || !next || !confirm) {
        kaSetInlineStatus(passwordStatus, 'Fill out all password fields to update.', 'error');
        return;
      }
      if (next !== confirm) {
        kaSetInlineStatus(passwordStatus, 'New password and confirmation do not match.', 'error');
        return;
      }
      if (next.length < 8) {
        kaSetInlineStatus(passwordStatus, 'New password must be at least 8 characters.', 'error');
        return;
      }

      const original = passwordSave.textContent || 'Update Password';
      passwordSave.disabled = true;
      passwordSave.textContent = 'Updating…';
      kaSetInlineStatus(passwordStatus, 'Updating password…');

      try {
        await fetchJSON('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            current_password: current,
            new_password: next
          })
        });
        if (passwordCurrent) passwordCurrent.value = '';
        if (passwordNew) passwordNew.value = '';
        if (passwordConfirm) passwordConfirm.value = '';
        kaSetInlineStatus(passwordStatus, 'Password updated.', 'ok');
      } catch (err) {
        console.error('Kiosk admin password update error:', err);
        kaSetInlineStatus(passwordStatus, err?.message || 'Failed to update password.', 'error');
      } finally {
        passwordSave.disabled = false;
        passwordSave.textContent = original;
      }
    });
  }
}

function kaGetDeviceSecret() {
  try {
    const stored = localStorage.getItem(KA_DEVICE_SECRET_KEY);
    if (stored) return stored;
  } catch {
    // ignore
  }
  try {
    const parts = document.cookie.split(';').map(p => p.trim()).filter(Boolean);
    for (const part of parts) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const key = decodeURIComponent(part.slice(0, eq).trim());
      if (key !== 'kiosk_device_secret') continue;
      const value = decodeURIComponent(part.slice(eq + 1).trim());
      return value || null;
    }
  } catch {
    // ignore
  }
  return null;
}

function kaLoadOrgTimezone() {
  try {
    return localStorage.getItem(KA_ORG_TIMEZONE_KEY) || KA_DEFAULT_TIMEZONE;
  } catch {
    return KA_DEFAULT_TIMEZONE;
  }
}

function kaTodayIso() {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: kaOrgTimezone || KA_DEFAULT_TIMEZONE,
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
  if (!input) return '';
  if (typeof input === 'string') {
    const match = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const [, yy, mm, dd] = match;
      return `${mm}/${dd}/${yy}`;
    }
  }
  const dt = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(dt.getTime())) return '';
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const yy = dt.getFullYear();
  return `${mm}/${dd}/${yy}`;
}

function kaDatePartsFromInput(input) {
  if (!input) return null;
  if (typeof input === 'string') {
    const match = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const [, yy, mm, dd] = match;
      return { y: Number(yy), m: Number(mm), d: Number(dd) };
    }
  }
  const dt = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(dt.getTime())) return null;
  return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() };
}

function kaFmtDateShort(input) {
  const parts = kaDatePartsFromInput(input);
  if (!parts) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[parts.m - 1] || '';
  return `${month} ${parts.d}`;
}

function kaFmtDateLong(input) {
  const parts = kaDatePartsFromInput(input);
  if (!parts) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[parts.m - 1] || '';
  return `${month} ${parts.d}, ${parts.y}`;
}

function kaSetHeaderView(title, dateLabel = '') {
  const titleEl = document.getElementById('ka-header-view-title');
  const dateEl = document.getElementById('ka-header-view-date');
  const sepEl = document.getElementById('ka-header-view-sep');
  if (titleEl) titleEl.textContent = title || '';
  if (dateEl) dateEl.textContent = dateLabel || '';
  const hasDate = !!dateLabel;
  if (dateEl) dateEl.classList.toggle('hidden', !hasDate);
  if (sepEl) sepEl.classList.toggle('hidden', !hasDate);
}

function kaTimesheetHeaderDateValue(activeSession = null) {
  const session = activeSession || kaComputeActiveSession(kaSessions || []);
  const sessionDate = session && session.date ? String(session.date) : '';
  return kaTimesheetDate || sessionDate || kaTodayIso();
}

function kaUpdateHeaderTitle(view = kaCurrentView) {
  const current = view || kaCurrentView || 'timesheets';
  let title = '';
  let dateLabel = '';
  if (current === 'timesheets') {
    title = 'Timesheets';
    dateLabel = kaFmtDateShort(kaTimesheetHeaderDateValue());
  } else if (current === 'workers') {
    title = 'Current Workers';
    dateLabel = kaCurrentWorkersProjectLabel();
  } else if (current === 'shipments') {
    title = 'Shipments – Ready to Pick Up';
  } else if (current === 'time') {
    title = 'Time Entries';
  } else if (current === 'account') {
    title = 'My Account';
  } else if (current === 'settings') {
    title = 'Settings';
  }
  kaSetHeaderView(title, dateLabel);
}

function kaCurrentWorkersProjectLabel() {
  const projectId = kaCurrentLiveProjectId();
  const normalizedId = Number.isFinite(Number(projectId)) ? Number(projectId) : null;
  if (normalizedId === null) return '';
  const sessions = Array.isArray(kaSessions) ? kaSessions : [];
  const match = sessions.find(s => Number(s.project_id) === normalizedId);
  if (match) {
    return match.project_name || kaProjectLabelById(match.project_id) || `Project ${normalizedId}`;
  }
  return kaProjectLabelById(normalizedId) || `Project ${normalizedId}`;
}

function kaLiveTimesheetOptionLabel(session) {
  if (!session) return '';
  return (
    session.project_name ||
    kaProjectLabelById(session.project_id) ||
    (session.project_id ? `Project ${session.project_id}` : '')
  );
}

function kaRenderLiveTimesheetFilter() {
  const select = document.getElementById('ka-live-timesheet-filter');
  if (!select) return;

  const sessions = Array.isArray(kaSessions) ? kaSessions : [];
  const today = kaTodayIso();
  const daySessions = sessions.filter(s => (s?.date || '') === today);
  const activeSession = kaComputeActiveSession(sessions);
  const activeLabel =
    activeSession && (activeSession?.date || '') === today
      ? kaLiveTimesheetOptionLabel(activeSession)
      : '';

  select.innerHTML = '';
  const activeOption = document.createElement('option');
  activeOption.value = '';
  activeOption.textContent = activeLabel ? `Active — ${activeLabel}` : 'No active timesheet';
  select.appendChild(activeOption);

  const sorted = kaSortSessionsByRecency(daySessions);
  const seen = new Set();
  sorted.forEach(session => {
    const pid = session && session.project_id !== undefined && session.project_id !== null
      ? Number(session.project_id)
      : null;
    if (!Number.isFinite(pid)) return;
    const key = String(pid);
    if (seen.has(key)) return;
    seen.add(key);
    const opt = document.createElement('option');
    opt.value = String(pid);
    opt.textContent = kaLiveTimesheetOptionLabel(session);
    select.appendChild(opt);
  });

  const selectedValue =
    kaLiveProjectOverride !== null && kaLiveProjectOverride !== undefined
      ? String(kaLiveProjectOverride)
      : '';
  if (selectedValue && !Array.from(select.options).some(opt => opt.value === selectedValue)) {
    const fallback = document.createElement('option');
    fallback.value = selectedValue;
    fallback.textContent = kaProjectLabelById(selectedValue) || `Project ${selectedValue}`;
    select.appendChild(fallback);
  }
  select.value = selectedValue;
  select.disabled = select.options.length <= 1;
}

function kaBindLiveTimesheetFilter() {
  const select = document.getElementById('ka-live-timesheet-filter');
  if (!select || select.dataset.bound === '1') return;
  select.addEventListener('change', () => {
    const val = select.value;
    if (!val) {
      kaLiveProjectOverride = null;
    } else {
      const pid = Number(val);
      kaLiveProjectOverride = Number.isFinite(pid) ? pid : null;
    }
    kaUpdateLiveDateLabel();
    kaLoadLiveWorkers();
  });
  select.dataset.bound = '1';
}

function kaUpdateLiveDateLabel() {
  const dateLabel = kaCurrentWorkersProjectLabel();
  if (kaCurrentView === 'workers') {
    kaSetHeaderView('Current Workers', dateLabel || '');
  }
}

function kaUpdateSessionFilterDate() {
  const dateEl = document.getElementById('ka-session-filter-date');
  if (dateEl) {
    const selected = kaTimesheetSelectedDate();
    dateEl.textContent = kaFmtDateLong(selected) || kaFmtDateLongTZ(new Date());
  }
}

function kaFmtDateLongTZ(input = new Date()) {
  const dt = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(dt.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: kaOrgTimezone || KA_DEFAULT_TIMEZONE,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(dt);
  } catch (err) {
    console.warn('Falling back to local date for kaFmtDateLongTZ:', err);
    return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
}

function kaTimesheetSelectedDate() {
  return kaTimesheetDate || kaTodayIso();
}

function kaSyncTimesheetDateInput() {
  const input = document.getElementById('ka-timesheet-date-input');
  if (!input) return;
  const selected = kaTimesheetSelectedDate();
  if (selected && input.value !== selected) {
    input.value = selected;
  }
}

function kaUpdateTimesheetSectionLabel() {
  const label = document.getElementById('ka-timesheet-day-label');
  if (!label) return;
  const selected = kaTimesheetSelectedDate();
  const today = kaTodayIso();
  label.textContent = selected === today ? 'Today' : kaFmtDateShort(selected);
}

function kaSetTimesheetDate(nextDate, opts = {}) {
  if (!nextDate) return;
  kaTimesheetDate = nextDate;
  kaUpdateTimesheetHeading();
  kaUpdateSessionFilterDate();
  kaUpdateTimesheetSectionLabel();
  kaSyncTimesheetDateInput();
  kaBindBottomNavPositioning();
  kaUpdateBottomNavDiamond();
  if (!opts.skipLoad) {
    kaLoadSessions();
  }
}

function kaIsoOffsetDays(baseIso, deltaDays) {
  if (!baseIso) return '';
  const parts = kaDatePartsFromInput(baseIso);
  if (!parts) return '';
  const dt = new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
  if (Number.isNaN(dt.getTime())) return '';
  dt.setUTCDate(dt.getUTCDate() + Number(deltaDays || 0));
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function kaRefreshOrgTimezone() {
  if (!kaDeviceId) return null;
  const deviceSecret = kaGetDeviceSecret();
  if (!deviceSecret) return null;
  try {
    const data = await fetchJSON('/api/kiosks/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const nextTz = data && data.org_timezone ? String(data.org_timezone) : null;
    if (nextTz) {
      kaOrgTimezone = nextTz;
      try {
        localStorage.setItem(KA_ORG_TIMEZONE_KEY, nextTz);
      } catch {
        // ignore storage failures
      }
      kaUpdateLiveDateLabel();
      kaUpdateSessionFilterDate();
    }
    return nextTz;
  } catch {
    return null;
  }
}

function kaProjectLabelById(projectId) {
  if (!projectId || !Array.isArray(kaProjects)) return '';
  const p = kaProjects.find(proj => Number(proj.id) === Number(projectId));
  if (!p) return '(Inactive project)';
  return p.name || '(Unnamed project)';
}

function kaHasTimesheetSessions() {
  return Array.isArray(kaSessions) && kaSessions.length > 0;
}

function kaSyncTimesheetEmptyState() {
  const view = document.getElementById('ka-view-timesheets');
  const emptyState = document.getElementById('ka-timesheet-empty-state');
  const hasSessions = kaHasTimesheetSessions();
  const selected = kaTimesheetSelectedDate();
  const isToday = selected === kaTodayIso();
  const showBanner = !hasSessions;

  if (view) {
    view.classList.toggle('ka-timesheet-empty-day', showBanner && isToday);
    view.classList.toggle('ka-timesheet-empty-banner', showBanner);
  }
  if (emptyState) {
    emptyState.classList.toggle('hidden', !showBanner);
    if (showBanner) {
      const title = emptyState.querySelector('.ka-timesheet-empty-title');
      const copy = emptyState.querySelector('.ka-timesheet-empty-copy');
      const actions = emptyState.querySelector('.ka-timesheet-empty-actions');
      if (isToday) {
        if (title) title.textContent = 'No open timesheets';
        if (copy) {
          copy.textContent = 'Start a timesheet to set the active job for this tablet.';
        }
        actions?.classList.remove('hidden');
      } else {
        if (title) title.textContent = 'No timesheets for this day';
        if (copy) copy.textContent = 'No timesheets exist for this date.';
        actions?.classList.add('hidden');
      }
    }
  }
}

function kaUpdateActiveProjectUI() {
  const startBtn = document.getElementById('ka-start-new-btn');
  const createBlock = document.getElementById('ka-session-create');

  const hasActive = !!(kaKiosk && kaKiosk.project_id);
  const hasSessions = kaHasTimesheetSessions();
  if (!hasActive && hasSessions) {
    kaNewSessionVisible = true;
  }

  if (startBtn) {
    startBtn.classList.toggle('hidden', !hasActive || kaNewSessionVisible);
  }

  if (createBlock) {
    if (!hasSessions) {
      createBlock.classList.toggle('hidden', !kaNewSessionVisible);
    } else {
      createBlock.classList.toggle('hidden', hasActive && !kaNewSessionVisible);
    }
  }

  kaSyncTimesheetEmptyState();
}

function kaLoadOfflinePunches() {
  const list = kaStoreGet(KA_OFFLINE_QUEUE_KEY, []);
  return Array.isArray(list) ? list : [];
}

function kaSaveOfflinePunches(list) {
  kaStoreSet(KA_OFFLINE_QUEUE_KEY, list || []);
  kaUpdateOfflineIndicator();
}

function kaLoadVerificationQueue() {
  const list = kaStoreGet(KA_VERIFY_QUEUE_KEY, []);
  return Array.isArray(list) ? list : [];
}

function kaSaveVerificationQueue(list) {
  kaStoreSet(KA_VERIFY_QUEUE_KEY, list || []);
  kaUpdateOfflineIndicator();
}

function kaLoadShipmentNotesQueue() {
  const list = kaStoreGet(KA_SHIPMENT_NOTES_QUEUE_KEY, []);
  return Array.isArray(list) ? list : [];
}

function kaSaveShipmentNotesQueue(list) {
  kaStoreSet(KA_SHIPMENT_NOTES_QUEUE_KEY, list || []);
  kaUpdateOfflineIndicator();
}

function kaLoadTimeReviewQueue() {
  const list = kaStoreGet(KA_TIME_REVIEW_QUEUE_KEY, []);
  return Array.isArray(list) ? list : [];
}

function kaSaveTimeReviewQueue(list) {
  kaStoreSet(KA_TIME_REVIEW_QUEUE_KEY, list || []);
  kaUpdateOfflineIndicator();
}

function kaQueueTimeReview(entry) {
  if (!entry || !entry.exception_id || !entry.payload) return;
  const queue = kaLoadTimeReviewQueue();
  const id = Number(entry.exception_id);
  const remaining = queue.filter(item => Number(item.exception_id) !== id);
  remaining.push(entry);
  kaSaveTimeReviewQueue(remaining);
}

function kaQueueShipmentNotes(shipmentId, notes, meta = {}) {
  if (!shipmentId) return;
  const idNum = Number(shipmentId);
  if (!Number.isFinite(idNum)) return;
  const queue = kaLoadShipmentNotesQueue();
  const remaining = queue.filter(item => Number(item.shipment_id) !== idNum);
  const auth = {
    ...kaShipmentAuthMeta(),
    ...meta
  };
  remaining.push({
    shipment_id: idNum,
    notes: notes == null ? '' : String(notes),
    employee_id: auth.employee_id || null,
    device_id: auth.device_id || null,
    device_secret: auth.device_secret || null,
    queued_at: new Date().toISOString()
  });
  kaSaveShipmentNotesQueue(remaining);
}

function kaQueueShipmentVerification(shipmentId, items = [], meta = {}) {
  if (!shipmentId || !Array.isArray(items) || !items.length) return;
  const queue = kaLoadVerificationQueue();
  let entry = queue.find(q => Number(q.shipment_id) === Number(shipmentId));
  if (!entry) {
    entry = { shipment_id: shipmentId, items: [], queued_at: new Date().toISOString() };
    queue.push(entry);
  }

  const auth = {
    ...kaShipmentAuthMeta(),
    ...meta
  };
  const clientId =
    meta.client_id ||
    entry.client_id ||
    `verify_${shipmentId}_${Date.now().toString(36)}`;

  entry.employee_id = auth.employee_id || entry.employee_id || null;
  entry.device_id = auth.device_id || entry.device_id || null;
  entry.device_secret = auth.device_secret || entry.device_secret || null;
  entry.client_id = clientId;

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

async function kaSyncShipmentNotesQueue() {
  const queue = kaLoadShipmentNotesQueue();
  if (!Array.isArray(queue) || !queue.length) return;

  const remaining = [];

  for (const job of queue) {
    if (!job || !job.shipment_id) continue;
    const fallback = kaShipmentAuthMeta();
    const employeeId = job.employee_id || fallback.employee_id;
    const deviceId = job.device_id || fallback.device_id;
    const deviceSecret = job.device_secret || fallback.device_secret;

    if (!employeeId || !deviceId || !deviceSecret) {
      remaining.push(job);
      continue;
    }

    try {
      await fetchJSON(`/api/shipments/${job.shipment_id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: job.notes == null ? '' : String(job.notes),
          employee_id: employeeId,
          device_id: deviceId,
          device_secret: deviceSecret
        })
      });
    } catch (err) {
      console.warn('Failed to sync queued shipment notes', err);
      remaining.push(job);
    }
  }

  kaSaveShipmentNotesQueue(remaining);
}

async function kaSyncVerificationQueue() {
  const queue = kaLoadVerificationQueue();
  if (!Array.isArray(queue) || !queue.length) return;

  const remaining = [];

  for (const job of queue) {
    if (!job || !job.shipment_id || !Array.isArray(job.items) || !job.items.length) continue;
    const fallback = kaShipmentAuthMeta();
    const employeeId = job.employee_id || fallback.employee_id;
    const deviceId = job.device_id || fallback.device_id;
    const deviceSecret = job.device_secret || fallback.device_secret;
    const clientId = job.client_id || `verify_${job.shipment_id}_${Date.now().toString(36)}`;

    if (!employeeId || !deviceId || !deviceSecret) {
      remaining.push(job);
      continue;
    }

    try {
      await fetchJSON(`/api/shipments/${job.shipment_id}/verify-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: job.items,
          employee_id: employeeId,
          device_id: deviceId,
          device_secret: deviceSecret,
          client_id: clientId
        })
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

function kaSetLiveWorkersEmptyState(isEmpty) {
  const view = document.getElementById('ka-view-workers');
  const card = document.getElementById('ka-live-card');
  if (view) view.classList.toggle('ka-live-empty', !!isEmpty);
  if (card) card.classList.toggle('ka-live-empty', !!isEmpty);
}

function kaInitialsFromName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] || '' : '';
  return `${first}${last}`.toUpperCase();
}

async function kaLoadLiveWorkers() {
  if (!kaKiosk) return;

  const list = document.getElementById('ka-live-list');
  const tag = document.getElementById('ka-live-count-tag');
  const card = document.getElementById('ka-live-card');
  if (!list) return;

  const hasContent = list.dataset.hasContent === '1';

  // Loading card placeholder
  if (!hasContent) {
    list.innerHTML = `
      <div class="ka-live-item ka-live-placeholder" data-ka-placeholder="1" role="listitem">(loading…)</div>
    `;
  }
  if (card) card.classList.add('ka-refreshing');
  list.dataset.refreshing = '1';

  try {
    const rows = await fetchJSON(`/api/kiosks/${kaKiosk.id}/open-punches`);
    const punchRows = Array.isArray(rows) ? rows : [];
    const fragment = document.createDocumentFragment();

    let liveProjectId = kaCurrentLiveProjectId();

    const filterByProject = (pid) =>
      pid !== null && pid !== undefined
        ? punchRows.filter(r => Number(r.project_id) === Number(pid))
        : punchRows;

    let filteredRows = Number.isFinite(Number(liveProjectId))
      ? filterByProject(liveProjectId)
      : [];

    const openRows = filteredRows.filter(r => !r.clock_out_ts);
    const openCount = openRows.length;

    kaUpdateLiveDateLabel();

    // ----- No active workers currently clocked in -----
    if (!punchRows.length || openRows.length === 0) {
      const item = document.createElement('div');
      item.className = 'ka-live-item ka-live-placeholder';
      item.dataset.kaPlaceholder = '1';
      item.setAttribute('role', 'listitem');
      item.textContent = `(${liveProjectId !== null ? 'no active workers on this project' : 'no active workers on this kiosk'})`;
      fragment.appendChild(item);
      if (tag) {
        tag.textContent = '0 Active workers';
        tag.className = 'ka-tag gray';
      }
      kaSetLiveWorkersEmptyState(true);
      list.replaceChildren(fragment);
      list.dataset.hasContent = '1';
      return;
    }

    const todayStr = kaTodayIso();
    const now = new Date();
    let olderThanTodayCount = 0;

    // ----- Build rows: Employee | Clock In | Time on Clock -----
    openRows.forEach(r => {
      const item = document.createElement('article');

      let clockInLabel = '';
      let clockInDateLabel = '';
      let clockOutLabel = '';
      let durationLabel = '—';
      let isOlder = false;

      if (r.clock_in_ts) {
        const dt = new Date(r.clock_in_ts);

        // Clock In (local time)
        clockInLabel = dt.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        });
        clockInDateLabel = kaFmtDateLong(dt);

        // Time on Clock (duration)
        durationLabel = kaDurationLabelFromStart(
          r.clock_in_ts,
          r.clock_out_ts ? new Date(r.clock_out_ts) : now
        ) || '—';

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

      const employeeName = r.employee_name || '(Unknown employee)';
      const initials = kaInitialsFromName(r.employee_name || 'Employee');
      const clockInStamp = clockInDateLabel || '';
      const clockInText = clockInLabel ? `Clocked in ${clockInLabel}` : 'Clocked in';
      const clockOutText = clockOutLabel ? `Clocked out ${clockOutLabel}` : '';
      const clockOutHtml = clockOutText ? `<span class="ka-live-clockout">${clockOutText}</span>` : '';
      const clockSepHtml = clockOutText ? '<span class="ka-live-clock-sep">•</span>' : '';
      const prevTagHtml = isOlder ? '<span class="ka-live-prev-tag">Prev day</span>' : '';

      item.className = `ka-live-item is-active${isOlder ? ' is-previous' : ''}`;
      item.setAttribute('role', 'listitem');
      item.innerHTML = `
        <div class="ka-live-avatar" aria-hidden="true">
          <span class="ka-live-initials">${initials || '?'}</span>
        </div>
        <div class="ka-live-details">
          <div class="ka-live-name-row">
            <div class="ka-live-employee">${employeeName}</div>
          </div>
          <div class="ka-live-date">${clockInStamp || '—'}</div>
          <div class="ka-live-clock-row">
            <span class="ka-live-clockin">${clockInText}</span>
            ${clockSepHtml}
            ${clockOutHtml}
            ${prevTagHtml}
          </div>
        </div>
        <div class="ka-live-metric">
          <span class="ka-live-metric-value">${durationLabel}</span>
        </div>
      `;

      fragment.appendChild(item);
    });

    // Update active count tag with live data (no extra refresh required)
    if (tag) {
      const count = openCount;
      tag.textContent = `${count} Active worker${count === 1 ? '' : 's'}`;
      tag.className = `ka-tag ${count > 0 ? 'green' : 'gray'}`;
    }

    kaSetLiveWorkersEmptyState(false);
    list.replaceChildren(fragment);
    list.dataset.hasContent = '1';

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
    if (!hasContent) {
      list.innerHTML = `
        <div class="ka-live-item ka-live-placeholder" data-ka-placeholder="1" role="listitem">(error loading live workers)</div>
      `;
      list.dataset.hasContent = '1';
    }
    kaSetLiveWorkersEmptyState(true);
    if (tag) {
      tag.textContent = 'Error';
      tag.className = 'ka-tag orange';
    }
  } finally {
    delete list.dataset.refreshing;
    if (card) card.classList.remove('ka-refreshing');
  }
}



function kaUpdateTimesheetHeading(activeSession = null) {
  const dateValue = kaTimesheetHeaderDateValue(activeSession);
  const shortLabel = kaFmtDateShort(dateValue);
  const longLabel = kaFmtDateLong(dateValue);
  const rangeEl = document.getElementById('ka-timesheet-range-date');
  if (rangeEl) {
    rangeEl.textContent = longLabel || shortLabel || '';
  }
  kaSyncTimesheetDateInput();
  if (kaCurrentView === 'timesheets') {
    kaSetHeaderView('Timesheets', shortLabel || '');
  }
}

function kaSyncTimeOrientationHint() {
  const orientation = document.getElementById('ka-time-orientation');
  if (!orientation) return;
  const isLandscape = window.innerWidth > window.innerHeight;
  orientation.style.display = isLandscape ? 'none' : 'block';
}

function kaBindTimeOrientationListener() {
  if (kaTimeOrientationListenerBound) return;
  const handler = () => kaSyncTimeOrientationHint();
  window.addEventListener('resize', handler);
  window.addEventListener('orientationchange', handler);
  kaTimeOrientationListenerBound = true;
}

function kaSyncLiveCountPill() {
  const pill = document.getElementById('ka-live-count-tag');
  if (!pill) return;
  const leftSlot = document.getElementById('ka-live-controls-left');
  if (leftSlot && pill.parentElement !== leftSlot) {
    leftSlot.appendChild(pill);
  }
}

// --- Timesheet helpers (sessions per kiosk) ---

function kaShowView(view, opts = {}) {
  if (!KA_VIEWS.includes(view)) return;
  kaCurrentView = view;
  if (view === 'workers') {
    const projectOverride = opts.projectOverride;
    const preserveOverride = opts.preserveLiveProject === true;
    if (projectOverride !== null && projectOverride !== undefined && Number.isFinite(Number(projectOverride))) {
      kaLiveProjectOverride = Number(projectOverride);
    } else if (!preserveOverride) {
      kaLiveProjectOverride = null;
    }
  }
  KA_VIEWS.forEach(v => {
    const section = document.getElementById(`ka-view-${v}`);
    if (section) section.classList.toggle('hidden', v !== view);
  });

  const bottomNavBtn = document.querySelector(
    `.ka-bottom-nav button[data-ka-view="${view}"]`
  );
  if (bottomNavBtn) {
    document.querySelectorAll('.ka-bottom-nav button').forEach(btn => {
      const v = btn.getAttribute('data-ka-view');
      btn.classList.toggle('active', v === view);
    });
    kaUpdateBottomNavDiamond();
  }
  kaUpdateHeaderTitle(view);
  if (document.body) {
    document.body.classList.toggle('ka-view-workers-active', view === 'workers');
    document.body.classList.toggle('ka-view-timesheets-active', view === 'timesheets');
    document.body.classList.toggle('ka-view-shipments-active', view === 'shipments');
  }
  kaSyncLiveCountPill();

  if (view === 'time') {
    kaBindTimeOrientationListener();
    kaSyncTimeOrientationHint();
  }

  if (view === 'shipments' && kaCanViewShipments()) {
    kaLoadShipments({ forceFresh: true });
  }

  if (view === 'workers') {
    kaBindLiveTimesheetFilter();
    kaRenderLiveTimesheetFilter();
    kaLoadLiveWorkers();
  }

  if (view === 'account') {
    kaBindAccountActions();
    kaLoadAccountInfo();
  }
}

function kaUpdateBottomNavDiamond() {
  const nav = document.querySelector('.ka-bottom-nav');
  if (!nav) return;
  const diamond = nav.querySelector('.ka-nav-diamond');
  const svg = nav.querySelector('.ka-nav-bg');
  const pathEl = nav.querySelector('.ka-nav-bg-path');
  if (!diamond || !pathEl) return;
  const activeBtn = nav.querySelector('button.active') || nav.querySelector('button[data-ka-view]');
  if (!activeBtn) return;
  const navRect = nav.getBoundingClientRect();
  const btnRect = activeBtn.getBoundingClientRect();
  const centerX = btnRect.left + btnRect.width / 2 - navRect.left;
  nav.style.setProperty('--ka-nav-diamond-x', `${centerX}px`);
  kaUpdateBottomNavPath(nav, pathEl, centerX, svg);
}

function kaBindBottomNavPositioning() {
  if (kaBottomNavPositionBound) return;
  const handler = () => kaUpdateBottomNavDiamond();
  window.addEventListener('resize', handler);
  window.addEventListener('orientationchange', handler);
  kaBottomNavPositionBound = true;
}

function kaUpdateBottomNavPath(nav, pathEl, notchCenterX, svg) {
  if (!nav || !pathEl) return;
  const navRect = nav.getBoundingClientRect();
  const styles = window.getComputedStyle(nav);
  const notchSize = parseFloat(styles.getPropertyValue('--ka-nav-notch-size')) || 82;
  const notchRadius = notchSize / 2;
  const notchDepth = Math.min(notchRadius, navRect.height * 0.8);
  const bottomRadius = Math.min(18, navRect.height * 0.4);

  const w = navRect.width;
  const h = navRect.height;
  const safeX = Math.max(notchRadius + 8, Math.min(w - notchRadius - 8, notchCenterX));
  const notchStart = safeX - notchRadius;
  const notchEnd = safeX + notchRadius;

  const cornerR = Math.min(8, notchRadius * 0.25);
  const apexR = Math.min(6, notchRadius * 0.2);
  const leftCurveEndX = (notchStart + cornerR).toFixed(2);
  const leftCurveEndY = cornerR.toFixed(2);
  const apexLeftX = (safeX - apexR).toFixed(2);
  const apexY = (notchDepth - apexR).toFixed(2);
  const apexRightX = (safeX + apexR).toFixed(2);
  const rightCurveStartX = (notchEnd - cornerR).toFixed(2);
  const rightCurveStartY = cornerR.toFixed(2);

  const d = [
    `M 0 0`,
    `H ${notchStart.toFixed(2)}`,
    `Q ${notchStart.toFixed(2)} 0 ${leftCurveEndX} ${leftCurveEndY}`,
    `L ${apexLeftX} ${apexY}`,
    `Q ${safeX.toFixed(2)} ${notchDepth.toFixed(2)} ${apexRightX} ${apexY}`,
    `L ${rightCurveStartX} ${rightCurveStartY}`,
    `Q ${notchEnd.toFixed(2)} 0 ${notchEnd.toFixed(2)} 0`,
    `H ${w.toFixed(2)}`,
    `V ${(h - bottomRadius).toFixed(2)}`,
    `Q ${w.toFixed(2)} ${h.toFixed(2)} ${(w - bottomRadius).toFixed(2)} ${h.toFixed(2)}`,
    `H ${bottomRadius.toFixed(2)}`,
    `Q 0 ${h.toFixed(2)} 0 ${(h - bottomRadius).toFixed(2)}`,
    `V 0`,
    `Z`
  ].join(' ');

  if (svg) {
    svg.setAttribute('viewBox', `0 0 ${w.toFixed(2)} ${h.toFixed(2)}`);
  }
  pathEl.setAttribute('d', d);
}

function kaParseUtcTimestamp(ts) {
  if (!ts) return null;
  const normalized = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
  const dt = new Date(normalized);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function kaFmtTimeShortTZ(input) {
  if (!input) return '';
  const dt = input instanceof Date ? input : kaParseUtcTimestamp(String(input));
  if (!dt || Number.isNaN(dt.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: kaOrgTimezone || KA_DEFAULT_TIMEZONE,
      hour: 'numeric',
      minute: '2-digit'
    }).format(dt);
  } catch (err) {
    console.warn('Falling back to local time for kaFmtTimeShortTZ:', err);
    return dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
}

function kaSessionRowMeta(session, opts = {}) {
  const startTs = session?.first_clock_in_ts || session?.created_at;
  const startLabel = kaFmtTimeShortTZ(startTs);
  const openCount = Number(session?.device_open_count ?? session?.open_count ?? 0);
  const isOngoing =
    typeof opts.isOngoing === 'boolean'
      ? opts.isOngoing
      : !!opts.isActive || openCount > 0;
  let endHtml = '';
  let statusHtml = '';

  if (isOngoing) {
    endHtml = '<span class="ka-session-ongoing">Ongoing</span>';
  } else if (session?.last_clock_out_ts) {
    endHtml = `<span class="ka-session-time">${kaFmtTimeShortTZ(session.last_clock_out_ts)}</span>`;
    statusHtml =
      '<span class="ka-session-complete">' +
      '<svg viewBox="0 0 20 20" aria-hidden="true">' +
      '<circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" stroke-width="1.4"></circle>' +
      '<path d="M6.4 10.4l2.3 2.3 4.9-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>' +
      '</svg>' +
      'Complete' +
      '</span>';
  }

  const rangeHtml =
    '<span class="ka-session-time-range">' +
    `<span class="ka-session-time">${startLabel}</span>` +
    '<span class="ka-session-time-divider">–</span>' +
    `${endHtml}` +
    `${statusHtml}` +
    '</span>';
  return rangeHtml;
}

function kaDurationLabelFromStart(startTs, endTs = new Date()) {
  if (!startTs) return '';
  const start = kaParseUtcTimestamp(String(startTs));
  const end = endTs instanceof Date ? endTs : kaParseUtcTimestamp(String(endTs));
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '';
  const diffMs = Math.max(0, end.getTime() - start.getTime());
  const totalMin = Math.max(0, Math.round(diffMs / 60000));
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours <= 0 && minutes <= 0) return '0m';
  if (hours <= 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function kaTimesheetWorkersSheetElements() {
  const sheet = document.getElementById('ka-timesheet-workers-sheet');
  if (!sheet) return null;
  return {
    sheet,
    panel: sheet.querySelector('.ka-sheet-panel'),
    list: sheet.querySelector('#ka-timesheet-workers-list'),
    status: sheet.querySelector('#ka-timesheet-workers-status'),
    sub: sheet.querySelector('#ka-timesheet-workers-sub'),
    title: sheet.querySelector('#ka-timesheet-workers-title'),
    handle: sheet.querySelector('[data-ka-sheet-handle]')
  };
}

function kaOpenTimesheetWorkersSheet(session) {
  const els = kaTimesheetWorkersSheetElements();
  if (!els) return;
  const projectId = session && session.project_id !== undefined ? Number(session.project_id) : null;
  const projectLabel =
    (session && (session.project_name || kaProjectLabelById(session.project_id))) ||
    (Number.isFinite(projectId) ? `Project ${projectId}` : '');
  const dateLabel = kaFmtDateLong(session?.date || kaTimesheetSelectedDate() || kaTodayIso());
  const subParts = [];
  if (projectLabel) subParts.push(projectLabel);
  if (dateLabel) subParts.push(dateLabel);
  if (els.sub) els.sub.textContent = subParts.join(' - ');
  if (els.list) els.list.innerHTML = '';
  if (els.status) {
    els.status.textContent = 'Loading current workers…';
    els.status.className = 'ka-status';
  }
  els.sheet.dataset.projectId = Number.isFinite(projectId) ? String(projectId) : '';
  els.sheet.dataset.sessionId = session && session.id ? String(session.id) : '';
  els.sheet.classList.remove('hidden');
  requestAnimationFrame(() => {
    els.sheet.classList.add('is-open');
  });
  els.sheet.setAttribute('aria-hidden', 'false');
  document.body.classList.add('ka-modal-open');
  document.documentElement.classList.add('ka-modal-open');
  kaLoadTimesheetWorkers(projectId);
}

function kaCloseTimesheetWorkersSheet() {
  const els = kaTimesheetWorkersSheetElements();
  if (!els) return;
  kaTimesheetWorkersSheetState.dragging = false;
  els.sheet.classList.remove('is-open');
  els.sheet.setAttribute('aria-hidden', 'true');
  if (els.panel) {
    els.panel.style.transform = '';
  }
  els.sheet.classList.remove('dragging');
  document.body.classList.remove('ka-modal-open');
  document.documentElement.classList.remove('ka-modal-open');
  window.setTimeout(() => {
    if (!els.sheet.classList.contains('is-open')) {
      els.sheet.classList.add('hidden');
    }
  }, 260);
}

async function kaLoadTimesheetWorkers(projectId) {
  const els = kaTimesheetWorkersSheetElements();
  if (!els || !els.list || !els.status) return;
  if (!kaKiosk || !kaKiosk.id) {
    els.status.textContent = 'Kiosk not ready.';
    return;
  }

  try {
    const rows = await fetchJSON(`/api/kiosks/${kaKiosk.id}/open-punches`);
    const allRows = Array.isArray(rows) ? rows : [];
    const filtered = Number.isFinite(projectId)
      ? allRows.filter(r => Number(r.project_id) === Number(projectId))
      : allRows;

    if (!filtered.length) {
      els.status.textContent = 'No workers currently clocked in.';
      els.list.innerHTML = '';
      return;
    }

    els.status.textContent = '';
    const now = new Date();
    const fragment = document.createDocumentFragment();
    filtered.forEach((row) => {
      const clockInLabel = kaFmtTimeShortTZ(row.clock_in_ts);
      const durationLabel = kaDurationLabelFromStart(row.clock_in_ts, now);
      const item = document.createElement('div');
      item.className = 'ka-sheet-item';
      item.innerHTML = `
        <div class="ka-sheet-item-name">${row.employee_name || '(Unknown employee)'}</div>
        <div class="ka-sheet-item-clockin">${clockInLabel ? `Clocked in ${clockInLabel}` : 'Clocked in'}</div>
        <div class="ka-sheet-item-duration">${durationLabel || ''}</div>
      `;
      fragment.appendChild(item);
    });
    els.list.replaceChildren(fragment);
  } catch (err) {
    console.error('Error loading timesheet workers:', err);
    els.status.textContent = 'Error loading current workers.';
    els.list.innerHTML = '';
  }
}

function kaSessionRangeForMode() {
  const date = kaTimesheetSelectedDate();
  return { start: date, end: date, useServerToday: false };
}

function kaSortSessionsByRecency(list) {
  return (Array.isArray(list) ? [...list] : []).sort((a, b) => {
    const dateDiff = (b.date || '').localeCompare(a.date || '');
    if (dateDiff !== 0) return dateDiff;
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
}

function kaExplicitActiveSession(sessions) {
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

  return null;
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
  if (kaSessionFilterMode === 'active') return 'Active';
  if (kaSessionFilterMode === 'inactive') return 'Inactive';
  if (kaSessionFilterMode === 'all') return 'All';
  return 'Active';
}

function kaRenderSessions() {
  const list = document.getElementById('ka-session-list');
  const emptyBanner = document.getElementById('ka-session-empty');
  if (!list) return;

  const sessions = Array.isArray(kaSessions) ? kaSessions : [];
  const hasSessions = sessions.length > 0;
  const activeSession = kaComputeActiveSession(sessions);
  kaUpdateTimesheetHeading(activeSession);
  kaSyncTimesheetEmptyState();
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
  let filtered = sessions;
  const query = (kaTimesheetSearchQuery || '').trim().toLowerCase();
  if (query) {
    filtered = filtered.filter(s => {
      const projectLabel =
        s.project_name ||
        kaProjectLabelById(s.project_id) ||
        (s.project_id ? `Project ${s.project_id}` : '');
      const createdBy = s.created_by_name || '';
      const combined = `${projectLabel} ${createdBy}`.toLowerCase();
      return combined.includes(query);
    });
  }
  if (kaSessionFilterMode === 'active') {
    filtered = filtered.filter(s => {
      const isActive = isSessionActive(s);
      if (isActive) return true;
      // If no active session is configured yet, still surface sessions with open punches
      if (!hasExplicitActive) {
        return Number(s.open_count || 0) > 0;
      }
      return false;
    });
  } else if (kaSessionFilterMode === 'inactive') {
    filtered = filtered.filter(s => !isSessionActive(s));
  }

  // Sort by active first, then date desc, then created_at desc
  filtered.sort((a, b) => {
    const activeDiff = Number(isSessionActive(b)) - Number(isSessionActive(a));
    if (activeDiff !== 0) return activeDiff;
    const dateDiff = (b.date || '').localeCompare(a.date || '');
    if (dateDiff !== 0) return dateDiff;
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });

  if (!filtered.length) {
    if (emptyBanner) {
      if (hasSessions) {
        emptyBanner.textContent = query
          ? 'No timesheets match that search.'
          : 'No timesheets yet. Select a project, then create a timesheet to set the active job for this tablet.';
        emptyBanner.classList.remove('hidden');
      } else {
        emptyBanner.classList.add('hidden');
      }
    }
    list.innerHTML = '';
    return;
  }

  if (emptyBanner) emptyBanner.classList.add('hidden');

  list.innerHTML = '';
  filtered.forEach(s => {
    const projName = s.project_name || kaProjectLabelById(s.project_id) || '(Project)';
    const isActive = isSessionActive(s);
    const createdByName = s.created_by_name ? `Created by ${String(s.created_by_name)}` : '';
    const openCount = Number(s.device_open_count ?? s.open_count ?? 0);
    const entryCount = Number(s.device_entry_count ?? s.entry_count ?? 0);
    const isOngoing = isActive || openCount > 0;
    const row = document.createElement('div');
    row.className = `ka-session-row${isActive ? ' is-active' : ''}`;
    row.dataset.sessionId = s.id;
    row.dataset.projectId = Number.isFinite(Number(s.project_id)) ? String(s.project_id) : '';

    const swipe = document.createElement('div');
    swipe.className = 'ka-session-swipe';

    const main = document.createElement('div');
    main.className = 'ka-session-main';

    const columns = document.createElement('div');
    columns.className = 'ka-session-columns';
    columns.innerHTML = `
      <span>Project</span>
      <span>Open punches</span>
      <span>Total entries</span>
    `;
    main.appendChild(columns);

    const head = document.createElement('div');
    head.className = 'ka-session-head';
    head.innerHTML = `
      <div class="ka-session-info">
        <span class="ka-session-active-icon ${isActive ? 'is-active' : ''}"></span>
        <div class="ka-session-info-text">
          <div class="ka-session-label">${projName}</div>
          ${createdByName ? `<div class="ka-session-owner">${createdByName}</div>` : ''}
        </div>
      </div>
      <div class="ka-session-meta-right">
        <div class="ka-session-metric">
          <span class="ka-session-metric-label">Open punches</span>
          <span class="ka-session-metric-value">${openCount}</span>
        </div>
        <div class="ka-session-metric">
          <span class="ka-session-metric-label">Total entries</span>
          <span class="ka-session-metric-value">${entryCount}</span>
        </div>
      </div>
    `;

    const detail = document.createElement('button');
    detail.type = 'button';
    detail.className = 'ka-session-detail-btn';
    detail.dataset.kaSessionDetail = s.id;
    detail.setAttribute('aria-label', 'View current workers');
    detail.innerHTML = `
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M7.5 4.5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    `;
    head.appendChild(detail);
    main.appendChild(head);
    const meta = document.createElement('div');
    meta.className = 'ka-session-meta';
    meta.innerHTML = kaSessionRowMeta(s, { isActive, isOngoing });
    main.appendChild(meta);

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
  kaRenderLiveTimesheetFilter();
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

async function kaAddSession(opts = {}) {
  if (!kaKiosk || !kaKiosk.id) return;
  const sel = document.getElementById('ka-project-select');
  const status = document.getElementById('ka-session-status');
  const inlineProjectId = sel && sel.value ? Number(sel.value) : null;
  const adminId = kaCurrentAdmin && kaCurrentAdmin.id ? Number(kaCurrentAdmin.id) : null;
  const adminName = (kaCurrentAdmin && (kaCurrentAdmin.nickname || kaCurrentAdmin.name)) || 'you';
  const dateLabel = kaFmtDateLong(kaTimesheetSelectedDate()) || kaFmtDateLongTZ(new Date());

  let adminOpen = false;
  let currentProjId = null;
  let currentLabel = '';
  if (adminId) {
    await kaRefreshAdminPunchStatus();
    adminOpen = !!(kaAdminOpenPunch && kaAdminOpenPunch.open);
    currentProjId = adminOpen ? kaAdminOpenPunch.project_id : null;
    if (adminOpen) {
      currentLabel =
        kaProjectLabelById(currentProjId) ||
        (kaAdminOpenPunch.project_name || `Project ${currentProjId}`);
    }
  }

  const buildPrompt = (targetProjectId) => {
    if (!targetProjectId) {
      return {
        message: 'Select a project to start a timesheet.',
        yesLabel: 'Start timesheet',
        skipLabel: 'Cancel',
        treatSkipAsCancel: true,
        projectLabel: ''
      };
    }
    const projectLabel = kaProjectLabelById(targetProjectId) || `Project ${targetProjectId}`;
    let message = '';
    let yesLabel = 'Start timesheet';
    let skipLabel = 'Cancel';
    let treatSkipAsCancel = true;
    if (adminOpen && Number(currentProjId) !== Number(targetProjectId)) {
      message = `${adminName} is clocked in on ${currentLabel}. Start a timesheet for ${projectLabel} (${dateLabel})? Switch your clock-in to this project?`;
      yesLabel = 'Start & switch';
      skipLabel = 'Start only';
      treatSkipAsCancel = false;
    } else if (!adminOpen && !kaClockInPhotoRequired && adminId) {
      message = `Start a timesheet for ${projectLabel} (${dateLabel}). Clock in ${adminName} as well?`;
      yesLabel = 'Start & clock in';
      skipLabel = 'Start only';
      treatSkipAsCancel = false;
    } else {
      message = `Start a timesheet for ${projectLabel} (${dateLabel})?`;
      if (!adminOpen && kaClockInPhotoRequired && adminId) {
        message += ' Photo is required to clock in.';
      }
      yesLabel = 'Start timesheet';
      skipLabel = 'Cancel';
      treatSkipAsCancel = true;
    }
    return { message, yesLabel, skipLabel, treatSkipAsCancel, projectLabel };
  };

    const defaultProjectId = opts.useModal ? null : inlineProjectId;
    let projectId =
      opts.projectId !== undefined && opts.projectId !== null
        ? opts.projectId
        : defaultProjectId;
    let modalResult = { action: 'skip', projectId };
    let treatSkipAsCancel = false;
    let usedModal = false;
    let projectLabel = '';

    if (opts.useModal) {
      const projectOptions = kaActiveProjectOptions();
      if (!projectOptions.length) {
      if (status) {
        status.textContent = 'No active projects available.';
        status.className = 'ka-status ka-status-error';
      }
      kaShowStatusMessage('No active projects available.', 'error', 6000);
      return;
    }
    const prompt = buildPrompt(projectId);
    modalResult = await kaShowClockInModal({
      projectId,
      adminName,
      titleText: 'Start timesheet?',
      message: prompt.message,
      yesLabel: prompt.yesLabel,
      skipLabel: prompt.skipLabel,
      projectOptions,
      projectLabelText: 'Project',
      allowBlankProject: true,
      onProjectChange: (nextProjectId) => {
        const nextPrompt = buildPrompt(nextProjectId);
        return {
          message: nextPrompt.message,
          yesLabel: nextPrompt.yesLabel,
          skipLabel: nextPrompt.skipLabel
        };
      }
    });
    usedModal = true;
    projectId = modalResult.projectId || projectId;
    const finalPrompt = buildPrompt(projectId);
    treatSkipAsCancel = finalPrompt.treatSkipAsCancel;
    projectLabel = finalPrompt.projectLabel;

    if (modalResult.action === 'dismiss' || (modalResult.action === 'skip' && treatSkipAsCancel)) {
      if (status) {
        status.textContent = 'Timesheet not started.';
        status.className = 'ka-status ka-status-error';
      }
      return;
    }

    if (!projectId) {
      if (status) {
        status.textContent = 'Pick a project to start a timesheet.';
        status.className = 'ka-status ka-status-error';
      }
      return;
    }
  } else {
    if (!projectId) {
      if (status) {
        status.textContent = 'Pick a project to start a timesheet.';
        status.className = 'ka-status ka-status-error';
      }
      return;
    }

    projectLabel = kaProjectLabelById(projectId) || `Project ${projectId}`;

    if (adminId) {
      const prompt = buildPrompt(projectId);
      treatSkipAsCancel = prompt.treatSkipAsCancel;
      modalResult = await kaShowClockInModal({
        projectId,
        adminName,
        titleText: 'Start timesheet?',
        message: prompt.message,
        yesLabel: prompt.yesLabel,
        skipLabel: prompt.skipLabel
      });

      if (modalResult.action === 'dismiss' || (modalResult.action === 'skip' && treatSkipAsCancel)) {
        if (status) {
          status.textContent = 'Timesheet not started.';
          status.className = 'ka-status ka-status-error';
        }
        return;
      }
    }
  }

  if (status) {
    status.textContent = 'Starting timesheet…';
    status.className = 'ka-status';
  }

  try {
    const pos = await kaGetPosition();
    const wantsSwitch =
      adminOpen &&
      Number(currentProjId) !== Number(projectId) &&
      modalResult.action === 'yes';
    const wantsClockIn =
      !adminOpen &&
      modalResult.action === 'yes' &&
      !kaClockInPhotoRequired &&
      !!adminId;
    const resp = await kaCreateSessionWithGeo({
      projectId,
      makeActive: true,
      adminId,
      lat: pos?.lat ?? null,
      lng: pos?.lng ?? null,
      clockMeIn: wantsClockIn,
      clockInPayload: wantsClockIn
        ? {
            client_id: 'start_' + Date.now().toString(36),
            lat: pos?.lat ?? null,
            lng: pos?.lng ?? null,
            device_timestamp: new Date().toISOString(),
            photo_base64: null
          }
        : null
    });
    if (!resp) {
      if (status) {
        status.textContent = 'Timesheet not started.';
        status.className = 'ka-status ka-status-error';
      }
      return;
    }

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

    if (adminId) {
      if (wantsClockIn) {
        if (resp && resp.clocked_in) {
          kaShowStatusMessage(
            'Timesheet set and you are clocked in on this project. You should now appear under Current Workers.',
            'ok',
            10000
          );
        } else {
          kaShowStatusMessage(
            'Timesheet set, but clock-in for admin failed. Please try clocking in manually.',
            'error',
            8000
          );
          if (!usedModal) {
            kaShowClockInPrompt({
              projectId,
              adminId,
              adminName,
              message: `${adminName} is not clocked in. Clock in to a timesheet for today?`
            });
          }
        }
      } else if (wantsSwitch) {
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
      } else if (!adminOpen) {
        if (kaClockInPhotoRequired) {
          kaShowStatusMessage(
            'Photo is required to clock in. Please clock in from the worker screen.',
            'error',
            8000
          );
        }
        if (!usedModal) {
          kaShowClockInPrompt({
            projectId,
            adminId,
            adminName,
            message: `${adminName} is not clocked in. Clock in to a timesheet for today?`
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
        if (kaClockInPhotoRequired) {
          kaShowStatusMessage(
            'Photo is required to clock in. Please clock in from the worker screen.',
            'error',
            8000
          );
          cleanup();
          return;
        }
        const pos = await kaGetPosition();
        await fetchJSON('/api/kiosk/punch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: 'startday-' + Date.now().toString(36),
            employee_id: adminId,
            project_id: targetProjectId,
            lat: pos?.lat ?? null,
            lng: pos?.lng ?? null,
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

function kaShowClockInModal({
  projectId,
  adminName,
  message,
  projectOptions,
  titleText,
  yesLabel,
  skipLabel,
  projectLabelText,
  onProjectChange,
  allowBlankProject
}) {
  const backdrop = document.getElementById('ka-clockin-modal-backdrop');
  const text = document.getElementById('ka-clockin-modal-text');
  const title = document.getElementById('ka-clockin-modal-title');
  const closeBtn = document.getElementById('ka-clockin-modal-close');
  const yesBtn = document.getElementById('ka-clockin-modal-yes');
  const skipBtn = document.getElementById('ka-clockin-modal-skip');
  const projWrap = document.getElementById('ka-clockin-modal-project-wrap');
  const projSel = document.getElementById('ka-clockin-modal-project');
  const projLabel = document.getElementById('ka-clockin-modal-project-label');
  if (!backdrop || !text || !title || !closeBtn || !yesBtn || !skipBtn) {
    return Promise.resolve({ action: 'dismiss', projectId });
  }

  const projectLabel = projectId ? (kaProjectLabelById(projectId) || 'this project') : 'this project';
  const dateLabel = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  title.textContent = titleText || 'Clock in?';
  text.textContent =
    message || `Timesheet created for ${projectLabel} (${dateLabel}). Clock in ${adminName} as well?`;
  yesBtn.textContent = yesLabel || 'Clock in';
  skipBtn.textContent = skipLabel || 'Skip';

  if (projSel && projWrap) {
    projSel.innerHTML = '';
    if (projectOptions && projectOptions.length > 0) {
      if (allowBlankProject) {
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select a project';
        placeholder.disabled = true;
        placeholder.selected = !projectId;
        projSel.appendChild(placeholder);
      }
      projectOptions.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.project_id;
        opt.textContent = p.label;
        projSel.appendChild(opt);
      });
      if (projectId) {
        projSel.value = String(projectId);
      } else if (allowBlankProject) {
        projSel.value = '';
      }
      if (projLabel) {
        if (!projLabel.dataset.defaultLabel) {
          projLabel.dataset.defaultLabel = projLabel.textContent || '';
        }
        projLabel.textContent = projectLabelText || projLabel.dataset.defaultLabel;
      }
      projWrap.style.display = 'block';
    } else {
      projWrap.style.display = 'none';
    }
  }

  backdrop.classList.remove('hidden');

  return new Promise(resolve => {
    const currentProjectId = () => {
      if (projSel && projWrap && projWrap.style.display !== 'none') {
        return projSel.value ? Number(projSel.value) : null;
      }
      return projectId || null;
    };

    const applyUpdates = (selectedId) => {
      if (allowBlankProject) {
        const hasSelection = !!selectedId;
        yesBtn.disabled = !hasSelection;
      }
      if (typeof onProjectChange !== 'function') return;
      const updates = onProjectChange(selectedId);
      if (!updates || typeof updates !== 'object') return;
      if (updates.titleText !== undefined) title.textContent = updates.titleText || '';
      if (updates.message !== undefined) text.textContent = updates.message || '';
      if (updates.yesLabel !== undefined) yesBtn.textContent = updates.yesLabel || '';
      if (updates.skipLabel !== undefined) skipBtn.textContent = updates.skipLabel || '';
    };

    if (projSel && projWrap && projWrap.style.display !== 'none') {
      projSel.onchange = () => applyUpdates(currentProjectId());
      applyUpdates(currentProjectId());
    } else {
      applyUpdates(currentProjectId());
    }

    const cleanup = (result) => {
      backdrop.classList.add('hidden');
      yesBtn.onclick = null;
      skipBtn.onclick = null;
      closeBtn.onclick = null;
      backdrop.onclick = null;
      if (projSel) {
        projSel.onchange = null;
      }
      resolve(result);
    };

    yesBtn.onclick = () => {
      cleanup({ action: 'yes', projectId: currentProjectId() });
    };
    skipBtn.onclick = () => cleanup({ action: 'skip', projectId: currentProjectId() });
    closeBtn.onclick = () => cleanup({ action: 'dismiss', projectId: currentProjectId() });
    backdrop.onclick = (e) => {
      if (e.target === backdrop) cleanup({ action: 'dismiss', projectId: currentProjectId() });
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

  const pos = await kaGetPosition();

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
        intended_mode: 'clock_out',
        lat: pos?.lat ?? null,
        lng: pos?.lng ?? null,
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
  if (kaClockInPhotoRequired) {
    throw new Error('Photo is required to clock in. Please clock in from the worker screen.');
  }
  await fetchJSON('/api/kiosk/punch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: 'switch-in-' + Date.now().toString(36),
      employee_id: adminId,
      project_id: targetProjectId,
      intended_mode: 'clock_in',
      lat: pos?.lat ?? null,
      lng: pos?.lng ?? null,
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

async function kaDeleteSession(sessionId, row = null) {
  if (!kaKiosk || !kaKiosk.id || !sessionId || !kaCurrentAdmin) return;
  const status = document.getElementById('ka-session-status');
  const session = kaSessions.find(s => Number(s.id) === Number(sessionId));
  const { openCount, entryCount } = kaSessionCounts(session);
  let pin = '';

  if (openCount > 0) {
    kaNotifySessionDeleteBlocked('Cannot delete this timesheet while workers are clocked in. Clock them out first.', row);
    return;
  }

  if (entryCount > 0) {
    kaNotifySessionDeleteBlocked('Cannot delete a timesheet with time entries.', row);
    return;
  }

  const confirmed = await kaShowConfirmDialog(
    'Are you sure you want to delete this timesheet?',
    { okLabel: 'Delete', cancelLabel: 'Cancel', title: 'Delete timesheet' }
  );
  if (!confirmed) return;

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
    const message = err && err.message ? err.message : 'Error deleting timesheet.';
    if (status) {
      status.textContent = message;
      status.className = 'ka-status ka-status-error';
    }
    kaNotifySessionDeleteBlocked(message, row);
  }
}

function kaHandleSessionTouchStart(e) {
  const row = e.target.closest('.ka-session-row');
  if (!row || !e.touches || !e.touches.length) return;
  row.dataset.touchStartX = String(e.touches[0].clientX);
  const target = e.target.closest('[data-ka-delete-session]') ? 'delete'
    : e.target.closest('[data-ka-session-detail]') ? 'detail'
    : 'row';
  row.dataset.touchStartTarget = target;
}

function kaHandleSessionTouchEnd(e) {
  const row = e.target.closest('.ka-session-row');
  if (!row) return;
  const startX = Number(row.dataset.touchStartX || 0);
  const endX = e.changedTouches && e.changedTouches.length ? e.changedTouches[0].clientX : startX;
  const delta = endX - startX;
  const startTarget = row.dataset.touchStartTarget || 'row';
  if (delta < -40) {
    kaShowSessionDelete(row);
  } else if (delta > 40) {
    kaHideSessionDelete(row);
  } else if (Math.abs(delta) < 10) {
    // For taps: only auto-hide if the tap wasn't on the delete/workers buttons
    if (startTarget === 'row') {
      kaHideSessionDelete(row);
    }
  }
}

// --- INIT ---

async function kaInit() {
  const params = new URLSearchParams(window.location.search);
  kaDeviceId = params.get('device_id');
  kaStartMode = params.get('start') === '1';
  kaStartEmployeeId = params.get('employee_id');
  kaOrgTimezone = kaLoadOrgTimezone();

  kaHardenPinInputs();
  if (window.AVIAN_STORE && typeof window.AVIAN_STORE.init === 'function') {
    await window.AVIAN_STORE.init([
      KA_OFFLINE_QUEUE_KEY,
      KA_PENDING_PIN_KEY,
      KA_VERIFY_QUEUE_KEY,
      KA_SHIPMENT_NOTES_QUEUE_KEY
    ]);
  }
  await kaMigratePendingPins();
  kaUpdateOfflineIndicator();

  if (!kaDeviceId) {
    alert('Missing kiosk device ID in URL (device_id).');
    kaSetText('ka-sidebar-admin-name', kaAdminDisplayName());
    return;
  }

  if (!kaStartEmployeeId) {
    alert('Open kiosk admin from the kiosk login screen so your admin PIN is verified.');
    window.location.href = '/kiosk';
    return;
  }

  await kaRefreshOrgTimezone();

  if (!kaTimesheetDate) {
    kaTimesheetDate = kaTodayIso();
  }

  kaUpdateTimesheetHeading();
  kaUpdateSessionFilterDate();
  kaUpdateTimesheetSectionLabel();

  // Header menu (settings)
  const menuToggle = document.getElementById('ka-header-menu-toggle');
  const menuPanel = document.getElementById('ka-header-menu-panel');
  const menuBackdrop = document.getElementById('ka-sidebar-backdrop');
  if (menuToggle && menuPanel) {
    const closeMenu = () => {
      menuPanel.classList.remove('is-open');
      menuToggle.setAttribute('aria-expanded', 'false');
      menuPanel.setAttribute('aria-hidden', 'true');
      if (menuBackdrop) menuBackdrop.classList.add('hidden');
      document.body.classList.remove('ka-modal-open');
      document.documentElement.classList.remove('ka-modal-open');
      window.setTimeout(() => {
        if (!menuPanel.classList.contains('is-open')) {
          menuPanel.classList.add('hidden');
        }
      }, 200);
    };
    const openMenu = () => {
      menuPanel.classList.remove('hidden');
      if (menuBackdrop) menuBackdrop.classList.remove('hidden');
      menuToggle.setAttribute('aria-expanded', 'true');
      menuPanel.setAttribute('aria-hidden', 'false');
      document.body.classList.add('ka-modal-open');
      document.documentElement.classList.add('ka-modal-open');
      requestAnimationFrame(() => {
        menuPanel.classList.add('is-open');
      });
    };
    menuToggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isOpen = menuPanel.classList.contains('is-open');
      if (isOpen) {
        closeMenu();
      } else {
        openMenu();
      }
    });
    menuPanel.addEventListener('click', (e) => {
      const item = e.target.closest('[data-ka-menu], [data-ka-view], [data-ka-action]');
      if (!item) return;
      const action = item.dataset.kaMenu;
      const view = item.dataset.kaView;
      const navAction = item.dataset.kaAction;
      if (navAction === 'clockin') {
        window.location.href = '/kiosk';
        return;
      }
      if (navAction === 'logout') {
        closeMenu();
        kaLogoutToKiosk();
        return;
      }
      if (navAction === 'help') {
        closeMenu();
        const helpBackdrop = document.getElementById('ka-help-backdrop');
        if (helpBackdrop) {
          helpBackdrop.classList.remove('hidden');
          document.body.classList.add('ka-modal-open');
          document.documentElement.classList.add('ka-modal-open');
        }
        return;
      }
      if (view && KA_VIEWS.includes(view)) {
        kaShowView(view);
      } else if (action === 'account') {
        kaShowView('account');
      } else if (action === 'settings') {
        kaShowView('settings');
      }
      closeMenu();
    });
    if (menuBackdrop) {
      menuBackdrop.addEventListener('click', closeMenu);
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
    });
  }

  const helpButtons = Array.from(
    document.querySelectorAll('[data-ka-help="timesheets"]')
  );
  if (!helpButtons.length) {
    const fallbackHelp = document.getElementById('ka-timesheet-help');
    if (fallbackHelp) helpButtons.push(fallbackHelp);
  }
  const helpBackdrop = document.getElementById('ka-help-backdrop');
  const helpClose = document.getElementById('ka-help-close');
  if (helpButtons.length && helpBackdrop) {
    const closeHelp = () => {
      helpBackdrop.classList.add('hidden');
      document.body.classList.remove('ka-modal-open');
      document.documentElement.classList.remove('ka-modal-open');
    };
    const openHelp = () => {
      helpBackdrop.classList.remove('hidden');
      document.body.classList.add('ka-modal-open');
      document.documentElement.classList.add('ka-modal-open');
    };
    helpButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openHelp();
      });
    });
    helpClose?.addEventListener('click', (e) => {
      e.preventDefault();
      closeHelp();
    });
    helpBackdrop.addEventListener('click', (e) => {
      if (e.target === helpBackdrop) closeHelp();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeHelp();
    });
  }

  let closeFilterPanel = null;
  const filterToggle = document.getElementById('ka-session-filter-toggle');
  const filterPanel = document.getElementById('ka-session-filter-panel');
  if (filterToggle && filterPanel) {
    const closeFilter = () => {
      filterPanel.classList.add('hidden');
      filterToggle.setAttribute('aria-expanded', 'false');
    };
    closeFilterPanel = closeFilter;
    filterToggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const willOpen = filterPanel.classList.contains('hidden');
      if (willOpen) {
        filterPanel.classList.remove('hidden');
        filterToggle.setAttribute('aria-expanded', 'true');
      } else {
        closeFilter();
      }
    });
    document.addEventListener('click', (e) => {
      if (filterPanel.classList.contains('hidden')) return;
      if (filterPanel.contains(e.target) || filterToggle.contains(e.target)) return;
      closeFilter();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeFilter();
    });
  }

  const dateNavButtons = document.querySelectorAll('[data-ka-date-nav]');
  dateNavButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const direction = btn.dataset.kaDateNav || 'next';
      const delta = direction === 'prev' ? -1 : 1;
      const baseDate = kaTimesheetSelectedDate();
      const nextDate = kaIsoOffsetDays(baseDate, delta);
      kaSetTimesheetDate(nextDate);
    });
  });

  const datePill = document.getElementById('ka-timesheet-date-pill');
  const dateInput = document.getElementById('ka-timesheet-date-input');
  if (dateInput) {
    kaSyncTimesheetDateInput();
    dateInput.addEventListener('change', () => {
      const next = dateInput.value;
      if (next) {
        kaSetTimesheetDate(next);
      }
    });
  }
  if (datePill && dateInput) {
    const openPicker = () => {
      if (typeof dateInput.showPicker === 'function') {
        dateInput.showPicker();
      } else {
        dateInput.focus();
        dateInput.click();
      }
    };
    datePill.addEventListener('click', (e) => {
      if (e.target && (e.target === dateInput)) return;
      openPicker();
    });
    datePill.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openPicker();
      }
    });
  }

  const searchInput = document.getElementById('ka-timesheet-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      kaTimesheetSearchQuery = searchInput.value || '';
      kaRenderSessions();
    });
    searchInput.addEventListener('search', () => {
      kaTimesheetSearchQuery = searchInput.value || '';
      kaRenderSessions();
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
  document
    .getElementById('ka-helper-submit')
    ?.addEventListener('click', kaHandleHelperAdd);
  window.addEventListener('online', () => {
    kaSyncOfflineData('online');
    kaStartOfflineSyncLoop();
    kaUpdateOfflineIndicator();
  });
  window.addEventListener('offline', () => {
    kaUpdateOfflineIndicator();
  });
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
      const nameLink = e.target.closest('.ka-doc-name');
      if (nameLink && nameLink.href) {
        e.preventDefault();
        e.stopPropagation();
        let type = '';
        const row = nameLink.closest('.ka-doc-row');
        const typeEl = row ? row.querySelector('.ka-doc-type') : null;
        if (typeEl) type = (typeEl.textContent || '').trim();
        if (type.toLowerCase().startsWith('type:')) {
          type = type.replace(/^type:\s*/i, '');
        }
        kaOpenDocViewer({
          url: nameLink.href,
          name: (nameLink.textContent || '').trim(),
          type
        });
        return;
      }
      const dl = e.target.closest('.ka-doc-download');
      if (dl && dl.href) {
        e.preventDefault();
        e.stopPropagation();
        if (!navigator.onLine) {
          kaShowModalToast('Offline: connect to download.', 'error');
          return;
        }
        window.open(dl.href, '_blank');
      }
    });
    docsBody.dataset.bound = '1';
  }

  kaBindDocViewerModal();

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
    ?.addEventListener('click', () => kaLoadShipments({ forceFresh: true }));

      // 🔹 Shipments filter: change mode (ready vs all)
  document
    .getElementById('ka-shipments-filter')
    ?.addEventListener('change', () => kaLoadShipments({ forceFresh: true }));
  document
    .getElementById('ka-shipments-project')
    ?.addEventListener('change', () => kaLoadShipments({ forceFresh: true }));


  // 🔹 Bottom nav click handler
  const bottomNav = document.querySelector('.ka-bottom-nav');
  if (bottomNav) {
    bottomNav.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-ka-view], button[data-ka-action]');
      if (!btn) return;
      const action = btn.dataset.kaAction;
      if (action === 'clockin') {
        window.location.href = '/kiosk';
        return;
      }
      const view = btn.getAttribute('data-ka-view');
      if (!view || !KA_VIEWS.includes(view)) return;
      kaShowView(view);
    });
  }

  const sheetEls = kaTimesheetWorkersSheetElements();
  if (sheetEls && !sheetEls.sheet.dataset.bound) {
    sheetEls.sheet.dataset.bound = '1';
    sheetEls.sheet.querySelectorAll('[data-ka-sheet-close]').forEach((btn) => {
      btn.addEventListener('click', () => kaCloseTimesheetWorkersSheet());
    });

    const handle = sheetEls.handle;
    if (handle) {
      const onPointerDown = (e) => {
        if (!sheetEls.sheet.classList.contains('is-open')) return;
        if (e.button !== undefined && e.button !== 0) return;
        kaTimesheetWorkersSheetState.dragging = true;
        kaTimesheetWorkersSheetState.startY = e.clientY;
        kaTimesheetWorkersSheetState.currentY = e.clientY;
        sheetEls.sheet.classList.add('dragging');
        handle.setPointerCapture(e.pointerId);
      };
      const onPointerMove = (e) => {
        if (!kaTimesheetWorkersSheetState.dragging) return;
        const delta = Math.max(0, e.clientY - kaTimesheetWorkersSheetState.startY);
        kaTimesheetWorkersSheetState.currentY = e.clientY;
        if (sheetEls.panel) {
          sheetEls.panel.style.transform = `translateY(${delta}px)`;
        }
      };
      const onPointerUp = () => {
        if (!kaTimesheetWorkersSheetState.dragging) return;
        kaTimesheetWorkersSheetState.dragging = false;
        sheetEls.sheet.classList.remove('dragging');
        const delta = Math.max(0, kaTimesheetWorkersSheetState.currentY - kaTimesheetWorkersSheetState.startY);
        const threshold = sheetEls.panel
          ? Math.min(180, sheetEls.panel.offsetHeight * 0.3)
          : 120;
        if (delta > threshold) {
          kaCloseTimesheetWorkersSheet();
        } else if (sheetEls.panel) {
          sheetEls.panel.style.transform = '';
        }
      };
      handle.addEventListener('pointerdown', onPointerDown);
      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', onPointerUp);
      handle.addEventListener('pointercancel', onPointerUp);
    }
  }

  // Timesheets: add + set active
  document.getElementById('ka-add-session-btn')?.addEventListener('click', () => kaAddSession({ useModal: true }));
  const startNewBtn = document.getElementById('ka-start-new-btn');
  if (startNewBtn) {
    startNewBtn.addEventListener('click', () => {
      kaAddSession({ useModal: true });
    });
  }
  const emptyStartBtn = document.getElementById('ka-timesheet-empty-start');
  if (emptyStartBtn) {
    emptyStartBtn.addEventListener('click', () => {
      kaAddSession({ useModal: true });
    });
  }
  const allowedModes = new Set(['active', 'all', 'inactive']);
  const sessionFilterOptions = Array.from(
    document.querySelectorAll('[data-ka-session-filter]')
  );
  const syncSessionFilterOptions = () => {
    sessionFilterOptions.forEach((btn) => {
      const value = btn.dataset.kaSessionFilter || 'active';
      const isActive = value === kaSessionFilterMode;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  };
  if (!allowedModes.has(kaSessionFilterMode)) kaSessionFilterMode = 'active';
  syncSessionFilterOptions();
  sessionFilterOptions.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const next = btn.dataset.kaSessionFilter || 'active';
      kaSessionFilterMode = allowedModes.has(next) ? next : 'active';
      syncSessionFilterOptions();
      kaRenderSessions();
      if (closeFilterPanel) closeFilterPanel();
    });
  });

  const sessionList = document.getElementById('ka-session-list');
  if (sessionList) {
    sessionList.addEventListener('click', async (e) => {
      const deleteBtn = e.target.closest('[data-ka-delete-session]');
      if (deleteBtn) {
        e.stopPropagation();
        e.preventDefault();
        const id = Number(deleteBtn.dataset.kaDeleteSession);
        if (id) {
          const row = deleteBtn.closest('.ka-session-row');
          kaDeleteSession(id, row);
        }
        return;
      }
      const detailBtn = e.target.closest('[data-ka-session-detail]');
      if (detailBtn) {
        e.stopPropagation();
        e.preventDefault();
        const sessionId = Number(detailBtn.dataset.kaSessionDetail);
        const session = (kaSessions || []).find(s => Number(s.id) === sessionId);
        const projectId =
          session && session.project_id !== undefined && session.project_id !== null
            ? Number(session.project_id)
            : null;
        kaShowView('workers', { projectOverride: projectId, preserveLiveProject: true });
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
      fetchJSON('/api/kiosk/projects'),
      fetchJSON('/api/kiosk/employees'),
    ]);

    // Only keep active projects for kiosk use
    kaProjects = (projects || []).filter(
      p => p.active === undefined || p.active === null || Number(p.active) === 1
    );
    kaEmployees = (employees || []).map(e => ({
      ...e,
      is_admin: !!e.kiosk_admin_access,
      uses_timekeeping: e.worker_timekeeping !== undefined ? Number(e.worker_timekeeping) : 1
    }));

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
      kaSetText('ka-sidebar-admin-name', kaAdminDisplayName());
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
    await kaInitAdminConsoleSwitch();
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
      await kaLoadShipments({ forceFresh: true });
    }

    // Try to sync any offline queues now that we are loaded
    await kaSyncOfflineData('init');
    if (kaHasOfflineDataToSync()) {
      kaStartOfflineSyncLoop();
    }

    // Default view → Timesheets
    kaShowView('timesheets');
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
    const choice = await kaShowChoiceDialog(
      'You have unsent item changes. Save all updates before closing?',
      {
        okLabel: 'Save & close',
        altLabel: 'Discard changes',
        cancelLabel: 'Keep working',
        title: 'Unsaved item updates'
      }
    );
    if (choice === 'cancel') return;
    if (choice === 'ok' && shipmentId) {
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
  kaShipmentDetailDocs = [];
  kaExpandedItems.clear();
  kaSavedItemStatuses.clear();
  kaRecentlySavedItems.forEach(timer => clearTimeout(timer));
  kaRecentlySavedItems.clear();
  if (kaCanViewShipments()) {
    kaLoadShipments({ forceFresh: true });
  }
}

function kaClearItemAutoSaves() {
  kaItemAutoSaveTimers.forEach(timer => clearTimeout(timer));
  kaItemAutoSaveTimers.clear();
}

function kaForceCloseAllModals() {
  const ids = [
    'ka-return-backdrop',
    'ka-time-action-backdrop',
    'ka-confirm-backdrop',
    'ka-docs-backdrop',
    'ka-doc-view-backdrop'
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  kaCloseItemsModal({ force: true });
  kaCloseDocViewer();
}

function kaSetItemsTab(tab) {
  kaItemsActiveTab = tab || 'items';
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
function kaCountVerifiedFromItems(items = []) {
  const total = Array.isArray(items) ? items.length : 0;
  let verified = 0;
  (items || []).forEach(it => {
    const current = kaCurrentItemState(it);
    const st = (current?.verification?.status || '').toLowerCase().trim();
    if (st && st !== 'unverified') {
      verified += 1;
    }
  });
  const allVerified = total > 0 && verified === total;
  return { total, verified, allVerified };
}

function kaRefreshShipmentProgress(shipmentId) {
  if (!shipmentId || !kaShipmentDetail || !kaShipmentDetail.items) return;
  const counts = kaCountVerifiedFromItems(kaShipmentDetail.items);

  // Update detail cache
  kaShipmentDetail.shipment = kaShipmentDetail.shipment || {};
  kaShipmentDetail.shipment.items_total = counts.total;
  kaShipmentDetail.shipment.items_verified_count = counts.verified;
  kaShipmentDetail.shipment.items_verified = counts.allVerified ? 1 : 0;

  // Update overview in modal
  const overviewEl = document.getElementById('ka-items-overview');
  if (overviewEl) {
    overviewEl.innerHTML = kaRenderShipmentOverview(
      kaShipmentDetail.shipment,
      kaShipmentDetailDocs || [],
      kaShipmentDetail.items || []
    );
    kaBindOverviewUpload();
    kaBindOverviewPaymentDocs();
    kaBindPickupControls(kaShipmentDetail.shipment || {});
  }

  // Update list cache + re-render shipments list
  const match = Array.isArray(kaShipments)
    ? kaShipments.find(s => Number(s.id) === Number(shipmentId))
    : null;
  if (match) {
    match.items_total = counts.total;
    match.items_verified_count = counts.verified;
    match.items_verified = counts.allVerified ? 1 : 0;
    kaRenderShipmentsList(kaShipments);
  }
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

function kaNormalizeItemStatus(status) {
  return (status || '').toLowerCase().trim();
}

function kaSetSavedItemStatus(itemId, status) {
  const normalized = kaNormalizeItemStatus(status);
  const idNum = Number(itemId);
  kaSavedItemStatuses.set(idNum, normalized);
}

function kaMarkItemRecentlySaved(itemId) {
  const idNum = Number(itemId);
  if (!Number.isFinite(idNum)) return;
  const existing = kaRecentlySavedItems.get(idNum);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    kaRecentlySavedItems.delete(idNum);
    const row = document.querySelector(`.ka-item-row[data-item-id="${idNum}"]`);
    const statusEl = row && row.querySelector('[data-ka-item-save-status]');
    if (statusEl) {
      statusEl.textContent = '';
      statusEl.classList.remove('is-ok');
    }
  }, KA_ITEM_SAVE_FLASH_MS);
  kaRecentlySavedItems.set(idNum, timer);
}

function kaClearItemSavedStatus(itemId) {
  const idNum = Number(itemId);
  const timer = kaRecentlySavedItems.get(idNum);
  if (timer) clearTimeout(timer);
  kaRecentlySavedItems.delete(idNum);
}

function kaGetSavedItemStatus(itemId, fallback = '') {
  const idNum = Number(itemId);
  if (kaSavedItemStatuses.has(idNum)) {
    return kaSavedItemStatuses.get(idNum);
  }
  return kaNormalizeItemStatus(fallback);
}

function kaSeedSavedItemStatuses(items = []) {
  kaSavedItemStatuses.clear();
  kaExpandedItems.clear();
  (items || []).forEach(it => {
    kaSetSavedItemStatus(it.id, it?.verification?.status || '');
  });
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

function kaDocCacheAvailable() {
  return typeof caches !== 'undefined' && typeof caches.open === 'function';
}

function kaDocNormalizeUrl(url) {
  if (!url) return '';
  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return url;
  }
}

async function kaGetDocCache() {
  if (!kaDocCacheAvailable()) return null;
  try {
    return await caches.open(KA_DOC_CACHE_NAME);
  } catch {
    return null;
  }
}

async function kaGetCachedDoc(url) {
  const cache = await kaGetDocCache();
  if (!cache) return null;
  const match = await cache.match(url);
  if (!match) return null;
  const blob = await match.blob();
  return {
    blob,
    contentType: match.headers.get('content-type') || blob.type || ''
  };
}

async function kaFetchDocBlob(url) {
  if (!navigator.onLine) {
    return { blob: null, contentType: '', offline: true };
  }
  const resp = await fetch(url, { credentials: 'same-origin' });
  if (!resp.ok) {
    const err = new Error(`Failed to load document (${resp.status})`);
    err.status = resp.status;
    throw err;
  }
  const cache = await kaGetDocCache();
  if (cache) {
    try {
      await cache.put(url, resp.clone());
    } catch {
      // ignore cache failures
    }
  }
  const blob = await resp.blob();
  return {
    blob,
    contentType: resp.headers.get('content-type') || blob.type || ''
  };
}

function kaDocViewKind(contentType, name = '', blobType = '') {
  const type = (contentType || blobType || '').toLowerCase();
  const lowerName = (name || '').toLowerCase();
  if (type.includes('pdf') || lowerName.endsWith('.pdf')) return 'pdf';
  if (type.startsWith('image/')) return 'image';
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(lowerName)) return 'image';
  return 'other';
}

function kaDocViewCleanup() {
  if (kaDocViewObjectUrl) {
    URL.revokeObjectURL(kaDocViewObjectUrl);
    kaDocViewObjectUrl = null;
  }
}

function kaUpdateDocViewerDownloadState() {
  const btn = document.getElementById('ka-doc-view-download');
  if (!btn) return;
  const online = navigator.onLine;
  btn.disabled = !online || !kaDocViewCurrentUrl;
  btn.title = !online ? 'Connect to the internet to download.' : '';
}

function kaCloseDocViewer() {
  const backdrop = document.getElementById('ka-doc-view-backdrop');
  if (backdrop) backdrop.classList.add('hidden');
  kaDocViewCleanup();
  kaDocViewCurrentUrl = null;
}

async function kaOpenDocViewer({ url, name, type } = {}) {
  const backdrop = document.getElementById('ka-doc-view-backdrop');
  const body = document.getElementById('ka-doc-view-body');
  const titleEl = document.getElementById('ka-doc-view-title');
  const subEl = document.getElementById('ka-doc-view-sub');
  if (!backdrop || !body || !titleEl) return;

  const normalizedUrl = kaDocNormalizeUrl(url);
  if (!normalizedUrl) return;

  kaDocViewCleanup();
  kaDocViewCurrentUrl = normalizedUrl;

  titleEl.textContent = name || 'Document';
  if (subEl) {
    subEl.textContent = type ? `Type: ${type}` : '';
  }

  body.innerHTML = '<div class="ka-ship-muted">Loading document…</div>';
  backdrop.classList.remove('hidden');
  kaUpdateDocViewerDownloadState();

  let cached = null;
  try {
    cached = await kaGetCachedDoc(normalizedUrl);
  } catch {
    cached = null;
  }

  let blob = cached?.blob || null;
  let contentType = cached?.contentType || '';

  if (!blob) {
    try {
      const fetched = await kaFetchDocBlob(normalizedUrl);
      blob = fetched.blob;
      contentType = fetched.contentType || contentType;
    } catch (err) {
      const offlineMsg = !navigator.onLine
        ? 'This document is not available offline yet. Connect to the internet and open it once to cache it.'
        : `Unable to load document. ${err.message || err}`;
      body.innerHTML = `<div class="ka-ship-muted">${offlineMsg}</div>`;
      return;
    }
  }

  const kind = kaDocViewKind(contentType, name, blob.type);
  const objectUrl = URL.createObjectURL(blob);
  kaDocViewObjectUrl = objectUrl;

  if (kind === 'pdf') {
    body.innerHTML = `<iframe class="ka-doc-view-frame" src="${objectUrl}" title="${name || 'Document'}"></iframe>`;
  } else if (kind === 'image') {
    body.innerHTML = `<img class="ka-doc-view-image" src="${objectUrl}" alt="${name || 'Document'}" />`;
  } else {
    body.innerHTML = '<div class="ka-ship-muted">Preview unavailable for this file type. Use Download while online.</div>';
  }
}

async function kaPrefetchDocsForOffline(docs = []) {
  if (!navigator.onLine || !Array.isArray(docs) || !docs.length) return;
  const cache = await kaGetDocCache();
  if (!cache) return;
  for (const doc of docs) {
    const rawUrl = doc?.url || doc?.file_path;
    if (!rawUrl) continue;
    const url = kaDocNormalizeUrl(kaAppendShipmentAuth(rawUrl));
    if (!url) continue;
    try {
      const cached = await cache.match(url);
      if (cached) continue;
      const resp = await fetch(url, { credentials: 'same-origin' });
      if (resp && resp.ok) {
        await cache.put(url, resp.clone());
      }
    } catch {
      // ignore prefetch failures
    }
  }
}

function kaBindDocViewerModal() {
  const backdrop = document.getElementById('ka-doc-view-backdrop');
  if (!backdrop || backdrop.dataset.bound) return;
  const closeBtn = document.getElementById('ka-doc-view-close');
  const closeBtnAlt = document.getElementById('ka-doc-view-close-btn');
  const downloadBtn = document.getElementById('ka-doc-view-download');
  const close = () => {
    kaCloseDocViewer();
  };

  closeBtn?.addEventListener('click', close);
  closeBtnAlt?.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !backdrop.classList.contains('hidden')) {
      close();
    }
  });
  downloadBtn?.addEventListener('click', () => {
    if (!kaDocViewCurrentUrl) return;
    if (!navigator.onLine) {
      kaShowModalToast('Offline: connect to download.', 'error');
      return;
    }
    window.open(kaDocViewCurrentUrl, '_blank');
  });

  window.addEventListener('online', kaUpdateDocViewerDownloadState);
  window.addEventListener('offline', kaUpdateDocViewerDownloadState);
  backdrop.dataset.bound = '1';
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

function kaDocMatchesVendor(doc) {
  const t = (doc.doc_type || doc.doc_label || doc.title || '').toLowerCase();
  if (kaDocMatchesShipper(doc) || kaDocMatchesClearing(doc)) return false;
  return (
    t.includes('vendor') ||
    t.includes('invoice') ||
    t.includes('supplier') ||
    t.includes('seller')
  );
}

function kaRenderDocsList(docs) {
  const list = kaFilterDocsForPermissions(docs);
  if (!Array.isArray(list) || !list.length) {
    return '<div class="ka-ship-muted">(No documents uploaded)</div>';
  }
  const items = list.map(doc => {
    const rawHref = doc.url || doc.file_path || '#';
    const href = kaAppendShipmentAuth(rawHref);
    const label =
      doc.filename || doc.title || doc.label || doc.doc_label || 'Document';
    const downloadName =
      doc.filename || doc.original_name || doc.title || doc.label || 'document';
    const type = doc.doc_label || doc.doc_type || '';
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
  const labelWrap = document.getElementById('ka-docs-upload-label-wrap');
  const labelInput = document.getElementById('ka-docs-upload-label');
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

  const syncLabelInput = () => {
    if (!typeSelect) return;
    const needsLabel = (typeSelect.value || '') === 'Other';
    if (labelWrap) labelWrap.hidden = !needsLabel;
    if (labelInput) {
      labelInput.disabled = !needsLabel;
      if (!needsLabel) labelInput.value = '';
    }
  };

  if (typeSelect) {
    typeSelect.addEventListener('change', syncLabelInput);
    syncLabelInput();
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
    const typeValue = typeSelect ? typeSelect.value : '';
    const customLabel = labelInput ? labelInput.value.trim() : '';
    if (typeValue === 'Other' && !customLabel) {
      if (statusEl) {
        statusEl.textContent = 'Enter a label for "Other" document type.';
        statusEl.className = 'ka-status ka-status-error';
      }
      return;
    }
    const form = new FormData();
    Array.from(files).forEach(f => form.append('documents', f));
    if (typeValue) {
      form.append('doc_type', typeValue);
      form.append('doc_label', typeValue === 'Other' ? customLabel : typeValue);
    }
    const auth = kaShipmentAuthMeta();
    if (auth.employee_id) form.append('employee_id', String(auth.employee_id));
    if (auth.device_id) form.append('device_id', auth.device_id);
    if (auth.device_secret) form.append('device_secret', auth.device_secret);

    if (!auth.employee_id || !auth.device_id || !auth.device_secret) {
      if (statusEl) {
        statusEl.textContent = 'Admin access required to upload documents.';
        statusEl.className = 'ka-status ka-status-error';
      }
      return;
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
        headers: kaGetCsrfHeader()
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.error || data.message || 'Upload failed');
      }

      await kaReloadDocsForOverview(kaItemsModalShipmentId);
      fileInput.value = '';
      if (typeSelect) typeSelect.value = '';
      if (labelInput) {
        labelInput.value = '';
        labelInput.disabled = true;
      }
      if (labelWrap) labelWrap.hidden = true;
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
        kaBindOverviewPaymentDocs();
        kaBindNotesControls(shipment);
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
        kaBindOverviewPaymentDocs();
        kaBindNotesControls(kaShipmentDetail.shipment);
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

function kaBindNotesControls(shipment) {
  const notesEl = document.getElementById('ka-shipment-notes');
  const saveBtn = document.getElementById('ka-notes-save');
  const statusEl = document.getElementById('ka-notes-status');
  if (!notesEl || !saveBtn) return;

  const startingValue = shipment && shipment.notes != null ? String(shipment.notes) : '';
  let lastSaved = startingValue;
  let isEditing = false;

  const setStatus = (msg, variant = '') => {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    let cls = 'ka-status';
    if (variant === 'error') cls += ' ka-status-error';
    if (variant === 'ok') cls += ' ka-status-ok';
    statusEl.className = cls;
  };

  const syncSaveState = () => {
    if (!isEditing) {
      saveBtn.disabled = false;
      return;
    }
    saveBtn.disabled = false;
  };

  const updateLocalNotes = (nextValue) => {
    const safeValue = nextValue == null ? '' : String(nextValue);
    if (shipment) shipment.notes = safeValue;
    if (kaShipmentDetail && kaShipmentDetail.shipment) {
      kaShipmentDetail.shipment.notes = safeValue;
    }
    if (notesEl && notesEl.value !== safeValue) {
      notesEl.value = safeValue;
    }
  };

  const enterEditMode = () => {
    isEditing = true;
    notesEl.readOnly = false;
    notesEl.closest('.ka-items-notes')?.classList.add('is-editing');
    saveBtn.textContent = 'Save notes';
    setStatus('');
    syncSaveState();
    notesEl.focus();
  };

  const exitEditMode = () => {
    isEditing = false;
    notesEl.readOnly = true;
    notesEl.closest('.ka-items-notes')?.classList.remove('is-editing');
    saveBtn.textContent = 'Edit notes';
    syncSaveState();
  };

  notesEl.closest('.ka-items-notes')?.classList.remove('is-editing');
  notesEl.readOnly = true;
  saveBtn.textContent = 'Edit notes';
  notesEl.addEventListener('input', syncSaveState);
  syncSaveState();

  saveBtn.onclick = async () => {
    if (!shipment || !shipment.id) return;
    const nextValue = notesEl.value || '';
    const normalized = nextValue.trim();
    if (!isEditing) {
      enterEditMode();
      return;
    }
    if (normalized === (lastSaved || '').trim()) {
      exitEditMode();
      return;
    }
    saveBtn.disabled = true;
    setStatus('Saving…');

    if (!navigator.onLine) {
      kaQueueShipmentNotes(shipment.id, normalized);
      updateLocalNotes(normalized);
      lastSaved = normalized;
      exitEditMode();
      setStatus('Saved offline. Will sync when online.', 'ok');
      return;
    }

    try {
      const resp = await fetchJSON(`/api/shipments/${shipment.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: normalized })
      });
      const saved = resp && resp.shipment ? resp.shipment : null;
      if (saved && saved.notes !== undefined) {
        updateLocalNotes(saved.notes || '');
        lastSaved = saved.notes || '';
      } else {
        updateLocalNotes(normalized);
        lastSaved = normalized;
      }
      setStatus('Notes saved.', 'ok');
      exitEditMode();
    } catch (err) {
      if (!navigator.onLine) {
        kaQueueShipmentNotes(shipment.id, normalized);
        updateLocalNotes(normalized);
        lastSaved = normalized;
        exitEditMode();
        setStatus('Saved offline. Will sync when online.', 'ok');
      } else {
        setStatus(err.message || 'Error saving notes.', 'error');
      }
    } finally {
      syncSaveState();
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

function kaShowDocsEmptyModal(mode = 'all') {
  const backdrop = document.getElementById('ka-docs-backdrop');
  const body = document.getElementById('ka-docs-body');
  const titleEl = document.getElementById('ka-docs-title');
  if (!backdrop || !body) return;
  const titles = {
    shipper: 'Shipper proof of payment',
    clearing: 'Clearing proof of payment',
    vendor: 'Vendor invoice',
    all: 'Shipment documents'
  };
  if (titleEl) titleEl.textContent = titles[mode] || titles.all;
  body.innerHTML = '<div class="ka-ship-muted">(No document uploaded.)</div>';
  backdrop.classList.remove('hidden');
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
    if (mode === 'vendor') filtered = docs.filter(kaDocMatchesVendor);

    if (titleEl) {
      const titles = {
        shipper: 'Shipper proof of payment',
        clearing: 'Clearing proof of payment',
        vendor: 'Vendor invoice',
        all: 'Shipment documents'
      };
      titleEl.textContent = titles[mode] || titles.all;
    }

    body.innerHTML = filtered.length
      ? kaRenderDocsList(filtered)
      : '<div class="ka-ship-muted">(No documents found for this category.)</div>';
    kaPrefetchDocsForOffline(filtered);
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
  const trackingHref = tracking
    ? `https://www.google.com/search?q=${encodeURIComponent(`tracking ${tracking}`)}`
    : '';
  const freight = shipment.freight_forwarder || '';
  const poNumber = shipment.po_number || '—';
  const internalRef = shipment.sku || '—';
  const canViewPayments = kaCanViewPayroll();
  const expectedShip = kaFmtDateMMDDYYYY(shipment.expected_ship_date) || '—';
  const expectedArrival = kaFmtDateMMDDYYYY(shipment.expected_arrival_date) || '—';
  const pickupDate = kaFmtDateMMDDYYYY(shipment.picked_up_date) || '—';
  const pickupUpdatedBy = shipment.picked_up_updated_by || '';
  const pickupUpdatedAt = shipment.picked_up_updated_at || '';
  const storageDue = kaFmtDateMMDDYYYY(shipment.storage_due_date) || '—';
  const paidShipper = Number(shipment.shipper_paid) === 1 ? 'Paid' : 'Unpaid';
  const paidCustoms = Number(shipment.customs_paid) === 1 ? 'Paid' : 'Unpaid';
  const amountShipper = kaFmtCurrency(shipment.shipper_paid_amount);
  const amountCustoms = kaFmtCurrency(shipment.customs_paid_amount);
  const totalPaid = kaFmtCurrency(
    (Number(shipment.shipper_paid_amount) || 0) +
    (Number(shipment.customs_paid_amount) || 0)
  );

  const verify = kaShipVerificationInfo(shipment);
  const normalizedDocs = kaFilterDocsForPermissions(kaNormalizeDocs(docs));
  const shipperDocs = normalizedDocs.filter(kaDocMatchesShipper);
  const clearingDocs = normalizedDocs.filter(kaDocMatchesClearing);
  const paymentRows = [
    { label: 'Freight Forwarder Paid', status: paidShipper, amount: amountShipper, mode: 'shipper', hasDocs: shipperDocs.length > 0 },
    { label: 'Customs Paid', status: paidCustoms, amount: amountCustoms, mode: 'clearing', hasDocs: clearingDocs.length > 0 }
  ];
  const paymentTotalsRow = canViewPayments
    ? `<div class="ka-items-overview-pair ka-pay-total"><span>Total Paid</span><strong>${totalPaid}</strong></div>`
    : '';
  const shipmentId = shipment.id || kaItemsModalShipmentId || '';
  const paymentsHtml = paymentRows
    .map(row => {
      const amountPart =
        canViewPayments && row.amount !== '—'
          ? row.status === 'Paid'
            ? ` (<button type="button" class="ka-pay-doc-link" data-ka-pay-docs="${row.mode}" data-ka-pay-docs-has="${row.hasDocs ? 1 : 0}" data-ka-pay-docs-id="${shipmentId}">${row.amount}</button>)`
            : ` (${row.amount})`
          : '';
      return `<div class="ka-items-overview-pair"><span>${row.label}</span><strong>${row.status}${amountPart}</strong></div>`;
    })
    .join('');
  const bolDoc = kaFindDocByType(normalizedDocs, 'bol');
  const bolHref = bolDoc ? kaAppendShipmentAuth(bolDoc.url || bolDoc.file_path || null) : null;
  const otherDocs = normalizedDocs.filter(d => !bolDoc || d !== bolDoc);

  const docItems = [];
  const pushDocCard = (doc, fallbackType) => {
    if (!doc) return;
    const href = kaAppendShipmentAuth(doc.url || doc.file_path || '#');
    const label = doc.filename || doc.title || doc.label || doc.doc_label || 'Document';
    const typeLabel = doc.doc_label || doc.doc_type || fallbackType || 'Document';
    docItems.push(`
      <li class="ka-doc-card">
        <a class="ka-doc-card-link" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>
        <div class="ka-doc-card-type">Type: ${typeLabel}</div>
      </li>
    `);
  };
  if (bolDoc) {
    pushDocCard(bolDoc, 'BOL');
  }
  otherDocs.forEach(doc => pushDocCard(doc, 'Document'));

  const docsHtml = docItems.length
    ? `<ul class="ka-docs-card-list">${docItems.join('')}</ul>`
    : '<div class="ka-ship-muted">(No documents uploaded)</div>';
  const notesValue = shipment.notes == null ? '' : String(shipment.notes);

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
                  ? `<a class="ka-ship-bol-pill" href="${bolHref}">${bolLabel}</a>`
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
        <div class="ka-items-overview-pair"><span>Tracking #</span>${
          tracking
            ? `<a class="ka-tracking-link" href="${trackingHref}" target="_blank" rel="noopener noreferrer">${tracking}</a>`
            : `<strong>—</strong>`
        }</div>
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

    <div class="ka-items-notes">
      <div class="ka-items-overview-label">Notes</div>
      <textarea id="ka-shipment-notes" rows="3" placeholder="Add notes for this shipment">${escapeHTML(notesValue)}</textarea>
      <div class="ka-notes-actions">
        <button type="button" class="btn secondary btn-sm" id="ka-notes-save">Save notes</button>
        <span class="ka-status" id="ka-notes-status"></span>
      </div>
    </div>

    <div class="ka-items-docs">
      <h4>Documents</h4>
      <div class="ka-docs-list-wrap">
        ${docsHtml}
      </div>
      <div class="ka-docs-divider"></div>
      <h5 class="ka-doc-upload-title">Upload New Documents</h5>
      <div class="ka-doc-upload-block">
          <div class="ka-doc-upload">
            <div class="ka-doc-upload-file">
              <div class="ka-doc-upload-step">
                <button type="button" class="btn secondary btn-sm" id="ka-docs-upload-choose">Choose Files</button>
              </div>
              <span id="ka-docs-upload-filename" class="ka-doc-file-name">No Files Selected</span>
              <input type="file" id="ka-docs-upload-files" multiple class="ka-doc-hidden-input" />
          </div>
          <label class="ka-doc-upload-type">
            <div class="ka-doc-upload-step">
              <select id="ka-docs-upload-type">
                <option value="">Select type…</option>
                <option value="Shippers Invoice">Shippers Invoice</option>
                <option value="Vendor Invoice">Vendor Invoice</option>
                <option value="BOL">BOL</option>
                <option value="Country of Origin Certificate">Country of Origin Certificate</option>
                <option value="Tally Sheet">Tally Sheet</option>
                <option value="Freight Forwarder Proof of Payment">Freight Forwarder Proof of Payment</option>
                <option value="Customs & Clearing Proof of Payment">Customs & Clearing Proof of Payment</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </label>
          <label class="ka-doc-upload-type" id="ka-docs-upload-label-wrap" hidden>
            <div class="ka-doc-upload-step">
              <input type="text" id="ka-docs-upload-label" placeholder="Describe document type" />
            </div>
          </label>
          <button type="button" class="btn primary btn-sm" id="ka-docs-upload-btn">Upload</button>
        </div>
        <div id="ka-docs-upload-status" class="ka-status"></div>
      </div>
    </div>
  `;
}

function kaBindOverviewPaymentDocs() {
  const wrap = document.getElementById('ka-items-overview');
  if (!wrap) return;
  wrap.querySelectorAll('[data-ka-pay-docs]').forEach(btn => {
    if (btn.dataset.bound) return;
    btn.addEventListener('click', () => {
      const mode = btn.dataset.kaPayDocs || 'all';
      const hasDocs = btn.dataset.kaPayDocsHas === '1';
      const sid = Number(btn.dataset.kaPayDocsId || kaItemsModalShipmentId);
      if (!sid) return;
      if (hasDocs) {
        kaOpenDocsModal(sid, mode);
      } else {
        kaShowDocsEmptyModal(mode);
      }
    });
    btn.dataset.bound = '1';
  });
}

function kaBindOverviewDocViewer() {
  const wrap = document.getElementById('ka-items-overview');
  if (!wrap || wrap.dataset.docViewBound) return;
  wrap.addEventListener('click', (e) => {
    const link = e.target.closest('.ka-doc-card-link, .ka-ship-bol-pill');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href || href === '#' || href.startsWith('javascript')) return;
    e.preventDefault();
    e.stopPropagation();
    const name = (link.textContent || '').trim();
    let type = '';
    const card = link.closest('.ka-doc-card');
    if (card) {
      const typeEl = card.querySelector('.ka-doc-card-type');
      if (typeEl) type = (typeEl.textContent || '').trim();
    }
    if (type.toLowerCase().startsWith('type:')) {
      type = type.replace(/^type:\s*/i, '');
    }
    if (!type && link.classList.contains('ka-ship-bol-pill')) {
      type = 'BOL';
    }
    kaOpenDocViewer({ url: href, name, type });
  });
  wrap.dataset.docViewBound = '1';
}

async function kaOpenItemsModal(shipmentId, opts = {}) {
  const { tab = kaItemsActiveTab || 'items' } = opts || {};
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
  kaItemsStatusFilter = 'unverified';
  kaSetItemsTab(tab);
  kaShipmentDetailDocs = [];
  kaExpandedItems.clear();

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
  kaShipmentDetailDocs = documents;

  kaSeedSavedItemStatuses(items);

  const bolDoc = kaFindDocByType(documents, 'bol');
  kaSetBolLink(shipmentId, bolDoc);

  titleEl.textContent =
    (shipment.title || shipment.sku || `Shipment #${shipment.id || shipmentId || ''}`);
  if (subEl) {
    subEl.textContent = '';
  }

  overviewEl.innerHTML = kaRenderShipmentOverview(shipment, documents, items);
  kaBindOverviewUpload();
  kaBindOverviewPaymentDocs();
  kaBindOverviewDocViewer();
  kaBindNotesControls(shipment);
  kaBindPickupControls(shipment);
  kaPrefetchDocsForOffline(documents);

  const hasItems = Array.isArray(items) && items.length > 0;

  body.innerHTML = `
    <div class="ka-items-toolbar">
      <div class="ka-items-actions">
        <label class="ka-items-filter">
          <span>View</span>
          <select id="ka-items-status-filter">
            <option value="unverified" ${kaItemsStatusFilter === 'unverified' ? 'selected' : ''}>Unverified</option>
            <option value="verified" ${kaItemsStatusFilter === 'verified' ? 'selected' : ''}>Verified</option>
            <option value="missing" ${kaItemsStatusFilter === 'missing' ? 'selected' : ''}>Missing</option>
            <option value="damaged" ${kaItemsStatusFilter === 'damaged' ? 'selected' : ''}>Damaged</option>
            <option value="wrong_item" ${kaItemsStatusFilter === 'wrong_item' ? 'selected' : ''}>Wrong item</option>
            <option value="all" ${kaItemsStatusFilter === 'all' ? 'selected' : ''}>All</option>
          </select>
        </label>
        <div class="ka-search-field">
          <svg class="ka-search-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="1.8"></circle>
            <path d="M20 20l-4.35-4.35" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
          </svg>
          <input type="search" id="ka-items-search" placeholder="Search description or SKU" value="${kaItemsFilterTerm}" />
        </div>
      </div>
    </div>

    <div id="ka-items-list" class="ka-items-list">
      ${hasItems ? '' : '<div class="ka-ship-muted">(No items on this shipment)</div>'}
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

  const statusFilterEl = document.getElementById('ka-items-status-filter');
  if (statusFilterEl && !statusFilterEl.dataset.bound) {
    statusFilterEl.addEventListener('change', () => {
      kaItemsStatusFilter = statusFilterEl.value || 'unverified';
      kaRenderItemsList(shipmentId);
    });
    statusFilterEl.dataset.bound = '1';
  }

  const saveNowBtn = document.getElementById('ka-items-save-now');
  if (saveNowBtn && !saveNowBtn.dataset.bound) {
    saveNowBtn.addEventListener('click', () => {
      kaClearItemAutoSaves();
      kaSaveShipmentVerificationFor(shipmentId);
    });
    saveNowBtn.dataset.bound = '1';
  }

  const undoBtn = document.getElementById('ka-items-undo');
  if (undoBtn && !undoBtn.dataset.bound) {
    undoBtn.addEventListener('click', () => {
      kaClearItemAutoSaves();
      kaShipmentItemsDirty.clear();
      kaOpenItemsModal(shipmentId, { tab: kaItemsActiveTab });
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

  const statusFilter = (kaItemsStatusFilter || 'unverified').toLowerCase().trim();
  if (statusFilter && statusFilter !== 'all') {
    items = items.filter(item => {
      const current = kaCurrentItemState(item);
      const status = kaNormalizeItemStatus(current?.verification?.status || '');
      const normalized = status || 'unverified';
      return normalized === statusFilter;
    });
  }

  const statusForSort = (it) => kaGetSavedItemStatus(it.id, it.verification?.status || '');
  if (kaItemsFilterUnverifiedFirst) {
    items.sort((a, b) => {
      const aStatus = statusForSort(a);
      const bStatus = statusForSort(b);
      // unverified first, then others; within that, keep collapsed items lower
      const rank = (st) => {
        if (!st || st === 'unverified') return 0;
        return 1;
      };
      const aRank = rank(aStatus);
      const bRank = rank(bStatus);
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
  const combinedNotes = notes || storage || '';
  const isExpanded = kaExpandedItems.has(Number(item.id));
  const chevronGlyph = isExpanded ? '⌄' : '›';
  const lastBy = verification.verified_by || '';
  const lastAt = verification.verified_at ? verification.verified_at.slice(0, 10) : '';
  const qty = item.quantity !== undefined ? item.quantity : '';
  const unit = item.unit || '';
  const sku = item.sku || '';
  const vendorName = item.vendor_name || '';
  const recentlySaved = kaRecentlySavedItems.has(Number(item.id));

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
        <div class="ka-status-select">
          <select class="ka-item-status" data-ka-item-status-select="${item.id}">
            ${statuses
              .map(
                s => `<option value="${s.val}" ${status === s.val ? 'selected' : ''}>${s.label}</option>`
              )
              .join('')}
          </select>
        </div>
        <button type="button" class="ka-item-collapse" data-ka-collapse="${item.id}" aria-label="${isExpanded ? 'Collapse item' : 'Expand item'}">${chevronGlyph}</button>
      </div>
    </div>
    <div class="ka-item-body">
      <div class="ka-item-divider"></div>

      <div class="ka-item-row-notes open" data-ka-notes="${item.id}">
        <label>
          <span>Notes & storage details</span>
          <textarea rows="3" data-ship-item-notes-id="${item.id}">${combinedNotes}</textarea>
        </label>
      </div>

      <div class="ka-item-row-footer">
        <div class="ka-item-last">
          <span class="ka-item-unsaved-dot ${kaShipmentItemsDirty.has(Number(item.id)) ? '' : 'hidden'}" aria-hidden="true">●</span>
          <span class="ka-item-last-meta">${
            lastBy || lastAt ? `${lastBy || ''}${lastAt ? ` · ${lastAt}` : ''}` : ''
          }</span>
        </div>
        <div class="ka-item-row-actions">
          <button type="button" class="btn secondary btn-sm" data-ka-save-item="${item.id}">Save now</button>
          <span class="ka-item-save-status ${recentlySaved ? 'is-ok' : ''}" data-ka-item-save-status="${item.id}">${recentlySaved ? 'Saved' : ''}</span>
        </div>
      </div>
    </div>
  `;

  const statusSelect = row.querySelector('[data-ka-item-status-select]');
  const notesEl = row.querySelector(`textarea[data-ship-item-notes-id="${item.id}"]`);
  const saveBtn = row.querySelector(`[data-ka-save-item="${item.id}"]`);
  const collapseBtn = row.querySelector(`[data-ka-collapse="${item.id}"]`);
  const unsavedDot = row.querySelector('.ka-item-unsaved-dot');
  const lastMeta = row.querySelector('.ka-item-last-meta');
  const saveStatus = row.querySelector('[data-ka-item-save-status]');

  const applyStatusStyle = (val) => {
    const allStatuses = ['verified', 'missing', 'damaged', 'wrong_item', 'unverified'];
    allStatuses.forEach(s => row.classList.remove(`status-${s}`));
    row.classList.add(`status-${val || 'unverified'}`);
    if (statusSelect) {
      statusSelect.classList.remove(
        'ka-status-verified',
        'ka-status-missing',
        'ka-status-damaged',
        'ka-status-wrong_item'
      );
      const normalized = kaNormalizeItemStatus(val);
      if (normalized && normalized !== 'unverified') {
        statusSelect.classList.add(`ka-status-${normalized}`);
      }
    }
  };

  const setActiveStatus = (val) => {
    if (statusSelect) statusSelect.value = val;
    applyStatusStyle(val);
  };

  const buildPayload = (statusOverride = null) => {
    const nowIso = new Date().toISOString();
    const admin = kaCurrentAdmin || {};
    const verifiedBy = admin.nickname || admin.name || 'Field Admin';
    const newStatus =
      statusOverride !== null ? statusOverride : (statusSelect ? statusSelect.value || '' : '');
    const combinedValue = notesEl ? notesEl.value || '' : '';

    return {
      status: newStatus,
      notes: combinedValue,
      storage_override: combinedValue,
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
    kaClearItemSavedStatus(itemIdNum);
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
    if (saveStatus) {
      saveStatus.textContent = '';
      saveStatus.classList.remove('is-ok');
    }

    if (lastMeta) {
      lastMeta.textContent = `${payload.verified_by || ''}${
        payload.verified_at ? ` · ${payload.verified_at.slice(0, 10)}` : ''
      }`;
    }

    if (!skipAuto && KA_ITEMS_AUTO_SAVE_ENABLED) scheduleAutoSave();
  };

  const currentStatusValue = () => {
    const active = statusSelect ? statusSelect.value || '' : '';
    const saved = kaGetSavedItemStatus(item.id, status);
    return kaNormalizeItemStatus(active || saved);
  };

  if (statusSelect) {
    statusSelect.addEventListener('change', () => {
      const val = statusSelect.value || '';
      setActiveStatus(val);
      markDirty(val, { skipAuto: true });
    });
  }

  notesEl?.addEventListener('blur', () => markDirty(null));

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const itemIdNum = Number(item.id);
      markDirty(null, { skipAuto: true });
      const ok = await kaSaveShipmentVerificationFor(shipmentId, { onlyItemId: itemIdNum });
      if (ok) {
        refreshUnsavedState(false);
      }
    });
  }

  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      const collapsed = row.classList.toggle('collapsed');
      if (collapsed) {
        kaExpandedItems.delete(Number(item.id));
      } else {
        kaExpandedItems.add(Number(item.id));
      }
      collapseBtn.textContent = collapsed ? '›' : '⌄';
      collapseBtn.setAttribute('aria-label', collapsed ? 'Expand item' : 'Collapse item');
    });
  }

  row.classList.toggle('collapsed', !isExpanded);

  setActiveStatus(currentStatusValue());

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

  const auth = kaShipmentAuthMeta();
  const clientId = `verify_${shipmentId}_${Date.now().toString(36)}`;

  try {
    const res = await fetchJSON(`/api/shipments/${shipmentId}/verify-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items,
        employee_id: auth.employee_id,
        device_id: auth.device_id,
        device_secret: auth.device_secret,
        client_id: clientId
      })
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

    // Refresh progress counts locally
    kaRefreshShipmentProgress(shipmentId);
    if (shipmentId === kaItemsModalShipmentId) {
      kaRenderItemsList(shipmentId);
    }

    // Also refresh the shipments summary list from the server so progress bars stay in sync
    if (kaCanViewShipments()) {
      kaLoadShipments({ forceFresh: true });
    }

    return true;
  } catch (err) {
    console.error('Failed to save shipment verification', err);
    const offlineLikely =
      !navigator.onLine ||
      (err && typeof err.status === 'number' && err.status === 0);

    if (offlineLikely) {
      kaQueueShipmentVerification(shipmentId, items, {
        ...auth,
        client_id: clientId
      });
      items.forEach(row => {
        kaShipmentItemsDirty.delete(Number(row.shipment_item_id));
        kaUpdateLocalItemVerification(row.shipment_item_id, row.verification || {});
        kaSetItemSavedUI(row.shipment_item_id);
      });
      kaUpdateItemsSavebar();
      kaUpdateItemsSummaryUI();
      kaRefreshShipmentProgress(shipmentId);
      if (shipmentId === kaItemsModalShipmentId) {
        kaRenderItemsList(shipmentId);
      }

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
  kaSetSavedItemStatus(itemId, status);
  kaMarkItemRecentlySaved(itemId);

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
      lastMeta.textContent = lastBy || lastAt ? `${lastBy || ''}${lastAt ? ` · ${lastAt}` : ''}` : '';
    }
    const saveStatus = row.querySelector('[data-ka-item-save-status]');
    if (saveStatus) {
      saveStatus.textContent = 'Saved';
      saveStatus.classList.add('is-ok');
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

  const adminId = Number(kaStartEmployeeId);
  await kaRefreshAdminPunchStatus();
  const adminWasOpen = kaAdminOpenPunch && kaAdminOpenPunch.open;

  const shouldClockMeIn = !kaClockInPhotoRequired && !adminWasOpen;

  if (status) {
    const msg = shouldClockMeIn
      ? 'Starting day and clocking you in…'
      : 'Starting day…';
    kaShowStatusMessage(msg, 'ok', 6000);
  }

  try {
    const pos = await kaGetPosition();
    // 1) Log a kiosk session and make it active so the worker screen is locked in
    let firstSessionToday = false;
    const sessionResp = await kaCreateSessionWithGeo({
      projectId,
      makeActive: true,
      adminId,
      clockMeIn: shouldClockMeIn,
      clockInPayload: shouldClockMeIn
        ? {
            client_id: `start_${kaKiosk.id}_${Date.now()}`,
            device_timestamp: new Date().toISOString(),
            lat: pos?.lat ?? null,
            lng: pos?.lng ?? null
          }
        : null,
      lat: pos?.lat ?? null,
      lng: pos?.lng ?? null
    });
    if (!sessionResp) {
      if (status) {
        status.textContent = 'Timesheet not started.';
        status.className = 'ka-status ka-status-error';
      }
      return;
    }
    firstSessionToday = !!(sessionResp && sessionResp.first_session_today);
    if (sessionResp && sessionResp.session && sessionResp.session.id) {
      kaActiveSessionId = sessionResp.session.id;
    }

    // 1b) Save kiosk settings (same as kaSaveKioskSettings)
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
    await kaLoadSessions();

    // Fallback detection in case the server did not flag it
    const today = kaTodayIso();
    const todaysSessions = (kaSessions || []).filter(
      s => (s.date || '').slice(0, 10) === today
    );
    if (!firstSessionToday && todaysSessions.length === 1) {
      firstSessionToday = true;
    }

    // 2) Ask the admin if they want to clock in on this timesheet
    await kaRefreshAdminPunchStatus();
    const adminOpen = kaAdminOpenPunch && kaAdminOpenPunch.open;
    if (shouldClockMeIn && adminOpen) {
      kaShowStatusMessage('Day started and you are now clocked in.', 'ok', 8000);
      return;
    }
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
  kaSetText('ka-sidebar-admin-name', kaAdminDisplayName());
  kaSetText('ka-kiosk-device-id', kaKiosk.device_id || '(none)');
  kaUpdateSidebarClockedIn();
}

function kaRenderProjectsSelect() {
  const sel = document.getElementById('ka-project-select');
  if (!sel) return;

  const projects = Array.isArray(kaProjects) ? kaProjects : [];
  const activeProjects = projects.filter(
    p => p.active === undefined || p.active === null || Number(p.active) === 1
  );
  const activeId =
    kaKiosk && kaKiosk.project_id !== undefined && kaKiosk.project_id !== null
      ? Number(kaKiosk.project_id)
      : null;
  if (Number.isFinite(activeId)) {
    activeProjects.sort((a, b) => {
      const aActive = Number(a.id) === activeId;
      const bActive = Number(b.id) === activeId;
      if (aActive === bActive) return 0;
      return aActive ? -1 : 1;
    });
  }

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

async function kaInitAdminConsoleSwitch() {
  const tile = document.getElementById('ka-admin-console-tile');
  const btn = document.getElementById('ka-switch-admin-console');
  const status = document.getElementById('ka-switch-admin-status');
  if (!tile || !btn) return;

  tile.classList.add('hidden');

  if (!kaCurrentAdmin || !kaCurrentAdmin.is_admin) return;
  tile.classList.remove('hidden');

  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    if (status) {
      status.textContent = 'Verifying PIN...';
      status.className = 'ka-status';
    }

    const unlocked = await kaRequireAdminUnlock();
    if (!unlocked) {
      btn.disabled = false;
      return;
    }

    try {
      if (status) {
        status.textContent = 'Switching to admin console...';
        status.className = 'ka-status';
      }
      await fetchJSON('/api/auth/ui-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'desktop' })
      });
      window.location.href = '/';
    } catch (err) {
      const statusCode = err && Number(err.status || 0);
      if (statusCode === 401 || statusCode === 403) {
        if (status) {
          status.textContent = 'Super admin sign-in required. Redirecting...';
          status.className = 'ka-status';
        }
        const params = new URLSearchParams();
        params.set('force_desktop', '1');
        window.location.href = `/auth?${params.toString()}`;
        return;
      }

      if (status) {
        status.textContent = err.message || 'Unable to switch to admin console.';
        status.className = 'ka-status ka-status-error';
      }
      btn.disabled = false;
    }
  });
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
    let sessionResp = null;
    if (projectId) {
      const pos = await kaGetPosition();
      sessionResp = await kaCreateSessionWithGeo({
        projectId,
        makeActive: true,
        lat: pos?.lat ?? null,
        lng: pos?.lng ?? null
      });
      if (!sessionResp) {
        if (status) {
          status.textContent = 'Timesheet not started.';
          status.className = 'ka-status ka-status-error';
        }
        return;
      }
      if (sessionResp.session && sessionResp.session.id) {
        kaActiveSessionId = sessionResp.session.id;
      }
    } else if (prevProjectId && !projectId) {
      kaActiveSessionId = null;
    }

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

    if (projectId) {
      await kaLoadSessions();
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
    const hasPin = !!e.pin_hash || !!(e.pin || '').trim();
    return !hasPin;
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
    if (emp) {
      const pinHash = kaHashPin(p1);
      if (pinHash) {
        emp.pin_hash = pinHash;
        emp.pin = '';
      } else {
        emp.pin = p1;
      }
    }

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
      if (emp) {
        const pinHash = kaHashPin(p1);
        if (pinHash) {
          emp.pin_hash = pinHash;
          emp.pin = '';
        } else {
          emp.pin = p1;
        }
      }
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
        if (emp) {
          const pinHash = kaHashPin(p1);
          if (pinHash) {
            emp.pin_hash = pinHash;
            emp.pin = '';
          } else {
            emp.pin = p1;
          }
        }
        await kaAddPendingPinUpdate({ employee_id: id, pin: p1 });
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

async function kaHandleHelperAdd() {
  const statusEl = document.getElementById('ka-helper-status');
  const nameInput = document.getElementById('ka-helper-name');
  const nicknameInput = document.getElementById('ka-helper-nickname');
  const langSelect = document.getElementById('ka-helper-language');
  const idTypeSelect = document.getElementById('ka-helper-id-type');
  const fileInput = document.getElementById('ka-helper-id-file');

  if (!statusEl || !nameInput || !idTypeSelect || !fileInput) return;

  if (!navigator.onLine) {
    statusEl.textContent = 'Adding workers requires an internet connection.';
    statusEl.className = 'ka-status ka-status-error';
    return;
  }

  const name = String(nameInput.value || '').trim();
  const nickname = String(nicknameInput?.value || '').trim();
  const language = (langSelect && langSelect.value) ? langSelect.value : 'en';
  const idType = String(idTypeSelect.value || '').trim();
  const file = fileInput.files && fileInput.files[0];
  const adminId = kaCurrentAdmin && kaCurrentAdmin.id ? kaCurrentAdmin.id : null;
  const deviceSecret = kaGetDeviceSecret();

  if (!name) {
    statusEl.textContent = 'Enter a full name.';
    statusEl.className = 'ka-status ka-status-error';
    return;
  }
  if (!idType) {
    statusEl.textContent = 'Select an ID type.';
    statusEl.className = 'ka-status ka-status-error';
    return;
  }
  if (!file) {
    statusEl.textContent = 'Upload an ID image.';
    statusEl.className = 'ka-status ka-status-error';
    return;
  }
  if (!adminId) {
    statusEl.textContent = 'Admin session required.';
    statusEl.className = 'ka-status ka-status-error';
    return;
  }
  if (!kaDeviceId || !deviceSecret) {
    statusEl.textContent = 'Kiosk device is not registered.';
    statusEl.className = 'ka-status ka-status-error';
    return;
  }

  statusEl.textContent = 'Uploading worker...';
  statusEl.className = 'ka-status';

  try {
    const form = new FormData();
    form.append('name', name);
    if (nickname) form.append('nickname', nickname);
    if (language) form.append('language', language);
    form.append('id_document_type', idType);
    form.append('id_document', file);
    form.append('admin_id', String(adminId));
    form.append('device_id', kaDeviceId);
    form.append('device_secret', deviceSecret);

    const resp = await fetch('/api/kiosk/employees', {
      method: 'POST',
      body: form,
      credentials: 'include',
      headers: kaGetCsrfHeader()
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data.error || 'Failed to add worker.');
    }

    statusEl.textContent = 'Worker added for review.';
    statusEl.className = 'ka-status ka-status-ok';

    nameInput.value = '';
    if (nicknameInput) nicknameInput.value = '';
    if (langSelect) langSelect.value = 'en';
    idTypeSelect.value = '';
    fileInput.value = '';

    const refreshed = await fetchJSON('/api/kiosk/employees');
    kaEmployees = (refreshed || []).map(e => ({
      ...e,
      is_admin: !!e.kiosk_admin_access,
      uses_timekeeping: e.worker_timekeeping !== undefined ? Number(e.worker_timekeeping) : 1
    }));
    kaRenderSettingsForm();
    kaRenderPinStatus();
    if (kaRatesUnlockedAll) {
      kaRenderRatesTable(kaEmployees);
    }
  } catch (err) {
    console.error('Error adding helper:', err);
    statusEl.textContent = err.message || 'Could not add worker.';
    statusEl.className = 'ka-status ka-status-error';
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
  const controls = [pinInput].filter(Boolean);

  if (!kaCanModifyPayRates()) {
    kaResetRatesUI('You do not have permission to modify pay rates.');
    return;
  }

  if (!kaCurrentAdmin || !kaCurrentAdmin.id) {
    kaResetRatesUI('Admin identity missing; reload and try again.');
    return;
  }

  const pin = pinInput ? (pinInput.value || '').trim() : '';
  if (kaEnforcePinThrottle('rate', controls)) {
    return;
  }
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
    kaResetPinFailures('rate');
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
    if (err && err.status === 401) {
      kaRegisterPinFailure('rate', controls);
    }
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

  const resolvedStatus = String(entry.resolved_status || '').toLowerCase();
  if (resolvedStatus && resolvedStatus !== 'open') {
    meta.push(`Review: ${resolvedStatus}`);
  }

  if (entry.resolved_note) {
    meta.push(`Note: ${entry.resolved_note}`);
  }

  const reviewedBy = entry.resolved_by || entry.approved_by_name || entry.approved_by_employee_id;
  const reviewedAt = entry.resolved_at;
  if (reviewedBy || reviewedAt) {
    meta.push(
      `Reviewed by ${reviewedBy || 'admin'}${reviewedAt ? ` on ${new Date(reviewedAt).toLocaleString()}` : ''}`
    );
  }

  return meta.length
    ? `<div class="ka-detail-row">${meta.join(' • ')}</div>`
    : '';
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
  const controls = [pinInput];
  if (kaEnforcePinThrottle('rate', controls)) {
    return;
  }
  const entered = (pinInput.value || '').trim();
  const storedHash = kaCurrentAdmin ? kaCurrentAdmin.pin_hash || '' : '';
  const storedPin = (kaCurrentAdmin && kaCurrentAdmin.pin || '').trim();
  if (!entered) {
    status.textContent = 'Enter your PIN.';
    status.className = 'ka-status ka-status-error';
    return;
  }
  const pinOk = storedHash
    ? kaVerifyPinHash(entered, storedHash)
    : (storedPin && entered === storedPin);
  if (!pinOk) {
    kaRegisterPinFailure('rate', controls);
    status.textContent = 'PIN is incorrect.';
    status.className = 'ka-status ka-status-error';
    return;
  }

  kaResetPinFailures('rate');
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

function kaPopulateTimeActionProjects(selectedId) {
  const select = document.getElementById('ka-time-action-project');
  if (!select) return;
  select.innerHTML = '<option value="">(No change)</option>';
  (kaProjects || []).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name || '(Project)';
    select.appendChild(opt);
  });
  if (selectedId != null) {
    select.value = String(selectedId);
  }
}

function kaOpenTimeActionModal(entry, action) {
  if (!entry) return;
  kaTimeActionEntry = entry;
  kaTimeActionMode = action;

  const backdrop = document.getElementById('ka-time-action-backdrop');
  const title = document.getElementById('ka-time-action-title');
  const sub = document.getElementById('ka-time-action-sub');
  const origDate = document.getElementById('ka-time-action-orig-date');
  const newDate = document.getElementById('ka-time-action-date');
  const origProject = document.getElementById('ka-time-action-orig-project');
  const projectSelect = document.getElementById('ka-time-action-project');
  const origStart = document.getElementById('ka-time-action-orig-start');
  const origEnd = document.getElementById('ka-time-action-orig-end');
  const newStart = document.getElementById('ka-time-action-start');
  const newEnd = document.getElementById('ka-time-action-end');
  const noteInput = document.getElementById('ka-time-action-note');
  const hoursWrap = document.getElementById('ka-time-action-hours-wrap');
  const hoursInput = document.getElementById('ka-time-action-hours');
  const status = document.getElementById('ka-time-action-status');

  if (status) {
    status.textContent = '';
    status.className = 'ka-status';
  }

  if (title) {
    title.textContent =
      action === 'modify'
        ? 'Modify Time Entry'
        : action === 'reject'
          ? 'Reject Time Entry'
          : 'Approve Time Entry';
  }
  if (sub) {
    sub.textContent = entry.employee_name ? `Employee: ${entry.employee_name}` : '';
  }

  const entryDate = entry.start_date || entry.end_date || '';
  if (origDate) origDate.textContent = entryDate || '—';
  if (newDate) newDate.value = entryDate || '';
  if (origProject) origProject.textContent = entry.project_name || '(No project)';
  kaPopulateTimeActionProjects(entry.project_id);
  if (projectSelect) projectSelect.value = '';

  if (origStart) origStart.textContent = entry.start_time || '—';
  if (origEnd) origEnd.textContent = entry.end_time || '—';
  if (newStart) newStart.value = '';
  if (newEnd) newEnd.value = '';
  if (noteInput) noteInput.value = '';
  if (hoursInput) hoursInput.value = '';

  const isModify = action === 'modify';
  [projectSelect, newStart, newEnd, hoursInput].forEach(el => {
    if (el) el.disabled = !isModify;
  });
  if (hoursWrap) {
    hoursWrap.classList.toggle('hidden', !isModify);
  }

  if (backdrop) backdrop.classList.remove('hidden');
}

async function kaHandleTimeActionSubmit() {
  const entry = kaTimeActionEntry;
  const action = kaTimeActionMode;
  if (!entry || !action) return;

  const status = document.getElementById('ka-time-action-status');
  const projectSelect = document.getElementById('ka-time-action-project');
  const newStart = document.getElementById('ka-time-action-start');
  const newEnd = document.getElementById('ka-time-action-end');
  const noteInput = document.getElementById('ka-time-action-note');
  const hoursInput = document.getElementById('ka-time-action-hours');
  const baseDate = document.getElementById('ka-time-action-date')?.value || entry.start_date || entry.end_date;

  const note = noteInput ? noteInput.value.trim() : '';
  if (!note) {
    if (status) {
      status.textContent = 'A note is required.';
      status.className = 'ka-status ka-status-error';
    }
    return;
  }

  const updates = {};
  if (action === 'modify') {
    const startVal = newStart?.value || '';
    const endVal = newEnd?.value || '';
    if (startVal) {
      updates.start_date = baseDate;
      updates.start_time = startVal;
    }
    if (endVal) {
      updates.end_date = baseDate;
      updates.end_time = endVal;
    }
    if (hoursInput && hoursInput.value) {
      const hoursVal = Number(hoursInput.value);
      if (!Number.isNaN(hoursVal)) {
        updates.hours = hoursVal;
      }
    }
    if (projectSelect && projectSelect.value) {
      updates.project_id = Number(projectSelect.value);
    }
    if (!Object.keys(updates).length) {
      if (status) {
        status.textContent = 'Add at least one change before saving.';
        status.className = 'ka-status ka-status-error';
      }
      return;
    }
  }

  try {
    if (status) {
      status.textContent = 'Saving...';
      status.className = 'ka-status';
    }

    const reviewClientId = `time_review_${entry.id}_${Date.now().toString(36)}`;
    const payload = {
      source: 'time_entry',
      action,
      note,
      actor_name: kaAdminDisplayName(),
      updates,
      client_id: reviewClientId
    };
    if (entry.updated_at) {
      payload.if_match_updated_at = entry.updated_at;
    }

    if (!navigator.onLine) {
      kaQueueTimeReview({
        exception_id: entry.id,
        payload,
        queued_at: new Date().toISOString(),
        employee_id: kaAdminAuthId() || null,
        device_id: kaDeviceId || null,
        device_secret: kaGetDeviceSecret() || null
      });
      if (status) {
        status.textContent = 'Saved offline — will sync when back online.';
        status.className = 'ka-status ka-status-ok';
      }
      const backdrop = document.getElementById('ka-time-action-backdrop');
      if (backdrop) backdrop.classList.add('hidden');
      kaTimeActionEntry = null;
      kaTimeActionMode = null;
      return;
    }

    await fetchJSON(`/api/time-exceptions/${entry.id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const backdrop = document.getElementById('ka-time-action-backdrop');
    if (backdrop) backdrop.classList.add('hidden');
    kaTimeActionEntry = null;
    kaTimeActionMode = null;

    await kaLoadTimeEntries();
  } catch (err) {
    if (kaIsConnectionIssue(err) || (err && (err.status === 401 || err.status === 403))) {
      kaQueueTimeReview({
        exception_id: entry.id,
        payload: {
          source: 'time_entry',
          action,
          note,
          actor_name: kaAdminDisplayName(),
          updates,
          client_id: reviewClientId,
          ...(entry.updated_at ? { if_match_updated_at: entry.updated_at } : {})
        },
        queued_at: new Date().toISOString(),
        employee_id: kaAdminAuthId() || null,
        device_id: kaDeviceId || null,
        device_secret: kaGetDeviceSecret() || null
      });
      if (status) {
        status.textContent = 'Saved offline — will sync when back online.';
        status.className = 'ka-status ka-status-ok';
      }
      const backdrop = document.getElementById('ka-time-action-backdrop');
      if (backdrop) backdrop.classList.add('hidden');
      kaTimeActionEntry = null;
      kaTimeActionMode = null;
      return;
    }
    if (status) {
      status.textContent = err.message || 'Failed to update time entry.';
      status.className = 'ka-status ka-status-error';
    }
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
  const colCount = 6 + (actionsEnabled ? 2 : 0);
  const hasContent = tbody && tbody.dataset.hasContent === '1';

  if (!payEnabled) {
    kaOpenDetailEntries.clear();
  }

  if (!tbody || !startInput || !endInput) return;

  // Pay columns are rendered inside detail rows; nothing to toggle here.
  const viewTime = document.getElementById('ka-view-time');
  if (viewTime) {
    viewTime.classList.toggle('ka-hide-approvals', !actionsEnabled);
  }

  if (!kaCanViewTimeReports()) {
    tbody.innerHTML =
      `<tr data-ka-placeholder="1"><td colspan="${colCount}" class="ka-muted">(no access to time entries)</td></tr>`;
    if (status) {
      status.textContent = 'You do not have access to Time Entries.';
      status.className = 'ka-status ka-status-error';
    }
    tbody.dataset.hasContent = '1';
    return;
  }

  const start = startInput.value || kaTodayIso();
  const end = endInput.value || start;
  const employeeId = empFilter ? empFilter.value : '';
  const projectId = projFilter ? projFilter.value : '';

  if (!hasContent) {
    tbody.innerHTML =
      `<tr data-ka-placeholder="1"><td colspan="${colCount}" class="ka-muted">(loading time entries…)</td></tr>`;
  }
  if (status) {
    status.textContent = hasContent ? status.textContent : '';
    status.className = status.className || 'ka-status';
  }
  tbody.dataset.refreshing = '1';

  try {
    const params = new URLSearchParams();
    params.set('start', start);
    params.set('end', end);
    if (employeeId) params.set('employee_id', employeeId);
    if (projectId) params.set('project_id', projectId);

    const deviceSecret = kaGetDeviceSecret();
    const useKioskAuth = kaDeviceId && deviceSecret;
    if (useKioskAuth) {
      params.set('device_id', kaDeviceId);
      params.set('device_secret', deviceSecret);
    }

    const endpoint = useKioskAuth
      ? `/api/kiosk/time-entries?${params.toString()}`
      : `/api/time-entries?${params.toString()}`;

    const entries = await fetchJSON(endpoint);

    // Fetch any open punches for this kiosk so they show as "in progress" rows
    let openPunches = [];
    if (kaKiosk && kaKiosk.id) {
      try {
        openPunches = await fetchJSON(`/api/kiosks/${kaKiosk.id}/open-punches`);
      } catch (err) {
        console.warn('Could not load open punches for kiosk', err);
      }
    }

    const hideResolved = hideResolvedEl && hideResolvedEl.checked;
    const filtered = (entries || []).filter(t => {
      if (!hideResolved) return true;
      const status = String(t.resolved_status || '').toLowerCase();
      const isResolved = t.resolved || (status && status !== 'open');
      return !isResolved;
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

    // Merge in open punches for this kiosk as "in progress" rows
    const openEntries = (openPunches || []).filter(p => {
      const d = p.clock_in_ts ? p.clock_in_ts.slice(0, 10) : '';
      if (!d || d < start || d > end) return false;
      if (employeeId && String(p.employee_id) !== String(employeeId)) return false;
      if (projectId && String(p.project_id) !== String(projectId)) return false;
      return true;
    }).map(p => {
      const startIso = p.clock_in_ts;
      const startDt = startIso ? new Date(startIso) : null;
      const hours = startDt ? Math.max(0, (Date.now() - startDt.getTime()) / 3600000) : 0;
      return {
        _open: true,
        id: `open-${p.id}`,
        employee_id: p.employee_id,
        employee_name: p.employee_name || '(Unknown)',
        project_id: p.project_id,
        project_name: p.project_name || '(No project)',
        start_date: startIso ? startIso.slice(0, 10) : '',
        end_date: startIso ? startIso.slice(0, 10) : '',
        start_time: startDt
          ? startDt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '—',
        end_time: 'In progress',
        hours,
        total_pay: null,
        paid: false,
        verified: false,
        resolved: false,
        has_geo_violation: false,
        has_auto_clock_out: false
      };
    });

    const combinedMap = new Map();
    filtered.forEach(e => {
      const key = e.id ? `srv-${e.id}` : JSON.stringify(e);
      combinedMap.set(key, e);
    });
    offlineEntries.forEach(e => {
      const key = e.client_id ? `off-${e.client_id}` : e.id;
      if (!combinedMap.has(key)) combinedMap.set(key, e);
    });

    openEntries.forEach(e => {
      const key = e.id ? `open-${e.id}` : JSON.stringify(e);
      if (!combinedMap.has(key)) combinedMap.set(key, e);
    });

    const combined = Array.from(combinedMap.values());
    const fragment = document.createDocumentFragment();
    const seenKeys = new Set();

    if (!combined.length) {
      const emptyRow = document.createElement('tr');
      emptyRow.dataset.kaPlaceholder = '1';
      emptyRow.innerHTML =
        `<td colspan="${colCount || 8}" class="ka-muted">(no time entries for this date range)</td>`;
      fragment.appendChild(emptyRow);
      tbody.replaceChildren(fragment);
      tbody.dataset.hasContent = '1';
      return;
    }

    combined.forEach((t, idx) => {
      const isOffline = !!t._offline;
      const isOpen = !!t._open;
      const tr = document.createElement('tr');
      tr.dataset.entryId = t.id;
      tr.dataset.verified = t.verified ? '1' : '0';
      tr.dataset.updatedAt = t.updated_at || '';
      tr._entry = t; // stash full row for actions
      const rowKey = tr.dataset.entryId ? String(tr.dataset.entryId) : `row-${idx}`;
      seenKeys.add(rowKey);

      const emp = t.employee_name || '(Unknown)';
      const proj = t.project_name || '(No project)';
      const dateLabel = t.start_date || t.end_date || '';
      const startLabel = t.start_time || '—';
      const endLabel = t.end_time || '—';
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
      let payVal = t.total_pay != null ? Number(t.total_pay) : null;
      if (payVal == null && rawRate != null && !Number.isNaN(Number(hours))) {
        payVal = rawRate * Number(hours);
      }
      const pay = payVal != null && !Number.isNaN(payVal) ? payVal.toFixed(2) : (isOpen ? '—' : '0.00');
      const detailMeta = kaEntryDetailMeta(t);
      const payDetail = payEnabled
        ? `
        <div class="ka-pay-inline">
          <div class="ka-pay-col ka-pay-left">
            <span class="ka-pay-label">Rate:</span>
            <span class="ka-pay-value"><span class="ka-rate-chip" data-rate-entry="${t.id}">${rateDisplay || '••••'}</span></span>
          </div>
          <div class="ka-pay-col ka-pay-right">
            <span class="ka-pay-label">Total Pay:</span>
            <span class="ka-pay-value">$${pay}</span>
          </div>
        </div>
      `
        : '';
      const punchCount = Number(t.punch_count || 0);
      const punchHours = Number(t.punch_hours || 0);
      const entryHours = Number(t.hours || 0);
      const entryMismatch =
        punchCount === 0 ||
        (Number.isFinite(entryHours) && Math.abs(punchHours - entryHours) >= 0.1);
      const flagged = !!entryMismatch;
      const resolvedStatus = String(t.resolved_status || '').toLowerCase();
      const isResolved = !!t.resolved || (resolvedStatus && resolvedStatus !== 'open');
      const isRejected = resolvedStatus === 'rejected';
      const isModified = resolvedStatus === 'modified';
      const isApproved = resolvedStatus === 'approved' || isModified;
      const statusLabel = (() => {
        if (isOpen) return '<span class="ka-tag gray">In progress</span>';
        if (isRejected) return '<span class="ka-tag orange">Rejected</span>';
        if (isModified) return '<span class="ka-tag green">Modified</span>';
        if (isApproved && flagged) return '<span class="ka-tag green">Approved</span>';
        if (isApproved && !flagged) return '<span class="ka-tag green">Approved as-is</span>';
        if (flagged) return '<span class="ka-tag orange">Pending review</span>';
        return '<span class="ka-tag gray">Approved as-is</span>';
      })();
      const approvedBy = kaReviewerName(
        t.resolved_by || t.approved_by_name || t.approved_by_employee_id
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
      const actionsCell = (() => {
        const showReviewActions = showActions && (flagged || isResolved);
        // Always show status; add a small menu trigger when allowed and not offline/open.
        if (isOffline || isOpen || !showReviewActions) return statusLabel;
        return `
        <div class="ka-status-actions">
          ${statusLabel}
          <div class="ka-time-row-actions dropdown">
            <button class="btn secondary btn-icon ka-actions-toggle ${actionClass || (!flagged ? 'ka-muted' : '')}" data-ka-time-menu aria-label="More actions">&#8942;</button>
            <div class="ka-actions-menu hidden">
              <button class="ka-actions-item" data-ka-time-action="approve">Approve</button>
              <button class="ka-actions-item" data-ka-time-action="modify">Modify</button>
              <button class="ka-actions-item" data-ka-time-action="reject">Reject</button>
            </div>
          </div>
        </div>
      `;
      })();

      let rowHtml = `
      <td>${emp}</td>
      <td>${proj}</td>
      <td>${dateLabel}</td>
      <td>${startLabel}</td>
      <td>${endLabel}</td>
      <td class="ka-right">${hours}</td>
    `;
      rowHtml += `
      <td class="ka-actions-cell ka-actions-col">${actionsCell}</td>
      <td class="ka-approve-col">${approvedBy}</td>
    `;

      tr.innerHTML = rowHtml;
      fragment.appendChild(tr);

      // Detail row (hidden until the main row is clicked)
      const detailTr = document.createElement('tr');
      detailTr.className = 'ka-time-detail-row hidden';
      detailTr.innerHTML = `
        <td colspan="${colCount}" class="ka-time-detail">
          <div class="ka-time-detail-grid">
            ${detailMeta}
            ${payDetail}
          </div>
        </td>
      `;
      if (payEnabled && kaOpenDetailEntries.has(rowKey)) {
        detailTr.classList.remove('hidden');
      }
      fragment.appendChild(detailTr);

      if (payEnabled) {
        detailTr.querySelectorAll('[data-rate-entry]').forEach(cell => {
          cell.style.cursor = 'pointer';
          cell.addEventListener('click', () => {
            if (tr._entry && tr._entry._open) return;
            const id = Number(cell.getAttribute('data-rate-entry'));
            if (Number.isNaN(id)) return;
            kaOpenRateModal(id);
          });
        });
      }
    });

    tbody.replaceChildren(fragment);
    tbody.dataset.hasContent = '1';

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
      const key = row.dataset.entryId ? String(row.dataset.entryId) : `row-${idx}`;
      row.addEventListener('click', (e) => {
        if (e.target.closest('.ka-actions-toggle') || e.target.closest('.ka-actions-menu')) return;
        if (!payEnabled) return;
        const detail = tbody.querySelectorAll('.ka-time-detail-row')[idx];
        if (detail) detail.classList.toggle('hidden');
        if (detail) {
          if (detail.classList.contains('hidden')) {
            kaOpenDetailEntries.delete(key);
          } else {
            kaOpenDetailEntries.add(key);
          }
        }
      });
    });
    // Close any open menus when clicking outside table
    if (!tbody._kaOutsideClickBound) {
      document.addEventListener('click', (e) => {
        if (!tbody.contains(e.target)) {
          tbody.querySelectorAll('.ka-actions-menu').forEach(m => m.classList.add('hidden'));
        }
      });
      tbody._kaOutsideClickBound = true;
    }

    // Prune any stale open-detail keys
    Array.from(kaOpenDetailEntries).forEach(k => {
      if (!seenKeys.has(k)) kaOpenDetailEntries.delete(k);
    });
  } catch (err) {
    console.error('Error loading time entries:', err);
    if (!hasContent) {
      tbody.innerHTML =
        `<tr data-ka-placeholder="1"><td colspan="${colCount}" class="ka-muted">(error loading time entries)</td></tr>`;
      tbody.dataset.hasContent = '1';
    }
    if (status) {
      status.textContent = 'Error loading time entries.';
      status.className = 'ka-status ka-status-error';
    }
  } finally {
    delete tbody.dataset.refreshing;
  }
}
    if (metaEl) {
      metaEl.textContent = '';
    }
