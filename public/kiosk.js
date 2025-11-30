// ====== CONSTANTS ======

const QUEUE_KEY = 'avian_kiosk_offline_punches_v1';
const CACHE_EMP_KEY = 'avian_kiosk_employees_v1';
const CACHE_PROJ_KEY = 'avian_kiosk_projects_v1';
const DEVICE_ID_KEY = 'avian_kiosk_device_id_v1';
const PENDING_PIN_KEY = 'avian_kiosk_pending_pins_v1';


let employeesCache = [];
let projectsCache = [];
let currentProjectName = '';
let currentEmployee = null;
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
let kioskRequirePhoto = false;
let currentPunchMode = 'clock_in';

// ====== BASIC HELPERS ======

let successTimeout = null;

function showSuccessOverlay(message, durationMs = 5000) {  // ⬅️ 5 seconds default
  const backdrop = document.getElementById('success-backdrop');
  const msgEl = document.getElementById('success-message');
  const closeBtn = document.getElementById('success-close-btn');
  const closeLabel = document.getElementById('success-close-label');

  if (!backdrop || !msgEl) return;

  msgEl.textContent = message;
  if (closeLabel) closeLabel.textContent = t('backToClock');

  const hideOverlay = () => {
    backdrop.classList.add('hidden');
    if (successTimeout) {
      clearTimeout(successTimeout);
      successTimeout = null;
    }
    resetLanguageToDefault();
  };

  // Show overlay
  backdrop.classList.remove('hidden');

  // Clear old timer
  if (successTimeout) {
    clearTimeout(successTimeout);
    successTimeout = null;
  }

  // Auto-close after durationMs
  successTimeout = setTimeout(() => {
    hideOverlay();
  }, durationMs);

  // Manual close button
  if (closeBtn) {
    closeBtn.onclick = () => {
      hideOverlay();
    };
  }
}




async function fetchJSON(url, options = {}) {
  const opts = Object.assign({ credentials: 'include' }, options);
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
  return data;
}

function asBool(val, fallback = false) {
  if (val === undefined || val === null) return fallback;
  return val === true || val === 'true' || val === 1 || val === '1';
}

// Simple haversine distance in meters
function distanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function makeClientId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : 'p_' +
      Date.now().toString(36) +
      '_' +
      Math.random().toString(36).slice(2);
}

const SUPPORTED_LANG_CODES = ['en', 'es', 'ht'];

const LANGUAGE_STRINGS = {
  en: {
    tapToClockIn: 'Tap to Clock In',
    tapToClockOut: 'Tap to Clock Out',
    readyToClockIn: 'Ready to clock in.',
    selectYourName: 'Select your name.',
    selectYourNamePlaceholder: 'Select your name / Seleccione su nombre / Chwazi non ou',
    selectProject: 'Select project',
    employeeNotFound: 'Employee not found.',
    adminMustStartDay:
      'Foreman must start the day and set today\'s project in the admin screen before anyone can clock in.',
    projectNotSet:
      'Project not set for this tablet. Ask your foreman to unlock the admin screen and choose today’s project before clocking in.',
    loading: 'Loading…',
    offlineLoaded: 'Offline lists loaded.',
    noDataCached: 'Error: No data cached.',
    adminNotConfigured: 'No admin users configured yet in the Admin Console.',
    adminSelectAdmin: 'Select an admin.',
    adminEnterPin: 'Enter PIN.',
    adminEmployeeNotFound: 'Employee not found.',
    adminNoPin: 'This person does not have a PIN set yet.',
    adminIncorrectPin: 'Incorrect PIN.',
    showPin: 'Show PIN',
    hidePin: 'Hide PIN',
    pinCancel: 'Cancel',
    pinContinue: 'Continue',
    startCamera: 'Start Camera',
    takePhoto: 'Take Photo',
    retakePhoto: 'Retake',
    backToClock: 'Back to clock-in screen',
    clockedInMinutes: 'Currently CLOCKED IN — {minutes} minutes so far.',
    clockedInHours: 'Currently CLOCKED IN — {hours} hours so far.',
    statusUnknown: 'Could not check current status. You can still punch.',
    savedOffline: 'Saved offline — will sync.',
    couldNotSync: 'Could not sync — saved offline.',
    pinEnter: 'Enter your PIN.',
    pinIncorrect: 'Incorrect PIN — could not clock in. Please try again.',
    pinOkPhoto: 'PIN OK. Take required photo.',
    pinEnterConfirm: 'Enter and confirm a 4-digit PIN.',
    pinDigits: 'PIN must be exactly 4 digits.',
    pinMismatch: 'PINs do not match. Please try again.',
    pinCreatedClockedIn: 'PIN successfully created. You are now clocked in.',
    pinCreatedPhoto: 'PIN created. Take required photo.',
    pinSaveFailed: 'Could not save PIN. Check connection and try again.',
    punchSaved: 'Punch recorded.',
    pinTitleExisting: 'Employee PIN',
    pinTitleNew: 'Create Your PIN',
    pinModeExisting: 'Enter your PIN to clock in or out.',
    pinModeNew:
      'First time clocking in — create a 4-digit PIN you’ll use on any Avian kiosk.',
    cameraReady: 'Camera ready.',
    cameraUnavailable: 'Camera unavailable.',
    photoCaptured: 'Photo captured.',
    punchRecorded: 'Punch recorded.',
    greetingMorning: 'Good Morning',
    greetingAfternoon: 'Good Afternoon',
    greetingEvening: 'Good Evening',
    crewLabel: 'Crew',
    employeeLabel: 'Employee',
    projectLabel: 'Project',
    projectSelectorMissing: 'Project selector not found.',
    projectSelectedByForeman: 'selected by foreman',
    projectWillBeSet: 'Project will be set by foreman',
    subtitle: 'Jobsite Kiosk'
  },
  es: {
    tapToClockIn: 'Toque para marcar entrada',
    tapToClockOut: 'Toque para marcar salida',
    readyToClockIn: 'Listo para marcar entrada.',
    selectYourName: 'Seleccione su nombre.',
    selectYourNamePlaceholder: 'Select your name / Seleccione su nombre / Chwazi non ou',
    selectProject: 'Seleccione proyecto',
    employeeNotFound: 'Empleado no encontrado.',
    adminMustStartDay:
      'El encargado debe iniciar el dia y establecer el proyecto en la pantalla de administrador antes de que alguien marque entrada.',
    projectNotSet:
      'Proyecto no configurado para esta tableta. Pida a su encargado que desbloquee la pantalla de administrador y elija el proyecto de hoy antes de marcar.',
    loading: 'Cargando…',
    offlineLoaded: 'Listas sin conexion cargadas.',
    noDataCached: 'Error: no hay datos en cache.',
    adminNotConfigured: 'No hay administradores configurados en la consola.',
    adminSelectAdmin: 'Seleccione un administrador.',
    adminEnterPin: 'Ingrese PIN.',
    adminEmployeeNotFound: 'Empleado no encontrado.',
    adminNoPin: 'Esta persona no tiene PIN.',
    adminIncorrectPin: 'PIN incorrecto.',
    showPin: 'Mostrar PIN',
    hidePin: 'Ocultar PIN',
    pinCancel: 'Cancelar',
    pinContinue: 'Continuar',
    startCamera: 'Iniciar camara',
    takePhoto: 'Tomar foto',
    retakePhoto: 'Repetir',
    backToClock: 'Volver a marcar',
    clockedInMinutes: 'Actualmente MARCADO — {minutes} minutos hasta ahora.',
    clockedInHours: 'Actualmente MARCADO — {hours} horas hasta ahora.',
    statusUnknown: 'No se pudo verificar el estado. Aun asi puede marcar.',
    savedOffline: 'Guardado sin conexion — se sincronizara.',
    couldNotSync: 'No se pudo sincronizar — guardado sin conexion.',
    pinEnter: 'Ingrese su PIN.',
    pinIncorrect: 'PIN incorrecto — no se pudo marcar. Intente de nuevo.',
    pinOkPhoto: 'PIN correcto. Tome la foto requerida.',
    pinEnterConfirm: 'Ingrese y confirme un PIN de 4 digitos.',
    pinDigits: 'El PIN debe tener exactamente 4 digitos.',
    pinMismatch: 'Los PIN no coinciden. Intente de nuevo.',
    pinCreatedClockedIn: 'PIN creado correctamente. Ya marco su entrada.',
    pinCreatedPhoto: 'PIN creado. Tome la foto requerida.',
    pinSaveFailed: 'No se pudo guardar el PIN. Revise la conexion e intente de nuevo.',
    punchSaved: 'Marcacion registrada.',
    pinTitleExisting: 'PIN del empleado',
    pinTitleNew: 'Cree su PIN',
    pinModeExisting: 'Ingrese su PIN para marcar entrada o salida.',
    pinModeNew:
      'Primera vez marcando — cree un PIN de 4 digitos que usara en cualquier kiosco de Avian.',
    cameraReady: 'Camara lista.',
    cameraUnavailable: 'Camara no disponible.',
    photoCaptured: 'Foto tomada.',
    punchRecorded: 'Marcacion registrada.',
    greetingMorning: 'Buenos dias',
    greetingAfternoon: 'Buenas tardes',
    greetingEvening: 'Buenas noches',
    crewLabel: 'Equipo',
    employeeLabel: 'Empleado',
    projectLabel: 'Proyecto',
    projectSelectorMissing: 'Selector de proyecto no encontrado.',
    projectSelectedByForeman: 'seleccionado por el encargado',
    projectWillBeSet: 'El proyecto sera elegido por el encargado',
    subtitle: 'Kiosco de obra'
  },
  ht: {
    tapToClockIn: 'Peze pou anrejistre antre',
    tapToClockOut: 'Peze pou anrejistre soti',
    readyToClockIn: 'Pare pou anrejistre antre.',
    selectYourName: 'Chwazi non ou.',
    selectYourNamePlaceholder: 'Select your name / Seleccione su nombre / Chwazi non ou',
    selectProject: 'Chwazi pwoje',
    employeeNotFound: 'Anplwaye pa jwenn.',
    adminMustStartDay:
      'Sipervize a dwe komanse jounen an epi chwazi pwoje a nan ekran admin nan anvan nenpot moun ka anrejistre.',
    projectNotSet:
      'Pwoje pa chwazi sou tablet sa a. Mande sipervize a pou l debloke ekran admin nan epi chwazi pwoje jodi a anvan ou anrejistre.',
    loading: 'Chaje…',
    offlineLoaded: 'Lis offline yo chaje.',
    noDataCached: 'Erè: pa gen done anrejistre.',
    adminNotConfigured: 'Pa gen itilizatè admin nan konsole a.',
    adminSelectAdmin: 'Chwazi yon admin.',
    adminEnterPin: 'Antre PIN.',
    adminEmployeeNotFound: 'Anplwaye pa jwenn.',
    adminNoPin: 'Moun sa pa gen PIN.',
    adminIncorrectPin: 'PIN pa bon.',
    showPin: 'Montre PIN',
    hidePin: 'Kache PIN',
    pinCancel: 'Anile',
    pinContinue: 'Kontinye',
    startCamera: 'Komanse kamera',
    takePhoto: 'Pran foto',
    retakePhoto: 'Repran',
    backToClock: 'Tounen pou anrejistre',
    clockedInMinutes: 'KOUNYE A ANREJISTRE — {minutes} minit jouk koulye a.',
    clockedInHours: 'KOUNYE A ANREJISTRE — {hours} edtan jouk koulye a.',
    statusUnknown: 'Pa t kapab tcheke estati a. Ou ka toujou anrejistre.',
    savedOffline: 'Sove san rezo — ap senkronize pita.',
    couldNotSync: 'Pa t kapab senkronize — sove san rezo.',
    pinEnter: 'Antre PIN ou.',
    pinIncorrect: 'PIN pa bon — pa t ka anrejistre. Tanpri eseye anko.',
    pinOkPhoto: 'PIN bon. Pran foto obligatwa a.',
    pinEnterConfirm: 'Antre epi konfime yon PIN 4 chif.',
    pinDigits: 'PIN dwe gen 4 chif egzakteman.',
    pinMismatch: 'PIN yo pa menm. Tanpri eseye anko.',
    pinCreatedClockedIn: 'PIN kreye avek sikses. Ou anrejistre antre kounye a.',
    pinCreatedPhoto: 'PIN kreye. Pran foto obligatwa a.',
    pinSaveFailed: 'Pa t kapab sove PIN lan. Tcheke koneksyon an epi eseye anko.',
    punchSaved: 'Anrejistreman fet.',
    pinTitleExisting: 'PIN Anplwaye',
    pinTitleNew: 'Kreye PIN ou',
    pinModeExisting: 'Antre PIN ou pou antre oswa soti.',
    pinModeNew:
      'Premye fwa w ap anrejistre — kreye yon PIN 4 chif ou pral itilize sou nenpot kiosk Avian.',
    cameraReady: 'Kamera pare.',
    cameraUnavailable: 'Kamera pa disponib.',
    photoCaptured: 'Foto pran.',
    punchRecorded: 'Anrejistreman fet.',
    greetingMorning: 'Bonjou',
    greetingAfternoon: 'Bon apremidi',
    greetingEvening: 'Bonswa',
    crewLabel: 'Ekip',
    employeeLabel: 'Anplwaye',
    projectLabel: 'Pwoje',
    projectSelectorMissing: 'Lis pwoje pa jwenn.',
    projectSelectedByForeman: 'chwazi pa sipervize a',
    projectWillBeSet: 'Pwoje a ap chwazi pa sipervize a',
    subtitle: 'Kios konstriksyon'
  }
};

const CLOCK_IN_MESSAGES = {
  en: [
    'Clocked IN — have a safe shift!',
    'Clocked IN — have a great day!',
    'Clocked IN — stay safe out there!',
    'Clocked IN — let’s build something awesome today!',
    'Clocked IN — thanks for being on time!',
    'Clocked IN — you’re all set, have a good shift!'
  ],
  es: [
    'Marcado ENTRADA — que tengas un buen turno!',
    'Marcado ENTRADA — que tengas un gran dia!',
    'Marcado ENTRADA — mantente seguro hoy!',
    'Marcado ENTRADA — construyamos algo bueno hoy!',
    'Marcado ENTRADA — gracias por llegar a tiempo!',
    'Marcado ENTRADA — listo, buen turno!'
  ],
  ht: [
    'Ou anrejistre — bon travay!',
    'Ou anrejistre — pase yon bon jounen!',
    'Ou anrejistre — rete an sekirite jodi a!',
    'Ou anrejistre — ann bati yon bagay solid jodi a!',
    'Ou anrejistre — mesi paske ou rive a le!',
    'Ou anrejistre — tout bagay anfom, bon shift!'
  ]
};

let currentLanguage = 'en';

function normalizeLanguage(lang) {
  const code = (lang || '').toString().trim().toLowerCase();
  return SUPPORTED_LANG_CODES.includes(code) ? code : 'en';
}

function setCurrentLanguage(lang) {
  currentLanguage = normalizeLanguage(lang);
}

function resetLanguageToDefault() {
  setCurrentLanguage('en');
  applyStaticTranslations();
  updateGreetingUI();
  updateClockDisplay();
}

function getLocaleForLanguage(lang) {
  const code = normalizeLanguage(lang || currentLanguage);
  const preferences = {
    es: ['es', 'es-US'],
    ht: ['ht', 'ht-HT', 'fr-HT'],
    en: ['en', 'en-US']
  };

  const candidates = preferences[code] || preferences.en;
  const supported = Intl.DateTimeFormat.supportedLocalesOf(candidates);
  return supported[0] || candidates[0] || 'en-US';
}

function t(key, vars = {}, langOverride) {
  const lang = normalizeLanguage(langOverride || currentLanguage);
  const dict = LANGUAGE_STRINGS[lang] || LANGUAGE_STRINGS.en;
  const template = dict[key] || LANGUAGE_STRINGS.en[key] || key;

  return template.replace(/\{(\w+)\}/g, (_, k) => {
    const val = vars[k];
    return val === undefined || val === null ? '' : String(val);
  });
}

function getRandomClockInMessage(langOverride) {
  const lang = normalizeLanguage(langOverride || currentLanguage);
  const list = CLOCK_IN_MESSAGES[lang] || CLOCK_IN_MESSAGES.en;
  if (!Array.isArray(list) || !list.length) {
    return CLOCK_IN_MESSAGES.en[0];
  }
  const idx = Math.floor(Math.random() * list.length);
  return list[idx];
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
  // update = { employee_id, pin, device_id }
  const list = loadPendingPins();
  list.push({
    employee_id: update.employee_id,
    pin: update.pin,
    device_id: update.device_id || null,
    created_at: new Date().toISOString()
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
  q.push({
    ...punch,
    retry_count: punch.retry_count || 0
  });
  saveQueue(q);
}
function removeFromQueue(id) {
  saveQueue(loadQueue().filter(p => p.client_id !== id));
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

function mapEmployeeRecord(raw) {
  const obj = raw || {};
  return {
    ...obj,
    id: obj.id !== undefined ? Number(obj.id) : obj.id,
    language: normalizeLanguage(obj.language)
  };
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

function getGreetingPrefix() {
  const hour = new Date().getHours();
  if (hour < 12) return t('greetingMorning');
  if (hour < 17) return t('greetingAfternoon');
  return t('greetingEvening');
}

function updateGreetingUI() {
  const greetingEl = document.getElementById('kiosk-greeting');
  const subEl = document.getElementById('kiosk-greeting-sub');
  const empSel = document.getElementById('kiosk-employee');
  const projectLabelEl = document.getElementById('kiosk-project-label');
  const projectNoteEl = document.getElementById('kiosk-project-note');
  const employeeLabelEl = document.getElementById('kiosk-employee-label');
  const employeePlaceholderEl = document.getElementById('kiosk-employee-placeholder');
  const subtitleEl = document.getElementById('kiosk-subtitle');
  const step1TitleEl = document.getElementById('kiosk-step-1-title');
  const step2TitleEl = document.getElementById('kiosk-step-2-title');

  const selectedName =
    empSel && empSel.value && empSel.selectedOptions.length
      ? (empSel.selectedOptions[0].textContent || '').trim()
      : '';

  const prefix = getGreetingPrefix();

  if (greetingEl) {
    const label = selectedName || t('crewLabel');
    greetingEl.textContent = `${prefix}, ${label}!`;
  }

  if (subEl) {
    subEl.textContent = '';
  }

  if (projectLabelEl) projectLabelEl.textContent = t('projectLabel');
  if (projectNoteEl) projectNoteEl.textContent = `(${t('projectSelectedByForeman')})`;
  if (employeeLabelEl) employeeLabelEl.textContent = t('employeeLabel');
  if (employeePlaceholderEl) employeePlaceholderEl.textContent = t('selectYourNamePlaceholder');
  if (step1TitleEl) step1TitleEl.textContent = t('selectYourName');
  if (step2TitleEl) {
    step2TitleEl.textContent =
      currentPunchMode === 'clock_out' ? t('tapToClockOut') : t('tapToClockIn');
  }
  if (subtitleEl) subtitleEl.textContent = t('subtitle');

  applyStaticTranslations();
}

function getProjectNameById(id) {
  if (!id) return '';
  const match = projectsCache.find(p => Number(p.id) === Number(id));
  return match ? match.name || '' : '';
}

function setCurrentProject(projectId) {
  kioskConfig.project_id = projectId || null;
  currentProjectName = projectId ? getProjectNameById(projectId) || '' : '';
  updateProjectChip();
}

function updateProjectChip() {
  const chip = document.getElementById('kiosk-project-pill');
  const projectNameEl = document.getElementById('kiosk-project-name');
  if (!chip) return;

  const hasProject = !!(kioskConfig && kioskConfig.project_id);
  const label = hasProject
    ? currentProjectName || getProjectNameById(kioskConfig.project_id) || t('projectLabel')
    : t('projectLabel');

  chip.classList.remove('hidden');

  if (!hasProject) {
    chip.textContent = t('projectLabel');
    chip.classList.add('chip-warning');
    if (projectNameEl) projectNameEl.textContent = t('projectSelectedByForeman');
    return;
  }

  chip.classList.remove('chip-warning');
  chip.textContent = label;
  if (projectNameEl) projectNameEl.textContent = label;
}

function updateClockDisplay() {
  const dayEl = document.getElementById('kiosk-day-label');
  const dateEl = document.getElementById('kiosk-date-label');
  const timeEl = document.getElementById('kiosk-time-label');

  const locale = getLocaleForLanguage(currentLanguage);
  const now = new Date();
  const day = now.toLocaleDateString(locale, { weekday: 'long' });
  const date = now.toLocaleDateString(locale, { month: 'long', day: 'numeric', year: 'numeric' });
  const time = now.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });

  if (dayEl) dayEl.textContent = day;
  if (dateEl) dateEl.textContent = date;
  if (timeEl) timeEl.textContent = time;

  // If the daypart shifts while kiosk is open, keep greeting fresh
  updateGreetingUI();
}

function startClockLoop() {
  updateClockDisplay();
  setInterval(updateClockDisplay, 1000);
}

function syncActionHeadline(button) {
  const step2TitleEl = document.getElementById('kiosk-step-2-title');
  if (step2TitleEl && button) {
    step2TitleEl.textContent = button.textContent || '';
  }
}

function setDefaultPunchButton(button) {
  if (!button) return;
  currentPunchMode = 'clock_in';
  button.classList.remove('kiosk-btn-danger');
  button.classList.add('btn-primary');
  button.textContent = t('tapToClockIn');
  syncActionHeadline(button);
}

function animateButtonPress(btn) {
  if (!btn) return;
  btn.classList.add('kiosk-btn-pressed');
  setTimeout(() => btn.classList.remove('kiosk-btn-pressed'), 180);
}

function playClickSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.value = 180;

    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);

    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch (err) {
    // ignore sound failures
  }
}

function tapFeedback(btn) {
  animateButtonPress(btn);
  playClickSound();
}

function getOrCreateDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = 'dev-' + makeClientId();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function getOrCreateDeviceSecret() {
  const key = 'avian_kiosk_device_secret_v1';
  let secret = localStorage.getItem(key);
  if (!secret) {
    secret = makeClientId();
    localStorage.setItem(key, secret);
  }
  return secret;
}

function showDeviceIdInUI() {
  const el = document.getElementById('kiosk-device-id');
  if (el && kioskDeviceId) {
    el.textContent = kioskDeviceId;
  }
}

async function loadKioskSettings() {
  try {
    const res = await fetchJSON('/api/kiosk/settings');
    const settings = (res && res.settings) || {};
    // Temporarily ignore stored kiosk photo requirement
    kioskRequirePhoto = false;
  } catch (err) {
    console.warn('Could not load kiosk settings', err);
    kioskRequirePhoto = false;
  }
}

function applyKioskProjectDefault() {
  // Pick the active session’s project if one exists; otherwise leave blank
  let projectId = null;
  if (activeSessionId && kioskSessions && kioskSessions.length) {
    const active = kioskSessions.find(s => Number(s.id) === Number(activeSessionId));
    if (active && active.project_id) {
      projectId = active.project_id;
    }
  } else if (kioskConfig && kioskConfig.project_id) {
    projectId = kioskConfig.project_id;
  }

  setCurrentProject(projectId);
}

async function updateKioskProjectOnServer(projectId) {
  if (!projectId || !kioskConfig || !kioskConfig.id) return;
  if (!navigator.onLine) return;

  try {
    await fetchJSON('/api/kiosks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: kioskConfig.id,
        name: kioskConfig.name || 'Kiosk',
        location: kioskConfig.location || null,
        device_id: kioskConfig.device_id || kioskDeviceId || getOrCreateDeviceId(),
        project_id: projectId,
        require_photo: kioskConfig.require_photo || 0
      })
    });
  } catch (err) {
    console.warn('Could not persist geofence-selected project to server', err);
  }
}

// Try to set the project based on the current geofence (if no project already set)
async function detectGeofenceProjectDefault() {
  // Respect an already-set kiosk project (foreman/admin selection)
  if (kioskConfig && kioskConfig.project_id) return;

  if (!projectsCache || !projectsCache.length) return;

  const pos = await getPosition();
  if (!pos) return;

  const candidates = projectsCache
    .filter(p =>
      p.geo_lat != null &&
      p.geo_lng != null &&
      p.geo_radius != null &&
      !Number.isNaN(Number(p.geo_lat)) &&
      !Number.isNaN(Number(p.geo_lng)) &&
      !Number.isNaN(Number(p.geo_radius))
    )
    .map(p => ({
      project: p,
      distance: distanceMeters(pos.lat, pos.lng, Number(p.geo_lat), Number(p.geo_lng))
    }))
    .filter(item => item.distance <= Number(item.project.geo_radius));

  if (!candidates.length) return;

  candidates.sort((a, b) => a.distance - b.distance);
  const best = candidates[0].project;
  const pid = String(best.id);

  // Apply selection locally (geofence-based convenience)
  setCurrentProject(best.id);
  if (kioskConfig) kioskConfig.project_id = best.id;

  // Persist to server so kiosk-admin sees the same default
  await updateKioskProjectOnServer(best.id);
}


async function initKioskConfig() {
  kioskDeviceId = getOrCreateDeviceId();
  const deviceSecret = getOrCreateDeviceSecret();
  showDeviceIdInUI();

  try {
    const data = await fetchJSON('/api/kiosks/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: kioskDeviceId, device_secret: deviceSecret })
    });

    if (data && data.kiosk) {
      kioskConfig = data.kiosk;
      kioskSessions = data.sessions || [];
      activeSessionId = data.active_session_id || null;
      applyKioskProjectDefault();
    }
  } catch (err) {
    console.error('Error registering kiosk device:', err);
  }
}

async function refreshKioskProjectFromServer() {
  const deviceSecret = getOrCreateDeviceSecret();
  try {
    const data = await fetchJSON('/api/kiosks/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: kioskDeviceId || getOrCreateDeviceId(),
        device_secret: deviceSecret
      })
    });

    if (data && data.kiosk) {
      kioskConfig = data.kiosk;
      kioskSessions = data.sessions || kioskSessions;
      activeSessionId = data.active_session_id || activeSessionId;
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

function hasActiveAdminSession() {
  if (isKioskDayStarted()) return true;
  if (activeSessionId) return true;

  if (kioskConfig && kioskConfig.project_id && kioskSessions && kioskSessions.length) {
    const match = kioskSessions.find(
      s => Number(s.project_id) === Number(kioskConfig.project_id)
    );
    if (match) return true;
  }

  return false;
}

// ====== LOAD EMPLOYEES & PROJECTS ======

async function loadEmployeesAndProjects() {
  const empSel = document.getElementById('kiosk-employee');
  const status = document.getElementById('kiosk-status');

  status.textContent = t('loading');

  try {
    const [emps, projs] = await Promise.all([
      fetchJSON('/api/kiosk/employees'),
      fetchJSON('/api/projects')
    ]);

    // normalize ids
    employeesCache = (emps || []).map(mapEmployeeRecord);
    // Only keep active project jobs (exclude top-level customers)
    projectsCache = (projs || []).filter(p => p.customer_name);

    fillEmployeeSelect(empSel, employeesCache);

    saveCache(CACHE_EMP_KEY, employeesCache);
    saveCache(CACHE_PROJ_KEY, projectsCache);

    updateProjectChip();
    status.textContent = '';
  } catch {
    const emps = (loadCache(CACHE_EMP_KEY) || []).map(mapEmployeeRecord);
    const projs = loadCache(CACHE_PROJ_KEY) || [];

    employeesCache = emps;
    projectsCache = projs;

    fillEmployeeSelect(empSel, emps);

    updateProjectChip();
    if (emps.length || projs.length) {
      status.textContent = t('offlineLoaded');
    } else {
      status.textContent = t('noDataCached');
    }
  }
}

function fillEmployeeSelect(sel, list) {
  sel.innerHTML = `<option value="">${t('selectYourNamePlaceholder')}</option>`;

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
    opt.dataset.lang = e.language || 'en';
    sel.appendChild(opt);
  }
}


// ====== ADMIN LOGIN (HIDDEN MODE) ======

let adminLongPressTimer = null;

function showAdminLoginModal(preselectAdminId = null, message = '') {
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
    status.textContent = t('adminNotConfigured');
  } else {
    status.textContent = message || '';
  }

  if (preselectAdminId && empSelect.querySelector(`option[value="${preselectAdminId}"]`)) {
    empSelect.value = String(preselectAdminId);
  }

  pinInput.value = '';
  backdrop.classList.remove('hidden');

  setTimeout(() => {
    pinInput.focus();
  }, 100);
}

function openAdminDashboard(employeeId, { skipPin = false, startMode = false } = {}) {
  try {
    const params = new URLSearchParams();
    const deviceId = kioskDeviceId || getOrCreateDeviceId();

    params.set('device_id', deviceId);
    if (employeeId) params.set('employee_id', employeeId);
    if (skipPin) params.set('skip_pin', '1');
    if (startMode) params.set('start', '1');

    const adminUrl = '/kiosk-admin.html?' + params.toString();
    window.location.href = adminUrl;
  } catch (err) {
    console.error('Error opening kiosk admin dashboard', err);
  }
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
    status.textContent = t('adminSelectAdmin');
    return;
  }
  if (!entered) {
    status.textContent = t('adminEnterPin');
    return;
  }

  const emp = (employeesCache || []).find(e => String(e.id) === String(id));
  if (!emp) {
    status.textContent = t('adminEmployeeNotFound');
    return;
  }

  const storedPin = (emp.pin || '').trim();
  if (!storedPin) {
    status.textContent = t('adminNoPin');
    return;
  }

  if (storedPin !== entered) {
    status.textContent = t('adminIncorrectPin');
    return;
  }

  // ✅ Success – close login and go to kiosk admin dashboard in the SAME tab
  status.textContent = '';
  hideAdminLoginModal();

  // First time today → open in "start-of-day" mode
  openAdminDashboard(id, { skipPin: true, startMode: !isKioskDayStarted() });
}



function setupAdminLongPress() {
  const logo = document.getElementById('kiosk-logo');
  if (!logo) return;

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
  logo.addEventListener('mousedown', start);
  logo.addEventListener('touchstart', start, { passive: false });

  logo.addEventListener('mouseup', cancel);
  logo.addEventListener('mouseleave', cancel);
  logo.addEventListener('touchend', cancel);
  logo.addEventListener('touchcancel', cancel);

  // 🚫 Block the context menu entirely
  logo.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  // Enable pointer-events in case CSS or a parent overlay blocked clicks
  logo.style.pointerEvents = 'auto';
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

  if (nameEl) {
    const baseName = employee.nickname || employee.name;

    // Try to read the currently active project label
    const projectLabel =
      kioskConfig && kioskConfig.project_id
        ? currentProjectName || getProjectNameById(kioskConfig.project_id) || ''
        : '';

    const projectWord = t('projectLabel');
    // Show “Name – Project: XYZ” if we know the project,
    // otherwise just the name
    nameEl.textContent = projectLabel
      ? `${baseName} – ${projectWord}: ${projectLabel}`
      : baseName;
  }

  // Title + explanatory label
  if (titleEl) {
    titleEl.textContent = hasPin ? t('pinTitleExisting') : t('pinTitleNew');
  }

if (modeLabelEl) {
  modeLabelEl.textContent = hasPin
    ? t('pinModeExisting')
    : t('pinModeNew');
}


  // Reset fields
  if (pinInput) {
    pinInput.value = '';
    pinInput.type = 'password';
    pinInput.readOnly = false;
  }
  if (pinConfirmInput) {
    pinConfirmInput.value = '';
    pinConfirmInput.type = 'password';
    // Only show confirm field when they are creating a new PIN
    pinConfirmInput.classList.toggle('hidden', hasPin);
  }

  if (toggleBtn) {
    toggleBtn.textContent = t('showPin');
  }

  if (status) {
    status.textContent = '';
    status.style.color = '#bbf7d0';
  }

  camSec.classList.add('hidden');
  stopCamera();

  const mustPhoto =
    kioskRequirePhoto ||
    !!employee.require_photo ||
    !!(kioskConfig && kioskConfig.require_photo);

  if (mustPhoto) camSec.classList.remove('hidden');

  document.getElementById('pin-backdrop').classList.remove('hidden');
  if (pinInput) {
    pinInput.focus();
    setTimeout(() => pinInput.focus(), 50);
  }
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

function applyStaticTranslations() {
  const cancelBtn = document.getElementById('pin-cancel');
  const continueBtn = document.getElementById('pin-continue');
  const startCam = document.getElementById('start-camera');
  const takePhotoBtn = document.getElementById('take-photo');
  const retakePhotoBtn = document.getElementById('retake-photo');
  const pinToggle = document.getElementById('pin-toggle-visibility');
  const successCloseLabel = document.getElementById('success-close-label');

  if (cancelBtn) cancelBtn.textContent = t('pinCancel');
  if (continueBtn) continueBtn.textContent = t('pinContinue');
  if (startCam) startCam.textContent = t('startCamera');
  if (takePhotoBtn) takePhotoBtn.textContent = t('takePhoto');
  if (retakePhotoBtn) retakePhotoBtn.textContent = t('retakePhoto');
  if (pinToggle) {
    pinToggle.textContent =
      pinToggle.textContent.trim().toLowerCase().includes('hide')
        ? t('hidePin')
        : t('showPin');
  }
  if (successCloseLabel) successCloseLabel.textContent = t('backToClock');
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

    setPinOk(t('cameraReady'));
  } catch {
    setPinError(t('cameraUnavailable'));
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

  setPinOk(t('photoCaptured'));
}

function retakePhoto() {
  currentPhotoBase64 = null;
  document.getElementById('cam-preview').classList.add('hidden');
  document.getElementById('cam-video').classList.remove('hidden');
  document.getElementById('take-photo').classList.remove('hidden');
  document.getElementById('retake-photo').classList.add('hidden');
}


// ====== SUBMIT PIN ======
function maybeOpenAdminAfterPin(employee) {
  if (!employee || !employee.is_admin) return false;
  if (isKioskDayStarted()) return false;

  // Skip straight to kiosk admin with skip_pin=1 since we just validated
  hidePinModal();
  openAdminDashboard(employee.id, { skipPin: true, startMode: true });
  return true;
}

async function submitPin() {
  const pinInput = document.getElementById('pin-input');
  const pinConfirmInput = document.getElementById('pin-confirm-input');
  const employee = currentEmployee;

  if (!employee || !pinInput) return;

  const entered = pinInput.value.trim();
  const storedPin = (employee.pin || '').trim();
  const mustPhoto =
    kioskRequirePhoto ||
    !!employee.require_photo ||
    !!(kioskConfig && kioskConfig.require_photo);

  // ===== EXISTING PIN =====
  if (storedPin) {
    // 1. PIN VALIDATION
    if (!pinValidated) {
      if (!entered) {
        setPinError(t('pinEnter'));
        return;
      }

      if (entered !== storedPin) {
        setPinError(t('pinIncorrect'));
        pinInput.value = '';

        // Brief pause so they can see the error, then back to main screen
        setTimeout(() => {
          hidePinModal();
        }, 1000);

        return;
      }

      pinValidated = true;
      pinInput.value = '';

      if (mustPhoto && !currentPhotoBase64) {
        setPinOk(t('pinOkPhoto'));
        return;
      }
    }

    if (mustPhoto && !currentPhotoBase64) {
      setPinError(t('pinOkPhoto'));
      return;
    }

    // 2. If this is an admin's first pin entry of the day, jump to kiosk admin
    if (maybeOpenAdminAfterPin(employee)) {
      return;
    }

    // 3. NORMAL PUNCH
    await performPunch(employee.id);
    hidePinModal();
    return;
  }

  // ===== NO PIN YET – CREATE + CONFIRM (2 FIELDS) =====
  const pin1 = entered;
  const pin2 = pinConfirmInput ? pinConfirmInput.value.trim() : '';

  if (!pin1 || !pin2) {
    setPinError(t('pinEnterConfirm'));
    return;
  }

  if (!/^\d{4}$/.test(pin1) || !/^\d{4}$/.test(pin2)) {
    setPinError(t('pinDigits'));
    return;
  }

  if (pin1 !== pin2) {
    setPinError(t('pinMismatch'));
    pinInput.value = '';
    if (pinConfirmInput) pinConfirmInput.value = '';
    return;
  }

  const deviceId = kioskDeviceId || getOrCreateDeviceId();
  const deviceSecret = getOrCreateDeviceSecret();

  try {
    // Attempt to save PIN online first
    await fetchJSON(`/api/employees/${employee.id}/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: pin1,
        device_id: deviceId,
        device_secret: deviceSecret
      })
    });

    // Success online
    employee.pin = pin1;
    saveCache(CACHE_EMP_KEY, employeesCache);
    justCreatedPin = true;

  } catch (err) {
    console.error('Error setting PIN', err);

    const msg = (err && err.message) ? String(err.message) : '';

    // Offline, auth, or network failure → save locally and queue for sync
    const authLike = /auth|login|credential|session/i.test(msg);
    if (!navigator.onLine || /NetworkError|Failed to fetch/i.test(msg) || authLike) {
      addPendingPinUpdate({
        employee_id: employee.id,
        pin: pin1,
        device_id: deviceId
      });

      employee.pin = pin1;           // treat as saved locally
      saveCache(CACHE_EMP_KEY, employeesCache);
      justCreatedPin = true;

    } else {
      // Real server error → do NOT continue
      setPinError(msg || t('pinSaveFailed'));
      return;
    }
  }

  // PIN is now considered saved (online or offline)
  pinValidated = true;
  pinSetupMode = false;
  pinFirstEntry = '';
  pinInput.value = '';
  if (pinConfirmInput) pinConfirmInput.value = '';

  if (mustPhoto && !currentPhotoBase64) {
    setPinOk(t('pinCreatedPhoto'));
    return;
  }

  // Clock them in immediately
  await performPunch(employee.id);
  hidePinModal();
}

// ====== PERFORM PUNCH ======

async function performPunch(employee_id) {
  const status = document.getElementById('kiosk-status');

  const empSel = document.getElementById('kiosk-employee');
  const selectedOption =
    empSel && empSel.selectedOptions && empSel.selectedOptions.length
      ? empSel.selectedOptions[0]
      : null;
  const empLang =
    (selectedOption && selectedOption.dataset && selectedOption.dataset.lang) ||
    ((employeesCache.find(e => Number(e.id) === Number(employee_id)) || {}).language);
  if (empLang) {
    setCurrentLanguage(empLang);
    applyStaticTranslations();
    updateClockDisplay();
  }

  const project_id = kioskConfig && kioskConfig.project_id
    ? parseInt(kioskConfig.project_id, 10)
    : null;
  if (!project_id) {
    status.textContent = t('projectNotSet');
    status.className = 'kiosk-status kiosk-status-error';
    return;
  }

  const punchMode = currentPunchMode || 'clock_in';
  if (punchMode === 'clock_in' && !hasActiveAdminSession()) {
    status.textContent = t('adminMustStartDay');
    status.className = 'kiosk-status kiosk-status-error';
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

  addToQueue(punch);

  if (!navigator.onLine) {
    status.textContent = t('savedOffline');
    status.className = 'kiosk-status kiosk-status-ok';

    const empSel = document.getElementById('kiosk-employee');
    const btn = document.getElementById('kiosk-punch');
    if (empSel) empSel.value = '';
    setDefaultPunchButton(btn);
    resetLanguageToDefault();

    return;
  }

  try {
    const data = await fetchJSON('/api/kiosk/punch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(punch)
    });

        removeFromQueue(client_id);

    if (data.mode === 'clock_in') {
  let msg;

  if (justCreatedPin) {
    // First-time PIN message – no extra random text
    msg = t('pinCreatedClockedIn');
    justCreatedPin = false; // reset flag
  } else {
    // Normal clock-in – keep the fun random messages
    msg = getRandomClockInMessage();
  }

  // Show the overlay and keep the kiosk page clean
  showSuccessOverlay(msg);        // uses the default 5000ms unless you override
  status.textContent = '';


    } else {
      showSuccessOverlay(t('punchSaved'));
      status.textContent = '';
    }

    status.className = 'kiosk-status kiosk-status-ok';


    const empSel = document.getElementById('kiosk-employee');
    const btn = document.getElementById('kiosk-punch');
    if (empSel) empSel.value = '';
    setDefaultPunchButton(btn);
    // Will reset to default when overlay closes
  } catch (err) {
    console.error('Error syncing punch', err);
    status.textContent = t('couldNotSync');
    status.className = 'kiosk-status kiosk-status-error';

    const empSel = document.getElementById('kiosk-employee');
    const btn = document.getElementById('kiosk-punch');
    if (empSel) empSel.value = '';
    setDefaultPunchButton(btn);
    resetLanguageToDefault();
  }
}



// ====== SYNC PENDING EMPLOYEES (OFFLINE → SERVER) ======

async function syncPendingEmployees() {
  if (!navigator.onLine) return;

  const pending = loadPendingPins();
  if (!pending.length) return;

  const remaining = [];
  const fallbackDeviceId = kioskDeviceId || getOrCreateDeviceId();
  const fallbackSecret = getOrCreateDeviceSecret();

  for (const item of pending) {
    try {
      await fetchJSON(`/api/employees/${item.employee_id}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin: item.pin,
          allowOverride: true,
          device_id: item.device_id || fallbackDeviceId,
          device_secret: fallbackSecret
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
    currentPunchMode = 'clock_in';
    setDefaultPunchButton(button);
    return;
  }

  // Offline → still show as "Clock In"
  if (!navigator.onLine) {
    currentPunchMode = 'clock_in';
    if (!hasActiveAdminSession() && status) {
      status.className = 'kiosk-status kiosk-status-error';
      status.textContent = t('adminMustStartDay');
    }
    setDefaultPunchButton(button);
    return;
  }

  try {
    const numericId = Number(employeeId);
    const data = await fetchJSON(
      `/api/kiosk/open-punch?employee_id=${numericId}`
    );

    const isClockedIn = !!data.open;
    currentPunchMode = isClockedIn ? 'clock_out' : 'clock_in';

    if (isClockedIn) {
      // EMPLOYEE IS CLOCKED IN → CLOCK OUT MODE (RED)
      button.textContent = t('tapToClockOut');
      syncActionHeadline(button);

      button.classList.add('kiosk-btn-danger');   // 🔴 make it red
      button.classList.remove('btn-primary');     // remove green

      // Show "clocked in for X time"
      if (data.clock_in_ts && status) {
        const start = new Date(data.clock_in_ts);
        const now = new Date();
        const diffMs = now - start;
        const diffMin = Math.floor(diffMs / 60000);
        const diffHours = diffMs / 3600000;

        status.className = 'kiosk-status kiosk-status-ok';
        status.textContent =
          diffMin < 60
            ? t('clockedInMinutes', { minutes: diffMin })
            : t('clockedInHours', { hours: diffHours.toFixed(2) });
      }

    } else {
      // Require admin start-of-day before allowing any new clock-ins
      if (!hasActiveAdminSession()) {
        if (status) {
          status.className = 'kiosk-status kiosk-status-error';
          status.textContent = t('adminMustStartDay');
        }
        setDefaultPunchButton(button);
        return;
      }

      // EMPLOYEE IS NOT CLOCKED IN → CLOCK IN MODE (GREEN)
      button.textContent = t('tapToClockIn');
      syncActionHeadline(button);

      button.classList.remove('kiosk-btn-danger'); // remove red
      button.classList.add('btn-primary');         // make green again

      if (status) {
        status.className = 'kiosk-status kiosk-status-ok';
        status.textContent = t('readyToClockIn');
      }
    }
  } catch (err) {
    console.error('Error checking open punch', err);

    currentPunchMode = 'clock_in';
    if (status) {
      status.className = 'kiosk-status kiosk-status-error';
      status.textContent = t('statusUnknown');
    }

    // Fallback appearance → Clock In (green)
    button.textContent = t('tapToClockIn');
    syncActionHeadline(button);
    button.classList.remove('kiosk-btn-danger');
    button.classList.add('btn-primary');
  }
}


async function onEmployeeChange() {
  const empSel = document.getElementById('kiosk-employee');
  if (!empSel) return;
  const empId = empSel.value;

  if (!empId) {
    setCurrentLanguage('en');
    await updatePunchButtonForEmployee(null);
    updateGreetingUI();
    return;
  }

  const selectedOption =
    empSel.selectedOptions && empSel.selectedOptions.length
      ? empSel.selectedOptions[0]
      : null;
  const optionLang =
    selectedOption && selectedOption.dataset && selectedOption.dataset.lang
      ? selectedOption.dataset.lang
      : null;

  const selectedEmp = employeesCache.find(e => String(e.id) === empId);
  setCurrentLanguage(optionLang || (selectedEmp ? selectedEmp.language : 'en'));
  updateClockDisplay();
  await updatePunchButtonForEmployee(empId);
  updateGreetingUI();
}

// ====== PUNCH BUTTON ======

function onPunchClick() {
  const empSel = document.getElementById('kiosk-employee');
  const status = document.getElementById('kiosk-status');

  if (!empSel.value) {
    status.textContent = t('selectYourName');
    status.className = 'kiosk-status kiosk-status-error';
    return;
  }

  const empId = empSel.value;
  const emp = employeesCache.find(e => String(e.id) === empId);
  if (!emp) {
    status.textContent = t('employeeNotFound');
    status.className = 'kiosk-status kiosk-status-error';
    return;
  }

  const isAdmin = !!emp.is_admin;

  const punchMode = currentPunchMode || 'clock_in';
  if (punchMode === 'clock_in' && !hasActiveAdminSession()) {
    if (isAdmin) {
      showAdminLoginModal(emp.id, t('adminMustStartDay'));
      return;
    }
    status.textContent = t('adminMustStartDay');
    status.className = 'kiosk-status kiosk-status-error';
    return;
  }

  const hasProject = kioskConfig && kioskConfig.project_id;

  if (!hasProject) {
    if (isAdmin) {
      showAdminLoginModal(emp.id, t('projectNotSet'));
      return;
    }
    status.textContent = t('projectNotSet');
    status.className = 'kiosk-status kiosk-status-error';
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

  const remaining = [];
  let changed = false;

  for (const punch of queue) {
    try {
      await fetchJSON('/api/kiosk/punch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(punch),
      });

      changed = true; // success → drop from queue
    } catch (err) {
      console.error('Error syncing queued punch, will retry later:', err);
      const msg = (err && err.message) ? String(err.message) : '';
      const netLike =
        !navigator.onLine ||
        /NetworkError|Failed to fetch|offline|timed out/i.test(msg);

      // Network/auth → keep the punch and try again later
      if (netLike) {
        remaining.push(punch);
        continue;
      }

      // Validation/other errors: cap retries so one bad record doesn't block others
      const attempts = (punch.retry_count || 0) + 1;
      if (attempts >= 3) {
        changed = true; // drop it after 3 failed tries
        continue;
      }

      changed = true;
      remaining.push({ ...punch, retry_count: attempts });
    }
  }

  saveQueue(remaining);

  // If we dropped some and still have items, try again soon so backlog drains
  if (changed && remaining.length && navigator.onLine) {
    setTimeout(syncQueueToServer, 3000);
  }
}


// ====== INIT ======

document.addEventListener('DOMContentLoaded', async () => {
  // Device ID + kiosk config
  kioskDeviceId = getOrCreateDeviceId();
  showDeviceIdInUI();

  await loadKioskSettings();
  // Load data, then fetch kiosk config so default project can be applied
  await loadEmployeesAndProjects();
  await initKioskConfig();
  startClockLoop();
  updateGreetingUI();
  updateProjectChip();
  setDefaultPunchButton(document.getElementById('kiosk-punch'));

  // Sync any offline stuff
  syncPendingEmployees();
  syncQueueToServer();

  // Periodically refresh the active project so workers always see the foreman’s current session
  setInterval(refreshKioskProjectFromServer, 30000);
  window.addEventListener('focus', refreshKioskProjectFromServer);

  // Main kiosk controls
  const punchBtn = document.getElementById('kiosk-punch');
  if (punchBtn) {
    punchBtn.addEventListener('click', () => {
      tapFeedback(punchBtn);
      onPunchClick();
    });
  }

  const empSel = document.getElementById('kiosk-employee');
  if (empSel) {
    empSel.addEventListener('change', onEmployeeChange);
  }

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

      pinToggle.textContent = newType === 'password' ? t('showPin') : t('hidePin');
    });
  }

  // Apply static translations on first load
  applyStaticTranslations();

});

// When we regain internet, try syncing again
window.addEventListener('online', () => {
  syncPendingEmployees();
  syncQueueToServer();
});
