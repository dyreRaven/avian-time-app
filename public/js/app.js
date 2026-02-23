
/* ───────── 1. SIDEBAR NAVIGATION ───────── */

// Run Payroll tab wiring & data loads only once
console.log('[App] app.js loaded');
let payrollTabInitialized = false;
let timeEntriesInitialized = false;
let timeEntriesReportInitialized = false;
let payrollReportsInitialized = false;
let dashboardSnapshotLoading = false;
let dashboardSnapshotLast = 0;
const timeEntryApprovalSelection = new Set();
const timeEntryApprovalNotes = new Map();
let timeEntryEditInModal = false;
let timeEntryFormOriginalParent = null;
let timeEntryFormOriginalNextSibling = null;
let timeEntryCurrentPage = 1;
const timeEntryPageSize = 25;
let timeEntryLastFilters = {};
let timeEntriesReportCurrentPage = 1;
const timeEntriesReportPageSize = 50;
let timeEntriesReportLastFilters = {};
window.CURRENT_ACCESS_PERMS = window.CURRENT_ACCESS_PERMS || {};
window.CURRENT_SECTION_FEATURES = window.CURRENT_SECTION_FEATURES || {};
const SECTION_FEATURE_DEFAULTS = {
  time: true,
  payroll: true,
  shipments: true
};
window.ONBOARDING_SHOW_QB = window.ONBOARDING_SHOW_QB || false;

function coerceFeatureFlag(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  return value !== false && value !== 0 && value !== '0' && value !== 'false';
}

function normalizeSectionFeatures(raw = {}) {
  return {
    time: coerceFeatureFlag(raw.time, SECTION_FEATURE_DEFAULTS.time),
    payroll: coerceFeatureFlag(raw.payroll, SECTION_FEATURE_DEFAULTS.payroll),
    shipments: coerceFeatureFlag(raw.shipments, SECTION_FEATURE_DEFAULTS.shipments)
  };
}

function isSectionFeatureEnabled(sectionName, features = window.CURRENT_SECTION_FEATURES) {
  return coerceFeatureFlag(features?.[sectionName], true);
}

function coerceAccessFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function applyShipmentsNavForAccess(perms = {}) {
  const featureEnabled = isSectionFeatureEnabled('shipments');
  const hasPerm = coerceAccessFlag(perms.see_shipments);
  if (featureEnabled && hasPerm) return;

  const navList = document.querySelector('.nav-list');
  const shipmentsItem = document.querySelector('.nav-item[data-section="shipments"]');
  const shipmentsReportItem = document.querySelector('.nav-item[data-section="shipments-report"]');
  const employeesItem = document.querySelector('.nav-item[data-section="employees"]');
  const shipmentsSection = document.getElementById('section-shipments');
  const employeesSection = document.getElementById('section-employees');

  if (shipmentsItem) shipmentsItem.remove();
  if (shipmentsReportItem) shipmentsReportItem.remove();

  if (navList && employeesItem) {
    navList.appendChild(employeesItem);
  }

  if (shipmentsSection && shipmentsSection.classList.contains('active')) {
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
    if (employeesItem) employeesItem.classList.add('active');
    shipmentsSection.classList.remove('active');
    if (employeesSection) employeesSection.classList.add('active');
  }
}

function applyTimeSectionForAccess() {
  const featureEnabled = isSectionFeatureEnabled('time');
  if (featureEnabled) return;

  const navItems = [
    '.nav-item[data-section="kiosks"]',
    '.nav-item[data-section="time-entries"]',
    '.nav-item[data-section="time-entries-report"]',
    '.nav-item[data-section="audit-time-report"]'
  ];
  const sectionIds = [
    'section-kiosks',
    'section-time-entries',
    'section-time-entries-report',
    'section-audit-time-report'
  ];

  navItems.forEach(selector => {
    const item = document.querySelector(selector);
    if (item && item.classList.contains('active')) {
      navigateToSection('dashboard', { force: true });
    }
    if (item) item.remove();
  });
  sectionIds.forEach(id => {
    const section = document.getElementById(id);
    if (section) section.remove();
  });
}

function applyPayrollNavForAccess(perms = {}) {
  const featureEnabled = isSectionFeatureEnabled('payroll');
  const hasPerm = coerceAccessFlag(perms.view_payroll);
  if (featureEnabled && hasPerm) return;

  const activeNav = document.querySelector('.nav-item.active');
  const activeKey = activeNav && activeNav.dataset ? activeNav.dataset.section : '';
  const payrollKeys = new Set(['payroll', 'reimbursements', 'reports', 'audit-payroll-report']);
  if (payrollKeys.has(activeKey)) {
    // Avoid leaving the user on a now-forbidden section.
    navigateToSection('dashboard', { force: true });
  }

  const payrollItem = document.querySelector('.nav-item[data-section="payroll"]');
  const reimbursementsItem = document.querySelector('.nav-item[data-section="reimbursements"]');
  const payrollReportsItem = document.querySelector('.nav-item[data-section="reports"]');
  const payrollAuditItem = document.querySelector('.nav-item[data-section="audit-payroll-report"]');
  const payrollSection = document.getElementById('section-payroll');
  const reimbursementsSection = document.getElementById('section-reimbursements');
  const payrollReportsSection = document.getElementById('section-reports');
  const payrollAuditSection = document.getElementById('section-audit-payroll-report');

  if (payrollItem) payrollItem.remove();
  if (reimbursementsItem) reimbursementsItem.remove();
  if (payrollReportsItem) payrollReportsItem.remove();
  if (payrollAuditItem) payrollAuditItem.remove();
  if (payrollSection) payrollSection.remove();
  if (reimbursementsSection) reimbursementsSection.remove();
  if (payrollReportsSection) payrollReportsSection.remove();
  if (payrollAuditSection) payrollAuditSection.remove();
}

function applySectionAccessNav(perms = {}) {
  applyTimeSectionForAccess();
  applyShipmentsNavForAccess(perms);
  applyPayrollNavForAccess(perms);
}

function navigateToSection(sectionKey, { force = false } = {}) {
  if (!sectionKey) return false;
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.section');
  const item = document.querySelector(`.nav-item[data-section="${sectionKey}"]`);
  if (!item) return false;

  const isDisabled = item.dataset.disabled === 'true';
  if (isDisabled && !force) return false;

  navItems.forEach(btn => btn.classList.remove('active'));
  item.classList.add('active');

  sections.forEach(sec => {
    const shouldBeActive = sec.id === `section-${sectionKey}`;
    sec.classList.toggle('active', shouldBeActive);
  });

  updateQbCardForSection(sectionKey);

  if (sectionKey === 'dashboard') {
    updateDashboardHero();
    refreshDashboardSnapshot();
  }

  if (sectionKey === 'payroll' || sectionKey === 'reimbursements') {
    initPayrollTabIfNeeded();
  }

  if (sectionKey === 'time-entries') {
    initTimeEntriesIfNeeded();
  }

  if (sectionKey === 'time-entries-report') {
    initTimeEntriesReportIfNeeded();
  }

  if (sectionKey === 'reports') {
    initPayrollReportsIfNeeded();
  }

  if (sectionKey === 'my-account' || sectionKey === 'settings' || sectionKey === 'notifications') {
    if (typeof window.initNotificationsSection === 'function') {
      Promise.resolve(window.initNotificationsSection()).then(() => {
        if (sectionKey === 'notifications' &&
            typeof window.markNotificationsReadOnView === 'function') {
          window.markNotificationsReadOnView();
        }
      });
    }
  }

  debugSectionLayout(sectionKey);
  return true;
}

window.navigateToSection = navigateToSection;
window.forceNavigateSection = (sectionKey) =>
  navigateToSection(sectionKey, { force: true });

function setupSidebarNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.section');

  console.log('[NAV] setupSidebarNavigation: found', navItems.length, 'nav items and', sections.length, 'sections');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const sectionKey = item.dataset.section;
      const isDisabled = item.dataset.disabled === 'true';
      console.log('[NAV] Clicked nav item', {
        text: item.textContent?.trim(),
        sectionKey,
        disabled: isDisabled
      });

      // 🔒 Do nothing if this nav item is disabled
      if (!navigateToSection(sectionKey)) {
        console.log('[NAV] Item is disabled, ignoring click.');
        return;
      }
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

/* ───────── DASHBOARD (ADMIN CONSOLE) ───────── */

function formatDashboardDate(timezone) {
  const now = new Date();
  try {
    if (timezone) {
      return new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        timeZone: timezone
      }).format(now);
    }
  } catch {
    // fall back to local formatting
  }
  return now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  });
}

function updateDashboardHero() {
  const adminNameEl = document.getElementById('dashboard-admin-name');
  const orgNameEl = document.getElementById('dashboard-org-name');
  const orgTzEl = document.getElementById('dashboard-org-timezone');
  const todayEl = document.getElementById('dashboard-today');

  const org = window.CURRENT_ORG || {};
  const employee = window.CURRENT_EMPLOYEE || {};

  if (adminNameEl) {
    adminNameEl.textContent = employee.name || 'Admin';
  }
  if (orgNameEl) {
    orgNameEl.textContent = org.name || 'Your organization';
  }
  if (orgTzEl) {
    orgTzEl.textContent = org.timezone || 'Local timezone';
  }
  if (todayEl) {
    todayEl.textContent = formatDashboardDate(org.timezone);
  }
}

function setDashboardStat(key, value, note = '') {
  const valueEl = document.getElementById(`dashboard-stat-${key}`);
  const noteEl = document.getElementById(`dashboard-stat-${key}-note`);
  if (valueEl) {
    valueEl.textContent = value;
  }
  if (noteEl) {
    noteEl.textContent = note || '';
  }
}

function setDashboardTask(key, value, note = null) {
  const valueEl = document.getElementById(`dashboard-task-${key}-count`);
  const noteEl = document.getElementById(`dashboard-task-${key}-note`);
  if (valueEl) {
    valueEl.textContent = value;
    valueEl.classList.remove('is-ok', 'is-warn');
    const num = Number(value);
    if (Number.isFinite(num)) {
      valueEl.classList.add(num > 0 ? 'is-warn' : 'is-ok');
    }
  }
  if (noteEl) {
    if (!noteEl.dataset.defaultText) {
      noteEl.dataset.defaultText = noteEl.textContent || '';
    }
    if (note !== null) {
      noteEl.textContent = note || '';
    } else {
      noteEl.textContent = noteEl.dataset.defaultText || '';
    }
  }
}

function setDashboardPayrollIssuesAction(run = null) {
  const btn = document.getElementById('dashboard-task-payroll-issues-action');
  if (!btn) return;
  const runId = Number(run?.id);
  if (Number.isFinite(runId) && runId > 0) {
    btn.textContent = 'Resume run';
    btn.dataset.payrollRunId = String(runId);
  } else {
    btn.textContent = 'Open payroll';
    delete btn.dataset.payrollRunId;
  }
}

function formatDashboardCount(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return num.toLocaleString('en-US');
}

function getDashboardTodayIso(timezone) {
  const now = new Date();
  try {
    if (timezone) {
      return new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: timezone
      }).format(now);
    }
  } catch {
    // fall back to local formatting
  }
  return now.toISOString().slice(0, 10);
}

async function refreshDashboardSnapshot({ force = false } = {}) {
  const now = Date.now();
  if (dashboardSnapshotLoading) return;
  if (!force && dashboardSnapshotLast && now - dashboardSnapshotLast < 30000) return;

  dashboardSnapshotLoading = true;
  dashboardSnapshotLast = now;

  const perms = window.CURRENT_ACCESS_PERMS || {};
  const sectionFeatures = window.CURRENT_SECTION_FEATURES || {};
  const canViewPayroll = !!perms.view_payroll && isSectionFeatureEnabled('payroll', sectionFeatures);
  const canSeeShipments = !!perms.see_shipments && isSectionFeatureEnabled('shipments', sectionFeatures);
  const canViewTime = !!(perms.view_time_reports || perms.view_payroll) && isSectionFeatureEnabled('time', sectionFeatures);
  const canViewTimesheets = !!(
    (perms.view_time_reports || perms.view_payroll || perms.view_all_timesheets) &&
    isSectionFeatureEnabled('time', sectionFeatures)
  );

  if (!canViewPayroll) {
    setDashboardStat('employees', '--', 'Payroll access required');
  }
  if (!canViewPayroll && !canSeeShipments) {
    setDashboardStat('projects', '--', 'Access required');
    setDashboardStat('vendors', '--', 'Access required');
  }
  if (!canSeeShipments) {
    setDashboardStat('shipments', '--', 'Access required');
  }
  if (!canViewTimesheets) {
    setDashboardStat('open-timesheets', '--', 'Access required');
    setDashboardStat('current-workers', '--', 'Access required');
  }
  if (!canViewTime) {
    setDashboardTask('time-entries', '--', 'Access required');
  }
  if (!canSeeShipments) {
    setDashboardTask('missing-docs', '--', 'Access required');
    setDashboardTask('unread-comments', '--', 'Access required');
    setDashboardTask('pickup-storage', '--', 'Access required');
  }
  if (!canViewPayroll) {
    setDashboardTask('qbo-sync', '--', 'Payroll access required');
    setDashboardTask('payroll-issues', '--', 'Payroll access required');
    setDashboardPayrollIssuesAction(null);
  }

  const tasks = [];

  if (canViewTime) {
    tasks.push(
      fetchJSON('/api/time-entries/pending-count')
        .then(res => {
          const pending = Number(res?.pending || 0);
          setDashboardTask('time-entries', formatDashboardCount(pending));
        })
        .catch(() => {
          setDashboardTask('time-entries', '--', 'Unavailable');
        })
    );
  }

  if (canViewPayroll) {
    tasks.push(
      fetchJSON('/api/employees?status=active')
        .then(list => {
          const count = Array.isArray(list) ? list.length : 0;
          setDashboardStat('employees', formatDashboardCount(count));
        })
        .catch(() => {
          setDashboardStat('employees', '--', 'Unavailable');
        })
    );
  }

  if (canViewPayroll || canSeeShipments) {
    tasks.push(
      fetchJSON('/api/projects?status=active')
        .then(list => {
          const count = Array.isArray(list) ? list.length : 0;
          setDashboardStat('projects', formatDashboardCount(count));
        })
        .catch(() => {
          setDashboardStat('projects', '--', 'Unavailable');
        })
    );

    tasks.push(
      fetchJSON('/api/vendors?status=active')
        .then(list => {
          const count = Array.isArray(list) ? list.length : 0;
          setDashboardStat('vendors', formatDashboardCount(count));
        })
        .catch(() => {
          setDashboardStat('vendors', '--', 'Unavailable');
        })
    );
  }

  if (canSeeShipments) {
    tasks.push(
      fetchJSON('/api/shipments')
        .then(data => {
          const shipmentsByStatus = data?.shipmentsByStatus;
          let count = 0;
          let missingDocs = 0;
          let pickupStorage = 0;
          const todayIso = getDashboardTodayIso(window.CURRENT_ORG?.timezone);

          if (shipmentsByStatus && typeof shipmentsByStatus === 'object') {
            Object.values(shipmentsByStatus).forEach(list => {
              if (!Array.isArray(list)) return;
              list.forEach(shipment => {
                if (!shipment) return;
                count += 1;
                const missingInvoice = Number(shipment.has_shippers_invoice_doc) !== 1;
                const missingBol = Number(shipment.has_bol_doc) !== 1;
                if (missingInvoice || missingBol) {
                  missingDocs += 1;
                }
                const status = shipment.status || '';
                const readyForPickup = status === 'Cleared - Ready for Pickup';
                const storageDueDate = shipment.storage_due_date;
                const storagePaid = Number(shipment.storage_paid) === 1;
                const storageDue =
                  storageDueDate &&
                  !storagePaid &&
                  status !== 'Picked Up' &&
                  status !== 'Archived' &&
                  storageDueDate <= todayIso;
                if (readyForPickup || storageDue) {
                  pickupStorage += 1;
                }
              });
            });
          }

          setDashboardStat('shipments', formatDashboardCount(count));
          setDashboardTask('missing-docs', formatDashboardCount(missingDocs));
          setDashboardTask('pickup-storage', formatDashboardCount(pickupStorage));
        })
        .catch(() => {
          setDashboardStat('shipments', '--', 'Unavailable');
          setDashboardTask('missing-docs', '--', 'Unavailable');
          setDashboardTask('pickup-storage', '--', 'Unavailable');
        })
    );
  }

  if (canViewTimesheets) {
    tasks.push(
      fetchJSON(`/api/kiosk-sessions/today?date=${encodeURIComponent(getDashboardTodayIso(window.CURRENT_ORG?.timezone))}`)
        .then(list => {
          const sessions = Array.isArray(list) ? list : [];
          const openSessions = sessions.filter(session => !session?.ended_at);
          const openTimesheets = openSessions.length;
          const currentWorkers = openSessions.reduce((sum, session) => {
            const punches = Array.isArray(session?.open_punches) ? session.open_punches.length : 0;
            return sum + punches;
          }, 0);
          setDashboardStat('open-timesheets', formatDashboardCount(openTimesheets));
          setDashboardStat('current-workers', formatDashboardCount(currentWorkers));
        })
        .catch(() => {
          setDashboardStat('open-timesheets', '--', 'Unavailable');
          setDashboardStat('current-workers', '--', 'Unavailable');
        })
    );
  }

  if (canSeeShipments) {
    tasks.push(
      fetchJSON('/api/notifications?unread_only=1&limit=200')
        .then(res => {
          const notifications = Array.isArray(res?.notifications) ? res.notifications : [];
          const count = notifications.filter(item => item?.type === 'shipment_comment').length;
          setDashboardTask('unread-comments', formatDashboardCount(count));
        })
        .catch(() => {
          setDashboardTask('unread-comments', '--', 'Unavailable');
        })
    );
  }

  if (canViewPayroll) {
    tasks.push(
      fetchJSON('/api/employees?status=pending')
        .then(list => {
          const count = Array.isArray(list) ? list.length : 0;
          const qbConnected = window.QBO_STATUS && window.QBO_STATUS.qbConnected === false;
          setDashboardTask(
            'qbo-sync',
            formatDashboardCount(count),
            qbConnected ? 'QuickBooks not connected' : null
          );
        })
        .catch(() => {
          setDashboardTask('qbo-sync', '--', 'Unavailable');
        })
    );

    tasks.push(
      fetchJSON('/api/reports/payroll-runs')
        .then(list => {
          const rows = Array.isArray(list) ? list : [];
          const unresolvedRows = rows.filter(row => {
            const status = String(row?.status || '').toLowerCase();
            return status === 'failed' || status === 'partial';
          });
          const count = unresolvedRows.length;
          const latest = unresolvedRows.length ? unresolvedRows[0] : null;
          if (latest) {
            const start = latest.start_date || '';
            const end = latest.end_date || '';
            const period = start && end ? `${start} to ${end}` : 'selected period';
            const status = String(latest.status || '').toUpperCase() || 'PARTIAL';
            setDashboardTask(
              'payroll-issues',
              formatDashboardCount(count),
              `Run #${latest.id} (${period}) is ${status}. Resume to retry failed checks.`
            );
          } else {
            setDashboardTask('payroll-issues', formatDashboardCount(count));
          }
          setDashboardPayrollIssuesAction(latest);
        })
        .catch(() => {
          setDashboardTask('payroll-issues', '--', 'Unavailable');
          setDashboardPayrollIssuesAction(null);
        })
    );
  }

  await Promise.allSettled(tasks);
  dashboardSnapshotLoading = false;
}

function updateDashboardQboBadge(status = window.QBO_STATUS) {
  const pill = document.getElementById('dashboard-qbo-pill');
  if (!pill) return;

  pill.classList.remove('is-ok', 'is-warn', 'is-muted');
  const perms = window.CURRENT_ACCESS_PERMS || {};
  if (!perms.view_payroll) {
    pill.textContent = 'QuickBooks: Access required';
    pill.classList.add('is-muted');
    return;
  }

  if (!status || typeof status.qbConnected === 'undefined') {
    pill.textContent = 'QuickBooks: Checking...';
    pill.classList.add('is-muted');
    return;
  }

  if (status.qbConnected) {
    pill.textContent = 'QuickBooks: Connected';
    pill.classList.add('is-ok');
  } else {
    pill.textContent = 'QuickBooks: Not connected';
    pill.classList.add('is-warn');
  }
}

function setupDashboardQuickLinks() {
  const expandDashboardTargetCard = cardId => {
    if (!cardId) return;
    const card = document.getElementById(cardId);
    if (!card || card.classList.contains('hidden')) return;
    if (card.tagName === 'DETAILS') {
      card.open = true;
    }
    requestAnimationFrame(() => {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const openDashboardSection = (key, options = {}) => {
    if (!key) return;
    const navItem = document.querySelector(`.nav-item[data-section="${key}"]`);
    if (navItem) {
      navItem.click();
      const expandCardId = String(options?.expandCardId || '').trim();
      if (expandCardId) {
        // Click handlers may still be finishing section toggles; expand immediately and on next tick.
        expandDashboardTargetCard(expandCardId);
        setTimeout(() => expandDashboardTargetCard(expandCardId), 0);
      }
    }
  };

  const links = document.querySelectorAll('[data-dashboard-link]');
  links.forEach(link => {
    if (link.dataset.bound) return;
    link.dataset.bound = '1';
    link.addEventListener('click', () => {
      const key = link.dataset.dashboardLink;
      const payrollRunId = Number(link.dataset.payrollRunId);
      openDashboardSection(key, {
        expandCardId: link.dataset.dashboardExpandCard
      });
      if (
        key === 'payroll' &&
        Number.isFinite(payrollRunId) &&
        payrollRunId > 0 &&
        typeof window.openPayrollRunReviewById === 'function'
      ) {
        const openReview = () => {
          window.openPayrollRunReviewById(payrollRunId).catch(err => {
            console.warn('Failed to open payroll run review from dashboard link:', err);
          });
        };
        setTimeout(openReview, 0);
        setTimeout(openReview, 180);
      }
    });
  });

  document.querySelectorAll('.dashboard-checklist-item').forEach(item => {
    const action = item.querySelector('button[data-dashboard-link]');
    const key = action?.dataset?.dashboardLink || '';
    if (!key) return;

    item.dataset.checklistLink = key;
    item.classList.add('is-clickable');
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');

    if (item.dataset.checklistBound) return;
    item.dataset.checklistBound = '1';

    const goToLinkedSection = () => {
      openDashboardSection(item.dataset.checklistLink || '');
    };

    item.addEventListener('click', event => {
      // Let explicit nested actions handle their own click.
      const nestedAction = event.target.closest('[data-dashboard-link]');
      if (nestedAction && nestedAction !== item) return;
      goToLinkedSection();
    });

    item.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      goToLinkedSection();
    });
  });
}

function applyDashboardLinkVisibility() {
  const links = document.querySelectorAll('[data-dashboard-link]');
  links.forEach(link => {
    const key = link.dataset.dashboardLink;
    if (!key) return;
    const navItem = document.querySelector(`.nav-item[data-section="${key}"]`);
    const shouldHide = !navItem;
    link.classList.toggle('hidden', shouldHide);
    if (shouldHide) {
      link.setAttribute('disabled', 'disabled');
    } else {
      link.removeAttribute('disabled');
    }
  });

  document.querySelectorAll('.dashboard-link-card').forEach(card => {
    const actions = Array.from(card.querySelectorAll('[data-dashboard-link]'));
    const hasVisible = actions.some(btn => !btn.classList.contains('hidden'));
    if (!hasVisible) {
      card.classList.add('hidden');
    }
  });

  document.querySelectorAll('.dashboard-checklist-item').forEach(item => {
    const action = item.querySelector('[data-dashboard-link]');
    if (!action) return;
    if (action.classList.contains('hidden')) {
      item.classList.add('hidden');
    }
  });
}

/* ───────── 2. QUICKBOOKS STATUS & SYNC ───────── */

async function checkStatus() {
  const statusEl = document.getElementById('qb-status');
  const disconnectBtn = document.getElementById('disconnect-quickbooks');
  try {
    const res = await fetch('/api/status', { credentials: 'same-origin' });
    if (res.status === 401 || res.status === 403) {
      updateDashboardQboBadge();
      if (disconnectBtn) {
        disconnectBtn.style.display = 'none';
      }
      if (statusEl) {
        statusEl.textContent = 'QuickBooks status unavailable.';
      }
      const activeNav = document.querySelector('.nav-item.active');
      if (activeNav && typeof updateQbCardForSection === 'function') {
        updateQbCardForSection(activeNav.dataset.section);
      }
      return;
    }
    const data = await res.json();
    window.QBO_STATUS = data;
    updateDashboardQboBadge(data);
    if (disconnectBtn) {
      disconnectBtn.style.display = data.qbConnected ? '' : 'none';
    }
    if (statusEl) {
      if (data.qbConnected) {
        if (data.qbConnectionWarning) {
          statusEl.textContent = `Connected to QuickBooks, but last check failed: ${data.qbConnectionWarning}`;
        } else {
          statusEl.textContent = 'Connected to QuickBooks. Use Connect to refresh authorization.';
        }
      } else {
        if (data.qbConnectionWarning) {
          statusEl.textContent = data.qbConnectionWarning;
        } else {
          statusEl.textContent = 'Not connected to QuickBooks. Click Connect to authorize.';
        }
      }
    }
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = 'Error checking status: ' + err.message;
    }
    updateDashboardQboBadge();
    if (disconnectBtn) {
      disconnectBtn.style.display = 'none';
    }
  }

  const activeNav = document.querySelector('.nav-item.active');
  if (activeNav && typeof updateQbCardForSection === 'function') {
    updateQbCardForSection(activeNav.dataset.section);
  }
}

function updateQbCardForSection(key) {
  const employeesBtn = document.getElementById('sync-employees');
  const vendorsBtn = document.getElementById('sync-vendors');
  const projectsBtn = document.getElementById('sync-projects');
  const accountsBtn = document.getElementById('sync-accounts');
  const syncButtons = [employeesBtn, vendorsBtn, projectsBtn, accountsBtn].filter(Boolean);

  syncButtons.forEach(btn => {
    btn.style.display = 'none';
    btn.disabled = false;
    btn.title = '';
    btn.onclick = null;
  });

  const onboardingBlocksQb =
    document.body.classList.contains('onboarding-first') && !window.ONBOARDING_SHOW_QB;
  if (onboardingBlocksQb) {
    return;
  }
  if (key !== 'settings') {
    return;
  }
  if (!window.CURRENT_IS_SUPER_ADMIN) {
    return;
  }

  const qboConnected = !!window.QBO_STATUS?.qbConnected;
  const disconnectedTitle = qboConnected ? '' : 'Connect QuickBooks first.';
  const showSyncButton = (btn, text, onClick) => {
    if (!btn) return;
    btn.style.display = '';
    btn.textContent = text;
    btn.disabled = !qboConnected;
    btn.title = disconnectedTitle;
    btn.onclick = onClick;
  };

  showSyncButton(employeesBtn, 'Sync Employees', () => syncRoute('/api/sync/employees'));
  showSyncButton(vendorsBtn, 'Sync Vendors', () => syncRoute('/api/sync/vendors'));
  showSyncButton(projectsBtn, 'Sync Projects', () => syncRoute('/api/sync/projects'));
  showSyncButton(accountsBtn, 'Sync Payroll Accounts', () =>
    syncRoute('/api/sync/payroll-accounts', async () => {
      if (typeof loadPayrollSettings === 'function') {
        await loadPayrollSettings();
      }
    })
  );
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


async function syncRoute(route, onSuccess, options = {}) {
  if (onSuccess && typeof onSuccess === 'object') {
    options = onSuccess;
    onSuccess = null;
  }
  const silent = !!options.silent;
  const statusEl = options.statusEl || null;
  const throwOnError = !!options.throwOnError;
  const indicator   = document.getElementById('qb-sync-indicator');
  const employeesBtn = document.getElementById('sync-employees');
  const vendorsBtn  = document.getElementById('sync-vendors');
  const projectsBtn = document.getElementById('sync-projects');
  const accountsBtn = document.getElementById('sync-accounts');
  const connectBtn  = document.getElementById('connect');
  let delayUnlockMs = 0;

  const getSyncErrorMessage = (payload, fallback) => {
    const raw = payload && (payload.qbo_error || payload.error || payload.message);
    const msg = typeof raw === 'string' ? raw.trim() : '';
    const reason = typeof payload?.reason === 'string' ? payload.reason.trim() : '';
    const errorCode = typeof payload?.error_code === 'string' ? payload.error_code.trim() : '';
    const message = msg || (typeof payload?.message === 'string' ? payload.message.trim() : '');
    const normalized = message.toLowerCase();

    if (errorCode === '003100' || normalized.includes('applicationauthorizationfailed')) {
      return 'QuickBooks authorization is not valid for this company. Reconnect using a QuickBooks Company Admin and confirm the app is authorized.';
    }

    if (!msg) return fallback;
    return reason ? `${msg} (${reason})` : msg;
  };

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
        const msg = getSyncErrorMessage(data, 'QuickBooks sync is temporarily unavailable.');
        throw new Error(`${msg} Please retry in ${backoffSeconds} seconds.`);
      }
      const msg = getSyncErrorMessage(data, 'Sync failed.');
      throw new Error(msg);
    }
    resetQboSyncBackoff(route);
    const fallbackMessage =
      typeof data.count === 'number' ? `Synced ${data.count} record(s).` : 'Sync complete.';
    if (!silent) {
      alert(data.message || fallbackMessage);
    } else if (statusEl) {
      statusEl.textContent = data.message || fallbackMessage;
      statusEl.style.color = 'green';
    }

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
    if (!silent) {
      alert('Error: ' + err.message);
    } else if (statusEl) {
      statusEl.textContent = err.message || 'Sync failed.';
      statusEl.style.color = 'crimson';
    }
    if (typeof checkStatus === 'function') {
      try {
        await checkStatus();
      } catch (statusErr) {
        console.warn('Failed to refresh QuickBooks status:', statusErr);
      }
    }
    if (throwOnError) {
      throw err;
    }
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

function deriveFieldReviewState(entry = {}) {
  const status = String(entry.resolved_status || '').toLowerCase();
  const resolvedFlag = entry.resolved === 1 || entry.resolved === true || entry.resolved === '1';
  const isRejected = status === 'rejected';
  const isModified = status === 'modified';
  const isApproved = status === 'approved';
  const isReviewed = resolvedFlag || isRejected || isModified || isApproved;
  let label = 'Pending review';
  if (isRejected) {
    label = 'Rejected';
  } else if (isModified) {
    label = 'Modified';
  } else if (isApproved) {
    label = 'Approved';
  } else if (resolvedFlag) {
    label = 'Reviewed';
  }
  return { label, isReviewed, isRejected, isModified, isApproved };
}

function getTimeEntryFlagsBounds(entries = []) {
  let minDate = '';
  let maxDate = '';

  entries.forEach(entry => {
    const start = entry?.start_date || entry?.end_date || '';
    const end = entry?.end_date || entry?.start_date || '';
    if (start) {
      if (!minDate || start < minDate) minDate = start;
      if (!maxDate || start > maxDate) maxDate = start;
    }
    if (end) {
      if (!minDate || end < minDate) minDate = end;
      if (!maxDate || end > maxDate) maxDate = end;
    }
  });

  if (!minDate || !maxDate) return null;
  return { start: minDate, end: maxDate };
}

async function loadTimeEntryFlagsMap(filters = {}, entries = []) {
  const params = new URLSearchParams();
  let start = filters.start || '';
  let end = filters.end || '';

  if (start && !end) {
    end = start;
  } else if (!start && end) {
    start = end;
  }

  if (!start || !end) {
    const bounds = getTimeEntryFlagsBounds(entries);
    if (bounds) {
      start = bounds.start;
      end = bounds.end;
    } else {
      const today = new Date().toISOString().slice(0, 10);
      start = today;
      end = today;
    }
  }

  params.set('start', start);
  params.set('end', end);
  if (filters.employee_id) params.set('employee_id', filters.employee_id);
  if (filters.project_id) params.set('project_id', filters.project_id);

  params.set('hide_resolved', '0');

  try {
    const data = await fetchJSON(`/api/time-exceptions?${params.toString()}`);
    const map = new Map();
    (Array.isArray(data) ? data : []).forEach(row => {
      const entryId =
        row.time_entry_id ||
        (row.source === 'time_entry' ? row.id : null);
      if (!entryId) return;

      const list = map.get(String(entryId)) || [];
      const flags = Array.isArray(row.flags) ? [...row.flags] : [];
      const autoReason = formatAutoClockoutReason(row.auto_clock_out_reason);
      if (autoReason) {
        flags.push(`Auto clock-out: ${autoReason}`);
      }
      flags.forEach(flag => {
        const text = String(flag || '').trim();
        if (!text) return;
        if (!list.includes(text)) {
          list.push(text);
        }
      });
      map.set(String(entryId), list);
    });
    return map;
  } catch (err) {
    console.warn('Failed to load time entry flags:', err?.message || err);
    return new Map();
  }
}

	async function loadTimeEntriesTable(filters = {}) {
	  const tbody   = document.getElementById('time-table-body');
	  const heading = document.getElementById('time-entries-heading');
	  if (!tbody) return;

  // columns: Employee, Project, Date, Clock in, Clock out, Hours, Flags, Field Review, Approve
  tbody.innerHTML = '<tr><td colspan="9">Loading...</td></tr>';
  timeEntryApprovalSelection.clear();
  timeEntryApprovalNotes.clear();
  updateApproveSelectedButton();

  const hasFilters = !!(
    filters.start ||
    filters.end ||
    filters.employee_id ||
    filters.project_id
  );

  if (heading) {
    heading.textContent = hasFilters ? 'Selected Entries' : "Today's Entries";
  }

  const page = Number(filters.page || timeEntryCurrentPage || 1);
  const pageSize = Number(filters.page_size || timeEntryPageSize || 25);
  timeEntryCurrentPage = Number.isFinite(page) && page > 0 ? page : 1;
  timeEntryLastFilters = { ...filters, page: timeEntryCurrentPage, page_size: pageSize };

  const params = [];
  if (filters.start)       params.push(`start=${encodeURIComponent(filters.start)}`);
  if (filters.end)         params.push(`end=${encodeURIComponent(filters.end)}`);
  if (filters.employee_id) params.push(`employee_id=${encodeURIComponent(filters.employee_id)}`);
  if (filters.project_id)  params.push(`project_id=${encodeURIComponent(filters.project_id)}`);
  if (filters.all_dates)   params.push('all_dates=1');
  if (filters.hide_paid)   params.push('hide_paid=1');
  if (filters.hide_approved) params.push('hide_payroll_approved=1');
  params.push(`limit=${encodeURIComponent(pageSize)}`);
  params.push(`offset=${encodeURIComponent((timeEntryCurrentPage - 1) * pageSize)}`);

  let url = '/api/time-entries';
  if (params.length) {
    url += '?' + params.join('&');
  }

  try {
    const data = await fetchJSONWithTimeout(url, {}, 12000);
    const entries = Array.isArray(data) ? data : (data && data.rows) ? data.rows : [];
    const total = !Array.isArray(data) && data && Number.isFinite(Number(data.total)) ? Number(data.total) : entries.length;

    const pageStatus = document.getElementById('te-page-status');
    const prevBtn = document.getElementById('te-page-prev');
    const nextBtn = document.getElementById('te-page-next');
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (pageStatus) pageStatus.textContent = `Page ${timeEntryCurrentPage} of ${totalPages}`;
    if (prevBtn) prevBtn.disabled = timeEntryCurrentPage <= 1;
    if (nextBtn) nextBtn.disabled = timeEntryCurrentPage >= totalPages;

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

      const reviewState = deriveFieldReviewState(e);
      const canModify = !!(window.CURRENT_ACCESS_PERMS && window.CURRENT_ACCESS_PERMS.modify_time);
      const reviewBy = e.resolved_by || '';
      const reviewAt = e.resolved_at ? formatDateTimeLocal(e.resolved_at) : '';
      let reviewHtml = `<div>${reviewState.label}</div>`;
      if (reviewState.isReviewed) {
        if (reviewBy) {
          reviewHtml += `<div class="text-xs text-gray-600">by ${escapeHTML(reviewBy)}</div>`;
        }
        if (reviewAt) {
          reviewHtml += `<div class="text-xs text-gray-600">${escapeHTML(reviewAt)}</div>`;
        }
      }

	      const flagsStr = '…';
	      let actionHtml = '—';
	      const canApprove = !!(window.CURRENT_ACCESS_PERMS && window.CURRENT_ACCESS_PERMS.approve_time);
	      const isPayrollApproved = String(e.approval_status || '').toLowerCase() === 'approved';
	      if (canApprove) {
	        if (isPayrollApproved) {
	          const approvedAt = e.approved_at ? formatDateTimeLocal(e.approved_at) : '';
	          const approvedBy = e.approved_by_name || e.approved_by_employee_id || '';
	          const titleParts = [];
	          if (approvedBy) titleParts.push(`by ${approvedBy}`);
	          if (approvedAt) titleParts.push(`at ${approvedAt}`);
	          const title = titleParts.length
	            ? ` title="${escapeHTML(`Approved ${titleParts.join(' ')}`)}"`
	            : '';
	          actionHtml = `<span class="te-approved-badge"${title}>Approved</span>`;
	        } else {
	          actionHtml = `
	            <label class="checkbox-inline">
	              <input type="checkbox" class="te-approve-checkbox" data-approve-id="${e.id}" />
	            </label>
	          `;
	        }
	      } else {
	        actionHtml = '<span class="text-xs text-gray-600">No payroll approval access</span>';
	      }

      const clockInLabel = formatTime12(e.start_time);
      const clockOutLabel = formatTime12(e.end_time);

      // ─────────────────────────────────────────────
      // BUILD THE TABLE ROW
      // ─────────────────────────────────────────────
      tr.innerHTML = `
        <td>${e.employee_name || ''}</td>
        <td>${e.project_name || ''}</td>
        <td>${dateLabel}</td>
        <td>${clockInLabel}</td>
        <td>${clockOutLabel}</td>
        <td>${Number(e.hours || 0).toFixed(2)}</td>
        <td class="te-flags-cell" data-entry-id="${e.id}">${escapeHTML(flagsStr)}</td>
        <td>${reviewHtml}</td>
        <td>${actionHtml}</td>
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
      tr.dataset.fieldReviewed = reviewState.isReviewed ? '1' : '0';
      tr.dataset.fieldReviewRejected = reviewState.isRejected ? '1' : '0';

      tr.addEventListener('click', (evt) => {
        if (evt.target && evt.target.closest('button, input, label, .checkbox-inline')) {
          return;
        }
        const flagsCell = tr.querySelector('.te-flags-cell');
        const flagsVal = flagsCell ? flagsCell.textContent : 'None';
        const flags = flagsVal && flagsVal !== '…' && flagsVal !== 'None'
          ? flagsVal.split(',').map(s => s.trim()).filter(Boolean)
          : [];
        showTimeEntryDetails({ entry: e, flags, rowElement: tr });
      });

      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.te-approve-checkbox').forEach(cb => {
      cb.addEventListener('change', handleTimeEntryApproveToggle);
      cb.addEventListener('click', evt => evt.stopPropagation());
    });

    // Load flags asynchronously so table doesn't hang if flags are slow.
    try {
      const flagsMap = await loadTimeEntryFlagsMap(filters, entries);
      tbody.querySelectorAll('.te-flags-cell').forEach(cell => {
        const entryId = cell.getAttribute('data-entry-id');
        if (!entryId) return;
        const flags = flagsMap.get(String(entryId)) || [];
        cell.textContent = flags.length ? flags.join(', ') : 'None';
      });
    } catch (err) {
      tbody.querySelectorAll('.te-flags-cell').forEach(cell => {
        if (cell.textContent === '…') cell.textContent = 'None';
      });
    }

  } catch (err) {
    console.error('Error loading time entries:', err.message);
    tbody.innerHTML =
      '<tr><td colspan="9">Error loading time entries</td></tr>';
  }
}

function resetTimeEntriesReportPagination() {
  timeEntriesReportCurrentPage = 1;
}

function getTimeEntriesReportFiltersFromUi() {
  const empFilter   = document.getElementById('ter-filter-employee');
  const projFilter  = document.getElementById('ter-filter-project');
  const startFilter = document.getElementById('ter-filter-start');
  const endFilter   = document.getElementById('ter-filter-end');

  return {
    employee_id: empFilter && empFilter.value ? empFilter.value : '',
    project_id:  projFilter && projFilter.value ? projFilter.value : '',
    start:       startFilter && startFilter.value ? startFilter.value : '',
    end:         endFilter && endFilter.value ? endFilter.value : ''
  };
}

function hasActiveTimeEntriesReportFilters(filters = {}) {
  return !!(
    (filters.employee_id && String(filters.employee_id).trim()) ||
    (filters.project_id && String(filters.project_id).trim())  ||
    (filters.start && String(filters.start).trim())            ||
    (filters.end && String(filters.end).trim())
  );
}

async function loadTimeEntriesReportTable(filters = {}) {
  const tbody   = document.getElementById('time-entries-report-body');
  const head    = document.getElementById('time-entries-report-head');
  const heading = document.getElementById('time-entries-report-heading');
  const msgEl   = document.getElementById('time-entries-report-message');
  if (!tbody) return;

  const canViewPayroll = !!(window.CURRENT_ACCESS_PERMS && window.CURRENT_ACCESS_PERMS.view_payroll);
  const colCount = canViewPayroll ? 9 : 6;

  if (head) {
    head.innerHTML = `
      <tr>
        <th>Employee</th>
        <th>Project</th>
        <th>Date</th>
        <th>Clock in</th>
        <th>Clock out</th>
        <th>Hours</th>
        ${
          canViewPayroll
            ? '<th>Total Pay</th><th>Paid?</th><th>Date Paid</th>'
            : ''
        }
      </tr>
    `;
  }

  tbody.innerHTML = `<tr><td colspan="${colCount}">Loading...</td></tr>`;
  if (msgEl) msgEl.textContent = '';

  const hasFilters = hasActiveTimeEntriesReportFilters(filters);
  if (heading) {
    heading.textContent = hasFilters ? 'Selected Entries' : "Today's Entries";
  }

  const page = Number(filters.page || timeEntriesReportCurrentPage || 1);
  const pageSize = Number(filters.page_size || timeEntriesReportPageSize || 50);
  timeEntriesReportCurrentPage = Number.isFinite(page) && page > 0 ? page : 1;
  timeEntriesReportLastFilters = { ...filters, page: timeEntriesReportCurrentPage, page_size: pageSize };

  const params = new URLSearchParams();
  if (filters.start)       params.set('start', filters.start);
  if (filters.end)         params.set('end', filters.end);
  if (filters.employee_id) params.set('employee_id', filters.employee_id);
  if (filters.project_id)  params.set('project_id', filters.project_id);
  params.set('limit', String(pageSize));
  params.set('offset', String((timeEntriesReportCurrentPage - 1) * pageSize));

  const pageStatus = document.getElementById('ter-page-status');
  const prevBtn = document.getElementById('ter-page-prev');
  const nextBtn = document.getElementById('ter-page-next');

  try {
    const data = await fetchJSONWithTimeout(`/api/time-entries?${params.toString()}`, {}, 12000);
    const entries = Array.isArray(data) ? data : (data && data.rows) ? data.rows : [];
    const total = !Array.isArray(data) && data && Number.isFinite(Number(data.total))
      ? Number(data.total)
      : entries.length;

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (pageStatus) pageStatus.textContent = `Page ${timeEntriesReportCurrentPage} of ${totalPages}`;
    if (prevBtn) prevBtn.disabled = timeEntriesReportCurrentPage <= 1;
    if (nextBtn) nextBtn.disabled = timeEntriesReportCurrentPage >= totalPages;

    if (!entries.length) {
      tbody.innerHTML = `<tr><td colspan="${colCount}">(no time entries for this selection)</td></tr>`;
      return;
    }

    tbody.innerHTML = '';
    entries.forEach(entry => {
      let dateLabel = '';
      if (entry.start_date && entry.end_date) {
        dateLabel = entry.start_date === entry.end_date
          ? formatDateUS(entry.start_date)
          : `${formatDateUS(entry.start_date)} → ${formatDateUS(entry.end_date)}`;
      } else if (entry.start_date) {
        dateLabel = formatDateUS(entry.start_date);
      } else if (entry.end_date) {
        dateLabel = formatDateUS(entry.end_date);
      }

      const clockInLabel = formatTime12(entry.start_time);
      const clockOutLabel = formatTime12(entry.end_time);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${entry.employee_name || ''}</td>
        <td>${entry.project_name || ''}</td>
        <td>${dateLabel}</td>
        <td>${clockInLabel}</td>
        <td>${clockOutLabel}</td>
        <td>${Number(entry.hours || 0).toFixed(2)}</td>
        ${
          canViewPayroll
            ? `
              <td>${formatMoney(Number(entry.total_pay || 0))}</td>
              <td>${entry.paid ? 'Yes' : 'No'}</td>
              <td>${entry.paid_date ? formatDateUS(entry.paid_date) : '—'}</td>
            `
            : ''
        }
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading time entries report:', err?.message || err);
    tbody.innerHTML = `<tr><td colspan="${colCount}">Error loading time entries</td></tr>`;
    if (msgEl) {
      msgEl.textContent = err?.message || 'Error loading time entries.';
      msgEl.style.color = 'crimson';
    }
  }
}

function entryRequiresNote(row) {
  if (!row) return false;
  const flagsCell = row.querySelector('.te-flags-cell');
  const flagsVal = flagsCell ? String(flagsCell.textContent || '').trim() : '';
  return !!(flagsVal && flagsVal !== 'None' && flagsVal !== '—' && flagsVal !== '…');
}

async function handleTimeEntryApproveToggle(evt) {
  const cb = evt.currentTarget;
  const id = cb?.getAttribute('data-approve-id');
  if (!id) return;
  if (cb.checked) {
    const row = cb.closest('tr');
    if (row && row.dataset.fieldReviewed !== '1') {
      const ok = await showTimeEntryReviewWarningModal(
        'Field review is still pending for this entry. Approve for payroll anyway?'
      );
      if (!ok) {
        cb.checked = false;
        timeEntryApprovalSelection.delete(String(id));
        updateApproveSelectedButton();
        return;
      }
    }

    if (entryRequiresNote(row)) {
      const noteInput = await showTimeEntryApproveNoteModal({
        message: 'A note is required because this entry has flags or manual edits. Enter a note to continue.',
        required: true
      });
      if (noteInput === null) {
        cb.checked = false;
        timeEntryApprovalSelection.delete(String(id));
        updateApproveSelectedButton();
        return;
      }
      const note = String(noteInput || '').trim();
      if (!note) {
        showTimeEntryNoteModal(
          'A note is required because this entry has flags or manual edits. Enter a note to continue.'
        );
        cb.checked = false;
        timeEntryApprovalSelection.delete(String(id));
        updateApproveSelectedButton();
        return;
      }
      timeEntryApprovalNotes.set(String(id), note);
    }
  }
  if (cb.checked) {
    timeEntryApprovalSelection.add(String(id));
  } else {
    timeEntryApprovalSelection.delete(String(id));
    timeEntryApprovalNotes.delete(String(id));
  }
  updateApproveSelectedButton();
}

function updateApproveSelectedButton() {
  const btn = document.getElementById('te-approve-selected');
  if (!btn) return;
  const count = timeEntryApprovalSelection.size;
  btn.disabled = count === 0;
  btn.textContent =
    count > 0
      ? `Approve selected for payroll (${count})`
      : 'Approve selected for payroll';
}

function setApproveSelectionForVisibleRows(checked) {
  const boxes = document.querySelectorAll('.te-approve-checkbox');
  boxes.forEach(cb => {
    cb.checked = checked;
    const id = cb.getAttribute('data-approve-id');
    if (!id) return;
    if (checked) {
      timeEntryApprovalSelection.add(String(id));
    } else {
      timeEntryApprovalSelection.delete(String(id));
    }
  });
  updateApproveSelectedButton();
}

function isApproveNoteRequiredError(err) {
  if (!err || err.status !== 400) return false;
  const msg = String(err.message || '').toLowerCase();
  return msg.includes('note') && msg.includes('required');
}

async function approveSelectedTimeEntries() {
  const ids = Array.from(timeEntryApprovalSelection);
  if (!ids.length) return;

  if (!navigator.onLine) {
    showTimeEntryNoteModal('Payroll approval requires an online connection.');
    return;
  }

  const approveBtn = document.getElementById('te-approve-selected');
  if (approveBtn) {
    approveBtn.disabled = true;
  }

  try {
    // Build a stable map of currently-visible approve rows so we can read flags/updated_at safely.
    const rowMap = new Map();
    document.querySelectorAll('.te-approve-checkbox').forEach(cb => {
      const id = cb.getAttribute('data-approve-id');
      const row = cb.closest('tr');
      if (!id || !row) return;
      rowMap.set(String(id), row);
    });

    let approvedCount = 0;
    const approvedIds = [];

    for (const id of ids) {
      if (approveBtn) {
        approveBtn.textContent = `Approving ${approvedCount + 1} of ${ids.length}...`;
      }

      const row = rowMap.get(String(id)) || null;

      if (entryRequiresNote(row) && !timeEntryApprovalNotes.get(String(id))) {
        const noteInput = await showTimeEntryApproveNoteModal({
          message: 'A note is required because this entry has flags or manual edits. Enter a note to continue.',
          required: true
        });
        if (noteInput === null) break;

        const note = String(noteInput || '').trim();
        if (!note) {
          showTimeEntryNoteModal(
            'A note is required because this entry has flags or manual edits. Enter a note to continue.'
          );
          break;
        }
        timeEntryApprovalNotes.set(String(id), note);
      }

      const payload = {};
      const note = timeEntryApprovalNotes.get(String(id));
      if (note) payload.note = note;
      const updatedAt = row && row.dataset && row.dataset.updatedAt ? row.dataset.updatedAt : '';
      if (updatedAt) payload.if_match_updated_at = updatedAt;

      try {
        await fetchJSON(`/api/time-entries/${encodeURIComponent(id)}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (err) {
        // If the server requires a note that we didn't pre-detect, prompt and retry once.
        if (isApproveNoteRequiredError(err) && !payload.note) {
          const noteInput = await showTimeEntryApproveNoteModal({
            message: err?.message || 'A note is required to approve this entry. Enter a note to continue.',
            required: true
          });
          if (noteInput === null) break;

          const noteVal = String(noteInput || '').trim();
          if (!noteVal) {
            showTimeEntryNoteModal('A note is required to approve this entry.');
            break;
          }

          timeEntryApprovalNotes.set(String(id), noteVal);
          payload.note = noteVal;

          try {
            await fetchJSON(`/api/time-entries/${encodeURIComponent(id)}/approve`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
          } catch (retryErr) {
            showTimeEntryNoteModal(retryErr?.message || `Failed to approve entry ${id}.`);
            break;
          }
        } else {
          showTimeEntryNoteModal(err?.message || `Failed to approve entry ${id}.`);
          break;
        }
      }

      approvedIds.push(String(id));
      approvedCount += 1;
    }

    if (approvedCount) {
      approvedIds.forEach(id => {
        timeEntryApprovalSelection.delete(String(id));
        timeEntryApprovalNotes.delete(String(id));
      });
      showToast(`Approved ${approvedCount} ${approvedCount === 1 ? 'entry' : 'entries'} for payroll.`);
      const filters = getTimeEntryFiltersFromUi();
      resetTimeEntryPagination();
      if (hasActiveTimeEntryFilters(filters)) {
        await loadTimeEntriesTable(filters);
      } else {
        await loadTimeEntriesTable();
      }
    }
  } finally {
    if (approveBtn) {
      updateApproveSelectedButton();
    }
  }
}

let currentTimeEntryDetail = null;
let timeEntryPunchesRequestId = 0;

function formatDetailValue(value) {
  if (value == null || value === '') return '—';
  return String(value);
}

let toastTimer = null;
function showToast(message, { durationMs = 2500 } = {}) {
  const el = document.getElementById('global-toast');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.add('hidden');
  }, durationMs);
}

async function fetchJSONWithTimeout(url, options = {}, timeoutMs = 10000) {
  let timer = null;
  try {
    return await Promise.race([
      fetchJSON(url, options),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Request timed out.')), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function formatTime12(value) {
  if (!value) return '—';
  const raw = String(value).trim();
  const match = /^([0-1]?\d|2[0-3]):([0-5]\d)/.exec(raw);
  if (!match) return raw;
  let hours = Number(match[1]);
  const minutes = match[2];
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${minutes} ${ampm}`;
}

function formatAutoClockoutReason(reason) {
  const raw = String(reason || '').trim().toLowerCase();
  if (!raw) return '';
  const map = {
    midnight_auto: 'Midnight auto-close',
    catch_up_auto: 'Catch-up auto-close',
    daily_max: 'Daily max hours',
    weekly_max: 'Weekly max hours'
  };
  return map[raw] || reason;
}

function formatPunchDateTime(value) {
  if (!value) return '—';
  return formatDateTimeLocal(value);
}

async function loadTimeEntryPunches(entryId) {
  const grid = document.getElementById('time-entry-punches-grid');
  if (!grid) return;

  const requestId = ++timeEntryPunchesRequestId;
  grid.innerHTML = '<div class="time-entry-punches-loading">Loading punches...</div>';

  try {
    const rows = await fetchJSON(`/api/time-entries/${encodeURIComponent(entryId)}/punches`);
    if (requestId !== timeEntryPunchesRequestId) return;

    if (!Array.isArray(rows) || !rows.length) {
      grid.innerHTML = '<div class="time-entry-punches-empty">No punches recorded.</div>';
      return;
    }

    grid.innerHTML = `
      <div class="time-entry-punches-header">Clock in</div>
      <div class="time-entry-punches-header">Clock-in device</div>
      <div class="time-entry-punches-header">Clock out</div>
      <div class="time-entry-punches-header">Clock-out device</div>
      ${rows.map(row => {
        const clockIn = formatPunchDateTime(row.clock_in_ts);
        const clockOut = row.clock_out_ts ? formatPunchDateTime(row.clock_out_ts) : 'Open';
        const clockInDevice = row.device_id ? escapeHTML(String(row.device_id)) : '—';
        const outDeviceRaw = row.clock_out_device_id
          ? String(row.clock_out_device_id)
          : row.clock_out_ts && row.device_id
            ? String(row.device_id)
            : '';
        const clockOutDevice = outDeviceRaw ? escapeHTML(outDeviceRaw) : '—';
        return `
          <div class="time-entry-punches-cell">${escapeHTML(clockIn)}</div>
          <div class="time-entry-punches-cell">${clockInDevice}</div>
          <div class="time-entry-punches-cell">${escapeHTML(clockOut)}</div>
          <div class="time-entry-punches-cell">${clockOutDevice}</div>
        `;
      }).join('')}
    `;
  } catch (err) {
    if (requestId !== timeEntryPunchesRequestId) return;
    grid.innerHTML = '<div class="time-entry-punches-empty">Unable to load punches.</div>';
  }
}

function showTimeEntryDetails({ entry, flags = [], rowElement } = {}) {
  if (!entry) return;
  currentTimeEntryDetail = { entry, rowElement };

  const overlay = document.getElementById('time-entry-detail-overlay');
  const panel = document.getElementById('time-entry-detail-panel');
  const title = document.getElementById('time-entry-detail-title');
  const sub = document.getElementById('time-entry-detail-sub');
  const body = document.getElementById('time-entry-detail-body');
  const editContainer = document.getElementById('time-entry-edit-container');
  const editBtn = document.getElementById('time-entry-detail-edit');

  if (!panel || !body) return;

  if (title) {
    title.textContent = `Entry #${entry.id}`;
  }
  if (sub) {
    sub.textContent = `${entry.employee_name || 'Employee'} • ${entry.project_name || 'No project'}`;
  }

  const dateLabel = entry.start_date
    ? (entry.start_date === entry.end_date ? formatDateUS(entry.start_date) : `${formatDateUS(entry.start_date)} → ${formatDateUS(entry.end_date)}`)
    : '—';
  const timeLabel = entry.start_time || entry.end_time
    ? `${formatTime12(entry.start_time)} → ${formatTime12(entry.end_time)}`
    : '—';
  const fieldStatus = deriveFieldReviewState(entry).label;
  const payrollStatus = String(entry.approval_status || '').toLowerCase() === 'approved' ? 'Approved' : 'Pending';

  const sections = [
    {
      title: 'Entry Details',
      items: [
        { label: 'Entry ID', value: entry.id },
        { label: 'Employee', value: entry.employee_name || '' },
        { label: 'Project', value: entry.project_name || '' },
        { label: 'Date', value: dateLabel },
        { label: 'Time', value: timeLabel },
        { label: 'Hours', value: entry.hours != null ? Number(entry.hours).toFixed(2) : '—' },
        { label: 'Flags', value: flags.length ? flags.join(', ') : 'None' },
        { label: 'Last Updated', value: entry.updated_at ? formatDateTimeLocal(entry.updated_at) : '—' }
      ]
    },
    {
      title: 'Field Review',
      items: [
        { label: 'Status', value: fieldStatus },
        { label: 'Reviewed By', value: entry.resolved_by || '—' },
        { label: 'Reviewed At', value: entry.resolved_at ? formatDateTimeLocal(entry.resolved_at) : '—' },
        { label: 'Notes', value: entry.resolved_note || '—' }
      ],
      includeChanges: true
    },
    {
      title: 'Payroll Approval',
      items: [
        { label: 'Status', value: payrollStatus },
        { label: 'Approved By', value: entry.approved_by_name || entry.approved_by_employee_id || '—' },
        { label: 'Approved At', value: entry.approved_at ? formatDateTimeLocal(entry.approved_at) : '—' },
        { label: 'Notes', value: entry.approval_note || '—' }
      ]
    }
  ];

  const sectionHtml = sections
    .map(section => {
      const itemsHtml = section.items
        .map(item => {
          return `
            <div>
              <div class="detail-label">${escapeHTML(item.label)}</div>
              <div class="detail-value">${escapeHTML(formatDetailValue(item.value))}</div>
            </div>
          `;
        })
        .join('');
      const changesHtml = section.includeChanges
        ? `
          <div id="time-entry-change-section" class="time-entry-change-section hidden">
            <div class="time-entry-detail-section-title">Field Review Changes</div>
            <div class="time-entry-change-meta" id="time-entry-change-meta"></div>
            <div class="time-entry-change-grid" id="time-entry-change-grid"></div>
          </div>
        `
        : '';
      return `
        <div class="time-entry-detail-section">
          <h4 class="time-entry-detail-section-title">${escapeHTML(section.title)}</h4>
          <div class="time-entry-detail-grid">
            ${itemsHtml}
          </div>
          ${changesHtml}
        </div>
      `;
    })
    .join('');

  const punchesHtml = `
    <div class="time-entry-detail-section">
      <h4 class="time-entry-detail-section-title">Punches</h4>
      <div id="time-entry-punches-grid" class="time-entry-punches-grid">
        <div class="time-entry-punches-loading">Loading punches...</div>
      </div>
    </div>
  `;

  body.innerHTML = sectionHtml + punchesHtml;
  loadTimeEntryChangeSummary(entry.id);
  loadTimeEntryPunches(entry.id);

  if (editContainer) {
    editContainer.classList.add('hidden');
  }
  body.classList.remove('hidden');

  if (editBtn) {
    editBtn.disabled = !rowElement;
  }

  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
  }
}

function closeTimeEntryDetails() {
  const overlay = document.getElementById('time-entry-detail-overlay');
  if (timeEntryEditInModal) {
    restoreTimeEntryFormToCard();
  }
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
  }
  currentTimeEntryDetail = null;
}

function showTimeEntryNoteModal(message) {
  const backdrop = document.getElementById('time-entry-note-backdrop');
  const modal = document.getElementById('time-entry-note-modal');
  const msgEl = document.getElementById('time-entry-note-message');
  if (!backdrop || !modal || !msgEl) {
    window.alert(message);
    return;
  }
  msgEl.textContent = message;
  backdrop.classList.remove('hidden');
  modal.classList.remove('hidden');
}

function closeTimeEntryNoteModal() {
  const backdrop = document.getElementById('time-entry-note-backdrop');
  const modal = document.getElementById('time-entry-note-modal');
  if (backdrop) backdrop.classList.add('hidden');
  if (modal) modal.classList.add('hidden');
}

let timeEntryApproveNoteResolver = null;

function showTimeEntryApproveNoteModal({ message, required = false } = {}) {
  const backdrop = document.getElementById('time-entry-approve-note-backdrop');
  const modal = document.getElementById('time-entry-approve-note-modal');
  const msgEl = document.getElementById('time-entry-approve-note-message');
  const input = document.getElementById('time-entry-approve-note-input');
  const submitBtn = document.getElementById('time-entry-approve-note-submit');

  if (!backdrop || !modal || !msgEl || !input || !submitBtn) {
    const fallback = window.prompt(message || 'Add a note (optional).');
    return Promise.resolve(fallback === null ? null : String(fallback));
  }

  msgEl.textContent = message || 'Add a note (optional).';
  input.value = '';
  submitBtn.textContent = required ? 'Submit note' : 'Submit';

  backdrop.classList.remove('hidden');
  modal.classList.remove('hidden');

  return new Promise(resolve => {
    timeEntryApproveNoteResolver = resolve;
    setTimeout(() => input.focus(), 0);
  });
}

function closeTimeEntryApproveNoteModal(result = null) {
  const backdrop = document.getElementById('time-entry-approve-note-backdrop');
  const modal = document.getElementById('time-entry-approve-note-modal');
  if (backdrop) backdrop.classList.add('hidden');
  if (modal) modal.classList.add('hidden');
  if (timeEntryApproveNoteResolver) {
    timeEntryApproveNoteResolver(result);
    timeEntryApproveNoteResolver = null;
  }
}

let timeEntryReviewWarningResolver = null;

function showTimeEntryReviewWarningModal(message) {
  const backdrop = document.getElementById('time-entry-review-warning-backdrop');
  const modal = document.getElementById('time-entry-review-warning-modal');
  const msgEl = document.getElementById('time-entry-review-warning-message');

  if (!backdrop || !modal || !msgEl) {
    return Promise.resolve(window.confirm(message));
  }

  msgEl.textContent =
    message ||
    'Field review is still pending for this entry. Approve for payroll anyway?';
  backdrop.classList.remove('hidden');
  modal.classList.remove('hidden');

  return new Promise(resolve => {
    timeEntryReviewWarningResolver = resolve;
  });
}

function closeTimeEntryReviewWarningModal(result = false) {
  const backdrop = document.getElementById('time-entry-review-warning-backdrop');
  const modal = document.getElementById('time-entry-review-warning-modal');
  if (backdrop) backdrop.classList.add('hidden');
  if (modal) modal.classList.add('hidden');
  if (timeEntryReviewWarningResolver) {
    timeEntryReviewWarningResolver(result);
    timeEntryReviewWarningResolver = null;
  }
}

async function loadTimeEntryChangeSummary(entryId) {
  const section = document.getElementById('time-entry-change-section');
  const grid = document.getElementById('time-entry-change-grid');
  const meta = document.getElementById('time-entry-change-meta');
  if (!section || !grid) return;

  grid.innerHTML = '';
  if (meta) meta.textContent = 'Loading changes...';

  try {
    const data = await fetchJSON(`/api/time-entries/${encodeURIComponent(entryId)}/changes`);
    const changes = data && data.changes;
    if (!changes || !Array.isArray(changes.fields) || !changes.fields.length) {
      section.classList.add('hidden');
      return;
    }

    const when = changes.created_at ? formatDateTimeLocal(changes.created_at) : '';
    const who = changes.actor_name ? `by ${changes.actor_name}` : '';
    const note = changes.note ? ` • Note: ${changes.note}` : '';
    if (meta) {
      meta.textContent = `${when}${when && who ? ' ' : ''}${who}${note}`;
    }

    const formatChangeValue = (label, value) => {
      if (!value) return '—';
      if (label === 'Clock in' || label === 'Clock out') {
        return formatTime12(value);
      }
      if (label === 'Date') {
        return formatDateUS(value);
      }
      return String(value);
    };

    grid.innerHTML = `
      <div class="time-entry-change-header">Field</div>
      <div class="time-entry-change-header">Before</div>
      <div class="time-entry-change-header">After</div>
      ${changes.fields.map(item => {
        const label = item.label || '';
        const beforeVal = formatChangeValue(label, item.before);
        const afterVal = formatChangeValue(label, item.after);
        return `
          <div class="time-entry-change-cell">${escapeHTML(label)}</div>
          <div class="time-entry-change-cell">${escapeHTML(beforeVal)}</div>
          <div class="time-entry-change-cell">${escapeHTML(afterVal)}</div>
        `;
      }).join('')}
    `;

    section.classList.remove('hidden');
  } catch (err) {
    section.classList.add('hidden');
  }
}

async function approveAllTimeEntries() {
  if (!(window.CURRENT_ACCESS_PERMS && window.CURRENT_ACCESS_PERMS.approve_time)) {
    showTimeEntryNoteModal('Payroll approval access required.');
    return;
  }

  const filters = getTimeEntryFiltersFromUi();
  const today = new Date().toISOString().slice(0, 10);
  const start = filters.start || today;
  const end = filters.end || start;

  const confirmed = window.confirm(
    `Approve all clean entries for payroll from ${start} to ${end}? Entries still awaiting field review or requiring a note will be skipped.`
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
    const skippedList = Array.isArray(resp?.skipped) ? resp.skipped : [];
    const skippedCount = skippedList.length;
    const skippedByReason = skippedList.reduce((acc, item) => {
      const key = item && item.reason ? item.reason : 'other';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const reasonParts = [];
    if (skippedByReason.needs_field_review) {
      reasonParts.push(`${skippedByReason.needs_field_review} need field review`);
    }
    if (skippedByReason.requires_note) {
      reasonParts.push(`${skippedByReason.requires_note} need a note`);
    }
    if (skippedByReason.rejected) {
      reasonParts.push(`${skippedByReason.rejected} rejected`);
    }
    const skippedMsg = skippedCount
      ? ` Skipped ${skippedCount} entries${reasonParts.length ? ` (${reasonParts.join(', ')})` : ''}.`
      : '';
    showTimeEntryNoteModal(`Approved ${approvedCount} entries.${skippedMsg}`);

    if (hasActiveTimeEntryFilters(filters)) {
      resetTimeEntryPagination();
      await loadTimeEntriesTable(filters);
    } else {
      resetTimeEntryPagination();
      await loadTimeEntriesTable();
    }
  } catch (err) {
    showTimeEntryNoteModal(err?.message || 'Bulk approve failed.');
  }
}

function applyTimeEntryApprovalAccess() {
  const approveAllBtn = document.getElementById('te-approve-all');
  const approveNowWrap = document.getElementById('te-approve-now-wrap');
  const approveNowInput = document.getElementById('te-approve-now');
  const approveSelectedBtn = document.getElementById('te-approve-selected');
  if (!approveAllBtn && !approveNowWrap && !approveSelectedBtn) return;
  const canApprove = !!(window.CURRENT_ACCESS_PERMS && window.CURRENT_ACCESS_PERMS.approve_time);
  if (approveAllBtn) {
    approveAllBtn.style.display = canApprove ? 'inline-flex' : 'none';
  }
  if (approveNowWrap) {
    approveNowWrap.style.display = canApprove ? 'flex' : 'none';
    approveNowWrap.classList.toggle('hidden', !canApprove);
  }
  if (approveSelectedBtn) {
    approveSelectedBtn.style.display = canApprove ? 'inline-flex' : 'none';
    if (!canApprove) {
      timeEntryApprovalSelection.clear();
      timeEntryApprovalNotes.clear();
      updateApproveSelectedButton();
    }
  }
  if (!canApprove && approveNowInput) {
    approveNowInput.checked = false;
  }
}

let timeEntryDateRangeMode = null;
let timeEntryLastCustomRange = { start: '', end: '' };

function formatDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveTimeEntryWeekStartDay() {
  const raw = window.CURRENT_PAYROLL_RULES?.pay_period_start_weekday;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 6) {
    return parsed;
  }
  return 1;
}

function getWeekStartDate(date, weekStartDay) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const diff = (start.getDay() - weekStartDay + 7) % 7;
  start.setDate(start.getDate() - diff);
  return start;
}

function getTimeEntryDateRangePreset(mode) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (mode === 'this_week' || mode === 'last_week') {
    const weekStartDay = resolveTimeEntryWeekStartDay();
    const currentWeekStart = getWeekStartDate(today, weekStartDay);
    const start = new Date(currentWeekStart);
    if (mode === 'last_week') {
      start.setDate(start.getDate() - 7);
    }
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { start: formatDateInputValue(start), end: formatDateInputValue(end) };
  }

  if (mode === 'this_month' || mode === 'last_month') {
    const year = today.getFullYear();
    const month = today.getMonth();
    const start = mode === 'this_month'
      ? new Date(year, month, 1)
      : new Date(year, month - 1, 1);
    const end = mode === 'this_month'
      ? new Date(year, month + 1, 0)
      : new Date(year, month, 0);
    return { start: formatDateInputValue(start), end: formatDateInputValue(end) };
  }

  return null;
}

function applyTimeEntryDateRangeMode(mode) {
  const startWrap = document.getElementById('te-filter-start-wrap');
  const endWrap = document.getElementById('te-filter-end-wrap');
  const startInput = document.getElementById('te-filter-start');
  const endInput = document.getElementById('te-filter-end');

  const nextMode = mode || 'range';

  if (timeEntryDateRangeMode === 'range' && startInput && endInput) {
    timeEntryLastCustomRange = {
      start: startInput.value || '',
      end: endInput.value || ''
    };
  }

  timeEntryDateRangeMode = nextMode;

  const showRange = nextMode === 'range';
  if (startWrap) startWrap.classList.toggle('hidden', !showRange);
  if (endWrap) endWrap.classList.toggle('hidden', !showRange);

  if (!startInput || !endInput) return;

  if (showRange) {
    if (timeEntryLastCustomRange.start || timeEntryLastCustomRange.end) {
      startInput.value = timeEntryLastCustomRange.start;
      endInput.value = timeEntryLastCustomRange.end;
    }
    return;
  }

  if (nextMode === 'all') {
    startInput.value = '';
    endInput.value = '';
    return;
  }

  const preset = getTimeEntryDateRangePreset(nextMode);
  if (preset) {
    startInput.value = preset.start;
    endInput.value = preset.end;
  }
}

function updateTimeEntryIncludeToggleLabel() {
  const labelEl = document.getElementById('te-filter-include-toggle-label');
  const includeApproved = document.getElementById('te-filter-include-approved');
  const includePaid = document.getElementById('te-filter-include-paid');
  if (!labelEl) return;

  let count = 0;
  if (includeApproved && includeApproved.checked) count += 1;
  if (includePaid && includePaid.checked) count += 1;
  labelEl.textContent = count > 0 ? `Include (${count})` : 'Include';
}

function getTimeEntryFiltersFromUi() {
  const empFilter   = document.getElementById('te-filter-employee');
  const projFilter  = document.getElementById('te-filter-project');
  const includeApproved = document.getElementById('te-filter-include-approved');
  const includePaid = document.getElementById('te-filter-include-paid');
  const payrollApprovalLegacy = document.getElementById('te-filter-payroll-approval');
  const rangeFilter = document.getElementById('te-filter-date-range');
  const startFilter = document.getElementById('te-filter-start');
  const endFilter   = document.getElementById('te-filter-end');

  const rangeMode = rangeFilter && rangeFilter.value ? rangeFilter.value : 'all';
  let startValue = startFilter && startFilter.value ? startFilter.value : '';
  let endValue = endFilter && endFilter.value ? endFilter.value : '';

  if (rangeMode !== 'range') {
    if (rangeMode === 'all') {
      startValue = '';
      endValue = '';
    } else {
      const preset = getTimeEntryDateRangePreset(rangeMode);
      startValue = preset ? preset.start : '';
      endValue = preset ? preset.end : '';
    }
  }

  // Default behavior: show unpaid + unapproved only.
  // Include dropdown options can widen the result set.
  let hideApproved = true;
  if (includeApproved) {
    hideApproved = !includeApproved.checked;
  } else if (payrollApprovalLegacy) {
    const payrollApprovalMode = payrollApprovalLegacy.value
      ? String(payrollApprovalLegacy.value)
      : 'all';
    hideApproved = payrollApprovalMode === 'unapproved';
  }
  const hidePaid = includePaid ? !includePaid.checked : true;

  return {
    employee_id: empFilter && empFilter.value ? empFilter.value : '',
    project_id:  projFilter && projFilter.value ? projFilter.value : '',
    start:       startValue,
    end:         endValue,
    all_dates:   rangeMode === 'all',
    hide_paid:   hidePaid,
    hide_approved: hideApproved
  };
}

function hasActiveTimeEntryFilters(filters = {}) {
  return !!(
    (filters.employee_id && String(filters.employee_id).trim()) ||
    (filters.project_id && String(filters.project_id).trim())  ||
    (filters.start && String(filters.start).trim())            ||
    (filters.end && String(filters.end).trim())                ||
    filters.all_dates === true                                 ||
    filters.hide_approved === true
  );
}

function resetTimeEntryPagination() {
  timeEntryCurrentPage = 1;
}

function buildTimeEntriesExportUrl(format) {
  const filters = getTimeEntryFiltersFromUi();

  const params = new URLSearchParams();

  if (filters.employee_id) params.set('employee_id', filters.employee_id);
  if (filters.project_id) params.set('project_id', filters.project_id);
  if (filters.start) params.set('start', filters.start);
  if (filters.end) params.set('end', filters.end);
  if (filters.all_dates) params.set('all_dates', '1');
  if (filters.hide_paid) params.set('hide_paid', '1');
  if (filters.hide_approved) params.set('hide_payroll_approved', '1');

  const qs = params.toString();
  return `/api/time-entries/export/${format}` + (qs ? `?${qs}` : '');
}

async function loadTimeEntryIntoFormFromRow(row, { showFormCard = true } = {}) {
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
  if (showFormCard && teFormCard && teFormCard.classList.contains('hidden')) {
    teFormCard.classList.remove('hidden');

    moveToggleToFormLocal();

    await loadEmployeesForSelect();
    await loadProjectsForTimeEntries();
    teFormCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (showFormCard) {
    // Card already open – still ensure toggle is in the right container
    moveToggleToFormLocal();
  } else {
    await loadEmployeesForSelect();
    await loadProjectsForTimeEntries();
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
  const approveNowInput = document.getElementById('te-approve-now');
  const updatedAtInput = document.getElementById('te-updated-at');
  const msgEl          = document.getElementById('time-entry-message');
  const origBlock      = document.getElementById('te-original');
  const origDateEl     = document.getElementById('te-original-date');
  const origProjEl     = document.getElementById('te-original-project');
  const origTimesEl    = document.getElementById('te-original-times');


  if (idInput) idInput.value = row.dataset.entryId || '';
  console.log('[TimeEntry] populated form', {
    id: idInput?.value,
    employee: employeeSelect?.value,
    project: projectSelect?.value
  });
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
  if (approveNowInput) approveNowInput.checked = false;

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

  const origDateEdit = document.getElementById('te-edit-orig-date');
  const origProjectEdit = document.getElementById('te-edit-orig-project');
  const origStartEdit = document.getElementById('te-edit-orig-start');
  const origEndEdit = document.getElementById('te-edit-orig-end');
  const origHoursEdit = document.getElementById('te-edit-orig-hours');

  if (origDateEdit) {
    origDateEdit.textContent = row.dataset.startDate || row.dataset.endDate || '—';
  }
  if (origProjectEdit) {
    origProjectEdit.textContent = row.dataset.projectName || row.dataset.projectId || '—';
  }
  if (origStartEdit) {
    origStartEdit.textContent = formatTime12(row.dataset.startTime || '');
  }
  if (origEndEdit) {
    origEndEdit.textContent = formatTime12(row.dataset.endTime || '');
  }
  if (origHoursEdit) {
    origHoursEdit.textContent = row.dataset.hours || '—';
  }
}

function enterTimeEntryEditModal() {
  const wrapper = document.getElementById('time-entry-form-wrapper');
  const editContainer = document.getElementById('time-entry-edit-container');
  const detailBody = document.getElementById('time-entry-detail-body');
  const formHost = document.getElementById('time-entry-edit-form-host');

  if (!wrapper || !editContainer || !formHost) return;

  if (!timeEntryFormOriginalParent) {
    timeEntryFormOriginalParent = wrapper.parentElement;
    timeEntryFormOriginalNextSibling = wrapper.nextSibling;
  }

  editContainer.classList.remove('hidden');
  if (detailBody) detailBody.classList.add('hidden');
  formHost.appendChild(wrapper);
  wrapper.classList.add('time-entry-edit-mode');
  timeEntryEditInModal = true;
}

function restoreTimeEntryFormToCard() {
  const wrapper = document.getElementById('time-entry-form-wrapper');
  const editContainer = document.getElementById('time-entry-edit-container');
  const detailBody = document.getElementById('time-entry-detail-body');

  if (!wrapper || !timeEntryFormOriginalParent) return;

  if (timeEntryFormOriginalNextSibling && timeEntryFormOriginalNextSibling.parentElement === timeEntryFormOriginalParent) {
    timeEntryFormOriginalParent.insertBefore(wrapper, timeEntryFormOriginalNextSibling);
  } else {
    timeEntryFormOriginalParent.appendChild(wrapper);
  }

  if (editContainer) editContainer.classList.add('hidden');
  if (detailBody) detailBody.classList.remove('hidden');
  wrapper.classList.remove('time-entry-edit-mode');
  timeEntryEditInModal = false;
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
  const approveNowInput = document.getElementById('te-approve-now');
  const msgEl          = document.getElementById('time-entry-message');

  // Basic field values
  const employee_id = Number(employeeSelect?.value || '');
  const project_id  = Number(projectSelect?.value || '');
  const start_date  = startInput?.value || '';
  const start_time  = startTimeInput?.value || '';
  const end_time    = endTimeInput?.value || '';
  const change_note = noteInput?.value || '';
  const approveNow = !!approveNowInput?.checked;
  const canApproveNow = approveNow && !!(window.CURRENT_ACCESS_PERMS && window.CURRENT_ACCESS_PERMS.approve_time);

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

  if (!change_note.trim()) {
    if (msgEl) {
      msgEl.textContent = isEdit
        ? 'A note is required when editing an entry.'
        : 'A note is required when creating a manual entry.';
      msgEl.style.color = 'red';
    }
    return;
  }

  if (isEdit && canApproveNow && navigator.onLine) {
    const confirmed = window.confirm(
      'Are you sure you want to approve this entry for payroll when you update it?'
    );
    if (!confirmed) {
      if (msgEl) {
        msgEl.textContent = 'Update canceled.';
        msgEl.style.color = '#b45309';
      }
      return;
    }
  }

  if (msgEl) {
    msgEl.textContent = 'Saving...';
    msgEl.style.color = 'black';
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
      msgEl.textContent = approveNow
        ? 'Saved offline — payroll approval requires an online connection.'
        : 'Saved offline — will sync when back online.';
      msgEl.style.color = '#b45309';
    }
    resetTimeEntryFormToNewMode();
    if (timeEntryEditInModal) {
      restoreTimeEntryFormToCard();
      closeTimeEntryDetails();
    }
    return;
  }

  try {
    const resp = await fetchJSON(url, {
      method: 'POST', // your API is using POST for both create + update
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    let approvedNow = false;
    if (canApproveNow) {
      const entryId = isEdit ? idInput?.value : resp?.id;
      if (entryId) {
        try {
          await fetchJSON(`/api/time-entries/${encodeURIComponent(entryId)}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note: change_note.trim() })
          });
          approvedNow = true;
        } catch (err) {
          showTimeEntryNoteModal(err?.message || 'Failed to approve time entry.');
        }
      }
    }

    if (msgEl) {
      if (approvedNow) {
        msgEl.textContent = isEdit
          ? 'Time entry updated and approved.'
          : 'Time entry saved and approved.';
      } else {
        msgEl.textContent = isEdit
          ? 'Time entry updated.'
          : 'Time entry saved.';
      }
      msgEl.style.color = 'green';
    }
    if (approvedNow) {
      showToast(isEdit ? 'Time entry updated and approved.' : 'Time entry saved and approved.');
    } else {
      showToast(isEdit ? 'Time entry updated.' : 'Time entry saved.');
    }

    // Reset form back to "new" mode
    resetTimeEntryFormToNewMode();
    if (timeEntryEditInModal) {
      restoreTimeEntryFormToCard();
      closeTimeEntryDetails();
    }

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
      if (timeEntryEditInModal) {
        restoreTimeEntryFormToCard();
        closeTimeEntryDetails();
      }
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
  const approveNowInput = document.getElementById('te-approve-now');
  const updatedAtInput = document.getElementById('te-updated-at');
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
  if (approveNowInput) approveNowInput.checked = false;
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





/* ───────── 5. GLOBAL EVENT WIRING & INIT ───────── */

function closeAllModals() {
  const modalPairs = [
    ['employee-edit-modal', 'employee-edit-backdrop'],
    ['vendor-edit-modal', 'vendor-edit-backdrop'],
    ['project-edit-modal', 'project-edit-backdrop'],
    ['shipment-create-modal', 'shipment-create-backdrop'],
    ['time-entries-modal', 'time-entries-backdrop'],
    ['shipment-detail-modal', 'shipment-detail-backdrop'],
    ['kiosk-modal', 'kiosk-modal-backdrop'],
    ['qbo-onboarding-modal', 'qbo-onboarding-backdrop'],
    ['qbo-match-sheet', 'qbo-match-sheet-backdrop'],
    ['qbo-link-confirm-modal', 'qbo-link-confirm-backdrop']
  ];

  modalPairs.forEach(([modalId, backdropId]) => {
    const modal = document.getElementById(modalId);
    const backdrop = document.getElementById(backdropId);
    if (modal) modal.classList.add('hidden');
    if (backdrop) backdrop.classList.add('hidden');
  });

  const detailOverlay = document.getElementById('time-entry-detail-overlay');
  if (detailOverlay) {
    detailOverlay.classList.add('hidden');
    detailOverlay.setAttribute('aria-hidden', 'true');
  }
}

/* ───────── 6. MODALS LOADER ───────── */

async function loadModalsIntoDom() {
  const container = document.getElementById('modals-root');

  try {
    const cacheBust = '20260204-time-entry-alerts';
    const response = await fetch(`/modals.html?v=${cacheBust}`, { cache: 'no-store' });
    const html = await response.text();
    container.innerHTML = html;
    if (typeof window.bindQboLinkConfirmModal === 'function') {
      window.bindQboLinkConfirmModal();
    }
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
  if (!isSectionFeatureEnabled('payroll')) {
    payrollTabInitialized = true;
    return;
  }

  const perms = window.CURRENT_ACCESS_PERMS || null;
  const permsHydrated =
    !!(perms && Object.prototype.hasOwnProperty.call(perms, 'view_payroll'));
  if (!permsHydrated) {
    // If you navigate early during app boot, permissions may not be ready yet.
    // Retry shortly so we can safely decide whether to init payroll.
    setTimeout(initPayrollTabIfNeeded, 75);
    return;
  }

  const payrollSection = document.getElementById('section-payroll');
  const reimbursementsSection = document.getElementById('section-reimbursements');
  const payrollActive = !!(payrollSection && payrollSection.classList.contains('active'));
  const reimbursementsActive = !!(
    reimbursementsSection && reimbursementsSection.classList.contains('active')
  );
  if (!payrollActive && !reimbursementsActive) {
    // User navigated away before permissions hydrated.
    return;
  }

  if (!coerceAccessFlag(perms.view_payroll)) {
    payrollTabInitialized = true;
    return;
  }

  payrollTabInitialized = true;

  console.log('[PAYROLL] Initializing payroll UI');

  // Initialize the dedicated payroll UI (settings/summary) if present.
  if (typeof window.initPayrollUiTab === 'function') {
    window.initPayrollUiTab();
  }
}

function initTimeEntriesIfNeeded() {
  if (timeEntriesInitialized) return;

  const perms = window.CURRENT_ACCESS_PERMS || null;
  const permsHydrated =
    !!(perms && Object.prototype.hasOwnProperty.call(perms, 'view_payroll'));
  if (!permsHydrated) {
    // If you navigate early during app boot, permissions may not be ready yet.
    // Retry shortly so the table renders with the correct approval/access controls.
    setTimeout(initTimeEntriesIfNeeded, 75);
    return;
  }

  timeEntriesInitialized = true;

  // Bind the critical approval handler even if the full wiring hasn't run yet.
  const approveSelectedBtn = document.getElementById('te-approve-selected');
  if (approveSelectedBtn && !approveSelectedBtn.dataset.bound) {
    approveSelectedBtn.dataset.bound = '1';
    approveSelectedBtn.addEventListener('click', approveSelectedTimeEntries);
  }
  applyTimeEntryApprovalAccess();

  if (typeof loadTimeEntriesTable === 'function') {
    resetTimeEntryPagination();
    loadTimeEntriesTable(getTimeEntryFiltersFromUi());
  }
}

function initTimeEntriesReportIfNeeded() {
  if (timeEntriesReportInitialized) return;
  timeEntriesReportInitialized = true;

  if (typeof loadEmployeesForSelect === 'function') {
    loadEmployeesForSelect();
  }
  if (typeof loadProjectsForTimeEntries === 'function') {
    loadProjectsForTimeEntries();
  }

  if (typeof loadTimeEntriesReportTable === 'function') {
    resetTimeEntriesReportPagination();
    loadTimeEntriesReportTable(getTimeEntriesReportFiltersFromUi());
  }
}

function initPayrollReportsIfNeeded() {
  if (payrollReportsInitialized) return;
  if (!isSectionFeatureEnabled('payroll')) {
    payrollReportsInitialized = true;
    return;
  }

  const section = document.getElementById('section-reports');
  if (!section) {
    payrollReportsInitialized = true;
    return;
  }

  const perms = window.CURRENT_ACCESS_PERMS || null;
  const permsHydrated =
    !!(perms && Object.prototype.hasOwnProperty.call(perms, 'view_payroll'));
  if (!permsHydrated) {
    setTimeout(initPayrollReportsIfNeeded, 75);
    return;
  }

  if (!section.classList.contains('active')) {
    // User navigated away before permissions hydrated.
    return;
  }

  if (!coerceAccessFlag(perms.view_payroll)) {
    payrollReportsInitialized = true;
    return;
  }

  payrollReportsInitialized = true;

  if (typeof setupPayrollReportFilters === 'function') {
    setupPayrollReportFilters();
  }
  if (typeof loadPayrollRuns === 'function') {
    loadPayrollRuns();
  }
  if (typeof setupReportsDownload === 'function') {
    setupReportsDownload();
  }
}



document.addEventListener('DOMContentLoaded', async () => {
  const url = new URL(window.location.href);
  let qboReturnError = null;
  if (url.searchParams.has('qbo')) {
    const qboParam = String(url.searchParams.get('qbo') || '').toLowerCase();
    if (qboParam === 'connected' || qboParam === '1' || qboParam === 'true') {
      window.QBO_JUST_CONNECTED = true;
    } else if (qboParam === 'error' || qboParam === 'failed') {
      const reason = String(url.searchParams.get('qbo_reason') || '').trim();
      const message = String(url.searchParams.get('qbo_message') || '').trim();
      qboReturnError = message || reason || 'QuickBooks connection failed.';
    }
    url.searchParams.delete('qbo');
    url.searchParams.delete('qbo_reason');
    url.searchParams.delete('qbo_message');
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  }

  const postBootstrapCard = document.getElementById('post-bootstrap-card');
  const postBootstrapChecklist = document.getElementById('post-bootstrap-checklist');
  const postBootstrapOrgStep = document.getElementById('post-bootstrap-org-step');
  const postBootstrapOrgForm = document.getElementById('post-bootstrap-org-form');
  const postBootstrapOrgName = document.getElementById('post-bootstrap-org-name');
  const postBootstrapOrgTimezone = document.getElementById('post-bootstrap-org-timezone');
  const postBootstrapAdminFirst = document.getElementById('post-bootstrap-admin-first-name');
  const postBootstrapAdminLast = document.getElementById('post-bootstrap-admin-last-name');
  const postBootstrapEmail = document.getElementById('post-bootstrap-email');
  const postBootstrapOrgStatus = document.getElementById('post-bootstrap-org-status');
  const postBootstrapBadge = document.getElementById('post-bootstrap-badge');
  const postBootstrapTitle = document.getElementById('post-bootstrap-title');
  const postBootstrapSubtitle = document.getElementById('post-bootstrap-subtitle');
  const postBootstrapQboBtn = document.getElementById('post-bootstrap-qbo');
  const postBootstrapQboSkipBtn = document.getElementById('post-bootstrap-qbo-skip');
  const postBootstrapQboStatus = document.getElementById('post-bootstrap-qbo-status');
  const postBootstrapPermissionsBtn = document.getElementById('post-bootstrap-permissions');
  const postBootstrapPermissionsOnlyAdminBtn = document.getElementById(
    'post-bootstrap-permissions-only-admin'
  );
  const postBootstrapPermissionsSkipBtn = document.getElementById('post-bootstrap-permissions-skip');
  const postBootstrapPermissionsStatus = document.getElementById('post-bootstrap-permissions-status');
  const postBootstrapSkipAllBtn = document.getElementById('post-bootstrap-skip-all');
  const postBootstrapDismissBtn = document.getElementById('post-bootstrap-dismiss');
  const postBootstrapPermissionsStepText = postBootstrapCard
    ? postBootstrapCard.querySelector('[data-step="permissions"] .onboarding-step-text')
    : null;
  let qboOnboardingModal = null;
  let qboOnboardingBackdrop = null;
  let qboOnboardingWizard = null;
  let qboOnboardingLoading = null;
  let qboOnboardingClose = null;
  let qboOnboardingStepIndicators = [];
  let qboOnboardingPanes = [];
  let qboOnboardingError = null;
  let qboSyncProgressList = null;
  let qboSyncStatus = null;
  let qboMatchList = null;
  let qboMatchSheet = null;
  let qboMatchSheetBackdrop = null;
  let qboMatchSheetClose = null;
  let qboMatchSheetDone = null;
  let qboMatchSheetEmployees = null;
  let qboMatchSheetBack = null;
  let qboMatchSheetList = null;
  let qboMatchSheetStatus = null;
  let qboOptionEmployees = null;
  let qboOptionProjects = null;
  let qboOptionVendors = null;
  let qboOptionAccounts = null;
  let qboStep1Continue = null;
  let qboStep1Cancel = null;
  let qboStep2Back = null;
  let qboStep2Connect = null;
  let qboStep2Error = null;
  let qboStep4Employees = null;
  let qboStep4Done = null;

  let pendingBootstrapFormBound = false;
  let qboInitialSyncRunning = false;
  let onboardingPermissionsDraftChanged = false;
  let onboardingEmployeeCountCache = null;
  let onboardingEmployeeCountCachedAt = 0;

  function setPostBootstrapOrgStatus(text, color) {
    if (!postBootstrapOrgStatus) return;
    postBootstrapOrgStatus.textContent = text || '';
    postBootstrapOrgStatus.style.color = color || '';
  }

  function setPostBootstrapQboStatus(text, color) {
    if (!postBootstrapQboStatus) return;
    postBootstrapQboStatus.textContent = text || '';
    postBootstrapQboStatus.style.color = color || '';
  }

  function setPostBootstrapPermissionsStatus(text, color) {
    if (!postBootstrapPermissionsStatus) return;
    postBootstrapPermissionsStatus.textContent = text || '';
    postBootstrapPermissionsStatus.style.color = color || '';
  }

  const ONBOARDING_PENDING_KEY = 'avian_onboarding_pending_v1';
  const LAST_ORG_ID_KEY = 'avian_last_org_id_v1';
  const ONBOARDING_FORCE_VISIBLE_KEY = 'avian_onboarding_force_visible_v1';
  const ONBOARDING_SKIPPED_KEY = 'avian_onboarding_skipped_v1';
  const ONBOARDING_PERMISSIONS_COMPLETE_KEY = 'avian_onboarding_permissions_complete_v1';
  const ONBOARDING_PERMISSIONS_SKIPPED_KEY = 'avian_onboarding_permissions_skipped_v1';
  const QBO_ONBOARDING_STORAGE_KEY = 'avian_qbo_onboarding_v2';
  const QBO_ONBOARDING_SELECTIONS_KEY = 'avian_qbo_onboarding_selections_v1';
  const QBO_SUGGEST_DISMISS_KEY = 'avian_qbo_suggest_dismiss_v1';

  function getOrgCreatedAt(orgId) {
    const current = window.CURRENT_ORG;
    if (!orgId || !current || Number(current.id) !== Number(orgId)) {
      return null;
    }
    return current.created_at || current.createdAt || null;
  }

  function getOrgFingerprint(orgId, createdAt = null) {
    if (!orgId) return null;
    const ts = createdAt || getOrgCreatedAt(orgId);
    return ts ? `${orgId}:${ts}` : String(orgId);
  }

  function getOnboardingForceKeys(orgId) {
    if (!orgId) return [];
    const keys = [];
    const fingerprint = getOrgFingerprint(orgId);
    if (fingerprint) {
      keys.push(`${ONBOARDING_FORCE_VISIBLE_KEY}:${fingerprint}`);
    }
    const fallback = String(orgId);
    if (fallback && fingerprint !== fallback) {
      keys.push(`${ONBOARDING_FORCE_VISIBLE_KEY}:${fallback}`);
    }
    return keys;
  }

  function getOnboardingSkippedKeys(orgId) {
    if (!orgId) return [];
    const keys = [];
    const fingerprint = getOrgFingerprint(orgId);
    if (fingerprint) {
      keys.push(`${ONBOARDING_SKIPPED_KEY}:${fingerprint}`);
    }
    const fallback = String(orgId);
    if (fallback && fingerprint !== fallback) {
      keys.push(`${ONBOARDING_SKIPPED_KEY}:${fallback}`);
    }
    return keys;
  }

  function getOnboardingPermissionsCompleteKeys(orgId) {
    if (!orgId) return [];
    const keys = [];
    const fingerprint = getOrgFingerprint(orgId);
    if (fingerprint) {
      keys.push(`${ONBOARDING_PERMISSIONS_COMPLETE_KEY}:${fingerprint}`);
    }
    const fallback = String(orgId);
    if (fallback && fingerprint !== fallback) {
      keys.push(`${ONBOARDING_PERMISSIONS_COMPLETE_KEY}:${fallback}`);
    }
    return keys;
  }

  function getOnboardingPermissionsSkippedKeys(orgId) {
    if (!orgId) return [];
    const keys = [];
    const fingerprint = getOrgFingerprint(orgId);
    if (fingerprint) {
      keys.push(`${ONBOARDING_PERMISSIONS_SKIPPED_KEY}:${fingerprint}`);
    }
    const fallback = String(orgId);
    if (fallback && fingerprint !== fallback) {
      keys.push(`${ONBOARDING_PERMISSIONS_SKIPPED_KEY}:${fallback}`);
    }
    return keys;
  }

  function isOnboardingForceVisible(orgId) {
    const keys = getOnboardingForceKeys(orgId);
    if (!keys.length) return false;
    try {
      return keys.some(key => localStorage.getItem(key) === '1');
    } catch {
      return false;
    }
  }

  function setOnboardingForceVisible(orgId, enabled) {
    const keys = getOnboardingForceKeys(orgId);
    if (!keys.length) return;
    try {
      keys.forEach(key => {
        if (enabled) {
          localStorage.setItem(key, '1');
        } else {
          localStorage.removeItem(key);
        }
      });
    } catch {
      // ignore storage failures
    }
  }

  function isOnboardingSkipped(orgId) {
    const keys = getOnboardingSkippedKeys(orgId);
    if (!keys.length) return false;
    try {
      return keys.some(key => localStorage.getItem(key) === '1');
    } catch {
      return false;
    }
  }

  function setOnboardingSkipped(orgId, skipped) {
    const keys = getOnboardingSkippedKeys(orgId);
    if (!keys.length) return;
    try {
      keys.forEach(key => {
        if (skipped) {
          localStorage.setItem(key, '1');
        } else {
          localStorage.removeItem(key);
        }
      });
    } catch {
      // ignore storage failures
    }
  }

  function isOnboardingPermissionsComplete(orgId) {
    const keys = getOnboardingPermissionsCompleteKeys(orgId);
    if (!keys.length) return false;
    try {
      return keys.some(key => localStorage.getItem(key) === '1');
    } catch {
      return false;
    }
  }

  function setOnboardingPermissionsComplete(orgId, complete) {
    const keys = getOnboardingPermissionsCompleteKeys(orgId);
    if (!keys.length) return;
    try {
      keys.forEach(key => {
        if (complete) {
          localStorage.setItem(key, '1');
        } else {
          localStorage.removeItem(key);
        }
      });
    } catch {
      // ignore storage failures
    }
  }

  function isOnboardingPermissionsSkipped(orgId) {
    const keys = getOnboardingPermissionsSkippedKeys(orgId);
    if (!keys.length) return false;
    try {
      return keys.some(key => localStorage.getItem(key) === '1');
    } catch {
      return false;
    }
  }

  function setOnboardingPermissionsSkipped(orgId, skipped) {
    const keys = getOnboardingPermissionsSkippedKeys(orgId);
    if (!keys.length) return;
    try {
      keys.forEach(key => {
        if (skipped) {
          localStorage.setItem(key, '1');
        } else {
          localStorage.removeItem(key);
        }
      });
    } catch {
      // ignore storage failures
    }
  }

  function setAppBooting(active) {
    if (document.documentElement) {
      document.documentElement.classList.toggle('app-booting', !!active);
    }
  }

  function clearAppBooting() {
    setAppBooting(false);
  }

  function setOnboardingRootClass(enabled) {
    if (document.body) {
      document.body.classList.toggle('onboarding-first', !!enabled);
    }
    if (document.documentElement) {
      document.documentElement.classList.toggle('onboarding-first', !!enabled);
    }
  }

  function storeLastOrgId(orgId) {
    if (!orgId) return;
    try {
      localStorage.setItem(LAST_ORG_ID_KEY, String(orgId));
    } catch {
      // ignore storage failures
    }
  }

  function setOnboardingPending(orgId) {
    try {
      const payload = { orgId: orgId || null, pending: true };
      localStorage.setItem(ONBOARDING_PENDING_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage failures
    }
    storeLastOrgId(orgId);
    setOnboardingRootClass(true);
  }

  function clearOnboardingPending() {
    try {
      localStorage.removeItem(ONBOARDING_PENDING_KEY);
    } catch {
      // ignore storage failures
    }
    setOnboardingRootClass(false);
  }

  function getQboOnboardingState(orgId) {
    if (!orgId) return null;
    try {
      const raw = localStorage.getItem(QBO_ONBOARDING_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.orgId !== orgId) return null;
      const expectedCreatedAt = getOrgCreatedAt(orgId);
      if (expectedCreatedAt && parsed.orgCreatedAt !== expectedCreatedAt) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function setQboOnboardingState(orgId, state) {
    if (!orgId) return;
    const payload = {
      orgId,
      orgCreatedAt: getOrgCreatedAt(orgId) || null,
      ...state
    };
    try {
      localStorage.setItem(QBO_ONBOARDING_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage failures
    }
  }

  function clearQboOnboardingState() {
    try {
      localStorage.removeItem(QBO_ONBOARDING_STORAGE_KEY);
    } catch {
      // ignore storage failures
    }
  }

  function clearBootstrapOnboardingLocalState(orgId) {
    if (!orgId) return;
    clearOnboardingPending();
    setOnboardingForceVisible(orgId, false);
    setOnboardingSkipped(orgId, false);
    setOnboardingPermissionsComplete(orgId, false);
    setOnboardingPermissionsSkipped(orgId, false);
    setQboSkipped(orgId, false);
    clearQboOnboardingState();
  }

  function getQboSuggestDismissKey(orgId, empId) {
    if (!orgId || !empId) return null;
    const fingerprint = getOrgFingerprint(orgId);
    return `${QBO_SUGGEST_DISMISS_KEY}:${fingerprint}:${empId}`;
  }

  function isQboSuggestDismissed(orgId, empId) {
    const key = getQboSuggestDismissKey(orgId, empId);
    if (!key) return false;
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  }

  function setQboSuggestDismissed(orgId, empId, dismissed) {
    const key = getQboSuggestDismissKey(orgId, empId);
    if (!key) return;
    try {
      if (dismissed) {
        localStorage.setItem(key, '1');
      } else {
        localStorage.removeItem(key);
      }
    } catch {
      // ignore storage failures
    }
  }

  function getQboOnboardingSelectionsKey(orgId) {
    if (!orgId) return null;
    const fingerprint = getOrgFingerprint(orgId);
    return `${QBO_ONBOARDING_SELECTIONS_KEY}:${fingerprint}`;
  }

  function getQboOnboardingSelections(orgId) {
    const key = getQboOnboardingSelectionsKey(orgId);
    if (!key) return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function setQboOnboardingSelections(orgId, selections) {
    const key = getQboOnboardingSelectionsKey(orgId);
    if (!key || !selections) return;
    try {
      localStorage.setItem(key, JSON.stringify(selections));
    } catch {
      // ignore storage failures
    }
  }

  function buildTimezoneOptions(selectEl) {
    if (!selectEl) return;
    const defaultTz = 'America/Puerto_Rico';
    let zones = [];
    if (typeof Intl !== 'undefined' && Intl.supportedValuesOf) {
      try {
        zones = Intl.supportedValuesOf('timeZone');
      } catch (err) {
        zones = [];
      }
    }
    if (!Array.isArray(zones) || zones.length === 0) {
      zones = [
        'America/Puerto_Rico',
        'America/New_York',
        'America/Chicago',
        'America/Denver',
        'America/Los_Angeles',
        'America/Phoenix',
        'America/Anchorage',
        'Pacific/Honolulu',
        'Europe/London',
        'Europe/Paris',
        'Europe/Berlin',
        'Asia/Dubai',
        'Asia/Kolkata',
        'Asia/Manila',
        'Asia/Shanghai',
        'Asia/Tokyo',
        'Australia/Sydney'
      ];
    }

    zones = [...new Set(zones)].sort((a, b) => a.localeCompare(b));

    selectEl.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select timezone';
    placeholder.disabled = true;
    placeholder.selected = true;
    selectEl.appendChild(placeholder);

    zones.forEach(zone => {
      const option = document.createElement('option');
      option.value = zone;
      option.textContent = zone;
      selectEl.appendChild(option);
    });

    if (zones.includes(defaultTz)) {
      selectEl.value = defaultTz;
    } else if (zones.length > 0) {
      selectEl.value = zones[0];
    }
  }

  function initPendingBootstrapUI(meData) {
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.section');

    sections.forEach(sec => {
      sec.classList.toggle('active', sec.id === 'section-dashboard');
    });

    navItems.forEach(item => {
      const isDashboard = item.dataset.section === 'dashboard';
      item.classList.toggle('active', isDashboard);
      if (!isDashboard) {
        item.removeAttribute('data-disabled');
        item.removeAttribute('title');
        item.removeAttribute('aria-disabled');
      } else {
        item.removeAttribute('title');
        item.setAttribute('aria-disabled', 'false');
      }
    });

    setOnboardingPending(null);
    clearAppBooting();
    window.ONBOARDING_SHOW_QB = false;

    if (typeof updateQbCardForSection === 'function') {
      updateQbCardForSection('dashboard');
    }

    if (postBootstrapCard) postBootstrapCard.classList.remove('hidden');
    if (postBootstrapChecklist) postBootstrapChecklist.classList.remove('hidden');
    if (postBootstrapOrgStep) postBootstrapOrgStep.classList.remove('hidden');
    bindPostBootstrapStepToggles();
    bindPostBootstrapActions();
    setPostBootstrapStepExpanded('org', true);
    setPostBootstrapStepExpanded('qbo', false);
    setPostBootstrapStepExpanded('permissions', false);
    setPostBootstrapStepComplete('org', false);
    setPostBootstrapStepDisabled('qbo', true);
    setPostBootstrapStepDisabled('permissions', true);
    if (postBootstrapBadge) postBootstrapBadge.textContent = 'Signed up';
    if (postBootstrapTitle) postBootstrapTitle.textContent = 'Finish setup';
    if (postBootstrapSubtitle) {
      postBootstrapSubtitle.textContent = 'Create your organization to get started.';
    }
    if (postBootstrapDismissBtn) postBootstrapDismissBtn.classList.add('hidden');
    if (postBootstrapEmail) {
      postBootstrapEmail.value = meData?.user?.email || '';
    }
    buildTimezoneOptions(postBootstrapOrgTimezone);

    if (postBootstrapOrgForm && !pendingBootstrapFormBound) {
      pendingBootstrapFormBound = true;
      postBootstrapOrgForm.addEventListener('submit', async evt => {
        evt.preventDefault();

        const orgName = postBootstrapOrgName?.value || '';
        const orgTimezone = postBootstrapOrgTimezone?.value || '';
        const adminFirst = postBootstrapAdminFirst?.value || '';
        const adminLast = postBootstrapAdminLast?.value || '';
        const adminName = [adminFirst, adminLast].filter(Boolean).join(' ').trim();

        if (!orgName || !orgTimezone || !adminName) {
          setPostBootstrapOrgStatus('Organization name, timezone, and admin name are required.', 'crimson');
          return;
        }

        const submitBtn = postBootstrapOrgForm.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;
        setPostBootstrapOrgStatus('Creating organization...', 'black');

        try {
          const bootstrapData = await fetchJSON('/api/auth/bootstrap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              org_name: orgName,
              org_timezone: orgTimezone,
              admin_name: adminName
            })
          });
          if (bootstrapData && bootstrapData.orgId) {
            clearBootstrapOnboardingLocalState(bootstrapData.orgId);
          }
          setPostBootstrapOrgStatus('Organization created. Redirecting...', 'green');
          window.location.href = '/';
        } catch (err) {
          console.error('Bootstrap error:', err);
          setPostBootstrapOrgStatus(err.message || 'Bootstrap failed.', 'crimson');
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }
  }

  let prefetchMeData = null;
  let prefetchMeStatus = null;
  try {
  const meRes = await fetch('/api/auth/me', { credentials: 'same-origin' });
  const prefetchMeCsrf = meRes.headers.get('X-CSRF-Token');
  if (prefetchMeCsrf) {
    storeCsrfToken(prefetchMeCsrf);
  }
  prefetchMeStatus = meRes.status;
  if (meRes.ok) {
    prefetchMeData = await meRes.json();
  }
  } catch (err) {
    prefetchMeData = null;
  }

  if (prefetchMeStatus === 401 || prefetchMeStatus === 403) {
    window.location.href = '/auth';
    return;
  }

  if (qboReturnError) {
    showToast(`QuickBooks: ${qboReturnError}`, { durationMs: 8000 });
  }

  if (prefetchMeData && prefetchMeData.pending_bootstrap) {
    initPendingBootstrapUI(prefetchMeData);
    return;
  }

  window.PREFETCHED_ME_DATA = prefetchMeData;
  const hasSession =
    !!(prefetchMeData && prefetchMeData.user && prefetchMeData.org);

  // 1) Load modals into the DOM
  await loadModalsIntoDom();
  refreshQboOnboardingDom();
  bindQboOnboardingModalHandlers();

  // 2) Make sure no modals/backdrops start stuck open
  if (typeof closeAllModals === 'function') {
    closeAllModals();
  }

  // 3) Sidebar navigation
  if (typeof setupSidebarNavigation === 'function') {
    setupSidebarNavigation();
  }

  setupDashboardQuickLinks();
  applyDashboardLinkVisibility();

  // Time Exceptions nav has been replaced by Review Time Entries.

  // 4) Shipments verification report wiring
  if (typeof initShipmentsReportUI === 'function') {
    initShipmentsReportUI();
  }

    // 3b) Make QuickBooks settings actions match the initially active tab (Dashboard on first load)
  const activeNav = document.querySelector('.nav-item.active');
  if (activeNav && typeof updateQbCardForSection === 'function') {
    updateQbCardForSection(activeNav.dataset.section);
  }

// 4) QuickBooks connection status
  if (hasSession && typeof checkStatus === 'function') {
    checkStatus();
  }

  // 4a) Payroll account sync is manual (Sync Now only).

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
async function refreshSessionCsrfToken() {
  try {
    const meRes = await fetch('/api/auth/me', { credentials: 'same-origin' });
    const prefetchMeCsrf = meRes && meRes.headers ? meRes.headers.get('X-CSRF-Token') : null;
    if (prefetchMeCsrf) {
      storeCsrfToken(prefetchMeCsrf);
    }
  } catch {
    // ignore
  }
}

  function getQboConnectErrorMessage(err) {
    const payload = err && err.body && typeof err.body === 'object' ? err.body : null;
    const primary =
      (payload && typeof payload.error === 'string' && payload.error.trim()) ||
      (payload && typeof payload.message === 'string' && payload.message.trim()) ||
      (err && err.message ? String(err.message).trim() : '');
    const missing = payload && Array.isArray(payload.missing)
      ? payload.missing.map(item => String(item).trim()).filter(Boolean)
      : [];
    const suffix = missing.length ? `Missing config: ${missing.join(', ')}` : '';
    return [primary, suffix].filter(Boolean).join(' ') || 'Unable to start QuickBooks authorization.';
  }

  async function startQboConnect({ silent = false, _retry = false } = {}) {
  try {
    qboReturnError = null;
    const returnTo =
      (window && window.location && window.location.href
        ? String(window.location.href)
        : '/');
    const res = await fetchJSON('/api/qbo/connect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getCsrfHeader()
      },
      body: JSON.stringify({ return_to: returnTo })
    });
    if (res && res.url) {
      window.location.href = res.url;
      return;
    }
    throw new Error('QuickBooks auth URL missing.');
  } catch (err) {
    const rawMessage = String(err && err.message ? err.message : '');
    const userMessage = getQboConnectErrorMessage(err);
    const isCsrfError =
      !_retry &&
      (err && (err.status === 403 || /CSRF validation failed/i.test(rawMessage)));
    if (isCsrfError) {
      await refreshSessionCsrfToken();
      return startQboConnect({ silent, _retry: true });
    }

    console.error('Failed to start QuickBooks auth:', err);
    if (!silent) {
      alert(userMessage || 'Failed to start QuickBooks auth.');
    }
    const wrapped = new Error(userMessage || 'Failed to start QuickBooks auth.');
    wrapped.status = err && err.status;
    wrapped.body = err && err.body;
    wrapped.code = err && err.code;
    throw wrapped;
  }
}

const connectBtn = document.getElementById('connect');
if (connectBtn) {
  connectBtn.addEventListener('click', () => {
    startQboConnect().catch(err => {
      const userMessage = getQboConnectErrorMessage(err);
      console.error('Connect button error:', err);
      showToast(`QuickBooks: ${userMessage}`, { durationMs: 8000 });
    });
  });
}

const disconnectBtn = document.getElementById('disconnect-quickbooks');
if (disconnectBtn) {
  disconnectBtn.addEventListener('click', async () => {
    if (!window.confirm('Disconnect QuickBooks for this organization?')) {
      return;
    }

    disconnectBtn.disabled = true;
    try {
      const res = await fetch('/api/qbo/disconnect', {
        method: 'POST',
        headers: getCsrfHeader()
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Unable to disconnect QuickBooks.');
      }

      if (typeof checkStatus === 'function') {
        await checkStatus();
      }
      showToast('QuickBooks disconnected.', { durationMs: 3000 });
    } catch (err) {
      console.error('Failed to disconnect QuickBooks:', err);
      showToast(`QuickBooks: ${err.message || 'Unable to disconnect QuickBooks.'}`, {
        durationMs: 6000
      });
    } finally {
      disconnectBtn.disabled = false;
    }
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
    storage_container_daily_late_fee_default: document.getElementById('settings-storage-container-daily-fee'),
    clock_in_photo_required: document.getElementById('settings-clock-in-photo-required'),
    audit_log_retention_days: document.getElementById('settings-audit-retention-days')
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
  const accountEmailCurrent = document.getElementById('account-email-current');
  const accountEmailNew = document.getElementById('account-email-new');
  const accountEmailConfirm = document.getElementById('account-email-confirm');
  const accountEmailPassword = document.getElementById('account-email-password');
  const accountEmailSave = document.getElementById('account-email-save');
  const accountEmailStatus = document.getElementById('account-email-status');
  const accountViewModeCard = document.getElementById('account-view-mode-card');
  const accountViewModeBtn = document.getElementById('account-view-mode-btn');
  const accountViewModeStatus = document.getElementById('account-view-mode-status');
  const quickbooksSettingsCard = document.getElementById('settings-quickbooks-card');
  const backupCard = document.getElementById('settings-backup-card');
  const auditCard = document.getElementById('settings-audit-card');
  const backupBtn = document.getElementById('settings-backup-now');
  const backupStatus = document.getElementById('settings-backup-status');
  const backupRuntime = document.getElementById('settings-backup-runtime');
  const backupLatest = document.getElementById('settings-backup-latest');
  const deviceSetupCard = document.getElementById('settings-device-setup-card');
  const kioskCodeEl = document.getElementById('settings-kiosk-enrollment-code');
  const kioskRotateBtn = document.getElementById('settings-kiosk-rotate');
  const kioskDevicesBody = document.getElementById('settings-kiosk-devices-body');
  const kioskDevicesStatus = document.getElementById('settings-kiosk-devices-status');
  const kioskOpenBtn = document.getElementById('settings-kiosk-open');
  const kioskStatus = document.getElementById('settings-kiosk-status');
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
  const templatePermViewAllTimesheets = document.getElementById('settings-template-perm-view-all-timesheets');
  const templatePermAssignTimesheets = document.getElementById('settings-template-perm-assign-timesheets');
  const templatePermViewPayroll = document.getElementById('settings-template-perm-view-payroll');
  const templatePermModifyPayroll = document.getElementById('settings-template-perm-modify-payroll');
  const templatePermModifyRates = document.getElementById('settings-template-perm-modify-pay-rates');
  const templateSaveBtn = document.getElementById('settings-template-save');
  const templateClearBtn = document.getElementById('settings-template-clear');
  const templateDeleteBtn = document.getElementById('settings-template-delete');
  const templateStatus = document.getElementById('settings-template-status');
  const templatePresetsBtn = document.getElementById('settings-template-presets-create');
  const templatePresetsStatus = document.getElementById('settings-template-presets-status');
  let currentUiMode = 'desktop';
  let editingTemplateId = null;
  let permissionTemplates = [];
  let adminUsersCache = [];

  let postBootstrapPollTimer = null;
  let postBootstrapCheckInFlight = false;

  function setPostBootstrapStepComplete(stepKey, isComplete) {
    if (!postBootstrapCard) return;
    const step = postBootstrapCard.querySelector(`[data-step="${stepKey}"]`);
    if (!step) return;
    step.classList.toggle('is-complete', !!isComplete);
  }

  function setPostBootstrapStepDisabled(stepKey, disabled) {
    if (!postBootstrapCard) return;
    const step = postBootstrapCard.querySelector(`[data-step="${stepKey}"]`);
    if (!step) return;
    step.classList.toggle('is-disabled', !!disabled);
  }

  function setPostBootstrapStepSkipped(stepKey, skipped) {
    if (!postBootstrapCard) return;
    const step = postBootstrapCard.querySelector(`[data-step="${stepKey}"]`);
    if (!step) return;
    step.classList.toggle('is-skipped', !!skipped);
  }

  function getQboSkipKey(orgId) {
    if (!orgId) return null;
    const fingerprint = getOrgFingerprint(orgId);
    return `avian_onboarding_qbo_skip_v1:${fingerprint}`;
  }

  function isQboSkipped(orgId) {
    const key = getQboSkipKey(orgId);
    if (!key) return false;
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  }

  function setQboSkipped(orgId, skipped) {
    const key = getQboSkipKey(orgId);
    if (!key) return;
    try {
      if (skipped) {
        localStorage.setItem(key, '1');
      } else {
        localStorage.removeItem(key);
      }
    } catch {
      // ignore storage failures
    }
  }

  async function getOnboardingActiveEmployeeCount({ force = false } = {}) {
    const now = Date.now();
    if (
      !force &&
      onboardingEmployeeCountCache != null &&
      now - onboardingEmployeeCountCachedAt < 15000
    ) {
      return onboardingEmployeeCountCache;
    }
    try {
      const list = await fetchJSON('/api/employees?status=active');
      const count = Array.isArray(list) ? list.length : 0;
      onboardingEmployeeCountCache = count;
      onboardingEmployeeCountCachedAt = now;
      return count;
    } catch {
      return onboardingEmployeeCountCache;
    }
  }

  function openEmployeesFromOnboarding() {
    const navItem = document.querySelector('.nav-item[data-section="employees"]');
    if (navItem) navItem.click();
    setTimeout(() => {
      const section = document.getElementById('section-employees');
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }

  function openAdminLoginsFromOnboarding() {
    onboardingPermissionsDraftChanged = false;
    openEmployeesFromOnboarding();
    setTimeout(() => {
      setPostBootstrapPermissionsStatus(
        'Open an employee, click Edit, then check "This employee is an admin" to manage admin login access.',
        '#0f766e'
      );
    }, 80);
  }

  function setPostBootstrapStepExpanded(stepKey, expanded) {
    if (!postBootstrapCard) return;
    const step = postBootstrapCard.querySelector(`[data-step="${stepKey}"]`);
    if (!step) return;
    const body = step.querySelector('.onboarding-step-body');
    const header = step.querySelector('.onboarding-step-header');
    if (body) body.classList.toggle('hidden', !expanded);
    if (header) header.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    step.classList.toggle('is-collapsed', !expanded);
  }

  function bindPostBootstrapStepToggles() {
    if (!postBootstrapCard) return;
    const steps = postBootstrapCard.querySelectorAll('.onboarding-step');
    steps.forEach(step => {
      const header = step.querySelector('.onboarding-step-header');
      const body = step.querySelector('.onboarding-step-body');
      if (!header || !body) return;
      if (header.dataset.bound) return;
      header.dataset.bound = '1';
      header.addEventListener('click', () => {
        if (step.classList.contains('is-disabled')) return;
        const isHidden = body.classList.contains('hidden');
        steps.forEach(other => {
          if (other !== step) {
            const otherBody = other.querySelector('.onboarding-step-body');
            const otherHeader = other.querySelector('.onboarding-step-header');
            if (otherBody) otherBody.classList.add('hidden');
            if (otherHeader) otherHeader.setAttribute('aria-expanded', 'false');
            other.classList.add('is-collapsed');
          }
        });
        body.classList.toggle('hidden', !isHidden);
        header.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
        step.classList.toggle('is-collapsed', !isHidden);
      });
    });
  }

  function bindPostBootstrapActions() {
    if (postBootstrapQboBtn && !postBootstrapQboBtn.dataset.bound) {
      postBootstrapQboBtn.dataset.bound = '1';
      postBootstrapQboBtn.addEventListener('click', async () => {
        const orgId = window.CURRENT_ORG && window.CURRENT_ORG.id;
        const action = String(postBootstrapQboBtn.dataset.action || '').trim();
        if (action === 'undo-skip') {
          if (!orgId) return;
          setQboSkipped(orgId, false);
          setPostBootstrapStepSkipped('qbo', false);
          setPostBootstrapStepExpanded('qbo', true);
          updatePostBootstrapChecklist();
          return;
        }
        if (orgId) {
          setQboSkipped(orgId, false);
          setPostBootstrapStepSkipped('qbo', false);
        }
        const shouldContinue = postBootstrapQboBtn.dataset.continue === '1';
        const selectedDefaults = {
          employees: true,
          projects: true,
          vendors: true,
          accounts: true
        };
        const savedSelections = getQboOnboardingSelections(orgId);
        const selections = savedSelections && typeof savedSelections === 'object'
          ? { ...selectedDefaults, ...savedSelections }
          : selectedDefaults;

        if (shouldContinue && orgId) {
          setQboOnboardingSelections(orgId, selections);
          setPostBootstrapQboStatus('QuickBooks is connected. Resuming setup...', '#0f766e');
          clearQboOnboardingState();
          await openQboOnboardingModal({ step: 3 });
          setQboSelectionsInInputs(selections);
          runQboOnboardingSync(selections).catch(err => {
            if (qboOnboardingError) {
              qboOnboardingError.textContent = err?.message || 'QuickBooks sync failed.';
              qboOnboardingError.style.color = '#b91c1c';
            }
          });
          return;
        }

        setQboOnboardingSelections(orgId, selectedDefaults);
        clearQboOnboardingState();
        openQboOnboardingModal({ step: 1, resetSelections: true }).catch(err => {
          console.error('Failed to open QBO onboarding modal:', err);
        });
      });
    }

    if (postBootstrapQboSkipBtn && !postBootstrapQboSkipBtn.dataset.bound) {
      postBootstrapQboSkipBtn.dataset.bound = '1';
      postBootstrapQboSkipBtn.addEventListener('click', () => {
        const orgId = window.CURRENT_ORG && window.CURRENT_ORG.id;
        if (!orgId) return;
        setQboSkipped(orgId, true);
        clearQboOnboardingState();
        setPostBootstrapStepSkipped('qbo', true);
        setPostBootstrapStepExpanded('qbo', false);
        setPostBootstrapStepExpanded('permissions', true);
        updatePostBootstrapChecklist();
      });
    }

    if (postBootstrapPermissionsBtn && !postBootstrapPermissionsBtn.dataset.bound) {
      postBootstrapPermissionsBtn.dataset.bound = '1';
      postBootstrapPermissionsBtn.addEventListener('click', openAdminLoginsFromOnboarding);
    }

    if (
      postBootstrapPermissionsOnlyAdminBtn &&
      !postBootstrapPermissionsOnlyAdminBtn.dataset.bound
    ) {
      postBootstrapPermissionsOnlyAdminBtn.dataset.bound = '1';
      postBootstrapPermissionsOnlyAdminBtn.addEventListener('click', () => {
        const orgId = window.CURRENT_ORG && window.CURRENT_ORG.id;
        if (!orgId) return;
        setOnboardingPermissionsComplete(orgId, true);
        setOnboardingPermissionsSkipped(orgId, false);
        setPostBootstrapStepComplete('permissions', true);
        setPostBootstrapStepSkipped('permissions', false);
        setPostBootstrapStepExpanded('permissions', false);
        onboardingPermissionsDraftChanged = false;
        updatePostBootstrapChecklist();
      });
    }

    if (postBootstrapPermissionsSkipBtn && !postBootstrapPermissionsSkipBtn.dataset.bound) {
      postBootstrapPermissionsSkipBtn.dataset.bound = '1';
      postBootstrapPermissionsSkipBtn.addEventListener('click', () => {
        const orgId = window.CURRENT_ORG && window.CURRENT_ORG.id;
        if (!orgId) return;
        const currentlySkipped =
          !isOnboardingForceVisible(orgId) && isOnboardingPermissionsSkipped(orgId);
        if (currentlySkipped) {
          setOnboardingPermissionsComplete(orgId, false);
          setOnboardingPermissionsSkipped(orgId, false);
          setPostBootstrapStepComplete('permissions', false);
          setPostBootstrapStepSkipped('permissions', false);
          setPostBootstrapStepExpanded('permissions', true);
          onboardingPermissionsDraftChanged = false;
          updatePostBootstrapChecklist();
          return;
        }
        setOnboardingPermissionsComplete(orgId, true);
        setOnboardingPermissionsSkipped(orgId, true);
        setPostBootstrapStepComplete('permissions', true);
        setPostBootstrapStepSkipped('permissions', true);
        setPostBootstrapStepExpanded('permissions', false);
        onboardingPermissionsDraftChanged = false;
        updatePostBootstrapChecklist();
      });
    }

    if (postBootstrapSkipAllBtn && !postBootstrapSkipAllBtn.dataset.bound) {
      postBootstrapSkipAllBtn.dataset.bound = '1';
      postBootstrapSkipAllBtn.addEventListener('click', () => {
        // "Finish Setup Later" only hides setup for now.
        showPostBootstrapCard(false);
      });
    }

    if (postBootstrapDismissBtn && !postBootstrapDismissBtn.dataset.bound) {
      postBootstrapDismissBtn.dataset.bound = '1';
      postBootstrapDismissBtn.addEventListener('click', () => {
        // "Mark as complete" permanently retires onboarding for this org on this device/session profile.
        const orgId = window.CURRENT_ORG && window.CURRENT_ORG.id;
        if (orgId) {
          setOnboardingSkipped(orgId, true);
          setOnboardingForceVisible(orgId, false);
        }
        showPostBootstrapCard(false);
      });
    }
  }

  async function ensureQboOnboardingModal() {
    if (qboOnboardingModal && qboOnboardingBackdrop) return true;
    await loadModalsIntoDom();
    if (!document.getElementById('qbo-onboarding-modal')) {
      const container = document.getElementById('modals-root') || document.body;
      const wrapper = document.createElement('div');
      wrapper.innerHTML = `
        <div id="qbo-onboarding-backdrop" class="modal-backdrop hidden"></div>
        <div id="qbo-onboarding-modal" class="modal hidden" role="dialog" aria-modal="true">
          <div class="modal-card modal-card-wide qbo-onboarding-card">
            <div class="modal-header">
              <div>
                <h3>Connect QuickBooks</h3>
                <p class="card-sub">We'll walk you through setup step-by-step.</p>
              </div>
              <button
                id="qbo-onboarding-close"
                class="icon-button"
                type="button"
                aria-label="Close QuickBooks setup"
              >
                &times;
              </button>
            </div>
            <div id="qbo-onboarding-wizard" class="qbo-onboarding-wizard">
              <div class="qbo-onboarding-stepper">
                <div class="qbo-onboarding-stepper-item" data-qbo-step-indicator="1">
                  <span class="qbo-stepper-number">1</span>
                  Choose data
                </div>
                <div class="qbo-onboarding-stepper-item" data-qbo-step-indicator="2">
                  <span class="qbo-stepper-number">2</span>
                  Connect
                </div>
                <div class="qbo-onboarding-stepper-item" data-qbo-step-indicator="3">
                  <span class="qbo-stepper-number">3</span>
                  Sync
                </div>
                <div class="qbo-onboarding-stepper-item" data-qbo-step-indicator="4">
                  <span class="qbo-stepper-number">4</span>
                  Match
                </div>
              </div>
              <div class="qbo-onboarding-pane" data-qbo-step="1">
                <h4>What should we sync first?</h4>
                <p class="qbo-step-text">Select what to pull in from QuickBooks during setup.</p>
                <div class="qbo-onboarding-options">
                  <label><input type="checkbox" id="qbo-sync-option-employees" checked /> Employees</label>
                  <label><input type="checkbox" id="qbo-sync-option-projects" checked /> Projects</label>
                  <label><input type="checkbox" id="qbo-sync-option-vendors" checked /> Vendors</label>
                  <label><input type="checkbox" id="qbo-sync-option-accounts" checked /> Payroll accounts</label>
                </div>
                <p id="qbo-onboarding-error" class="message"></p>
                <div class="qbo-onboarding-actions">
                  <button id="qbo-step1-continue" class="btn primary" type="button">Continue</button>
                  <button id="qbo-step1-cancel" class="btn secondary" type="button">Cancel</button>
                </div>
              </div>
                <div class="qbo-onboarding-pane hidden" data-qbo-step="2">
                <h4>Connect your QuickBooks account</h4>
                <p class="qbo-step-text">We'll open QuickBooks in a new tab for secure authorization.</p>
                <p id="qbo-step2-error" class="message"></p>
                <div class="qbo-onboarding-actions">
                  <button id="qbo-step2-back" class="btn secondary" type="button">Back</button>
                  <button id="qbo-step2-connect" class="btn primary" type="button">Connect QuickBooks</button>
                </div>
              </div>
              <div class="qbo-onboarding-pane hidden" data-qbo-step="3">
                <h4>Syncing your data</h4>
                <p class="qbo-step-text">We'll sync each item in order and let you know when it's ready.</p>
                <div id="qbo-sync-progress-list" class="qbo-sync-progress-list"></div>
                <p id="qbo-sync-status" class="message"></p>
              </div>
              <div class="qbo-onboarding-pane hidden" data-qbo-step="4">
                <h4>Match employees (if needed)</h4>
                <p class="qbo-step-text">Only needed for employees created in Avian before connecting QuickBooks.</p>
                <p class="qbo-onboarding-note">You can skip for now, but payroll will require QBO links.</p>
                <div id="qbo-match-list" class="qbo-match-list"></div>
                <div class="qbo-onboarding-actions">
                  <button id="qbo-step4-employees" class="btn secondary" type="button">Review matches</button>
                  <button id="qbo-step4-done" class="btn primary" type="button">Skip and return to setup</button>
                </div>
              </div>
            </div>
            <div id="qbo-onboarding-loading" class="qbo-onboarding-loading hidden" role="status" aria-live="polite">
              <div class="sync-indicator">
                <span class="sync-indicator-dot" aria-hidden="true"></span>
                <span>Opening QuickBooks...</span>
              </div>
              <p class="qbo-onboarding-note">If nothing happens, refresh and try again.</p>
            </div>
          </div>
        </div>
      `;
      container.appendChild(wrapper);
    }
    refreshQboOnboardingDom();
    bindQboOnboardingModalHandlers();
    return !!qboOnboardingModal;
  }

  function refreshQboOnboardingDom() {
    qboOnboardingModal = document.getElementById('qbo-onboarding-modal');
    qboOnboardingBackdrop = document.getElementById('qbo-onboarding-backdrop');
    qboOnboardingWizard = document.getElementById('qbo-onboarding-wizard');
    qboOnboardingLoading = document.getElementById('qbo-onboarding-loading');
    qboOnboardingClose = document.getElementById('qbo-onboarding-close');
    qboOnboardingStepIndicators = Array.from(
      document.querySelectorAll('[data-qbo-step-indicator]')
    );
    qboOnboardingPanes = Array.from(
      document.querySelectorAll('.qbo-onboarding-pane')
    );
    qboOnboardingError = document.getElementById('qbo-onboarding-error');
    qboSyncProgressList = document.getElementById('qbo-sync-progress-list');
    qboSyncStatus = document.getElementById('qbo-sync-status');
    qboMatchList = document.getElementById('qbo-match-list');
    qboOptionEmployees = document.getElementById('qbo-sync-option-employees');
    qboOptionProjects = document.getElementById('qbo-sync-option-projects');
    qboOptionVendors = document.getElementById('qbo-sync-option-vendors');
    qboOptionAccounts = document.getElementById('qbo-sync-option-accounts');
    qboStep1Continue = document.getElementById('qbo-step1-continue');
    qboStep1Cancel = document.getElementById('qbo-step1-cancel');
    qboStep2Back = document.getElementById('qbo-step2-back');
    qboStep2Connect = document.getElementById('qbo-step2-connect');
    qboStep2Error = document.getElementById('qbo-step2-error');
    qboStep4Employees = document.getElementById('qbo-step4-employees');
    qboStep4Done = document.getElementById('qbo-step4-done');

    qboMatchSheet = document.getElementById('qbo-match-sheet');
    qboMatchSheetBackdrop = document.getElementById('qbo-match-sheet-backdrop');
    qboMatchSheetClose = document.getElementById('qbo-match-sheet-close');
    qboMatchSheetDone = document.getElementById('qbo-match-sheet-done');
    qboMatchSheetEmployees = document.getElementById('qbo-match-sheet-employees');
    qboMatchSheetBack = document.getElementById('qbo-match-sheet-back');
    qboMatchSheetList = document.getElementById('qbo-match-sheet-list');
    qboMatchSheetStatus = document.getElementById('qbo-match-sheet-status');
  }

  function setQboOnboardingLoading(isLoading) {
    if (qboOnboardingWizard) {
      qboOnboardingWizard.classList.toggle('hidden', !!isLoading);
    }
    if (qboOnboardingLoading) {
      qboOnboardingLoading.classList.toggle('hidden', !isLoading);
    }
  }

  function setQboOnboardingStep(step) {
    if (qboOnboardingPanes && qboOnboardingPanes.length) {
      qboOnboardingPanes.forEach(pane => {
        const paneStep = Number(pane.dataset.qboStep || 0);
        pane.classList.toggle('hidden', paneStep !== step);
      });
    }
    if (qboOnboardingStepIndicators && qboOnboardingStepIndicators.length) {
      qboOnboardingStepIndicators.forEach(item => {
        const itemStep = Number(item.dataset.qboStepIndicator || 0);
        item.classList.toggle('is-active', itemStep === step);
        item.classList.toggle('is-complete', itemStep < step);
      });
    }
  }

  async function openQboOnboardingModal(options = {}) {
    const ok = await ensureQboOnboardingModal();
    if (!ok || !qboOnboardingModal || !qboOnboardingBackdrop) {
      startQboConnect().catch(err => {
        const userMessage = getQboConnectErrorMessage(err);
        console.error('Failed to start QuickBooks auth from fallback modal flow:', err);
        showToast(`QuickBooks: ${userMessage}`, { durationMs: 8000 });
      });
      return;
    }
    setQboOnboardingLoading(false);
    if (qboOnboardingClose) qboOnboardingClose.disabled = false;
    if (qboStep1Continue) qboStep1Continue.disabled = false;
    if (qboStep1Cancel) qboStep1Cancel.disabled = false;
    if (qboStep2Back) qboStep2Back.disabled = false;
    if (qboStep2Connect) qboStep2Connect.disabled = false;
    if (qboStep4Employees) qboStep4Employees.disabled = false;
    if (qboStep4Done) qboStep4Done.disabled = false;
    if (qboOnboardingError) qboOnboardingError.textContent = '';
    if (qboStep2Error) qboStep2Error.textContent = '';
    const step = options.step || 1;
    if (options.resetSelections) {
      setQboSelectionsInInputs({
        employees: true,
        projects: true,
        vendors: true,
        accounts: true
      });
    }
    setQboOnboardingStep(step);
    qboOnboardingModal.classList.remove('hidden');
    qboOnboardingBackdrop.classList.remove('hidden');
  }

  function closeQboOnboardingModal() {
    if (qboOnboardingModal) qboOnboardingModal.classList.add('hidden');
    if (qboOnboardingBackdrop) qboOnboardingBackdrop.classList.add('hidden');
    setQboOnboardingLoading(false);
    if (qboOnboardingClose) qboOnboardingClose.disabled = false;
  }

  function openQboMatchSheet() {
    if (qboMatchSheet) qboMatchSheet.classList.remove('hidden');
    if (qboMatchSheetBackdrop) qboMatchSheetBackdrop.classList.remove('hidden');
  }

  function closeQboMatchSheet() {
    if (qboMatchSheet) qboMatchSheet.classList.add('hidden');
    if (qboMatchSheetBackdrop) qboMatchSheetBackdrop.classList.add('hidden');
  }

  async function loadQboMatchSheetList() {
    if (!qboMatchSheetList) return;
    if (qboMatchSheetStatus) qboMatchSheetStatus.textContent = '';
    qboMatchSheetList.textContent = 'Loading employees that need linking...';
    let matches = [];
    try {
      matches = await fetchJSON('/api/employees?status=pending');
    } catch (err) {
      if (qboMatchSheetStatus) {
        qboMatchSheetStatus.textContent = err?.message || 'Failed to load matches.';
        qboMatchSheetStatus.style.color = 'crimson';
      }
      matches = [];
    }
    renderQboMatchList({
      container: qboMatchSheetList,
      statusEl: qboMatchSheetStatus,
      matches,
      limit: 12
    });
  }

  function getQboSelectionsFromInputs() {
    return {
      employees: qboOptionEmployees ? qboOptionEmployees.checked : true,
      projects: qboOptionProjects ? qboOptionProjects.checked : true,
      vendors: qboOptionVendors ? qboOptionVendors.checked : true,
      accounts: qboOptionAccounts ? qboOptionAccounts.checked : true
    };
  }

  function setQboSelectionsInInputs(selections) {
    if (!selections) return;
    if (qboOptionEmployees) qboOptionEmployees.checked = !!selections.employees;
    if (qboOptionProjects) qboOptionProjects.checked = !!selections.projects;
    if (qboOptionVendors) qboOptionVendors.checked = !!selections.vendors;
    if (qboOptionAccounts) qboOptionAccounts.checked = !!selections.accounts;
  }

  function renderQboSyncProgress(selections) {
    if (!qboSyncProgressList) return;
    const rows = [
      { key: 'employees', label: 'Employees', selected: selections.employees },
      { key: 'projects', label: 'Projects', selected: selections.projects },
      { key: 'vendors', label: 'Vendors', selected: selections.vendors },
      { key: 'accounts', label: 'Payroll accounts', selected: selections.accounts }
    ];
    qboSyncProgressList.innerHTML = '';
    rows.forEach(row => {
      const item = document.createElement('div');
      item.className = 'qbo-sync-progress-item';
      item.dataset.qboSyncKey = row.key;
      const statusText = row.selected ? 'Pending' : 'Skipped';
      item.innerHTML = `
        <span>${row.label}</span>
        <span class="qbo-sync-status ${row.selected ? '' : 'is-done'}">${statusText}</span>
      `;
      qboSyncProgressList.appendChild(item);
    });
  }

  function updateQboSyncStatus(key, state, text) {
    if (!qboSyncProgressList) return;
    const item = qboSyncProgressList.querySelector(`[data-qbo-sync-key="${key}"]`);
    if (!item) return;
    const statusEl = item.querySelector('.qbo-sync-status');
    if (!statusEl) return;
    statusEl.classList.remove('is-running', 'is-done', 'is-error');
    if (state) statusEl.classList.add(state);
    statusEl.textContent = text || statusEl.textContent;
  }

  async function loadQboMatchList() {
    if (!qboMatchList) return;
    qboMatchList.textContent = 'Checking for employees that need linking...';
    let matches = [];
    try {
      matches = await fetchJSON('/api/employees?status=pending');
    } catch {
      matches = [];
    }
    renderQboMatchList({
      container: qboMatchList,
      statusEl: qboMatchSheetStatus,
      matches,
      limit: 6
    });
  }

  async function linkQboFromOnboarding({ empId, qboId, qboName } = {}) {
    if (!empId || !qboId) return;
    if (qboMatchSheetStatus) {
      qboMatchSheetStatus.textContent = 'Linking to QuickBooks...';
      qboMatchSheetStatus.style.color = '#111827';
    }
    try {
      await fetchJSON(`/api/employees/${empId}/link-qbo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getCsrfHeader() },
        body: JSON.stringify({
          employee_qbo_id: qboId,
          allow_merge: true
        })
      });
      if (qboMatchSheetStatus) {
        qboMatchSheetStatus.textContent = `Linked ${qboName ? `${qboName}` : 'employee'} to QuickBooks.`;
        qboMatchSheetStatus.style.color = 'green';
      }
      await loadQboMatchList();
      await loadQboMatchSheetList();
      await updatePostBootstrapChecklist();
    } catch (err) {
      if (qboMatchSheetStatus) {
        qboMatchSheetStatus.textContent = err?.message || 'Failed to link to QuickBooks.';
        qboMatchSheetStatus.style.color = 'crimson';
      }
    }
  }

  function renderQboMatchList({ container, statusEl, matches, limit = 6 } = {}) {
    if (!container) return;
    const orgId = window.CURRENT_ORG && window.CURRENT_ORG.id;
    const pending = Array.isArray(matches) ? matches.filter(emp => !emp.employee_qbo_id && !emp.vendor_qbo_id) : [];
    if (!pending.length) {
      container.textContent = 'No Avian-created employees need linking. You can continue setup.';
      return;
    }

    const show = limit ? pending.slice(0, limit) : pending;
    container.innerHTML = '';
    show.forEach(emp => {
      const name =
        emp.name ||
        `${emp.given_name || ''} ${emp.family_name || ''}`.trim() ||
        'Employee';
      const suggestions = Array.isArray(emp.qbo_suggestions) ? emp.qbo_suggestions : [];
      const dismissed = orgId ? isQboSuggestDismissed(orgId, emp.id) : false;
      const suggestion = !dismissed && suggestions.length ? suggestions[0] : null;
      const badgeLabel = suggestion
        ? (suggestion.confidence === 'strong' ? 'Strong match' : 'Possible match')
        : '';
      const badgeClass = suggestion
        ? (suggestion.confidence === 'strong' ? 'pill pill-good' : 'pill pill-warn')
        : '';

      const row = document.createElement('div');
      row.className = 'pending-suggestion';
      row.innerHTML = `
        <div class="pending-sub">${escapeHTML(name)}</div>
        ${
          suggestion
            ? `
              <div class="pending-suggestion-row">
                <span>${escapeHTML(suggestion.name || 'QuickBooks employee')}${suggestion.employee_qbo_id ? ` (${escapeHTML(suggestion.employee_qbo_id)})` : ''}</span>
                <span class="${badgeClass}">${badgeLabel}</span>
              </div>
              <div class="pending-suggestion-actions">
                <button class="btn primary btn-sm qbo-onboard-confirm" data-emp-id="${emp.id}" data-qbo-id="${escapeHTML(suggestion.employee_qbo_id || '')}" data-qbo-name="${encodeURIComponent(suggestion.name || '')}">Confirm link</button>
                <button class="btn tertiary btn-sm qbo-onboard-dismiss" data-emp-id="${emp.id}">Not a match</button>
              </div>
            `
            : `
              <div class="pending-suggestion-row">
                <span>No suggested match yet.</span>
                <span class="pill pill-warn">Needs review</span>
              </div>
            `
        }
      `;

      row.addEventListener('click', async evt => {
        const confirmBtn = evt.target.closest('.qbo-onboard-confirm');
        if (confirmBtn) {
          const empId = confirmBtn.dataset.empId;
          const qboId = confirmBtn.dataset.qboId;
          const qboName = confirmBtn.dataset.qboName ? decodeURIComponent(confirmBtn.dataset.qboName) : '';
          if (statusEl) statusEl.textContent = '';
          if (typeof window.openQboLinkConfirmModal === 'function') {
            window.openQboLinkConfirmModal({
              empId,
              empName: name,
              qboId,
              qboName,
              onConfirm: linkQboFromOnboarding
            });
          } else {
            const ok = window.confirm(`Link ${name} to ${qboName || 'QuickBooks'} (${qboId})?`);
            if (ok) {
              await linkQboFromOnboarding({ empId, qboId, qboName });
            }
          }
          return;
        }

        const dismissBtn = evt.target.closest('.qbo-onboard-dismiss');
        if (dismissBtn) {
          if (orgId) {
            setQboSuggestDismissed(orgId, emp.id, true);
            renderQboMatchList({ container, statusEl, matches, limit });
          }
          return;
        }

      });

      container.appendChild(row);
    });

    if (pending.length > show.length) {
      const more = document.createElement('div');
      more.className = 'pending-sub';
      more.textContent = `+${pending.length - show.length} more employees need linking`;
      container.appendChild(more);
    }
  }

  async function runQboOnboardingSync(selections) {
    if (qboInitialSyncRunning) return;
    qboInitialSyncRunning = true;
    if (qboSyncStatus) {
      qboSyncStatus.textContent = 'QuickBooks connected. Starting sync...';
      qboSyncStatus.style.color = '#0f766e';
    }
    renderQboSyncProgress(selections);
    setQboOnboardingStep(3);
    const orgId = window.CURRENT_ORG && window.CURRENT_ORG.id;
    if (orgId) {
      setQboOnboardingSelections(orgId, selections);
    }

    const tasks = [
      { key: 'employees', route: '/api/sync/employees' },
      { key: 'projects', route: '/api/sync/projects' },
      { key: 'vendors', route: '/api/sync/vendors' },
      { key: 'accounts', route: '/api/sync/payroll-accounts' }
    ];
    let currentTaskKey = null;

    try {
      for (const task of tasks) {
        if (!selections[task.key]) {
          updateQboSyncStatus(task.key, 'is-done', 'Skipped');
          continue;
        }
        currentTaskKey = task.key;
        updateQboSyncStatus(task.key, 'is-running', 'Syncing...');
        await syncRoute(task.route, {
          silent: true,
          statusEl: qboSyncStatus,
          throwOnError: true
        });
        if (task.key === 'accounts' && typeof loadPayrollSettings === 'function') {
          await loadPayrollSettings();
        }
        updateQboSyncStatus(task.key, 'is-done', 'Done');
        currentTaskKey = null;
      }
      if (qboSyncStatus) {
        qboSyncStatus.textContent = 'Sync complete.';
        qboSyncStatus.style.color = 'green';
      }
      clearQboOnboardingState();
      await updatePostBootstrapChecklist();
      await loadQboMatchList();
      setQboOnboardingStep(4);
    } catch (err) {
      updateQboSyncStatus(currentTaskKey || 'employees', 'is-error', 'Failed');
      if (qboSyncStatus) {
        qboSyncStatus.textContent = err?.message || 'Sync failed.';
        qboSyncStatus.style.color = 'crimson';
      }
    } finally {
      qboInitialSyncRunning = false;
    }
  }

  function bindQboOnboardingModalHandlers() {
    if (qboOnboardingClose && !qboOnboardingClose.dataset.bound) {
      qboOnboardingClose.dataset.bound = '1';
      qboOnboardingClose.addEventListener('click', closeQboOnboardingModal);
    }

    if (qboOnboardingBackdrop && !qboOnboardingBackdrop.dataset.bound) {
      qboOnboardingBackdrop.dataset.bound = '1';
      qboOnboardingBackdrop.addEventListener('click', closeQboOnboardingModal);
    }

    if (qboStep1Continue && !qboStep1Continue.dataset.bound) {
      qboStep1Continue.dataset.bound = '1';
      qboStep1Continue.addEventListener('click', () => {
        const selections = getQboSelectionsFromInputs();
        const hasSelection = Object.values(selections).some(Boolean);
        if (!hasSelection) {
          if (qboOnboardingError) {
            qboOnboardingError.textContent = 'Select at least one item to sync.';
            qboOnboardingError.style.color = 'crimson';
          }
          return;
        }
        if (qboOnboardingError) qboOnboardingError.textContent = '';
        if (qboStep2Error) qboStep2Error.textContent = '';
        setQboOnboardingStep(2);
      });
    }

    if (qboStep1Cancel && !qboStep1Cancel.dataset.bound) {
      qboStep1Cancel.dataset.bound = '1';
      qboStep1Cancel.addEventListener('click', closeQboOnboardingModal);
    }

    if (qboStep2Back && !qboStep2Back.dataset.bound) {
      qboStep2Back.dataset.bound = '1';
      qboStep2Back.addEventListener('click', () => {
        if (qboStep2Error) qboStep2Error.textContent = '';
        setQboOnboardingStep(1);
      });
    }

    if (qboStep2Connect && !qboStep2Connect.dataset.bound) {
      qboStep2Connect.dataset.bound = '1';
      qboStep2Connect.addEventListener('click', () => {
        const orgId = window.CURRENT_ORG && window.CURRENT_ORG.id;
        const selections = getQboSelectionsFromInputs();
        setQboOnboardingState(orgId, { selections, stage: 'auth', startedAt: Date.now() });
        setQboOnboardingLoading(true);
        if (qboStep2Connect) qboStep2Connect.disabled = true;
        if (qboStep2Back) qboStep2Back.disabled = true;
        if (qboOnboardingClose) qboOnboardingClose.disabled = true;
        setTimeout(async () => {
              try {
                await startQboConnect({ silent: true });
              } catch (err) {
                const userMessage = getQboConnectErrorMessage(err);
                if (qboStep2Connect) qboStep2Connect.disabled = false;
                if (qboStep2Back) qboStep2Back.disabled = false;
                if (qboOnboardingClose) qboOnboardingClose.disabled = false;
                setQboOnboardingLoading(false);
                if (qboOnboardingError) {
                  qboOnboardingError.textContent = userMessage;
                  qboOnboardingError.style.color = '#b91c1c';
                }
                if (qboStep2Error) {
                  qboStep2Error.textContent = userMessage;
                  qboStep2Error.style.color = '#b91c1c';
                }
                console.error('QuickBooks connect start failed:', err);
              }
            }, 60);
      });
    }

    if (qboStep4Employees && !qboStep4Employees.dataset.bound) {
      qboStep4Employees.dataset.bound = '1';
      qboStep4Employees.addEventListener('click', () => {
        closeQboOnboardingModal();
        openQboMatchSheet();
        loadQboMatchSheetList();
      });
    }

    if (qboStep4Done && !qboStep4Done.dataset.bound) {
      qboStep4Done.dataset.bound = '1';
      qboStep4Done.addEventListener('click', () => {
        const orgId = window.CURRENT_ORG && window.CURRENT_ORG.id;
        if (orgId) {
          setQboSkipped(orgId, false);
          setPostBootstrapStepSkipped('qbo', false);
          setOnboardingForceVisible(orgId, true);
        }
        closeQboOnboardingModal();
        showPostBootstrapCard(true);
        setPostBootstrapStepExpanded('qbo', false);
        setPostBootstrapStepExpanded('permissions', true);
        updatePostBootstrapChecklist();
      });
    }

    if (qboMatchSheetClose && !qboMatchSheetClose.dataset.bound) {
      qboMatchSheetClose.dataset.bound = '1';
      qboMatchSheetClose.addEventListener('click', closeQboMatchSheet);
    }

    if (qboMatchSheetBackdrop && !qboMatchSheetBackdrop.dataset.bound) {
      qboMatchSheetBackdrop.dataset.bound = '1';
      qboMatchSheetBackdrop.addEventListener('click', closeQboMatchSheet);
    }

    if (qboMatchSheetBack && !qboMatchSheetBack.dataset.bound) {
      qboMatchSheetBack.dataset.bound = '1';
      qboMatchSheetBack.addEventListener('click', closeQboMatchSheet);
    }

    if (qboMatchSheetDone && !qboMatchSheetDone.dataset.bound) {
      qboMatchSheetDone.dataset.bound = '1';
      qboMatchSheetDone.addEventListener('click', () => {
        closeQboMatchSheet();
        setPostBootstrapStepExpanded('qbo', false);
        setPostBootstrapStepExpanded('permissions', true);
      });
    }

    if (qboMatchSheetEmployees && !qboMatchSheetEmployees.dataset.bound) {
      qboMatchSheetEmployees.dataset.bound = '1';
      qboMatchSheetEmployees.addEventListener('click', () => {
        closeQboMatchSheet();
        const navItem = document.querySelector('.nav-item[data-section="employees"]');
        if (navItem) navItem.click();
      });
    }
  }

  async function resumeQboOnboardingIfNeeded() {
    if (!window.QBO_JUST_CONNECTED) return;
    const orgId = window.CURRENT_ORG && window.CURRENT_ORG.id;
    const defaultSelections = {
      employees: true,
      projects: true,
      vendors: true,
      accounts: true
    };
    const state = getQboOnboardingState(orgId);
    const stateSelections = state && state.selections && typeof state.selections === 'object'
      ? state.selections
      : null;
    const storedSelections = getQboOnboardingSelections(orgId);
    const selections = {
      ...defaultSelections,
      ...(storedSelections && typeof storedSelections === 'object' ? storedSelections : {}),
      ...(stateSelections || {})
    };

    const status = await fetchJSON('/api/status').catch(() => null);
    const qbConnected = !!status?.qbConnected;
    const qbConnectionWarning = String(status?.qbConnectionWarning || '').trim();

    try {
      if (!qbConnected || qbConnectionWarning) {
        await openQboOnboardingModal({ step: 1 });
        if (qboOnboardingError) {
          qboOnboardingError.textContent = qbConnectionWarning
            ? `QuickBooks connection check needs attention: ${qbConnectionWarning}`
            : 'QuickBooks connection did not complete. Please try again.';
          qboOnboardingError.style.color = 'crimson';
        }
        return;
      }

      if (orgId) {
        setQboOnboardingSelections(orgId, selections);
        clearQboOnboardingState();
      }
      await openQboOnboardingModal({ step: 3 });
      setQboOnboardingLoading(false);
      setQboSelectionsInInputs(selections);
      await runQboOnboardingSync(selections);
    } finally {
      window.QBO_JUST_CONNECTED = false;
    }
  }

  async function updatePostBootstrapChecklist() {
    if (!postBootstrapCard || postBootstrapCard.classList.contains('hidden')) return;
    if (postBootstrapCheckInFlight) return;
    postBootstrapCheckInFlight = true;

    try {
      const orgId = window.CURRENT_ORG && window.CURRENT_ORG.id;
      const orgComplete = !!orgId;
      setPostBootstrapStepComplete('org', orgComplete);
      setPostBootstrapStepDisabled('qbo', !orgComplete);
      setPostBootstrapStepDisabled('permissions', !orgComplete);
      if (!orgComplete) {
        return;
      }

      const status = await fetchJSON('/api/status').catch(() => null);

      const qbConnectionWarning = String(status?.qbConnectionWarning || '').trim();
      const callbackQboError = String(qboReturnError || '').trim();
      const qbConnected = !!status?.qbConnected && !qbConnectionWarning;
      const storedQboSkipped = isQboSkipped(orgId);
      const qboSkipped = storedQboSkipped && !qbConnected;
      if (storedQboSkipped && qbConnected) {
        setQboSkipped(orgId, false);
      }
      const lastSync = status?.lastSync || {};
      const storedSelections = getQboOnboardingSelections(orgId);
      const selectionMap = storedSelections && typeof storedSelections === 'object'
        ? storedSelections
        : null;
      const requiredKeys = selectionMap
        ? Object.entries(selectionMap)
          .filter(([, value]) => !!value)
          .map(([key]) => (key === 'accounts' ? 'payroll_accounts' : key))
        : ['employees', 'vendors', 'projects', 'payroll_accounts'];
      const effectiveRequired = requiredKeys.length ? requiredKeys : ['employees'];
      const qboSyncReady =
        qbConnected &&
        effectiveRequired.every(key => !!lastSync?.[key]);
      const orgIdForForce = orgId;
      const forceVisible = isOnboardingForceVisible(orgIdForForce);
      const activeEmployeeCountRaw = await getOnboardingActiveEmployeeCount();
      const activeEmployeeCount = Number.isFinite(Number(activeEmployeeCountRaw))
        ? Math.max(1, Math.floor(Number(activeEmployeeCountRaw)))
        : 2;
      const additionalEmployeesCount = Math.max(0, activeEmployeeCount - 1);
      const hasAdditionalEmployees = additionalEmployeesCount > 0;
      const storedPermissionsComplete = !forceVisible && isOnboardingPermissionsComplete(orgId);
      const permissionsSkipped =
        !forceVisible && isOnboardingPermissionsSkipped(orgId);
      const autoPermissionsComplete = !forceVisible && !hasAdditionalEmployees;
      const permissionsComplete = forceVisible
        ? false
        : (storedPermissionsComplete || autoPermissionsComplete);
      setPostBootstrapStepSkipped('permissions', permissionsSkipped);
      if (postBootstrapPermissionsBtn) {
        postBootstrapPermissionsBtn.textContent = 'Set up admin logins';
      }
      if (postBootstrapPermissionsOnlyAdminBtn) {
        postBootstrapPermissionsOnlyAdminBtn.textContent = "I'm the only admin";
      }
      if (postBootstrapPermissionsSkipBtn) {
        postBootstrapPermissionsSkipBtn.textContent = permissionsSkipped
          ? 'Undo skip'
          : 'Finish later';
      }
      if (postBootstrapPermissionsStepText) {
        if (hasAdditionalEmployees && qbConnected) {
          postBootstrapPermissionsStepText.textContent =
            'QuickBooks synced employees. Choose who should also have admin login access.';
        } else if (hasAdditionalEmployees) {
          postBootstrapPermissionsStepText.textContent =
            'Add employees, then choose who should have admin login access.';
        } else {
          postBootstrapPermissionsStepText.textContent =
            "You're already the default super admin. Add another admin only if needed.";
        }
      }
      if (permissionsSkipped) {
        setPostBootstrapPermissionsStatus(
          'Skipped for now. You can set additional admins anytime in Employees.',
          '#b45309'
        );
      } else if (hasAdditionalEmployees) {
        const label = additionalEmployeesCount === 1 ? 'employee is' : 'employees are';
        setPostBootstrapPermissionsStatus(
          `${additionalEmployeesCount} ${label} ready for admin setup.`,
          '#0f766e'
        );
      } else {
        setPostBootstrapPermissionsStatus(
          'No additional employees yet. You can continue with just your super admin account.',
          '#6b7280'
        );
      }

      const needsQuickbooksSetup = !qboSyncReady;
      const showConnectActions = needsQuickbooksSetup || qboSkipped;
      const showQboSkipAction = needsQuickbooksSetup && !qboSkipped;
      if (postBootstrapQboBtn) {
        postBootstrapQboBtn.textContent = qboSkipped
          ? 'Undo skip'
          : (qbConnected && !qboSyncReady
            ? 'Continue QuickBooks setup'
            : 'Connect QuickBooks');
        postBootstrapQboBtn.dataset.action = qboSkipped ? 'undo-skip' : 'start';
        postBootstrapQboBtn.dataset.continue = qbConnected && !qboSyncReady ? '1' : '0';
        postBootstrapQboBtn.style.display = showConnectActions ? '' : 'none';
      }
      if (postBootstrapQboSkipBtn) {
        postBootstrapQboSkipBtn.textContent = 'Finish later';
        postBootstrapQboSkipBtn.style.display = showQboSkipAction ? '' : 'none';
      }
      if (postBootstrapQboStatus) {
        if (qboSkipped) {
          setPostBootstrapQboStatus('Skipped for now. You can connect QuickBooks anytime.', '#b45309');
        } else if (callbackQboError) {
          setPostBootstrapQboStatus(`QuickBooks connect failed: ${callbackQboError}`, '#b91c1c');
        } else if (!qbConnected) {
          setPostBootstrapQboStatus('', '');
        } else if (qboConnectionWarning) {
          setPostBootstrapQboStatus(`QuickBooks check failed: ${qbConnectionWarning}`, '#b45309');
        } else if (qboSyncReady) {
          setPostBootstrapQboStatus('Connected and synced.', 'green');
        } else {
          const pieces = [];
          if (lastSync.employees) pieces.push(`Employees: ${formatDateTimeLocal(lastSync.employees)}`);
          if (lastSync.vendors) pieces.push(`Vendors: ${formatDateTimeLocal(lastSync.vendors)}`);
          if (lastSync.projects) pieces.push(`Projects: ${formatDateTimeLocal(lastSync.projects)}`);
          if (lastSync.payroll_accounts) pieces.push(`Accounts: ${formatDateTimeLocal(lastSync.payroll_accounts)}`);
          const summary = qboInitialSyncRunning
            ? 'Connected. Syncing your data now.'
            : pieces.length
              ? `Last sync — ${pieces.join(' · ')}`
              : 'Connected. Finish the sync in QuickBooks setup.';
          setPostBootstrapQboStatus(summary, '#0f766e');
        }
      }

      const qboStepComplete = qbConnected;
      setPostBootstrapStepSkipped('qbo', qboSkipped);
      setPostBootstrapStepComplete('qbo', qboStepComplete);
      setPostBootstrapStepComplete('permissions', permissionsComplete);

      // Only auto-retire checklist after true completion (not skipped steps).
      const onboardingFullyCompleted =
        orgComplete &&
        qboSyncReady &&
        !qboSkipped &&
        permissionsComplete &&
        !permissionsSkipped;

      if (!forceVisible && onboardingFullyCompleted) {
        showPostBootstrapCard(false);
      }
    } catch (err) {
      console.warn('Failed to refresh setup checklist', err);
    } finally {
      postBootstrapCheckInFlight = false;
    }
  }

  function startPostBootstrapPolling() {
    if (postBootstrapPollTimer) return;
    updatePostBootstrapChecklist();
    postBootstrapPollTimer = setInterval(updatePostBootstrapChecklist, 20000);
  }

  function stopPostBootstrapPolling() {
    if (!postBootstrapPollTimer) return;
    clearInterval(postBootstrapPollTimer);
    postBootstrapPollTimer = null;
  }

  function showPostBootstrapCard(show) {
    if (!postBootstrapCard) return;
    postBootstrapCard.classList.toggle('hidden', !show);
    if (show) {
      const currentOrgId = window.CURRENT_ORG && window.CURRENT_ORG.id;
      const forceVisible = currentOrgId ? isOnboardingForceVisible(currentOrgId) : false;
      const qboConnected =
        !!window.QBO_STATUS?.qbConnected &&
        !String(window.QBO_STATUS?.qbConnectionWarning || '').trim();
      const qboSkipped = currentOrgId ? (isQboSkipped(currentOrgId) && !qboConnected) : false;
      const permissionsSkipped =
        !!currentOrgId && !forceVisible && isOnboardingPermissionsSkipped(currentOrgId);
      if (postBootstrapChecklist) postBootstrapChecklist.classList.remove('hidden');
      if (postBootstrapOrgStep) postBootstrapOrgStep.classList.remove('hidden');
      if (postBootstrapQboBtn) postBootstrapQboBtn.style.display = 'none';
      if (postBootstrapQboSkipBtn) postBootstrapQboSkipBtn.style.display = 'none';
      bindPostBootstrapStepToggles();
      bindPostBootstrapActions();
      setPostBootstrapStepSkipped('qbo', qboSkipped);
      setPostBootstrapStepSkipped('permissions', permissionsSkipped);
      if (postBootstrapQboBtn) {
        postBootstrapQboBtn.textContent = qboSkipped ? 'Undo skip' : 'Connect QuickBooks';
        postBootstrapQboBtn.dataset.action = qboSkipped ? 'undo-skip' : 'start';
        postBootstrapQboBtn.dataset.continue = '0';
        postBootstrapQboBtn.style.display = '';
      }
      if (postBootstrapQboSkipBtn) {
        postBootstrapQboSkipBtn.textContent = 'Finish later';
        postBootstrapQboSkipBtn.style.display = qboSkipped ? 'none' : '';
      }
      if (postBootstrapQboStatus) {
        if (qboSkipped) {
          setPostBootstrapQboStatus('Skipped for now. You can connect QuickBooks anytime.', '#b45309');
        } else {
          setPostBootstrapQboStatus('', '');
        }
      }
      const showQboStep = !!window.QBO_JUST_CONNECTED;
      setPostBootstrapStepExpanded('org', !showQboStep);
      setPostBootstrapStepExpanded('qbo', showQboStep);
      setPostBootstrapStepExpanded('permissions', false);
      setPostBootstrapStepComplete('org', true);
      setPostBootstrapStepDisabled('qbo', false);
      setPostBootstrapStepDisabled('permissions', false);
      setOnboardingPending(currentOrgId);
      window.ONBOARDING_SHOW_QB = false;
      if (typeof updateQbCardForSection === 'function') {
        updateQbCardForSection('dashboard');
      }
      if (showQboStep) {
        setPostBootstrapQboStatus('', '');
      }
      startPostBootstrapPolling();
    } else {
      const orgId = window.CURRENT_ORG && window.CURRENT_ORG.id;
      if (orgId) setOnboardingForceVisible(orgId, false);
      clearOnboardingPending();
      window.ONBOARDING_SHOW_QB = false;
      const activeNav = document.querySelector('.nav-item.active');
      if (activeNav && typeof updateQbCardForSection === 'function') {
        updateQbCardForSection(activeNav.dataset.section);
      }
      stopPostBootstrapPolling();
    }
    clearAppBooting();
  }

  function setPasswordStatus(text, color) {
    if (!passwordStatus) return;
    passwordStatus.textContent = text || '';
    passwordStatus.style.color = color || '';
  }

  function setAccountEmailStatus(text, color) {
    if (!accountEmailStatus) return;
    accountEmailStatus.textContent = text || '';
    accountEmailStatus.style.color = color || '';
  }

  function setAccountViewModeStatus(text, color) {
    if (!accountViewModeStatus) return;
    accountViewModeStatus.textContent = text || '';
    accountViewModeStatus.style.color = color || '';
  }

  function canSwitchAdminViewMode() {
    const employee = window.CURRENT_EMPLOYEE || {};
    return !!(employee.desktop_access && employee.kiosk_admin_access);
  }

  function applyAccountViewModeSwitcher() {
    if (!accountViewModeCard || !accountViewModeBtn) return;
    const canSwitch = canSwitchAdminViewMode();
    accountViewModeCard.classList.toggle('hidden', !canSwitch);
    if (!canSwitch) {
      setAccountViewModeStatus('', '');
      return;
    }

    const inKioskMode = currentUiMode === 'kiosk';
    accountViewModeBtn.textContent = inKioskMode
      ? 'Switch to Desktop View'
      : 'Switch to Kiosk View';
  }

  function setBackupStatus(text, color) {
    if (!backupStatus) return;
    backupStatus.textContent = text || '';
    backupStatus.style.color = color || '';
  }

  function setBackupRuntime(text, color) {
    if (!backupRuntime) return;
    backupRuntime.textContent = text || '';
    backupRuntime.style.color = color || '';
  }

  function setBackupLatest(text, color) {
    if (!backupLatest) return;
    backupLatest.textContent = text || '';
    backupLatest.style.color = color || '';
  }

  function formatBackupBytes(bytes) {
    const size = Number(bytes);
    if (!Number.isFinite(size) || size < 0) return null;
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function formatBackupTimestamp(value) {
    if (!value) return null;
    if (typeof formatDateTimeLocal === 'function') {
      const formatted = formatDateTimeLocal(value);
      if (formatted) return formatted;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleString();
  }

  function describeBackupBucket(label, bucket) {
    const count = Number(bucket?.count || 0);
    const latest = bucket?.latest;
    if (!latest || !latest.key) return `${label}: none (count ${count})`;
    const parts = [];
    const ts = formatBackupTimestamp(latest.db_modified_at);
    const size = formatBackupBytes(latest.db_size_bytes);
    if (ts) parts.push(ts);
    if (size) parts.push(size);
    const details = parts.length ? `, ${parts.join(' • ')}` : '';
    return `${label}: ${latest.key}${details} (count ${count})`;
  }

  async function loadBackupRuntimeStatus() {
    if (!window.CURRENT_IS_SUPER_ADMIN || !backupCard) return;
    setBackupRuntime('Runtime status: loading…', '#6b7280');
    setBackupLatest('Latest snapshots: loading…', '#6b7280');
    try {
      const res = await fetchJSON('/api/admin/backup-status');
      const status = res?.status || {};
      const autoEnabled = !!status.auto_enabled;
      const intervalHours = Number(status.interval_hours || 24);
      const startup = status.run_on_startup ? 'startup + interval' : 'interval only';
      const dailyRetention = Number(status.retention_daily_count || 30);
      const monthlyRetention = Number(status.retention_monthly_count || 12);
      if (autoEnabled) {
        setBackupRuntime(
          `Runtime status: auto backups ON (${startup}, every ${intervalHours}h, retention ${dailyRetention} daily / ${monthlyRetention} monthly).`,
          '#166534'
        );
      } else {
        setBackupRuntime(
          `Runtime status: auto backups OFF. Use Backup Now or an external scheduler.`,
          '#92400e'
        );
      }
      const daily = describeBackupBucket('Daily', status.daily || {});
      const monthly = describeBackupBucket('Monthly', status.monthly || {});
      setBackupLatest(`Latest snapshots: ${daily}; ${monthly}.`, '#374151');
    } catch (err) {
      console.error('Error loading backup status:', err);
      setBackupRuntime(err?.message || 'Runtime status unavailable.', 'crimson');
      setBackupLatest('Latest snapshots unavailable.', 'crimson');
    }
  }

  function setKioskStatus(text, color) {
    if (!kioskStatus) return;
    kioskStatus.textContent = text || '';
    kioskStatus.style.color = color || '';
  }

  function setKioskDevicesStatus(text, color) {
    if (!kioskDevicesStatus) return;
    kioskDevicesStatus.textContent = text || '';
    kioskDevicesStatus.style.color = color || '';
  }

  function formatKioskRegistryDate(value) {
    if (!value) return '—';
    if (typeof formatDateTimeLocal === 'function') {
      const formatted = formatDateTimeLocal(value);
      return formatted || '—';
    }
    return String(value);
  }

  function formatKioskGeofenceLocation(device) {
    const projectName = String(device?.geofence_project_name || '').trim();
    const customerName = String(device?.geofence_customer_name || '').trim();
    const latNum = Number(device?.geofence_lat);
    const lngNum = Number(device?.geofence_lng);
    const radiusNum = Number(device?.geofence_radius);
    const hasLatLng = Number.isFinite(latNum) && Number.isFinite(lngNum);
    const hasRadius = Number.isFinite(radiusNum) && radiusNum > 0;

    let projectLabel = '';
    if (projectName) {
      projectLabel = customerName
        ? `${projectName} (${customerName})`
        : projectName;
    }

    if (hasLatLng) {
      const coords = `${latNum.toFixed(5)}, ${lngNum.toFixed(5)}`;
      const radius = hasRadius ? ` • ${Math.round(radiusNum)}m` : '';
      return projectLabel
        ? `${projectLabel} • ${coords}${radius}`
        : `${coords}${radius}`;
    }

    if (projectLabel) {
      return `${projectLabel} (geofence not set)`;
    }

    return 'No geofence location';
  }

  function renderKioskDeviceRegistry(rows = []) {
    if (!kioskDevicesBody) return;
    if (!rows.length) {
      kioskDevicesBody.innerHTML = '<tr><td colspan="6">(no registered devices)</td></tr>';
      return;
    }

    kioskDevicesBody.innerHTML = '';
    rows.forEach(device => {
      const tr = document.createElement('tr');

      const kioskIdCell = document.createElement('td');
      kioskIdCell.textContent = device?.id ? String(device.id) : '—';
      tr.appendChild(kioskIdCell);

      const deviceCell = document.createElement('td');
      deviceCell.textContent = device?.name || 'Unnamed kiosk';
      tr.appendChild(deviceCell);

      const idCell = document.createElement('td');
      idCell.textContent = device?.device_id || '—';
      tr.appendChild(idCell);

      const adminCell = document.createElement('td');
      const registeredByName = String(device?.registered_by_name || '').trim();
      const registeredByEmployeeId = Number.isFinite(Number(device?.registered_by_employee_id))
        ? Number(device.registered_by_employee_id)
        : null;
      if (registeredByName && registeredByEmployeeId) {
        adminCell.textContent = `${registeredByName} (#${registeredByEmployeeId})`;
      } else if (registeredByName) {
        adminCell.textContent = registeredByName;
      } else if (registeredByEmployeeId) {
        adminCell.textContent = `Employee #${registeredByEmployeeId}`;
      } else {
        adminCell.textContent = 'Unknown (legacy/unspecified)';
      }
      tr.appendChild(adminCell);

      const registeredCell = document.createElement('td');
      registeredCell.textContent = formatKioskRegistryDate(device?.registered_at);
      tr.appendChild(registeredCell);

      const geofenceCell = document.createElement('td');
      geofenceCell.textContent = formatKioskGeofenceLocation(device);
      tr.appendChild(geofenceCell);

      kioskDevicesBody.appendChild(tr);
    });
  }

  async function loadKioskDeviceRegistry() {
    if (!window.CURRENT_IS_SUPER_ADMIN || !kioskDevicesBody) return;
    kioskDevicesBody.innerHTML = '<tr><td colspan="6">(loading devices…)</td></tr>';
    setKioskDevicesStatus('', '');
    try {
      const res = await fetchJSON('/api/kiosks/registry');
      const rows = Array.isArray(res?.kiosks) ? res.kiosks : [];
      renderKioskDeviceRegistry(rows);
      setKioskDevicesStatus(
        rows.length === 1 ? '1 registered device.' : `${rows.length} registered devices.`,
        '#374151'
      );
    } catch (err) {
      console.error('Error loading kiosk device registry', err);
      kioskDevicesBody.innerHTML = '<tr><td colspan="6">(failed to load devices)</td></tr>';
      setKioskDevicesStatus(err?.message || 'Failed to load devices.', 'crimson');
    }
  }

  function setKioskCode(code) {
    if (!kioskCodeEl) return;
    kioskCodeEl.textContent = code || '—';
  }

  async function loadEnrollmentCode() {
    if (!window.CURRENT_IS_SUPER_ADMIN || !kioskCodeEl) return;
    setKioskStatus('Loading enrollment code…', '#6b7280');
    try {
      const res = await fetchJSON('/api/kiosks/enrollment-code');
      setKioskCode(res?.code || '—');
      setKioskStatus('', '');
      await loadKioskDeviceRegistry();
    } catch (err) {
      console.error('Error loading enrollment code', err);
      setKioskCode('—');
      setKioskStatus(err?.message || 'Failed to load enrollment code.', 'crimson');
      if (kioskDevicesBody) {
        kioskDevicesBody.innerHTML = '<tr><td colspan="6">(failed to load devices)</td></tr>';
      }
      setKioskDevicesStatus(err?.message || 'Failed to load devices.', 'crimson');
    }
  }

  async function rotateEnrollmentCode() {
    if (!window.CURRENT_IS_SUPER_ADMIN) return;
    const ok = window.confirm(
      'Rotate the enrollment code? Existing kiosks stay enrolled, but new kiosks will need the new code.'
    );
    if (!ok) return;
    setKioskStatus('Rotating code…', '#6b7280');
    try {
      const res = await fetchJSON('/api/kiosks/enrollment-code/rotate', {
        method: 'POST'
      });
      setKioskCode(res?.code || '—');
      setKioskStatus('Enrollment code rotated.', 'green');
      await loadKioskDeviceRegistry();
    } catch (err) {
      console.error('Error rotating enrollment code', err);
      setKioskStatus(err?.message || 'Failed to rotate enrollment code.', 'crimson');
    }
  }

  function setAdminUsersCache(list = []) {
    adminUsersCache = Array.isArray(list) ? list : [];
    window.ADMIN_USERS_CACHE = adminUsersCache;
  }

  function getAdminUserByEmployeeId(employeeId) {
    if (!employeeId) return null;
    return adminUsersCache.find(user => Number(user.employee_id) === Number(employeeId)) || null;
  }

  async function refreshAdminUsersCache({ render = false } = {}) {
    if (!window.CURRENT_IS_SUPER_ADMIN) return adminUsersCache;
    const data = await fetchJSON('/api/auth/users');
    const list = (data && data.users) || [];
    setAdminUsersCache(list);
    return adminUsersCache;
  }

  window.getAdminUserByEmployeeId = getAdminUserByEmployeeId;
  window.refreshAdminUsersCache = refreshAdminUsersCache;

  function applyBackupCardVisibility() {
    if (!backupCard) return;
    if (window.CURRENT_IS_SUPER_ADMIN) {
      backupCard.classList.remove('hidden');
    } else {
      backupCard.classList.add('hidden');
    }
  }

  function applyAuditCardVisibility() {
    if (!auditCard) return;
    if (window.CURRENT_IS_SUPER_ADMIN) {
      auditCard.classList.remove('hidden');
    } else {
      auditCard.classList.add('hidden');
    }
  }

  function applyDeviceSetupVisibility() {
    if (!deviceSetupCard) return;
    if (window.CURRENT_IS_SUPER_ADMIN) {
      deviceSetupCard.classList.remove('hidden');
    } else {
      deviceSetupCard.classList.add('hidden');
    }
  }

  function applyQuickBooksSettingsVisibility() {
    if (!quickbooksSettingsCard) return;
    if (window.CURRENT_IS_SUPER_ADMIN) {
      quickbooksSettingsCard.classList.remove('hidden');
    } else {
      quickbooksSettingsCard.classList.add('hidden');
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

  function setTemplatePresetsStatus(text, color) {
    if (!templatePresetsStatus) return;
    templatePresetsStatus.textContent = text || '';
    templatePresetsStatus.style.color = color || '';
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
    if (templatePermViewAllTimesheets) templatePermViewAllTimesheets.checked = false;
    if (templatePermAssignTimesheets) templatePermAssignTimesheets.checked = false;
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
        view_all_timesheets: !!templatePermViewAllTimesheets?.checked,
        assign_timesheets: !!templatePermAssignTimesheets?.checked,
        view_payroll: !!templatePermViewPayroll?.checked,
        modify_payroll: !!templatePermModifyPayroll?.checked,
        modify_pay_rates: !!templatePermModifyRates?.checked
      }
    };
  }

  const RECOMMENDED_TEMPLATES = [
    {
      name: 'Super Admin',
      role_title: 'Super Admin',
      access: { worker_timekeeping: true, desktop_access: true, kiosk_admin_access: true },
      permissions: {
        see_shipments: true,
        modify_time: true,
        approve_time: true,
        view_time_reports: true,
        view_all_timesheets: true,
        assign_timesheets: true,
        view_payroll: true,
        modify_payroll: true,
        modify_pay_rates: true
      }
    },
    {
      name: 'Payroll Manager',
      role_title: 'Payroll Manager',
      access: { worker_timekeeping: false, desktop_access: true, kiosk_admin_access: false },
      permissions: {
        see_shipments: true,
        modify_time: true,
        view_time_reports: true,
        view_all_timesheets: true,
        assign_timesheets: true,
        view_payroll: true,
        modify_payroll: true,
        modify_pay_rates: true
      }
    },
    {
      name: 'Payroll Approver',
      role_title: 'Payroll Approver',
      access: { worker_timekeeping: false, desktop_access: true, kiosk_admin_access: false },
      permissions: {
        see_shipments: false,
        modify_time: false,
        view_time_reports: false,
        view_all_timesheets: false,
        assign_timesheets: false,
        view_payroll: true,
        modify_payroll: false,
        modify_pay_rates: false
      }
    },
    {
      name: 'Time Reviewer',
      role_title: 'Time Reviewer',
      access: { worker_timekeeping: false, desktop_access: true, kiosk_admin_access: false },
      permissions: {
        see_shipments: false,
        modify_time: true,
        view_time_reports: true,
        view_all_timesheets: false,
        assign_timesheets: false,
        view_payroll: false,
        modify_payroll: false,
        modify_pay_rates: false
      }
    },
    {
      name: 'Shipments Admin',
      role_title: 'Shipments Admin',
      access: { worker_timekeeping: false, desktop_access: true, kiosk_admin_access: false },
      permissions: {
        see_shipments: true,
        modify_time: false,
        view_time_reports: false,
        view_all_timesheets: false,
        assign_timesheets: false,
        view_payroll: false,
        modify_payroll: false,
        modify_pay_rates: false
      }
    },
    {
      name: 'Kiosk Admin',
      role_title: 'Kiosk Admin',
      access: { worker_timekeeping: true, desktop_access: false, kiosk_admin_access: true },
      permissions: {
        see_shipments: true,
        modify_time: true,
        view_time_reports: true,
        view_all_timesheets: false,
        assign_timesheets: false,
        view_payroll: false,
        modify_payroll: false,
        modify_pay_rates: false
      }
    }
  ];

  async function createRecommendedTemplates() {
    if (!window.CURRENT_IS_SUPER_ADMIN) return;
    setTemplatePresetsStatus('Creating templates...', '#111827');
    try {
      if (!permissionTemplates.length) {
        const res = await fetchJSON('/api/permission-templates');
        permissionTemplates = (res && res.templates) || [];
      }

      const existing = new Set(
        (permissionTemplates || []).map(t => (t.name || '').trim().toLowerCase())
      );
      const toCreate = RECOMMENDED_TEMPLATES.filter(
        tpl => !existing.has(tpl.name.trim().toLowerCase())
      );
      if (!toCreate.length) {
        setTemplatePresetsStatus('All recommended templates already exist.', '#059669');
        return;
      }

      for (const tpl of toCreate) {
        await fetchJSON('/api/permission-templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getCsrfHeader() },
          body: JSON.stringify(tpl)
        });
      }

      setTemplatePresetsStatus(`Created ${toCreate.length} template${toCreate.length === 1 ? '' : 's'}.`, '#059669');
      await loadRoleTemplates({ force: true });
      if (typeof window.reloadPermissionTemplates === 'function') {
        await window.reloadPermissionTemplates({ force: true });
      }
    } catch (err) {
      console.error('Create recommended templates error', err);
      setTemplatePresetsStatus(err?.message || 'Failed to create templates.', 'crimson');
    }
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
    if (templatePermViewAllTimesheets) templatePermViewAllTimesheets.checked = !!template.permissions?.view_all_timesheets;
    if (templatePermAssignTimesheets) templatePermAssignTimesheets.checked = !!template.permissions?.assign_timesheets;
    if (templatePermViewPayroll) templatePermViewPayroll.checked = !!template.permissions?.view_payroll;
    if (templatePermModifyPayroll) templatePermModifyPayroll.checked = !!template.permissions?.modify_payroll;
    if (templatePermModifyRates) templatePermModifyRates.checked = !!template.permissions?.modify_pay_rates;
    if (templateDeleteBtn) templateDeleteBtn.disabled = false;
    if (templateSaveBtn) templateSaveBtn.textContent = 'Update template';
  }

  if (postBootstrapQboBtn && !postBootstrapQboBtn.dataset.bound) {
    postBootstrapQboBtn.dataset.bound = '1';
    postBootstrapQboBtn.addEventListener('click', async () => {
      const orgId = window.CURRENT_ORG && window.CURRENT_ORG.id;
      const action = String(postBootstrapQboBtn.dataset.action || '').trim();
      if (action === 'undo-skip') {
        if (!orgId) return;
        setQboSkipped(orgId, false);
        setPostBootstrapStepSkipped('qbo', false);
        setPostBootstrapStepExpanded('qbo', true);
        updatePostBootstrapChecklist();
        return;
      }
      if (orgId) {
        setQboSkipped(orgId, false);
        setPostBootstrapStepSkipped('qbo', false);
      }
      const shouldContinue = postBootstrapQboBtn.dataset.continue === '1';
      const selectedDefaults = {
        employees: true,
        projects: true,
        vendors: true,
        accounts: true
      };
      const savedSelections = getQboOnboardingSelections(orgId);
      const selections = savedSelections && typeof savedSelections === 'object'
        ? { ...selectedDefaults, ...savedSelections }
        : selectedDefaults;

      if (shouldContinue && orgId) {
        setQboOnboardingSelections(orgId, selections);
        setPostBootstrapQboStatus('QuickBooks is connected. Resuming setup...', '#0f766e');
        clearQboOnboardingState();
        await openQboOnboardingModal({ step: 3 });
        setQboSelectionsInInputs(selections);
        runQboOnboardingSync(selections).catch(err => {
          if (qboOnboardingError) {
            qboOnboardingError.textContent = err?.message || 'QuickBooks sync failed.';
            qboOnboardingError.style.color = '#b91c1c';
          }
        });
        return;
      }

      setQboOnboardingSelections(orgId, selectedDefaults);
      clearQboOnboardingState();
      openQboOnboardingModal({ step: 1, resetSelections: true }).catch(err => {
        console.error('Failed to open QBO onboarding modal:', err);
      });
    });
  }

  if (postBootstrapQboSkipBtn && !postBootstrapQboSkipBtn.dataset.bound) {
    postBootstrapQboSkipBtn.dataset.bound = '1';
    postBootstrapQboSkipBtn.addEventListener('click', () => {
      const orgId = window.CURRENT_ORG && window.CURRENT_ORG.id;
      if (!orgId) return;
      setQboSkipped(orgId, true);
      clearQboOnboardingState();
      setPostBootstrapStepSkipped('qbo', true);
      setPostBootstrapStepExpanded('qbo', false);
      setPostBootstrapStepExpanded('permissions', true);
      updatePostBootstrapChecklist();
    });
  }

  if (postBootstrapPermissionsBtn && !postBootstrapPermissionsBtn.dataset.bound) {
    postBootstrapPermissionsBtn.dataset.bound = '1';
    postBootstrapPermissionsBtn.addEventListener('click', openAdminLoginsFromOnboarding);
  }

  if (kioskRotateBtn) {
    kioskRotateBtn.addEventListener('click', () => {
      rotateEnrollmentCode();
    });
  }

  if (kioskOpenBtn) {
    kioskOpenBtn.addEventListener('click', () => {
      window.location.href = '/kiosk';
    });
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

  if (templatePresetsBtn) {
    templatePresetsBtn.addEventListener('click', () => {
      createRecommendedTemplates();
    });
  }

  function clearPasswordInputs() {
    if (passwordFields.current) passwordFields.current.value = '';
    if (passwordFields.next) passwordFields.next.value = '';
    if (passwordFields.confirm) passwordFields.confirm.value = '';
  }

  function clearAccountEmailInputs() {
    if (accountEmailNew) accountEmailNew.value = '';
    if (accountEmailConfirm) accountEmailConfirm.value = '';
    if (accountEmailPassword) accountEmailPassword.value = '';
  }

  function deriveCurrentAdminAccess(perms = {}) {
    const isSuperAdmin = !!window.CURRENT_IS_SUPER_ADMIN;
    const approveTime = coerceAccessFlag(perms.approve_time) || isSuperAdmin;
    const modifyTime = coerceAccessFlag(perms.modify_time) || approveTime;
    return {
      see_shipments: coerceAccessFlag(perms.see_shipments),
      modify_time: modifyTime,
      approve_time: approveTime,
      view_time_reports: coerceAccessFlag(perms.view_time_reports) || isSuperAdmin,
      view_all_timesheets: coerceAccessFlag(perms.view_all_timesheets) || isSuperAdmin,
      assign_timesheets: coerceAccessFlag(perms.assign_timesheets) || isSuperAdmin,
      modify_pay_rates: coerceAccessFlag(perms.modify_pay_rates) || isSuperAdmin,
      modify_payroll: isSuperAdmin,
      view_payroll: isSuperAdmin
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
          view_all_timesheets: !!admin.view_all_timesheets,
          assign_timesheets: !!admin.assign_timesheets,
          modify_pay_rates: !!admin.modify_pay_rates
        };
        const tr = document.createElement('tr');
        tr.dataset.adminId = admin.id;
        tr.innerHTML = `
          <td>${escapeHTML(admin.name || '')}</td>
          <td class="center"><input type="checkbox" data-perm="see_shipments" ${perms.see_shipments ? 'checked' : ''}></td>
          <td class="center"><input type="checkbox" data-perm="modify_time" ${perms.modify_time ? 'checked' : ''}></td>
          <td class="center"><input type="checkbox" data-perm="view_time_reports" ${perms.view_time_reports ? 'checked' : ''}></td>
          <td class="center"><input type="checkbox" data-perm="view_all_timesheets" ${perms.view_all_timesheets ? 'checked' : ''}></td>
          <td class="center"><input type="checkbox" data-perm="assign_timesheets" ${perms.assign_timesheets ? 'checked' : ''}></td>
          <td class="center"><input type="checkbox" data-perm="modify_pay_rates" ${perms.modify_pay_rates ? 'checked' : ''}></td>
        `;

        tr.querySelectorAll('input[data-perm]').forEach(input => {
          input.addEventListener('change', () => {
            onboardingPermissionsDraftChanged = true;
          });
        });
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
        let meData = window.PREFETCHED_ME_DATA || null;
        window.PREFETCHED_ME_DATA = null;
        if (!meData) {
          const meRes = await fetch('/api/auth/me');
          if (meRes.ok) {
            meData = await meRes.json();
          }
        }
        if (meData) {
          window.CURRENT_EMPLOYEE = meData.employee || null;
          window.CURRENT_USER = meData.user || null;
          currentUiMode = meData?.ui_mode === 'kiosk' ? 'kiosk' : 'desktop';
          window.CURRENT_UI_MODE = currentUiMode;
          if (accountEmailCurrent) {
            accountEmailCurrent.value = meData?.user?.email || '';
          }
          window.CURRENT_IS_SUPER_ADMIN = !!meData?.membership?.is_super_admin;
          window.CURRENT_ORG = meData.org || null;
          storeLastOrgId(meData?.org?.id);
          window.CURRENT_ORG_TIMEZONE = meData?.org?.timezone || null;
          window.CURRENT_SECTION_FEATURES = normalizeSectionFeatures(
            meData?.features || {}
          );
          const currentOrgId = meData?.org?.id || null;
          if (meData?.just_bootstrapped && currentOrgId) {
            clearBootstrapOnboardingLocalState(currentOrgId);
          }
          if (window.CURRENT_IS_SUPER_ADMIN && !isOnboardingSkipped(currentOrgId)) {
            showPostBootstrapCard(true);
          } else {
            showPostBootstrapCard(false);
          }
          const currentAccess = deriveCurrentAdminAccess(meData.permissions || {});
          window.CURRENT_ACCESS_PERMS = {
            ...(window.CURRENT_ACCESS_PERMS || {}),
            ...currentAccess
          };
          applySectionAccessNav(window.CURRENT_ACCESS_PERMS);
          if (typeof loadAssignableAdmins === 'function' &&
              typeof canAssignTimesheets === 'function' &&
              canAssignTimesheets()) {
            await loadAssignableAdmins();
          }
          if (window.CURRENT_IS_SUPER_ADMIN && typeof loadShareableAdmins === 'function') {
            await loadShareableAdmins();
          }
          if (typeof renderSessionsTable === 'function') {
            renderSessionsTable();
          }
          if (typeof applyTimeEntryApprovalAccess === 'function') {
            applyTimeEntryApprovalAccess();
          }
          if (typeof window.applyPayrollSettingsAccess === 'function') {
            window.applyPayrollSettingsAccess();
          }
          if (typeof applyRateAccessToEmployees === 'function') {
            applyRateAccessToEmployees(window.CURRENT_ACCESS_PERMS);
          }
          if (typeof applySuperAdminAccessToEmployees === 'function') {
            applySuperAdminAccessToEmployees(window.CURRENT_IS_SUPER_ADMIN);
          }
          applyQuickBooksSettingsVisibility();
          applyBackupCardVisibility();
          applyAuditCardVisibility();
          applyDeviceSetupVisibility();
          applyRoleTemplatesVisibility();
          applyDashboardLinkVisibility();
          const activeNavItem = document.querySelector('.nav-item.active');
          if (activeNavItem && typeof updateQbCardForSection === 'function') {
            updateQbCardForSection(activeNavItem.dataset.section);
          }
          updateDashboardHero();
          updateDashboardQboBadge();
          refreshDashboardSnapshot();
          if (typeof initAuditReports === 'function') {
            initAuditReports();
          }
          if (window.CURRENT_IS_SUPER_ADMIN) {
            await loadBackupRuntimeStatus();
            await loadEnrollmentCode();
          }
        }
        applyAccountViewModeSwitcher();
        if (window.QBO_JUST_CONNECTED) {
          await resumeQboOnboardingIfNeeded();
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
      if (settingsFields.storage_container_daily_late_fee_default) {
        const fee =
          data.storage_container_daily_late_fee_default === null ||
          typeof data.storage_container_daily_late_fee_default === 'undefined'
            ? ''
            : data.storage_container_daily_late_fee_default;
        settingsFields.storage_container_daily_late_fee_default.value = fee;
      }
      if (settingsFields.clock_in_photo_required) {
        settingsFields.clock_in_photo_required.checked = asBool(data.clock_in_photo_required);
      }
      if (settingsFields.audit_log_retention_days) {
        const rawRetention = data.audit_log_retention_days;
        settingsFields.audit_log_retention_days.value =
          rawRetention === null || typeof rawRetention === 'undefined' ? '' : rawRetention;
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
    } finally {
      // Safety fallback: ensure boot gate is removed even if profile/settings fetch fails.
      clearAppBooting();
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
        view_all_timesheets: row.querySelector('input[data-perm="view_all_timesheets"]')?.checked || false,
        assign_timesheets: row.querySelector('input[data-perm="assign_timesheets"]')?.checked || false,
        modify_pay_rates: row.querySelector('input[data-perm="modify_pay_rates"]')?.checked || false
      };
    });
    return map;
  }

  async function saveSettings() {
    const orgId = window.CURRENT_ORG && window.CURRENT_ORG.id;
    const permissionsEdited = !!onboardingPermissionsDraftChanged;
    const rawStorageFee = settingsFields.storage_daily_late_fee_default?.value || '';
    const storageFee =
      rawStorageFee.trim() === '' ? null : Number(rawStorageFee);
    const rawContainerFee =
      settingsFields.storage_container_daily_late_fee_default?.value || '';
    const containerFee =
      rawContainerFee.trim() === '' ? null : Number(rawContainerFee);
    const rawAuditRetention = settingsFields.audit_log_retention_days?.value || '';
    const trimmedAuditRetention = rawAuditRetention.trim();
    let auditRetention = null;
    if (trimmedAuditRetention !== '') {
      const parsedRetention = Number(trimmedAuditRetention);
      if (!Number.isFinite(parsedRetention) || parsedRetention < 0 || !Number.isInteger(parsedRetention)) {
        if (settingsStatus) {
          settingsStatus.textContent = 'Audit log retention must be a whole number (0 or greater).';
          settingsStatus.style.color = '#b91c1c';
        }
        return;
      }
      auditRetention = parsedRetention;
    }
    const payload = {
      company_name: settingsFields.company_name?.value || '',
      company_email: settingsFields.company_email?.value || '',
      storage_daily_late_fee_default: Number.isNaN(storageFee) ? null : storageFee,
      storage_container_daily_late_fee_default: Number.isNaN(containerFee) ? null : containerFee,
      clock_in_photo_required: settingsFields.clock_in_photo_required?.checked || false,
      time_exception_rules: collectExceptionRuleSettings()
    };
    if (window.CURRENT_IS_SUPER_ADMIN) {
      payload.audit_log_retention_days = auditRetention;
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
        if (permissionsEdited && orgId) {
          setOnboardingPermissionsComplete(orgId, true);
          setOnboardingPermissionsSkipped(orgId, false);
          onboardingPermissionsDraftChanged = false;
        }
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

      if (permissionsEdited && orgId) {
        setPostBootstrapStepComplete('permissions', true);
        setPostBootstrapStepSkipped('permissions', false);
        if (postBootstrapCard && !postBootstrapCard.classList.contains('hidden')) {
          updatePostBootstrapChecklist();
        }
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

  await loadSettings();
  if (window.QBO_JUST_CONNECTED) {
    await resumeQboOnboardingIfNeeded();
  }

  if (settingsSaveBtn) {
    settingsSaveBtn.addEventListener('click', saveSettings);
  }

  async function updateAccountEmail() {
    if (!accountEmailSave) return;
    const currentEmail = String(accountEmailCurrent?.value || '').trim();
    const nextEmail = String(accountEmailNew?.value || '').trim();
    const confirmEmail = String(accountEmailConfirm?.value || '').trim();
    const currentPassword = String(accountEmailPassword?.value || '');

    if (!nextEmail || !confirmEmail || !currentPassword) {
      setAccountEmailStatus('Fill out email and password fields to update your email.', '#b45309');
      return;
    }
    if (nextEmail !== confirmEmail) {
      setAccountEmailStatus('New email and confirmation do not match.', 'crimson');
      return;
    }
    if (currentEmail && nextEmail.toLowerCase() === currentEmail.toLowerCase()) {
      setAccountEmailStatus('New email matches your current email.', '#b45309');
      return;
    }

    const originalText = accountEmailSave.textContent || 'Update Email';
    accountEmailSave.disabled = true;
    accountEmailSave.textContent = 'Updating…';
    setAccountEmailStatus('Updating email…', '');

    try {
      const res = await fetchJSON('/api/auth/change-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: currentPassword,
          new_email: nextEmail
        })
      });
      const updatedEmail = res?.email || nextEmail;
      if (accountEmailCurrent) accountEmailCurrent.value = updatedEmail;
      if (window.CURRENT_USER) {
        window.CURRENT_USER.email = updatedEmail;
      }
      setAccountEmailStatus('Email updated.', 'green');
      clearAccountEmailInputs();
    } catch (err) {
      console.error('Email update error:', err);
      setAccountEmailStatus(err.message || 'Failed to update email.', 'crimson');
    } finally {
      accountEmailSave.disabled = false;
      accountEmailSave.textContent = originalText;
    }
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

  if (accountEmailSave) {
    accountEmailSave.addEventListener('click', updateAccountEmail);
  }

  async function switchAccountViewMode() {
    if (!accountViewModeBtn || !canSwitchAdminViewMode()) return;
    const targetMode = currentUiMode === 'kiosk' ? 'desktop' : 'kiosk';
    const targetLabel = targetMode === 'kiosk' ? 'kiosk view' : 'desktop view';
    const originalText = accountViewModeBtn.textContent || 'Switch View';
    accountViewModeBtn.disabled = true;
    accountViewModeBtn.textContent = 'Switching…';
    setAccountViewModeStatus(`Opening ${targetLabel}…`, '');

    try {
      await fetchJSON('/api/auth/ui-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: targetMode })
      });
      currentUiMode = targetMode;
      window.CURRENT_UI_MODE = currentUiMode;
      window.location.href = targetMode === 'kiosk' ? '/kiosk' : '/';
    } catch (err) {
      console.error('UI mode switch error:', err);
      setAccountViewModeStatus(err.message || 'Failed to switch views.', 'crimson');
      accountViewModeBtn.disabled = false;
      accountViewModeBtn.textContent = originalText;
      applyAccountViewModeSwitcher();
    }
  }

  if (accountViewModeBtn) {
    accountViewModeBtn.addEventListener('click', switchAccountViewMode);
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
      await loadBackupRuntimeStatus();
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
      if (timeEntryEditInModal) {
        resetTimeEntryFormToNewMode();
        restoreTimeEntryFormToCard();
        closeTimeEntryDetails();
        return;
      }

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
  const timeFilterIncludeToggle = document.getElementById('te-filter-include-toggle');
  const timeFilterIncludeMenu = document.getElementById('te-filter-include-menu');
  const timeFilterIncludeApproved = document.getElementById('te-filter-include-approved');
  const timeFilterIncludePaid = document.getElementById('te-filter-include-paid');
  const timeFilterPayrollApprovalLegacy = document.getElementById('te-filter-payroll-approval');
  const timeFilterRange     = document.getElementById('te-filter-date-range');
  const timeFilterStart     = document.getElementById('te-filter-start');
  const timeFilterEnd       = document.getElementById('te-filter-end');
  const approveSelectedBtn  = document.getElementById('te-approve-selected');

  function closeTimeEntryIncludeMenu() {
    if (timeFilterIncludeMenu) timeFilterIncludeMenu.classList.add('hidden');
    if (timeFilterIncludeToggle) {
      timeFilterIncludeToggle.setAttribute('aria-expanded', 'false');
    }
  }

  if (timeFilterIncludeToggle && timeFilterIncludeMenu) {
    timeFilterIncludeToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = timeFilterIncludeMenu.classList.contains('hidden');
      timeFilterIncludeMenu.classList.toggle('hidden');
      timeFilterIncludeToggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
    timeFilterIncludeMenu.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    document.addEventListener('click', (e) => {
      if (!timeFilterIncludeMenu.contains(e.target) && !timeFilterIncludeToggle.contains(e.target)) {
        closeTimeEntryIncludeMenu();
      }
    });
  }
  updateTimeEntryIncludeToggleLabel();

  if (timeFilterApplyBtn) {
    timeFilterApplyBtn.addEventListener('click', () => {
      const filters = getTimeEntryFiltersFromUi();
      if (hasActiveTimeEntryFilters(filters)) {
        resetTimeEntryPagination();
        loadTimeEntriesTable(filters);
      } else {
        resetTimeEntryPagination();
        loadTimeEntriesTable({});
      }
    });
  }

  if (timeFilterClearBtn) {
    timeFilterClearBtn.addEventListener('click', () => {
      if (timeFilterEmployee) timeFilterEmployee.value = '';
      if (timeFilterProject)  timeFilterProject.value  = '';
      if (timeFilterIncludeApproved) timeFilterIncludeApproved.checked = false;
      if (timeFilterIncludePaid) timeFilterIncludePaid.checked = false;
      if (timeFilterPayrollApprovalLegacy) timeFilterPayrollApprovalLegacy.value = 'all';
      if (timeFilterRange)    timeFilterRange.value    = 'all';
      if (timeFilterStart)    timeFilterStart.value    = '';
      if (timeFilterEnd)      timeFilterEnd.value      = '';
      updateTimeEntryIncludeToggleLabel();
      closeTimeEntryIncludeMenu();
      applyTimeEntryDateRangeMode(timeFilterRange ? timeFilterRange.value : 'all');

      resetTimeEntryPagination();
      loadTimeEntriesTable(getTimeEntryFiltersFromUi());
    });
  }

  const pagePrevBtn = document.getElementById('te-page-prev');
  const pageNextBtn = document.getElementById('te-page-next');
  if (pagePrevBtn) {
    pagePrevBtn.addEventListener('click', () => {
      if (timeEntryCurrentPage <= 1) return;
      timeEntryCurrentPage -= 1;
      loadTimeEntriesTable(timeEntryLastFilters);
    });
  }
  if (pageNextBtn) {
    pageNextBtn.addEventListener('click', () => {
      timeEntryCurrentPage += 1;
      loadTimeEntriesTable(timeEntryLastFilters);
    });
  }

  if (timeFilterIncludeApproved) {
    timeFilterIncludeApproved.addEventListener('change', () => {
      updateTimeEntryIncludeToggleLabel();
      resetTimeEntryPagination();
      const filters = getTimeEntryFiltersFromUi();
      loadTimeEntriesTable(filters);
    });
  }
  if (timeFilterIncludePaid) {
    timeFilterIncludePaid.addEventListener('change', () => {
      updateTimeEntryIncludeToggleLabel();
      resetTimeEntryPagination();
      const filters = getTimeEntryFiltersFromUi();
      loadTimeEntriesTable(filters);
    });
  }
  if (timeFilterPayrollApprovalLegacy) {
    timeFilterPayrollApprovalLegacy.addEventListener('change', () => {
      const filters = getTimeEntryFiltersFromUi();
      loadTimeEntriesTable(filters);
    });
  }

  if (timeFilterRange) {
    timeFilterRange.addEventListener('change', () => {
      applyTimeEntryDateRangeMode(timeFilterRange.value);
    });
    applyTimeEntryDateRangeMode(timeFilterRange.value);
  } else {
    applyTimeEntryDateRangeMode('range');
  }

  if (approveSelectedBtn) {
    if (!approveSelectedBtn.dataset.bound) {
      approveSelectedBtn.dataset.bound = '1';
      approveSelectedBtn.addEventListener('click', approveSelectedTimeEntries);
    }
    const canApprove = !!(window.CURRENT_ACCESS_PERMS && window.CURRENT_ACCESS_PERMS.approve_time);
    approveSelectedBtn.style.display = canApprove ? 'inline-flex' : 'none';
  }

  // ───────── Time Entries Report (view-only) ─────────
  const reportApplyBtn = document.getElementById('ter-filter-apply');
  const reportClearBtn = document.getElementById('ter-filter-clear');
  const reportEmployee = document.getElementById('ter-filter-employee');
  const reportProject  = document.getElementById('ter-filter-project');
  const reportStart    = document.getElementById('ter-filter-start');
  const reportEnd      = document.getElementById('ter-filter-end');
  const reportPrevBtn  = document.getElementById('ter-page-prev');
  const reportNextBtn  = document.getElementById('ter-page-next');

  if (reportApplyBtn) {
    reportApplyBtn.addEventListener('click', () => {
      resetTimeEntriesReportPagination();
      loadTimeEntriesReportTable(getTimeEntriesReportFiltersFromUi());
    });
  }

  if (reportClearBtn) {
    reportClearBtn.addEventListener('click', () => {
      if (reportEmployee) reportEmployee.value = '';
      if (reportProject) reportProject.value = '';
      if (reportStart) reportStart.value = '';
      if (reportEnd) reportEnd.value = '';

      resetTimeEntriesReportPagination();
      loadTimeEntriesReportTable(getTimeEntriesReportFiltersFromUi());
    });
  }

  if (reportPrevBtn) {
    reportPrevBtn.addEventListener('click', () => {
      if (timeEntriesReportCurrentPage <= 1) return;
      timeEntriesReportCurrentPage -= 1;
      loadTimeEntriesReportTable({
        ...timeEntriesReportLastFilters,
        page: timeEntriesReportCurrentPage
      });
    });
  }

  if (reportNextBtn) {
    reportNextBtn.addEventListener('click', () => {
      timeEntriesReportCurrentPage += 1;
      loadTimeEntriesReportTable({
        ...timeEntriesReportLastFilters,
        page: timeEntriesReportCurrentPage
      });
    });
  }

  const detailCloseBtn = document.getElementById('time-entry-detail-close');
  const detailEditBtn = document.getElementById('time-entry-detail-edit');
  const detailOverlay = document.getElementById('time-entry-detail-overlay');
  const noteBackdrop = document.getElementById('time-entry-note-backdrop');
  const noteCloseBtn = document.getElementById('time-entry-note-close');
  const noteOkBtn = document.getElementById('time-entry-note-ok');
  const approveNoteBackdrop = document.getElementById('time-entry-approve-note-backdrop');
  const approveNoteCloseBtn = document.getElementById('time-entry-approve-note-close');
  const approveNoteCancelBtn = document.getElementById('time-entry-approve-note-cancel');
  const approveNoteSubmitBtn = document.getElementById('time-entry-approve-note-submit');
  const approveNoteInput = document.getElementById('time-entry-approve-note-input');
  const reviewWarningBackdrop = document.getElementById('time-entry-review-warning-backdrop');
  const reviewWarningCloseBtn = document.getElementById('time-entry-review-warning-close');
  const reviewWarningCancelBtn = document.getElementById('time-entry-review-warning-cancel');
  const reviewWarningOkBtn = document.getElementById('time-entry-review-warning-ok');
  if (detailCloseBtn) {
    detailCloseBtn.addEventListener('click', closeTimeEntryDetails);
  }
  if (detailOverlay) {
    detailOverlay.addEventListener('click', evt => {
      if (evt.target === detailOverlay) {
        closeTimeEntryDetails();
      }
    });
  }
  if (detailEditBtn) {
    detailEditBtn.addEventListener('click', async () => {
      const detail = currentTimeEntryDetail;
      if (detail && detail.rowElement) {
        enterTimeEntryEditModal();
        await loadTimeEntryIntoFormFromRow(detail.rowElement, { showFormCard: false });
      }
    });
  }
  if (noteBackdrop) {
    noteBackdrop.addEventListener('click', closeTimeEntryNoteModal);
  }
  if (noteCloseBtn) {
    noteCloseBtn.addEventListener('click', closeTimeEntryNoteModal);
  }
  if (noteOkBtn) {
    noteOkBtn.addEventListener('click', closeTimeEntryNoteModal);
  }
  if (approveNoteBackdrop) {
    approveNoteBackdrop.addEventListener('click', () => closeTimeEntryApproveNoteModal(null));
  }
  if (approveNoteCloseBtn) {
    approveNoteCloseBtn.addEventListener('click', () => closeTimeEntryApproveNoteModal(null));
  }
  if (approveNoteCancelBtn) {
    approveNoteCancelBtn.addEventListener('click', () => closeTimeEntryApproveNoteModal(null));
  }
  if (approveNoteSubmitBtn) {
    approveNoteSubmitBtn.addEventListener('click', () => {
      const val = approveNoteInput ? approveNoteInput.value : '';
      closeTimeEntryApproveNoteModal(val);
    });
  }
  if (reviewWarningBackdrop) {
    reviewWarningBackdrop.addEventListener('click', () => closeTimeEntryReviewWarningModal(false));
  }
  if (reviewWarningCloseBtn) {
    reviewWarningCloseBtn.addEventListener('click', () => closeTimeEntryReviewWarningModal(false));
  }
  if (reviewWarningCancelBtn) {
    reviewWarningCancelBtn.addEventListener('click', () => closeTimeEntryReviewWarningModal(false));
  }
  if (reviewWarningOkBtn) {
    reviewWarningOkBtn.addEventListener('click', () => closeTimeEntryReviewWarningModal(true));
  }

  // ───────── Live open punches ─────────
  // ⚠️ Moved to initPayrollTabIfNeeded()
  // if (typeof loadOpenPunches === 'function') {
  //   loadOpenPunches();
  // }

  // ───────── Sessions (kiosks) ─────────
  const canLoadTimeSections =
    isSectionFeatureEnabled('time', window.CURRENT_SECTION_FEATURES) &&
    !!(
      (window.CURRENT_ACCESS_PERMS &&
        (window.CURRENT_ACCESS_PERMS.modify_time ||
          window.CURRENT_ACCESS_PERMS.view_time_reports ||
          window.CURRENT_ACCESS_PERMS.view_payroll ||
          window.CURRENT_ACCESS_PERMS.view_all_timesheets ||
          window.CURRENT_ACCESS_PERMS.assign_timesheets)) ||
      window.CURRENT_IS_SUPER_ADMIN
    );

  if (canLoadTimeSections && typeof loadSessionsSection === 'function') {
    loadSessionsSection();
  }

  // ───────── Shipments ─────────
  const canSeeShipments =
    window.CURRENT_ACCESS_PERMS?.see_shipments &&
    isSectionFeatureEnabled('shipments', window.CURRENT_SECTION_FEATURES);

  if (canSeeShipments) {
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
    if (shipmentCloseTop && typeof attemptCloseShipmentCreateModal === 'function') {
      shipmentCloseTop.addEventListener('click', attemptCloseShipmentCreateModal);
    }

    const shipmentSaveClose = document.getElementById('shipment-save-close');
    if (shipmentSaveClose && typeof saveShipmentFromModal === 'function') {
      shipmentSaveClose.addEventListener('click', async () => {
        shipmentSaveClose.disabled = true;
        const step =
          shipmentCreateForm?.dataset.step ||
          document.getElementById('shipment-create-form')?.dataset.step ||
          '1';
        if (step === '1') {
          const shipmentId = document.getElementById('shipment-id')?.value || '';
          const hasExistingShipment = !!shipmentId;
          await saveShipmentFromModal({
            stayOpen: false,
            skipItems: !hasExistingShipment,
            successMessage: 'Draft saved.'
          });
        } else {
          await saveShipmentFromModal({
            stayOpen: false,
            successMessage: 'Draft saved.'
          });
        }
        shipmentSaveClose.disabled = false;
      });
    }

    const shipmentAddItemBtn = document.getElementById('shipment-add-item-row');
    if (shipmentAddItemBtn && typeof addShipmentItemRow === 'function') {
      shipmentAddItemBtn.addEventListener('click', () => {
        addShipmentItemRow();
      });
    }

    // Shipment create modal wiring
    const shipmentCreateBackdrop = document.getElementById('shipment-create-backdrop');
    if (shipmentCreateBackdrop && typeof attemptCloseShipmentCreateModal === 'function') {
      shipmentCreateBackdrop.addEventListener('click', (e) => {
        if (e.target === shipmentCreateBackdrop) {
          attemptCloseShipmentCreateModal();
        }
      });
    }

    const shipmentCreateClose = document.getElementById('shipment-create-close');
    if (shipmentCreateClose && typeof attemptCloseShipmentCreateModal === 'function') {
      shipmentCreateClose.addEventListener('click', attemptCloseShipmentCreateModal);
    }

    const shipmentCreateBack = document.getElementById('shipment-create-back');
    if (shipmentCreateBack && typeof setShipmentCreateStep === 'function') {
      shipmentCreateBack.addEventListener('click', () => {
        const step =
          shipmentCreateForm?.dataset.step ||
          document.getElementById('shipment-create-form')?.dataset.step ||
          '1';
        if (step === '5') {
          setShipmentCreateStep(4);
        } else if (step === '4') {
          setShipmentCreateStep(3);
        } else if (step === '3') {
          setShipmentCreateStep(2);
        } else if (step === '2') {
          setShipmentCreateStep(1);
        }
      });
    }

    const shipmentStepNext = document.getElementById('shipment-step-next');
    if (shipmentStepNext && typeof saveShipmentFromModal === 'function') {
      shipmentStepNext.addEventListener('click', async () => {
        shipmentStepNext.disabled = true;
        const step =
          shipmentCreateForm?.dataset.step ||
          document.getElementById('shipment-create-form')?.dataset.step ||
          '1';
        if (step === '1') {
          const result = await saveShipmentFromModal({
            stayOpen: true,
            skipItems: true,
            successMessage: 'Draft saved. Continue to items.'
          });
          shipmentStepNext.disabled = false;
          if (result && result.ok && typeof setShipmentCreateStep === 'function') {
            setShipmentCreateStep(2);
          }
          return;
        }

        if (step === '2') {
          const result = await saveShipmentFromModal({
            stayOpen: true,
            successMessage: 'Draft saved. Continue to payments.'
          });
          shipmentStepNext.disabled = false;
          if (result && result.ok && typeof setShipmentCreateStep === 'function') {
            setShipmentCreateStep(3);
          }
          return;
        }

        if (step === '3') {
          const result = await saveShipmentFromModal({
            stayOpen: true,
            successMessage: 'Draft saved. Continue to documents.'
          });
          shipmentStepNext.disabled = false;
          if (result && result.ok && typeof setShipmentCreateStep === 'function') {
            setShipmentCreateStep(4);
          }
          return;
        }

        if (step === '4') {
          const result = await saveShipmentFromModal({
            stayOpen: true,
            successMessage: 'Draft saved. Continue to pickup.'
          });
          shipmentStepNext.disabled = false;
          if (result && result.ok && typeof setShipmentCreateStep === 'function') {
            setShipmentCreateStep(5);
          }
          return;
        }

        shipmentStepNext.disabled = false;
      });
    }

    const shipmentCreateForm = document.getElementById('shipment-create-form');
    if (shipmentCreateForm && typeof saveShipmentFromModal === 'function') {
      shipmentCreateForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const step = shipmentCreateForm.dataset.step || '1';
        if (step === '1') {
          const result = await saveShipmentFromModal({
            stayOpen: true,
            skipItems: true,
            successMessage: 'Draft saved. Continue to items.'
          });
          if (result && result.ok && typeof setShipmentCreateStep === 'function') {
            setShipmentCreateStep(2);
          }
          return;
        }

        if (step === '2') {
          const result = await saveShipmentFromModal({
            stayOpen: true,
            successMessage: 'Draft saved. Continue to payments.'
          });
          if (result && result.ok && typeof setShipmentCreateStep === 'function') {
            setShipmentCreateStep(3);
          }
          return;
        }

        if (step === '3') {
          const result = await saveShipmentFromModal({
            stayOpen: true,
            successMessage: 'Draft saved. Continue to documents.'
          });
          if (result && result.ok && typeof setShipmentCreateStep === 'function') {
            setShipmentCreateStep(4);
          }
          return;
        }

        if (step === '4') {
          const result = await saveShipmentFromModal({
            stayOpen: true,
            successMessage: 'Draft saved. Continue to pickup.'
          });
          if (result && result.ok && typeof setShipmentCreateStep === 'function') {
            setShipmentCreateStep(5);
          }
          return;
        }

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
  }

  // Employee CREATE button
  const saveEmployeeBtn = document.getElementById('save-employee');
  if (saveEmployeeBtn && typeof saveEmployee === 'function') {
    saveEmployeeBtn.addEventListener('click', saveEmployee);
  }

  // Payroll reports are initialized when navigating to the Payroll Reports section.

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
