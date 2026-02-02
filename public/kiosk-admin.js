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
const kaSessionClosePrompted = new Set();
const kaSessionOpenCountCache = new Map();
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
let kaItemsStatusFilter = 'all';
let kaItemsActiveTab = 'items';
let kaEmployeeFormVisible = false;
let kaEmployeeSearchQuery = '';
let kaEmployeeStatusFilter = 'all';
const kaItemAutoSaveTimers = new Map();
const kaSavedItemStatuses = new Map();
const kaSavedItemNotes = new Map();
const kaExpandedItems = new Set();
const kaAutoExpandedItems = new Set();
const kaRecentlySavedItems = new Map(); // itemId -> timeout id
const KA_ITEM_SAVE_FLASH_MS = 2500;
const KA_ITEMS_AUTO_SAVE_ENABLED = false; // keep items from autosaving/reordering mid-edit
let kaTimeRangeMode = 'today';
let kaTimeReportHasRun = false;
let kaTimeActionEntry = null;
let kaTimeActionMode = null;
let kaTimePendingGlobalCount = null;
let kaTimePendingGlobalLastFetched = 0;
let kaTimePendingGlobalInFlight = false;
const kaOpenDetailEntries = new Set();
let kaAccessPerms = {
  see_shipments: true,
  modify_time: true,
  view_time_reports: true,
  view_all_timesheets: false,
  assign_timesheets: false,
  view_payroll: true,
  modify_pay_rates: false
};
let kaShipments = [];
let kaShowPayUI = false;
let kaShowApprovalsUI = true;
let kaShowHideResolved = true;
let kaRatesUnlockedAll = false;
const kaUnlockedRates = new Set();
const KA_DEVICE_SECRET_KEY = 'avian_kiosk_device_secret_v1';
let kaNewSessionVisible = false;
let kaFirstActiveSetShown = false;
let kaClockInPhotoRequired = false;
let kaTimesheetWorkersSheetState = { open: false, dragging: false, startY: 0, currentY: 0 };
let kaCustomerSheetState = { open: false, dragging: false, startY: 0, currentY: 0 };
let kaEmployeesSheetState = {
  open: false,
  dragging: false,
  startY: 0,
  currentY: 0,
  contentParent: null,
  contentNext: null,
  restoreHidden: false,
  addBtnParent: null,
  addBtnNext: null,
  addBtnWasHidden: false
};
let kaAccountSheetState = {
  open: false,
  dragging: false,
  startY: 0,
  currentY: 0,
  contentParent: null,
  contentNext: null,
  restoreHidden: false
};
let kaSettingsSheetState = {
  open: false,
  dragging: false,
  startY: 0,
  currentY: 0,
  contentParent: null,
  contentNext: null,
  restoreHidden: false
};
let kaEmployeeSheetState = {
  open: false,
  dragging: false,
  startY: 0,
  currentY: 0,
  employeeId: null,
  reactivatePending: false,
  reactivateSnapshot: null,
  history: []
};
let kaEmployeePinSheetState = {
  open: false,
  dragging: false,
  startY: 0,
  currentY: 0,
  employeeId: null
};
let kaTimeDetailSheetState = {
  open: false,
  dragging: false,
  startY: 0,
  currentY: 0,
  entryId: null,
  entry: null
};
let kaTimeReportSheetState = {
  open: false,
  dragging: false,
  startY: 0,
  currentY: 0
};
let kaTimeReviewSheetState = {
  open: false,
  dragging: false,
  startY: 0,
  currentY: 0,
  entries: [],
  pendingCount: 0,
  params: null,
  needsRefresh: false
};
let kaTimeCalendarState = {
  year: null,
  month: null,
  selectedDate: null
};
let kaTimeCalendarSheetState = {
  open: false,
  dragging: false,
  startY: 0,
  currentY: 0,
  date: null,
  entries: []
};
let kaTimeEntriesCache = null;
let kaDocViewObjectUrl = null;
let kaTimesheetAssignees = [];
let kaTimesheetAssigneesLoaded = false;
let kaTimesheetAssigneesLoading = false;
let kaDocViewCurrentUrl = null;
let kaDebugTapEnabled = false;

const KA_VIEWS = ['timesheets', 'workers', 'employees', 'shipments', 'time', 'account', 'settings'];
const KA_PENDING_PIN_KEY = 'avian_kiosk_pending_pins_v1';
const KA_OFFLINE_QUEUE_KEY = 'avian_kiosk_offline_punches_v1';
const KA_VERIFY_QUEUE_KEY = 'avian_kiosk_verify_queue_v1';
const KA_SHIPMENT_NOTES_QUEUE_KEY = 'avian_kiosk_shipment_notes_queue_v1';
const KA_TIME_REVIEW_QUEUE_KEY = 'avian_kiosk_time_review_queue_v1';
const KA_EMPLOYEE_UPDATES_QUEUE_KEY = 'avian_kiosk_employee_updates_queue_v1';
const KA_EMPLOYEE_DOCS_DB = 'avian_kiosk_employee_docs_v1';
const KA_EMPLOYEE_DOCS_STORE = 'uploads';
const KA_EMPLOYEE_DOCS_QUEUE_FLAG = 'avian_kiosk_employee_docs_pending_v1';
const KA_SHIPMENTS_CACHE_KEY = 'avian_kiosk_shipments_cache_v1';
const KA_DOC_CACHE_NAME = 'avian_doc_cache_v1';
const KA_ORG_TIMEZONE_KEY = 'avian_kiosk_org_timezone_v1';
const KA_DEFAULT_TIMEZONE = 'America/Puerto_Rico';
const KA_LANGUAGE_LABELS = {
  en: 'English',
  es: 'Spanish',
  ht: 'Haitian Creole'
};
const KA_SHIPMENT_STATUSES = [
  'Pre-Order',
  'Ordered',
  'In Transit to Forwarder',
  'Arrived at Forwarder',
  'Sailed',
  'Arrived at Port',
  'Awaiting Clearance',
  'Cleared - Ready for Pickup',
  'Picked Up',
  'Archived'
];
const KA_TIME_EVENTS = [
  { value: 'TIME_EXCEPTION_OPEN', label: 'Exceptions opened' },
  { value: 'TIME_EXCEPTION_REVIEWED', label: 'Exceptions reviewed' },
  { value: 'TIME_EXCEPTION_RESOLVED', label: 'Exceptions resolved' },
  { value: 'TIME_ENTRY_MANUAL_CREATED', label: 'Manual entries created' },
  { value: 'TIME_ENTRY_MANUAL_EDITED', label: 'Manual entries edited' },
  { value: 'TIME_SHIFT_LONG', label: 'Long shifts (12+ hours)' },
  { value: 'TIME_SHIFT_MULTI_DAY', label: 'Multi-day shifts (24+ hours)' },
  { value: 'TIME_PUNCH_OPEN_LONG', label: 'Open punches (12+ hours)' },
  { value: 'TIME_PUNCH_OPEN_MULTI_DAY', label: 'Open punches (24+ hours)' },
  { value: 'TIME_WEEKLY_THRESHOLD_NEAR', label: 'Weekly hours near limit' },
  { value: 'TIME_WEEKLY_THRESHOLD_EXCEEDED', label: 'Weekly hours exceeded' }
];

const KA_PAYROLL_EVENTS = [
  { value: 'PAYROLL_RUN_DUE', label: 'Payroll due' },
  { value: 'PAYROLL_RUN_STARTED', label: 'Payroll started' },
  { value: 'PAYROLL_RUN_SUCCESS', label: 'Payroll success' },
  { value: 'PAYROLL_RUN_PARTIAL', label: 'Payroll partial' },
  { value: 'PAYROLL_RUN_FAILURE', label: 'Payroll failure' },
  { value: 'PAYROLL_FATAL_ERROR', label: 'Payroll fatal error' },
  { value: 'PAYROLL_QBO_ERROR', label: 'QuickBooks error' },
  { value: 'PAYROLL_UNPAY', label: 'Payroll unpaid' }
];

const KA_SHIPMENT_NOTIFY_DEFAULT = {
  enabled: false,
  statuses: [],
  project_ids: [],
  shipment_ids: [],
  notify_time: '19:00',
  remind_every_days: 1
};

const KA_NOTIFICATION_PREF_DEFAULT = {
  email_enabled: true,
  push_enabled: true,
  shipment_filters: {
    enabled: true,
    statuses: [],
    project_ids: []
  },
  payroll_filters: {
    enabled: true,
    event_types: [
      'PAYROLL_RUN_DUE',
      'PAYROLL_RUN_FAILURE',
      'PAYROLL_QBO_ERROR',
      'PAYROLL_FATAL_ERROR'
    ]
  },
  time_filters: {
    enabled: true,
    event_types: ['TIME_EXCEPTION_OPEN']
  },
  remind_time: '',
  remind_every_days: 1,
  clockout_enabled: false,
  clockout_time: '19:00'
};

let kaShipmentNotifyPref = { ...KA_SHIPMENT_NOTIFY_DEFAULT };
let kaNotificationPrefs = { ...KA_NOTIFICATION_PREF_DEFAULT };
let kaPushPublicKey = '';
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
  const docs = kaHasEmployeeDocsQueueFlag() ? 1 : 0;
  const updates = kaLoadEmployeeUpdatesQueue().length;
  return punches + pins + verify + notes + reviews + docs + updates;
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
  const openCount = Number(
    session &&
      (session.session_open_count ??
        session.device_open_count ??
        session.open_count ??
        0)
  );
  const entryCount = Number(
    session &&
      (session.session_entry_count ??
        session.device_entry_count ??
        session.entry_count ??
        0)
  );
  return { openCount, entryCount };
}

function kaNotifySessionDeleteBlocked(message, row = null) {
  const msg = message || 'Cannot delete this timesheet.';
  if (row) kaShowSessionDelete(row);
  // Surface a single clear dialog so it is impossible to miss
  kaShowConfirmDialog(msg, {
    okLabel: 'OK',
    cancelLabel: null,
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
    url.startsWith('/api/kiosk') ||
    url.startsWith('/api/kiosks') ||
    url.startsWith('/api/kiosk-sessions');
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
    <div class="ka-modal ka-confirm-modal" role="dialog" aria-modal="true">
      <h3 id="ka-confirm-title">Confirm</h3>
      <p id="ka-confirm-message"></p>
      <div class="ka-modal-actions ka-confirm-actions">
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

  const hideCancel = cancelLabel === null;
  msgEl.textContent = message || '';
  titleEl.textContent = title || 'Confirm';
  yesBtn.textContent = okLabel || 'Yes';
  if (hideCancel) {
    cancelBtn.hidden = true;
    cancelBtn.textContent = '';
  } else {
    cancelBtn.hidden = false;
    cancelBtn.textContent = cancelLabel || 'Cancel';
  }
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
    cancelBtn.onclick = hideCancel ? null : () => cleanup(false);
    backdrop.onclick = (e) => {
      if (e.target === backdrop && !hideCancel) cleanup(false);
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

function kaEnsureTimesheetActionModal() {
  let backdrop = document.getElementById('ka-timesheet-action-backdrop');
  if (backdrop) return backdrop;

  backdrop = document.createElement('div');
  backdrop.id = 'ka-timesheet-action-backdrop';
  backdrop.className = 'ka-modal-backdrop hidden';
  backdrop.innerHTML = `
    <div class="ka-modal ka-timesheet-action-modal" role="dialog" aria-modal="true" aria-labelledby="ka-timesheet-action-title">
      <div class="ka-modal-header">
        <h3 id="ka-timesheet-action-title">Timesheet options</h3>
        <button type="button" class="ka-modal-close" id="ka-timesheet-action-close" aria-label="Close">×</button>
      </div>
      <p id="ka-timesheet-action-message"></p>
      <div class="ka-modal-actions">
        <button type="button" class="btn danger btn-sm" id="ka-timesheet-action-delete">Delete</button>
        <button type="button" class="btn secondary btn-sm" id="ka-timesheet-action-close-sheet">Close timesheet</button>
        <button type="button" class="btn secondary btn-sm" id="ka-timesheet-action-assign-btn">Assign to admin</button>
        <button type="button" class="btn primary btn-sm" id="ka-timesheet-action-set">Set active</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  return backdrop;
}

function kaEnsureTimesheetAssignModal() {
  let backdrop = document.getElementById('ka-timesheet-assign-backdrop');
  if (backdrop) return backdrop;

  backdrop = document.createElement('div');
  backdrop.id = 'ka-timesheet-assign-backdrop';
  backdrop.className = 'ka-modal-backdrop hidden';
  backdrop.innerHTML = `
    <div class="ka-modal ka-timesheet-assign-modal" role="dialog" aria-modal="true" aria-labelledby="ka-timesheet-assign-title">
      <div class="ka-modal-header">
        <h3 id="ka-timesheet-assign-title">Assign to admin</h3>
        <button type="button" class="ka-modal-close" id="ka-timesheet-assign-close" aria-label="Close">×</button>
      </div>
      <p id="ka-timesheet-assign-message"></p>
      <div class="ka-timesheet-assign-field">
        <label class="ka-timesheet-assign-label" for="ka-timesheet-assign-select">Assign to</label>
        <select id="ka-timesheet-assign-select" class="ka-timesheet-assign-select"></select>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  return backdrop;
}

function kaEnsureTimesheetReplaceModal() {
  let backdrop = document.getElementById('ka-timesheet-replace-backdrop');
  if (backdrop) return backdrop;

  backdrop = document.createElement('div');
  backdrop.id = 'ka-timesheet-replace-backdrop';
  backdrop.className = 'ka-modal-backdrop hidden';
  backdrop.innerHTML = `
    <div class="ka-modal ka-timesheet-assign-modal" role="dialog" aria-modal="true" aria-labelledby="ka-timesheet-replace-title">
      <div class="ka-modal-header">
        <h3 id="ka-timesheet-replace-title">Set a different active timesheet</h3>
        <button type="button" class="ka-modal-close" id="ka-timesheet-replace-close" aria-label="Close">×</button>
      </div>
      <p id="ka-timesheet-replace-message"></p>
      <div class="ka-modal-actions">
        <button type="button" class="btn secondary btn-sm" id="ka-timesheet-replace-cancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  return backdrop;
}

function kaShowActiveReplacementModal({ session, options }) {
  const backdrop = kaEnsureTimesheetReplaceModal();
  const titleEl = document.getElementById('ka-timesheet-replace-title');
  const msgEl = document.getElementById('ka-timesheet-replace-message');
  const closeBtn = document.getElementById('ka-timesheet-replace-close');
  const cancelBtn = document.getElementById('ka-timesheet-replace-cancel');
  if (!backdrop || !titleEl || !msgEl || !closeBtn || !cancelBtn) {
    return Promise.resolve(null);
  }

  titleEl.textContent = 'Cannot delete active timesheet';
  msgEl.textContent =
    'Set a new active timesheet before deleting this one.';

  backdrop.classList.remove('hidden');

  return new Promise(resolve => {
    const cleanup = (result) => {
      backdrop.classList.add('hidden');
      closeBtn.onclick = null;
      cancelBtn.onclick = null;
      backdrop.onclick = null;
      resolve(result);
    };

    closeBtn.onclick = () => cleanup(null);
    cancelBtn.onclick = () => cleanup(null);
    backdrop.onclick = (e) => {
      if (e.target === backdrop) cleanup(null);
    };
  });
}

function kaSetPinToggleState(button, isVisible) {
  if (!button) return;
  button.dataset.state = isVisible ? 'visible' : 'hidden';
  button.setAttribute('aria-pressed', isVisible ? 'true' : 'false');
  button.setAttribute('aria-label', isVisible ? 'Hide PIN' : 'Show PIN');
}

function kaDebugTapFlash(target, label) {
  if (!kaDebugTapEnabled) return;
  const host = document.body || document.documentElement;
  if (!host) return;
  const bubble = document.createElement('div');
  bubble.className = 'ka-tap-debug';
  bubble.textContent = label || 'tap';
  host.appendChild(bubble);

  const cleanup = () => {
    if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
  };

  let rect = null;
  if (target && target.getBoundingClientRect) {
    rect = target.getBoundingClientRect();
  }
  if (rect) {
    bubble.style.left = `${Math.min(window.innerWidth - 140, Math.max(12, rect.left + rect.width / 2 - 60))}px`;
    bubble.style.top = `${Math.max(12, rect.top - 12)}px`;
  } else {
    bubble.style.left = '12px';
    bubble.style.top = '12px';
  }

  window.setTimeout(() => {
    bubble.classList.add('is-fade');
    window.setTimeout(cleanup, 400);
  }, 700);
}

function kaEnsureTapDebugPanel() {
  let panel = document.getElementById('ka-tap-debug-panel');
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = 'ka-tap-debug-panel';
  panel.className = 'ka-tap-debug-panel';
  panel.innerHTML = '<div class="ka-tap-debug-title">Tap Debug</div>';
  document.body.appendChild(panel);
  return panel;
}

function kaDebugTapLog(message) {
  if (!kaDebugTapEnabled) return;
  const panel = kaEnsureTapDebugPanel();
  if (!panel) return;
  const line = document.createElement('div');
  line.className = 'ka-tap-debug-line';
  const ts = new Date();
  const stamp = ts.toLocaleTimeString([], { minute: '2-digit', second: '2-digit' });
  line.textContent = `[${stamp}] ${message}`;
  panel.appendChild(line);
  const lines = panel.querySelectorAll('.ka-tap-debug-line');
  if (lines.length > 8) {
    lines[0].remove();
  }
}

function kaEnsureAdminPinModal() {
  let backdrop = document.getElementById('ka-admin-pin-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'ka-admin-pin-backdrop';
    backdrop.className = 'ka-modal-backdrop ka-pin-backdrop hidden';
    backdrop.innerHTML = `
      <div class="ka-pin-modal" role="dialog" aria-modal="true" aria-labelledby="ka-admin-pin-title">
        <div class="ka-pin-header">
          <div>
            <div class="ka-pin-title" id="ka-admin-pin-title">Admin Access</div>
            <div class="ka-pin-sub" id="ka-admin-pin-sub">Enter your admin PIN.</div>
          </div>
          <button type="button" class="ka-pin-close" id="ka-admin-pin-close" aria-label="Close">×</button>
        </div>
        <div class="ka-pin-body">
          <div class="ka-pin-input-wrap">
            <input
              id="ka-admin-pin-input"
              class="ka-pin-input"
              type="password"
              inputmode="numeric"
              maxlength="4"
              placeholder="PIN"
            />
            <button type="button" class="ka-pin-toggle" id="ka-admin-pin-toggle" aria-label="Show PIN" data-state="hidden">
              <svg class="ka-pin-eye-icon ka-pin-eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z"></path>
                <circle cx="12" cy="12" r="3.2"></circle>
              </svg>
              <svg class="ka-pin-eye-icon ka-pin-eye-closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z"></path>
                <circle cx="12" cy="12" r="3.2"></circle>
                <path d="M4 4l16 16"></path>
              </svg>
            </button>
          </div>
          <div id="ka-admin-pin-status" class="ka-pin-status"></div>
          <div class="ka-pin-actions">
            <button type="button" class="ka-pin-btn ka-pin-btn-outline" id="ka-admin-pin-cancel">Cancel</button>
            <button type="button" class="ka-pin-btn" id="ka-admin-pin-continue">Continue</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
  }

  return {
    backdrop,
    modal: backdrop.querySelector('.ka-pin-modal'),
    title: document.getElementById('ka-admin-pin-title'),
    sub: document.getElementById('ka-admin-pin-sub'),
    input: document.getElementById('ka-admin-pin-input'),
    toggle: document.getElementById('ka-admin-pin-toggle'),
    status: document.getElementById('ka-admin-pin-status'),
    cancel: document.getElementById('ka-admin-pin-cancel'),
    confirm: document.getElementById('ka-admin-pin-continue'),
    close: document.getElementById('ka-admin-pin-close')
  };
}

function kaPromptAdminPin({ title, message, confirmLabel = 'Continue', validatePin } = {}) {
  const els = kaEnsureAdminPinModal();
  if (!els || !els.backdrop) {
    return Promise.resolve(null);
  }

  if (els.title) els.title.textContent = title || 'Admin Access';
  if (els.sub) els.sub.textContent = message || 'Enter your admin PIN.';
  if (els.confirm) els.confirm.textContent = confirmLabel || 'Continue';
  if (els.status) {
    els.status.textContent = '';
    els.status.classList.remove('is-error');
  }

  if (els.input) {
    els.input.value = '';
    els.input.type = 'password';
    kaDisableAutofill(els.input);
  }
  kaSetPinToggleState(els.toggle, false);

  els.backdrop.classList.remove('hidden');
  kaSyncModalOpenState();

  return new Promise(resolve => {
    const controls = [els.input, els.confirm].filter(Boolean);

    const cleanup = (result) => {
      els.backdrop.classList.add('hidden');
      kaSyncModalOpenState();
      if (els.confirm) els.confirm.onclick = null;
      if (els.cancel) els.cancel.onclick = null;
      if (els.close) els.close.onclick = null;
      if (els.toggle) els.toggle.onclick = null;
      if (els.input) els.input.onkeydown = null;
      els.backdrop.onclick = null;
      resolve(result);
    };

    const showError = (msg) => {
      if (!els.status) return;
      els.status.textContent = msg;
      els.status.classList.add('is-error');
    };

    const handleSubmit = async () => {
      if (kaEnforcePinThrottle('admin', controls)) {
        showError('Please wait a moment and try again.');
        return;
      }
      const pin = (els.input?.value || '').trim();
      if (!/^[0-9]{4}$/.test(pin)) {
        kaRegisterPinFailure('admin', controls);
        showError('PIN must be exactly 4 digits.');
        return;
      }
      if (typeof validatePin === 'function') {
        const error = await validatePin(pin);
        if (error) {
          kaRegisterPinFailure('admin', controls);
          showError(error);
          return;
        }
      }
      kaResetPinFailures('admin');
      cleanup(pin);
    };

    if (els.confirm) els.confirm.onclick = handleSubmit;
    if (els.cancel) els.cancel.onclick = () => cleanup(null);
    if (els.close) els.close.onclick = () => cleanup(null);
    if (els.toggle && els.input) {
      els.toggle.onclick = () => {
        const isVisible = els.input.type === 'password';
        els.input.type = isVisible ? 'text' : 'password';
        kaSetPinToggleState(els.toggle, isVisible);
      };
    }
    if (els.input) {
      els.input.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleSubmit();
        }
      };
      setTimeout(() => {
        try {
          els.input.focus();
        } catch {}
      }, 0);
    }
    els.backdrop.onclick = (e) => {
      if (e.target === els.backdrop) cleanup(null);
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
    const tasks = [kaLoadLiveWorkers()];
    if (kaCurrentView === 'time' && kaTimeReportHasRun) {
      tasks.push(kaLoadTimeEntries());
    }
    await Promise.all(tasks);
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

function kaLoadEmployeeUpdatesQueue() {
  const list = kaStoreGet(KA_EMPLOYEE_UPDATES_QUEUE_KEY, []);
  return Array.isArray(list) ? list : [];
}

function kaSaveEmployeeUpdatesQueue(list) {
  kaStoreSet(KA_EMPLOYEE_UPDATES_QUEUE_KEY, list || []);
  kaUpdateOfflineIndicator();
}

function kaQueueEmployeeUpdates(entries = []) {
  if (!Array.isArray(entries) || !entries.length) return;
  const list = kaLoadEmployeeUpdatesQueue();
  entries.forEach(entry => {
    if (!entry || !entry.employee_id || !entry.action) return;
    list.push({
      ...entry,
      queued_at: entry.queued_at || new Date().toISOString()
    });
  });
  kaSaveEmployeeUpdatesQueue(list);
}

async function kaDispatchEmployeeUpdate(entry) {
  const id = entry.employee_id;
  const auth = entry.auth || {};
  const payload = entry.payload || {};
  switch (entry.action) {
    case 'name':
      return fetchJSON(`/api/employees/${id}/name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: payload.name, ...auth })
      });
    case 'phone':
      return fetchJSON(`/api/employees/${id}/phone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: payload.phone || null, ...auth })
      });
    case 'language':
      return fetchJSON(`/api/employees/${id}/language`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: payload.language, ...auth })
      });
    case 'name_on_checks':
      return fetchJSON(`/api/employees/${id}/name-on-checks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name_on_checks: payload.name_on_checks || null, ...auth })
      });
    case 'employment_dates':
      return fetchJSON(`/api/employees/${id}/employment-dates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_date: payload.start_date || null,
          termination_date: payload.termination_date || null,
          ...auth
        })
      });
    case 'reactivate':
      return fetchJSON(`/api/employees/${id}/reactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_date: payload.start_date, ...auth })
      });
    case 'rate':
      return fetchJSON(`/api/kiosk/rates/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rate: payload.rate })
      });
    default:
      return null;
  }
}

async function kaSyncEmployeeUpdatesQueue() {
  if (!navigator.onLine) return;
  const queue = kaLoadEmployeeUpdatesQueue();
  if (!queue.length) return;

  const remaining = [];
  for (const entry of queue) {
    if (!entry || !entry.employee_id || !entry.action) continue;
    try {
      await kaDispatchEmployeeUpdate(entry);
    } catch (err) {
      const msg = (err && err.message) ? err.message : '';
      const authLike = /auth|login|credential|session/i.test(msg);
      const netLike = /network|failed to fetch|offline/i.test(msg);
      remaining.push(entry);
      if (authLike || netLike) {
        // Stop processing; wait for auth/connection recovery.
        break;
      }
    }
  }

  if (remaining.length) {
    kaSaveEmployeeUpdatesQueue(remaining);
  } else {
    kaSaveEmployeeUpdatesQueue([]);
  }
}

function kaEmployeeDocsDbAvailable() {
  return typeof indexedDB !== 'undefined';
}

function kaSetEmployeeDocsQueueFlag(hasPending) {
  kaStoreSet(KA_EMPLOYEE_DOCS_QUEUE_FLAG, hasPending ? 1 : 0);
  kaUpdateOfflineIndicator();
}

function kaHasEmployeeDocsQueueFlag() {
  return !!kaStoreGet(KA_EMPLOYEE_DOCS_QUEUE_FLAG, 0);
}

function kaOpenEmployeeDocsDb() {
  if (!kaEmployeeDocsDbAvailable()) {
    return Promise.reject(new Error('IndexedDB unavailable'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KA_EMPLOYEE_DOCS_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KA_EMPLOYEE_DOCS_STORE)) {
        const store = db.createObjectStore(KA_EMPLOYEE_DOCS_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('queued_at', 'queued_at');
        store.createIndex('employee_id', 'employee_id');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open employee docs DB'));
  });
}

async function kaEmployeeDocsGetAll() {
  const db = await kaOpenEmployeeDocsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KA_EMPLOYEE_DOCS_STORE, 'readonly');
    const store = tx.objectStore(KA_EMPLOYEE_DOCS_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error('Failed to read employee docs queue'));
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  });
}

async function kaEmployeeDocsAdd(entry) {
  const db = await kaOpenEmployeeDocsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KA_EMPLOYEE_DOCS_STORE, 'readwrite');
    const store = tx.objectStore(KA_EMPLOYEE_DOCS_STORE);
    const req = store.add(entry);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to queue employee document'));
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  });
}

async function kaEmployeeDocsDelete(id) {
  const db = await kaOpenEmployeeDocsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KA_EMPLOYEE_DOCS_STORE, 'readwrite');
    const store = tx.objectStore(KA_EMPLOYEE_DOCS_STORE);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error('Failed to delete queued employee doc'));
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  });
}

async function kaQueueEmployeeDocUpload({ employeeId, type, label, file, auth }) {
  if (!employeeId || !type || !file) {
    throw new Error('Missing required document data.');
  }
  const entry = {
    employee_id: Number(employeeId),
    doc_type: type,
    doc_label: label || '',
    filename: file.name || 'document',
    mime: file.type || '',
    size: file.size || 0,
    blob: file,
    auth: auth || {},
    queued_at: new Date().toISOString()
  };
  await kaEmployeeDocsAdd(entry);
  kaSetEmployeeDocsQueueFlag(true);
}

async function kaSyncEmployeeDocUploads() {
  if (!navigator.onLine || !kaEmployeeDocsDbAvailable()) return;
  let queued = [];
  try {
    queued = await kaEmployeeDocsGetAll();
  } catch (err) {
    console.warn('Unable to read employee doc queue', err);
    return;
  }
  if (!queued.length) {
    kaSetEmployeeDocsQueueFlag(false);
    return;
  }

  let refreshedEmployeeId = null;
  for (const entry of queued) {
    if (!entry || !entry.employee_id || !entry.blob) continue;
    const type = entry.doc_type || '';
    const auth = entry.auth || {};
    const form = new FormData();
    form.append('doc_type', type);
    if (entry.doc_label) form.append('doc_label', entry.doc_label);
    if (auth.admin_id) form.append('admin_id', String(auth.admin_id));
    if (auth.device_id) form.append('device_id', String(auth.device_id));
    if (auth.device_secret) form.append('device_secret', String(auth.device_secret));

    let endpoint = `/api/kiosk/admin/employees/${entry.employee_id}/documents`;
    if (type === 'Photo') {
      endpoint = `/api/kiosk/admin/employees/${entry.employee_id}/photo`;
      form.append('employee_photo', entry.blob, entry.filename);
    } else if (type === 'ID') {
      endpoint = `/api/kiosk/admin/employees/${entry.employee_id}/id-document`;
      form.append('id_document', entry.blob, entry.filename);
    } else {
      form.append('documents', entry.blob, entry.filename);
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: form,
        credentials: 'include',
        headers: kaGetCsrfHeader()
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Upload failed.');
      }
      await kaEmployeeDocsDelete(entry.id);
      refreshedEmployeeId = entry.employee_id;
    } catch (err) {
      const msg = (err && err.message) ? String(err.message) : '';
      const authLike = /auth|login|credential|session/i.test(msg);
      const netLike = /network|failed to fetch|offline/i.test(msg);
      if (authLike || netLike) break;
    }
  }

  const remaining = await kaEmployeeDocsGetAll().catch(() => []);
  kaSetEmployeeDocsQueueFlag(Array.isArray(remaining) && remaining.length > 0);
  if (refreshedEmployeeId && kaEmployeeSheetState.employeeId === refreshedEmployeeId) {
    kaLoadEmployeeDocs(refreshedEmployeeId);
    kaRefreshEmployeeSheet();
  }
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
    const docsPending = kaHasEmployeeDocsQueueFlag();
    const updates = kaLoadEmployeeUpdatesQueue();
    return (Array.isArray(pins) && pins.length > 0) ||
      (Array.isArray(verify) && verify.length > 0) ||
      (Array.isArray(notes) && notes.length > 0) ||
      (Array.isArray(punches) && punches.length > 0) ||
      (Array.isArray(reviews) && reviews.length > 0) ||
      docsPending ||
      (Array.isArray(updates) && updates.length > 0);
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
    await kaSyncEmployeeDocUploads();
    await kaSyncEmployeeUpdatesQueue();
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
  ['admin-login-pin', 'ka-pin-new', 'ka-pin-confirm', 'ka-rates-pin', 'ka-rate-pin', 'ka-admin-pin-input'].forEach(id => {
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
      view_url: doc.view_url || null,
      download_url: doc.download_url || null,
      url: doc.view_url || doc.url || doc.file_path || null,
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
    const href = kaAppendShipmentAuth(doc.view_url || doc.url || doc.file_path || '#');
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
  const rawHref = doc.view_url || doc.url || doc.file_path || '#';
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
  const auth = kaShipmentAuthMeta();
  if (auth.device_id && auth.device_secret) {
    params.set('device_id', auth.device_id);
    params.set('device_secret', auth.device_secret);
  }
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

// --- Notification helpers (per kiosk device/admin) ---

function kaShipmentNotifyStorageKey() {
  const adminPart = kaCurrentAdmin && kaCurrentAdmin.id
    ? `admin_${kaCurrentAdmin.id}`
    : 'admin_unknown';
  const devicePart = kaDeviceId ? `device_${kaDeviceId}` : 'device_unknown';
  return `avian_kiosk_ship_notify_${adminPart}_${devicePart}`;
}

function kaNotificationPrefsStorageKey() {
  const adminPart = kaCurrentAdmin && kaCurrentAdmin.id
    ? `admin_${kaCurrentAdmin.id}`
    : 'admin_unknown';
  const devicePart = kaDeviceId ? `device_${kaDeviceId}` : 'device_unknown';
  return `avian_kiosk_notify_prefs_${adminPart}_${devicePart}`;
}

function kaNormalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(v => String(v)).filter(v => v);
}

function kaNormalizeNumberArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(val => Number(val))
    .filter(num => Number.isFinite(num));
}

function kaLoadShipmentNotifyPrefFromStorage() {
  if (!kaCurrentAdmin || !kaCurrentAdmin.id) return { ...KA_SHIPMENT_NOTIFY_DEFAULT };
  try {
    const raw = localStorage.getItem(kaShipmentNotifyStorageKey());
    if (!raw) return { ...KA_SHIPMENT_NOTIFY_DEFAULT };
    const parsed = JSON.parse(raw);
    const enabled =
      parsed.enabled !== undefined
        ? parsed.enabled
        : (parsed.shipments_enabled !== undefined ? parsed.shipments_enabled : false);
    const notifyTime =
      parsed.notify_time ||
      parsed.remind_time ||
      KA_SHIPMENT_NOTIFY_DEFAULT.notify_time;

    // Migrate old frequency/day to every_days if present
    let migratedEvery = parsed.remind_every_days;
    if (migratedEvery == null && parsed.remind_frequency) {
      if (parsed.remind_frequency === 'weekly') migratedEvery = 7;
      else if (parsed.remind_frequency === 'biweekly') migratedEvery = 14;
      else migratedEvery = 1;
    }

    return {
      ...KA_SHIPMENT_NOTIFY_DEFAULT,
      ...parsed,
      enabled: !!enabled,
      statuses: kaNormalizeStringArray(parsed.statuses),
      project_ids: kaNormalizeNumberArray(parsed.project_ids),
      shipment_ids: kaNormalizeNumberArray(parsed.shipment_ids),
      notify_time: notifyTime,
      remind_every_days: Number(migratedEvery || parsed.remind_every_days || KA_SHIPMENT_NOTIFY_DEFAULT.remind_every_days) || 1
    };
  } catch {
    return { ...KA_SHIPMENT_NOTIFY_DEFAULT };
  }
}

function kaSaveShipmentNotifyPref(pref) {
  if (!kaCurrentAdmin || !kaCurrentAdmin.id) return;
  try {
    localStorage.setItem(kaShipmentNotifyStorageKey(), JSON.stringify(pref || KA_SHIPMENT_NOTIFY_DEFAULT));
  } catch {}
}

function kaLoadNotificationPrefsFromStorage() {
  if (!kaCurrentAdmin || !kaCurrentAdmin.id) return { ...KA_NOTIFICATION_PREF_DEFAULT };
  try {
    const raw = localStorage.getItem(kaNotificationPrefsStorageKey());
    if (!raw) return { ...KA_NOTIFICATION_PREF_DEFAULT };
    const parsed = JSON.parse(raw);
    const shipmentFilters = parsed.shipment_filters || {};
    const payrollFilters = parsed.payroll_filters || {};
    const timeFilters = parsed.time_filters || {};
    return {
      ...KA_NOTIFICATION_PREF_DEFAULT,
      ...parsed,
      email_enabled: parsed.email_enabled !== false && parsed.email_enabled !== 0,
      push_enabled: parsed.push_enabled !== false && parsed.push_enabled !== 0,
      shipment_filters: {
        enabled: shipmentFilters.enabled !== false && shipmentFilters.enabled !== 0 && shipmentFilters.enabled !== 'false',
        statuses: kaNormalizeStringArray(shipmentFilters.statuses),
        project_ids: kaNormalizeNumberArray(shipmentFilters.project_ids)
      },
      payroll_filters: {
        enabled: payrollFilters.enabled !== false && payrollFilters.enabled !== 0 && payrollFilters.enabled !== 'false',
        event_types: kaNormalizeStringArray(payrollFilters.event_types)
      },
      time_filters: {
        enabled: timeFilters.enabled !== false && timeFilters.enabled !== 0 && timeFilters.enabled !== 'false',
        event_types: kaNormalizeStringArray(timeFilters.event_types)
      },
      remind_time: parsed.remind_time || '',
      remind_every_days: Number(parsed.remind_every_days) || 1,
      clockout_enabled: parsed.clockout_enabled === true || parsed.clockout_enabled === 1 || parsed.clockout_enabled === 'true',
      clockout_time: parsed.clockout_time || KA_NOTIFICATION_PREF_DEFAULT.clockout_time
    };
  } catch {
    return { ...KA_NOTIFICATION_PREF_DEFAULT };
  }
}

function kaSaveNotificationPrefs(pref) {
  if (!kaCurrentAdmin || !kaCurrentAdmin.id) return;
  try {
    localStorage.setItem(kaNotificationPrefsStorageKey(), JSON.stringify(pref || KA_NOTIFICATION_PREF_DEFAULT));
  } catch {}
}

function kaNormalizeShipmentNotifyPref(raw = {}) {
  const enabled =
    raw.enabled !== undefined
      ? raw.enabled
      : (raw.shipments_enabled !== undefined ? raw.shipments_enabled : false);
  const notifyTime = raw.notify_time || raw.remind_time || KA_SHIPMENT_NOTIFY_DEFAULT.notify_time;
  const every = Number(raw.remind_every_days) || 1;
  return {
    ...KA_SHIPMENT_NOTIFY_DEFAULT,
    ...raw,
    enabled: !!enabled,
    statuses: kaNormalizeStringArray(raw.statuses),
    project_ids: kaNormalizeNumberArray(raw.project_ids),
    shipment_ids: kaNormalizeNumberArray(raw.shipment_ids),
    notify_time: notifyTime,
    remind_every_days: every > 0 ? every : 1
  };
}

function kaNormalizeNotificationPrefs(raw = {}) {
  const shipmentFilters = raw.shipment_filters || {};
  const payrollFilters = raw.payroll_filters || {};
  const timeFilters = raw.time_filters || {};

  return {
    ...KA_NOTIFICATION_PREF_DEFAULT,
    ...raw,
    email_enabled: raw.email_enabled !== false && raw.email_enabled !== 0,
    push_enabled: raw.push_enabled !== false && raw.push_enabled !== 0,
    shipment_filters: {
      enabled:
        shipmentFilters.enabled !== false &&
        shipmentFilters.enabled !== 0 &&
        shipmentFilters.enabled !== 'false',
      statuses: kaNormalizeStringArray(shipmentFilters.statuses),
      project_ids: kaNormalizeNumberArray(shipmentFilters.project_ids)
    },
    payroll_filters: {
      enabled:
        payrollFilters.enabled !== false &&
        payrollFilters.enabled !== 0 &&
        payrollFilters.enabled !== 'false',
      event_types: kaNormalizeStringArray(payrollFilters.event_types)
    },
    time_filters: {
      enabled:
        timeFilters.enabled !== false &&
        timeFilters.enabled !== 0 &&
        timeFilters.enabled !== 'false',
      event_types: kaNormalizeStringArray(timeFilters.event_types)
    },
    remind_time: raw.remind_time || '',
    remind_every_days: Number(raw.remind_every_days) || 1,
    clockout_enabled:
      raw.clockout_enabled === true ||
      raw.clockout_enabled === 1 ||
      raw.clockout_enabled === 'true',
    clockout_time: raw.clockout_time || KA_NOTIFICATION_PREF_DEFAULT.clockout_time
  };
}

function kaNotifyStatusesSource() {
  return [...KA_SHIPMENT_STATUSES];
}

function kaRenderCheckboxGroup(container, options, selectedSet) {
  if (!container) return;
  container.innerHTML = '';
  (options || []).forEach(opt => {
    if (!opt || !opt.value) return;
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = opt.value;
    input.checked = selectedSet.has(opt.value);
    label.appendChild(input);
    label.append(` ${opt.label}`);
    container.appendChild(label);
  });
}

function kaSetNotifyGroupDisabled(container, disabled) {
  if (!container) return;
  container.querySelectorAll('input, button, select').forEach(el => {
    el.disabled = !!disabled;
  });
}

function kaUpdateShipmentFilterState({ statuses = null, projectIds = null } = {}) {
  if (statuses) {
    kaShipmentNotifyPref.statuses = statuses;
    kaNotificationPrefs.shipment_filters.statuses = statuses;
  }
  if (projectIds) {
    kaShipmentNotifyPref.project_ids = projectIds;
    kaNotificationPrefs.shipment_filters.project_ids = projectIds;
  }
  kaNotifiedShipments = new Set();
  kaReminderTimestamps = {};
  kaSaveShipmentNotifyPref(kaShipmentNotifyPref);
  kaSaveNotificationPrefs(kaNotificationPrefs);
}

function kaRenderNotifyStatuses(statuses) {
  const menu = document.getElementById('ka-notify-statuses-menu');
  const labelEl = document.getElementById('ka-notify-statuses-label');
  if (!menu || !labelEl) return;

  const list = Array.isArray(statuses) && statuses.length ? statuses : KA_SHIPMENT_STATUSES;
  const selected = new Set(kaShipmentNotifyPref.statuses || []);
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
    if (!picked.length || picked.length === list.length) {
      labelEl.textContent = 'All statuses';
      labelEl.classList.add('placeholder');
    } else {
      labelEl.textContent = `${picked.length} selected`;
      labelEl.classList.remove('placeholder');
    }
    const normalized = picked.length === list.length ? [] : picked;
    kaUpdateShipmentFilterState({ statuses: normalized });
  }

  menu.onchange = updateLabel;
  updateLabel();
}

function kaRefreshNotifyProjectSelect() {
  const menu = document.getElementById('ka-notify-projects-menu');
  const labelEl = document.getElementById('ka-notify-projects-label');
  if (!menu || !labelEl) return;

  const selected = new Set(kaShipmentNotifyPref.project_ids || []);
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

    const normalized =
      kaProjects && picked.length === kaProjects.length ? [] : picked;
    kaUpdateShipmentFilterState({ projectIds: normalized });
  }

  menu.onchange = updateLabel;
  updateLabel();
}

function kaUpdateShipmentNotifyVisibility() {
  const updatesToggle = document.getElementById('ka-notify-shipments-updates-enabled');
  const remindersToggle = document.getElementById('ka-notify-shipments-reminders-enabled');
  const filtersBody = document.getElementById('ka-notify-shipments-filters');
  const reminderBody = document.getElementById('ka-notify-shipments-reminder-body');
  const statusBtn = document.getElementById('ka-notify-statuses-btn');
  const projectBtn = document.getElementById('ka-notify-projects-btn');

  const updatesEnabled = !!updatesToggle?.checked;
  const remindersEnabled = !!remindersToggle?.checked;
  const filtersDisabled = !(updatesEnabled || remindersEnabled);

  if (filtersBody) {
    kaSetNotifyGroupDisabled(filtersBody, filtersDisabled);
  }
  if (statusBtn) statusBtn.disabled = filtersDisabled;
  if (projectBtn) projectBtn.disabled = filtersDisabled;
  if (reminderBody) reminderBody.classList.toggle('hidden', !remindersEnabled);
}

function kaApplyShipmentNotifyPrefToUI(pref, statusesList) {
  kaShipmentNotifyPref = kaNormalizeShipmentNotifyPref(pref || {});
  kaSaveShipmentNotifyPref(kaShipmentNotifyPref);

  const remindersToggle = document.getElementById('ka-notify-shipments-reminders-enabled');
  if (remindersToggle) remindersToggle.checked = !!kaShipmentNotifyPref.enabled;

  const timeEl = document.getElementById('ka-notify-shipments-time');
  if (timeEl) timeEl.value = kaShipmentNotifyPref.notify_time || KA_SHIPMENT_NOTIFY_DEFAULT.notify_time;

  const everyEl = document.getElementById('ka-notify-shipments-every-days');
  if (everyEl) everyEl.value = kaShipmentNotifyPref.remind_every_days || 1;

  kaRenderNotifyStatuses(statusesList || kaNotifyStatusesSource());
  kaRefreshNotifyProjectSelect();
  kaUpdateShipmentNotifyVisibility();
}

function kaApplyNotificationPrefsToUI(prefs) {
  kaNotificationPrefs = kaNormalizeNotificationPrefs(prefs || {});
  kaSaveNotificationPrefs(kaNotificationPrefs);

  const emailToggle = document.getElementById('ka-notify-email-enabled');
  const pushToggle = document.getElementById('ka-notify-push-enabled');
  const shipmentsToggle = document.getElementById('ka-notify-shipments-updates-enabled');
  const timeToggle = document.getElementById('ka-notify-time-enabled');
  const payrollToggle = document.getElementById('ka-notify-payroll-enabled');
  const dailyToggle = document.getElementById('ka-notify-daily-enabled');
  const dailyBody = document.getElementById('ka-notify-daily-body');
  const dailyTime = document.getElementById('ka-notify-daily-time');
  const dailyEvery = document.getElementById('ka-notify-daily-every');
  const clockoutToggle = document.getElementById('ka-notify-clockout-enabled');
  const clockoutTime = document.getElementById('ka-notify-clockout-time');

  if (emailToggle) emailToggle.checked = !!kaNotificationPrefs.email_enabled;
  if (pushToggle) pushToggle.checked = !!kaNotificationPrefs.push_enabled;

  if (shipmentsToggle) {
    shipmentsToggle.checked = kaNotificationPrefs.shipment_filters?.enabled !== false;
  }

  if (timeToggle) timeToggle.checked = kaNotificationPrefs.time_filters?.enabled !== false;
  if (payrollToggle) payrollToggle.checked = kaNotificationPrefs.payroll_filters?.enabled !== false;

  const dailyEnabled = !!kaNotificationPrefs.remind_time;
  if (dailyToggle) dailyToggle.checked = dailyEnabled;
  if (dailyBody) dailyBody.classList.toggle('hidden', !dailyEnabled);
  if (dailyTime) dailyTime.value = kaNotificationPrefs.remind_time || KA_SHIPMENT_NOTIFY_DEFAULT.notify_time;
  if (dailyEvery) dailyEvery.value = kaNotificationPrefs.remind_every_days || 1;

  if (clockoutToggle) clockoutToggle.checked = !!kaNotificationPrefs.clockout_enabled;
  if (clockoutTime) clockoutTime.value = kaNotificationPrefs.clockout_time || KA_NOTIFICATION_PREF_DEFAULT.clockout_time;
  if (clockoutTime) clockoutTime.disabled = !clockoutToggle?.checked;

  kaRenderCheckboxGroup(
    document.getElementById('ka-notify-time-events'),
    KA_TIME_EVENTS,
    new Set(kaNotificationPrefs.time_filters?.event_types || [])
  );
  kaRenderCheckboxGroup(
    document.getElementById('ka-notify-payroll-events'),
    KA_PAYROLL_EVENTS,
    new Set(kaNotificationPrefs.payroll_filters?.event_types || [])
  );

  kaSetNotifyGroupDisabled(
    document.getElementById('ka-notify-time-events'),
    !timeToggle?.checked
  );
  kaSetNotifyGroupDisabled(
    document.getElementById('ka-notify-payroll-events'),
    !payrollToggle?.checked
  );

  kaUpdateShipmentNotifyVisibility();
}

function kaCollectSelectedStatuses() {
  const picked = Array.from(
    document.querySelectorAll('#ka-notify-statuses-menu input[type="checkbox"]:checked')
  ).map(cb => cb.value);
  const total = KA_SHIPMENT_STATUSES.length;
  if (total && picked.length === total) return [];
  return picked;
}

function kaCollectSelectedProjects() {
  const picked = Array.from(
    document.querySelectorAll('#ka-notify-projects-menu input[type="checkbox"]:checked')
  ).map(cb => Number(cb.value)).filter(Number.isFinite);
  const total = Array.isArray(kaProjects) ? kaProjects.length : 0;
  if (total && picked.length === total) return [];
  return picked;
}

function kaCollectShipmentNotifyPrefsFromUI() {
  const enabled = document.getElementById('ka-notify-shipments-reminders-enabled')?.checked || false;
  const timeValue = document.getElementById('ka-notify-shipments-time')?.value || KA_SHIPMENT_NOTIFY_DEFAULT.notify_time;
  const everyVal = Number(document.getElementById('ka-notify-shipments-every-days')?.value || 1);
  const statuses = kaCollectSelectedStatuses();
  const projectIds = kaCollectSelectedProjects();

  return {
    enabled,
    statuses,
    project_ids: projectIds,
    shipment_ids: [],
    notify_time: enabled ? timeValue : '',
    remind_every_days: everyVal > 0 ? everyVal : 1
  };
}

function kaCollectNotificationPrefsFromUI() {
  const emailEnabled = document.getElementById('ka-notify-email-enabled')?.checked || false;
  const pushEnabled = document.getElementById('ka-notify-push-enabled')?.checked || false;
  const shipmentsUpdates = document.getElementById('ka-notify-shipments-updates-enabled')?.checked || false;
  const timeEnabled = document.getElementById('ka-notify-time-enabled')?.checked || false;
  const payrollEnabled = document.getElementById('ka-notify-payroll-enabled')?.checked || false;
  const dailyEnabled = document.getElementById('ka-notify-daily-enabled')?.checked || false;
  const dailyTimeVal = document.getElementById('ka-notify-daily-time')?.value || KA_SHIPMENT_NOTIFY_DEFAULT.notify_time;
  const dailyEveryVal = Number(document.getElementById('ka-notify-daily-every')?.value || 1);
  const clockoutEnabled = document.getElementById('ka-notify-clockout-enabled')?.checked || false;
  const clockoutTimeVal = document.getElementById('ka-notify-clockout-time')?.value || KA_NOTIFICATION_PREF_DEFAULT.clockout_time;

  const statuses = kaCollectSelectedStatuses();
  const projectIds = kaCollectSelectedProjects();

  const timeEvents = Array.from(
    document.querySelectorAll('#ka-notify-time-events input[type="checkbox"]:checked')
  ).map(cb => cb.value);

  const payrollEvents = Array.from(
    document.querySelectorAll('#ka-notify-payroll-events input[type="checkbox"]:checked')
  ).map(cb => cb.value);

  return {
    email_enabled: emailEnabled,
    push_enabled: pushEnabled,
    shipment_filters: {
      enabled: shipmentsUpdates,
      statuses,
      project_ids: projectIds
    },
    time_filters: {
      enabled: timeEnabled,
      event_types: timeEvents
    },
    payroll_filters: {
      enabled: payrollEnabled,
      event_types: payrollEvents
    },
    remind_time: dailyEnabled ? dailyTimeVal : '',
    remind_every_days: dailyEveryVal > 0 ? dailyEveryVal : 1,
    clockout_enabled: clockoutEnabled,
    clockout_time: clockoutEnabled ? clockoutTimeVal : ''
  };
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

function kaShipIsReadyForPickup(status) {
  const st = String(status || '').toLowerCase();
  return st.includes('ready') && st.includes('pickup');
}

function kaShipIsPickedUp(sh) {
  if (!sh) return false;
  const status = String(sh.status || '').toLowerCase();
  if (status.includes('archived')) return true;
  return status.includes('picked') && status.includes('up');
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

function kaStripNoChargesLabel(title) {
  if (!title) return title;
  const stripped = String(title).replace(/\s*[-–—]\s*no charges\s*/gi, ' ').trim();
  return stripped;
}

function kaBindExpandableSelect(select) {
  if (!select || select.dataset.expandSelectBound) return;
  const expand = () => {
    const count = select.options ? select.options.length : 0;
    if (count > 1) select.size = count;
  };
  const collapse = () => {
    select.size = 1;
  };
  select.addEventListener('focus', expand);
  select.addEventListener('blur', collapse);
  select.addEventListener('change', () => {
    collapse();
    select.blur();
  });
  collapse();
  select.dataset.expandSelectBound = '1';
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
    const rawTitle = sh.title || sh.sku || `Shipment #${sh.id || ''}`;
    const bol = sh.bol_number ? `BOL ${sh.bol_number}` : '';
    const project = sh.project_name ? sh.project_name : 'No project set';
    const statusText = sh.status || 'Status';
    const statusTone = kaShipStatusTone(statusText);
    const tracking = sh.tracking_number ? String(sh.tracking_number).trim() : '';
    const trackingHref = tracking
      ? `https://www.google.com/search?q=${encodeURIComponent(`tracking ${tracking}`)}`
      : '';
    const verify = kaShipVerificationInfo(sh);
    const late = kaStorageLateFees(sh.storage_due_date, sh.storage_daily_late_fee);
    const isOverdue = late.daysLate > 0 && late.estimate > 0;
    const strippedTitle = kaStripNoChargesLabel(rawTitle);
    const title = strippedTitle ? strippedTitle : rawTitle;
    const showPaymentDetails = kaCanViewPayroll();
    const overdueText = showPaymentDetails
      ? `Shipment overdue · Estimated charges: $${late.estimate.toFixed(2)}`
      : 'Shipment overdue';
    const isReadyForPickup = kaShipIsReadyForPickup(statusText);
    const isPickedUp = kaShipIsPickedUp(sh);
    const showPickupControls = isReadyForPickup && !isPickedUp;
    const showVerification = isPickedUp;
    const pickedBy = sh.picked_up_by ? String(sh.picked_up_by).trim() : '';
    const pickedDateRaw = sh.picked_up_date ? String(sh.picked_up_date).slice(0, 10) : '';
    const pickedDate = pickedDateRaw ? kaFmtDateMMDDYYYY(pickedDateRaw) : '';
    const pickupSummaryLabel = pickedBy ? 'Picked up by' : 'Picked up on';
    const pickupSummary = pickedBy
      ? `${pickedBy}${pickedDate ? ` (${pickedDate})` : ''}`
      : (pickedDate ? pickedDate : '');
    const storageNote = sh.notes ? String(sh.notes) : '';

    let pickupSection = '';
    if (showPickupControls) {
      const admins = kaPickupAdminOptions();
      const matchedAdmin = admins.find(a => a.label === pickedBy);
      const otherSelected = !!pickedBy && !matchedAdmin;
      const otherValue = otherSelected ? pickedBy : '';
      const pickupDateValue = pickedDateRaw || '';
      const canEditPickup = !!kaAdminAuthId() && kaCanViewShipments();
      const disabledAttr = canEditPickup ? '' : 'disabled';
      const statusMsg = canEditPickup
        ? ''
        : (kaAdminAuthId()
          ? 'You do not have shipments access.'
          : 'Identify yourself on this device to edit.');
      const savedOtherOption = otherSelected
        ? `<option value="__other_saved__" data-other-name="${escapeHTML(otherValue)}" selected>${escapeHTML(otherValue)}</option>`
        : '';
      const pickupOptions = [
        '<option value="">Select Name</option>',
        ...admins.map(a => {
          const isSelected = matchedAdmin && String(a.id) === String(matchedAdmin.id);
          return `<option value="${escapeHTML(String(a.id))}" ${isSelected ? 'selected' : ''}>${escapeHTML(a.label)}</option>`;
        }),
        savedOtherOption,
        `<option value="__other__">Other</option>`
      ].join('');

      pickupSection = `
        <div class="ka-ship-info-box">
          <div class="ka-ship-detail-grid ka-ship-detail-grid--pickup">
            <div class="ka-ship-info-row ka-ship-info-row--half ka-ship-info-row--label-left">
              <div class="ka-ship-info-label">Picked up by</div>
              <div class="ka-ship-info-value">
                <select data-ka-pickup-select aria-label="Picked up by" data-ka-pickup-current-other="${escapeHTML(otherValue)}" ${disabledAttr}>${pickupOptions}</select>
              </div>
            </div>
            <div class="ka-ship-info-row hidden" data-ka-pickup-other-row>
              <div class="ka-ship-info-value">
                <input type="text" data-ka-pickup-other placeholder="Other name" aria-label="Other name" value="${escapeHTML(otherValue)}" ${disabledAttr} />
              </div>
            </div>
            <div class="ka-ship-info-row ka-ship-info-row--half ka-ship-info-row--label-left">
              <div class="ka-ship-info-label">Pickup date</div>
              <div class="ka-ship-info-value">
                <input type="date" data-ka-pickup-date aria-label="Pickup date" value="${escapeHTML(pickupDateValue)}" ${disabledAttr} />
              </div>
            </div>
            <div class="ka-ship-info-row wide">
              <div class="ka-ship-info-value">
                <textarea rows="2" data-ka-pickup-note aria-label="Storage note" placeholder="Notes / Storage information (optional)" ${disabledAttr}>${escapeHTML(storageNote)}</textarea>
              </div>
            </div>
            <div class="ka-ship-info-row wide">
              <div class="ka-ship-info-value ka-storage-actions ka-storage-actions--pickup">
                <div class="ka-storage-action-row">
                  <button class="btn primary btn-sm" data-ka-pickup-save ${disabledAttr}>Save pickup</button>
                  <button type="button" class="ka-ship-chevron-btn ka-ship-chevron-btn--inline" data-ka-open-overview="${sh.id}" aria-label="View more">
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                    </svg>
                  </button>
                </div>
                <span class="ka-status" data-ka-pickup-status>${escapeHTML(statusMsg)}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    const actionsHtml = showVerification
      ? `
        <div class="ka-ship-card-actions">
          <button type="button" class="btn secondary btn-sm" data-ka-open-items="${sh.id}">
            View & verify items
          </button>
        </div>
      `
      : '';

    const card = document.createElement('div');
    card.className = 'ka-ship-card';
    if (showPickupControls) card.classList.add('ka-ship-card--pickup');
    card.dataset.shipmentId = sh.id;
    card.innerHTML = `
      ${isOverdue ? `<div class="ka-ship-overdue">${overdueText}</div>` : ''}
      <div class="ka-ship-card-header">
        <div class="ka-ship-card-titlewrap">
          <div class="ka-ship-title-row">
            <div class="ka-ship-title">${escapeHTML(title)} — ${escapeHTML(project)}</div>
          </div>
          <div class="ka-ship-meta-row">
            ${
              !isReadyForPickup
                ? `<span class="ka-ship-meta-text">
                    Tracking: ${
                      tracking
                        ? `<a class="ka-tracking-link" href="${trackingHref}" target="_blank" rel="noopener noreferrer">${escapeHTML(tracking)}</a>`
                        : '—'
                    }
                  </span>`
                : ''
            }
            ${
              !isPickedUp && sh.storage_due_date
                ? `<span class="ka-ship-meta-text ka-ship-meta-text--due">Due for pickup: ${kaFmtDateMMDDYYYY(sh.storage_due_date)}</span>`
                : ''
            }
            ${
              isPickedUp && pickupSummary
                ? `<span class="ka-ship-meta-text">${pickupSummaryLabel}: ${escapeHTML(pickupSummary)}</span>`
                : ''
            }
          </div>
        </div>
        <div class="ka-ship-header-right">
          <div class="ka-ship-header-top">
            <span class="ka-ship-status-pill ${statusTone}">${escapeHTML(statusText)}</span>
            ${
              bol
                ? `<a class="ka-ship-bol-pill ka-ship-bol" data-bol-for="${sh.id}" href="javascript:void(0)">${escapeHTML(bol)}</a>`
                : ''
            }
          </div>
          ${
            !isPickedUp && !showPickupControls
              ? `<button type="button" class="ka-ship-chevron-btn" data-ka-open-overview="${sh.id}" aria-label="View more">
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                  </svg>
                </button>`
              : ''
          }
        </div>
      </div>

      ${pickupSection}
      ${
        showVerification
          ? `
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
          `
          : ''
      }
      ${actionsHtml}
    `;
    const openItemsBtn = card.querySelector('[data-ka-open-items]');
    if (openItemsBtn && !openItemsBtn.dataset.bound) {
      openItemsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const sid = Number(openItemsBtn.dataset.kaOpenItems || card.dataset.shipmentId);
        if (sid) {
          kaOpenItemsModal(sid, { tab: 'items' });
        }
      });
      openItemsBtn.dataset.bound = '1';
    }
    const openOverviewBtn = card.querySelector('[data-ka-open-overview]');
    if (openOverviewBtn && !openOverviewBtn.dataset.bound) {
      openOverviewBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const sid = Number(openOverviewBtn.dataset.kaOpenOverview || card.dataset.shipmentId);
        if (sid) {
          kaOpenItemsModal(sid, { tab: 'overview' });
        }
      });
      openOverviewBtn.dataset.bound = '1';
    }
    wrap.appendChild(card);
  });

  if (!wrap.dataset.bound) {
    wrap.addEventListener('click', async (e) => {
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

      const saveBtn = e.target.closest('[data-ka-pickup-save]');
      if (saveBtn) {
        e.preventDefault();
        e.stopPropagation();
        const card = saveBtn.closest('.ka-ship-card');
        const shipmentId = Number(card?.dataset.shipmentId || 0);
        if (!shipmentId) return;

        const select = card?.querySelector('[data-ka-pickup-select]');
        const otherRow = card?.querySelector('[data-ka-pickup-other-row]');
        const otherInput = card?.querySelector('[data-ka-pickup-other]');
        const dateInput = card?.querySelector('[data-ka-pickup-date]');
        const noteInput = card?.querySelector('[data-ka-pickup-note]');
        const statusEl = card?.querySelector('[data-ka-pickup-status]');
        if (!select || !dateInput) return;

        const setStatus = (msg, type) => {
          if (!statusEl) return;
          statusEl.textContent = msg || '';
          statusEl.className = 'ka-status';
          if (type === 'ok') statusEl.classList.add('ka-status-ok');
          if (type === 'error') statusEl.classList.add('ka-status-error');
        };

        const adminId = kaAdminAuthId();
        if (!adminId) {
          setStatus('Identify yourself on this device to edit.', 'error');
          return;
        }
        if (!kaCanViewShipments()) {
          setStatus('You do not have shipments access.', 'error');
          return;
        }

        const admins = kaPickupAdminOptions();
        const isOther = select.value === '__other__';
        const isSavedOther = select.value === '__other_saved__';
        const selectedOption = select.selectedOptions ? select.selectedOptions[0] : null;
        const pickedVal = isOther
          ? (otherInput?.value || '').trim()
          : isSavedOther
            ? (selectedOption?.dataset.otherName || selectedOption?.textContent || '').trim()
            : (admins.find(a => String(a.id) === select.value)?.label || '');
        const pickedDate = dateInput.value || '';
        const noteValue = noteInput ? noteInput.value.trim() : '';

        if (!pickedVal) {
          setStatus(isOther ? 'Enter a pickup name for Other.' : 'Choose a pickup name.', 'error');
          return;
        }

        const shipment = kaShipments.find(s => Number(s.id) === shipmentId) || {};
        const existingName = (shipment.picked_up_by || '').trim();
        const existingDate = shipment.picked_up_date
          ? String(shipment.picked_up_date).slice(0, 10)
          : '';
        const lastBy = shipment.picked_up_updated_by || '';
        const lastAt = shipment.picked_up_updated_at || '';
        const changingExisting =
          (existingName && existingName !== pickedVal) ||
          (existingDate && existingDate !== pickedDate);

        if (changingExisting && (existingName || existingDate)) {
          const confirmMsg = `Pickup info was last set by ${lastBy || 'someone'}${lastAt ? ` on ${lastAt}` : ''}.\nDo you want to overwrite it with your changes?`;
          const ok = await kaShowConfirmDialog(confirmMsg, { okLabel: 'Overwrite', cancelLabel: 'Cancel', title: 'Update pickup' });
          if (!ok) return;
        }

        setStatus('Saving pickup…');
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
            `/api/shipments/${shipmentId}/storage`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            }
          );
          const saved = resp && resp.shipment ? resp.shipment : resp;

          const existingNotes = shipment.notes ? String(shipment.notes).trim() : '';
          const notesChanged =
            noteInput && noteValue.trim() !== existingNotes;
          let nextNotes = existingNotes;

          if (notesChanged) {
            if (!navigator.onLine) {
              kaQueueShipmentNotes(shipmentId, noteValue);
              nextNotes = noteValue;
            } else {
              try {
                const notesResp = await fetchJSON(
                  `/api/shipments/${shipmentId}/notes`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ notes: noteValue })
                  }
                );
                const savedNotes =
                  notesResp && notesResp.shipment ? notesResp.shipment : notesResp;
                if (savedNotes && savedNotes.notes !== undefined) {
                  nextNotes = savedNotes.notes || '';
                } else {
                  nextNotes = noteValue;
                }
              } catch (err) {
                console.error('Storage note save failed', err);
                kaShowInlineAlert('Pickup saved, but storage note failed to save.', 'error', 6000);
              }
            }
          }
          const idx = kaShipments.findIndex(s => Number(s.id) === shipmentId);
          if (idx !== -1) {
            kaShipments[idx] = { ...kaShipments[idx], ...saved, notes: nextNotes };
          }
          kaSaveShipmentsCache(kaShipments);
          kaShowInlineAlert('Pickup saved.', 'ok', 4000);
          kaRenderShipmentsList(kaShipments);
        } catch (err) {
          console.error('Pickup save failed', err);
          setStatus(err.message || 'Error saving pickup.', 'error');
        } finally {
          if (card && card.isConnected) {
            saveBtn.disabled = false;
            if (select) select.disabled = false;
            if (otherInput) otherInput.disabled = false;
            if (dateInput) dateInput.disabled = false;
            if (otherRow && select.value !== '__other__') {
              otherRow.classList.add('hidden');
            }
          }
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

      const overviewBtn = e.target.closest('[data-ka-open-overview]');
      if (overviewBtn) {
        e.preventDefault();
        e.stopPropagation();
        const sid = Number(overviewBtn.dataset.kaOpenOverview);
        if (sid) {
          kaOpenItemsModal(sid, { tab: 'overview' });
        }
      }
    });

    wrap.addEventListener('change', (e) => {
      const select = e.target.closest('[data-ka-pickup-select]');
      if (!select) return;
      const card = select.closest('.ka-ship-card');
      const otherRow = card?.querySelector('[data-ka-pickup-other-row]');
      const otherInput = card?.querySelector('[data-ka-pickup-other]');
      if (!otherRow) return;
      const isOther = select.value === '__other__';
      otherRow.classList.toggle('hidden', !isOther);
      if (otherInput) {
        otherInput.required = isOther;
        otherInput.setAttribute('aria-required', isOther ? 'true' : 'false');
        if (isOther && !otherInput.value) {
          const currentOther = select.dataset.kaPickupCurrentOther || '';
          if (currentOther) otherInput.value = currentOther;
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
  if (statusVal) {
    if (statusVal.startsWith('status:')) {
      const statusLabel = statusVal.slice('status:'.length);
      params.set('status', statusLabel);
      if (statusLabel === 'Picked Up') {
        params.set('include_archived', '1');
      }
    } else if (statusVal === 'all') {
      params.set('include_archived', '1');
    } else if (statusVal === 'active') {
      params.set('include_archived', '0');
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
  if (!kaNotificationPrefs.push_enabled) return false;
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

async function kaTriggerShipmentNotification(force = false) {
  const pref = kaShipmentNotifyPref || KA_SHIPMENT_NOTIFY_DEFAULT;
  const matching = kaShipmentsMatchingNotify(pref);

  const title = force ? 'Test: Shipment reminder' : 'Shipment reminder';
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
  if (!kaShipmentNotifyPref.enabled) return;

  await kaTriggerShipmentNotification(forceNow);
}

function kaProcessNewShipmentsForAlert() {
  if (!kaNotificationPrefs.shipment_filters?.enabled) return;
  const matches = kaShipmentsMatchingNotify(kaShipmentNotifyPref);
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
  if (!kaShipmentNotifyPref.enabled) return;
  const now = Date.now();
  const matches = kaShipmentsMatchingNotify(kaShipmentNotifyPref);

  const outstanding = matches.filter(sh =>
    (sh.status || '') === 'Cleared - Ready for Pickup' &&
    (!sh.picked_up_by || String(sh.picked_up_by).trim() === '')
  );

  const everyDays = Math.max(Number(kaShipmentNotifyPref.remind_every_days) || 1, 1);
  const today = new Date();
  const targetTime = (kaShipmentNotifyPref.notify_time || KA_SHIPMENT_NOTIFY_DEFAULT.notify_time).match(/^(\d{2}):(\d{2})$/)
    ? kaShipmentNotifyPref.notify_time
    : KA_SHIPMENT_NOTIFY_DEFAULT.notify_time;

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
      new Notification('Ready for Pickup – Pickup Reminder', {
        body: `${summary.join(', ')}${extra}`
      });
    } catch (err) {
      console.warn('Kiosk reminder notification failed:', err);
    }
  }
  kaSetNotifyMsg('Reminder sent for ready-to-pickup shipments.', '#0f172a');

  due.forEach(sh => {
    kaReminderTimestamps[sh.id] = now;
    kaNotifiedShipments.add(sh.id);
  });
}

async function kaClockoutAlertCheck(forceNow = false) {
  if (!kaNotificationPrefs.clockout_enabled || !kaKiosk) return;

  const timeStr =
    (kaNotificationPrefs.clockout_time || KA_NOTIFICATION_PREF_DEFAULT.clockout_time).match(/^(\d{2}):(\d{2})$/)
      ? kaNotificationPrefs.clockout_time
      : KA_NOTIFICATION_PREF_DEFAULT.clockout_time;

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

  if (!kaShipmentNotifyPref.enabled && !kaNotificationPrefs.clockout_enabled) return;

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

function kaSetNotifyMessage(text, color) {
  const el = document.getElementById('ka-notify-msg');
  if (!el) return;
  el.textContent = text || '';
  if (color) el.style.color = color;
}

async function kaSyncNotificationPrefsQueue() {
  if (!navigator.onLine) return;
  const queue = loadSettingsQueue();
  if (!queue.length) return;

  const remaining = [];
  for (const entry of queue) {
    if (!entry || entry.type !== 'notifications_prefs') continue;
    try {
      const data = await fetchJSON('/api/notifications/prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry.payload || {})
      });
      kaNotificationPrefs = kaNormalizeNotificationPrefs(data.prefs || entry.payload || {});
      kaSaveNotificationPrefs(kaNotificationPrefs);
    } catch (err) {
      if (!navigator.onLine) {
        remaining.push(entry);
        break;
      }
      remaining.push(entry);
    }
  }
  replaceSettingsQueueTypes(['notifications_prefs'], remaining);
}

async function kaSyncShipmentNotifyPrefsQueue() {
  if (!navigator.onLine) return;
  const queue = loadSettingsQueue();
  if (!queue.length) return;

  const remaining = [];
  for (const entry of queue) {
    if (!entry || entry.type !== 'shipments_notifications') continue;
    try {
      const data = await fetchJSON('/api/shipments/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry.payload || {})
      });
      kaShipmentNotifyPref = kaNormalizeShipmentNotifyPref(data.preference || entry.payload || {});
      kaSaveShipmentNotifyPref(kaShipmentNotifyPref);
    } catch (err) {
      if (!navigator.onLine) {
        remaining.push(entry);
        break;
      }
      remaining.push(entry);
    }
  }
  replaceSettingsQueueTypes(['shipments_notifications'], remaining);
}

function kaIsPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

function kaUrlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

async function kaRefreshPushStatus() {
  const statusEl = document.getElementById('ka-notify-push-status');
  const subscribeBtn = document.getElementById('ka-notify-push-subscribe');
  const unsubscribeBtn = document.getElementById('ka-notify-push-unsubscribe');

  if (!kaIsPushSupported()) {
    if (statusEl) statusEl.textContent = 'Push not supported on this browser.';
    if (subscribeBtn) subscribeBtn.disabled = true;
    if (unsubscribeBtn) unsubscribeBtn.disabled = true;
    return;
  }

  if (!kaPushPublicKey) {
    if (statusEl) statusEl.textContent = 'Push keys are not configured yet.';
    if (subscribeBtn) subscribeBtn.disabled = true;
    if (unsubscribeBtn) unsubscribeBtn.disabled = true;
    return;
  }

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    if (statusEl) statusEl.textContent = 'Push is enabled on this device.';
    if (subscribeBtn) subscribeBtn.disabled = true;
    if (unsubscribeBtn) unsubscribeBtn.disabled = false;
  } else {
    if (statusEl) statusEl.textContent = 'Push is not enabled on this device.';
    if (subscribeBtn) subscribeBtn.disabled = false;
    if (unsubscribeBtn) unsubscribeBtn.disabled = true;
  }
}

async function kaSubscribeToPush() {
  const statusEl = document.getElementById('ka-notify-push-status');
  try {
    if (!kaPushPublicKey) {
      if (statusEl) statusEl.textContent = 'Push keys are not configured yet.';
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      if (statusEl) statusEl.textContent = 'Push permission was not granted.';
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: kaUrlBase64ToUint8Array(kaPushPublicKey)
      });
    }
    const json = sub.toJSON();
    await fetchJSON('/api/notifications/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh || '',
        auth: json.keys?.auth || '',
        user_agent: navigator.userAgent
      })
    });
    if (statusEl) statusEl.textContent = 'Push enabled for this device.';
    await kaRefreshPushStatus();
  } catch (err) {
    if (statusEl) statusEl.textContent = err.message || 'Failed to enable push.';
  }
}

async function kaUnsubscribeFromPush() {
  const statusEl = document.getElementById('ka-notify-push-status');
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) {
      if (statusEl) statusEl.textContent = 'Push is already disabled.';
      await kaRefreshPushStatus();
      return;
    }
    await fetchJSON('/api/notifications/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint })
    });
    await sub.unsubscribe();
    if (statusEl) statusEl.textContent = 'Push disabled for this device.';
    await kaRefreshPushStatus();
  } catch (err) {
    if (statusEl) statusEl.textContent = err.message || 'Failed to disable push.';
  }
}

async function kaLoadNotificationPrefs() {
  if (!kaCurrentAdmin || !kaCurrentAdmin.id) return;
  try {
    const data = await fetchJSON('/api/notifications/prefs');
    kaPushPublicKey = data.push_public_key || '';
    kaNotificationPrefs = kaNormalizeNotificationPrefs(data.prefs || {});
    kaSaveNotificationPrefs(kaNotificationPrefs);
  } catch (err) {
    kaNotificationPrefs = kaLoadNotificationPrefsFromStorage();
  }
  kaApplyNotificationPrefsToUI(kaNotificationPrefs);
  await kaRefreshPushStatus();
}

function kaSyncShipmentFilterPrefs() {
  if (!kaNotificationPrefs.shipment_filters) {
    kaNotificationPrefs.shipment_filters = { enabled: true, statuses: [], project_ids: [] };
  }
  kaNotificationPrefs.shipment_filters.statuses = (kaShipmentNotifyPref.statuses || []).slice();
  kaNotificationPrefs.shipment_filters.project_ids = (kaShipmentNotifyPref.project_ids || []).slice();
  kaSaveNotificationPrefs(kaNotificationPrefs);
}

async function kaLoadShipmentNotifyPrefs() {
  if (!kaCurrentAdmin || !kaCurrentAdmin.id) return;
  try {
    const data = await fetchJSON('/api/shipments/notifications');
    kaShipmentNotifyPref = kaNormalizeShipmentNotifyPref(data.preference || {});
    kaSaveShipmentNotifyPref(kaShipmentNotifyPref);
  } catch (err) {
    kaShipmentNotifyPref = kaLoadShipmentNotifyPrefFromStorage();
  }
  if (
    (!kaShipmentNotifyPref.statuses || !kaShipmentNotifyPref.statuses.length) &&
    kaNotificationPrefs.shipment_filters?.statuses?.length
  ) {
    kaShipmentNotifyPref.statuses = kaNotificationPrefs.shipment_filters.statuses.slice();
  }
  if (
    (!kaShipmentNotifyPref.project_ids || !kaShipmentNotifyPref.project_ids.length) &&
    kaNotificationPrefs.shipment_filters?.project_ids?.length
  ) {
    kaShipmentNotifyPref.project_ids = kaNotificationPrefs.shipment_filters.project_ids.slice();
  }
  kaSyncShipmentFilterPrefs();
  kaApplyShipmentNotifyPrefToUI(kaShipmentNotifyPref, kaNotifyStatusesSource());
}

async function kaSaveNotificationsToServer({ notificationPrefs, shipmentPrefs }) {
  if (notificationPrefs) {
    const payload = kaNormalizeNotificationPrefs(notificationPrefs);
    kaNotificationPrefs = payload;
    kaSaveNotificationPrefs(payload);
    if (!navigator.onLine) {
      queueSettingsUpdate('notifications_prefs', payload);
    } else {
      await fetchJSON('/api/notifications/prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }
  }

  if (shipmentPrefs) {
    const payload = kaNormalizeShipmentNotifyPref(shipmentPrefs);
    kaShipmentNotifyPref = payload;
    kaSaveShipmentNotifyPref(payload);
    if (!navigator.onLine) {
      queueSettingsUpdate('shipments_notifications', payload);
    } else {
      await fetchJSON('/api/shipments/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }
  }
}

async function kaSendTestNotification() {
  try {
    const channels = ['in_app'];
    if (kaNotificationPrefs.email_enabled) channels.push('email');
    if (kaNotificationPrefs.push_enabled) channels.push('push');
    const data = await fetchJSON('/api/notifications/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channels,
        title: 'Test notification',
        body: 'This is a test notification from Avian.'
      })
    });
    const results = data.results || {};
    const summary = Object.entries(results)
      .map(([key, val]) => `${key}: ${val}`)
      .join(', ');
    kaSetNotifyMessage(summary ? `Test sent (${summary}).` : 'Test sent.', 'green');
  } catch (err) {
    kaSetNotifyMessage(err.message || 'Failed to send test.', '#b91c1c');
  }
}

async function kaInitNotifyPanel() {
  if (!kaCurrentAdmin || !kaCurrentAdmin.id) return;

  kaNotifiedShipments = new Set();
  kaReminderTimestamps = {};
  kaClockoutAlertedDay = '';
  if (kaNotifyTimer) {
    clearInterval(kaNotifyTimer);
    kaNotifyTimer = null;
  }

  await kaLoadNotificationPrefs();
  await kaLoadShipmentNotifyPrefs();

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

  const shipmentsUpdatesToggle = document.getElementById('ka-notify-shipments-updates-enabled');
  if (shipmentsUpdatesToggle) {
    shipmentsUpdatesToggle.addEventListener('change', () => {
      kaNotificationPrefs.shipment_filters.enabled = shipmentsUpdatesToggle.checked;
      kaUpdateShipmentNotifyVisibility();
    });
  }

  const shipmentRemindersToggle = document.getElementById('ka-notify-shipments-reminders-enabled');
  if (shipmentRemindersToggle) {
    shipmentRemindersToggle.addEventListener('change', () => {
      kaShipmentNotifyPref.enabled = shipmentRemindersToggle.checked;
      if (!kaShipmentNotifyPref.enabled) {
        kaShipmentNotifyPref.notify_time = '';
      }
      kaUpdateShipmentNotifyVisibility();
      kaStartNotifyTimer(true);
    });
  }

  const shipmentTimeEl = document.getElementById('ka-notify-shipments-time');
  if (shipmentTimeEl) {
    shipmentTimeEl.addEventListener('change', () => {
      kaShipmentNotifyPref.notify_time = shipmentTimeEl.value || KA_SHIPMENT_NOTIFY_DEFAULT.notify_time;
      kaReminderTimestamps = {};
      kaStartNotifyTimer(true);
    });
  }

  const shipmentEveryEl = document.getElementById('ka-notify-shipments-every-days');
  if (shipmentEveryEl) {
    shipmentEveryEl.addEventListener('change', () => {
      const val = Number(shipmentEveryEl.value) || 1;
      kaShipmentNotifyPref.remind_every_days = val > 0 ? val : 1;
      kaReminderTimestamps = {};
      kaStartNotifyTimer(true);
    });
  }

  const timeToggle = document.getElementById('ka-notify-time-enabled');
  if (timeToggle) {
    timeToggle.addEventListener('change', () => {
      kaNotificationPrefs.time_filters.enabled = timeToggle.checked;
      kaSetNotifyGroupDisabled(
        document.getElementById('ka-notify-time-events'),
        !timeToggle.checked
      );
    });
  }

  const payrollToggle = document.getElementById('ka-notify-payroll-enabled');
  if (payrollToggle) {
    payrollToggle.addEventListener('change', () => {
      kaNotificationPrefs.payroll_filters.enabled = payrollToggle.checked;
      kaSetNotifyGroupDisabled(
        document.getElementById('ka-notify-payroll-events'),
        !payrollToggle.checked
      );
    });
  }

  const dailyToggle = document.getElementById('ka-notify-daily-enabled');
  if (dailyToggle) {
    dailyToggle.addEventListener('change', () => {
      const body = document.getElementById('ka-notify-daily-body');
      if (body) body.classList.toggle('hidden', !dailyToggle.checked);
    });
  }

  const clockToggle = document.getElementById('ka-notify-clockout-enabled');
  if (clockToggle) {
    clockToggle.addEventListener('change', () => {
      kaNotificationPrefs.clockout_enabled = clockToggle.checked;
      kaClockoutAlertedDay = '';
      const clockBody = document.getElementById('ka-notify-clockout-body');
      if (clockBody) clockBody.classList.toggle('hidden', !clockToggle.checked);
      kaStartNotifyTimer(true);
    });
  }

  const clockoutTimeEl = document.getElementById('ka-notify-clockout-time');
  if (clockoutTimeEl) {
    clockoutTimeEl.addEventListener('change', () => {
      const val = clockoutTimeEl.value || KA_NOTIFICATION_PREF_DEFAULT.clockout_time;
      kaNotificationPrefs.clockout_time = val;
      kaClockoutAlertedDay = '';
      kaStartNotifyTimer(true);
    });
  }

  const dailyTimeEl = document.getElementById('ka-notify-daily-time');
  if (dailyTimeEl) {
    dailyTimeEl.addEventListener('change', () => {
      kaNotificationPrefs.remind_time = dailyTimeEl.value || KA_SHIPMENT_NOTIFY_DEFAULT.notify_time;
    });
  }

  const dailyEveryEl = document.getElementById('ka-notify-daily-every');
  if (dailyEveryEl) {
    dailyEveryEl.addEventListener('change', () => {
      const val = Number(dailyEveryEl.value) || 1;
      kaNotificationPrefs.remind_every_days = val > 0 ? val : 1;
    });
  }

  const emailToggle = document.getElementById('ka-notify-email-enabled');
  if (emailToggle) {
    emailToggle.addEventListener('change', () => {
      kaNotificationPrefs.email_enabled = emailToggle.checked;
    });
  }

  const pushToggle = document.getElementById('ka-notify-push-enabled');
  if (pushToggle) {
    pushToggle.addEventListener('change', () => {
      kaNotificationPrefs.push_enabled = pushToggle.checked;
    });
  }

  const pushSubscribeBtn = document.getElementById('ka-notify-push-subscribe');
  if (pushSubscribeBtn) {
    pushSubscribeBtn.addEventListener('click', kaSubscribeToPush);
  }
  const pushUnsubscribeBtn = document.getElementById('ka-notify-push-unsubscribe');
  if (pushUnsubscribeBtn) {
    pushUnsubscribeBtn.addEventListener('click', kaUnsubscribeFromPush);
  }

  const saveBtn = document.getElementById('ka-notify-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const shipmentPayload = kaCollectShipmentNotifyPrefsFromUI();
      const notificationPayload = kaCollectNotificationPrefsFromUI();
      try {
        await kaSaveNotificationsToServer({
          notificationPrefs: notificationPayload,
          shipmentPrefs: shipmentPayload
        });
        kaApplyNotificationPrefsToUI(kaNotificationPrefs);
        kaApplyShipmentNotifyPrefToUI(kaShipmentNotifyPref, kaNotifyStatusesSource());
        kaReminderTimestamps = {};
        kaNotifiedShipments = new Set();
        kaClockoutAlertedDay = '';
        await kaStartNotifyTimer(true);
        if (!navigator.onLine) {
          kaSetNotifyMessage('Saved offline — will sync when back online.', '#b45309');
        } else {
          kaSetNotifyMessage('Notification settings saved.', 'green');
        }
      } catch (err) {
        kaSetNotifyMessage(err.message || 'Failed to save notification settings.', '#b91c1c');
      }
      const statusMenu = document.getElementById('ka-notify-statuses-menu');
      if (statusMenu) statusMenu.classList.add('hidden');
      const projMenu = document.getElementById('ka-notify-projects-menu');
      if (projMenu) projMenu.classList.add('hidden');
      kaUpdateShipmentNotifyVisibility();
    });
  }

  const testBtn = document.getElementById('ka-notify-test');
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      const tests = [];
      if (kaShipmentNotifyPref.enabled) tests.push(kaTriggerShipmentNotification(true));
      if (kaNotificationPrefs.clockout_enabled) tests.push(kaClockoutAlertCheck(true));
      await kaSendTestNotification();
      if (!tests.length) {
        kaSetNotifyMessage('Test sent. Enable shipment reminders or clock-out alerts for device popups.', '#b45309');
        return;
      }
      Promise.allSettled(tests);
    });
  }

  await kaSyncNotificationPrefsQueue();
  await kaSyncShipmentNotifyPrefsQueue();
  kaStartNotifyTimer(true);
}

function kaPerm(key) {
  return !!kaAccessPerms[key];
}

function kaIsSuperAdmin() {
  const value = kaCurrentAdmin && kaCurrentAdmin.is_super_admin;
  return value === true || value === 1 || value === '1';
}

function kaCanViewShipments() {
  return kaPerm('see_shipments');
}

function kaCanViewTimeReports() {
  return kaPerm('view_time_reports') || kaPerm('view_payroll');
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

function kaCanAssignTimesheets() {
  return kaPerm('assign_timesheets') || kaIsSuperAdmin();
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
  const canTimeNotify = kaCanModifyTime() || kaCanViewTimeReports() || kaCanViewPayroll();
  const canPayrollNotify = kaCanViewPayroll();
  const canShipmentNotify = kaCanViewShipments();
  const canAnyNotify = canShipmentNotify || canTimeNotify || canPayrollNotify;
  if (notifyTile) notifyTile.style.display = canAnyNotify ? '' : 'none';

  const notifyShipSection = document.getElementById('ka-notify-shipments-section');
  if (notifyShipSection) notifyShipSection.style.display = canShipmentNotify ? '' : 'none';
  const notifyTimeSection = document.getElementById('ka-notify-time-section');
  if (notifyTimeSection) notifyTimeSection.style.display = canTimeNotify ? '' : 'none';
  const payrollSection = document.getElementById('ka-notify-payroll-section');
  if (payrollSection) payrollSection.style.display = canPayrollNotify ? '' : 'none';
  const summarySection = document.getElementById('ka-notify-summary-section');
  if (summarySection) summarySection.style.display = (canTimeNotify || canPayrollNotify) ? '' : 'none';
  const clockoutSection = document.getElementById('ka-notify-clockout-section');
  if (clockoutSection) clockoutSection.style.display = canTimeNotify ? '' : 'none';

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

  const rateField = document.querySelector('.ka-employee-rate-field');
  if (rateField) rateField.classList.toggle('hidden', !canRates);

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
    assign_timesheets: false,
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
    assign_timesheets: coerceFlag(admin.assign_timesheets, defaults.assign_timesheets),
    view_payroll: coerceFlag(admin.view_payroll, defaults.view_payroll),
    modify_pay_rates: coerceFlag(admin.modify_pay_rates, defaults.modify_pay_rates)
  };

  if (kaIsSuperAdmin()) {
    nextPerms = {
      ...nextPerms,
      see_shipments: true,
      modify_time: true,
      view_time_reports: true,
      view_all_timesheets: true,
      assign_timesheets: true,
      view_payroll: true,
      modify_pay_rates: true
    };
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

function kaAccountAuthMessage(err) {
  const raw = err && (err.message || err.error) ? String(err.message || err.error) : '';
  const msg = raw.trim();
  if (/no login account/i.test(msg)) {
    return 'No login account is linked to this admin. Ask a super admin to create one.';
  }
  if (/login is disabled/i.test(msg)) {
    return 'Login is disabled for this account.';
  }
  if (/desktop access/i.test(msg)) {
    return 'Desktop access is required to update login details.';
  }
  if (/not authenticated|not authorized|admin privileges required/i.test(msg)) {
    return 'Sign in as a kiosk admin to update your account.';
  }
  return msg || 'Unable to load account.';
}

function kaUpdateAccountProfile({ employee, email } = {}) {
  const nameEl = document.getElementById('ka-account-name');
  const emailEl = document.getElementById('ka-account-email');
  const photoEl = document.getElementById('ka-account-photo');
  const initialsEl = document.getElementById('ka-account-initials');
  const resolved = employee || kaCurrentAdmin || null;
  const displayName = resolved?.nickname || resolved?.name || 'My account';
  if (nameEl) nameEl.textContent = displayName;
  if (emailEl) {
    const label = (email || resolved?.email || '').trim();
    emailEl.textContent = label || '—';
  }
  kaApplyEmployeeAvatar({
    imgEl: photoEl,
    initialsEl,
    employeeId: resolved?.id,
    uploadedAt: resolved?.employee_photo_uploaded_at,
    name: displayName
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
  kaUpdateAccountProfile({ employee: kaCurrentAdmin });

  try {
    const me = await fetchJSON('/api/kiosk/admin/account');
    kaAccountAuthed = !!me?.ok;
    if (emailCurrent) {
      emailCurrent.value = me?.user?.email || '';
    }
    const employeeId = me?.employee?.id;
    const employee = employeeId
      ? (kaFindEmployeeById(employeeId) || { id: employeeId, name: me?.employee?.name || '' })
      : kaCurrentAdmin;
    kaUpdateAccountProfile({ employee, email: me?.user?.email || '' });
    kaSetInlineStatus(authStatusEl, '');
    kaSetAccountDisabled(!kaAccountAuthed);
  } catch (err) {
    kaAccountAuthed = false;
    if (emailCurrent) emailCurrent.value = '';
    kaSetInlineStatus(authStatusEl, kaAccountAuthMessage(err), 'error');
    kaSetAccountDisabled(true);
    kaUpdateAccountProfile({ employee: kaCurrentAdmin });
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
        const res = await fetchJSON('/api/kiosk/admin/account/email', {
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
        kaUpdateAccountProfile({ employee: kaCurrentAdmin, email: updatedEmail });
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
        await fetchJSON('/api/kiosk/admin/account/password', {
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

function kaFmtDateTimeMDY(input) {
  if (!input) return '';
  const dt = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(dt.getTime())) return '';
  const datePart = kaFmtDateMDY(dt);
  const timePart = dt.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  return `${datePart}, ${timePart}`;
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
  return kaFmtDateMDY(input);
}

function kaFmtDateLong(input) {
  return kaFmtDateMDY(input);
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

function kaCurrentShipmentsHeaderLabel() {
  const select = document.getElementById('ka-shipments-filter');
  if (!select) return '';
  const option = select.options[select.selectedIndex];
  if (!option) return '';
  return (option.textContent || '').trim();
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
    const label = kaCurrentShipmentsHeaderLabel();
    title = label ? `Shipments – ${label}` : 'Shipments';
  } else if (current === 'time') {
    title = 'Time Entries';
  } else if (current === 'employees') {
    title = 'Employees';
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
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: kaOrgTimezone || KA_DEFAULT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = fmt.formatToParts(dt);
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const d = parts.find(p => p.type === 'day')?.value;
    if (y && m && d) return `${m}/${d}/${y}`;
  } catch (err) {
    console.warn('Falling back to local date for kaFmtDateLongTZ:', err);
    return kaFmtDateMDY(dt);
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
  const source = entry.payload && entry.payload.source ? String(entry.payload.source) : 'time_entry';
  const remaining = queue.filter(item => {
    const itemId = Number(item.exception_id);
    const itemSource = item && item.payload && item.payload.source
      ? String(item.payload.source)
      : 'time_entry';
    return !(itemId === id && itemSource === source);
  });
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
    punch_exception_unresolved: 0,
    punch_exception_ids: [],
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
          minute: '2-digit',
          hour12: true
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
            minute: '2-digit',
            hour12: true
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
      const initials = kaInitialsFromName(r.employee_name || 'Employee') || '?';
      const empRecord = r.employee_id ? kaFindEmployeeById(r.employee_id) : null;
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
          <img class="ka-live-photo hidden" alt="" />
          <span class="ka-live-initials">${initials}</span>
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

      const photoEl = item.querySelector('.ka-live-photo');
      const initialsEl = item.querySelector('.ka-live-initials');
      kaApplyEmployeeAvatar({
        imgEl: photoEl,
        initialsEl,
        employeeId: r.employee_id,
        uploadedAt: empRecord?.employee_photo_uploaded_at,
        initials
      });

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

function kaSetTimeReportVisible(show) {
  const report = document.getElementById('ka-time-report');
  if (report) report.classList.toggle('hidden', !show);
}

function kaSyncLiveCountPill() {
  const pill = document.getElementById('ka-live-count-tag');
  if (!pill) return;
  const leftSlot = document.getElementById('ka-live-controls-left');
  if (leftSlot && pill.parentElement !== leftSlot) {
    leftSlot.appendChild(pill);
  }
}

function kaSetEmployeeFormVisible(nextVisible, { skipScroll = false } = {}) {
  const form = document.getElementById('ka-employee-add-form');
  const toggleBtn = document.getElementById('ka-employee-add-cta');
  const card = document.getElementById('ka-employee-add-card');
  const statusEl = document.getElementById('ka-helper-status');
  if (!form || !toggleBtn || !card) return;
  kaEmployeeFormVisible = !!nextVisible;
  form.classList.toggle('hidden', !kaEmployeeFormVisible);
  card.classList.toggle('hidden', !kaEmployeeFormVisible);
  toggleBtn.textContent = kaEmployeeFormVisible ? 'Close' : '+ New Employee';
  toggleBtn.setAttribute('aria-expanded', String(kaEmployeeFormVisible));
  if (statusEl && !kaEmployeeFormVisible) {
    statusEl.textContent = '';
    statusEl.className = 'ka-status';
  }
  if (kaEmployeeFormVisible && !skipScroll) {
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function kaNormalizeEmployees(rows) {
  return (rows || []).map(e => ({
    ...e,
    is_admin: !!e.kiosk_admin_access,
    is_super_admin: e.is_super_admin === true || e.is_super_admin === 1 || e.is_super_admin === '1'
  }));
}

function kaFindEmployeeById(id) {
  if (!id) return null;
  return (kaEmployees || []).find(e => Number(e.id) === Number(id)) || null;
}

function kaUpdateEmployeeRecord(id, updates = {}) {
  const emp = kaFindEmployeeById(id);
  if (!emp) return null;
  Object.assign(emp, updates);
  if (kaCurrentAdmin && Number(kaCurrentAdmin.id) === Number(id)) {
    Object.assign(kaCurrentAdmin, updates);
  }
  return emp;
}

function kaEmployeeDateLabel(value) {
  const label = kaFmtDateLong(value);
  return label || 'Not set';
}

function kaEmployeeInitials(name) {
  const text = (name || '').toString().trim();
  if (!text) return '—';
  const parts = text.split(/\s+/).filter(Boolean);
  const first = parts[0] ? parts[0][0] : '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase() || '—';
}

function kaEmployeeDateInputValue(value) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function kaSetEmployeeDateInput(el, value) {
  if (!el) return;
  const normalized = kaEmployeeDateInputValue(value);
  if (el instanceof HTMLInputElement) {
    el.value = normalized;
  } else {
    el.textContent = normalized || 'Not set';
  }
}

function kaSetEmployeeFieldValue(el, value, placeholder = 'Not set') {
  if (!el) return;
  const text = value == null ? '' : String(value).trim();
  const isEmpty = !text || text.toLowerCase() === 'not set';
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.value = isEmpty ? '' : text;
    el.placeholder = isEmpty ? placeholder : '';
  } else {
    el.textContent = isEmpty ? placeholder : text;
  }
}

function kaEmployeeAuthParams() {
  const params = new URLSearchParams();
  const adminId = kaAdminAuthId() || (kaStartEmployeeId ? Number(kaStartEmployeeId) : null);
  if (adminId) params.set('admin_id', adminId);
  const deviceSecret = kaGetDeviceSecret();
  if (kaDeviceId && deviceSecret) {
    params.set('device_id', kaDeviceId);
    params.set('device_secret', deviceSecret);
  }
  return params;
}

function kaEmployeeAuthMeta() {
  const adminId = kaAdminAuthId() || (kaStartEmployeeId ? Number(kaStartEmployeeId) : null);
  return {
    admin_id: adminId || null,
    device_id: kaDeviceId || null,
    device_secret: kaGetDeviceSecret() || null
  };
}

function kaAppendEmployeeAuth(url) {
  const params = kaEmployeeAuthParams();
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

function kaEmployeeDocUrl(employeeId, kind) {
  if (!employeeId || !kind) return '#';
  const base = `/api/kiosk/admin/employees/${encodeURIComponent(employeeId)}/${kind}`;
  return kaAppendEmployeeAuth(base);
}

function kaEmployeePhotoSrc(employeeId, uploadedAt) {
  if (!employeeId || !uploadedAt) return '';
  const base = kaEmployeeDocUrl(employeeId, 'photo');
  if (!base || base === '#') return '';
  const cacheBust = encodeURIComponent(uploadedAt);
  return `${base}${base.includes('?') ? '&' : '?'}v=${cacheBust}`;
}

function kaBindAvatarImage(imgEl, initialsEl) {
  if (!imgEl || imgEl.dataset.bound) return;
  imgEl.addEventListener('load', () => {
    imgEl.classList.remove('hidden');
    if (initialsEl) initialsEl.classList.add('hidden');
  });
  imgEl.addEventListener('error', () => {
    imgEl.classList.add('hidden');
    if (initialsEl) initialsEl.classList.remove('hidden');
  });
  imgEl.dataset.bound = '1';
}

function kaApplyEmployeeAvatar({ imgEl, initialsEl, employeeId, uploadedAt, name, initials }) {
  if (initialsEl) {
    if (initials != null) {
      initialsEl.textContent = initials;
    } else if (name != null) {
      initialsEl.textContent = kaEmployeeInitials(name);
    }
  }
  if (!imgEl) return;
  const src = kaEmployeePhotoSrc(employeeId, uploadedAt);
  if (src) {
    imgEl.classList.add('hidden');
    imgEl.src = src;
    if (initialsEl) initialsEl.classList.remove('hidden');
  } else {
    imgEl.removeAttribute('src');
    imgEl.classList.add('hidden');
    if (initialsEl) initialsEl.classList.remove('hidden');
  }
  kaBindAvatarImage(imgEl, initialsEl);
}

function kaEmployeeDocCardTypeLabel(doc = {}) {
  const rawType = (doc.doc_type || doc.type || '').toString().toLowerCase();
  const label = (doc.doc_label || '').toString().trim();
  if (rawType === 'photo') return 'Photo';
  if (rawType === 'id') return label || 'ID';
  if (rawType === 'worker_authorization' || rawType === 'worker authorization') {
    return 'Worker Authorization';
  }
  if (rawType === 'other') return label || 'Other';
  return label || 'Document';
}

function kaEmployeeHistoryCacheKey(employeeId) {
  return `ka_employee_history_${employeeId}`;
}

function kaCacheEmployeeHistory(employeeId, history = []) {
  if (!employeeId) return;
  kaStoreSet(kaEmployeeHistoryCacheKey(employeeId), history || []);
}

function kaLoadCachedEmployeeHistory(employeeId) {
  if (!employeeId) return [];
  const history = kaStoreGet(kaEmployeeHistoryCacheKey(employeeId), []);
  return Array.isArray(history) ? history : [];
}

function kaUpdateEmployeeHistoryButton(history = []) {
  const els = kaEmployeeSheetElements();
  if (!els || !els.historyBtn) return;
  const hasHistory = Array.isArray(history) && history.length > 0;
  els.historyBtn.classList.toggle('hidden', !hasHistory);
}

async function kaLoadEmployeeHistory(employeeId) {
  if (!employeeId) return [];
  if (!navigator.onLine) {
    const cached = kaLoadCachedEmployeeHistory(employeeId);
    kaEmployeeSheetState.history = cached;
    kaUpdateEmployeeHistoryButton(cached);
    return cached;
  }
  try {
    const url = kaAppendEmployeeAuth(`/api/kiosk/admin/employees/${employeeId}/employment-history`);
    const res = await fetchJSON(url);
    const history = res && Array.isArray(res.history) ? res.history : [];
    kaCacheEmployeeHistory(employeeId, history);
    kaEmployeeSheetState.history = history;
    kaUpdateEmployeeHistoryButton(history);
    return history;
  } catch (err) {
    console.error('Failed to load employee history', err);
    const cached = kaLoadCachedEmployeeHistory(employeeId);
    kaEmployeeSheetState.history = cached;
    kaUpdateEmployeeHistoryButton(cached);
    return cached;
  }
}

function kaEmployeeDocsCacheKey(employeeId) {
  return `ka_employee_docs_cache_${employeeId}`;
}

function kaCacheEmployeeDocs(employeeId, docs = []) {
  if (!employeeId) return;
  kaStoreSet(kaEmployeeDocsCacheKey(employeeId), docs || []);
}

function kaLoadCachedEmployeeDocs(employeeId) {
  if (!employeeId) return [];
  const docs = kaStoreGet(kaEmployeeDocsCacheKey(employeeId), []);
  return Array.isArray(docs) ? docs : [];
}

function kaRenderEmployeeDocsList(docs = []) {
  const els = kaEmployeeSheetElements();
  if (!els || !els.docsList) return;
  const list = Array.isArray(docs) ? docs : [];
  if (!list.length) {
    els.docsList.innerHTML = '<div class="ka-ship-muted">(No documents uploaded)</div>';
    return;
  }
  const items = list.map(doc => {
    const href = kaAppendEmployeeAuth(doc.url || doc.file_path || '#');
    const title = doc.title || doc.filename || doc.label || doc.doc_label || 'Document';
    const typeLabel = kaEmployeeDocCardTypeLabel(doc);
    return `
      <li class="ka-doc-card" data-doc-url="${escapeHTML(href)}" data-doc-name="${escapeHTML(title)}" data-doc-type="${escapeHTML(typeLabel)}">
        <a class="ka-doc-card-link" href="${href}" target="_blank" rel="noopener noreferrer" data-doc-url="${escapeHTML(href)}" data-doc-name="${escapeHTML(title)}" data-doc-type="${escapeHTML(typeLabel)}">${escapeHTML(title)}</a>
        <div class="ka-doc-card-type">Type: ${escapeHTML(typeLabel)}</div>
      </li>
    `;
  });
  els.docsList.innerHTML = `<ul class="ka-docs-card-list">${items.join('')}</ul>`;
}

async function kaLoadEmployeeDocs(employeeId) {
  const els = kaEmployeeSheetElements();
  if (!els || !els.docsList || !employeeId) return;
  if (!navigator.onLine) {
    const cached = kaLoadCachedEmployeeDocs(employeeId);
    if (cached.length) {
      kaRenderEmployeeDocsList(cached);
    } else {
      els.docsList.innerHTML = '<div class="ka-ship-muted">(Offline — connect to load documents)</div>';
    }
    return;
  }
  els.docsList.innerHTML = '<div class="ka-ship-muted">(Loading documents…)</div>';
  try {
    const url = kaAppendEmployeeAuth(`/api/kiosk/admin/employees/${employeeId}/documents`);
    const res = await fetchJSON(url);
    const docs = res && Array.isArray(res.documents) ? res.documents : [];
    kaRenderEmployeeDocsList(docs);
    kaCacheEmployeeDocs(employeeId, docs);
    kaPrefetchEmployeeDocsForOffline(docs);
  } catch (err) {
    console.error('Failed to load employee documents', err);
    els.docsList.innerHTML = '<div class="ka-ship-muted">(Error loading documents)</div>';
  }
}

function kaBindEmployeeDocsUploader() {
  const els = kaEmployeeSheetElements();
  if (!els || !els.docsFileInput || !els.docsType || !els.docsUpload || els.docsUpload.dataset.bound) {
    return;
  }
  els.docsUpload.dataset.bound = '1';

  if (els.docsChoose) {
    els.docsChoose.addEventListener('click', () => {
      els.docsFileInput.click();
    });
  }

  const updateTypeVisibility = () => {
    const value = els.docsType.value || '';
    const showLabel = value === 'Other';
    if (els.docsLabelWrap) els.docsLabelWrap.hidden = !showLabel;
    if (els.docsLabel && !showLabel) els.docsLabel.value = '';
    if (els.docsFileInput) {
      if (value === 'Photo') {
        els.docsFileInput.accept = 'image/*';
      } else if (value === 'ID') {
        els.docsFileInput.accept = 'image/*,application/pdf';
      } else {
        els.docsFileInput.accept = 'image/*,application/pdf';
      }
    }
  };

  els.docsType.addEventListener('change', updateTypeVisibility);
  updateTypeVisibility();

  els.docsFileInput.addEventListener('change', () => {
    const file = els.docsFileInput.files && els.docsFileInput.files[0];
    if (els.docsFileName) {
      els.docsFileName.textContent = file ? file.name : '';
    }
  });

  els.docsUpload.addEventListener('click', () => kaHandleEmployeeDocUpload());
}

function kaBindEmployeeDocsViewer() {
  const els = kaEmployeeSheetElements();
  if (!els || !els.docsList || els.docsList.dataset.bound) return;
  els.docsList.addEventListener('click', (event) => {
    const link = event.target.closest('.ka-doc-card-link');
    if (!link) return;
    const url = link.getAttribute('data-doc-url') || link.getAttribute('href') || '';
    if (!url || url === '#') return;
    event.preventDefault();
    const name = link.getAttribute('data-doc-name') || link.textContent || 'Document';
    const type = link.getAttribute('data-doc-type') || '';
    kaOpenDocViewer({ url, name, type });
  });
  els.docsList.dataset.bound = '1';
}

function kaBindEmployeeHistoryModal() {
  const backdrop = document.getElementById('ka-employee-history-backdrop');
  if (!backdrop || backdrop.dataset.bound) return;
  const closeBtn = document.getElementById('ka-employee-history-close');
  const closeBtnAlt = document.getElementById('ka-employee-history-close-btn');
  const close = () => kaCloseEmployeeHistoryModal();
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
  backdrop.dataset.bound = '1';
}

async function kaHandleEmployeeDocUpload() {
  const els = kaEmployeeSheetElements();
  if (!els || !els.docsFileInput || !els.docsType || !els.docsStatus) return;
  const id = kaEmployeeSheetState.employeeId;
  if (!id) {
    kaSetInlineStatus(els.docsStatus, 'Employee not selected.', 'error');
    return;
  }
  const type = (els.docsType.value || '').trim();
  if (!type) {
    kaSetInlineStatus(els.docsStatus, 'Select a document type.', 'error');
    return;
  }
  const file = els.docsFileInput.files && els.docsFileInput.files[0];
  if (!file) {
    kaSetInlineStatus(els.docsStatus, 'Choose a file to upload.', 'error');
    return;
  }
  const label = (els.docsLabel && els.docsLabel.value ? els.docsLabel.value : '').trim();
  if (type === 'Other' && !label) {
    kaSetInlineStatus(els.docsStatus, 'Enter a label for Other documents.', 'error');
    return;
  }

  const form = new FormData();
  form.append('doc_type', type);
  if (label) form.append('doc_label', label);
  const auth = kaEmployeeAuthMeta();
  if (auth.admin_id) form.append('admin_id', String(auth.admin_id));
  if (auth.device_id) form.append('device_id', String(auth.device_id));
  if (auth.device_secret) form.append('device_secret', String(auth.device_secret));

  let endpoint = `/api/kiosk/admin/employees/${id}/documents`;
  if (type === 'Photo') {
    endpoint = `/api/kiosk/admin/employees/${id}/photo`;
    form.append('employee_photo', file);
  } else if (type === 'ID') {
    endpoint = `/api/kiosk/admin/employees/${id}/id-document`;
    form.append('id_document', file);
  } else {
    form.append('documents', file);
  }

  if (!navigator.onLine) {
    try {
      await kaQueueEmployeeDocUpload({
        employeeId: id,
        type,
        label,
        file,
        auth
      });
      if (els.docsFileInput) els.docsFileInput.value = '';
      if (els.docsFileName) els.docsFileName.textContent = '';
      if (els.docsType) els.docsType.value = '';
      if (els.docsLabel) els.docsLabel.value = '';
      if (els.docsLabelWrap) els.docsLabelWrap.hidden = true;
      kaSetInlineStatus(els.docsStatus, 'Saved offline. Will sync when online.', 'ok');
    } catch (err) {
      console.error('Employee doc queue failed', err);
      kaSetInlineStatus(els.docsStatus, err.message || 'Unable to save document offline.', 'error');
    }
    return;
  }

  kaSetInlineStatus(els.docsStatus, 'Uploading document…');
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      body: form,
      credentials: 'include',
      headers: kaGetCsrfHeader()
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Upload failed.');
    }

    if (els.docsFileInput) els.docsFileInput.value = '';
    if (els.docsFileName) els.docsFileName.textContent = '';
    if (els.docsType) els.docsType.value = '';
    if (els.docsLabel) els.docsLabel.value = '';
    if (els.docsLabelWrap) els.docsLabelWrap.hidden = true;
    kaSetInlineStatus(els.docsStatus, 'Document uploaded.', 'ok');
    kaLoadEmployeeDocs(id);
    kaRefreshEmployeeSheet();
  } catch (err) {
    console.error('Employee doc upload failed', err);
    const offlineLikely = kaIsConnectionIssue(err);
    if (offlineLikely) {
      try {
        await kaQueueEmployeeDocUpload({
          employeeId: id,
          type,
          label,
          file,
          auth
        });
        if (els.docsFileInput) els.docsFileInput.value = '';
        if (els.docsFileName) els.docsFileName.textContent = '';
        if (els.docsType) els.docsType.value = '';
        if (els.docsLabel) els.docsLabel.value = '';
        if (els.docsLabelWrap) els.docsLabelWrap.hidden = true;
        kaSetInlineStatus(els.docsStatus, 'Saved offline. Will sync when online.', 'ok');
        return;
      } catch (queueErr) {
        console.error('Employee doc queue failed', queueErr);
      }
    }
    kaSetInlineStatus(els.docsStatus, err.message || 'Upload failed.', 'error');
  }
}

function kaEmployeeSheetElements() {
  const sheet = document.getElementById('ka-employee-detail-sheet');
  if (!sheet) return null;
  return {
    sheet,
    panel: sheet.querySelector('.ka-sheet-panel'),
    handle: sheet.querySelector('[data-ka-employee-sheet-handle]'),
    header: sheet.querySelector('.ka-sheet-header'),
    title: sheet.querySelector('#ka-employee-detail-title'),
    sub: sheet.querySelector('#ka-employee-detail-sub'),
    status: sheet.querySelector('#ka-employee-detail-status'),
    profileName: sheet.querySelector('#ka-employee-detail-name'),
    profileState: sheet.querySelector('#ka-employee-detail-state'),
    profileLang: sheet.querySelector('#ka-employee-detail-meta-lang'),
    profileStart: sheet.querySelector('#ka-employee-detail-meta-start'),
    firstName: sheet.querySelector('#ka-employee-detail-first'),
    lastName: sheet.querySelector('#ka-employee-detail-last'),
    nickname: sheet.querySelector('#ka-employee-detail-nickname'),
    email: sheet.querySelector('#ka-employee-detail-email'),
    phone: sheet.querySelector('#ka-employee-detail-phone'),
    startDate: sheet.querySelector('#ka-employee-detail-start'),
    termDate: sheet.querySelector('#ka-employee-detail-term'),
    language: sheet.querySelector('#ka-employee-detail-language'),
    nameChecks: sheet.querySelector('#ka-employee-detail-namechecks'),
    rateField: sheet.querySelector('.ka-employee-rate-field'),
    rateInput: sheet.querySelector('#ka-employee-detail-rate'),
    geofenceToggle: sheet.querySelector('#ka-employee-detail-geofence'),
    reactivateBtn: sheet.querySelector('#ka-employee-detail-reactivate'),
    reactivateNote: sheet.querySelector('#ka-employee-detail-reactivate-note'),
    historyBtn: sheet.querySelector('#ka-employee-detail-history-open'),
    saveBtn: sheet.querySelector('#ka-employee-detail-save'),
    saveStatus: sheet.querySelector('#ka-employee-detail-save-status'),
    docsList: sheet.querySelector('#ka-employee-docs-list'),
    docsChoose: sheet.querySelector('#ka-employee-docs-upload-choose'),
    docsFileInput: sheet.querySelector('#ka-employee-docs-upload-files'),
    docsFileName: sheet.querySelector('#ka-employee-docs-upload-filename'),
    docsType: sheet.querySelector('#ka-employee-docs-upload-type'),
    docsLabelWrap: sheet.querySelector('#ka-employee-docs-upload-label-wrap'),
    docsLabel: sheet.querySelector('#ka-employee-docs-upload-label'),
    docsUpload: sheet.querySelector('#ka-employee-docs-upload-btn'),
    docsStatus: sheet.querySelector('#ka-employee-docs-upload-status'),
    photoImg: sheet.querySelector('#ka-employee-detail-photo'),
    photoInitials: sheet.querySelector('#ka-employee-detail-initials'),
    photoInput: sheet.querySelector('#ka-employee-detail-photo-input'),
    photoBtn: sheet.querySelector('#ka-employee-detail-photo-btn'),
    photoStatus: sheet.querySelector('#ka-employee-detail-photo-status')
  };
}

function kaEmployeePinSheetElements() {
  const sheet = document.getElementById('ka-employee-pin-sheet');
  if (!sheet) return null;
  return {
    sheet,
    panel: sheet.querySelector('.ka-sheet-panel'),
    handle: sheet.querySelector('[data-ka-employee-pin-handle]'),
    header: sheet.querySelector('.ka-sheet-header'),
    title: sheet.querySelector('#ka-employee-pin-title'),
    sub: sheet.querySelector('#ka-employee-pin-sub'),
    pinInput: sheet.querySelector('#ka-employee-pin-input'),
    pinConfirm: sheet.querySelector('#ka-employee-pin-confirm'),
    pinSave: sheet.querySelector('#ka-employee-pin-save'),
    pinStatus: sheet.querySelector('#ka-employee-pin-status')
  };
}

function kaTimeDetailSheetElements() {
  const sheet = document.getElementById('ka-time-detail-sheet');
  if (!sheet) return null;
  return {
    sheet,
    panel: sheet.querySelector('.ka-sheet-panel'),
    header: sheet.querySelector('.ka-sheet-header'),
    title: sheet.querySelector('#ka-time-detail-title'),
    sub: sheet.querySelector('#ka-time-detail-sub'),
    photo: sheet.querySelector('#ka-time-detail-photo'),
    initials: sheet.querySelector('#ka-time-detail-initials'),
    summary: sheet.querySelector('#ka-time-detail-summary'),
    meta: sheet.querySelector('#ka-time-detail-meta'),
    actions: sheet.querySelector('#ka-time-detail-actions'),
    handle: sheet.querySelector('[data-ka-time-detail-handle]')
  };
}

function kaTimeReportSheetElements() {
  const sheet = document.getElementById('ka-time-report-sheet');
  if (!sheet) return null;
  return {
    sheet,
    panel: sheet.querySelector('.ka-sheet-panel'),
    header: sheet.querySelector('.ka-sheet-header'),
    title: sheet.querySelector('#ka-time-report-sheet-title'),
    sub: sheet.querySelector('#ka-time-report-sheet-sub'),
    handle: sheet.querySelector('[data-ka-time-report-handle]')
  };
}

function kaTimeCalendarSheetElements() {
  const sheet = document.getElementById('ka-time-calendar-sheet');
  if (!sheet) return null;
  return {
    sheet,
    panel: sheet.querySelector('.ka-sheet-panel'),
    header: sheet.querySelector('.ka-sheet-header'),
    title: sheet.querySelector('#ka-time-calendar-sheet-title'),
    sub: sheet.querySelector('#ka-time-calendar-sheet-sub'),
    status: sheet.querySelector('#ka-time-calendar-sheet-status'),
    cards: sheet.querySelector('#ka-time-calendar-sheet-cards'),
    empty: sheet.querySelector('#ka-time-calendar-sheet-empty'),
    handle: sheet.querySelector('[data-ka-time-calendar-handle]')
  };
}

function kaPopulateTimeDetailSheet(entry) {
  const els = kaTimeDetailSheetElements();
  if (!els || !entry) return;

  const emp = entry.employee_name || '(Unknown)';
  const proj = entry.project_name || '(No project)';
  const dateValue = entry.start_date || entry.end_date || '';
  const dateLabel = dateValue ? kaFmtDateLong(dateValue) : '—';
  const startLabel = entry.start_time ? kaFormatTimeValue12(entry.start_time) : '—';
  const endLabel = kaTimeEntryEndLabel(entry);
  const hoursLabel = entry.hours != null ? Number(entry.hours).toFixed(2) : '—';

  if (els.title) {
    els.title.textContent = emp || 'Time entry';
  }
  const empRecord = entry.employee_id ? kaFindEmployeeById(entry.employee_id) : null;
  kaApplyEmployeeAvatar({
    imgEl: els.photo,
    initialsEl: els.initials,
    employeeId: entry.employee_id,
    uploadedAt: empRecord?.employee_photo_uploaded_at,
    name: emp
  });
  if (els.sub) {
    const subParts = [];
    if (proj) subParts.push(proj);
    if (dateLabel) subParts.push(dateLabel);
    els.sub.textContent = subParts.join(' • ');
  }

  if (els.summary) {
    const payParts = [];
    if (kaCanViewPayroll() && entry.total_pay != null) {
      let rateValue = null;
      const rateRaw = entry.rate ?? entry.pay_rate ?? entry.hourly_rate ?? entry.employee_rate;
      if (rateRaw !== undefined && rateRaw !== null && rateRaw !== '') {
        const parsed = Number(rateRaw);
        if (Number.isFinite(parsed)) rateValue = parsed;
      }
      if (rateValue == null) {
        const empRateRaw = kaFindEmployeeById(entry.employee_id)?.rate;
        if (empRateRaw !== undefined && empRateRaw !== null && empRateRaw !== '') {
          const parsed = Number(empRateRaw);
          if (Number.isFinite(parsed)) rateValue = parsed;
        }
      }
      if (rateValue == null) {
        const hoursNum = Number(entry.hours);
        const totalNum = Number(entry.total_pay);
        if (Number.isFinite(hoursNum) && hoursNum > 0 && Number.isFinite(totalNum)) {
          rateValue = totalNum / hoursNum;
        }
      }
      const rateLabel = rateValue != null ? `${kaFmtMoney(rateValue) || '$0.00'}/hr` : '';
      const totalPayLabel = kaFmtMoney(entry.total_pay) || '$0.00';
      if (rateLabel) {
        payParts.push(`
          <div class="ka-time-detail-item ka-time-detail-item-pay">
            <div class="ka-time-detail-label">Total Pay</div>
            <div class="ka-time-detail-label ka-time-detail-rate-label">Rate</div>
            <div class="ka-time-detail-value ka-time-detail-amount">${totalPayLabel}</div>
            <div class="ka-time-detail-value ka-time-detail-rate">${rateLabel}</div>
          </div>
        `);
      } else {
        payParts.push(`
          <div class="ka-time-detail-item">
            <div class="ka-time-detail-label">Total Pay</div>
            <div class="ka-time-detail-value">${totalPayLabel}</div>
          </div>
        `);
      }
    }
    els.summary.innerHTML = `
      <div class="ka-time-detail-grid">
        <div class="ka-time-detail-item">
          <div class="ka-time-detail-label">Employee</div>
          <div class="ka-time-detail-value">${emp}</div>
        </div>
        <div class="ka-time-detail-item">
          <div class="ka-time-detail-label">Project</div>
          <div class="ka-time-detail-value">${proj}</div>
        </div>
        <div class="ka-time-detail-item">
          <div class="ka-time-detail-label">Date</div>
          <div class="ka-time-detail-value">${dateLabel || '—'}</div>
        </div>
        <div class="ka-time-detail-item">
          <div class="ka-time-detail-label">Clock in</div>
          <div class="ka-time-detail-value">${startLabel}</div>
        </div>
        <div class="ka-time-detail-item">
          <div class="ka-time-detail-label">Clock out</div>
          <div class="ka-time-detail-value">${endLabel}</div>
        </div>
        <div class="ka-time-detail-item">
          <div class="ka-time-detail-label">Hours</div>
          <div class="ka-time-detail-value">${hoursLabel}</div>
        </div>
        ${payParts.join('')}
      </div>
    `;
  }

  if (els.meta) {
    const items = [];
    const addItem = (label, value) => {
      if (!label || value == null || value === '') return;
      items.push(`
        <div class="ka-time-detail-item">
          <div class="ka-time-detail-label">${label}</div>
          <div class="ka-time-detail-value">${value}</div>
        </div>
      `);
    };

    addItem('Status', kaTimeEntryStatusText(entry));
    // Punches row removed per UI simplification request.

    const metaLines = kaEntryDetailMetaList(entry);
    metaLines.forEach((line) => {
      const trimmed = String(line || '').trim();
      if (!trimmed) return;
      if (trimmed.toLowerCase().startsWith('flags:')) {
        const rawFlags = trimmed.replace(/^flags:\s*/i, '') || 'None';
        const flagText = rawFlags.trim();
        const hasFlags = flagText && flagText.toLowerCase() !== 'none';
        if (hasFlags) {
          addItem(
            'Flags',
            `<div class="ka-time-flag-inline">
              <span class="ka-time-flag-text">${escapeHTML(flagText)}</span>
              <button type="button" class="ka-time-flag-trigger" data-ka-time-flag-trigger aria-label="Explain flags">?</button>
            </div>`
          );
        } else {
          addItem('Flags', escapeHTML(flagText || 'None'));
        }
        return;
      }
      if (trimmed.toLowerCase().startsWith('note:')) {
        addItem('Note', trimmed.replace(/^note:\s*/i, ''));
        return;
      }
      if (trimmed.toLowerCase().startsWith('reviewed by')) {
        addItem('Field reviewed by', trimmed.replace(/^reviewed by\s*/i, ''));
        return;
      }
      addItem('Detail', trimmed);
    });

    if (entry._offline) {
      addItem('Sync', 'Queued offline; waiting to sync.');
    }
    if (entry._open) {
      addItem('Clock-out', 'Pending');
    }

    els.meta.innerHTML = items.length
      ? `<div class="ka-time-detail-grid">${items.join('')}</div>`
      : '';

    kaHideTimeFlagBanner();
    const flagTrigger = els.meta.querySelector('[data-ka-time-flag-trigger]');
    if (flagTrigger) {
      flagTrigger.addEventListener('click', () => {
        const banner = document.getElementById('ka-time-detail-flag-banner');
        if (banner && !banner.classList.contains('hidden')) {
          kaHideTimeFlagBanner();
        } else {
          kaShowTimeFlagBanner(entry);
        }
      });
    }
  }

  if (els.actions) {
    const canReview = kaCanModifyTime();
    const isOffline = !!entry._offline;
    const isOpen = !!entry._open;
    const meta = kaTimeEntryMeta(entry);
    if (!canReview) {
      els.actions.innerHTML = '';
    } else if (isOffline) {
      els.actions.innerHTML = '<div class="ka-time-detail-note">Review actions are unavailable while offline.</div>';
    } else if (isOpen) {
      els.actions.innerHTML = `
        <div class="ka-time-detail-actions-row">
          <button class="btn secondary btn-sm" data-ka-time-detail-action="modify">Edit clock-in</button>
        </div>
      `;
    } else {
      const actions = [];
      const needsApprove = meta.isPending;
      if (meta.isRejected) {
        actions.push({
          action: 'approve',
          label: 'Reactivate',
          className: 'btn secondary btn-sm'
        });
      } else if (needsApprove) {
        actions.push({
          action: 'approve',
          label: 'Approve as-is',
          className: 'btn secondary btn-sm'
        });
      }
      actions.push({
        action: 'modify',
        label: 'Modify',
        className: 'btn secondary btn-sm'
      });
      actions.push({
        action: 'send_back',
        label: 'Send back for review',
        className: 'btn secondary btn-sm'
      });
      if (!meta.isRejected) {
        actions.push({
          action: 'reject',
          label: 'Reject',
          className: 'btn danger btn-sm'
        });
      }
      els.actions.innerHTML = actions.length
        ? `
        <div class="ka-time-detail-actions-row">
          ${actions.map(a => (
            `<button class="${a.className}" data-ka-time-detail-action="${a.action}">${a.label}</button>`
          )).join('')}
        </div>
      `
        : '';
    }
  }
}

function kaOpenTimeDetailSheet(entry) {
  const els = kaTimeDetailSheetElements();
  if (!els || !entry) return;
  kaTimeDetailSheetState.entryId = entry.id;
  kaTimeDetailSheetState.entry = entry;
  kaTimeDetailSheetState.open = true;
  kaPopulateTimeDetailSheet(entry);
  els.sheet.classList.remove('hidden');
  requestAnimationFrame(() => {
    els.sheet.classList.add('is-open');
  });
  els.sheet.setAttribute('aria-hidden', 'false');
  document.body.classList.add('ka-modal-open');
  document.documentElement.classList.add('ka-modal-open');
}

function kaCloseTimeDetailSheet() {
  const els = kaTimeDetailSheetElements();
  if (!els) return;
  kaTimeDetailSheetState.dragging = false;
  kaTimeDetailSheetState.open = false;
  kaTimeDetailSheetState.entryId = null;
  kaTimeDetailSheetState.entry = null;
  els.sheet.classList.remove('is-open');
  els.sheet.setAttribute('aria-hidden', 'true');
  if (els.panel) {
    els.panel.style.transform = '';
  }
  els.sheet.classList.remove('dragging');
  kaSyncModalOpenState();
  window.setTimeout(() => {
    if (!els.sheet.classList.contains('is-open')) {
      els.sheet.classList.add('hidden');
    }
    kaSyncModalOpenState();
  }, 260);
}

function kaResetTimeDetailSheetPosition() {
  const els = kaTimeDetailSheetElements();
  if (!els) return;
  kaTimeDetailSheetState.dragging = false;
  els.sheet.classList.remove('dragging');
  if (els.panel) {
    els.panel.style.transform = '';
  }
}

function kaTimeReportSheetSubLabel() {
  const start = document.getElementById('ka-time-start')?.value || '';
  const end = document.getElementById('ka-time-end')?.value || start || '';
  const employeeId = document.getElementById('ka-time-employee')?.value || '';
  const projectId = document.getElementById('ka-time-project')?.value || '';
  const parts = [];
  const rangeLabel = kaTimeReviewRangeLabel(start, end);
  if (rangeLabel) parts.push(rangeLabel);
  const filters = kaTimeReviewFilterLabels({ employeeId, projectId });
  if (filters.length) parts.push(...filters);
  return parts.join(' • ');
}

function kaOpenTimeReportSheet() {
  const els = kaTimeReportSheetElements();
  if (!els) return;
  kaTimeReportSheetState.open = true;
  kaTimeReportSheetState.dragging = false;
  kaTimeReportSheetState.startY = 0;
  kaTimeReportSheetState.currentY = 0;
  if (els.title) els.title.textContent = 'Time entries';
  if (els.sub) els.sub.textContent = kaTimeReportSheetSubLabel();
  els.sheet.classList.remove('hidden');
  requestAnimationFrame(() => {
    els.sheet.classList.add('is-open');
  });
  els.sheet.setAttribute('aria-hidden', 'false');
  kaSyncModalOpenState();
}

function kaCloseTimeReportSheet() {
  const els = kaTimeReportSheetElements();
  if (!els) return;
  kaTimeReportSheetState.dragging = false;
  kaTimeReportSheetState.open = false;
  els.sheet.classList.remove('is-open');
  els.sheet.setAttribute('aria-hidden', 'true');
  if (els.panel) {
    els.panel.style.transform = '';
  }
  els.sheet.classList.remove('dragging');
  kaSyncModalOpenState();
  window.setTimeout(() => {
    if (!els.sheet.classList.contains('is-open')) {
      els.sheet.classList.add('hidden');
      kaSyncModalOpenState();
    }
  }, 260);
}

function kaResetTimeReportSheetPosition() {
  const els = kaTimeReportSheetElements();
  if (!els) return;
  kaTimeReportSheetState.dragging = false;
  els.sheet.classList.remove('dragging');
  if (els.panel) {
    els.panel.style.transform = '';
  }
}

function kaTimeReviewSheetElements() {
  const sheet = document.getElementById('ka-time-review-sheet');
  if (!sheet) return null;
  return {
    sheet,
    panel: sheet.querySelector('.ka-sheet-panel'),
    header: sheet.querySelector('.ka-sheet-header'),
    handle: sheet.querySelector('[data-ka-time-review-handle]'),
    title: sheet.querySelector('#ka-time-review-title'),
    sub: sheet.querySelector('#ka-time-review-sub'),
    count: sheet.querySelector('#ka-time-review-sheet-count'),
    list: sheet.querySelector('#ka-time-review-list'),
    empty: sheet.querySelector('#ka-time-review-empty'),
    status: sheet.querySelector('#ka-time-review-status')
  };
}

function kaTimeEntriesCacheKey(params = {}) {
  const { start = '', end = '', employeeId = '', projectId = '' } = params || {};
  return [start || '', end || '', employeeId || '', projectId || ''].join('|');
}

async function kaRefreshTimePendingCount({ force = false } = {}) {
  if (kaTimePendingGlobalInFlight) return;
  if (!kaCanViewTimeReports()) {
    kaTimePendingGlobalCount = 0;
    kaUpdateTimeSummary({ pending: 0 });
    return;
  }
  const now = Date.now();
  if (!force && kaTimePendingGlobalLastFetched && now - kaTimePendingGlobalLastFetched < 30000) {
    return;
  }
  if (!navigator.onLine) return;
  kaTimePendingGlobalInFlight = true;
  try {
    const deviceSecret = kaGetDeviceSecret();
    const useKioskAuth = kaDeviceId && deviceSecret;
    const endpoint = useKioskAuth
      ? '/api/kiosk/time-entries/pending-count'
      : '/api/time-entries/pending-count';
    const res = await fetchJSON(endpoint);
    const count = Number(res && res.pending != null ? res.pending : 0);
    if (Number.isFinite(count)) {
      kaTimePendingGlobalCount = Math.max(0, count);
      kaTimePendingGlobalLastFetched = now;
      kaUpdateTimeSummary({ pending: kaTimePendingGlobalCount });
    }
  } catch (err) {
    // Keep existing count if the request fails.
  } finally {
    kaTimePendingGlobalInFlight = false;
  }
}

function kaTimeReviewRangeLabel(start, end) {
  if (!start && !end) return '';
  const startLabel = start ? (kaFmtDateShort(start) || start) : '';
  const endLabel = end ? (kaFmtDateShort(end) || end) : '';
  if (start && end && start === end) return startLabel || endLabel;
  if (startLabel && endLabel) return `${startLabel} – ${endLabel}`;
  return startLabel || endLabel || '';
}

function kaSetTimeReviewStatus(message = '', variant = '') {
  const els = kaTimeReviewSheetElements();
  if (!els || !els.status) return;
  els.status.textContent = message || '';
  els.status.className = 'ka-status';
  if (variant === 'error') {
    els.status.classList.add('ka-status-error');
  } else if (variant === 'ok') {
    els.status.classList.add('ka-status-ok');
  }
}

function kaUpdateTimeReviewSheetCounts(count = null) {
  const els = kaTimeReviewSheetElements();
  if (!els) return;
  const pending = Number.isFinite(count)
    ? count
    : Number(kaTimeReviewSheetState.pendingCount || 0);
  if (els.count) els.count.textContent = String(pending);
  if (els.empty) {
    els.empty.classList.toggle('hidden', pending !== 0);
  }
  if (els.list) {
    els.list.classList.toggle('hidden', pending === 0);
  }
}

function kaTimeReviewFilterLabels(params = {}) {
  const labels = [];
  if (params.employeeId) {
    const emp = kaFindEmployeeById(params.employeeId);
    if (emp) labels.push(emp.nickname || emp.name || 'Employee');
  }
  if (params.projectId) {
    const proj = (kaProjects || []).find(p => String(p.id) === String(params.projectId));
    if (proj) labels.push(proj.name || 'Project');
  }
  return labels;
}

function kaSetTimeEntriesCache({ key, pendingEntries = [], summaryCounts = {}, params = {} } = {}) {
  if (!key) return;
  kaTimeEntriesCache = {
    key,
    pendingEntries: Array.isArray(pendingEntries) ? pendingEntries : [],
    summaryCounts: summaryCounts || {},
    params,
    fetchedAt: Date.now()
  };
}

function kaRenderTimeReviewList(entries = [], params = {}) {
  const els = kaTimeReviewSheetElements();
  if (!els) return;
  const list = Array.isArray(entries) ? entries : [];
  kaTimeReviewSheetState.entries = list.slice();
  kaTimeReviewSheetState.pendingCount = kaTimeReviewSheetState.entries.length;
  kaTimeReviewSheetState.params = params || null;

  if (els.list) {
    els.list.replaceChildren();
    kaTimeReviewSheetState.entries.forEach(entry => {
      const row = kaBuildTimeReviewRow(entry);
      if (row) els.list.appendChild(row);
    });
  }

  const filterLabels = kaTimeReviewFilterLabels(params);
  const subParts = [];
  if (params && params.scope === 'all') {
    subParts.push('All dates');
  } else {
    const rangeLabel = kaTimeReviewRangeLabel(params.start, params.end);
    if (rangeLabel) subParts.push(rangeLabel);
  }
  if (filterLabels.length) subParts.push(...filterLabels);
  if (els.sub) {
    els.sub.textContent = subParts.join(' • ');
  }

  kaUpdateTimeReviewSheetCounts(kaTimeReviewSheetState.pendingCount);
  kaUpdateTimeSummary({ pending: kaTimeReviewSheetState.pendingCount });
}

function kaSetTimeReviewRowStatus(row, message = '', variant = '') {
  if (!row) return;
  const status = row.querySelector('[data-ka-time-review-status]');
  if (!status) return;
  status.textContent = message || '';
  status.classList.remove('is-error');
  if (variant === 'error') status.classList.add('is-error');
}

function kaRemoveTimeReviewRow(row) {
  if (!row) return;
  row.classList.add('show-approve');
  row.classList.add('is-removing');
  const cleanup = () => {
    if (row && row.parentElement) row.remove();
  };
  row.addEventListener('transitionend', cleanup, { once: true });
  window.setTimeout(cleanup, 260);
}

function kaApplyTimeReviewRemoval(entryId, row) {
  const idNum = Number(entryId);
  if (!Number.isFinite(idNum)) return;
  const sheetEntries = Array.isArray(kaTimeReviewSheetState.entries)
    ? kaTimeReviewSheetState.entries
    : [];
  const nextEntries = sheetEntries.filter(e => Number(e.id) !== idNum);
  const hasSheetEntries = kaTimeReviewSheetState.open || sheetEntries.length > 0;
  if (hasSheetEntries) {
    kaTimeReviewSheetState.entries = nextEntries;
    kaTimeReviewSheetState.pendingCount = nextEntries.length;
  }
  if (kaTimeReviewSheetState.open) {
    kaTimeReviewSheetState.needsRefresh = true;
  }

  if (kaTimeEntriesCache && kaTimeEntriesCache.key) {
    const pendingEntries = Array.isArray(kaTimeEntriesCache.pendingEntries)
      ? kaTimeEntriesCache.pendingEntries.filter(e => Number(e.id) !== idNum)
      : [];
    const summaryCounts = { ...(kaTimeEntriesCache.summaryCounts || {}) };
    summaryCounts.pending = pendingEntries.length;
    kaSetTimeEntriesCache({
      key: kaTimeEntriesCache.key,
      pendingEntries,
      summaryCounts,
      params: kaTimeEntriesCache.params || {}
    });
  }

  if (Number.isFinite(kaTimePendingGlobalCount)) {
    kaTimePendingGlobalCount = Math.max(0, kaTimePendingGlobalCount - 1);
  }

  let pendingCount = null;
  if (hasSheetEntries) {
    pendingCount = kaTimeReviewSheetState.pendingCount;
  } else if (kaTimeEntriesCache && Array.isArray(kaTimeEntriesCache.pendingEntries)) {
    pendingCount = kaTimeEntriesCache.pendingEntries.length;
  } else {
    pendingCount = Number(kaTimeReviewSheetState.pendingCount || 0);
  }
  kaUpdateTimeSummary({ pending: pendingCount });
  if (kaTimeReviewSheetState.open) {
    kaUpdateTimeReviewSheetCounts(pendingCount);
  }

  if (kaTimeReviewSheetState.open && row) {
    kaRemoveTimeReviewRow(row);
  } else if (kaTimeReviewSheetState.open) {
    kaRenderTimeReviewList(nextEntries, kaTimeReviewSheetState.params || {});
  }
}

function kaBuildTimeReviewRow(entry) {
  if (!entry) return null;
  const row = document.createElement('div');
  row.className = 'ka-time-review-row';
  row.dataset.entryId = entry.id;
  row._entry = entry;

  const emp = entry.employee_name || '(Unknown)';
  const proj = entry.project_name || '(No project)';
  const dateLabel = entry.start_date || entry.end_date || '';
  const dateDisplay = dateLabel ? kaFmtDateMDY(dateLabel) : '';
  const startLabel = entry.start_time ? kaFormatTimeValue12(entry.start_time) : '—';
  const endLabel = kaTimeEntryEndLabel(entry);
  const hoursLabel = entry.hours != null ? Number(entry.hours).toFixed(2) : '0.00';
  const issues = kaTimeReviewIssues(entry);
  const issuesHtml = issues.length
    ? `<div class="ka-time-review-issues">${issues.map((issue) => {
        const label = issue && issue.label ? String(issue.label) : '';
        const help = issue && issue.help ? String(issue.help) : '';
        const tooltipAttr = help ? ` data-tooltip="${escapeHTML(help)}"` : '';
        const aria = help
          ? ` aria-label="${escapeHTML(`${label}. ${help}`)}"`
          : ` aria-label="${escapeHTML(label)}"`;
        return `<button type="button" class="ka-time-review-issue"${tooltipAttr}${aria} title="${escapeHTML(help || label)}">${escapeHTML(label)}</button>`;
      }).join('')}</div>`
    : '';
  const statusLabel = kaTimeEntryStatusLabel(entry);
  const noteValue = '';
  const disabled = entry._offline || entry._open || !kaCanModifyTime() || !kaCanViewTimeReports();

  row.innerHTML = `
    <div class="ka-time-review-swipe">
      <div class="ka-time-review-swipe-main">
        <div class="ka-time-review-head">
          <div class="ka-time-review-employee">${escapeHTML(emp)}</div>
          ${statusLabel}
        </div>
        <div class="ka-time-review-sub">${escapeHTML(proj)}${dateDisplay ? ` • ${escapeHTML(dateDisplay)}` : ''}</div>
        <div class="ka-time-review-meta">${escapeHTML(startLabel)} – ${escapeHTML(endLabel)} · ${escapeHTML(hoursLabel)}h</div>
        ${issuesHtml}
        <input type="text" class="ka-time-review-note" data-ka-time-review-note placeholder="Note (required)" value="${escapeHTML(noteValue)}" ${disabled ? 'disabled' : ''} />
        <div class="ka-time-review-actions">
          <button type="button" class="btn primary btn-sm" data-ka-time-review-approve ${disabled ? 'disabled' : ''}>Approve</button>
          <button type="button" class="btn secondary btn-sm" data-ka-time-review-modify ${disabled ? 'disabled' : ''}>Modify</button>
          <button type="button" class="btn danger btn-sm" data-ka-time-review-reject ${disabled ? 'disabled' : ''}>Reject</button>
        </div>
        <div class="ka-time-review-row-status" data-ka-time-review-status></div>
      </div>
      <button type="button" class="ka-time-review-swipe-action" data-ka-time-review-approve aria-label="Approve time entry" ${disabled ? 'disabled' : ''}>Approve</button>
    </div>
  `;

  if (disabled) {
    kaSetTimeReviewRowStatus(
      row,
      entry._offline || entry._open
        ? 'Review actions are unavailable for in-progress or offline entries.'
        : 'You do not have access to review time entries.',
      'error'
    );
    return row;
  }

  row.querySelectorAll('[data-ka-time-review-approve]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (row.dataset.swipeJustOpened === '1') {
        row.dataset.swipeJustOpened = '0';
        return;
      }
      await kaHandleTimeReviewApprove(row);
    });
  });

  const modifyBtn = row.querySelector('[data-ka-time-review-modify]');
  if (modifyBtn) {
    modifyBtn.addEventListener('click', () => {
      kaCloseTimeReviewSwipes();
      kaOpenTimeActionModal(entry, 'modify');
    });
  }

  const rejectBtn = row.querySelector('[data-ka-time-review-reject]');
  if (rejectBtn) {
    rejectBtn.addEventListener('click', () => {
      kaCloseTimeReviewSwipes();
      kaOpenTimeActionModal(entry, 'reject');
    });
  }

  kaBindTimeReviewSwipe(row);
  return row;
}

function kaCloseTimeReviewSwipes(exceptRow = null) {
  document.querySelectorAll('.ka-time-review-row.show-approve').forEach(row => {
    if (exceptRow && row === exceptRow) return;
    kaResetTimeReviewSwipe(row);
  });
}

function kaResetTimeReviewSwipe(row) {
  if (!row) return;
  row.classList.remove('show-approve');
  row.classList.remove('is-dragging');
  const swipeMain = row.querySelector('.ka-time-review-swipe-main');
  if (swipeMain) {
    swipeMain.style.transform = '';
    swipeMain.style.transition = '';
  }
}

function kaBindTimeReviewSwipe(row) {
  const swipe = row?.querySelector('.ka-time-review-swipe');
  const swipeMain = row?.querySelector('.ka-time-review-swipe-main');
  if (!row || !swipe || !swipeMain || swipe.dataset.bound) return;
  const actionWidth = 120;
  const dragSlop = 5;
  const verticalCancelSlop = 12;
  const horizontalIntentRatio = 0.8;
  const verticalIntentRatio = 1.2;
  const openThreshold = -actionWidth * 0.3;
  const closeThreshold = -actionWidth * 0.6;
  const flickThreshold = 0.25;
  const state = {
    tracking: false,
    dragging: false,
    startX: 0,
    startY: 0,
    startOffset: 0,
    currentOffset: 0,
    deltaX: 0,
    pointerId: null,
    lastMoveX: 0,
    lastMoveTime: 0,
    velocityX: 0
  };

  const canStart = (target) => {
    if (!target) return false;
    if (row.classList.contains('is-busy')) return false;
    if (target.closest('button, a, input, select, textarea')) return false;
    return true;
  };

  const setOffset = (offset) => {
    const clamped = Math.max(-actionWidth, Math.min(0, offset));
    state.currentOffset = clamped;
    swipeMain.style.transform = `translate3d(${clamped}px, 0, 0)`;
  };

  const openSwipe = () => {
    row.classList.add('show-approve');
    setOffset(-actionWidth);
  };

  const closeSwipe = () => {
    row.classList.remove('show-approve');
    setOffset(0);
  };

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!canStart(e.target)) return;
    state.tracking = true;
    state.dragging = false;
    swipeMain.style.transition = 'none';
    state.pointerId = e.pointerId;
    if (swipeMain.setPointerCapture) swipeMain.setPointerCapture(e.pointerId);
    state.startX = e.clientX;
    state.startY = e.clientY;
    state.startOffset = row.classList.contains('show-approve') ? -actionWidth : 0;
    state.currentOffset = state.startOffset;
    state.deltaX = 0;
    state.lastMoveX = e.clientX;
    state.lastMoveTime = performance.now();
    state.velocityX = 0;
  };

  const onPointerMove = (e) => {
    if (!state.tracking || (state.pointerId !== null && e.pointerId !== state.pointerId)) return;
    const rawDx = e.clientX - state.startX;
    const rawDy = e.clientY - state.startY;
    const absDx = Math.abs(rawDx);
    const absDy = Math.abs(rawDy);
    const now = performance.now();
    const dt = now - state.lastMoveTime;
    if (dt > 0) {
      const vx = (e.clientX - state.lastMoveX) / dt;
      state.velocityX = state.velocityX ? state.velocityX * 0.6 + vx * 0.4 : vx;
    }
    state.lastMoveX = e.clientX;
    state.lastMoveTime = now;
    if (!state.dragging) {
      if (absDx < dragSlop && absDy < dragSlop) return;
      const horizontalIntent = absDx >= absDy * horizontalIntentRatio;
      const verticalIntent = absDy > verticalCancelSlop && absDy >= absDx * verticalIntentRatio;
      if (horizontalIntent) {
        state.dragging = true;
        row.classList.add('is-dragging');
        if (swipeMain.setPointerCapture) swipeMain.setPointerCapture(e.pointerId);
        kaCloseTimeReviewSwipes(row);
        state.startX = e.clientX;
        state.startY = e.clientY;
        state.startOffset = state.currentOffset;
        state.deltaX = 0;
      } else if (verticalIntent) {
        state.tracking = false;
        swipeMain.style.transition = '';
        return;
      } else {
        return;
      }
    }
    const dx = e.clientX - state.startX;
    state.deltaX = dx;
    e.preventDefault();
    setOffset(state.startOffset + dx);
  };

  const onPointerEnd = () => {
    if (!state.tracking) return;
    const offset = state.currentOffset || 0;
    let shouldOpen = row.classList.contains('show-approve');
    if (state.dragging) {
      if (state.velocityX < -flickThreshold) {
        shouldOpen = true;
      } else if (state.velocityX > flickThreshold) {
        shouldOpen = false;
      } else if (row.classList.contains('show-approve')) {
        shouldOpen = offset <= closeThreshold;
      } else {
        shouldOpen = offset < openThreshold;
      }
    } else if (shouldOpen) {
      shouldOpen = false;
    }
    row.classList.remove('is-dragging');
    state.tracking = false;
    state.dragging = false;
    if (state.pointerId !== null && swipeMain.releasePointerCapture) {
      try {
        swipeMain.releasePointerCapture(state.pointerId);
      } catch (err) {
        // Ignore release errors for browsers that don't support capture on touch.
      }
    }
    state.pointerId = null;
    swipeMain.style.transition = '';
    requestAnimationFrame(() => {
      if (shouldOpen) {
        openSwipe();
        row.dataset.swipeJustOpened = '1';
        window.setTimeout(() => {
          if (row && row.dataset) row.dataset.swipeJustOpened = '0';
        }, 220);
      } else {
        closeSwipe();
      }
    });
  };

  swipeMain.addEventListener('pointerdown', onPointerDown);
  swipeMain.addEventListener('pointermove', onPointerMove, { passive: false });
  swipeMain.addEventListener('pointerup', onPointerEnd);
  swipeMain.addEventListener('pointercancel', onPointerEnd);

  swipe.dataset.bound = '1';
}

async function kaSubmitTimeReview(entry, action, note, updates = {}) {
  if (!entry) throw new Error('Missing time entry.');
  const noteValue = (note || '').trim();
  if (!noteValue) {
    throw new Error('A note is required.');
  }
  const reviewClientId = `time_review_${entry.id}_${Date.now().toString(36)}`;
  const punchExceptionIds = kaGetPunchExceptionIds(entry);
  const punchAction = action === 'modify' ? 'approve' : action;
  const payload = {
    source: 'time_entry',
    action,
    note: noteValue,
    actor_name: kaAdminDisplayName(),
    updates,
    client_id: reviewClientId
  };
  if (entry.updated_at) payload.if_match_updated_at = entry.updated_at;

  if (!navigator.onLine) {
    kaQueueTimeReview({
      exception_id: entry.id,
      payload,
      queued_at: new Date().toISOString(),
      employee_id: kaAdminAuthId() || null,
      device_id: kaDeviceId || null,
      device_secret: kaGetDeviceSecret() || null
    });
    kaQueuePunchExceptionReviews(punchExceptionIds, punchAction, noteValue);
    return { queued: true };
  }

  try {
    await fetchJSON(`/api/time-exceptions/${entry.id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const punchResult = await kaReviewPunchExceptionsOnline(punchExceptionIds, punchAction, noteValue);
    return { queued: !!(punchResult && punchResult.queued) };
  } catch (err) {
    if (kaIsConnectionIssue(err) || (err && (err.status === 401 || err.status === 403))) {
      kaQueueTimeReview({
        exception_id: entry.id,
        payload,
        queued_at: new Date().toISOString(),
        employee_id: kaAdminAuthId() || null,
        device_id: kaDeviceId || null,
        device_secret: kaGetDeviceSecret() || null
      });
      kaQueuePunchExceptionReviews(punchExceptionIds, punchAction, noteValue);
      return { queued: true };
    }
    throw err;
  }
}

async function kaHandleTimeReviewApprove(row) {
  if (!row || !row._entry) return;
  if (row.classList.contains('is-busy')) return;
  const entry = row._entry;
  const noteInput = row.querySelector('[data-ka-time-review-note]');
  let note = noteInput ? (noteInput.value || '').trim() : '';
  if (!note) {
    kaSetTimeReviewRowStatus(row, 'A note is required.', 'error');
    if (noteInput) noteInput.focus();
    return;
  }
  row.classList.add('is-busy');
  kaSetTimeReviewRowStatus(row, 'Saving...');
  kaSetTimeReviewStatus('');
  try {
    const result = await kaSubmitTimeReview(entry, 'approve', note, {});
    kaApplyTimeReviewRemoval(entry.id, row);
    kaSetTimeReviewStatus(
      result && result.queued
        ? 'Saved offline — will sync when back online.'
        : 'Time entry approved.',
      'ok'
    );
    kaRefreshTimePendingCount({ force: true });
  } catch (err) {
    const msg = err && err.message ? err.message : 'Failed to approve.';
    kaSetTimeReviewRowStatus(row, msg, 'error');
    row.classList.remove('is-busy');
  }
}

function kaHandleTimeReviewResolved(entry, { queued = false } = {}) {
  if (!entry) return;
  const entryId = entry.id != null ? entry.id : entry;
  if (entryId == null) return;
  const row = kaTimeReviewSheetState.open
    ? document.querySelector(`.ka-time-review-row[data-entry-id="${entryId}"]`)
    : null;
  kaApplyTimeReviewRemoval(entryId, row);
  if (kaTimeReviewSheetState.open && queued) {
    kaSetTimeReviewStatus('Saved offline — will sync when back online.', 'ok');
  }
  kaRefreshTimePendingCount({ force: true });
}

async function kaLoadTimeReviewEntries({ forceRefresh = false } = {}) {
  const els = kaTimeReviewSheetElements();
  if (!els) return;
  if (!kaCanModifyTime() || !kaCanViewTimeReports()) {
    kaRenderTimeReviewList([], {});
    kaSetTimeReviewStatus('You do not have access to review time entries.', 'error');
    return;
  }
  kaSetTimeReviewStatus('');

  const employeeSelect = document.getElementById('ka-time-employee');
  const projectSelect = document.getElementById('ka-time-project');

  const employeeId = employeeSelect ? employeeSelect.value : '';
  const projectId = projectSelect ? projectSelect.value : '';
  const params = { scope: 'all', employeeId, projectId };
  const cacheKey = `pending|${employeeId || ''}|${projectId || ''}`;

  if (!forceRefresh && kaTimeEntriesCache && kaTimeEntriesCache.key === cacheKey) {
    const cached = kaTimeEntriesCache.pendingEntries || [];
    kaRenderTimeReviewList(cached, params);
    return;
  }

  if (!navigator.onLine) {
    if (kaTimeEntriesCache && Array.isArray(kaTimeEntriesCache.pendingEntries)) {
      kaRenderTimeReviewList(
        kaTimeEntriesCache.pendingEntries,
        kaTimeEntriesCache.params || params
      );
      kaSetTimeReviewStatus('Offline: showing last loaded pending entries.', 'error');
    } else {
      kaRenderTimeReviewList([], params);
      kaSetTimeReviewStatus('Offline: connect to load pending reviews.', 'error');
    }
    return;
  }

  if (els.list) {
    els.list.innerHTML = '<div class="ka-muted">(loading pending time entries...)</div>';
  }

  try {
    const deviceSecret = kaGetDeviceSecret();
    const useKioskAuth = kaDeviceId && deviceSecret;
    const search = new URLSearchParams();
    if (employeeId) search.set('employee_id', employeeId);
    if (projectId) search.set('project_id', projectId);
    const endpoint = useKioskAuth
      ? `/api/kiosk/time-entries/pending?${search.toString()}`
      : `/api/time-entries/pending?${search.toString()}`;
    const entries = await fetchJSON(endpoint);
    const normalized = (entries || []).map(kaNormalizeTimeEntry);
    const pending = normalized.filter(entry => kaTimeEntryMeta(entry).isPending);
    kaSetTimeEntriesCache({
      key: cacheKey,
      pendingEntries: pending,
      summaryCounts: { pending: pending.length },
      params
    });
    kaRenderTimeReviewList(pending, params);
  } catch (err) {
    const msg = err && err.message ? err.message : 'Failed to load pending time entries.';
    kaRenderTimeReviewList([], params);
    kaSetTimeReviewStatus(msg, 'error');
  }
}

function kaOpenTimeReviewSheet({ forceRefresh = false } = {}) {
  const els = kaTimeReviewSheetElements();
  if (!els) return;
  kaTimeReviewSheetState.open = true;
  kaTimeReviewSheetState.needsRefresh = false;
  els.sheet.classList.remove('hidden');
  requestAnimationFrame(() => {
    els.sheet.classList.add('is-open');
  });
  els.sheet.setAttribute('aria-hidden', 'false');
  kaSyncModalOpenState();
  kaLoadTimeReviewEntries({ forceRefresh });
}

function kaCloseTimeReviewSheet() {
  const els = kaTimeReviewSheetElements();
  if (!els) return;
  kaTimeReviewSheetState.dragging = false;
  kaTimeReviewSheetState.open = false;
  els.sheet.classList.remove('is-open');
  els.sheet.setAttribute('aria-hidden', 'true');
  if (els.panel) {
    els.panel.style.transform = '';
  }
  els.sheet.classList.remove('dragging');
  kaSyncModalOpenState();
  window.setTimeout(() => {
    if (!els.sheet.classList.contains('is-open')) {
      els.sheet.classList.add('hidden');
    }
    kaSyncModalOpenState();
  }, 260);
  if (kaTimeReviewSheetState.needsRefresh && kaCurrentView === 'time' && kaTimeReportHasRun) {
    kaLoadTimeEntries();
    kaTimeReviewSheetState.needsRefresh = false;
  }
}

function kaResetTimeReviewSheetPosition() {
  const els = kaTimeReviewSheetElements();
  if (!els) return;
  kaTimeReviewSheetState.dragging = false;
  els.sheet.classList.remove('dragging');
  if (els.panel) {
    els.panel.style.transform = '';
  }
}

function kaPopulateEmployeeSheet(employee) {
  const els = kaEmployeeSheetElements();
  if (!els || !employee) return;
  const displayName = employee.nickname || employee.name || 'Employee';
  const secondaryName =
    employee.nickname && employee.name && employee.nickname !== employee.name ? employee.name : '';
  const nameParts = String(employee.name || '').trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

  if (els.title) els.title.textContent = '';
  if (els.sub) {
    els.sub.textContent = '';
  }

  if (els.status) kaSetInlineStatus(els.status, '');
  if (els.photoInitials) {
    els.photoInitials.textContent = kaEmployeeInitials(displayName);
    if (!employee.employee_photo_uploaded_at) {
      els.photoInitials.classList.remove('hidden');
    }
  }
  if (els.profileName) els.profileName.textContent = displayName;
  if (els.profileState) {
    const isInactive = employee.active === 0;
    els.profileState.textContent = `Status: ${isInactive ? 'Inactive' : 'Active'}`;
  }
  if (els.profileLang) {
    const langKey = (employee.language || 'en').toString().toLowerCase();
    const langLabel = KA_LANGUAGE_LABELS[langKey] || 'English';
    els.profileLang.textContent = `Language: ${langLabel}`;
  }
  if (els.profileStart) {
    const startLabel = kaFmtDateLong(employee.start_date) || 'Not set';
    els.profileStart.textContent = `Start: ${startLabel}`;
  }
  if (els.photoImg) {
    const hasPhoto = !!employee.employee_photo_uploaded_at;
    if (hasPhoto && employee.id) {
      const base = kaEmployeeDocUrl(employee.id, 'photo');
      const cacheBust = encodeURIComponent(employee.employee_photo_uploaded_at);
      const src = `${base}${base.includes('?') ? '&' : '?'}v=${cacheBust}`;
      els.photoImg.src = src;
      els.photoImg.classList.remove('hidden');
    } else {
      els.photoImg.removeAttribute('src');
      els.photoImg.classList.add('hidden');
    }
  }
  kaSetEmployeeFieldValue(els.firstName, firstName);
  kaSetEmployeeFieldValue(els.lastName, lastName);
  kaSetEmployeeFieldValue(els.nickname, employee.nickname || '');
  kaSetEmployeeFieldValue(els.email, employee.email || '');
  const phoneValue = employee.phone || employee.phone_number || employee.phoneNumber || '';
  kaSetEmployeeFieldValue(els.phone, phoneValue);
  kaSetEmployeeDateInput(els.startDate, employee.start_date);
  kaSetEmployeeDateInput(els.termDate, employee.termination_date);

  const canRates = kaCanModifyPayRates();
  if (els.rateField) els.rateField.classList.toggle('hidden', !canRates);
  if (els.rateInput) {
    const rateValue = employee.rate != null ? Number(employee.rate) : null;
    els.rateInput.value = Number.isFinite(rateValue) ? rateValue.toFixed(2) : '';
  }

  if (els.geofenceToggle) {
    els.geofenceToggle.checked = false;
  }
  if (els.reactivateBtn) {
    const isInactive = employee.active === 0;
    els.reactivateBtn.classList.toggle('hidden', !isInactive);
    els.reactivateBtn.disabled = !isInactive;
  }
  if (els.reactivateNote) {
    const isInactive = employee.active === 0;
    els.reactivateNote.classList.toggle('hidden', !isInactive);
  }
  kaEmployeeSheetState.reactivatePending = false;
  kaEmployeeSheetState.reactivateSnapshot = null;

  if (els.language) {
    const lang = (employee.language || 'en').toString().toLowerCase();
    els.language.value = KA_LANGUAGE_LABELS[lang] ? lang : 'en';
  }
  if (els.nameChecks) {
    els.nameChecks.value = employee.name_on_checks || employee.name || '';
  }
  if (els.saveStatus) kaSetInlineStatus(els.saveStatus, '');
  if (els.docsStatus) kaSetInlineStatus(els.docsStatus, '');
}

function kaPopulateEmployeePinSheet(employee) {
  const els = kaEmployeePinSheetElements();
  if (!els || !employee) return;
  const displayName = employee.nickname || employee.name || 'Employee';
  if (els.title) els.title.textContent = 'Change PIN';
  if (els.sub) els.sub.textContent = displayName;
  if (els.pinInput) els.pinInput.value = '';
  if (els.pinConfirm) els.pinConfirm.value = '';
  if (els.pinStatus) kaSetInlineStatus(els.pinStatus, '');
}

function kaRenderEmployeeHistory(history = []) {
  const body = document.getElementById('ka-employee-history-body');
  if (!body) return;
  if (!Array.isArray(history) || !history.length) {
    body.innerHTML = '<div class="ka-ship-muted">(No prior employment history)</div>';
    return;
  }
  const rows = history.map(entry => {
    const start = kaFmtDateLong(entry.start_date) || 'Not set';
    const term = kaFmtDateLong(entry.termination_date) || 'Not set';
    const recorded = kaFmtDateLong(entry.recorded_at) || '';
    return `
      <div class="ka-employee-history-row">
        <div>${escapeHTML(start)}</div>
        <div>${escapeHTML(term)}</div>
        <div>${escapeHTML(recorded)}</div>
      </div>
    `;
  });
  body.innerHTML = `
    <div class="ka-employee-history-header">
      <div>Start date</div>
      <div>End date</div>
      <div>Recorded</div>
    </div>
    ${rows.join('')}
  `;
}

function kaOpenEmployeeHistoryModal() {
  const backdrop = document.getElementById('ka-employee-history-backdrop');
  if (!backdrop) return;
  kaRenderEmployeeHistory(kaEmployeeSheetState.history || []);
  backdrop.classList.remove('hidden');
}

function kaCloseEmployeeHistoryModal() {
  const backdrop = document.getElementById('ka-employee-history-backdrop');
  if (backdrop) backdrop.classList.add('hidden');
}

function kaEmployeesSheetElements() {
  const sheet = document.getElementById('ka-employees-sheet');
  if (!sheet) return null;
  return {
    sheet,
    panel: sheet.querySelector('.ka-sheet-panel'),
    handle: sheet.querySelector('[data-ka-employees-sheet-handle]'),
    header: sheet.querySelector('.ka-sheet-header'),
    slot: sheet.querySelector('[data-ka-employees-sheet-slot]'),
    actions: sheet.querySelector('[data-ka-employees-sheet-actions]')
  };
}

function kaOpenEmployeesSheet() {
  const els = kaEmployeesSheetElements();
  const section = document.getElementById('ka-view-employees');
  if (!els || !section) return;
  if (kaEmployeesSheetState.open) return;
  kaEmployeesSheetState.open = true;
  kaEmployeesSheetState.dragging = false;
  kaEmployeesSheetState.startY = 0;
  kaEmployeesSheetState.currentY = 0;
  kaEmployeesSheetState.restoreHidden = section.classList.contains('hidden');
  if (!kaEmployeesSheetState.contentParent) {
    kaEmployeesSheetState.contentParent = section.parentElement;
    kaEmployeesSheetState.contentNext = section.nextSibling;
  }
  if (els.slot && section.parentElement !== els.slot) {
    els.slot.appendChild(section);
  }
  section.classList.remove('hidden');

  const addBtn = document.getElementById('ka-employee-add-cta');
  if (addBtn) {
    if (!kaEmployeesSheetState.addBtnParent) {
      kaEmployeesSheetState.addBtnParent = addBtn.parentElement;
      kaEmployeesSheetState.addBtnNext = addBtn.nextSibling;
    }
    kaEmployeesSheetState.addBtnWasHidden = addBtn.classList.contains('hidden');
    addBtn.classList.remove('hidden');
    if (els.actions && addBtn.parentElement !== els.actions) {
      const closeBtn = els.actions.querySelector('[data-ka-employees-sheet-close]');
      if (closeBtn) {
        els.actions.insertBefore(addBtn, closeBtn);
      } else {
        els.actions.appendChild(addBtn);
      }
    }
  }

  kaRenderEmployeesGrid();
  kaSetEmployeeFormVisible(kaEmployeeFormVisible, { skipScroll: true });
  els.sheet.classList.remove('hidden');
  requestAnimationFrame(() => {
    els.sheet.classList.add('is-open');
  });
  els.sheet.setAttribute('aria-hidden', 'false');
  kaSyncModalOpenState();
}

function kaCloseEmployeesSheet() {
  const els = kaEmployeesSheetElements();
  const section = document.getElementById('ka-view-employees');
  if (!els) return;
  kaEmployeesSheetState.dragging = false;
  kaEmployeesSheetState.open = false;
  els.sheet.classList.remove('is-open');
  els.sheet.setAttribute('aria-hidden', 'true');
  if (els.panel) {
    els.panel.style.transform = '';
  }
  els.sheet.classList.remove('dragging');

  const addBtn = document.getElementById('ka-employee-add-cta');
  if (addBtn && kaEmployeesSheetState.addBtnParent) {
    const refNode =
      kaEmployeesSheetState.addBtnNext &&
      kaEmployeesSheetState.addBtnNext.parentNode === kaEmployeesSheetState.addBtnParent
        ? kaEmployeesSheetState.addBtnNext
        : null;
    kaEmployeesSheetState.addBtnParent.insertBefore(addBtn, refNode);
  }
  if (addBtn && kaEmployeesSheetState.addBtnWasHidden) {
    addBtn.classList.add('hidden');
  }

  if (section && kaEmployeesSheetState.contentParent) {
    const refNode =
      kaEmployeesSheetState.contentNext &&
      kaEmployeesSheetState.contentNext.parentNode === kaEmployeesSheetState.contentParent
        ? kaEmployeesSheetState.contentNext
        : null;
    kaEmployeesSheetState.contentParent.insertBefore(section, refNode);
  }
  if (section && kaEmployeesSheetState.restoreHidden) {
    section.classList.add('hidden');
  }

  kaSyncModalOpenState();
  window.setTimeout(() => {
    if (!els.sheet.classList.contains('is-open')) {
      els.sheet.classList.add('hidden');
    }
    kaSyncModalOpenState();
  }, 260);
}

function kaAccountSheetElements() {
  const sheet = document.getElementById('ka-account-sheet');
  if (!sheet) return null;
  return {
    sheet,
    panel: sheet.querySelector('.ka-sheet-panel'),
    handle: sheet.querySelector('[data-ka-account-sheet-handle]'),
    header: sheet.querySelector('.ka-sheet-header'),
    slot: sheet.querySelector('[data-ka-account-sheet-slot]')
  };
}

function kaOpenAccountSheet() {
  const els = kaAccountSheetElements();
  const section = document.getElementById('ka-view-account');
  if (!els || !section) return;
  if (kaAccountSheetState.open) return;
  kaAccountSheetState.open = true;
  kaAccountSheetState.dragging = false;
  kaAccountSheetState.startY = 0;
  kaAccountSheetState.currentY = 0;
  kaAccountSheetState.restoreHidden = section.classList.contains('hidden');
  if (!kaAccountSheetState.contentParent) {
    kaAccountSheetState.contentParent = section.parentElement;
    kaAccountSheetState.contentNext = section.nextSibling;
  }
  if (els.slot && section.parentElement !== els.slot) {
    els.slot.appendChild(section);
  }
  section.classList.remove('hidden');

  kaBindAccountActions();
  kaLoadAccountInfo();

  els.sheet.classList.remove('hidden');
  requestAnimationFrame(() => {
    els.sheet.classList.add('is-open');
  });
  els.sheet.setAttribute('aria-hidden', 'false');
  kaSyncModalOpenState();
}

function kaCloseAccountSheet() {
  const els = kaAccountSheetElements();
  const section = document.getElementById('ka-view-account');
  if (!els) return;
  kaAccountSheetState.dragging = false;
  kaAccountSheetState.open = false;
  els.sheet.classList.remove('is-open');
  els.sheet.setAttribute('aria-hidden', 'true');
  if (els.panel) {
    els.panel.style.transform = '';
  }
  els.sheet.classList.remove('dragging');

  if (section && kaAccountSheetState.contentParent) {
    const refNode =
      kaAccountSheetState.contentNext &&
      kaAccountSheetState.contentNext.parentNode === kaAccountSheetState.contentParent
        ? kaAccountSheetState.contentNext
        : null;
    kaAccountSheetState.contentParent.insertBefore(section, refNode);
  }
  if (section && kaAccountSheetState.restoreHidden) {
    section.classList.add('hidden');
  }

  kaSyncModalOpenState();
  window.setTimeout(() => {
    if (!els.sheet.classList.contains('is-open')) {
      els.sheet.classList.add('hidden');
    }
    kaSyncModalOpenState();
  }, 260);
}

function kaSettingsSheetElements() {
  const sheet = document.getElementById('ka-settings-sheet');
  if (!sheet) return null;
  return {
    sheet,
    panel: sheet.querySelector('.ka-sheet-panel'),
    handle: sheet.querySelector('[data-ka-settings-sheet-handle]'),
    header: sheet.querySelector('.ka-sheet-header'),
    slot: sheet.querySelector('[data-ka-settings-sheet-slot]')
  };
}

function kaOpenSettingsSheet() {
  const els = kaSettingsSheetElements();
  const section = document.getElementById('ka-view-settings');
  if (!els || !section) return;
  if (kaSettingsSheetState.open) return;
  kaSettingsSheetState.open = true;
  kaSettingsSheetState.dragging = false;
  kaSettingsSheetState.startY = 0;
  kaSettingsSheetState.currentY = 0;
  kaSettingsSheetState.restoreHidden = section.classList.contains('hidden');
  if (!kaSettingsSheetState.contentParent) {
    kaSettingsSheetState.contentParent = section.parentElement;
    kaSettingsSheetState.contentNext = section.nextSibling;
  }
  if (els.slot && section.parentElement !== els.slot) {
    els.slot.appendChild(section);
  }
  section.classList.remove('hidden');

  kaRenderSettingsForm();

  els.sheet.classList.remove('hidden');
  requestAnimationFrame(() => {
    els.sheet.classList.add('is-open');
  });
  els.sheet.setAttribute('aria-hidden', 'false');
  kaSyncModalOpenState();
}

function kaCloseSettingsSheet() {
  const els = kaSettingsSheetElements();
  const section = document.getElementById('ka-view-settings');
  if (!els) return;
  kaSettingsSheetState.dragging = false;
  kaSettingsSheetState.open = false;
  els.sheet.classList.remove('is-open');
  els.sheet.setAttribute('aria-hidden', 'true');
  if (els.panel) {
    els.panel.style.transform = '';
  }
  els.sheet.classList.remove('dragging');

  if (section && kaSettingsSheetState.contentParent) {
    const refNode =
      kaSettingsSheetState.contentNext &&
      kaSettingsSheetState.contentNext.parentNode === kaSettingsSheetState.contentParent
        ? kaSettingsSheetState.contentNext
        : null;
    kaSettingsSheetState.contentParent.insertBefore(section, refNode);
  }
  if (section && kaSettingsSheetState.restoreHidden) {
    section.classList.add('hidden');
  }

  kaSyncModalOpenState();
  window.setTimeout(() => {
    if (!els.sheet.classList.contains('is-open')) {
      els.sheet.classList.add('hidden');
    }
    kaSyncModalOpenState();
  }, 260);
}

function kaOpenEmployeeSheet(employee) {
  const els = kaEmployeeSheetElements();
  if (!els || !employee) return;
  kaEmployeeSheetState.employeeId = Number(employee.id) || null;
  kaEmployeeSheetState.open = true;
  kaPopulateEmployeeSheet(employee);
  kaLoadEmployeeDocs(kaEmployeeSheetState.employeeId);
  kaLoadEmployeeHistory(kaEmployeeSheetState.employeeId);
  els.sheet.classList.remove('hidden');
  requestAnimationFrame(() => {
    els.sheet.classList.add('is-open');
  });
  els.sheet.setAttribute('aria-hidden', 'false');
  kaSyncModalOpenState();
}

function kaCloseEmployeeSheet() {
  const els = kaEmployeeSheetElements();
  if (!els) return;
  kaEmployeeSheetState.dragging = false;
  kaEmployeeSheetState.open = false;
  kaEmployeeSheetState.employeeId = null;
  kaEmployeeSheetState.history = [];
  kaEmployeeSheetState.reactivatePending = false;
  kaEmployeeSheetState.reactivateSnapshot = null;
  els.sheet.classList.remove('is-open');
  els.sheet.setAttribute('aria-hidden', 'true');
  if (els.panel) {
    els.panel.style.transform = '';
  }
  els.sheet.classList.remove('dragging');
  kaSyncModalOpenState();
  window.setTimeout(() => {
    if (!els.sheet.classList.contains('is-open')) {
      els.sheet.classList.add('hidden');
    }
    kaSyncModalOpenState();
  }, 260);
}

function kaOpenEmployeePinSheet(employeeId) {
  const els = kaEmployeePinSheetElements();
  const id = Number(employeeId) || null;
  if (!els || !id) return;
  const emp = kaFindEmployeeById(id);
  if (!emp) return;
  if (kaEmployeeSheetState.open) {
    kaCloseEmployeeSheet();
  }
  kaEmployeePinSheetState.employeeId = id;
  kaEmployeePinSheetState.open = true;
  kaPopulateEmployeePinSheet(emp);
  els.sheet.classList.remove('hidden');
  requestAnimationFrame(() => {
    els.sheet.classList.add('is-open');
  });
  els.sheet.setAttribute('aria-hidden', 'false');
  kaSyncModalOpenState();
}

function kaCloseEmployeePinSheet({ returnToDetails = true } = {}) {
  const els = kaEmployeePinSheetElements();
  if (!els) return;
  const id = kaEmployeePinSheetState.employeeId;
  kaEmployeePinSheetState.dragging = false;
  kaEmployeePinSheetState.open = false;
  kaEmployeePinSheetState.employeeId = null;
  els.sheet.classList.remove('is-open');
  els.sheet.setAttribute('aria-hidden', 'true');
  if (els.panel) {
    els.panel.style.transform = '';
  }
  els.sheet.classList.remove('dragging');
  kaSyncModalOpenState();
  window.setTimeout(() => {
    if (!els.sheet.classList.contains('is-open')) {
      els.sheet.classList.add('hidden');
    }
    kaSyncModalOpenState();
  }, 260);

  if (returnToDetails && id) {
    const emp = kaFindEmployeeById(id);
    if (emp) {
      kaOpenEmployeeSheet(emp);
    }
  }
}

function kaRefreshEmployeeSheet() {
  const id = kaEmployeeSheetState.employeeId;
  if (!id) return;
  const emp = kaFindEmployeeById(id);
  if (emp) kaPopulateEmployeeSheet(emp);
  kaLoadEmployeeDocs(id);
  kaLoadEmployeeHistory(id);
}

async function kaHandleEmployeePhotoUpload(file) {
  const els = kaEmployeeSheetElements();
  if (!els || !file) return;
  const id = kaEmployeeSheetState.employeeId;
  if (!id) return;
  kaSetInlineStatus(els.photoStatus, 'Uploading photo…');
  try {
    const form = new FormData();
    form.append('employee_photo', file);
    const auth = kaEmployeeAuthMeta();
    if (auth.admin_id) form.append('admin_id', String(auth.admin_id));
    if (auth.device_id) form.append('device_id', String(auth.device_id));
    if (auth.device_secret) form.append('device_secret', String(auth.device_secret));

    const res = await fetch(`/api/kiosk/admin/employees/${id}/photo`, {
      method: 'POST',
      body: form,
      credentials: 'include',
      headers: kaGetCsrfHeader()
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Upload failed.');
    }
    const uploadedAt = new Date().toISOString();
    kaUpdateEmployeeRecord(id, { employee_photo_uploaded_at: uploadedAt });
    if (kaCurrentAdmin && Number(kaCurrentAdmin.id) === Number(id)) {
      kaUpdateAccountProfile({ employee: kaCurrentAdmin });
    }
    if (els.photoInput) els.photoInput.value = '';
    kaSetInlineStatus(els.photoStatus, 'Photo uploaded.', 'ok');
    kaRefreshEmployeeSheet();
    kaRenderEmployeesGrid();
  } catch (err) {
    console.error('Employee photo upload failed', err);
    kaSetInlineStatus(els.photoStatus, err.message || 'Upload failed.', 'error');
  }
}

function kaRenderEmployeesGrid() {
  const grid = document.getElementById('ka-employees-grid');
  const empty = document.getElementById('ka-employees-empty');
  const countTag = document.getElementById('ka-employees-count');
  if (!grid) return;

  const employees = Array.isArray(kaEmployees) ? [...kaEmployees] : [];
  const query = (kaEmployeeSearchQuery || '').toString().trim().toLowerCase();
  const statusFilter = (kaEmployeeStatusFilter || 'all').toString().toLowerCase();
  const filtered = employees.filter(emp => {
    if (statusFilter === 'active' && emp.active === 0) return false;
    if (statusFilter === 'inactive' && emp.active !== 0) return false;
    if (!query) return true;
    const name = (emp.name || '').toString().toLowerCase();
    const nickname = (emp.nickname || '').toString().toLowerCase();
    const nameChecks = (emp.name_on_checks || '').toString().toLowerCase();
    return name.includes(query) || nickname.includes(query) || nameChecks.includes(query);
  });
  filtered.sort((a, b) => {
    const aName = (a.nickname || a.name || '').toLowerCase();
    const bName = (b.nickname || b.name || '').toLowerCase();
    return aName.localeCompare(bName);
  });

  if (countTag) {
    const total = filtered.length;
    countTag.textContent = `${total} Employee${total === 1 ? '' : 's'}`;
    countTag.className = `ka-tag ${total ? 'gray' : 'orange'}`;
  }

  if (!filtered.length) {
    grid.replaceChildren();
    if (empty) empty.classList.remove('hidden');
    return;
  }

  if (empty) empty.classList.add('hidden');

  const fragment = document.createDocumentFragment();
  filtered.forEach(emp => {
    const card = document.createElement('div');
    card.className = 'ka-employee-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.dataset.employeeId = emp.id;

    const displayName = emp.nickname || emp.name || 'Unnamed employee';
    card.setAttribute('aria-label', `View details for ${displayName}`);
    const secondaryName =
      emp.nickname && emp.name && emp.nickname !== emp.name ? emp.name : '';
    const tags = [];
    if (emp.active === 0) {
      tags.push('<span class="ka-tag red">Inactive</span>');
    }
    if (emp.pin_hash) {
      tags.push('<span class="ka-tag orange">PIN set</span>');
    }
    const langKey = (emp.language || 'en').toString().toLowerCase();
    const langLabel = KA_LANGUAGE_LABELS[langKey] || 'English';

    card.innerHTML = `
      <div class="ka-employee-card-header">
        <div>
          <div class="ka-employee-card-name">${escapeHTML(displayName)}</div>
          ${secondaryName ? `<div class="ka-employee-card-sub">${escapeHTML(secondaryName)}</div>` : ''}
        </div>
        <div class="ka-employee-tags">${tags.join('')}</div>
      </div>
      <div class="ka-employee-card-meta">
        <div>
          <span class="ka-employee-meta-label">Language</span>
          ${escapeHTML(langLabel)}
        </div>
      </div>
    `;
    card.addEventListener('click', () => {
      const current = kaFindEmployeeById(emp.id) || emp;
      kaOpenEmployeeSheet(current);
    });
    card.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter' || evt.key === ' ') {
        evt.preventDefault();
        const current = kaFindEmployeeById(emp.id) || emp;
        kaOpenEmployeeSheet(current);
      }
    });
    fragment.appendChild(card);
  });

  grid.replaceChildren(fragment);
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
  const startBtn = document.getElementById('ka-start-new-btn');
  const addBtn = document.getElementById('ka-employee-add-cta');
  if (startBtn) {
    if (view === 'timesheets') {
      kaUpdateActiveProjectUI();
    } else {
      startBtn.classList.add('hidden');
    }
  }
  if (addBtn) addBtn.classList.toggle('hidden', view !== 'employees');
  if (document.body) {
    document.body.classList.toggle('ka-view-workers-active', view === 'workers');
    document.body.classList.toggle('ka-view-timesheets-active', view === 'timesheets');
    document.body.classList.toggle('ka-view-shipments-active', view === 'shipments');
    document.body.classList.toggle('ka-view-employees-active', view === 'employees');
    document.body.classList.toggle('ka-view-time-active', view === 'time');
  }
  kaSyncLiveCountPill();


  if (view === 'time') {
    kaBindTimeOrientationListener();
    kaSyncTimeOrientationHint();
    kaSetTimeReportVisible(kaTimeReportHasRun);
    kaBindTimeCalendar();
    kaRenderTimeCalendar();
  }

  if (view === 'time' || view === 'timesheets') {
    kaRefreshTimePendingCount();
  }

  if (view === 'shipments' && kaCanViewShipments()) {
    kaLoadShipments({ forceFresh: true });
  }

  if (view === 'workers') {
    kaBindLiveTimesheetFilter();
    kaRenderLiveTimesheetFilter();
    kaLoadLiveWorkers();
  }

  if (view === 'employees') {
    kaRenderEmployeesGrid();
    kaSetEmployeeFormVisible(kaEmployeeFormVisible, { skipScroll: true });
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

function kaIsoDateFromTimestampTZ(input) {
  if (!input) return '';
  const dt = input instanceof Date ? input : kaParseUtcTimestamp(String(input));
  if (!dt || Number.isNaN(dt.getTime())) return '';
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: kaOrgTimezone || KA_DEFAULT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = fmt.formatToParts(dt);
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const d = parts.find(p => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch (err) {
    console.warn('Falling back to UTC date for kaIsoDateFromTimestampTZ:', err);
  }
  return dt.toISOString().slice(0, 10);
}

function kaTimeValue24TZ(input) {
  if (!input) return '';
  const dt = input instanceof Date ? input : kaParseUtcTimestamp(String(input));
  if (!dt || Number.isNaN(dt.getTime())) return '';
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: kaOrgTimezone || KA_DEFAULT_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    });
    const parts = fmt.formatToParts(dt);
    const hh = parts.find(p => p.type === 'hour')?.value;
    const mm = parts.find(p => p.type === 'minute')?.value;
    if (hh && mm) return `${hh}:${mm}`;
  } catch (err) {
    console.warn('Falling back to UTC time for kaTimeValue24TZ:', err);
  }
  return dt.toISOString().slice(11, 16);
}

function kaFormatTimeValue12(value) {
  if (!value) return '';
  if (value instanceof Date) {
    return value.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  }
  const raw = String(value).trim();
  if (!raw) return '';
  if (/(^|\\s)(am|pm)\\b/i.test(raw)) return raw;
  if (raw.includes('T') || raw.includes('-') || raw.includes('/')) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    }
  }
  const parts = raw.split(':');
  if (parts.length >= 2) {
    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return raw;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return raw;
    const hour12 = hours % 12 || 12;
    const hh = String(hour12).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    const suffix = hours >= 12 ? 'PM' : 'AM';
    return `${hh}:${mm} ${suffix}`;
  }
  return raw;
}

function kaFmtTimeShortTZ(input) {
  if (!input) return '';
  const dt = input instanceof Date ? input : kaParseUtcTimestamp(String(input));
  if (!dt || Number.isNaN(dt.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: kaOrgTimezone || KA_DEFAULT_TIMEZONE,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(dt);
  } catch (err) {
    console.warn('Falling back to local time for kaFmtTimeShortTZ:', err);
    return dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  }
}

function kaSessionRowMeta(session, opts = {}) {
  const startTs = session?.first_clock_in_ts || session?.created_at;
  const startLabel = kaFmtTimeShortTZ(startTs);
  const { openCount, entryCount } = kaSessionCounts(session);
  const endedAt = session?.ended_at;
  const isClosed = !!endedAt;
  const isOngoing =
    isClosed
      ? false
      : typeof opts.isOngoing === 'boolean'
        ? opts.isOngoing
        : openCount > 0 || (!!opts.isActive && !session?.last_clock_out_ts);
  let endHtml = '';
  let statusHtml = '';

  if (isOngoing) {
    endHtml = '<span class="ka-session-ongoing">Ongoing</span>';
  } else if (endedAt) {
    endHtml = `<span class="ka-session-time">${kaFmtTimeShortTZ(endedAt)}</span>`;
    const closedLabel = openCount === 0 && entryCount > 0 ? 'Complete & Closed' : 'Closed';
    statusHtml =
      '<span class="ka-session-complete">' +
      '<svg viewBox="0 0 20 20" aria-hidden="true">' +
      '<circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" stroke-width="1.4"></circle>' +
      '<path d="M6.4 10.4l2.3 2.3 4.9-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>' +
      '</svg>' +
      closedLabel +
      '</span>';
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
    '<span class="ka-session-time-group">' +
    `<span class="ka-session-time">${startLabel}</span>` +
    '<span class="ka-session-time-divider">–</span>' +
    `${endHtml}` +
    '</span>' +
    `${statusHtml}` +
    '</span>';
  return rangeHtml;
}

async function kaLoadTimesheetAssignees({ force = false } = {}) {
  if (!kaCanAssignTimesheets()) return [];
  if (kaTimesheetAssigneesLoaded && !force) return kaTimesheetAssignees;
  if (kaTimesheetAssigneesLoading) return kaTimesheetAssignees;
  kaTimesheetAssigneesLoading = true;
  try {
    const res = await fetchJSON('/api/kiosk-sessions/assignees');
    kaTimesheetAssignees = (res && res.admins) ? res.admins : [];
  } catch (err) {
    console.warn('Unable to load timesheet assignees', err);
    kaTimesheetAssignees = [];
  }
  kaTimesheetAssigneesLoaded = true;
  kaTimesheetAssigneesLoading = false;
  return kaTimesheetAssignees;
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
    handle: sheet.querySelector('[data-ka-sheet-handle]'),
    header: sheet.querySelector('.ka-sheet-header')
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
  const sorted = kaSortSessionsByRecency(sessions).filter(s => !kaIsSessionClosed(s));
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
  const sorted = kaSortSessionsByRecency(sessions).filter(s => !kaIsSessionClosed(s));
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

function kaSessionProjectLabel(session) {
  if (!session) return 'this project';
  return (
    session.project_name ||
    kaProjectLabelById(session.project_id) ||
    (session.project_id ? `Project ${session.project_id}` : 'this project')
  );
}

function kaIsSessionClosed(session) {
  return !!(session && session.ended_at);
}

function kaFindOpenSessionForProjectToday(projectId) {
  if (!projectId) return null;
  const todayIso = kaTodayIso();
  return (kaSessions || []).find(
    session =>
      Number(session?.project_id) === Number(projectId) &&
      !kaIsSessionClosed(session) &&
      String(session?.date || '').slice(0, 10) === todayIso
  );
}

function kaIsSessionActive(session) {
  if (!session) return false;
  if (kaIsSessionClosed(session)) return false;
  const todayIso = kaTodayIso();
  if (String(session.date || '').slice(0, 10) !== todayIso) return false;
  const activeId =
    kaActiveSessionId !== undefined && kaActiveSessionId !== null
      ? Number(kaActiveSessionId)
      : null;
  if (Number.isFinite(activeId)) {
    return Number(session.id) === activeId;
  }
  const activeProjectId =
    kaKiosk && kaKiosk.project_id !== undefined && kaKiosk.project_id !== null
      ? Number(kaKiosk.project_id)
      : null;
  if (Number.isFinite(activeProjectId)) {
    return Number(session.project_id) === activeProjectId;
  }
  return false;
}

async function kaOpenTimesheetActions(sessionId, row = null) {
  if (!sessionId) return;
  let session = (kaSessions || []).find(s => Number(s.id) === Number(sessionId));
  if (!session) {
    const fallbackProjectId = row && row.dataset.projectId ? Number(row.dataset.projectId) : null;
    session = {
      id: sessionId,
      project_id: Number.isFinite(fallbackProjectId) ? fallbackProjectId : null,
      date: kaTimesheetSelectedDate() || kaTodayIso()
    };
  }

  const backdrop = kaEnsureTimesheetActionModal();
  const titleEl = document.getElementById('ka-timesheet-action-title');
  const msgEl = document.getElementById('ka-timesheet-action-message');
  const assignBtn = document.getElementById('ka-timesheet-action-assign-btn');
  const deleteBtn = document.getElementById('ka-timesheet-action-delete');
  const closeBtn = document.getElementById('ka-timesheet-action-close');
  const closeSheetBtn = document.getElementById('ka-timesheet-action-close-sheet');
  const setBtn = document.getElementById('ka-timesheet-action-set');

  if (!backdrop || !titleEl || !msgEl || !assignBtn || !deleteBtn || !closeBtn || !closeSheetBtn || !setBtn) {
    kaDebugTapLog('actions modal missing elements');
    return;
  }

  const isActive = (row && row.classList.contains('is-active')) || kaIsSessionActive(session);
  const modal = backdrop.querySelector('.ka-timesheet-action-modal');
  if (modal) modal.classList.toggle('is-active-session', isActive);
  kaDebugTapLog(`actions modal open id=${sessionId} active=${isActive} canAssign=${kaCanAssignTimesheets()}`);
  const projectLabel = kaSessionProjectLabel(session);
  titleEl.textContent = projectLabel || 'Timesheet options';
  const { openCount, entryCount } = kaSessionCounts(session);
  const isClosed = kaIsSessionClosed(session);
  const canClose = !isClosed && openCount === 0;
  const canDelete = openCount === 0 && entryCount === 0;
  const baseMessage = isActive
    ? 'Assign this active timesheet to an admin.'
    : `Set ${projectLabel} from this timesheet as the active project for this kiosk.`;
  msgEl.textContent = isClosed
    ? (canDelete ? 'This timesheet is closed. You can delete it since it has no time entries.'
      : 'This timesheet is closed. It cannot be changed.')
    : openCount > 0
      ? `${baseMessage} Close is available once all workers are clocked out.`
      : baseMessage;

  const canAssign = kaCanAssignTimesheets();
  setBtn.hidden = isActive || isClosed;
  assignBtn.hidden = !canAssign || isClosed;
  if (isClosed) {
    deleteBtn.hidden = !canDelete;
  } else {
    deleteBtn.hidden = canAssign || isActive || !canDelete;
  }
  closeSheetBtn.hidden = isClosed || !canClose;
  closeSheetBtn.disabled = !canClose;
  assignBtn.classList.toggle('ka-timesheet-assign-active', isActive);

  const closeModal = () => {
    backdrop.classList.add('hidden');
    closeBtn.onclick = null;
    setBtn.onclick = null;
    assignBtn.onclick = null;
    deleteBtn.onclick = null;
    closeSheetBtn.onclick = null;
    backdrop.onclick = null;
  };

  closeBtn.onclick = () => closeModal();
  backdrop.onclick = (e) => {
    if (e.target === backdrop) closeModal();
  };

  setBtn.onclick = async () => {
    closeModal();
    await kaSetActiveSession(sessionId);
  };

  deleteBtn.onclick = async () => {
    closeModal();
    await kaDeleteSession(sessionId, row);
  };

  closeSheetBtn.onclick = async () => {
    if (!canClose) return;
    closeModal();
    await kaCloseSession(sessionId, row);
  };

  assignBtn.onclick = async () => {
    closeModal();
    await kaOpenTimesheetAssignPicker(session);
  };

  backdrop.classList.remove('hidden');
  kaDebugTapLog('actions modal shown');
}

async function kaOpenTimesheetAssignPicker(session) {
  if (!session || !kaCanAssignTimesheets()) return;
  await kaLoadTimesheetAssignees();
  const admins = Array.isArray(kaTimesheetAssignees) ? kaTimesheetAssignees : [];

  const backdrop = kaEnsureTimesheetAssignModal();
  const titleEl = document.getElementById('ka-timesheet-assign-title');
  const msgEl = document.getElementById('ka-timesheet-assign-message');
  const selectEl = document.getElementById('ka-timesheet-assign-select');
  const closeBtn = document.getElementById('ka-timesheet-assign-close');

  if (!backdrop || !titleEl || !msgEl || !selectEl || !closeBtn) return;

  const assignedName = session.assigned_to_name || session.created_by_name || '';
  const assignedId = session.assigned_to_employee_id || null;

  titleEl.textContent = 'Assign to admin';
  msgEl.textContent = assignedName
    ? `Assigned to ${assignedName}.`
    : 'Currently unassigned.';

  const closeModal = () => {
    backdrop.classList.add('hidden');
    closeBtn.onclick = null;
    selectEl.onchange = null;
    backdrop.onclick = null;
  };

  const assignTo = async (nextId) => {
    const previousValue = assignedId ? String(assignedId) : '';
    selectEl.disabled = true;
    try {
      const res = await fetchJSON(`/api/kiosk-sessions/${session.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assigned_to_employee_id: nextId ? Number(nextId) : null
        })
      });
      session.assigned_to_employee_id = res.assigned_to_employee_id || null;
      session.assigned_to_name = res.assigned_to_name || null;
      kaRenderSessions();
      closeModal();
    } catch (err) {
      console.error('Error updating timesheet assignee', err);
      selectEl.disabled = false;
      selectEl.value = previousValue;
    }
  };

  const currentValue = assignedId ? String(assignedId) : '';
  selectEl.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = assignedName ? `Assigned to ${assignedName}` : 'Select admin';
  placeholder.disabled = true;
  placeholder.selected = !currentValue;
  selectEl.appendChild(placeholder);

  let hasAssignedOption = false;
  admins.forEach(admin => {
    const opt = document.createElement('option');
    opt.value = String(admin.id);
    opt.textContent = admin.name || 'Admin';
    if (assignedId && Number(admin.id) === Number(assignedId)) {
      hasAssignedOption = true;
    }
    selectEl.appendChild(opt);
  });

  if (currentValue && !hasAssignedOption) {
    const currentOpt = document.createElement('option');
    currentOpt.value = currentValue;
    currentOpt.textContent = assignedName || `Admin #${assignedId}`;
    currentOpt.disabled = true;
    currentOpt.selected = true;
    selectEl.insertBefore(currentOpt, selectEl.firstChild);
  } else if (currentValue) {
    selectEl.value = currentValue;
  }

  selectEl.onchange = () => {
    const nextValue = selectEl.value;
    if (!nextValue || nextValue === currentValue) return;
    assignTo(Number(nextValue));
  };

  closeBtn.onclick = () => closeModal();
  backdrop.onclick = (e) => {
    if (e.target === backdrop) closeModal();
  };
  backdrop.classList.remove('hidden');
  selectEl.focus();
}

async function kaTriggerSessionRowAction(row) {
  if (!row || !row.dataset.sessionId) return;
  const id = Number(row.dataset.sessionId);
  if (!id) return;
  const session = (kaSessions || []).find(s => Number(s.id) === id);
  const isActive = row.classList.contains('is-active') || (session ? kaIsSessionActive(session) : false);
  const canClose = session && !kaIsSessionClosed(session) && kaSessionCounts(session).openCount === 0;
  kaDebugTapFlash(row, isActive ? 'tap: active row' : 'tap: inactive row');
  kaDebugTapLog(`trigger row id=${id} active=${isActive} canAssign=${kaCanAssignTimesheets()}`);
  if (isActive && !kaCanAssignTimesheets() && !canClose) return;
  await kaOpenTimesheetActions(id, row);
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
  const todayIso = kaTodayIso();
  const isSessionToday = (s) => String(s?.date || '').slice(0, 10) === todayIso;
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
    isSessionToday(activeSession) &&
    (Number.isFinite(normalizedActiveSessionId) ||
      (kaKiosk && kaKiosk.project_id !== undefined && kaKiosk.project_id !== null));
  const isSessionActive = (s) => {
    if (!s) return false;
    if (!isSessionToday(s)) return false;
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
      const assignedTo = s.assigned_to_name || '';
      const combined = `${projectLabel} ${createdBy} ${assignedTo}`.toLowerCase();
      return combined.includes(query);
    });
  }
  if (kaSessionFilterMode === 'active') {
    filtered = filtered.filter(s => {
      const isActive = isSessionActive(s);
      if (isActive) return true;
      // If no active session is configured yet, still surface sessions with open punches
      if (!hasExplicitActive) {
        return kaSessionCounts(s).openCount > 0;
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
    const assignedBaseName = s.assigned_to_name || s.created_by_name || '';
    const assignedLabel = assignedBaseName
      ? `Assigned to: ${String(assignedBaseName)}`
      : 'Assigned to: —';
    const { openCount, entryCount } = kaSessionCounts(s);
    const isClosed = kaIsSessionClosed(s);
    const isOngoing = isSessionToday(s) && !isClosed && (isActive || openCount > 0);
    const assignDisplayHtml = `<div class="ka-session-owner">${assignedLabel}</div>`;
    const row = document.createElement('div');
    row.className = `ka-session-row${isActive ? ' is-active' : ''}${isClosed ? ' is-closed' : ''}`;
    row.dataset.sessionId = s.id;
    row.dataset.projectId = Number.isFinite(Number(s.project_id)) ? String(s.project_id) : '';
    row.addEventListener('pointerup', (event) => {
      kaDebugTapFlash(row, `row pointerup:${event.pointerType}`);
      kaDebugTapLog(`row pointerup row=${row.dataset.sessionId || ''} type=${event.pointerType}`);
      if (event.pointerType === 'mouse') return;
      if (event.target.closest('[data-ka-delete-session]')) return;
      if (event.target.closest('[data-ka-session-actions]')) return;
    }, { capture: true });

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
      <span aria-hidden="true"></span>
    `;
    main.appendChild(columns);

    const head = document.createElement('div');
    head.className = 'ka-session-head';
    head.innerHTML = `
      <div class="ka-session-info">
        <span class="ka-session-active-icon ${isActive ? 'is-active' : ''}"></span>
        <div class="ka-session-info-text">
          <div class="ka-session-label">${projName}</div>
          ${assignDisplayHtml}
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
    detail.dataset.kaSessionActions = s.id;
    detail.setAttribute('aria-label', 'Timesheet actions');
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
    if (kaCanAssignTimesheets()) {
      await kaLoadTimesheetAssignees();
    }
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

    const isTodayView = kaTimesheetSelectedDate() === kaTodayIso();
    const closePromptCandidates = [];
    if (isTodayView) {
      (kaSessions || []).forEach(session => {
        if (!session || session.id === undefined || session.id === null) return;
        const sessionId = Number(session.id);
        const { openCount, entryCount } = kaSessionCounts(session);
        const prevOpen = kaSessionOpenCountCache.get(sessionId);
        const isToday = String(session.date || '').slice(0, 10) === kaTodayIso();
        if (
          isToday &&
          openCount === 0 &&
          entryCount > 0 &&
          !kaIsSessionClosed(session) &&
          !kaSessionClosePrompted.has(sessionId) &&
          (prevOpen === undefined || prevOpen > 0)
        ) {
          closePromptCandidates.push(session);
        }
        kaSessionOpenCountCache.set(sessionId, openCount);
      });
    }
    const activeSession = isTodayView ? kaComputeActiveSession(kaSessions) : null;
    if (isTodayView) {
      kaActiveSessionId = activeSession ? activeSession.id : null;
      if (!kaKiosk.project_id && activeSession && activeSession.project_id) {
        kaKiosk.project_id = activeSession.project_id;
      }
    }

    kaRenderSessions();
    kaRenderLiveTimesheetFilter();
    kaUpdateActiveProjectUI();
    await kaRefreshAdminPunchStatus();
    await kaRefreshLiveData();
    if (closePromptCandidates.length && kaCurrentView === 'timesheets') {
      const activeCandidate = closePromptCandidates.find(s => kaIsSessionActive(s));
      const promptSession = activeCandidate || closePromptCandidates[0];
      if (promptSession && promptSession.id != null) {
        await kaPromptCloseSession(promptSession);
      }
    }
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
  const selectedDate = kaTimesheetSelectedDate();
  const dateLabel = kaFmtDateLong(selectedDate) || kaFmtDateLongTZ(new Date());

  if (selectedDate && selectedDate < kaTodayIso()) {
    const msg = 'Cannot create timesheets for past dates.';
    if (status) {
      status.textContent = msg;
      status.className = 'ka-status ka-status-error';
    }
    kaShowStatusMessage(msg, 'error', 6000);
    return;
  }

  if (selectedDate && selectedDate > kaTodayIso()) {
    const msg = 'Cannot create timesheets for future dates.';
    if (status) {
      status.textContent = msg;
      status.className = 'ka-status ka-status-error';
    }
    kaShowStatusMessage(msg, 'error', 6000);
    return;
  }

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

  const todayIso = kaTodayIso();
  const isToday = selectedDate === todayIso;
  const todaySessions = isToday
    ? (kaSessions || []).filter(s => (s.date || '').slice(0, 10) === todayIso)
    : [];
  const hasSessionToday = isToday && todaySessions.length > 0;
  const activeProjectId =
    kaKiosk && kaKiosk.project_id !== undefined && kaKiosk.project_id !== null
      ? Number(kaKiosk.project_id)
      : null;
  const activeProjectLabel = Number.isFinite(activeProjectId)
    ? (kaProjectLabelById(activeProjectId) || `Project ${activeProjectId}`)
    : '';

  const buildToggleState = (targetProjectId) => {
    if (!targetProjectId) {
      return {
        active: { visible: false },
        punch: { visible: false }
      };
    }

    const normalizedTarget = Number(targetProjectId);
    const activeMatches =
      Number.isFinite(activeProjectId) && Number(activeProjectId) === normalizedTarget;
    const hasActiveToday = isToday && Number.isFinite(activeProjectId);
    const isFirstToday = isToday && !hasSessionToday;

    let activeChecked = false;
    if (activeMatches) {
      activeChecked = true;
    } else if (isToday && (isFirstToday || !hasActiveToday)) {
      activeChecked = true;
    }

    let activeNote = '';
    if (activeMatches) {
      activeNote = 'Already the active project for this kiosk.';
    } else if (!isToday) {
      activeNote = "Active project affects today's punches on this kiosk.";
    } else if (hasActiveToday && activeProjectLabel) {
      activeNote = `Current active project: ${activeProjectLabel}.`;
    } else {
      activeNote = 'New worker punches use the active project on this kiosk.';
    }

    const activeToggle = {
      visible: true,
      checked: activeChecked,
      disabled: activeMatches,
      label: 'Set this as the active project for this kiosk',
      note: activeNote
    };

    const punchToggle = {
      visible: !!adminId,
      checked: false,
      disabled: false,
      label: 'Clock in to this project',
      note: ''
    };

    if (!adminId) {
      return { active: activeToggle, punch: punchToggle };
    }

    if (adminOpen && Number(currentProjId) === normalizedTarget) {
      punchToggle.disabled = true;
      punchToggle.note = 'You are already clocked in on this project.';
    } else if (kaClockInPhotoRequired) {
      punchToggle.disabled = true;
      punchToggle.note = 'Photo is required to clock in from the worker screen.';
    } else if (adminOpen) {
      punchToggle.label = 'Clock out of your current project and clock in to this project';
      punchToggle.note = currentLabel
        ? `You are clocked in on ${currentLabel}.`
        : 'You are clocked in on another project.';
    } else {
      punchToggle.checked = true;
      punchToggle.note = 'Clock in to this project after starting the timesheet.';
    }

    return { active: activeToggle, punch: punchToggle };
  };

  const buildPrompt = (targetProjectId) => {
    if (!targetProjectId) {
      return {
        message: 'Select a project to start a timesheet.',
        projectLabel: '',
        toggles: buildToggleState(targetProjectId)
      };
    }
    const projectLabel = kaProjectLabelById(targetProjectId) || `Project ${targetProjectId}`;
    const message = `Start a timesheet for ${projectLabel} (${dateLabel}).`;
    return {
      message,
      projectLabel,
      toggles: buildToggleState(targetProjectId)
    };
  };

  const duplicateSessionMessage = (targetProjectId) => {
    if (!targetProjectId) return null;
    const existing = kaFindOpenSessionForProjectToday(targetProjectId);
    if (!existing) return null;
    const label =
      kaProjectLabelById(targetProjectId) ||
      kaSessionProjectLabel(existing);
    return `A timesheet for ${label} is already open on this tablet. Close it or choose another project.`;
  };

  const defaultProjectId = opts.useModal ? null : inlineProjectId;
  let projectId =
    opts.projectId !== undefined && opts.projectId !== null
      ? opts.projectId
      : defaultProjectId;
  let modalResult = { action: 'yes', projectId };
  let projectLabel = '';
  let usedModal = false;

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
    usedModal = true;
    modalResult = await kaShowClockInModal({
      projectId,
      adminName,
      titleText: 'Start timesheet',
      message: prompt.message,
      yesLabel: 'Start timesheet',
      skipLabel: 'Cancel',
      projectOptions,
      projectLabelText: 'Project',
      allowBlankProject: true,
      toggles: prompt.toggles,
      onConfirm: ({ projectId: selectedId }) => {
        const msg = duplicateSessionMessage(selectedId);
        if (msg) return { ok: false, message: msg };
        return { ok: true };
      },
      onProjectChange: (nextProjectId) => {
        const nextPrompt = buildPrompt(nextProjectId);
        return {
          message: nextPrompt.message,
          toggles: nextPrompt.toggles
        };
      }
    });
    projectId = modalResult.projectId || projectId;
    projectLabel = buildPrompt(projectId).projectLabel;

    if (modalResult.action !== 'yes') {
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
      usedModal = true;
      modalResult = await kaShowClockInModal({
        projectId,
        adminName,
        titleText: 'Start timesheet',
        message: prompt.message,
        yesLabel: 'Start timesheet',
        skipLabel: 'Cancel',
        toggles: prompt.toggles,
        onConfirm: ({ projectId: selectedId }) => {
          const msg = duplicateSessionMessage(selectedId);
          if (msg) return { ok: false, message: msg };
          return { ok: true };
        }
      });
      if (modalResult.action !== 'yes') {
        if (status) {
          status.textContent = 'Timesheet not started.';
          status.className = 'ka-status ka-status-error';
        }
        return;
      }
    }
  }

  if (!usedModal) {
    const msg = duplicateSessionMessage(projectId);
    if (msg) {
      if (status) {
        status.textContent = msg;
        status.className = 'ka-status ka-status-error';
      }
      kaShowStatusMessage(msg, 'error', 8000);
      return;
    }
  }

  const toggleDefaults = buildToggleState(projectId);
  let shouldMakeActive =
    modalResult.makeActive !== undefined
      ? modalResult.makeActive
      : !!(toggleDefaults.active && toggleDefaults.active.checked);
  const shouldMovePunch =
    modalResult.movePunch !== undefined
      ? modalResult.movePunch
      : !!(toggleDefaults.punch && toggleDefaults.punch.checked);
  const forcedActiveForPunch = shouldMovePunch && !shouldMakeActive;
  if (forcedActiveForPunch) {
    shouldMakeActive = true;
  }

  if (status) {
    status.textContent = 'Starting timesheet…';
    status.className = 'ka-status';
  }

  try {
    const pos = await kaGetPosition();
    const wantsSwitch =
      adminOpen &&
      shouldMovePunch &&
      Number(currentProjId) !== Number(projectId);
    const wantsClockIn =
      !adminOpen &&
      shouldMovePunch &&
      !kaClockInPhotoRequired &&
      !!adminId;
    const resp = await kaCreateSessionWithGeo({
      projectId,
      makeActive: shouldMakeActive,
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
    let activeSetOk = !shouldMakeActive;
    if (shouldMakeActive) {
      if (resp && resp.session && resp.session.id) {
        if (resp && resp.active_project_id) {
          kaActiveSessionId = resp.session.id;
          kaKiosk.project_id = resp.active_project_id;
          activeSetOk = true;
        } else {
          activeSetOk = await kaSetActiveSession(resp.session.id, { silent: true });
        }
      } else {
        activeSetOk = false;
      }
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
          kaShowClockInPrompt({
            projectId,
            adminId,
            adminName,
            message: `${adminName} is not clocked in. Clock in to a timesheet for today?`
          });
        }
      } else if (wantsSwitch) {
        if (shouldMakeActive && !activeSetOk) {
          kaShowStatusMessage(
            'Timesheet started, but the active project did not update. Please tap Set Active on the timesheet before switching your punch.',
            'error',
            9000
          );
        } else {
          try {
            await kaSwitchAdminProject(currentProjId, projectId, {
              inSessionId: resp && resp.session ? resp.session.id : null
            });
            if (shouldMakeActive) {
              activeSetOk = true;
            }
            kaShowStatusMessage(
              `Switched from ${currentLabel} to ${projectLabel} for ${adminName}.`,
              'ok',
              10000
            );
          } catch (err) {
            console.error('Error switching admin project:', err);
            const msg = err && err.message
              ? err.message
              : 'Switch failed. Please try again or clock out/in manually.';
            kaShowStatusMessage(msg, 'error', 8000);
          }
        }
      }
    }

    if (status) {
      if (shouldMakeActive && !activeSetOk) {
        status.textContent = 'Timesheet started, but active project did not update.';
        status.className = 'ka-status ka-status-error';
      } else {
        status.textContent = shouldMakeActive
          ? 'Timesheet started and set active.'
          : 'Timesheet started.';
        status.className = 'ka-status ka-status-ok';
      }
    }
    kaRenderProjectsSelect();
    kaUpdateActiveProjectUI();
    await kaRefreshLiveData();
    if (shouldMakeActive && activeSetOk) {
      kaMarkDayStarted();
    }

    // First active project of the day → offer to return to clock-in
    if (shouldMakeActive && activeSetOk && !kaFirstActiveSetShown && isKioskDayStarted() === false) {
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

async function kaSetActiveSession(sessionId, opts = {}) {
  if (!kaKiosk || !kaKiosk.id || !sessionId) return false;
  const { silent = false } = opts || {};
  const status = document.getElementById('ka-session-status');
  if (!silent && status) {
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
    if (!silent && status) {
      status.textContent = 'Active project updated for this kiosk.';
      status.className = 'ka-status ka-status-ok';
    }
    return true;
  } catch (err) {
    console.error('Error setting active session:', err);
    if (!silent && status) {
      status.textContent = err && err.message ? err.message : 'Error setting active session.';
      status.className = 'ka-status ka-status-error';
    }
    return false;
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
  const dateLabel = kaFmtDateMDY(new Date());
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
  toggles,
  onProjectChange,
  allowBlankProject,
  onConfirm
}) {
  const backdrop = document.getElementById('ka-clockin-modal-backdrop');
  const text = document.getElementById('ka-clockin-modal-text');
  const title = document.getElementById('ka-clockin-modal-title');
  const closeBtn = document.getElementById('ka-clockin-modal-close');
  const yesBtn = document.getElementById('ka-clockin-modal-yes');
  const skipBtn = document.getElementById('ka-clockin-modal-skip');
  const errorEl = document.getElementById('ka-clockin-modal-error');
  const projWrap = document.getElementById('ka-clockin-modal-project-wrap');
  const projSel = document.getElementById('ka-clockin-modal-project');
  const projLabel = document.getElementById('ka-clockin-modal-project-label');
  const togglesWrap = document.getElementById('ka-clockin-modal-toggles');
  const activeToggle = document.getElementById('ka-clockin-modal-active');
  const activeLabel = document.getElementById('ka-clockin-modal-active-label');
  const activeNote = document.getElementById('ka-clockin-modal-active-note');
  const punchToggle = document.getElementById('ka-clockin-modal-punch');
  const punchLabel = document.getElementById('ka-clockin-modal-punch-label');
  const punchNote = document.getElementById('ka-clockin-modal-punch-note');
  if (!backdrop || !text || !title || !closeBtn || !yesBtn || !skipBtn) {
    return Promise.resolve({ action: 'dismiss', projectId });
  }

  const projectLabel = projectId ? (kaProjectLabelById(projectId) || 'this project') : 'this project';
  const dateLabel = kaFmtDateMDY(new Date());
  title.textContent = titleText || 'Clock in?';
  text.textContent =
    message || `Timesheet created for ${projectLabel} (${dateLabel}). Clock in ${adminName} as well?`;
  yesBtn.textContent = yesLabel || 'Clock in';
  skipBtn.textContent = skipLabel || 'Skip';

  const setError = (msg) => {
    if (!errorEl) return;
    if (!msg) {
      errorEl.textContent = '';
      errorEl.classList.add('hidden');
      return;
    }
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
  };
  setError('');

  const applyToggle = (inputEl, labelEl, noteEl, cfg = {}) => {
    if (!inputEl || !labelEl || !noteEl) return false;
    const visible = cfg.visible !== false;
    labelEl.style.display = visible ? '' : 'none';
    inputEl.dataset.visible = visible ? '1' : '0';
    if (!visible) {
      inputEl.checked = false;
      inputEl.disabled = true;
      noteEl.style.display = 'none';
      noteEl.textContent = '';
      return false;
    }
    if (cfg.label) {
      const span = labelEl.querySelector('span');
      if (span) span.textContent = cfg.label;
    }
    if (cfg.checked !== undefined) {
      inputEl.checked = !!cfg.checked;
    }
    inputEl.disabled = !!cfg.disabled;
    labelEl.classList.toggle('ka-toggle-disabled', !!cfg.disabled);
    const noteText = cfg.note || '';
    noteEl.textContent = noteText;
    noteEl.style.display = noteText ? 'block' : 'none';
    return true;
  };

  const applyToggleState = (state) => {
    if (!togglesWrap) return;
    const activeState = state && state.active ? state.active : { visible: false };
    const punchState = state && state.punch ? state.punch : { visible: false };
    const activeVisible = applyToggle(activeToggle, activeLabel, activeNote, activeState);
    const punchVisible = applyToggle(punchToggle, punchLabel, punchNote, punchState);
    togglesWrap.classList.toggle('hidden', !(activeVisible || punchVisible));
  };

  applyToggleState(toggles);

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
      setError('');
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
      if (updates.toggles !== undefined) applyToggleState(updates.toggles);
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

    const readToggleState = () => {
      const state = {};
      if (activeToggle && activeToggle.dataset.visible === '1') {
        state.makeActive = !!activeToggle.checked;
      }
      if (punchToggle && punchToggle.dataset.visible === '1') {
        state.movePunch = !!punchToggle.checked;
      }
      return state;
    };

    yesBtn.onclick = async () => {
      setError('');
      const payload = { action: 'yes', projectId: currentProjectId(), ...readToggleState() };
      if (typeof onConfirm === 'function') {
        const wasDisabled = yesBtn.disabled;
        yesBtn.disabled = true;
        let validation = null;
        try {
          validation = await onConfirm(payload);
        } catch (err) {
          validation = { ok: false, message: err && err.message ? err.message : 'Unable to start timesheet.' };
        }
        yesBtn.disabled = wasDisabled;
        if (validation === false) {
          setError('Unable to start timesheet.');
          return;
        }
        if (typeof validation === 'string') {
          setError(validation);
          return;
        }
        if (validation && typeof validation === 'object' && validation.ok === false) {
          setError(validation.message || validation.error || 'Unable to start timesheet.');
          return;
        }
      }
      cleanup(payload);
    };
    skipBtn.onclick = () => cleanup({ action: 'skip', projectId: currentProjectId(), ...readToggleState() });
    closeBtn.onclick = () => cleanup({ action: 'dismiss', projectId: currentProjectId(), ...readToggleState() });
    backdrop.onclick = (e) => {
      if (e.target === backdrop) {
        cleanup({ action: 'dismiss', projectId: currentProjectId(), ...readToggleState() });
      }
    };
  });
}

async function kaEnsureActiveProject(projectId, { sessionId = null } = {}) {
  if (!projectId) return false;
  const normalizedProjectId = Number(projectId);
  if (!Number.isFinite(normalizedProjectId)) return false;
  if (kaKiosk && Number(kaKiosk.project_id) === normalizedProjectId) {
    return true;
  }
  let targetSessionId = sessionId != null ? Number(sessionId) : null;
  if (!Number.isFinite(targetSessionId)) {
    targetSessionId = null;
  }
  if (!targetSessionId) {
    const session = kaFindOpenSessionForProjectToday(normalizedProjectId);
    if (session && session.id != null) {
      targetSessionId = Number(session.id);
    }
  }
  if (!targetSessionId) return false;
  const ok = await kaSetActiveSession(targetSessionId, { silent: true });
  return !!ok && !!(kaKiosk && Number(kaKiosk.project_id) === normalizedProjectId);
}

async function kaSwitchAdminProject(fromProjectId, toProjectId, opts = {}) {
  if (!kaCurrentAdmin || !kaCurrentAdmin.id || !toProjectId) return;
  const adminId = Number(kaCurrentAdmin.id);
  const targetProjectId = Number(toProjectId);
  const sourceProjectId =
    fromProjectId !== undefined && fromProjectId !== null
      ? Number(fromProjectId)
      : null;
  const inSessionId =
    opts && opts.inSessionId !== undefined && opts.inSessionId !== null
      ? Number(opts.inSessionId)
      : null;

  // 1) Refresh current status
  await kaRefreshAdminPunchStatus();
  const open =
    kaAdminOpenPunch && kaAdminOpenPunch.open ? kaAdminOpenPunch : null;

  // If already on target, just refresh UI
  if (open && Number(open.project_id) === targetProjectId) {
    await kaEnsureActiveProject(targetProjectId, { sessionId: inSessionId });
    await kaRefreshSessionsAndLive();
    return;
  }

  const pos = await kaGetPosition();

  // 2) If clocked in elsewhere, clock out first
  if (open) {
    const outProjectId =
      sourceProjectId !== null ? sourceProjectId : open.project_id;
    const outActiveOk = await kaEnsureActiveProject(outProjectId);
    if (!outActiveOk) {
      throw new Error(
        'Active project must match your current punch before clocking out. Set it active first.'
      );
    }
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
  const inActiveOk = await kaEnsureActiveProject(targetProjectId, { sessionId: inSessionId });
  if (!inActiveOk) {
    throw new Error('Unable to set the active project for clock-in. Set it active first.');
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

  if (openCount > 0) {
    kaNotifySessionDeleteBlocked('Cannot delete a timesheet that has time entries.', row);
    return;
  }

  if (entryCount > 0) {
    kaNotifySessionDeleteBlocked('Cannot delete a timesheet with time entries.', row);
    return;
  }

  const isActive = session ? kaIsSessionActive(session) : false;
  let replacementSessionId = null;
  if (isActive) {
    const today = kaTodayIso();
    const replacementCandidates = kaSortSessionsByRecency(kaSessions || []).filter(s => {
      if (!s || Number(s.id) === Number(sessionId)) return false;
      if (kaIsSessionClosed(s)) return false;
      return String(s.date || '').slice(0, 10) === today;
    });

    if (replacementCandidates.length) {
      replacementSessionId = await kaShowActiveReplacementModal({
        session,
        options: replacementCandidates
      });
      if (!replacementSessionId) {
        kaHideSessionDelete(row);
        return;
      }
    } else {
      const projectLabel = kaSessionProjectLabel(session);
      const dateLabel = kaFmtDateLong(session?.date || today);
      const confirmMsg =
        `Delete the active timesheet for ${projectLabel} (${dateLabel})? ` +
        'This will clear the active project for this kiosk, so workers will see "No active timesheet" until you set a new one.';
      const confirmed = await kaShowConfirmDialog(confirmMsg, {
        title: 'Delete active timesheet?',
        okLabel: 'Delete timesheet',
        cancelLabel: 'Cancel'
      });
      if (!confirmed) return;
    }
  }

  const storedHash = kaCurrentAdmin ? (kaCurrentAdmin.pin_hash || '') : '';
  const pin = await kaPromptAdminPin({
    title: 'Enter PIN to confirm delete',
    message: ' ',
    confirmLabel: 'Continue',
    validatePin: (enteredPin) => {
      if (storedHash && !kaVerifyPinHash(enteredPin, storedHash)) {
        return 'Incorrect PIN.';
      }
      return null;
    }
  });
  if (!pin) return;

  if (replacementSessionId) {
    const setOk = await kaSetActiveSession(replacementSessionId);
    if (!setOk) return;
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
    kaRenderLiveTimesheetFilter();
    kaUpdateActiveProjectUI();
    await kaRefreshLiveData();
    if (status) {
      status.textContent = 'Timesheet deleted.';
      status.className = 'ka-status ka-status-ok';
    }
  } catch (err) {
    console.error('Error deleting timesheet:', err);
    const message = err && err.message ? err.message : 'Error deleting timesheet.';
    if (/pin/i.test(message)) {
      kaRegisterPinFailure('admin');
    }
    if (status) {
      status.textContent = message;
      status.className = 'ka-status ka-status-error';
    }
    kaNotifySessionDeleteBlocked(message, row);
  }
}

async function kaPromptCloseSession(session, row = null) {
  if (!session || session.id === undefined || session.id === null) return;
  const sessionId = Number(session.id);
  if (!Number.isFinite(sessionId)) return;
  if (kaSessionClosePrompted.has(sessionId)) return;
  if (kaIsSessionClosed(session)) return;
  const { openCount, entryCount } = kaSessionCounts(session);
  if (openCount > 0 || entryCount <= 0) return;
  const isToday = String(session.date || '').slice(0, 10) === kaTodayIso();
  if (!isToday) return;

  const projectLabel = kaSessionProjectLabel(session);
  const dateLabel = kaFmtDateLong(session?.date || kaTodayIso());
  const confirmMsg =
    `Close ${projectLabel} for ${dateLabel}? ` +
    'You cannot reopen it. Start a new timesheet to keep working on this project.';
  const confirmed = await kaShowConfirmDialog(confirmMsg, {
    title: 'Close timesheet?',
    okLabel: 'Close timesheet',
    cancelLabel: 'Cancel'
  });
  kaSessionClosePrompted.add(sessionId);
  if (!confirmed) return;
  await kaCloseSession(sessionId, row, { skipConfirm: true });
}

async function kaCloseSession(sessionId, row = null, { skipConfirm = false } = {}) {
  if (!kaKiosk || !sessionId) return;
  const status = document.getElementById('ka-session-status');
  const session = (kaSessions || []).find(s => Number(s.id) === Number(sessionId));
  if (!session) return;

  if (kaIsSessionClosed(session)) {
    if (status) {
      status.textContent = 'Timesheet is already closed.';
      status.className = 'ka-status';
    }
    return;
  }

  const { openCount } = kaSessionCounts(session);
  if (openCount > 0) {
    const msg = 'Cannot close this timesheet while workers are clocked in.';
    if (status) {
      status.textContent = msg;
      status.className = 'ka-status ka-status-error';
    }
    kaShowStatusMessage(msg, 'error', 5000);
    return;
  }

  if (!skipConfirm) {
    const projectLabel = kaSessionProjectLabel(session);
    const dateLabel = kaFmtDateLong(session?.date || kaTodayIso());
    const confirmMsg =
      `Close ${projectLabel} for ${dateLabel}? ` +
      'You cannot reopen it. Start a new timesheet to keep working on this project.';
    const confirmed = await kaShowConfirmDialog(confirmMsg, {
      title: 'Close timesheet?',
      okLabel: 'Close timesheet',
      cancelLabel: 'Cancel'
    });
    if (!confirmed) {
      return;
    }
  }

  if (status) {
    status.textContent = 'Closing timesheet…';
    status.className = 'ka-status';
  }

  try {
    const resp = await fetchJSON(`/api/kiosk-sessions/${sessionId}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_id: kaCurrentAdmin?.id })
    });

    session.ended_at = resp && resp.ended_at ? resp.ended_at : new Date().toISOString();
    kaSessionClosePrompted.add(sessionId);
    kaSessionOpenCountCache.set(sessionId, 0);

    if (kaActiveSessionId && Number(kaActiveSessionId) === Number(sessionId)) {
      kaActiveSessionId = null;
    }
    if (kaKiosk && kaKiosk.project_id && Number(session.project_id) === Number(kaKiosk.project_id)) {
      kaKiosk.project_id = null;
    }

    kaRenderProjectsSelect();
    kaRenderSessions();
    kaRenderLiveTimesheetFilter();
    kaUpdateActiveProjectUI();
    await kaRefreshLiveData();

    if (status) {
      status.textContent = 'Timesheet closed.';
      status.className = 'ka-status ka-status-ok';
    }
  } catch (err) {
    console.error('Error closing timesheet:', err);
    const message = err && err.message ? err.message : 'Error closing timesheet.';
    if (status) {
      status.textContent = message;
      status.className = 'ka-status ka-status-error';
    }
    kaShowStatusMessage(message, 'error', 5000);
  }
}

function kaHandleSessionTouchStart(e) {
  const row = e.target.closest('.ka-session-row');
  if (!row || !e.touches || !e.touches.length) return;
  kaDebugTapFlash(row, 'touchstart');
  kaDebugTapLog(`touchstart row=${row.dataset.sessionId || ''}`);
  row.dataset.touchStartX = String(e.touches[0].clientX);
  const target = e.target.closest('[data-ka-delete-session]') ? 'delete'
    : e.target.closest('[data-ka-session-actions]') ? 'detail'
    : 'row';
  row.dataset.touchStartTarget = target;
}

function kaHandleSessionTouchEnd(e) {
  const row = e.target.closest('.ka-session-row');
  if (!row) return;
  kaDebugTapFlash(row, 'touchend');
  kaDebugTapLog(`touchend row=${row.dataset.sessionId || ''} target=${row.dataset.touchStartTarget || ''}`);
  const startX = Number(row.dataset.touchStartX || 0);
  const endX = e.changedTouches && e.changedTouches.length ? e.changedTouches[0].clientX : startX;
  const delta = endX - startX;
  const startTarget = row.dataset.touchStartTarget || 'row';
  if (delta < -40) {
    kaShowSessionDelete(row);
  } else if (delta > 40) {
    kaHideSessionDelete(row);
  } else if (Math.abs(delta) < 10) {
    // For taps: only auto-hide if the tap wasn't on the delete/actions buttons
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

  kaSetViewportHeightVar();
  window.addEventListener('resize', kaSetViewportHeightVar);
  window.addEventListener('orientationchange', kaSetViewportHeightVar);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', kaSetViewportHeightVar);
  }

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
  const menuToggles = Array.from(document.querySelectorAll('.ka-header-menu-toggle'));
  const menuPanel = document.getElementById('ka-header-menu-panel');
  const menuBackdrop = document.getElementById('ka-sidebar-backdrop');
  if (menuToggles.length && menuPanel) {
    const setExpanded = (isOpen) => {
      menuToggles.forEach((toggle) => {
        toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      });
    };
    const closeMenu = () => {
      menuPanel.classList.remove('is-open');
      setExpanded(false);
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
      setExpanded(true);
      menuPanel.setAttribute('aria-hidden', 'false');
      document.body.classList.add('ka-modal-open');
      document.documentElement.classList.add('ka-modal-open');
      requestAnimationFrame(() => {
        menuPanel.classList.add('is-open');
      });
    };
    menuToggles.forEach((toggle) => {
      toggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isOpen = menuPanel.classList.contains('is-open');
        if (isOpen) {
          closeMenu();
        } else {
          openMenu();
        }
      });
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
        if (typeof window.kaOpenHelpModal === 'function') {
          window.kaOpenHelpModal();
          return;
        }
        const helpBackdrop = document.getElementById('ka-help-backdrop');
        if (helpBackdrop) {
          helpBackdrop.classList.remove('hidden');
          document.body.classList.add('ka-modal-open');
          document.documentElement.classList.add('ka-modal-open');
        }
        return;
      }
      if (view === 'employees') {
        closeMenu();
        kaOpenEmployeesSheet();
        return;
      }
      if (action === 'account') {
        closeMenu();
        kaOpenAccountSheet();
        return;
      }
      if (action === 'settings') {
        closeMenu();
        kaOpenSettingsSheet();
        return;
      }
      if (view && KA_VIEWS.includes(view)) {
        kaShowView(view);
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

  const helpButtons = Array.from(document.querySelectorAll('[data-ka-help]'));
  const fallbackHelp = document.getElementById('ka-timesheet-help');
  if (fallbackHelp && !helpButtons.includes(fallbackHelp)) {
    if (!fallbackHelp.dataset.kaHelp) fallbackHelp.dataset.kaHelp = 'timesheets';
    helpButtons.push(fallbackHelp);
  }
  const helpBackdrop = document.getElementById('ka-help-backdrop');
  const helpClose = document.getElementById('ka-help-close');
  const helpModal = helpBackdrop
    ? helpBackdrop.querySelector('.ka-help-modal') || helpBackdrop.querySelector('.ka-modal')
    : null;
  const helpSectionMap = {
    timesheets: 'ka-help-timesheets',
    'time-entries': 'ka-help-time-entries'
  };
  if (helpBackdrop) {
    const closeHelp = () => {
      helpBackdrop.classList.add('hidden');
      document.body.classList.remove('ka-modal-open');
      document.documentElement.classList.remove('ka-modal-open');
    };
    const scrollHelpToSection = (target) => {
      if (!target) {
        if (helpModal) helpModal.scrollTop = 0;
        return;
      }
      const sectionId = helpSectionMap[target] || target;
      const section = document.getElementById(sectionId);
      if (!section) return;
      if (!helpModal) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const modalRect = helpModal.getBoundingClientRect();
      const sectionRect = section.getBoundingClientRect();
      helpModal.scrollTop += sectionRect.top - modalRect.top - 12;
    };
    const openHelp = (target = null) => {
      helpBackdrop.classList.remove('hidden');
      document.body.classList.add('ka-modal-open');
      document.documentElement.classList.add('ka-modal-open');
      requestAnimationFrame(() => scrollHelpToSection(target));
    };
    window.kaOpenHelpModal = openHelp;
    helpButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openHelp(btn.dataset.kaHelp || null);
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

  document.addEventListener('click', (e) => {
    const pill = e.target.closest('.ka-time-review-issue[data-tooltip]');
    if (!pill) {
      kaCloseTimeReviewIssueTips();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const isOpen = pill.classList.contains('is-tip-open');
    kaCloseTimeReviewIssueTips();
    if (!isOpen) {
      pill.classList.add('is-tip-open');
      pill.focus();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      kaCloseTimeReviewIssueTips();
      return;
    }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const pill = e.target.closest('.ka-time-review-issue[data-tooltip]');
    if (!pill) return;
    e.preventDefault();
    const isOpen = pill.classList.contains('is-tip-open');
    kaCloseTimeReviewIssueTips();
    if (!isOpen) {
      pill.classList.add('is-tip-open');
    }
  });

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
  document
    .getElementById('ka-employee-add-cta')
    ?.addEventListener('click', () => kaSetEmployeeFormVisible(!kaEmployeeFormVisible));
  document
    .getElementById('ka-employee-add-cancel')
    ?.addEventListener('click', () => kaSetEmployeeFormVisible(false));
  const employeeSearch = document.getElementById('ka-employee-search');
  if (employeeSearch) {
    employeeSearch.addEventListener('input', () => {
      kaEmployeeSearchQuery = employeeSearch.value || '';
      kaRenderEmployeesGrid();
    });
    employeeSearch.addEventListener('search', () => {
      kaEmployeeSearchQuery = employeeSearch.value || '';
      kaRenderEmployeesGrid();
    });
  }
  document
    .getElementById('ka-employee-status-filter')
    ?.addEventListener('change', (e) => {
      kaEmployeeStatusFilter = e.target && e.target.value ? e.target.value : 'all';
      kaRenderEmployeesGrid();
    });
  document
    .getElementById('ka-employee-detail-save')
    ?.addEventListener('click', kaHandleEmployeeSheetSave);
  document
    .getElementById('ka-employee-detail-reactivate')
    ?.addEventListener('click', () => {
      const id = kaEmployeeSheetState.employeeId;
      if (!id) return;
      const emp = kaFindEmployeeById(id);
      if (!emp || emp.active !== 0) return;
      kaEmployeeSheetState.reactivatePending = true;
      kaEmployeeSheetState.reactivateSnapshot = {
        start_date: emp.start_date || null,
        termination_date: emp.termination_date || null
      };
      const els = kaEmployeeSheetElements();
      if (els && els.saveStatus) {
        kaSetInlineStatus(
          els.saveStatus,
          'Reactivation selected. Enter a new start date, then Save & Close.',
          'ok'
        );
      }
    });
  document
    .getElementById('ka-employee-detail-history-open')
    ?.addEventListener('click', () => kaOpenEmployeeHistoryModal());
  document
    .getElementById('ka-employee-detail-pin-open')
    ?.addEventListener('click', () => kaOpenEmployeePinSheet(kaEmployeeSheetState.employeeId));
  document
    .getElementById('ka-employee-pin-save')
    ?.addEventListener('click', kaHandleEmployeePinSave);
  document
    .getElementById('ka-employee-detail-photo-btn')
    ?.addEventListener('click', () => {
      const input = document.getElementById('ka-employee-detail-photo-input');
      if (input) input.click();
    });
  document
    .getElementById('ka-employee-detail-photo-input')
    ?.addEventListener('change', (e) => {
      const file = e.target && e.target.files ? e.target.files[0] : null;
      if (file) kaHandleEmployeePhotoUpload(file);
    });
  const photoImg = document.getElementById('ka-employee-detail-photo');
  if (photoImg && !photoImg.dataset.bound) {
    const initials = document.getElementById('ka-employee-detail-initials');
    photoImg.addEventListener('load', () => {
      photoImg.classList.remove('hidden');
      if (initials) initials.classList.add('hidden');
    });
    photoImg.addEventListener('error', () => {
      photoImg.classList.add('hidden');
      if (initials) initials.classList.remove('hidden');
    });
    photoImg.dataset.bound = '1';
  }
  kaBindEmployeeDocsUploader();
  kaBindEmployeeDocsViewer();
  window.addEventListener('online', () => {
    kaSyncOfflineData('online');
    kaStartOfflineSyncLoop();
    kaUpdateOfflineIndicator();
    kaSyncNotificationPrefsQueue().catch(err => {
      console.warn('Notification prefs sync failed:', err);
    });
    kaSyncShipmentNotifyPrefsQueue().catch(err => {
      console.warn('Shipment notification prefs sync failed:', err);
    });
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
  kaBindItemsSheetSwipe();

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
  kaBindEmployeeHistoryModal();

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

  const runReport = () => {
    kaTimeReportHasRun = true;
    kaSetTimeReportVisible(true);
    if (kaTimeViewMode !== 'view') {
      kaSetTimeViewMode('view', { skipLoad: true });
    }
    kaOpenTimeReportSheet();
    kaLoadTimeEntries();
  };
  const runReview = () => {
    kaTimeReportHasRun = true;
    kaSetTimeReportVisible(true);
    kaOpenTimeReviewSheet({ forceRefresh: true });
  };
  document
    .getElementById('ka-time-refresh')
    ?.addEventListener('click', () => {
      kaSetTimeRange('custom');
      runReport();
    });
  document
    .getElementById('ka-time-run')
    ?.addEventListener('click', runReport);
  document
    .getElementById('ka-time-review-banner')
    ?.addEventListener('click', runReview);
  kaShowApprovalsUI = true;

  // Rate unlock modal buttons
  document.getElementById('ka-rate-cancel')?.addEventListener('click', kaCloseRateModal);
  document.getElementById('ka-rate-unlock-one')?.addEventListener('click', () => kaHandleRateUnlock(false));
  document.getElementById('ka-rate-unlock-all')?.addEventListener('click', () => kaHandleRateUnlock(true));

  document
    .getElementById('ka-time-range')
    ?.addEventListener('change', (e) => {
      const mode = e.target.value || 'today';
      kaSetTimeRange(mode);
    });

  document
    .getElementById('ka-time-verify-all')
    ?.addEventListener('click', () => kaVerifyAllTimeEntriesVisible());

  kaSetTimeRange('today');
  kaSetTimeViewMode('view', { skipLoad: true });
  kaBindTimeCalendar();
  kaRenderTimeCalendar();

  document
    .getElementById('ka-time-action-cancel')
    ?.addEventListener('click', () => {
      kaBlurActiveElement();
      document.getElementById('ka-time-action-backdrop')?.classList.add('hidden');
      kaSyncModalOpenState();
      kaForceViewportSync();
      kaResetTimeDetailSheetPosition();
      kaResetTimeReviewSheetPosition();
      kaResetTimeCalendarSheetPosition();
      kaResetTimeReportSheetPosition();
    });
  document
    .getElementById('ka-time-action-close')
    ?.addEventListener('click', () => {
      kaBlurActiveElement();
      document.getElementById('ka-time-action-backdrop')?.classList.add('hidden');
      kaSyncModalOpenState();
      kaForceViewportSync();
      kaResetTimeDetailSheetPosition();
      kaResetTimeReviewSheetPosition();
      kaResetTimeCalendarSheetPosition();
      kaResetTimeReportSheetPosition();
    });
  document
    .getElementById('ka-time-action-submit')
    ?.addEventListener('click', () => {
      const isModify = kaTimeActionMode === 'modify';
      kaHandleTimeActionSubmit({ resolveAfterModify: isModify ? false : null });
    });
  document
    .getElementById('ka-time-action-submit-approve')
    ?.addEventListener('click', () => kaHandleTimeActionSubmit({ resolveAfterModify: true }));

  const timeActionStart = document.getElementById('ka-time-action-start');
  const timeActionEnd = document.getElementById('ka-time-action-end');
  const timeActionDate = document.getElementById('ka-time-action-date');
  const timeActionProject = document.getElementById('ka-time-action-project');
  [timeActionStart, timeActionEnd, timeActionDate, timeActionProject].forEach((el) => {
    if (!el) return;
    el.addEventListener('input', () => kaUpdateTimeActionHours());
    el.addEventListener('change', () => kaUpdateTimeActionHours());
  });

  // 🔹 Shipments tab: refresh list
  document
    .getElementById('ka-shipments-refresh')
    ?.addEventListener('click', () => kaLoadShipments({ forceFresh: true }));

  // 🔹 Shipments filter: change mode (ready vs all)
  const shipmentsStatusSelect = document.getElementById('ka-shipments-filter');
  if (shipmentsStatusSelect) {
    shipmentsStatusSelect.addEventListener('change', () => {
      kaUpdateHeaderTitle('shipments');
      kaLoadShipments({ forceFresh: true });
    });
    kaBindExpandableSelect(shipmentsStatusSelect);
  }
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
    const header = sheetEls.header;
    const dragTargets = [handle, header].filter(Boolean);
    if (dragTargets.length) {
      const onPointerDown = (e) => {
        if (!sheetEls.sheet.classList.contains('is-open')) return;
        if (e.button !== undefined && e.button !== 0) return;
        if (e.target.closest('button, a, input, select, textarea')) return;
        kaTimesheetWorkersSheetState.dragging = true;
        kaTimesheetWorkersSheetState.startY = e.clientY;
        kaTimesheetWorkersSheetState.currentY = e.clientY;
        sheetEls.sheet.classList.add('dragging');
        e.currentTarget?.setPointerCapture?.(e.pointerId);
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
      dragTargets.forEach((target) => {
        target.addEventListener('pointerdown', onPointerDown);
        target.addEventListener('pointermove', onPointerMove);
        target.addEventListener('pointerup', onPointerUp);
        target.addEventListener('pointercancel', onPointerUp);
      });
    }
  }

  const customerSheetEls = kaCustomerSheetElements();
  if (customerSheetEls && !customerSheetEls.sheet.dataset.bound) {
    customerSheetEls.sheet.dataset.bound = '1';
    customerSheetEls.sheet.querySelectorAll('[data-ka-customer-sheet-close]').forEach((btn) => {
      btn.addEventListener('click', () => kaCloseCustomerSheet());
    });

    const handle = customerSheetEls.handle;
    const header = customerSheetEls.header;
    const dragTargets = [handle, header].filter(Boolean);
    if (dragTargets.length) {
      const onPointerDown = (e) => {
        if (!customerSheetEls.sheet.classList.contains('is-open')) return;
        if (e.button !== undefined && e.button !== 0) return;
        if (e.target.closest('button, a, input, select, textarea')) return;
        kaCustomerSheetState.dragging = true;
        kaCustomerSheetState.startY = e.clientY;
        kaCustomerSheetState.currentY = e.clientY;
        customerSheetEls.sheet.classList.add('dragging');
        e.currentTarget?.setPointerCapture?.(e.pointerId);
      };
      const onPointerMove = (e) => {
        if (!kaCustomerSheetState.dragging) return;
        const delta = Math.max(0, e.clientY - kaCustomerSheetState.startY);
        kaCustomerSheetState.currentY = e.clientY;
        if (customerSheetEls.panel) {
          customerSheetEls.panel.style.transform = `translateY(${delta}px)`;
        }
      };
      const onPointerUp = () => {
        if (!kaCustomerSheetState.dragging) return;
        kaCustomerSheetState.dragging = false;
        customerSheetEls.sheet.classList.remove('dragging');
        const delta = Math.max(0, kaCustomerSheetState.currentY - kaCustomerSheetState.startY);
        const threshold = customerSheetEls.panel
          ? Math.min(180, customerSheetEls.panel.offsetHeight * 0.3)
          : 120;
        if (delta > threshold) {
          kaCloseCustomerSheet();
        } else if (customerSheetEls.panel) {
          customerSheetEls.panel.style.transform = '';
        }
      };
      dragTargets.forEach((target) => {
        target.addEventListener('pointerdown', onPointerDown);
        target.addEventListener('pointermove', onPointerMove);
        target.addEventListener('pointerup', onPointerUp);
        target.addEventListener('pointercancel', onPointerUp);
      });
    }
  }

  const employeesSheetEls = kaEmployeesSheetElements();
  if (employeesSheetEls && !employeesSheetEls.sheet.dataset.bound) {
    employeesSheetEls.sheet.dataset.bound = '1';
    employeesSheetEls.sheet.querySelectorAll('[data-ka-employees-sheet-close]').forEach((btn) => {
      btn.addEventListener('click', () => kaCloseEmployeesSheet());
    });

    const handle = employeesSheetEls.handle;
    const header = employeesSheetEls.header;
    const dragTargets = [handle, header].filter(Boolean);
    if (dragTargets.length) {
      const onPointerDown = (e) => {
        if (!employeesSheetEls.sheet.classList.contains('is-open')) return;
        if (e.button !== undefined && e.button !== 0) return;
        if (e.target.closest('button, a, input, select, textarea')) return;
        kaEmployeesSheetState.dragging = true;
        kaEmployeesSheetState.startY = e.clientY;
        kaEmployeesSheetState.currentY = e.clientY;
        employeesSheetEls.sheet.classList.add('dragging');
        e.currentTarget?.setPointerCapture?.(e.pointerId);
      };
      const onPointerMove = (e) => {
        if (!kaEmployeesSheetState.dragging) return;
        const delta = Math.max(0, e.clientY - kaEmployeesSheetState.startY);
        kaEmployeesSheetState.currentY = e.clientY;
        if (employeesSheetEls.panel) {
          employeesSheetEls.panel.style.transform = `translateY(${delta}px)`;
        }
      };
      const onPointerUp = () => {
        if (!kaEmployeesSheetState.dragging) return;
        kaEmployeesSheetState.dragging = false;
        employeesSheetEls.sheet.classList.remove('dragging');
        const delta = Math.max(0, kaEmployeesSheetState.currentY - kaEmployeesSheetState.startY);
        const threshold = employeesSheetEls.panel
          ? Math.min(180, employeesSheetEls.panel.offsetHeight * 0.3)
          : 120;
        if (delta > threshold) {
          kaCloseEmployeesSheet();
        } else if (employeesSheetEls.panel) {
          employeesSheetEls.panel.style.transform = '';
        }
      };
      dragTargets.forEach((target) => {
        target.addEventListener('pointerdown', onPointerDown);
        target.addEventListener('pointermove', onPointerMove);
        target.addEventListener('pointerup', onPointerUp);
        target.addEventListener('pointercancel', onPointerUp);
      });
    }
  }

  const accountSheetEls = kaAccountSheetElements();
  if (accountSheetEls && !accountSheetEls.sheet.dataset.bound) {
    accountSheetEls.sheet.dataset.bound = '1';
    accountSheetEls.sheet.querySelectorAll('[data-ka-account-sheet-close]').forEach((btn) => {
      btn.addEventListener('click', () => kaCloseAccountSheet());
    });

    const handle = accountSheetEls.handle;
    const header = accountSheetEls.header;
    const dragTargets = [handle, header].filter(Boolean);
    if (dragTargets.length) {
      const onPointerDown = (e) => {
        if (!accountSheetEls.sheet.classList.contains('is-open')) return;
        if (e.button !== undefined && e.button !== 0) return;
        if (e.target.closest('button, a, input, select, textarea')) return;
        kaAccountSheetState.dragging = true;
        kaAccountSheetState.startY = e.clientY;
        kaAccountSheetState.currentY = e.clientY;
        accountSheetEls.sheet.classList.add('dragging');
        e.currentTarget?.setPointerCapture?.(e.pointerId);
      };
      const onPointerMove = (e) => {
        if (!kaAccountSheetState.dragging) return;
        const delta = Math.max(0, e.clientY - kaAccountSheetState.startY);
        kaAccountSheetState.currentY = e.clientY;
        if (accountSheetEls.panel) {
          accountSheetEls.panel.style.transform = `translateY(${delta}px)`;
        }
      };
      const onPointerUp = () => {
        if (!kaAccountSheetState.dragging) return;
        kaAccountSheetState.dragging = false;
        accountSheetEls.sheet.classList.remove('dragging');
        const delta = Math.max(0, kaAccountSheetState.currentY - kaAccountSheetState.startY);
        const threshold = accountSheetEls.panel
          ? Math.min(180, accountSheetEls.panel.offsetHeight * 0.3)
          : 120;
        if (delta > threshold) {
          kaCloseAccountSheet();
        } else if (accountSheetEls.panel) {
          accountSheetEls.panel.style.transform = '';
        }
      };
      dragTargets.forEach((target) => {
        target.addEventListener('pointerdown', onPointerDown);
        target.addEventListener('pointermove', onPointerMove);
        target.addEventListener('pointerup', onPointerUp);
        target.addEventListener('pointercancel', onPointerUp);
      });
    }
  }

  const settingsSheetEls = kaSettingsSheetElements();
  if (settingsSheetEls && !settingsSheetEls.sheet.dataset.bound) {
    settingsSheetEls.sheet.dataset.bound = '1';
    settingsSheetEls.sheet.querySelectorAll('[data-ka-settings-sheet-close]').forEach((btn) => {
      btn.addEventListener('click', () => kaCloseSettingsSheet());
    });

    const handle = settingsSheetEls.handle;
    const header = settingsSheetEls.header;
    const dragTargets = [handle, header].filter(Boolean);
    if (dragTargets.length) {
      const onPointerDown = (e) => {
        if (!settingsSheetEls.sheet.classList.contains('is-open')) return;
        if (e.button !== undefined && e.button !== 0) return;
        if (e.target.closest('button, a, input, select, textarea')) return;
        kaSettingsSheetState.dragging = true;
        kaSettingsSheetState.startY = e.clientY;
        kaSettingsSheetState.currentY = e.clientY;
        settingsSheetEls.sheet.classList.add('dragging');
        e.currentTarget?.setPointerCapture?.(e.pointerId);
      };
      const onPointerMove = (e) => {
        if (!kaSettingsSheetState.dragging) return;
        const delta = Math.max(0, e.clientY - kaSettingsSheetState.startY);
        kaSettingsSheetState.currentY = e.clientY;
        if (settingsSheetEls.panel) {
          settingsSheetEls.panel.style.transform = `translateY(${delta}px)`;
        }
      };
      const onPointerUp = () => {
        if (!kaSettingsSheetState.dragging) return;
        kaSettingsSheetState.dragging = false;
        settingsSheetEls.sheet.classList.remove('dragging');
        const delta = Math.max(0, kaSettingsSheetState.currentY - kaSettingsSheetState.startY);
        const threshold = settingsSheetEls.panel
          ? Math.min(180, settingsSheetEls.panel.offsetHeight * 0.3)
          : 120;
        if (delta > threshold) {
          kaCloseSettingsSheet();
        } else if (settingsSheetEls.panel) {
          settingsSheetEls.panel.style.transform = '';
        }
      };
      dragTargets.forEach((target) => {
        target.addEventListener('pointerdown', onPointerDown);
        target.addEventListener('pointermove', onPointerMove);
        target.addEventListener('pointerup', onPointerUp);
        target.addEventListener('pointercancel', onPointerUp);
      });
    }
  }

  const employeeSheetEls = kaEmployeeSheetElements();
  if (employeeSheetEls && !employeeSheetEls.sheet.dataset.bound) {
    employeeSheetEls.sheet.dataset.bound = '1';
    employeeSheetEls.sheet.querySelectorAll('[data-ka-employee-sheet-close]').forEach((btn) => {
      btn.addEventListener('click', () => kaCloseEmployeeSheet());
    });

    const handle = employeeSheetEls.handle;
    const header = employeeSheetEls.header;
    const dragTargets = [handle, header].filter(Boolean);
    if (dragTargets.length) {
      const onPointerDown = (e) => {
        if (!employeeSheetEls.sheet.classList.contains('is-open')) return;
        if (e.button !== undefined && e.button !== 0) return;
        if (e.target.closest('button, a, input, select, textarea')) return;
        kaEmployeeSheetState.dragging = true;
        kaEmployeeSheetState.startY = e.clientY;
        kaEmployeeSheetState.currentY = e.clientY;
        employeeSheetEls.sheet.classList.add('dragging');
        e.currentTarget?.setPointerCapture?.(e.pointerId);
      };
      const onPointerMove = (e) => {
        if (!kaEmployeeSheetState.dragging) return;
        const delta = Math.max(0, e.clientY - kaEmployeeSheetState.startY);
        kaEmployeeSheetState.currentY = e.clientY;
        if (employeeSheetEls.panel) {
          employeeSheetEls.panel.style.transform = `translateY(${delta}px)`;
        }
      };
      const onPointerUp = () => {
        if (!kaEmployeeSheetState.dragging) return;
        kaEmployeeSheetState.dragging = false;
        employeeSheetEls.sheet.classList.remove('dragging');
        const delta = Math.max(0, kaEmployeeSheetState.currentY - kaEmployeeSheetState.startY);
        const threshold = employeeSheetEls.panel
          ? Math.min(180, employeeSheetEls.panel.offsetHeight * 0.3)
          : 120;
        if (delta > threshold) {
          kaCloseEmployeeSheet();
        } else if (employeeSheetEls.panel) {
          employeeSheetEls.panel.style.transform = '';
        }
      };
      dragTargets.forEach((target) => {
        target.addEventListener('pointerdown', onPointerDown);
        target.addEventListener('pointermove', onPointerMove);
        target.addEventListener('pointerup', onPointerUp);
        target.addEventListener('pointercancel', onPointerUp);
      });
    }
  }

  const employeePinSheetEls = kaEmployeePinSheetElements();
  if (employeePinSheetEls && !employeePinSheetEls.sheet.dataset.bound) {
    employeePinSheetEls.sheet.dataset.bound = '1';
    employeePinSheetEls.sheet.querySelectorAll('[data-ka-employee-pin-close]').forEach((btn) => {
      btn.addEventListener('click', () => kaCloseEmployeePinSheet());
    });

    const handle = employeePinSheetEls.handle;
    const header = employeePinSheetEls.header;
    const dragTargets = [handle, header].filter(Boolean);
    if (dragTargets.length) {
      const onPointerDown = (e) => {
        if (!employeePinSheetEls.sheet.classList.contains('is-open')) return;
        if (e.button !== undefined && e.button !== 0) return;
        if (e.target.closest('button, a, input, select, textarea')) return;
        kaEmployeePinSheetState.dragging = true;
        kaEmployeePinSheetState.startY = e.clientY;
        kaEmployeePinSheetState.currentY = e.clientY;
        employeePinSheetEls.sheet.classList.add('dragging');
        e.currentTarget?.setPointerCapture?.(e.pointerId);
      };
      const onPointerMove = (e) => {
        if (!kaEmployeePinSheetState.dragging) return;
        const delta = Math.max(0, e.clientY - kaEmployeePinSheetState.startY);
        kaEmployeePinSheetState.currentY = e.clientY;
        if (employeePinSheetEls.panel) {
          employeePinSheetEls.panel.style.transform = `translateY(${delta}px)`;
        }
      };
      const onPointerUp = () => {
        if (!kaEmployeePinSheetState.dragging) return;
        kaEmployeePinSheetState.dragging = false;
        employeePinSheetEls.sheet.classList.remove('dragging');
        const delta = Math.max(0, kaEmployeePinSheetState.currentY - kaEmployeePinSheetState.startY);
        const threshold = employeePinSheetEls.panel
          ? Math.min(180, employeePinSheetEls.panel.offsetHeight * 0.3)
          : 120;
        if (delta > threshold) {
          kaCloseEmployeePinSheet();
        } else if (employeePinSheetEls.panel) {
          employeePinSheetEls.panel.style.transform = '';
        }
      };
      dragTargets.forEach((target) => {
        target.addEventListener('pointerdown', onPointerDown);
        target.addEventListener('pointermove', onPointerMove);
        target.addEventListener('pointerup', onPointerUp);
        target.addEventListener('pointercancel', onPointerUp);
      });
    }
  }

  const timeDetailSheetEls = kaTimeDetailSheetElements();
  if (timeDetailSheetEls && !timeDetailSheetEls.sheet.dataset.bound) {
    timeDetailSheetEls.sheet.dataset.bound = '1';
    timeDetailSheetEls.sheet.querySelectorAll('[data-ka-time-detail-close]').forEach((btn) => {
      btn.addEventListener('click', () => kaCloseTimeDetailSheet());
    });
    timeDetailSheetEls.sheet.querySelectorAll('[data-ka-time-flag-close]').forEach((btn) => {
      btn.addEventListener('click', () => kaHideTimeFlagBanner());
    });
    timeDetailSheetEls.sheet.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('[data-ka-time-detail-action]');
      if (!actionBtn) return;
      const action = actionBtn.getAttribute('data-ka-time-detail-action');
      const entry = kaTimeDetailSheetState.entry;
      if (!action || !entry) return;
      kaOpenTimeActionModal(entry, action);
    });

    const handle = timeDetailSheetEls.handle;
    const header = timeDetailSheetEls.header;
    const dragTargets = [handle, header].filter(Boolean);
    if (dragTargets.length) {
      const onPointerDown = (e) => {
        if (!timeDetailSheetEls.sheet.classList.contains('is-open')) return;
        if (e.button !== undefined && e.button !== 0) return;
        if (e.target.closest('button, a, input, select, textarea, [data-ka-time-detail-action]')) return;
        kaTimeDetailSheetState.dragging = true;
        kaTimeDetailSheetState.startY = e.clientY;
        kaTimeDetailSheetState.currentY = e.clientY;
        timeDetailSheetEls.sheet.classList.add('dragging');
        e.currentTarget?.setPointerCapture?.(e.pointerId);
      };
      const onPointerMove = (e) => {
        if (!kaTimeDetailSheetState.dragging) return;
        const delta = Math.max(0, e.clientY - kaTimeDetailSheetState.startY);
        kaTimeDetailSheetState.currentY = e.clientY;
        if (timeDetailSheetEls.panel) {
          timeDetailSheetEls.panel.style.transform = `translateY(${delta}px)`;
        }
      };
      const onPointerUp = () => {
        if (!kaTimeDetailSheetState.dragging) return;
        kaTimeDetailSheetState.dragging = false;
        timeDetailSheetEls.sheet.classList.remove('dragging');
        const delta = Math.max(0, kaTimeDetailSheetState.currentY - kaTimeDetailSheetState.startY);
        const threshold = timeDetailSheetEls.panel
          ? Math.min(180, timeDetailSheetEls.panel.offsetHeight * 0.3)
          : 120;
        if (delta > threshold) {
          kaCloseTimeDetailSheet();
        } else if (timeDetailSheetEls.panel) {
          timeDetailSheetEls.panel.style.transform = '';
        }
      };
      dragTargets.forEach((target) => {
        target.addEventListener('pointerdown', onPointerDown);
        target.addEventListener('pointermove', onPointerMove);
        target.addEventListener('pointerup', onPointerUp);
        target.addEventListener('pointercancel', onPointerUp);
      });
    }
  }

  const timeReportSheetEls = kaTimeReportSheetElements();
  if (timeReportSheetEls && !timeReportSheetEls.sheet.dataset.bound) {
    timeReportSheetEls.sheet.dataset.bound = '1';
    timeReportSheetEls.sheet.querySelectorAll('[data-ka-time-report-close]').forEach((btn) => {
      btn.addEventListener('click', () => kaCloseTimeReportSheet());
    });

    const handle = timeReportSheetEls.handle;
    const header = timeReportSheetEls.header;
    const dragTargets = [handle, header].filter(Boolean);
    if (dragTargets.length) {
      const onPointerDown = (e) => {
        if (!timeReportSheetEls.sheet.classList.contains('is-open')) return;
        if (e.button !== undefined && e.button !== 0) return;
        if (e.target.closest('button, a, input, select, textarea')) return;
        kaTimeReportSheetState.dragging = true;
        kaTimeReportSheetState.startY = e.clientY;
        kaTimeReportSheetState.currentY = e.clientY;
        timeReportSheetEls.sheet.classList.add('dragging');
        e.currentTarget?.setPointerCapture?.(e.pointerId);
      };
      const onPointerMove = (e) => {
        if (!kaTimeReportSheetState.dragging) return;
        const delta = Math.max(0, e.clientY - kaTimeReportSheetState.startY);
        kaTimeReportSheetState.currentY = e.clientY;
        if (timeReportSheetEls.panel) {
          timeReportSheetEls.panel.style.transform = `translateY(${delta}px)`;
        }
      };
      const onPointerUp = () => {
        if (!kaTimeReportSheetState.dragging) return;
        kaTimeReportSheetState.dragging = false;
        timeReportSheetEls.sheet.classList.remove('dragging');
        const delta = Math.max(0, kaTimeReportSheetState.currentY - kaTimeReportSheetState.startY);
        const threshold = timeReportSheetEls.panel
          ? Math.min(180, timeReportSheetEls.panel.offsetHeight * 0.3)
          : 120;
        if (delta > threshold) {
          kaCloseTimeReportSheet();
        } else if (timeReportSheetEls.panel) {
          timeReportSheetEls.panel.style.transform = '';
        }
      };
      dragTargets.forEach((target) => {
        target.addEventListener('pointerdown', onPointerDown);
        target.addEventListener('pointermove', onPointerMove);
        target.addEventListener('pointerup', onPointerUp);
        target.addEventListener('pointercancel', onPointerUp);
      });
    }
  }

  const timeCalendarSheetEls = kaTimeCalendarSheetElements();
  if (timeCalendarSheetEls && !timeCalendarSheetEls.sheet.dataset.bound) {
    timeCalendarSheetEls.sheet.dataset.bound = '1';
    timeCalendarSheetEls.sheet.querySelectorAll('[data-ka-time-calendar-close]').forEach((btn) => {
      btn.addEventListener('click', () => kaCloseTimeCalendarSheet());
    });

    const handle = timeCalendarSheetEls.handle;
    const header = timeCalendarSheetEls.header;
    const dragTargets = [handle, header].filter(Boolean);
    if (dragTargets.length) {
      const onPointerDown = (e) => {
        if (!timeCalendarSheetEls.sheet.classList.contains('is-open')) return;
        if (e.button !== undefined && e.button !== 0) return;
        if (e.target.closest('button, a, input, select, textarea')) return;
        kaTimeCalendarSheetState.dragging = true;
        kaTimeCalendarSheetState.startY = e.clientY;
        kaTimeCalendarSheetState.currentY = e.clientY;
        timeCalendarSheetEls.sheet.classList.add('dragging');
        e.currentTarget?.setPointerCapture?.(e.pointerId);
      };
      const onPointerMove = (e) => {
        if (!kaTimeCalendarSheetState.dragging) return;
        const delta = Math.max(0, e.clientY - kaTimeCalendarSheetState.startY);
        kaTimeCalendarSheetState.currentY = e.clientY;
        if (timeCalendarSheetEls.panel) {
          timeCalendarSheetEls.panel.style.transform = `translateY(${delta}px)`;
        }
      };
      const onPointerUp = () => {
        if (!kaTimeCalendarSheetState.dragging) return;
        kaTimeCalendarSheetState.dragging = false;
        timeCalendarSheetEls.sheet.classList.remove('dragging');
        const delta = Math.max(0, kaTimeCalendarSheetState.currentY - kaTimeCalendarSheetState.startY);
        const threshold = timeCalendarSheetEls.panel
          ? Math.min(180, timeCalendarSheetEls.panel.offsetHeight * 0.3)
          : 120;
        if (delta > threshold) {
          kaCloseTimeCalendarSheet();
        } else if (timeCalendarSheetEls.panel) {
          timeCalendarSheetEls.panel.style.transform = '';
        }
      };
      dragTargets.forEach((target) => {
        target.addEventListener('pointerdown', onPointerDown);
        target.addEventListener('pointermove', onPointerMove);
        target.addEventListener('pointerup', onPointerUp);
        target.addEventListener('pointercancel', onPointerUp);
      });
    }
  }

  const timeReviewSheetEls = kaTimeReviewSheetElements();
  if (timeReviewSheetEls && !timeReviewSheetEls.sheet.dataset.bound) {
    timeReviewSheetEls.sheet.dataset.bound = '1';
    timeReviewSheetEls.sheet.querySelectorAll('[data-ka-time-review-close]').forEach((btn) => {
      btn.addEventListener('click', () => kaCloseTimeReviewSheet());
    });

    const handle = timeReviewSheetEls.handle;
    const header = timeReviewSheetEls.header;
    const dragTargets = [handle, header].filter(Boolean);
    if (dragTargets.length) {
      const onPointerDown = (e) => {
        if (!timeReviewSheetEls.sheet.classList.contains('is-open')) return;
        if (e.button !== undefined && e.button !== 0) return;
        if (e.target.closest('button, a, input, select, textarea')) return;
        kaTimeReviewSheetState.dragging = true;
        kaTimeReviewSheetState.startY = e.clientY;
        kaTimeReviewSheetState.currentY = e.clientY;
        timeReviewSheetEls.sheet.classList.add('dragging');
        e.currentTarget?.setPointerCapture?.(e.pointerId);
      };
      const onPointerMove = (e) => {
        if (!kaTimeReviewSheetState.dragging) return;
        const delta = Math.max(0, e.clientY - kaTimeReviewSheetState.startY);
        kaTimeReviewSheetState.currentY = e.clientY;
        if (timeReviewSheetEls.panel) {
          timeReviewSheetEls.panel.style.transform = `translateY(${delta}px)`;
        }
      };
      const onPointerUp = () => {
        if (!kaTimeReviewSheetState.dragging) return;
        kaTimeReviewSheetState.dragging = false;
        timeReviewSheetEls.sheet.classList.remove('dragging');
        const delta = Math.max(0, kaTimeReviewSheetState.currentY - kaTimeReviewSheetState.startY);
        const threshold = timeReviewSheetEls.panel
          ? Math.min(180, timeReviewSheetEls.panel.offsetHeight * 0.3)
          : 120;
        if (delta > threshold) {
          kaCloseTimeReviewSheet();
        } else if (timeReviewSheetEls.panel) {
          timeReviewSheetEls.panel.style.transform = '';
        }
      };
      dragTargets.forEach((target) => {
        target.addEventListener('pointerdown', onPointerDown);
        target.addEventListener('pointermove', onPointerMove);
        target.addEventListener('pointerup', onPointerUp);
        target.addEventListener('pointercancel', onPointerUp);
      });
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
      kaDebugTapFlash(e.target, 'click list');
      kaDebugTapLog('click list');
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
      const actionsBtn = e.target.closest('[data-ka-session-actions]');
      if (actionsBtn) {
        e.stopPropagation();
        e.preventDefault();
        const sessionId = Number(actionsBtn.dataset.kaSessionActions);
        if (sessionId) {
          const row = actionsBtn.closest('.ka-session-row');
          await kaOpenTimesheetActions(sessionId, row);
        }
        return;
      }
    });
    sessionList.addEventListener('pointerup', async (e) => {
      kaDebugTapFlash(e.target, `pointerup:${e.pointerType}`);
      kaDebugTapLog(`list pointerup type=${e.pointerType}`);
      if (e.pointerType === 'mouse') return;
      if (e.target.closest('[data-ka-session-actions]')) return;
      if (e.target.closest('[data-ka-delete-session]')) return;
    });
    sessionList.addEventListener('touchstart', kaHandleSessionTouchStart, { passive: true });
    sessionList.addEventListener('touchend', kaHandleSessionTouchEnd);
  }

  // 3) Load core data in parallel
  try {
    const [kiosks, projects, employees] = await Promise.all([
      fetchJSON('/api/kiosks'),
      fetchJSON('/api/kiosk/projects'),
      fetchJSON('/api/kiosk/admin/employees'),
    ]);

    // Only keep active projects for kiosk use
    kaProjects = (projects || []).filter(
      p => p.active === undefined || p.active === null || Number(p.active) === 1
    );
    kaEmployees = kaNormalizeEmployees(employees || []);
    kaRefreshNotifyProjectSelect();

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
    await kaInitNotifyPanel();

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
    kaRenderEmployeesGrid();
    kaSetEmployeeFormVisible(false, { skipScroll: true });
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

function kaResetItemsSheetPosition() {
  const content = document.querySelector('#ka-items-modal .ka-items-modal-content');
  if (content) {
    content.style.transform = '';
    content.classList.remove('is-dragging');
  }
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
    if (choice === 'cancel') return false;
    if (choice === 'ok' && shipmentId) {
      const ok = await kaSaveShipmentVerificationFor(shipmentId, { silent: true });
      if (!ok) return false;
    }
  }

  const modal = document.getElementById('ka-items-modal');
  if (modal) {
    modal.classList.add('hidden');
    const content = modal.querySelector('.ka-items-modal-content');
    if (content) {
      content.style.transform = '';
      content.classList.remove('is-dragging');
    }
  }
  document.body.classList.remove('ka-modal-open');
  document.documentElement.classList.remove('ka-modal-open');
  kaClearItemAutoSaves();
  kaShipmentItemsDirty.clear();
  kaItemsFilterTerm = '';
  kaItemsFilterUnverifiedFirst = true;
  kaItemsModalShipmentId = null;
  kaShipmentDetailDocs = [];
  kaExpandedItems.clear();
  kaAutoExpandedItems.clear();
  kaSavedItemStatuses.clear();
  kaRecentlySavedItems.forEach(timer => clearTimeout(timer));
  kaRecentlySavedItems.clear();
  if (kaCanViewShipments()) {
    kaLoadShipments({ forceFresh: true });
  }
  return true;
}

function kaClearItemAutoSaves() {
  kaItemAutoSaveTimers.forEach(timer => clearTimeout(timer));
  kaItemAutoSaveTimers.clear();
}

function kaBindItemsSheetSwipe() {
  const modal = document.getElementById('ka-items-modal');
  const content = modal?.querySelector('.ka-items-modal-content');
  if (!modal || !content || content.dataset.sheetBound) return;
  const header = content.querySelector('.ka-items-modal-header');
  const handle = content.querySelector('.ka-items-sheet-handle');
  const state = { dragging: false, startY: 0, lastY: 0, pointerId: null };

  const canStart = (target) => {
    if (!target) return false;
    if (handle && handle.contains(target)) return true;
    if (!header || !header.contains(target)) return false;
    if (target.closest('button, a, input, select, textarea')) return false;
    return true;
  };

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!canStart(e.target)) return;
    if (modal.classList.contains('hidden')) return;
    state.dragging = true;
    state.startY = e.clientY;
    state.lastY = e.clientY;
    state.pointerId = e.pointerId;
    content.classList.add('is-dragging');
    if (content.setPointerCapture) content.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!state.dragging) return;
    if (state.pointerId !== null && e.pointerId !== state.pointerId) return;
    const delta = Math.max(0, e.clientY - state.startY);
    state.lastY = e.clientY;
    content.style.transform = `translateY(${delta}px)`;
    if (delta > 0) e.preventDefault();
  };

  const onPointerEnd = async (e) => {
    if (!state.dragging) return;
    if (state.pointerId !== null && e.pointerId !== state.pointerId) return;
    state.dragging = false;
    content.classList.remove('is-dragging');
    const delta = Math.max(0, state.lastY - state.startY);
    const threshold = Math.min(160, content.offsetHeight * 0.25);
    if (delta > threshold) {
      const closed = await kaCloseItemsModal();
      if (!closed) {
        kaResetItemsSheetPosition();
      }
    } else {
      kaResetItemsSheetPosition();
    }
    state.pointerId = null;
  };

  content.addEventListener('pointerdown', onPointerDown);
  content.addEventListener('pointermove', onPointerMove, { passive: false });
  content.addEventListener('pointerup', onPointerEnd);
  content.addEventListener('pointercancel', onPointerEnd);
  content.dataset.sheetBound = '1';
}

function kaForceCloseAllModals() {
  const ids = [
    'ka-return-backdrop',
    'ka-time-action-backdrop',
    'ka-confirm-backdrop',
    'ka-admin-pin-backdrop',
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

function kaBlurActiveElement() {
  const active = document.activeElement;
  if (active && typeof active.blur === 'function') active.blur();
}

function kaSetViewportHeightVar() {
  const height = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  if (!height || !Number.isFinite(height)) return;
  document.documentElement.style.setProperty('--ka-vh', `${height * 0.01}px`);
}

function kaForceViewportSync() {
  window.setTimeout(() => {
    kaSetViewportHeightVar();
    try {
      window.dispatchEvent(new Event('resize'));
    } catch {
      // ignore
    }
    kaUpdateBottomNavDiamond();
  }, 0);
}

function kaSyncModalOpenState() {
  const hasBackdrop = Array.from(document.querySelectorAll('.ka-modal-backdrop'))
    .some(el => !el.classList.contains('hidden'));
  const hasSheet = Array.from(document.querySelectorAll('.ka-sheet'))
    .some(el => !el.classList.contains('hidden'));
  const itemsModal = document.getElementById('ka-items-modal');
  const itemsOpen = !!(itemsModal && !itemsModal.classList.contains('hidden'));
  const shouldLock = hasBackdrop || hasSheet || itemsOpen;
  document.body.classList.toggle('ka-modal-open', shouldLock);
  document.documentElement.classList.toggle('ka-modal-open', shouldLock);
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
    '': 'Not Reviewed'
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
    kaBindOverviewPaidByLinks();
    kaBindOverviewDocViewer();
    kaBindPickupControls(kaShipmentDetail.shipment || {});
    kaLoadPaymentLedgerForOverview(shipmentId);
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

function kaCanVerifyShipmentItems(shipment) {
  const raw = shipment && shipment.status ? String(shipment.status).toLowerCase().trim() : '';
  if (!raw) return false;
  if (raw.includes('archived')) return true;
  return raw.includes('picked') && raw.includes('up');
}

function kaNormalizeItemNotes(value) {
  return String(value || '').trim();
}

function kaStatusRequiresNotes(status) {
  const normalized = kaNormalizeItemStatus(status);
  if (!normalized || normalized === 'unverified' || normalized === 'verified') return false;
  return true;
}

function kaVerificationNotesValue(verification) {
  if (!verification || typeof verification !== 'object') return '';
  const notes = verification.notes ?? '';
  const storage = verification.storage_override ?? verification.storage ?? '';
  const raw = notes || storage || '';
  return kaNormalizeItemNotes(raw);
}

function kaSetSavedItemNotes(itemId, notes) {
  const idNum = Number(itemId);
  if (!Number.isFinite(idNum)) return;
  kaSavedItemNotes.set(idNum, kaNormalizeItemNotes(notes));
}

function kaGetSavedItemNotes(itemId, fallback = '') {
  const idNum = Number(itemId);
  if (kaSavedItemNotes.has(idNum)) {
    return kaSavedItemNotes.get(idNum);
  }
  return kaNormalizeItemNotes(fallback);
}

function kaNotesMeetRequirement(itemId, status, notesValue) {
  if (!kaStatusRequiresNotes(status)) return true;
  const current = kaNormalizeItemNotes(notesValue);
  return !!current;
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
  kaSavedItemNotes.clear();
  kaExpandedItems.clear();
  kaAutoExpandedItems.clear();
  (items || []).forEach(it => {
    kaSetSavedItemStatus(it.id, it?.verification?.status || '');
    kaSetSavedItemNotes(it.id, kaVerificationNotesValue(it?.verification || {}));
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

async function kaPrefetchEmployeeDocsForOffline(docs = []) {
  if (!navigator.onLine || !Array.isArray(docs) || !docs.length) return;
  const cache = await kaGetDocCache();
  if (!cache) return;
  for (const doc of docs) {
    const rawUrl = doc?.url || doc?.file_path;
    if (!rawUrl) continue;
    const url = kaDocNormalizeUrl(kaAppendEmployeeAuth(rawUrl));
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

function kaPaymentLedgerContainer() {
  return document.getElementById('ka-payment-ledger');
}

function kaFormatPaymentLedgerType(type = '') {
  const key = String(type || '').toLowerCase();
  if (key === 'shipper') return 'Freight Forwarder';
  if (key === 'customs') return 'Customs/Clearing';
  if (key === 'vendor') return 'Vendor';
  if (key === 'other') return 'Other';
  return key ? key[0].toUpperCase() + key.slice(1) : 'Other';
}

function kaRenderPaymentLedger(rows = []) {
  if (!Array.isArray(rows) || !rows.length) return '';

  const items = rows.map(row => {
    const typeLabel = kaFormatPaymentLedgerType(row.type);
    const amount = kaFmtCurrency(row.amount);
    const status = row.status || 'Pending';
    const due = row.due_date ? kaFmtDateMMDDYYYY(row.due_date) : '—';
    const paid = row.paid_date ? kaFmtDateMMDDYYYY(row.paid_date) : '—';
    const invoice = row.invoice_number || '—';
    const notes = row.notes ? escapeHTML(row.notes) : '';

    return `
      <div class="ka-ledger-row">
        <div class="ka-ledger-main">
          <strong>${escapeHTML(typeLabel)}</strong>
          <span class="ka-ledger-amount">${amount}</span>
          <span class="ka-ledger-status">${escapeHTML(status)}</span>
        </div>
        <div class="ka-ledger-meta">Due ${escapeHTML(due)} · Paid ${escapeHTML(paid)} · Invoice ${escapeHTML(invoice)}</div>
        ${notes ? `<div class="ka-ledger-notes">${notes}</div>` : ''}
      </div>
    `;
  });

  return `
    <div class="ka-ledger-title">Payment Ledger</div>
    <div class="ka-ledger-list">
      ${items.join('')}
    </div>
  `;
}

async function kaLoadPaymentLedgerForOverview(shipmentId, { force = false } = {}) {
  const container = kaPaymentLedgerContainer();
  if (!container || !shipmentId) return;
  if (!kaCanViewPayroll()) return;
  if (!navigator.onLine) return;

  const cached =
    !force &&
    kaShipmentDetail &&
    kaShipmentDetail.shipment &&
    Number(kaShipmentDetail.shipment.id) === Number(shipmentId) &&
    kaShipmentDetail.payment_ledger_loaded;

  if (cached) {
    const html = kaRenderPaymentLedger(kaShipmentDetail.payment_ledger || []);
    if (html) {
      container.innerHTML = html;
      container.classList.remove('hidden');
    } else {
      container.innerHTML = '';
      container.classList.add('hidden');
    }
    return;
  }

  try {
    const resp = await fetchJSON(`/api/shipments/${shipmentId}/payments`);
    const rows = Array.isArray(resp?.payments) ? resp.payments : [];
    if (kaShipmentDetail && kaShipmentDetail.shipment) {
      kaShipmentDetail.payment_ledger = rows;
      kaShipmentDetail.payment_ledger_loaded = true;
    }
    const html = kaRenderPaymentLedger(rows);
    if (html) {
      container.innerHTML = html;
      container.classList.remove('hidden');
    } else {
      container.innerHTML = '';
      container.classList.add('hidden');
    }
  } catch (err) {
    console.warn('Failed to load payment ledger for kiosk overview', err);
  }
}

function kaRenderDocsList(docs) {
  const list = kaFilterDocsForPermissions(docs);
  if (!Array.isArray(list) || !list.length) {
    return '<div class="ka-ship-muted">(No documents uploaded)</div>';
  }
  const items = list.map(doc => {
    const viewHref = kaAppendShipmentAuth(doc.view_url || doc.url || doc.file_path || '#');
    const downloadHref = kaAppendShipmentAuth(doc.download_url || doc.url || doc.file_path || '#');
    const label =
      doc.filename || doc.title || doc.label || doc.doc_label || 'Document';
    const downloadName =
      doc.filename || doc.original_name || doc.title || doc.label || 'document';
    const type = doc.doc_label || doc.doc_type || '';
    const extra = type ? `<span class="ka-doc-type">${type}</span>` : '';
    return `
      <li class="ka-doc-row">
        <div class="ka-doc-line">
          <a class="ka-doc-name" href="${viewHref}" target="_blank" rel="noopener noreferrer">${label}</a>
          ${extra}
        </div>
        <a class="ka-doc-download" href="${downloadHref}" target="_blank" rel="noopener noreferrer" download="${downloadName}" aria-label="Download document">
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
        kaBindOverviewPaidByLinks();
        kaBindNotesControls(shipment);
        kaBindPickupControls(shipment);
        kaLoadPaymentLedgerForOverview(shipmentId);
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
  const matchedAdmin = admins.find(a => a.label === currentName);

  // Populate select
  select.innerHTML = '<option value="">Select admin</option>';
  admins.forEach(a => {
    const opt = document.createElement('option');
    opt.value = String(a.id);
    opt.textContent = a.label;
    select.appendChild(opt);
  });
  if (currentName && !matchedAdmin) {
    const savedOpt = document.createElement('option');
    savedOpt.value = '__other_saved__';
    savedOpt.textContent = currentName;
    savedOpt.dataset.otherName = currentName;
    select.appendChild(savedOpt);
  }
  const otherOpt = document.createElement('option');
  otherOpt.value = '__other__';
  otherOpt.textContent = 'Other';
  select.appendChild(otherOpt);

  if (matchedAdmin) {
    select.value = String(matchedAdmin.id);
  } else if (currentName) {
    select.value = '__other_saved__';
    if (otherInput) otherInput.value = currentName;
  } else {
    select.value = '';
  }
  select.dataset.kaPickupCurrentOther = currentName || '';

  if (dateInput && currentDate) {
    dateInput.value = currentDate.slice(0, 10);
  }

  const toggleOther = () => {
    if (otherRow) {
      const isOther = select.value === '__other__';
      otherRow.classList.toggle('hidden', !isOther);
      if (otherInput) {
        otherInput.required = isOther;
        otherInput.setAttribute('aria-required', isOther ? 'true' : 'false');
        if (isOther && !otherInput.value) {
          const currentOther = select.dataset.kaPickupCurrentOther || '';
          if (currentOther) otherInput.value = currentOther;
        }
      }
    }
  };
  toggleOther();

  select.onchange = () => {
    toggleOther();
  };

  saveBtn.onclick = async () => {
    const adminId = kaAdminAuthId();
    const isOther = select.value === '__other__';
    const isSavedOther = select.value === '__other_saved__';
    const selectedOption = select.selectedOptions ? select.selectedOptions[0] : null;
    const pickedVal = isOther
      ? (otherInput?.value || '').trim()
      : isSavedOther
        ? (selectedOption?.dataset.otherName || selectedOption?.textContent || '').trim()
        : (admins.find(a => String(a.id) === select.value)?.label || '');
    const pickedDate = dateInput.value || '';

    if (!pickedVal) {
      if (statusEl) {
        statusEl.textContent = isOther ? 'Enter a pickup name for Other.' : 'Choose a pickup name.';
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
      const nextStatus = saved && saved.status ? saved.status : (shipment && shipment.status ? shipment.status : '');
      if (kaShipmentDetail && kaShipmentDetail.shipment) {
        kaShipmentDetail.shipment.picked_up_by = saved.picked_up_by || pickedVal;
        kaShipmentDetail.shipment.picked_up_date = saved.picked_up_date || pickedDate;
        kaShipmentDetail.shipment.picked_up_updated_by = saved.picked_up_updated_by || updaterName || '';
        kaShipmentDetail.shipment.picked_up_updated_at = saved.picked_up_updated_at || '';
        if (nextStatus) {
          kaShipmentDetail.shipment.status = nextStatus;
        }
      }
      if (statusEl) {
        statusEl.textContent = 'Pickup saved.';
        statusEl.className = 'ka-status ka-status-ok';
      }
      if (metaEl) {
        metaEl.textContent = `Last updated by ${kaShipmentDetail.shipment.picked_up_updated_by || updaterName || '—'}${kaShipmentDetail.shipment.picked_up_updated_at ? ` on ${kaShipmentDetail.shipment.picked_up_updated_at}` : ''}`;
      }
      kaShowModalToast('Pickup updated successfully.', 'ok');
      if (Array.isArray(kaShipments)) {
        const idx = kaShipments.findIndex(s => Number(s.id) === Number(shipment.id));
        if (idx !== -1) {
          kaShipments[idx] = {
            ...kaShipments[idx],
            picked_up_by: saved.picked_up_by || pickedVal,
            picked_up_date: saved.picked_up_date || pickedDate,
            picked_up_updated_by: saved.picked_up_updated_by || updaterName || '',
            picked_up_updated_at: saved.picked_up_updated_at || '',
            status: nextStatus || kaShipments[idx].status
          };
          kaSaveShipmentsCache(kaShipments);
          kaRenderShipmentsList(kaShipments);
        }
      }
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
        kaBindOverviewPaidByLinks();
        kaBindNotesControls(kaShipmentDetail.shipment);
        kaBindPickupControls(kaShipmentDetail.shipment);
        kaLoadPaymentLedgerForOverview(shipment.id);
      }
      if (kaItemsModalShipmentId === shipment.id) {
        kaRenderItemsList(shipment.id);
        const lockNoteEl = document.getElementById('ka-items-locked-note');
        const allowVerification = kaCanVerifyShipmentItems(kaShipmentDetail.shipment || {});
        if (lockNoteEl) {
          lockNoteEl.classList.toggle('hidden', allowVerification);
        }
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

function kaIsItemsModalOpen() {
  const modal = document.getElementById('ka-items-modal');
  return !!(modal && !modal.classList.contains('hidden'));
}

function kaShowItemsModalAlert(message, variant = 'error', duration = 6000) {
  if (kaIsItemsModalOpen()) {
    kaShowModalToast(message, variant, duration);
  } else {
    kaShowInlineAlert(message, variant, duration);
  }
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

function kaNormalizeCustomerLabel(project) {
  if (!project) return '';
  const raw = project.customer_name;
  return raw ? String(raw).trim() : '';
}

function kaFindCustomerProjects(name) {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return [];
  const projects = Array.isArray(kaProjects) ? kaProjects : [];
  return projects.filter(p => {
    const label = kaNormalizeCustomerLabel(p);
    return label && label.toLowerCase() === target;
  });
}

function kaIsCustomerName(name) {
  const raw = String(name || '').trim();
  if (!raw) return false;
  if (/^company$/i.test(raw)) return false;
  if (/^other:/i.test(raw)) return false;
  return kaFindCustomerProjects(raw).length > 0;
}

function kaCustomerSheetElements() {
  const sheet = document.getElementById('ka-customer-sheet');
  if (!sheet) return null;
  return {
    sheet,
    panel: sheet.querySelector('.ka-sheet-panel'),
    handle: sheet.querySelector('[data-ka-customer-sheet-handle]'),
    header: sheet.querySelector('.ka-sheet-header'),
    title: sheet.querySelector('#ka-customer-sheet-title'),
    sub: sheet.querySelector('#ka-customer-sheet-sub'),
    body: sheet.querySelector('#ka-customer-sheet-body')
  };
}

function kaRenderCustomerSheetBody(name, projects = []) {
  const safeName = escapeHTML(name);
  const countLabel = projects.length
    ? `${projects.length} project${projects.length === 1 ? '' : 's'}`
    : 'No linked projects';
  const list = projects.length
    ? `<ul class="ka-customer-projects">${projects.map(p => {
        const projName = escapeHTML(p.name || '(Unnamed project)');
        const activeFlag =
          p.active === undefined || p.active === null || Number(p.active) === 1;
        const status = activeFlag ? 'Active' : 'Inactive';
        const tz = p.project_timezone ? escapeHTML(p.project_timezone) : '';
        const meta = [status, tz].filter(Boolean).join(' · ');
        return `
          <li class="ka-customer-project">
            <div class="ka-customer-project-name">${projName}</div>
            <div class="ka-customer-project-meta">${meta || '—'}</div>
          </li>
        `;
      }).join('')}</ul>`
    : '<div class="ka-ship-muted">(No projects found for this customer.)</div>';

  return `
    <div class="ka-customer-summary">
      <div class="ka-customer-label">Customer</div>
      <div class="ka-customer-name">${safeName}</div>
      <div class="ka-customer-meta">${countLabel}</div>
    </div>
    <div class="ka-customer-section">
      <div class="ka-customer-section-title">Projects</div>
      ${list}
    </div>
  `;
}

function kaOpenCustomerSheet(name) {
  const els = kaCustomerSheetElements();
  const label = String(name || '').trim();
  if (!els || !label) return;
  const projects = kaFindCustomerProjects(label);
  if (els.title) els.title.textContent = label;
  if (els.sub) {
    els.sub.textContent = projects.length
      ? `${projects.length} project${projects.length === 1 ? '' : 's'}`
      : 'Customer details';
  }
  if (els.body) {
    els.body.innerHTML = kaRenderCustomerSheetBody(label, projects);
  }

  if (!kaCustomerSheetState.open) {
    kaCustomerSheetState.open = true;
    kaCustomerSheetState.dragging = false;
    kaCustomerSheetState.startY = 0;
    kaCustomerSheetState.currentY = 0;
    els.sheet.classList.remove('hidden');
    requestAnimationFrame(() => {
      els.sheet.classList.add('is-open');
    });
    els.sheet.setAttribute('aria-hidden', 'false');
    kaSyncModalOpenState();
  }
}

function kaCloseCustomerSheet() {
  const els = kaCustomerSheetElements();
  if (!els) return;
  kaCustomerSheetState.open = false;
  kaCustomerSheetState.dragging = false;
  els.sheet.classList.remove('is-open');
  els.sheet.setAttribute('aria-hidden', 'true');
  els.sheet.classList.remove('dragging');
  if (els.panel) els.panel.style.transform = '';
  kaSyncModalOpenState();
  window.setTimeout(() => {
    if (!els.sheet.classList.contains('is-open')) {
      els.sheet.classList.add('hidden');
    }
    kaSyncModalOpenState();
  }, 260);
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
  const paidStorage = Number(shipment.storage_paid) === 1 ? 'Paid' : 'Unpaid';
  const amountShipper = kaFmtCurrency(shipment.shipper_paid_amount);
  const amountCustoms = kaFmtCurrency(shipment.customs_paid_amount);
  const amountStorage = kaFmtCurrency(shipment.storage_paid_amount);
  const paidByShipper = shipment.shipper_paid_by || '';
  const paidByCustoms = shipment.customs_paid_by || '';
  const hasStorageFees =
    (shipment.storage_paid_amount != null && Number(shipment.storage_paid_amount) > 0) ||
    Number(shipment.storage_paid) === 1;
  const totalPaidRaw = shipment.total_paid != null
    ? Number(shipment.total_paid)
    : (Number(shipment.shipper_paid) === 1 ? Number(shipment.shipper_paid_amount) || 0 : 0) +
      (Number(shipment.customs_paid) === 1 ? Number(shipment.customs_paid_amount) || 0 : 0) +
      (Number(shipment.storage_paid) === 1 ? Number(shipment.storage_paid_amount) || 0 : 0);
  const totalPaid = kaFmtCurrency(totalPaidRaw);

  const verify = kaShipVerificationInfo(shipment);
  const normalizedDocs = kaFilterDocsForPermissions(kaNormalizeDocs(docs));
  const shipperDocs = normalizedDocs.filter(kaDocMatchesShipper);
  const clearingDocs = normalizedDocs.filter(kaDocMatchesClearing);
  const paymentRows = [
    { title: 'Freight Forwarder', status: paidShipper, amount: amountShipper, mode: 'shipper', hasDocs: shipperDocs.length > 0, paidBy: paidByShipper },
    { title: 'Customs/Clearing', status: paidCustoms, amount: amountCustoms, mode: 'clearing', hasDocs: clearingDocs.length > 0, paidBy: paidByCustoms }
  ];
  const paymentTotalsRow = canViewPayments
    ? `<div class="ka-items-overview-pair ka-pay-total"><span>Total Paid</span><strong>${totalPaid}</strong></div>`
    : '';
  const paymentLedgerSlot = canViewPayments
    ? `<div class="ka-payment-ledger hidden" id="ka-payment-ledger"></div>`
    : '';
  const shipmentId = shipment.id || kaItemsModalShipmentId || '';
  const renderAmountValue = (row) => {
    if (!canViewPayments) return '—';
    if (!row.amount || row.amount === '—') return '—';
    if (row.status === 'Paid' && row.hasDocs) {
      return `<button type="button" class="ka-pay-doc-link" data-ka-pay-docs="${row.mode}" data-ka-pay-docs-has="${row.hasDocs ? 1 : 0}" data-ka-pay-docs-id="${shipmentId}">${row.amount}</button>`;
    }
    return row.amount;
  };
  const renderPaidByValue = (row) => {
    if (!canViewPayments || row.status !== 'Paid' || !row.paidBy) return '—';
    const safeName = escapeHTML(row.paidBy);
    if (kaIsCustomerName(row.paidBy)) {
      return `<button type="button" class="ka-pay-paidby-link" data-ka-customer="${safeName}">${safeName}</button>`;
    }
    return safeName;
  };
  const renderPaymentCard = (row) => {
    const statusValue = row.status === 'Paid'
      ? '<span class="ka-payment-status is-paid">Paid</span>'
      : '<span class="ka-payment-status is-unpaid">Unpaid</span>';
    return `
      <div class="ka-payment-card">
        <div class="ka-payment-card-title">${row.title}</div>
        <div class="ka-payment-card-row"><span>Status</span>${statusValue}</div>
        <div class="ka-payment-card-row"><span>Amount</span><strong>${renderAmountValue(row)}</strong></div>
        <div class="ka-payment-card-row"><span>Paid by</span><strong>${renderPaidByValue(row)}</strong></div>
      </div>
    `;
  };
  const paymentsHtml = `
    <div class="ka-payments-grid">
      ${paymentRows.map(renderPaymentCard).join('')}
    </div>
  `;
  const storageRowHtml = hasStorageFees
    ? `
      <div class="ka-payment-inline">
        <span class="ka-payment-inline-label">Storage fees</span>
        <div class="ka-payment-inline-meta">
          <span class="ka-payment-status ${paidStorage === 'Paid' ? 'is-paid' : 'is-unpaid'}">${paidStorage}</span>
          <strong class="ka-payment-inline-amount">${canViewPayments ? amountStorage : '—'}</strong>
        </div>
      </div>
    `
    : '';
  const bolDoc = kaFindDocByType(normalizedDocs, 'bol');
  const bolHref = bolDoc
    ? kaAppendShipmentAuth(bolDoc.view_url || bolDoc.url || bolDoc.file_path || null)
    : null;
  const otherDocs = normalizedDocs.filter(d => !bolDoc || d !== bolDoc);

  const docItems = [];
  const pushDocCard = (doc, fallbackType) => {
    if (!doc) return;
    const href = kaAppendShipmentAuth(doc.view_url || doc.url || doc.file_path || '#');
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
          <input type="text" id="ka-pickup-other" placeholder="Enter name" aria-required="false" />
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
        ${storageRowHtml}
        ${paymentTotalsRow}
        ${paymentLedgerSlot}
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

function kaBindOverviewPaidByLinks() {
  const wrap = document.getElementById('ka-items-overview');
  if (!wrap) return;
  wrap.querySelectorAll('[data-ka-customer]').forEach(btn => {
    if (btn.dataset.bound) return;
    btn.addEventListener('click', () => {
      const name = btn.dataset.kaCustomer || '';
      if (!name) return;
      kaOpenCustomerSheet(name);
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
  kaResetItemsSheetPosition();

  document.body.classList.add('ka-modal-open');
  document.documentElement.classList.add('ka-modal-open');

  kaShipmentItemsDirty.clear();
  kaClearItemAutoSaves();
  kaItemsModalShipmentId = shipmentId;
  kaItemsFilterTerm = '';
  kaItemsStatusFilter = 'all';
  kaSetItemsTab(tab);
  kaShipmentDetailDocs = [];
  kaExpandedItems.clear();
  kaAutoExpandedItems.clear();

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
    const projectLabel =
      shipment.project_name ||
      kaProjectLabelById(shipment.project_id) ||
      'No project set';
    subEl.textContent = `Project: ${projectLabel}`;
  }

  overviewEl.innerHTML = kaRenderShipmentOverview(shipment, documents, items);
  kaBindOverviewUpload();
  kaBindOverviewPaymentDocs();
  kaBindOverviewPaidByLinks();
  kaBindOverviewDocViewer();
  kaBindNotesControls(shipment);
  kaBindPickupControls(shipment);
  kaPrefetchDocsForOffline(documents);
  kaLoadPaymentLedgerForOverview(shipmentId);

  const hasItems = Array.isArray(items) && items.length > 0;
  const allowVerification = kaCanVerifyShipmentItems(shipment);
  const lockNote = allowVerification
    ? ''
    : '<div id="ka-items-locked-note" class="ka-items-locked-note ka-ship-muted">Items can be reviewed after pickup is recorded.</div>';

  body.innerHTML = `
    <div class="ka-items-toolbar">
      <div class="ka-items-actions">
        <label class="ka-items-filter">
          <span>View</span>
          <select id="ka-items-status-filter">
            <option value="all" ${kaItemsStatusFilter === 'all' ? 'selected' : ''}>All</option>
            <option value="unverified" ${kaItemsStatusFilter === 'unverified' ? 'selected' : ''}>Not Reviewed</option>
            <option value="verified" ${kaItemsStatusFilter === 'verified' ? 'selected' : ''}>Verified</option>
            <option value="issues" ${kaItemsStatusFilter === 'issues' ? 'selected' : ''}>Issues</option>
            <option value="missing" ${kaItemsStatusFilter === 'missing' ? 'selected' : ''}>Missing</option>
            <option value="damaged" ${kaItemsStatusFilter === 'damaged' ? 'selected' : ''}>Damaged</option>
            <option value="wrong_item" ${kaItemsStatusFilter === 'wrong_item' ? 'selected' : ''}>Wrong item</option>
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

    ${lockNote}

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
      kaItemsStatusFilter = statusFilterEl.value || 'all';
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
  const allowVerification = kaCanVerifyShipmentItems(kaShipmentDetail.shipment || {});
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

  const statusFilter = (kaItemsStatusFilter || 'all').toLowerCase().trim();
  if (statusFilter && statusFilter !== 'all') {
    items = items.filter(item => {
      const current = kaCurrentItemState(item);
      const status = kaNormalizeItemStatus(current?.verification?.status || '');
      const normalized = status || 'unverified';
      if (statusFilter === 'issues') {
        return ['missing', 'damaged', 'wrong_item'].includes(normalized);
      }
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
    const row = kaRenderItemRow(item, shipmentId, allowVerification);
    if (row) listEl.appendChild(row);
  });

  kaUpdateItemsSummaryUI();
}

function kaRenderItemRow(item, shipmentId, allowVerification = true) {
  if (!item) return null;
  const verification = item.verification || {};
  const itemIdNum = Number(item.id);
  const status = (verification.status || '').toLowerCase();
  const notes = verification.notes || '';
  const storage = verification.storage_override || '';
  const combinedNotes = notes || storage || '';
  const isExpanded = kaExpandedItems.has(itemIdNum);
  const chevronGlyph = isExpanded ? '▾' : '▸';
  const lastBy = verification.verified_by || '';
  const lastAt = verification.verified_at ? verification.verified_at.slice(0, 10) : '';
  const qty = item.quantity !== undefined ? item.quantity : '';
  const unit = item.unit || '';
  const sku = item.sku || '';
  const vendorName = item.vendor_name || '';
  const recentlySaved = kaRecentlySavedItems.has(itemIdNum);
  const qtyText = `${qty}${unit ? ` ${unit}` : ''}`.trim();
  const metaParts = [];
  if (qtyText !== '') {
    metaParts.push(`
      <span class="ka-item-meta-chunk">
        <span class="ka-item-meta-label">Qty:</span>
        <span class="ka-item-meta-value">${qtyText}</span>
      </span>
    `);
  }
  if (sku) {
    metaParts.push(`
      <span class="ka-item-meta-chunk">
        <span class="ka-item-meta-label">SKU:</span>
        <span class="ka-item-meta-value">${sku}</span>
      </span>
    `);
  }
  if (vendorName) {
    metaParts.push(`
      <span class="ka-item-meta-chunk">
        <span class="ka-item-meta-label">Vendor:</span>
        <span class="ka-item-meta-value">${vendorName}</span>
      </span>
    `);
  }
  const metaHtml = metaParts.length
    ? metaParts.join('<span class="ka-item-meta-dot">•</span>')
    : '';

  const row = document.createElement('div');
  row.className = 'ka-item-row';
  row.dataset.itemId = item.id;
  row.classList.add(status ? `status-${status}` : 'status-unverified');
  if (kaShipmentItemsDirty.has(itemIdNum)) row.classList.add('is-unsaved');

  const statuses = [
    { val: '', label: 'Not Reviewed' },
    { val: 'verified', label: 'Verified' },
    { val: 'missing', label: 'Missing' },
    { val: 'damaged', label: 'Damaged' },
    { val: 'wrong_item', label: 'Wrong item' }
  ];


  row.innerHTML = `
    <div class="ka-item-swipe">
      <div class="ka-item-swipe-main">
        <div class="ka-item-row-head">
          <div class="ka-item-head-left">
            <button type="button" class="ka-item-collapse" data-ka-collapse="${item.id}" aria-label="${isExpanded ? 'Collapse item' : 'Expand item'}">${chevronGlyph}</button>
            <div class="ka-item-head-text">
              <div class="ka-item-title">${item.description || '(No description)'}</div>
              <div class="ka-item-meta-line">
                ${metaHtml}
              </div>
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
          </div>
        </div>
        <div class="ka-item-body">
          <div class="ka-item-divider"></div>

          <div class="ka-item-row-notes open" data-ka-notes="${item.id}">
            <label>
              <span>Notes & Storage Details</span>
              <textarea rows="3" data-ship-item-notes-id="${item.id}">${combinedNotes}</textarea>
            </label>
          </div>

          <div class="ka-item-row-footer">
            <div class="ka-item-last">
              <span class="ka-item-unsaved-dot ${kaShipmentItemsDirty.has(itemIdNum) ? '' : 'hidden'}" aria-hidden="true">●</span>
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
      </div>
      <button type="button" class="ka-item-swipe-action" data-ka-item-swipe-save="${item.id}" aria-label="Save item">Save</button>
    </div>
  `;

  row.querySelectorAll('.ka-item-meta-value').forEach(el => {
    const fullText = (el.textContent || '').trim();
    if (fullText) el.setAttribute('title', fullText);
  });

  const statusSelect = row.querySelector('[data-ka-item-status-select]');
  const notesEl = row.querySelector(`textarea[data-ship-item-notes-id="${item.id}"]`);
  const saveBtn = row.querySelector(`[data-ka-save-item="${item.id}"]`);
  const collapseBtn = row.querySelector(`[data-ka-collapse="${item.id}"]`);
  const unsavedDot = row.querySelector('.ka-item-unsaved-dot');
  const lastMeta = row.querySelector('.ka-item-last-meta');
  const saveStatus = row.querySelector('[data-ka-item-save-status]');
  const notesWrap = row.querySelector(`[data-ka-notes="${item.id}"]`);
  const swipeAction = row.querySelector('[data-ka-item-swipe-save]');

  if (!allowVerification) {
    row.classList.add('ka-item-locked');
    if (statusSelect) statusSelect.disabled = true;
    if (notesEl) {
      notesEl.disabled = true;
      notesEl.required = false;
    }
    if (saveBtn) saveBtn.disabled = true;
    if (swipeAction) swipeAction.disabled = true;
  }

  const setNotesErrorState = (show) => {
    if (!notesEl) return;
    notesEl.classList.toggle('field-error', !!show);
    if (show) {
      notesEl.setAttribute('aria-invalid', 'true');
    } else {
      notesEl.removeAttribute('aria-invalid');
    }
  };

  const setNotesRequiredState = (required) => {
    if (!notesEl) return;
    notesEl.required = !!required;
    notesEl.setAttribute('aria-required', required ? 'true' : 'false');
    if (!required) setNotesErrorState(false);
    if (notesWrap) notesWrap.classList.toggle('is-required', !!required);
  };

  const updateCollapseButton = (collapsed) => {
    if (!collapseBtn) return;
    collapseBtn.textContent = collapsed ? '▸' : '▾';
    collapseBtn.setAttribute('aria-label', collapsed ? 'Expand item' : 'Collapse item');
  };

  const expandRowForNotes = (autoExpand) => {
    if (!row.classList.contains('collapsed')) return;
    row.classList.remove('collapsed');
    kaExpandedItems.add(itemIdNum);
    if (autoExpand) kaAutoExpandedItems.add(itemIdNum);
    updateCollapseButton(false);
  };

  const updateNotesRequirement = (statusVal, { autoExpand = false, showError = false } = {}) => {
    const needsNotes = kaStatusRequiresNotes(statusVal);
    setNotesRequiredState(needsNotes);
    if (!needsNotes) {
      kaAutoExpandedItems.delete(itemIdNum);
      setNotesErrorState(false);
      return;
    }
    if (autoExpand) {
      expandRowForNotes(true);
    }
    const meetsRequirement = kaNotesMeetRequirement(
      itemIdNum,
      statusVal,
      notesEl ? notesEl.value : ''
    );
    if (showError) {
      setNotesErrorState(!meetsRequirement);
    } else if (meetsRequirement) {
      setNotesErrorState(false);
    }
  };

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
      kaResetItemSwipe(row);
    }
  };

  const scheduleAutoSave = () => {
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
    const saved = kaGetSavedItemStatus(itemIdNum, status);
    return kaNormalizeItemStatus(active || saved);
  };

  if (allowVerification && statusSelect) {
    statusSelect.addEventListener('change', () => {
      const val = statusSelect.value || '';
      setActiveStatus(val);
      updateNotesRequirement(val, { autoExpand: true, showError: true });
      markDirty(val, { skipAuto: true });
    });
  }

  if (allowVerification && notesEl) {
    notesEl.addEventListener('input', () => {
      markDirty(null);
      updateNotesRequirement(statusSelect ? statusSelect.value || '' : '', { showError: true });
    });
  }

  if (allowVerification && saveBtn) {
    saveBtn.addEventListener('click', async () => {
      markDirty(null, { skipAuto: true });
      const ok = await kaSaveShipmentVerificationFor(shipmentId, { onlyItemId: itemIdNum });
      if (ok) {
        refreshUnsavedState(false);
      }
    });
  }

  if (allowVerification && swipeAction) {
    swipeAction.addEventListener('click', async (e) => {
      e.stopPropagation();
      markDirty(null, { skipAuto: true });
      const ok = await kaSaveShipmentVerificationFor(shipmentId, { onlyItemId: itemIdNum });
      if (ok) {
        refreshUnsavedState(false);
        kaCloseItemSwipes();
      }
    });
  }

  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      const collapsed = row.classList.toggle('collapsed');
      if (collapsed) {
        kaExpandedItems.delete(itemIdNum);
      } else {
        kaExpandedItems.add(itemIdNum);
      }
      kaAutoExpandedItems.delete(itemIdNum);
      updateCollapseButton(collapsed);
    });
  }

  row.classList.toggle('collapsed', !isExpanded);

  const initialStatus = currentStatusValue();
  setActiveStatus(initialStatus);
  if (allowVerification) {
    updateNotesRequirement(initialStatus);
  } else {
    setNotesRequiredState(false);
  }
  kaBindItemSwipe(row);

  return row;
}

function kaCloseItemSwipes(exceptRow = null) {
  document.querySelectorAll('.ka-item-row.show-save').forEach(row => {
    if (exceptRow && row === exceptRow) return;
    kaResetItemSwipe(row);
  });
}

function kaResetItemSwipe(row) {
  if (!row) return;
  row.classList.remove('show-save');
  row.classList.remove('is-dragging');
  const swipeMain = row.querySelector('.ka-item-swipe-main');
  if (swipeMain) {
    swipeMain.style.transform = '';
    swipeMain.style.transition = '';
  }
}

function kaBindItemSwipe(row) {
  const swipe = row?.querySelector('.ka-item-swipe');
  const swipeMain = row?.querySelector('.ka-item-swipe-main');
  if (!row || !swipe || !swipeMain || swipe.dataset.bound) return;
  const actionWidth = 110;
  const dragSlop = 8;
  const verticalCancelSlop = 14;
  const horizontalIntentRatio = 1.1;
  const verticalIntentRatio = 1.1;
  const openThreshold = -actionWidth * 0.3;
  const closeThreshold = -actionWidth * 0.6;
  const flickThreshold = 0.25;
  const itemIdNum = Number(row.dataset.itemId);
  const state = {
    tracking: false,
    dragging: false,
    startX: 0,
    startY: 0,
    startOffset: 0,
    currentOffset: 0,
    deltaX: 0,
    pointerId: null,
    lastMoveX: 0,
    lastMoveTime: 0,
    velocityX: 0,
    rafId: 0,
    pendingOffset: 0
  };

  const canStart = (target) => {
    if (!target) return false;
    const isDirty = row.classList.contains('is-unsaved') || kaShipmentItemsDirty.has(itemIdNum);
    if (!isDirty) return false;
    if (target.closest('button, a, input, select, textarea')) return false;
    return true;
  };

  const clampOffset = (offset) => Math.max(-actionWidth, Math.min(0, offset));

  const applyOffset = (offset) => {
    const clamped = clampOffset(offset);
    state.currentOffset = clamped;
    swipeMain.style.transform = `translate3d(${clamped}px, 0, 0)`;
  };

  const queueOffset = (offset) => {
    const clamped = Math.max(-actionWidth, Math.min(0, offset));
    state.currentOffset = clamped;
    state.pendingOffset = clamped;
    if (state.rafId) return;
    state.rafId = requestAnimationFrame(() => {
      state.rafId = 0;
      swipeMain.style.transform = `translate3d(${state.pendingOffset}px, 0, 0)`;
    });
  };

  const openSwipe = () => {
    row.classList.add('show-save');
    applyOffset(-actionWidth);
  };

  const closeSwipe = () => {
    row.classList.remove('show-save');
    applyOffset(0);
  };

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!canStart(e.target)) return;
    state.tracking = true;
    state.dragging = false;
    swipeMain.style.transition = 'none';
    state.pointerId = e.pointerId;
    if (swipeMain.setPointerCapture) swipeMain.setPointerCapture(e.pointerId);
    state.startX = e.clientX;
    state.startY = e.clientY;
    state.startOffset = row.classList.contains('show-save') ? -actionWidth : 0;
    state.currentOffset = state.startOffset;
    state.deltaX = 0;
    state.lastMoveX = e.clientX;
    state.lastMoveTime = performance.now();
    state.velocityX = 0;
  };

  const onPointerMove = (e) => {
    if (!state.tracking || (state.pointerId !== null && e.pointerId !== state.pointerId)) return;
    const rawDx = e.clientX - state.startX;
    const rawDy = e.clientY - state.startY;
    const absDx = Math.abs(rawDx);
    const absDy = Math.abs(rawDy);
    const now = performance.now();
    const dt = now - state.lastMoveTime;
    if (dt > 0) {
      const vx = (e.clientX - state.lastMoveX) / dt;
      state.velocityX = state.velocityX ? state.velocityX * 0.6 + vx * 0.4 : vx;
    }
    state.lastMoveX = e.clientX;
    state.lastMoveTime = now;
    if (!state.dragging) {
      if (absDx < dragSlop && absDy < dragSlop) return;
      const horizontalIntent = absDx >= absDy * horizontalIntentRatio;
      const verticalIntent = absDy > verticalCancelSlop && absDy >= absDx * verticalIntentRatio;
      if (horizontalIntent) {
        state.dragging = true;
        row.classList.add('is-dragging');
        if (swipeMain.setPointerCapture) swipeMain.setPointerCapture(e.pointerId);
        kaCloseItemSwipes(row);
        state.startX = e.clientX;
        state.startY = e.clientY;
        state.startOffset = state.currentOffset;
        state.deltaX = 0;
      } else if (verticalIntent) {
        state.tracking = false;
        swipeMain.style.transition = '';
        return;
      } else {
        return;
      }
    }
    const dx = e.clientX - state.startX;
    state.deltaX = dx;
    e.preventDefault();
    queueOffset(state.startOffset + dx);
  };

  const onPointerEnd = () => {
    if (!state.tracking) return;
    const offset = state.currentOffset || 0;
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
    let shouldOpen = row.classList.contains('show-save');
    if (state.dragging) {
      const isOpen = row.classList.contains('show-save');
      if (state.velocityX < -flickThreshold) {
        shouldOpen = true;
      } else if (state.velocityX > flickThreshold) {
        shouldOpen = false;
      } else if (isOpen) {
        if (offset > closeThreshold) {
          shouldOpen = false;
        } else {
          shouldOpen = true;
        }
      } else if (offset < openThreshold) {
        shouldOpen = true;
      } else {
        shouldOpen = false;
      }
    } else if (shouldOpen) {
      shouldOpen = false;
    }
    row.classList.remove('is-dragging');
    state.tracking = false;
    state.dragging = false;
    if (state.pointerId !== null && swipeMain.releasePointerCapture) {
      try {
        swipeMain.releasePointerCapture(state.pointerId);
      } catch (err) {
        // Ignore release errors for browsers that don't support capture on touch.
      }
    }
    state.pointerId = null;
    swipeMain.style.transition = '';
    requestAnimationFrame(() => {
      if (shouldOpen) {
        openSwipe();
      } else {
        closeSwipe();
      }
    });
  };

  swipeMain.addEventListener('pointerdown', onPointerDown);
  swipeMain.addEventListener('pointermove', onPointerMove, { passive: false });
  swipeMain.addEventListener('pointerup', onPointerEnd);
  swipeMain.addEventListener('pointercancel', onPointerEnd);

  swipe.dataset.bound = '1';
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

  const invalidItems = items.filter(row => {
    const verification = row.verification || {};
    const notesValue = kaVerificationNotesValue(verification);
    return !kaNotesMeetRequirement(row.shipment_item_id, verification.status, notesValue);
  });

  if (invalidItems.length) {
    invalidItems.forEach(row => {
      const idNum = Number(row.shipment_item_id);
      if (!Number.isFinite(idNum)) return;
      kaExpandedItems.add(idNum);
      kaAutoExpandedItems.add(idNum);
      const rowEl = document.querySelector(`.ka-item-row[data-item-id="${idNum}"]`);
      if (rowEl) {
        rowEl.classList.remove('collapsed');
        const collapseBtn = rowEl.querySelector(`[data-ka-collapse="${idNum}"]`);
        if (collapseBtn) {
          collapseBtn.textContent = '▾';
          collapseBtn.setAttribute('aria-label', 'Collapse item');
        }
        const notesEl = rowEl.querySelector(`textarea[data-ship-item-notes-id="${idNum}"]`);
        if (notesEl) {
          notesEl.classList.add('field-error');
          notesEl.setAttribute('aria-invalid', 'true');
          notesEl.setAttribute('aria-required', 'true');
        }
        kaResetItemSwipe(rowEl);
      }
    });
    if (!silent || onlyItemId === null) {
      kaShowItemsModalAlert(
        'Notes are required for missing, damaged, or wrong-item statuses. Update the note before saving.',
        'error',
        6000
      );
    }
    return false;
  }

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
        kaShowItemsModalAlert('Offline: verification saved locally and will sync when online.', 'error', 6000);
      }
      return true;
    }

    if (!silent) {
      const msg = err && err.message ? err.message : 'Failed to save verification.';
      kaShowItemsModalAlert(msg, 'error', 8000);
    }
    return false;
  }
}

function kaSetItemSavedUI(itemId) {
  const itemIdNum = Number(itemId);
  const row = document.querySelector(`.ka-item-row[data-item-id="${itemId}"]`);
  const item = kaFindShipmentItem(itemId);
  const current = kaCurrentItemState(item);
  const status = current && current.verification ? (current.verification.status || '').toLowerCase() : '';
  kaSetSavedItemStatus(itemIdNum, status);
  if (current && current.verification) {
    kaSetSavedItemNotes(itemIdNum, kaVerificationNotesValue(current.verification));
  }
  kaMarkItemRecentlySaved(itemIdNum);

  if (kaAutoExpandedItems.has(itemIdNum)) {
    kaAutoExpandedItems.delete(itemIdNum);
    kaExpandedItems.delete(itemIdNum);
    if (row) {
      row.classList.add('collapsed');
      const collapseBtn = row.querySelector(`[data-ka-collapse="${itemIdNum}"]`);
      if (collapseBtn) {
        collapseBtn.textContent = '▸';
        collapseBtn.setAttribute('aria-label', 'Expand item');
      }
    }
  }

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
    if (e.active === 0) return false;
    const hasPin = !!e.pin_hash || !!(e.pin || '').trim();
    return !hasPin;
  });

  tbody.innerHTML = '';

  if (!needingPin.length) {
    tbody.innerHTML =
      '<tr><td colspan="2" class="ka-muted">(all active employees have a PIN)</td></tr>';
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

async function kaSaveEmployeePinUpdate({ employeeId, pin, statusEl }) {
  const deviceSecret = kaGetDeviceSecret();
  if (statusEl) {
    statusEl.textContent = 'Saving PIN…';
    statusEl.className = 'ka-status';
  }

  const updateLocal = () => {
    const emp = kaFindEmployeeById(employeeId);
    if (emp) {
      const pinHash = kaHashPin(pin);
      if (pinHash) {
        emp.pin_hash = pinHash;
        emp.pin = '';
      } else {
        emp.pin = pin;
      }
    }
  };

  try {
    await fetchJSON(`/api/employees/${employeeId}/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin,
        allowOverride: true,
        device_id: kaDeviceId || null,
        device_secret: deviceSecret
      })
    });

    updateLocal();
    if (statusEl) {
      statusEl.textContent = 'PIN updated.';
      statusEl.classList.add('ka-status-ok');
    }
    return { ok: true };
  } catch (err) {
    console.error('Error updating PIN (primary endpoint)', err);
    try {
      await fetchJSON(`/api/employees/${employeeId}/pin?allowOverride=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin,
          device_id: kaDeviceId || null,
          device_secret: deviceSecret
        })
      });
      updateLocal();
      if (statusEl) {
        statusEl.textContent = 'PIN updated.';
        statusEl.classList.add('ka-status-ok');
      }
      return { ok: true };
    } catch (err2) {
      console.error('PIN fallback attempt failed', err2);
      const msg = err2 && err2.message ? err2.message : (err && err.message) || 'Error updating PIN. Please try again.';

      const authLike = /auth|login|credential|session/i.test(msg);
      const netLike = /network|failed to fetch|offline/i.test(msg);
      if (authLike || netLike) {
        updateLocal();
        await kaAddPendingPinUpdate({ employee_id: employeeId, pin });
        if (statusEl) {
          statusEl.textContent = 'PIN saved locally; will sync when online/authenticated.';
          statusEl.classList.add('ka-status-ok');
        }
        return { ok: true, queued: true };
      }

      if (statusEl) {
        statusEl.textContent = msg;
        statusEl.classList.add('ka-status-error');
      }
      return { ok: false, error: msg };
    }
  }
}

async function kaHandlePinChange() {
  const sel = document.getElementById('ka-pin-employee');
  const pin1 = document.getElementById('ka-pin-new');
  const pin2 = document.getElementById('ka-pin-confirm');
  const status = document.getElementById('ka-pin-status');

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

  const result = await kaSaveEmployeePinUpdate({ employeeId: id, pin: p1, statusEl: status });
  if (result && result.ok) {
    pin1.value = '';
    pin2.value = '';
    kaRenderEmployeesGrid();
    kaRenderPinStatus();
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
    await fetchJSON(`/api/employees/${id}/name-on-checks`, {
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
      status.textContent = 'Name on checks updated.';
      status.classList.add('ka-status-ok');
    }
  } catch (err) {
    console.error('Error updating name on checks', err);
    if (status) {
      status.textContent = 'Error updating name on checks.';
      status.classList.add('ka-status-error');
    }
  }
}

function kaAppendEmployeeHistoryEntry(employeeId, entry) {
  if (!employeeId || !entry) return;
  if (!entry.start_date && !entry.termination_date) return;
  const history = kaLoadCachedEmployeeHistory(employeeId);
  history.unshift({
    start_date: entry.start_date || null,
    termination_date: entry.termination_date || null,
    recorded_at: entry.recorded_at || new Date().toISOString()
  });
  kaCacheEmployeeHistory(employeeId, history);
  kaEmployeeSheetState.history = history;
  kaUpdateEmployeeHistoryButton(history);
}

function kaApplyEmployeeUpdateLocal(employeeId, action, payload = {}) {
  if (!employeeId) return;
  switch (action) {
    case 'name':
      kaUpdateEmployeeRecord(employeeId, { name: payload.name });
      break;
    case 'phone':
      kaUpdateEmployeeRecord(employeeId, { phone: payload.phone || null });
      break;
    case 'language':
      kaUpdateEmployeeRecord(employeeId, { language: payload.language });
      break;
    case 'name_on_checks':
      kaUpdateEmployeeRecord(employeeId, { name_on_checks: payload.name_on_checks || null });
      break;
    case 'employment_dates': {
      const updates = {
        start_date: payload.start_date || null,
        termination_date: payload.termination_date || null
      };
      if (payload.termination_date) updates.active = 0;
      kaUpdateEmployeeRecord(employeeId, updates);
      break;
    }
    case 'reactivate':
      kaUpdateEmployeeRecord(employeeId, {
        start_date: payload.start_date || null,
        termination_date: null,
        active: 1
      });
      if (payload.prior_start_date || payload.prior_termination_date) {
        kaAppendEmployeeHistoryEntry(employeeId, {
          start_date: payload.prior_start_date || null,
          termination_date: payload.prior_termination_date || null
        });
      }
      break;
    case 'rate':
      kaUpdateEmployeeRecord(employeeId, { rate: payload.rate });
      break;
    default:
      break;
  }
}

async function kaHandleEmployeeSheetSave() {
  const els = kaEmployeeSheetElements();
  if (!els || !els.firstName || !els.lastName || !els.saveStatus) return;
  const id = kaEmployeeSheetState.employeeId;
  if (!id) {
    kaSetInlineStatus(els.saveStatus, 'Employee not selected.', 'error');
    return;
  }

  const first = (els.firstName.value || '').trim();
  const last = (els.lastName.value || '').trim();
  const fullName = [first, last].filter(Boolean).join(' ').trim();
  if (!fullName) {
    kaSetInlineStatus(els.saveStatus, 'Enter a first or last name.', 'error');
    return;
  }

  const phone = (els.phone && els.phone.value ? els.phone.value : '').trim();
  const lang = els.language && els.language.value ? els.language.value : 'en';
  const nameChecks = els.nameChecks && els.nameChecks.value ? els.nameChecks.value : '';
  const nameChecksValue = nameChecks.trim();
  const canRates = kaCanModifyPayRates();
  const rateInputValue = els.rateInput && els.rateInput.value !== undefined
    ? String(els.rateInput.value || '').trim()
    : '';
  const rateValue = rateInputValue === '' ? null : Number(rateInputValue);
  if (canRates && rateInputValue !== '' && Number.isNaN(rateValue)) {
    kaSetInlineStatus(els.saveStatus, 'Hourly rate must be a number.', 'error');
    return;
  }
  const startDate = els.startDate && els.startDate.value ? els.startDate.value.trim() : '';
  const termDate = els.termDate && els.termDate.value ? els.termDate.value.trim() : '';
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  if (startDate && !datePattern.test(startDate)) {
    kaSetInlineStatus(els.saveStatus, 'Start date must be YYYY-MM-DD.', 'error');
    return;
  }
  if (termDate && !datePattern.test(termDate)) {
    kaSetInlineStatus(els.saveStatus, 'Termination date must be YYYY-MM-DD.', 'error');
    return;
  }

  const emp = kaFindEmployeeById(id);
  const norm = (val) => (val || '').toString().trim();
  const nameChanged = norm(emp?.name) !== fullName;
  const phoneChanged = norm(emp?.phone) !== phone;
  const langChanged = norm(emp?.language || 'en') !== norm(lang);
  const nameChecksChanged = norm(emp?.name_on_checks || '') !== nameChecksValue;
  const startChanged = norm(emp?.start_date) !== startDate;
  const termChanged = norm(emp?.termination_date) !== termDate;
  const currentRate = emp && emp.rate != null ? Number(emp.rate) : null;
  const rateChanged = canRates && rateInputValue !== ''
    ? (currentRate === null || !Number.isFinite(currentRate) || Math.abs(currentRate - rateValue) > 0.0001)
    : false;
  const reactivatePending = !!kaEmployeeSheetState.reactivatePending;
  const reactivateSnapshot = kaEmployeeSheetState.reactivateSnapshot || {
    start_date: emp?.start_date || null,
    termination_date: emp?.termination_date || null
  };

  if (reactivatePending && !startDate) {
    kaSetInlineStatus(els.saveStatus, 'Enter a new start date to reactivate.', 'error');
    return;
  }

  const updates = [];
  if (nameChanged) updates.push({ action: 'name', payload: { name: fullName } });
  if (phoneChanged) updates.push({ action: 'phone', payload: { phone: phone || null } });
  if (langChanged) updates.push({ action: 'language', payload: { language: lang } });
  if (nameChecksChanged) {
    updates.push({ action: 'name_on_checks', payload: { name_on_checks: nameChecksValue || null } });
  }
  if (reactivatePending) {
    updates.push({
      action: 'reactivate',
      payload: {
        start_date: startDate,
        prior_start_date: reactivateSnapshot.start_date || null,
        prior_termination_date: reactivateSnapshot.termination_date || null
      }
    });
  } else if (startChanged || termChanged) {
    updates.push({
      action: 'employment_dates',
      payload: { start_date: startDate || null, termination_date: termDate || null }
    });
  }
  if (rateChanged) updates.push({ action: 'rate', payload: { rate: rateValue } });

  if (!updates.length) {
    kaSetInlineStatus(els.saveStatus, 'No changes to save.', 'ok');
    kaCloseEmployeeSheet();
    return;
  }

  kaSetInlineStatus(els.saveStatus, 'Saving changes…');
  const auth = kaEmployeeAuthMeta();
  const entries = updates.map(update => ({
    employee_id: id,
    action: update.action,
    payload: update.payload,
    auth
  }));

  if (!navigator.onLine) {
    kaQueueEmployeeUpdates(entries);
    entries.forEach(entry => kaApplyEmployeeUpdateLocal(id, entry.action, entry.payload));
    kaEmployeeSheetState.reactivatePending = false;
    kaEmployeeSheetState.reactivateSnapshot = null;
    kaSetInlineStatus(els.saveStatus, 'Saved offline. Will sync when online.', 'ok');
    kaRenderEmployeesGrid();
    kaRenderSettingsForm();
    kaCloseEmployeeSheet();
    return;
  }

  try {
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      try {
        await kaDispatchEmployeeUpdate(entry);
        kaApplyEmployeeUpdateLocal(id, entry.action, entry.payload);
      } catch (err) {
        if (kaIsConnectionIssue(err)) {
          const remaining = entries.slice(i);
          kaQueueEmployeeUpdates(remaining);
          remaining.forEach(rem => kaApplyEmployeeUpdateLocal(id, rem.action, rem.payload));
          kaEmployeeSheetState.reactivatePending = false;
          kaEmployeeSheetState.reactivateSnapshot = null;
          kaSetInlineStatus(els.saveStatus, 'Saved offline. Will sync when online.', 'ok');
          kaRenderEmployeesGrid();
          kaRenderSettingsForm();
          kaCloseEmployeeSheet();
          return;
        }
        throw err;
      }
    }

    kaEmployeeSheetState.reactivatePending = false;
    kaEmployeeSheetState.reactivateSnapshot = null;
    kaSetInlineStatus(els.saveStatus, 'Changes saved.', 'ok');
    kaRenderEmployeesGrid();
    kaRenderSettingsForm();
    kaCloseEmployeeSheet();
  } catch (err) {
    console.error('Error saving employee sheet', err);
    kaSetInlineStatus(els.saveStatus, err.message || 'Error saving changes.', 'error');
  }
}

async function kaHandleEmployeePinSave() {
  const els = kaEmployeePinSheetElements();
  if (!els || !els.pinInput || !els.pinConfirm || !els.pinStatus) return;
  const id = kaEmployeePinSheetState.employeeId;
  if (!id) {
    kaSetInlineStatus(els.pinStatus, 'Employee not selected.', 'error');
    return;
  }
  const p1 = (els.pinInput.value || '').trim();
  const p2 = (els.pinConfirm.value || '').trim();
  kaSetInlineStatus(els.pinStatus, '');

  if (!/^[0-9]{4}$/.test(p1) || !/^[0-9]{4}$/.test(p2)) {
    kaSetInlineStatus(els.pinStatus, 'PIN must be exactly 4 digits.', 'error');
    return;
  }
  if (p1 !== p2) {
    kaSetInlineStatus(els.pinStatus, 'PIN entries do not match.', 'error');
    return;
  }

  const result = await kaSaveEmployeePinUpdate({ employeeId: id, pin: p1, statusEl: els.pinStatus });
  if (result && result.ok) {
    els.pinInput.value = '';
    els.pinConfirm.value = '';
    kaRenderEmployeesGrid();
    kaRenderPinStatus();
    kaRefreshEmployeeSheet();
  }
}

async function kaHandleHelperAdd() {
  const statusEl = document.getElementById('ka-helper-status');
  const nameInput = document.getElementById('ka-helper-name');
  const nicknameInput = document.getElementById('ka-helper-nickname');
  const langSelect = document.getElementById('ka-helper-language');
  const idTypeSelect = document.getElementById('ka-helper-id-type');
  const fileInput = document.getElementById('ka-helper-id-file');
  const photoInput = document.getElementById('ka-helper-photo-file');

  if (!statusEl || !nameInput || !idTypeSelect || !fileInput) return;

  if (!navigator.onLine) {
    statusEl.textContent = 'Adding employees requires an internet connection.';
    statusEl.className = 'ka-status ka-status-error';
    return;
  }

  const name = String(nameInput.value || '').trim();
  const nickname = String(nicknameInput?.value || '').trim();
  const language = (langSelect && langSelect.value) ? langSelect.value : 'en';
  const idType = String(idTypeSelect.value || '').trim();
  const file = fileInput.files && fileInput.files[0];
  const photoFile = photoInput && photoInput.files ? photoInput.files[0] : null;
  const adminId = kaCurrentAdmin && kaCurrentAdmin.id ? kaCurrentAdmin.id : null;
  const deviceSecret = kaGetDeviceSecret();

  if (!name) {
    statusEl.textContent = 'Enter a full name.';
    statusEl.className = 'ka-status ka-status-error';
    return;
  }
  if (idType && !file) {
    statusEl.textContent = 'Upload an ID image or clear the ID type.';
    statusEl.className = 'ka-status ka-status-error';
    return;
  }
  if (file && !idType) {
    statusEl.textContent = 'Select an ID type to match the uploaded ID.';
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

  statusEl.textContent = 'Uploading employee...';
  statusEl.className = 'ka-status';

  try {
    const form = new FormData();
    form.append('name', name);
    if (nickname) form.append('nickname', nickname);
    if (language) form.append('language', language);
    if (idType && file) {
      form.append('id_document_type', idType);
      form.append('id_document', file);
    }
    if (photoFile) {
      form.append('employee_photo', photoFile);
    }
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
      throw new Error(data.error || 'Failed to add employee.');
    }

    statusEl.textContent = 'Employee added.';
    statusEl.className = 'ka-status ka-status-ok';

    nameInput.value = '';
    if (nicknameInput) nicknameInput.value = '';
    if (langSelect) langSelect.value = 'en';
    idTypeSelect.value = '';
    fileInput.value = '';
    if (photoInput) photoInput.value = '';

    const refreshed = await fetchJSON('/api/kiosk/admin/employees');
    kaEmployees = kaNormalizeEmployees(refreshed || []);
    if (kaStartEmployeeId) {
      kaCurrentAdmin =
        kaEmployees.find((e) => String(e.id) === String(kaStartEmployeeId)) || kaCurrentAdmin;
    }
    kaRenderSettingsForm();
    kaRenderPinStatus();
    kaRenderEmployeesGrid();
    if (kaEmployeeSheetState.open) kaRefreshEmployeeSheet();
    if (kaRatesUnlockedAll) {
      kaRenderRatesTable(kaEmployees);
    }
  } catch (err) {
    console.error('Error adding helper:', err);
    statusEl.textContent = err.message || 'Could not add employee.';
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

function kaParseIsoDateParts(dateStr) {
  if (!dateStr) return null;
  const match = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if ([year, month, day].some(Number.isNaN)) return null;
  return { year, month, day };
}

function kaIsoDateFromParts(year, month, day) {
  const yy = String(year).padStart(4, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function kaDateAtNoonUtc(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function kaDaysInMonth(year, month) {
  const dt = new Date(Date.UTC(year, month, 0));
  return dt.getUTCDate();
}

function kaWeekdayIndex(year, month, day) {
  const dt = kaDateAtNoonUtc(year, month, day);
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: kaOrgTimezone || KA_DEFAULT_TIMEZONE,
      weekday: 'short'
    }).formatToParts(dt);
    const weekday = parts.find(p => p.type === 'weekday')?.value || '';
    const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[weekday] ?? dt.getUTCDay();
  } catch {
    return dt.getUTCDay();
  }
}

function kaFormatMonthYearLabel(year, month) {
  const dt = kaDateAtNoonUtc(year, month, 1);
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: kaOrgTimezone || KA_DEFAULT_TIMEZONE,
      month: 'long',
      year: 'numeric'
    }).format(dt);
  } catch {
    const fallback = dt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    return fallback || `${month}/${year}`;
  }
}

function kaTimeCalendarMonthLabel(month) {
  const dt = kaDateAtNoonUtc(2024, month, 1);
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: kaOrgTimezone || KA_DEFAULT_TIMEZONE,
      month: 'long'
    }).format(dt);
  } catch {
    const names = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return names[month - 1] || String(month);
  }
}

function kaTimeCalendarYearRange(baseYear) {
  const currentYear = new Date().getFullYear();
  let min = currentYear - 50;
  let max = currentYear + 5;
  if (baseYear) {
    if (baseYear < min) min = baseYear - 5;
    if (baseYear > max) max = baseYear + 5;
  }
  return { min, max };
}

function kaEnsureTimeCalendarMonthOptions(selectEl) {
  if (!selectEl || selectEl.dataset.built) return;
  const fragment = document.createDocumentFragment();
  for (let month = 1; month <= 12; month += 1) {
    const opt = document.createElement('option');
    opt.value = String(month);
    opt.textContent = kaTimeCalendarMonthLabel(month);
    fragment.appendChild(opt);
  }
  selectEl.replaceChildren(fragment);
  selectEl.dataset.built = '1';
}

function kaEnsureTimeCalendarYearOptions(selectEl, baseYear) {
  if (!selectEl) return;
  const { min, max } = kaTimeCalendarYearRange(baseYear);
  const rangeKey = `${min}:${max}`;
  if (selectEl.dataset.range === rangeKey && selectEl.options.length) return;
  const fragment = document.createDocumentFragment();
  for (let year = min; year <= max; year += 1) {
    const opt = document.createElement('option');
    opt.value = String(year);
    opt.textContent = String(year);
    fragment.appendChild(opt);
  }
  selectEl.replaceChildren(fragment);
  selectEl.dataset.range = rangeKey;
}

function kaSyncTimeCalendarPicker(els) {
  if (!els || !els.monthSelect || !els.yearSelect) return;
  kaInitTimeCalendarState();
  const year = kaTimeCalendarState.year || new Date().getFullYear();
  const month = kaTimeCalendarState.month || 1;
  kaEnsureTimeCalendarMonthOptions(els.monthSelect);
  kaEnsureTimeCalendarYearOptions(els.yearSelect, year);
  els.monthSelect.value = String(month);
  els.yearSelect.value = String(year);
}

function kaSetTimeCalendarPickerOpen(open, { focusTitle = false } = {}) {
  const els = kaTimeCalendarElements();
  if (!els || !els.picker || !els.title) return;
  if (open) {
    kaSyncTimeCalendarPicker(els);
    els.picker.classList.remove('hidden');
    els.title.setAttribute('aria-expanded', 'true');
    els.monthSelect?.focus();
  } else {
    els.picker.classList.add('hidden');
    els.title.setAttribute('aria-expanded', 'false');
    if (focusTitle) els.title.focus();
  }
}

function kaTimeCalendarElements() {
  const root = document.getElementById('ka-time-calendar');
  if (!root) return null;
  return {
    root,
    title: root.querySelector('#ka-time-calendar-title'),
    grid: root.querySelector('#ka-time-calendar-grid'),
    picker: root.querySelector('#ka-time-calendar-picker'),
    monthSelect: root.querySelector('#ka-time-calendar-month'),
    yearSelect: root.querySelector('#ka-time-calendar-year')
  };
}

function kaInitTimeCalendarState() {
  if (kaTimeCalendarState.year && kaTimeCalendarState.month) return;
  const today = kaTodayIso();
  const parts = kaParseIsoDateParts(today);
  if (!parts) return;
  kaTimeCalendarState.year = parts.year;
  kaTimeCalendarState.month = parts.month;
  kaTimeCalendarState.selectedDate = today;
}

function kaRenderTimeCalendar() {
  const els = kaTimeCalendarElements();
  if (!els) return;
  kaInitTimeCalendarState();
  const year = kaTimeCalendarState.year;
  const month = kaTimeCalendarState.month;
  if (!year || !month) return;
  if (els.title) {
    els.title.textContent = kaFormatMonthYearLabel(year, month);
  }
  kaSyncTimeCalendarPicker(els);
  if (!els.grid) return;
  const todayIso = kaTodayIso();
  const selected = kaTimeCalendarState.selectedDate;
  const firstWeekday = kaWeekdayIndex(year, month, 1);
  const daysInMonth = kaDaysInMonth(year, month);
  const totalCells = firstWeekday + daysInMonth;
  const trailing = (7 - (totalCells % 7)) % 7;

  const fragment = document.createDocumentFragment();
  const addEmptyCell = () => {
    const cell = document.createElement('div');
    cell.className = 'ka-time-calendar-day is-empty';
    cell.setAttribute('aria-hidden', 'true');
    fragment.appendChild(cell);
  };

  for (let i = 0; i < firstWeekday; i += 1) {
    addEmptyCell();
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateStr = kaIsoDateFromParts(year, month, day);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ka-time-calendar-day';
    btn.textContent = String(day);
    btn.dataset.kaTimeCalDate = dateStr;
    btn.setAttribute('role', 'gridcell');
    if (dateStr === todayIso) btn.classList.add('is-today');
    if (selected && dateStr === selected) {
      btn.classList.add('is-selected');
    }
    fragment.appendChild(btn);
  }

  for (let i = 0; i < trailing; i += 1) {
    addEmptyCell();
  }

  els.grid.replaceChildren(fragment);
}

function kaShiftTimeCalendarMonth(delta) {
  kaInitTimeCalendarState();
  let year = kaTimeCalendarState.year || 0;
  let month = kaTimeCalendarState.month || 1;
  month += delta;
  if (month < 1) {
    month = 12;
    year -= 1;
  } else if (month > 12) {
    month = 1;
    year += 1;
  }
  kaTimeCalendarState.year = year;
  kaTimeCalendarState.month = month;
  kaRenderTimeCalendar();
}

function kaBindTimeCalendar() {
  const els = kaTimeCalendarElements();
  if (!els || els.root.dataset.bound) return;
  els.root.dataset.bound = '1';
  const handlePickerChange = () => {
    const month = Number(els.monthSelect?.value);
    const year = Number(els.yearSelect?.value);
    if (!month || !year) return;
    if (kaTimeCalendarState.month === month && kaTimeCalendarState.year === year) return;
    kaTimeCalendarState.month = month;
    kaTimeCalendarState.year = year;
    kaRenderTimeCalendar();
  };
  els.monthSelect?.addEventListener('change', handlePickerChange);
  els.yearSelect?.addEventListener('change', handlePickerChange);
  els.root.addEventListener('click', (e) => {
    const titleBtn = e.target.closest('[data-ka-time-cal-title]');
    if (titleBtn) {
      const isOpen = !els.picker?.classList.contains('hidden');
      kaSetTimeCalendarPickerOpen(!isOpen);
      return;
    }
    if (els.picker && !els.picker.classList.contains('hidden') && els.picker.contains(e.target)) {
      return;
    }
    const navBtn = e.target.closest('[data-ka-time-cal-nav]');
    if (navBtn) {
      const dir = navBtn.getAttribute('data-ka-time-cal-nav');
      kaSetTimeCalendarPickerOpen(false);
      if (dir === 'prev') kaShiftTimeCalendarMonth(-1);
      if (dir === 'next') kaShiftTimeCalendarMonth(1);
      return;
    }
    const dayBtn = e.target.closest('[data-ka-time-cal-date]');
    if (dayBtn) {
      const dateStr = dayBtn.getAttribute('data-ka-time-cal-date');
      if (!dateStr) return;
      kaSetTimeCalendarPickerOpen(false);
      kaTimeCalendarState.selectedDate = dateStr;
      kaRenderTimeCalendar();
      kaOpenTimeCalendarSheet(dateStr);
    }
  });
  document.addEventListener('click', (e) => {
    if (!els.picker || els.picker.classList.contains('hidden')) return;
    if (els.picker.contains(e.target) || els.title?.contains(e.target)) return;
    kaSetTimeCalendarPickerOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') kaSetTimeCalendarPickerOpen(false);
  });
}

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
  const filters = document.querySelector('#ka-view-time .ka-time-filters');
  if (filters) {
    filters.classList.toggle('ka-custom-open', mode === 'custom');
  }
}

function kaEntryStatusBadges(entry) {
  return kaTimeEntryStatusLabel(entry);
}

function kaFormatAutoClockoutReason(reason) {
  const raw = String(reason || '').trim().toLowerCase();
  if (!raw) return '';
  const map = {
    midnight_auto: 'Midnight auto-close',
    catch_up_auto: 'Catch-up auto-close',
    daily_max: 'Daily max hours',
    weekly_max: 'Weekly max hours'
  };
  return map[raw] || reason;
}

function kaAutoClockOutHelpText(reasonLabel = '') {
  const raw = String(reasonLabel || '').toLowerCase();
  if (raw.includes('midnight')) {
    return 'Midnight: closed at org midnight for a prior-day open punch.';
  }
  if (raw.includes('catch-up')) {
    return 'Catch-up: hourly job closed a prior-day open punch if midnight was missed.';
  }
  if (raw.includes('daily')) {
    return 'Daily max: closed when daily hours limit was exceeded.';
  }
  if (raw.includes('weekly')) {
    return 'Weekly max: closed when weekly hours limit was exceeded.';
  }
  if (raw.includes('flag')) {
    return 'Auto clock-out recorded; reason was not captured.';
  }
  return 'Auto clock-out recorded; reason was not captured.';
}

function kaAutoClockOutHelpLabel(reasonLabel = '') {
  const help = kaAutoClockOutHelpText(reasonLabel).replace(/"/g, '&quot;');
  return `Auto clock-out <span class="ka-info-tip" tabindex="0" role="note" aria-label="${help}" data-tooltip="${help}">?</span>`;
}

function kaReviewStatusDisplay(status) {
  const raw = String(status || '').trim().toLowerCase();
  if (!raw || raw === 'open') return '';
  if (raw === 'rejected') return 'Voided';
  if (raw === 'approved') return 'Approved';
  if (raw === 'modified') return 'Modified';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function kaEntryDetailMetaList(entry) {
  const meta = [];
  const metaState = kaTimeEntryMeta(entry);
  const flags = kaTimeEntryFlagLabels(entry, { includeFallback: metaState.isPending });
  meta.push(`Flags: ${flags.length ? flags.join(', ') : 'None'}`);

  const resolvedStatus = String(entry.resolved_status || '').toLowerCase();
  if (entry.resolved_note) {
    meta.push(`Note: ${entry.resolved_note}`);
  }

  const reviewedBy = entry.resolved_by || entry.approved_by_name || entry.approved_by_employee_id;
  const reviewedAt = entry.resolved_at;
  if (reviewedBy || reviewedAt) {
    meta.push(
      `Field reviewed by ${reviewedBy || 'admin'}${reviewedAt ? ` on ${kaFmtDateTimeMDY(reviewedAt)}` : ''}`
    );
  }

  return meta;
}

function kaEntryDetailMeta(entry) {
  const meta = kaEntryDetailMetaList(entry);
  return meta.length
    ? `<div class="ka-detail-row">${meta.join(' • ')}</div>`
    : '';
}

function kaShowTimeFlagBanner(entry) {
  const banner = document.getElementById('ka-time-detail-flag-banner');
  const textEl = document.getElementById('ka-time-detail-flag-text');
  if (!banner || !textEl || !entry) return;
  const meta = kaTimeEntryMeta(entry);
  const issues = kaTimeReviewIssues(entry, { includeFallback: meta.isPending });
  if (!issues.length) {
    banner.classList.add('hidden');
    textEl.innerHTML = '';
    return;
  }
  const rows = issues.map((issue) => {
    const label = escapeHTML(issue.label || 'Flag');
    const help = escapeHTML(issue.help || 'Please review this entry.');
    return `
      <div class="ka-time-flag-banner-row">
        <div class="ka-time-flag-banner-label">${label}</div>
        <div class="ka-time-flag-banner-help">${help}</div>
      </div>
    `;
  });
  textEl.innerHTML = rows.join('');
  banner.classList.remove('hidden');
}

function kaHideTimeFlagBanner() {
  const banner = document.getElementById('ka-time-detail-flag-banner');
  const textEl = document.getElementById('ka-time-detail-flag-text');
  if (!banner) return;
  banner.classList.add('hidden');
  if (textEl) textEl.innerHTML = '';
}

function kaTimeEntryStatusLabel(entry) {
  const meta = kaTimeEntryMeta(entry);
  if (meta.isOpen) return '<span class="ka-tag gray">In progress</span>';
  if (meta.isRejected) return '<span class="ka-tag orange">Voided</span>';
  if (meta.isModified) return '<span class="ka-tag green">Modified</span>';
  if (meta.isApproved && meta.flaggedEver) return '<span class="ka-tag green">Approved</span>';
  if (meta.isApproved && !meta.flaggedEver) return '<span class="ka-tag green">Approved as-is</span>';
  if (meta.isPending && meta.flagged) return '<span class="ka-tag orange">Pending review + flagged</span>';
  if (meta.isPending) return '<span class="ka-tag orange">Pending review</span>';
  return '<span class="ka-tag green">Approved as-is</span>';
}

function kaTimeEntryStatusText(entry) {
  const meta = kaTimeEntryMeta(entry);
  if (meta.isOpen) return 'In progress';
  if (meta.isRejected) return 'Voided';
  if (meta.isModified) return 'Modified';
  if (meta.isApproved && meta.flaggedEver) return 'Approved';
  if (meta.isApproved && !meta.flaggedEver) return 'Approved as-is';
  if (meta.isPending && meta.flagged) return 'Pending review + flagged';
  if (meta.isPending) return 'Pending review';
  return 'Approved as-is';
}

function kaTimeEntryEndLabel(entry) {
  if (!entry) return '—';
  if (entry._open) return 'In progress';
  return entry.end_time ? kaFormatTimeValue12(entry.end_time) : '—';
}

function kaTimeEntryMeta(entry) {
  const isOpen = !!entry._open;
  const resolvedStatus = String(entry.resolved_status || '').toLowerCase();
  const isResolved = !!entry.resolved || (resolvedStatus && resolvedStatus !== 'open');
  const isRejected = resolvedStatus === 'rejected';
  const isModified = resolvedStatus === 'modified';
  const isApproved = resolvedStatus === 'approved' || isModified;
  const punchCount = Number(entry.punch_count || 0);
  const punchHours = Number(entry.punch_hours || 0);
  const entryHours = Number(entry.hours || 0);
  const punchExceptionRaw = entry.punch_exception_unresolved;
  const hasPunchExceptionField = punchExceptionRaw !== undefined && punchExceptionRaw !== null;
  const punchExceptionUnresolved = Number(punchExceptionRaw || 0);
  const punchExceptionResolved = Number(entry.punch_exception_resolved || 0);
  const hasFlags = !!entry.has_geo_violation || !!entry.has_auto_clock_out;
  const entryMismatch = !isOpen &&
    (punchCount === 0 ||
      (Number.isFinite(entryHours) && Math.abs(punchHours - entryHours) >= 0.1));
  const hasPendingNote = !isOpen && resolvedStatus === 'open' && !!entry.resolved_note;
  const flagged = !!entryMismatch ||
    (hasPunchExceptionField ? punchExceptionUnresolved > 0 : hasFlags) ||
    hasPendingNote;
  const flaggedEver = flagged || hasFlags || punchExceptionResolved > 0;
  const isPending = !isOpen && !isResolved;
  return {
    isOpen,
    isResolved,
    isRejected,
    isModified,
    isApproved,
    flagged,
    flaggedEver,
    isPending,
    resolvedStatus
  };
}

function kaTimeReviewIssues(entry, opts = {}) {
  if (!entry) return [];
  const issues = [];
  const includeFallback = opts.includeFallback !== false;
  const addIssue = (label, help) => {
    if (!label) return;
    issues.push({ label, help: help || '' });
  };
  const punchExceptionDetails = () => {
    const details = [];
    if (entry.has_geo_violation) details.push('Geofence flag');
    if (entry.has_auto_clock_out) {
      const reason = kaFormatAutoClockoutReason(entry.auto_clock_out_reason);
      details.push(reason ? `Auto clock-out: ${reason}` : 'Auto clock-out');
    }
    return details;
  };
  const isOpen = !!entry._open;
  const punchCount = Number(entry.punch_count || 0);
  const punchHours = Number(entry.punch_hours || 0);
  const entryHours = Number(entry.hours || 0);
  const punchExceptionRaw = entry.punch_exception_unresolved;
  const punchExceptionUnresolved = Number(punchExceptionRaw || 0);

  if (!isOpen) {
    if (punchCount === 0) {
      addIssue(
        'Missing punches',
        'No punch records were captured for this time entry.'
      );
    } else if (Number.isFinite(entryHours) && Math.abs(punchHours - entryHours) >= 0.1) {
      addIssue(
        `Hours mismatch (${punchHours.toFixed(2)}h vs ${entryHours.toFixed(2)}h)`,
        'Punch hours do not match the entry hours.'
      );
    }
  }

  if (entry.has_geo_violation) {
    addIssue(
      'Geofence flag',
      'A punch or kiosk session was recorded outside the geofence (advisory only).'
    );
  }
  if (entry.has_auto_clock_out) {
    const reason = kaFormatAutoClockoutReason(entry.auto_clock_out_reason);
    const label = reason ? `Auto clock-out: ${reason}` : 'Auto clock-out';
    addIssue(label, kaAutoClockOutHelpText(reason));
  }

  if (!issues.length && includeFallback) {
    addIssue(
      'Needs review',
      'This entry is pending review even though no specific issue was detected.'
    );
  }
  return issues;
}

function kaTimeEntryFlagLabels(entry, opts = {}) {
  const includeFallback = opts.includeFallback === true;
  const issues = kaTimeReviewIssues(entry, { includeFallback });
  return issues.map(issue => issue.label);
}

function kaCloseTimeReviewIssueTips(except = null) {
  document.querySelectorAll('.ka-time-review-issue.is-tip-open').forEach((pill) => {
    if (except && pill === except) return;
    pill.classList.remove('is-tip-open');
  });
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

function kaSetTimeViewMode(mode, { skipLoad = false } = {}) {
  kaTimeViewMode = mode === 'review' ? 'review' : 'view';
  const viewEl = document.getElementById('ka-view-time');
  if (viewEl) {
    viewEl.classList.toggle('ka-time-mode-review', kaTimeViewMode === 'review');
  }
  const reportSheet = document.getElementById('ka-time-report-sheet');
  if (reportSheet) {
    reportSheet.classList.toggle('ka-time-mode-review', kaTimeViewMode === 'review');
  }
  const viewBtn = document.getElementById('ka-time-mode-view');
  const reviewBtn = document.getElementById('ka-time-mode-review');
  const toggleWrap = document.querySelector('.ka-time-mode-toggle');
  if (viewBtn) {
    viewBtn.classList.toggle('is-active', kaTimeViewMode === 'view');
    viewBtn.setAttribute('aria-selected', kaTimeViewMode === 'view' ? 'true' : 'false');
  }
  if (reviewBtn) {
    reviewBtn.classList.toggle('is-active', kaTimeViewMode === 'review');
    reviewBtn.setAttribute('aria-selected', kaTimeViewMode === 'review' ? 'true' : 'false');
  }
  if (toggleWrap) {
    toggleWrap.classList.toggle('is-review', kaTimeViewMode === 'review');
  }

  const includeOpen = document.getElementById('ka-time-include-open');
  if (kaTimeViewMode === 'review') {
    if (includeOpen) {
      kaTimeViewLastIncludeOpen = includeOpen.checked;
      includeOpen.checked = false;
      includeOpen.disabled = true;
    }
  } else {
    if (includeOpen) {
      includeOpen.disabled = false;
      includeOpen.checked = kaTimeViewLastIncludeOpen;
    }
  }

  if (!skipLoad && kaTimeReportHasRun) {
    kaLoadTimeEntries();
  }
}

function kaUpdateTimeSummary(counts = {}) {
  const pendingEl = document.getElementById('ka-time-summary-pending');
  const safe = (val) => (val == null ? '0' : String(val));
  if (pendingEl) pendingEl.textContent = safe(counts.pending);
  const banner = document.getElementById('ka-time-review-banner');
  const bannerCount = document.getElementById('ka-time-review-count');
  const bannerPrefix = document.getElementById('ka-time-review-prefix');
  const bannerSuffix = document.getElementById('ka-time-review-suffix');
  const bannerValue = Number.isFinite(kaTimePendingGlobalCount)
    ? kaTimePendingGlobalCount
    : counts.pending;
  if (bannerCount) bannerCount.textContent = safe(bannerValue);
  if (banner) {
    const show = Number(bannerValue || 0) > 0;
    banner.classList.toggle('is-zero', !show);
    const bannerIcon = banner.querySelector('.ka-review-banner-icon');
    if (bannerIcon) bannerIcon.hidden = !show;
    if (bannerPrefix) {
      bannerPrefix.textContent = '';
      bannerPrefix.hidden = true;
    }
    if (bannerSuffix) {
      bannerSuffix.textContent = 'Pending Review';
      bannerSuffix.hidden = false;
    }
    banner.classList.remove('hidden');
    if (!show && kaTimeViewMode === 'review') {
      kaSetTimeViewMode('view', { skipLoad: true });
    }
  }
}

let kaRateUnlockTarget = null;
let kaTimeViewMode = 'view';
let kaTimeViewLastIncludeOpen = true;

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

function kaGetPunchExceptionIds(entry) {
  if (!entry) return [];
  if (Array.isArray(entry.punch_exception_ids)) {
    return entry.punch_exception_ids
      .map(id => Number(id))
      .filter(id => Number.isFinite(id) && id > 0);
  }
  if (typeof entry.punch_exception_ids === 'string' && entry.punch_exception_ids.trim()) {
    return entry.punch_exception_ids
      .split(',')
      .map(id => Number(id))
      .filter(id => Number.isFinite(id) && id > 0);
  }
  return [];
}

function kaGetOpenPunchId(entry) {
  if (!entry) return null;
  const direct = Number(entry.punch_id);
  if (Number.isFinite(direct) && direct > 0) return direct;
  if (typeof entry.id === 'string' && entry.id.startsWith('open-')) {
    const parsed = Number(entry.id.slice(5));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const fallback = Number(entry.id);
  if (Number.isFinite(fallback) && fallback > 0) return fallback;
  return null;
}

function kaQueuePunchExceptionReviews(ids, action, note) {
  if (!Array.isArray(ids) || !ids.length) return;
  ids.forEach((id) => {
    const clientId = `punch_review_${id}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    kaQueueTimeReview({
      exception_id: id,
      payload: {
        source: 'punch',
        action,
        note,
        actor_name: kaAdminDisplayName(),
        updates: {},
        client_id: clientId
      },
      queued_at: new Date().toISOString(),
      employee_id: kaAdminAuthId() || null,
      device_id: kaDeviceId || null,
      device_secret: kaGetDeviceSecret() || null
    });
  });
}

async function kaReviewPunchExceptionsOnline(ids, action, note) {
  if (!Array.isArray(ids) || !ids.length) return { queued: false };
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const clientId = `punch_review_${id}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const payload = {
      source: 'punch',
      action,
      note,
      actor_name: kaAdminDisplayName(),
      updates: {},
      client_id: clientId
    };
    try {
      await fetchJSON(`/api/time-exceptions/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      if (kaIsConnectionIssue(err) || (err && (err.status === 401 || err.status === 403))) {
        kaQueuePunchExceptionReviews(ids.slice(i), action, note);
        return { queued: true };
      }
      throw err;
    }
  }
  return { queued: false };
}

function kaOpenTimeActionModal(entry, action) {
  if (!entry) return;
  kaTimeActionEntry = entry;
  kaTimeActionMode = action;
  const isOpen = !!entry._open;
  const isSendBack = action === 'send_back';

  const backdrop = document.getElementById('ka-time-action-backdrop');
  const title = document.getElementById('ka-time-action-title');
  const sub = document.getElementById('ka-time-action-sub');
  const origDate = document.getElementById('ka-time-action-orig-date');
  const origHours = document.getElementById('ka-time-action-orig-hours');
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
  const warning = document.getElementById('ka-time-action-warning');
  const changesSection = document.getElementById('ka-time-action-changes-section');
  const submitBtn = document.getElementById('ka-time-action-submit');
  const approveBtn = document.getElementById('ka-time-action-submit-approve');

  if (status) {
    status.textContent = '';
    status.className = 'ka-status';
  }

  const meta = kaTimeEntryMeta(entry);
  const undoReject = action === 'approve' && meta.isRejected;

  if (title) {
    title.textContent =
      action === 'modify'
        ? 'Modify Time Entry'
        : action === 'reject'
          ? 'Reject Time Entry'
          : isSendBack
            ? 'Send Back to Field Review'
            : undoReject
            ? 'Reactivate Time Entry'
            : 'Approve Time Entry';
    if (isOpen && action === 'modify') {
      title.textContent = 'Edit In-Progress Entry';
    }
  }
  const showApprove = action === 'modify' && !isOpen;
  if (submitBtn) {
    submitBtn.textContent = action === 'modify'
      ? (showApprove ? 'Save (Pending)' : 'Save')
      : action === 'reject'
        ? 'Delete entry'
        : isSendBack
          ? 'Send back for review'
          : undoReject
          ? 'Reactivate entry'
          : 'Approve entry';
    submitBtn.classList.toggle('secondary', showApprove);
    submitBtn.classList.toggle('primary', !showApprove);
  }
  if (approveBtn) {
    approveBtn.textContent = 'Save + Approve';
    approveBtn.classList.toggle('hidden', !showApprove);
  }
  const entryDate = entry.start_date || entry.end_date || '';
  const entryDateLabel = entryDate ? kaFmtDateMDY(entryDate) : '';
  if (sub) {
    const subParts = [];
    if (entry.employee_name) subParts.push(entry.employee_name);
    if (entry.project_name) subParts.push(entry.project_name);
    if (entryDateLabel) subParts.push(entryDateLabel);
    sub.textContent = subParts.join(' • ');
  }
  if (origDate) origDate.textContent = entryDateLabel || '—';
  if (origHours) {
    const hoursLabel = entry.hours != null ? Number(entry.hours).toFixed(2) : '—';
    origHours.textContent = hoursLabel;
  }
  if (newDate) newDate.value = entryDate || '';
  if (origProject) origProject.textContent = entry.project_name || '(No project)';
  kaPopulateTimeActionProjects(entry.project_id);
  if (projectSelect) projectSelect.value = '';

  if (origStart) origStart.textContent = entry.start_time ? kaFormatTimeValue12(entry.start_time) : '—';
  if (origEnd) {
    origEnd.textContent = isOpen
      ? 'In progress'
      : (entry.end_time ? kaFormatTimeValue12(entry.end_time) : '—');
  }
  if (newStart) newStart.value = '';
  if (newEnd) newEnd.value = '';
  if (noteInput) noteInput.value = '';
  if (hoursInput) hoursInput.value = '';

  const isModify = action === 'modify';
  if (changesSection) {
    changesSection.classList.toggle('hidden', !isModify);
  }
  [newDate, projectSelect, newStart, hoursInput].forEach(el => {
    if (el) el.disabled = !isModify;
  });
  if (newEnd) newEnd.disabled = !isModify || isOpen;
  if (hoursWrap) {
    hoursWrap.classList.toggle('hidden', !isModify || isOpen);
  }
  kaUpdateTimeActionHours();

  if (warning) {
    if (action === 'reject') {
      warning.textContent =
        'This will delete this time entry. Are you sure you want to delete it? ' +
        'You can still reactivate it if needed.';
      warning.classList.remove('hidden');
    } else if (isSendBack) {
      warning.textContent =
        'This will clear payroll approval and return the entry to field review.';
      warning.classList.remove('hidden');
    } else {
      warning.textContent = '';
      warning.classList.add('hidden');
    }
  }

  if (backdrop) backdrop.classList.remove('hidden');
  kaSyncModalOpenState();
}

function kaParseTimeToMinutes(value) {
  const parts = String(value || '').split(':');
  if (parts.length < 2) return null;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function kaComputeTimeHours(startVal, endVal) {
  const startMin = kaParseTimeToMinutes(startVal);
  const endMin = kaParseTimeToMinutes(endVal);
  if (startMin == null || endMin == null) return null;
  const diff = endMin - startMin;
  if (diff < 0) return null;
  return diff / 60;
}

function kaUpdateTimeActionHours() {
  const entry = kaTimeActionEntry;
  const hoursInput = document.getElementById('ka-time-action-hours');
  if (!hoursInput) return;
  if (!entry) {
    hoursInput.value = '';
    return;
  }
  if (entry._open) {
    const entryHours = Number(entry.hours);
    hoursInput.value = Number.isFinite(entryHours) ? entryHours.toFixed(2) : '';
    return;
  }
  const startInput = document.getElementById('ka-time-action-start');
  const endInput = document.getElementById('ka-time-action-end');
  const startVal = startInput?.value || '';
  const endVal = endInput?.value || '';
  const hasTimeChange = !!startVal || !!endVal;
  if (!hasTimeChange) {
    const entryHours = Number(entry.hours);
    hoursInput.value = Number.isFinite(entryHours) ? entryHours.toFixed(2) : '';
    return;
  }
  const calcStart = startVal || entry.start_time || '';
  const calcEnd = endVal || entry.end_time || '';
  const hours = kaComputeTimeHours(calcStart, calcEnd);
  hoursInput.value = hours != null ? hours.toFixed(2) : '';
}

async function kaHandleTimeActionSubmit({ resolveAfterModify = null } = {}) {
  const entry = kaTimeActionEntry;
  const action = kaTimeActionMode;
  if (!entry || !action) return;
  const isOpen = !!entry._open;
  const isSendBack = action === 'send_back';
  const shouldResolve = action !== 'modify' ? true : resolveAfterModify === true;

  const status = document.getElementById('ka-time-action-status');
  const projectSelect = document.getElementById('ka-time-action-project');
  const newStart = document.getElementById('ka-time-action-start');
  const newEnd = document.getElementById('ka-time-action-end');
  const noteInput = document.getElementById('ka-time-action-note');
  const hoursInput = document.getElementById('ka-time-action-hours');
  const dateInput = document.getElementById('ka-time-action-date');
  const entryDate = entry.start_date || entry.end_date || '';
  const dateVal = dateInput?.value || entryDate || '';
  const baseDate = dateVal || entryDate;

  const note = noteInput ? noteInput.value.trim() : '';
  if (!note) {
    if (status) {
      status.textContent = 'A note is required.';
      status.className = 'ka-status ka-status-error';
    }
    return;
  }

  if (isSendBack) {
    if (isOpen) {
      if (status) {
        status.textContent = 'In-progress entries cannot be sent back.';
        status.className = 'ka-status ka-status-error';
      }
      return;
    }
    if (!navigator.onLine) {
      if (status) {
      status.textContent = 'Send back for review requires an online connection.';
        status.className = 'ka-status ka-status-error';
      }
      return;
    }
    try {
      if (status) {
        status.textContent = 'Sending back...';
        status.className = 'ka-status';
      }
      const payload = { note };
      if (entry.updated_at) payload.if_match_updated_at = entry.updated_at;
      await fetchJSON(`/api/time-entries/${encodeURIComponent(entry.id)}/send-back`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const backdrop = document.getElementById('ka-time-action-backdrop');
      if (backdrop) backdrop.classList.add('hidden');
      kaSyncModalOpenState();
      kaBlurActiveElement();
      kaForceViewportSync();
      kaCloseTimeDetailSheet();
      kaTimeActionEntry = null;
      kaTimeActionMode = null;

      await kaLoadTimeEntries();
      kaRefreshTimePendingCount({ force: true });
    } catch (err) {
      if (status) {
        status.textContent = err.message || 'Failed to send back time entry.';
        status.className = 'ka-status ka-status-error';
      }
    }
    return;
  }

  if (isOpen && action !== 'modify') {
    if (status) {
      status.textContent = 'In-progress entries can only be modified.';
      status.className = 'ka-status ka-status-error';
    }
    return;
  }

  const targetId = isOpen ? kaGetOpenPunchId(entry) : entry.id;
  if (!targetId) {
    if (status) {
      status.textContent = 'Missing punch ID for this in-progress entry.';
      status.className = 'ka-status ka-status-error';
    }
    return;
  }

  const updates = {};
  if (action === 'modify') {
    const startVal = newStart?.value || '';
    const endVal = newEnd?.value || '';
    if (isOpen) {
      if (dateVal && dateVal !== entryDate) {
        updates.start_date = dateVal;
      }
      if (startVal) {
        updates.start_time = startVal;
      }
      if (endVal) {
        if (status) {
          status.textContent = 'Clock-out cannot be set while the entry is in progress.';
          status.className = 'ka-status ka-status-error';
        }
        return;
      }
    } else {
      const hasTimeChange = !!startVal || !!endVal;
      if (dateVal && dateVal !== entryDate) {
        updates.start_date = dateVal;
        updates.end_date = dateVal;
      }
      if (startVal) {
        updates.start_date = baseDate;
        updates.start_time = startVal;
      }
      if (endVal) {
        updates.end_date = baseDate;
        updates.end_time = endVal;
      }
      if (hasTimeChange) {
        const calcStart = startVal || entry.start_time || '';
        const calcEnd = endVal || entry.end_time || '';
        const calcHours = kaComputeTimeHours(calcStart, calcEnd);
        if (calcHours != null) {
          updates.hours = calcHours;
        }
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

  const reviewClientId = `${isOpen ? 'punch' : 'time_review'}_${targetId}_${Date.now().toString(36)}`;
  const punchExceptionIds = kaGetPunchExceptionIds(entry);
  const punchAction = action === 'modify' ? (shouldResolve ? 'approve' : null) : action;
  const shouldReviewPunches = !!punchAction;

  try {
    if (status) {
      status.textContent = 'Saving...';
      status.className = 'ka-status';
    }

    const payload = {
      source: isOpen ? 'punch' : 'time_entry',
      action,
      note,
      actor_name: kaAdminDisplayName(),
      updates,
      client_id: reviewClientId
    };
    if (action === 'modify') {
      payload.resolve = shouldResolve;
    }
    if (entry.updated_at && !isOpen) {
      payload.if_match_updated_at = entry.updated_at;
    }

    if (!navigator.onLine) {
      kaQueueTimeReview({
        exception_id: targetId,
        payload,
        queued_at: new Date().toISOString(),
        employee_id: kaAdminAuthId() || null,
        device_id: kaDeviceId || null,
        device_secret: kaGetDeviceSecret() || null
      });
      if (shouldReviewPunches) {
        kaQueuePunchExceptionReviews(punchExceptionIds, punchAction, note);
      }
    if (status) {
      status.textContent = 'Saved offline — will sync when back online.';
      status.className = 'ka-status ka-status-ok';
    }
    const backdrop = document.getElementById('ka-time-action-backdrop');
    if (backdrop) backdrop.classList.add('hidden');
    kaSyncModalOpenState();
    kaBlurActiveElement();
    kaForceViewportSync();
    kaCloseTimeDetailSheet();
    if (shouldResolve) {
      kaHandleTimeReviewResolved(entry, { queued: true });
    } else {
      kaRefreshTimePendingCount({ force: true });
    }
    kaTimeActionEntry = null;
    kaTimeActionMode = null;
    return;
    }

    await fetchJSON(`/api/time-exceptions/${targetId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

  const punchResult = shouldReviewPunches
    ? await kaReviewPunchExceptionsOnline(punchExceptionIds, punchAction, note)
    : { queued: false };
  const backdrop = document.getElementById('ka-time-action-backdrop');
  if (backdrop) backdrop.classList.add('hidden');
  kaSyncModalOpenState();
  kaBlurActiveElement();
  kaForceViewportSync();
  kaCloseTimeDetailSheet();
  kaTimeActionEntry = null;
  kaTimeActionMode = null;

    await kaLoadTimeEntries();
    if (shouldResolve) {
      kaHandleTimeReviewResolved(entry, { queued: !!(punchResult && punchResult.queued) });
    } else {
      kaRefreshTimePendingCount({ force: true });
    }
    if (punchResult && punchResult.queued && status) {
      status.textContent = 'Saved offline — will sync when back online.';
      status.className = 'ka-status ka-status-ok';
    }
  } catch (err) {
    if (kaIsConnectionIssue(err) || (err && (err.status === 401 || err.status === 403))) {
      kaQueueTimeReview({
        exception_id: targetId,
        payload: {
          source: isOpen ? 'punch' : 'time_entry',
          action,
          note,
          actor_name: kaAdminDisplayName(),
          updates,
          client_id: reviewClientId,
          ...(action === 'modify' ? { resolve: shouldResolve } : {}),
          ...((entry.updated_at && !isOpen) ? { if_match_updated_at: entry.updated_at } : {})
        },
        queued_at: new Date().toISOString(),
        employee_id: kaAdminAuthId() || null,
        device_id: kaDeviceId || null,
        device_secret: kaGetDeviceSecret() || null
      });
      if (shouldReviewPunches) {
        kaQueuePunchExceptionReviews(punchExceptionIds, punchAction, note);
      }
    if (status) {
      status.textContent = 'Saved offline — will sync when back online.';
      status.className = 'ka-status ka-status-ok';
    }
    const backdrop = document.getElementById('ka-time-action-backdrop');
    if (backdrop) backdrop.classList.add('hidden');
    kaSyncModalOpenState();
    kaBlurActiveElement();
    kaForceViewportSync();
    kaCloseTimeDetailSheet();
    if (shouldResolve) {
      kaHandleTimeReviewResolved(entry, { queued: true });
    } else {
      kaRefreshTimePendingCount({ force: true });
    }
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

function kaNormalizeTimeEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  const rawIds = entry.punch_exception_ids;
  if (Array.isArray(rawIds)) {
    entry.punch_exception_ids = rawIds
      .map(id => Number(id))
      .filter(id => Number.isFinite(id));
  } else if (typeof rawIds === 'string' && rawIds.trim()) {
    entry.punch_exception_ids = rawIds
      .split(',')
      .map(id => Number(id))
      .filter(id => Number.isFinite(id));
  } else {
    entry.punch_exception_ids = [];
  }
  entry.punch_exception_unresolved = Number(entry.punch_exception_unresolved || 0);
  entry.punch_exception_resolved = Number(entry.punch_exception_resolved || 0);
  return entry;
}

async function kaFetchTimeEntriesForRange({ start, end, employeeId, projectId, includeOpen }) {
  const params = new URLSearchParams();
  params.set('start', start);
  params.set('end', end);
  if (employeeId) params.set('employee_id', employeeId);
  if (projectId) params.set('project_id', projectId);

  const deviceSecret = kaGetDeviceSecret();
  const useKioskAuth = kaDeviceId && deviceSecret;
  const endpoint = useKioskAuth
    ? `/api/kiosk/time-entries?${params.toString()}`
    : `/api/time-entries?${params.toString()}`;

  const entries = await fetchJSON(endpoint);
  const baseEntries = (entries || []).map(kaNormalizeTimeEntry);

  const combinedMap = new Map();
  baseEntries.forEach(e => {
    const key = e.id ? `srv-${e.id}` : JSON.stringify(e);
    combinedMap.set(key, e);
  });

  const offlinePunches = kaLoadOfflinePunches().filter(p => {
    const d = p.device_timestamp ? p.device_timestamp.slice(0, 10) : '';
    if (!d || d < start || d > end) return false;
    if (employeeId && String(p.employee_id) !== String(employeeId)) return false;
    if (projectId && String(p.project_id) !== String(projectId)) return false;
    return true;
  });
  const offlineEntries = offlinePunches.map(kaOfflinePunchToEntry);
  offlineEntries.forEach(e => {
    const key = e.client_id ? `off-${e.client_id}` : e.id;
    if (!combinedMap.has(key)) combinedMap.set(key, e);
  });

  if (includeOpen && kaKiosk && kaKiosk.id) {
    try {
      const openPunches = await fetchJSON(`/api/kiosks/${kaKiosk.id}/open-punches`);
      const openEntries = (openPunches || []).filter(p => {
        const d = p.clock_in_ts ? kaIsoDateFromTimestampTZ(p.clock_in_ts) : '';
        if (!d || d < start || d > end) return false;
        if (employeeId && String(p.employee_id) !== String(employeeId)) return false;
        if (projectId && String(p.project_id) !== String(projectId)) return false;
        return true;
      }).map(p => {
        const startIso = p.clock_in_ts;
        const startDt = startIso ? kaParseUtcTimestamp(startIso) : null;
        const startDate = startDt ? kaIsoDateFromTimestampTZ(startDt) : '';
        const startTime = startDt ? kaTimeValue24TZ(startDt) : '';
        const hours = startDt ? Math.max(0, (Date.now() - startDt.getTime()) / 3600000) : 0;
        return {
          _open: true,
          id: `open-${p.id}`,
          punch_id: p.id,
          clock_in_ts: startIso || null,
          employee_id: p.employee_id,
          employee_name: p.employee_name || '(Unknown)',
          project_id: p.project_id,
          project_name: p.project_name || '(No project)',
          start_date: startDate,
          end_date: startDate,
          start_time: startTime,
          end_time: '',
          hours,
          total_pay: null,
          paid: false,
          verified: false,
          resolved: false,
          has_geo_violation: false,
          has_auto_clock_out: false,
          punch_exception_unresolved: 0,
          punch_exception_resolved: 0,
          punch_exception_ids: []
        };
      });

      openEntries.forEach(e => {
        const key = e.id ? `open-${e.id}` : JSON.stringify(e);
        if (!combinedMap.has(key)) combinedMap.set(key, e);
      });
    } catch (err) {
      console.warn('Could not load open punches for calendar view', err);
    }
  }

  return Array.from(combinedMap.values());
}

function kaRenderTimeEntryCards(entries, container) {
  if (!container) return;
  const fragment = document.createDocumentFragment();
  (entries || []).forEach(entry => {
    const emp = entry.employee_name || '(Unknown)';
    const proj = entry.project_name || '(No project)';
    const dateLabel = entry.start_date || entry.end_date || '';
    const dateDisplay = dateLabel ? kaFmtDateMDY(dateLabel) : '';
    const startLabel = entry.start_time ? kaFormatTimeValue12(entry.start_time) : '—';
    const endLabel = kaTimeEntryEndLabel(entry);
    const hours = entry.hours != null ? Number(entry.hours).toFixed(2) : '0.00';
    const statusLabel = kaTimeEntryStatusLabel(entry);

    const card = document.createElement('div');
    card.className = 'ka-time-card ka-time-card-compact';
    card.dataset.entryId = entry.id || '';
    card.dataset.kaTimeEntry = '1';
    card._entry = entry;
    card.innerHTML = `
      <div class="ka-time-card-heading">
        <div class="ka-time-card-name-row">
          <div class="ka-time-card-employee">${emp}</div>
          <div class="ka-time-card-status">${statusLabel}</div>
        </div>
        <div class="ka-time-card-project">Project: ${proj}</div>
      </div>
      <div class="ka-time-card-meta">
        <div class="ka-time-card-meta-item">
          <span class="ka-time-card-label">Date</span>
          <span>${dateDisplay || '—'}</span>
        </div>
        <div class="ka-time-card-meta-item">
          <span class="ka-time-card-label">Clock</span>
          <span>${startLabel} - ${endLabel}</span>
        </div>
        <div class="ka-time-card-meta-item ka-time-card-hours">
          <span class="ka-time-card-label">Hours</span>
          <span>${hours}</span>
        </div>
      </div>
    `;
    card.addEventListener('click', () => kaOpenTimeDetailSheet(entry));
    fragment.appendChild(card);
  });
  container.replaceChildren(fragment);
}

async function kaLoadTimeCalendarEntries(dateStr) {
  const els = kaTimeCalendarSheetElements();
  if (!els) return;
  if (els.status) {
    els.status.textContent = 'Loading time entries…';
    els.status.className = 'ka-status';
  }
  if (els.empty) els.empty.classList.add('hidden');
  if (els.cards) els.cards.innerHTML = '';

  if (!kaCanViewTimeReports()) {
    if (els.status) {
      els.status.textContent = 'You do not have access to Time Entries.';
      els.status.className = 'ka-status ka-status-error';
    }
    return;
  }

  try {
    const entries = await kaFetchTimeEntriesForRange({
      start: dateStr,
      end: dateStr,
      employeeId: '',
      projectId: '',
      includeOpen: true
    });
    kaTimeCalendarSheetState.entries = entries || [];
    if (!entries || !entries.length) {
      if (els.empty) els.empty.classList.remove('hidden');
      if (els.status) {
        els.status.textContent = '';
        els.status.className = 'ka-status';
      }
      return;
    }
    if (els.cards) kaRenderTimeEntryCards(entries, els.cards);
    if (els.status) {
      els.status.textContent = '';
      els.status.className = 'ka-status';
    }
  } catch (err) {
    if (els.status) {
      els.status.textContent = err.message || 'Failed to load time entries.';
      els.status.className = 'ka-status ka-status-error';
    }
  }
}

function kaOpenTimeCalendarSheet(dateStr) {
  const els = kaTimeCalendarSheetElements();
  if (!els || !dateStr) return;
  kaTimeCalendarSheetState.open = true;
  kaTimeCalendarSheetState.date = dateStr;
  if (els.title) els.title.textContent = 'Time entries';
  if (els.sub) {
    els.sub.textContent = kaFmtDateLong(dateStr);
  }
  kaTimeCalendarSheetState.entries = [];
  kaLoadTimeCalendarEntries(dateStr);
  els.sheet.classList.remove('hidden');
  requestAnimationFrame(() => {
    els.sheet.classList.add('is-open');
  });
  els.sheet.setAttribute('aria-hidden', 'false');
  kaSyncModalOpenState();
}

function kaCloseTimeCalendarSheet() {
  const els = kaTimeCalendarSheetElements();
  if (!els) return;
  kaTimeCalendarSheetState.dragging = false;
  kaTimeCalendarSheetState.open = false;
  kaTimeCalendarSheetState.date = null;
  els.sheet.classList.remove('is-open');
  els.sheet.setAttribute('aria-hidden', 'true');
  if (els.panel) {
    els.panel.style.transform = '';
  }
  els.sheet.classList.remove('dragging');
  window.setTimeout(() => {
    if (!els.sheet.classList.contains('is-open')) {
      els.sheet.classList.add('hidden');
      kaSyncModalOpenState();
    }
  }, 260);
}

function kaResetTimeCalendarSheetPosition() {
  const els = kaTimeCalendarSheetElements();
  if (!els) return;
  kaTimeCalendarSheetState.dragging = false;
  if (els.panel) {
    els.panel.style.transform = '';
  }
  els.sheet.classList.remove('dragging');
}

async function kaLoadTimeEntries() {
  const tbody = document.getElementById('ka-time-body');
  const cards = document.getElementById('ka-time-cards');
  const report = document.getElementById('ka-time-report');
  const status = document.getElementById('ka-time-status');
  const startInput = document.getElementById('ka-time-start');
  const endInput = document.getElementById('ka-time-end');
  const empFilter = document.getElementById('ka-time-employee');
  const projFilter = document.getElementById('ka-time-project');
  const includeOpenToggle = document.getElementById('ka-time-include-open');
  const showPay = false;
  const showActions = kaCanModifyTime();
  const showApproved = showActions;
  const payEnabled = false;
  const actionsEnabled = showActions && kaShowApprovalsUI && kaTimeViewMode !== 'view';
  const isViewMode = kaTimeViewMode === 'view';
  const colCount = 6 + (actionsEnabled ? 2 : 0);
  const hasContent = tbody && tbody.dataset.hasContent === '1';

  if (!kaTimeReportHasRun) {
    if (report) report.classList.add('hidden');
    return;
  }
  if (report) report.classList.remove('hidden');
  if (kaCurrentView !== 'time') return;

  if (!tbody || !startInput || !endInput) return;

  // Pay columns are rendered inside detail rows; nothing to toggle here.
  const viewTime = document.getElementById('ka-view-time');
  if (viewTime) {
    viewTime.classList.toggle('ka-hide-approvals', !actionsEnabled);
  }
  const reportSheet = document.getElementById('ka-time-report-sheet');
  if (reportSheet) {
    reportSheet.classList.toggle('ka-hide-approvals', !actionsEnabled);
  }

  if (!kaCanViewTimeReports()) {
    tbody.innerHTML =
      `<tr data-ka-placeholder="1"><td colspan="${colCount}" class="ka-muted">(no access to time entries)</td></tr>`;
    if (cards) {
      cards.innerHTML = '<div class="ka-time-card ka-time-card-empty">(no access to time entries)</div>';
    }
    kaUpdateTimeSummary({ total: 0, pending: 0, inProgress: 0, resolved: 0 });
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
  const cacheKey = kaTimeEntriesCacheKey({ start, end, employeeId, projectId });

  if (!hasContent) {
    tbody.innerHTML =
      `<tr data-ka-placeholder="1"><td colspan="${colCount}" class="ka-muted">(loading time entries...)</td></tr>`;
    if (cards) {
      cards.innerHTML = '<div class="ka-time-card ka-time-card-empty">(loading time entries...)</div>';
    }
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

    const baseEntries = (entries || []).map(kaNormalizeTimeEntry);

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
      const d = p.clock_in_ts ? kaIsoDateFromTimestampTZ(p.clock_in_ts) : '';
      if (!d || d < start || d > end) return false;
      if (employeeId && String(p.employee_id) !== String(employeeId)) return false;
      if (projectId && String(p.project_id) !== String(projectId)) return false;
      return true;
    }).map(p => {
      const startIso = p.clock_in_ts;
      const startDt = startIso ? kaParseUtcTimestamp(startIso) : null;
      const startDate = startDt ? kaIsoDateFromTimestampTZ(startDt) : '';
      const startTime = startDt ? kaTimeValue24TZ(startDt) : '';
      const hours = startDt ? Math.max(0, (Date.now() - startDt.getTime()) / 3600000) : 0;
      return {
        _open: true,
        id: `open-${p.id}`,
        punch_id: p.id,
        clock_in_ts: startIso || null,
        employee_id: p.employee_id,
        employee_name: p.employee_name || '(Unknown)',
        project_id: p.project_id,
        project_name: p.project_name || '(No project)',
        start_date: startDate,
        end_date: startDate,
        start_time: startTime,
        end_time: '',
        hours,
        total_pay: null,
        paid: false,
        verified: false,
        resolved: false,
        has_geo_violation: false,
        has_auto_clock_out: false,
        punch_exception_unresolved: 0,
        punch_exception_resolved: 0,
        punch_exception_ids: []
      };
    });

    const combinedMap = new Map();
    baseEntries.forEach(e => {
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
    const includeOpen = includeOpenToggle ? includeOpenToggle.checked : true;
    const statusMode = 'all';
    const filteredCombined = combined.filter(entry => {
      const meta = kaTimeEntryMeta(entry);
      if (meta.isOpen) {
        if (!includeOpen) return false;
        return statusMode === 'all';
      }
      if (statusMode === 'pending') return meta.isPending;
      if (statusMode === 'resolved') return meta.isResolved;
      return true;
    });
    const fragment = document.createDocumentFragment();
    const cardFragment = document.createDocumentFragment();
    const seenKeys = new Set();
    const summaryCounts = { total: filteredCombined.length, pending: 0, inProgress: 0, resolved: 0 };
    const pendingEntries = [];

    if (!filteredCombined.length) {
      const emptyRow = document.createElement('tr');
      emptyRow.dataset.kaPlaceholder = '1';
      emptyRow.innerHTML =
        `<td colspan="${colCount || 8}" class="ka-muted">(no time entries for this date range)</td>`;
      fragment.appendChild(emptyRow);
      tbody.replaceChildren(fragment);
      if (cards) {
        cards.innerHTML = '<div class="ka-time-card ka-time-card-empty">(no time entries for this date range)</div>';
      }
      kaUpdateTimeSummary({ total: 0, pending: 0, inProgress: 0, resolved: 0 });
      kaSetTimeEntriesCache({
        key: cacheKey,
        pendingEntries: [],
        summaryCounts: { total: 0, pending: 0, inProgress: 0, resolved: 0 },
        params: { start, end, employeeId, projectId }
      });
      tbody.dataset.hasContent = '1';
      return;
    }

    filteredCombined.forEach((t, idx) => {
      const isOffline = !!t._offline;
      const isOpen = !!t._open;
      const tr = document.createElement('tr');
      tr.dataset.entryId = t.id;
      tr.dataset.verified = t.verified ? '1' : '0';
      tr.dataset.updatedAt = t.updated_at || '';
      tr.dataset.kaTimeEntry = '1';
      tr._entry = t; // stash full row for actions
      const rowKey = tr.dataset.entryId ? String(tr.dataset.entryId) : `row-${idx}`;
      seenKeys.add(rowKey);

      const emp = t.employee_name || '(Unknown)';
      const proj = t.project_name || '(No project)';
      const dateLabel = t.start_date || t.end_date || '';
      const dateDisplay = dateLabel ? kaFmtDateMDY(dateLabel) : '';
      const startLabel = t.start_time ? kaFormatTimeValue12(t.start_time) : '—';
      const endLabel = kaTimeEntryEndLabel(t);
      const hours = t.hours != null ? Number(t.hours).toFixed(2) : '0.00';
      const detailMeta = !isViewMode ? kaEntryDetailMeta(t) : '';
      const meta = kaTimeEntryMeta(t);
      const flagged = meta.flagged;
      const isResolved = meta.isResolved;
      const isRejected = meta.isRejected;
      const isModified = meta.isModified;
      const isApproved = meta.isApproved;
      if (isOpen) {
        summaryCounts.inProgress += 1;
      } else if (isResolved) {
        summaryCounts.resolved += 1;
      } else {
        summaryCounts.pending += 1;
      }
      if (meta.isPending) pendingEntries.push(t);
      const statusLabel = kaTimeEntryStatusLabel(t);
      const statusSelectValue = (() => {
        if (isRejected) return 'reject';
        if (isModified) return 'modify';
        if (meta.isPending) return 'pending_review';
        return 'approve_as_is';
      })();
      const rejectLabel = isRejected ? 'Voided' : 'Reject';
      const approveLabel = isRejected ? 'Reactivate' : 'Approve as-is';
      const approvedBy = kaReviewerName(
        t.resolved_by || t.approved_by_name || t.approved_by_employee_id
      );
      const statusControl = (() => {
        const canShowDropdown = actionsEnabled && !isOpen;
        if (!canShowDropdown) return statusLabel;
        return `
        <div class="ka-status-actions ka-status-actions-select">
          <select class="ka-time-status-select ka-select-arrow status-${statusSelectValue}" data-ka-time-action-select data-ka-time-status-current="${statusSelectValue}" ${isOffline || isOpen ? 'disabled' : ''}>
            <option value="pending_review" ${statusSelectValue === 'pending_review' ? 'selected' : ''}>Pending review</option>
            <option value="approve_as_is" ${statusSelectValue === 'approve_as_is' ? 'selected' : ''}>${approveLabel}</option>
            <option value="send_back">Send back for review</option>
            <option value="modify" ${statusSelectValue === 'modify' ? 'selected' : ''}>Modify</option>
            <option value="reject" ${statusSelectValue === 'reject' ? 'selected' : ''}>${rejectLabel}</option>
          </select>
        </div>
      `;
      })();

      let rowHtml = `
      <td>${emp}</td>
      <td>${proj}</td>
      <td>${dateDisplay || '—'}</td>
      <td>${startLabel}</td>
      <td>${endLabel}</td>
      <td class="ka-right">${hours}</td>
    `;
      if (!isViewMode) {
        rowHtml += `
      <td class="ka-actions-cell ka-actions-col">${statusControl}</td>
      <td class="ka-approve-col">${approvedBy}</td>
    `;
      }

      tr.innerHTML = rowHtml;
      fragment.appendChild(tr);

      // Detail row (hidden until the main row is clicked)
      const hasDetail = !!detailMeta;
      if (!hasDetail) {
        kaOpenDetailEntries.delete(rowKey);
      }
      if (hasDetail) {
        const detailTr = document.createElement('tr');
        detailTr.className = 'ka-time-detail-row hidden';
        detailTr.innerHTML = `
          <td colspan="${colCount}" class="ka-time-detail">
            <div class="ka-time-detail-grid">
              ${detailMeta}
            </div>
          </td>
        `;
        if (kaOpenDetailEntries.has(rowKey)) {
          detailTr.classList.remove('hidden');
        }
        fragment.appendChild(detailTr);
      }

      if (cards) {
        const card = document.createElement('div');
        card.className = isViewMode ? 'ka-time-card ka-time-card-compact' : 'ka-time-card';
        card.dataset.entryId = t.id;
        card.dataset.entryKey = rowKey;
        card.dataset.kaTimeEntry = '1';
        card._entry = t;
        if (isViewMode) {
          card.innerHTML = `
            <div class="ka-time-card-heading">
              <div class="ka-time-card-name-row">
                <div class="ka-time-card-employee">${emp}</div>
                <div class="ka-time-card-status">${statusLabel}</div>
              </div>
              <div class="ka-time-card-project">Project: ${proj}</div>
            </div>
            <div class="ka-time-card-meta">
              <div class="ka-time-card-meta-item">
                <span class="ka-time-card-label">Date</span>
                <span>${dateDisplay || '—'}</span>
              </div>
              <div class="ka-time-card-meta-item">
                <span class="ka-time-card-label">Clock</span>
                <span>${startLabel} - ${endLabel}</span>
              </div>
              <div class="ka-time-card-meta-item ka-time-card-hours">
                <span class="ka-time-card-label">Hours</span>
                <span>${hours}</span>
              </div>
            </div>
          `;
        } else {
          card.innerHTML = `
            <div class="ka-time-card-top">
              <div class="ka-time-card-heading">
                <div class="ka-time-card-name-row">
                  <div class="ka-time-card-employee">${emp}</div>
                  <div class="ka-time-card-status">${statusControl}</div>
                </div>
                <div class="ka-time-card-project">Project: ${proj}</div>
              </div>
            </div>
            <div class="ka-time-card-meta">
              <div class="ka-time-card-meta-item">
                <span class="ka-time-card-label">Date</span>
                <span>${dateDisplay || '—'}</span>
              </div>
              <div class="ka-time-card-meta-item">
                <span class="ka-time-card-label">Clock</span>
                <span>${startLabel} - ${endLabel}</span>
              </div>
              <div class="ka-time-card-meta-item ka-time-card-hours">
                <span class="ka-time-card-label">Hours</span>
                <span>${hours}</span>
              </div>
            </div>
            <div class="ka-time-card-footer">
              <div class="ka-time-card-review ka-approve-meta">Field reviewed by ${approvedBy}</div>
              ${hasDetail ? '<button class="btn secondary btn-sm" type="button" data-ka-time-detail-toggle>Details</button>' : ''}
            </div>
            ${hasDetail ? `
              <div class="ka-time-card-detail ka-time-detail ${kaOpenDetailEntries.has(rowKey) ? '' : 'hidden'}">
                <div class="ka-time-detail-grid">
                  ${detailMeta}
                </div>
              </div>
            ` : ''}
          `;
        }
        cardFragment.appendChild(card);
      }
    });

    tbody.replaceChildren(fragment);
    tbody.dataset.hasContent = '1';
    if (cards) {
      cards.replaceChildren(cardFragment);
    }
    kaUpdateTimeSummary(summaryCounts);
    kaSetTimeEntriesCache({
      key: cacheKey,
      pendingEntries,
      summaryCounts,
      params: { start, end, employeeId, projectId }
    });

    const bindActions = (root) => {
      if (!root) return;
      root.querySelectorAll('[data-ka-time-action]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const action = btn.getAttribute('data-ka-time-action');
          const row = e.target.closest('[data-ka-time-entry]');
          if (!row || !row._entry) return;
          e.stopPropagation();
          if (row._entry._offline) return; // skip actions for offline pending
          kaOpenTimeActionModal(row._entry, action);
          // Close menu after click
          const menu = btn.closest('.ka-actions-menu');
          if (menu) menu.classList.add('hidden');
        });
      });
      root.querySelectorAll('[data-ka-time-action-select]').forEach(select => {
        select.addEventListener('change', (e) => {
          const action = select.value || '';
          const current = select.getAttribute('data-ka-time-status-current') || '';
          if (!action || action === current) return;
          const row = e.target.closest('[data-ka-time-entry]') || e.target.closest('.ka-time-card');
          if (!row || !row._entry) return;
          if (row._entry._offline) {
            select.value = current || 'pending_review';
            return;
          }
          if (action === 'pending_review') {
            select.value = current || 'pending_review';
            return;
          }
          const actionMap = {
            approve_as_is: 'approve',
            send_back: 'send_back',
            modify: 'modify',
            reject: 'reject'
          };
          const mapped = actionMap[action];
          if (!mapped) {
            select.value = current || 'pending_review';
            return;
          }
          kaOpenTimeActionModal(row._entry, mapped);
          select.value = current || 'pending_review';
        });
        select.addEventListener('focus', () => {
          select.classList.add('is-open');
        });
        select.addEventListener('blur', () => {
          select.classList.remove('is-open');
        });
      });
    };

    bindActions(tbody);
    if (cards) bindActions(cards);
    const rows = Array.from(tbody.querySelectorAll('tr')).filter(r => !r.classList.contains('ka-time-detail-row'));
    if (isViewMode) {
      rows.forEach((row) => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('.ka-actions-toggle') || e.target.closest('.ka-actions-menu')) return;
          if (!row._entry) return;
          kaOpenTimeDetailSheet(row._entry);
        });
      });
    } else {
      // Row click to toggle details
      rows.forEach((row, idx) => {
        const key = row.dataset.entryId ? String(row.dataset.entryId) : `row-${idx}`;
        row.addEventListener('click', (e) => {
          if (e.target.closest('.ka-actions-toggle') || e.target.closest('.ka-actions-menu')) return;
          const detail = row.nextElementSibling;
          if (!detail || !detail.classList.contains('ka-time-detail-row')) return;
          detail.classList.toggle('hidden');
          if (detail.classList.contains('hidden')) {
            kaOpenDetailEntries.delete(key);
          } else {
            kaOpenDetailEntries.add(key);
          }
        });
      });
    }
    if (cards) {
      if (isViewMode) {
        cards.querySelectorAll('.ka-time-card').forEach(card => {
          card.addEventListener('click', () => {
            if (!card._entry) return;
            kaOpenTimeDetailSheet(card._entry);
          });
        });
      } else {
        cards.querySelectorAll('[data-ka-time-detail-toggle]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const card = btn.closest('.ka-time-card');
            const detail = card?.querySelector('.ka-time-card-detail');
            if (!detail) return;
            detail.classList.toggle('hidden');
            const key = card.dataset.entryKey || card.dataset.entryId || '';
            if (detail.classList.contains('hidden')) {
              kaOpenDetailEntries.delete(key);
            } else {
              kaOpenDetailEntries.add(key);
            }
          });
        });
      }
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
      if (cards) {
        cards.innerHTML = '<div class="ka-time-card ka-time-card-empty">(error loading time entries)</div>';
      }
      kaUpdateTimeSummary({ total: 0, pending: 0, inProgress: 0, resolved: 0 });
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
