// ====== CONSTANTS ======

const QUEUE_KEY = 'avian_kiosk_offline_punches_v1';
const CACHE_EMP_KEY = 'avian_kiosk_employees_v1';
const CACHE_PROJ_KEY = 'avian_kiosk_projects_v1';
const CURRENT_PROJECT_KEY = 'avian_kiosk_current_project_v1';
const DEVICE_ID_KEY = 'avian_kiosk_device_id_v1';
const PENDING_PIN_KEY = 'avian_kiosk_pending_pins_v1';


let employeesCache = [];
let projectsCache = [];
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

// ====== BASIC HELPERS ======

let successTimeout = null;

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




async function fetchJSON(url, options = {}) {
  const opts = Object.assign({ credentials: 'include' }, options);
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
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

const CLOCK_IN_MESSAGES = [
  'Clocked IN — have a safe shift!',
  'Clocked IN — have a great day!',
  'Clocked IN — stay safe out there!',
  'Clocked IN — let’s build something awesome today!',
  'Clocked IN — thanks for being on time!',
  'Clocked IN — you’re all set, have a good shift!'
];

function getRandomClockInMessage() {
  if (!Array.isArray(CLOCK_IN_MESSAGES) || !CLOCK_IN_MESSAGES.length) {
    return 'Clocked IN — have a safe shift!';
  }
  const idx = Math.floor(Math.random() * CLOCK_IN_MESSAGES.length);
  return CLOCK_IN_MESSAGES[idx];
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
  q.push(punch);
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
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

function updateGreetingUI() {
  const greetingEl = document.getElementById('kiosk-greeting');
  const subEl = document.getElementById('kiosk-greeting-sub');
  const empSel = document.getElementById('kiosk-employee');

  const selectedName =
    empSel && empSel.value && empSel.selectedOptions.length
      ? (empSel.selectedOptions[0].textContent || '').trim()
      : '';

  const prefix = getGreetingPrefix();

  if (greetingEl) {
    const label = selectedName || 'Crew';
    greetingEl.textContent = `${prefix}, ${label}!`;
  }

  if (subEl) {
    subEl.textContent = '';
  }
}

function updateProjectChip() {
  const chip = document.getElementById('kiosk-project-pill');
  const projSel = document.getElementById('kiosk-project');
  if (!chip || !projSel) return;

  const label =
    projSel.value && projSel.selectedOptions.length
      ? (projSel.selectedOptions[0].textContent || '').trim()
      : '';

  if (!projSel.value) {
    chip.textContent = '';
    chip.classList.add('hidden');
    chip.classList.remove('chip-warning');
    return;
  }

  chip.classList.remove('hidden');
  chip.classList.remove('chip-warning');
  chip.textContent = label || 'Project';
}

function updateClockDisplay() {
  const dayEl = document.getElementById('kiosk-day-label');
  const dateEl = document.getElementById('kiosk-date-label');
  const timeEl = document.getElementById('kiosk-time-label');

  const now = new Date();
  const day = now.toLocaleDateString(undefined, { weekday: 'long' });
  const date = now.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

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

function setDefaultPunchButton(button) {
  if (!button) return;
  button.classList.remove('kiosk-btn-danger');
  button.classList.add('btn-primary');
  button.textContent = 'Tap to Clock In';
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

function showDeviceIdInUI() {
  const el = document.getElementById('kiosk-device-id');
  if (el && kioskDeviceId) {
    el.textContent = kioskDeviceId;
  }
}

function applyKioskProjectDefault() {
  const projSel = document.getElementById('kiosk-project');
  if (!projSel) return;

  // If the kiosk has a project id from the server, select it
  if (kioskConfig && kioskConfig.project_id) {
    const pid = String(kioskConfig.project_id);
    const opt = projSel.querySelector(`option[value="${pid}"]`);
    if (opt) {
      projSel.value = pid;
      localStorage.setItem(CURRENT_PROJECT_KEY, pid);
    }
  }

  // 🔒 Lock the dropdown so crew cannot change it
  projSel.disabled = true;
  projSel.classList.add('kiosk-select-locked');
  updateProjectChip();
}


async function initKioskConfig() {
  kioskDeviceId = getOrCreateDeviceId();
  showDeviceIdInUI();

  try {
    const data = await fetchJSON('/api/kiosks/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: kioskDeviceId })
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
  try {
    const data = await fetchJSON('/api/kiosks/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: kioskDeviceId || getOrCreateDeviceId() })
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

// ====== LOAD EMPLOYEES & PROJECTS ======

async function loadEmployeesAndProjects() {
  const empSel = document.getElementById('kiosk-employee');
  const projSel = document.getElementById('kiosk-project');
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
    fillProjectSelect(projSel, projectsCache);

    saveCache(CACHE_EMP_KEY, employeesCache);
    saveCache(CACHE_PROJ_KEY, projectsCache);

    const saved = localStorage.getItem(CURRENT_PROJECT_KEY);
    if (saved && projSel.querySelector(`option[value="${saved}"]`)) {
      projSel.value = saved;
    }

    updateProjectChip();
    status.textContent = '';
  } catch {
    const emps = loadCache(CACHE_EMP_KEY) || [];
    const projs = loadCache(CACHE_PROJ_KEY) || [];

    employeesCache = emps;
    projectsCache = projs;

    fillEmployeeSelect(empSel, emps);
    fillProjectSelect(projSel, projs);

    const saved = localStorage.getItem(CURRENT_PROJECT_KEY);
    if (saved && projSel.querySelector(`option[value="${saved}"]`)) {
      projSel.value = saved;
    }

    updateProjectChip();
    if (emps.length || projs.length) {
      status.textContent = 'Offline lists loaded.';
    } else {
      status.textContent = 'Error: No data cached.';
    }
  }
}

function fillEmployeeSelect(sel, list) {
  sel.innerHTML =
    '<option value="">Select your name / Seleccione su nombre / Chwazi non ou</option>';

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


function fillProjectSelect(sel, list) {
  sel.innerHTML = '<option value="">Select project</option>';
  const activeProjects = (list || []).filter(
    p =>
      (p.active === undefined || p.active === null || Number(p.active) === 1) &&
      p.customer_name // hide top-level customers; only show job projects
  );

  for (const p of activeProjects) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name || '(Unnamed project)';
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
    status.textContent = 'Select an admin.';
    return;
  }
  if (!entered) {
    status.textContent = 'Enter PIN.';
    return;
  }

  const emp = (employeesCache || []).find(e => String(e.id) === String(id));
  if (!emp) {
    status.textContent = 'Employee not found.';
    return;
  }

  const storedPin = (emp.pin || '').trim();
  if (!storedPin) {
    status.textContent = 'This person does not have a PIN set yet.';
    return;
  }

  if (storedPin !== entered) {
    status.textContent = 'Incorrect PIN.';
    return;
  }

  // ✅ Success – close login and go to kiosk admin dashboard in the SAME tab
  status.textContent = '';
  hideAdminLoginModal();

  try {
    const params = new URLSearchParams();
    const deviceId = kioskDeviceId || getOrCreateDeviceId();

    params.set('device_id', deviceId);
    params.set('employee_id', id);          // 👈 NEW – pass the admin id

    // First time today → open in "start-of-day" mode
    if (!isKioskDayStarted()) {
      params.set('start', '1');
    }

    const adminUrl = '/kiosk-admin.html?' + params.toString();
    window.location.href = adminUrl;
  } catch (err) {
    console.error('Error opening kiosk admin dashboard', err);
  }
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

    // Try to read the currently selected project’s label
    const projSel = document.getElementById('kiosk-project');
    let projectLabel = '';
    if (projSel && projSel.value) {
      const opt = projSel.selectedOptions && projSel.selectedOptions[0];
      if (opt && opt.textContent) {
        projectLabel = opt.textContent.trim();
      }
    }

    // Show “Name – Project: XYZ” if we know the project,
    // otherwise just the name
    nameEl.textContent = projectLabel
      ? `${baseName} – Project: ${projectLabel}`
      : baseName;
  }

  // Title + explanatory label
  if (titleEl) {
    titleEl.textContent = hasPin ? 'Employee PIN' : 'Create Your PIN';
  }

if (modeLabelEl) {
  modeLabelEl.textContent = hasPin
    ? 'Enter your PIN to clock in or out.'
    : 'First time clocking in — create a 4-digit PIN you’ll use on any Avian kiosk.';
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
    toggleBtn.textContent = 'Show PIN';
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
        setPinError('Enter your PIN.');
        return;
      }

      if (entered !== storedPin) {
        setPinError('Incorrect PIN — could not clock in. Please try again.');
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
        setPinOk('PIN OK. Take required photo.');
        return;
      }
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
    setPinError('Enter and confirm a 4-digit PIN.');
    return;
  }

  if (!/^\d{4}$/.test(pin1) || !/^\d{4}$/.test(pin2)) {
    setPinError('PIN must be exactly 4 digits.');
    return;
  }

  if (pin1 !== pin2) {
    setPinError('PINs do not match. Please try again.');
    pinInput.value = '';
    if (pinConfirmInput) pinConfirmInput.value = '';
    return;
  }

  try {
    // Attempt to save PIN online first
    await fetchJSON(`/api/employees/${employee.id}/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pin1 })
    });

    // Success online
    employee.pin = pin1;
    justCreatedPin = true;

  } catch (err) {
    console.error('Error setting PIN', err);

    const msg = (err && err.message) ? String(err.message) : '';

    // Offline, auth, or network failure → save locally and queue for sync
    const authLike = /auth|login|credential|session/i.test(msg);
    if (!navigator.onLine || /NetworkError|Failed to fetch/i.test(msg) || authLike) {
      addPendingPinUpdate({ employee_id: employee.id, pin: pin1 });

      employee.pin = pin1;           // treat as saved locally
      justCreatedPin = true;

    } else {
      // Real server error → do NOT continue
      setPinError(msg || 'Could not save PIN. Check connection and try again.');
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
    setPinOk('PIN created. Take required photo.');
    return;
  }

  // Clock them in immediately
  await performPunch(employee.id);
  hidePinModal();
}

// ====== PERFORM PUNCH ======

async function performPunch(employee_id) {
  const projectSel = document.getElementById('kiosk-project');
  const status = document.getElementById('kiosk-status');

  if (!projectSel) {
    status.textContent = 'Project selector not found.';
    status.className = 'kiosk-status kiosk-status-error';
    return;
  }
  const project_id = kioskConfig && kioskConfig.project_id
    ? parseInt(kioskConfig.project_id, 10)
    : parseInt(projectSel.value, 10);
  if (!project_id) {
    status.textContent =
      'Project not set for this tablet. Ask your foreman to unlock the admin screen and choose today’s project before clocking in.';
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
    status.textContent = 'Saved offline — will sync.';
    status.className = 'kiosk-status kiosk-status-ok';

    const empSel = document.getElementById('kiosk-employee');
    const btn = document.getElementById('kiosk-punch');
    if (empSel) empSel.value = '';
    setDefaultPunchButton(btn);
    updateGreetingUI();

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
    msg = 'PIN successfully created. You are now clocked in.';
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

    status.className = 'kiosk-status kiosk-status-ok';


    const empSel = document.getElementById('kiosk-employee');
    const btn = document.getElementById('kiosk-punch');
    if (empSel) empSel.value = '';
    setDefaultPunchButton(btn);
    updateGreetingUI();
  } catch (err) {
    console.error('Error syncing punch', err);
    status.textContent = 'Could not sync — saved offline.';
    status.className = 'kiosk-status kiosk-status-error';

    const empSel = document.getElementById('kiosk-employee');
    const btn = document.getElementById('kiosk-punch');
    if (empSel) empSel.value = '';
    setDefaultPunchButton(btn);
    updateGreetingUI();
  }
}



// ====== SYNC PENDING EMPLOYEES (OFFLINE → SERVER) ======

async function syncPendingEmployees() {
  if (!navigator.onLine) return;

  const pending = loadPendingPins();
  if (!pending.length) return;

  const remaining = [];

  for (const item of pending) {
    try {
      await fetchJSON(`/api/employees/${item.employee_id}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin: item.pin,
          allowOverride: true
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
      button.textContent = 'Tap to Clock Out';

      button.classList.add('kiosk-btn-danger');   // 🔴 make it red
      button.classList.remove('btn-primary');     // remove green

      // Show "clocked in for X time"
      if (data.clock_in_ts) {
        const start = new Date(data.clock_in_ts);
        const now = new Date();
        const diffMs = now - start;
        const diffMin = Math.floor(diffMs / 60000);
        const diffHours = diffMs / 3600000;

        status.className = 'kiosk-status kiosk-status-ok';
        status.textContent =
          diffMin < 60
            ? `Currently CLOCKED IN — ${diffMin} minutes so far.`
            : `Currently CLOCKED IN — ${diffHours.toFixed(2)} hours so far.`;
      }

    } else {
      // EMPLOYEE IS NOT CLOCKED IN → CLOCK IN MODE (GREEN)
      button.textContent = 'Tap to Clock In';

      button.classList.remove('kiosk-btn-danger'); // remove red
      button.classList.add('btn-primary');         // make green again

      status.className = 'kiosk-status kiosk-status-ok';
      status.textContent = 'Ready to clock in.';
    }
  } catch (err) {
    console.error('Error checking open punch', err);

    status.className = 'kiosk-status kiosk-status-error';
    status.textContent =
      'Could not check current status. You can still punch.';

    // Fallback appearance → Clock In (green)
    button.textContent = 'Tap to Clock In';
    button.classList.remove('kiosk-btn-danger');
    button.classList.add('btn-primary');
  }
}


async function onEmployeeChange() {
  const empSel = document.getElementById('kiosk-employee');
  if (!empSel) return;
  const empId = empSel.value;

  if (!empId) {
    await updatePunchButtonForEmployee(null);
    updateGreetingUI();
    return;
  }

  await updatePunchButtonForEmployee(empId);
  updateGreetingUI();
}

// ====== PUNCH BUTTON ======

function onPunchClick() {
  const empSel = document.getElementById('kiosk-employee');
  const projSel = document.getElementById('kiosk-project');
  const status = document.getElementById('kiosk-status');

  if (!empSel.value) {
    status.textContent = 'Select your name.';
    status.className = 'kiosk-status kiosk-status-error';
    return;
  }

  const empId = empSel.value;
  const emp = employeesCache.find(e => String(e.id) === empId);
  if (!emp) {
    status.textContent = 'Employee not found.';
    status.className = 'kiosk-status kiosk-status-error';
    return;
  }

  const hasProject = kioskConfig && kioskConfig.project_id
    ? true
    : !!projSel.value;

  if (!hasProject) {
    if (emp.is_admin) {
      showPinModal(emp);
      return;
    }

    status.textContent =
      'Project not set for this tablet. Ask your foreman to unlock the admin screen and choose today’s project before clocking in.';
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


// ====== INIT ======

document.addEventListener('DOMContentLoaded', async () => {
  // Device ID + kiosk config
  kioskDeviceId = getOrCreateDeviceId();
  showDeviceIdInUI();

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

  const projSel = document.getElementById('kiosk-project');
  if (projSel) {
    projSel.addEventListener('change', updateProjectChip);
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

      pinToggle.textContent = newType === 'password' ? 'Show PIN' : 'Hide PIN';
    });
  }


}); 

// When we regain internet, try syncing again
window.addEventListener('online', () => {
  syncPendingEmployees();
  syncQueueToServer();
});
