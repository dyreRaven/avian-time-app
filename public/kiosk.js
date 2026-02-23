// ====== CONSTANTS ======

const QUEUE_KEY = 'avian_kiosk_offline_punches_v1';
const CACHE_EMP_KEY = 'avian_kiosk_employees_v1';
const CACHE_PROJ_KEY = 'avian_kiosk_projects_v1';
const CURRENT_PROJECT_KEY = 'avian_kiosk_current_project_v1';
const OPEN_PUNCH_CACHE_KEY = 'avian_kiosk_open_punch_cache_v1';
const DEVICE_ID_KEY = 'avian_kiosk_device_id_v1';
const DEVICE_SECRET_KEY = 'avian_kiosk_device_secret_v1';
const DEBUG_STORAGE_KEY = 'avian_kiosk_debug';
const ORG_TIMEZONE_KEY = 'avian_kiosk_org_timezone_v1';
const PENDING_PIN_KEY = 'avian_kiosk_pending_pins_v1';
const CLOCK_IN_PHOTO_REQUIRED_KEY = 'avian_kiosk_clock_in_photo_required_v1';
const KIOSK_CACHE_KEY = 'avian_kiosk_config_cache_v1';
const ORG_SUSPENDED_KEY = 'avian_kiosk_org_suspended_v1';
const DEFAULT_TIMEZONE = 'America/Puerto_Rico';
let offlineStorageSupported = true;
const PIN_THROTTLE_START_AFTER = 3;
const PIN_THROTTLE_BASE_MS = 1000;
const PIN_THROTTLE_MAX_MS = 8000;
const PIN_CRYPTO_VERSION = 'v1';
const PIN_CRYPTO_SALT = 'avian-kiosk-pin-v1';
const PIN_CRYPTO_ITERATIONS = 50000;
const KIOSK_DEBUG = (() => {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has('debug')) return true;
    return localStorage.getItem(DEBUG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
})();
const DEBUG_MAX_LINES = 6;
const debugLines = [];
let debugEl = null;

const LANG_COPY = {
  en: {
    greetMorning: 'Good morning!',
    greetAfternoon: 'Good afternoon',
    greetEvening: 'Good evening',
    instructions: 'Please select your name below and tap the button to begin or end your shift.',
    placeholder: 'Select your name',
    employeeLabel: 'Employee',
    languageLabel: 'Language',
    projectActiveLabel: 'Active Project:',
    projectNotSetLabel: 'No project set',
    projectLabel: 'Project',
    projectLabelWithId: 'Project {{id}}',
    employeeProjectLine: '{{name}} — Project: {{project}}',
    tapIn: 'CLOCK IN',
    tapOut: 'CLOCK OUT',
    selectYourNameStatus: 'Select your name.',
    projectNotSet: 'Project not set for this tablet. See your supervisor to clock in.',
    timesheetNotSet: 'No timesheet set for this tablet today. See your supervisor to choose a project first.',
    pinTitleExisting: 'Employee PIN',
    pinTitleNew: 'Create Your PIN',
    pinSubtitleExisting: 'Enter your PIN to clock in or out.',
    pinSubtitleNew: 'First time clocking in — create a 4-digit PIN you’ll use on any Avian kiosk.',
    pinPlaceholder: 'PIN',
    pinConfirmPlaceholder: 'Confirm PIN',
    pinStatusNoPin: 'This person does not have a PIN set yet.',
    pinStatusIncorrect: 'Incorrect PIN.',
    pinStatusEnter: 'Enter PIN.',
    pinStatusEnterPin: 'Enter your PIN.',
    pinStatusPinOkPhoto: 'PIN OK. Take required photo.',
    pinStatusSubmitting: 'PIN OK. Submitting...',
    pinStatusCreateBoth: 'Enter and confirm a 4-digit PIN.',
    pinStatusDigitsOnly: 'PIN must be exactly 4 digits.',
    pinStatusMismatch: 'PINs do not match. Please try again.',
    pinStatusSaveErr: 'Could not save PIN. Check connection and try again.',
    pinStatusPinCreatedPhoto: 'PIN created. Take required photo.',
    pinStatusPinCreatedClocked: 'PIN successfully created. You are now clocked in.',
    pinToggleShow: 'Show PIN',
    pinToggleHide: 'Hide PIN',
    photoRequired: 'Photo Required',
    cameraStart: 'Start Camera',
    cameraTake: 'Take Photo',
    cameraRetake: 'Retake',
    clockInPhotoUnavailable:
      'Clock-in needs a photo, but this tablet cannot access the camera. Ask a supervisor or use another tablet.',
    pinCancel: 'Cancel',
    pinContinue: 'Continue',
    successBackToClockIn: 'Back to Clock-In',
    offlineStatusQueued: 'Offline — punch will be queued.',
    offlineStatusClockedIn: 'Offline — last known: clocked in. Punch will be queued.',
    offlineStatusClockedOut: 'Offline — last known: clocked out. Punch will be queued.',
    offlineUnsupported:
      'Offline mode is not supported on this device. Connect to the internet to clock in or out.',
    statusLoading: 'Loading…',
    statusOfflineListsLoaded: 'Offline lists loaded.',
    statusNoDataCached: 'Error: No data cached.',
    statusEmployeeNotFound: 'Employee not found.',
    statusCameraReady: 'Camera ready.',
    statusCameraUnavailable: 'Camera unavailable.',
    statusPhotoCaptured: 'Photo captured.',
    statusSavedOffline: 'Saved offline — will sync.',
    statusSavedOfflineBackOnline: 'Saved offline — will sync when back online.',
    statusSavedOfflineReenroll: 'Saved offline — re-enroll to sync.',
    statusSavedOfflineReenrollBackOnline: 'Saved offline — re-enroll to sync when back online.',
    statusPunchRecorded: 'Punch recorded.',
    statusClockedInMinutes: 'Currently CLOCKED IN — {{minutes}} minutes so far.',
    statusClockedInHours: 'Currently CLOCKED IN — {{hours}} hours so far.',
    statusCheckCurrentStatusError: 'Could not check current status. You can still punch.',
    statusSyncError: 'Could not sync punch.',
    tinyPunchConfirm: 'This shift is only {{minutes}} minutes. Clock out anyway?',
    longShiftConfirm: 'You have been clocked in for {{hours}} hours. Clock out now?',
    longShiftWarning: 'You have been clocked in for {{hours}} hours. Please clock out if your shift ended.',
    geofenceClockInWarning: 'Clock-in recorded, but you are outside the geofence.',
    geofenceBanner: 'Timesheet started outside the project geofence.',
    statusOnline: 'Online',
    statusOffline: 'Offline',
    statusSynced: 'Synced',
    statusSyncCount: 'Sync {{count}}',
    statusSyncReenroll: 'Re-enroll to sync punches',
    statusSyncOfflineTooOld: 'Queued punch too old to sync (limit {{days}} days).',
    statusSyncRateLimited: 'Sync delayed by punch rate limit - retrying in about {{seconds}}s.',
    statusSyncNeedsAdmin: 'Sync needs admin attention',
    clockingModuleDisabled: 'Clock-in is disabled for this deployment.',
    summaryCloseLabel: 'OK',
    clockOutSummaryTitle: 'Clock-out recorded.',
    clockOutSummaryOfflineTitle: 'Clock-out saved offline - will sync.',
    summaryDateLabel: 'Date',
    summaryStartLabel: 'Start',
    summaryEndLabel: 'End',
    summaryTotalLabel: 'Total hours',
    summaryUnknown: 'Unknown'
  },
  es: {
    greetMorning: 'Buenos días',
    greetAfternoon: 'Buenas tardes',
    greetEvening: 'Buenas noches',
    instructions: 'Seleccione su nombre abajo y toque el botón para comenzar o terminar su turno.',
    placeholder: 'Seleccione su nombre',
    employeeLabel: 'Empleado',
    languageLabel: 'Idioma',
    projectActiveLabel: 'Proyecto activo:',
    projectNotSetLabel: 'Sin proyecto asignado',
    projectLabel: 'Proyecto',
    projectLabelWithId: 'Proyecto {{id}}',
    employeeProjectLine: '{{name}} — Proyecto: {{project}}',
    tapIn: 'REGISTRAR ENTRADA',
    tapOut: 'REGISTRAR SALIDA',
    selectYourNameStatus: 'Seleccione su nombre.',
    projectNotSet: 'Proyecto no está configurado para esta tableta. Consulte a su supervisor para registrar entrada.',
    timesheetNotSet: 'No hay parte de trabajo para esta tableta hoy. Pida a su supervisor que elija un proyecto primero.',
    pinTitleExisting: 'PIN del empleado',
    pinTitleNew: 'Crear tu PIN',
    pinSubtitleExisting: 'Ingresa tu PIN para marcar entrada o salida.',
    pinSubtitleNew: 'Primer fichaje: crea un PIN de 4 dígitos que usarás en cualquier kiosko Avian.',
    pinPlaceholder: 'PIN',
    pinConfirmPlaceholder: 'Confirmar PIN',
    pinStatusNoPin: 'Esta persona no tiene un PIN configurado.',
    pinStatusIncorrect: 'PIN incorrecto.',
    pinStatusEnter: 'Ingresa el PIN.',
    pinStatusEnterPin: 'Ingresa tu PIN.',
    pinStatusPinOkPhoto: 'PIN OK. Toma la foto requerida.',
    pinStatusSubmitting: 'PIN correcto. Enviando...',
    pinStatusCreateBoth: 'Ingresa y confirma un PIN de 4 dígitos.',
    pinStatusDigitsOnly: 'El PIN debe tener exactamente 4 dígitos.',
    pinStatusMismatch: 'Los PIN no coinciden. Inténtalo de nuevo.',
    pinStatusSaveErr: 'No se pudo guardar el PIN. Verifica la conexión e inténtalo otra vez.',
    pinStatusPinCreatedPhoto: 'PIN creado. Toma la foto requerida.',
    pinStatusPinCreatedClocked: 'PIN creado correctamente. Ya estás registrado.',
    pinToggleShow: 'Mostrar PIN',
    pinToggleHide: 'Ocultar PIN',
    photoRequired: 'Foto requerida',
    cameraStart: 'Iniciar cámara',
    cameraTake: 'Tomar foto',
    cameraRetake: 'Repetir',
    clockInPhotoUnavailable:
      'Para fichar entrada se requiere una foto, pero esta tableta no puede acceder a la cámara.',
    pinCancel: 'Cancelar',
    pinContinue: 'Continuar',
    successBackToClockIn: 'Volver al fichaje',
    offlineStatusQueued: 'Sin conexión — la marcación quedará en cola.',
    offlineStatusClockedIn: 'Sin conexión — último estado: con entrada. La marcación quedará en cola.',
    offlineStatusClockedOut: 'Sin conexión — último estado: con salida. La marcación quedará en cola.',
    offlineUnsupported:
      'El modo sin conexión no está disponible en este dispositivo. Conéctese a internet para marcar.',
    statusLoading: 'Cargando…',
    statusOfflineListsLoaded: 'Listas sin conexión cargadas.',
    statusNoDataCached: 'Error: no hay datos en caché.',
    statusEmployeeNotFound: 'Empleado no encontrado.',
    statusCameraReady: 'Cámara lista.',
    statusCameraUnavailable: 'Cámara no disponible.',
    statusPhotoCaptured: 'Foto capturada.',
    statusSavedOffline: 'Guardado sin conexión — se sincronizará.',
    statusSavedOfflineBackOnline: 'Guardado sin conexión — se sincronizará cuando vuelva la conexión.',
    statusSavedOfflineReenroll: 'Guardado sin conexión — reinscribe para sincronizar.',
    statusSavedOfflineReenrollBackOnline: 'Guardado sin conexión — reinscribe para sincronizar cuando vuelva la conexión.',
    statusPunchRecorded: 'Marcación registrada.',
    statusClockedInMinutes: 'Actualmente REGISTRADO — {{minutes}} minutos hasta ahora.',
    statusClockedInHours: 'Actualmente REGISTRADO — {{hours}} horas hasta ahora.',
    statusCheckCurrentStatusError: 'No se pudo verificar el estado actual. Aún puedes marcar.',
    statusSyncError: 'No se pudo sincronizar la marcación.',
    tinyPunchConfirm: 'Este turno dura solo {{minutes}} minutos. ¿Registrar salida?',
    longShiftConfirm: 'Has estado registrado por {{hours}} horas. ¿Registrar salida ahora?',
    longShiftWarning: 'Has estado registrado por {{hours}} horas. Registra salida si terminó tu turno.',
    geofenceClockInWarning: 'Entrada registrada, pero estás fuera del geofence.',
    geofenceBanner: 'El parte de trabajo se inició fuera del geofence del proyecto.',
    statusOnline: 'En línea',
    statusOffline: 'Sin conexión',
    statusSynced: 'Sincronizado',
    statusSyncCount: 'Sincronizar {{count}}',
    statusSyncReenroll: 'Reinscribe para sincronizar marcaciones',
    statusSyncOfflineTooOld: 'Una marcación en cola era demasiado antigua para sincronizarse (límite {{days}} días).',
    statusSyncRateLimited: 'Sincronización retrasada por límite de marcaciones - reintentando en ~{{seconds}} s.',
    statusSyncNeedsAdmin: 'La sincronización necesita atención del administrador',
    clockingModuleDisabled: 'El registro de horas está desactivado para este despliegue.',
    summaryCloseLabel: 'Aceptar',
    clockOutSummaryTitle: 'Salida registrada.',
    clockOutSummaryOfflineTitle: 'Salida guardada sin conexion - se sincronizara.',
    summaryDateLabel: 'Fecha',
    summaryStartLabel: 'Inicio',
    summaryEndLabel: 'Fin',
    summaryTotalLabel: 'Horas totales',
    summaryUnknown: 'Desconocido'
  },
  ht: {
    greetMorning: 'Bonjou',
    greetAfternoon: 'Bon apremidi',
    greetEvening: 'Bonswa',
    instructions: 'Ekri non ou anba epi peze bouton an lew komanse ak lew fini travay',
    placeholder: 'Chwazi non ou',
    employeeLabel: 'Anplwaye',
    languageLabel: 'Lang',
    projectActiveLabel: 'Pwojè aktif:',
    projectNotSetLabel: 'Pa gen pwojè asiyen',
    projectLabel: 'Pwojè',
    projectLabelWithId: 'Pwojè {{id}}',
    employeeProjectLine: '{{name}} — Pwojè: {{project}}',
    // Chosen CTA: "FÈ PONTAJ" is short and natural for clocking in/out.
    tapIn: 'FÈ PONTAJ',
    tapOut: 'FÈ PONTAJ',
    selectYourNameStatus: 'Tanpri chwazi non ou.',
    projectNotSet: 'Pa gen pwojè sa sou tablet sa; fòk ou wè ak sipèvizè ou pou anrejistre lè ou antre.',
    timesheetNotSet: 'Pa gen fèy travay pou jodi a sou tablet sa. Wè sipèvizè a pou chwazi yon pwojè anvan.',
    pinTitleExisting: 'PIN anplwaye',
    pinTitleNew: 'Kreye PIN ou',
    pinSubtitleExisting: 'Antre PIN ou pou antre oswa soti.',
    pinSubtitleNew: 'Premye fwa w ap anrejistre — kreye yon PIN 4 chif pou nenpòt kios Avian.',
    pinPlaceholder: 'PIN',
    pinConfirmPlaceholder: 'Konfime PIN',
    pinStatusNoPin: 'Moun sa pa gen PIN ankò.',
    pinStatusIncorrect: 'PIN la pa kòrèk.',
    pinStatusEnter: 'Antre PIN la.',
    pinStatusEnterPin: 'Antre PIN ou.',
    pinStatusPinOkPhoto: 'PIN bon. Pran foto obligatwa a.',
    pinStatusSubmitting: 'PIN bon. Ap voye...',
    pinStatusCreateBoth: 'Antre epi konfime yon PIN 4 chif.',
    pinStatusDigitsOnly: 'PIN la dwe gen egzakteman 4 chif.',
    pinStatusMismatch: 'PIN yo pa menm. Eseye ankò.',
    pinStatusSaveErr: 'Pa t ka sove PIN lan. Tcheke koneksyon an epi eseye ankò.',
    pinStatusPinCreatedPhoto: 'PIN kreye. Pran foto obligatwa a.',
    pinStatusPinCreatedClocked: 'PIN kreye avèk siksè. Ou deja anrejistre.',
    pinToggleShow: 'Montre PIN',
    pinToggleHide: 'Kache PIN',
    photoRequired: 'Foto obligatwa',
    cameraStart: 'Kòmanse kamera',
    cameraTake: 'Pran foto',
    cameraRetake: 'Repran',
    clockInPhotoUnavailable:
      'Pou antre, foto obligatwa, men tablèt sa pa ka sèvi ak kamera.',
    pinCancel: 'Anile',
    pinContinue: 'Kontinye',
    successBackToClockIn: 'Retounen pou antre lè',
    offlineStatusQueued: 'San koneksyon — makaj la pral antre nan liy.',
    offlineStatusClockedIn: 'San koneksyon — dènye eta: antre. Makaj la pral antre nan liy.',
    offlineStatusClockedOut: 'San koneksyon — dènye eta: sòti. Makaj la pral antre nan liy.',
    offlineUnsupported:
      'Mòd san koneksyon pa disponib sou aparèy sa. Konekte sou entènèt pou anrejistre.',
    statusLoading: 'Ap chaje…',
    statusOfflineListsLoaded: 'Lis san koneksyon chaje.',
    statusNoDataCached: 'Erè: pa gen done nan kach.',
    statusEmployeeNotFound: 'Anplwaye pa jwenn.',
    statusCameraReady: 'Kamera pare.',
    statusCameraUnavailable: 'Kamera pa disponib.',
    statusPhotoCaptured: 'Foto pran.',
    statusSavedOffline: 'Sove san koneksyon — pral senkronize.',
    statusSavedOfflineBackOnline: 'Sove san koneksyon — pral senkronize lè koneksyon tounen.',
    statusSavedOfflineReenroll: 'Sove san koneksyon — re-anrejistre pou senkronize.',
    statusSavedOfflineReenrollBackOnline: 'Sove san koneksyon — re-anrejistre pou senkronize lè koneksyon tounen.',
    statusPunchRecorded: 'Makaj anrejistre.',
    statusClockedInMinutes: 'Kounye a ANTRE — {{minutes}} minit jiska kounye a.',
    statusClockedInHours: 'Kounye a ANTRE — {{hours}} èdtan jiska kounye a.',
    statusCheckCurrentStatusError: 'Nou pa ka verifye estati a. Ou ka toujou make.',
    statusSyncError: 'Pa t ka senkronize makaj la.',
    tinyPunchConfirm: 'Chèf sa dire sèlman {{minutes}} minit. Fè sòti kanmenm?',
    longShiftConfirm: 'Ou sou lè depi {{hours}} è. Fè sòti kounye a?',
    longShiftWarning: 'Ou sou lè depi {{hours}} è. Fè sòti si jounen travay la fini.',
    geofenceClockInWarning: 'Antre anrejistre, men ou deyò geofence la.',
    geofenceBanner: 'Fich travay la te kòmanse deyò geofence pwojè a.',
    statusOnline: 'Sou entènèt',
    statusOffline: 'San koneksyon',
    statusSynced: 'Senkronize',
    statusSyncCount: 'Senkronize {{count}}',
    statusSyncReenroll: 'Re-anrejistre pou senkronize makaj yo',
    statusSyncOfflineTooOld: 'Yon makaj ki nan lis la twò ansyen pou senkronize (limit {{days}} jou).',
    statusSyncRateLimited: 'Senkronizasyon retade pa limit makaj - ap eseye ankò nan apeprè {{seconds}}s.',
    statusSyncNeedsAdmin: 'Senkronizasyon bezwen atansyon admin',
    clockingModuleDisabled: 'Antre sòti anrejistre pou aplikasyon sa a dezaktive.',
    summaryCloseLabel: 'Dakò',
    clockOutSummaryTitle: 'Fini travay anrejistre.',
    clockOutSummaryOfflineTitle: 'Fini travay sove offline - ap senkronize.',
    summaryDateLabel: 'Dat',
    summaryStartLabel: 'Komanse',
    summaryEndLabel: 'Fini',
    summaryTotalLabel: 'Total edtan',
    summaryUnknown: 'Enkoni'
  }
};
const DEFAULT_LANGUAGE = 'en';
const PUNCH_DEDUP_WINDOW_MS = 2500;
const CLOCK_OUT_SUMMARY_DURATION_MS = 12000;
const TINY_PUNCH_MINUTES = 5;
const LONG_SHIFT_WARNING_HOURS = 12;

const CSRF_TOKEN_KEY = 'avian_csrf_token_v1';
let csrfToken = null;

function kioskLoadCsrfToken() {
  if (csrfToken) return csrfToken;
  try {
    const stored = localStorage.getItem(CSRF_TOKEN_KEY);
    if (stored) csrfToken = stored;
  } catch {
    // ignore storage failures
  }
  return csrfToken;
}

function kioskStoreCsrfToken(token) {
  if (!token) return;
  csrfToken = token;
  try {
    localStorage.setItem(CSRF_TOKEN_KEY, token);
  } catch {
    // ignore storage failures
  }
}


let employeesCache = [];
let projectsCache = [];
let currentProjectName = '';
let currentEmployee = null;
let currentLanguage = DEFAULT_LANGUAGE;
let manualLanguageOverride = null;
let manualLanguageEmployeeId = null;
let employeeSelectStartValue = '';
let employeeSelectChanged = false;
let pinValidated = false;
let currentPhotoBase64 = null;
let cameraStream = null;
let pinSetupMode = false;
let pinFirstEntry = '';
let kioskDeviceId = null;
let kioskConfig = {
  id: null,
  name: '',
  project_id: null
};
let kioskSessions = [];
let kioskSessionsLoaded = false;
let activeSessionId = null;
let justCreatedPin = false;
let offlineSyncTimerId = null;
let offlineSyncInFlight = false;
let syncWarning = null;
let punchInFlight = false;

const EN_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ES_WEEKDAYS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const ES_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const HT_WEEKDAYS = ['lendi', 'madi', 'mèkredi', 'jedi', 'vandredi', 'samdi', 'dimanch'];
const HT_MONTHS = [
  'janvye',
  'fevriye',
  'mas',
  'avril',
  'me',
  'jen',
  'jiyè',
  'out',
  'septanm',
  'oktòb',
  'novanm',
  'desanm'
];
let lastPunchMeta = null;
let kioskEnrolled = false;
let clockInPhotoRequired = loadClockInPhotoRequired() ?? false;
let kioskTimezone = null;
let kioskRefreshIntervalId = null;
let headerClockTimerId = null;
let headerClockTimeoutId = null;
const KIOSK_SECTION_FEATURE_DEFAULTS = { time: true, payroll: true, shipments: true };
let kioskSectionFeatures = { ...KIOSK_SECTION_FEATURE_DEFAULTS };

function setPinToggleState(button, isVisible) {
  if (!button) return;
  const nextLabel = isVisible ? getCopy('pinToggleHide') : getCopy('pinToggleShow');
  button.dataset.state = isVisible ? 'visible' : 'hidden';
  button.setAttribute('aria-pressed', isVisible ? 'true' : 'false');
  button.setAttribute('aria-label', nextLabel);
  const labelEl = button.querySelector('[data-pin-toggle-label]');
  if (labelEl) labelEl.textContent = nextLabel;
}

function kioskCoerceSectionFlag(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 1 || value === '1' || value === 'true';
}

function kioskNormalizeSectionFeatures(raw = {}) {
  const next = raw && typeof raw === 'object' ? raw : {};
  return {
    time: kioskCoerceSectionFlag(next.time, KIOSK_SECTION_FEATURE_DEFAULTS.time),
    payroll: kioskCoerceSectionFlag(next.payroll, KIOSK_SECTION_FEATURE_DEFAULTS.payroll),
    shipments: kioskCoerceSectionFlag(next.shipments, KIOSK_SECTION_FEATURE_DEFAULTS.shipments)
  };
}

function isKioskSectionEnabled(sectionName) {
  return kioskCoerceSectionFlag(kioskSectionFeatures?.[sectionName], true);
}

function applyClockingModuleDisabledState() {
  const status = document.getElementById('kiosk-status');
  const employeeSelect = document.getElementById('kiosk-employee');
  const punchBtn = document.getElementById('kiosk-punch');
  const langSwitch = document.querySelector('.lang-switch');
  const logoHotspot =
    document.getElementById('kiosk-logo-hotspot') ||
    (document.querySelector('.glass-logo') &&
      document.querySelector('.glass-logo').querySelector('.logo-hotspot'));

  if (status) {
    status.textContent = getCopy('clockingModuleDisabled');
    status.className = 'glass-status kiosk-status kiosk-status-error';
  }
  if (employeeSelect) {
    employeeSelect.disabled = true;
  }
  if (punchBtn) {
    punchBtn.disabled = true;
  }
  if (langSwitch) {
    langSwitch.style.display = 'none';
  }
  if (logoHotspot) {
    logoHotspot.style.pointerEvents = 'none';
    logoHotspot.style.opacity = '0.7';
  }
}

// ====== BASIC HELPERS ======

function kioskDebug(...args) {
  if (!KIOSK_DEBUG) return;
  const line = args
    .map(val => {
      if (val === null || val === undefined) return String(val);
      if (typeof val === 'string') return val;
      try {
        return JSON.stringify(val);
      } catch {
        return String(val);
      }
    })
    .join(' ');
  console.log('[kiosk]', ...args);
  debugLines.push(line);
  while (debugLines.length > DEBUG_MAX_LINES) debugLines.shift();
  if (!debugEl && document && document.body) {
    debugEl = document.createElement('div');
    debugEl.id = 'kiosk-debug';
    debugEl.style.cssText = [
      'position:fixed',
      'bottom:12px',
      'left:12px',
      'z-index:99999',
      'max-width:60vw',
      'padding:8px 10px',
      'background:rgba(15,23,42,0.85)',
      'color:#e2e8f0',
      'font:12px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      'border-radius:8px',
      'box-shadow:0 4px 14px rgba(0,0,0,0.35)',
      'white-space:pre-wrap'
    ].join(';');
    document.body.appendChild(debugEl);
  }
  if (debugEl) {
    debugEl.textContent = debugLines.join('\n');
  }
}

let successTimeout = null;
let successDefaultCloseLabel = null;

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
  ['pin-input', 'pin-confirm-input', 'admin-login-pin', 'kiosk-enroll-input'].forEach(id => {
    disableAutofillPinInput(document.getElementById(id));
  });
}

function showSuccessOverlay(message, durationMs = 5000, closeLabel = null) {  // ⬅️ 5 seconds default
  const backdrop = document.getElementById('success-backdrop');
  const msgEl = document.getElementById('success-message');
  const closeBtn = document.getElementById('success-close-btn');
  const closeLabelEl = document.getElementById('success-close-label');

  if (!backdrop || !msgEl) return;

  msgEl.textContent = message;

  if (successDefaultCloseLabel === null && closeLabelEl) {
    successDefaultCloseLabel = closeLabelEl.textContent || '';
  }
  if (closeLabelEl) {
    closeLabelEl.textContent = closeLabel || successDefaultCloseLabel || 'OK';
  }

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
  const nativeConfirm = window.confirm && window.confirm.bind(window);
  window.alert = function kioskAlert(message) {
    showSuccessOverlay(String(message || ''));
  };
  window.confirm = function kioskConfirm(message) {
    if (nativeConfirm) return nativeConfirm(String(message || ''));
    return false;
  };
  window.prompt = function kioskPrompt(message) {
    showSuccessOverlay(String(message || ''));
    return null;
  };
}
overrideNativeDialogs();

function storeGet(key, fallback) {
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

function storeSet(key, value) {
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

function loadOpenPunchCache() {
  const cache = storeGet(OPEN_PUNCH_CACHE_KEY, {});
  if (!cache || typeof cache !== 'object' || Array.isArray(cache)) return {};
  return cache;
}

function saveOpenPunchCache(cache) {
  storeSet(OPEN_PUNCH_CACHE_KEY, cache || {});
}

function getCachedOpenPunch(employeeId) {
  if (!employeeId) return null;
  const cache = loadOpenPunchCache();
  const entry = cache[String(employeeId)];
  if (!entry || typeof entry !== 'object') return null;
  return {
    open: !!entry.open,
    clock_in_ts: entry.clock_in_ts || null,
    updated_at: entry.updated_at || null
  };
}

function setCachedOpenPunch(employeeId, payload) {
  if (!employeeId) return;
  const cache = loadOpenPunchCache();
  cache[String(employeeId)] = {
    open: !!(payload && payload.open),
    clock_in_ts: payload && payload.clock_in_ts ? String(payload.clock_in_ts) : null,
    updated_at: new Date().toISOString()
  };
  saveOpenPunchCache(cache);
}

function canUseLocalStorage() {
  try {
    const key = '__avian_local_storage_test__';
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

const pinThrottleState = {
  worker: { fails: 0, nextAllowedAt: 0, timer: null },
  admin: { fails: 0, nextAllowedAt: 0, timer: null }
};

function computePinThrottleDelay(fails) {
  if (fails < PIN_THROTTLE_START_AFTER) return 0;
  const step = Math.min(fails - PIN_THROTTLE_START_AFTER, 3);
  const delay = PIN_THROTTLE_BASE_MS * Math.pow(2, step);
  return Math.min(delay, PIN_THROTTLE_MAX_MS);
}

function getPinThrottleRemaining(kind) {
  const state = pinThrottleState[kind];
  if (!state) return 0;
  const remaining = state.nextAllowedAt - Date.now();
  return remaining > 0 ? remaining : 0;
}

function schedulePinThrottle(kind, elements, delayMs) {
  const state = pinThrottleState[kind];
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

function registerPinFailure(kind, elements = []) {
  const state = pinThrottleState[kind];
  if (!state) return 0;
  state.fails += 1;
  const delay = computePinThrottleDelay(state.fails);
  if (delay > 0) {
    state.nextAllowedAt = Date.now() + delay;
    schedulePinThrottle(kind, elements, delay);
  }
  return delay;
}

function resetPinFailures(kind) {
  const state = pinThrottleState[kind];
  if (!state) return;
  state.fails = 0;
  state.nextAllowedAt = 0;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

function enforcePinThrottle(kind, elements = []) {
  const remaining = getPinThrottleRemaining(kind);
  if (remaining <= 0) return false;
  schedulePinThrottle(kind, elements, remaining);
  return true;
}

const pinCryptoKeyCache = {
  secret: null,
  promise: null
};

function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach(b => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function getPinCryptoKey(secret) {
  if (!secret || !window.crypto || !window.crypto.subtle) return null;
  if (pinCryptoKeyCache.secret === secret && pinCryptoKeyCache.promise) {
    return pinCryptoKeyCache.promise;
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
      salt: enc.encode(PIN_CRYPTO_SALT),
      iterations: PIN_CRYPTO_ITERATIONS,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  pinCryptoKeyCache.secret = secret;
  pinCryptoKeyCache.promise = keyPromise;
  return keyPromise;
}

async function encryptPinForStore(pin, secret) {
  if (!pin || !secret || !window.crypto || !window.crypto.subtle) return null;
  const key = await getPinCryptoKey(secret);
  if (!key) return null;
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const cipherBuf = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(String(pin))
  );
  const cipherBytes = new Uint8Array(cipherBuf);
  return `${PIN_CRYPTO_VERSION}:${bytesToBase64(iv)}:${bytesToBase64(cipherBytes)}`;
}

async function decryptPinFromStore(token, secret) {
  if (!token || !secret || !window.crypto || !window.crypto.subtle) return null;
  const parts = String(token).split(':');
  if (parts.length !== 3 || parts[0] !== PIN_CRYPTO_VERSION) return null;
  const key = await getPinCryptoKey(secret);
  if (!key) return null;
  try {
    const iv = base64ToBytes(parts[1]);
    const data = base64ToBytes(parts[2]);
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
  kioskDebug('fetchJSON', { url, method: opts.method || 'GET' });
  const timeoutMsRaw = opts.timeoutMs;
  delete opts.timeoutMs;
  const timeoutMs = Number(timeoutMsRaw);
  let timeoutId = null;
  let controller = null;
  if (Number.isFinite(timeoutMs) && timeoutMs > 0 && typeof AbortController !== 'undefined') {
    controller = new AbortController();
    if (!opts.signal) opts.signal = controller.signal;
    timeoutId = setTimeout(() => {
      try {
        controller.abort();
      } catch {
        // ignore abort errors
      }
    }, timeoutMs);
  }
  const method = (opts.method || 'GET').toUpperCase();
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const headers = new Headers(opts.headers || {});
  const token = kioskLoadCsrfToken();
  if (unsafe && token && !headers.get('X-CSRF-Token')) {
    headers.set('X-CSRF-Token', token);
  }
  opts.headers = headers;

  const needsDeviceAuth =
    url.startsWith('/api/kiosk') || url.startsWith('/api/kiosks');
  const deviceId = kioskDeviceId || getOrCreateDeviceId();
  const deviceSecret = getOrCreateDeviceSecret();

  if (needsDeviceAuth && deviceId && deviceSecret) {
    if (!headers.get('X-Kiosk-Device-Id')) headers.set('X-Kiosk-Device-Id', deviceId);
    if (!headers.get('X-Kiosk-Device-Secret')) headers.set('X-Kiosk-Device-Secret', deviceSecret);

    const contentType = headers.get('Content-Type') || headers.get('content-type') || '';
    if (method !== 'GET' && /application\/json/i.test(contentType)) {
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
      opts.body = JSON.stringify(body);
    }
  }

  try {
    const res = await fetch(url, opts);
    const nextToken = res.headers.get('X-CSRF-Token');
    if (nextToken) kioskStoreCsrfToken(nextToken);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || data.message || 'Request failed');
      err.data = data;
      err.status = res.status;
      err.statusText = res.statusText;
      throw err;
    }
    return data;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      const timeoutErr = new Error('Request timed out');
      timeoutErr.code = 'ETIMEDOUT';
      throw timeoutErr;
    }
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function makeClientId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : 'p_' +
      Date.now().toString(36) +
      '_' +
      Math.random().toString(36).slice(2);
}

async function verifyAdminPinWithServer(adminId, pin) {
  if (!adminId || !pin) return false;
  try {
    const res = await fetchJSON('/api/kiosk/admin/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_id: adminId, pin })
    });
    return !!(res && res.ok);
  } catch (err) {
    return false;
  }
}

function getRecentPunchClientId(employeeId, intendedMode) {
  if (!lastPunchMeta) return null;
  const now = Date.now();
  if (now - lastPunchMeta.at > PUNCH_DEDUP_WINDOW_MS) return null;
  if (String(lastPunchMeta.employeeId) !== String(employeeId)) return null;
  if (lastPunchMeta.intendedMode !== intendedMode) return null;
  return lastPunchMeta.clientId;
}

function recordPunchClientId(employeeId, intendedMode, clientId) {
  lastPunchMeta = {
    employeeId: String(employeeId),
    intendedMode,
    clientId,
    at: Date.now()
  };
}

function getBcrypt() {
  if (window.dcodeIO && window.dcodeIO.bcrypt) return window.dcodeIO.bcrypt;
  if (window.bcrypt) return window.bcrypt;
  return null;
}

function verifyPinHash(pin, hash) {
  const bcrypt = getBcrypt();
  if (!bcrypt || !hash) return false;
  try {
    return bcrypt.compareSync(String(pin || '').trim(), String(hash));
  } catch {
    return false;
  }
}

function hashPin(pin) {
  const bcrypt = getBcrypt();
  if (!bcrypt) return null;
  try {
    const salt = bcrypt.genSaltSync(10);
    return bcrypt.hashSync(String(pin || '').trim(), salt);
  } catch {
    return null;
  }
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
  const list = storeGet(PENDING_PIN_KEY, []);
  return Array.isArray(list) ? list : [];
}

function savePendingPins(list) {
  storeSet(PENDING_PIN_KEY, list || []);
  updateOfflineIndicator();
}

async function migratePendingPins() {
  const list = loadPendingPins();
  if (!list.length) return;
  let changed = false;
  for (const item of list) {
    if (item && item.pin && !item.pin_cipher) {
      const secret =
        (item.device_secret || '').trim() ||
        getOrCreateDeviceSecret();
      try {
        const cipher = await encryptPinForStore(item.pin, secret);
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
  if (changed) savePendingPins(list);
}

async function addPendingPinUpdate(update) {
  // update = { employee_id, pin }
  const list = loadPendingPins();
  const deviceId = kioskDeviceId || getOrCreateDeviceId();
  const deviceSecret = getOrCreateDeviceSecret();
  let pinCipher = null;
  try {
    const secret = deviceSecret;
    pinCipher = await encryptPinForStore(update.pin, secret);
  } catch {
    pinCipher = null;
  }
  list.push({
    client_id: makeClientId(),
    employee_id: update.employee_id,
    ...(pinCipher ? { pin_cipher: pinCipher } : { pin: update.pin }),
    created_at: new Date().toISOString(),
    device_id: deviceId,
    device_secret: deviceSecret
  });
  savePendingPins(list);
}



function loadQueue() {
  const list = storeGet(QUEUE_KEY, []);
  return Array.isArray(list) ? list : [];
}

function saveQueue(q) {
  storeSet(QUEUE_KEY, q || []);
  updateOfflineIndicator();
}
function addToQueue(punch) {
  const q = loadQueue();
  const entry = Object.assign({}, punch);
  if (!entry.queued_at) {
    entry.queued_at = new Date().toISOString();
  }
  if (q.some(p => p && p.client_id === entry.client_id)) {
    return;
  }
  q.push(entry);
  saveQueue(q);
}
function removeFromQueue(id) {
  saveQueue(loadQueue().filter(p => p.client_id !== id));
}

function getOfflineQueueCount() {
  const punchCount = loadQueue().length;
  const pinCount = loadPendingPins().length;
  return punchCount + pinCount;
}

function updateOfflineIndicator() {
  const connectionEl = document.getElementById('kiosk-connection-status');
  const syncEl = document.getElementById('kiosk-sync-status');
  const online = navigator.onLine;
  if (connectionEl) {
    connectionEl.textContent = online ? getCopy('statusOnline') : getCopy('statusOffline');
    connectionEl.classList.toggle('is-offline', !online);
  }
  if (syncEl) {
    if (!offlineStorageSupported && !online) {
      syncEl.textContent = getCopy('offlineUnsupported');
      syncEl.classList.add('has-pending');
      return;
    }
    const count = getOfflineQueueCount();
    if (syncWarning && count > 0) {
      syncEl.textContent = syncWarning;
      syncEl.classList.add('has-pending');
    } else {
      syncEl.textContent = count
        ? formatCopy('statusSyncCount', { count })
        : getCopy('statusSynced');
      syncEl.classList.toggle('has-pending', count > 0);
      if (count === 0) syncWarning = null;
    }
  }
}

function setSyncWarning(message) {
  if (!message) return;
  syncWarning = String(message);
  updateOfflineIndicator();
}

function clearSyncWarning() {
  if (!syncWarning) return;
  syncWarning = null;
  updateOfflineIndicator();
}

function isConnectionIssue(err, message) {
  const status = err && (err.status || err.code);
  const msg = String(message || (err && err.message) || '').toLowerCase();
  const networkish = /network|failed to fetch|offline|connection|timed out/.test(msg);
  const serverDown = typeof status === 'number' && status >= 500;
  return !navigator.onLine || networkish || serverDown;
}

function isHardPunchQueueError(err) {
  const status = err && err.status;
  if (typeof status !== 'number') return false;

  if (status === 401 || status === 403) return false;
  if (status === 429) return false;
  if (status >= 500) return false;
  return status >= 400 && status < 500;
}

function getRetryAfterSeconds(err) {
  const retryAfter = Number(err && err.data && err.data.retry_after_seconds);
  if (!Number.isFinite(retryAfter) || retryAfter <= 0) return null;
  return Math.max(1, Math.ceil(retryAfter));
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
  return getDeviceSecret() || '';
}

function setKioskAdminCookie(name, value) {
  if (!value) return;
  const safeName = encodeURIComponent(String(name));
  const safeValue = encodeURIComponent(String(value));
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${safeName}=${safeValue}; Max-Age=900; Path=/; SameSite=Strict${secure}`;
}

function primeKioskAdminCookies(deviceId, deviceSecret) {
  if (deviceId) {
    setKioskAdminCookie('kiosk_device_id', deviceId);
  }
  if (deviceSecret) {
    setKioskAdminCookie('kiosk_device_secret', deviceSecret);
  }
}

function loadKioskTimezone() {
  try {
    return localStorage.getItem(ORG_TIMEZONE_KEY) || DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function loadClockInPhotoRequired() {
  try {
    const raw = localStorage.getItem(CLOCK_IN_PHOTO_REQUIRED_KEY);
    if (raw === null || raw === undefined) return null;
    return raw === '1' || raw === 'true';
  } catch {
    return null;
  }
}

function saveClockInPhotoRequired(value) {
  try {
    localStorage.setItem(CLOCK_IN_PHOTO_REQUIRED_KEY, value ? '1' : '0');
  } catch {
    // ignore storage failures
  }
}

function setOrgSuspendedFlag(isSuspended) {
  try {
    localStorage.setItem(ORG_SUSPENDED_KEY, isSuspended ? '1' : '0');
  } catch {
    // ignore
  }
}

function isOrgSuspendedFlag() {
  try {
    const raw = localStorage.getItem(ORG_SUSPENDED_KEY);
    return raw === '1' || raw === 'true';
  } catch {
    return false;
  }
}

function saveKioskCache(data) {
  if (!data || !data.kiosk) return;
  const payload = {
    kiosk: data.kiosk,
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
    active_session_id: data.active_session_id || null,
    org_timezone: data.org_timezone || kioskTimezone || DEFAULT_TIMEZONE,
    cached_at: new Date().toISOString()
  };
  try {
    localStorage.setItem(KIOSK_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage failures
  }
}

function loadKioskCache() {
  try {
    const raw = localStorage.getItem(KIOSK_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.kiosk) return null;
    if (parsed.kiosk.device_id && kioskDeviceId && parsed.kiosk.device_id !== kioskDeviceId) {
      return null;
    }
    const tz = parsed.org_timezone || kioskTimezone || DEFAULT_TIMEZONE;
    const today = getTodayIsoInTimezone(tz);
    const sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions.filter(s => (s.date || '').slice(0, 10) === today)
      : [];
    const activeId = parsed.active_session_id;
    const activeSessionId = sessions.some(s => Number(s.id) === Number(activeId))
      ? activeId
      : null;
    return {
      ...parsed,
      sessions,
      active_session_id: activeSessionId
    };
  } catch {
    return null;
  }
}

function setKioskTimezone(tz) {
  const safe = tz || DEFAULT_TIMEZONE;
  kioskTimezone = safe;
  try {
    localStorage.setItem(ORG_TIMEZONE_KEY, safe);
  } catch {
    // ignore storage failures
  }
  updateKioskDateTime();
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

function formatCopy(key, vars = {}) {
  const template = getCopy(key);
  if (!vars || typeof template !== 'string') return template;
  return Object.keys(vars).reduce((out, token) => {
    return out.replace(new RegExp(`{{\\s*${token}\\s*}}`, 'g'), String(vars[token]));
  }, template);
}

function normalizeLanguage(lang) {
  if (!lang) return 'en';
  const normalized = String(lang).toLowerCase();
  return LANG_COPY[normalized] ? normalized : 'en';
}

function getLocaleForLanguage(lang) {
  const normalized = normalizeLanguage(lang);
  if (normalized === 'es') return 'es-PR';
  if (normalized === 'ht') return 'ht-HT';
  return 'en-US';
}

function formatNumber(value, options = {}) {
  const locale = getLocaleForLanguage(currentLanguage);
  try {
    return new Intl.NumberFormat(locale, options).format(value);
  } catch {
    return String(value);
  }
}

function getZonedDateParts(value) {
  const safeTime = value instanceof Date ? value : new Date(value);
  const tz = kioskTimezone || DEFAULT_TIMEZONE;
  const parts = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
    timeZone: tz
  }).formatToParts(safeTime);
  let weekdayPart = '';
  let monthPart = '';
  let dayPart = '';
  for (const part of parts) {
    if (part.type === 'weekday') weekdayPart = part.value;
    if (part.type === 'month') monthPart = part.value;
    if (part.type === 'day') dayPart = part.value;
  }
  const weekdayIndex = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6
  }[weekdayPart] ?? safeTime.getDay();
  const monthIndex = Math.max(0, Math.min(11, Number(monthPart || 1) - 1));
  return {
    safeTime,
    day: Number(dayPart),
    weekdayIndex,
    monthIndex
  };
}

function formatTimeForLocale(value, lang) {
  const safeTime = value instanceof Date ? value : new Date(value);
  const tz = kioskTimezone || DEFAULT_TIMEZONE;
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: tz
  }).formatToParts(safeTime);
  let hour = '';
  let minute = '';
  let dayPeriod = '';
  for (const part of parts) {
    if (part.type === 'hour') hour = part.value;
    if (part.type === 'minute') minute = part.value;
    if (part.type === 'dayPeriod') dayPeriod = part.value;
  }
  if (lang === 'es') {
    const suffix = dayPeriod.toLowerCase() === 'pm' ? 'p. m.' : 'a. m.';
    return `${hour}:${minute} ${suffix}`;
  }
  const suffix = dayPeriod.toLowerCase() === 'pm' ? 'PM' : 'AM';
  return `${hour}:${minute} ${suffix}`;
}

function formatKioskDateTime(now) {
  const safeTime = now instanceof Date ? now : new Date();
  const locale = getLocaleForLanguage(currentLanguage);
  try {
    const { day, weekdayIndex, monthIndex } = getZonedDateParts(safeTime);
    const timePart = formatTimeForLocale(safeTime, currentLanguage);
    if (currentLanguage === 'es') {
      return `${ES_WEEKDAYS[weekdayIndex]}, ${day} ${ES_MONTHS[monthIndex]} – ${timePart}`;
    }
    if (currentLanguage === 'ht') {
      return `${HT_WEEKDAYS[weekdayIndex]} ${day} ${HT_MONTHS[monthIndex]} – ${timePart}`;
    }
    return `${EN_WEEKDAYS[weekdayIndex]}, ${EN_MONTHS[monthIndex]} ${day} – ${timePart}`;
  } catch {
    return safeTime.toLocaleString(locale, { hour12: true });
  }
}

function formatKioskDate(value) {
  if (!value) return getCopy('summaryUnknown');
  const safeTime = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(safeTime.getTime())) return getCopy('summaryUnknown');
  const locale = getLocaleForLanguage(currentLanguage);
  try {
    const { day, weekdayIndex, monthIndex } = getZonedDateParts(safeTime);
    if (currentLanguage === 'es') {
      return `${ES_WEEKDAYS[weekdayIndex]}, ${day} ${ES_MONTHS[monthIndex]}`;
    }
    if (currentLanguage === 'ht') {
      return `${HT_WEEKDAYS[weekdayIndex]} ${day} ${HT_MONTHS[monthIndex]}`;
    }
    return `${EN_WEEKDAYS[weekdayIndex]}, ${EN_MONTHS[monthIndex]} ${day}`;
  } catch {
    return safeTime.toLocaleDateString(locale);
  }
}

function formatKioskTime(value) {
  if (!value) return getCopy('summaryUnknown');
  const safeTime = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(safeTime.getTime())) return getCopy('summaryUnknown');
  const tz = kioskTimezone || DEFAULT_TIMEZONE;
  const locale = getLocaleForLanguage(currentLanguage);
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: tz
    }).format(safeTime);
  } catch {
    return safeTime.toLocaleTimeString([], { hour12: true });
  }
}

function computeHoursFromRange(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date)) return null;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const diffMs = end - start;
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  const minutes = Math.ceil(diffMs / 60000);
  return minutes / 60;
}

function computeMinutesFromRange(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date)) return null;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const diffMs = end - start;
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  return Math.ceil(diffMs / 60000);
}

function buildClockOutSummary({ startIso, endIso, hours, offline }) {
  const start = startIso ? new Date(startIso) : null;
  const end = endIso ? new Date(endIso) : null;
  const unknown = getCopy('summaryUnknown');
  const hasStart = start instanceof Date && !Number.isNaN(start.getTime());
  const hasEnd = end instanceof Date && !Number.isNaN(end.getTime());
  const startDateLabel = hasStart ? formatKioskDate(start) : null;
  const endDateLabel = hasEnd ? formatKioskDate(end) : null;
  let dateLabel = startDateLabel || endDateLabel || unknown;
  if (startDateLabel && endDateLabel && startDateLabel !== endDateLabel) {
    dateLabel = `${startDateLabel} -> ${endDateLabel}`;
  }

  const startTimeLabel = hasStart ? formatKioskTime(start) : unknown;
  const endTimeLabel = hasEnd ? formatKioskTime(end) : unknown;
  const resolvedHours = Number.isFinite(hours)
    ? Number(hours)
    : computeHoursFromRange(start, end);
  const hoursLabel = Number.isFinite(resolvedHours)
    ? formatNumber(resolvedHours, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : unknown;
  const header = offline
    ? getCopy('clockOutSummaryOfflineTitle')
    : getCopy('clockOutSummaryTitle');

  return [
    header,
    `${getCopy('summaryDateLabel')}: ${dateLabel}`,
    `${getCopy('summaryStartLabel')}: ${startTimeLabel}`,
    `${getCopy('summaryEndLabel')}: ${endTimeLabel}`,
    `${getCopy('summaryTotalLabel')}: ${hoursLabel}`
  ].join('\n');
}

function showClockOutSummary({ startIso, endIso, hours, offline }) {
  const message = buildClockOutSummary({ startIso, endIso, hours, offline });
  showSuccessOverlay(message, CLOCK_OUT_SUMMARY_DURATION_MS, getCopy('summaryCloseLabel'));
}

function updateKioskDateTime() {
  const el = document.getElementById('kiosk-datetime');
  if (!el) return;
  el.textContent = formatKioskDateTime(new Date());
}

function startHeaderClock() {
  if (headerClockTimerId) clearInterval(headerClockTimerId);
  if (headerClockTimeoutId) clearTimeout(headerClockTimeoutId);
  updateKioskDateTime();
  const now = new Date();
  const msToNextMinute = 60000 - (now.getSeconds() * 1000 + now.getMilliseconds());
  headerClockTimeoutId = setTimeout(() => {
    updateKioskDateTime();
    headerClockTimerId = setInterval(updateKioskDateTime, 60000);
  }, msToNextMinute);
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
  const openSessions = sorted.filter(s => !s?.ended_at);

  const normalizedSessionId =
    sessionId !== null && sessionId !== undefined ? Number(sessionId) : null;
  const normalizedProjectId =
    kioskProjectId !== null && kioskProjectId !== undefined ? Number(kioskProjectId) : null;
  const validSessionId = Number.isFinite(normalizedSessionId) ? normalizedSessionId : null;
  const validProjectId = Number.isFinite(normalizedProjectId) ? normalizedProjectId : null;

  if (validSessionId !== null) {
    const matchById = openSessions.find(s => Number(s.id) === validSessionId);
    if (matchById && (validProjectId === null || Number(matchById.project_id) === validProjectId)) {
      return matchById;
    }
  }

  if (validProjectId !== null) {
    const matchByProject = openSessions.find(
      s => Number(s.project_id) === validProjectId
    );
    if (matchByProject) return matchByProject;
  }

  return openSessions[0] || null;
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
    return formatCopy('projectLabelWithId', { id: active.project_id });
  }

  const projectId = kioskConfig && kioskConfig.project_id;
    if (projectId) {
      const fromCache = getProjectNameById(projectId);
      if (fromCache) return fromCache;
      if (kioskConfig && kioskConfig.project_name) return kioskConfig.project_name;
    return formatCopy('projectLabelWithId', { id: projectId });
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
    ? currentProjectName || getActiveProjectLabel() || getCopy('projectLabel')
    : getCopy('projectNotSetLabel');

  if (projectNameEl) projectNameEl.textContent = label;
}

function updateGeofenceBanner() {
  const banner = document.getElementById('kiosk-geo-banner');
  if (!banner) return;
  const active = getActiveSession();
  const violation = !!(active && active.geo_violation);
  if (!violation) {
    banner.textContent = '';
    banner.classList.add('hidden');
    return;
  }
  let text = getCopy('geofenceBanner');
  const distance = Number(active.geo_distance_m);
  const radius = Number(active.geo_radius);
  if (Number.isFinite(distance) && Number.isFinite(radius)) {
    text += ` (distance ~${Math.round(distance)}m, radius ${Math.round(radius)}m)`;
  }
  banner.textContent = text;
  banner.classList.remove('hidden');
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

function setPunchButtonLabel(button, label) {
  if (!button) return;
  const labelEl = button.querySelector('.kiosk-btn-label');
  if (labelEl) {
    const isSpanish = currentLanguage === 'es';
    labelEl.classList.toggle('kiosk-btn-label-es', isSpanish);
    labelEl.textContent = label;
    if (isSpanish) {
      labelEl.style.fontSize = 'clamp(0.8rem, 3.1vw, 1rem)';
      labelEl.style.letterSpacing = '0.09em';
      labelEl.style.lineHeight = '1.1';
      labelEl.style.whiteSpace = 'pre-line';
      labelEl.style.textAlign = 'center';
      labelEl.style.width = '100%';
    } else {
      labelEl.style.fontSize = '';
      labelEl.style.letterSpacing = '';
      labelEl.style.lineHeight = '';
      labelEl.style.whiteSpace = '';
      labelEl.style.textAlign = '';
      labelEl.style.width = '';
    }
  } else {
    button.textContent = label;
  }
}

function setDefaultPunchButton(button) {
  if (!button) return;
  button.classList.remove('kiosk-btn-danger');
  button.classList.add('btn-primary');
  setPunchButtonLabel(button, getCopy('tapIn'));
  button.dataset.mode = 'clock_in';
}

function setClockOutButton(button) {
  if (!button) return;
  setPunchButtonLabel(button, getCopy('tapOut'));
  button.classList.add('kiosk-btn-danger');
  button.classList.remove('btn-primary');
  button.dataset.mode = 'clock_out';
}

function isClockInMode() {
  const button = document.getElementById('kiosk-punch');
  if (!button) return true;
  return button.dataset.mode !== 'clock_out';
}

function setLanguage(lang) {
  const nextLang = normalizeLanguage(lang);
  currentLanguage = nextLang;
  document.documentElement.lang = nextLang;
  document.body && document.body.setAttribute('data-lang', nextLang);
  applyGreeting();
  const punchBtn = document.getElementById('kiosk-punch');
  if (punchBtn) {
    const mode = punchBtn.dataset.mode === 'clock_out' ? 'tapOut' : 'tapIn';
    setPunchButtonLabel(punchBtn, getCopy(mode));
  }
  const placeholder = getCopy('placeholder');
  const empLabel = document.getElementById('kiosk-employee-label');
  if (empLabel) empLabel.textContent = getCopy('employeeLabel');
  const projectLabel = document.getElementById('kiosk-project-label');
  if (projectLabel) projectLabel.textContent = getCopy('projectActiveLabel');
  const empPlaceholder = document.getElementById('kiosk-employee-placeholder');
  if (empPlaceholder) empPlaceholder.textContent = placeholder;
  const empSelect = document.getElementById('kiosk-employee');
  if (empSelect && empSelect.options.length) {
    empSelect.options[0].textContent = placeholder;
  }
  const langGroup = document.querySelector('.lang-switch');
  if (langGroup) langGroup.setAttribute('aria-label', getCopy('languageLabel'));
  const pinInput = document.getElementById('pin-input');
  if (pinInput) pinInput.setAttribute('placeholder', getCopy('pinPlaceholder'));
  const pinConfirmInput = document.getElementById('pin-confirm-input');
  if (pinConfirmInput) pinConfirmInput.setAttribute('placeholder', getCopy('pinConfirmPlaceholder'));
  const cameraLabel = document.getElementById('camera-required-label');
  if (cameraLabel) cameraLabel.textContent = getCopy('photoRequired');
  updateGeofenceBanner();
  const startCameraBtn = document.getElementById('start-camera');
  if (startCameraBtn) startCameraBtn.textContent = getCopy('cameraStart');
  const takePhotoBtn = document.getElementById('take-photo');
  if (takePhotoBtn) takePhotoBtn.textContent = getCopy('cameraTake');
  const retakePhotoBtn = document.getElementById('retake-photo');
  if (retakePhotoBtn) retakePhotoBtn.textContent = getCopy('cameraRetake');
  const pinCancel = document.getElementById('pin-cancel');
  if (pinCancel) pinCancel.textContent = getCopy('pinCancel');
  const pinContinue = document.getElementById('pin-continue');
  if (pinContinue) pinContinue.textContent = getCopy('pinContinue');
  const successCloseLabel = document.getElementById('success-close-label');
  const successLabelText = getCopy('successBackToClockIn');
  successDefaultCloseLabel = successLabelText;
  if (successCloseLabel) successCloseLabel.textContent = successLabelText;
  const pinToggle = document.getElementById('pin-toggle-visibility');
  if (pinToggle) {
    const isVisible = pinToggle.dataset.state === 'visible';
    setPinToggleState(pinToggle, isVisible);
  }
  if (currentEmployee) {
    const nameEl = document.getElementById('pin-employee-name');
    if (nameEl) {
      nameEl.textContent = buildEmployeeProjectLine(currentEmployee);
    }
    const modeLabelEl = document.getElementById('pin-mode-label');
    if (modeLabelEl) {
      const storedHash = currentEmployee.pin_hash || '';
      const storedPin = (currentEmployee.pin || '').trim();
      const hasPin = !!storedHash || !!storedPin;
      modeLabelEl.textContent = hasPin
        ? getCopy('pinSubtitleExisting')
        : getCopy('pinSubtitleNew');
    }
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
  updateProjectChip();
  updateOfflineIndicator();
  updateKioskDateTime();
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
  }

  if (!projectId && kioskConfig) {
    kioskConfig.project_id = null;
  }
  if (!projectId) {
    try {
      localStorage.removeItem(CURRENT_PROJECT_KEY);
    } catch {
      // ignore
    }
  }

  setCurrentProject(projectId);
  if (projectId) {
    markKioskDayStarted();
  }
}

function applyKioskRegistration(data, { keepSessions = false } = {}) {
  if (!data || !data.kiosk) return;
  setOrgSuspendedFlag(false);
  if (data.org_timezone) {
    setKioskTimezone(data.org_timezone);
  } else if (!kioskTimezone) {
    setKioskTimezone(loadKioskTimezone());
  }

  kioskConfig = data.kiosk;
  if (!keepSessions) {
    kioskSessions = data.sessions || [];
  } else if (Array.isArray(data.sessions) && data.sessions.length) {
    kioskSessions = data.sessions;
  }
  kioskSessionsLoaded = true;
  activeSessionId = data.active_session_id || activeSessionId;
  if (data.kiosk.device_secret) {
    setDeviceSecret(data.kiosk.device_secret);
  }
  applyKioskProjectDefault();
  updateGeofenceBanner();
  saveKioskCache({
    kiosk: kioskConfig,
    sessions: kioskSessions,
    active_session_id: activeSessionId,
    org_timezone: data.org_timezone || kioskTimezone
  });
  clearSyncWarning();
}

function showEnrollmentScreen(message) {
  const backdrop = document.getElementById('kiosk-enroll-backdrop');
  const status = document.getElementById('kiosk-enroll-status');
  if (backdrop) backdrop.classList.remove('hidden');
  if (status) status.textContent = message || 'Enter the enrollment code to continue.';
  const input = document.getElementById('kiosk-enroll-input');
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 100);
  }
}

function hideEnrollmentScreen() {
  const backdrop = document.getElementById('kiosk-enroll-backdrop');
  const status = document.getElementById('kiosk-enroll-status');
  if (backdrop) backdrop.classList.add('hidden');
  if (status) status.textContent = '';
}

async function submitEnrollmentCode() {
  const input = document.getElementById('kiosk-enroll-input');
  const status = document.getElementById('kiosk-enroll-status');
  const raw = input ? String(input.value || '').trim() : '';
  const code = raw.replace(/\D/g, '');

  if (!code) {
    if (status) status.textContent = 'Enter the enrollment code.';
    return;
  }
  if (!navigator.onLine) {
    if (status) status.textContent = 'Enrollment requires an internet connection.';
    return;
  }

  try {
    const data = await fetchJSON('/api/kiosks/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enrollment_code: code,
        device_id: kioskDeviceId || getOrCreateDeviceId()
      })
    });
    applyKioskRegistration(data);
    hideEnrollmentScreen();
    await onKioskReady();
  } catch (err) {
    const msg = err && err.message ? String(err.message) : 'Enrollment failed.';
    if (status) status.textContent = msg;
  }
}

function bindEnrollmentHandlers() {
  const btn = document.getElementById('kiosk-enroll-submit');
  if (btn) btn.addEventListener('click', submitEnrollmentCode);
  const input = document.getElementById('kiosk-enroll-input');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitEnrollmentCode();
      }
    });
  }
}

async function loadKioskSettings() {
  const cached = loadClockInPhotoRequired();
  if (cached !== null) {
    clockInPhotoRequired = cached;
  }
  try {
    const data = await fetchJSON('/api/kiosk/settings');
    const settings = data && data.settings ? data.settings : {};
    const sectionFeatures = data && data.features ? data.features : {};
    clockInPhotoRequired = !!settings.clock_in_photo_required;
    saveClockInPhotoRequired(clockInPhotoRequired);
    kioskSectionFeatures = kioskNormalizeSectionFeatures(sectionFeatures);
  } catch (err) {
    console.warn('Unable to load kiosk settings', err);
  }
}

async function onKioskReady() {
  if (kioskEnrolled) return;
  kioskEnrolled = true;
  await loadKioskSettings();

  if (!isKioskSectionEnabled('time')) {
    applyClockingModuleDisabledState();
    return;
  }

  await loadEmployeesAndProjects();
  await syncOfflineData('init');
  startOfflineSyncLoop();
  setupAdminLongPress();

  if (!kioskRefreshIntervalId) {
    kioskRefreshIntervalId = setInterval(refreshKioskProjectFromServer, 30000);
  }
}


async function initKioskConfig() {
  kioskDeviceId = getOrCreateDeviceId();
  showDeviceIdInUI();

  if (isOrgSuspendedFlag()) {
    showEnrollmentScreen('This organization is suspended. Contact your administrator.');
    return false;
  }

  const storedSecret = getOrCreateDeviceSecret();
  if (!storedSecret) {
    showEnrollmentScreen('Enter the enrollment code to set up this kiosk.');
    return false;
  }

  try {
    const data = await fetchJSON('/api/kiosks/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: kioskDeviceId,
        device_secret: storedSecret
      })
    });

    applyKioskRegistration(data);
    return true;
  } catch (err) {
    const msg = err && err.message ? String(err.message) : 'Unable to register kiosk.';
    if (!navigator.onLine) {
      const cached = loadKioskCache();
      if (cached && cached.kiosk) {
        applyKioskRegistration(cached, { keepSessions: true });
        updateOfflineIndicator();
        return true;
      }
      showEnrollmentScreen('Enrollment requires an internet connection.');
      return false;
    }
    const lowerMsg = msg.toLowerCase();
    const displayMsg = lowerMsg.includes('org access denied')
      ? 'This organization is suspended. Contact your administrator.'
      : msg;
    if (lowerMsg.includes('org access denied')) {
      setOrgSuspendedFlag(true);
    }
    showEnrollmentScreen(displayMsg);
    console.warn('Error registering kiosk device:', err);
    return false;
  }
}

async function refreshKioskProjectFromServer() {
  const secret = getOrCreateDeviceSecret();
  if (!secret) return;
  try {
    const data = await fetchJSON('/api/kiosks/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: kioskDeviceId || getOrCreateDeviceId(),
        device_secret: secret
      })
    });

    if (data && data.kiosk) {
      setOrgSuspendedFlag(false);
      applyKioskRegistration(data, { keepSessions: true });
    }
  } catch (err) {
    const msg = err && err.message ? String(err.message) : '';
    if (msg.toLowerCase().includes('org access denied')) {
      setOrgSuspendedFlag(true);
      showEnrollmentScreen('This organization is suspended. Contact your administrator.');
      return;
    }
    console.warn('Unable to refresh kiosk project', err);
  }
}


function getTodayIsoInTimezone(tz) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || DEFAULT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = fmt.formatToParts(new Date());
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const d = parts.find(p => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // ignore
  }
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
}

function getKioskDayKey() {
  const dev = kioskDeviceId || getOrCreateDeviceId();
  const today = getTodayIsoInTimezone(kioskTimezone || DEFAULT_TIMEZONE);
  return `avian_kiosk_day_started_${dev}_${today}`;
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

function hasTodayTimesheet() {
  const today = getTodayIsoInTimezone(kioskTimezone || DEFAULT_TIMEZONE);
  return (kioskSessions || []).some(
    s => (s.date || '').slice(0, 10) === today && s.project_id && !s.ended_at
  );
}

function openAdminDashboard(employeeId, options = {}) {
  const { skipPin = false, forceStart = false } = options || {};
  try {
    const params = new URLSearchParams();
    const deviceId = kioskDeviceId || getOrCreateDeviceId();
    const deviceSecret = getOrCreateDeviceSecret();

    params.set('device_id', deviceId);
    params.set('employee_id', employeeId);
    primeKioskAdminCookies(deviceId, deviceSecret);

    // Open in start-of-day mode if day not started OR no project set yet
    if (
      forceStart ||
      !isKioskDayStarted() ||
      !(kioskConfig && kioskConfig.project_id)
    ) {
      params.set('start', '1');
    }

    if (skipPin) {
      params.set('skip_pin', '1');
    }

    const adminUrl = '/kiosk-admin?' + params.toString();
    window.location.href = adminUrl;
  } catch (err) {
    console.error('Error opening kiosk admin dashboard', err);
  }
}

// ====== LOAD EMPLOYEES & PROJECTS ======

async function loadEmployeesAndProjects() {
  const empSel = document.getElementById('kiosk-employee');
  const status = document.getElementById('kiosk-status');

  status.textContent = getCopy('statusLoading');

  const [empRes, projRes] = await Promise.allSettled([
    fetchJSON('/api/kiosk/employees'),
    fetchJSON('/api/kiosk/projects')
  ]);

  let hadNetwork = false;

  if (empRes.status === 'fulfilled') {
    hadNetwork = true;
    const emps = empRes.value || [];
    // normalize ids
    employeesCache = emps.map(e => ({
      ...e,
      id: Number(e.id),
      is_admin: e.is_admin !== undefined ? !!e.is_admin : !!e.kiosk_admin_access,
      uses_timekeeping: e.worker_timekeeping !== undefined ? Number(e.worker_timekeeping) : 1
    }));
    saveCache(CACHE_EMP_KEY, employeesCache);
  } else {
    employeesCache = loadCache(CACHE_EMP_KEY) || [];
    employeesCache = (employeesCache || []).map(e => ({
      ...e,
      is_admin: e.is_admin !== undefined ? e.is_admin : !!e.kiosk_admin_access,
      uses_timekeeping:
        e.uses_timekeeping !== undefined
          ? e.uses_timekeeping
          : (e.worker_timekeeping !== undefined ? Number(e.worker_timekeeping) : 1)
    }));
  }

  if (projRes.status === 'fulfilled') {
    hadNetwork = true;
    const projs = projRes.value || [];
    // Only keep active project jobs (exclude top-level customers)
    projectsCache = projs.filter(p => p.customer_name);
    saveCache(CACHE_PROJ_KEY, projectsCache);
  } else {
    projectsCache = loadCache(CACHE_PROJ_KEY) || [];
  }

  fillEmployeeSelect(empSel, employeesCache);
  updateProjectChip();

  if (employeesCache.length || projectsCache.length) {
    status.textContent = hadNetwork ? '' : getCopy('statusOfflineListsLoaded');
  } else {
    status.textContent = getCopy('statusNoDataCached');
  }
}

function fillEmployeeSelect(sel, list) {
  sel.innerHTML = `<option value="">${getCopy('placeholder')}</option>`;

  const rows = (list || []).filter(e => {
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
  pinInput.type = 'password';
  const toggleBtn = document.getElementById('admin-pin-toggle-visibility');
  if (toggleBtn) {
    setPinToggleState(toggleBtn, false);
  }
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

async function submitAdminLogin() {
  const empSelect = document.getElementById('admin-login-employee');
  const pinInput = document.getElementById('admin-login-pin');
  const status = document.getElementById('admin-login-status');
  const continueBtn = document.getElementById('admin-login-continue');

  if (!empSelect || !pinInput || !status) return;

  const id = empSelect.value;
  const entered = (pinInput.value || '').trim();
  const controls = [pinInput, continueBtn].filter(Boolean);

  if (!id) {
    status.textContent = getCopy('selectYourNameStatus');
    return;
  }
  if (enforcePinThrottle('admin', controls)) {
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

  const storedHash = emp.pin_hash || '';
  const storedPin = (emp.pin || '').trim();
  if (!storedHash && !storedPin) {
    status.textContent = getCopy('pinStatusNoPin');
    return;
  }

  let pinOk = storedHash
    ? verifyPinHash(entered, storedHash)
    : storedPin === entered;

  if (!pinOk && navigator.onLine) {
    pinOk = await verifyAdminPinWithServer(id, entered);
  }

  if (!pinOk) {
    registerPinFailure('admin', controls);
    status.textContent = getCopy('pinStatusIncorrect');
    return;
  }

  resetPinFailures('admin');

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
    }, 1000); // 1.0s hold
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

function buildEmployeeProjectLine(employee) {
  if (!employee) return '';
  const baseName = employee.nickname || employee.name || '';
  const projectLabel =
    kioskConfig && kioskConfig.project_id
      ? currentProjectName ||
        getActiveProjectLabel() ||
        getProjectNameById(kioskConfig.project_id) ||
        ''
      : '';
  if (!projectLabel) return baseName;
  return formatCopy('employeeProjectLine', { name: baseName, project: projectLabel });
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

  const storedHash = employee.pin_hash || '';
  const storedPin = (employee.pin || '').trim();
  const hasPin = !!storedHash || !!storedPin;

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
    nameEl.textContent = buildEmployeeProjectLine(employee);
  }

  // Title + explanatory label
  if (titleEl) {
    titleEl.textContent = '';
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
    setPinToggleState(toggleBtn, false);
  }

  if (status) {
    status.textContent = '';
    status.style.color = '#bbf7d0';
  }
  clearClockInPhotoPendingState();

  const cachedOpen = getCachedOpenPunch(employee.id);
  if (cachedOpen && cachedOpen.open && cachedOpen.clock_in_ts) {
    const start = new Date(cachedOpen.clock_in_ts);
    const hours = computeHoursFromRange(start, new Date());
    if (hours != null && hours >= LONG_SHIFT_WARNING_HOURS) {
      setPinWarning(formatCopy('longShiftWarning', { hours: hours.toFixed(1) }));
    }
  }

  camSec.classList.add('hidden');
  stopCamera();

  const mustPhoto = clockInPhotoRequired && isClockInMode();

  if (mustPhoto) camSec.classList.remove('hidden');
  if (mustPhoto && !isPhotoCaptureSupported()) {
    setClockInPhotoUnavailableState();
  }

  document.getElementById('pin-backdrop').classList.remove('hidden');
  if (pinInput) pinInput.focus();
}


function hidePinModal() {
  document.getElementById('pin-backdrop').classList.add('hidden');
  stopCamera();
  currentEmployee = null;
  resetLanguageOverride();
}

function resetEmployeeSelection() {
  const empSel = document.getElementById('kiosk-employee');
  if (!empSel) return;
  empSel.value = '';
  if (empSel.selectedIndex !== 0) {
    empSel.selectedIndex = 0;
  }
  const status = document.getElementById('kiosk-status');
  if (status) {
    status.textContent = '';
    status.className = 'glass-status kiosk-status';
  }
  void onEmployeeChange();
}

function cancelPinModal() {
  hidePinModal();
  resetEmployeeSelection();
}

function setPinError(msg) {
  const el = document.getElementById('pin-modal-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = '#fecaca';
}

function setPinOk(msg) {
  const el = document.getElementById('pin-modal-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = '#bbf7d0';
}

function setPinWarning(msg) {
  const el = document.getElementById('pin-modal-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = '#fbbf24';
}

function isPhotoCaptureSupported() {
  return !!(
    navigator &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

function setClockInPhotoUnavailableState() {
  const pinContinueBtn = document.getElementById('pin-continue');
  if (pinContinueBtn) pinContinueBtn.disabled = true;
  setPinError(getCopy('clockInPhotoUnavailable'));
}

function setClockInPhotoPendingState() {
  const pinContinueBtn = document.getElementById('pin-continue');
  if (pinContinueBtn) pinContinueBtn.disabled = true;
  setPinWarning(getCopy('pinStatusPinOkPhoto'));
}

function clearClockInPhotoPendingState() {
  const pinContinueBtn = document.getElementById('pin-continue');
  if (pinContinueBtn) pinContinueBtn.disabled = false;
}

// ====== CAMERA ======

async function startCamera() {
  if (!isPhotoCaptureSupported()) {
    setClockInPhotoUnavailableState();
    return;
  }
  try {
    stopCamera();
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });

    document.getElementById('cam-video').srcObject = cameraStream;
    document.getElementById('cam-video').classList.remove('hidden');
    document.getElementById('start-camera').classList.add('hidden');
    document.getElementById('take-photo').classList.remove('hidden');

    setPinOk(getCopy('statusCameraReady'));
  } catch {
    if (clockInPhotoRequired && isClockInMode()) {
      setClockInPhotoUnavailableState();
      return;
    }
    setPinError(getCopy('statusCameraUnavailable'));
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

  setPinOk(getCopy('statusPhotoCaptured'));
  clearClockInPhotoPendingState();
}

function retakePhoto() {
  currentPhotoBase64 = null;
  document.getElementById('cam-preview').classList.add('hidden');
  document.getElementById('cam-video').classList.remove('hidden');
  document.getElementById('take-photo').classList.remove('hidden');
  document.getElementById('retake-photo').classList.add('hidden');
  if (clockInPhotoRequired && isClockInMode()) {
    setClockInPhotoPendingState();
  }
}


// ====== SUBMIT PIN ======
async function submitPin() {
  const pinInput = document.getElementById('pin-input');
  const pinConfirmInput = document.getElementById('pin-confirm-input');
  const pinContinueBtn = document.getElementById('pin-continue');
  const employee = currentEmployee;

  if (!employee || !pinInput) return;

  const pinControls = [pinInput, pinContinueBtn].filter(Boolean);
  const entered = pinInput.value.trim();
  const storedHash = employee.pin_hash || '';
  const storedPin = (employee.pin || '').trim();
  const hasPin = !!storedHash || !!storedPin;
  kioskDebug('submitPin start', {
    employee_id: employee.id,
    has_pin: hasPin,
    pin_validated: pinValidated,
    mode: isClockInMode() ? 'clock_in' : 'clock_out',
    online: navigator.onLine
  });

  // ===== EXISTING PIN =====
  if (hasPin) {
    // 1. PIN VALIDATION
    if (!pinValidated) {
      if (enforcePinThrottle('worker', pinControls)) {
        return;
      }
      if (!entered) {
        setPinError(getCopy('pinStatusEnterPin'));
        return;
      }

      const pinOk = storedHash
        ? verifyPinHash(entered, storedHash)
        : entered === storedPin;

      if (!pinOk) {
        kioskDebug('pin invalid', { employee_id: employee.id });
        registerPinFailure('worker', pinControls);
        setPinError(getCopy('pinStatusIncorrect'));
        pinInput.value = '';

        // Brief pause so they can see the error, then back to main screen
        setTimeout(() => {
          hidePinModal();
        }, 1000);

        return;
      }

      resetPinFailures('worker');
      pinValidated = true;
      pinInput.value = '';
      kioskDebug('pin ok', { employee_id: employee.id });

      if (clockInPhotoRequired && isClockInMode() && !currentPhotoBase64) {
        kioskDebug('awaiting photo');
        if (isPhotoCaptureSupported()) {
          setClockInPhotoPendingState();
        } else {
          setClockInPhotoUnavailableState();
        }
        return;
      }
    }

    let hasProject = !!(kioskConfig && kioskConfig.project_id);
    const activeSession = getActiveSession();
    const hasSession = !!(activeSession && activeSession.project_id);
    const hasTimesheetToday = hasTodayTimesheet();

    // If the server says there's an active session, ensure the kiosk project is set from it.
    if (!hasProject && hasSession && activeSession && activeSession.project_id) {
      setCurrentProject(activeSession.project_id);
      hasProject = true;
    }

    // Admins should be routed to the kiosk-admin flow when no active timesheet is available
    const needsTimesheet = employee.is_admin && !hasTimesheetToday;

    if (needsTimesheet) {
      kioskDebug('admin needs timesheet, routing to kiosk admin');
      hidePinModal();
      openAdminDashboard(employee.id, { skipPin: true, forceStart: true });
      return;
    }

    // 2. NORMAL PUNCH
    setPinOk(getCopy('pinStatusSubmitting'));
    if (pinContinueBtn) pinContinueBtn.disabled = true;
    const watchdog = KIOSK_DEBUG
      ? setTimeout(() => kioskDebug('submitPin waiting on punch...'), 8000)
      : null;
    try {
      await performPunch(employee.id);
    } finally {
      if (watchdog) clearTimeout(watchdog);
      if (pinContinueBtn) pinContinueBtn.disabled = false;
    }
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
    const pinHash = hashPin(pin1);
    if (pinHash) {
      employee.pin_hash = pinHash;
      employee.pin = '';
    } else {
      employee.pin = pin1;
    }
    justCreatedPin = true;

  } catch (err) {
    console.error('Error setting PIN', err);
    kioskDebug('pin save error', { employee_id: employee.id, message: err && err.message });

    const msg = (err && err.message) ? String(err.message) : '';
    const offlineIssue = isConnectionIssue(err, msg);

    // Offline, auth, or network failure → save locally and queue for sync
    const authLike = /auth|login|credential|session/i.test(msg);
    if (offlineIssue || authLike) {
      if (!offlineStorageSupported) {
        setPinError(getCopy('offlineUnsupported'));
        return;
      }
      await addPendingPinUpdate({ employee_id: employee.id, pin: pin1 });

      const pinHash = hashPin(pin1);
      if (pinHash) {
        employee.pin_hash = pinHash;
        employee.pin = '';
      } else {
        employee.pin = pin1;
      }
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

  if (clockInPhotoRequired && isClockInMode() && !currentPhotoBase64) {
    if (isPhotoCaptureSupported()) {
      setClockInPhotoPendingState();
    } else {
      setClockInPhotoUnavailableState();
    }
    return;
  }

  const needsTimesheet =
    employee.is_admin && !hasTodayTimesheet();
  if (needsTimesheet) {
    kioskDebug('admin needs timesheet after pin creation');
    hidePinModal();
    openAdminDashboard(employee.id, { skipPin: true, forceStart: true });
    return;
  }

  const isAdminStartOfDay = employee.is_admin && !isKioskDayStarted();

  if (isAdminStartOfDay) {
    kioskDebug('admin start of day, routing to kiosk admin');
    hidePinModal();
    openAdminDashboard(employee.id, { skipPin: true });
    return;
  }

  // Clock them in immediately
  setPinOk(getCopy('pinStatusSubmitting'));
  if (pinContinueBtn) pinContinueBtn.disabled = true;
  const watchdog = KIOSK_DEBUG
    ? setTimeout(() => kioskDebug('submitPin waiting on punch (new pin)...'), 8000)
    : null;
  try {
    await performPunch(employee.id);
  } finally {
    if (watchdog) clearTimeout(watchdog);
    if (pinContinueBtn) pinContinueBtn.disabled = false;
  }
  hidePinModal();
}

// ====== PERFORM PUNCH ======

async function performPunch(employee_id) {
  const status = document.getElementById('kiosk-status');
  const punchBtn = document.getElementById('kiosk-punch');
  const employee = (employeesCache || []).find(
    e => String(e.id) === String(employee_id)
  );
  const isAdmin = !!(employee && employee.is_admin);
  const intendedMode = isClockInMode() ? 'clock_in' : 'clock_out';
  const cachedOpenPunch = getCachedOpenPunch(employee_id);
  const hasOpenPunch = !!(cachedOpenPunch && cachedOpenPunch.open);
  const cachedClockInTs =
    cachedOpenPunch && cachedOpenPunch.open ? cachedOpenPunch.clock_in_ts : null;
  kioskDebug('performPunch start', {
    employee_id,
    intended_mode: intendedMode,
    online: navigator.onLine,
    cached_open: cachedOpenPunch ? cachedOpenPunch.open : false
  });

  const project_id = kioskConfig && kioskConfig.project_id
    ? parseInt(kioskConfig.project_id, 10)
    : null;
  if (!project_id) {
    kioskDebug('performPunch blocked: no project');
    if (isAdmin) {
      // Route admins to start-of-day/timesheet setup instead of hard-blocking
      status.textContent = getCopy('timesheetNotSet');
      status.className = 'glass-status kiosk-status kiosk-status-error';
      openAdminDashboard(employee_id, { skipPin: true, forceStart: true });
      return;
    }

    status.textContent = getCopy('projectNotSet');
    status.className = 'glass-status kiosk-status kiosk-status-error';
    return;
  }

  const hasTimesheetToday = hasTodayTimesheet();
  if (!hasTimesheetToday && !hasOpenPunch && intendedMode === 'clock_in') {
    if (!navigator.onLine) {
      kioskDebug('performPunch blocked: no timesheet (offline)');
      status.textContent = getCopy('timesheetNotSet');
      status.className = 'glass-status kiosk-status kiosk-status-error';
      return;
    }
    if (isAdmin) {
      kioskDebug('performPunch admin needs timesheet');
      openAdminDashboard(employee_id, { skipPin: true, forceStart: true });
      return;
    }
    kioskDebug('performPunch worker needs timesheet');
    status.textContent = getCopy('timesheetNotSet');
    status.className = 'glass-status kiosk-status kiosk-status-error';
    showAdminLoginModal();
    return;
  }

  if (intendedMode === 'clock_out' && cachedClockInTs) {
    const start = new Date(cachedClockInTs);
    const minutes = computeMinutesFromRange(start, new Date());
    if (minutes != null) {
      if (minutes < TINY_PUNCH_MINUTES) {
        const ok = window.confirm(
          formatCopy('tinyPunchConfirm', { minutes })
        );
        if (!ok) {
          if (punchBtn) punchBtn.disabled = false;
          return;
        }
      }
      const hours = minutes / 60;
      if (hours >= LONG_SHIFT_WARNING_HOURS) {
        const ok = window.confirm(
          formatCopy('longShiftConfirm', { hours: hours.toFixed(1) })
        );
        if (!ok) {
          if (punchBtn) punchBtn.disabled = false;
          return;
        }
      }
    }
  }

  if (punchInFlight) return;
  punchInFlight = true;
  if (punchBtn) punchBtn.disabled = true;

  try {
    const reuseClientId = getRecentPunchClientId(employee_id, intendedMode);
    const client_id = reuseClientId || makeClientId();
    recordPunchClientId(employee_id, intendedMode, client_id);
    kioskDebug('performPunch: requesting position');
    const pos = await getPosition();
    kioskDebug('performPunch: position result', pos);

    const punch = {
      client_id,
      employee_id,
      project_id,
      intended_mode: intendedMode,
      lat: pos?.lat || null,
      lng: pos?.lng || null,
      device_timestamp: new Date().toISOString(),
      photo_base64: currentPhotoBase64 || null,
      device_id: kioskDeviceId || null,
      device_secret: getOrCreateDeviceSecret()
    };

    if (!navigator.onLine) {
      kioskDebug('performPunch offline queue', { client_id });
      if (!offlineStorageSupported) {
        status.textContent = getCopy('offlineUnsupported');
        status.className = 'glass-status kiosk-status kiosk-status-error';
        return;
      }
      addToQueue(punch);
      setCachedOpenPunch(employee_id, {
        open: intendedMode === 'clock_in',
        clock_in_ts: intendedMode === 'clock_in' ? punch.device_timestamp : null
      });
      status.textContent = getCopy('statusSavedOffline');
      status.className = 'glass-status kiosk-status kiosk-status-ok';
      if (intendedMode === 'clock_out') {
        showClockOutSummary({
          startIso: cachedClockInTs,
          endIso: punch.device_timestamp,
          hours: null,
          offline: true
        });
      } else {
        showSuccessOverlay(getCopy('statusSavedOfflineBackOnline'));
      }
      startOfflineSyncLoop();

      const empSel = document.getElementById('kiosk-employee');
      if (empSel) empSel.value = '';
      setDefaultPunchButton(punchBtn);
      resetLanguageOverride();

      return;
    }

    kioskDebug('performPunch sending', { client_id, project_id, intendedMode });
    const data = await fetchJSON('/api/kiosk/punch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(punch),
      timeoutMs: 12000
    });
    kioskDebug('performPunch response', data);
    setCachedOpenPunch(employee_id, {
      open: data.mode === 'clock_in',
      clock_in_ts: data.mode === 'clock_in' ? punch.device_timestamp : null
    });

    if (data.mode === 'clock_in') {
      let msg;

      if (data.geofence_violation) {
        msg = getCopy('geofenceClockInWarning');
      } else if (justCreatedPin) {
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
      showClockOutSummary({
        startIso: cachedClockInTs,
        endIso: punch.device_timestamp,
        hours: data && data.hours,
        offline: false
      });
      status.textContent = '';
    }

  // Clear any prior success/error styling when no status text is shown.
  status.className = 'glass-status kiosk-status';


    const empSel = document.getElementById('kiosk-employee');
    if (empSel) empSel.value = '';
    setDefaultPunchButton(punchBtn);
    resetLanguageOverride();
  } catch (err) {
    console.error('Error syncing punch', err);
    kioskDebug('performPunch error', {
      message: err && err.message,
      status: err && err.status,
      code: err && err.code
    });
    const msg = err && err.message ? String(err.message) : '';
    const projectMsg = getCopy(isAdmin ? 'timesheetNotSet' : 'projectNotSet');
    const showProjectMsg = /project|timesheet/i.test(msg);
    const offlineIssue = isConnectionIssue(err, msg);
    const authIssue = err && (err.status === 401 || err.status === 403);

    const activeChanged =
      err &&
      err.status === 409 &&
      err.data &&
      err.data.active_project_id;

    if (activeChanged) {
      const activeId = Number(err.data.active_project_id);
      const activeLabel = Number.isFinite(activeId)
        ? (getProjectNameById(activeId) || formatCopy('projectLabelWithId', { id: activeId }))
        : '';
      status.textContent = activeLabel
        ? `Active project changed to ${activeLabel}. Please try again.`
        : 'Active project changed. Ask an admin to set today’s timesheet.';
      status.className = 'glass-status kiosk-status kiosk-status-error';
      refreshKioskProjectFromServer();
    } else if (showProjectMsg) {
      status.textContent = projectMsg;
      status.className = 'glass-status kiosk-status kiosk-status-error';
    } else if (offlineIssue || authIssue) {
      if (!offlineStorageSupported) {
        status.textContent = getCopy('offlineUnsupported');
        status.className = 'glass-status kiosk-status kiosk-status-error';
        return;
      }
      addToQueue(punch);
      setCachedOpenPunch(employee_id, {
        open: intendedMode === 'clock_in',
        clock_in_ts: intendedMode === 'clock_in' ? punch.device_timestamp : null
      });
      status.textContent = authIssue
        ? getCopy('statusSavedOfflineReenroll')
        : getCopy('statusSavedOffline');
      status.className = 'glass-status kiosk-status kiosk-status-ok';
      if (intendedMode === 'clock_out') {
        showClockOutSummary({
          startIso: cachedClockInTs,
          endIso: punch.device_timestamp,
          hours: null,
          offline: true
        });
      } else {
        showSuccessOverlay(
          authIssue
            ? getCopy('statusSavedOfflineReenrollBackOnline')
            : getCopy('statusSavedOfflineBackOnline')
        );
      }
      startOfflineSyncLoop();
      if (authIssue) {
        setSyncWarning(getCopy('statusSyncReenroll'));
      }
    } else {
      status.textContent = msg || getCopy('statusSyncError');
      status.className = 'glass-status kiosk-status kiosk-status-error';
    }

    const isAdminPunch =
      (employeesCache || []).some(
        e => String(e.id) === String(employee_id) && e.is_admin
      );
    if (showProjectMsg && isAdminPunch) {
      openAdminDashboard(employee_id, { skipPin: true, forceStart: true });
      return;
    }

    const empSel = document.getElementById('kiosk-employee');
    if (empSel) empSel.value = '';
    setDefaultPunchButton(punchBtn);
    resetLanguageOverride();
  } finally {
    punchInFlight = false;
    if (punchBtn) punchBtn.disabled = false;
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
    const pin =
      item.pin ||
      (await decryptPinFromStore(
        item.pin_cipher,
        (item.device_secret || '').trim() || deviceSecret
      ));
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

  // Offline → use cached state for button mode
  if (!navigator.onLine) {
    const cached = getCachedOpenPunch(employeeId);
    if (cached && cached.open) {
      setClockOutButton(button);
      if (status) {
        status.className = 'glass-status kiosk-status kiosk-status-ok';
        status.textContent = getCopy('offlineStatusClockedIn');
      }
    } else {
      setDefaultPunchButton(button);
      if (status) {
        status.className = 'glass-status kiosk-status kiosk-status-ok';
        status.textContent = cached
          ? getCopy('offlineStatusClockedOut')
          : getCopy('offlineStatusQueued');
      }
    }
    return;
  }

  try {
    const numericId = Number(employeeId);
    const data = await fetchJSON(
      `/api/kiosk/open-punch?employee_id=${numericId}`
    );

    setCachedOpenPunch(employeeId, {
      open: !!data.open,
      clock_in_ts: data.open ? data.clock_in_ts : null
    });

    if (data.open) {
      // EMPLOYEE IS CLOCKED IN → CLOCK OUT MODE (RED)
      setClockOutButton(button);
      if (status) {
        status.className = 'glass-status kiosk-status';
        status.textContent = '';
      }
    } else {
      // EMPLOYEE IS NOT CLOCKED IN → CLOCK IN MODE (GREEN)
      setDefaultPunchButton(button);
      if (status) {
        status.className = 'glass-status kiosk-status';
        status.textContent = '';
      }
    }
  } catch (err) {
    console.error('Error checking open punch', err);

    status.className = 'glass-status kiosk-status kiosk-status-error';
    status.textContent = getCopy('statusCheckCurrentStatusError');

    // Fallback appearance → Clock In (green)
    setDefaultPunchButton(button);
  }
}


async function onEmployeeChange() {
  const empSel = document.getElementById('kiosk-employee');
  if (!empSel) return;
  const empId = empSel.value;
  const emp = employeesCache.find(e => String(e.id) === String(empId));

  if (!empId) {
    resetLanguageOverride();
    await updatePunchButtonForEmployee(null);
    return;
  }

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

  await updatePunchButtonForEmployee(empId);
}

function handleEmployeeSelectFocus() {
  const empSel = document.getElementById('kiosk-employee');
  if (!empSel) return;
  employeeSelectStartValue = empSel.value;
  employeeSelectChanged = false;
}

function handleEmployeeSelectChange() {
  employeeSelectChanged = true;
  void onEmployeeChange();
}

function handleEmployeeSelectBlur() {
  const empSel = document.getElementById('kiosk-employee');
  if (!empSel) return;
  if (!employeeSelectChanged && employeeSelectStartValue) {
    empSel.value = '';
    if (empSel.selectedIndex !== 0) {
      empSel.selectedIndex = 0;
    }
    void onEmployeeChange();
  }
  employeeSelectChanged = false;
  employeeSelectStartValue = empSel.value || '';
}

// ====== PUNCH BUTTON ======

function onPunchClick() {
  const empSel = document.getElementById('kiosk-employee');
  const status = document.getElementById('kiosk-status');
  if (!isKioskSectionEnabled('time')) {
    status.textContent = getCopy('clockingModuleDisabled');
    status.className = 'glass-status kiosk-status kiosk-status-error';
    return;
  }

  if (!empSel.value) {
    status.textContent = getCopy('selectYourNameStatus');
    status.className = 'glass-status kiosk-status kiosk-status-error';
    return;
  }

  const empId = empSel.value;
  const emp = employeesCache.find(e => String(e.id) === empId);
  if (!emp) {
    status.textContent = getCopy('statusEmployeeNotFound');
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

  let queue = loadQueue();
  if (!queue.length) {
    clearSyncWarning();
    return;
  }

  let updated = false;
  queue = queue.map(punch => {
    if (punch && !punch.queued_at) {
      updated = true;
      return { ...punch, queued_at: new Date().toISOString() };
    }
    return punch;
  });
  if (updated) {
    saveQueue(queue);
  }

  const currentDeviceId = kioskDeviceId || getOrCreateDeviceId();
  const currentDeviceSecret = getOrCreateDeviceSecret();

  for (const punch of queue) {
    try {
      const payload = {
        ...punch,
        device_id: currentDeviceId,
        device_secret: currentDeviceSecret
      };
      await fetchJSON('/api/kiosk/punch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      // If successful, remove from local queue
      removeFromQueue(punch.client_id);
    } catch (err) {
      console.error('Error syncing queued punch, will retry later:', err);
      const msg = err && err.message ? String(err.message) : '';
      const offlineIssue = isConnectionIssue(err, msg);
      const authIssue = err && (err.status === 401 || err.status === 403);
      if (offlineIssue) {
        // Likely transient connectivity – try again on next tick
        break;
      }
      if (authIssue) {
        setSyncWarning(getCopy('statusSyncReenroll'));
        break;
      }
      if (err && err.status === 429) {
        const retryAfterSeconds = getRetryAfterSeconds(err) || 10;
        setSyncWarning(
          formatCopy('statusSyncRateLimited', {
            seconds: String(retryAfterSeconds)
          })
        );
        break;
      }
      if (isHardPunchQueueError(err)) {
        removeFromQueue(punch.client_id);
        if (err && err.data && err.data.code === 'offline_punch_too_old') {
          const maxAgeDays = Number(err.data.max_age_days);
          if (Number.isFinite(maxAgeDays) && maxAgeDays > 0) {
            setSyncWarning(
              formatCopy('statusSyncOfflineTooOld', {
                days: String(Math.floor(maxAgeDays))
              })
            );
          } else {
            setSyncWarning(getCopy('statusSyncNeedsAdmin'));
          }
          continue;
        }
        setSyncWarning(getCopy('statusSyncNeedsAdmin'));
        continue;
      }
      setSyncWarning(getCopy('statusSyncNeedsAdmin'));
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
    updateOfflineIndicator();
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

  if (window.AVIAN_STORE && typeof window.AVIAN_STORE.init === 'function') {
    await window.AVIAN_STORE.init([QUEUE_KEY, PENDING_PIN_KEY]);
    const hasLocalStorage = canUseLocalStorage();
    const hasIdb =
      typeof window.AVIAN_STORE.isIdb === 'function' &&
      window.AVIAN_STORE.isIdb();
    offlineStorageSupported = hasIdb || hasLocalStorage;
  } else {
    offlineStorageSupported = canUseLocalStorage();
  }

  await migratePendingPins();

  if (!offlineStorageSupported) {
    setSyncWarning(getCopy('offlineUnsupported'));
  }

  // Device ID + kiosk config
  kioskDeviceId = getOrCreateDeviceId();
  kioskTimezone = loadKioskTimezone();
  showDeviceIdInUI();
  setLanguage(currentLanguage);
  startHeaderClock();
  updateOfflineIndicator();
  hideStep2Sub();
  bindEnrollmentHandlers();

  if (hasOfflineDataToSync()) {
    startOfflineSyncLoop();
  }

  // Register the kiosk first so device auth is ready for kiosk endpoints
  const ready = await initKioskConfig();
  if (ready) {
    await onKioskReady();
  }

  // Periodically refresh the active project so workers always see the foreman’s current session
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
    empSel.addEventListener('focus', handleEmployeeSelectFocus);
    empSel.addEventListener('change', handleEmployeeSelectChange);
    empSel.addEventListener('blur', handleEmployeeSelectBlur);
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
    pinClose.addEventListener('click', cancelPinModal);
  }

  const pinCancel = document.getElementById('pin-cancel');
  if (pinCancel) {
    pinCancel.addEventListener('click', cancelPinModal);
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

  // Hidden admin mode on logo long-press is initialized after feature validation.

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
    pinToggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const pinInput = document.getElementById('pin-input');
      const pinConfirmInput = document.getElementById('pin-confirm-input');
      if (!pinInput) return;

      const newType = pinInput.type === 'password' ? 'text' : 'password';
      pinInput.type = newType;
      if (pinConfirmInput) pinConfirmInput.type = newType;

      setPinToggleState(pinToggle, newType === 'text');
      pinInput.focus({ preventScroll: true });
    });
  }

  const adminPinToggle = document.getElementById('admin-pin-toggle-visibility');
  if (adminPinToggle) {
    adminPinToggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const adminPinInput = document.getElementById('admin-login-pin');
      if (!adminPinInput) return;

      const newType = adminPinInput.type === 'password' ? 'text' : 'password';
      adminPinInput.type = newType;

      setPinToggleState(adminPinToggle, newType === 'text');
      adminPinInput.focus({ preventScroll: true });
    });
  }


}); 

// When we regain internet, try syncing again
window.addEventListener('online', () => {
  syncOfflineData('online');
  startOfflineSyncLoop();
  updateOfflineIndicator();
});
window.addEventListener('offline', () => {
  updateOfflineIndicator();
});
