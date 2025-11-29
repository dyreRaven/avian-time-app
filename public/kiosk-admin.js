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
let kaShipmentItemsDirty = new Map(); // shipment_item_id -> verification payload
let kaShipmentDetail = null;
let kaItemsModalShipmentId = null;
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

const KA_VIEWS = ['live', 'shipments', 'time', 'settings'];
const KA_PENDING_PIN_KEY = 'avian_kiosk_pending_pins_v1';
const KA_OFFLINE_QUEUE_KEY = 'avian_kiosk_offline_punches_v1';
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


// --- Small helpers ---

function kaMarkDayStarted() {
  if (!kaDeviceId) return;
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const key = `avian_kiosk_day_started_${kaDeviceId}_${y}-${m}-${d}`;
  try {
    localStorage.setItem(key, '1');
  } catch {}
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
    // sessionStorage may be blocked; ignore and fall back to prompt
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

function kaFindDocByType(docs, typeMatch) {
  if (!Array.isArray(docs)) return null;
  const lower = typeMatch.toLowerCase();
  return docs.find(d => {
    const t = (d.doc_type || '').toLowerCase();
    const lbl = (d.doc_label || '').toLowerCase();
    return t === lower || lbl === lower || t.includes(lower) || lbl.includes(lower);
  }) || null;
}

function kaPaymentBadge(paid, amount, label, doc) {
  const isPaid = !!paid;
  const fmt = (val) => `$${Number(val).toFixed(2)}`;
  const hasAmount = amount !== null && amount !== undefined && amount !== '';
  const amt = hasAmount ? fmt(amount) : (isPaid ? '—' : fmt(0));
  const docLink = doc
    ? `<a class="ka-pay-doc-link" href="${doc.url || doc.file_path || '#'}" target="_blank" rel="noopener noreferrer" aria-label="${label} document">View doc</a>`
    : '<span class="ka-pay-doc-missing">No doc</span>';

  return `
    <div class="ka-pay-chip ${isPaid ? 'paid' : 'unpaid'}" data-pay-chip="${label.toLowerCase()}">
      <button class="ka-pay-pill" type="button">
        <span class="ka-pay-chip-label">${label}</span>
        <span class="ka-pay-pill-sep">—</span>
        <span class="ka-pay-status-icon top-right">${isPaid ? '✓' : '✕'}</span>
      </button>
      <div class="ka-pay-detail" data-pay-detail="${label.toLowerCase()}">
        <div class="ka-pay-detail-row">Amount: ${amt}</div>
        <div class="ka-pay-detail-doc">${docLink}</div>
      </div>
    </div>
  `;
}

function kaRenderPaymentBar(shipmentId, docs) {
  const bar = document.querySelector(
    `.ka-ship-payments[data-payments-bar-for="${shipmentId}"]`
  );
  if (!bar) return;

  const row = (kaShipments || []).find(
    r => Number(r.id) === Number(shipmentId)
  );
  if (!row) return;

  const ffDoc = docs ? kaFindDocByType(docs, 'Freight Forwarder Proof of Payment') : null;
  const customsDoc = docs ? kaFindDocByType(docs, 'Customs & Clearing Proof of Payment') : null;

  bar.innerHTML = `
    ${kaPaymentBadge(row.shipper_paid, row.shipper_paid_amount, 'Forwarder', row.shipper_paid ? ffDoc : null)}
    ${kaPaymentBadge(row.customs_paid, row.customs_paid_amount, 'Customs', row.customs_paid ? customsDoc : null)}
  `;

  bar.querySelectorAll('.ka-pay-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      // Ignore clicks on the link/detail so content stays visible after opening docs
      if (e.target.closest('.ka-pay-detail')) return;
      e.stopPropagation();
      const key = chip.dataset.payChip;
      const detail = bar.querySelector(`[data-pay-detail="${key}"]`);
      if (!detail) return;
      const isOpen = !detail.classList.contains('hidden');
      bar.querySelectorAll('.ka-pay-detail').forEach(d => d.classList.add('hidden'));
      if (!isOpen) {
        detail.classList.remove('hidden');
      }
    });
  });
}

async function kaHydrateShipmentCard(shipmentId, adminId) {
  try {
    const resp = await fetchJSON(
      `/api/shipments/${shipmentId}/documents${
        adminId ? `?employee_id=${adminId}` : ''
      }`
    );
    const docs = kaNormalizeDocs(resp);
    kaRenderPaymentBar(shipmentId, docs);
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
  const saved = kaLoadNotifyPrefFromStorage();
  kaApplyNotifyPrefToUI(saved, kaNotifyStatusesSource());

  const openBtn = document.getElementById('ka-notify-open');
  const modal = document.getElementById('ka-notify-modal');
  const backdrop = document.getElementById('ka-notify-backdrop');
  const closeBtn = document.getElementById('ka-notify-close');

  function closeModal() {
    modal?.classList.add('hidden');
    backdrop?.classList.add('hidden');
  }

  function openModal() {
    modal?.classList.remove('hidden');
    backdrop?.classList.remove('hidden');
  }

  if (openBtn) openBtn.addEventListener('click', openModal);
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (backdrop) {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });
  }

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

  const notifyBtn = document.getElementById('ka-notify-open');
  const notifyModal = document.getElementById('ka-notify-modal');
  const notifyBackdrop = document.getElementById('ka-notify-backdrop');
  const showNotify = kaCanViewShipments();
  if (notifyBtn) notifyBtn.style.display = showNotify ? '' : 'none';
  if (!showNotify) {
    notifyModal?.classList.add('hidden');
    notifyBackdrop?.classList.add('hidden');
    document.getElementById('ka-notify-projects-menu')?.classList.add('hidden');
    document.getElementById('ka-notify-statuses-menu')?.classList.add('hidden');
  }

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
  const ratesToggle = document.getElementById('ka-rates-toggle');
  const ratesEditor = document.getElementById('ka-rates-editor');
  const canRates = kaCanModifyPayRates();
  if (ratesBlock) ratesBlock.classList.toggle('hidden', !canRates);
  if (!canRates) {
    kaRatesUnlocked = false;
    if (ratesToggle) ratesToggle.checked = false;
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

function kaPaymentChip(label, paid, amount, proofDoc) {
  const isPaid = !!paid;
  const amt =
    amount !== null && amount !== undefined
      ? `$${Number(amount).toFixed(2)}`
      : '—';
  const proofLink = proofDoc
    ? `<a class="ka-pay-doc-link" href="${proofDoc.url || proofDoc.file_path || '#'}" target="_blank" rel="noopener noreferrer">Doc</a>`
    : '';

  return `<span class="ka-pay-chip ${isPaid ? 'paid' : 'unpaid'}">
    <div class="ka-pay-chip-left">
      <div class="ka-pay-chip-label">${label}</div>
      <div class="ka-pay-chip-meta">${amt}${proofLink ? ` • ${proofLink}` : ''}</div>
    </div>
    <div class="ka-pay-chip-right ${isPaid ? 'paid' : 'unpaid'}">
      <div class="ka-pay-status-icon">${isPaid ? '✓' : '✕'}</div>
      <div class="ka-pay-status-text">${isPaid ? 'Paid' : 'Unpaid'}</div>
    </div>
  </span>`;
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
  const dueLabel = shipment.storage_due_date
    ? kaFormatDateIso(shipment.storage_due_date)
    : 'No due date set';
  if (valueEl) valueEl.textContent = dueLabel;

  dueBox.classList.toggle('late', daysLate > 0 && estimate > 0);
  dueBox.querySelectorAll('.late-text').forEach(el => el.remove());
  if (daysLate > 0 && estimate > 0) {
    const lt = document.createElement('span');
    lt.className = 'late-text';
    lt.textContent = `${daysLate} day${daysLate === 1 ? '' : 's'} late · Est. ${kaFmtMoney(estimate) || '$0.00'}`;
    dueBox.appendChild(lt);
  }
}

function kaRenderStorageSection(storageGrid, shipment, card) {
  if (!storageGrid || !shipment) return;
  const sid = shipment.id;
  const adminId = kaAdminAuthId();
  const canEdit = !!adminId && kaCanViewShipments();

  const late = kaCalcStorageLateFees(
    shipment.storage_due_date,
    shipment.storage_daily_late_fee
  );
  const lateLabel =
    late.daysLate > 0
      ? `${late.daysLate} day${late.daysLate === 1 ? '' : 's'} late`
      : 'Not late yet';

  storageGrid.innerHTML = `
    <div class="ka-ship-info-row">
      <div class="ka-ship-info-label">Storage Due Date</div>
      <div class="ka-ship-info-value">
        <input type="date" data-ka-storage-field="due" ${canEdit ? '' : 'disabled'} />
      </div>
    </div>
    <div class="ka-ship-info-row">
      <div class="ka-ship-info-label">Daily Late Fee</div>
      <div class="ka-ship-info-value ka-storage-fee-row">
        <span class="ka-storage-prefix">$</span>
        <input
          type="number"
          step="0.01"
          min="0"
          inputmode="decimal"
          data-ka-storage-field="fee"
          ${canEdit ? '' : 'disabled'}
        />
      </div>
    </div>
    <div class="ka-ship-info-row">
      <div class="ka-ship-info-label">Estimated Late Fees</div>
      <div class="ka-ship-info-value">
        <div class="ka-storage-estimate" data-ka-storage-estimate="${sid}">${kaFmtMoney(late.estimate) || '$0.00'}</div>
        <div class="ka-storage-helper" data-ka-storage-helper="${sid}">${lateLabel}</div>
      </div>
    </div>
    <div class="ka-ship-info-row">
      <div class="ka-ship-info-label">Expected Arrival</div>
      <div class="ka-ship-info-value">
        <input type="date" data-ka-storage-field="arrival" ${canEdit ? '' : 'disabled'} />
      </div>
    </div>
    <div class="ka-ship-info-row">
      <div class="ka-ship-info-label">Storage Room</div>
      <div class="ka-ship-info-value">
        <input type="text" data-ka-storage-field="room" placeholder="Where is it stored?" ${canEdit ? '' : 'disabled'} />
      </div>
    </div>
    <div class="ka-ship-info-row">
      <div class="ka-ship-info-label">Storage Details</div>
      <div class="ka-ship-info-value">
        <textarea rows="2" data-ka-storage-field="details" placeholder="Notes for warehouse" ${canEdit ? '' : 'disabled'}></textarea>
      </div>
    </div>
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
      <div class="ka-ship-info-label">Actions</div>
      <div class="ka-ship-info-value ka-storage-actions">
        <button class="btn primary btn-sm" data-ka-storage-save="${sid}" ${canEdit ? '' : 'disabled'}>Save storage & pickup</button>
        <span class="ka-status" data-ka-storage-status="${sid}">${canEdit ? '' : 'Log in as an admin to edit.'}</span>
      </div>
    </div>
  `;

  const getField = (name) =>
    storageGrid.querySelector(`[data-ka-storage-field="${name}"]`);
  const dueInput = getField('due');
  const feeInput = getField('fee');
  const arrivalInput = getField('arrival');
  const roomInput = getField('room');
  const detailsInput = getField('details');
  const pickedByInput = getField('picked_by');
  const pickedDateInput = getField('picked_date');
  const estimateEl = storageGrid.querySelector(
    `[data-ka-storage-estimate="${sid}"]`
  );
  const helperEl = storageGrid.querySelector(
    `[data-ka-storage-helper="${sid}"]`
  );
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
    if (dueInput) dueInput.value = src.storage_due_date || '';
    if (feeInput) {
      const feeNum = Number(src.storage_daily_late_fee);
      feeInput.value =
        src.storage_daily_late_fee !== null &&
        src.storage_daily_late_fee !== undefined &&
        src.storage_daily_late_fee !== '' &&
        Number.isFinite(feeNum)
          ? feeNum.toFixed(2)
          : '';
    }
    if (arrivalInput) arrivalInput.value = src.expected_arrival_date || '';
    if (roomInput) roomInput.value = src.storage_room || '';
    if (detailsInput) detailsInput.value = src.storage_details || '';
    if (pickedByInput) pickedByInput.value = src.picked_up_by || '';
    if (pickedDateInput) pickedDateInput.value = src.picked_up_date || '';
    kaUpdateShipmentCardDue(card, src);
    updateLateDisplays();
  };

  const updateLateDisplays = () => {
    const dueVal = dueInput ? dueInput.value : '';
    const feeVal = feeInput ? feeInput.value : '';
    const lateCalc = kaCalcStorageLateFees(dueVal, feeVal);
    if (estimateEl) {
      const est = kaFmtMoney(lateCalc.estimate) || '$0.00';
      estimateEl.textContent = est;
    }
    if (helperEl) {
      const label =
        lateCalc.daysLate > 0
          ? `${lateCalc.daysLate} day${lateCalc.daysLate === 1 ? '' : 's'} late`
          : dueVal
          ? 'Not late yet'
          : 'No due date set';
      helperEl.textContent = label;
    }
  };

  if (dueInput) dueInput.addEventListener('change', updateLateDisplays);
  if (feeInput) feeInput.addEventListener('input', updateLateDisplays);

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
        storage_due_date: dueInput?.value || null,
        storage_daily_late_fee:
          feeInput && feeInput.value !== '' ? Number(feeInput.value) : null,
        expected_arrival_date: arrivalInput?.value || null,
        storage_room: roomInput?.value ? roomInput.value.trim() : '',
        storage_details: detailsInput?.value ? detailsInput.value.trim() : '',
        picked_up_by: pickedByInput?.value ? pickedByInput.value.trim() : '',
        picked_up_date: pickedDateInput?.value || null,
        employee_id: adminId
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
        const updated = resp.shipment || {};
        Object.assign(shipment, updated);
        // keep global cache in sync
        const idx = kaShipments.findIndex(
          (s) => Number(s.id) === Number(sid)
        );
        if (idx >= 0) {
          kaShipments[idx] = { ...kaShipments[idx], ...updated };
        }
        if (kaShipmentDetail && kaShipmentDetail.shipment) {
          if (Number(kaShipmentDetail.shipment.id) === Number(sid)) {
            kaShipmentDetail.shipment = {
              ...kaShipmentDetail.shipment,
              ...updated
            };
          }
        }
        applyValues(updated);
        setStatus('Storage & pickup updated.', 'ok');
      } catch (err) {
        console.error('Error saving storage from kiosk:', err);
        setStatus('Error saving storage: ' + (err.message || err), 'error');
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  applyValues(shipment);
}


async function kaLoadShipmentDetailIntoCard(shipmentId, card, detailEl) {
  // 🔹 Clear any previous dirty items when we focus this shipment
  kaShipmentItemsDirty.clear();

  const docsEl = detailEl.querySelector(
    `.ka-ship-doc-list[data-docs-for="${shipmentId}"]`
  );
  const itemsEl = detailEl.querySelector(
    `.ka-ship-items-list[data-items-for="${shipmentId}"]`
  );
  const basicGrid = detailEl.querySelector(
    `.ka-ship-detail-grid[data-basic-grid-for="${shipmentId}"]`
  );
  const datesGrid = detailEl.querySelector(
    `.ka-ship-detail-grid[data-dates-grid-for="${shipmentId}"]`
  );
  const paymentsGrid = detailEl.querySelector(
    `.ka-ship-detail-grid[data-payments-grid-for="${shipmentId}"]`
  );
  const storageGrid = detailEl.querySelector(
    `.ka-ship-detail-grid[data-storage-grid-for="${shipmentId}"]`
  );

  if (docsEl) {
    docsEl.innerHTML = '<li class="ka-ship-muted">(loading documents…)</li>';
  }
  if (itemsEl) {
    itemsEl.innerHTML = '<div class="ka-ship-muted">(loading items…)</div>';
  }

  try {
    let docsForShipment = [];
    const adminId = kaAdminAuthId();
    // 1) verification/details
    const report = await fetchJSON(
      '/api/reports/shipment-verification?shipment_id=' +
        shipmentId +
        (adminId ? `&employee_id=${adminId}` : '')
    );
    const shipment = report.shipment || {};
    const items = Array.isArray(report.items) ? report.items : [];
    // store globally for modal use
    kaShipmentDetail = { shipment, items };

    // 2) documents (unchanged)
    if (docsEl) {
      try {
        const docResp = await fetchJSON(
          `/api/shipments/${shipmentId}/documents${
            adminId
              ? `?employee_id=${adminId}`
              : ''
          }`
        );
        const normalizedDocs = kaNormalizeDocs(docResp);
        const visibleDocs = normalizedDocs.filter(
          d => (d.doc_type || '').toLowerCase() !== 'bol' && (d.doc_label || '').toLowerCase() !== 'bol'
        );
        docsForShipment = visibleDocs;
        docsEl.innerHTML = '';
        kaRenderPaymentBar(shipmentId, normalizedDocs);
        const bolDoc = kaFindDocByType(normalizedDocs, 'bol');
        kaSetBolLink(shipmentId, bolDoc);

        if (!visibleDocs.length) {
          docsEl.innerHTML =
            '<li class="ka-ship-muted">(No documents uploaded)</li>';
        } else {
         visibleDocs.forEach((doc) => {
  const li = document.createElement('li');
  const a = document.createElement('a');

  const href = doc.url || doc.file_path || '#';
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = doc.title || doc.label || doc.filename || doc.original_name || 'Document';

  li.appendChild(a);

  const typeLabel = doc.doc_label || doc.doc_type;
  if (typeLabel) {
    const chip = document.createElement('span');
    chip.className = 'ka-ship-doc-tag';
    chip.textContent = typeLabel;
    if (doc.doc_type && doc.doc_label && doc.doc_label !== doc.doc_type) {
      chip.title = `Type: ${doc.doc_type}`;
    }
    li.appendChild(chip);
  }

  const hint = document.createElement('span');
  hint.className = 'ka-ship-doc-download-hint';
  hint.textContent = ' ⟶ Open in new tab';
  li.appendChild(hint);

  docsEl.appendChild(li);
});

        }
      } catch (e) {
        console.warn('Error loading docs for shipment', shipmentId, e);
        docsEl.innerHTML =
          '<li class="ka-ship-muted">(Error loading docs)</li>';
      }
    }

    const renderGrid = (gridEl, fields) => {
      if (!gridEl) return;
      const rows = fields
        .filter(([_, val]) => val !== null && val !== undefined && val !== '')
        .map(
          ([label, val, full]) => `
            <div class="ka-ship-info-row${full ? ' wide' : ''}">
              <div class="ka-ship-info-label">${label}</div>
              <div class="ka-ship-info-value">${val}</div>
            </div>
          `
        )
        .join('');
      gridEl.innerHTML = rows || '<div class="ka-ship-muted">(No details)</div>';
    };

    const orDash = (val) =>
      val === null || val === undefined || val === '' ? '—' : val;

    const itemsVendors = new Set(
      items
        .map(it => (it.vendor_name || '').trim())
        .filter(Boolean)
    );

    const canShowDefaultVendor =
      itemsVendors.size === 1 && itemsVendors.values().next().value;

    // Basic (per user-requested order)
    renderGrid(basicGrid, [
      ['Shipment Title', orDash(shipment.reference || shipment.title)],
      ['BOL #', orDash(shipment.bol_number)],
      ['PO #', orDash(shipment.po_number)],
      ['Internal Ref #', orDash(shipment.sku)],
      ['Project', orDash(shipment.project_name)],
      ...(canShowDefaultVendor
        ? [['Default Vendor', orDash(shipment.vendor_name || Array.from(itemsVendors)[0])]]
        : []),
      ['Freight Forwarder', orDash(shipment.freight_forwarder)],
      ['Status', orDash(shipment.status), true],
      ['Website / Order URL', orDash(shipment.website_url), true],
      ['Tracking #', orDash(shipment.tracking_number), true]
    ]);

    // Dates & tracking
    renderGrid(datesGrid, [
      // intentionally minimal per request
    ]);

    // Payments
    if (paymentsGrid) {
      const ffDoc = kaFindDocByType(
        docsForShipment,
        'Freight Forwarder Proof of Payment'
      );
      const customsDoc = kaFindDocByType(
        docsForShipment,
        'Customs & Clearing Proof of Payment'
      );
      const bolDoc = kaFindDocByType(docsForShipment, 'BOL');

      const boxHtml = (label, paid, amt, doc) => `
        <div class="ka-pay-box ${paid ? 'paid' : 'unpaid'}">
          <div class="ka-pay-label">${label}</div>
          <div class="ka-pay-status">${paid ? '✔ Paid' : '✕ Not paid'}</div>
          <div class="ka-pay-amount">${kaFmtMoney(amt) || '—'}${doc ? ` <a class="ka-pay-doc-link" href="${doc.url || doc.file_path || '#'}" target="_blank" rel="noopener noreferrer">Doc</a>` : ''}</div>
        </div>
      `;

      paymentsGrid.innerHTML = `
        ${boxHtml('Freight Forwarder', shipment.shipper_paid, shipment.shipper_paid_amount, ffDoc)}
        ${boxHtml('Customs & Clearing', shipment.customs_paid, shipment.customs_paid_amount, customsDoc)}
        ${bolDoc ? `<div class="ka-pay-box paid bol-box">
          <div class="ka-pay-label">BOL</div>
          <div class="ka-pay-status"><a class="ka-pay-doc-link" href="${bolDoc.url || bolDoc.file_path || '#'}" target="_blank" rel="noopener noreferrer">Open BOL</a></div>
        </div>` : ''}
      `;

      // Also update the main card payment chips with doc links
      const bar = card.querySelector(
        `.ka-ship-payments[data-payments-bar-for="${shipmentId}"]`
      );
      if (bar) {
        bar.innerHTML = [
          kaPaymentChip('Freight Forwarder', shipment.shipper_paid, shipment.shipper_paid_amount, ffDoc),
          kaPaymentChip('Customs & Clearing', shipment.customs_paid, shipment.customs_paid_amount, customsDoc),
          bolDoc
            ? `<a class="ka-pay-doc-link bol-link" href="${bolDoc.url || bolDoc.file_path || '#'}" target="_blank" rel="noopener noreferrer">BOL</a>`
            : ''
        ]
          .filter(Boolean)
          .join('');
      }
    }

    // Storage & pickup
    kaRenderStorageSection(storageGrid, shipment, card);

    // 3) items + verification controls (unchanged)
    if (itemsEl) {
      itemsEl.innerHTML = '';

      if (!items.length) {
        itemsEl.innerHTML =
          '<div class="ka-ship-muted">(No items on this shipment)</div>';
      } else {
        items.forEach((item) => {
          const v = item.verification || {};
          const status = v.status || '';
          const notes = v.notes || '';
          const lastBy = v.verified_by || '';
          const lastAt = v.verified_at || '';
          const initials = kaInitials(lastBy);

          const rowEl = document.createElement('div');
          rowEl.className = 'ka-ship-item-row';

          rowEl.innerHTML = `
            <div class="ka-ship-item-main">
              <div class="ka-ship-item-desc">${
                item.description || '(No description)'
              }</div>
              <div class="ka-ship-item-qty">
                Qty: <strong>${item.quantity}</strong>
                ${item.unit ? `<span> ${item.unit}</span>` : ''}
              </div>
            </div>

            <div class="ka-ship-item-controls">
              <label>
                Status
                <select data-ship-item-id="${item.id}">
                  <option value="">(none)</option>
                  <option value="verified"${
                    status === 'verified' ? ' selected' : ''
                  }>Verified</option>
                  <option value="missing"${
                    status === 'missing' ? ' selected' : ''
                  }>Missing</option>
                  <option value="damaged"${
                    status === 'damaged' ? ' selected' : ''
                  }>Damaged</option>
                  <option value="wrong_item"${
                    status === 'wrong_item' ? ' selected' : ''
                  }>Wrong item</option>
                </select>
              </label>
              <label>
                Notes
                <textarea rows="2" data-ship-item-notes-id="${item.id}">${
                  notes || ''
                }</textarea>
              </label>
              <div class="ka-ship-item-last">
                ${
                  lastBy || lastAt
                    ? `
                      <div class="ka-ship-item-verifier">
                        <span class="ka-ship-item-initials">${initials || '—'}</span>
                        <span class="ka-ship-item-verifier-meta">
                          ${lastBy || ''}
                          ${lastAt ? ` · ${lastAt.slice(0, 10)}` : ''}
                        </span>
                      </div>
                    `
                    : '<span class="ka-ship-muted">Not verified yet</span>'
                }
              </div>
            </div>
          `;

          const statusSel = rowEl.querySelector('select[data-ship-item-id]');
          const notesEl = rowEl.querySelector(
            'textarea[data-ship-item-notes-id]'
          );
          const itemId = item.id;

          function markDirty() {
            const nowIso = new Date().toISOString();
            const admin = kaCurrentAdmin || {};
            const verifiedBy =
              admin.nickname || admin.name || 'Field Admin';

            kaShipmentItemsDirty.set(itemId, {
              status: statusSel.value || '',
              notes: notesEl.value || '',
              verified_at: nowIso,
              verified_by: verifiedBy,
            });

            const badge = rowEl.querySelector('.ka-ship-item-initials');
            const meta = rowEl.querySelector('.ka-ship-item-verifier-meta');
            if (badge) badge.textContent = kaInitials(verifiedBy) || '—';
            if (meta) {
              meta.textContent = `${verifiedBy || ''}${
                nowIso ? ` · ${nowIso.slice(0, 10)}` : ''
              }`;
            }
          }

          statusSel.addEventListener('change', markDirty);
          notesEl.addEventListener('blur', markDirty);

          itemsEl.appendChild(rowEl);
        });
      }
    }
  } catch (err) {
    console.error('Error loading shipment detail:', err);
    if (itemsEl) {
      itemsEl.innerHTML =
        '<div class="ka-ship-muted">(Error loading shipment detail)</div>';
    }
  }

  // Mark as loaded once all the work is done
  detailEl.dataset.loaded = '1';
}


async function kaSaveShipmentVerificationFor(shipmentId) {
  if (!shipmentId || !kaShipmentItemsDirty.size) return;

  const statusEl = document.getElementById('ka-kiosk-status');
  if (statusEl) {
    statusEl.textContent = 'Saving shipment verification…';
    statusEl.className = 'ka-status';
  }

  try {
    const payload = [];
    kaShipmentItemsDirty.forEach((v, shipmentItemId) => {
      payload.push({
        shipment_item_id: shipmentItemId,
        verification: v,
      });
    });

    await fetchJSON(`/api/shipments/${shipmentId}/verify-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: payload }),
    });

    if (statusEl) {
      statusEl.textContent = 'Shipment verification saved.';
      statusEl.className = 'ka-status ka-status-ok';
    }

    kaShipmentItemsDirty.clear();
    // refresh cards so tags update
    await kaLoadShipments();
  } catch (err) {
    console.error('Error saving shipment verification:', err);
    if (statusEl) {
      statusEl.textContent = 'Error saving shipment verification.';
      statusEl.className = 'ka-status ka-status-error';
    }
  }
}



// --- Sessions (projects for this kiosk) ---

function kaRenderSessions() {
  const listEl = document.getElementById('ka-session-list');
  const statusEl = document.getElementById('ka-session-status');
  if (!listEl) return;

  if (!kaSessions || !kaSessions.length) {
    listEl.innerHTML = '<div class="ka-muted">(no sessions yet — add a project to start)</div>';
    return;
  }

  listEl.innerHTML = '';
  kaSessions.forEach((s) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'ka-session-row';
    wrapper.dataset.sessionId = s.id;

    const isActive = kaActiveSessionId && Number(kaActiveSessionId) === Number(s.id);

    const label = kaProjectLabelById(s.project_id) || '(Unknown project)';

    wrapper.innerHTML = `
      <div class="ka-session-info">
        <span class="ka-session-active-icon ${isActive ? 'is-active' : ''}" aria-label="${isActive ? 'Active session' : 'Inactive session'}"></span>
        <div>
          <div><strong>${label}</strong></div>
          <div class="ka-label-note">Created at ${s.created_at || ''}</div>
          <div class="ka-label-note">${s.open_count || 0} worker(s) clocked in on this tablet</div>
        </div>
      </div>
      <div>
        <button class="btn ghost btn-sm ka-icon-btn" title="View current workers" data-ka-view-workers="${s.id}">
          <img src="/icons/worker.svg" alt="View current workers" class="ka-icon-img" />
          <span>View Current Workers</span>
        </button>
      </div>
    `;

    listEl.appendChild(wrapper);
  });

  if (statusEl) statusEl.textContent = '';
}

function kaUpdateEndSessionButton() {
  const btn = document.getElementById('ka-end-session-live');
  if (!btn) return;
  const hasActive = !!kaActiveSessionId;
  btn.style.display = hasActive ? 'inline-flex' : 'none';
}

async function kaLoadSessions() {
  if (!kaKiosk) return;

  const listEl = document.getElementById('ka-session-list');
  const statusEl = document.getElementById('ka-session-status');
  if (listEl) {
    listEl.innerHTML = '<div class="ka-muted">(loading sessions…)</div>';
  }

  try {
    const rows = await fetchJSON(`/api/kiosks/${kaKiosk.id}/sessions`);
    kaSessions = rows || [];

    // If we don't have an active session, try to pick the most recent one for the current project
    if (!kaActiveSessionId && kaKiosk && kaKiosk.project_id) {
      const matches = kaSessions
        .filter(s => Number(s.project_id) === Number(kaKiosk.project_id))
        .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
      if (matches.length) {
        kaActiveSessionId = matches[matches.length - 1].id;
      }
    }

    kaRenderSessions();
    kaUpdateEndSessionButton();
  } catch (err) {
    console.error('Error loading sessions for kiosk', err);
    if (statusEl) {
      statusEl.textContent = 'Error loading sessions.';
      statusEl.classList.add('ka-status-error');
    }
  }
}

async function kaSetActiveSession(sessionId) {
  if (!kaKiosk || !sessionId) return;
  const statusEl = document.getElementById('ka-session-status');
  if (statusEl) {
    statusEl.textContent = 'Setting active session on the kiosk…';
    statusEl.className = 'ka-status';
  }

  try {
    const data = await fetchJSON(`/api/kiosks/${kaKiosk.id}/active-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: Number(sessionId) })
    });

    kaActiveSessionId = Number(sessionId);
    if (data && data.project_id) {
      kaKiosk.project_id = data.project_id;
    }

    await kaLoadSessions();
    kaRenderProjectsSelect();
    kaLoadLiveWorkers();
    kaUpdateEndSessionButton();
    document.getElementById('ka-live-card')?.scrollIntoView({ behavior: 'smooth' });

    if (statusEl) {
      statusEl.textContent = 'Session for this project already started. Workers remain clocked in.';
      statusEl.className = 'ka-status ka-status-ok';
    }
  } catch (err) {
    console.error('Error setting active session:', err);
    if (statusEl) {
      statusEl.textContent = 'Could not set active session.';
      statusEl.className = 'ka-status ka-status-error';
    }
  }
}

async function kaAddSession() {
  if (!kaKiosk) return;
  const select = document.getElementById('ka-project-select');
  const statusEl = document.getElementById('ka-session-status');
  const projectId = select && select.value ? Number(select.value) : null;

  if (!projectId) {
    if (statusEl) {
      statusEl.textContent = 'Select a project before adding a session.';
      statusEl.className = 'ka-status ka-status-error';
    }
    return;
  }

  // If a session for this project already exists today, just make it active
  const existing = (kaSessions || []).find(
    s => Number(s.project_id) === Number(projectId)
  );
  if (existing) {
    if (statusEl) {
      statusEl.textContent = 'Session already exists for this project today. Setting it active…';
      statusEl.className = 'ka-status';
    }
    await kaSetActiveSession(existing.id);
    return;
  }

  if (statusEl) {
    statusEl.textContent = 'Adding session and setting it active on the kiosk…';
    statusEl.className = 'ka-status';
  }

  try {
    await fetchJSON(`/api/kiosks/${kaKiosk.id}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        make_active: true
      })
    });

    kaKiosk.project_id = projectId;
    await kaLoadSessions();
    kaRenderProjectsSelect();
    kaLoadLiveWorkers();
    kaUpdateEndSessionButton();

    if (statusEl) {
      statusEl.textContent = 'Session added and set active.';
      statusEl.className = 'ka-status ka-status-ok';
    }

    kaShowReturnPrompt('Project set and ready. Go back to the worker clock-in page?');
  } catch (err) {
    console.error('Error adding session:', err);
    if (statusEl) {
      statusEl.textContent = 'Could not add session.';
      statusEl.className = 'ka-status ka-status-error';
    }
  }
}

function kaShowView(view) {
  // Block Shipments view if this admin doesn't have access
  if (view === 'shipments' && !kaCanViewShipments()) {
    const status = document.getElementById('ka-kiosk-status');
    if (status) {
      status.textContent = 'You do not have access to the Shipments tab.';
      status.className = 'ka-status ka-status-error';
    }
    return;
  }

  if (view === 'time' && !kaCanViewTimeReports()) {
    const status = document.getElementById('ka-kiosk-status');
    if (status) {
      status.textContent = 'You do not have access to Time Entries.';
      status.className = 'ka-status ka-status-error';
    }
    return;
  }

  kaCurrentView = view;

  // Lazy-load shipments when the tab is shown
  if (view === 'shipments') {
    kaLoadShipments();
  }

  KA_VIEWS.forEach(v => {
    const section = document.getElementById(`ka-view-${v}`);
    if (section) {
      section.classList.toggle('hidden', v !== view);
    }

    const btn = document.querySelector(
      `.ka-bottom-nav button[data-ka-view="${v}"]`
    );
    if (btn) {
      if (v === view) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });
}


async function kaLoadShipments() {

  // Extra safety: only load when Shipments tab is active
  if (kaCurrentView !== 'shipments') {
    return;
  }
  if (!kaCanViewShipments()) return;

  if (!kaKiosk) return;

  const listEl = document.getElementById('ka-shipments-list');
  const filterEl = document.getElementById('ka-shipments-filter');
  const projEl = document.getElementById('ka-shipments-project');
  const adminId = kaAdminAuthId();

  const mode =
    filterEl?.value || 'status:Cleared - Ready for Release';
  if (!listEl) return;

  if (!adminId) {
    listEl.innerHTML =
      '<div class="ka-ship-muted">(Log in as a kiosk admin with shipments access to view this tab.)</div>';
    return;
  }

  listEl.innerHTML = '<div class="ka-ship-muted">(loading shipments…)</div>';

  try {
    const params = new URLSearchParams();

    params.set('employee_id', adminId);

    if (mode === 'ready') {
      params.set('status', 'Cleared - Ready for Release');
    } else if (mode === 'all') {
      // no status param
    } else if (mode.startsWith('status:')) {
      const statusValue = mode.slice('status:'.length);
      params.set('status', statusValue);
    }

    const projVal = projEl?.value ? projEl.value : '';
    if (projVal) {
      params.set('project_id', projVal);
    }

    const data = await fetchJSON(
      '/api/reports/shipment-verification?' + params.toString()
    );

    const rows = Array.isArray(data && data.shipments)
      ? data.shipments
      : [];

    kaShipments = rows;
    kaApplyNotifyPrefToUI(kaNotifyPref, kaNotifyStatusesSource());
    kaProcessNewShipmentsForAlert();
    await kaStartNotifyTimer(false);
    await kaReminderCheck(true);

    if (!rows.length) {
      let label;
      if (mode === 'all') {
        label = 'No shipments found for this project.';
      } else if (mode.startsWith('status:')) {
        const statusValue = mode.slice('status:'.length);
        label = `No shipments with status "${statusValue}".`;
      } else {
        label = 'No shipments.';
      }

      listEl.innerHTML = `<div class="ka-ship-muted">(${label})</div>`;
      return;
    }

    listEl.innerHTML = '';

    rows.forEach(row => {
      const card = document.createElement('div');
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
      card.className = 'ka-ship-card';
      card.dataset.shipmentId = row.id;

      const when = row.requested_date || row.created_at || '';
      // Show vendor only when a single vendor is set; otherwise "Multiple vendors"
      const vendor =
        row.vendor_name &&
        row.vendor_name.trim() &&
        (row.distinct_item_vendors === null ||
          row.distinct_item_vendors === undefined ||
          Number(row.distinct_item_vendors) <= 1)
          ? row.vendor_name
          : 'Multiple vendors';
      const project = row.project_name || '';
      const statusText = row.status || '';
      const dueDate = row.storage_due_date || '';
      const dailyLateFee =
        row.storage_daily_late_fee != null
          ? Number(row.storage_daily_late_fee)
          : null;
      const totalItems = Number(row.items_total || 0);
      const verifiedCount = Number(row.items_verified_count || 0);
      const pendingCount = Math.max(0, totalItems - verifiedCount);
      const { daysLate, estimate } = kaCalcStorageLateFees(
        dueDate,
        dailyLateFee
      );
      const dueLabel = dueDate ? kaFormatDateIso(dueDate) : 'No due date set';
      const lateFeeLabel =
        daysLate > 0 && estimate > 0
          ? `${daysLate} day${daysLate === 1 ? '' : 's'} late · Est. $${estimate.toFixed(2)}`
          : '';

      const statusLabel = row.items_verified
        ? '<span class="ka-tag green">✓ All verified</span>'
        : '<span class="ka-tag orange">Needs verification</span>';
      const pendingNumber = pendingCount || totalItems || 0;
      const verifyCard = row.items_verified
        ? ''
        : `
            <div class="ka-verify-card" data-verify-for="${row.id}">
              <div class="ka-verify-title">Needs verification <span class="ka-verify-count-inline">(${pendingNumber})</span></div>
              <div class="ka-verify-hint">Tap to review items</div>
            </div>
          `;

      card.innerHTML = `
  <div class="ka-ship-card-main">
    <div class="ka-ship-top">
      <div class="ka-ship-title-row">
        <div class="ka-ship-title">${row.title || row.reference || 'Shipment #'+row.id}</div>
        ${row.bol_number ? `<a class="ka-ship-bol disabled" data-bol-for="${row.id}">BOL ${row.bol_number}</a>` : ''}
      </div>
      <div class="ka-ship-top-right">
        <div class="ka-ship-due-inline ${lateFeeLabel ? 'late' : ''}">
          <span class="label">Due</span>
          <span class="value">${dueLabel}</span>
          ${lateFeeLabel ? `<span class="late-text">${lateFeeLabel}</span>` : ''}
        </div>
        <button class="ka-ship-expand" type="button" aria-label="Expand shipment" aria-expanded="false">▾</button>
      </div>
    </div>
    <div class="ka-ship-line-sub">
      <span>${vendor}</span>
      ${project ? `<span>• ${project}</span>` : ''}
      ${when ? `<span>• ${(when || '').slice(0, 10)}</span>` : ''}
    </div>

    <div class="ka-ship-inline">
      <div class="ka-ship-payments" data-payments-bar-for="${row.id}">
        ${kaPaymentBadge(row.shipper_paid, row.shipper_paid_amount, 'Forwarder')}
        ${kaPaymentBadge(row.customs_paid, row.customs_paid_amount, 'Customs')}
      </div>
      ${verifyCard}
    </div>
    <div class="ka-ship-status bottom">
      <div class="ka-ship-status-tags">
        ${
          (mode === 'all' || mode.startsWith('status:')) && statusText
            ? `<span class="ka-tag gray">${statusText}</span>`
            : ''
        }
      </div>
    </div>
  </div>

  <div class="ka-ship-card-detail" data-detail-for="${row.id}">
    <div class="ka-ship-detail-body">

      <!-- BASIC INFO -->
      <div class="ka-ship-detail-section">
        <div class="ka-ship-section-header">
          <div class="ka-ship-detail-label">Basic Info</div>
          <button
            type="button"
            class="ka-ship-toggle"
            data-target-box="basic"
            data-sid="${row.id}"
          >
            Show
          </button>
        </div>
        <div
          class="ka-ship-info-box collapsed"
          data-basic-box-for="${row.id}"
        >
          <div class="ka-ship-detail-grid" data-basic-grid-for="${row.id}">
            <div class="ka-ship-muted">(loading…)</div>
          </div>
        </div>
      </div>

      <!-- DATES & TRACKING -->
      <!-- PAYMENTS -->
      <div class="ka-ship-detail-section">
        <div class="ka-ship-section-header">
          <div class="ka-ship-detail-label">Payments</div>
          <button
            type="button"
            class="ka-ship-toggle"
            data-target-box="payments"
            data-sid="${row.id}"
          >
            Show
          </button>
        </div>
        <div
          class="ka-ship-info-box collapsed"
          data-payments-box-for="${row.id}"
        >
          <div class="ka-ship-detail-grid" data-payments-grid-for="${row.id}">
            <div class="ka-ship-muted">(loading…)</div>
          </div>
        </div>
      </div>

      <!-- DOCS BOX -->
      <div class="ka-ship-detail-section">
        <div class="ka-ship-section-header">
          <div class="ka-ship-detail-label">Documents</div>
          <button
            type="button"
            class="ka-ship-docs-toggle"
            data-docs-toggle-for="${row.id}"
          >
            Show
          </button>
        </div>
        <div
          class="ka-ship-docs-box collapsed"
          data-docs-box-for="${row.id}"
        >
          <ul class="ka-ship-doc-list" data-docs-for="${row.id}">
            <li class="ka-ship-muted">(loading…)</li>
          </ul>
        </div>
      </div>

      <!-- STORAGE & PICKUP -->
      <div class="ka-ship-detail-section">
        <div class="ka-ship-section-header">
          <div class="ka-ship-detail-label">Storage & Pickup (optional)</div>
          <button
            type="button"
            class="ka-ship-toggle"
            data-target-box="storage"
            data-sid="${row.id}"
          >
            Show
          </button>
        </div>
        <div
          class="ka-ship-info-box collapsed"
          data-storage-box-for="${row.id}"
        >
          <div class="ka-ship-detail-grid" data-storage-grid-for="${row.id}">
            <div class="ka-ship-muted">(loading…)</div>
          </div>
        </div>
      </div>

      <!-- ITEMS BOX -->
      <div class="ka-ship-detail-section">
      <div class="ka-ship-items-header">
        <div class="ka-ship-detail-label">Items & Verification</div>
        <button
          type="button"
          class="ka-ship-items-toggle"
          data-items-open-for="${row.id}"
        >
          Verify items
        </button>
      </div>
      <div class="ka-ship-items-list collapsed" data-items-for="${row.id}">
        <div class="ka-ship-muted">(loading…)</div>
      </div>
      </div>

    </div>
  </div>
`;


            // Items toggle inside card – just expands/collapses the items list
      // Items toggle inside card – just expands/collapses the items list
const itemsToggle = card.querySelector('button[data-items-open-for]');
if (itemsToggle) {
  itemsToggle.addEventListener('click', async (e) => {
    e.stopPropagation(); // don't open/close the whole card
    const sid = itemsToggle.getAttribute('data-items-open-for');
    if (!sid) return;
    await kaOpenItemsModal(Number(sid));
  });
}

/* 🔹 NEW: Docs toggle, same idea as items */
const docsToggle = card.querySelector('button[data-docs-toggle-for]');
if (docsToggle) {
  docsToggle.addEventListener('click', (e) => {
    e.stopPropagation();

    const sid = docsToggle.getAttribute('data-docs-toggle-for');
    const box = card.querySelector(
      `.ka-ship-docs-box[data-docs-box-for="${sid}"]`
    );
    if (!box) return;

    const isExpanded = box.classList.contains('expanded');
    box.classList.toggle('expanded', !isExpanded);
    box.classList.toggle('collapsed', isExpanded);
    docsToggle.textContent = isExpanded ? 'Show' : 'Hide';
  });
}

// Expand/collapse arrow
const expandBtn = card.querySelector('.ka-ship-expand');
if (expandBtn) {
  expandBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    kaToggleShipmentCard(card, row.id);
  });
}

// BOL pill toggles BOL detail
const bolBtn = card.querySelector('.ka-ship-bol');
if (bolBtn) {
  bolBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const href = bolBtn.dataset.bolUrl || bolBtn.href;
    if (href && !bolBtn.classList.contains('disabled')) {
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
  });
}

// Needs verification card opens items modal
const verifyCardEl = card.querySelector('.ka-verify-card');
if (verifyCardEl) {
  verifyCardEl.addEventListener('click', (e) => {
    e.stopPropagation();
    kaOpenItemsModal(row.id);
  });
}

// Prefetch docs/payments/bol for this card so header controls work pre-expand
kaHydrateShipmentCard(row.id, adminId);

// Section toggles (basic / dates / payments / storage)
card.querySelectorAll('.ka-ship-toggle').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const target = btn.dataset.targetBox;
    const sid = btn.dataset.sid;
    if (!target || !sid) return;
    const box = card.querySelector(
      `.ka-ship-info-box[data-${target}-box-for="${sid}"]`
    );
    if (!box) return;
    const isExpanded = !box.classList.contains('collapsed');
    box.classList.toggle('collapsed', isExpanded);
    box.classList.toggle('expanded', !isExpanded);
    btn.textContent = isExpanded ? 'Show' : 'Hide';
  });
});


      kaRenderPaymentBar(row.id, null);
      listEl.appendChild(card);

      // Default BOL detail state
      kaUpdateBolDetail(row.id, null);
    });
  } catch (err) {
    console.error('Error loading shipments for kiosk admin:', err);
    listEl.innerHTML = '<div class="ka-ship-muted">(Error loading shipments)</div>';
  }
}



async function kaOpenShipmentDetail(shipmentId) {
  const detailWrap = document.getElementById('ka-shipment-detail');
  const titleEl = document.getElementById('ka-shipment-detail-title');
  const metaEl = document.getElementById('ka-shipment-detail-meta');
  const docsEl = document.getElementById('ka-shipment-docs');
  const itemsEl = document.getElementById('ka-shipment-items');
  if (!detailWrap || !titleEl || !metaEl || !docsEl || !itemsEl) return;

  detailWrap.classList.remove('hidden');
  itemsEl.innerHTML = '<div class="ka-muted">(loading items…)</div>';
  docsEl.innerHTML = '<li class="ka-muted">(loading documents…)</li>';
  kaShipmentItemsDirty.clear();
  kaShipmentDetail = null;

  try {
    // 1) Verification detail (metadata + items)
    const adminId = kaAdminAuthId();
    const report = await fetchJSON(
      '/api/reports/shipment-verification?shipment_id=' +
        shipmentId +
        (adminId ? `&employee_id=${adminId}` : '')
    );
    const shipment = report.shipment || {};
    const items = Array.isArray(report.items) ? report.items : [];
    kaShipmentDetail = { shipment, items };

    const headerTitle = shipment.reference || `Shipment #${shipment.id}`;
    const vendor = shipment.vendor_name || '(Vendor unknown)';
    const project = shipment.project_name || '';
    const addr = shipment.delivery_address || '';
    const dateStr = (shipment.requested_date || shipment.created_at || '').slice(0,10);

    titleEl.textContent = headerTitle;
    metaEl.textContent = [
      vendor,
      project && `Project: ${project}`,
      dateStr && `Requested: ${dateStr}`,
      addr && `Deliver to: ${addr}`,
    ].filter(Boolean).join(' • ');

    // 2) Documents (download on tablet/phone)
    try {
      const docResp = await fetchJSON(
        `/api/shipments/${shipmentId}/documents${adminId ? `?employee_id=${adminId}` : ''}`
      );
      const docs = kaNormalizeDocs(docResp);
      docsEl.innerHTML = '';
      const bolDoc = kaFindDocByType(docs, 'bol');
      kaSetBolLink(shipmentId, bolDoc);
      if (!docs || !docs.length) {
        docsEl.innerHTML = '<li class="ka-muted">(No documents uploaded)</li>';
      } else {
        docs.forEach(doc => {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.href = doc.url;  // your API returns full URL (same as desktop)
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = doc.label || doc.filename;
          li.appendChild(a);
          docsEl.appendChild(li);
        });
      }
    } catch (e) {
      console.warn('Error loading docs for shipment', shipmentId, e);
      docsEl.innerHTML = '<li class="ka-muted">(Error loading docs)</li>';
    }

    // 3) Items + verification controls
    itemsEl.innerHTML = '';
    if (!items.length) {
      itemsEl.innerHTML = '<div class="ka-muted">(No items on this shipment)</div>';
    } else {
      items.forEach(item => {
        const v = item.verification || {};
        const status = v.status || '';
        const notes = v.notes || '';
        const lastBy = v.verified_by || '';
        const lastAt = v.verified_at || '';

        const container = document.createElement('div');
        container.className = 'ka-item-row';

        container.innerHTML = `
          <div class="ka-item-main">
            <div class="ka-item-desc">${item.description || '(No description)'}</div>
            <div class="ka-item-qty">
              Qty: <strong>${item.quantity}</strong>
              ${item.unit ? `<span class="ka-muted">${item.unit}</span>` : ''}
            </div>
          </div>

          <div class="ka-item-controls">
            <label>
              Status
              <select data-ship-item-id="${item.id}">
                <option value="">(none)</option>
                <option value="verified"${status === 'verified' ? ' selected' : ''}>Verified</option>
                <option value="missing"${status === 'missing' ? ' selected' : ''}>Missing</option>
                <option value="damaged"${status === 'damaged' ? ' selected' : ''}>Damaged</option>
                <option value="wrong_item"${status === 'wrong_item' ? ' selected' : ''}>Wrong item</option>
              </select>
            </label>
            <label>
              Notes
              <textarea rows="2" data-ship-item-notes-id="${item.id}">${notes || ''}</textarea>
            </label>
            <div class="ka-item-last">
              ${
                lastBy || lastAt
                  ? `Last: ${lastBy || ''} ${lastAt ? 'on ' + lastAt.slice(0,10) : ''}`
                  : '<span class="ka-muted">Not verified yet</span>'
              }
            </div>
          </div>
        `;

        const statusSel = container.querySelector('select[data-ship-item-id]');
        const notesEl = container.querySelector('textarea[data-ship-item-notes-id]');
        const itemId = item.id;

        function markDirty() {
          const nowIso = new Date().toISOString();
          const foreman = window.kaForeman || null;  // whatever you load in kaLoadForeman()
          const verifiedBy = foreman
            ? (foreman.initials || foreman.nickname || foreman.name)
            : 'Field Admin';

          kaShipmentItemsDirty.set(itemId, {
            status: statusSel.value || '',
            notes: notesEl.value || '',
            verified_at: nowIso,        // you already decided: update date every change
            verified_by: verifiedBy,
          });
        }

        statusSel.addEventListener('change', markDirty);
        notesEl.addEventListener('blur', markDirty);

        itemsEl.appendChild(container);
      });
    }
  } catch (err) {
    console.error('Error loading shipment detail:', err);
    itemsEl.innerHTML = '<div class="ka-muted">(Error loading shipment detail)</div>';
  }
}


async function kaSaveShipmentVerification() {
  if (!kaShipmentDetail || !kaShipmentItemsDirty.size) return;

  const statusEl = document.getElementById('ka-kiosk-status');
  if (statusEl) {
    statusEl.textContent = 'Saving shipment verification…';
    statusEl.className = 'ka-status';
  }

  try {
    const payload = [];
    kaShipmentItemsDirty.forEach((v, shipmentItemId) => {
      payload.push({
        shipment_item_id: shipmentItemId,
        verification: v,
      });
    });

    await fetchJSON(`/api/shipments/${kaShipmentDetail.shipment.id}/verify-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: payload }),
    });

    if (statusEl) {
      statusEl.textContent = 'Shipment verification saved.';
      statusEl.className = 'ka-status ka-status-ok';
    }

    kaShipmentItemsDirty.clear();
    kaLoadShipments(); // refresh cards so tags update
  } catch (err) {
    console.error('Error saving shipment verification:', err);
    if (statusEl) {
      statusEl.textContent = 'Error saving shipment verification.';
      statusEl.className = 'ka-status ka-status-error';
    }
  }
}


async function kaChangeProjectOnly() {
  if (!kaKiosk) return;

  const sel = document.getElementById('ka-project-select');
  const status = document.getElementById('ka-kiosk-status');

  const projectId = sel && sel.value ? Number(sel.value) : null;

  if (!projectId) {
    if (status) {
      status.textContent = "Select a project before saving.";
      status.className = "ka-status ka-status-error";
    }
    return;
  }

  try {
    // Save kiosk project
    await fetchJSON("/api/kiosks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: kaKiosk.id,
        name: kaKiosk.name,
        location: kaKiosk.location,
        device_id: kaKiosk.device_id,
        project_id: projectId
      })
    });

    // Update local model
    kaKiosk.project_id = projectId;

    if (status) {
      status.textContent = "Project updated. Workers remain clocked in.";
      status.className = "ka-status ka-status-ok";
    }

    // Live worker refresh doesn't clock anyone out now
    kaLoadLiveWorkers();

  } catch (err) {
    console.error("Error saving kiosk project:", err);
    if (status) {
      status.textContent = "Error saving project.";
      status.className = "ka-status ka-status-error";
    }
  }
}



async function kaSetEntryVerified(entryId, verified, { reload = false } = {}) {
  const status = document.getElementById('ka-time-status');

  if (!kaStartEmployeeId) {
    if (status) {
      status.textContent = 'Cannot verify: missing admin employee id in URL.';
      status.className = 'ka-status ka-status-error';
    }
    return;
  }

  try {
    if (status) {
      status.textContent = verified
        ? 'Marking entry as verified…'
        : 'Clearing verification…';
      status.className = 'ka-status';
    }

    await fetchJSON(`/api/time-entries/${entryId}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        verified,
        verified_by_employee_id: Number(kaStartEmployeeId)
      })
    });

    if (reload) {
      await kaLoadTimeEntries();
    } else if (status) {
      status.textContent = 'Verification updated.';
      status.className = 'ka-status ka-status-ok';
    }
  } catch (err) {
    console.error('Error updating verification:', err);
    if (status) {
      status.textContent = 'Error updating verification.';
      status.className = 'ka-status ka-status-error';
    }
  }
}

async function kaVerifyAllTimeEntriesVisible() {
  const tbody = document.getElementById('ka-time-body');
  const status = document.getElementById('ka-time-status');
  if (!tbody) return;

  const rows = Array.from(tbody.querySelectorAll('tr[data-entry-id]'));
  const ids = rows
    .filter(r => r.dataset.verified !== '1')
    .map(r => r.dataset.entryId);

  if (!ids.length) {
    if (status) {
      status.textContent = 'All visible entries are already verified.';
      status.className = 'ka-status ka-status-ok';
    }
    return;
  }

  const confirmMsg =
    'This will mark ALL visible time entries in the current date range as verified for accuracy.\n\n' +
    'Are you sure you have reviewed them?';
  if (!window.confirm(confirmMsg)) return;

  try {
    if (status) {
      status.textContent = 'Verifying all visible entries…';
      status.className = 'ka-status';
    }

    // Do them sequentially; small N so this is fine
    for (const id of ids) {
      await kaSetEntryVerified(id, true, { reload: false });
    }

    await kaLoadTimeEntries();

    if (status) {
      status.textContent = 'All visible time entries have been marked as verified.';
      status.className = 'ka-status ka-status-ok';
    }
  } catch (err) {
    console.error('Error verifying all entries:', err);
    if (status) {
      status.textContent = 'Error verifying all entries.';
      status.className = 'ka-status ka-status-error';
    }
  }
}

async function kaApproveEntry(entry) {
  await kaSetEntryVerified(entry.id, true, { reload: false });
  await kaLoadTimeEntries();
}

async function kaRejectEntry(entry) {
  await kaSetEntryVerified(entry.id, false, { reload: false });
  await kaLoadTimeEntries();
}

async function kaModifyEntry(entry) {
  await kaLoadTimeEntries();
}

function kaOpenTimeActionModal(entry, mode) {
  kaTimeActionEntry = entry;
  kaTimeActionMode = mode;

  const backdrop = document.getElementById('ka-time-action-backdrop');
  const title = document.getElementById('ka-time-action-title');
  const sub = document.getElementById('ka-time-action-sub');
  const note = document.getElementById('ka-time-action-note');
  const hoursWrap = document.getElementById('ka-time-action-hours-wrap');
  const hoursInput = document.getElementById('ka-time-action-hours');
  const dateInput = document.getElementById('ka-time-action-date');
  const startInput = document.getElementById('ka-time-action-start');
  const endInput = document.getElementById('ka-time-action-end');
  const projSel = document.getElementById('ka-time-action-project');
  const status = document.getElementById('ka-time-action-status');
  const origDate = document.getElementById('ka-time-action-orig-date');
  const origProj = document.getElementById('ka-time-action-orig-project');
  const origStart = document.getElementById('ka-time-action-orig-start');
  const origEnd = document.getElementById('ka-time-action-orig-end');
  if (!backdrop || !title || !sub || !note || !hoursWrap || !status) return;

  const isModify = mode === 'modify';
  const isApprove = mode === 'approve';
  const isReject = mode === 'reject';

  title.textContent =
    isApprove ? 'Approve Time Entry'
    : isReject ? 'Reject Time Entry'
    : 'Modify Time Entry';

  const emp = entry.employee_name || '(Unknown)';
  const proj = kaProjectLabelById(entry.project_id) || '(No project)';
  sub.textContent = `${emp} — ${proj} — ${entry.start_date || entry.end_date || ''}`;
  if (origDate) origDate.textContent = entry.start_date || entry.end_date || '—';
  if (origProj) origProj.textContent = proj || '—';
  if (origStart) origStart.textContent = entry.start_time || '—';
  if (origEnd) origEnd.textContent = entry.end_time || '—';

  note.value = '';
  status.textContent = '';
  status.className = 'ka-status';

  if (dateInput) dateInput.value = entry.start_date || entry.end_date || '';
  if (startInput) startInput.value = entry.start_time || '';
  if (endInput) endInput.value = entry.end_time || '';
  hoursWrap.style.display = isModify ? 'block' : 'none';
  // Keep pair rows visible, but disable date edits (day cannot change)

  if (isModify && hoursInput) {
    hoursInput.value = entry.hours != null ? Number(entry.hours).toFixed(2) : '';
  }

  if (projSel) {
    kaSetOptionList(projSel, kaProjects, { placeholder: '(keep current)' });
    if (isModify && entry.project_id) {
      projSel.value = String(entry.project_id);
    } else {
      projSel.value = '';
    }
  }

  backdrop.classList.remove('hidden');
  // Avoid auto-focusing a text field so mobile keyboards don't pop immediately
  setTimeout(() => {
    if (note) note.blur();
  }, 50);
}

async function kaHandleTimeActionSubmit() {
  const backdrop = document.getElementById('ka-time-action-backdrop');
  const note = document.getElementById('ka-time-action-note');
  const hoursInput = document.getElementById('ka-time-action-hours');
  const dateInput = document.getElementById('ka-time-action-date');
  const startInput = document.getElementById('ka-time-action-start');
  const endInput = document.getElementById('ka-time-action-end');
  const projSel = document.getElementById('ka-time-action-project');
  const status = document.getElementById('ka-time-action-status');
  if (!kaTimeActionEntry || !kaTimeActionMode || !note || !status) return;

  const noteVal = note.value.trim();
  if (!noteVal) {
    status.textContent = 'A note is required.';
    status.className = 'ka-status ka-status-error';
    return;
  }

  status.textContent = 'Saving…';
  status.className = 'ka-status';

  const name = kaAdminDisplayName();
  const resolvedAt = new Date().toISOString();
  const resolveNote =
    kaTimeActionMode === 'approve'
      ? `${name} • Approved: ${noteVal}`
      : kaTimeActionMode === 'reject'
        ? `${name} • Rejected: ${noteVal}`
        : `${name} • Modified: ${noteVal}`;

  try {
    if (kaTimeActionMode === 'approve') {
      await kaSetEntryVerified(kaTimeActionEntry.id, true, { reload: false });
      await fetchJSON(`/api/time-entries/${kaTimeActionEntry.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resolved: true,
          resolved_by: resolveNote,
          resolved_at: resolvedAt
        })
      });
    } else if (kaTimeActionMode === 'reject') {
      await kaSetEntryVerified(kaTimeActionEntry.id, false, { reload: false });
      await fetchJSON(`/api/time-entries/${kaTimeActionEntry.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resolved: true,
          resolved_by: resolveNote,
          resolved_at: resolvedAt
        })
      });
    } else if (kaTimeActionMode === 'modify') {
      const hoursNumRaw = hoursInput?.value;
      const hoursNum = hoursNumRaw ? Number(hoursNumRaw) : Number(kaTimeActionEntry.hours || 0);
      if (Number.isNaN(hoursNum)) {
        status.textContent = 'Hours must be a number.';
        status.className = 'ka-status ka-status-error';
        return;
      }
      const projectId = projSel && projSel.value ? Number(projSel.value) : kaTimeActionEntry.project_id;
      const newDate = dateInput && dateInput.value ? dateInput.value : (kaTimeActionEntry.start_date || kaTimeActionEntry.end_date || kaTodayIso());
      const startTime = startInput && startInput.value ? startInput.value : (kaTimeActionEntry.start_time || '00:00');
      const endTime = endInput && endInput.value ? endInput.value : (kaTimeActionEntry.end_time || '00:00');
      const computedHours = (() => {
        if (!startInput?.value || !endInput?.value) return null;
        const [sh, sm] = startInput.value.split(':').map(Number);
        const [eh, em] = endInput.value.split(':').map(Number);
        if ([sh, sm, eh, em].some(Number.isNaN)) return null;
        const diff = (eh * 60 + em) - (sh * 60 + sm);
        return diff > 0 ? diff / 60 : null;
      })();
      const payload = {
        employee_id: kaTimeActionEntry.employee_id,
        project_id: projectId,
        start_date: newDate,
        end_date: newDate,
        start_time: startTime,
        end_time: endTime,
        hours: computedHours != null ? computedHours : hoursNum
      };

      await fetchJSON(`/api/time-entries/${kaTimeActionEntry.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      await fetchJSON(`/api/time-entries/${kaTimeActionEntry.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resolved: true,
          resolved_by: resolveNote,
          resolved_at: resolvedAt
        })
      });
    }

    if (backdrop) backdrop.classList.add('hidden');
    await kaLoadTimeEntries();
  } catch (err) {
    console.error('Error applying time entry action:', err);
    status.textContent = 'Error: ' + (err.message || err);
    status.className = 'ka-status ka-status-error';
  }
}



// Small helper copied from kiosk.js
async function fetchJSON(url, options = {}) {
  const opts = Object.assign({ credentials: 'include' }, options);
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
  return data;
}

function kaAdminAuthId() {
  return (kaCurrentAdmin && kaCurrentAdmin.id) || kaStartEmployeeId || null;
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

function kaShowEndSessionModal() {
  const backdrop = document.getElementById('ka-end-session-backdrop');
  const pin1 = document.getElementById('ka-end-pin-1');
  const pin2 = document.getElementById('ka-end-pin-2');
  const status = document.getElementById('ka-end-session-status');
  const cancel = document.getElementById('ka-end-session-cancel');
  const confirmBtn = document.getElementById('ka-end-session-confirm');
  if (!backdrop || !pin1 || !pin2 || !status || !cancel || !confirmBtn) return;

  pin1.value = '';
  pin2.value = '';
  status.textContent = '';
  status.className = 'ka-status';

  const close = () => {
    backdrop.classList.add('hidden');
  };

  cancel.onclick = close;
  backdrop.onclick = (e) => {
    if (e.target === backdrop) close();
  };

  confirmBtn.onclick = async () => {
    const p1 = (pin1.value || '').trim();
    const p2 = (pin2.value || '').trim();
    if (!p1 || !p2) {
      status.textContent = 'Enter your PIN twice to confirm.';
      status.className = 'ka-status ka-status-error';
      return;
    }
    if (p1 !== p2) {
      status.textContent = 'PINs do not match. Try again.';
      status.className = 'ka-status ka-status-error';
      return;
    }

    const adminPin = (kaCurrentAdmin && kaCurrentAdmin.pin || '').trim();
    if (!adminPin) {
      status.textContent = 'No PIN found for this admin.';
      status.className = 'ka-status ka-status-error';
      return;
    }
    if (p1 !== adminPin) {
      status.textContent = 'Incorrect PIN.';
      status.className = 'ka-status ka-status-error';
      return;
    }

    try {
      status.textContent = 'Ending session and clocking out all workers…';
      status.className = 'ka-status';
      await kaEndSessionAndClockOutAll();
      status.textContent = 'Session ended and all workers clocked out.';
      status.className = 'ka-status ka-status-ok';
      setTimeout(close, 800);
    } catch (err) {
      status.textContent = 'Error ending session: ' + (err.message || err);
      status.className = 'ka-status ka-status-error';
    }
  };

  backdrop.classList.remove('hidden');
  pin1.focus();
}

async function kaEndSessionAndClockOutAll() {
  if (!kaKiosk) throw new Error('No kiosk loaded.');
  let targetProjectId = null;
  let targetSessionStart = null;
  if (kaActiveSessionId) {
    const active = kaSessions.find(s => Number(s.id) === Number(kaActiveSessionId));
    if (active) {
      targetProjectId = active.project_id || null;
      targetSessionStart = active.created_at || null;
    }
  }
  if (!targetProjectId && kaKiosk.project_id) {
    targetProjectId = kaKiosk.project_id;
  }
  if (!targetProjectId) {
    throw new Error('No active session selected.');
  }

  // Load open punches for this kiosk/device
  const openPunches = await fetchJSON(`/api/kiosks/${kaKiosk.id}/open-punches`);
  if (!openPunches || !openPunches.length) {
    return;
  }

  // Clock out each worker by sending a kiosk punch for each employee
  for (const p of openPunches) {
    const clientId = `end-${Date.now().toString(36)}-${p.employee_id}`;
    try {
      await fetchJSON('/api/kiosk/punch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          employee_id: p.employee_id,
          project_id: p.project_id || targetProjectId || null,
          lat: null,
          lng: null,
          device_timestamp: new Date().toISOString(),
          photo_base64: null,
          device_id: kaKiosk.device_id || null
        })
      });
    } catch (err) {
      console.warn('Failed to clock out employee', p.employee_id, err);
    }
  }

  // Clear active session on kiosk
  if (kaKiosk && kaKiosk.id) {
    try {
      await fetchJSON('/api/kiosks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: kaKiosk.id,
          name: kaKiosk.name,
          location: kaKiosk.location,
          device_id: kaKiosk.device_id,
          project_id: null
        })
      });
      kaKiosk.project_id = null;
      kaActiveSessionId = null;
    } catch (err) {
      console.warn('Error clearing kiosk project after end session', err);
    }
  }

  await kaLoadSessions();
  kaRenderProjectsSelect();
  await kaLoadLiveWorkers();
  kaUpdateEndSessionButton();
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
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function kaProjectLabelById(projectId) {
  if (!projectId || !Array.isArray(kaProjects)) return '';
  const p = kaProjects.find(proj => Number(proj.id) === Number(projectId));
  if (!p) return '(Inactive project)';
  return p.name || '(Unnamed project)';
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

function kaOfflinePunchToEntry(punch) {
  const emp = (kaEmployees || []).find(e => Number(e.id) === Number(punch.employee_id));
  const proj = (kaProjects || []).find(p => Number(p.id) === Number(punch.project_id));
  const dateStr = punch.device_timestamp ? String(punch.device_timestamp).slice(0, 10) : kaTodayIso();
  return {
    id: `offline-${punch.client_id || punch.device_timestamp || Date.now()}`,
    client_id: punch.client_id,
    employee_name: emp ? (emp.nickname || emp.name || 'Employee') : 'Employee',
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
  const projLabelEl = document.getElementById('ka-live-project-label'); // text under the header
  if (!tbody) return;

  // Loading row (3 columns: Employee | Clock In | Time on Clock)
  tbody.innerHTML = `
    <tr><td colspan="3" class="ka-muted">(loading…)</td></tr>
  `;

  try {
    const rows = await fetchJSON(`/api/kiosks/${kaKiosk.id}/open-punches`);
    tbody.innerHTML = '';

    // ----- Project label under header (optional) -----
    if (projLabelEl) {
      let projectLabel = '';

      // Prefer kiosk.project_id → look it up in kaProjects if available
      if (kaKiosk && kaKiosk.project_id && Array.isArray(kaProjects)) {
        projectLabel = kaProjectLabelById(kaKiosk.project_id);
      }

      // Fallback: infer from first open punch row
      if (!projectLabel && rows && rows.length) {
        const r0 = rows[0];
        if (r0.project_name) {
          projectLabel = r0.project_name;
        }
      }

      projLabelEl.textContent =
        projectLabel || 'Project not set yet.';
    }

    // ----- No workers currently clocked in -----
    if (!rows || !rows.length) {
      tbody.innerHTML = `
        <tr><td colspan="3" class="ka-muted">(no one is currently clocked in on this kiosk)</td></tr>
      `;
      if (tag) {
        tag.textContent = '0 active';
        tag.className = 'ka-tag gray';
      }
      return;
    }

    const todayStr = kaTodayIso();
    const now = new Date();
    let olderThanTodayCount = 0;

    // ----- Build rows: Employee | Clock In | Time on Clock -----
    rows.forEach(r => {
      const tr = document.createElement('tr');

      let clockInLabel = '–';
      let durationLabel = '–';
      let isOlder = false;

      if (r.clock_in_ts) {
        const dt = new Date(r.clock_in_ts);

        // Clock In (local time)
        clockInLabel = dt.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        });

        // Time on Clock (duration)
        const diffMs = now - dt;
        const diffMin = Math.max(0, Math.floor(diffMs / 60000));
        const diffHours = diffMs / 3600000;

        if (diffMin < 60) {
          durationLabel = `${diffMin} min`;
        } else {
          const hours = Math.floor(diffHours);
          const minutes = diffMin % 60;
          durationLabel =
            minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
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
      `;

      tbody.appendChild(tr);
    });

    if (tag) {
      tag.textContent = `${rows.length} active`;
      tag.className = 'ka-tag green';
    }

    // Optional warning about previous-day open punches
    const status = document.getElementById('ka-kiosk-status');
    if (status) {
      if (olderThanTodayCount > 0) {
        status.textContent =
          `${olderThanTodayCount} worker(s) appear to still be clocked in from a previous day. ` +
          `Make sure they are clocked out in the main admin console.`;
        status.className = 'ka-status ka-status-error';
      } else {
        status.textContent = '';
        status.className = '';
      }
    }
  } catch (err) {
    console.error('Error loading live workers:', err);
    tbody.innerHTML = `
      <tr><td colspan="3" class="ka-muted">(error loading live workers)</td></tr>
    `;
    if (tag) {
      tag.textContent = 'Error';
      tag.className = 'ka-tag orange';
    }
  }
}



// --- INIT ---

async function kaInit() {
  const params = new URLSearchParams(window.location.search);
  kaDeviceId = params.get('device_id');
  kaStartMode = params.get('start') === '1';
  kaStartEmployeeId = params.get('employee_id');

  if (!kaDeviceId) {
    alert('Missing kiosk device ID in URL (device_id).');
    kaSetText('ka-kiosk-name', 'No kiosk selected');
    return;
  }

  if (!kaStartEmployeeId) {
    alert('Open kiosk admin from the kiosk login screen so your admin PIN is verified.');
    window.location.href = '/kiosk';
    return;
  }

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
    .getElementById('ka-admin-select')
    ?.addEventListener('change', kaHandleAdminChange);
  document
    .getElementById('ka-lang-search')
    ?.addEventListener('input', () => kaRenderSettingsForm());
  document
    .getElementById('ka-pin-search')
    ?.addEventListener('input', () => kaRenderSettingsForm());
  document
    .getElementById('ka-rates-toggle')
    ?.addEventListener('change', kaHandleRatesToggleChange);
  document
    .getElementById('ka-rates-pin-submit')
    ?.addEventListener('click', kaUnlockRatesWithPin);
  document
    .getElementById('ka-rates-pin-cancel')
    ?.addEventListener('click', () => kaResetRatesUI());
  document
    .getElementById('ka-rates-body')
    ?.addEventListener('click', kaHandleRateSaveClick);
  window.addEventListener('online', () => kaSyncPendingPins());
  kaResetRatesUI();

  // Shipment notifications panel
  kaInitNotifyPanel();

  // Start-of-day button (foreman “save & clock me in”)
  document
    .getElementById('ka-start-day-btn')
    ?.addEventListener('click', kaStartDayAndClockIn);

  // Items modal controls
  document.getElementById('ka-items-modal-close')?.addEventListener('click', kaCloseItemsModal);
  document.getElementById('ka-items-modal-cancel')?.addEventListener('click', kaCloseItemsModal);
  document.getElementById('ka-items-modal-save')?.addEventListener('click', async () => {
    if (kaItemsModalShipmentId) {
      await kaSaveShipmentVerificationFor(kaItemsModalShipmentId);
    }
    kaCloseItemsModal();
  });

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

      // Optional refresh of active workers
      kaLoadLiveWorkers();
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

  // Sessions: add + set active
  document.getElementById('ka-add-session-btn')?.addEventListener('click', kaAddSession);
  const sessionList = document.getElementById('ka-session-list');
  if (sessionList) {
    sessionList.addEventListener('click', (e) => {
      const viewBtn = e.target.closest('[data-ka-view-workers]');
      if (viewBtn) {
        document.getElementById('ka-live-card')?.scrollIntoView({ behavior: 'smooth' });
        return;
      }
      const row = e.target.closest('.ka-session-row');
      if (row && row.dataset.sessionId) {
        const id = Number(row.dataset.sessionId);
        const ok = window.confirm(
          'Make this session active? Workers will clock in under this project on this device.'
        );
        if (ok) {
          kaSetActiveSession(id);
        }
      }
    });
  }
  document.getElementById('ka-end-session-live')?.addEventListener('click', kaShowEndSessionModal);

  // 3) Load core data in parallel
  try {
    const [kiosks, projects, employees] = await Promise.all([
      fetchJSON('/api/kiosks'),
      fetchJSON('/api/projects'),
      fetchJSON('/api/kiosk/employees'),
    ]);

    // Only keep active projects for kiosk use (hide top-level customers)
    kaProjects = (projects || []).filter(
      p =>
        (p.active === undefined || p.active === null || Number(p.active) === 1) &&
        p.customer_name
    );
    kaEmployees = employees || [];

    // Figure out which employee is running kiosk-admin (from URL ?employee_id=)
    if (kaStartEmployeeId) {
      kaCurrentAdmin =
        kaEmployees.find(
          (e) => String(e.id) === String(kaStartEmployeeId)
        ) || null;

      // Reload notification prefs now that we know which admin is using this device
      kaApplyNotifyPrefToUI(kaLoadNotifyPrefFromStorage(), kaNotifyStatusesSource());
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

    await kaLoadAccessPerms();
    // find kiosk by device id
    kaKiosk = (kiosks || []).find(
      (k) => String(k.device_id || '') === String(kaDeviceId)
    );

    if (!kaKiosk) {
      kaSetText('ka-kiosk-name', 'Kiosk not linked');
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

    // Default view → Live Workers
    kaShowView('live');
  } catch (err) {
    console.error('Error initializing kiosk admin:', err);
    alert('Error loading kiosk admin data: ' + (err.message || err));
  }
}





// --- start ---

document.addEventListener('DOMContentLoaded', kaInit);

function kaCloseItemsModal() {
  const modal = document.getElementById('ka-items-modal');
  if (modal) modal.classList.add('hidden');
  kaItemsModalShipmentId = null;
}

function kaForceCloseAllModals() {
  const ids = [
    'ka-return-backdrop',
    'ka-time-action-backdrop',
    'ka-end-session-backdrop'
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  kaCloseItemsModal();
}

async function kaOpenItemsModal(shipmentId) {
  const modal = document.getElementById('ka-items-modal');
  const body = document.getElementById('ka-items-modal-body');
  const titleEl = document.getElementById('ka-items-modal-title');
  if (!modal || !body || !titleEl) return;

  kaShipmentItemsDirty.clear();
  kaItemsModalShipmentId = shipmentId;

  // Always load fresh detail for this shipment
  let shipment = null;
  let items = [];
  try {
    const report = await fetchJSON(
      '/api/reports/shipment-verification?shipment_id=' +
        shipmentId +
        (kaCurrentAdmin && kaCurrentAdmin.id
          ? `&employee_id=${kaCurrentAdmin.id}`
          : '')
    );
    shipment = report.shipment || {};
    items = Array.isArray(report.items) ? report.items : [];
    kaShipmentDetail = { shipment, items };
  } catch (err) {
    console.error('Failed to load shipment for items modal', err);
    body.innerHTML = '<div class="ka-ship-muted">(Error loading items)</div>';
    modal.classList.remove('hidden');
    return;
  }

  titleEl.textContent =
    (shipment.title || shipment.reference || `Shipment #${shipment.id}`) +
    (shipment.bol_number ? ` · BOL ${shipment.bol_number}` : '');

  body.innerHTML = '';

  if (!items || !items.length) {
    body.innerHTML = '<div class="ka-ship-muted">(No items on this shipment)</div>';
  } else {
    items.forEach(item => {
      const v = item.verification || {};
      const status = v.status || '';
      const notes = v.notes || '';
      const storage = v.storage_override || '';
      const lastBy = v.verified_by || '';
      const lastAt = v.verified_at || '';
      const initials = kaInitials(lastBy);

      const rowEl = document.createElement('div');
      rowEl.className = 'ka-ship-item-row';

      rowEl.innerHTML = `
        <div class="ka-ship-item-main">
          <div class="ka-ship-item-desc">${item.description || '(No description)'}</div>
          <div class="ka-ship-item-qty">
            Qty: <strong>${item.quantity}</strong>
            ${item.unit ? `<span> ${item.unit}</span>` : ''}
          </div>
        </div>

        <div class="ka-ship-item-controls">
          <div class="ka-ship-status-buttons" data-ship-item-id="${item.id}">
            <button type="button" class="ka-status-pill status-verified ${status === 'verified' ? 'active' : ''}" data-status="verified">V</button>
            <button type="button" class="ka-status-pill status-missing ${status === 'missing' ? 'active' : ''}" data-status="missing">M</button>
            <button type="button" class="ka-status-pill status-damaged ${status === 'damaged' ? 'active' : ''}" data-status="damaged">D</button>
            <button type="button" class="ka-status-pill status-wrong_item ${status === 'wrong_item' ? 'active' : ''}" data-status="wrong_item">WI</button>
            <button type="button" class="ka-status-pill ${!status ? 'active' : ''}" data-status="">Clear</button>
          </div>
          <label>
            Storage info (optional)
            <textarea rows="2" data-ship-item-storage-id="${item.id}">${storage || ''}</textarea>
          </label>
          <label>
            Notes
            <textarea rows="2" data-ship-item-notes-id="${item.id}">${notes || ''}</textarea>
          </label>
          <div class="ka-ship-item-last">
            ${
              lastBy || lastAt
                ? `
                  <div class="ka-ship-item-verifier">
                    <span class="ka-ship-item-initials">${initials || '—'}</span>
                    <span class="ka-ship-item-verifier-meta">
                      ${lastBy || ''}
                      ${lastAt ? ` · ${lastAt.slice(0, 10)}` : ''}
                    </span>
                  </div>
                `
                : '<span class="ka-ship-muted">Not verified yet</span>'
            }
          </div>
        </div>
      `;

      const statusButtons = Array.from(
        rowEl.querySelectorAll('.ka-status-pill')
      );
      const notesEl = rowEl.querySelector(
        'textarea[data-ship-item-notes-id]'
      );
      const storageEl = rowEl.querySelector(
        'textarea[data-ship-item-storage-id]'
      );
      const itemId = item.id;

      const applyStatusStyle = () => {
        const activeBtn = statusButtons.find(btn =>
          btn.classList.contains('active')
        );
        const val = activeBtn ? activeBtn.dataset.status || '' : '';
        rowEl.classList.remove(
          'status-verified',
          'status-missing',
          'status-damaged',
          'status-wrong_item'
        );
        if (val) {
          rowEl.classList.add(`status-${val}`);
        }
      };

      function markDirty() {
        const nowIso = new Date().toISOString();
        const admin = kaCurrentAdmin || {};
        const verifiedBy =
          admin.nickname || admin.name || 'Field Admin';

        const activeBtn = statusButtons.find(btn => btn.classList.contains('active'));
        const newStatus = activeBtn ? activeBtn.dataset.status || '' : '';

        kaShipmentItemsDirty.set(itemId, {
          status: newStatus,
          notes: notesEl.value || '',
          storage_override: storageEl ? storageEl.value || '' : '',
          verified_at: nowIso,
          verified_by: verifiedBy,
        });

        applyStatusStyle();

        const badge = rowEl.querySelector('.ka-ship-item-initials');
        const meta = rowEl.querySelector('.ka-ship-item-verifier-meta');
        if (badge) badge.textContent = kaInitials(verifiedBy) || '—';
        if (meta) {
          meta.textContent = `${verifiedBy || ''}${
            nowIso ? ` · ${nowIso.slice(0, 10)}` : ''
          }`;
        }
      }

      applyStatusStyle();
      const labelMap = {
        verified: { short: 'V', full: 'Verified' },
        missing: { short: 'M', full: 'Missing' },
        damaged: { short: 'D', full: 'Damaged' },
        wrong_item: { short: 'WI', full: 'Wrong Item' },
        '': { short: 'Clear', full: 'Clear' }
      };

      const updatePills = () => {
        const activeBtn = statusButtons.find(b => b.classList.contains('active'));
        statusButtons.forEach(b => {
          const val = b.dataset.status || '';
          const labels = labelMap[val] || { short: val || 'Clear', full: val || 'Clear' };
          const isActive = activeBtn && b === activeBtn;
          b.textContent = isActive ? labels.full : labels.short;
          if (activeBtn && b !== activeBtn) {
            b.classList.add('muted');
          } else {
            b.classList.remove('muted');
          }
        });
      };

      statusButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          statusButtons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          updatePills();
          markDirty();
        });
      });
      notesEl.addEventListener('blur', markDirty);
      storageEl?.addEventListener('blur', markDirty);
      updatePills();
      applyStatusStyle();

      body.appendChild(rowEl);
    });
  }

  modal.classList.remove('hidden');
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
    status.textContent = 'Starting day and clocking you in…';
    status.className = 'ka-status';
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
    try {
      await fetchJSON(`/api/kiosks/${kaKiosk.id}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          make_active: true
        })
      });
      await kaLoadSessions();
    } catch (e) {
      console.warn('Could not log kiosk session', e);
    }

    // 2) Clock the foreman in via the same kiosk punch endpoint
    await fetchJSON('/api/kiosk/punch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: 'startday-' + Date.now().toString(36),
        employee_id: Number(kaStartEmployeeId),
        project_id: projectId,
        lat: null,
        lng: null,
        device_timestamp: new Date().toISOString(),
        photo_base64: null,
        device_id: kaDeviceId
      })
    });

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
      status.textContent = 'Day started and you are clocked IN as foreman.';
      status.className = 'ka-status ka-status-ok';
    }
    // Offer to return to the kiosk so workers can start clocking in immediately
    kaShowReturnPrompt('Project set and you are clocked in. Go back to the worker clock-in screen?');

    // Hide the start-of-day button so they don't repeat it
    const btn = document.getElementById('ka-start-day-btn');
    if (btn) btn.style.display = 'none';

    // Refresh live workers table so you show up there
    kaLoadLiveWorkers();
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
  kaSetText('ka-kiosk-name', kaKiosk.name || '(Unnamed kiosk)');
  kaSetText('ka-kiosk-device-id', kaKiosk.device_id || '(none)');
}

function kaRenderProjectsSelect() {
  const sel = document.getElementById('ka-project-select');
  if (!sel) return;

  sel.innerHTML = '<option value="">(No default project)</option>';

  // Only show active projects in the picker (hide top-level customers)
  const activeProjects = (kaProjects || []).filter(
    p =>
      (p.active === undefined || p.active === null || Number(p.active) === 1) &&
      p.customer_name
  );

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

function kaToggleAdminSettingsVisibility(adminId) {
  const block = document.getElementById('ka-admin-settings-block');
  const hasAdmin = true; // kiosk admin is already validated
  if (block) block.classList.toggle('hidden', !hasAdmin);

  const toggleEls = [
    document.getElementById('ka-lang-search'),
    document.getElementById('ka-pin-search'),
    document.getElementById('ka-lang-employee'),
    document.getElementById('ka-pin-employee'),
    document.getElementById('ka-lang-choice'),
    document.getElementById('ka-pin-new'),
    document.getElementById('ka-pin-confirm'),
    document.getElementById('ka-pin-save'),
    document.getElementById('ka-lang-save')
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
  const pinSearch = document.getElementById('ka-pin-search');
  const langSelect = document.getElementById('ka-lang-employee');
  const langSearch = document.getElementById('ka-lang-search');
  // Always show settings; do not gate on admin selection
  kaToggleAdminSettingsVisibility(true);

  // Force dropdowns to start at the placeholder
  if (pinSelect) pinSelect.value = '';
  if (langSelect) langSelect.value = '';

  const filterText = (input) => (input && input.value ? input.value.toLowerCase() : '');

  const fillSelect = (selectEl, filterVal) => {
    if (!selectEl) return;
    const prev = selectEl.value || '';
    const f = filterVal || '';
    selectEl.innerHTML = '<option value="">Select an employee</option>';
    (kaEmployees || []).forEach(emp => {
      const label = `${emp.nickname || emp.name || 'Unnamed'} (${emp.is_admin ? 'Admin' : 'Employee'})`;
      if (f && !label.toLowerCase().includes(f)) return;
      const opt = document.createElement('option');
      opt.value = emp.id;
      opt.textContent = label;
      if (prev && String(prev) === String(emp.id)) opt.selected = true;
      selectEl.appendChild(opt);
    });
  };

  fillSelect(pinSelect, filterText(pinSearch));
  fillSelect(langSelect, filterText(langSearch));

  kaSyncLanguageChoice();
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
        await fetchJSON(`/api/kiosks/${kaKiosk.id}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_id: projectId,
            make_active: true
          })
        });
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

function kaResetRatesUI(message = '') {
  const status = document.getElementById('ka-rates-status');
  const editor = document.getElementById('ka-rates-editor');
  const tbody = document.getElementById('ka-rates-body');
  const toggle = document.getElementById('ka-rates-toggle');
  const pinRow = document.getElementById('ka-rates-pin-row');

  kaRatesUnlocked = false;
  if (toggle) toggle.checked = false;
  pinRow?.classList.add('hidden');
  editor?.classList.add('hidden');

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
      status.textContent = 'Unlocked. Rates are visible for a short time.';
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
      status.textContent = 'Unlocked. Rates are visible for a short time.';
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
  const toggle = document.getElementById('ka-rates-toggle');
  const pinRow = document.getElementById('ka-rates-pin-row');
  const pinInput = document.getElementById('ka-rates-pin');
  const editor = document.getElementById('ka-rates-editor');

  if (!toggle) return;

  if (!toggle.checked) {
    kaResetRatesUI();
    return;
  }

  if (!kaCanModifyPayRates()) {
    kaResetRatesUI('You do not have permission to modify pay rates.');
    return;
  }

  editor?.classList.add('hidden');
  pinRow?.classList.remove('hidden');
  if (pinInput) {
    pinInput.value = '';
    pinInput.focus();
  }
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
  const today = new Date();
  const iso = (dt) => {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  if (mode === 'yesterday') {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    return { start: iso(y), end: iso(y) };
  }

  if (mode === 'last7') {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { start: iso(start), end: iso(today) };
  }

  // default → today
  return { start: iso(today), end: iso(today) };
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
    viewTime.classList.toggle('ka-hide-pay', !kaCanViewPayroll);
  }
}

async function kaLoadTimeEntries() {
  const tbody = document.getElementById('ka-time-body');
  const status = document.getElementById('ka-time-status');
  const startInput = document.getElementById('ka-time-start');
  const endInput = document.getElementById('ka-time-end');
  const hideResolvedEl = document.getElementById('ka-time-hide-resolved');
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
      return d && d >= start && d <= end;
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
