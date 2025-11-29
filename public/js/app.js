
/* ───────── 1. SIDEBAR NAVIGATION ───────── */

// Run Payroll tab wiring & data loads only once
let payrollTabInitialized = false;
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
    await fetch('/api/sync/payroll-accounts', { method: 'POST' });
    // If payroll settings loader is available, refresh options
    if (typeof loadPayrollSettings === 'function') {
      await loadPayrollSettings();
    }
  } catch (err) {
    console.warn('[PAYROLL] Background payroll account sync failed:', err);
  }
}


async function syncRoute(route, onSuccess) {
  const indicator   = document.getElementById('qb-sync-indicator');
  const employeesBtn = document.getElementById('sync-employees');
  const vendorsBtn  = document.getElementById('sync-vendors');
  const projectsBtn = document.getElementById('sync-projects');
  const accountsBtn = document.getElementById('sync-accounts');
  const connectBtn  = document.getElementById('connect');

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

    const data = await fetchJSON(route, { method: 'POST' });
    alert(data.message || 'Sync complete.');

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
    allButtons.forEach(btn => {
      btn.disabled = false;
    });
  }
}

/* ───────── 3. TIME ENTRIES UI ───────── */

function updateManualTimeHoursPreview() {
  const startInput     = document.getElementById('te-start');
  const startTimeInput = document.getElementById('te-start-time');
  const endTimeInput   = document.getElementById('te-end-time');
  const hoursInput     = document.getElementById('te-hours');
  const noteInput      = document.getElementById('te-note');
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

  // 7 columns now (Employee, Project, Date, Hours, Pay, Paid?, Paid on)
  tbody.innerHTML = '<tr><td colspan="7">Loading...</td></tr>';

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
        '<tr><td colspan="7">(no time entries for this selection)</td></tr>';
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

      // ─────────────────────────────────────────────
      // BUILD THE TABLE ROW
      // ─────────────────────────────────────────────
      tr.innerHTML = `
        <td>${e.employee_name || ''}</td>
        <td>${e.project_name || ''}</td>
        <td>${dateLabel}</td>
        <td>${Number(e.hours || 0).toFixed(2)}</td>
        <td>$${Number(e.total_pay || 0).toFixed(2)}</td>
        <td>${paidLabel}</td>
        <td>${paidDateLabel}</td>
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

      // clicking a row loads it into the form for editing
      tr.addEventListener('click', () => {
        loadTimeEntryIntoFormFromRow(tr);
      });

      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error('Error loading time entries:', err.message);
    tbody.innerHTML =
      '<tr><td colspan="7">Error loading time entries</td></tr>';
  }
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
  const msgEl          = document.getElementById('time-entry-message');


  if (idInput) idInput.value = row.dataset.entryId || '';

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

async function saveTimeEntry() {
  const idInput        = document.getElementById('te-id');
  const employeeSelect = document.getElementById('te-employee');
  const projectSelect  = document.getElementById('te-project');
  const startInput     = document.getElementById('te-start');
  const hoursInput     = document.getElementById('te-hours');
  const startTimeInput = document.getElementById('te-start-time');
  const endTimeInput   = document.getElementById('te-end-time');
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

  if (isEdit && !change_note.trim()) {
    if (msgEl) {
      msgEl.textContent = 'A note is required when editing an entry.';
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
    change_note: isEdit ? `${new Date().toISOString()} - ${change_note.trim()}` : undefined,
    change_recorded_at: isEdit ? new Date().toISOString() : undefined,
    change_recorded_by: isEdit ? 'Web admin' : undefined
  };

  let url = '/api/time-entries';
  if (isEdit) {
    url = `/api/time-entries/${encodeURIComponent(idInput.value)}`;
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

  if (reviewClose) reviewClose.addEventListener('click', closeTimeExceptionReviewModal);
  if (reviewCancel) reviewCancel.addEventListener('click', closeTimeExceptionReviewModal);
  if (reviewBackdrop) {
    reviewBackdrop.addEventListener('click', closeTimeExceptionReviewModal);
  }
  if (reviewSave) {
    reviewSave.addEventListener('click', submitTimeExceptionReview);
  }
  if (reviewAction) {
    reviewAction.addEventListener('change', () => {
      const note = document.getElementById('te-review-note');
      const noteHelp = document.getElementById('te-review-note-help');
      const needNote = reviewAction.value === 'modify';
      if (note) note.required = needNote;
      if (noteHelp) noteHelp.classList.toggle('hidden', !needNote);
    });
  }

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

let currentTimeExceptionRecord = null;

function closeTimeExceptionReviewModal() {
  const backdrop = document.getElementById('time-exception-review-backdrop');
  const modal = document.getElementById('time-exception-review-modal');
  if (backdrop) backdrop.classList.add('hidden');
  if (modal) modal.classList.add('hidden');
  currentTimeExceptionRecord = null;
}

function openTimeExceptionReviewModal(rec) {
  currentTimeExceptionRecord = rec;
  const backdrop = document.getElementById('time-exception-review-backdrop');
  const modal = document.getElementById('time-exception-review-modal');
  if (!modal || !backdrop || !rec) return;

  const title = document.getElementById('te-review-title');
  const meta = document.getElementById('te-review-meta');
  const flagsEl = document.getElementById('te-review-flags');
  const startInput = document.getElementById('te-review-start');
  const endInput = document.getElementById('te-review-end');
  const hoursWrap = document.getElementById('te-review-hours-wrap');
  const hoursInput = document.getElementById('te-review-hours');
  const actorInput = document.getElementById('te-review-actor');
  const actionSelect = document.getElementById('te-review-action');
  const noteInput = document.getElementById('te-review-note');

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

  if (startInput) {
    const startVal =
      rec.clock_in_ts ||
      (rec.start_date ? `${rec.start_date}T${rec.start_time || '00:00'}` : '');
    startInput.value = formatDateTimeLocal(startVal);
  }

  if (endInput) {
    const endVal =
      rec.clock_out_ts ||
      (rec.end_date ? `${rec.end_date}T${rec.end_time || '00:00'}` : '');
    endInput.value = formatDateTimeLocal(endVal);
  }

  if (hoursWrap) {
    hoursWrap.classList.toggle('hidden', rec.source !== 'time_entry');
  }
  if (hoursInput) {
    hoursInput.value =
      rec.source === 'time_entry' && typeof rec.duration_hours === 'number'
        ? rec.duration_hours
        : '';
  }

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

  modal.dataset.source = rec.source || '';
  modal.dataset.id = rec.id ? String(rec.id) : '';

  backdrop.classList.remove('hidden');
  modal.classList.remove('hidden');
}

async function submitTimeExceptionReview() {
  const modal = document.getElementById('time-exception-review-modal');
  if (!modal) return;

  const source = modal.dataset.source;
  const id = modal.dataset.id;
  if (!source || !id) return;

  const startInput = document.getElementById('te-review-start');
  const endInput = document.getElementById('te-review-end');
  const hoursInput = document.getElementById('te-review-hours');
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

  if (action === 'modify' && !note) {
    if (msgEl) {
      msgEl.textContent = 'A note is required when modifying an exception.';
      msgEl.style.color = 'red';
    }
    return;
  }

  const updates = {};
  if (action === 'modify') {
    const startVal = startInput?.value ? new Date(startInput.value).toISOString() : null;
    const endVal = endInput?.value ? new Date(endInput.value).toISOString() : null;

    if (source === 'punch') {
      updates.clock_in_ts = startVal;
      updates.clock_out_ts = endVal;
    } else if (source === 'time_entry') {
      if (startVal) {
        updates.start_date = startVal.slice(0, 10);
        updates.start_time = startVal.slice(11, 16);
      }
      if (endVal) {
        updates.end_date = endVal.slice(0, 10);
        updates.end_time = endVal.slice(11, 16);
      }
      if (hoursInput && hoursInput.value) {
        updates.hours = Number(hoursInput.value);
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
      msgEl.textContent = 'Failed to save review.';
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

    if (!Array.isArray(data) || !data.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center text-gray-500">
            No exceptions found for this range.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = '';

    data.forEach(r => {
      const tr = document.createElement('tr');

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
        <td>${r.employee_name || ''}</td>
        <td>${r.project_name || ''}</td>
        <td>${startStr}</td>
        <td>${endStr}</td>
        <td class="text-right">${durationStr}</td>
        <td>${categoryLabel}</td>
        <td>${flagsStr}</td>
        <td>
          <button
            class="btn-secondary btn-xs te-review-btn"
            data-id="${r.id}"
            data-source="${r.source || ''}"
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

    // Wire up review click handlers
    tbody.querySelectorAll('.te-review-btn').forEach(btn => {
      btn.addEventListener('click', evt => {
        const id = evt.currentTarget.getAttribute('data-id');
        if (!id) return;
        const rec = (data || []).find(r => String(r.id) === String(id));
        if (rec) {
          openTimeExceptionReviewModal(rec);
        }
      });
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
  if (typeof setupTimeExceptionsSection === 'function') {
    setupTimeExceptionsSection();
  }

  // Also initialize the dedicated payroll UI (settings/summary) if present.
  if (typeof window.initPayrollUiTab === 'function') {
    window.initPayrollUiTab();
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
    workers_see_shipments: document.getElementById('settings-workers-see-shipments'),
    workers_see_time: document.getElementById('settings-workers-see-time'),
    daily_fee: document.getElementById('settings-daily-fee'),
    due_offset: document.getElementById('settings-due-offset')
  };

  function deriveCurrentAdminAccess(accessMap = {}) {
    const defaults = { modify_pay_rates: false };
    const emp = typeof CURRENT_EMPLOYEE !== 'undefined' ? CURRENT_EMPLOYEE : null;
    if (!emp || !emp.id) return defaults;
    const perms = accessMap[emp.id] || accessMap[String(emp.id)] || {};
    return {
      ...defaults,
      modify_pay_rates: perms.modify_pay_rates === true || perms.modify_pay_rates === 'true'
    };
  }

  async function loadAccessControl(accessMap = {}) {
    const tbody = document.getElementById('settings-access-body');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="6">(loading admins…)</td></tr>';
    try {
      const employees = await fetchJSON('/api/employees');
      const admins = (employees || []).filter(e => e.is_admin);
      if (!admins.length) {
        tbody.innerHTML = '<tr><td colspan="6">(no admins found)</td></tr>';
        return;
      }

      tbody.innerHTML = '';
      admins.forEach(admin => {
        const perms = accessMap[admin.id] || {};
        const tr = document.createElement('tr');
        tr.dataset.adminId = admin.id;
        tr.innerHTML = `
          <td>${admin.name || ''}</td>
          <td class="center"><input type="checkbox" data-perm="see_shipments" ${perms.see_shipments ? 'checked' : ''}></td>
          <td class="center"><input type="checkbox" data-perm="modify_time" ${perms.modify_time ? 'checked' : ''}></td>
          <td class="center"><input type="checkbox" data-perm="view_time_reports" ${perms.view_time_reports ? 'checked' : ''}></td>
          <td class="center"><input type="checkbox" data-perm="view_payroll" ${perms.view_payroll ? 'checked' : ''}></td>
          <td class="center"><input type="checkbox" data-perm="modify_pay_rates" ${perms.modify_pay_rates ? 'checked' : ''}></td>
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {
      console.error('Error loading admins for access control', err);
      tbody.innerHTML = '<tr><td colspan="6">(error loading admins)</td></tr>';
    }
  }

  async function loadSettings() {
    try {
      const res = await fetchJSON('/api/settings');
      const data = (res && res.settings) || {};

      if (settingsFields.company_name) settingsFields.company_name.value = data.company_name || '';
      if (settingsFields.company_email) settingsFields.company_email.value = data.company_email || '';
      if (settingsFields.workers_see_shipments) settingsFields.workers_see_shipments.checked =
        data.workers_see_shipments === 'true' || data.workers_see_shipments === true;
      if (settingsFields.workers_see_time) settingsFields.workers_see_time.checked =
        data.workers_see_time === 'true' || data.workers_see_time === true;
      if (settingsFields.daily_fee) settingsFields.daily_fee.value = data.daily_fee || '';
      if (settingsFields.due_offset) settingsFields.due_offset.value = data.due_offset || '';

      const accessMap =
        typeof data.access_admins === 'string'
          ? JSON.parse(data.access_admins || '{}')
          : (data.access_admins || {});
      const currentAccess = deriveCurrentAdminAccess(accessMap);
      window.CURRENT_ACCESS_PERMS = {
        ...(window.CURRENT_ACCESS_PERMS || {}),
        ...currentAccess
      };
      if (typeof applyRateAccessToEmployees === 'function') {
        applyRateAccessToEmployees(window.CURRENT_ACCESS_PERMS);
      }
      await loadAccessControl(accessMap);
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
        modify_pay_rates: row.querySelector('input[data-perm="modify_pay_rates"]')?.checked || false
      };
    });
    return map;
  }

  async function saveSettings() {
    const payload = {
      company_name: settingsFields.company_name?.value || '',
      company_email: settingsFields.company_email?.value || '',
      workers_see_shipments: settingsFields.workers_see_shipments?.checked || false,
      workers_see_time: settingsFields.workers_see_time?.checked || false,
      daily_fee: settingsFields.daily_fee?.value || '',
      due_offset: settingsFields.due_offset?.value || '',
      access_admins: JSON.stringify(collectAccessControl())
    };
    try {
      await fetchJSON('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (settingsStatus) {
        settingsStatus.textContent = 'Settings saved.';
        settingsStatus.style.color = 'green';
        // Auto-clear the success message after a short delay
        setTimeout(() => {
          settingsStatus.textContent = '';
        }, 3500);
      }
    } catch (err) {
      if (settingsStatus) {
        settingsStatus.textContent = 'Error saving settings.';
        settingsStatus.style.color = 'crimson';
      }
    }
  }

  loadSettings();

  if (settingsSaveBtn) {
    settingsSaveBtn.addEventListener('click', saveSettings);
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

document.getElementById('logout-btn')?.addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
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
});
