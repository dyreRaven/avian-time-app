
/* ───────── 1. CORE HELPERS ───────── */

const CSRF_TOKEN_KEY = 'avian_csrf_token_v1';
let csrfToken = null;

function loadCsrfToken() {
  if (csrfToken) return csrfToken;
  try {
    const stored = localStorage.getItem(CSRF_TOKEN_KEY);
    if (stored) csrfToken = stored;
  } catch {
    // ignore storage failures
  }
  return csrfToken;
}

function storeCsrfToken(token) {
  if (!token) return;
  csrfToken = token;
  try {
    localStorage.setItem(CSRF_TOKEN_KEY, token);
  } catch {
    // ignore storage failures
  }
}

function getCsrfHeader() {
  const token = loadCsrfToken();
  if (!token) return {};
  return { 'X-CSRF-Token': token };
}

async function fetchJSON(url, options = {}) {
  const opts = Object.assign({ credentials: 'same-origin' }, options);
  const method = (opts.method || 'GET').toUpperCase();
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const headers = new Headers(opts.headers || {});

  const token = loadCsrfToken();
  if (unsafe && token && !headers.get('X-CSRF-Token')) {
    headers.set('X-CSRF-Token', token);
  }
  opts.headers = headers;

  const res = await fetch(url, opts);
  const nextToken = res.headers.get('X-CSRF-Token');
  if (nextToken) storeCsrfToken(nextToken);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || data.message || 'Request failed';
    throw new Error(msg);
  }
  return data;
}

function formatDateTimeLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

// Safely escape text for insertion into HTML attributes / text nodes
function escapeHTML(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}


function formatDateUS(dateInput) {
  if (!dateInput) return '';

  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return dateInput; // fallback if it's not a real date

  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();

  return `${mm}/${dd}/${yyyy}`;
}

function formatHoursMinutes(hours) {
  const totalMinutes = Math.round((Number(hours) || 0) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;

  if (h > 0 && m > 0) {
    return `${h} hr${h !== 1 ? 's' : ''} ${m} min`;
  }
  if (h > 0) {
    return `${h} hr${h !== 1 ? 's' : ''}`;
  }
  return `${m} min`;
}

function formatMoney(value) {
  const num = Number(value) || 0;
  return '$' + num.toFixed(2);
}

function makeClientId(prefix = 'c') {
  if (crypto && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return (
    `${prefix}_` +
    Date.now().toString(36) +
    '_' +
    Math.random().toString(36).slice(2)
  );
}

const SETTINGS_QUEUE_KEY = 'avian_settings_update_queue_v1';

function loadSettingsQueue() {
  try {
    const raw = localStorage.getItem(SETTINGS_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSettingsQueue(queue) {
  try {
    localStorage.setItem(SETTINGS_QUEUE_KEY, JSON.stringify(queue || []));
  } catch {
    // ignore
  }
}

function replaceSettingsQueueTypes(types, items) {
  const typeSet = new Set(types || []);
  const current = loadSettingsQueue();
  const keep = current.filter(entry => entry && !typeSet.has(entry.type));
  saveSettingsQueue(keep.concat(items || []));
}

function queueSettingsUpdate(type, payload) {
  const next = [{
    client_id: makeClientId('settings'),
    type,
    payload,
    queued_at: new Date().toISOString()
  }];
  replaceSettingsQueueTypes([type], next);
}

function computeHoursFromDateTimes(startDate, startTime, endDate, endTime) {
  if (!startDate || !startTime || !endDate || !endTime) {
    return null;
  }

  // Build ISO-like strings: "YYYY-MM-DDTHH:MM:00"
  const start = new Date(`${startDate}T${startTime}:00`);
  const end   = new Date(`${endDate}T${endTime}:00`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  const diffMs = end - start;
  if (diffMs <= 0) {
    // end must be after start
    return null;
  }

  // Round **up** to the nearest minute (matches kiosk punch logic)
  const minutes = Math.ceil(diffMs / 60000);
  const hours   = minutes / 60;

  return hours;
}
