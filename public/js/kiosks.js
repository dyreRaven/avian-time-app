/* ───────── TIMESHEETS (ADMIN CONSOLE) ───────── */

let sessionsTableData = [];
let selectedSession = null;
let timesheetAssignableAdmins = [];
let timesheetAssignableLoaded = false;
let timesheetShareableAdmins = [];
let timesheetShareableLoaded = false;
let desktopClockEmployees = [];
let desktopClockOpenPunch = null;
let desktopClockLookupEmployeeId = null;
let desktopClockControlsBound = false;

function canAssignTimesheets() {
  if (window.CURRENT_IS_SUPER_ADMIN === true) return true;
  const perms = window.CURRENT_ACCESS_PERMS || {};
  return perms.assign_timesheets === true || perms.assign_timesheets === 1 || perms.assign_timesheets === '1' || perms.assign_timesheets === 'true';
}

function canShareTimesheets() {
  return window.CURRENT_IS_SUPER_ADMIN === true;
}

function hasResolvedSuperAdminFlag() {
  return window.CURRENT_IS_SUPER_ADMIN === true || window.CURRENT_IS_SUPER_ADMIN === false;
}

function invalidateTimesheetAdminCaches() {
  timesheetAssignableLoaded = false;
  timesheetShareableLoaded = false;
}

async function refreshTimesheetAdminLists({ rerender = true } = {}) {
  if (!canAssignTimesheets() && !canShareTimesheets()) return;
  invalidateTimesheetAdminCaches();
  await Promise.all([loadAssignableAdmins(), loadShareableAdmins()]);
  if (rerender && typeof renderSessionsTable === 'function') {
    renderSessionsTable();
  }
}

window.refreshTimesheetAdminLists = refreshTimesheetAdminLists;

async function loadAssignableAdmins() {
  if (timesheetAssignableLoaded) return timesheetAssignableAdmins;
  if (!canAssignTimesheets()) {
    if (hasResolvedSuperAdminFlag()) {
      timesheetAssignableAdmins = [];
      timesheetAssignableLoaded = true;
    }
    return timesheetAssignableAdmins;
  }
  try {
    const data = await fetchJSON('/api/kiosk-sessions/assignees');
    timesheetAssignableAdmins = (data && data.admins) || [];
  } catch (err) {
    console.warn('Error loading timesheet assignees', err);
    timesheetAssignableAdmins = [];
  }
  timesheetAssignableLoaded = true;
  return timesheetAssignableAdmins;
}

async function loadShareableAdmins() {
  if (timesheetShareableLoaded) return timesheetShareableAdmins;
  if (!canShareTimesheets()) {
    if (hasResolvedSuperAdminFlag()) {
      timesheetShareableAdmins = [];
      timesheetShareableLoaded = true;
    }
    return timesheetShareableAdmins;
  }
  try {
    const data = await fetchJSON('/api/kiosk-sessions/shareable-admins');
    timesheetShareableAdmins = (data && data.admins) || [];
  } catch (err) {
    console.warn('Error loading shareable admins', err);
    timesheetShareableAdmins = [];
  }
  timesheetShareableLoaded = true;
  return timesheetShareableAdmins;
}

function buildAssigneeOptions(selectedId, selectedName) {
  const selectedNum = selectedId ? Number(selectedId) : null;
  const options = [];
  let hasSelected = false;
  (timesheetAssignableAdmins || []).forEach(admin => {
    const adminId = Number(admin.id);
    const selected = selectedNum && adminId === selectedNum ? 'selected' : '';
    if (selected) hasSelected = true;
    options.push(`<option value="${adminId}" ${selected}>${admin.name || ''}</option>`);
  });
  if (selectedNum && !hasSelected) {
    options.splice(
      1,
      0,
      `<option value="${selectedNum}" selected>${selectedName || `Admin ${selectedNum}`}</option>`
    );
  }
  return options.join('');
}

function normalizeSharedAdmins(session) {
  return Array.isArray(session?.shared_admins) ? session.shared_admins : [];
}

function formatSharedSummary(session) {
  const sharedAdmins = normalizeSharedAdmins(session);
  if (!sharedAdmins.length) return 'Share';
  return `Shared (${sharedAdmins.length})`;
}

function formatSharedNames(session) {
  const sharedAdmins = normalizeSharedAdmins(session);
  if (!sharedAdmins.length) return '—';
  return sharedAdmins.map(admin => admin.name || '').filter(Boolean).join(', ') || '—';
}

function buildShareMenuOptions(session) {
  if (!timesheetShareableLoaded) {
    return '<div class="session-share-empty">Loading admins…</div>';
  }
  const sharedAdmins = normalizeSharedAdmins(session);
  const selected = new Map();
  sharedAdmins.forEach(admin => {
    const id = Number(admin.id);
    if (Number.isFinite(id)) {
      selected.set(id, admin.name || '');
    }
  });

  const options = [];
  const used = new Set();
  (timesheetShareableAdmins || []).forEach(admin => {
    const adminId = Number(admin.id);
    if (!Number.isFinite(adminId)) return;
    const checked = selected.has(adminId);
    const label = admin.name || '';
    used.add(adminId);
    options.push(
      `<label class="session-share-item">` +
        `<input type="checkbox" data-session-share-id="${session.id}" value="${adminId}" ${checked ? 'checked' : ''}>` +
        `<span>${label}</span>` +
      `</label>`
    );
  });

  selected.forEach((label, id) => {
    if (used.has(id)) return;
    options.push(
      `<label class="session-share-item is-disabled">` +
        `<input type="checkbox" checked disabled>` +
        `<span>${label || `Admin ${id}`}</span>` +
      `</label>`
    );
  });

  if (!options.length) {
    return '<div class="session-share-empty">No admins available.</div>';
  }
  return options.join('');
}

function applyShareSelection(detailsEl, session) {
  if (!detailsEl) return;
  const sharedIds = new Set(normalizeSharedAdmins(session).map(admin => Number(admin.id)));
  const checkboxes = detailsEl.querySelectorAll('input[type="checkbox"][data-session-share-id]');
  checkboxes.forEach(cb => {
    const adminId = Number(cb.value);
    cb.checked = sharedIds.has(adminId);
  });
}

function updateShareSummary(detailsEl, session) {
  if (!detailsEl) return;
  const summary = detailsEl.querySelector('.session-share-summary');
  if (summary) summary.textContent = formatSharedSummary(session);
}

function getLocalIsoDate(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function getSelectedTimesheetDate() {
  const input = document.getElementById('session-date');
  const fallback = getLocalIsoDate();
  if (!input) return fallback;
  const value = input.value ? String(input.value).trim() : '';
  if (!value) {
    input.value = fallback;
    return fallback;
  }
  return value;
}

function isSelectedDateToday(dateStr) {
  if (!dateStr) return false;
  return String(dateStr) === getLocalIsoDate();
}

function formatTimesheetDateLabel(dateStr) {
  if (!dateStr) return '';
  const normalized = String(dateStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return formatDateUS(`${normalized}T00:00:00`);
  }
  return formatDateUS(normalized);
}

function formatDurationFrom(now, iso) {
  if (!iso) return '';
  const start = new Date(iso);
  if (Number.isNaN(start.getTime())) return '';

  const diffMs = now - start;
  const diffMin = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMin < 60) return `${diffMin} min`;
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function coerceClockFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function canUseDesktopClockPanel() {
  const features = window.CURRENT_SECTION_FEATURES || {};
  const timeFeatureEnabled =
    features.time === undefined || features.time === null
      ? true
      : coerceClockFlag(features.time);
  const perms = window.CURRENT_ACCESS_PERMS || {};
  return timeFeatureEnabled && coerceClockFlag(perms.modify_time);
}

function desktopClockElements() {
  return {
    card: document.getElementById('desktop-clock-card'),
    employee: document.getElementById('desktop-clock-employee'),
    timesheet: document.getElementById('desktop-clock-timesheet'),
    clockIn: document.getElementById('desktop-clock-in-btn'),
    clockOut: document.getElementById('desktop-clock-out-btn'),
    status: document.getElementById('desktop-clock-status'),
    refresh: document.getElementById('desktop-clock-refresh-btn')
  };
}

function setDesktopClockStatus(message, tone = '') {
  const { status } = desktopClockElements();
  if (!status) return;
  status.textContent = message || '';
  if (tone === 'error') {
    status.style.color = '#b91c1c';
  } else if (tone === 'ok') {
    status.style.color = '#15803d';
  } else {
    status.style.color = '';
  }
}

function desktopEmployeeShownOnWorkerKiosk(employee) {
  if (!employee) return true;
  if (employee.worker_timekeeping === undefined || employee.worker_timekeeping === null) return true;
  return coerceClockFlag(employee.worker_timekeeping);
}

function desktopHiddenClockEmployees() {
  return (desktopClockEmployees || [])
    .filter(emp => Number(emp && emp.id) > 0)
    .filter(emp => Number(emp.active) !== 0)
    .filter(emp => !desktopEmployeeShownOnWorkerKiosk(emp))
    .map(emp => ({
      id: Number(emp.id),
      label: String(emp.nickname || emp.name || `Employee ${emp.id}`).trim() || `Employee ${emp.id}`
    }))
    .sort((a, b) =>
      String(a.label).localeCompare(String(b.label), undefined, { sensitivity: 'base' })
    );
}

function desktopClockOpenSessions() {
  return (sessionsTableData || [])
    .filter(session => !session?.ended_at)
    .filter(session => Number(session?.project_id) > 0)
    .filter(session => {
      const deviceId = String(session?.device_id || session?.kiosk_device_id || '').trim();
      return !!deviceId;
    });
}

function desktopClockSessionLabel(session) {
  const project = session.project_name || `Project ${session.project_id || ''}`.trim();
  const device = session.device_id || session.kiosk_device_id || 'Unknown device';
  const kioskName = session.kiosk_name ? String(session.kiosk_name).trim() : '';
  const started = formatAstTime(session.created_at);
  const bits = [project];
  bits.push(kioskName ? `${kioskName} (${device})` : device);
  if (started) bits.push(`Started ${started}`);
  return bits.join(' • ');
}

function desktopClockFindSessionById(sessionId) {
  if (!sessionId) return null;
  return desktopClockOpenSessions().find(session => Number(session.id) === Number(sessionId)) || null;
}

function desktopClockRenderEmployees() {
  const els = desktopClockElements();
  if (!els.employee) return [];
  const rows = desktopHiddenClockEmployees();
  const previous = Number(els.employee.value || 0);
  els.employee.innerHTML = '';

  if (!rows.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '(no hidden employees)';
    els.employee.appendChild(opt);
    els.employee.disabled = true;
    return rows;
  }

  rows.forEach(row => {
    const opt = document.createElement('option');
    opt.value = String(row.id);
    opt.textContent = row.label;
    els.employee.appendChild(opt);
  });

  const nextId = rows.some(row => row.id === previous) ? previous : rows[0].id;
  els.employee.value = String(nextId);
  els.employee.disabled = false;
  return rows;
}

function desktopClockRenderTimesheets() {
  const els = desktopClockElements();
  if (!els.timesheet) return [];
  const rows = desktopClockOpenSessions();
  const previous = Number(els.timesheet.value || 0);
  els.timesheet.innerHTML = '';

  if (!rows.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '(no active timesheets)';
    els.timesheet.appendChild(opt);
    els.timesheet.disabled = true;
    return rows;
  }

  rows.forEach(row => {
    const opt = document.createElement('option');
    opt.value = String(row.id);
    opt.textContent = desktopClockSessionLabel(row);
    els.timesheet.appendChild(opt);
  });

  const nextId = rows.some(row => Number(row.id) === previous) ? previous : Number(rows[0].id);
  els.timesheet.value = String(nextId);
  els.timesheet.disabled = false;
  return rows;
}

async function loadDesktopClockEmployees({ force = false } = {}) {
  if (!force && desktopClockEmployees.length) return desktopClockEmployees;
  const res = await fetchJSON('/api/time-punches/clock-panel-employees');
  const rows = Array.isArray(res?.employees) ? res.employees : [];
  desktopClockEmployees = rows.map(emp => ({
    ...emp,
    id: Number(emp.id),
    active: Number(emp.active),
    worker_timekeeping:
      emp.worker_timekeeping === undefined || emp.worker_timekeeping === null
        ? 1
        : Number(emp.worker_timekeeping)
  }));
  return desktopClockEmployees;
}

async function refreshDesktopClockPanel({ forceEmployees = false, forcePunch = false } = {}) {
  const els = desktopClockElements();
  if (!els.card) return;

  if (!canUseDesktopClockPanel()) {
    els.card.classList.add('hidden');
    return;
  }

  els.card.classList.remove('hidden');

  try {
    await loadDesktopClockEmployees({ force: forceEmployees });
  } catch (err) {
    console.error('Error loading desktop clock employees:', err);
    if (els.clockIn) els.clockIn.disabled = true;
    if (els.clockOut) els.clockOut.disabled = true;
    setDesktopClockStatus(err?.message || 'Unable to load employees for desktop clock panel.', 'error');
    return;
  }

  const employees = desktopClockRenderEmployees();
  const sessions = desktopClockRenderTimesheets();

  if (!employees.length) {
    if (els.clockIn) els.clockIn.disabled = true;
    if (els.clockOut) els.clockOut.disabled = true;
    setDesktopClockStatus('No employees are currently hidden from the worker kiosk list.');
    desktopClockOpenPunch = null;
    desktopClockLookupEmployeeId = null;
    return;
  }

  const employeeId = Number(els.employee && els.employee.value ? els.employee.value : 0);
  const selectedSessionId = Number(els.timesheet && els.timesheet.value ? els.timesheet.value : 0);
  const selectedSession = desktopClockFindSessionById(selectedSessionId);
  if (!employeeId) {
    if (els.clockIn) els.clockIn.disabled = true;
    if (els.clockOut) els.clockOut.disabled = true;
    setDesktopClockStatus('Select an employee.');
    return;
  }

  const shouldFetchPunch =
    forcePunch ||
    desktopClockLookupEmployeeId !== employeeId ||
    !desktopClockOpenPunch;

  if (shouldFetchPunch) {
    try {
      desktopClockOpenPunch = await fetchJSON(`/api/kiosk/open-punch?employee_id=${employeeId}`);
    } catch (err) {
      console.warn('Unable to load open punch status for desktop panel:', err);
      desktopClockOpenPunch = null;
    } finally {
      desktopClockLookupEmployeeId = employeeId;
    }
  }

  const hasOpenPunch = !!(desktopClockOpenPunch && desktopClockOpenPunch.open);
  const canClockIn = !!(employeeId && selectedSession && !hasOpenPunch);
  const clockOutDevice = hasOpenPunch
    ? String(desktopClockOpenPunch.device_id || selectedSession?.device_id || selectedSession?.kiosk_device_id || '').trim()
    : '';
  const canClockOut = !!(employeeId && hasOpenPunch && clockOutDevice);
  if (els.clockIn) els.clockIn.disabled = !canClockIn;
  if (els.clockOut) els.clockOut.disabled = !canClockOut;

  let status = '';
  if (hasOpenPunch) {
    const openProject = desktopClockOpenPunch.project_name || `Project ${desktopClockOpenPunch.project_id || ''}`.trim();
    const since = desktopClockOpenPunch.clock_in_ts
      ? formatDateTimeLocal(desktopClockOpenPunch.clock_in_ts)
      : '';
    status = since
      ? `Clocked in on ${openProject} since ${since}.`
      : `Clocked in on ${openProject}.`;
  } else if (!sessions.length) {
    status = 'No active timesheets are available. Start a timesheet first.';
  } else if (selectedSession) {
    status = `Not clocked in. Clock-in will use ${desktopClockSessionLabel(selectedSession)}.`;
  } else {
    status = 'Select an active timesheet.';
  }
  setDesktopClockStatus(status);
}

async function submitDesktopClock(mode = 'clock_in') {
  const normalizedMode = mode === 'clock_out' ? 'clock_out' : 'clock_in';
  const els = desktopClockElements();
  if (!els.employee || !els.timesheet) return;

  const employeeId = Number(els.employee.value || 0);
  const sessionId = Number(els.timesheet.value || 0);
  const session = desktopClockFindSessionById(sessionId);
  const hasOpenPunch = !!(desktopClockOpenPunch && desktopClockOpenPunch.open);
  const deviceId = normalizedMode === 'clock_out'
    ? String(desktopClockOpenPunch?.device_id || session?.device_id || session?.kiosk_device_id || '').trim()
    : String(session?.device_id || session?.kiosk_device_id || '').trim();
  const projectId = normalizedMode === 'clock_out'
    ? Number(desktopClockOpenPunch?.project_id || session?.project_id || 0)
    : Number(session?.project_id || 0);

  if (!employeeId) {
    setDesktopClockStatus('Select an employee first.', 'error');
    return;
  }
  if (normalizedMode === 'clock_in' && !session) {
    setDesktopClockStatus('Select an active timesheet first.', 'error');
    return;
  }
  if (normalizedMode === 'clock_out' && !hasOpenPunch) {
    setDesktopClockStatus('No open punch found for this employee.', 'error');
    return;
  }
  if (!deviceId) {
    setDesktopClockStatus('Could not determine which device to use for this punch.', 'error');
    return;
  }
  if (!Number.isFinite(projectId) || projectId <= 0) {
    setDesktopClockStatus('Could not determine project for this punch.', 'error');
    return;
  }

  if (els.clockIn) els.clockIn.disabled = true;
  if (els.clockOut) els.clockOut.disabled = true;
  setDesktopClockStatus(normalizedMode === 'clock_in' ? 'Clocking in…' : 'Clocking out…');

  const payload = {
    client_id:
      `desktop_${normalizedMode}_${employeeId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    employee_id: employeeId,
    project_id: projectId,
    intended_mode: normalizedMode,
    lat: null,
    lng: null,
    device_timestamp: new Date().toISOString(),
    photo_base64: null,
    device_id: deviceId
  };

  try {
    await fetchJSON('/api/kiosk/punch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    await loadSessionsTable();
    await refreshDesktopClockPanel({ forcePunch: true });
    setDesktopClockStatus(
      normalizedMode === 'clock_in'
        ? 'Clock-in recorded.'
        : 'Clock-out recorded.',
      'ok'
    );
  } catch (err) {
    if (
      normalizedMode === 'clock_in' &&
      err &&
      err.body &&
      Number(err.body.active_project_id) > 0 &&
      els.timesheet
    ) {
      const activeProjectId = Number(err.body.active_project_id);
      const fallbackSession = desktopClockOpenSessions().find(
        row => Number(row.project_id) === activeProjectId
      );
      if (fallbackSession) {
        els.timesheet.value = String(fallbackSession.id);
      }
    }
    await refreshDesktopClockPanel({ forcePunch: true });
    setDesktopClockStatus(err?.message || 'Could not submit punch.', 'error');
  }
}

function bindDesktopClockControls() {
  if (desktopClockControlsBound) return;
  const els = desktopClockElements();
  if (!els.employee || !els.timesheet || !els.clockIn || !els.clockOut || !els.refresh) return;

  els.employee.addEventListener('change', () => {
    refreshDesktopClockPanel({ forcePunch: true });
  });
  els.timesheet.addEventListener('change', () => {
    refreshDesktopClockPanel({ forcePunch: false });
  });
  els.clockIn.addEventListener('click', () => {
    submitDesktopClock('clock_in');
  });
  els.clockOut.addEventListener('click', () => {
    submitDesktopClock('clock_out');
  });
  els.refresh.addEventListener('click', async () => {
    setDesktopClockStatus('Refreshing…');
    await loadSessionsTable();
    await refreshDesktopClockPanel({ forceEmployees: true, forcePunch: true });
  });
  desktopClockControlsBound = true;
}

async function loadSessionsSection() {
  updateTimesheetHeading();
  await loadAssignableAdmins();
  await loadShareableAdmins();
  await loadSessionsTable();
  clearSessionDetail();
  await refreshDesktopClockPanel({ forceEmployees: true, forcePunch: true });
}

function clearSessionDetail() {
  const card = document.getElementById('session-detail-card');
  const title = document.getElementById('session-detail-title');
  const sub = document.getElementById('session-detail-sub');
  const tbody = document.getElementById('session-workers-body');

  selectedSession = null;
  if (card) card.classList.add('hidden');
  if (title) title.textContent = 'Current Workers';
  if (sub) sub.textContent = '';
  if (tbody) tbody.innerHTML = '<tr><td colspan="3">(select a timesheet)</td></tr>';
}

function formatAstTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Puerto_Rico'
  });
}

function renderSessionsTable() {
  const tbody = document.getElementById('session-table-body');
  if (!tbody) return;

  if (!sessionsTableData.length) {
    const selectedDate = getSelectedTimesheetDate();
    const emptyLabel = isSelectedDateToday(selectedDate)
      ? '(no timesheets yet today)'
      : '(no timesheets for this date)';
    tbody.innerHTML = `<tr><td colspan="8">${emptyLabel}</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  const now = new Date();

  sessionsTableData.forEach(session => {
    const tr = document.createElement('tr');
    const projLabel = session.project_name || '(project not set)';
    const deviceLabel = session.device_id || session.kiosk_device_id || '—';
    const workersCount = (session.open_punches || []).length;
    const adminLabel = session.started_by_name || session.foreman_name || '—';
    const started = formatAstTime(session.created_at);
    const ended = formatAstTime(session.ended_at);
    const canAssign = canAssignTimesheets();
    const canShare = canShareTimesheets();
    const isClosed = !!session.ended_at;
    const assignedLabel = session.assigned_to_name || session.started_by_name || '—';
    const assignDisabled = !timesheetAssignableAdmins.length;
    const assignedCell = canAssign && !isClosed
      ? `<td>
          <select class="session-assign-select" data-session-assign="${session.id}" ${assignDisabled ? 'disabled' : ''}>
            ${buildAssigneeOptions(session.assigned_to_employee_id, assignedLabel)}
          </select>
        </td>`
      : `<td>${assignedLabel}</td>`;
    const sharedCell = canShare && !isClosed
      ? `<td>
          <details class="session-share" data-session-share="${session.id}">
            <summary class="session-share-summary">${formatSharedSummary(session)}</summary>
            <div class="session-share-menu">
              ${buildShareMenuOptions(session)}
            </div>
          </details>
        </td>`
      : `<td>${formatSharedNames(session)}</td>`;

    tr.innerHTML = `
      <td>${projLabel}</td>
      <td>${deviceLabel}</td>
      <td>${adminLabel}</td>
      ${assignedCell}
      <td class="right">${workersCount}</td>
      <td>${started || '—'}</td>
      <td>${ended || '—'}</td>
      ${sharedCell}
    `;

    tr.addEventListener('click', () => showSessionDetail(session, now));
    if (canAssign && !isClosed) {
      const select = tr.querySelector('.session-assign-select');
      if (select) {
        select.addEventListener('click', e => e.stopPropagation());
        let lastValue = select.value;
        select.addEventListener('change', async (e) => {
          e.stopPropagation();
          const nextValue = select.value;
          try {
            const res = await fetchJSON(`/api/kiosk-sessions/${session.id}/assign`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                assigned_to_employee_id: nextValue ? Number(nextValue) : null
              })
            });
            session.assigned_to_employee_id = res.assigned_to_employee_id || null;
            session.assigned_to_name = res.assigned_to_name || null;
            lastValue = nextValue;
          } catch (err) {
            console.error('Error updating timesheet assignee', err);
            select.value = lastValue;
          }
        });
      }
    }
    if (canShare && !isClosed) {
      const details = tr.querySelector('details.session-share');
      if (details) {
        const summary = details.querySelector('summary');
        const menu = details.querySelector('.session-share-menu');
        if (summary) {
          summary.addEventListener('click', e => e.stopPropagation());
        }
        if (menu) {
          menu.addEventListener('click', e => e.stopPropagation());
          menu.addEventListener('change', async (e) => {
            const checkbox = e.target.closest('input[type="checkbox"][data-session-share-id]');
            if (!checkbox) return;
            e.stopPropagation();

            const shareInputs = menu.querySelectorAll('input[type="checkbox"][data-session-share-id]');
            const selectedIds = Array.from(shareInputs)
              .filter(cb => cb.checked)
              .map(cb => Number(cb.value))
              .filter(value => Number.isFinite(value) && value > 0);

            const prevAdmins = normalizeSharedAdmins(session);

            shareInputs.forEach(cb => { cb.disabled = true; });
            try {
              const res = await fetchJSON(`/api/kiosk-sessions/${session.id}/share`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ shared_with_employee_ids: selectedIds })
              });
              session.shared_admins = (res && res.shared_admins) || [];
              session.shared_with_all = 0;
              applyShareSelection(details, session);
              updateShareSummary(details, session);
            } catch (err) {
              console.error('Error updating timesheet sharing', err);
              session.shared_admins = prevAdmins;
              session.shared_with_all = 0;
              applyShareSelection(details, session);
              updateShareSummary(details, session);
            } finally {
              shareInputs.forEach(cb => { cb.disabled = false; });
            }
          });
        }
      }
    }
    tbody.appendChild(tr);
  });
}

function showSessionDetail(session, now = new Date()) {
  // Toggle off if same row clicked
  if (selectedSession && selectedSession.id === session.id) {
    clearSessionDetail();
    return;
  }
  selectedSession = session;
  const card = document.getElementById('session-detail-card');
  const title = document.getElementById('session-detail-title');
  const sub = document.getElementById('session-detail-sub');
  const tbody = document.getElementById('session-workers-body');

  const projLabel = session.project_name || '(project not set)';
  const deviceLabel = session.device_id || session.kiosk_device_id || '';

  if (title) title.textContent = `${projLabel} – Current Workers`;
  if (sub) {
    sub.textContent = deviceLabel ? `Device ID: ${deviceLabel}` : 'Device ID: —';
  }

  if (tbody) {
    const open = session.open_punches || [];
    if (!open.length) {
      tbody.innerHTML = '<tr><td colspan="3">(no one clocked in on this timesheet)</td></tr>';
    } else {
      tbody.innerHTML = '';
      open.forEach(p => {
        const when = p.clock_in_ts
          ? formatAstTime(p.clock_in_ts)
          : '';
        const duration = formatDurationFrom(now, p.clock_in_ts);
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${p.employee_name || ''}</td>
          <td>${when}</td>
          <td>${duration}</td>
        `;
        tbody.appendChild(tr);
      });
    }
  }

  if (card) card.classList.remove('hidden');
}

async function loadSessionsTable() {
  const tbody = document.getElementById('session-table-body');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="8">Loading timesheets…</td></tr>';
  }

  try {
    updateTimesheetHeading();
    const selectedDate = getSelectedTimesheetDate();
    const url = selectedDate
      ? `/api/kiosk-sessions/today?date=${encodeURIComponent(selectedDate)}`
      : '/api/kiosk-sessions/today';
    const sessions = await fetchJSON(url);
    sessionsTableData = sessions || [];
    renderSessionsTable();
    await refreshDesktopClockPanel({ forcePunch: false });
  } catch (err) {
    console.error('Error loading timesheets:', err);
    sessionsTableData = [];
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="8">Error loading timesheets.</td></tr>';
    }
    await refreshDesktopClockPanel({ forcePunch: false });
  }
}

function updateTimesheetHeading() {
  const heading = document.getElementById('session-heading');
  if (!heading) return;
  const selectedDate = getSelectedTimesheetDate();
  const dateLabel = formatTimesheetDateLabel(selectedDate);
  const prefix = isSelectedDateToday(selectedDate) ? "Today's Timesheets" : 'Timesheets';
  heading.textContent = `${prefix} - ${dateLabel}`;
}

document.addEventListener('DOMContentLoaded', () => {
  bindDesktopClockControls();
  // Auto-load once so the Timesheets tab has data immediately
  loadSessionsSection();

  const dateInput = document.getElementById('session-date');
  if (dateInput) {
    if (!dateInput.value) dateInput.value = getLocalIsoDate();
    dateInput.addEventListener('change', () => {
      clearSessionDetail();
      loadSessionsTable();
    });
  }

  const refreshBtn = document.getElementById('session-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      clearSessionDetail();
      loadSessionsTable();
    });
  }
});
