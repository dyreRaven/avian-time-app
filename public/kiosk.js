// ====== CONSTANTS ======

const QUEUE_KEY = 'avian_kiosk_offline_punches_v1';
const CACHE_EMP_KEY = 'avian_kiosk_employees_v1';
const CACHE_PROJ_KEY = 'avian_kiosk_projects_v1';
const CURRENT_PROJECT_KEY = 'avian_kiosk_current_project_v1';

let employeesCache = [];
let projectsCache = [];
let currentEmployee = null;
let pinValidated = false;
let currentPhotoBase64 = null;
let cameraStream = null;
let pinSetupMode = false;
let pinFirstEntry = '';

// ====== BASIC HELPERS ======

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
  return data;
}

function makeClientId() {
  return crypto.randomUUID ? crypto.randomUUID() :
    'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
}

function loadQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); }
  catch { return []; }
}

function saveQueue(q) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }
function addToQueue(punch) { const q = loadQueue(); q.push(punch); saveQueue(q); }
function removeFromQueue(id) { saveQueue(loadQueue().filter(p => p.client_id !== id)); }

function saveCache(key,v){localStorage.setItem(key,JSON.stringify(v));}
function loadCache(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}}

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

// ====== LOAD EMPLOYEES & PROJECTS ======

async function loadEmployeesAndProjects() {
  const empSel = document.getElementById('kiosk-employee');
  const projSel = document.getElementById('kiosk-project');
  const status = document.getElementById('kiosk-status');

  status.textContent = 'Loading…';

  try {
    const [emps, projs] = await Promise.all([
      fetchJSON('/api/employees'),
      fetchJSON('/api/projects')
    ]);

    // ✅ normalize ids to numbers, keep pin + require_photo
    employeesCache = (emps || []).map(e => ({
      ...e,
      id: Number(e.id)
    }));
    projectsCache = projs || [];

    fillEmployeeSelect(empSel, employeesCache);
    fillProjectSelect(projSel, projectsCache);

    saveCache(CACHE_EMP_KEY, employeesCache);
    saveCache(CACHE_PROJ_KEY, projectsCache);

    const saved = localStorage.getItem(CURRENT_PROJECT_KEY);
    if (saved && projSel.querySelector(`option[value="${saved}"]`))
      projSel.value = saved;

    status.textContent = '';
  } catch {
    const emps = loadCache(CACHE_EMP_KEY) || [];
    const projs = loadCache(CACHE_PROJ_KEY) || [];

    employeesCache = emps;
    projectsCache = projs;

    fillEmployeeSelect(empSel, emps);
    fillProjectSelect(projSel, projs);

    const saved = localStorage.getItem(CURRENT_PROJECT_KEY);
    if (saved && projSel.querySelector(`option[value="${saved}"]`))
      projSel.value = saved;

    if (emps.length||projs.length)
      status.textContent = 'Offline lists loaded.';
    else
      status.textContent = 'Error: No data cached.';
  }
}

function fillEmployeeSelect(sel, list) {
  sel.innerHTML = '<option value="">Select your name</option>';
  for (const e of list) {
    const opt = document.createElement('option');
    opt.value = e.id;
    opt.textContent = e.nickname || e.name;
    sel.appendChild(opt);
  }
}

function fillProjectSelect(sel, list) {
  sel.innerHTML = '<option value="">Select project</option>';
  for (const p of list) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.customer_name ? `${p.customer_name} – ${p.name}` : p.name;
    sel.appendChild(opt);
  }
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
  const status = document.getElementById('pin-modal-status');
  const camSec = document.getElementById('camera-section');

  nameEl.textContent = employee.nickname || employee.name;
  pinInput.value = '';
  status.textContent = '';

  camSec.classList.add('hidden');
  stopCamera();

  if (employee.require_photo) camSec.classList.remove('hidden');

  document.getElementById('pin-backdrop').classList.remove('hidden');
  pinInput.focus();
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
    cameraStream = await navigator.mediaDevices.getUserMedia({ video:true });

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
  const entered = pinInput.value.trim();
  const employee = currentEmployee;

  if (!employee) return;

  const storedPin = (employee.pin || '').trim();

  // ====== EXISTING PIN: standard validation path ======
  if (storedPin) {
    // First time through: validate PIN
    if (!pinValidated) {
      if (!entered) {
        setPinError('Enter your PIN.');
        return;
      }

      if (entered !== storedPin) {
        setPinError('Incorrect PIN.');
        pinInput.value = '';
        return;
      }

      // PIN correct
      pinValidated = true;
      pinInput.value = '';

      // If photo required and not yet taken, pause here
      if (employee.require_photo && !currentPhotoBase64) {
        setPinOk('PIN OK. Take required photo.');
        return;
      }
    }

    // PIN already validated + photo (if needed) is ready → perform punch
    await performPunch(employee.id);
    hidePinModal();
    return;
  }

  // ====== NO PIN YET: first-time PIN setup ======
  // Stage 1: capture first entry
  if (!pinSetupMode) {
    if (!entered) {
      setPinError('Choose a new PIN.');
      return;
    }

    if (entered.length < 4) {
      setPinError('PIN should be at least 4 digits.');
      pinInput.value = '';
      return;
    }

    pinSetupMode = true;
    pinFirstEntry = entered;
    pinInput.value = '';
    setPinOk('Re-enter PIN to confirm.');
    return;
  }

  // Stage 2: confirm and save to server
  if (entered !== pinFirstEntry) {
    setPinError('PINs do not match. Try again.');
    pinSetupMode = false;
    pinFirstEntry = '';
    pinInput.value = '';
    return;
  }

  try {
    await fetchJSON(`/api/employees/${employee.id}/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pinFirstEntry })
    });

    // Update in-memory cache so next time we enforce it
    employee.pin = pinFirstEntry;

    pinValidated = true;
    pinSetupMode = false;
    pinFirstEntry = '';
    pinInput.value = '';

    if (employee.require_photo && !currentPhotoBase64) {
      setPinOk('PIN created. Take required photo.');
      return;
    }

    await performPunch(employee.id);
    hidePinModal();
  } catch (err) {
    console.error('Error setting PIN', err);
    setPinError('Could not save PIN. Check connection and try again.');
  }
}


// ====== PERFORM PUNCH ======

async function performPunch(employee_id) {
  const projectSel = document.getElementById('kiosk-project');
  const status = document.getElementById('kiosk-status');

  const project_id = parseInt(projectSel.value, 10);
  if (!project_id) {
    status.textContent = 'Project not selected.';
    status.className='kiosk-status kiosk-status-error';
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
    photo_base64: currentPhotoBase64 || null
  };

  // Always queue
  addToQueue(punch);

  if (!navigator.onLine) {
    status.textContent = 'Saved offline — will sync.';
    status.className='kiosk-status kiosk-status-ok';

    const empSel = document.getElementById('kiosk-employee');
    const btn = document.getElementById('kiosk-punch');
    if (empSel) empSel.value = '';
    if (btn) btn.textContent = 'Tap to Clock In';

    return;
  }


  try {
    const data = await fetchJSON('/api/kiosk/punch', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(punch)
    });

    removeFromQueue(client_id);

    if (data.mode === 'clock_in') {
      status.textContent = 'Clocked IN — have a safe shift.';
    } else if (data.mode==='clock_out') {
      if (typeof data.hours==='number') {
        const minutes = data.hours*60;
        status.textContent =
          minutes<60
            ? `Clocked OUT — ${minutes.toFixed(0)} minutes.`
            : `Clocked OUT — ${data.hours.toFixed(2)} hours.`;
      } else {
        status.textContent='Clocked OUT.';
      }
    } else {
      status.textContent = 'Punch recorded.';
    }

    status.className='kiosk-status kiosk-status-ok';

    const empSel = document.getElementById('kiosk-employee');
    const btn = document.getElementById('kiosk-punch');
    if (empSel) empSel.value = '';
    if (btn) btn.textContent = 'Tap to Clock In';
  } catch (err) {
    console.error('Error syncing punch', err);
    status.textContent='Could not sync — saved offline.';
    status.className='kiosk-status kiosk-status-error';

    const empSel = document.getElementById('kiosk-employee');
    const btn = document.getElementById('kiosk-punch');
    if (empSel) empSel.value = '';
    if (btn) btn.textContent = 'Tap to Clock In';
  }
}


// ====== PUNCH STATUS (IN/OUT) ======

async function updatePunchButtonForEmployee(employeeId) {
  const button = document.getElementById('kiosk-punch');
  const status = document.getElementById('kiosk-status');
  if (!button) return;

  // No employee selected: reset to default label, keep current status text
  if (!employeeId) {
    button.textContent = 'Tap to Clock In';
    return;
  }

  // If offline, we can't query the server; leave status alone and default to "Clock In"
  if (!navigator.onLine) {
    button.textContent = 'Tap to Clock In';
    return;
  }

  try {
    const data = await fetchJSON(`/api/kiosk/open-punch?employee_id=${employeeId}`);

    if (data.open) {
      button.textContent = 'Tap to Clock Out';

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
      button.textContent = 'Tap to Clock In';
      status.className = 'kiosk-status kiosk-status-ok';
      status.textContent = 'Ready to clock in.';
    }
  } catch (err) {
    console.error('Error checking open punch', err);
    status.className = 'kiosk-status kiosk-status-error';
    status.textContent = 'Could not check current status. You can still punch.';
    button.textContent = 'Tap to Clock In';
  }
}

async function onEmployeeChange() {
  const empSel = document.getElementById('kiosk-employee');
  if (!empSel) return;
  const empId = parseInt(empSel.value, 10);
  if (!empId) {
    await updatePunchButtonForEmployee(null);
    return;
  }
  await updatePunchButtonForEmployee(empId);
}



// ====== PUNCH BUTTON ======

function onPunchClick() {
  const empSel = document.getElementById('kiosk-employee');
  const projSel = document.getElementById('kiosk-project');
  const status = document.getElementById('kiosk-status');

  if (!projSel.value) {
    status.textContent='Foreman must select project.';
    status.className='kiosk-status kiosk-status-error';
    return;
  }

  if (!empSel.value) {
    status.textContent='Select your name.';
    status.className='kiosk-status kiosk-status-error';
    return;
  }

  const empId = Number(empSel.value);
const emp = employeesCache.find(e => Number(e.id) === empId);
  if (!emp) {
    status.textContent='Employee not found.';
    status.className='kiosk-status kiosk-status-error';
    return;
  }

  showPinModal(emp);
}

// ====== SYNC ON ONLINE ======

async function syncQueueToServer() {
  if (!navigator.onLine) return;
  const queue = loadQueue();
  for (const punch of queue) {
    try {
      await fetchJSON('/api/kiosk/punch',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(punch)
      });
      removeFromQueue(punch.client_id);
    } catch {
      break;
    }
  }
}

// ====== INIT ======

document.addEventListener('DOMContentLoaded', () => {
  loadEmployeesAndProjects();
  syncQueueToServer();

  const punchBtn = document.getElementById('kiosk-punch');
  if (punchBtn) {
    punchBtn.addEventListener('click', onPunchClick);
  }

  const empSel = document.getElementById('kiosk-employee');
  if (empSel) {
    empSel.addEventListener('change', onEmployeeChange);
  }

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

  const startCam = document.getElementById('start-camera');
  if (startCam) {
    startCam.addEventListener('click', startCamera);
  }

  const takePhotoBtn = document.getElementById('take-photo');
  if (takePhotoBtn) {
    takePhotoBtn.addEventListener('click', takePhoto);
  }

  const retakePhotoBtn = document.getElementById('retake-photo');
  if (retakePhotoBtn) {
    retakePhotoBtn.addEventListener('click', retakePhoto);
  }

  window.addEventListener('online', syncQueueToServer);
});
