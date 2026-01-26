
/* ───────── 1. SIDEBAR NAVIGATION ───────── */

// Run Payroll tab wiring & data loads only once
console.log('[App] app.js loaded');
let payrollTabInitialized = false;
let timeExceptionsInitialized = false;
let timeExceptionProjects = [];
window.CURRENT_ACCESS_PERMS = window.CURRENT_ACCESS_PERMS || {};

function setupSidebarNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.section');

  console.log('[NAV] setupSidebarNavigation: found', navItems.length, 'nav items and', sections.length, 'sections');

  navItems.forEach(item => {
    const isDisabled = item.dataset.disabled === 'true';

    item.addEventListener('click', () => {
      const sectionKey = item.dataset.section;
      console.log('[NAV] Clicked nav item', {
        text: item.textContent?.trim(),
        sectionKey,
        disabled: isDisabled
      });

      // 🔒 Do nothing if this nav item is disabled
      if (isDisabled) {
        console.log('[NAV] Item is disabled, ignoring click.');
        return;
      }

      // Update active nav button
      navItems.forEach(btn => btn.classList.remove('active'));
      item.classList.add('active');

      // Show matching section
      sections.forEach(sec => {
        const shouldBeActive = sec.id === `section-${sectionKey}`;
        sec.classList.toggle('active', shouldBeActive);
      });

      // Log which sections are active
      const activeIds = [...sections]
        .filter(sec => sec.classList.contains('active'))
        .map(sec => sec.id);
      console.log('[NAV] Active sections after click:', activeIds);

      // Update QB card visibility / buttons
      updateQbCardForSection(sectionKey);

      // ✅ Initialize payroll tab once, when first opened
      if (sectionKey === 'payroll') {
        console.log('[NAV] Initializing payroll tab (if not already).');
        initPayrollTabIfNeeded();
      }

      // Initialize Time Exceptions when that tab is opened directly
      if (sectionKey === 'time-exceptions') {
        initTimeExceptionsIfNeeded();
      }

      if (sectionKey === 'notifications') {
        if (typeof window.initNotificationsSection === 'function') {
          window.initNotificationsSection();
        }
      }

      // Layout debug for the active section
      debugSectionLayout(sectionKey);
    });
  });
}

function debugSectionLayout(sectionKey) {
  const sectionId = `section-${sectionKey}`;
  const section = document.getElementById(sectionId);

  if (!section) {
    console.log('[NAV DEBUG]', sectionKey, '→ NO <section> element with id', sectionId);
    return;
  }

  const cs = getComputedStyle(section);
  const rect = section.getBoundingClientRect();

  const firstCard = section.querySelector('.card');
  const cardRect = firstCard ? firstCard.getBoundingClientRect() : null;

  console.log('[NAV DEBUG] Active section:', sectionKey, {
    sectionId,
    display: cs.display,
    visibility: cs.visibility,
    opacity: cs.opacity,
    position: cs.position,
    rect,
    hasCard: !!firstCard,
    cardRect
  });
}

/* ───────── 2. QUICKBOOKS STATUS & SYNC ───────── */

async function checkStatus() {
  try {
    const data = await fetchJSON('/api/status');
    window.QBO_STATUS = data;
    const el = document.getElementById('qb-status');
    if (data.qbConnected) {
      el.textContent = '🔗 Connected to QuickBooks. Click “Connect” to refresh authorization.';
    } else {
      el.textContent = '❌ Not connected to QuickBooks. Click “Connect” to authorize.';
    }
  } catch (err) {
    document.getElementById('qb-status').textContent =
      'Error checking status: ' + err.message;
  }
}

function updateQbCardForSection(key) {
  const qbCard        = document.querySelector('.qb-card');
  const employeesBtn  = document.getElementById('sync-employees');
  const vendorsBtn    = document.getElementById('sync-vendors');
  const projectsBtn   = document.getElementById('sync-projects');
  const accountsBtn   = document.getElementById('sync-accounts');

  // 🔹 Remove any previous accent highlighting
  document.querySelectorAll('.card--accent').forEach(el => {
    el.classList.remove('card--accent');
  });

  // 🔹 Baseline: hide the QB card and reset all buttons
  if (qbCard) {
    qbCard.style.display = 'none';   // 👈 hide by default on all sections
  }

  if (employeesBtn) {
    employeesBtn.style.display = 'none';
    employeesBtn.onclick = null;
  }

  if (vendorsBtn) {
    vendorsBtn.style.display = 'none';
    vendorsBtn.onclick = null;
  }

  if (projectsBtn) {
    projectsBtn.style.display = 'none';
    projectsBtn.onclick = null;
  }

  if (accountsBtn) {
    accountsBtn.style.display = 'none';
    accountsBtn.onclick = null;
  }

  // 🔹 Only show the QB card + relevant button on these three tabs
  switch (key) {
    case 'employees':
      if (qbCard) qbCard.style.display = ''; // show card
      if (employeesBtn) {
        employeesBtn.style.display = '';
        employeesBtn.textContent = 'Sync Employees';
        employeesBtn.onclick = () => syncRoute('/api/sync/employees');
      }
      break;

    case 'vendors':
      if (qbCard) qbCard.style.display = ''; // show card
      if (vendorsBtn) {
        vendorsBtn.style.display = '';
        vendorsBtn.textContent = 'Sync Vendors';
        vendorsBtn.onclick = () => syncRoute('/api/sync/vendors');
      }
      break;

    case 'projects':
      if (qbCard) qbCard.style.display = ''; // show card
      if (projectsBtn) {
        projectsBtn.style.display = '';
        projectsBtn.textContent = 'Sync Projects';
        projectsBtn.onclick = () => syncRoute('/api/sync/projects');
      }
      break;

    case 'payroll':
      // Show QB connection card on payroll so admins can connect before running checks
      if (qbCard) qbCard.style.display = '';
      if (accountsBtn) {
        accountsBtn.style.display = '';
        accountsBtn.textContent = 'Sync Payroll Accounts';
        accountsBtn.onclick = () => syncRoute('/api/sync/payroll-accounts', async () => {
          // Reload account options/settings after sync
          if (typeof loadPayrollSettings === 'function') {
            await loadPayrollSettings();
          }
        });
      }
      break;

    // ...other cases unchanged
  }
}

// Background payroll accounts sync so settings dropdowns are fresh when opened
async function backgroundSyncPayrollAccounts() {
  if (window.__payrollAccountsSynced) return;
  window.__payrollAccountsSynced = true;

  try {
    await fetch('/api/sync/payroll-accounts', {
      method: 'POST',
      headers: getCsrfHeader()
    });
    // If payroll settings loader is available, refresh options
    if (typeof loadPayrollSettings === 'function') {
      await loadPayrollSettings();
    }
  } catch (err) {
    console.warn('[PAYROLL] Background payroll account sync failed:', err);
  }
}

const qboSyncBackoff = window.QBO_SYNC_BACKOFF || {};
window.QBO_SYNC_BACKOFF = qboSyncBackoff;

function resetQboSyncBackoff(route) {
  if (!route) return;
  delete qboSyncBackoff[route];
}

function computeQboSyncBackoffSeconds(route, retryAfterHeader) {
  if (!route) return 0;
  const existing = qboSyncBackoff[route] || { count: 0 };
  const schedule = [10, 30, 120];
  const fallbackSeconds = schedule[Math.min(existing.count, schedule.length - 1)];
  const retryAfterSeconds = Number.isFinite(Number(retryAfterHeader))
    ? Math.max(0, Number(retryAfterHeader))
    : 0;
  const seconds = retryAfterSeconds || fallbackSeconds;
  qboSyncBackoff[route] = { count: existing.count + 1, until: Date.now() + seconds * 1000 };
  return seconds;
}


async function syncRoute(route, onSuccess) {
  const indicator   = document.getElementById('qb-sync-indicator');
  const employeesBtn = document.getElementById('sync-employees');
  const vendorsBtn  = document.getElementById('sync-vendors');
  const projectsBtn = document.getElementById('sync-projects');
  const accountsBtn = document.getElementById('sync-accounts');
  const connectBtn  = document.getElementById('connect');
  let delayUnlockMs = 0;

  // ✅ include employeesBtn here
  const allButtons = [employeesBtn, vendorsBtn, projectsBtn, accountsBtn, connectBtn].filter(Boolean);

  try {
    // Show "syncing" UI
    if (indicator) {
      indicator.style.display = 'inline-flex';
      indicator.innerHTML =
        '<span class="sync-indicator-dot" aria-hidden="true"></span>' +
        '<span>Syncing with QuickBooks…</span>';
    }

    // Disable related buttons while sync is running
    allButtons.forEach(btn => {
      btn.disabled = true;
    });

    const res = await fetch(route, {
      method: 'POST',
      headers: getCsrfHeader()
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data && data.retryable) {
        const retryAfter = res.headers.get('Retry-After');
        const backoffSeconds = computeQboSyncBackoffSeconds(route, retryAfter);
        delayUnlockMs = backoffSeconds * 1000;
        const msg = data.error || data.message || 'QuickBooks sync is temporarily unavailable.';
        throw new Error(`${msg} Please retry in ${backoffSeconds} seconds.`);
      }
      const msg = data.error || data.message || 'Sync failed.';
      throw new Error(msg);
    }
    resetQboSyncBackoff(route);
    const fallbackMessage =
      typeof data.count === 'number' ? `Synced ${data.count} record(s).` : 'Sync complete.';
    alert(data.message || fallbackMessage);

    // After syncing from QuickBooks, reload what depends on it
    if (route === '/api/sync/vendors' || route === '/api/sync/employees') {
      await loadEmployeesTable();
      await loadEmployeesForSelect();
      await loadVendorsTable();
    } else if (route === '/api/sync/projects') {
      await loadProjectsForTimeEntries(); // time entry dropdown
      await loadProjectsTable();          // Projects section table
    } else if (route === '/api/sync/payroll-accounts') {
      if (typeof loadPayrollSettings === 'function') {
        await loadPayrollSettings();
      }
    }

    if (typeof onSuccess === 'function') {
      await onSuccess(data);
    }
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    // Hide indicator + re-enable buttons
    if (indicator) {
      indicator.style.display = 'none';
    }
    if (delayUnlockMs > 0) {
      setTimeout(() => {
        allButtons.forEach(btn => {
          btn.disabled = false;
        });
      }, delayUnlockMs);
    } else {
      allButtons.forEach(btn => {
        btn.disabled = false;
      });
    }
  }
}

/* ───────── 3. TIME ENTRIES UI ───────── */

function updateManualTimeHoursPreview() {
  const startInput     = document.getElementById('te-start');
  const startTimeInput = document.getElementById('te-start-time');
  const endTimeInput   = document.getElementById('te-end-time');
  const hoursInput     = document.getElementById('te-hours');
  const noteInput      = document.getElementById('te-note');
  const updatedAtInput = document.getElementById('te-updated-at');
  const origBlock      = document.getElementById('te-original');
  const origDateEl     = document.getElementById('te-original-date');
  const origProjEl     = document.getElementById('te-original-project');
  const origTimesEl    = document.getElementById('te-original-times');
  const msgEl          = document.getElementById('time-entry-message');

  if (!hoursInput) return;

  const start_date  = startInput?.value || '';
  const start_time  = startTimeInput?.value || '';
  const end_time    = endTimeInput?.value || '';

  // Don’t complain while they’re still typing
  if (!start_date || !start_time || !end_time) {
    hoursInput.value = '';
    if (msgEl) msgEl.textContent = '';
    return;
  }

  // Manual entries = same-day
  const hours = computeHoursFromDateTimes(start_date, start_time, start_date, end_time);

  if (hours == null) {
    hoursInput.value = '';
    if (msgEl) {
      msgEl.textContent = 'End time must be after start time on the same day.';
      msgEl.style.color = 'red';
    }
  } else {
    hoursInput.value = hours.toFixed(2);
    if (msgEl) {
      msgEl.textContent = '';
    }
  }
}

async function loadTimeEntriesTable(filters = {}) {
  const tbody   = document.getElementById('time-table-body');
  const heading = document.getElementById('time-entries-heading');
  if (!tbody) return;

  // columns: Entry ID, Employee, Project, Date, Hours, Pay, Paid?, Paid on, Approval
  tbody.innerHTML = '<tr><td colspan="9">Loading...</td></tr>';

  const hasFilters = !!(
    filters.start ||
    filters.end ||
    filters.employee_id ||
    filters.project_id
  );

  if (heading) {
    heading.textContent = hasFilters ? 'Selected Entries' : "Today's Entries";
  }

  const params = [];
  if (filters.start)       params.push(`start=${encodeURIComponent(filters.start)}`);
  if (filters.end)         params.push(`end=${encodeURIComponent(filters.end)}`);
  if (filters.employee_id) params.push(`employee_id=${encodeURIComponent(filters.employee_id)}`);
  if (filters.project_id)  params.push(`project_id=${encodeURIComponent(filters.project_id)}`);

  let url = '/api/time-entries';
  if (params.length) {
    url += '?' + params.join('&');
  }

  try {
    const entries = await fetchJSON(url);

    if (!entries.length) {
      tbody.innerHTML =
        '<tr><td colspan="9">(no time entries for this selection)</td></tr>';
      return;
    }

    tbody.innerHTML = '';

    entries.forEach(e => {
      const tr = document.createElement('tr');

      // ─────────────────────────────────────────────
      // DATE LOGIC: show single date unless truly multi-day
      // ─────────────────────────────────────────────
      let dateLabel = '';

      if (e.start_date && e.end_date) {
        if (e.start_date === e.end_date) {
          // same day — show just one date
          dateLabel = formatDateUS(e.start_date);
        } else {
          // true multi-day range
          dateLabel = `${formatDateUS(e.start_date)} → ${formatDateUS(e.end_date)}`;
        }
      } else if (e.start_date) {
        dateLabel = formatDateUS(e.start_date);
      } else if (e.end_date) {
        dateLabel = formatDateUS(e.end_date);
      }

      // ─────────────────────────────────────────────
      // PAID / UNPAID LOGIC
      // ─────────────────────────────────────────────
      const paidValue = e.paid;
      const paidLabel =
        paidValue === 1 ||
        paidValue === true ||
        paidValue === '1'
          ? 'Paid'
          : 'Unpaid';

      const paidDateLabel = e.paid_date ? formatDateUS(e.paid_date) : '';

      const approvalStatus =
        String(e.approval_status || '').toLowerCase() === 'approved'
          ? 'Approved'
          : 'Pending';
      const approvedBy =
        e.approved_by_name ||
        (e.approved_by_employee_id ? `#${e.approved_by_employee_id}` : '—');
      const approvedAt = e.approved_at ? formatDateTimeLocal(e.approved_at) : '';
      const canApprove = !!window.CURRENT_IS_SUPER_ADMIN;
      let approvalHtml = `<div>${approvalStatus}</div>`;
      if (approvalStatus === 'Approved') {
        approvalHtml += `<div class="text-xs text-gray-600">by ${escapeHTML(approvedBy)}</div>`;
        if (approvedAt) {
          approvalHtml += `<div class="text-xs text-gray-600">${escapeHTML(approvedAt)}</div>`;
        }
      } else if (canApprove) {
        approvalHtml += `
          <button class="btn primary btn-xs te-approve-btn" data-approve-id="${e.id}">
            Approve
          </button>
        `;
      }

      // ─────────────────────────────────────────────
      // BUILD THE TABLE ROW
      // ─────────────────────────────────────────────
      tr.innerHTML = `
        <td>${e.id != null ? e.id : ''}</td>
        <td>${e.employee_name || ''}</td>
        <td>${e.project_name || ''}</td>
        <td>${dateLabel}</td>
        <td>${Number(e.hours || 0).toFixed(2)}</td>
        <td>$${Number(e.total_pay || 0).toFixed(2)}</td>
        <td>${paidLabel}</td>
        <td>${paidDateLabel}</td>
        <td>${approvalHtml}</td>
      `;

      // store raw values on the row for editing
      tr.dataset.entryId    = e.id;
      tr.dataset.employeeId = e.employee_id;
      tr.dataset.projectId  = e.project_id;
      tr.dataset.projectName = e.project_name || '';
      tr.dataset.startDate  = e.start_date || '';
      tr.dataset.endDate    = e.end_date || '';
      tr.dataset.hours      = e.hours != null ? String(e.hours) : '';
      tr.dataset.startTime  = e.start_time || '';
      tr.dataset.endTime    = e.end_time || '';
      tr.dataset.updatedAt  = e.updated_at || '';

      // clicking a row loads it into the form for editing
      tr.addEventListener('click', () => {
        loadTimeEntryIntoFormFromRow(tr);
      });

      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.te-approve-btn').forEach(btn => {
      btn.addEventListener('click', handleTimeEntryApproveClick);
    });

  } catch (err) {
    console.error('Error loading time entries:', err.message);
    tbody.innerHTML =
      '<tr><td colspan="9">Error loading time entries</td></tr>';
  }
}

async function handleTimeEntryApproveClick(evt) {
  evt.stopPropagation();
  const btn = evt.currentTarget;
  const id = btn?.getAttribute('data-approve-id');
  if (!id) return;

  const row = btn.closest('tr');
  const updatedAt = row?.dataset?.updatedAt || '';

  const noteInput = window.prompt(
    'Add a note if needed (required for discrepancies or manual edits). Leave blank for clean entries.'
  );
  if (noteInput === null) return;
  const note = noteInput.trim();

  try {
    const payload = {};
    if (note) payload.note = note;
    if (updatedAt) payload.if_match_updated_at = updatedAt;
    await fetchJSON(`/api/time-entries/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const filters = getTimeEntryFiltersFromUi();
    if (hasActiveTimeEntryFilters(filters)) {
      await loadTimeEntriesTable(filters);
    } else {
      await loadTimeEntriesTable();
    }
  } catch (err) {
    window.alert(err?.message || 'Failed to approve time entry.');
  }
}

async function approveAllTimeEntries() {
  if (!window.CURRENT_IS_SUPER_ADMIN) {
    window.alert('Super admin access required.');
    return;
  }

  const filters = getTimeEntryFiltersFromUi();
  const today = new Date().toISOString().slice(0, 10);
  const start = filters.start || today;
  const end = filters.end || start;

  const confirmed = window.confirm(
    `Approve all clean entries from ${start} to ${end}? Entries requiring a note will be skipped.`
  );
  if (!confirmed) return;

  try {
    const payload = {
      start,
      end
    };
    if (filters.employee_id) payload.employee_id = filters.employee_id;
    if (filters.project_id) payload.project_id = filters.project_id;

    const resp = await fetchJSON('/api/time-entries/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const approvedCount = resp?.approved_count || 0;
    const skippedCount = Array.isArray(resp?.skipped) ? resp.skipped.length : 0;
    window.alert(
      `Approved ${approvedCount} entries. Skipped ${skippedCount} entries that require a note.`
    );

    if (hasActiveTimeEntryFilters(filters)) {
      await loadTimeEntriesTable(filters);
    } else {
      await loadTimeEntriesTable();
    }
  } catch (err) {
    window.alert(err?.message || 'Bulk approve failed.');
  }
}

function applyTimeEntryApprovalAccess() {
  const approveAllBtn = document.getElementById('te-approve-all');
  if (!approveAllBtn) return;
  approveAllBtn.style.display = window.CURRENT_IS_SUPER_ADMIN ? 'inline-flex' : 'none';
}

function getTimeEntryFiltersFromUi() {
  const empFilter   = document.getElementById('te-filter-employee');
  const projFilter  = document.getElementById('te-filter-project');
  const startFilter = document.getElementById('te-filter-start');
  const endFilter   = document.getElementById('te-filter-end');

  return {
    employee_id: empFilter && empFilter.value ? empFilter.value : '',
    project_id:  projFilter && projFilter.value ? projFilter.value : '',
    start:       startFilter && startFilter.value ? startFilter.value : '',
    end:         endFilter && endFilter.value ? endFilter.value : ''
  };
}

function hasActiveTimeEntryFilters(filters = {}) {
  return !!(
    (filters.employee_id && String(filters.employee_id).trim()) ||
    (filters.project_id && String(filters.project_id).trim())  ||
    (filters.start && String(filters.start).trim())            ||
    (filters.end && String(filters.end).trim())
  );
}

function buildTimeEntriesExportUrl(format) {
  const empFilter   = document.getElementById('te-filter-employee');
  const projFilter  = document.getElementById('te-filter-project');
  const startFilter = document.getElementById('te-filter-start');
  const endFilter   = document.getElementById('te-filter-end');

  const params = new URLSearchParams();

  if (empFilter && empFilter.value)   params.set('employee_id', empFilter.value);
  if (projFilter && projFilter.value) params.set('project_id', projFilter.value);
  if (startFilter && startFilter.value) params.set('start', startFilter.value);
  if (endFilter && endFilter.value)     params.set('end', endFilter.value);

  const qs = params.toString();
  return `/api/time-entries/export/${format}` + (qs ? `?${qs}` : '');
}

async function loadTimeEntryIntoFormFromRow(row) {
  const teFormCard    = document.getElementById('time-entry-create-card');
  const teToggleBtn   = document.getElementById('time-entry-toggle-form');
  const teToggleContainerForm   = document.getElementById('time-entry-toggle-container-form');
  const teToggleContainerReport = document.getElementById('time-entry-toggle-container-report');
  const saveBtn       = document.getElementById('time-entry-save-btn');

  function moveToggleToFormLocal() {
    if (teToggleBtn && teToggleContainerForm && teToggleBtn.parentElement !== teToggleContainerForm) {
      teToggleContainerForm.appendChild(teToggleBtn);
    }
    if (teToggleBtn) teToggleBtn.textContent = 'Hide manual time entry';
  }

  // Ensure the manual-entry card is visible
  if (teFormCard && teFormCard.classList.contains('hidden')) {
    teFormCard.classList.remove('hidden');

    moveToggleToFormLocal();

    await loadEmployeesForSelect();
    await loadProjectsForTimeEntries();

    teFormCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    // Card already open – still ensure toggle is in the right container
    moveToggleToFormLocal();
  }

  const idInput        = document.getElementById('te-id');
  const employeeSelect = document.getElementById('te-employee');
  const projectSelect  = document.getElementById('te-project');
  const startInput     = document.getElementById('te-start');
  const endInput       = document.getElementById('te-end');
  const startTimeInput = document.getElementById('te-start-time');
  const endTimeInput   = document.getElementById('te-end-time');
  const hoursInput     = document.getElementById('te-hours');
  const noteInput      = document.getElementById('te-note');
  const updatedAtInput = document.getElementById('te-updated-at');
  const msgEl          = document.getElementById('time-entry-message');


  if (idInput) idInput.value = row.dataset.entryId || '';
  if (updatedAtInput) updatedAtInput.value = row.dataset.updatedAt || '';

  if (employeeSelect && row.dataset.employeeId) {
    employeeSelect.value = String(row.dataset.employeeId);
  }

  if (projectSelect && row.dataset.projectId) {
    projectSelect.value = String(row.dataset.projectId);
  }

  if (startInput) startInput.value = row.dataset.startDate || '';
  if (endInput)   endInput.value   = row.dataset.endDate || '';
  if (hoursInput) hoursInput.value = row.dataset.hours || '';
  if (startTimeInput) startTimeInput.value = row.dataset.startTime || '';
if (endTimeInput)   endTimeInput.value   = row.dataset.endTime || '';
  if (noteInput) noteInput.value = '';

  if (origBlock) {
    origBlock.classList.remove('hidden');
    if (origDateEl) origDateEl.textContent = row.dataset.startDate || row.dataset.endDate || '—';
    if (origProjEl) origProjEl.textContent = row.dataset.projectName || row.dataset.projectId || '—';
    const timesLabel = `${row.dataset.startTime || '—'} to ${row.dataset.endTime || '—'}`;
    if (origTimesEl) origTimesEl.textContent = timesLabel;
  }

  if (msgEl) {
    msgEl.textContent =
      'Editing existing time entry. Update the fields and click "Update Time Entry".';
    msgEl.style.color = 'blue';
  }
  if (saveBtn) {
    saveBtn.textContent = 'Update Time Entry';
  }
}

async function loadOpenPunches() {
  const tbody = document.getElementById('live-open-punches-body');
  const msgEl = document.getElementById('live-message');
  if (!tbody) return;

  // Clear message
  if (msgEl) msgEl.textContent = '';

  // Loading state
  tbody.innerHTML =
    '<tr><td colspan="4">Loading current punches...</td></tr>';

  try {
    const rows = await fetchJSON('/api/time-punches/open');

    if (!rows.length) {
      tbody.innerHTML =
        '<tr><td colspan="4">(no one is currently clocked in)</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    const now = new Date();

    rows.forEach(row => {
      const tr = document.createElement('tr');

      const start = row.clock_in_ts ? new Date(row.clock_in_ts) : null;
      let durationText = '';

      if (start && !Number.isNaN(start.getTime())) {
        const diffMs = now - start;
        const diffMin = Math.floor(diffMs / 60000);
        const diffHours = diffMs / 3600000;

        if (diffMin < 60) {
          durationText = `${diffMin} min`;
        } else {
          durationText = `${diffHours.toFixed(2)} hrs`;
        }
      }

      const whenText = row.clock_in_ts
        ? formatDateTimeLocal(row.clock_in_ts)
        : '';

      const proj = row.project_name || '';

      tr.innerHTML = `
        <td>${row.employee_name || ''}</td>
        <td>${proj}</td>
        <td>${whenText}</td>
        <td>${durationText}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading open punches:', err.message);
    tbody.innerHTML =
      '<tr><td colspan="4">Error loading current punches</td></tr>';
    if (msgEl) msgEl.textContent = 'Could not load live data. Check connection.';
  }
}

// Offline queue for time entry edits.
const TIME_EDIT_QUEUE_KEY = 'avian_kiosk_time_edit_queue_v1';

function loadTimeEditQueue() {
  try {
    const raw = localStorage.getItem(TIME_EDIT_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveTimeEditQueue(queue) {
  try {
    localStorage.setItem(TIME_EDIT_QUEUE_KEY, JSON.stringify(queue || []));
  } catch {
    // ignore
  }
}

function queueTimeEdit(entry) {
  const q = loadTimeEditQueue();
  const timeEntryId = entry && entry.time_entry_id ? String(entry.time_entry_id) : '';
  const filtered = timeEntryId
    ? q.filter(item => String(item.time_entry_id || '') !== timeEntryId)
    : q;
  filtered.push(entry);
  saveTimeEditQueue(filtered);
}

function isTimeEditConnectionIssue(err) {
  const msg = err && err.message ? String(err.message) : '';
  return !navigator.onLine || /network|failed to fetch|offline/i.test(msg);
}

async function syncTimeEditQueue() {
  if (!navigator.onLine) return;
  const q = loadTimeEditQueue();
  if (!q.length) return;

  const remaining = [];

  for (const entry of q) {
    if (!entry || !entry.payload) continue;
    const url = entry.time_entry_id
      ? `/api/time-entries/${encodeURIComponent(entry.time_entry_id)}`
      : '/api/time-entries';
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getCsrfHeader() },
        body: JSON.stringify(entry.payload)
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          remaining.push(entry);
          break;
        }
        if (res.status >= 500) {
          remaining.push(entry);
          break;
        }
        if (res.status === 409) {
          remaining.push(entry);
          break;
        }
        // Drop hard validation errors so the queue doesn't block.
        continue;
      }
    } catch (err) {
      if (isTimeEditConnectionIssue(err)) {
        remaining.push(entry);
        break;
      }
    }
  }

  saveTimeEditQueue(remaining);
}

async function saveTimeEntry() {
  const idInput        = document.getElementById('te-id');
  const employeeSelect = document.getElementById('te-employee');
  const projectSelect  = document.getElementById('te-project');
  const startInput     = document.getElementById('te-start');
  const hoursInput     = document.getElementById('te-hours');
  const startTimeInput = document.getElementById('te-start-time');
  const endTimeInput   = document.getElementById('te-end-time');
  const noteInput      = document.getElementById('te-note');
  const updatedAtInput = document.getElementById('te-updated-at');
  const msgEl          = document.getElementById('time-entry-message');

  // Basic field values
  const employee_id = Number(employeeSelect?.value || '');
  const project_id  = Number(projectSelect?.value || '');
  const start_date  = startInput?.value || '';
  const start_time  = startTimeInput?.value || '';
  const end_time    = endTimeInput?.value || '';
  const change_note = noteInput?.value || '';

  // 👉 Manual entries are always single-day
  const end_date = start_date;

  const isEdit = !!(idInput && idInput.value);

  // ───────── VALIDATION ─────────
  if (!employee_id || !project_id || !start_date || !start_time || !end_time) {
    if (msgEl) {
      msgEl.textContent =
        'Employee, project, date, start time, and end time are required.';
      msgEl.style.color = 'red';
    }
    return;
  }

  // ───────── HOURS CALCULATION ─────────
  const hours = computeHoursFromDateTimes(start_date, start_time, end_date, end_time);
  if (hours == null) {
    if (msgEl) {
      msgEl.textContent = 'End time must be after start time on the same day.';
      msgEl.style.color = 'red';
    }
    return;
  }

  if (hoursInput) {
    hoursInput.value = hours.toFixed(2);
  }

  if (msgEl) {
    msgEl.textContent = 'Saving...';
    msgEl.style.color = 'black';
  }

  if (!change_note.trim()) {
    if (msgEl) {
      msgEl.textContent = isEdit
        ? 'A note is required when editing an entry.'
        : 'A note is required when creating a manual entry.';
      msgEl.style.color = 'red';
    }
    return;
  }

  const payload = {
    employee_id,
    project_id,
    start_date,
    end_date,
    start_time,
    end_time,
    hours,
    note: change_note.trim(),
    client_id: makeClientId(isEdit ? 'time_edit' : 'time_create')
  };
  if (isEdit && updatedAtInput && updatedAtInput.value) {
    payload.if_match_updated_at = updatedAtInput.value;
  }

  let url = '/api/time-entries';
  if (isEdit) {
    url = `/api/time-entries/${encodeURIComponent(idInput.value)}`;
  }

  if (!navigator.onLine) {
    queueTimeEdit({
      client_id: payload.client_id,
      time_entry_id: isEdit ? idInput.value : null,
      payload,
      queued_at: new Date().toISOString()
    });
    if (msgEl) {
      msgEl.textContent = 'Saved offline — will sync when back online.';
      msgEl.style.color = '#b45309';
    }
    resetTimeEntryFormToNewMode();
    return;
  }

  try {
    await fetchJSON(url, {
      method: 'POST', // your API is using POST for both create + update
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (msgEl) {
      msgEl.textContent = isEdit
        ? 'Time entry updated.'
        : 'Time entry saved.';
      msgEl.style.color = 'green';
    }

    // Reset form back to "new" mode
    resetTimeEntryFormToNewMode();

    // ───────── RELOAD TABLE WITH EXISTING FILTERS (IF ANY) ─────────
    const filters = getTimeEntryFiltersFromUi();
    const hasFilters = hasActiveTimeEntryFilters(filters);

    if (hasFilters) {
      await loadTimeEntriesTable(filters);
    } else {
      await loadTimeEntriesTable(); // today's entries
    }
  } catch (err) {
    console.error('Error saving time entry:', err);
    if (isTimeEditConnectionIssue(err)) {
      queueTimeEdit({
        client_id: payload.client_id,
        time_entry_id: isEdit ? idInput.value : null,
        payload,
        queued_at: new Date().toISOString()
      });
      if (msgEl) {
        msgEl.textContent = 'Saved offline — will sync when back online.';
        msgEl.style.color = '#b45309';
      }
      resetTimeEntryFormToNewMode();
      return;
    }
    if (msgEl) {
      msgEl.textContent = 'Error saving time entry: ' + err.message;
      msgEl.style.color = 'red';
    }
  }
}

function resetTimeEntryFormToNewMode() {
  const idInput        = document.getElementById('te-id');
  const employeeSelect = document.getElementById('te-employee');
  const projectSelect  = document.getElementById('te-project');
  const startInput     = document.getElementById('te-start');
  const endInput       = document.getElementById('te-end');
  const startTimeInput = document.getElementById('te-start-time');
  const endTimeInput   = document.getElementById('te-end-time');
  const hoursInput     = document.getElementById('te-hours');
  const noteInput      = document.getElementById('te-note');
  const origBlock      = document.getElementById('te-original');
  const msgEl          = document.getElementById('time-entry-message');
  const saveBtn        = document.getElementById('time-entry-save-btn');

  if (idInput)        idInput.value = '';
  if (employeeSelect) employeeSelect.value = '';
  if (projectSelect)  projectSelect.value = '';
  if (startInput)     startInput.value = '';
  if (endInput)       endInput.value = '';
  if (startTimeInput) startTimeInput.value = '';
  if (endTimeInput)   endTimeInput.value = '';
  if (hoursInput)     hoursInput.value = '';
  if (noteInput)      noteInput.value = '';
  if (updatedAtInput) updatedAtInput.value = '';
  if (origBlock)      origBlock.classList.add('hidden');

  if (msgEl) {
    msgEl.textContent = '';
    msgEl.style.color = 'black';
  }

  if (saveBtn) {
    saveBtn.textContent = 'Save Time Entry';
  }
}

function setupTimeExceptionsSection() {
  const applyBtn = document.getElementById('te-ex-apply');
  const clearBtn = document.getElementById('te-ex-clear');
  const hideResolvedEl = document.getElementById('te-ex-hide-resolved');
  const categorySel = document.getElementById('te-ex-filter-category');
  const reviewClose = document.getElementById('te-review-close');
  const reviewCancel = document.getElementById('te-review-cancel');
  const reviewSave = document.getElementById('te-review-save');
  const reviewBackdrop = document.getElementById('time-exception-review-backdrop');
  const reviewAction = document.getElementById('te-review-action');

  // APPLY button → reload table with selected filters
  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      loadTimeExceptionsTable();
    });
  }

  // CLEAR button → reset all filters back to defaults
if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    const empSel  = document.getElementById('te-ex-filter-employee');
    const projSel = document.getElementById('te-ex-filter-project');
    const startEl = document.getElementById('te-ex-filter-start');
    const endEl   = document.getElementById('te-ex-filter-end');
    const catSel  = document.getElementById('te-ex-filter-category');

    if (empSel) empSel.value = '';
    if (projSel) projSel.value = '';
    if (catSel) catSel.value = '';

    // reset dates to today
    const today = new Date().toISOString().slice(0, 10);
    if (startEl) startEl.value = today;
    if (endEl)   endEl.value   = today;

    loadTimeExceptionsTable();
  });
}


  // HIDE RESOLVED checkbox → reload whenever toggled
  if (hideResolvedEl) {
    hideResolvedEl.addEventListener('change', () => {
      loadTimeExceptionsTable();
    });
  }

    // CATEGORY dropdown → client-side filter only
  if (categorySel) {
    categorySel.addEventListener('change', () => {
      applyTimeExceptionCategoryFilter();
    });
  }

  // Delegate review button clicks so wiring survives table reloads
  const tbody = document.getElementById('time-exceptions-body');
  if (tbody) {
    tbody.addEventListener('click', evt => {
      const btn = evt.target.closest('.te-review-btn');
      if (!btn) return;
      console.log('[Time Exceptions] Delegated handler fired');

      const id = btn.getAttribute('data-id');
      const source = btn.getAttribute('data-source');
      if (!id) return;

      const row = btn.closest('tr');
      const recFromRow = row && row.__timeException;
      const recFromList = currentTimeExceptions.find(
        r => String(r.id) === String(id) && (!source || r.source === source)
      );

      const rec = recFromRow || recFromList || null;
      if (!rec) {
        console.warn('[Time Exceptions] Review click but record not found', {
          id,
          source,
          listCount: currentTimeExceptions.length
        });
        return;
      }

      openTimeExceptionReviewModal(rec);
    });
  }

  // Global fallback listener in case tbody listener is removed/replaced
  document.addEventListener('click', evt => {
    const btn = evt.target.closest && evt.target.closest('.te-review-btn');
    if (!btn) return;
    console.log('[Time Exceptions] Document-level fallback handler fired');
    handleTimeExceptionReviewClick(evt);
  });

  if (reviewClose) reviewClose.addEventListener('click', closeTimeExceptionReviewModal);
  if (reviewCancel) reviewCancel.addEventListener('click', closeTimeExceptionReviewModal);
  if (reviewBackdrop) {
    reviewBackdrop.addEventListener('click', closeTimeExceptionReviewModal);
  }
  if (reviewSave) {
    reviewSave.addEventListener('click', submitTimeExceptionReview);
  }
  if (reviewAction) {
    reviewAction.addEventListener('change', handleTimeExceptionActionChange);
  }
  bindReviewTimeInputs();

  // Initial load: first load dropdowns, then load the table
  loadTimeExceptionsFilters().then(() => {
    loadTimeExceptionsTable();
  });
}



async function loadTimeExceptionsFilters() {
  try {
    // Reuse existing APIs for employees & projects
    const [employeesRes, projectsRes] = await Promise.all([
      fetchJSON('/api/employees?status=active'),
      fetchJSON('/api/projects?status=active')
    ]);

    const employees = employeesRes || [];
    const projects  = projectsRes || [];
    timeExceptionProjects = projects;

    const empSelect = document.getElementById('te-ex-filter-employee');
    const projSelect = document.getElementById('te-ex-filter-project');

    if (empSelect) {
      empSelect.innerHTML = '<option value="">All employees</option>';
      employees.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.id;
        opt.textContent = e.name;
        empSelect.appendChild(opt);
      });
    }

    if (projSelect) {
      projSelect.innerHTML = '<option value="">All projects</option>';
      projects.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name || '(Unnamed project)';
        projSelect.appendChild(opt);
      });
    }

    // Default date range: today → today
    const today = new Date().toISOString().slice(0, 10);
    const startInput = document.getElementById('te-ex-filter-start');
    const endInput   = document.getElementById('te-ex-filter-end');

    if (startInput && !startInput.value) startInput.value = today;
    if (endInput && !endInput.value)     endInput.value   = today;
  } catch (err) {
    console.error('Error loading time-exceptions filters:', err);
  }
}

function classifyTimeException(row) {
  const flags = Array.isArray(row.flags) ? row.flags : [];
  const categories = new Set();

  // Auto-clock-out category
  if (
    row.auto_clock_out ||
    flags.some(f => /^auto clock-out/i.test(String(f)))
  ) {
    categories.add('auto');
  }

  // Geofence category: explicit flag or has_geo_violation from server
  if (
    row.has_geo_violation ||
    flags.some(f => /geofence/i.test(String(f)))
  ) {
    categories.add('geo');
  }

  // Time category: anything that's not auto/geofence
  const hasTimeishFlag = flags.some(f => {
    const lower = String(f).toLowerCase();
    const isGeo = lower.includes('geofence');
    const isAuto = lower.startsWith('auto clock-out');
    return !isGeo && !isAuto;
  });
  if (hasTimeishFlag) {
    categories.add('time');
  }

  // Fallback if somehow nothing matched
  if (categories.size === 0) {
    categories.add('time');
  }

  const keyToLabel = {
    time: 'Time entry discrepancy',
    geo: 'Geofence discrepancy',
    auto: 'Auto clock-out'
  };

  const keys = Array.from(categories);
  const label = keys.map(k => keyToLabel[k] || k).join(', ');

  return { keys, label };
}

function fillReviewNewFieldsFromOriginal(rec = currentTimeExceptionRecord || {}) {
  const startInput = document.getElementById('te-review-start');
  const endInput = document.getElementById('te-review-end');
  const projectSelect = document.getElementById('te-review-project');

  const { startIso, endIso } = getTimeExceptionOriginalRange(rec);

  const startStr = startIso
    ? formatLocalTimeHHMM(startIso)
    : rec.start_time || '';
  const endStr = endIso
    ? formatLocalTimeHHMM(endIso)
    : rec.end_time || '';

  if (startInput) startInput.value = startStr;
  if (endInput) endInput.value = endStr;

  if (projectSelect) {
    projectSelect.value = rec.project_id ? String(rec.project_id) : '';
  }

  updateReviewHoursDisplay();
}

function handleTimeExceptionActionChange() {
  const reviewAction = document.getElementById('te-review-action');
  const note = document.getElementById('te-review-note');
  const noteHelp = document.getElementById('te-review-note-help');
  const newBlock = document.getElementById('te-review-new-block');
  const startInput = document.getElementById('te-review-start');
  const endInput = document.getElementById('te-review-end');
  const projectSelect = document.getElementById('te-review-project');
  const hoursInput = document.getElementById('te-review-hours');

  if (!reviewAction) return;

  const needNote =
    reviewAction.value === 'approve' ||
    reviewAction.value === 'modify' ||
    reviewAction.value === 'reject';
  if (note) note.required = needNote;
  if (noteHelp) noteHelp.classList.toggle('hidden', !needNote);
  if (newBlock) newBlock.classList.toggle('hidden', reviewAction.value !== 'modify');

  if (reviewAction.value !== 'modify') {
    if (startInput) startInput.value = '';
    if (endInput) endInput.value = '';
    if (projectSelect) projectSelect.value = '';
    if (hoursInput) hoursInput.value = '';
  } else {
    fillReviewNewFieldsFromOriginal();
  }

  updateReviewHoursDisplay();
}

function bindReviewTimeInputs() {
  const startInput = document.getElementById('te-review-start');
  const endInput = document.getElementById('te-review-end');
  [startInput, endInput].forEach(input => {
    if (input && !input.dataset.boundHours) {
      input.dataset.boundHours = '1';
      input.addEventListener('input', updateReviewHoursDisplay);
      input.addEventListener('change', updateReviewHoursDisplay);
    }
  });
}

async function ensureTimeExceptionProjectsLoaded() {
  if (timeExceptionProjects && timeExceptionProjects.length) return timeExceptionProjects;
  try {
    const projects = await fetchJSON('/api/projects?status=active');
    timeExceptionProjects = projects || [];
  } catch (err) {
    console.error('[Time Exceptions] Failed to load projects for review modal', err);
    timeExceptionProjects = [];
  }
  return timeExceptionProjects;
}

function populateTimeExceptionProjectSelect(selectedId) {
  const sel = document.getElementById('te-review-project');
  if (!sel) return;
  sel.innerHTML = '<option value="">Select project</option>';
  (timeExceptionProjects || []).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name || '(Unnamed project)';
    sel.appendChild(opt);
  });
  if (selectedId != null) {
    sel.value = selectedId;
  }
}

function formatDateTimeLocal(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d)) return '';
  const pad = n => String(n).padStart(2, '0');
  return [
    d.getFullYear(),
    '-',
    pad(d.getMonth() + 1),
    '-',
    pad(d.getDate()),
    'T',
    pad(d.getHours()),
    ':',
    pad(d.getMinutes())
  ].join('');
}

function formatLocalTimeHHMM(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d)) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getTimeExceptionBaseDay(rec = {}) {
  return (
    (rec.clock_in_ts && rec.clock_in_ts.slice(0, 10)) ||
    rec.start_date ||
    rec.end_date ||
    null
  );
}

function calculateDurationHours(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const diffMs = end - start;
  if (diffMs < 0) return null;
  const hours = diffMs / 3600000;
  return Number.isFinite(hours) ? Number(hours.toFixed(2)) : null;
}

function getTimeExceptionOriginalRange(rec = {}) {
  const startIso =
    rec.clock_in_ts ||
    (rec.start_date ? `${rec.start_date}T${rec.start_time || '00:00'}` : null);
  const endIso =
    rec.clock_out_ts ||
    (rec.end_date ? `${rec.end_date}T${rec.end_time || '00:00'}` : null);

  const hoursFromRange = calculateDurationHours(startIso, endIso);
  const fallbackHours =
    rec.duration_hours != null
      ? Number(rec.duration_hours)
      : rec.hours != null
        ? Number(rec.hours)
        : null;

  const hours =
    hoursFromRange != null
      ? hoursFromRange
      : !Number.isNaN(fallbackHours)
        ? fallbackHours
        : null;

  return { startIso, endIso, hours };
}

function updateReviewHoursDisplay() {
  const rec = currentTimeExceptionRecord || {};
  const { hours: origHours } = getTimeExceptionOriginalRange(rec);
  const origHoursEl = document.getElementById('te-review-orig-hours');
  if (origHoursEl) {
    origHoursEl.textContent =
      origHours != null && !Number.isNaN(origHours)
        ? `${origHours.toFixed(2)} hrs`
        : '—';
  }

  const actionSelect = document.getElementById('te-review-action');
  const isModify = actionSelect ? actionSelect.value === 'modify' : false;
  const startInput = document.getElementById('te-review-start');
  const endInput = document.getElementById('te-review-end');
  const hoursInput = document.getElementById('te-review-hours');

  if (!hoursInput) return;
  if (!isModify) {
    hoursInput.value = '';
    return;
  }

  const baseDay = getTimeExceptionBaseDay(rec);
  const startVal = startInput?.value;
  const endVal = endInput?.value;
  const startIso =
    baseDay && startVal ? `${baseDay}T${startVal}:00` : null;
  const endIso = baseDay && endVal ? `${baseDay}T${endVal}:00` : null;
  const newHours = calculateDurationHours(startIso, endIso);

  hoursInput.value =
    newHours != null && !Number.isNaN(newHours) ? newHours.toFixed(2) : '';
}

let currentTimeExceptionRecord = null;
let currentTimeExceptions = [];

// Global helper for inline handlers (more reliable than late-bound listeners)
window.handleTimeExceptionReviewClick = function handleTimeExceptionReviewClick(evt) {
  console.log('[Time Exceptions] Review clicked (inline/global handler)');
  const btn = evt?.currentTarget || evt?.target;
  if (!btn) return;

   if (evt && typeof evt.stopPropagation === 'function') {
    evt.stopPropagation();
  }

  const idx = btn.getAttribute('data-index');
  const id = btn.getAttribute('data-id');
  const source = btn.getAttribute('data-source');
  if (idx == null && !id) return;

  // Try to resolve record from multiple sources
  let rec = null;

  // 1) From row property (most reliable if table rebuilt)
  const row = btn.closest('tr');
  if (row && row.__timeException) {
    rec = row.__timeException;
  }

  // 2) From index in cached array
  if (!rec && idx != null && currentTimeExceptions[Number(idx)]) {
    rec = currentTimeExceptions[Number(idx)];
  }

  // 3) Fallback by id search
  if (!rec && id) {
    rec = currentTimeExceptions.find(r => String(r.id) === String(id));
  }

  if (!rec) return;
  if (source && rec.source && rec.source !== source) return;

  openTimeExceptionReviewModal(rec);
};

function closeTimeExceptionReviewModal() {
  const backdrop = document.getElementById('time-exception-review-backdrop');
  const modal = document.getElementById('time-exception-review-modal');
  if (backdrop) {
    backdrop.classList.add('hidden');
    backdrop.style.display = 'none';
  }
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
  currentTimeExceptionRecord = null;
}

async function openTimeExceptionReviewModal(rec) {
  currentTimeExceptionRecord = rec;
  const { backdrop, modal } = await ensureTimeExceptionModalReady();
  await ensureTimeExceptionProjectsLoaded();
  if (!modal || !backdrop || !rec) {
    console.warn('[Time Exceptions] Missing modal/backdrop or record for review click.', {
      hasModal: !!modal,
      hasBackdrop: !!backdrop,
      rec
    });
    return;
  }

  // Ensure elements are attached to document and above everything
  if (!modal.isConnected) document.body.appendChild(modal);
  if (!backdrop.isConnected) document.body.appendChild(backdrop);

  // Show modal
  backdrop.classList.remove('hidden');
  modal.classList.remove('hidden');
  // Force inline display/z-index/size in case CSS collisions kept it hidden
  Object.assign(backdrop.style, {
    display: 'block',
    position: 'fixed',
    inset: '0',
    zIndex: '9998',
    opacity: '1'
  });
  Object.assign(modal.style, {
    display: 'flex',
    position: 'fixed',
    inset: '0',
    width: '100vw',
    height: '100vh',
    zIndex: '9999',
    opacity: '1',
    pointerEvents: 'auto',
    alignItems: 'center',
    justifyContent: 'center'
  });
  console.log('[Time Exceptions] Showing review modal');

  const title = document.getElementById('te-review-title');
  const meta = document.getElementById('te-review-meta');
  const flagsEl = document.getElementById('te-review-flags');
  const startInput = document.getElementById('te-review-start');
  const endInput = document.getElementById('te-review-end');
  const projectSelect = document.getElementById('te-review-project');
  const actorInput = document.getElementById('te-review-actor');
  const actionSelect = document.getElementById('te-review-action');
  const noteInput = document.getElementById('te-review-note');
  const origStart = document.getElementById('te-review-orig-start');
  const origEnd = document.getElementById('te-review-orig-end');
  const origProject = document.getElementById('te-review-orig-project');

  if (title) {
    title.textContent = `Review: ${rec.employee_name || 'Employee'} (${rec.source})`;
  }

  if (meta) {
    meta.textContent = `${rec.project_name || '(No project)'} • ${rec.category || ''}`;
  }

  if (flagsEl) {
    const flagsStr = Array.isArray(rec.flags) ? rec.flags.join(', ') : '';
    flagsEl.textContent = flagsStr || 'No flags';
  }

  // Original values display
  const { startIso: originalStartIso, endIso: originalEndIso } =
    getTimeExceptionOriginalRange(rec);
  if (origStart) origStart.textContent = originalStartIso ? new Date(originalStartIso).toLocaleString() : '—';
  if (origEnd) origEnd.textContent = originalEndIso ? new Date(originalEndIso).toLocaleString() : '—';
  if (origProject) origProject.textContent = rec.project_name || '(No project)';

  // New fields start blank; only entered values will be applied
  if (startInput) {
    startInput.value = '';
  }

  if (endInput) {
    endInput.value = '';
  }

  // Project dropdown (blank by default)
  populateTimeExceptionProjectSelect('');

  if (actorInput) {
    const empCtx =
      typeof CURRENT_EMPLOYEE !== 'undefined' ? CURRENT_EMPLOYEE : null;
    const userCtx = typeof CURRENT_USER !== 'undefined' ? CURRENT_USER : null;
    const defaultName =
      (empCtx && (empCtx.display_name || empCtx.name)) ||
      (userCtx && userCtx.email) ||
      '';
    actorInput.value = defaultName;
  }

  if (actionSelect) {
    actionSelect.value = 'approve';
    actionSelect.dispatchEvent(new Event('change'));
  }

  if (noteInput) {
    noteInput.value = '';
  }

  const newBlock = document.getElementById('te-review-new-block');
  if (newBlock) newBlock.classList.add('hidden');

  updateReviewHoursDisplay();

  modal.dataset.source = rec.source || '';
  modal.dataset.id = rec.id ? String(rec.id) : '';

  // Debug visibility: log bounding box and, if tiny/hidden, force emergency inline style
  const rect = modal.getBoundingClientRect();
  const cs = window.getComputedStyle(modal);
  console.log('[Time Exceptions] Modal rect/visible', {
    width: rect.width,
    height: rect.height,
    display: cs.display,
    visibility: cs.visibility,
    opacity: cs.opacity,
    zIndex: cs.zIndex
  });

  // Dump first child tag to verify structure
  if (modal && modal.firstElementChild) {
    console.log('[Time Exceptions] Modal first child tag', modal.firstElementChild.tagName, 'class', modal.firstElementChild.className);
  }

  const looksHidden =
    rect.width < 10 ||
    rect.height < 10 ||
    cs.display === 'none' ||
    cs.visibility === 'hidden' ||
    Number(cs.opacity) === 0;

  if (looksHidden) {
    console.warn('[Time Exceptions] Modal looked hidden; applying emergency inline styles');
    Object.assign(modal.style, {
      display: 'flex',
      position: 'fixed',
      inset: '0',
      zIndex: '99999',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(15,23,42,0.75)',
      pointerEvents: 'auto'
    });

    const card = modal.querySelector('.modal-card');
    if (card) {
      card.style.maxWidth = '520px';
      card.style.width = '90%';
      card.style.pointerEvents = 'auto';
    }
  }
}

async function submitTimeExceptionReview() {
  const modal = document.getElementById('time-exception-review-modal');
  if (!modal) return;

  const source = modal.dataset.source;
  const id = modal.dataset.id;
  if (!source || !id) return;

  const startInput = document.getElementById('te-review-start');
  const endInput = document.getElementById('te-review-end');
  const projectSelect = document.getElementById('te-review-project');
  const actorInput = document.getElementById('te-review-actor');
  const actionSelect = document.getElementById('te-review-action');
  const noteInput = document.getElementById('te-review-note');
  const msgEl = document.getElementById('te-review-message');

  if (msgEl) {
    msgEl.textContent = '';
    msgEl.style.color = 'black';
  }

  const action = actionSelect ? actionSelect.value : 'approve';
  const note = noteInput ? noteInput.value.trim() : '';
  const actorName = actorInput ? actorInput.value.trim() : '';
  const rec = currentTimeExceptionRecord || {};

  if (action === 'approve') {
    const confirmed = window.confirm(
      'Are you sure you want to approve this exception? It will no longer appear in the Time Exceptions report.'
    );
    if (!confirmed) return;
  }

  if ((action === 'approve' || action === 'modify' || action === 'reject') && !note) {
    if (msgEl) {
      msgEl.textContent =
        'A note is required when approving, rejecting, or modifying an exception.';
      msgEl.style.color = 'red';
    }
    return;
  }

  const updates = {};
  if (action === 'modify') {
    const dayStr = getTimeExceptionBaseDay(rec);

    const startVal =
      startInput && startInput.value && dayStr
        ? `${dayStr}T${startInput.value}:00`
        : null;
    const endVal =
      endInput && endInput.value && dayStr
        ? `${dayStr}T${endInput.value}:00`
        : null;
    const projectVal = projectSelect?.value || '';
    const projectId = projectVal ? Number(projectVal) : null;

    if (source === 'punch') {
      if (startVal) updates.clock_in_ts = startVal;
      if (endVal) updates.clock_out_ts = endVal;
      if (projectVal) {
        updates.project_id = projectId;
        updates.clock_out_project_id = projectId;
      }
    } else if (source === 'time_entry') {
      if (startVal) {
        updates.start_date = startVal.slice(0, 10);
        updates.start_time = startVal.slice(11, 16);
      }
      if (endVal) {
        updates.end_date = endVal.slice(0, 10);
        updates.end_time = endVal.slice(11, 16);
      }
      if (startVal && endVal) {
        const durationHours = calculateDurationHours(startVal, endVal);
        if (durationHours != null) {
          updates.hours = durationHours;
        }
      }
      if (projectVal) {
        updates.project_id = projectId;
      }
    }
  }

  try {
    const resp = await fetchJSON(`/api/time-exceptions/${id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source,
        action,
        note,
        actor_name: actorName,
        updates
      })
    });

    if (resp && resp.ok) {
      closeTimeExceptionReviewModal();
      loadTimeExceptionsTable();
    } else if (msgEl) {
      msgEl.textContent = resp?.error || 'Failed to save review.';
      msgEl.style.color = 'red';
    }
  } catch (err) {
    console.error('Error saving review:', err);
    if (msgEl) {
      msgEl.textContent = err?.message || 'Failed to save review.';
      msgEl.style.color = 'red';
    }
  }
}

function applyTimeExceptionCategoryFilter() {
  const tbody = document.getElementById('time-exceptions-body');
  if (!tbody) return;

  const select = document.getElementById('te-ex-filter-category');
  const value = select?.value || '';
  const rows = tbody.querySelectorAll('tr');

  rows.forEach(tr => {
    if (!value) {
      // No filter → show everything
      tr.style.display = '';
      return;
    }

    const cats = (tr.dataset.categories || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    tr.style.display = cats.includes(value) ? '' : 'none';
  });
}


async function loadTimeExceptionsTable() {
  const tbody = document.getElementById('time-exceptions-body');
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="8" class="text-center text-gray-500">Loading exceptions…</td>
    </tr>
  `;

  // Remove any stale cached rows
  currentTimeExceptions = [];
  console.log('[Time Exceptions] Loading table…');

  try {
    // 🔹 Use the new filter IDs
    const start = document.getElementById('te-ex-filter-start')?.value;
    const end   = document.getElementById('te-ex-filter-end')?.value;
    const emp   = document.getElementById('te-ex-filter-employee')?.value;
    const proj  = document.getElementById('te-ex-filter-project')?.value;
    const hideResolvedEl = document.getElementById('te-ex-hide-resolved');

    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end)   params.set('end', end);
    if (emp)   params.set('employee_id', emp);
    if (proj)  params.set('project_id', proj);

    // 🔹 send hide_resolved flag to the server
    if (hideResolvedEl && hideResolvedEl.checked) {
      params.set('hide_resolved', '1');
    }

    const data = await fetchJSON(`/api/time-exceptions?${params.toString()}`);
    console.log('[Time Exceptions] Data loaded', Array.isArray(data) ? data.length : 'non-array');
    currentTimeExceptions = Array.isArray(data) ? data : [];

    if (!Array.isArray(data) || !data.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center text-gray-500">
            No exceptions found for this range.
          </td>
        </tr>
      `;
      currentTimeExceptions = [];
      return;
    }

    tbody.innerHTML = '';

    data.forEach((r, idx) => {
      const tr = document.createElement('tr');
      tr.dataset.idx = idx;
      tr.__timeException = r; // store record on row for robust click lookup

      const startStr = r.clock_in_ts
        ? new Date(r.clock_in_ts).toLocaleString()
        : '';
      const endStr = r.clock_out_ts
        ? new Date(r.clock_out_ts).toLocaleString()
        : '';

      const durationStr =
        r.duration_hours != null
          ? r.duration_hours.toFixed(2)
          : '';

      const flagsStr = Array.isArray(r.flags) ? r.flags.join(', ') : '';

      // 🔹 Classify into categories + label
      const { keys: categoryKeys, label: categoryLabel } =
        classifyTimeException(r);

      // Store raw keys for filtering later
      tr.dataset.categories = categoryKeys.join(',');

      tr.innerHTML = `
        <td>${r.id != null ? r.id : ''}</td>
        <td>${r.employee_name || ''}</td>
        <td>${r.project_name || ''}</td>
        <td>${startStr}</td>
        <td>${endStr}</td>
        <td class="text-right">${durationStr}</td>
        <td>${categoryLabel}</td>
        <td>${flagsStr}</td>
        <td>
          <button
            class="btn primary btn-xs te-review-btn"
            data-id="${r.id}"
            data-source="${r.source || ''}"
            data-index="${idx}"
            onclick="handleTimeExceptionReviewClick(event)"
          >
            Review
          </button>
          <div class="text-xs text-gray-600">
            Status: ${r.review_status || (r.resolved ? 'resolved' : 'open')}
          </div>
        </td>
      `;

      tbody.appendChild(tr);
    });

    // 🔹 Apply category filter (if user picked one)
    applyTimeExceptionCategoryFilter();
  } catch (err) {
    console.error('Error loading time exceptions:', err);
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center text-red-500">
          Error loading exceptions.
        </td>
      </tr>
    `;
  }
}




/* ───────── 5. GLOBAL EVENT WIRING & INIT ───────── */

function closeAllModals() {
  const modalPairs = [
    ['employee-edit-modal', 'employee-edit-backdrop'],
    ['vendor-edit-modal', 'vendor-edit-backdrop'],
    ['project-edit-modal', 'project-edit-backdrop'],
    ['shipment-create-modal', 'shipment-create-backdrop'],
    ['time-entries-modal', 'time-entries-backdrop'],
    ['shipment-detail-modal', 'shipment-detail-backdrop'],
    ['kiosk-modal', 'kiosk-modal-backdrop']
  ];

  modalPairs.forEach(([modalId, backdropId]) => {
    const modal = document.getElementById(modalId);
    const backdrop = document.getElementById(backdropId);
    if (modal) modal.classList.add('hidden');
    if (backdrop) backdrop.classList.add('hidden');
  });
}

/* ───────── 6. MODALS LOADER ───────── */

async function loadModalsIntoDom() {
  const container = document.getElementById('modals-root');

  try {
    const response = await fetch('modals.html', { cache: 'no-store' });
    const html = await response.text();
    container.innerHTML = html;
    console.log('[MODALS] Loaded');
  } catch (err) {
    console.error('[MODALS] Failed to load', err);
  }
}

// Ensure time exception modal elements exist (fallback if modals.html fails/cached)
async function ensureTimeExceptionModalReady() {
  // Always rebuild fresh to avoid stale/hijacked DOM/CSS
  let backdrop = document.getElementById('time-exception-review-backdrop');
  let modal = document.getElementById('time-exception-review-modal');

  if (backdrop) backdrop.remove();
  if (modal) modal.remove();

  // Build a minimal fallback overlay entirely with inline styles (ignore external CSS)
  backdrop = document.createElement('div');
  backdrop.id = 'time-exception-review-backdrop';
  Object.assign(backdrop.style, {
    position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
    background: 'rgba(0,0,0,0.45)', zIndex: '99990'
  });

  modal = document.createElement('div');
  modal.id = 'time-exception-review-modal';
  Object.assign(modal.style, {
    position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: '99999', background: 'rgba(0,0,0,0.6)',
    pointerEvents: 'auto'
  });

  const card = document.createElement('div');
  card.className = 'modal-card modal-card-wide te-review-card';

  card.innerHTML = `
    <div class="te-review-header">
      <h3 id="te-review-title">Review Time Exception</h3>
      <button id="te-review-close" class="icon-button" type="button" aria-label="Close">×</button>
    </div>
    <div class="te-review-meta">
      <p id="te-review-meta" class="text-sm text-gray-700"></p>
      <p><strong>Flags:</strong> <span id="te-review-flags"></span></p>
    </div>
    <div class="te-review-original">
      <h4>Original</h4>
      <div class="te-review-row"><span class="label">Start</span><span id="te-review-orig-start"></span></div>
      <div class="te-review-row"><span class="label">End</span><span id="te-review-orig-end"></span></div>
      <div class="te-review-row"><span class="label">Hours</span><span id="te-review-orig-hours"></span></div>
      <div class="te-review-row"><span class="label">Project</span><span id="te-review-orig-project"></span></div>
    </div>
    <div class="te-review-grid-two form-grid">
      <div class="form-field">
        <label for="te-review-actor">Reviewer</label>
        <input type="text" id="te-review-actor" placeholder="Your name" />
      </div>
      <div class="form-field">
        <label for="te-review-action">Action</label>
        <select id="te-review-action">
          <option value="approve">Approve</option>
          <option value="modify">Modify</option>
          <option value="reject">Reject</option>
        </select>
      </div>
    </div>
    <div id="te-review-new-block" class="te-review-new-block hidden">
      <div class="te-review-grid-three form-grid">
        <div class="form-field">
          <label for="te-review-start">Start time (new)</label>
          <input type="time" id="te-review-start" />
        </div>
        <div class="form-field">
          <label for="te-review-end">End time (new)</label>
          <input type="time" id="te-review-end" />
        </div>
        <div class="form-field">
          <label for="te-review-project">Project (new)</label>
          <select id="te-review-project"></select>
        </div>
      </div>
      <div class="form-field">
        <label for="te-review-hours">New hours (auto)</label>
        <input type="number" id="te-review-hours" step="0.01" min="0" readonly />
        <p class="text-sm text-gray-600">Calculated from start and end times.</p>
      </div>
    </div>
    <div class="form-field te-review-notes">
      <label for="te-review-note">Notes</label>
      <textarea id="te-review-note" rows="3" placeholder="Required when approving, rejecting, or modifying"></textarea>
      <p id="te-review-note-help" class="text-sm text-gray-600 hidden">Required when approving, rejecting, or modifying an exception.</p>
    </div>
    <p id="te-review-message" class="message"></p>
    <div class="te-review-actions">
      <button id="te-review-cancel" type="button" class="btn secondary">Cancel</button>
      <button id="te-review-save" type="button" class="btn primary">Save</button>
    </div>
  `;

  modal.appendChild(card);
  document.body.appendChild(backdrop);
  document.body.appendChild(modal);

  bindTimeExceptionModalListeners();

  return { backdrop, modal };
}

function bindTimeExceptionModalListeners() {
  const reviewClose = document.getElementById('te-review-close');
  const reviewCancel = document.getElementById('te-review-cancel');
  const reviewSave = document.getElementById('te-review-save');
  const reviewBackdrop = document.getElementById('time-exception-review-backdrop');
  const reviewAction = document.getElementById('te-review-action');

  if (reviewClose && !reviewClose.dataset.bound) {
    reviewClose.dataset.bound = '1';
    reviewClose.addEventListener('click', closeTimeExceptionReviewModal);
  }
  if (reviewCancel && !reviewCancel.dataset.bound) {
    reviewCancel.dataset.bound = '1';
    reviewCancel.addEventListener('click', closeTimeExceptionReviewModal);
  }
  if (reviewBackdrop && !reviewBackdrop.dataset.bound) {
    reviewBackdrop.dataset.bound = '1';
    reviewBackdrop.addEventListener('click', closeTimeExceptionReviewModal);
  }
  if (reviewSave && !reviewSave.dataset.bound) {
    reviewSave.dataset.bound = '1';
    reviewSave.addEventListener('click', submitTimeExceptionReview);
  }
  if (reviewAction && !reviewAction.dataset.bound) {
    reviewAction.dataset.bound = '1';
    reviewAction.addEventListener('change', handleTimeExceptionActionChange);
  }
  bindReviewTimeInputs();
}

/* ───────── 7. DOMContentLoaded INIT ───────── */

// ───────── PAYROLL TAB LAZY INIT ─────────

function initPayrollTabIfNeeded() {
  if (payrollTabInitialized) return;
  payrollTabInitialized = true;

  console.log('[PAYROLL] Initializing payroll tab data');

  // 1) Time entries → today's entries by default
  if (typeof loadTimeEntriesTable === 'function') {
    loadTimeEntriesTable({});  // no filters = "Today's Entries"
  }

  // 2) Live open punches
  if (typeof loadOpenPunches === 'function') {
    loadOpenPunches();
  }

  // 3) Time Exceptions
  initTimeExceptionsIfNeeded();

  // Also initialize the dedicated payroll UI (settings/summary) if present.
  if (typeof window.initPayrollUiTab === 'function') {
    window.initPayrollUiTab();
  }
}

function initTimeExceptionsIfNeeded() {
  if (timeExceptionsInitialized) return;
  timeExceptionsInitialized = true;

  if (typeof setupTimeExceptionsSection === 'function') {
    setupTimeExceptionsSection();
  }
}


document.addEventListener('DOMContentLoaded', async () => {
  // 1) Load modals into the DOM
  await loadModalsIntoDom();

  // 2) Make sure no modals/backdrops start stuck open
  if (typeof closeAllModals === 'function') {
    closeAllModals();
  }

  // 3) Sidebar navigation
  if (typeof setupSidebarNavigation === 'function') {
    setupSidebarNavigation();
  }

  // Ensure Time Exceptions wiring is ready even if user opens that tab first
  initTimeExceptionsIfNeeded();

  // 4) Shipments verification report wiring
  if (typeof initShipmentsReportUI === 'function') {
    initShipmentsReportUI();
  }

    // 3b) Make QB card match the initially active tab (Employees on first load)
  const activeNav = document.querySelector('.nav-item.active');
  if (activeNav && typeof updateQbCardForSection === 'function') {
    updateQbCardForSection(activeNav.dataset.section);
  }

// 4) QuickBooks connection status
  if (typeof checkStatus === 'function') {
    checkStatus();
  }

  // 4a) Fire background payroll account sync so dropdowns are ready when opened
  backgroundSyncPayrollAccounts().catch(() => {});

// 4b) Load core master data from our own DB so tables/dropdowns are ready
if (typeof loadEmployeesTable === 'function') {
  loadEmployeesTable();
}
if (typeof loadVendorsTable === 'function') {
  loadVendorsTable();
}
if (typeof loadProjectsTable === 'function') {
  loadProjectsTable();
}

// Preload dropdowns for time entries (even before you open the manual entry card)
if (typeof loadEmployeesForSelect === 'function') {
  loadEmployeesForSelect();
}
if (typeof loadProjectsForTimeEntries === 'function') {
  loadProjectsForTimeEntries();
}

// 5) QUICKBOOKS CONNECT (FULL PAGE REDIRECT — NO POPUP)
const connectBtn = document.getElementById('connect');
if (connectBtn) {
  connectBtn.addEventListener('click', () => {
    window.location.href = '/auth/qbo';
  });
}

  // ───────── Vendor PIN modal: auto-enter edit mode ─────────
  const vendorPinInput = document.getElementById('edit-vendor-pin');
  const vendorPinConfirmInput = document.getElementById('edit-vendor-pin-confirm');
  const vendorForwarderCheckbox = document.getElementById('edit-vendor-is-freight-forwarder');

  if (vendorPinInput) {
    vendorPinInput.addEventListener('focus', () => {
      if (!vendorPinEditMode) enterVendorPinEditMode();
    });
  }
  if (vendorPinConfirmInput) {
    vendorPinConfirmInput.addEventListener('focus', () => {
      if (!vendorPinEditMode) enterVendorPinEditMode();
    });
  }
  if (vendorForwarderCheckbox) {
    vendorForwarderCheckbox.addEventListener('change', () => {
      if (!vendorPinEditMode) enterVendorPinEditMode();
    });
  }

  // ───────── Projects: edit modal buttons ─────────
  const projClose    = document.getElementById('project-edit-close');
  const projCancel   = document.getElementById('project-edit-cancel');
  const projSave     = document.getElementById('project-edit-save');
  const projBackdrop = document.getElementById('project-edit-backdrop');

  if (projClose)  projClose.addEventListener('click', closeProjectEditModal);
  if (projCancel) projCancel.addEventListener('click', closeProjectEditModal);
  if (projSave)   projSave.addEventListener('click', saveProjectFromModal);
  if (projBackdrop) {
    projBackdrop.addEventListener('click', (e) => {
      if (e.target === projBackdrop) closeProjectEditModal();
    });
  }

  // ───────── Settings page: load/save placeholders ─────────
  const settingsSaveBtn = document.getElementById('settings-save');
  const settingsStatus  = document.getElementById('settings-status');
  const settingsFields = {
    company_name: document.getElementById('settings-company-name'),
    company_email: document.getElementById('settings-company-email'),
    storage_daily_late_fee_default: document.getElementById('settings-storage-daily-fee'),
    clock_in_photo_required: document.getElementById('settings-clock-in-photo-required')
  };
  const payrollRuleFields = {
    pay_period_length_days: document.getElementById('settings-pay-period-length'),
    pay_period_start_weekday: document.getElementById('settings-pay-period-weekday'),
    pay_period_anchor_date: document.getElementById('settings-pay-period-anchor'),
    overtime_enabled: document.getElementById('settings-overtime-enabled'),
    overtime_daily_threshold_hours: document.getElementById('settings-overtime-daily-threshold'),
    overtime_weekly_threshold_hours: document.getElementById('settings-overtime-weekly-threshold'),
    overtime_multiplier: document.getElementById('settings-overtime-multiplier'),
    double_time_enabled: document.getElementById('settings-doubletime-enabled'),
    double_time_daily_threshold_hours: document.getElementById('settings-doubletime-daily-threshold'),
    double_time_multiplier: document.getElementById('settings-doubletime-multiplier')
  };
  const exceptionRuleCheckboxes = Array.from(
    document.querySelectorAll('[data-exception-rule]')
  );
  const exceptionRuleFields = {
    weekly_hours_threshold: document.getElementById('settings-weekly-hours-threshold'),
    auto_clockout_daily_max_hours: document.getElementById('settings-auto-clockout-daily-max'),
    auto_clockout_weekly_max_hours: document.getElementById('settings-auto-clockout-weekly-max')
  };
  const passwordFields = {
    current: document.getElementById('settings-password-current'),
    next: document.getElementById('settings-password-new'),
    confirm: document.getElementById('settings-password-confirm')
  };
  const passwordSaveBtn = document.getElementById('settings-password-save');
  const passwordStatus = document.getElementById('settings-password-status');
  const backupCard = document.getElementById('settings-backup-card');
  const backupBtn = document.getElementById('settings-backup-now');
  const backupStatus = document.getElementById('settings-backup-status');
  const adminUsersCard = document.getElementById('settings-admin-users-card');
  const adminUsersBody = document.getElementById('settings-admin-users-body');
  const adminUserEmployee = document.getElementById('settings-admin-user-employee');
  const adminUserEmail = document.getElementById('settings-admin-user-email');
  const adminUserPassword = document.getElementById('settings-admin-user-password');
  const adminUserPasswordConfirm = document.getElementById('settings-admin-user-password-confirm');
  const adminUserCreateBtn = document.getElementById('settings-admin-user-create');
  const adminUserStatus = document.getElementById('settings-admin-user-status');
  const roleTemplatesCard = document.getElementById('settings-role-templates-card');
  const roleTemplatesBody = document.getElementById('settings-role-templates-body');
  const templateNameInput = document.getElementById('settings-template-name');
  const templateRoleTitleInput = document.getElementById('settings-template-role-title');
  const templateAccessWorker = document.getElementById('settings-template-worker-timekeeping');
  const templateAccessDesktop = document.getElementById('settings-template-desktop-access');
  const templateAccessKiosk = document.getElementById('settings-template-kiosk-admin-access');
  const templatePermSeeShipments = document.getElementById('settings-template-perm-see-shipments');
  const templatePermModifyTime = document.getElementById('settings-template-perm-modify-time');
  const templatePermViewTime = document.getElementById('settings-template-perm-view-time-reports');
  const templatePermViewPayroll = document.getElementById('settings-template-perm-view-payroll');
  const templatePermModifyPayroll = document.getElementById('settings-template-perm-modify-payroll');
  const templatePermModifyRates = document.getElementById('settings-template-perm-modify-pay-rates');
  const templateSaveBtn = document.getElementById('settings-template-save');
  const templateClearBtn = document.getElementById('settings-template-clear');
  const templateDeleteBtn = document.getElementById('settings-template-delete');
  const templateStatus = document.getElementById('settings-template-status');
  let editingTemplateId = null;
  let permissionTemplates = [];

  function setPasswordStatus(text, color) {
    if (!passwordStatus) return;
    passwordStatus.textContent = text || '';
    passwordStatus.style.color = color || '';
  }

  function setBackupStatus(text, color) {
    if (!backupStatus) return;
    backupStatus.textContent = text || '';
    backupStatus.style.color = color || '';
  }

  function setAdminUserStatus(text, color) {
    if (!adminUserStatus) return;
    adminUserStatus.textContent = text || '';
    adminUserStatus.style.color = color || '';
  }

  function applyBackupCardVisibility() {
    if (!backupCard) return;
    if (window.CURRENT_IS_SUPER_ADMIN) {
      backupCard.classList.remove('hidden');
    } else {
      backupCard.classList.add('hidden');
    }
  }

  function applyAdminUsersVisibility() {
    if (!adminUsersCard) return;
    if (window.CURRENT_IS_SUPER_ADMIN) {
      adminUsersCard.classList.remove('hidden');
    } else {
      adminUsersCard.classList.add('hidden');
    }
  }

  function applyRoleTemplatesVisibility() {
    if (!roleTemplatesCard) return;
    if (window.CURRENT_IS_SUPER_ADMIN) {
      roleTemplatesCard.classList.remove('hidden');
    } else {
      roleTemplatesCard.classList.add('hidden');
    }
  }

  function setTemplateStatus(text, color) {
    if (!templateStatus) return;
    templateStatus.textContent = text || '';
    templateStatus.style.color = color || '';
  }

  function clearTemplateForm() {
    editingTemplateId = null;
    if (templateNameInput) templateNameInput.value = '';
    if (templateRoleTitleInput) templateRoleTitleInput.value = '';
    if (templateAccessWorker) templateAccessWorker.checked = false;
    if (templateAccessDesktop) templateAccessDesktop.checked = false;
    if (templateAccessKiosk) templateAccessKiosk.checked = false;
    if (templatePermSeeShipments) templatePermSeeShipments.checked = false;
    if (templatePermModifyTime) templatePermModifyTime.checked = false;
    if (templatePermViewTime) templatePermViewTime.checked = false;
    if (templatePermViewPayroll) templatePermViewPayroll.checked = false;
    if (templatePermModifyPayroll) templatePermModifyPayroll.checked = false;
    if (templatePermModifyRates) templatePermModifyRates.checked = false;
    if (templateDeleteBtn) templateDeleteBtn.disabled = true;
    if (templateSaveBtn) templateSaveBtn.textContent = 'Save template';
  }

  function collectTemplatePayload() {
    const name = templateNameInput ? templateNameInput.value.trim() : '';
    if (!name) {
      throw new Error('Template name is required.');
    }
    return {
      name,
      role_title: templateRoleTitleInput ? templateRoleTitleInput.value.trim() || null : null,
      access: {
        worker_timekeeping: !!templateAccessWorker?.checked,
        desktop_access: !!templateAccessDesktop?.checked,
        kiosk_admin_access: !!templateAccessKiosk?.checked
      },
      permissions: {
        see_shipments: !!templatePermSeeShipments?.checked,
        modify_time: !!templatePermModifyTime?.checked,
        view_time_reports: !!templatePermViewTime?.checked,
        view_payroll: !!templatePermViewPayroll?.checked,
        modify_payroll: !!templatePermModifyPayroll?.checked,
        modify_pay_rates: !!templatePermModifyRates?.checked
      }
    };
  }

  function renderRoleTemplates(templates = []) {
    if (!roleTemplatesBody) return;
    if (!templates.length) {
      roleTemplatesBody.innerHTML = '<tr><td colspan="3">(no templates yet)</td></tr>';
      return;
    }
    roleTemplatesBody.innerHTML = '';
    templates.forEach(template => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${template.name || ''}</td>
        <td>${template.role_title || '—'}</td>
        <td>
          <button class="btn secondary btn-sm" data-template-action="edit" data-template-id="${template.id}">Edit</button>
          <button class="btn danger btn-sm" data-template-action="delete" data-template-id="${template.id}">Delete</button>
        </td>
      `;
      roleTemplatesBody.appendChild(tr);
    });
  }

  async function loadRoleTemplates({ force = false } = {}) {
    if (!window.CURRENT_IS_SUPER_ADMIN) return;
    if (!force && permissionTemplates.length) {
      renderRoleTemplates(permissionTemplates);
      return;
    }
    try {
      const res = await fetchJSON('/api/permission-templates');
      permissionTemplates = (res && res.templates) || [];
      renderRoleTemplates(permissionTemplates);
    } catch (err) {
      console.error('Error loading templates', err);
      if (roleTemplatesBody) {
        roleTemplatesBody.innerHTML = '<tr><td colspan="3">(error loading templates)</td></tr>';
      }
    }
  }

  function fillTemplateForm(template) {
    if (!template) return;
    editingTemplateId = template.id;
    if (templateNameInput) templateNameInput.value = template.name || '';
    if (templateRoleTitleInput) templateRoleTitleInput.value = template.role_title || '';
    if (templateAccessWorker) templateAccessWorker.checked = !!template.access?.worker_timekeeping;
    if (templateAccessDesktop) templateAccessDesktop.checked = !!template.access?.desktop_access;
    if (templateAccessKiosk) templateAccessKiosk.checked = !!template.access?.kiosk_admin_access;
    if (templatePermSeeShipments) templatePermSeeShipments.checked = !!template.permissions?.see_shipments;
    if (templatePermModifyTime) templatePermModifyTime.checked = !!template.permissions?.modify_time;
    if (templatePermViewTime) templatePermViewTime.checked = !!template.permissions?.view_time_reports;
    if (templatePermViewPayroll) templatePermViewPayroll.checked = !!template.permissions?.view_payroll;
    if (templatePermModifyPayroll) templatePermModifyPayroll.checked = !!template.permissions?.modify_payroll;
    if (templatePermModifyRates) templatePermModifyRates.checked = !!template.permissions?.modify_pay_rates;
    if (templateDeleteBtn) templateDeleteBtn.disabled = false;
    if (templateSaveBtn) templateSaveBtn.textContent = 'Update template';
  }

  function getAdminUserStatus(user) {
    const enabled =
      user.login_enabled === true ||
      user.login_enabled === 1 ||
      user.login_enabled === '1';
    const employeeActive = !!user.employee_active;
    const desktopAccess = !!user.desktop_access;
    if (!enabled) return 'Disabled';
    if (!user.is_super_admin) return 'Blocked (not super admin)';
    if (!employeeActive) return 'Blocked (inactive employee)';
    if (!desktopAccess) return 'Blocked (no desktop access)';
    return 'Enabled';
  }

  function renderAdminUsers(users = []) {
    if (!adminUsersBody) return;
    if (!users.length) {
      adminUsersBody.innerHTML = '<tr><td colspan="4">(no admin accounts yet)</td></tr>';
      return;
    }
    adminUsersBody.innerHTML = '';
    users.forEach(user => {
      const isSelf = Number(window.CURRENT_USER?.id) === Number(user.user_id);
      const enabled =
        user.login_enabled === true ||
        user.login_enabled === 1 ||
        user.login_enabled === '1';
      const canEnable = !!user.employee_active && !!user.desktop_access;
      const tr = document.createElement('tr');

      const emailCell = document.createElement('td');
      const emailText = user.email || '';
      emailCell.textContent = isSelf && emailText ? `${emailText} (you)` : emailText;

      const employeeCell = document.createElement('td');
      employeeCell.textContent = user.employee_name || '—';

      const statusCell = document.createElement('td');
      statusCell.textContent = getAdminUserStatus(user);

      const actionsCell = document.createElement('td');
      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'btn secondary btn-sm';
      resetBtn.textContent = 'Reset password';
      resetBtn.dataset.userId = user.user_id;
      resetBtn.dataset.userEmail = emailText;
      resetBtn.dataset.userAction = 'reset';

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'btn secondary btn-sm';
      toggleBtn.dataset.userId = user.user_id;
      toggleBtn.dataset.userEmail = emailText;
      toggleBtn.dataset.userAction = enabled ? 'disable' : 'enable';
      toggleBtn.textContent = enabled ? 'Disable login' : 'Enable login';
      if (!enabled && !canEnable) {
        toggleBtn.disabled = true;
        toggleBtn.title = 'Employee must be active with desktop access to enable login.';
      }

      actionsCell.appendChild(resetBtn);
      actionsCell.appendChild(document.createTextNode(' '));
      actionsCell.appendChild(toggleBtn);

      tr.appendChild(emailCell);
      tr.appendChild(employeeCell);
      tr.appendChild(statusCell);
      tr.appendChild(actionsCell);
      adminUsersBody.appendChild(tr);
    });
  }

  async function loadAdminUsers() {
    if (!adminUsersBody || !window.CURRENT_IS_SUPER_ADMIN) return;
    try {
      const data = await fetchJSON('/api/auth/users');
      renderAdminUsers((data && data.users) || []);
    } catch (err) {
      console.error('Error loading admin accounts', err);
      adminUsersBody.innerHTML = '<tr><td colspan="4">(error loading accounts)</td></tr>';
    }
  }

  async function handleAdminUserAction(event) {
    if (!adminUsersBody) return;
    const button = event.target.closest('button[data-user-action]');
    if (!button) return;
    if (button.disabled) return;

    const action = button.dataset.userAction;
    const userId = Number(button.dataset.userId);
    const userEmail = button.dataset.userEmail || 'this user';

    if (!userId || !action) return;

    const originalText = button.textContent || '';
    button.disabled = true;

    try {
      if (action === 'reset') {
        const next = window.prompt(
          `Enter a new password for ${userEmail} (min 8 characters):`,
          ''
        );
        if (next === null) return;
        const confirm = window.prompt(`Confirm the new password for ${userEmail}:`, '');
        if (confirm === null) return;
        if (next !== confirm) {
          setAdminUserStatus('Passwords do not match.', 'crimson');
          return;
        }
        if (next.length < 8) {
          setAdminUserStatus('Password must be at least 8 characters.', '#b45309');
          return;
        }
        await fetchJSON(`/api/auth/users/${userId}/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ new_password: next })
        });
        setAdminUserStatus(`Password reset for ${userEmail}.`, 'green');
      } else if (action === 'disable') {
        const ok = window.confirm(
          `Disable login for ${userEmail}? They will no longer be able to sign in.`
        );
        if (!ok) return;
        await fetchJSON(`/api/auth/users/${userId}/disable`, { method: 'POST' });
        setAdminUserStatus(`Login disabled for ${userEmail}.`, 'green');
        await loadAdminUsers();
      } else if (action === 'enable') {
        const ok = window.confirm(
          `Enable login for ${userEmail}? This grants super admin sign-in access.`
        );
        if (!ok) return;
        await fetchJSON(`/api/auth/users/${userId}/enable`, { method: 'POST' });
        setAdminUserStatus(`Login enabled for ${userEmail}.`, 'green');
        await loadAdminUsers();
      }
    } catch (err) {
      console.error('Admin user action error:', err);
      setAdminUserStatus(err?.message || 'Action failed.', 'crimson');
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  if (adminUsersBody) {
    adminUsersBody.addEventListener('click', handleAdminUserAction);
  }

  if (roleTemplatesBody) {
    roleTemplatesBody.addEventListener('click', async event => {
      const btn = event.target.closest('button[data-template-action]');
      if (!btn) return;
      const action = btn.dataset.templateAction;
      const id = Number(btn.dataset.templateId);
      if (!id) return;

      const template = permissionTemplates.find(t => Number(t.id) === id);
      if (!template) {
        setTemplateStatus('Template not found.', 'crimson');
        return;
      }

      if (action === 'edit') {
        fillTemplateForm(template);
        setTemplateStatus(`Editing ${template.name}.`, '#111827');
        return;
      }

      if (action === 'delete') {
        const ok = window.confirm(`Delete template "${template.name}"?`);
        if (!ok) return;
        try {
          await fetchJSON(`/api/permission-templates/${id}`, { method: 'DELETE' });
          setTemplateStatus(`Deleted ${template.name}.`, 'green');
          clearTemplateForm();
          await loadRoleTemplates({ force: true });
          if (typeof window.reloadPermissionTemplates === 'function') {
            await window.reloadPermissionTemplates({ force: true });
          }
        } catch (err) {
          console.error('Delete template error', err);
          setTemplateStatus(err?.message || 'Failed to delete template.', 'crimson');
        }
      }
    });
  }

  if (templateSaveBtn) {
    templateSaveBtn.addEventListener('click', async () => {
      try {
        const payload = collectTemplatePayload();
        if (editingTemplateId) {
          await fetchJSON(`/api/permission-templates/${editingTemplateId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          setTemplateStatus('Template updated.', 'green');
        } else {
          await fetchJSON('/api/permission-templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          setTemplateStatus('Template created.', 'green');
        }
        clearTemplateForm();
        await loadRoleTemplates({ force: true });
        if (typeof window.reloadPermissionTemplates === 'function') {
          await window.reloadPermissionTemplates({ force: true });
        }
      } catch (err) {
        console.error('Save template error', err);
        setTemplateStatus(err?.message || 'Failed to save template.', 'crimson');
      }
    });
  }

  if (templateClearBtn) {
    templateClearBtn.addEventListener('click', () => {
      clearTemplateForm();
      setTemplateStatus('', '');
    });
  }

  if (templateDeleteBtn) {
    templateDeleteBtn.addEventListener('click', async () => {
      if (!editingTemplateId) return;
      const current = permissionTemplates.find(t => Number(t.id) === Number(editingTemplateId));
      const label = current ? current.name : 'this template';
      const ok = window.confirm(`Delete ${label}?`);
      if (!ok) return;
      try {
        await fetchJSON(`/api/permission-templates/${editingTemplateId}`, { method: 'DELETE' });
        setTemplateStatus('Template deleted.', 'green');
        clearTemplateForm();
        await loadRoleTemplates({ force: true });
        if (typeof window.reloadPermissionTemplates === 'function') {
          await window.reloadPermissionTemplates({ force: true });
        }
      } catch (err) {
        console.error('Delete template error', err);
        setTemplateStatus(err?.message || 'Failed to delete template.', 'crimson');
      }
    });
  }

  async function loadAdminUserEmployees() {
    if (!adminUserEmployee || !window.CURRENT_IS_SUPER_ADMIN) return;
    adminUserEmployee.innerHTML = '<option value="">Select employee</option>';
    try {
      const list = await fetchJSON('/api/employees?status=active');
      const eligible = (list || []).filter(emp => emp && emp.desktop_access);
      eligible.forEach(emp => {
        const option = document.createElement('option');
        option.value = emp.id;
        option.textContent = `${emp.name || '(Unnamed)'}${emp.email ? ` — ${emp.email}` : ''}`;
        adminUserEmployee.appendChild(option);
      });
    } catch (err) {
      console.error('Error loading employee list for admin accounts', err);
    }
  }

  function clearPasswordInputs() {
    if (passwordFields.current) passwordFields.current.value = '';
    if (passwordFields.next) passwordFields.next.value = '';
    if (passwordFields.confirm) passwordFields.confirm.value = '';
  }

  function deriveCurrentAdminAccess(perms = {}) {
    const fallbackModifyPayroll =
      typeof perms.modify_payroll === 'undefined'
        ? (perms.view_payroll === true || perms.view_payroll === 'true')
        : (perms.modify_payroll === true || perms.modify_payroll === 'true');
    return {
      modify_pay_rates: perms.modify_pay_rates === true || perms.modify_pay_rates === 'true',
      modify_payroll: fallbackModifyPayroll,
      view_payroll: perms.view_payroll === true || perms.view_payroll === 'true'
    };
  }

  const asBool = (val, fallback = false) => {
    if (val === undefined || val === null) return fallback;
    return val === true || val === 'true' || val === 1 || val === '1';
  };

  function applyExceptionRulesToUI(rawValue) {
    if (!exceptionRuleCheckboxes.length) return;
    let parsed = null;
    if (typeof rawValue === 'string') {
      try {
        parsed = JSON.parse(rawValue);
      } catch {
        parsed = null;
      }
    } else if (rawValue && typeof rawValue === 'object') {
      parsed = rawValue;
    }

    exceptionRuleCheckboxes.forEach(cb => {
      const key = cb.dataset.exceptionRule;
      if (!key) return;
      const defaultState = cb.defaultChecked || true;
      const enabled =
        parsed && Object.prototype.hasOwnProperty.call(parsed, key)
          ? asBool(parsed[key], defaultState)
          : defaultState;
      cb.checked = enabled;
    });

    const normalizeThreshold = value => {
      const num = Number(value);
      return Number.isFinite(num) && num > 0 ? num : '';
    };

    if (exceptionRuleFields.weekly_hours_threshold) {
      const raw =
        parsed && Object.prototype.hasOwnProperty.call(parsed, 'weekly_hours_threshold')
          ? parsed.weekly_hours_threshold
          : '';
      exceptionRuleFields.weekly_hours_threshold.value = normalizeThreshold(raw);
    }

    if (exceptionRuleFields.auto_clockout_daily_max_hours) {
      const raw =
        parsed && Object.prototype.hasOwnProperty.call(parsed, 'auto_clockout_daily_max_hours')
          ? parsed.auto_clockout_daily_max_hours
          : '';
      exceptionRuleFields.auto_clockout_daily_max_hours.value = normalizeThreshold(raw);
    }

    if (exceptionRuleFields.auto_clockout_weekly_max_hours) {
      const raw =
        parsed && Object.prototype.hasOwnProperty.call(parsed, 'auto_clockout_weekly_max_hours')
          ? parsed.auto_clockout_weekly_max_hours
          : '';
      exceptionRuleFields.auto_clockout_weekly_max_hours.value = normalizeThreshold(raw);
    }
  }

  function collectExceptionRuleSettings() {
    const map = {};
    exceptionRuleCheckboxes.forEach(cb => {
      const key = cb.dataset.exceptionRule;
      if (!key) return;
      map[key] = !!cb.checked;
    });

    const normalizeThreshold = field => {
      if (!field) return null;
      const raw = String(field.value || '').trim();
      if (!raw) return null;
      const num = Number(raw);
      return Number.isFinite(num) && num > 0 ? num : null;
    };

    map.weekly_hours_threshold = normalizeThreshold(
      exceptionRuleFields.weekly_hours_threshold
    );
    map.auto_clockout_daily_max_hours = normalizeThreshold(
      exceptionRuleFields.auto_clockout_daily_max_hours
    );
    map.auto_clockout_weekly_max_hours = normalizeThreshold(
      exceptionRuleFields.auto_clockout_weekly_max_hours
    );
    return map;
  }

  function normalizePayrollRuleNumber(value, fallback) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function applyPayrollRulesToUI(rawValue) {
    if (!payrollRuleFields.pay_period_length_days) return;
    let parsed = null;
    if (typeof rawValue === 'string') {
      try {
        parsed = JSON.parse(rawValue);
      } catch {
        parsed = null;
      }
    } else if (rawValue && typeof rawValue === 'object') {
      parsed = rawValue;
    }

    const defaults = {
      pay_period_length_days: 7,
      pay_period_start_weekday: 1,
      pay_period_anchor_date: '',
      overtime_enabled: false,
      overtime_daily_threshold_hours: 8,
      overtime_weekly_threshold_hours: 40,
      overtime_multiplier: 1.5,
      double_time_enabled: false,
      double_time_daily_threshold_hours: 12,
      double_time_multiplier: 2.0
    };

    const resolved = {
      pay_period_length_days: normalizePayrollRuleNumber(
        parsed?.pay_period_length_days,
        defaults.pay_period_length_days
      ),
      pay_period_start_weekday: normalizePayrollRuleNumber(
        parsed?.pay_period_start_weekday,
        defaults.pay_period_start_weekday
      ),
      pay_period_anchor_date: parsed?.pay_period_anchor_date || defaults.pay_period_anchor_date,
      overtime_enabled: asBool(parsed?.overtime_enabled, defaults.overtime_enabled),
      overtime_daily_threshold_hours: normalizePayrollRuleNumber(
        parsed?.overtime_daily_threshold_hours,
        defaults.overtime_daily_threshold_hours
      ),
      overtime_weekly_threshold_hours: normalizePayrollRuleNumber(
        parsed?.overtime_weekly_threshold_hours,
        defaults.overtime_weekly_threshold_hours
      ),
      overtime_multiplier: normalizePayrollRuleNumber(
        parsed?.overtime_multiplier,
        defaults.overtime_multiplier
      ),
      double_time_enabled: asBool(parsed?.double_time_enabled, defaults.double_time_enabled),
      double_time_daily_threshold_hours: normalizePayrollRuleNumber(
        parsed?.double_time_daily_threshold_hours,
        defaults.double_time_daily_threshold_hours
      ),
      double_time_multiplier: normalizePayrollRuleNumber(
        parsed?.double_time_multiplier,
        defaults.double_time_multiplier
      )
    };

    payrollRuleFields.pay_period_length_days.value = resolved.pay_period_length_days;
    payrollRuleFields.pay_period_start_weekday.value = resolved.pay_period_start_weekday;
    payrollRuleFields.pay_period_anchor_date.value = resolved.pay_period_anchor_date || '';
    payrollRuleFields.overtime_enabled.checked = resolved.overtime_enabled;
    payrollRuleFields.overtime_daily_threshold_hours.value = resolved.overtime_daily_threshold_hours;
    payrollRuleFields.overtime_weekly_threshold_hours.value = resolved.overtime_weekly_threshold_hours;
    payrollRuleFields.overtime_multiplier.value = resolved.overtime_multiplier;
    payrollRuleFields.double_time_enabled.checked = resolved.double_time_enabled;
    payrollRuleFields.double_time_daily_threshold_hours.value = resolved.double_time_daily_threshold_hours;
    payrollRuleFields.double_time_multiplier.value = resolved.double_time_multiplier;

    updatePayrollRulesUIState();

    window.CURRENT_PAYROLL_RULES = { ...resolved };
  }

  function updatePayrollRulesUIState() {
    const lengthVal = Number(payrollRuleFields.pay_period_length_days?.value || 7);
    const usesAnchor = lengthVal > 7;
    if (payrollRuleFields.pay_period_anchor_date) {
      payrollRuleFields.pay_period_anchor_date.disabled = !usesAnchor;
    }
    const overtimeOn = payrollRuleFields.overtime_enabled?.checked;
    ['overtime_daily_threshold_hours', 'overtime_weekly_threshold_hours', 'overtime_multiplier'].forEach(key => {
      if (payrollRuleFields[key]) payrollRuleFields[key].disabled = !overtimeOn;
    });
    const doubleOn = payrollRuleFields.double_time_enabled?.checked;
    ['double_time_daily_threshold_hours', 'double_time_multiplier'].forEach(key => {
      if (payrollRuleFields[key]) payrollRuleFields[key].disabled = !doubleOn;
    });
  }

  function collectPayrollRulesSettings() {
    if (!payrollRuleFields.pay_period_length_days) return null;
    const lengthDays = Math.floor(
      normalizePayrollRuleNumber(payrollRuleFields.pay_period_length_days.value, 7)
    );
    const safeLength = lengthDays >= 1 && lengthDays <= 31 ? lengthDays : 7;
    const startWeekday = Math.floor(
      normalizePayrollRuleNumber(payrollRuleFields.pay_period_start_weekday.value, 1)
    );
    const safeWeekday = startWeekday >= 0 && startWeekday <= 6 ? startWeekday : 1;
    const anchorDate = (payrollRuleFields.pay_period_anchor_date.value || '').trim() || null;

    return {
      pay_period_length_days: safeLength,
      pay_period_start_weekday: safeWeekday,
      pay_period_anchor_date: anchorDate,
      overtime_enabled: !!payrollRuleFields.overtime_enabled?.checked,
      overtime_daily_threshold_hours: normalizePayrollRuleNumber(
        payrollRuleFields.overtime_daily_threshold_hours?.value,
        8
      ),
      overtime_weekly_threshold_hours: normalizePayrollRuleNumber(
        payrollRuleFields.overtime_weekly_threshold_hours?.value,
        40
      ),
      overtime_multiplier: normalizePayrollRuleNumber(
        payrollRuleFields.overtime_multiplier?.value,
        1.5
      ),
      double_time_enabled: !!payrollRuleFields.double_time_enabled?.checked,
      double_time_daily_threshold_hours: normalizePayrollRuleNumber(
        payrollRuleFields.double_time_daily_threshold_hours?.value,
        12
      ),
      double_time_multiplier: normalizePayrollRuleNumber(
        payrollRuleFields.double_time_multiplier?.value,
        2.0
      )
    };
  }

  async function loadAccessControl() {
    const tbody = document.getElementById('settings-access-body');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="7">(loading admins…)</td></tr>';
    try {
      const employees = await fetchJSON('/api/employees?status=active');
      const admins = (employees || []).filter(
        e => e.desktop_access || e.kiosk_admin_access
      );
      if (!admins.length) {
        tbody.innerHTML = '<tr><td colspan="7">(no admins found)</td></tr>';
        return;
      }

      tbody.innerHTML = '';
      admins.forEach(admin => {
        const perms = {
          see_shipments: !!admin.see_shipments,
          modify_time: !!admin.modify_time,
          view_time_reports: !!admin.view_time_reports,
          view_payroll: !!admin.view_payroll,
          modify_payroll: !!admin.modify_payroll,
          modify_pay_rates: !!admin.modify_pay_rates
        };
        const canModifyPayroll = perms.modify_payroll;
        const tr = document.createElement('tr');
        tr.dataset.adminId = admin.id;
        tr.innerHTML = `
          <td>${admin.name || ''}</td>
          <td class="center"><input type="checkbox" data-perm="see_shipments" ${perms.see_shipments ? 'checked' : ''}></td>
          <td class="center"><input type="checkbox" data-perm="modify_time" ${perms.modify_time ? 'checked' : ''}></td>
          <td class="center"><input type="checkbox" data-perm="view_time_reports" ${perms.view_time_reports ? 'checked' : ''}></td>
          <td class="center"><input type="checkbox" data-perm="view_payroll" ${perms.view_payroll ? 'checked' : ''}></td>
          <td class="center"><input type="checkbox" data-perm="modify_payroll" ${canModifyPayroll ? 'checked' : ''}></td>
          <td class="center"><input type="checkbox" data-perm="modify_pay_rates" ${perms.modify_pay_rates ? 'checked' : ''}></td>
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {
      console.error('Error loading admins for access control', err);
      tbody.innerHTML = '<tr><td colspan="7">(error loading admins)</td></tr>';
    }
  }

  async function loadSettings() {
    try {
      try {
        const meRes = await fetch('/api/auth/me');
        if (meRes.ok) {
          const meData = await meRes.json();
          window.CURRENT_EMPLOYEE = meData.employee || null;
          window.CURRENT_USER = meData.user || null;
          window.CURRENT_IS_SUPER_ADMIN = !!meData?.membership?.is_super_admin;
          window.CURRENT_ORG = meData.org || null;
          window.CURRENT_ORG_TIMEZONE = meData?.org?.timezone || null;
          const currentAccess = deriveCurrentAdminAccess(meData.permissions || {});
          window.CURRENT_ACCESS_PERMS = {
            ...(window.CURRENT_ACCESS_PERMS || {}),
            ...currentAccess
          };
          if (typeof applyTimeEntryApprovalAccess === 'function') {
            applyTimeEntryApprovalAccess();
          }
          if (typeof applyRateAccessToEmployees === 'function') {
            applyRateAccessToEmployees(window.CURRENT_ACCESS_PERMS);
          }
          if (typeof applySuperAdminAccessToEmployees === 'function') {
            applySuperAdminAccessToEmployees(window.CURRENT_IS_SUPER_ADMIN);
          }
          applyBackupCardVisibility();
          applyAdminUsersVisibility();
          applyRoleTemplatesVisibility();
          if (window.CURRENT_IS_SUPER_ADMIN) {
            loadAdminUsers();
            loadAdminUserEmployees();
            loadRoleTemplates({ force: true });
          }
        }
      } catch (err) {
        console.warn('Failed to load current user context', err);
      }

      const res = await fetchJSON('/api/settings');
      const data = (res && res.settings) || {};

      if (settingsFields.company_name) settingsFields.company_name.value = data.company_name || '';
      if (settingsFields.company_email) settingsFields.company_email.value = data.company_email || '';
      if (settingsFields.storage_daily_late_fee_default) {
        const fee =
          data.storage_daily_late_fee_default === null ||
          typeof data.storage_daily_late_fee_default === 'undefined'
            ? ''
            : data.storage_daily_late_fee_default;
        settingsFields.storage_daily_late_fee_default.value = fee;
      }
      if (settingsFields.clock_in_photo_required) {
        settingsFields.clock_in_photo_required.checked = asBool(data.clock_in_photo_required);
      }
      applyExceptionRulesToUI(data.time_exception_rules);
      applyPayrollRulesToUI(data.payroll_rules);

      const accessCard = document.getElementById('settings-access-card');
      if (accessCard && !window.CURRENT_IS_SUPER_ADMIN) {
        accessCard.classList.add('hidden');
      }
      const payrollRulesCard = document.getElementById('settings-payroll-rules-card');
      if (payrollRulesCard && !window.CURRENT_IS_SUPER_ADMIN) {
        payrollRulesCard.classList.add('hidden');
      }
      if (window.CURRENT_IS_SUPER_ADMIN) {
        await loadAccessControl();
      }
    } catch (err) {
      console.warn('Failed to load settings', err);
      if (settingsStatus) {
        settingsStatus.textContent = 'Could not load settings (using defaults).';
        settingsStatus.style.color = '#b45309';
      }
    }
  }

  function collectAccessControl() {
    const rows = document.querySelectorAll('#settings-access-body tr[data-admin-id]');
    const map = {};
    rows.forEach(row => {
      const id = row.dataset.adminId;
      map[id] = {
        see_shipments: row.querySelector('input[data-perm="see_shipments"]')?.checked || false,
        modify_time: row.querySelector('input[data-perm="modify_time"]')?.checked || false,
        view_time_reports: row.querySelector('input[data-perm="view_time_reports"]')?.checked || false,
        view_payroll: row.querySelector('input[data-perm="view_payroll"]')?.checked || false,
        modify_payroll: row.querySelector('input[data-perm="modify_payroll"]')?.checked || false,
        modify_pay_rates: row.querySelector('input[data-perm="modify_pay_rates"]')?.checked || false
      };
    });
    return map;
  }

  async function saveSettings() {
    const rawStorageFee = settingsFields.storage_daily_late_fee_default?.value || '';
    const storageFee =
      rawStorageFee.trim() === '' ? null : Number(rawStorageFee);
    const payload = {
      company_name: settingsFields.company_name?.value || '',
      company_email: settingsFields.company_email?.value || '',
      storage_daily_late_fee_default: Number.isNaN(storageFee) ? null : storageFee,
      clock_in_photo_required: settingsFields.clock_in_photo_required?.checked || false,
      time_exception_rules: collectExceptionRuleSettings()
    };
    if (window.CURRENT_IS_SUPER_ADMIN) {
      const payrollRulesPayload = collectPayrollRulesSettings();
      if (payrollRulesPayload) {
        if (payrollRulesPayload.pay_period_length_days > 7 && !payrollRulesPayload.pay_period_anchor_date) {
          if (settingsStatus) {
            settingsStatus.textContent = 'Payroll rules: anchor date is required when the pay period exceeds 7 days.';
            settingsStatus.style.color = '#b91c1c';
          }
          return;
        }
        payload.payroll_rules = payrollRulesPayload;
      }
    }
    try {
      await fetchJSON('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (window.CURRENT_IS_SUPER_ADMIN) {
        const accessMap = collectAccessControl();
        await Promise.all(
          Object.entries(accessMap).map(([id, perms]) =>
            fetchJSON('/api/employees', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id, ...perms })
            })
          )
        );
      }

      if (typeof window.clearShipmentSettingsCache === 'function') {
        window.clearShipmentSettingsCache();
      }

      if (settingsStatus) {
        settingsStatus.textContent = 'Settings saved.';
        settingsStatus.style.color = 'green';
        // Auto-clear the success message after a short delay
        setTimeout(() => {
          settingsStatus.textContent = '';
        }, 3500);
      }
    } catch (err) {
      console.error('Error saving settings:', err);
      if (settingsStatus) {
        settingsStatus.textContent = err?.message || 'Error saving settings.';
        settingsStatus.style.color = 'crimson';
      }
    }
  }

  if (payrollRuleFields.pay_period_length_days) {
    payrollRuleFields.pay_period_length_days.addEventListener('input', updatePayrollRulesUIState);
  }
  if (payrollRuleFields.overtime_enabled) {
    payrollRuleFields.overtime_enabled.addEventListener('change', updatePayrollRulesUIState);
  }
  if (payrollRuleFields.double_time_enabled) {
    payrollRuleFields.double_time_enabled.addEventListener('change', updatePayrollRulesUIState);
  }

  loadSettings();

  if (settingsSaveBtn) {
    settingsSaveBtn.addEventListener('click', saveSettings);
  }

  async function changePassword() {
    if (!passwordSaveBtn) return;
    const current = passwordFields.current?.value || '';
    const next = passwordFields.next?.value || '';
    const confirm = passwordFields.confirm?.value || '';

    if (!current || !next || !confirm) {
      setPasswordStatus('Fill out all password fields to update your password.', '#b45309');
      return;
    }
    if (next !== confirm) {
      setPasswordStatus('New password and confirmation do not match.', 'crimson');
      return;
    }
    if (next.length < 8) {
      setPasswordStatus('New password must be at least 8 characters.', '#b45309');
      return;
    }

    const originalText = passwordSaveBtn.textContent || 'Update Password';
    passwordSaveBtn.disabled = true;
    passwordSaveBtn.textContent = 'Updating…';
    setPasswordStatus('Updating password…', '');

    try {
      await fetchJSON('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: current,
          new_password: next
        })
      });
      setPasswordStatus('Password updated.', 'green');
      clearPasswordInputs();
    } catch (err) {
      console.error('Password update error:', err);
      setPasswordStatus(err.message || 'Failed to update password.', 'crimson');
    } finally {
      passwordSaveBtn.disabled = false;
      passwordSaveBtn.textContent = originalText;
    }
  }

  if (passwordSaveBtn) {
    passwordSaveBtn.addEventListener('click', changePassword);
  }

  async function runManualBackup() {
    if (!backupBtn) return;
    const originalText = backupBtn.textContent || 'Backup Now';
    backupBtn.disabled = true;
    backupBtn.textContent = 'Running…';
    setBackupStatus('Running backup…', '');

    try {
      await fetchJSON('/api/admin/backup', { method: 'POST' });
      setBackupStatus('Backup completed.', 'green');
    } catch (err) {
      console.error('Manual backup error:', err);
      setBackupStatus(err.message || 'Backup failed.', 'crimson');
    } finally {
      backupBtn.disabled = false;
      backupBtn.textContent = originalText;
    }
  }

  if (backupBtn) {
    backupBtn.addEventListener('click', runManualBackup);
  }

  async function createAdminUser() {
    if (!adminUserCreateBtn) return;
    const employeeId = adminUserEmployee ? Number(adminUserEmployee.value) : null;
    const email = adminUserEmail ? String(adminUserEmail.value || '').trim() : '';
    const password = adminUserPassword ? String(adminUserPassword.value || '') : '';
    const confirm = adminUserPasswordConfirm ? String(adminUserPasswordConfirm.value || '') : '';

    if (!employeeId) {
      setAdminUserStatus('Select an employee to link.', '#b45309');
      return;
    }
    if (!email) {
      setAdminUserStatus('Login email is required.', '#b45309');
      return;
    }
    if (password || confirm) {
      if (password !== confirm) {
        setAdminUserStatus('Passwords do not match.', 'crimson');
        return;
      }
      if (password.length < 8) {
        setAdminUserStatus('Password must be at least 8 characters.', '#b45309');
        return;
      }
    }

    adminUserCreateBtn.disabled = true;
    setAdminUserStatus('Saving account…', '');

    const payload = {
      email,
      employee_id: employeeId
    };
    if (password) payload.password = password;

    try {
      await fetchJSON('/api/auth/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setAdminUserStatus('Admin login saved.', 'green');
      if (adminUserPassword) adminUserPassword.value = '';
      if (adminUserPasswordConfirm) adminUserPasswordConfirm.value = '';
      await loadAdminUsers();
    } catch (err) {
      console.error('Error saving admin login', err);
      setAdminUserStatus(err.message || 'Failed to save admin login.', 'crimson');
    } finally {
      adminUserCreateBtn.disabled = false;
    }
  }

  if (adminUserCreateBtn) {
    adminUserCreateBtn.addEventListener('click', createAdminUser);
  }


    // ───────── Time Entries (table + manual entry auto-hours) ─────────
  const teStart     = document.getElementById('te-start');
  const teStartTime = document.getElementById('te-start-time');
  const teEndTime   = document.getElementById('te-end-time');

  [teStart, teStartTime, teEndTime].forEach(el => {
    if (!el || typeof updateManualTimeHoursPreview !== 'function') return;
    el.addEventListener('input', updateManualTimeHoursPreview);
    el.addEventListener('change', updateManualTimeHoursPreview);
  });

  // ⚠️ NOTICE: we are *not* calling loadTimeEntriesTable() here anymore.
  // That now happens inside initPayrollTabIfNeeded(), the first time
  // the user clicks the Payroll tab.

  // ───────── Time entries: manual entry card + exports ─────────
  const teFormCard    = document.getElementById('time-entry-create-card');
  const teFormWrapper = document.getElementById('time-entry-form-wrapper');
  const teToggleBtn   = document.getElementById('time-entry-toggle-form');
  const teSaveBtn     = document.getElementById('time-entry-save-btn');
  const teCancelBtn   = document.getElementById('time-entry-cancel-btn');

  const teToggleContainerReport = document.getElementById('time-entry-toggle-container-report');
  const teToggleContainerForm   = document.getElementById('time-entry-toggle-container-form');

  function moveToggleToForm() {
    if (teToggleBtn && teToggleContainerForm && teToggleBtn.parentElement !== teToggleContainerForm) {
      teToggleContainerForm.appendChild(teToggleBtn);
    }
    if (teToggleBtn) {
      teToggleBtn.textContent = 'Hide manual time entry';
    }
  }

  function moveToggleToReport() {
    if (teToggleBtn && teToggleContainerReport && teToggleBtn.parentElement !== teToggleContainerReport) {
      teToggleContainerReport.appendChild(teToggleBtn);
    }
    if (teToggleBtn) {
      teToggleBtn.textContent = '+ Add manual time entry';
    }
  }

  if (teToggleBtn && teFormCard) {
    teToggleBtn.addEventListener('click', async () => {
      const isHidden = teFormCard.classList.contains('hidden');

      if (isHidden) {
        // Open the manual-entry card
        teFormCard.classList.remove('hidden');
        if (teFormWrapper) teFormWrapper.classList.remove('hidden');

        moveToggleToForm();

        // Populate dropdowns
        await loadEmployeesForSelect();
        await loadProjectsForTimeEntries();

        // Reset to "new" mode
        resetTimeEntryFormToNewMode();

        // Scroll into view (optional)
        teFormCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        // Hide the manual-entry card
        teFormCard.classList.add('hidden');
        moveToggleToReport();
      }
    });
  }

  if (teSaveBtn) {
    teSaveBtn.addEventListener('click', () => {
      saveTimeEntry();
      // saveTimeEntry itself will refresh the table / show messages
    });
  }

  if (teCancelBtn) {
    teCancelBtn.addEventListener('click', () => {
      // Reset the form to "new" mode
      resetTimeEntryFormToNewMode();

      // Hide the manual-entry card
      if (teFormCard && !teFormCard.classList.contains('hidden')) {
        teFormCard.classList.add('hidden');
      }

      // Move toggle button back to the report header
      moveToggleToReport();
    });
  }

  // Exports
  const exportCsvBtn = document.getElementById('te-export-csv');
  const exportPdfBtn = document.getElementById('te-export-pdf');
  const exportToggle = document.getElementById('te-export-toggle');
  const exportMenu   = document.getElementById('te-export-menu');

  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
      const url = buildTimeEntriesExportUrl('csv');
      window.location = url;
    });
  }

  if (exportPdfBtn) {
    exportPdfBtn.addEventListener('click', () => {
      const url = buildTimeEntriesExportUrl('pdf');
      window.location = url;
    });
  }

  if (exportToggle && exportMenu) {
    exportToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      exportMenu.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
      if (!exportMenu.contains(e.target) && !exportToggle.contains(e.target)) {
        exportMenu.classList.add('hidden');
      }
    });
  }

  // Filters → "Generate Report" / "Clear"
  const timeFilterApplyBtn  = document.getElementById('time-filter-apply');
  const timeFilterClearBtn  = document.getElementById('time-filter-clear');
  const timeFilterEmployee  = document.getElementById('te-filter-employee');
  const timeFilterProject   = document.getElementById('te-filter-project');
  const timeFilterStart     = document.getElementById('te-filter-start');
  const timeFilterEnd       = document.getElementById('te-filter-end');
  const approveAllBtn       = document.getElementById('te-approve-all');

  if (timeFilterApplyBtn) {
    timeFilterApplyBtn.addEventListener('click', () => {
      const filters = getTimeEntryFiltersFromUi();
      if (hasActiveTimeEntryFilters(filters)) {
        loadTimeEntriesTable(filters);
      } else {
        loadTimeEntriesTable({});
      }
    });
  }

  if (timeFilterClearBtn) {
    timeFilterClearBtn.addEventListener('click', () => {
      if (timeFilterEmployee) timeFilterEmployee.value = '';
      if (timeFilterProject)  timeFilterProject.value  = '';
      if (timeFilterStart)    timeFilterStart.value    = '';
      if (timeFilterEnd)      timeFilterEnd.value      = '';

      loadTimeEntriesTable({});
    });
  }

  if (approveAllBtn) {
    approveAllBtn.addEventListener('click', approveAllTimeEntries);
    applyTimeEntryApprovalAccess();
  }

  // ───────── Live open punches ─────────
  // ⚠️ Moved to initPayrollTabIfNeeded()
  // if (typeof loadOpenPunches === 'function') {
  //   loadOpenPunches();
  // }

  // ───────── Sessions (kiosks) ─────────
  if (typeof loadSessionsSection === 'function') {
    loadSessionsSection();
  }

  // ───────── Shipments ─────────
  if (typeof loadShipmentsSection === 'function') {
    loadShipmentsSection();
  }

  if (typeof setupShipmentsUI === 'function') {
    setupShipmentsUI();
  }

  const addShipmentBtn = document.getElementById('shipment-add-btn');
  if (addShipmentBtn && typeof openShipmentCreateModal === 'function') {
    addShipmentBtn.addEventListener('click', openShipmentCreateModal);
  }

  const shipmentCloseBottom = document.getElementById('shipment-close-bottom');
  if (shipmentCloseBottom && typeof closeShipmentCreateModal === 'function') {
    shipmentCloseBottom.addEventListener('click', closeShipmentCreateModal);
  }

  const shipmentCloseTop = document.getElementById('shipment-close-top');
  if (shipmentCloseTop && typeof closeShipmentCreateModal === 'function') {
    shipmentCloseTop.addEventListener('click', closeShipmentCreateModal);
  }

  const shipmentAddItemBtn = document.getElementById('shipment-add-item-row');
  if (shipmentAddItemBtn && typeof addShipmentItemRow === 'function') {
    shipmentAddItemBtn.addEventListener('click', () => {
      addShipmentItemRow();
    });
  }

  // Shipment create modal wiring
  const shipmentCreateBackdrop = document.getElementById('shipment-create-backdrop');
  if (shipmentCreateBackdrop && typeof closeShipmentCreateModal === 'function') {
    shipmentCreateBackdrop.addEventListener('click', (e) => {
      if (e.target === shipmentCreateBackdrop) {
        closeShipmentCreateModal();
      }
    });
  }

  const shipmentCreateClose = document.getElementById('shipment-create-close');
  if (shipmentCreateClose && typeof closeShipmentCreateModal === 'function') {
    shipmentCreateClose.addEventListener('click', closeShipmentCreateModal);
  }

  const shipmentCreateForm = document.getElementById('shipment-create-form');
  if (shipmentCreateForm && typeof saveShipmentFromModal === 'function') {
    shipmentCreateForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await saveShipmentFromModal();
    });
  }

  // Tracking helper wiring
  const trackingInputEl   = document.getElementById('shipment-tracking-number');
  const forwarderSelectEl = document.getElementById('shipment-forwarder');
  const websiteInputEl    = document.getElementById('shipment-website-url');

  if (typeof updateShipmentTrackingHelper === 'function') {
    if (trackingInputEl) {
      trackingInputEl.addEventListener('input', updateShipmentTrackingHelper);
      trackingInputEl.addEventListener('change', updateShipmentTrackingHelper);
    }
    if (forwarderSelectEl) {
      forwarderSelectEl.addEventListener('change', updateShipmentTrackingHelper);
    }
    if (websiteInputEl) {
      websiteInputEl.addEventListener('input', updateShipmentTrackingHelper);
      websiteInputEl.addEventListener('change', updateShipmentTrackingHelper);
    }
  }

  // Employee CREATE button
  const saveEmployeeBtn = document.getElementById('save-employee');
  if (saveEmployeeBtn && typeof saveEmployee === 'function') {
    saveEmployeeBtn.addEventListener('click', saveEmployee);
  }

  // Payroll reports & audit log (these can stay eager – lighter than time table)
  if (typeof loadPayrollRuns === 'function') {
    loadPayrollRuns();
  }
  if (typeof loadPayrollAuditLog === 'function') {
    loadPayrollAuditLog();
  }
  if (typeof setupReportsDownload === 'function') {
    setupReportsDownload();
  }

  // Time Exceptions moved to Payroll lazy init
  // if (typeof setupTimeExceptionsSection === 'function') {
  //   setupTimeExceptionsSection();
  // }

  // Global "close all modals" helpers
  if (typeof closeAllModals === 'function') {
    document.querySelectorAll('[data-close-all-modals]').forEach(btn => {
      btn.addEventListener('click', closeAllModals);
    });
  }
});

// ───────── 8. BFCache / RETURN FROM QB FIX ─────────
// When the page is restored from the back/forward cache (e.g. after QuickBooks),
// make sure all modals/backdrops are closed so they don't block clicks.
window.addEventListener('pageshow', () => {
  if (typeof closeAllModals === 'function') {
    closeAllModals();
  }
  if (typeof checkStatus === 'function') {
    checkStatus();
  }
});

// ───────── 9. DEBUG HELPER FOR BACKDROPS ─────────
console.log('[DEBUG] registering debugVisibleBackdrops');

// Create a real global function
function debugVisibleBackdrops() {
  const backdrops = [
    ...document.querySelectorAll(
      '#employee-edit-backdrop, ' +
      '#vendor-edit-backdrop, ' +
      '#project-edit-backdrop, ' +
      '#shipment-create-backdrop, ' +
      '#time-entries-backdrop, ' +
      '#shipment-detail-backdrop, ' +
      '#kiosk-modal-backdrop'
    )
  ];

  const visible = backdrops.filter(el => !el.classList.contains('hidden'));
  console.log('Visible backdrops:', visible);

  visible.forEach(el => {
    el.style.outline = '3px solid red';
    el.style.background = 'rgba(255,0,0,0.05)';
  });
}

window.debugVisibleBackdrops = debugVisibleBackdrops;

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => {
    syncTimeEditQueue();
  });
} else {
  syncTimeEditQueue();
}
window.addEventListener('online', () => {
  syncTimeEditQueue();
});

const logoutButtons = document.querySelectorAll('.logout-btn');

if (logoutButtons.length) {
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getCsrfHeader() }
      });
    } catch (err) {
      console.error('Logout error:', err);
    }

    // Clear cached assets/service workers so the auth page renders cleanly
    try {
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if (navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(reg => reg.unregister()));
      }
    } catch (err) {
      console.warn('Logout cache cleanup failed:', err);
    }

    // 🔹 After destroying session, go directly to real sign-in
    window.location.replace('/');
  };

  logoutButtons.forEach(btn => btn.addEventListener('click', handleLogout));
}
