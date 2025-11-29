/* ───────── SESSIONS (ADMIN CONSOLE) ───────── */

let sessionsTableData = [];
let selectedSession = null;

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
  await loadSessionsTable();
  clearSessionDetail();
}

function clearSessionDetail() {
  const card = document.getElementById('session-detail-card');
  const title = document.getElementById('session-detail-title');
  const tbody = document.getElementById('session-workers-body');

  selectedSession = null;
  if (card) card.classList.add('hidden');
  if (title) title.textContent = 'Current Workers';
  if (tbody) tbody.innerHTML = '<tr><td colspan="3">(select a session)</td></tr>';
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
    tbody.innerHTML = '<tr><td colspan="5">(no sessions yet today)</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  const now = new Date();

  sessionsTableData.forEach(session => {
    const tr = document.createElement('tr');
    const projLabel = session.project_name || '(project not set)';
    const workersCount = (session.open_punches || []).length;
    const adminLabel = session.started_by_name || session.foreman_name || '—';
    const started = formatAstTime(session.created_at);
    const ended = formatAstTime(session.ended_at);

    tr.innerHTML = `
      <td>${projLabel}</td>
      <td>${adminLabel}</td>
      <td class="right">${workersCount}</td>
      <td>${started || '—'}</td>
      <td>${ended || '—'}</td>
    `;

    tr.addEventListener('click', () => showSessionDetail(session, now));
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
  const tbody = document.getElementById('session-workers-body');

  const projLabel = session.project_name || '(project not set)';

  if (title) title.textContent = `${projLabel} – Current Workers`;

  if (tbody) {
    const open = session.open_punches || [];
    if (!open.length) {
      tbody.innerHTML = '<tr><td colspan="3">(no one clocked in on this session)</td></tr>';
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
    tbody.innerHTML = '<tr><td colspan="5">Loading sessions…</td></tr>';
  }

  try {
    const sessions = await fetchJSON('/api/kiosk-sessions/today');
    sessionsTableData = sessions || [];
    renderSessionsTable();
  } catch (err) {
    console.error('Error loading sessions:', err);
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="5">Error loading sessions.</td></tr>';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Auto-load once so the Sessions tab has data immediately
  loadSessionsSection();

  const refreshBtn = document.getElementById('session-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      clearSessionDetail();
      loadSessionsTable();
    });
  }
});
