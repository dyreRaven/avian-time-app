/* ───────── TIMESHEETS (ADMIN CONSOLE) ───────── */

let sessionsTableData = [];
let selectedSession = null;
let timesheetAssignableAdmins = [];
let timesheetAssignableLoaded = false;
let timesheetShareableAdmins = [];
let timesheetShareableLoaded = false;

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

async function loadSessionsSection() {
  updateTimesheetHeading();
  await loadAssignableAdmins();
  await loadShareableAdmins();
  await loadSessionsTable();
  clearSessionDetail();
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
  } catch (err) {
    console.error('Error loading timesheets:', err);
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="8">Error loading timesheets.</td></tr>';
    }
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
