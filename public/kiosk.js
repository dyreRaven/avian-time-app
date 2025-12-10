// ====== CONSTANTS ======

const QUEUE_KEY = 'avian_kiosk_offline_punches_v1';
const CACHE_EMP_KEY = 'avian_kiosk_employees_v1';
const CACHE_PROJ_KEY = 'avian_kiosk_projects_v1';
const CURRENT_PROJECT_KEY = 'avian_kiosk_current_project_v1';
const DEVICE_ID_KEY = 'avian_kiosk_device_id_v1';
const DEVICE_SECRET_KEY = 'avian_kiosk_device_secret_v1';
const PENDING_PIN_KEY = 'avian_kiosk_pending_pins_v1';

const LANG_COPY = {
  en: {
    greetMorning: 'Good morning!',
    greetAfternoon: 'Good afternoon',
    greetEvening: 'Good evening',
    instructions: 'Please select your name below and tap the button to begin or end your shift.',
    placeholder: 'Select your name',
    employeeLabel: 'Employee',
    tapIn: 'Tap to Clock In',
    tapOut: 'Tap to Clock Out',
    selectYourNameStatus: 'Select your name.',
    projectNotSet: 'Project not set for this tablet. See your supervisor to clock in.',
    timesheetNotSet: 'No timesheet set for this tablet today. See your supervisor to choose a project first.',
    pinTitleExisting: 'Employee PIN',
    pinTitleNew: 'Create Your PIN',
    pinSubtitleExisting: 'Enter your PIN to clock in or out.',
    pinSubtitleNew: 'First time clocking in — create a 4-digit PIN you’ll use on any Avian kiosk.',
    pinStatusNoPin: 'This person does not have a PIN set yet.',
    pinStatusIncorrect: 'Incorrect PIN.',
    pinStatusEnter: 'Enter PIN.',
    pinStatusEnterPin: 'Enter your PIN.',
    pinStatusPinOkPhoto: 'PIN OK. Take required photo.',
    pinStatusCreateBoth: 'Enter and confirm a 4-digit PIN.',
    pinStatusDigitsOnly: 'PIN must be exactly 4 digits.',
    pinStatusMismatch: 'PINs do not match. Please try again.',
    pinStatusSaveErr: 'Could not save PIN. Check connection and try again.',
    pinStatusPinCreatedPhoto: 'PIN created. Take required photo.',
    pinStatusPinCreatedClocked: 'PIN successfully created. You are now clocked in.',
    pinToggleShow: 'Show PIN',
    pinToggleHide: 'Hide PIN'
  },
  es: {
    greetMorning: 'Buenos días',
    greetAfternoon: 'Buenas tardes',
    greetEvening: 'Buenas noches',
    instructions: 'Seleccione su nombre abajo y toque el botón para comenzar o terminar su turno.',
    placeholder: 'Seleccione su nombre',
    employeeLabel: 'Empleado',
    tapIn: 'Registrar entrada',
    tapOut: 'Registrar salida',
    selectYourNameStatus: 'Seleccione su nombre.',
    projectNotSet: 'Proyecto no está configurado para esta tableta. Consulte a su supervisor para registrar entrada.',
    timesheetNotSet: 'No hay parte de trabajo para esta tableta hoy. Pida a su supervisor que elija un proyecto primero.',
    pinTitleExisting: 'PIN del empleado',
    pinTitleNew: 'Crear tu PIN',
    pinSubtitleExisting: 'Ingresa tu PIN para marcar entrada o salida.',
    pinSubtitleNew: 'Primer fichaje: crea un PIN de 4 dígitos que usarás en cualquier kiosko Avian.',
    pinStatusNoPin: 'Esta persona no tiene un PIN configurado.',
    pinStatusIncorrect: 'PIN incorrecto.',
    pinStatusEnter: 'Ingresa el PIN.',
    pinStatusEnterPin: 'Ingresa tu PIN.',
    pinStatusPinOkPhoto: 'PIN OK. Toma la foto requerida.',
    pinStatusCreateBoth: 'Ingresa y confirma un PIN de 4 dígitos.',
    pinStatusDigitsOnly: 'El PIN debe tener exactamente 4 dígitos.',
    pinStatusMismatch: 'Los PIN no coinciden. Inténtalo de nuevo.',
    pinStatusSaveErr: 'No se pudo guardar el PIN. Verifica la conexión e inténtalo otra vez.',
    pinStatusPinCreatedPhoto: 'PIN creado. Toma la foto requerida.',
    pinStatusPinCreatedClocked: 'PIN creado correctamente. Ya estás registrado.',
    pinToggleShow: 'Mostrar PIN',
    pinToggleHide: 'Ocultar PIN'
  },
  ht: {
    greetMorning: 'Bonjou',
    greetAfternoon: 'Bon apremidi',
    greetEvening: 'Bonswa',
    instructions: 'Ekri non ou anba epi peze bouton an lew komanse ak lew fini travay',
    placeholder: 'Chwazi non ou',
    employeeLabel: 'Anplwaye',
    tapIn: 'Komanse travay',
    tapOut: 'Fini travay',
    selectYourNameStatus: 'Tanpri chwazi non ou.',
    projectNotSet: 'Pa gen pwojè sa sou tablet sa; fòk ou wè ak sipèvizè ou pou anrejistre lè ou antre.',
    timesheetNotSet: 'Pa gen fèy travay pou jodi a sou tablet sa. Wè sipèvizè a pou chwazi yon pwojè anvan.',
    pinTitleExisting: 'PIN anplwaye',
    pinTitleNew: 'Kreye PIN ou',
    pinSubtitleExisting: 'Antre PIN ou pou antre oswa soti.',
    pinSubtitleNew: 'Premye fwa w ap anrejistre — kreye yon PIN 4 chif pou nenpòt kios Avian.',
    pinStatusNoPin: 'Moun sa pa gen PIN ankò.',
    pinStatusIncorrect: 'PIN la pa kòrèk.',
    pinStatusEnter: 'Antre PIN la.',
    pinStatusEnterPin: 'Antre PIN ou.',
    pinStatusPinOkPhoto: 'PIN bon. Pran foto obligatwa a.',
    pinStatusCreateBoth: 'Antre epi konfime yon PIN 4 chif.',
    pinStatusDigitsOnly: 'PIN la dwe gen egzakteman 4 chif.',
    pinStatusMismatch: 'PIN yo pa menm. Eseye ankò.',
    pinStatusSaveErr: 'Pa t ka sove PIN lan. Tcheke koneksyon an epi eseye ankò.',
    pinStatusPinCreatedPhoto: 'PIN kreye. Pran foto obligatwa a.',
    pinStatusPinCreatedClocked: 'PIN kreye avèk siksè. Ou deja anrejistre.',
    pinToggleShow: 'Montre PIN',
    pinToggleHide: 'Kache PIN'
  }
};
const DEFAULT_LANGUAGE = 'en';


let employeesCache = [];
let projectsCache = [];
let currentProjectName = '';
let currentEmployee = null;
let currentLanguage = DEFAULT_LANGUAGE;
let manualLanguageOverride = null;
let manualLanguageEmployeeId = null;
let pinValidated = false;
let currentPhotoBase64 = null;
let cameraStream = null;
let pinSetupMode = false;
let pinFirstEntry = '';
let kioskDeviceId = null;
let kioskConfig = {
  id: null,
  name: '',
  project_id: null,
  require_photo: 0
};
let kioskSessions = [];
let activeSessionId = null;
let justCreatedPin = false;
let offlineSyncTimerId = null;
let offlineSyncInFlight = false;

// ====== BASIC HELPERS ======

let successTimeout = null;

function disableAutofillPinInput(el) {
  if (!el) return;
  el.setAttribute('autocomplete', 'one-time-code');
  el.setAttribute('autofill', 'off');
  el.setAttribute('inputmode', 'numeric');
  el.setAttribute('pattern', '[0-9]*');
  el.setAttribute('data-lpignore', 'true');
  el.setAttribute('data-1p-ignore', 'true');
  el.setAttribute('data-form-type', 'other');
  // Randomize name so password managers avoid saving it
  el.name = `pin-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function hardenPinFields() {
  ['pin-input', 'pin-confirm-input', 'admin-login-pin'].forEach(id => {
    disableAutofillPinInput(document.getElementById(id));
  });
}

function showSuccessOverlay(message, durationMs = 5000) {  // ⬅️ 5 seconds default
  const backdrop = document.getElementById('success-backdrop');
  const msgEl = document.getElementById('success-message');
  const closeBtn = document.getElementById('success-close-btn');

  if (!backdrop || !msgEl) return;

  msgEl.textContent = message;

  // Show overlay
  backdrop.classList.remove('hidden');

  // Clear old timer
  if (successTimeout) {
    clearTimeout(successTimeout);
    successTimeout = null;
  }

  // Auto-close after durationMs
  successTimeout = setTimeout(() => {
    backdrop.classList.add('hidden');
    successTimeout = null;
  }, durationMs);

  // Manual close button
  if (closeBtn) {
    closeBtn.onclick = () => {
      backdrop.classList.add('hidden');
      if (successTimeout) {
        clearTimeout(successTimeout);
        successTimeout = null;
      }
    };
  }
}

// Replace native dialogs with our in-app overlay to avoid browser chrome like "IP address says"
function overrideNativeDialogs() {
  window.alert = function kioskAlert(message) {
    showSuccessOverlay(String(message || ''));
  };
  window.confirm = function kioskConfirm(message) {
    showSuccessOverlay(String(message || ''));
    return false;
  };
  window.prompt = function kioskPrompt(message) {
    showSuccessOverlay(String(message || ''));
    return null;
  };
}
overrideNativeDialogs();




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

function makeClientId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : 'p_' +
      Date.now().toString(36) +
      '_' +
      Math.random().toString(36).slice(2);
}

const CLOCK_IN_MESSAGES_BY_LANG = {
  en: [
    'You are now clocked in — thanks for your hard work!',
    'You are now clocked in — have a good day!'
  ],
  es: [
    'Ya estás registrado — gracias por tu gran trabajo.',
    'Ya estás registrado — que tengas un buen día.'
  ],
  ht: [
    'Ou anrejistre kounye a — mèsi pou bon travay ou.',
    'Ou anrejistre kounye a — pase yon bon jounen.'
  ]
};

const GREET_EN = 'Select your name';
const GREET_ES = 'Seleccione su nombre';
const GREET_HT = 'Chwazi non ou';

function getRandomClockInMessage() {
  const messages =
    CLOCK_IN_MESSAGES_BY_LANG[currentLanguage] ||
    CLOCK_IN_MESSAGES_BY_LANG.en ||
    [];

  if (!Array.isArray(messages) || !messages.length) {
    return 'You are now clocked in — thanks for your hard work!';
  }

  const idx = Math.floor(Math.random() * messages.length);
  return messages[idx];
}

function loadPendingPins() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_PIN_KEY) || '[]');
  } catch {
    return [];
  }
}

function savePendingPins(list) {
  localStorage.setItem(PENDING_PIN_KEY, JSON.stringify(list || []));
}

function addPendingPinUpdate(update) {
  // update = { employee_id, pin }
  const list = loadPendingPins();
  list.push({
    employee_id: update.employee_id,
    pin: update.pin,
    created_at: new Date().toISOString(),
    device_id: kioskDeviceId || getOrCreateDeviceId(),
    device_secret: getOrCreateDeviceSecret()
  });
  savePendingPins(list);
}



function loadQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveQueue(q) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}
function addToQueue(punch) {
  const q = loadQueue();
  q.push(punch);
  saveQueue(q);
}
function removeFromQueue(id) {
  saveQueue(loadQueue().filter(p => p.client_id !== id));
}

function isConnectionIssue(err, message) {
  const status = err && (err.status || err.code);
  const msg = String(message || (err && err.message) || '').toLowerCase();
  const networkish = /network|failed to fetch|offline|connection|timed out/.test(msg);
  const serverDown = typeof status === 'number' && status >= 500;
  return !navigator.onLine || networkish || serverDown;
}

function saveCache(key, v) {
  localStorage.setItem(key, JSON.stringify(v));
}
function loadCache(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function getPosition() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

function getOrCreateDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = 'dev-' + makeClientId();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function getDeviceSecret() {
  try {
    return localStorage.getItem(DEVICE_SECRET_KEY) || null;
  } catch {
    return null;
  }
}

function setDeviceSecret(secret) {
  if (!secret) return;
  try {
    localStorage.setItem(DEVICE_SECRET_KEY, secret);
  } catch {
    // ignore storage failures
  }
}

function getOrCreateDeviceSecret() {
  let secret = getDeviceSecret();
  if (!secret) {
    secret =
      'sec-' +
      Math.random().toString(36).slice(2) +
      Math.random().toString(36).slice(2);
    setDeviceSecret(secret);
  }
  return secret;
}

function showDeviceIdInUI() {
  const el = document.getElementById('kiosk-device-id');
  if (el && kioskDeviceId) {
    el.textContent = kioskDeviceId;
  }
}

function getCopy(key) {
  if (LANG_COPY[currentLanguage] && LANG_COPY[currentLanguage][key]) {
    return LANG_COPY[currentLanguage][key];
  }
  return (LANG_COPY.en && LANG_COPY.en[key]) || key;
}

function normalizeLanguage(lang) {
  if (!lang) return 'en';
  const normalized = String(lang).toLowerCase();
  return LANG_COPY[normalized] ? normalized : 'en';
}

function getGreetingForTime() {
  const now = new Date();
  const hour = now.getHours();
  const key =
    hour < 12
      ? 'greetMorning'
      : hour < 17
      ? 'greetAfternoon'
      : 'greetEvening';
  return getCopy(key);
}

function getProjectNameById(id) {
  if (!id) return '';
  const match = projectsCache.find(p => Number(p.id) === Number(id));
  return match ? match.name || '' : '';
}

function sortSessionsByRecency(list) {
  return (Array.isArray(list) ? [...list] : []).sort((a, b) => {
    const dateDiff = (b.date || '').localeCompare(a.date || '');
    if (dateDiff !== 0) return dateDiff;
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
}

function computeActiveSession(sessions, sessionId, kioskProjectId) {
  const sorted = sortSessionsByRecency(sessions);
  if (!sorted.length) return null;

  const normalizedSessionId =
    sessionId !== null && sessionId !== undefined ? Number(sessionId) : null;
  const normalizedProjectId =
    kioskProjectId !== null && kioskProjectId !== undefined ? Number(kioskProjectId) : null;
  const validSessionId = Number.isFinite(normalizedSessionId) ? normalizedSessionId : null;
  const validProjectId = Number.isFinite(normalizedProjectId) ? normalizedProjectId : null;

  if (validSessionId !== null) {
    const matchById = sorted.find(s => Number(s.id) === validSessionId);
    if (matchById && (validProjectId === null || Number(matchById.project_id) === validProjectId)) {
      return matchById;
    }
  }

  if (validProjectId !== null) {
    const matchByProject = sorted.find(s => Number(s.project_id) === validProjectId);
    if (matchByProject) return matchByProject;
  }

  return sorted[0] || null;
}

function getActiveSession() {
  return computeActiveSession(kioskSessions, activeSessionId, kioskConfig && kioskConfig.project_id);
}

function getActiveProjectLabel() {
  const active = getActiveSession();
  if (active && active.project_id) {
    const fromSession =
      getProjectNameById(active.project_id) ||
      active.project_name ||
      '';
    if (fromSession) return fromSession;
    return `Project ${active.project_id}`;
  }

  const projectId = kioskConfig && kioskConfig.project_id;
  if (projectId) {
    const fromCache = getProjectNameById(projectId);
    if (fromCache) return fromCache;
    if (kioskConfig && kioskConfig.project_name) return kioskConfig.project_name;
    return `Project ${projectId}`;
  }

  // Fallback to the id as a label
  return '';
}

function setCurrentProject(projectId) {
  kioskConfig.project_id = projectId || null;
  currentProjectName = projectId ? (getActiveProjectLabel() || getProjectNameById(projectId) || '') : '';

  if (projectId) {
    localStorage.setItem(CURRENT_PROJECT_KEY, String(projectId));
  } else {
    localStorage.removeItem(CURRENT_PROJECT_KEY);
  }

  updateProjectChip();
}

function updateProjectChip() {
  const projectNameEl = document.getElementById('kiosk-project-name');

  const active = getActiveSession();
  const hasProject = !!(active && active.project_id);
  const label = hasProject
    ? currentProjectName || getActiveProjectLabel() || 'Project'
    : 'None';

  if (projectNameEl) projectNameEl.textContent = label;
}

function applyGreeting() {
  const primary = getGreetingForTime();
  const subline = getCopy('instructions');

  const hero = document.getElementById('kiosk-greeting');
  if (hero) hero.textContent = subline;

  const inlineGreeting = document.getElementById('kiosk-inline-greeting');
  if (inlineGreeting) inlineGreeting.textContent = primary;
}

function hideStep2Sub() {
  const sub = document.getElementById('kiosk-step-2-sub');
  if (sub) {
    sub.textContent = '';
    sub.style.display = 'none';
  }
}

function setDefaultPunchButton(button) {
  if (!button) return;
  button.classList.remove('kiosk-btn-danger');
  button.classList.add('btn-primary');
  button.textContent = getCopy('tapIn');
}

function setLanguage(lang) {
  const nextLang = normalizeLanguage(lang);
  currentLanguage = nextLang;
  applyGreeting();
  const placeholder = getCopy('placeholder');
  const empLabel = document.getElementById('kiosk-employee-label');
  if (empLabel) empLabel.textContent = getCopy('employeeLabel');
  const empPlaceholder = document.getElementById('kiosk-employee-placeholder');
  if (empPlaceholder) empPlaceholder.textContent = placeholder;
  const empSelect = document.getElementById('kiosk-employee');
  if (empSelect && empSelect.options.length) {
    empSelect.options[0].textContent = placeholder;
  }
  const empSelectVal = empSelect ? empSelect.value : '';
  setDefaultPunchButton(document.getElementById('kiosk-punch'));
  if (empSelectVal) {
    updatePunchButtonForEmployee(empSelectVal);
  }

  document.querySelectorAll('.lang-btn').forEach(btn => {
    const btnLang = btn.getAttribute('data-lang');
    if (btnLang === nextLang) btn.classList.add('active');
    else btn.classList.remove('active');
  });
}

function resetLanguageOverride() {
  manualLanguageOverride = null;
  manualLanguageEmployeeId = null;
  setLanguage(DEFAULT_LANGUAGE);
}

function applyKioskProjectDefault() {
  let projectId = null;

  const active = getActiveSession();
  if (active && active.project_id) {
    activeSessionId = active.id || activeSessionId;
    projectId = active.project_id;
    kioskConfig.project_id = projectId;
  } else if (kioskConfig && kioskConfig.project_id) {
    projectId = kioskConfig.project_id;
  } else {
    const saved = localStorage.getItem(CURRENT_PROJECT_KEY);
    if (saved) projectId = Number(saved);
  }

  setCurrentProject(projectId);
}


async function initKioskConfig() {
  kioskDeviceId = getOrCreateDeviceId();
  showDeviceIdInUI();

  try {
    const data = await fetchJSON('/api/kiosks/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: kioskDeviceId,
        device_secret: getOrCreateDeviceSecret()
      })
    });

    if (data && data.kiosk) {
      kioskConfig = data.kiosk;
      kioskSessions = data.sessions || [];
      activeSessionId = data.active_session_id || null;
      if (data.kiosk.device_secret) {
        setDeviceSecret(data.kiosk.device_secret);
      }
      applyKioskProjectDefault();
    }
  } catch (err) {
    console.error('Error registering kiosk device:', err);
  }
}

async function refreshKioskProjectFromServer() {
  try {
    const data = await fetchJSON('/api/kiosks/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: kioskDeviceId || getOrCreateDeviceId(),
        device_secret: getOrCreateDeviceSecret()
      })
    });

    if (data && data.kiosk) {
      kioskConfig = data.kiosk;
      kioskSessions = data.sessions || kioskSessions;
      activeSessionId = data.active_session_id || activeSessionId;
      if (data.kiosk.device_secret) {
        setDeviceSecret(data.kiosk.device_secret);
      }
      applyKioskProjectDefault();
    }
  } catch (err) {
    console.warn('Unable to refresh kiosk project', err);
  }
}


function getKioskDayKey() {
  const dev = kioskDeviceId || getOrCreateDeviceId();
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `avian_kiosk_day_started_${dev}_${y}-${m}-${d}`;
}

function isKioskDayStarted() {
  try {
    return localStorage.getItem(getKioskDayKey()) === '1';
  } catch {
    return false;
  }
}

function markKioskDayStarted() {
  try {
    localStorage.setItem(getKioskDayKey(), '1');
  } catch {
    // ignore storage failures
  }
}

function openAdminDashboard(employeeId, options = {}) {
  const { skipPin = false } = options || {};
  try {
    const params = new URLSearchParams();
    const deviceId = kioskDeviceId || getOrCreateDeviceId();

    params.set('device_id', deviceId);
    params.set('employee_id', employeeId);

    // Open in start-of-day mode if day not started OR no project set yet
    if (!isKioskDayStarted() || !(kioskConfig && kioskConfig.project_id)) {
      params.set('start', '1');
    }

    if (skipPin) {
      params.set('skip_pin', '1');
    }

    const adminUrl = '/kiosk-admin.html?' + params.toString();
    window.location.href = adminUrl;
  } catch (err) {
    console.error('Error opening kiosk admin dashboard', err);
  }
}

// ====== LOAD EMPLOYEES & PROJECTS ======

async function loadEmployeesAndProjects() {
  const empSel = document.getElementById('kiosk-employee');
  const status = document.getElementById('kiosk-status');

  status.textContent = 'Loading…';

  try {
    const [emps, projs] = await Promise.all([
      fetchJSON('/api/kiosk/employees'),
      fetchJSON('/api/projects')
    ]);

    // normalize ids
    employeesCache = (emps || []).map(e => ({
      ...e,
      id: Number(e.id)
    }));
    // Only keep active project jobs (exclude top-level customers)
    projectsCache = (projs || []).filter(p => p.customer_name);

    fillEmployeeSelect(empSel, employeesCache);

    saveCache(CACHE_EMP_KEY, employeesCache);
    saveCache(CACHE_PROJ_KEY, projectsCache);

    updateProjectChip();
    status.textContent = '';
  } catch {
    const emps = loadCache(CACHE_EMP_KEY) || [];
    const projs = loadCache(CACHE_PROJ_KEY) || [];

    employeesCache = emps;
    projectsCache = projs;

    fillEmployeeSelect(empSel, emps);
    updateProjectChip();

    if (emps.length || projs.length) {
      status.textContent = 'Offline lists loaded.';
    } else {
      status.textContent = 'Error: No data cached.';
    }
  }
}

function fillEmployeeSelect(sel, list) {
  sel.innerHTML = `<option value="">${getCopy('placeholder')}</option>`;

  const rows = (list || []).filter(e => {
    // 🔹 Always show admins, even if uses_timekeeping is off
    if (e.is_admin) {
      return true;
    }

    // For normal workers, keep the "Uses timekeeping" logic
    if (e.uses_timekeeping === undefined || e.uses_timekeeping === null) {
      return true;
    }
    return !!e.uses_timekeeping;
  });

  for (const e of rows) {
    const opt = document.createElement('option');
    opt.value = e.id;
    opt.textContent = e.nickname || e.name;
    sel.appendChild(opt);
  }
}


// ====== ADMIN LOGIN (HIDDEN MODE) ======

let adminLongPressTimer = null;

function showAdminLoginModal() {
  const backdrop = document.getElementById('admin-login-backdrop');
  const empSelect = document.getElementById('admin-login-employee');
  const pinInput = document.getElementById('admin-login-pin');
  const status = document.getElementById('admin-login-status');

  if (!backdrop || !empSelect || !pinInput || !status) return;

  const admins = (employeesCache || []).filter(e => e.is_admin);

  empSelect.innerHTML = '<option value="">Select admin</option>';

  admins.forEach(e => {
    const opt = document.createElement('option');
    opt.value = e.id;
    opt.textContent = e.nickname || e.name;
    empSelect.appendChild(opt);
  });

  if (!admins.length) {
    status.textContent = 'No admin users configured yet in the Admin Console.';
  } else {
    status.textContent = '';
  }

  pinInput.value = '';
  backdrop.classList.remove('hidden');

  setTimeout(() => {
    pinInput.focus();
  }, 100);
}

function hideAdminLoginModal() {
  const backdrop = document.getElementById('admin-login-backdrop');
  const status = document.getElementById('admin-login-status');
  if (backdrop) backdrop.classList.add('hidden');
  if (status) status.textContent = '';
}

function submitAdminLogin() {
  const empSelect = document.getElementById('admin-login-employee');
  const pinInput = document.getElementById('admin-login-pin');
  const status = document.getElementById('admin-login-status');

  if (!empSelect || !pinInput || !status) return;

  const id = empSelect.value;
  const entered = (pinInput.value || '').trim();

  if (!id) {
    status.textContent = getCopy('selectYourNameStatus');
    return;
  }
  if (!entered) {
    status.textContent = getCopy('pinStatusEnter');
    return;
  }

  const emp = (employeesCache || []).find(e => String(e.id) === String(id));
  if (!emp) {
    status.textContent = 'Employee not found.';
    return;
  }

  const storedPin = (emp.pin || '').trim();
  if (!storedPin) {
    status.textContent = getCopy('pinStatusNoPin');
    return;
  }

  if (storedPin !== entered) {
    status.textContent = getCopy('pinStatusIncorrect');
    return;
  }

  // ✅ Success – close login and go to kiosk admin dashboard in the SAME tab
  status.textContent = '';
  hideAdminLoginModal();

  openAdminDashboard(id, { skipPin: true });
}



function setupAdminLongPress() {
  const logoContainer =
    document.getElementById('kiosk-logo-wrapper') ||
    document.querySelector('.glass-logo') ||
    document.querySelector('.kiosk-logo');
  const hotspot =
    document.getElementById('kiosk-logo-hotspot') ||
    (logoContainer ? logoContainer.querySelector('.logo-hotspot') : null);

  const target = hotspot || logoContainer;
  if (!target) return;

  target.style.webkitTouchCallout = 'none';
  target.style.webkitUserSelect = 'none';
  target.style.userSelect = 'none';
  target.style.touchAction = 'none';

  const start = (event) => {
    // 🚫 Stop default press/hold behavior (copy/save image popup)
    if (event) {
      event.preventDefault();
    }

    if (adminLongPressTimer) return;
    adminLongPressTimer = setTimeout(() => {
      adminLongPressTimer = null;
      showAdminLoginModal();
    }, 1500); // 1.5s hold
  };

  const cancel = () => {
    if (adminLongPressTimer) {
      clearTimeout(adminLongPressTimer);
      adminLongPressTimer = null;
    }
  };

  // Normal press events
  ['mousedown', 'pointerdown'].forEach(evt =>
    target.addEventListener(evt, start)
  );
  target.addEventListener('touchstart', start, { passive: false, capture: true });

  ['mouseup', 'mouseleave', 'pointerup', 'pointerleave'].forEach(evt =>
    target.addEventListener(evt, cancel)
  );
  target.addEventListener('touchend', cancel, { capture: true });
  target.addEventListener('touchcancel', cancel, { capture: true });

  // 🚫 Block the context menu / long-press menu entirely
  ['contextmenu', 'gesturestart'].forEach(evt => {
    target.addEventListener(evt, (e) => {
      e.preventDefault();
    }, { capture: true });
  });

  // Extra guard: if touch holds more than 100ms, stop propagation to avoid image menu
  target.addEventListener('touchstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
  }, { passive: false, capture: true });
}


/* ====== ADD WORKER MODAL (DISABLED) ====== */

function showAddWorkerModal() {
  alert(
    'Adding workers at the kiosk is disabled. Please add new workers in QuickBooks.'
  );
}

function submitAddWorker() {
  alert(
    'Adding workers at the kiosk is disabled. Please add new workers in QuickBooks.'
  );
}

function hideAddWorkerModal() {
  const backdrop = document.getElementById('add-worker-backdrop');
  const status = document.getElementById('add-worker-status');

  if (backdrop) backdrop.classList.add('hidden');
  if (status) status.textContent = '';
}

// ====== PIN MODAL ======

function showPinModal(employee) {
  currentEmployee = employee;
  pinValidated = false;
  currentPhotoBase64 = null;
  pinSetupMode = false;
  pinFirstEntry = '';

  const nameEl = document.getElementById('pin-employee-name');
  const pinInput = document.getElementById('pin-input');
  const pinConfirmInput = document.getElementById('pin-confirm-input');
  const status = document.getElementById('pin-modal-status');
  const camSec = document.getElementById('camera-section');
  const titleEl = document.getElementById('pin-modal-title');
  const modeLabelEl = document.getElementById('pin-mode-label');
  const toggleBtn = document.getElementById('pin-toggle-visibility');

  const storedPin = (employee.pin || '').trim();
  const hasPin = !!storedPin;

  // Block PIN modal for non-admins if no project/timesheet is active.
  // Admins can still proceed so they can be routed to kiosk-admin to create one.
  const hasProject = !!(kioskConfig && kioskConfig.project_id);
  const activeSession = getActiveSession();
  const hasSession = !!(activeSession && activeSession.project_id);
  if (!employee.is_admin && (!hasProject || !hasSession)) {
    const kioskStatus = document.getElementById('kiosk-status');
    if (kioskStatus) {
      kioskStatus.textContent = getCopy('timesheetNotSet');
      kioskStatus.className = 'glass-status kiosk-status kiosk-status-error';
    }
    return;
  }

  if (nameEl) {
    const baseName = employee.nickname || employee.name;

    const projectLabel =
      kioskConfig && kioskConfig.project_id
        ? currentProjectName || getProjectNameById(kioskConfig.project_id) || ''
        : '';

    // Show “Name – Project: XYZ” if we know the project,
    // otherwise just the name
    nameEl.textContent = projectLabel
      ? `${baseName} – Project: ${projectLabel}`
      : baseName;
  }

  // Title + explanatory label
  if (titleEl) {
    titleEl.textContent = hasPin ? getCopy('pinTitleExisting') : getCopy('pinTitleNew');
  }

if (modeLabelEl) {
  modeLabelEl.textContent = hasPin
    ? getCopy('pinSubtitleExisting')
    : getCopy('pinSubtitleNew');
}


  // Reset fields
  if (pinInput) {
    pinInput.value = '';
    pinInput.type = 'password';
  }
  if (pinConfirmInput) {
    pinConfirmInput.value = '';
    pinConfirmInput.type = 'password';
    // Only show confirm field when they are creating a new PIN
    pinConfirmInput.classList.toggle('hidden', hasPin);
  }

  if (toggleBtn) {
    toggleBtn.textContent = getCopy('pinToggleShow');
  }

  if (status) {
    status.textContent = '';
    status.style.color = '#bbf7d0';
  }

  camSec.classList.add('hidden');
  stopCamera();

  const mustPhoto =
    !!employee.require_photo || !!(kioskConfig && kioskConfig.require_photo);

  if (mustPhoto) camSec.classList.remove('hidden');

  document.getElementById('pin-backdrop').classList.remove('hidden');
  if (pinInput) pinInput.focus();
}


function hidePinModal() {
  document.getElementById('pin-backdrop').classList.add('hidden');
  stopCamera();
  currentEmployee = null;
}

function setPinError(msg) {
  const el = document.getElementById('pin-modal-status');
  el.textContent = msg;
  el.style.color = '#fecaca';
}

function setPinOk(msg) {
  const el = document.getElementById('pin-modal-status');
  el.textContent = msg;
  el.style.color = '#bbf7d0';
}

// ====== CAMERA ======

async function startCamera() {
  try {
    stopCamera();
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });

    document.getElementById('cam-video').srcObject = cameraStream;
    document.getElementById('cam-video').classList.remove('hidden');
    document.getElementById('start-camera').classList.add('hidden');
    document.getElementById('take-photo').classList.remove('hidden');

    setPinOk('Camera ready.');
  } catch {
    setPinError('Camera unavailable.');
  }
}

function stopCamera() {
  if (cameraStream) {
    for (const t of cameraStream.getTracks()) t.stop();
    cameraStream = null;
  }
}

function takePhoto() {
  const video = document.getElementById('cam-video');
  const canvas = document.getElementById('cam-canvas');
  const preview = document.getElementById('cam-preview');

  const w = video.videoWidth || 640;
  const h = video.videoHeight || 480;

  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(video, 0, 0, w, h);

  currentPhotoBase64 = canvas.toDataURL('image/jpeg', 0.85);

  preview.src = currentPhotoBase64;
  preview.classList.remove('hidden');
  video.classList.add('hidden');

  document.getElementById('take-photo').classList.add('hidden');
  document.getElementById('retake-photo').classList.remove('hidden');

  setPinOk('Photo captured.');
}

function retakePhoto() {
  currentPhotoBase64 = null;
  document.getElementById('cam-preview').classList.add('hidden');
  document.getElementById('cam-video').classList.remove('hidden');
  document.getElementById('take-photo').classList.remove('hidden');
  document.getElementById('retake-photo').classList.add('hidden');
}


// ====== SUBMIT PIN ======
async function submitPin() {
  const pinInput = document.getElementById('pin-input');
  const pinConfirmInput = document.getElementById('pin-confirm-input');
  const employee = currentEmployee;

  if (!employee || !pinInput) return;

  const entered = pinInput.value.trim();
  const storedPin = (employee.pin || '').trim();

  // ===== EXISTING PIN =====
  if (storedPin) {
    // 1. PIN VALIDATION
    if (!pinValidated) {
      if (!entered) {
        setPinError(getCopy('pinStatusEnterPin'));
        return;
      }

      if (entered !== storedPin) {
        setPinError(getCopy('pinStatusIncorrect'));
        pinInput.value = '';

        // Brief pause so they can see the error, then back to main screen
        setTimeout(() => {
          hidePinModal();
        }, 1000);

        return;
      }

      pinValidated = true;
      pinInput.value = '';

    if (employee.require_photo && !currentPhotoBase64) {
      setPinOk(getCopy('pinStatusPinOkPhoto'));
      return;
    }
  }

    let hasProject = !!(kioskConfig && kioskConfig.project_id);
    const activeSession = getActiveSession();
    const hasSession = !!(activeSession && activeSession.project_id);
    const dayStarted = isKioskDayStarted();

    // If the server says there's an active session, ensure the kiosk project is set from it.
    if (!hasProject && hasSession && activeSession && activeSession.project_id) {
      setCurrentProject(activeSession.project_id);
      hasProject = true;
    }

    // Admins should be routed to the kiosk-admin flow when no active timesheet is available
    // (either no session yet, or we haven't started the day with a project).
    const needsTimesheet = employee.is_admin && !(hasSession || (hasProject && dayStarted));

    if (needsTimesheet) {
      hidePinModal();
      openAdminDashboard(employee.id, { skipPin: true });
      return;
    }

    // 2. NORMAL PUNCH
    await performPunch(employee.id);
    hidePinModal();
    return;
  }

  // ===== NO PIN YET – CREATE + CONFIRM (2 FIELDS) =====
  const pin1 = entered;
  const pin2 = pinConfirmInput ? pinConfirmInput.value.trim() : '';

  if (!pin1 || !pin2) {
    setPinError(getCopy('pinStatusCreateBoth'));
    return;
  }

  if (!/^\d{4}$/.test(pin1) || !/^\d{4}$/.test(pin2)) {
    setPinError(getCopy('pinStatusDigitsOnly'));
    return;
  }

  if (pin1 !== pin2) {
    setPinError(getCopy('pinStatusMismatch'));
    pinInput.value = '';
    if (pinConfirmInput) pinConfirmInput.value = '';
    return;
  }

  try {
    // Attempt to save PIN online first
    await fetchJSON(`/api/employees/${employee.id}/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: pin1,
        device_id: kioskDeviceId || getOrCreateDeviceId(),
        device_secret: getOrCreateDeviceSecret()
      })
    });

    // Success online
    employee.pin = pin1;
    justCreatedPin = true;

  } catch (err) {
    console.error('Error setting PIN', err);

    const msg = (err && err.message) ? String(err.message) : '';
    const offlineIssue = isConnectionIssue(err, msg);

    // Offline, auth, or network failure → save locally and queue for sync
    const authLike = /auth|login|credential|session/i.test(msg);
    if (offlineIssue || authLike) {
      addPendingPinUpdate({ employee_id: employee.id, pin: pin1 });

      employee.pin = pin1;           // treat as saved locally
      justCreatedPin = true;

    } else {
      // Real server error → do NOT continue
      setPinError(msg || getCopy('pinStatusSaveErr'));
      return;
    }
  }

  // PIN is now considered saved (online or offline)
  pinValidated = true;
  pinSetupMode = false;
  pinFirstEntry = '';
  pinInput.value = '';
  if (pinConfirmInput) pinConfirmInput.value = '';

  if (employee.require_photo && !currentPhotoBase64) {
    setPinOk(getCopy('pinStatusPinCreatedPhoto'));
    return;
  }

  const isAdminStartOfDay = employee.is_admin && !isKioskDayStarted();

  if (isAdminStartOfDay) {
    hidePinModal();
    openAdminDashboard(employee.id, { skipPin: true });
    return;
  }

  // Clock them in immediately
  await performPunch(employee.id);
  hidePinModal();
}

// ====== PERFORM PUNCH ======

async function performPunch(employee_id) {
  const status = document.getElementById('kiosk-status');

  const project_id = kioskConfig && kioskConfig.project_id
    ? parseInt(kioskConfig.project_id, 10)
    : null;
  if (!project_id) {
    status.textContent =
      getCopy('projectNotSet');
    status.className = 'glass-status kiosk-status kiosk-status-error';
    return;
  }


  const client_id = makeClientId();
  const pos = await getPosition();

  const punch = {
    client_id,
    employee_id,
    project_id,
    lat: pos?.lat || null,
    lng: pos?.lng || null,
    device_timestamp: new Date().toISOString(),
    photo_base64: currentPhotoBase64 || null,
    device_id: kioskDeviceId || null
  };

  if (!navigator.onLine) {
    addToQueue(punch);
    status.textContent = 'Saved offline — will sync.';
    status.className = 'glass-status kiosk-status kiosk-status-ok';
    showSuccessOverlay('Saved offline — will sync when back online.');
    startOfflineSyncLoop();

    const empSel = document.getElementById('kiosk-employee');
    const btn = document.getElementById('kiosk-punch');
    if (empSel) empSel.value = '';
    setDefaultPunchButton(btn);
    resetLanguageOverride();

    return;
  }

  try {
    const data = await fetchJSON('/api/kiosk/punch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(punch)
    });

    if (data.mode === 'clock_in') {
  let msg;

  if (justCreatedPin) {
    // First-time PIN message – no extra random text
    msg = getCopy('pinStatusPinCreatedClocked');
    justCreatedPin = false; // reset flag
  } else {
    // Normal clock-in – keep the fun random messages
    msg = getRandomClockInMessage();
  }

  // Show the overlay and keep the kiosk page clean
  showSuccessOverlay(msg);        // uses the default 5000ms unless you override
  status.textContent = '';


    } else {
      showSuccessOverlay('Punch recorded.');
      status.textContent = '';
    }

  status.className = 'glass-status kiosk-status kiosk-status-ok';


    const empSel = document.getElementById('kiosk-employee');
    const btn = document.getElementById('kiosk-punch');
    if (empSel) empSel.value = '';
    setDefaultPunchButton(btn);
    resetLanguageOverride();
  } catch (err) {
    console.error('Error syncing punch', err);
    const msg = err && err.message ? String(err.message) : '';
    const projectMsg = getCopy('projectNotSet');
    const showProjectMsg = /project|timesheet/i.test(msg);
    const offlineIssue = isConnectionIssue(err, msg);

    if (showProjectMsg) {
      status.textContent = projectMsg;
      status.className = 'glass-status kiosk-status kiosk-status-error';
    } else if (offlineIssue) {
      addToQueue(punch);
      status.textContent = 'Saved offline — will sync.';
      status.className = 'glass-status kiosk-status kiosk-status-ok';
      showSuccessOverlay('Saved offline — will sync when back online.');
      startOfflineSyncLoop();
    } else {
      status.textContent = msg || 'Could not sync punch.';
      status.className = 'glass-status kiosk-status kiosk-status-error';
    }

    const empSel = document.getElementById('kiosk-employee');
    const btn = document.getElementById('kiosk-punch');
    if (empSel) empSel.value = '';
    setDefaultPunchButton(btn);
    resetLanguageOverride();
  }
}



// ====== SYNC PENDING EMPLOYEES (OFFLINE → SERVER) ======

async function syncPendingEmployees() {
  if (!navigator.onLine) return;

  const pending = loadPendingPins();
  if (!pending.length) return;

  const remaining = [];

  for (const item of pending) {
    const deviceId = item.device_id || kioskDeviceId || getOrCreateDeviceId();
    const deviceSecret =
      item.device_secret || getOrCreateDeviceSecret();

    try {
      await fetchJSON(`/api/employees/${item.employee_id}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin: item.pin,
          allowOverride: true,
          device_id: deviceId,
          device_secret: deviceSecret
        })
      });
      // If this succeeds, the server now knows the pin — nothing else to do
    } catch (err) {
      console.error('Error syncing pending PIN for employee', item.employee_id, err);
      // Keep this one in the queue to try again later
      remaining.push(item);
    }
  }

  savePendingPins(remaining);
}


// ====== PUNCH STATUS (IN/OUT) ======

async function updatePunchButtonForEmployee(employeeId) {
  const button = document.getElementById('kiosk-punch');
  const status = document.getElementById('kiosk-status');
  if (!button) return;

  // No employee selected → reset to Clock In (green)
  if (!employeeId) {
    setDefaultPunchButton(button);
    return;
  }

  // Offline → still show as "Clock In"
  if (!navigator.onLine) {
    setDefaultPunchButton(button);
    return;
  }

  try {
    const numericId = Number(employeeId);
    const data = await fetchJSON(
      `/api/kiosk/open-punch?employee_id=${numericId}`
    );

    if (data.open) {
      // EMPLOYEE IS CLOCKED IN → CLOCK OUT MODE (RED)
      button.textContent = getCopy('tapOut');

      button.classList.add('kiosk-btn-danger');   // 🔴 make it red
      button.classList.remove('btn-primary');     // remove green

      // Show "clocked in for X time"
      if (data.clock_in_ts) {
        const start = new Date(data.clock_in_ts);
        const now = new Date();
        const diffMs = now - start;
        const diffMin = Math.floor(diffMs / 60000);
        const diffHours = diffMs / 3600000;

        status.className = 'glass-status kiosk-status kiosk-status-ok';
        status.textContent =
          diffMin < 60
            ? `Currently CLOCKED IN — ${diffMin} minutes so far.`
            : `Currently CLOCKED IN — ${diffHours.toFixed(2)} hours so far.`;
      }

    } else {
      // EMPLOYEE IS NOT CLOCKED IN → CLOCK IN MODE (GREEN)
      button.textContent = getCopy('tapIn');

      button.classList.remove('kiosk-btn-danger'); // remove red
      button.classList.add('btn-primary');         // make green again

      status.className = 'glass-status kiosk-status kiosk-status-ok';
      status.textContent = 'Ready to clock in.';
    }
  } catch (err) {
    console.error('Error checking open punch', err);

    status.className = 'glass-status kiosk-status kiosk-status-error';
    status.textContent =
      'Could not check current status. You can still punch.';

    // Fallback appearance → Clock In (green)
    setDefaultPunchButton(button);
  }
}


async function onEmployeeChange() {
  const empSel = document.getElementById('kiosk-employee');
  if (!empSel) return;
  const empId = empSel.value;
  const emp = employeesCache.find(e => String(e.id) === String(empId));

  // If a manual override is active but this is a different employee selection, clear the override.
  if (
    manualLanguageOverride &&
    manualLanguageEmployeeId &&
    empId &&
    empId !== manualLanguageEmployeeId
  ) {
    resetLanguageOverride();
  }

  // Tie a freshly chosen employee to the active manual override so it stays scoped to that person.
  if (manualLanguageOverride && empId && !manualLanguageEmployeeId) {
    manualLanguageEmployeeId = empId;
  }

  const langToUse =
    manualLanguageOverride ||
    (emp ? normalizeLanguage(emp.language) : currentLanguage);
  setLanguage(langToUse);

  if (!empId) {
    await updatePunchButtonForEmployee(null);
    return;
  }

  await updatePunchButtonForEmployee(empId);
}

// ====== PUNCH BUTTON ======

function onPunchClick() {
  const empSel = document.getElementById('kiosk-employee');
  const status = document.getElementById('kiosk-status');

  if (!empSel.value) {
    status.textContent = getCopy('selectYourNameStatus');
    status.className = 'glass-status kiosk-status kiosk-status-error';
    return;
  }

  const empId = empSel.value;
  const emp = employeesCache.find(e => String(e.id) === empId);
  if (!emp) {
    status.textContent = 'Employee not found.';
    status.className = 'glass-status kiosk-status kiosk-status-error';
    return;
  }

  const hasProject = kioskConfig && kioskConfig.project_id;

  if (!hasProject) {
    if (emp.is_admin) {
      showPinModal(emp);
      return;
    }

    status.textContent = getCopy('projectNotSet');
    status.className = 'glass-status kiosk-status kiosk-status-error';
    return;
  }


  // Normal path: we have an employee and a project, show PIN modal
  showPinModal(emp);
}


// ====== SYNC ON ONLINE ======

async function syncQueueToServer() {
  if (!navigator.onLine) return;

  const queue = loadQueue();
  if (!queue.length) return;

  for (const punch of queue) {
    try {
      await fetchJSON('/api/kiosk/punch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(punch),
      });

      // If successful, remove from local queue
      removeFromQueue(punch.client_id);
    } catch (err) {
      console.error('Error syncing queued punch, will retry later:', err);
      // Stop on first failure to avoid hammering the server / bad network
      break;
    }
  }
}

// ====== OFFLINE SYNC COORDINATOR ======

function hasOfflineDataToSync() {
  try {
    const punches = loadQueue();
    const pins = loadPendingPins();
    return (Array.isArray(punches) && punches.length > 0) ||
      (Array.isArray(pins) && pins.length > 0);
  } catch {
    return false;
  }
}

async function syncOfflineData(trigger = 'manual') {
  if (offlineSyncInFlight) return;
  if (!navigator.onLine && !hasOfflineDataToSync()) return;

  offlineSyncInFlight = true;
  try {
    await syncPendingEmployees();
    await syncQueueToServer();
  } catch (err) {
    console.error('Offline sync failed', trigger, err);
  } finally {
    offlineSyncInFlight = false;
  }
}

function startOfflineSyncLoop() {
  if (offlineSyncTimerId) clearInterval(offlineSyncTimerId);
  offlineSyncTimerId = setInterval(() => {
    if (!hasOfflineDataToSync()) return;
    syncOfflineData('interval');
  }, 30000);
}


// ====== INIT ======

document.addEventListener('DOMContentLoaded', async () => {
  hardenPinFields();

  // Device ID + kiosk config
  kioskDeviceId = getOrCreateDeviceId();
  showDeviceIdInUI();
  setLanguage(currentLanguage);
  hideStep2Sub();

  // Load data, then fetch kiosk config so default project can be applied
  await loadEmployeesAndProjects();
  await initKioskConfig();

  // Sync any offline stuff
  await syncOfflineData('init');
  startOfflineSyncLoop();

  // Periodically refresh the active project so workers always see the foreman’s current session
  setInterval(refreshKioskProjectFromServer, 30000);
  window.addEventListener('focus', () => {
    refreshKioskProjectFromServer();
    syncOfflineData('focus');
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncOfflineData('visibility');
  });

  // Main kiosk controls
  const punchBtn = document.getElementById('kiosk-punch');
  if (punchBtn) {
    punchBtn.addEventListener('click', onPunchClick);
  }

  const empSel = document.getElementById('kiosk-employee');
  if (empSel) {
    empSel.addEventListener('change', onEmployeeChange);
  }

  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const lang = normalizeLanguage(btn.getAttribute('data-lang') || 'en');
      manualLanguageOverride = lang;
      const empSel = document.getElementById('kiosk-employee');
      manualLanguageEmployeeId = empSel && empSel.value ? empSel.value : null;
      setLanguage(lang);
    });
  });

  // PIN modal buttons
  const pinClose = document.getElementById('pin-close-btn');
  if (pinClose) {
    pinClose.addEventListener('click', hidePinModal);
  }

  const pinCancel = document.getElementById('pin-cancel');
  if (pinCancel) {
    pinCancel.addEventListener('click', hidePinModal);
  }

  const pinContinue = document.getElementById('pin-continue');
  if (pinContinue) {
    pinContinue.addEventListener('click', submitPin);
  }

// Camera buttons
  const startCam = document.getElementById('start-camera');
  if (startCam) startCam.addEventListener('click', startCamera);

  const takePhotoBtn = document.getElementById('take-photo');
  if (takePhotoBtn) takePhotoBtn.addEventListener('click', takePhoto);

  const retakePhotoBtn = document.getElementById('retake-photo');
  if (retakePhotoBtn) retakePhotoBtn.addEventListener('click', retakePhoto);

  // Hidden admin mode on logo long-press
  setupAdminLongPress();

  // Admin login modal buttons
  const adminClose = document.getElementById('admin-login-close');
  if (adminClose) adminClose.addEventListener('click', hideAdminLoginModal);

  const adminCancel = document.getElementById('admin-login-cancel');
  if (adminCancel) adminCancel.addEventListener('click', hideAdminLoginModal);

  const adminContinue = document.getElementById('admin-login-continue');
  if (adminContinue) adminContinue.addEventListener('click', submitAdminLogin);

  // ✅ NEW: Submit admin PIN by ENTER key
  const adminPinInput = document.getElementById('admin-login-pin');
  if (adminPinInput) {
    adminPinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitAdminLogin();
      }
    });
  }

    const pinToggle = document.getElementById('pin-toggle-visibility');
  if (pinToggle) {
    pinToggle.addEventListener('click', () => {
      const pinInput = document.getElementById('pin-input');
      const pinConfirmInput = document.getElementById('pin-confirm-input');
      if (!pinInput) return;

      const newType = pinInput.type === 'password' ? 'text' : 'password';
      pinInput.type = newType;
      if (pinConfirmInput) pinConfirmInput.type = newType;

      pinToggle.textContent = newType === 'password' ? getCopy('pinToggleShow') : getCopy('pinToggleHide');
    });
  }


}); 

// When we regain internet, try syncing again
window.addEventListener('online', () => {
  syncOfflineData('online');
  startOfflineSyncLoop();
});
