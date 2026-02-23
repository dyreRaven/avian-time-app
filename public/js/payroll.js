/* eslint-disable no-alert, no-console */

// Rebuilt payroll UI from scratch: summary, settings, send-to-QB toggle, custom lines,
// inline time-entry viewer/editor, and create-check payload wiring.

const DEFAULT_PAYROLL_MEMO_TEMPLATE = 'Payroll {start} – {end}';
const DEFAULT_PAYROLL_LINE_TEMPLATE = 'Labor {hours} hrs – {project}';
const PAYROLL_TEMPLATE_TOKENS = Object.freeze([
  '{start}',
  '{end}',
  '{dateRange}',
  '{employee}',
  '{project}',
  '{hours}'
]);
const PAYROLL_TEMPLATE_TOKEN_SET = new Set(PAYROLL_TEMPLATE_TOKENS);

let currentPayrollSettings = {
  bank_account_name: null,
  expense_account_name: null,
  receipt_expense_account_name: null,
  receipt_class_name: null,
  default_memo: DEFAULT_PAYROLL_MEMO_TEMPLATE,
  line_description_template: DEFAULT_PAYROLL_LINE_TEMPLATE
};
let currentPayrollRows = [];
let currentPayrollRange = { start: null, end: null };
let payrollOverrides = {}; // per-employee memo/line overrides
let payrollExpenseAccounts = [];
let payrollClasses = [];
let payrollProjects = [];
let payrollEmployees = [];
let payrollSettingsPromise = null;
let payrollSettingsLoaded = false;
let additionalLinesByEmployee = {}; // { empId: [ { id, description, amount, expenseAccountName, className } ] }
let payrollExpandedRows = new Set(); // track expanded rows so rerenders don't collapse
let payrollSendSelections = new Set(); // selected employee ids for "Send to QB"
let lastPayrollResults = null;
let lastPayrollRunId = null;
let lastPayrollRunStatus = null;
let lastPayrollPreflightId = null;
let lastPayrollPayloadHash = null;
let lastPayrollRunType = 'standard';
let lastPayrollAdjustmentReason = null;
let lastTimeEntriesContext = null;
let currentPayrollPendingApprovals = [];
let currentPayrollPendingApprovalCount = 0;
let payrollPendingApprovalsDismissed = false;
let payrollPendingApprovalsActionsBound = false;
let payrollReportRuns = [];
let payrollRunDetailsCache = {};
let currentPayrollReportRunId = null;
let currentPayrollRunReview = null;
let payrollRunReviewRetrySelections = new Set();
let payrollReportRunFilters = {
  start: '',
  end: '',
  status: '',
  runType: ''
};
let payrollReportCheckFilters = {
  employee: '',
  paid: ''
};
let auditReportsInitialized = false;
const PAYROLL_REIMBURSEMENT_PAGE_SIZE = 50;
let payrollReimbursementCurrentPage = 1;
let payrollReimbursementTotalPages = 1;
let payrollReimbursementTotalCount = 0;
let payrollReimbursementLastFilters = null;

function collectPayrollWarnings(results) {
  if (!Array.isArray(results)) return [];
  const list = [];
  results.forEach(r => {
    if (!r) return;
    const warnings = Array.isArray(r.warnings) ? r.warnings : [];
    const codes = Array.isArray(r.warningCodes) ? r.warningCodes : [];
    warnings.forEach((msg, idx) => {
      list.push({
        employee: r.employeeName || '(Employee)',
        message: msg,
        code: codes[idx] || codes[0] || null
      });
    });
  });
  return list;
}

function buildPendingApprovalsMessage(pendingRows) {
  if (!Array.isArray(pendingRows) || !pendingRows.length) return '';
  const maxRows = 8;
  const preview = pendingRows.slice(0, maxRows).map(row => {
    const employee = row?.employee_name || '(Employee)';
    const start = row?.start_date || '';
    const end = row?.end_date || '';
    const dateLabel = start && end ? `${start} to ${end}` : (start || end || 'unknown date');
    return `• ${employee} (${dateLabel})`;
  });
  const remaining = pendingRows.length - preview.length;
  const moreLine = remaining > 0 ? `\n• +${remaining} more` : '';
  return `\n\nPending approvals in this period:\n${preview.join('\n')}${moreLine}`;
}

function buildPendingApprovalsConfirmWarning({ pendingRows = [], pendingCount = null } = {}) {
  const rows = Array.isArray(pendingRows) ? pendingRows : [];
  const parsedCount = Number(pendingCount);
  const totalCount =
    Number.isFinite(parsedCount) && parsedCount >= 0
      ? parsedCount
      : rows.length;
  if (totalCount <= 0) return '';

  const maxRows = 6;
  const preview = rows.slice(0, maxRows).map(row => {
    const employee = row?.employee_name || '(Employee)';
    const start = row?.start_date || '';
    const end = row?.end_date || '';
    const dateLabel = start && end
      ? (start === end ? formatDateUS(start) : `${formatDateUS(start)} to ${formatDateUS(end)}`)
      : (start ? formatDateUS(start) : (end ? formatDateUS(end) : 'Unknown date'));
    return `• ${employee} (${dateLabel})`;
  });
  const remaining = Math.max(0, totalCount - preview.length);
  const heading = totalCount === 1
    ? 'Warning: 1 time entry in this period is not payroll-approved yet.'
    : `Warning: ${totalCount} time entries in this period are not payroll-approved yet.`;
  const previewText = preview.length
    ? `\n${preview.join('\n')}${remaining > 0 ? `\n• +${remaining} more` : ''}`
    : '';

  return `\n\n${heading}\nPayroll will run only for approved selected entries.${previewText}`;
}

function buildPayrollApiErrorMessage(err) {
  const base = (err && err.message) ? err.message : String(err || 'Unknown error');
  const pendingRows = Array.isArray(err?.body?.pending)
    ? err.body.pending
    : (Array.isArray(err?.body?.pending_approvals?.pending)
      ? err.body.pending_approvals.pending
      : []);
  if (Array.isArray(pendingRows) && pendingRows.length) {
    return base + buildPendingApprovalsMessage(pendingRows);
  }
  return base;
}

function openPayrollReviewTimeEntries() {
  if (typeof window.navigateToSection === 'function') {
    window.navigateToSection('time-entries');
  }
  const applyFilters = () => {
    const startEl = document.getElementById('te-filter-start');
    const endEl = document.getElementById('te-filter-end');
    const runBtn = document.getElementById('time-filter-apply');
    if (startEl && currentPayrollRange?.start) startEl.value = currentPayrollRange.start;
    if (endEl && currentPayrollRange?.end) endEl.value = currentPayrollRange.end;
    if (runBtn) runBtn.click();
  };
  setTimeout(applyFilters, 0);
  setTimeout(applyFilters, 120);
}

function renderPayrollPendingApprovalsBanner() {
  const box = document.getElementById('payroll-pending-approvals-banner');
  const textEl = document.getElementById('payroll-pending-approvals-text');
  const listEl = document.getElementById('payroll-pending-approvals-list');
  if (!box || !textEl || !listEl) return;

  const hasPending = currentPayrollPendingApprovalCount > 0;
  if (!hasPending || payrollPendingApprovalsDismissed) {
    box.classList.add('hidden');
    listEl.innerHTML = '';
    textEl.textContent = '';
    return;
  }

  const start = currentPayrollRange?.start ? formatDateUS(currentPayrollRange.start) : '';
  const end = currentPayrollRange?.end ? formatDateUS(currentPayrollRange.end) : '';
  const rangeLabel = start && end ? ` (${start} – ${end})` : '';
  const countLabel = currentPayrollPendingApprovalCount === 1 ? 'entry is' : 'entries are';
  textEl.textContent =
    `${currentPayrollPendingApprovalCount} time ${countLabel} still not approved for payroll${rangeLabel}. ` +
    'These unapproved entries are excluded and will not appear in the payroll entries below. ' +
    'You can continue with approved entries, or review these first.';

  listEl.innerHTML = '';
  const maxRows = 10;
  currentPayrollPendingApprovals.slice(0, maxRows).forEach(row => {
    const li = document.createElement('li');
    const employee = row?.employee_name || '(Employee)';
    const startDate = row?.start_date || '';
    const endDate = row?.end_date || '';
    const dateLabel = startDate && endDate
      ? (startDate === endDate ? formatDateUS(startDate) : `${formatDateUS(startDate)} to ${formatDateUS(endDate)}`)
      : (startDate ? formatDateUS(startDate) : (endDate ? formatDateUS(endDate) : 'Unknown date'));
    li.textContent = `${employee} (${dateLabel})`;
    listEl.appendChild(li);
  });
  const remaining = currentPayrollPendingApprovalCount - Math.min(maxRows, currentPayrollPendingApprovals.length);
  if (remaining > 0) {
    const li = document.createElement('li');
    li.textContent = `+${remaining} more`;
    listEl.appendChild(li);
  }

  box.classList.remove('hidden');
}

function setPayrollPendingApprovals(pendingRows = [], pendingCount = null) {
  currentPayrollPendingApprovals = Array.isArray(pendingRows) ? pendingRows : [];
  const parsedCount = Number(pendingCount);
  currentPayrollPendingApprovalCount =
    Number.isFinite(parsedCount) && parsedCount >= 0
      ? parsedCount
      : currentPayrollPendingApprovals.length;
  payrollPendingApprovalsDismissed = false;
  renderPayrollPendingApprovalsBanner();
}

function clearPayrollPendingApprovals() {
  currentPayrollPendingApprovals = [];
  currentPayrollPendingApprovalCount = 0;
  payrollPendingApprovalsDismissed = false;
  renderPayrollPendingApprovalsBanner();
}

function setupPayrollPendingApprovalsBannerActions() {
  if (payrollPendingApprovalsActionsBound) return;
  const continueBtn = document.getElementById('payroll-pending-approvals-continue');
  const reviewBtn = document.getElementById('payroll-pending-approvals-review');
  if (!continueBtn && !reviewBtn) return;

  if (continueBtn) {
    continueBtn.addEventListener('click', () => {
      payrollPendingApprovalsDismissed = true;
      renderPayrollPendingApprovalsBanner();
    });
  }
  if (reviewBtn) {
    reviewBtn.addEventListener('click', openPayrollReviewTimeEntries);
  }
  payrollPendingApprovalsActionsBound = true;
}

function isPayrollFeatureEnabled() {
  if (typeof isSectionFeatureEnabled !== 'function') return true;
  return isSectionFeatureEnabled('payroll');
}

function canModifyPayrollReports() {
  if (!isPayrollFeatureEnabled()) return false;
  const perms = window.CURRENT_ACCESS_PERMS || {};
  return (
    perms.modify_payroll === true ||
    perms.modify_payroll === 'true' ||
    perms.modify_payroll === 1 ||
    perms.modify_payroll === '1'
  );
}

function applyPayrollSettingsAccess() {
  if (!isPayrollFeatureEnabled()) return;
  const canEdit = canModifyPayrollReports();
  const fieldIds = [
    'payroll-bank-account',
    'payroll-expense-account',
    'payroll-receipt-expense-account',
    'payroll-receipt-class',
    'payroll-memo-template',
    'payroll-line-desc-template'
  ];
  fieldIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !canEdit;
  });
  const saveBtn = document.getElementById('payroll-settings-save');
  if (saveBtn) {
    saveBtn.disabled = !canEdit;
    saveBtn.title = canEdit ? '' : 'Requires modify payroll permission.';
  }

  // Payroll actions (create checks / unpay) require modify_payroll.
  const createBtn = document.getElementById('payroll-create-checks');
  if (createBtn) {
    createBtn.disabled = !canEdit;
    createBtn.title = canEdit ? '' : 'Requires modify payroll permission.';
  }
  const retryBtn = document.getElementById('payroll-retry-failed');
  if (retryBtn) {
    if (!canEdit) {
      retryBtn.disabled = true;
      retryBtn.title = 'Requires modify payroll permission.';
    } else {
      retryBtn.title = '';
    }
  }
  const runReviewRetryBtn = document.getElementById('payroll-run-review-retry-selected');
  if (runReviewRetryBtn) {
    runReviewRetryBtn.title = canEdit ? '' : 'Requires modify payroll permission.';
  }
  document.querySelectorAll('.payroll-run-review-select-failed').forEach(el => {
    el.disabled = !canEdit;
    el.title = canEdit ? '' : 'Requires modify payroll permission.';
  });
  updatePayrollRunReviewRetryButtonState();

  const reimbursementFieldIds = [
    'payroll-reimbursement-employee',
    'payroll-reimbursement-project',
    'payroll-reimbursement-amount',
    'payroll-reimbursement-date',
    'payroll-reimbursement-note',
    'payroll-reimbursement-vendor',
    'payroll-reimbursement-receipt'
  ];
  reimbursementFieldIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !canEdit;
  });
  const reimbursementBtn = document.getElementById('payroll-reimbursement-submit');
  if (reimbursementBtn) {
    reimbursementBtn.disabled = !canEdit;
    reimbursementBtn.title = canEdit ? '' : 'Requires modify payroll permission.';
  }
  const reimbursementOpenBtn = document.getElementById('payroll-reimbursement-open-modal');
  if (reimbursementOpenBtn) {
    reimbursementOpenBtn.disabled = !canEdit;
    reimbursementOpenBtn.title = canEdit ? '' : 'Requires modify payroll permission.';
  }
  document.querySelectorAll('.payroll-reimbursement-approve, .payroll-reimbursement-cancel').forEach(btn => {
    btn.disabled = !canEdit;
    btn.title = canEdit ? '' : 'Requires modify payroll permission.';
  });

  // Summary table contains per-employee memo/line item inputs which should also reflect access.
  applyPayrollSummaryAccess();
}

function applyPayrollSummaryAccess() {
  if (!isPayrollFeatureEnabled()) return;
  const canEdit = canModifyPayrollReports();
  const tbody = document.getElementById('payroll-summary-body');
  if (!tbody) return;

  const title = canEdit ? '' : 'Requires modify payroll permission.';

  tbody.querySelectorAll('.payroll-send-checkbox').forEach(el => {
    el.disabled = !canEdit;
    el.title = title;
  });

  tbody.querySelectorAll('.payroll-memo-input').forEach(el => {
    el.disabled = !canEdit;
    el.title = title;
  });

  tbody
    .querySelectorAll(
      '.line-expense-select, .line-class-select, .line-project-select'
    )
    .forEach(el => {
      el.disabled = !canEdit;
      el.title = title;
    });

  tbody.querySelectorAll('.line-desc-input, .line-amount-input').forEach(el => {
    el.disabled = !canEdit;
    el.title = title;
  });

  // Hide add/remove buttons in view-only mode so the UI doesn't look editable.
  tbody.querySelectorAll('.btn-add-line, .btn-remove-line').forEach(btn => {
    btn.disabled = !canEdit;
    btn.title = title;
    btn.style.display = canEdit ? '' : 'none';
  });
}

function rememberInputCaretPosition(input) {
  if (!input) return;
  const start = Number(input.selectionStart);
  const end = Number(input.selectionEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  input.dataset.caretStart = String(start);
  input.dataset.caretEnd = String(end);
}

function getInputCaretPosition(input) {
  const valueLength = String(input?.value || '').length;
  const isFocused = document.activeElement === input;
  let start = isFocused ? Number(input?.selectionStart) : Number(input?.dataset?.caretStart);
  let end = isFocused ? Number(input?.selectionEnd) : Number(input?.dataset?.caretEnd);

  if (!Number.isFinite(start) && isFocused) start = Number(input?.dataset?.caretStart);
  if (!Number.isFinite(end) && isFocused) end = Number(input?.dataset?.caretEnd);

  if (!Number.isFinite(start)) start = valueLength;
  if (!Number.isFinite(end)) end = start;

  start = Math.min(Math.max(0, start), valueLength);
  end = Math.min(Math.max(start, end), valueLength);

  return { start, end };
}

function insertTemplateTokenAtCaret(input, token) {
  if (!input || input.disabled || input.readOnly) return;
  const text = String(token || '');
  if (!text) return;

  const { start, end } = getInputCaretPosition(input);
  if (typeof input.setRangeText === 'function') {
    input.setRangeText(text, start, end, 'end');
  } else {
    const value = String(input.value || '');
    input.value = value.slice(0, start) + text + value.slice(end);
  }

  const cursor = start + text.length;
  input.dataset.caretStart = String(cursor);
  input.dataset.caretEnd = String(cursor);
  input.focus({ preventScroll: true });
  try {
    input.setSelectionRange(cursor, cursor);
  } catch {}
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function setupPayrollTemplateTagPalettes() {
  if (!isPayrollFeatureEnabled()) return;
  document.querySelectorAll('.tag-palette[data-target]').forEach(palette => {
    if (!palette || palette.dataset.bound === '1') return;
    const targetId = palette.dataset.target;
    if (!targetId) return;
    const targetInput = document.getElementById(targetId);
    if (!targetInput) return;

    palette.dataset.bound = '1';

    const trackCaret = () => rememberInputCaretPosition(targetInput);
    ['focus', 'click', 'keyup', 'input', 'select', 'blur'].forEach(evtName => {
      targetInput.addEventListener(evtName, trackCaret);
    });

    palette.addEventListener('click', evt => {
      const chip = evt.target.closest('.tag-chip[data-tag]');
      if (!chip) return;
      insertTemplateTokenAtCaret(targetInput, chip.dataset.tag || chip.textContent || '');
    });

    palette.addEventListener('dragstart', evt => {
      const chip = evt.target.closest('.tag-chip[data-tag]');
      if (!chip || !evt.dataTransfer) return;
      const token = chip.dataset.tag || chip.textContent || '';
      evt.dataTransfer.effectAllowed = 'copy';
      evt.dataTransfer.setData('text/plain', token);
    });

    targetInput.addEventListener('dragover', evt => {
      if (targetInput.disabled || targetInput.readOnly) return;
      if (!evt.dataTransfer) return;
      evt.preventDefault();
      evt.dataTransfer.dropEffect = 'copy';
    });

    targetInput.addEventListener('drop', evt => {
      if (targetInput.disabled || targetInput.readOnly) return;
      if (!evt.dataTransfer) return;
      const token = evt.dataTransfer.getData('text/plain');
      if (!token) return;
      evt.preventDefault();
      rememberInputCaretPosition(targetInput);
      insertTemplateTokenAtCaret(targetInput, token);
    });
  });
}

function setupPayrollTemplateHelpToggle() {
  if (!isPayrollFeatureEnabled()) return;
  const help = document.getElementById('payroll-template-help-text');
  const btn = document.getElementById('payroll-template-help-btn');
  if (!help || !btn || btn.dataset.bound === '1') return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', () => {
    const isHidden = help.classList.contains('hidden');
    help.classList.toggle('hidden', !isHidden);
    btn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
  });
}

function getPayrollTemplatePreviewEmployeeOptions() {
  const byId = new Map();
  (currentPayrollRows || []).forEach(row => {
    const id = Number(row?.employee_id);
    if (!Number.isFinite(id) || id <= 0) return;
    const key = String(id);
    if (byId.has(key)) return;
    const name = String(row?.employee_name || '').trim() || `Employee ${id}`;
    byId.set(key, { id: key, name });
  });
  (payrollEmployees || []).forEach(emp => {
    const id = Number(emp?.id);
    if (!Number.isFinite(id) || id <= 0) return;
    const key = String(id);
    if (byId.has(key)) return;
    const name = String(emp?.name || '').trim() || `Employee ${id}`;
    byId.set(key, { id: key, name });
  });
  return Array.from(byId.values());
}

function getPayrollTemplatePreviewProjectOptions() {
  const byId = new Map();
  (currentPayrollRows || []).forEach(row => {
    const id = Number(row?.project_id);
    if (!Number.isFinite(id) || id <= 0) return;
    const key = String(id);
    if (byId.has(key)) return;
    const rawName = String(row?.project_name_raw || row?.project_name || '').trim();
    const label = getProjectLabel(id, rawName || row?.project_name || '', row?.project_customer_name || '');
    byId.set(key, {
      id: key,
      name: rawName || String(row?.project_name || '').trim() || `Project ${id}`,
      label: label || rawName || `Project ${id}`
    });
  });
  (payrollProjects || []).forEach(project => {
    const id = Number(project?.id);
    if (!Number.isFinite(id) || id <= 0) return;
    const key = String(id);
    if (byId.has(key)) return;
    const name = String(project?.name || '').trim() || `Project ${id}`;
    const label = project?.customer_name ? `${project.customer_name} : ${name}` : name;
    byId.set(key, { id: key, name, label });
  });
  return Array.from(byId.values());
}

function populatePayrollTemplatePreviewSelectors(options = {}) {
  const { preserveSelection = true } = options || {};
  const employeeSelect = document.getElementById('payroll-template-preview-employee');
  const projectSelect = document.getElementById('payroll-template-preview-project');
  if (!employeeSelect || !projectSelect) return;

  const prevEmployee = preserveSelection ? employeeSelect.value : '';
  const prevProject = preserveSelection ? projectSelect.value : '';

  const employeeOptions = getPayrollTemplatePreviewEmployeeOptions();
  const projectOptions = getPayrollTemplatePreviewProjectOptions();

  employeeSelect.innerHTML = '';
  if (!employeeOptions.length) {
    employeeSelect.innerHTML = '<option value="">Sample Employee</option>';
  } else {
    employeeOptions.forEach(option => {
      const el = document.createElement('option');
      el.value = option.id;
      el.textContent = option.name;
      employeeSelect.appendChild(el);
    });
  }

  projectSelect.innerHTML = '';
  if (!projectOptions.length) {
    projectSelect.innerHTML = '<option value="">Sample Project</option>';
  } else {
    projectOptions.forEach(option => {
      const el = document.createElement('option');
      el.value = option.id;
      el.textContent = option.label || option.name;
      projectSelect.appendChild(el);
    });
  }

  if (prevEmployee && employeeSelect.querySelector(`option[value="${prevEmployee}"]`)) {
    employeeSelect.value = prevEmployee;
  } else if (employeeSelect.options.length) {
    employeeSelect.selectedIndex = 0;
  }

  if (prevProject && projectSelect.querySelector(`option[value="${prevProject}"]`)) {
    projectSelect.value = prevProject;
  } else if (projectSelect.options.length) {
    projectSelect.selectedIndex = 0;
  }
}

function getPayrollTemplatePreviewContext() {
  const startInput = document.getElementById('payroll-start');
  const endInput = document.getElementById('payroll-end');
  const employeeSelect = document.getElementById('payroll-template-preview-employee');
  const projectSelect = document.getElementById('payroll-template-preview-project');

  const selectedEmployeeId = Number(employeeSelect?.value || 0);
  const selectedProjectId = Number(projectSelect?.value || 0);

  const employeeRows = (currentPayrollRows || []).filter(
    row => Number(row?.employee_id) === selectedEmployeeId
  );
  const employeeProjectRow = employeeRows.find(
    row => Number(row?.project_id) === selectedProjectId
  );
  const anyProjectRow = (currentPayrollRows || []).find(
    row => Number(row?.project_id) === selectedProjectId
  ) || null;
  const employeeFallbackRow = employeeRows[0] || null;

  const employeeFromList = (payrollEmployees || []).find(
    emp => Number(emp?.id) === selectedEmployeeId
  ) || null;
  const projectFromList = (payrollProjects || []).find(
    project => Number(project?.id) === selectedProjectId
  ) || null;

  const employeeName = String(
    employeeFallbackRow?.employee_name ||
      employeeFromList?.name ||
      employeeSelect?.selectedOptions?.[0]?.textContent ||
      'Sample Employee'
  ).trim() || 'Sample Employee';

  const projectName = String(
    employeeProjectRow?.project_name_raw ||
      employeeProjectRow?.project_name ||
      anyProjectRow?.project_name_raw ||
      anyProjectRow?.project_name ||
      projectFromList?.name ||
      projectSelect?.selectedOptions?.[0]?.textContent ||
      'Sample Project'
  ).trim() || 'Sample Project';

  const totalHoursRaw = employeeRows.reduce(
    (sum, row) => sum + Number(row?.project_hours || row?.total_hours || 0),
    0
  );
  const lineHoursRaw = Number(
    employeeProjectRow?.project_hours ||
      employeeProjectRow?.total_hours ||
      anyProjectRow?.project_hours ||
      anyProjectRow?.total_hours ||
      employeeFallbackRow?.project_hours ||
      employeeFallbackRow?.total_hours ||
      0
  );
  const lineHours = lineHoursRaw > 0 ? lineHoursRaw : 8;
  const totalHours = totalHoursRaw > 0 ? totalHoursRaw : lineHours;
  const start = startInput?.value || currentPayrollRange?.start || '';
  const end = endInput?.value || currentPayrollRange?.end || '';

  return {
    start,
    end,
    employeeName,
    projectName,
    lineHours,
    totalHours,
    memoRow: {
      employee_name: employeeName,
      project_name: projectName,
      total_hours: totalHours,
      project_hours: lineHours
    },
    lineRow: {
      employee_name: employeeName,
      project_name: projectName,
      project_hours: lineHours,
      total_hours: totalHours
    }
  };
}

function renderPayrollTemplatePreview() {
  const memoInput = document.getElementById('payroll-memo-template');
  const lineDescInput = document.getElementById('payroll-line-desc-template');
  const memoPreview = document.getElementById('payroll-template-preview-memo');
  const linePreview = document.getElementById('payroll-template-preview-line');
  const contextEl = document.getElementById('payroll-template-preview-context');
  if (!memoInput || !lineDescInput || !memoPreview || !linePreview || !contextEl) return;

  const context = getPayrollTemplatePreviewContext();
  const memoText = buildMemoFromTemplate(
    memoInput.value,
    context.memoRow,
    context.start,
    context.end
  );
  const lineText = buildLineDescription(
    lineDescInput.value,
    context.lineRow,
    context.start,
    context.end
  );

  memoPreview.textContent = memoText || '(empty)';
  linePreview.textContent = lineText || '(empty)';
  const rangeLabel = context.start && context.end
    ? `${formatDateUS(context.start)} – ${formatDateUS(context.end)}`
    : 'set Start/End below';
  contextEl.textContent =
    `Using ${context.employeeName} / ${context.projectName} / ${context.lineHours.toFixed(2)} hrs / ${rangeLabel}.`;
}

function setupPayrollTemplatePreviewBindings() {
  if (!isPayrollFeatureEnabled()) return;
  const memoInput = document.getElementById('payroll-memo-template');
  const lineDescInput = document.getElementById('payroll-line-desc-template');
  const employeeSelect = document.getElementById('payroll-template-preview-employee');
  const projectSelect = document.getElementById('payroll-template-preview-project');
  const startInput = document.getElementById('payroll-start');
  const endInput = document.getElementById('payroll-end');
  if (!memoInput || !lineDescInput) return;

  const bindPreviewRefresh = (el, events = ['change']) => {
    if (!el || el.dataset.previewBound === '1') return;
    el.dataset.previewBound = '1';
    events.forEach(evtName => {
      el.addEventListener(evtName, () => {
        renderPayrollTemplatePreview();
      });
    });
  };

  bindPreviewRefresh(memoInput, ['input', 'change']);
  bindPreviewRefresh(lineDescInput, ['input', 'change']);
  bindPreviewRefresh(employeeSelect, ['change']);
  bindPreviewRefresh(projectSelect, ['change']);
  bindPreviewRefresh(startInput, ['input', 'change']);
  bindPreviewRefresh(endInput, ['input', 'change']);

  populatePayrollTemplatePreviewSelectors();
  renderPayrollTemplatePreview();
}

// app.js hydrates CURRENT_ACCESS_PERMS after payroll.js runs; expose a hook to re-apply access gates.
if (typeof window !== 'undefined') {
  window.applyPayrollSettingsAccess = applyPayrollSettingsAccess;
}

function setReportsMessage(text, isError = false) {
  const msgEl = document.getElementById('reports-message');
  if (!msgEl) return;
  msgEl.textContent = text || '';
  msgEl.style.color = isError ? '#b91c1c' : '';
}

function getPayrollRunReviewElements() {
  return {
    wrap: document.getElementById('payroll-run-review'),
    subtext: document.getElementById('payroll-run-review-subtext'),
    meta: document.getElementById('payroll-run-review-meta'),
    alert: document.getElementById('payroll-run-review-alert'),
    failedCount: document.getElementById('payroll-run-review-failed-count'),
    successCount: document.getElementById('payroll-run-review-success-count'),
    failedBody: document.getElementById('payroll-run-review-failed-body'),
    successBody: document.getElementById('payroll-run-review-success-body'),
    retryBtn: document.getElementById('payroll-run-review-retry-selected'),
    loadPeriodBtn: document.getElementById('payroll-run-review-load-period'),
    refreshBtn: document.getElementById('payroll-run-review-refresh')
  };
}

function getPayrollReviewFailedRows(review = currentPayrollRunReview) {
  const results = Array.isArray(review?.results) ? review.results : [];
  return results.filter(row => row && (row.ok === 0 || row.ok === false));
}

function getPayrollReviewSuccessRows(review = currentPayrollRunReview) {
  const results = Array.isArray(review?.results) ? review.results : [];
  return results.filter(row => row && !(row.ok === 0 || row.ok === false));
}

function getPayrollReviewSelectedFailedEmployeeIds() {
  return [...payrollRunReviewRetrySelections]
    .map(id => Number(id))
    .filter(Number.isFinite);
}

function setPayrollRunReviewAlert(message, isError = true) {
  const { alert } = getPayrollRunReviewElements();
  if (!alert) return;
  const text = String(message || '').trim();
  if (!text) {
    alert.textContent = '';
    alert.classList.add('hidden');
    return;
  }
  alert.textContent = text;
  alert.style.borderColor = isError ? '#f59e0b' : '#cbd5e1';
  alert.style.background = isError ? '#fffbeb' : '#f8fafc';
  alert.style.color = isError ? '#92400e' : '#334155';
  alert.classList.remove('hidden');
}

function derivePayrollFailureFixHint(row, run = null) {
  const errorText = String(row?.error || run?.last_error || '').trim();
  const normalized = errorText.toLowerCase();
  const warningCodes = Array.isArray(row?.warning_codes)
    ? row.warning_codes.map(code => String(code || '').toLowerCase())
    : [];

  if (!errorText) {
    return 'Review this employee in Payroll Summary, then retry after confirming line-item details.';
  }

  if (
    normalized.includes('not connected to quickbooks') ||
    normalized.includes('quickbooks not connected')
  ) {
    return 'Connect QuickBooks in the QuickBooks card, then retry this employee.';
  }
  if (
    normalized.includes('applicationauthorizationfailed') ||
    (normalized.includes('quickbooks') && normalized.includes('auth'))
  ) {
    return 'Reconnect QuickBooks, run Sync Now if needed, then retry this employee.';
  }
  if (normalized.includes('rate limit') || normalized.includes('retry after')) {
    return 'QuickBooks rate-limited this request. Wait briefly, then retry selected failed checks.';
  }
  if (normalized.includes('snapshot') || normalized.includes('changed since preflight')) {
    return 'Reload payroll summary for this period, verify details, then retry.';
  }
  if (
    normalized.includes('employee') &&
    (normalized.includes('link') || normalized.includes('qbo id') || normalized.includes('quickbooks id'))
  ) {
    return 'Open Employees, link this employee to QuickBooks, then retry.';
  }
  if (
    normalized.includes('missing') &&
    (normalized.includes('expense') || normalized.includes('class') || normalized.includes('project') || normalized.includes('memo'))
  ) {
    return 'Use "Load Period For Edits", fix missing payroll line fields, and retry.';
  }
  if (normalized.includes('class') && (normalized.includes('no matching') || normalized.includes('qbo'))) {
    return 'Sync QuickBooks classes, update class mapping in Payroll Summary, then retry.';
  }
  if (
    normalized.includes('bank account') ||
    normalized.includes('expense account')
  ) {
    return 'Set payroll accounts in Payroll Settings and retry.';
  }
  if (warningCodes.includes('qbo_dirty_fields') || warningCodes.includes('qbo_conflict_fields')) {
    return 'Run QuickBooks employee update sync to clear dirty/conflict fields, then retry.';
  }
  return 'Use "Load Period For Edits", review this employee, save fixes, then retry this row.';
}

async function showPayrollRunReviewNotice(message, options = {}) {
  const {
    isError = true,
    runId = null,
    preserveSelection = false,
    scrollIntoView = true,
    fallbackAlert = true
  } = options;
  const text = String(message || '').trim();
  if (!text) return false;

  let rendered = false;
  const normalizedRunId = Number(runId);
  if (Number.isFinite(normalizedRunId) && normalizedRunId > 0) {
    try {
      await loadPayrollRunReviewById(normalizedRunId, {
        preserveSelection,
        scrollIntoView
      });
      rendered = true;
    } catch (err) {
      console.warn('Failed loading payroll run review for inline notice:', err);
    }
  }

  const { wrap } = getPayrollRunReviewElements();
  if (wrap && !wrap.classList.contains('hidden')) {
    if (scrollIntoView) {
      wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setPayrollRunReviewAlert(text, isError);
    return true;
  }

  if (fallbackAlert && !rendered) {
    alert(text);
  } else if (rendered) {
    setPayrollRunReviewAlert(text, isError);
  }
  return rendered;
}

function syncLastPayrollStateFromReview(review) {
  if (!review || !review.run) return;
  const run = review.run;
  lastPayrollRunId = Number(run.id) || null;
  lastPayrollRunStatus = run.status || null;
  lastPayrollRunType = run.run_type || 'standard';
  lastPayrollAdjustmentReason = run.adjustment_reason || null;

  const normalizedResults = (Array.isArray(review.results) ? review.results : []).map(row => ({
    employeeId: Number(row.employee_id) || null,
    employeeName: row.employee_name || '',
    totalHours: Number(row.total_hours || 0),
    totalPay: Number(row.total_pay || 0),
    ok: !(row.ok === 0 || row.ok === false),
    error: row.error || null,
    warningCodes: Array.isArray(row.warning_codes) ? row.warning_codes : [],
    qboTxnId: row.qbo_txn_id || null
  }));
  lastPayrollResults = normalizedResults;
}

function updatePayrollRunReviewRetryButtonState() {
  const { retryBtn } = getPayrollRunReviewElements();
  if (!retryBtn) return;
  const canEdit = canModifyPayrollReports();
  const failedRows = getPayrollReviewFailedRows();
  const failedIds = new Set(
    failedRows
      .map(row => Number(row.employee_id))
      .filter(Number.isFinite)
  );
  payrollRunReviewRetrySelections = new Set(
    [...payrollRunReviewRetrySelections].filter(id => failedIds.has(Number(id)))
  );
  const selectedCount = getPayrollReviewSelectedFailedEmployeeIds().length;
  retryBtn.textContent = selectedCount > 0
    ? `Retry Selected Failed (${selectedCount})`
    : 'Retry Selected Failed';
  retryBtn.disabled = !canEdit || !failedRows.length || selectedCount === 0;
  retryBtn.title = canEdit ? '' : 'Requires modify payroll permission.';

  const legacyRetryBtn = document.getElementById('payroll-retry-failed');
  if (legacyRetryBtn) {
    legacyRetryBtn.disabled = !canEdit || !failedRows.length;
    legacyRetryBtn.title = canEdit ? '' : 'Requires modify payroll permission.';
  }
}

function renderPayrollRunReview(review, options = {}) {
  const { preserveSelection = true } = options;
  const els = getPayrollRunReviewElements();
  if (!els.wrap) return;

  if (!review || !review.run) {
    currentPayrollRunReview = null;
    payrollRunReviewRetrySelections = new Set();
    els.wrap.classList.add('hidden');
    return;
  }

  currentPayrollRunReview = review;
  syncLastPayrollStateFromReview(review);

  const run = review.run || {};
  const latestAttempt = review.latest_attempt || null;
  const checkRows = Array.isArray(review.check_rows) ? review.check_rows : [];
  const failedRows = getPayrollReviewFailedRows(review);
  let successRows = getPayrollReviewSuccessRows(review);
  if (!successRows.length && checkRows.length) {
    successRows = checkRows.map(row => ({
      employee_id: row.employee_id,
      employee_name: row.employee_name,
      total_hours: row.total_hours,
      total_pay: row.total_pay,
      qbo_txn_id: row.qbo_txn_id
    }));
  }

  const failedEmployeeIds = new Set(
    failedRows
      .map(row => Number(row.employee_id))
      .filter(Number.isFinite)
  );
  if (!preserveSelection || !payrollRunReviewRetrySelections.size) {
    payrollRunReviewRetrySelections = new Set(failedEmployeeIds);
  } else {
    payrollRunReviewRetrySelections = new Set(
      [...payrollRunReviewRetrySelections].filter(id => failedEmployeeIds.has(Number(id)))
    );
    if (!payrollRunReviewRetrySelections.size && failedEmployeeIds.size) {
      payrollRunReviewRetrySelections = new Set(failedEmployeeIds);
    }
  }

  if (els.subtext) {
    if (failedRows.length) {
      els.subtext.textContent =
        'Some checks failed. Fix any payroll details, then retry only the failed employees you select.';
    } else {
      els.subtext.textContent =
        'No failures in the latest attempt. Successful checks are listed here for reference.';
    }
  }

  if (els.meta) {
    const status = formatPayrollRunStatus(run.status || '') || '-';
    const start = formatDateUS(run.start_date || '');
    const end = formatDateUS(run.end_date || '');
    const period = start && end ? `${start} - ${end}` : '-';
    const created = formatDateTimeLocal(run.created_at) || '';
    const attempt = latestAttempt?.id ? ` | Attempt #${latestAttempt.id}` : '';
    const attemptTime = latestAttempt?.created_at
      ? ` at ${formatDateTimeLocal(latestAttempt.created_at)}`
      : '';
    els.meta.textContent =
      `Run #${run.id} | Status ${status} | Period ${period} | Created ${created}${attempt}${attemptTime}`;
  }

  const alertMessage =
    (latestAttempt && latestAttempt.fatal_error) ||
    run.last_error ||
    '';
  setPayrollRunReviewAlert(alertMessage, true);

  if (els.failedCount) {
    els.failedCount.textContent = String(failedRows.length);
  }
  if (els.successCount) {
    els.successCount.textContent = String(successRows.length);
  }

  const checkByEmployeeId = new Map();
  checkRows.forEach(row => {
    const employeeId = Number(row?.employee_id);
    if (!Number.isFinite(employeeId) || checkByEmployeeId.has(employeeId)) return;
    checkByEmployeeId.set(employeeId, row);
  });

  if (els.failedBody) {
    if (!failedRows.length) {
      els.failedBody.innerHTML = '<tr><td colspan="6">(no failed checks in this run)</td></tr>';
    } else {
      const canEdit = canModifyPayrollReports();
      els.failedBody.innerHTML = failedRows.map(row => {
        const employeeId = Number(row.employee_id);
        const isSelectable = Number.isFinite(employeeId);
        const checked = isSelectable && payrollRunReviewRetrySelections.has(employeeId);
        const employee = escapeHTML(row.employee_name || '(Employee)');
        const errorRaw = String(row.error || run.last_error || 'QuickBooks error');
        const errorText = escapeHTML(errorRaw);
        const hintText = escapeHTML(derivePayrollFailureFixHint(row, run));
        const hours = escapeHTML(Number(row.total_hours || 0).toFixed(2));
        const pay = escapeHTML(formatMoney(Number(row.total_pay || 0)));
        return `
          <tr>
            <td>
              <input
                type="checkbox"
                class="payroll-run-review-select-failed"
                data-employee-id="${isSelectable ? employeeId : ''}"
                ${checked ? 'checked' : ''}
                ${(canEdit && isSelectable) ? '' : 'disabled'}
              />
            </td>
            <td>${employee}</td>
            <td title="${errorText}">${errorText}</td>
            <td>${hintText}</td>
            <td>${hours}</td>
            <td>${pay}</td>
          </tr>
        `;
      }).join('');
      els.failedBody.querySelectorAll('.payroll-run-review-select-failed').forEach(input => {
        input.addEventListener('change', () => {
          const employeeId = Number(input.dataset.employeeId);
          if (!Number.isFinite(employeeId)) return;
          if (input.checked) payrollRunReviewRetrySelections.add(employeeId);
          else payrollRunReviewRetrySelections.delete(employeeId);
          updatePayrollRunReviewRetryButtonState();
        });
      });
    }
  }

  if (els.successBody) {
    if (!successRows.length) {
      els.successBody.innerHTML = '<tr><td colspan="4">(no successful checks yet)</td></tr>';
    } else {
      els.successBody.innerHTML = successRows.map(row => {
        const employeeId = Number(row.employee_id);
        const employee = escapeHTML(row.employee_name || '(Employee)');
        const checkRow = checkByEmployeeId.get(employeeId);
        const checkText = checkRow?.check_number || checkRow?.qbo_txn_id || row.qbo_txn_id || '-';
        const hours = escapeHTML(Number(row.total_hours || 0).toFixed(2));
        const pay = escapeHTML(formatMoney(Number(row.total_pay || 0)));
        return `
          <tr>
            <td>${employee}</td>
            <td>${escapeHTML(String(checkText || '-'))}</td>
            <td>${hours}</td>
            <td>${pay}</td>
          </tr>
        `;
      }).join('');
    }
  }

  els.wrap.classList.remove('hidden');
  updatePayrollRunReviewRetryButtonState();
}

async function loadPayrollRunReviewById(runId, options = {}) {
  const { preserveSelection = false, scrollIntoView = false } = options;
  const normalizedRunId = Number(runId);
  if (!Number.isFinite(normalizedRunId) || normalizedRunId <= 0) return null;
  const payload = await fetchJSON(`/api/reports/payroll-runs/${normalizedRunId}/review`);
  const review = payload?.review || null;
  renderPayrollRunReview(review, { preserveSelection });
  if (scrollIntoView) {
    const { wrap } = getPayrollRunReviewElements();
    if (wrap && !wrap.classList.contains('hidden')) {
      wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
  return review;
}

async function loadLatestUnresolvedPayrollRunReview(options = {}) {
  const { allowHide = true } = options;
  const payload = await fetchJSON('/api/reports/payroll-runs/unresolved/latest');
  const review = payload?.review || null;
  if (!review) {
    if (allowHide) renderPayrollRunReview(null);
    return null;
  }
  renderPayrollRunReview(review, { preserveSelection: false });
  return review;
}

function formatPayrollRunStatus(status) {
  if (!status) return '';
  return String(status).toUpperCase();
}

function formatPayrollRunType(runType, adjustmentReason) {
  if (!runType || runType === 'standard') return 'Standard';
  if (runType === 'adjustment') {
    return adjustmentReason ? `Adjustment - ${adjustmentReason}` : 'Adjustment';
  }
  const trimmed = String(runType).trim();
  if (!trimmed) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function formatPayrollRunError(errorText, maxLen = 80) {
  const raw = (errorText || '').toString().trim();
  if (!raw) return '';
  if (raw.length <= maxLen) return raw;
  return raw.slice(0, maxLen - 3) + '...';
}

// Utils
function formatDateUS(dateInput) {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return dateInput;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function buildLineDescription(template, row, start, end) {
  if (!template) {
    return `Labor ${Number(row.project_hours || row.total_hours || 0).toFixed(2)} hrs – ${row.project_name || ''}`;
  }
  const startUS = formatDateUS(start);
  const endUS = formatDateUS(end);
  const dateRange = `${startUS} – ${endUS}`;
  return template
    .replace('{employee}', row.employee_name || '')
    .replace('{project}', row.project_name || '')
    .replace('{hours}', Number(row.project_hours || row.total_hours || 0).toFixed(2))
    .replace('{dateRange}', dateRange)
    .replace('{start}', startUS)
    .replace('{end}', endUS);
}

function buildMemoFromTemplate(template, row, start, end) {
  const startUS = formatDateUS(start);
  const endUS = formatDateUS(end);
  const dateRange = `${startUS || ''} – ${endUS || ''}`;
  return (template || DEFAULT_PAYROLL_MEMO_TEMPLATE)
    .replace('{employee}', row?.employee_name || '')
    .replace('{project}', row?.project_name || '')
    .replace('{hours}', Number(row?.project_hours || row?.total_hours || 0).toFixed(2))
    .replace('{dateRange}', dateRange)
    .replace('{start}', startUS || '')
    .replace('{end}', endUS || '');
}

function collectUnknownPayrollTemplateTokens(templateText) {
  const matches = String(templateText || '').match(/\{[^{}]+\}/g) || [];
  const seen = new Set();
  const unknown = [];
  matches.forEach(token => {
    if (PAYROLL_TEMPLATE_TOKEN_SET.has(token)) return;
    if (seen.has(token)) return;
    seen.add(token);
    unknown.push(token);
  });
  return unknown;
}

function buildPayrollTemplateValidationMessage(memoUnknown = [], lineUnknown = []) {
  const chunks = [];
  if (memoUnknown.length) {
    chunks.push(
      `Default memo template has unknown token${memoUnknown.length === 1 ? '' : 's'}: ${memoUnknown.join(', ')}.`
    );
  }
  if (lineUnknown.length) {
    chunks.push(
      `Line description template has unknown token${lineUnknown.length === 1 ? '' : 's'}: ${lineUnknown.join(', ')}.`
    );
  }
  if (!chunks.length) return '';
  chunks.push(`Allowed tokens are: ${PAYROLL_TEMPLATE_TOKENS.join(', ')} (case-sensitive).`);
  return chunks.join(' ');
}

function appendReimbursementMemoSuffix(baseMemo, hasReimbursementLines) {
  if (!hasReimbursementLines) return baseMemo;
  const suffix = ' + Reimbursement';
  const memo = String(baseMemo || '');
  if (!memo) return '+ Reimbursement';
  return memo.endsWith(suffix) ? memo : `${memo}${suffix}`;
}

function buildReceiptLineDescription(row) {
  const vendorName = String(row?.vendor_name || '').trim() || 'Unknown Vendor';
  return `[${vendorName}] Reimbursement`;
}

function getPayrollIncludeReimbursementsSetting() {
  const checkbox = document.getElementById('payroll-include-reimbursements');
  return checkbox ? checkbox.checked : true;
}

function ensureSelectOption(selectEl, value, label) {
  if (!selectEl || !value) return;
  const existing = Array.from(selectEl.options || []).find(opt => opt.value === value);
  if (existing) return;
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = label || value;
  selectEl.appendChild(opt);
}

function getProjectLabel(projectId, projectName, customerName) {
  const fromPayload = customerName ? `${customerName} : ${projectName || ''}` : projectName || '';
  if (fromPayload) return fromPayload;
  const match = payrollProjects.find(p => Number(p.id) === Number(projectId));
  if (!match) return projectName || '';
  return match.customer_name ? `${match.customer_name} : ${match.name}` : (match.name || '');
}

function populatePayrollReimbursementEmployeeSelect(selectEl, placeholderText = '(select employee)') {
  if (!selectEl) return;
  const selectedValue = selectEl.value;
  selectEl.innerHTML = `<option value="">${placeholderText}</option>`;
  (payrollEmployees || []).forEach(emp => {
    const id = Number(emp.id || 0);
    if (!id) return;
    const option = document.createElement('option');
    option.value = String(id);
    option.textContent = emp.name || `Employee #${id}`;
    selectEl.appendChild(option);
  });
  if (selectedValue && Array.from(selectEl.options || []).some(opt => opt.value === selectedValue)) {
    selectEl.value = selectedValue;
  }
}

function populatePayrollReimbursementProjectSelect(selectEl, placeholderText = '(select project)') {
  if (!selectEl) return;
  const selectedValue = selectEl.value;
  selectEl.innerHTML = `<option value="">${placeholderText}</option>`;
  (payrollProjects || []).forEach(project => {
    const id = Number(project.id || 0);
    if (!id) return;
    const option = document.createElement('option');
    option.value = String(id);
    option.textContent = project.customer_name
      ? `${project.customer_name} : ${project.name || ''}`
      : (project.name || `Project #${id}`);
    selectEl.appendChild(option);
  });
  if (selectedValue && Array.from(selectEl.options || []).some(opt => opt.value === selectedValue)) {
    selectEl.value = selectedValue;
  }
}

function populatePayrollReimbursementFormOptions() {
  populatePayrollReimbursementEmployeeSelect(
    document.getElementById('payroll-reimbursement-employee'),
    '(select employee)'
  );
  populatePayrollReimbursementProjectSelect(
    document.getElementById('payroll-reimbursement-project'),
    '(select project)'
  );
  populatePayrollReimbursementEmployeeSelect(
    document.getElementById('payroll-reimbursement-filter-employee'),
    'All employees'
  );
  populatePayrollReimbursementProjectSelect(
    document.getElementById('payroll-reimbursement-filter-project'),
    'All projects'
  );
}

function ensurePayrollReimbursementDateDefault() {
  const input = document.getElementById('payroll-reimbursement-date');
  if (!input || input.value) return;
  input.value = new Date().toISOString().slice(0, 10);
}

const PAYROLL_REIMBURSEMENT_STATUSES = new Set(['all', 'requested', 'approved', 'paid', 'cancelled']);

function getPayrollReimbursementFiltersFromUi() {
  const employeeIdRaw = Number(document.getElementById('payroll-reimbursement-filter-employee')?.value || 0);
  const projectIdRaw = Number(document.getElementById('payroll-reimbursement-filter-project')?.value || 0);
  const statusRaw = String(
    document.getElementById('payroll-reimbursement-filter-status')?.value || 'all'
  ).trim().toLowerCase();
  const start = String(document.getElementById('payroll-reimbursement-filter-start')?.value || '').trim();
  const end = String(document.getElementById('payroll-reimbursement-filter-end')?.value || '').trim();
  return {
    employeeId: Number.isFinite(employeeIdRaw) && employeeIdRaw > 0 ? employeeIdRaw : null,
    projectId: Number.isFinite(projectIdRaw) && projectIdRaw > 0 ? projectIdRaw : null,
    status: PAYROLL_REIMBURSEMENT_STATUSES.has(statusRaw) ? statusRaw : 'all',
    start,
    end
  };
}

function resetPayrollReimbursementFiltersUi() {
  const employee = document.getElementById('payroll-reimbursement-filter-employee');
  const project = document.getElementById('payroll-reimbursement-filter-project');
  const status = document.getElementById('payroll-reimbursement-filter-status');
  const start = document.getElementById('payroll-reimbursement-filter-start');
  const end = document.getElementById('payroll-reimbursement-filter-end');
  if (employee) employee.value = '';
  if (project) project.value = '';
  if (status) status.value = 'all';
  if (start) start.value = '';
  if (end) end.value = '';
}

function normalizePayrollReimbursementFilters(filters) {
  const source = filters && typeof filters === 'object' ? filters : {};
  const employeeId = Number(source.employeeId || 0);
  const projectId = Number(source.projectId || 0);
  const statusRaw = String(source.status || 'all').trim().toLowerCase();
  const start = String(source.start || '').trim();
  const end = String(source.end || '').trim();
  return {
    employeeId: Number.isFinite(employeeId) && employeeId > 0 ? employeeId : null,
    projectId: Number.isFinite(projectId) && projectId > 0 ? projectId : null,
    status: PAYROLL_REIMBURSEMENT_STATUSES.has(statusRaw) ? statusRaw : 'all',
    start,
    end
  };
}

function setPayrollReimbursementRangeNote(paging = null) {
  const noteEl = document.getElementById('payroll-reimbursement-range-note');
  if (!noteEl) return;
  const start = String(paging?.applied_start || '').trim();
  const end = String(paging?.applied_end || '').trim();
  const defaulted = !!paging?.default_window_applied;
  if (!start && !end) {
    noteEl.textContent = '';
    return;
  }
  const rangeLabel = start && end
    ? `${formatDateUS(start)} - ${formatDateUS(end)}`
    : (start ? `From ${formatDateUS(start)}` : `Through ${formatDateUS(end)}`);
  noteEl.textContent = defaulted
    ? `Showing latest 30-day window (${rangeLabel}).`
    : `Showing ${rangeLabel}.`;
}

function updatePayrollReimbursementPaginationUi(paging = null) {
  const page = Math.max(1, Number(paging?.page || payrollReimbursementCurrentPage || 1));
  const totalPages = Math.max(1, Number(paging?.total_pages || payrollReimbursementTotalPages || 1));
  const totalCount = Math.max(0, Number(paging?.total_count || payrollReimbursementTotalCount || 0));
  payrollReimbursementCurrentPage = page;
  payrollReimbursementTotalPages = totalPages;
  payrollReimbursementTotalCount = totalCount;

  const prevBtn = document.getElementById('payroll-reimbursement-prev');
  const nextBtn = document.getElementById('payroll-reimbursement-next');
  const info = document.getElementById('payroll-reimbursement-page-info');

  if (prevBtn) prevBtn.disabled = page <= 1;
  if (nextBtn) nextBtn.disabled = page >= totalPages;
  if (info) {
    info.textContent = `Page ${page} of ${totalPages} (${totalCount})`;
  }
}

function parseYmd(value) {
  if (!value) return null;
  const str = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const [y, m, d] = str.split('-').map(Number);
  if (!y || !m || !d) return null;
  return { year: y, month: m, day: d };
}

function ymdToUtcDays({ year, month, day }) {
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function utcDaysToYmd(days) {
  const dt = new Date(days * 86400000);
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate()
  };
}

function formatYmd({ year, month, day }) {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function getTodayPartsInTimeZone(timeZone) {
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
  const [year, month, day] = dateStr.split('-').map(Number);
  const weekdayStr = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short'
  }).format(now);
  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };
  const weekday = weekdayMap[weekdayStr] ?? 0;
  return { year, month, day, weekday };
}

function normalizePayrollRulesForDefaults(rawRules) {
  const parsed = rawRules && typeof rawRules === 'object' ? rawRules : {};
  const lengthRaw = Math.floor(Number(parsed.pay_period_length_days || 7));
  const length = lengthRaw >= 1 && lengthRaw <= 31 ? lengthRaw : 7;
  const weekdayRaw = Math.floor(Number(parsed.pay_period_start_weekday || 1));
  const startWeekday = weekdayRaw >= 0 && weekdayRaw <= 6 ? weekdayRaw : 1;
  const anchor = parseYmd(parsed.pay_period_anchor_date);
  return {
    pay_period_length_days: length,
    pay_period_start_weekday: startWeekday,
    pay_period_anchor_date: anchor
  };
}

async function loadPayrollDefaultsContext() {
  const existingRules = window.CURRENT_PAYROLL_RULES || null;
  const existingTimezone = window.CURRENT_ORG_TIMEZONE || null;
  if (existingRules && existingTimezone) {
    return { rules: existingRules, timezone: existingTimezone };
  }

  const [meRes, settingsRes] = await Promise.all([
    fetch('/api/auth/me'),
    fetch('/api/settings')
  ]);

  let timezone = existingTimezone;
  if (meRes.ok) {
    const meData = await meRes.json();
    timezone = meData?.org?.timezone || timezone;
    window.CURRENT_ORG_TIMEZONE = timezone;
    window.CURRENT_PAYROLL_RULES = window.CURRENT_PAYROLL_RULES || null;
  }

  if (settingsRes.ok) {
    const settingsData = await settingsRes.json();
    const rules = settingsData?.settings?.payroll_rules || null;
    if (rules) {
      window.CURRENT_PAYROLL_RULES = rules;
    }
  }

  return {
    rules: window.CURRENT_PAYROLL_RULES || null,
    timezone: window.CURRENT_ORG_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone
  };
}

async function setDefaultBillingCycleDates() {
  const startInput = document.getElementById('payroll-start');
  const endInput = document.getElementById('payroll-end');
  if (!startInput || !endInput) return;
  if (startInput.value && endInput.value) return;

  try {
    const context = await loadPayrollDefaultsContext();
    const normalized = normalizePayrollRulesForDefaults(context.rules || {});
    const tz = context.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const todayParts = getTodayPartsInTimeZone(tz);
    const todayDays = ymdToUtcDays(todayParts);
    const length = normalized.pay_period_length_days;

    let startDays = todayDays;
    if (length > 7 && normalized.pay_period_anchor_date) {
      const anchorDays = ymdToUtcDays(normalized.pay_period_anchor_date);
      const diff = todayDays - anchorDays;
      const periods = Math.floor(diff / length);
      startDays = anchorDays + periods * length;
    } else {
      const diff = (todayParts.weekday - normalized.pay_period_start_weekday + 7) % 7;
      startDays = todayDays - diff;
    }

    const endDays = startDays + length - 1;
    const start = formatYmd(utcDaysToYmd(startDays));
    const end = formatYmd(utcDaysToYmd(endDays));

    startInput.value = start;
    endInput.value = end;
    currentPayrollRange = { start, end };
    renderPayrollTemplatePreview();
  } catch (err) {
    console.warn('Failed to compute payroll default dates, falling back.', err);
    const today = new Date();
    const day = today.getDay();
    const diffToLastFriday = (day + 7 - 5) % 7;
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - diffToLastFriday);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);
    const fmt = d => d.toISOString().slice(0, 10);
    startInput.value = fmt(startDate);
    endInput.value = fmt(endDate);
    currentPayrollRange = { start: fmt(startDate), end: fmt(endDate) };
    renderPayrollTemplatePreview();
  }
}

function validatePayrollDates(start, end) {
  if (!start || !end) {
    alert('Please pick both a start and end date for the payroll period.');
    return false;
  }
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
    alert('One of the dates is invalid.');
    return false;
  }
  if (e < s) {
    alert('End date must be on or after the start date.');
    return false;
  }
  const diffDays = (e - s) / (1000 * 60 * 60 * 24) + 1;
  const MAX_DAYS = 31;
  if (diffDays > MAX_DAYS) {
    alert(`This payroll period is ${Math.round(diffDays)} days long, which exceeds the maximum allowed of ${MAX_DAYS} days.`);
    return false;
  }
  return true;
}

async function runPayrollPreflightWithConfirm(payload, options) {
  const {
    mode,
    start,
    end,
    runType,
    adjustmentReason,
    failedEmployeeIds = []
  } = options || {};

  let preflightData = null;
  try {
    showPayrollLoading();
    preflightData = await fetchJSON('/api/payroll/preflight-checks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, previewOnly: true })
    });
  } catch (err) {
    console.error('Error preflighting checks:', err);
    const prefix = mode === 'retry' ? 'Could not prepare retry' : 'Could not prepare checks';
    alert(prefix + ':\n\n' + buildPayrollApiErrorMessage(err));
    hidePayrollLoading();
    return null;
  }
  hidePayrollLoading();

  if (!preflightData || preflightData.ok === false) {
    const msg = preflightData?.error || preflightData?.reason || 'Preflight failed.';
    const prefix = mode === 'retry' ? 'Retry preflight failed' : 'Preflight failed';
    alert(prefix + ':\n\n' + msg);
    return null;
  }

  if (!preflightData.preflight_id || !preflightData.payload_hash) {
    const prefix = mode === 'retry' ? 'Retry preflight did not return a token.' : 'Preflight did not return a token.';
    alert(prefix + ' Please retry.');
    return null;
  }

  lastPayrollPreflightId = preflightData.preflight_id;
  lastPayrollPayloadHash = preflightData.payload_hash;

  const pendingFieldReviewCount = Number(preflightData?.field_review?.pending_count || 0);
  const pendingApprovalRows = Array.isArray(preflightData?.pending_approvals?.pending)
    ? preflightData.pending_approvals.pending
    : [];
  const pendingApprovalCountRaw = Number(preflightData?.pending_approvals?.pending_count);
  const pendingApprovalCount =
    Number.isFinite(pendingApprovalCountRaw) && pendingApprovalCountRaw >= 0
      ? pendingApprovalCountRaw
      : pendingApprovalRows.length;
  const pendingApprovalsWarning = buildPendingApprovalsConfirmWarning({
    pendingRows: pendingApprovalRows,
    pendingCount: pendingApprovalCount
  });
  const fieldReviewWarning = pendingFieldReviewCount > 0
    ? `\n\nNote: ${pendingFieldReviewCount} time entries are still awaiting field review. Payroll can proceed, but you may want to double-check those entries.`
    : '';

  const previewFailures = Array.isArray(preflightData.results)
    ? preflightData.results.filter(r => r && r.ok === false)
    : [];

  if (previewFailures.length) {
    const failureText = previewFailures
      .map(f => `• ${f.employeeName || 'Employee'} – ${f.error || 'Unknown error'}`)
      .join('\n');
    const prompt = mode === 'retry'
      ? 'The following retry checks still look like they will fail:\n\n' +
        failureText +
        '\n\nSend the rest to QuickBooks and leave these in the queue?' +
        pendingApprovalsWarning +
        fieldReviewWarning
      : 'The following checks look like they will fail:\n\n' +
        failureText +
        '\n\nSend the rest to QuickBooks and leave these in the queue?' +
        pendingApprovalsWarning +
        fieldReviewWarning;
    if (!confirm(prompt)) {
      return null;
    }
  } else {
    let confirmText = '';
    if (mode === 'retry') {
      const failedCount = Array.isArray(failedEmployeeIds) ? failedEmployeeIds.length : 0;
      confirmText = `Retry QuickBooks checks for ${failedCount} failed employees?`;
    } else if (runType === 'adjustment') {
      confirmText = `Create an adjustment payroll run for ${start} to ${end}?` +
        (adjustmentReason ? `\nReason: ${adjustmentReason}` : '');
    } else {
      confirmText = `Create QuickBooks checks for the period ${start} to ${end}?`;
    }
    confirmText += pendingApprovalsWarning + fieldReviewWarning;
    if (!confirm(confirmText)) {
      return null;
    }
  }

  return preflightData;
}

function getPayrollAdjustmentSettings() {
  const toggle = document.getElementById('payroll-adjustment-toggle');
  const reasonInput = document.getElementById('payroll-adjustment-reason');
  const enabled = !!(toggle && toggle.checked);
  const reason = reasonInput ? reasonInput.value.trim() : '';
  return { enabled, reason, reasonInput };
}

function getPayrollOvertimeSetting() {
  const toggle = document.getElementById('payroll-include-overtime');
  return toggle ? toggle.checked : true;
}

function updatePayrollAdjustmentUI() {
  const { enabled, reasonInput } = getPayrollAdjustmentSettings();
  if (!reasonInput) return;
  if (enabled) {
    reasonInput.classList.remove('hidden');
  } else {
    reasonInput.classList.add('hidden');
    reasonInput.value = '';
  }
}

async function loadPayrollSettings() {
  if (!isPayrollFeatureEnabled()) return;
  if (payrollSettingsPromise) return payrollSettingsPromise;
  payrollSettingsPromise = (async () => {
  const bankSelect = document.getElementById('payroll-bank-account');
  const expenseSelect = document.getElementById('payroll-expense-account');
  const receiptExpenseSelect = document.getElementById('payroll-receipt-expense-account');
  const receiptClassSelect = document.getElementById('payroll-receipt-class');
  const memoInput = document.getElementById('payroll-memo-template');
  const lineDescInput = document.getElementById('payroll-line-desc-template');
  const statusEl = getPayrollSettingsStatusEl();
    if (bankSelect) bankSelect.classList.add('with-arrow');
    if (expenseSelect) expenseSelect.classList.add('with-arrow');
    if (receiptExpenseSelect) receiptExpenseSelect.classList.add('with-arrow');
    if (receiptClassSelect) receiptClassSelect.classList.add('with-arrow');
  try {
    const [settingsRes, optsRes, classesRes, projectsRes, employeesRes] = await Promise.all([
      fetch('/api/payroll/settings'),
      fetch('/api/payroll/account-options'),
      fetch('/api/payroll/classes'),
      fetch('/api/projects'),
      fetch('/api/employees?status=active')
    ]);
    const settings = settingsRes.ok ? await settingsRes.json() : {};
    const opts = optsRes.ok ? await optsRes.json() : { bankAccounts: [], expenseAccounts: [] };
    const classesPayload = classesRes.ok ? await classesRes.json() : { classes: [] };
    const projectsPayload = projectsRes.ok ? await projectsRes.json() : [];
    const employeesPayload = employeesRes.ok ? await employeesRes.json() : [];
    payrollExpenseAccounts = opts.expenseAccounts || [];
    payrollClasses = classesPayload.classes || [];
    payrollProjects = Array.isArray(projectsPayload) ? projectsPayload : (projectsPayload.projects || []);
    payrollEmployees = Array.isArray(employeesPayload)
      ? employeesPayload
      : (employeesPayload.employees || []);
    currentPayrollSettings = {
      bank_account_name: settings.bank_account_name || null,
      expense_account_name: settings.expense_account_name || null,
      receipt_expense_account_name: settings.receipt_expense_account_name || null,
      receipt_class_name: settings.receipt_class_name || null,
      default_memo: settings.default_memo || DEFAULT_PAYROLL_MEMO_TEMPLATE,
      line_description_template: settings.line_description_template || DEFAULT_PAYROLL_LINE_TEMPLATE
    };
    if (bankSelect) {
      bankSelect.innerHTML = '<option value="">(select bank account)</option>';
      (opts.bankAccounts || []).forEach(acc => {
        const fullName = acc.fullName || acc.name || '';
        if (!fullName) return;
        const opt = document.createElement('option');
        opt.value = fullName;
        opt.textContent = fullName;
        bankSelect.appendChild(opt);
      });
      if (currentPayrollSettings.bank_account_name) {
        ensureSelectOption(bankSelect, currentPayrollSettings.bank_account_name);
      }
      bankSelect.value = currentPayrollSettings.bank_account_name || '';
    }
    if (expenseSelect) {
      expenseSelect.innerHTML = '<option value="">(select expense account)</option>';
      (payrollExpenseAccounts || []).forEach(acc => {
        const fullName = acc.fullName || acc.name || '';
        if (!fullName) return;
        const opt = document.createElement('option');
        opt.value = fullName;
        opt.textContent = fullName;
        expenseSelect.appendChild(opt);
      });
      if (currentPayrollSettings.expense_account_name) {
        ensureSelectOption(expenseSelect, currentPayrollSettings.expense_account_name);
      }
      expenseSelect.value = currentPayrollSettings.expense_account_name || '';
    }
    if (receiptExpenseSelect) {
      receiptExpenseSelect.innerHTML = '<option value="">(select receipt expense account)</option>';
      (payrollExpenseAccounts || []).forEach(acc => {
        const fullName = acc.fullName || acc.name || '';
        if (!fullName) return;
        const opt = document.createElement('option');
        opt.value = fullName;
        opt.textContent = fullName;
        receiptExpenseSelect.appendChild(opt);
      });
      if (currentPayrollSettings.receipt_expense_account_name) {
        ensureSelectOption(
          receiptExpenseSelect,
          currentPayrollSettings.receipt_expense_account_name
        );
      }
      receiptExpenseSelect.value = currentPayrollSettings.receipt_expense_account_name || '';
    }
    if (receiptClassSelect) {
      receiptClassSelect.innerHTML = '<option value="">(select receipt class)</option>';
      (payrollClasses || []).forEach(cls => {
        const className = cls.fullName || cls.name || '';
        if (!className) return;
        const opt = document.createElement('option');
        opt.value = className;
        opt.textContent = className;
        receiptClassSelect.appendChild(opt);
      });
      if (currentPayrollSettings.receipt_class_name) {
        ensureSelectOption(receiptClassSelect, currentPayrollSettings.receipt_class_name);
      }
      receiptClassSelect.value = currentPayrollSettings.receipt_class_name || '';
    }
    if (memoInput) memoInput.value = currentPayrollSettings.default_memo;
    if (lineDescInput) lineDescInput.value = currentPayrollSettings.line_description_template;
    populatePayrollTemplatePreviewSelectors();
    renderPayrollTemplatePreview();
    populatePayrollReimbursementFormOptions();
    ensurePayrollReimbursementDateDefault();
    if (statusEl) statusEl.textContent = '';
  } catch (err) {
    console.error('Error loading payroll settings/options:', err);
  }
  payrollSettingsLoaded = true;
  return currentPayrollSettings;
  })();
  return payrollSettingsPromise;
}

async function savePayrollSettings() {
  if (!canModifyPayrollReports()) {
    alert('You do not have permission to modify payroll settings.');
    return;
  }
  const bankSelect = document.getElementById('payroll-bank-account');
  const expenseSelect = document.getElementById('payroll-expense-account');
  const receiptExpenseSelect = document.getElementById('payroll-receipt-expense-account');
  const receiptClassSelect = document.getElementById('payroll-receipt-class');
  const memoInput = document.getElementById('payroll-memo-template');
  const lineDescInput = document.getElementById('payroll-line-desc-template');
  const statusEl = getPayrollSettingsStatusEl();
  const memoTemplateRaw = memoInput ? String(memoInput.value || '') : '';
  const lineTemplateRaw = lineDescInput ? String(lineDescInput.value || '') : '';
  const memoUnknownTokens = collectUnknownPayrollTemplateTokens(memoTemplateRaw);
  const lineUnknownTokens = collectUnknownPayrollTemplateTokens(lineTemplateRaw);
  const validationMessage = buildPayrollTemplateValidationMessage(
    memoUnknownTokens,
    lineUnknownTokens
  );
  if (validationMessage) {
    if (statusEl) {
      statusEl.textContent = validationMessage;
      statusEl.style.color = '#b91c1c';
    } else {
      alert(validationMessage);
    }
    if (memoUnknownTokens.length && memoInput) memoInput.focus();
    else if (lineUnknownTokens.length && lineDescInput) lineDescInput.focus();
    return;
  }
  const payload = {
    bank_account_name: bankSelect ? bankSelect.value || null : null,
    expense_account_name: expenseSelect ? expenseSelect.value || null : null,
    receipt_expense_account_name: receiptExpenseSelect ? receiptExpenseSelect.value || null : null,
    receipt_class_name: receiptClassSelect ? receiptClassSelect.value || null : null,
    default_memo: memoInput ? memoInput.value || null : null,
    line_description_template: lineDescInput ? lineDescInput.value || null : null
  };
  let data = null;
  try {
    data = await fetchJSON('/api/payroll/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    const msg = err?.message || 'Failed to save payroll settings.';
    if (statusEl) {
      statusEl.textContent = 'Failed to save payroll settings: ' + msg;
      statusEl.style.color = '#b91c1c';
    } else {
      alert('Failed to save payroll settings: ' + msg);
    }
    return;
  }
  if (!data?.ok && data?.error) {
    if (statusEl) {
      statusEl.textContent = 'Failed to save payroll settings: ' + data.error;
      statusEl.style.color = '#b91c1c';
    } else {
      alert('Failed to save payroll settings: ' + data.error);
    }
    return;
  }
  currentPayrollSettings = payload;
  renderPayrollTemplatePreview();
  const applyResult = applySavedSettingsToLoadedChecks(currentPayrollSettings);
  const body = document.getElementById('payroll-settings-body');
  if (body) body.classList.add('hidden');
  const settingsSaveBtn = document.getElementById('payroll-settings-save');
  if (settingsSaveBtn) {
    const originalText = settingsSaveBtn.textContent || 'Save Payroll Settings';
    settingsSaveBtn.textContent = 'Saved';
    settingsSaveBtn.disabled = true;
    setTimeout(() => {
      settingsSaveBtn.textContent = originalText;
      settingsSaveBtn.disabled = false;
    }, 1200);
  }
  if (statusEl) {
    let statusMsg = 'Payroll settings saved.';
    if (applyResult.appliedCount > 0) {
      statusMsg += ` Updated ${applyResult.appliedCount} loaded check field${applyResult.appliedCount === 1 ? '' : 's'}.`;
    }
    if (applyResult.conflicts > 0 && !applyResult.overwroteFilled) {
      statusMsg += ' Existing filled check values were kept.';
    }
    statusEl.textContent = statusMsg;
    statusEl.style.color = '#0f5132';
  }
  payrollSettingsLoaded = true;
  payrollSettingsPromise = null;
}

function setupPayrollSettingsCollapse() {
  const header = document.getElementById('payroll-settings-toggle');
  const body = document.getElementById('payroll-settings-body');
  const chev = document.getElementById('payroll-settings-chevron');
  if (!header || !body) return;
  body.classList.add('hidden');
  if (chev) chev.textContent = '▸';
  header.addEventListener('click', () => {
    const hidden = body.classList.toggle('hidden');
    if (chev) chev.textContent = hidden ? '▸' : '▾';
  });
}

function getPayrollSettingsStatusEl() {
  let el = document.getElementById('payroll-settings-status');
  if (el) return el;
  const container = document.getElementById('payroll-settings-body') || document.getElementById('payroll-settings-card');
  if (!container) return null;
  el = document.createElement('div');
  el.id = 'payroll-settings-status';
  el.style.marginTop = '6px';
  el.style.fontSize = '0.85rem';
  el.style.color = '#0f5132';
  container.appendChild(el);
  return el;
}

function setPayrollReimbursementMessage(text, isError = false, options = {}) {
  const includePage = options.includePage !== false;
  const includeModal = options.includeModal !== false;
  const targets = [];
  if (includePage) targets.push(document.getElementById('payroll-reimbursement-message'));
  if (includeModal) targets.push(document.getElementById('payroll-reimbursement-modal-message'));
  targets
    .filter(Boolean)
    .forEach(el => {
      el.textContent = text || '';
      el.style.color = isError ? '#b91c1c' : '';
    });
}

function openPayrollReimbursementModal() {
  if (!canModifyPayrollReports()) return;
  const modal = document.getElementById('payroll-reimbursement-modal');
  const backdrop = document.getElementById('payroll-reimbursement-modal-backdrop');
  if (!modal || !backdrop) return;
  populatePayrollReimbursementFormOptions();
  ensurePayrollReimbursementDateDefault();
  setPayrollReimbursementMessage('', false, { includePage: false, includeModal: true });
  modal.classList.remove('hidden');
  backdrop.classList.remove('hidden');
  const employeeSelect = document.getElementById('payroll-reimbursement-employee');
  if (employeeSelect) {
    setTimeout(() => employeeSelect.focus(), 0);
  }
}

function closePayrollReimbursementModal() {
  const modal = document.getElementById('payroll-reimbursement-modal');
  const backdrop = document.getElementById('payroll-reimbursement-modal-backdrop');
  if (modal) modal.classList.add('hidden');
  if (backdrop) backdrop.classList.add('hidden');
  setPayrollReimbursementMessage('', false, { includePage: false, includeModal: true });
}

function formatPayrollReimbursementStatus(row) {
  const statusRaw = String(row?.status || 'requested').trim().toLowerCase();
  if (!statusRaw) return 'REQUESTED';
  if (statusRaw === 'approved') {
    const approver = (row?.approved_by_name || '').trim();
    const approvedDate = row?.approved_at ? formatDateUS(row.approved_at) : '';
    if (approver && approvedDate) return `APPROVED (${approver}, ${approvedDate})`;
    if (approver) return `APPROVED (${approver})`;
    if (approvedDate) return `APPROVED (${approvedDate})`;
    return 'APPROVED';
  }
  if (statusRaw === 'paid') {
    const paidDate = row?.paid_date ? formatDateUS(row.paid_date) : '';
    return paidDate ? `PAID (${paidDate})` : 'PAID';
  }
  return statusRaw.toUpperCase();
}

function closePayrollReimbursementHistoryModal() {
  const modal = document.getElementById('payroll-reimbursement-history-modal');
  const backdrop = document.getElementById('payroll-reimbursement-history-backdrop');
  const listEl = document.getElementById('payroll-reimbursement-history-list');
  const msgEl = document.getElementById('payroll-reimbursement-history-message');
  if (modal) modal.classList.add('hidden');
  if (backdrop) backdrop.classList.add('hidden');
  if (listEl) listEl.innerHTML = '';
  if (msgEl) msgEl.textContent = '';
}

function statusHistoryLabel(statusRaw) {
  const status = String(statusRaw || '').trim().toLowerCase();
  if (status === 'requested') return 'Requested';
  if (status === 'approved') return 'Approved';
  if (status === 'paid') return 'Paid';
  if (status === 'cancelled') return 'Cancelled';
  return status ? `${status[0].toUpperCase()}${status.slice(1)}` : 'Unknown';
}

function renderPayrollReimbursementHistory(rows) {
  const listEl = document.getElementById('payroll-reimbursement-history-list');
  if (!listEl) return;
  const events = Array.isArray(rows) ? rows : [];
  if (!events.length) {
    listEl.innerHTML = '<div class="payroll-reimbursement-history-item">No history found.</div>';
    return;
  }
  listEl.innerHTML = events.map(event => {
    const status = statusHistoryLabel(event?.status || '');
    const when = event?.created_at ? formatDateTimeLocal(event.created_at) : 'Unknown date';
    const actor = String(event?.actor_name || '').trim();
    const source = String(event?.actor_source || '').trim();
    const reason = String(event?.reason || '').trim();
    const meta = event?.meta && typeof event.meta === 'object' ? event.meta : null;
    const actorLabel = actor || (source ? source.replace(/_/g, ' ') : 'System');
    const sourceMeta = meta?.payroll_run_id
      ? `Run #${meta.payroll_run_id}${meta.payroll_check_id ? ` • Check #${meta.payroll_check_id}` : ''}`
      : '';
    return `
      <div class="payroll-reimbursement-history-item">
        <div class="payroll-reimbursement-history-item-head">
          <div class="payroll-reimbursement-history-status">${escapeHTML(status)}</div>
          <div class="payroll-reimbursement-history-meta">${escapeHTML(when)}</div>
        </div>
        <div class="payroll-reimbursement-history-meta">${escapeHTML(actorLabel)}${sourceMeta ? ` • ${escapeHTML(sourceMeta)}` : ''}</div>
        ${reason ? `<div class="payroll-reimbursement-history-reason">${escapeHTML(reason)}</div>` : ''}
      </div>
    `;
  }).join('');
}

async function openPayrollReimbursementHistoryModal(reimbursementId) {
  const reimbursementIdNum = Number(reimbursementId || 0);
  if (!Number.isFinite(reimbursementIdNum) || reimbursementIdNum <= 0) return;

  const modal = document.getElementById('payroll-reimbursement-history-modal');
  const backdrop = document.getElementById('payroll-reimbursement-history-backdrop');
  const titleEl = document.getElementById('payroll-reimbursement-history-title');
  const msgEl = document.getElementById('payroll-reimbursement-history-message');
  if (!modal || !backdrop) return;

  if (titleEl) titleEl.textContent = `Reimbursement History #${reimbursementIdNum}`;
  if (msgEl) msgEl.textContent = 'Loading history...';
  renderPayrollReimbursementHistory([]);
  modal.classList.remove('hidden');
  backdrop.classList.remove('hidden');

  try {
    const payload = await fetchJSON(`/api/payroll/reimbursements/${reimbursementIdNum}/history`);
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    renderPayrollReimbursementHistory(rows);
    if (msgEl) msgEl.textContent = '';
  } catch (err) {
    console.error('[PAYROLL] openPayrollReimbursementHistoryModal error', err);
    if (msgEl) msgEl.textContent = err?.message || 'Failed to load reimbursement history.';
    renderPayrollReimbursementHistory([]);
  }
}

function renderPayrollReimbursementsTable(rows) {
  const tbody = document.getElementById('payroll-reimbursements-body');
  if (!tbody) return;
  const esc = typeof escapeHTML === 'function' ? escapeHTML : (value => String(value || ''));
  const list = Array.isArray(rows) ? rows : [];
  tbody.innerHTML = '';
  if (!list.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="9">(no receipt reimbursements found)</td>';
    tbody.appendChild(tr);
    return;
  }

  list.forEach(row => {
    const tr = document.createElement('tr');
    const reimbursementId = Number(row.id || 0);
    const amount = Number(row.amount || 0);
    const projectLabel = row.project_customer_name
      ? `${row.project_customer_name} : ${row.project_name || ''}`
      : (row.project_name || '');
    const statusRaw = String(row.status || 'requested').trim().toLowerCase();
    const status = formatPayrollReimbursementStatus(row);
    const canApprove = canModifyPayrollReports();
    const showApproveAction = (statusRaw === 'requested' || statusRaw === 'cancelled') &&
      Number.isFinite(reimbursementId) &&
      reimbursementId > 0;
    const showCancelAction = (statusRaw === 'requested' || statusRaw === 'approved') &&
      Number.isFinite(reimbursementId) &&
      reimbursementId > 0;
    let actionHtml = '—';
    const historyHtml =
      Number.isFinite(reimbursementId) && reimbursementId > 0
        ? `<button type="button" class="btn tertiary btn-sm payroll-reimbursement-history" data-reimbursement-id="${reimbursementId}">Timeline</button>`
        : '—';
    if (showApproveAction || showCancelAction) {
      const actionButtons = [];
      let actionLabel = '';
      if (showApproveAction) {
        if (statusRaw === 'cancelled') {
          actionLabel = '<span class="payroll-reimbursement-action-label payroll-reimbursement-action-label-cancelled">Cancelled</span>';
        }
        actionButtons.push(
          `<button type="button" class="btn secondary btn-sm payroll-reimbursement-approve" data-reimbursement-id="${reimbursementId}" ${canApprove ? '' : 'disabled title="Requires modify payroll permission."'}>Approve</button>`
        );
      }
      if (showCancelAction) {
        const cancelLabel = statusRaw === 'approved' ? 'Cancel' : 'Reject';
        if (statusRaw === 'approved') {
          actionLabel = '<span class="payroll-reimbursement-action-label">Approved</span>';
        }
        actionButtons.push(
          `<button type="button" class="btn danger btn-sm payroll-reimbursement-cancel" data-reimbursement-id="${reimbursementId}" data-reimbursement-status="${esc(statusRaw)}" ${canApprove ? '' : 'disabled title="Requires modify payroll permission."'}>${cancelLabel}</button>`
        );
      }
      actionHtml = `<div class="payroll-reimbursement-actions">${actionLabel}${actionButtons.join('')}</div>`;
    } else if (statusRaw === 'approved') {
      actionHtml = 'Approved';
    } else if (statusRaw === 'paid') {
      actionHtml = 'Paid';
    } else if (statusRaw === 'cancelled') {
      actionHtml = 'Cancelled';
    }
    tr.innerHTML = `
      <td>${esc(formatDateUS(row.expense_date || row.requested_at || ''))}</td>
      <td>${esc(row.employee_name || '')}</td>
      <td>${esc(row.vendor_name || '')}</td>
      <td>${esc(projectLabel)}</td>
      <td>$${amount.toFixed(2)}</td>
      <td>${esc(status)}</td>
      <td>${row.receipt_url ? `<a href="${esc(row.receipt_url)}" target="_blank" rel="noopener">View</a>` : ''}</td>
      <td>${historyHtml}</td>
      <td>${actionHtml}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadPayrollReimbursements(filters = null, options = {}) {
  if (!isPayrollFeatureEnabled()) return;
  const tbody = document.getElementById('payroll-reimbursements-body');
  if (tbody && !tbody.children.length) {
    tbody.innerHTML = '<tr><td colspan="9">(loading)</td></tr>';
  }

  const resetPage = !!options?.resetPage;
  const requestedPage = Number(options?.page || 0);
  if (resetPage) payrollReimbursementCurrentPage = 1;
  if (Number.isFinite(requestedPage) && requestedPage > 0) {
    payrollReimbursementCurrentPage = Math.floor(requestedPage);
  }

  const providedFilters = (filters && typeof filters === 'object')
    ? normalizePayrollReimbursementFilters(filters)
    : null;
  if (providedFilters) {
    payrollReimbursementLastFilters = providedFilters;
  }
  const activeFilters = payrollReimbursementLastFilters || normalizePayrollReimbursementFilters(getPayrollReimbursementFiltersFromUi());
  if (!payrollReimbursementLastFilters) {
    payrollReimbursementLastFilters = activeFilters;
  }

  const params = new URLSearchParams();
  const statusRaw = String(activeFilters?.status || 'all').trim().toLowerCase();
  params.set('status', PAYROLL_REIMBURSEMENT_STATUSES.has(statusRaw) ? statusRaw : 'all');
  const start = String(activeFilters?.start || '').trim();
  const end = String(activeFilters?.end || '').trim();
  const employeeId = Number(activeFilters?.employeeId || 0);
  const projectId = Number(activeFilters?.projectId || 0);
  if (start) params.set('start', start);
  if (end) params.set('end', end);
  if (Number.isFinite(employeeId) && employeeId > 0) {
    params.set('employeeId', String(employeeId));
  }
  if (Number.isFinite(projectId) && projectId > 0) {
    params.set('projectId', String(projectId));
  }
  params.set('page', String(payrollReimbursementCurrentPage));
  params.set('page_size', String(PAYROLL_REIMBURSEMENT_PAGE_SIZE));

  try {
    const data = await fetchJSON(`/api/payroll/reimbursements?${params.toString()}`);
    const rows = Array.isArray(data)
      ? data
      : (Array.isArray(data?.rows) ? data.rows : []);
    const paging = data && data.paging ? data.paging : null;
    renderPayrollReimbursementsTable(rows);
    updatePayrollReimbursementPaginationUi(paging);
    setPayrollReimbursementRangeNote(paging);
    setPayrollReimbursementMessage('', false, { includePage: true, includeModal: false });
    if (typeof window.refreshReimbursementPendingBadge === 'function') {
      window.refreshReimbursementPendingBadge();
    }
  } catch (err) {
    console.error('[PAYROLL] loadPayrollReimbursements error', err);
    renderPayrollReimbursementsTable([]);
    updatePayrollReimbursementPaginationUi({
      page: payrollReimbursementCurrentPage,
      total_pages: payrollReimbursementTotalPages,
      total_count: payrollReimbursementTotalCount
    });
    setPayrollReimbursementMessage(
      'Failed to load reimbursements: ' + (err?.message || 'Unknown error'),
      true,
      { includePage: true, includeModal: false }
    );
  } finally {
    applyPayrollSettingsAccess();
  }
}

async function approvePayrollReimbursement(reimbursementId) {
  if (!canModifyPayrollReports()) {
    alert('You do not have permission to approve reimbursements.');
    return;
  }
  const reimbursementIdNum = Number(reimbursementId);
  if (!Number.isFinite(reimbursementIdNum) || reimbursementIdNum <= 0) {
    return;
  }

  const confirmApprove = confirm('Approve this reimbursement for payroll?');
  if (!confirmApprove) return;

  setPayrollReimbursementMessage('Approving reimbursement...', false, { includePage: true, includeModal: false });
  try {
    const payload = await fetchJSON(`/api/payroll/reimbursements/${reimbursementIdNum}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (!payload?.ok) {
      throw new Error(payload?.error || 'Failed to approve reimbursement.');
    }

    setPayrollReimbursementMessage('Reimbursement approved for payroll.', false, {
      includePage: true,
      includeModal: false
    });
    await loadPayrollReimbursements();
    if (currentPayrollRange?.start && currentPayrollRange?.end && getPayrollIncludeReimbursementsSetting()) {
      await loadPayrollSummary({ suppressAlerts: true });
    }
  } catch (err) {
    console.error('[PAYROLL] approvePayrollReimbursement error', err);
    setPayrollReimbursementMessage(
      'Failed to approve reimbursement: ' + (err?.message || 'Unknown error'),
      true,
      { includePage: true, includeModal: false }
    );
  } finally {
    applyPayrollSettingsAccess();
  }
}

async function cancelPayrollReimbursement(reimbursementId, currentStatus = 'requested') {
  if (!canModifyPayrollReports()) {
    alert('You do not have permission to reject/cancel reimbursements.');
    return;
  }
  const reimbursementIdNum = Number(reimbursementId);
  if (!Number.isFinite(reimbursementIdNum) || reimbursementIdNum <= 0) {
    return;
  }

  const statusRaw = String(currentStatus || 'requested').trim().toLowerCase();
  const isApproved = statusRaw === 'approved';
  const confirmCancel = confirm(
    isApproved
      ? 'Cancel this approved reimbursement? It will no longer be included in payroll.'
      : 'Reject this reimbursement request?'
  );
  if (!confirmCancel) return;
  const reason = prompt('Optional reason (saved to audit log):', '');
  if (reason === null) return;

  setPayrollReimbursementMessage(
    isApproved ? 'Cancelling reimbursement...' : 'Rejecting reimbursement...',
    false,
    { includePage: true, includeModal: false }
  );
  try {
    const payload = await fetchJSON(`/api/payroll/reimbursements/${reimbursementIdNum}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: String(reason || '').trim() })
    });
    if (!payload?.ok) {
      throw new Error(payload?.error || 'Failed to cancel reimbursement.');
    }

    setPayrollReimbursementMessage(
      isApproved ? 'Reimbursement cancelled.' : 'Reimbursement rejected.',
      false,
      { includePage: true, includeModal: false }
    );
    await loadPayrollReimbursements();
    if (currentPayrollRange?.start && currentPayrollRange?.end && getPayrollIncludeReimbursementsSetting()) {
      await loadPayrollSummary({ suppressAlerts: true });
    }
  } catch (err) {
    console.error('[PAYROLL] cancelPayrollReimbursement error', err);
    setPayrollReimbursementMessage(
      'Failed to reject/cancel reimbursement: ' + (err?.message || 'Unknown error'),
      true,
      { includePage: true, includeModal: false }
    );
  } finally {
    applyPayrollSettingsAccess();
  }
}

function buildPayrollDuplicateWarning(duplicates) {
  const rows = Array.isArray(duplicates) ? duplicates : [];
  if (!rows.length) return '';
  return rows
    .slice(0, 3)
    .map(row => {
      const date = row?.expense_date ? formatDateUS(row.expense_date) : 'Unknown date';
      const amount = Number(row?.amount || 0).toFixed(2);
      const vendor = row?.vendor_name || 'Unknown vendor';
      const status = String(row?.status || 'requested').toUpperCase();
      return `- ${date}: ${vendor} $${amount} (${status})`;
    })
    .join('\n');
}

async function submitPayrollReimbursement({ allowDuplicate = false } = {}) {
  if (!canModifyPayrollReports()) {
    alert('You do not have permission to request reimbursements.');
    return;
  }

  const employeeSelect = document.getElementById('payroll-reimbursement-employee');
  const projectSelect = document.getElementById('payroll-reimbursement-project');
  const amountInput = document.getElementById('payroll-reimbursement-amount');
  const dateInput = document.getElementById('payroll-reimbursement-date');
  const noteInput = document.getElementById('payroll-reimbursement-note');
  const vendorInput = document.getElementById('payroll-reimbursement-vendor');
  const fileInput = document.getElementById('payroll-reimbursement-receipt');
  const submitBtn = document.getElementById('payroll-reimbursement-submit');

  const employeeId = Number(employeeSelect?.value || 0);
  const projectId = Number(projectSelect?.value || 0);
  const amount = Number(amountInput?.value || 0);
  const expenseDate = (dateInput?.value || '').trim();
  const note = (noteInput?.value || '').trim();
  const vendorName = (vendorInput?.value || '').trim();
  const file = fileInput?.files && fileInput.files[0] ? fileInput.files[0] : null;

  if (!employeeId || !projectId || !Number.isFinite(amount) || amount <= 0 || !vendorName || !file) {
    setPayrollReimbursementMessage(
      'Employee, project, vendor, amount, and receipt file are required.',
      true,
      { includePage: false, includeModal: true }
    );
    return;
  }

  const formData = new FormData();
  formData.append('employee_id', String(employeeId));
  formData.append('project_id', String(projectId));
  formData.append('amount', amount.toFixed(2));
  formData.append('vendor_name', vendorName);
  if (expenseDate) formData.append('expense_date', expenseDate);
  if (note) formData.append('note', note);
  if (allowDuplicate) formData.append('allow_duplicate', '1');
  formData.append('receipt', file);

  if (submitBtn) submitBtn.disabled = true;
  setPayrollReimbursementMessage('Uploading receipt...', false, { includePage: false, includeModal: true });
  try {
    const data = await fetchJSON('/api/payroll/reimbursements', {
      method: 'POST',
      body: formData
    });
    if (!data?.ok) {
      throw new Error(data?.error || 'Failed to create reimbursement request.');
    }

    setPayrollReimbursementMessage('Reimbursement request created. Approve it before including it in payroll.', false, {
      includePage: true,
      includeModal: false
    });
    if (amountInput) amountInput.value = '';
    if (noteInput) noteInput.value = '';
    if (vendorInput) vendorInput.value = '';
    if (fileInput) fileInput.value = '';
    ensurePayrollReimbursementDateDefault();
    closePayrollReimbursementModal();

    await loadPayrollReimbursements();
    if (currentPayrollRange?.start && currentPayrollRange?.end && getPayrollIncludeReimbursementsSetting()) {
      await loadPayrollSummary({ suppressAlerts: true });
    }
  } catch (err) {
    console.error('[PAYROLL] submitPayrollReimbursement error', err);
    if (err?.status === 409 && err?.body?.code === 'duplicate_reimbursement' && !allowDuplicate) {
      const warning = buildPayrollDuplicateWarning(err?.body?.duplicates);
      const proceed = confirm(
        `Possible duplicate reimbursement found.${warning ? `\n\n${warning}` : ''}\n\nUpload anyway?`
      );
      if (proceed) {
        return submitPayrollReimbursement({ allowDuplicate: true });
      }
    }
    setPayrollReimbursementMessage(
      'Failed to create reimbursement request: ' + (err?.message || 'Unknown error'),
      true,
      { includePage: false, includeModal: true }
    );
  } finally {
    if (submitBtn) submitBtn.disabled = false;
    applyPayrollSettingsAccess();
  }
}

function setupPayrollReimbursements() {
  const filterApplyBtn = document.getElementById('payroll-reimbursement-filter-apply');
  if (filterApplyBtn && !filterApplyBtn.dataset.bound) {
    filterApplyBtn.dataset.bound = '1';
    filterApplyBtn.addEventListener('click', () => {
      const nextFilters = normalizePayrollReimbursementFilters(getPayrollReimbursementFiltersFromUi());
      loadPayrollReimbursements(nextFilters, { resetPage: true });
    });
  }
  const filterClearBtn = document.getElementById('payroll-reimbursement-filter-clear');
  if (filterClearBtn && !filterClearBtn.dataset.bound) {
    filterClearBtn.dataset.bound = '1';
    filterClearBtn.addEventListener('click', () => {
      resetPayrollReimbursementFiltersUi();
      const cleared = normalizePayrollReimbursementFilters(getPayrollReimbursementFiltersFromUi());
      loadPayrollReimbursements(cleared, { resetPage: true });
    });
  }
  const openBtn = document.getElementById('payroll-reimbursement-open-modal');
  if (openBtn && !openBtn.dataset.bound) {
    openBtn.dataset.bound = '1';
    openBtn.addEventListener('click', openPayrollReimbursementModal);
  }
  const submitBtn = document.getElementById('payroll-reimbursement-submit');
  if (submitBtn && !submitBtn.dataset.bound) {
    submitBtn.dataset.bound = '1';
    submitBtn.addEventListener('click', submitPayrollReimbursement);
  }
  const closeBtn = document.getElementById('payroll-reimbursement-modal-close');
  if (closeBtn && !closeBtn.dataset.bound) {
    closeBtn.dataset.bound = '1';
    closeBtn.addEventListener('click', closePayrollReimbursementModal);
  }
  const cancelBtn = document.getElementById('payroll-reimbursement-modal-cancel');
  if (cancelBtn && !cancelBtn.dataset.bound) {
    cancelBtn.dataset.bound = '1';
    cancelBtn.addEventListener('click', closePayrollReimbursementModal);
  }
  const modalBackdrop = document.getElementById('payroll-reimbursement-modal-backdrop');
  if (modalBackdrop && !modalBackdrop.dataset.bound) {
    modalBackdrop.dataset.bound = '1';
    modalBackdrop.addEventListener('click', event => {
      if (event.target === modalBackdrop) {
        closePayrollReimbursementModal();
      }
    });
  }
  const modal = document.getElementById('payroll-reimbursement-modal');
  if (modal && !modal.dataset.boundEscape) {
    modal.dataset.boundEscape = '1';
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (modal.classList.contains('hidden')) return;
      closePayrollReimbursementModal();
    });
  }
  const tbody = document.getElementById('payroll-reimbursements-body');
  if (tbody && !tbody.dataset.boundApprove) {
    tbody.dataset.boundApprove = '1';
    tbody.addEventListener('click', event => {
      const approveBtn = event.target.closest('.payroll-reimbursement-approve');
      if (approveBtn) {
        const reimbursementId = Number(approveBtn.dataset.reimbursementId || 0);
        approvePayrollReimbursement(reimbursementId);
        return;
      }
      const historyBtn = event.target.closest('.payroll-reimbursement-history');
      if (historyBtn) {
        const reimbursementId = Number(historyBtn.dataset.reimbursementId || 0);
        openPayrollReimbursementHistoryModal(reimbursementId);
        return;
      }
      const cancelBtn = event.target.closest('.payroll-reimbursement-cancel');
      if (!cancelBtn) return;
      const reimbursementId = Number(cancelBtn.dataset.reimbursementId || 0);
      const status = String(cancelBtn.dataset.reimbursementStatus || 'requested');
      cancelPayrollReimbursement(reimbursementId, status);
    });
  }

  const historyCloseBtn = document.getElementById('payroll-reimbursement-history-close');
  if (historyCloseBtn && !historyCloseBtn.dataset.bound) {
    historyCloseBtn.dataset.bound = '1';
    historyCloseBtn.addEventListener('click', closePayrollReimbursementHistoryModal);
  }
  const historyDoneBtn = document.getElementById('payroll-reimbursement-history-done');
  if (historyDoneBtn && !historyDoneBtn.dataset.bound) {
    historyDoneBtn.dataset.bound = '1';
    historyDoneBtn.addEventListener('click', closePayrollReimbursementHistoryModal);
  }
  const historyBackdrop = document.getElementById('payroll-reimbursement-history-backdrop');
  if (historyBackdrop && !historyBackdrop.dataset.bound) {
    historyBackdrop.dataset.bound = '1';
    historyBackdrop.addEventListener('click', event => {
      if (event.target === historyBackdrop) {
        closePayrollReimbursementHistoryModal();
      }
    });
  }
  const historyModal = document.getElementById('payroll-reimbursement-history-modal');
  if (historyModal && !historyModal.dataset.boundEscape) {
    historyModal.dataset.boundEscape = '1';
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (historyModal.classList.contains('hidden')) return;
      closePayrollReimbursementHistoryModal();
    });
  }

  const prevBtn = document.getElementById('payroll-reimbursement-prev');
  if (prevBtn && !prevBtn.dataset.bound) {
    prevBtn.dataset.bound = '1';
    prevBtn.addEventListener('click', () => {
      if (payrollReimbursementCurrentPage <= 1) return;
      loadPayrollReimbursements(null, { page: payrollReimbursementCurrentPage - 1 });
    });
  }

  const nextBtn = document.getElementById('payroll-reimbursement-next');
  if (nextBtn && !nextBtn.dataset.bound) {
    nextBtn.dataset.bound = '1';
    nextBtn.addEventListener('click', () => {
      if (payrollReimbursementCurrentPage >= payrollReimbursementTotalPages) return;
      loadPayrollReimbursements(null, { page: payrollReimbursementCurrentPage + 1 });
    });
  }
}

function getPayrollEmployeeName(employeeId) {
  if (!employeeId) return '';
  const row = document.querySelector(`tr.payroll-row[data-employee-id="${employeeId}"]`);
  return row?.dataset?.employeeName || '';
}

function getPayrollEmployeeTemplateContext(employeeId, fallbackName = '') {
  const targetId = Number(employeeId);
  const rows = (currentPayrollRows || []).filter(
    row => Number(row?.employee_id) === targetId
  );
  const uniqueProjects = new Set();
  let totalHours = 0;

  rows.forEach(row => {
    totalHours += Number(row?.project_hours || row?.total_hours || 0);
    const projectName = String(row?.project_name_raw || row?.project_name || '').trim();
    if (projectName) uniqueProjects.add(projectName);
  });

  const projectNames = Array.from(uniqueProjects);
  const projectName = projectNames.length === 1
    ? projectNames[0]
    : (projectNames.length > 1 ? 'Multiple Projects' : '');

  return {
    employee_name: fallbackName || rows[0]?.employee_name || '',
    total_hours: totalHours,
    project_name: projectName
  };
}

function findPayrollSummaryProject(employeeId, projectId) {
  if (!employeeId || projectId === undefined || projectId === null || projectId === '') return null;
  return (currentPayrollRows || []).find(
    row =>
      Number(row.employee_id) === Number(employeeId) &&
      String(row.project_id) === String(projectId)
  ) || null;
}

function setFieldValueAndSync(field, value) {
  if (!field) return false;
  const nextValue = value == null ? '' : String(value);
  if (field.value === nextValue) return false;
  field.value = nextValue;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function applySavedSettingsToLoadedChecks(savedSettings) {
  const tbody = document.getElementById('payroll-summary-body');
  if (!tbody) {
    return { appliedCount: 0, conflicts: 0, overwroteFilled: false };
  }

  const memoInputs = Array.from(tbody.querySelectorAll('.payroll-memo-input'));
  const standardLineRows = Array.from(tbody.querySelectorAll('.line-items-box tbody tr'))
    .filter(row => !row.classList.contains('custom-line-row'));
  if (!memoInputs.length && !standardLineRows.length) {
    return { appliedCount: 0, conflicts: 0, overwroteFilled: false };
  }

  const rangeStart = currentPayrollRange?.start || '';
  const rangeEnd = currentPayrollRange?.end || '';
  const memoTemplate = savedSettings?.default_memo || DEFAULT_PAYROLL_MEMO_TEMPLATE;
  const lineTemplate = savedSettings?.line_description_template || DEFAULT_PAYROLL_LINE_TEMPLATE;

  const memoUpdates = memoInputs.map(input => {
    const employeeId = Number(input.dataset.employeeId || 0);
    const employeeName = getPayrollEmployeeName(employeeId);
    const memoContext = getPayrollEmployeeTemplateContext(employeeId, employeeName);
    const memoBase = buildMemoFromTemplate(
      memoTemplate,
      memoContext,
      rangeStart,
      rangeEnd
    );
    const hasReimbursementLines = (currentPayrollRows || []).some(
      row =>
        Number(row?.employee_id) === employeeId &&
        !!row?.is_receipt_reimbursement
    );
    const desired = appendReimbursementMemoSuffix(
      memoBase,
      hasReimbursementLines
    );
    return {
      input,
      current: (input.value || '').trim(),
      desired
    };
  });

  const lineUpdates = standardLineRows
    .map(row => {
      const descInput = row.querySelector('.line-desc-input');
      const expenseSelect = row.querySelector('.line-expense-select');
      if (!descInput || !expenseSelect) return null;
      const employeeId = Number(descInput.dataset.employeeId || expenseSelect.dataset.employeeId || row.dataset.employeeId || 0);
      const projectId = descInput.dataset.projectId || expenseSelect.dataset.projectId || '';
      const projectCell = row.querySelector('td[data-project-id]');
      const fallbackProjectName = projectCell?.dataset?.projectName || '';
      const employeeName = getPayrollEmployeeName(employeeId);
      const projectSummary = findPayrollSummaryProject(employeeId, projectId);
      const lineType = row.dataset.lineType || '';
      const isReceipt = lineType === 'receipt';
      const desiredDesc = isReceipt
        ? buildReceiptLineDescription(projectSummary || {
            vendor_name: projectSummary?.vendor_name || '',
            project_name_raw: fallbackProjectName,
            project_name: fallbackProjectName,
            reimbursement_count: Number(projectSummary?.reimbursement_count || 0)
          })
        : buildLineDescription(
            lineTemplate,
            {
              employee_name: employeeName,
              project_name:
                projectSummary?.project_name_raw ||
                projectSummary?.project_name ||
                fallbackProjectName,
              project_hours: Number(projectSummary?.project_hours || 0)
            },
            rangeStart,
            rangeEnd
          );
      const desiredExpense = isReceipt
        ? (
            savedSettings?.receipt_expense_account_name ||
            savedSettings?.expense_account_name ||
            ''
          )
        : (savedSettings?.expense_account_name || '');
      return {
        descInput,
        expenseSelect,
        currentDesc: (descInput.value || '').trim(),
        desiredDesc,
        currentExpense: (expenseSelect.value || '').trim(),
        desiredExpense
      };
    })
    .filter(Boolean);

  let conflicts = 0;
  memoUpdates.forEach(update => {
    if (update.current && update.current !== update.desired) {
      conflicts += 1;
    }
  });
  lineUpdates.forEach(update => {
    if (update.currentDesc && update.currentDesc !== update.desiredDesc) {
      conflicts += 1;
    }
    if (update.desiredExpense && update.currentExpense && update.currentExpense !== update.desiredExpense) {
      conflicts += 1;
    }
  });

  let overwroteFilled = false;
  if (conflicts > 0) {
    overwroteFilled = confirm(
      'Some checks already have memo or line values.\n\n' +
      'Select OK to rewrite those values with the saved payroll settings.\n' +
      'Select Cancel to keep existing filled values and only fill blank fields.'
    );
  }

  let appliedCount = 0;
  memoUpdates.forEach(update => {
    const shouldApply = overwroteFilled || !update.current;
    if (!shouldApply) return;
    if (setFieldValueAndSync(update.input, update.desired)) {
      appliedCount += 1;
    }
  });

  lineUpdates.forEach(update => {
    const shouldApplyDesc = overwroteFilled || !update.currentDesc;
    if (shouldApplyDesc && setFieldValueAndSync(update.descInput, update.desiredDesc)) {
      appliedCount += 1;
    }

    if (update.desiredExpense) {
      ensureSelectOption(update.expenseSelect, update.desiredExpense);
      const shouldApplyExpense = overwroteFilled || !update.currentExpense;
      if (shouldApplyExpense && setFieldValueAndSync(update.expenseSelect, update.desiredExpense)) {
        appliedCount += 1;
      }
    }
  });

  const bankPreviewText = savedSettings?.bank_account_name || '(not set)';
  document.querySelectorAll('.payroll-bank-preview').forEach(node => {
    node.textContent = bankPreviewText;
  });

  return { appliedCount, conflicts, overwroteFilled };
}

function promptReuseSavedSettingsIfNeeded() {
  // No-op: defaults disabled per request.
}

function normalizeTimeValue(val) {
  if (!val) return '';
  const parts = String(val).split(':');
  if (parts.length >= 2) {
    const hh = parts[0].padStart(2, '0');
    const mm = parts[1].padStart(2, '0');
    return `${hh}:${mm}`;
  }
  return val;
}

function computeHoursFromDateTimes(startDate, startTime, endDate, endTime) {
  if (!startDate || !endDate || !startTime || !endTime) return null;
  const start = new Date(`${startDate}T${startTime}`);
  const end = new Date(`${endDate}T${endTime}`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const diff = end - start;
  if (diff <= 0) return null;
  return diff / (1000 * 60 * 60);
}

// Time entries modal
let timeEntriesCloseBound = false;

function closeTimeEntriesModal() {
  const modal = document.getElementById('time-entries-modal');
  const backdrop = document.getElementById('time-entries-backdrop');
  hideInlineTimeEntryEditor();
  lastTimeEntriesContext = null;
  if (modal) modal.classList.add('hidden');
  if (backdrop) backdrop.classList.add('hidden');
}

function bindTimeEntriesCloseHandlers() {
  if (timeEntriesCloseBound) return;
  const closeBtn = document.getElementById('time-entries-close');
  const backdrop = document.getElementById('time-entries-backdrop');
  if (closeBtn) closeBtn.addEventListener('click', closeTimeEntriesModal);
  if (backdrop) {
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) closeTimeEntriesModal();
    });
  }
  timeEntriesCloseBound = true;
}

function hideInlineTimeEntryEditor() {
  const panel = document.getElementById('time-entry-edit');
  const errEl = document.getElementById('edit-entry-error');
  if (!panel) return;
  panel.classList.add('hidden');
  panel.dataset.entryId = '';
  if (errEl) errEl.textContent = '';
}

async function reapproveEditedTimeEntryForPayroll(entryId, note) {
  const idNum = Number(entryId);
  if (!idNum) return { ok: false, error: 'Invalid time entry id.' };
  try {
    await fetchJSON(`/api/time-entries/${idNum}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: (note || '').trim() || null })
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || 'Failed to re-approve time entry.' };
  }
}

function openInlineTimeEntryEditor(row) {
  const panel = document.getElementById('time-entry-edit');
  if (!panel) return;
  const entryId = row.dataset.entryId;
  const startDate = row.dataset.startDate || '';
  const endDate = row.dataset.endDate || '';
  const startTime = row.dataset.startTime || '';
  const endTime = row.dataset.endTime || '';
  const hours = row.dataset.hours || '';
  const empId = row.dataset.employeeId || '';
  const projectId = row.dataset.projectId || '';
  const note = row.dataset.note || '';
  panel.dataset.entryId = entryId || '';
  panel.dataset.employeeId = empId || '';
  panel.dataset.projectId = projectId || '';
  panel.classList.remove('hidden');
  const errEl = document.getElementById('edit-entry-error');
  if (errEl) errEl.textContent = '';
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  };
  setVal('edit-entry-start-date', startDate);
  setVal('edit-entry-end-date', endDate);
  setVal('edit-entry-start-time', startTime);
  setVal('edit-entry-end-time', endTime);
  setVal('edit-entry-hours', hours);
  setVal('edit-entry-note', note);
  const startTimeInput = document.getElementById('edit-entry-start-time');
  const endTimeInput = document.getElementById('edit-entry-end-time');
  const hoursInput = document.getElementById('edit-entry-hours');
  function recomputeHours() {
    const sd = document.getElementById('edit-entry-start-date')?.value || startDate;
    const ed = document.getElementById('edit-entry-end-date')?.value || endDate;
    const st = startTimeInput?.value || '';
    const et = endTimeInput?.value || '';
    const computed = computeHoursFromDateTimes(sd, st, ed, et);
    if (hoursInput) hoursInput.value = Number.isFinite(computed) ? computed.toFixed(2) : '';
  }
  ['change', 'input'].forEach(evt => {
    if (startTimeInput) startTimeInput.addEventListener(evt, recomputeHours);
    if (endTimeInput) endTimeInput.addEventListener(evt, recomputeHours);
  });
}

function bindInlineTimeEntryEditor() {
  const panel = document.getElementById('time-entry-edit');
  if (!panel) return;
  const saveBtn = document.getElementById('edit-entry-save');
  const cancelBtn = document.getElementById('edit-entry-cancel');
  const errEl = document.getElementById('edit-entry-error');
  function hidePanel() {
    hideInlineTimeEntryEditor();
  }
  if (cancelBtn && !cancelBtn._bound) {
    cancelBtn._bound = true;
    cancelBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      hidePanel();
      closeTimeEntriesModal();
    });
  }
  if (saveBtn && !saveBtn._bound) {
    saveBtn._bound = true;
    saveBtn.addEventListener('click', async () => {
      const entryId = panel.dataset.entryId;
      const empId = Number(panel.dataset.employeeId);
      const projId = Number(panel.dataset.projectId);
      if (!entryId || !empId || !projId) {
        if (errEl) errEl.textContent = 'Missing entry metadata (employee/project).';
        return;
      }
      const start_date = (document.getElementById('edit-entry-start-date')?.value || '').trim();
      const end_date = (document.getElementById('edit-entry-end-date')?.value || '').trim();
      const start_time = (document.getElementById('edit-entry-start-time')?.value || '').trim();
      const end_time = (document.getElementById('edit-entry-end-time')?.value || '').trim();
      const hoursVal = (document.getElementById('edit-entry-hours')?.value || '').trim();
      const note = (document.getElementById('edit-entry-note')?.value || '').trim();
      if (!start_date || !end_date || !start_time || !end_time) {
        if (errEl) errEl.textContent = 'Start/end date and time are required.';
        return;
      }
      const computedHours = computeHoursFromDateTimes(start_date, start_time, end_date, end_time);
      const hours = Number(computedHours ?? hoursVal);
      if (!Number.isFinite(hours) || hours <= 0) {
        if (errEl) errEl.textContent = 'Hours are invalid. Check start/end times.';
        return;
      }
      if (!note) {
        if (errEl) errEl.textContent = 'A note is required when saving changes.';
        return;
      }
      const confirmed = confirm(
        'Save changes to this time entry?\n\n' +
        'This will update payroll totals/check line items and keep this entry approved for payroll.'
      );
      if (!confirmed) return;
      try {
        const data = await fetchJSON(`/api/time-entries/${entryId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employee_id: empId,
            project_id: projId,
            start_date,
            end_date,
            start_time,
            end_time,
            hours,
            note
          })
        });
        if (data && data.error) throw new Error(data.error || 'Failed to save time entry.');
        const reapprove = await reapproveEditedTimeEntryForPayroll(entryId, note);
        closeTimeEntriesModal();
        await loadPayrollSummary();
        if (!reapprove.ok) {
          alert(
            'Time entry changes were saved, but payroll approval could not be restored automatically.\n\n' +
            (reapprove.error || 'Please re-approve this entry in Review Time Entries.')
          );
        }
      } catch (err) {
        console.error('[PAYROLL] Save time entry error', err);
        if (errEl) errEl.textContent = err.message || 'Failed to save time entry.';
      }
    });
  }
}

async function openTimeEntriesModal(employeeId, employeeName, projectId = null, projectName = '') {
  lastTimeEntriesContext = { employeeId, employeeName, projectId, projectName };
  const modal = document.getElementById('time-entries-modal');
  const backdrop = document.getElementById('time-entries-backdrop');
  const bodyEl = document.getElementById('time-entries-body');
  const titleEl = document.getElementById('time-entries-title');
  bindTimeEntriesCloseHandlers();
  bindInlineTimeEntryEditor();
  if (!modal || !backdrop || !bodyEl || !titleEl) return;
  const { start, end } = currentPayrollRange || {};
  if (!start || !end) {
    alert('Please select a start and end date first.');
    return;
  }
  const startUS = formatDateUS(start);
  const endUS = formatDateUS(end);
  const projectLabel = projectName ? ` – ${projectName}` : '';
  titleEl.textContent = `Time Entries for ${employeeName}${projectLabel} (${startUS} – ${endUS})`;
  bodyEl.innerHTML = '<p>Loading time entries…</p>';
  try {
    const params = new URLSearchParams({ employeeId: String(employeeId), start, end });
    const res = await fetch('/api/payroll/time-entries?' + params.toString());
    let entries = await res.json();
    if (!res.ok || (entries && entries.error)) {
      throw new Error(entries?.error || 'Failed to load time entries.');
    }
    if (!Array.isArray(entries)) entries = [];
    if (projectId) {
      const pid = Number(projectId);
      entries = entries.filter(e => Number(e.project_id) === pid);
    }
    if (!Array.isArray(entries) || !entries.length) {
      bodyEl.innerHTML = '<p>No time entries for this employee in this date range.</p>';
    } else {
      const byProject = new Map();
      for (const e of entries) {
        const key = e.project_name || '(No project)';
        if (!byProject.has(key)) byProject.set(key, []);
        byProject.get(key).push(e);
      }
      let html = '';
      for (const [projName, list] of byProject.entries()) {
        let totalHours = 0;
        let totalPay = 0;
        list.forEach(e => {
          totalHours += Number(e.hours || 0);
          totalPay += Number(e.total_pay || 0);
        });
        html += `
  <h4>${projName}</h4>
  <table class="table nested-table">
    <thead>
      <tr>
        <th>Entry ID</th>
        <th>Date</th>
        <th>Start</th>
        <th>End</th>
        <th>Hours</th>
        <th>Rate</th>
        <th>Pay</th>
      </tr>
    </thead>
    <tbody>
      ${list
        .map(e => {
          const hours = Number(e.hours || 0);
          const rowPay = Number(e.total_pay || 0);
          const rate = Number(e.rate || (hours > 0 ? rowPay / hours : 0));
          const startDateUS = formatDateUS(e.start_date);
          const endDateUS = formatDateUS(e.end_date);
          const dateLabel = e.start_date === e.end_date ? startDateUS : `${startDateUS} – ${endDateUS}`;
          const startTimeVal = normalizeTimeValue(e.start_time);
          const endTimeVal = normalizeTimeValue(e.end_time);
          const startTimeDisplay = startTimeVal ? formatTimeValue12(startTimeVal) : '';
          const endTimeDisplay = endTimeVal ? formatTimeValue12(endTimeVal) : '';
          const noteAttr = (e.resolved_note || '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, ' ');
          return `
  <tr
    class="time-entry-row"
    data-entry-id="${e.id}"
    data-employee-id="${employeeId}"
    data-project-id="${e.project_id || ''}"
    data-start-date="${e.start_date || ''}"
    data-end-date="${e.end_date || ''}"
    data-start-time="${startTimeVal}"
    data-end-time="${endTimeVal}"
    data-hours="${hours.toFixed(2)}"
    data-note="${noteAttr}"
  >
    <td>${e.id != null ? e.id : ''}</td>
    <td>${dateLabel}</td>
    <td>${startTimeDisplay || '<span class="missing-time">Missing</span>'}</td>
    <td>${endTimeDisplay || '<span class="missing-time">Missing</span>'}</td>
    <td>${hours.toFixed(2)}</td>
    <td>$${rate.toFixed(2)}/hr</td>
    <td>$${rowPay.toFixed(2)}</td>
  </tr>
`;
        })
        .join('')}
      <tr class="project-total-row">
        <td colspan="4"><strong>Project Total</strong></td>
        <td><strong>${totalHours.toFixed(2)}</strong></td>
        <td></td>
        <td><strong>$${totalPay.toFixed(2)}</strong></td>
      </tr>
    </tbody>
  </table>
`;
      }
      bodyEl.innerHTML = html;
      bodyEl.querySelectorAll('tr.time-entry-row').forEach(tr => {
        tr.addEventListener('click', () => openInlineTimeEntryEditor(tr));
      });
    }
    modal.classList.remove('hidden');
    backdrop.classList.remove('hidden');
  } catch (err) {
    console.error('Error loading time entries for payroll view:', err);
    bodyEl.innerHTML = '<p>Failed to load time entries.</p>';
    modal.classList.remove('hidden');
    backdrop.classList.remove('hidden');
  }
}

function setupViewTimeEntriesButtons() {
  const tbody = document.getElementById('payroll-summary-body');
  if (!tbody) return;
  tbody.addEventListener('click', e => {
    const btn = e.target.closest('.btn-view-time-entries');
    if (!btn) return;
    e.stopPropagation();
    const empId = Number(btn.dataset.employeeId);
    const empName = btn.dataset.employeeName || '';
    const projectId = btn.dataset.projectId || null;
    const projectName = btn.dataset.projectName || '';
    if (!empId) return;
    openTimeEntriesModal(empId, empName, projectId, projectName);
  });
}

function renderPayrollSummaryTable() {
  const tbody = document.getElementById('payroll-summary-body');
  if (!tbody) return;
  const expandedBefore = new Set(payrollExpandedRows);
  const esc = typeof escapeHTML === 'function' ? escapeHTML : (value => (value == null ? '' : String(value)));
  tbody.innerHTML = '';
  if (!currentPayrollRows.length) {
    payrollSendSelections = new Set();
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="5">(no data yet)</td>`;
    tbody.appendChild(tr);
    return;
  }
  const byEmployee = new Map();
  for (const row of currentPayrollRows) {
    const key = row.employee_id;
    if (!byEmployee.has(key)) {
      byEmployee.set(key, {
        employee_id: row.employee_id,
        employee_name: row.employee_name,
        vendor_qbo_id: row.employee_vendor_qbo_id || null,
        employee_qbo_id: row.employee_employee_qbo_id || null,
        total_hours: 0,
        total_pay: 0,
        any_paid: false,
        payroll_run_id: row.payroll_run_id || null,
        projects: []
      });
    }
    const agg = byEmployee.get(key);
    agg.total_hours += Number(row.project_hours || 0);
    agg.total_pay += Number(row.project_pay || 0);
    agg.any_paid = agg.any_paid || !!row.any_paid;
    if (row.payroll_run_id) agg.payroll_run_id = row.payroll_run_id;
    agg.projects.push({
      project_id: row.project_id,
      project_name: row.project_name,
      project_customer_name: row.project_customer_name,
      project_name_raw: row.project_name_raw,
      vendor_name: row.vendor_name || '',
      hours: row.project_hours,
      total_pay: row.project_pay,
      class_name: row.class_name || '',
      expense_account_name: row.expense_account_name || '',
      is_receipt_reimbursement: !!row.is_receipt_reimbursement,
      reimbursement_count: Number(row.reimbursement_count || 0)
    });
  }
  const loadedEmployeeIds = new Set(
    Array.from(byEmployee.keys())
      .map(id => Number(id))
      .filter(Number.isFinite)
  );
  if (payrollSendSelections.size) {
    payrollSendSelections = new Set(
      Array.from(payrollSendSelections).filter(id => loadedEmployeeIds.has(id))
    );
  }
  const startUS = formatDateUS(currentPayrollRange.start);
  const endUS = formatDateUS(currentPayrollRange.end);
  const canUnpay = canModifyPayrollReports();
  for (const agg of byEmployee.values()) {
    const employeeId = Number(agg.employee_id);
    const employeeNameRaw = agg.employee_name || '';
    const customLines = additionalLinesByEmployee[employeeId] || [];
    const customTotal = customLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
    const displayTotalPay = agg.total_pay + customTotal;
    const unpayButtonHtml = canUnpay && agg.any_paid
      ? `<button type="button" class="btn tertiary btn-compact btn-unpay" data-employee-id="${employeeId}" data-payroll-run-id="${agg.payroll_run_id || ''}">Mark unpaid</button>`
      : '';
    const tr = document.createElement('tr');
    tr.classList.add('payroll-row');
    tr.dataset.employeeId = employeeId;
    tr.dataset.employeeName = employeeNameRaw;
    const paidBadge = agg.any_paid ? '<span class="paid-badge">Paid</span>' : '';
    const sendChecked = payrollSendSelections.has(employeeId) ? 'checked' : '';
    tr.innerHTML = `
      <td>${esc(employeeNameRaw)} ${paidBadge}</td>
      <td>(multiple)</td>
      <td>${agg.total_hours.toFixed(2)}</td>
      <td>$${displayTotalPay.toFixed(2)}</td>
      <td>
        <div class="actions-inline">
          <label class="checkbox-inline">
            <input type="checkbox" class="payroll-send-checkbox" data-employee-id="${employeeId}" ${sendChecked} />
            Send to QB
          </label>
          ${unpayButtonHtml}
        </div>
      </td>
    `;
    const memoContext = getPayrollEmployeeTemplateContext(employeeId, employeeNameRaw);
    const memoBase = buildMemoFromTemplate(
      currentPayrollSettings.default_memo,
      memoContext,
      currentPayrollRange.start,
      currentPayrollRange.end
    );
    const hasReimbursementLines = (agg.projects || []).some(
      p => !!p.is_receipt_reimbursement
    );
    const memoText = appendReimbursementMemoSuffix(
      memoBase,
      hasReimbursementLines
    );
    const detailsTr = document.createElement('tr');
    detailsTr.classList.add('payroll-details-row', 'hidden');
    detailsTr.dataset.employeeId = employeeId;
    const colCount = 5;
    const safeBankAccount = esc(currentPayrollSettings.bank_account_name || '(not set)');
    const safeMemoText = esc(memoText);
    const payPeriodLabel = `${startUS} - ${endUS}`;
    const totalLineCount = (agg.projects ? agg.projects.length : 0) + customLines.length;
    detailsTr.innerHTML = `
      <td colspan="${colCount}">
        <div class="payroll-details">
          <section class="payroll-details-panel payroll-check-preview">
            <div class="payroll-section-heading">
              <h4>QuickBooks Check Preview</h4>
              <p class="payroll-section-subtitle">Pay Period ${esc(payPeriodLabel)}</p>
            </div>
            <div class="summary-grid">
              <div class="summary-item"><div class="label">Employee</div><div class="value">${esc(employeeNameRaw)}</div></div>
              <div class="summary-item"><div class="label">Check Date</div><div class="value">${esc(formatDateUS(currentPayrollRange.end))}</div></div>
              <div class="summary-item summary-item-total"><div class="label">Total Amount</div><div class="value">$${displayTotalPay.toFixed(2)}</div></div>
              <div class="summary-item"><div class="label">Bank Account</div><div class="value payroll-bank-preview">${safeBankAccount}</div></div>
            </div>
            <div class="form-field payroll-memo-field">
              <label><strong>Default Memo</strong></label>
              <input type="text" class="payroll-memo-input" data-employee-id="${employeeId}" value="${safeMemoText}" />
            </div>
          </section>
          <section class="payroll-details-panel payroll-line-items">
            <div class="payroll-section-heading">
              <h4>Line Items</h4>
              <p class="payroll-section-subtitle">${totalLineCount} line item${totalLineCount === 1 ? '' : 's'}</p>
            </div>
            <div class="line-items-box">
              ${agg.projects && agg.projects.length ? `
                  <table class="table nested-table payroll-line-items-table">
                    <thead>
                      <tr>
                        <th>Expense Account</th><th>Description</th><th>Amount</th><th>Customer / Project</th><th>Class</th><th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${agg.projects.map(p => {
                        const hours = Number(p.hours || 0);
                        const amount = Number(p.total_pay || 0);
                        const isReceiptReimbursement = !!p.is_receipt_reimbursement;
                        const lineDesc = isReceiptReimbursement
                          ? buildReceiptLineDescription(p)
                          : buildLineDescription(
                              currentPayrollSettings.line_description_template,
                              {
                                employee_name: employeeNameRaw,
                                project_name: p.project_name_raw || p.project_name,
                                project_hours: hours
                              },
                              currentPayrollRange.start,
                              currentPayrollRange.end
                            );
                        const selectedExpenseDefault = isReceiptReimbursement
                          ? (
                              document.getElementById('payroll-receipt-expense-account')?.value ||
                              currentPayrollSettings.receipt_expense_account_name ||
                              currentPayrollSettings.expense_account_name ||
                              ''
                            )
                          : (
                              document.getElementById('payroll-expense-account')?.value ||
                              currentPayrollSettings.expense_account_name ||
                              ''
                            );
                        const defaultExpenseName = selectedExpenseDefault || '';
                        const expenseOptions = (payrollExpenseAccounts || []).map(acc => {
                          const fullName = acc.fullName || acc.name || '';
                          if (!fullName) return '';
                          const selected = fullName === defaultExpenseName ? ' selected' : '';
                          return `<option value="${esc(fullName)}"${selected}>${esc(fullName)}</option>`;
                        }).join('');
                        const defaultClassName = isReceiptReimbursement
                          ? (p.class_name || currentPayrollSettings.receipt_class_name || '')
                          : (p.class_name || p.project_name || '');
                        let classOptions = (payrollClasses || []).map(c => {
                          const name = c.fullName || c.name || '';
                          if (!name) return '';
                          const selected = name === defaultClassName ? ' selected' : '';
                          return `<option value="${esc(name)}"${selected}>${esc(name)}</option>`;
                        }).join('');
                        if (defaultClassName && !(payrollClasses || []).some(c => (c.fullName || c.name) === defaultClassName)) {
                          classOptions = `<option value="${esc(defaultClassName)}" selected>${esc(defaultClassName)}</option>` + classOptions;
                        }
                        const projectLabel = isReceiptReimbursement
                          ? ''
                          : getProjectLabel(p.project_id, p.project_name_raw || p.project_name, p.project_customer_name);
                        const actionsCell = isReceiptReimbursement
                          ? `<span class="payroll-line-note">Receipt reimbursement</span>`
                          : `<button type="button" class="btn secondary btn-compact btn-view-time-entries" data-employee-id="${employeeId}" data-employee-name="${esc(employeeNameRaw)}" data-project-id="${p.project_id || ''}" data-project-name="${esc(p.project_name || '')}">View Time Entries</button>`;
                        return `
                          <tr data-employee-id="${employeeId}" data-employee-name="${esc(employeeNameRaw)}" data-line-type="${isReceiptReimbursement ? 'receipt' : 'labor'}">
                            <td><select class="line-expense-select with-arrow" data-employee-id="${employeeId}" data-project-id="${p.project_id}"><option value="${esc(defaultExpenseName || '')}" ${defaultExpenseName ? 'selected' : ''}>${defaultExpenseName ? `Use default (${esc(defaultExpenseName)})` : '(select expense)'}</option>${expenseOptions}</select></td>
                            <td><input type="text" class="line-desc-input" data-employee-id="${employeeId}" data-project-id="${p.project_id}" value="${esc(lineDesc)}" /></td>
                            <td>$${amount.toFixed(2)}</td>
                            <td data-project-id="${p.project_id}" data-customer-name="${esc(isReceiptReimbursement ? '' : (p.project_customer_name || ''))}" data-project-name="${esc(isReceiptReimbursement ? '' : (p.project_name_raw || p.project_name || ''))}">${esc(projectLabel)}</td>
                            <td><select class="line-class-select with-arrow" data-employee-id="${employeeId}" data-project-id="${p.project_id}"><option value="">(none)</option>${classOptions}</select></td>
                            <td>${actionsCell}</td>
                          </tr>
                        `;
                      }).join('')}
                      ${customLines.map(line => {
                        const hasExpense = !!line.expenseAccountName;
                        const hasDesc = !!line.description;
                        const amountVal = Number(line.amount || 0);
                        const hasAmount = Number.isFinite(amountVal) && amountVal > 0;
                        const hasClass = !!line.className;
                        const projectOptions = (payrollProjects || []).map(pr => {
                          const label = pr.customer_name ? `${pr.customer_name} : ${pr.name}` : pr.name;
                          return `<option value="${pr.id}">${esc(label)}</option>`;
                        }).join('');
                        const hasProject = !!line.projectId;
                        const expenseOptions = (payrollExpenseAccounts || []).map(acc => {
                          const fullName = acc.fullName || acc.name || '';
                          if (!fullName) return '';
                          const selected = fullName === line.expenseAccountName ? ' selected' : '';
                          return `<option value="${esc(fullName)}"${selected}>${esc(fullName)}</option>`;
                        }).join('');
                        const classOptions = (payrollClasses || []).map(c => {
                          const name = c.fullName || c.name || '';
                          if (!name) return '';
                          const selected = name === (line.className || '') ? ' selected' : '';
                          return `<option value="${esc(name)}"${selected}>${esc(name)}</option>`;
                        }).join('');
                        return `
                          <tr class="custom-line-row" data-employee-id="${employeeId}" data-employee-name="${esc(employeeNameRaw)}" data-line-id="${line.id}">
                            <td><select class="line-expense-select with-arrow ${hasExpense ? '' : 'input-error'}" data-employee-id="${employeeId}" data-project-id="${line.id}" data-custom-line="true"><option value="">(select expense account)</option>${expenseOptions}</select></td>
                            <td><input type="text" class="line-desc-input ${hasDesc ? '' : 'input-error'}" data-employee-id="${employeeId}" data-project-id="${line.id}" data-custom-line="true" value="${esc(line.description || '')}" placeholder="(custom description)" /></td>
                            <td><input type="number" step="0.01" min="0" class="line-amount-input ${hasAmount ? '' : 'input-error'}" data-employee-id="${employeeId}" data-project-id="${line.id}" data-custom-line="true" value="${hasAmount ? amountVal.toFixed(2) : ''}" placeholder="0.00" /></td>
                            <td><select class="line-project-select with-arrow ${hasProject ? '' : 'input-error'}" data-employee-id="${employeeId}" data-project-id="${line.id}" data-custom-line="true"><option value="">(select customer / project)</option>${projectOptions}</select></td>
                            <td><select class="line-class-select with-arrow ${hasClass ? '' : 'input-error'}" data-employee-id="${employeeId}" data-project-id="${line.id}" data-custom-line="true"><option value="">(select class)</option>${classOptions}</select></td>
                            <td><button type="button" class="btn tertiary btn-compact btn-remove-line" data-employee-id="${employeeId}" data-line-id="${line.id}">Remove</button></td>
                          </tr>
                        `;
                      }).join('')}
                    </tbody>
                  </table>
                  <div class="payroll-add-line-wrap"><button type="button" class="btn tertiary btn-add-line" data-employee-id="${employeeId}">+ Add line item</button></div>
                ` : '<p class="line-items-empty">No line items available.</p>'}
            </div>
          </section>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
    tbody.appendChild(detailsTr);
    if (expandedBefore.has(employeeId)) {
      detailsTr.classList.remove('hidden');
      tr.classList.add('payroll-row-open');
    }
  }

  applyPayrollSummaryAccess();
}

function setupPayrollRowToggle() {
  const tbody = document.getElementById('payroll-summary-body');
  if (!tbody) return;
  tbody.addEventListener('click', e => {
    if (e.target.closest('button, input, select, textarea, label, a')) return;
    const tr = e.target.closest('tr.payroll-row');
    if (!tr) return;
    const empId = tr.dataset.employeeId;
    const detailsRow = tbody.querySelector(`tr.payroll-details-row[data-employee-id="${empId}"]`);
    if (!detailsRow) return;
    const nowHidden = detailsRow.classList.toggle('hidden');
    tr.classList.toggle('payroll-row-open', !nowHidden);
    const empIdNum = Number(empId);
    if (nowHidden) payrollExpandedRows.delete(empIdNum);
    else payrollExpandedRows.add(empIdNum);
  });
}

function setupPayrollOverrideInputs() {
  if (!isPayrollFeatureEnabled()) return;
  document.querySelectorAll('.payroll-memo-input').forEach(input => {
    const empId = input.dataset.employeeId;
    if (!empId) return;
    function updateMemo() {
      payrollOverrides[empId] = payrollOverrides[empId] || {};
      payrollOverrides[empId].employeeId = Number(empId);
      payrollOverrides[empId].memo = input.value || null;
    }
    input.addEventListener('input', updateMemo);
    input.addEventListener('change', updateMemo);
  });
  document.querySelectorAll('.line-expense-select, .line-desc-input, .line-class-select, .line-amount-input, .line-project-select').forEach(el => {
    const empId = el.dataset.employeeId;
    const projectId = el.dataset.projectId;
    const isCustom = el.dataset.customLine === 'true';
    if (!empId || !projectId) return;
    const key = isCustom ? `custom:${empId}:${projectId}` : `${empId}:${projectId}`;
    function updateOverride() {
      if (el.classList.contains('input-error')) {
        const val = el.value;
        if (val && val.trim() !== '' && !(el.type === 'number' && Number(val) <= 0)) {
          el.classList.remove('input-error');
        }
      }
      if (isCustom) {
        const lines = additionalLinesByEmployee[empId] || [];
        const idx = lines.findIndex(l => String(l.id) === String(projectId));
        if (idx >= 0) {
          const row = el.closest('tr');
          const descInput = row?.querySelector('.line-desc-input');
          const amountInput = row?.querySelector('.line-amount-input');
          const expenseSel = row?.querySelector('.line-expense-select');
          const classInput = row?.querySelector('.line-class-select');
          const projectSel = row?.querySelector('.line-project-select');
          lines[idx] = {
            ...lines[idx],
            description: descInput?.value || '',
            amount: Number(amountInput?.value || 0),
            expenseAccountName: expenseSel?.value || null,
            className: classInput?.value || null,
            projectId: projectSel?.value || null
          };
          additionalLinesByEmployee[empId] = lines;
        }
      } else {
        const row = el.closest('tr');
        if (!row) return;
        const expenseSel = row.querySelector('.line-expense-select');
        const descInput = row.querySelector('.line-desc-input');
        const classInput = row.querySelector('.line-class-select');
        const projectSel = row.querySelector('.line-project-select');
        payrollOverrides[key] = {
          employeeId: Number(empId),
          projectId: Number(projectId),
          expenseAccountName: expenseSel?.value || null,
          description: descInput?.value || null,
          className: classInput?.value || null,
          projectIdOverride: projectSel?.value || null
        };
      }
    }
    el.addEventListener('input', updateOverride);
    el.addEventListener('change', updateOverride);
  });
}

async function loadPayrollSummary(options = {}) {
  const suppressAlerts = !!options.suppressAlerts;
  if (!isPayrollFeatureEnabled()) return;
  // ensure settings (and classes) are loaded first
  if (!payrollSettingsLoaded) {
    await loadPayrollSettings();
  }
  const startInput = document.getElementById('payroll-start');
  const endInput = document.getElementById('payroll-end');
  if (!startInput?.value || !endInput?.value) setDefaultBillingCycleDates();
  const start = startInput?.value || '';
  const end = endInput?.value || '';
  if (!validatePayrollDates(start, end)) return;
  const prevRange = currentPayrollRange || {};
  currentPayrollRange = { start, end };
  payrollOverrides = {};
  if (prevRange.start !== start || prevRange.end !== end) {
    additionalLinesByEmployee = {};
    payrollExpandedRows = new Set();
    payrollSendSelections = new Set();
  }
  const includePaidCheckbox = document.getElementById('payroll-include-paid');
  const includePaid = includePaidCheckbox?.checked ? '1' : '0';
  const includeOvertime = getPayrollOvertimeSetting() ? '1' : '0';
  const includeReceiptReimbursements = getPayrollIncludeReimbursementsSetting() ? '1' : '0';
  const params = new URLSearchParams({
    start,
    end,
    includePaid,
    includeOvertime,
    includeReceiptReimbursements
  });
  const url = `/api/payroll-summary?${params.toString()}`;
  try {
    const payload = await fetchJSON(url);
    const rows = Array.isArray(payload)
      ? payload
      : (Array.isArray(payload?.rows) ? payload.rows : []);
    const pendingRows = Array.isArray(payload?.pending_approvals?.pending)
      ? payload.pending_approvals.pending
      : [];
    const pendingCount = Number(payload?.pending_approvals?.pending_count);

    currentPayrollRows = rows;
    populatePayrollTemplatePreviewSelectors();
    renderPayrollTemplatePreview();
    setPayrollPendingApprovals(pendingRows, Number.isFinite(pendingCount) ? pendingCount : pendingRows.length);
    renderPayrollSummaryTable();
    setupPayrollOverrideInputs();
    await loadPayrollReimbursements();
    if (!suppressAlerts && !currentPayrollRows.length) {
      if (currentPayrollPendingApprovalCount > 0) {
        alert(
          'No payroll-approved unpaid entries are ready yet for this date range.\n\n' +
          'Review the pending approval list and approve entries, or adjust your date range.'
        );
      } else {
        alert('No payroll-approved unpaid time entries found for this date range. Use Include Paid to review prior runs.');
      }
    }
  } catch (err) {
    console.error('[PAYROLL] loadPayrollSummary error', err);
    currentPayrollRows = [];
    populatePayrollTemplatePreviewSelectors();
    renderPayrollTemplatePreview();
    clearPayrollPendingApprovals();
    renderPayrollSummaryTable();
    await loadPayrollReimbursements();
    if (!suppressAlerts) {
      alert('Could not load payroll summary:\n\n' + buildPayrollApiErrorMessage(err));
    }
  }
}

function addCustomLine(empId) {
  if (!isPayrollFeatureEnabled()) return;
  const lines = additionalLinesByEmployee[empId] || [];
  const newId = Date.now() + '-' + Math.round(Math.random() * 1e6);
  lines.push({ id: newId, description: '', amount: 0, expenseAccountName: null, className: null });
  additionalLinesByEmployee[empId] = lines;
  payrollExpandedRows.add(Number(empId));
  renderPayrollSummaryTable();
  setupPayrollOverrideInputs();
}

function removeCustomLine(empId, lineId) {
  if (!isPayrollFeatureEnabled()) return;
  const lines = additionalLinesByEmployee[empId] || [];
  additionalLinesByEmployee[empId] = lines.filter(l => String(l.id) !== String(lineId));
  renderPayrollSummaryTable();
  setupPayrollOverrideInputs();
}

function setupCustomLineButtons() {
  if (!isPayrollFeatureEnabled()) return;
  const tbody = document.getElementById('payroll-summary-body');
  if (!tbody) return;
  tbody.addEventListener('click', e => {
    const addBtn = e.target.closest('.btn-add-line');
    if (addBtn) {
      e.stopPropagation();
      const empId = addBtn.dataset.employeeId;
      if (empId) addCustomLine(empId);
      return;
    }
    const removeBtn = e.target.closest('.btn-remove-line');
    if (removeBtn) {
      e.stopPropagation();
      const empId = removeBtn.dataset.employeeId;
      const lineId = removeBtn.dataset.lineId;
      if (empId && lineId) removeCustomLine(empId, lineId);
      return;
    }
  });
}

function refreshCurrentPayrollSettingsFromInputs() {
  const bankSelect = document.getElementById('payroll-bank-account');
  const expenseSelect = document.getElementById('payroll-expense-account');
  const receiptExpenseSelect = document.getElementById('payroll-receipt-expense-account');
  const receiptClassSelect = document.getElementById('payroll-receipt-class');
  const memoInput = document.getElementById('payroll-memo-template');
  const lineDescInput = document.getElementById('payroll-line-desc-template');
  currentPayrollSettings.bank_account_name =
    bankSelect ? (bankSelect.value || currentPayrollSettings.bank_account_name) : currentPayrollSettings.bank_account_name;
  currentPayrollSettings.expense_account_name =
    expenseSelect ? (expenseSelect.value || currentPayrollSettings.expense_account_name) : currentPayrollSettings.expense_account_name;
  currentPayrollSettings.receipt_expense_account_name =
    receiptExpenseSelect
      ? (receiptExpenseSelect.value || currentPayrollSettings.receipt_expense_account_name)
      : currentPayrollSettings.receipt_expense_account_name;
  currentPayrollSettings.receipt_class_name =
    receiptClassSelect ? (receiptClassSelect.value || currentPayrollSettings.receipt_class_name) : currentPayrollSettings.receipt_class_name;
  currentPayrollSettings.default_memo = memoInput ? (memoInput.value || null) : null;
  currentPayrollSettings.line_description_template = lineDescInput ? (lineDescInput.value || null) : null;
}

function buildRetryOverridesForEmployeeIds(employeeIds = []) {
  const targetIds = new Set((employeeIds || []).map(Number).filter(Number.isFinite));
  return Object.entries(payrollOverrides || {})
    .map(([key, ov]) => ({
      employeeId: Number(ov?.employeeId || key.split(':')[0]),
      expenseAccountName: ov?.expenseAccountName || null,
      memo: ov?.memo || null,
      lineDescriptionTemplate: ov?.lineDescriptionTemplate || null
    }))
    .filter(o => o.employeeId && targetIds.has(o.employeeId));
}

async function retryPayrollEmployees(options = {}) {
  const {
    start,
    end,
    payrollRunId,
    failedEmployeeIds = [],
    runType = 'standard',
    adjustmentReason = null,
    includeOvertime = true,
    includeReceiptReimbursements = getPayrollIncludeReimbursementsSetting(),
    sourceLabel = 'retry'
  } = options;

  if (!canModifyPayrollReports()) {
    alert('Payroll section is disabled or your permissions are insufficient.');
    return;
  }
  if (!validatePayrollDates(start, end)) return;
  const normalizedRunId = Number(payrollRunId);
  if (!normalizedRunId) {
    alert('Cannot retry: no payroll run ID is available.');
    return;
  }
  const employeeIds = [...new Set((failedEmployeeIds || []).map(Number).filter(Number.isFinite))];
  if (!employeeIds.length) {
    alert('There are no failed employees selected to retry.');
    return;
  }
  if (runType === 'adjustment' && !adjustmentReason) {
    alert('Adjustment reason is required for an adjustment payroll retry.');
    return;
  }

  refreshCurrentPayrollSettingsFromInputs();
  const overrides = buildRetryOverridesForEmployeeIds(employeeIds);
  const payload = {
    start,
    end,
    bankAccountName: currentPayrollSettings.bank_account_name || null,
    expenseAccountName: currentPayrollSettings.expense_account_name || null,
    receiptExpenseAccountName: currentPayrollSettings.receipt_expense_account_name || null,
    memo: currentPayrollSettings.default_memo || null,
    lineDescriptionTemplate: currentPayrollSettings.line_description_template || null,
    includeOvertime,
    includeReceiptReimbursements,
    overrides,
    isRetry: true,
    originalPayrollRunId: normalizedRunId,
    onlyEmployeeIds: employeeIds,
    run_type: runType,
    adjustment_reason: adjustmentReason || null
  };

  const createBtn = document.getElementById('payroll-create-checks');
  const retryBtn = document.getElementById('payroll-retry-failed');
  if (createBtn) createBtn.disabled = true;
  if (retryBtn) retryBtn.disabled = true;

  const preflightData = await runPayrollPreflightWithConfirm(payload, {
    mode: 'retry',
    start,
    end,
    runType,
    adjustmentReason,
    failedEmployeeIds: employeeIds
  });
  if (!preflightData) {
    if (createBtn) createBtn.disabled = false;
    if (retryBtn) retryBtn.disabled = false;
    updatePayrollRunReviewRetryButtonState();
    return;
  }

  const basePayload = { ...payload };
  let createPayload = {
    ...payload,
    preflight_id: preflightData.preflight_id,
    payload_hash: preflightData.payload_hash
  };
  let conflictAttempts = 0;

  while (true) {
    let data = null;
    let callErr = null;
    try {
      showPayrollLoading();
      data = await fetchJSON('/api/payroll/create-checks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createPayload)
      });
    } catch (err) {
      callErr = err;
    } finally {
      hidePayrollLoading();
    }

    if (callErr) {
      const body = callErr && callErr.body ? callErr.body : null;
      if (callErr.status === 409 && body && body.snapshot_hash && conflictAttempts < 1) {
        data = body;
      } else {
        console.error(`Error calling /api/payroll/create-checks (${sourceLabel}):`, callErr);
        const msg = 'There was a problem contacting the server while retrying failed checks.\n\n' +
          buildPayrollApiErrorMessage(callErr);
        await showPayrollRunReviewNotice(msg, {
          isError: true,
          runId: lastPayrollRunId || normalizedRunId,
          preserveSelection: true,
          scrollIntoView: true,
          fallbackAlert: true
        });
        if (retryBtn) retryBtn.disabled = false;
        if (createBtn) createBtn.disabled = false;
        updatePayrollRunReviewRetryButtonState();
        return;
      }
    }

    if (data && data.snapshot_hash && conflictAttempts < 1) {
      const retryPreflight = confirm(
        'Time entries changed since preflight. Re-run preflight and try again?'
      );
      if (!retryPreflight) {
        if (createBtn) createBtn.disabled = false;
        if (retryBtn) retryBtn.disabled = false;
        updatePayrollRunReviewRetryButtonState();
        return;
      }

      const refreshed = await runPayrollPreflightWithConfirm(basePayload, {
        mode: 'retry',
        start,
        end,
        runType,
        adjustmentReason,
        failedEmployeeIds: employeeIds
      });
      if (!refreshed) {
        if (createBtn) createBtn.disabled = false;
        if (retryBtn) retryBtn.disabled = false;
        updatePayrollRunReviewRetryButtonState();
        return;
      }
      createPayload = {
        ...basePayload,
        preflight_id: refreshed.preflight_id,
        payload_hash: refreshed.payload_hash
      };
      conflictAttempts += 1;
      continue;
    }

    lastPayrollResults = data.results || null;
    lastPayrollRunId = data.payrollRunId || normalizedRunId;
    lastPayrollRunStatus = data.status || null;
    lastPayrollRunType = runType;
    lastPayrollAdjustmentReason = adjustmentReason;
    const backupWarnings = Array.isArray(data.warnings) ? data.warnings : [];

    if (!data.ok) {
      let msg = data.error || data.reason || 'Unknown error retrying checks.';
      if (data.fatal_qbo_error) {
        msg += `\n\nFatal QuickBooks error:\n${data.fatal_qbo_error}`;
      }
      if (backupWarnings.length) {
        msg += '\n\nBackup warnings:\n' + backupWarnings.map(w => `• ${w.message || 'Backup warning'}`).join('\n');
      }
      await showPayrollRunReviewNotice(msg, {
        isError: true,
        runId: lastPayrollRunId || normalizedRunId,
        preserveSelection: false,
        scrollIntoView: true,
        fallbackAlert: true
      });
      if (retryBtn) retryBtn.disabled = !(data.results || []).some(r => r && r.ok === false);
      break;
    }

    const results = Array.isArray(data.results) ? data.results : [];
    const failedAgain = results.filter(r => r && r.ok === false);
    const succeeded = results.filter(r => r && r.ok !== false);
    const warnings = collectPayrollWarnings(results);
    const statusLabel = data.status ? String(data.status).toUpperCase() : null;
    let msg = `Retry complete. ${succeeded.length} succeeded, ${failedAgain.length} failed.`;
    if (statusLabel) msg += `\nStatus: ${statusLabel}`;
    if (warnings.length) msg += `\n${warnings.length} discrepancy warning(s) were returned.`;
    if (backupWarnings.length) {
      msg += '\n\nBackup warnings:\n' + backupWarnings.map(w => `• ${w.message || 'Backup warning'}`).join('\n');
    }
    await showPayrollRunReviewNotice(msg, {
      isError: failedAgain.length > 0 || !!data.fatal_qbo_error,
      runId: lastPayrollRunId || normalizedRunId,
      preserveSelection: false,
      scrollIntoView: true,
      fallbackAlert: true
    });
    if (retryBtn) retryBtn.disabled = !failedAgain.length;
    if (
      typeof loadPayrollSummary === 'function' &&
      currentPayrollRange &&
      currentPayrollRange.start === start &&
      currentPayrollRange.end === end
    ) {
      loadPayrollSummary();
    }
    break;
  }

  if (createBtn) createBtn.disabled = false;
  updatePayrollRunReviewRetryButtonState();
}

async function createChecksForCurrentRange() {
  if (!canModifyPayrollReports()) {
    alert('Payroll section is disabled or your permissions are insufficient.');
    return;
  }
  if (!Array.isArray(currentPayrollRows) || !currentPayrollRows.length) {
    alert('No payroll-approved unpaid time entries are loaded for this date range.');
    return;
  }
  const { start, end } = currentPayrollRange || {};
  if (!validatePayrollDates(start, end)) return;
  const adjustmentSettings = getPayrollAdjustmentSettings();
  if (adjustmentSettings.enabled && !adjustmentSettings.reason) {
    alert('Adjustment reason is required for an adjustment payroll run.');
    return;
  }
  refreshCurrentPayrollSettingsFromInputs();
  const checkboxRows = Array.from(document.querySelectorAll('.payroll-send-checkbox'));
  const selectedEmployeeIds = new Set(
    checkboxRows
      .filter(cb => cb.checked)
      .map(cb => Number(cb.dataset.employeeId))
      .filter(Number.isFinite)
  );
  const unchecked = checkboxRows
    .filter(cb => !cb.checked)
    .map(cb => Number(cb.dataset.employeeId))
    .filter(Number.isFinite);
  const overridesArray = [];
  const lineOverrides = [];
  Object.entries(payrollOverrides || {}).forEach(([key, ov]) => {
    if (!ov) return;
    if (key.includes(':')) {
      const [empIdRaw, projectIdRaw] = key.split(':');
      const empId = Number(empIdRaw);
      if (!empId || !projectIdRaw) return;
      if (!selectedEmployeeIds.has(empId)) return;
      lineOverrides.push({
        employeeId: empId,
        projectId: projectIdRaw,
        expenseAccountName: ov.expenseAccountName || null,
        description: ov.description || null,
        className: ov.className || null,
        isCustom: ov.isCustom || false
      });
    } else {
      const empId = Number(ov.employeeId || key);
      if (!empId) return;
      if (!selectedEmployeeIds.has(empId)) return;
      overridesArray.push({
        employeeId: empId,
        expenseAccountName: ov.expenseAccountName || null,
        memo: ov.memo || null,
        lineDescriptionTemplate: ov.lineDescriptionTemplate || null
      });
    }
  });
  const customLines = Object.entries(additionalLinesByEmployee || {}).flatMap(([empId, lines]) => {
    if (!selectedEmployeeIds.has(Number(empId))) return [];
    return (lines || [])
      .filter(l => Number(l.amount) > 0)
      .map(l => ({
        employeeId: Number(empId),
        description: l.description || '',
        amount: Number(l.amount),
        expenseAccountName: l.expenseAccountName || null,
        className: l.className || null,
        projectId: l.projectId || null
      }));
  });
  // Basic pre-flight validation
  const errors = [];
  if (!selectedEmployeeIds.size) {
    errors.push('Select at least one employee with "Send to QB" before creating checks.');
  }
  const classNames = new Set((payrollClasses || []).map(c => c.fullName || c.name).filter(Boolean));
  if (selectedEmployeeIds.size && !currentPayrollSettings.bank_account_name) {
    errors.push('Bank account is not selected in payroll settings.');
  }
  if (selectedEmployeeIds.size && !currentPayrollSettings.expense_account_name) {
    errors.push('Expense account is not selected in payroll settings.');
  }
  const missingLines = [];
  // clear previous highlights
  document.querySelectorAll('#payroll-summary-body .line-items-box .input-error').forEach(el => {
    el.classList.remove('input-error');
  });
  const debugLines = [];
  document.querySelectorAll('#payroll-summary-body .line-items-box tr').forEach(row => {
    const empId = row.dataset.employeeId || row.closest('tr')?.dataset.employeeId || '';
    const empIdNum = Number(empId);
    if (!Number.isFinite(empIdNum) || !selectedEmployeeIds.has(empIdNum)) return;
    const empName = row.dataset.employeeName || '';
    const projectSel = row.querySelector('.line-project-select');
    const projectLabelCell = (!projectSel && row.children[3] && row.children[3].dataset) ? row.children[3] : null;
    const expenseEl = row.querySelector('.line-expense-select');
    const descEl = row.querySelector('.line-desc-input');
    const classEl = row.querySelector('.line-class-select');
    const amountEl = row.querySelector('.line-amount-input');
    const isCustom = row.classList.contains('custom-line-row') || row.dataset.lineId;
    // Skip header/placeholder rows that have no inputs/selects at all
    if (!expenseEl && !descEl && !classEl && !amountEl && !projectSel) return;
    let projectVal = projectSel?.value || '';
    if (!projectVal && projectLabelCell && projectLabelCell.dataset.projectId) {
      projectVal = projectLabelCell.dataset.projectId || '';
    }
    const expense = expenseEl?.value || '';
    const desc = descEl?.value || '';
    const cls = classEl?.value || '';
    const amountVal = amountEl ? Number(amountEl.value) : null;
    const needsAmount = !!amountEl;
    const amountOk = needsAmount ? Number.isFinite(amountVal) && amountVal > 0 : true;
    const allEmptyCustom = isCustom && !expense && !desc && !cls && (!amountEl || amountEl.value === '' || Number(amountEl.value) === 0) && (!projectVal);
    if (allEmptyCustom) return; // ignore totally blank custom rows
    const classKnown = cls ? classNames.has(cls) : false;
    if (!expense || !desc || !cls || !amountOk || (projectSel && !projectVal) || (cls && !classKnown)) {
      const projLabel = row.querySelector('td:nth-child(4)')?.textContent?.trim() || '(project)';
      debugLines.push({ empId, projLabel, expense, desc, cls, amount: amountEl?.value || '', projectVal, isCustom });
      if (projectSel && !projectVal) projectSel.classList.add('input-error');
      if (!expense && expenseEl) expenseEl.classList.add('input-error');
      if (!desc && descEl) descEl.classList.add('input-error');
      if (!cls && classEl) classEl.classList.add('input-error');
      if (cls && !classKnown && classEl) classEl.classList.add('input-error');
      if (!amountOk && amountEl) amountEl.classList.add('input-error');
      missingLines.push(`${empName || 'Employee ' + empId} / ${projLabel} missing ${[
        projectSel && !projectVal ? 'customer/project' : '',
        !expense ? 'expense' : '',
        !desc ? 'description' : '',
        !cls ? 'class' : (!classKnown ? 'class (no matching QBO class)' : ''),
        !amountOk ? 'amount' : ''
      ].filter(Boolean).join(', ')}`);
    }
  });
  if (debugLines.length) {
    console.warn('[PAYROLL VALIDATION] Missing line data:', debugLines);
  }
  if (missingLines.length) errors.push('Line items incomplete:\n' + missingLines.join('\n'));
  if (errors.length) {
    alert('Please fix the following before creating checks:\n\n' + errors.join('\n'));
    return;
  }

  // All good → show loading
  const runType = adjustmentSettings.enabled ? 'adjustment' : 'standard';
  const adjustmentReason = adjustmentSettings.enabled ? adjustmentSettings.reason : null;
  const includeOvertime = getPayrollOvertimeSetting();
  const includeReceiptReimbursements = getPayrollIncludeReimbursementsSetting();
  const payload = {
    start,
    end,
    bankAccountName: currentPayrollSettings.bank_account_name || null,
    expenseAccountName: currentPayrollSettings.expense_account_name || null,
    receiptExpenseAccountName: currentPayrollSettings.receipt_expense_account_name || null,
    memo: currentPayrollSettings.default_memo || null,
    lineDescriptionTemplate: currentPayrollSettings.line_description_template || null,
    includeOvertime,
    includeReceiptReimbursements,
    overrides: overridesArray,
    customLines,
    lineOverrides,
    excludeEmployeeIds: unchecked,
    isRetry: false,
    originalPayrollRunId: null,
    onlyEmployeeIds: [],
    run_type: runType,
    adjustment_reason: adjustmentReason
  };
  const createBtn = document.getElementById('payroll-create-checks');
  const retryBtn = document.getElementById('payroll-retry-failed');
  if (createBtn) createBtn.disabled = true;
  if (retryBtn) retryBtn.disabled = true;

  const preflightData = await runPayrollPreflightWithConfirm(payload, {
    mode: 'create',
    start,
    end,
    runType,
    adjustmentReason
  });
  if (!preflightData) {
    if (createBtn) createBtn.disabled = false;
    if (retryBtn) retryBtn.disabled = false;
    return;
  }

  const basePayload = { ...payload };
  let createPayload = {
    ...payload,
    preflight_id: preflightData.preflight_id,
    payload_hash: preflightData.payload_hash
  };
  let conflictAttempts = 0;

  while (true) {
    let data = null;
    let callErr = null;
    try {
      showPayrollLoading();
      data = await fetchJSON('/api/payroll/create-checks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createPayload)
      });
    } catch (err) {
      callErr = err;
    } finally {
      hidePayrollLoading();
    }

    if (callErr) {
      const body = callErr && callErr.body ? callErr.body : null;
      if (callErr.status === 409 && body && body.snapshot_hash && conflictAttempts < 1) {
        data = body;
      } else {
        console.error('Error calling /api/payroll/create-checks:', callErr);
        const msg = 'There was a problem contacting the server while creating checks.\n\n' +
          buildPayrollApiErrorMessage(callErr);
        await showPayrollRunReviewNotice(msg, {
          isError: true,
          runId: lastPayrollRunId || null,
          preserveSelection: true,
          scrollIntoView: true,
          fallbackAlert: true
        });
        if (retryBtn) retryBtn.disabled = false;
        if (createBtn) createBtn.disabled = false;
        return;
      }
    }

    if (data && data.snapshot_hash && conflictAttempts < 1) {
      const retryPreflight = confirm(
        'Time entries changed since preflight. Re-run preflight and try again?'
      );
      if (!retryPreflight) {
        if (createBtn) createBtn.disabled = false;
        if (retryBtn) retryBtn.disabled = false;
        return;
      }

      const refreshed = await runPayrollPreflightWithConfirm(basePayload, {
        mode: 'create',
        start,
        end,
        runType,
        adjustmentReason
      });
      if (!refreshed) {
        if (createBtn) createBtn.disabled = false;
        if (retryBtn) retryBtn.disabled = false;
        return;
      }
      createPayload = {
        ...basePayload,
        preflight_id: refreshed.preflight_id,
        payload_hash: refreshed.payload_hash
      };
      conflictAttempts += 1;
      continue;
    }

    lastPayrollResults = data.results || null;
    lastPayrollRunId = data.payrollRunId || null;
    lastPayrollRunStatus = data.status || null;
    lastPayrollRunType = runType;
    lastPayrollAdjustmentReason = adjustmentReason;
    const backupWarnings = Array.isArray(data.warnings) ? data.warnings : [];
    if (!data.ok) {
      let msg = data.error || data.reason || 'Unknown error creating checks.';
      if (data.fatal_qbo_error) msg += `\n\nFatal QuickBooks error:\n${data.fatal_qbo_error}`;
      if (backupWarnings.length) {
        msg += '\n\nBackup warnings:\n' + backupWarnings.map(w => `• ${w.message || 'Backup warning'}`).join('\n');
      }
      await showPayrollRunReviewNotice(msg, {
        isError: true,
        runId: lastPayrollRunId || null,
        preserveSelection: false,
        scrollIntoView: true,
        fallbackAlert: true
      });
      if (retryBtn) retryBtn.disabled = !(data.results || []).some(r => r && r.ok === false);
      break;
    }
    const results = Array.isArray(data.results) ? data.results : [];
    const failed = results.filter(r => r && r.ok === false);
    const okList = results.filter(r => r && r.ok !== false);
    const warnings = collectPayrollWarnings(results);
    const statusLabel = data.status ? String(data.status).toUpperCase() : null;
    let msg = `Create checks complete: ${okList.length} succeeded, ${failed.length} failed.`;
    msg += `\nPayroll run ID: ${data.payrollRunId || '(none)'}`;
    if (statusLabel) msg += `\nStatus: ${statusLabel}`;
    if (failed.length) msg += '\nUse Payroll Run Review to fix and retry only failed checks.';
    if (warnings.length) msg += `\n${warnings.length} discrepancy warning(s) were returned.`;
    if (backupWarnings.length) {
      msg += '\n\nBackup warnings:\n' + backupWarnings.map(w => `• ${w.message || 'Backup warning'}`).join('\n');
    }
    if (data.fatal_qbo_error) msg += `\n\nFatal QuickBooks error:\n${data.fatal_qbo_error}`;
    await showPayrollRunReviewNotice(msg, {
      isError: failed.length > 0 || !!data.fatal_qbo_error,
      runId: lastPayrollRunId || null,
      preserveSelection: false,
      scrollIntoView: true,
      fallbackAlert: true
    });
    if (retryBtn) retryBtn.disabled = !failed.length;
    if (typeof loadPayrollSummary === 'function') loadPayrollSummary();
    break;
  }

  if (createBtn) createBtn.disabled = false;
  updatePayrollRunReviewRetryButtonState();
}

async function retryFailedChecksForCurrentRun() {
  const failed = Array.isArray(lastPayrollResults)
    ? lastPayrollResults.filter(r => r && r.ok === false && r.employeeId)
    : [];
  if (!failed.length) {
    alert('There are no failed employees to retry.');
    return;
  }
  const failedEmployeeIds = [...new Set(failed.map(f => Number(f.employeeId)).filter(Number.isFinite))];
  const adjustmentSettings = getPayrollAdjustmentSettings();
  const runType =
    lastPayrollRunType ||
    (adjustmentSettings.enabled ? 'adjustment' : 'standard');
  const adjustmentReason =
    runType === 'adjustment'
      ? (lastPayrollAdjustmentReason || adjustmentSettings.reason)
      : null;
  const { start, end } = currentPayrollRange || {};
  const reviewRun = currentPayrollRunReview?.run || null;
  const retryStart = reviewRun?.start_date || start;
  const retryEnd = reviewRun?.end_date || end;
  const includeOvertime =
    reviewRun && Object.prototype.hasOwnProperty.call(reviewRun, 'include_overtime')
      ? !!reviewRun.include_overtime
      : getPayrollOvertimeSetting();

  await retryPayrollEmployees({
    start: retryStart,
    end: retryEnd,
    payrollRunId: reviewRun?.id || lastPayrollRunId,
    failedEmployeeIds,
    runType,
    adjustmentReason,
    includeOvertime,
    sourceLabel: 'retry-button'
  });
}

async function retrySelectedFailedChecksFromReview() {
  if (!currentPayrollRunReview || !currentPayrollRunReview.run) {
    alert('Load a payroll run review first.');
    return;
  }
  const run = currentPayrollRunReview.run;
  const selectedEmployeeIds = getPayrollReviewSelectedFailedEmployeeIds();
  if (!selectedEmployeeIds.length) {
    alert('Select at least one failed employee to retry.');
    return;
  }
  await retryPayrollEmployees({
    start: run.start_date,
    end: run.end_date,
    payrollRunId: run.id,
    failedEmployeeIds: selectedEmployeeIds,
    runType: run.run_type || 'standard',
    adjustmentReason: run.adjustment_reason || null,
    includeOvertime: !!run.include_overtime,
    sourceLabel: 'run-review'
  });
}

function setupPayrollRunReviewActions() {
  const els = getPayrollRunReviewElements();
  if (!els.wrap || els.wrap.dataset.bound) return;
  els.wrap.dataset.bound = '1';

  if (els.loadPeriodBtn) {
    els.loadPeriodBtn.addEventListener('click', async () => {
      const run = currentPayrollRunReview?.run;
      if (!run) return;
      const startInput = document.getElementById('payroll-start');
      const endInput = document.getElementById('payroll-end');
      if (startInput) startInput.value = run.start_date || '';
      if (endInput) endInput.value = run.end_date || '';
      currentPayrollRange = { start: run.start_date || null, end: run.end_date || null };
      try {
        await loadPayrollSummary();
      } catch (err) {
        console.warn('Failed loading payroll summary for run-review period:', err);
      }
    });
  }

  if (els.refreshBtn) {
    els.refreshBtn.addEventListener('click', async () => {
      const runId = Number(currentPayrollRunReview?.run?.id);
      try {
        if (runId) {
          await loadPayrollRunReviewById(runId, { preserveSelection: true, scrollIntoView: false });
        } else {
          await loadLatestUnresolvedPayrollRunReview({ allowHide: false });
        }
      } catch (err) {
        console.warn('Failed refreshing payroll run review:', err);
        setPayrollRunReviewAlert(err?.message || 'Failed to refresh run review.', true);
      }
    });
  }

  if (els.retryBtn) {
    els.retryBtn.addEventListener('click', retrySelectedFailedChecksFromReview);
  }
}

function setupPayrollActions() {
  if (!isPayrollFeatureEnabled()) return;
  const createBtn = document.getElementById('payroll-create-checks');
  const retryBtn = document.getElementById('payroll-retry-failed');
  if (createBtn) createBtn.addEventListener('click', createChecksForCurrentRange);
  if (retryBtn) retryBtn.addEventListener('click', retryFailedChecksForCurrentRun);
  const tbody = document.getElementById('payroll-summary-body');
  if (tbody) {
    tbody.addEventListener('change', e => {
      const cb = e.target.closest('.payroll-send-checkbox');
      if (!cb) return;
      const empId = Number(cb.dataset.employeeId);
      if (!Number.isFinite(empId)) return;
      if (cb.checked) payrollSendSelections.add(empId);
      else payrollSendSelections.delete(empId);
    });
    tbody.addEventListener('click', async e => {
      const btn = e.target.closest('.btn-unpay');
      if (!btn) return;
      e.stopPropagation();
      const empId = Number(btn.dataset.employeeId);
      const payrollRunId = Number(btn.dataset.payrollRunId) || lastPayrollRunId || null;
      if (!empId || !payrollRunId) {
        alert('Select a payroll run before marking unpaid.');
        return;
      }
      const reason = prompt('Reason for marking unpaid (optional):', 'manual unpay');
      if (reason === null) return;
      try {
        const data = await fetchJSON('/api/payroll/unpay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payrollRunId, employeeId: empId, reason })
        });
        if (data && data.ok === false) {
          throw new Error(data.error || 'Failed to mark unpaid.');
        }
        alert('Marked unpaid. Reloading payroll summary.');
        if (typeof loadPayrollSummary === 'function') loadPayrollSummary();
        if (payrollRunId) {
          loadPayrollRunReviewById(payrollRunId, { preserveSelection: true })
            .catch(err => {
              console.warn('Failed to refresh payroll run review after unpay:', err);
            });
        }
      } catch (err) {
        console.error('Unpay error:', err);
        alert('Failed to mark unpaid: ' + (err.message || err));
      }
    });
  }
}

function initPayrollUiTab() {
  if (!isPayrollFeatureEnabled()) {
    window.payrollUiInitialized = true;
    return;
  }
  if (window.payrollUiInitialized) return;
  window.payrollUiInitialized = true;
  setupPayrollSettingsCollapse();
  setupPayrollTemplateHelpToggle();
  setupPayrollTemplateTagPalettes();
  setupPayrollTemplatePreviewBindings();
  setupPayrollRowToggle();
  setupViewTimeEntriesButtons();
  setupPayrollPendingApprovalsBannerActions();
  bindInlineTimeEntryEditor();
  setupCustomLineButtons();
  setupPayrollReimbursements();
  setupPayrollRunReviewActions();
  const settingsSaveBtn = document.getElementById('payroll-settings-save');
  if (settingsSaveBtn) settingsSaveBtn.addEventListener('click', savePayrollSettings);
  const refreshBtn = document.getElementById('payroll-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', loadPayrollSummary);
  const includeReimbursementsCheckbox = document.getElementById('payroll-include-reimbursements');
  if (includeReimbursementsCheckbox && !includeReimbursementsCheckbox.dataset.bound) {
    includeReimbursementsCheckbox.dataset.bound = '1';
    includeReimbursementsCheckbox.addEventListener('change', () => {
      if (currentPayrollRange?.start && currentPayrollRange?.end) {
        loadPayrollSummary();
      }
    });
  }
  const adjustmentToggle = document.getElementById('payroll-adjustment-toggle');
  if (adjustmentToggle) {
    adjustmentToggle.addEventListener('change', updatePayrollAdjustmentUI);
    updatePayrollAdjustmentUI();
  }
  setDefaultBillingCycleDates();
  ensurePayrollReimbursementDateDefault();
  loadPayrollSettings()
    .then(() => loadPayrollReimbursements())
    .catch(err => {
      console.warn('Failed to initialize payroll settings/reimbursements:', err);
    });
  applyPayrollSettingsAccess();
  setupPayrollActions();
  loadLatestUnresolvedPayrollRunReview()
    .catch(err => {
      console.warn('Failed to load latest unresolved payroll run review:', err);
    });
}

// Expose for nav hook in app.js
window.initPayrollUiTab = initPayrollUiTab;
window.openPayrollRunReviewById = async (runId, options = {}) => {
  if (typeof window.initPayrollUiTab === 'function') {
    window.initPayrollUiTab();
  }
  return loadPayrollRunReviewById(runId, {
    preserveSelection: false,
    scrollIntoView: true,
    ...options
  });
};
window.loadLatestUnresolvedPayrollRunReview = loadLatestUnresolvedPayrollRunReview;

// Simple loading overlay helpers
function showPayrollLoading() {
  let overlay = document.getElementById('payroll-loading');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'payroll-loading';
    overlay.innerHTML = '<div class="spinner"></div><div class="spinner-text">Creating checks...</div>';
    document.body.appendChild(overlay);
  }
  overlay.classList.remove('hidden');
}

function hidePayrollLoading() {
  const overlay = document.getElementById('payroll-loading');
  if (overlay) overlay.classList.add('hidden');
}

function updatePayrollRunDetailsCache(runId, checkId, updates = {}) {
  const list = payrollRunDetailsCache[runId];
  if (!Array.isArray(list)) return;
  const target = list.find(row => Number(row.id) === Number(checkId));
  if (!target) return;
  if (Object.prototype.hasOwnProperty.call(updates, 'check_number')) {
    target.check_number = updates.check_number;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'paid')) {
    target.paid = updates.paid ? 1 : 0;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'paid_date')) {
    target.paid_date = updates.paid_date;
  }
}

async function patchPayrollCheck(checkId, updates) {
  return fetchJSON(`/api/reports/checks/${checkId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
}

function buildPayrollRunSummary(run) {
  if (!run) return '';
  const period = `${formatDateUS(run.start_date)} - ${formatDateUS(run.end_date)}`;
  const status = formatPayrollRunStatus(run.status);
  const type = formatPayrollRunType(run.run_type, run.adjustment_reason);
  let text = `Selected run: ${period}.`;
  if (status) text += ` Status: ${status}.`;
  if (type) text += ` Type: ${type}.`;
  if (run.last_error) text += ` Last error: ${run.last_error}`;
  return text;
}

function normalizeRunStatusFilter(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeRunTypeFilter(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'standard';
  return raw;
}

function getPayrollRunFiltersFromUi() {
  const start = document.getElementById('reports-runs-filter-start')?.value || '';
  const end = document.getElementById('reports-runs-filter-end')?.value || '';
  const status = document.getElementById('reports-runs-filter-status')?.value || '';
  const runType = document.getElementById('reports-runs-filter-type')?.value || '';
  return {
    start,
    end,
    status: normalizeRunStatusFilter(status),
    runType: String(runType || '').trim().toLowerCase()
  };
}

function resetPayrollRunFiltersInUi() {
  const start = document.getElementById('reports-runs-filter-start');
  const end = document.getElementById('reports-runs-filter-end');
  const status = document.getElementById('reports-runs-filter-status');
  const runType = document.getElementById('reports-runs-filter-type');
  if (start) start.value = '';
  if (end) end.value = '';
  if (status) status.value = '';
  if (runType) runType.value = '';
}

function getPayrollCheckFiltersFromUi() {
  const employee = document.getElementById('reports-checks-filter-employee')?.value || '';
  const paid = document.getElementById('reports-checks-filter-paid')?.value || '';
  return {
    employee: employee.trim().toLowerCase(),
    paid: String(paid || '').trim().toLowerCase()
  };
}

function resetPayrollCheckFiltersInUi() {
  const employee = document.getElementById('reports-checks-filter-employee');
  const paid = document.getElementById('reports-checks-filter-paid');
  if (employee) employee.value = '';
  if (paid) paid.value = '';
}

function refreshPayrollRunStatusFilterOptions(runs = []) {
  const statusSelect = document.getElementById('reports-runs-filter-status');
  if (!statusSelect) return;
  const selectedStatus = payrollReportRunFilters.status || '';
  const statuses = Array.from(
    new Set(
      (Array.isArray(runs) ? runs : [])
        .map(run => normalizeRunStatusFilter(run?.status))
        .filter(Boolean)
    )
  ).sort();
  statusSelect.innerHTML = '<option value="">All statuses</option>';
  statuses.forEach(status => {
    const opt = document.createElement('option');
    opt.value = status;
    opt.textContent = formatPayrollRunStatus(status) || status;
    statusSelect.appendChild(opt);
  });
  if (selectedStatus && statuses.includes(selectedStatus)) {
    statusSelect.value = selectedStatus;
  } else if (selectedStatus && !statuses.includes(selectedStatus)) {
    payrollReportRunFilters.status = '';
    statusSelect.value = '';
  }
}

function filterPayrollRunsByFilters(runs = [], filters = {}) {
  const start = String(filters.start || '').trim();
  const end = String(filters.end || '').trim();
  const status = normalizeRunStatusFilter(filters.status || '');
  const runType = String(filters.runType || '').trim().toLowerCase();

  return (Array.isArray(runs) ? runs : []).filter(run => {
    const runStart = String(run?.start_date || '').slice(0, 10);
    const runEnd = String(run?.end_date || '').slice(0, 10);
    const runStatus = normalizeRunStatusFilter(run?.status);
    const rowRunType = normalizeRunTypeFilter(run?.run_type);

    if (start && (!runStart || runStart < start)) return false;
    if (end && (!runEnd || runEnd > end)) return false;
    if (status && runStatus !== status) return false;
    if (runType && rowRunType !== runType) return false;
    return true;
  });
}

function filterPayrollChecksByFilters(rows = [], filters = {}) {
  const employeeNeedle = String(filters.employee || '').trim().toLowerCase();
  const paidFilter = String(filters.paid || '').trim().toLowerCase();

  return (Array.isArray(rows) ? rows : []).filter(row => {
    const name = String(row?.employee_name || '').toLowerCase();
    const isPaid = row?.paid === 1 || row?.paid === true;
    if (employeeNeedle && !name.includes(employeeNeedle)) return false;
    if (paidFilter === 'paid' && !isPaid) return false;
    if (paidFilter === 'unpaid' && isPaid) return false;
    return true;
  });
}

function setPayrollRunDetailsPlaceholder(message) {
  const tbody = document.getElementById('reports-details-body');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6">${escapeHTML(message)}</td></tr>`;
}

function renderPayrollRunDetailsRows(runId, rows = []) {
  const tbody = document.getElementById('reports-details-body');
  const downloadBtn = document.getElementById('reports-download');
  if (!tbody) return;

  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    setPayrollRunDetailsPlaceholder('(no checks found for this run)');
    if (downloadBtn) downloadBtn.disabled = true;
    return;
  }

  const filtered = filterPayrollChecksByFilters(list, payrollReportCheckFilters);
  if (!filtered.length) {
    setPayrollRunDetailsPlaceholder('(no checks match current filters)');
    if (downloadBtn) downloadBtn.disabled = false;
    return;
  }

  const canEdit = canModifyPayrollReports();
  tbody.innerHTML = '';
  filtered.forEach(row => {
    const tr = document.createElement('tr');
    const paidValue = row.paid === 1 || row.paid === true;
    const paidDateLabel = row.paid_date ? formatDateUS(row.paid_date) : '';
    if (canEdit) {
      tr.innerHTML = `
        <td>${escapeHTML(row.employee_name || '')}</td>
        <td>${escapeHTML(Number(row.total_hours || 0).toFixed(2))}</td>
        <td>${escapeHTML(formatMoney(Number(row.total_pay || 0)))}</td>
        <td>
          <input type="text" class="reports-check-input" value="${escapeHTML(row.check_number || '')}" />
        </td>
        <td>${escapeHTML(paidDateLabel)}</td>
        <td>
          <input type="checkbox" class="reports-paid-toggle" ${paidValue ? 'checked' : ''} />
        </td>
      `;

      const checkInput = tr.querySelector('.reports-check-input');
      const paidToggle = tr.querySelector('.reports-paid-toggle');
      if (checkInput) {
        checkInput.dataset.original = row.check_number || '';
        checkInput.addEventListener('keydown', e => {
          if (e.key === 'Enter') checkInput.blur();
        });
        checkInput.addEventListener('change', async () => {
          const nextValue = checkInput.value.trim();
          const original = checkInput.dataset.original || '';
          if (nextValue === original) return;
          checkInput.disabled = true;
          try {
            await patchPayrollCheck(row.id, { check_number: nextValue || null });
            checkInput.dataset.original = nextValue;
            row.check_number = nextValue || null;
            updatePayrollRunDetailsCache(runId, row.id, { check_number: nextValue || null });
            setReportsMessage('Check number updated.');
          } catch (err) {
            console.error('Failed updating check number:', err);
            checkInput.value = original;
            setReportsMessage('Failed to update check number: ' + (err.message || err), true);
          } finally {
            checkInput.disabled = false;
          }
        });
      }

      if (paidToggle) {
        paidToggle.dataset.original = paidValue ? '1' : '0';
        paidToggle.addEventListener('change', async () => {
          const original = paidToggle.dataset.original === '1';
          if (paidToggle.checked === original) return;
          paidToggle.disabled = true;
          try {
            const result = await patchPayrollCheck(row.id, { paid: paidToggle.checked });
            paidToggle.dataset.original = paidToggle.checked ? '1' : '0';
            row.paid = paidToggle.checked ? 1 : 0;
            const nextPaidDate =
              Object.prototype.hasOwnProperty.call(result, 'paid_date') ? result.paid_date : null;
            row.paid_date = nextPaidDate;
            const dateCell = tr.querySelector('td:nth-child(5)');
            if (dateCell) {
              dateCell.textContent = nextPaidDate ? formatDateUS(nextPaidDate) : '';
            }
            updatePayrollRunDetailsCache(runId, row.id, {
              paid: paidToggle.checked,
              paid_date: nextPaidDate
            });
            setReportsMessage('Check updated.');
          } catch (err) {
            console.error('Failed updating paid status:', err);
            paidToggle.checked = original;
            setReportsMessage('Failed to update paid status: ' + (err.message || err), true);
          } finally {
            paidToggle.disabled = false;
          }
        });
      }
    } else {
      tr.innerHTML = `
        <td>${escapeHTML(row.employee_name || '')}</td>
        <td>${escapeHTML(Number(row.total_hours || 0).toFixed(2))}</td>
        <td>${escapeHTML(formatMoney(Number(row.total_pay || 0)))}</td>
        <td>${escapeHTML(row.check_number || '')}</td>
        <td>${escapeHTML(paidDateLabel)}</td>
        <td>${paidValue ? 'Yes' : 'No'}</td>
      `;
    }
    tbody.appendChild(tr);
  });

  if (downloadBtn) {
    downloadBtn.disabled = false;
  }
}

function rerenderCurrentPayrollRunDetails() {
  const runId = Number(currentPayrollReportRunId);
  if (!runId) return;
  const rows = payrollRunDetailsCache[runId];
  if (!Array.isArray(rows)) return;
  renderPayrollRunDetailsRows(runId, rows);
}

function setupPayrollReportFilters() {
  const runsForm = document.getElementById('reports-runs-filter-form');
  if (runsForm && !runsForm.dataset.bound) {
    runsForm.dataset.bound = '1';
    const applyBtn = document.getElementById('reports-runs-filter-apply');
    const clearBtn = document.getElementById('reports-runs-filter-clear');
    const applyRunFilters = () => {
      payrollReportRunFilters = getPayrollRunFiltersFromUi();
      loadPayrollRuns();
    };
    if (applyBtn) applyBtn.addEventListener('click', applyRunFilters);
    runsForm.addEventListener('submit', evt => {
      evt.preventDefault();
      applyRunFilters();
    });
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        payrollReportRunFilters = { start: '', end: '', status: '', runType: '' };
        resetPayrollRunFiltersInUi();
        loadPayrollRuns();
      });
    }
  }

  const checksForm = document.getElementById('reports-checks-filter-form');
  if (checksForm && !checksForm.dataset.bound) {
    checksForm.dataset.bound = '1';
    const applyBtn = document.getElementById('reports-checks-filter-apply');
    const clearBtn = document.getElementById('reports-checks-filter-clear');
    const applyCheckFilters = () => {
      payrollReportCheckFilters = getPayrollCheckFiltersFromUi();
      rerenderCurrentPayrollRunDetails();
    };
    if (applyBtn) applyBtn.addEventListener('click', applyCheckFilters);
    checksForm.addEventListener('submit', evt => {
      evt.preventDefault();
      applyCheckFilters();
    });
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        payrollReportCheckFilters = { employee: '', paid: '' };
        resetPayrollCheckFiltersInUi();
        rerenderCurrentPayrollRunDetails();
      });
    }
  }
}

async function loadPayrollRuns() {
  if (!isPayrollFeatureEnabled()) return;
  const tbody = document.getElementById('reports-runs-body');
  if (!tbody) return;
  payrollReportRunFilters = getPayrollRunFiltersFromUi();
  tbody.innerHTML = '<tr><td colspan="8">(loading payroll runs...)</td></tr>';
  try {
    const runs = await fetchJSON('/api/reports/payroll-runs');
    payrollReportRuns = Array.isArray(runs) ? runs : [];
    refreshPayrollRunStatusFilterOptions(payrollReportRuns);
    if (!payrollReportRuns.length) {
      tbody.innerHTML = '<tr><td colspan="8">(no payroll runs yet)</td></tr>';
      currentPayrollReportRunId = null;
      const downloadBtn = document.getElementById('reports-download');
      if (downloadBtn) downloadBtn.disabled = true;
      setPayrollRunDetailsPlaceholder('(select a payroll run above)');
      setReportsMessage('');
      return;
    }

    const visibleRuns = filterPayrollRunsByFilters(payrollReportRuns, payrollReportRunFilters);
    if (!visibleRuns.length) {
      tbody.innerHTML = '<tr><td colspan="8">(no payroll runs match current filters)</td></tr>';
      currentPayrollReportRunId = null;
      const downloadBtn = document.getElementById('reports-download');
      if (downloadBtn) downloadBtn.disabled = true;
      setPayrollRunDetailsPlaceholder('(select a payroll run above)');
      setReportsMessage('');
      return;
    }

    tbody.innerHTML = '';
    visibleRuns.forEach(run => {
      const payPeriod = `${formatDateUS(run.start_date)} - ${formatDateUS(run.end_date)}`;
      const status = formatPayrollRunStatus(run.status) || '-';
      const typeLabel = formatPayrollRunType(run.run_type, run.adjustment_reason) || '-';
      const created = formatDateTimeLocal(run.created_at) || '';
      const hours = Number(run.total_hours || 0).toFixed(2);
      const totalPay = formatMoney(Number(run.total_pay || 0));
      const paidChecks = Number(run.paid_checks || 0);
      const totalChecks = Number(run.check_count || 0);
      const errorFull = run.last_error || '';
      const errorShort = formatPayrollRunError(errorFull);

      const tr = document.createElement('tr');
      tr.dataset.runId = run.id;
      if (currentPayrollReportRunId && Number(currentPayrollReportRunId) === Number(run.id)) {
        tr.classList.add('is-selected');
      }
      tr.innerHTML = `
        <td>${escapeHTML(payPeriod)}</td>
        <td>${escapeHTML(status)}</td>
        <td>${escapeHTML(typeLabel)}</td>
        <td>${escapeHTML(created)}</td>
        <td>${escapeHTML(hours)}</td>
        <td>${escapeHTML(totalPay)}</td>
        <td>${escapeHTML(`${paidChecks} / ${totalChecks}`)}</td>
        <td title="${escapeHTML(errorFull)}">${escapeHTML(errorShort)}</td>
      `;
      tr.addEventListener('click', () => {
        document.querySelectorAll('#reports-runs-body tr').forEach(row => {
          row.classList.remove('is-selected');
        });
        tr.classList.add('is-selected');
        currentPayrollReportRunId = run.id;
        loadPayrollRunDetails(run.id, run);
      });
      tbody.appendChild(tr);
    });

    const selectedStillVisible = visibleRuns.some(
      run => Number(run.id) === Number(currentPayrollReportRunId)
    );
    if (!selectedStillVisible) {
      currentPayrollReportRunId = null;
      const downloadBtn = document.getElementById('reports-download');
      if (downloadBtn) downloadBtn.disabled = true;
      setPayrollRunDetailsPlaceholder('(select a payroll run above)');
      setReportsMessage('');
    } else {
      rerenderCurrentPayrollRunDetails();
    }
  } catch (err) {
    console.error('Error loading payroll runs:', err);
    tbody.innerHTML = '<tr><td colspan="8">(error loading payroll runs)</td></tr>';
    setReportsMessage('Failed to load payroll runs.', true);
  }
}

async function loadPayrollRunDetails(runId, runMeta = null) {
  if (!isPayrollFeatureEnabled()) return;
  const downloadBtn = document.getElementById('reports-download');
  setPayrollRunDetailsPlaceholder('(loading run details...)');
  if (downloadBtn) {
    downloadBtn.disabled = true;
    downloadBtn.dataset.runId = runId;
  }

  const runInfo =
    runMeta ||
    (Array.isArray(payrollReportRuns)
      ? payrollReportRuns.find(r => Number(r.id) === Number(runId))
      : null);
  if (runInfo) {
    setReportsMessage(buildPayrollRunSummary(runInfo), !!runInfo.last_error);
  }

  try {
    const rows = await fetchJSON(`/api/reports/payroll-runs/${runId}`);
    const list = Array.isArray(rows) ? rows : [];
    payrollRunDetailsCache[runId] = list;
    renderPayrollRunDetailsRows(runId, list);
  } catch (err) {
    console.error('Error loading payroll run details:', err);
    setPayrollRunDetailsPlaceholder('(error loading run details)');
    setReportsMessage('Failed to load payroll run details.', true);
  }
}

async function loadPayrollAuditLog() {
  if (!isPayrollFeatureEnabled()) return;
  const tbody = document.getElementById('reports-audit-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4">(loading audit log...)</td></tr>';
  try {
    const rows = await fetchJSON('/api/reports/payroll-audit?limit=50');
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="4">(no audit events yet)</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    list.forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHTML(formatDateTimeLocal(row.created_at) || '')}</td>
        <td>${escapeHTML(row.event_type || '')}</td>
        <td>${escapeHTML(row.message || '')}</td>
        <td>${escapeHTML(row.payroll_run_id || '')}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading payroll audit log:', err);
    tbody.innerHTML = '<tr><td colspan="4">(error loading audit log)</td></tr>';
  }
}

function formatAuditValue(value) {
  if (value == null) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? value : '—';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : '—';
  }
  try {
    const json = JSON.stringify(value);
    if (!json) return '—';
    return json.length > 80 ? `${json.slice(0, 77)}...` : json;
  } catch {
    return '—';
  }
}

function summarizeAuditChanges(before, after, maxFields = 4) {
  if (!before && !after) return '';
  const skipKey = key => /pin|password|secret|token/i.test(key);
  const beforeObj = before && typeof before === 'object' ? before : {};
  const afterObj = after && typeof after === 'object' ? after : {};
  const keys = new Set([
    ...Object.keys(beforeObj || {}),
    ...Object.keys(afterObj || {})
  ]);
  const changes = [];
  keys.forEach(key => {
    if (!key || skipKey(key)) return;
    const beforeVal = beforeObj ? beforeObj[key] : undefined;
    const afterVal = afterObj ? afterObj[key] : undefined;
    const beforeJson = JSON.stringify(beforeVal);
    const afterJson = JSON.stringify(afterVal);
    if (beforeJson === afterJson) return;
    changes.push(`${key}: ${formatAuditValue(beforeVal)} → ${formatAuditValue(afterVal)}`);
  });
  if (!changes.length) return '';
  const snippet = changes.slice(0, maxFields).join('; ');
  return changes.length > maxFields
    ? `${snippet}; +${changes.length - maxFields} more`
    : snippet;
}

function formatAuditActor(row) {
  if (row.actor_name) return row.actor_name;
  if (row.actor_employee_id) return `employee-${row.actor_employee_id}`;
  if (row.actor_user_id) return `user-${row.actor_user_id}`;
  return 'system';
}

function formatAuditTarget(row, domain) {
  if (domain === 'time_entries') {
    const entryId = row.entry_id ? `Entry #${row.entry_id}` : 'Entry';
    const emp = row.employee_name || row.employee_id ? `${row.employee_name || `employee-${row.employee_id}`}` : '';
    const proj = row.project_name || row.project_id ? `${row.project_name || `project-${row.project_id}`}` : '';
    const parts = [entryId];
    if (emp) parts.push(emp);
    if (proj) parts.push(proj);
    return parts.join(' · ');
  }
  if (domain === 'payroll_runs') {
    return row.payroll_run_id ? `Run #${row.payroll_run_id}` : 'Payroll run';
  }
  if (row.entity_type && row.entity_id) {
    return `${row.entity_type} #${row.entity_id}`;
  }
  if (row.entity_type) return row.entity_type;
  return '—';
}

function formatAuditAction(row, domain) {
  if (domain === 'time_entries') {
    const map = {
      create: 'Created',
      modify: 'Edited',
      verify: 'Verified',
      unverify: 'Unverified',
      resolve: 'Resolved',
      unresolve: 'Unresolved',
      send_back: 'Sent back',
      approve: 'Approved'
    };
    return map[row.action] || row.action || '';
  }
  if (domain === 'payroll_runs') {
    return row.event_type || '';
  }
  return row.action || '';
}

function formatAuditDetails(row, domain) {
  if (domain === 'payroll_runs') {
    if (row.details && typeof row.details === 'object') {
      const summary = summarizeAuditChanges(null, row.details, 3);
      return summary || formatAuditValue(row.details);
    }
    return '';
  }
  if (domain === 'time_entries') {
    return summarizeAuditChanges(row.before, row.after);
  }
  return summarizeAuditChanges(row.before, row.after);
}

function renderAuditReportRows({ rows, domain, tbodyId }) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6">(no audit events found)</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  list.forEach(row => {
    const tr = document.createElement('tr');
    const when = formatDateTimeLocal(row.created_at || row.time || '') || '';
    const actor = formatAuditActor(row);
    const action = formatAuditAction(row, domain);
    const target = formatAuditTarget(row, domain);
    const note = row.note || row.message || '';
    const details = formatAuditDetails(row, domain);
    tr.innerHTML = `
      <td>${escapeHTML(when)}</td>
      <td>${escapeHTML(actor)}</td>
      <td>${escapeHTML(action)}</td>
      <td>${escapeHTML(target)}</td>
      <td>${escapeHTML(note || '—')}</td>
      <td>${escapeHTML(details || '—')}</td>
    `;
    tbody.appendChild(tr);
  });
}

function hasAuditAccess(requirement) {
  const sectionEnabled = isPayrollFeatureEnabled();
  const perms = window.CURRENT_ACCESS_PERMS || {};
  const isSuperAdmin = window.CURRENT_IS_SUPER_ADMIN === true;
  if (!requirement) return true;
  if (requirement === 'super_admin') return isSuperAdmin;
  if (requirement === 'view_payroll') {
    return sectionEnabled && (perms.view_payroll === true || perms.view_payroll === 'true');
  }
  if (requirement === 'see_shipments') {
    return perms.see_shipments === true || perms.see_shipments === 'true';
  }
  if (requirement === 'view_time_reports') {
    return (
      perms.view_time_reports === true ||
      perms.view_time_reports === 'true' ||
      perms.view_payroll === true ||
      perms.view_payroll === 'true'
    );
  }
  return true;
}

function applyAuditSectionAccess({ sectionKey, requirement, messageId }) {
  const allowed = hasAuditAccess(requirement);
  const navItem = document.querySelector(`.nav-item[data-section="${sectionKey}"]`);
  const section = document.getElementById(`section-${sectionKey}`);
  const dashboardButtons = document.querySelectorAll(
    `[data-dashboard-link="${sectionKey}"]`
  );
  if (!allowed) {
    if (navItem) navItem.remove();
    dashboardButtons.forEach(btn => btn.remove());
    if (section && section.classList.contains('active')) {
      section.classList.remove('active');
    }
    if (section) section.remove();
    return false;
  }
  dashboardButtons.forEach(btn => btn.classList.remove('hidden'));
  if (messageId) {
    const msgEl = document.getElementById(messageId);
    if (msgEl) {
      msgEl.textContent = '';
      msgEl.style.color = '';
    }
  }
  return true;
}

async function runAuditReport(config) {
  const {
    domain,
    startId,
    endId,
    actorId,
    entityId,
    messageId,
    tbodyId,
    domainSelectId,
    domainOverrides
  } = config;

  const msgEl = document.getElementById(messageId);
  if (msgEl) {
    msgEl.textContent = 'Loading audit log...';
    msgEl.style.color = '';
  }

  const start = document.getElementById(startId)?.value || '';
  const end = document.getElementById(endId)?.value || '';
  const actor = document.getElementById(actorId)?.value?.trim() || '';
  const entity = document.getElementById(entityId)?.value?.trim() || '';
  const domainSelect = domainSelectId ? document.getElementById(domainSelectId) : null;
  const resolvedDomain = domainSelect ? domainSelect.value : domain;
  const domainKey = domainOverrides?.[resolvedDomain] || resolvedDomain;

  const params = new URLSearchParams();
  if (start) params.set('start', start);
  if (end) params.set('end', end);
  if (actor) params.set('actor', actor);

  let url = '';
  let renderDomain = domainKey;
  if (domainKey === 'time_entries') {
    if (entity) params.set('entry_id', entity);
    url = `/api/reports/time-entry-audit?${params.toString()}`;
  } else if (domainKey === 'payroll_runs') {
    url = `/api/reports/payroll-audit?${params.toString()}`;
  } else {
    params.set('domain', domainKey);
    if (entity) params.set('entity_id', entity);
    url = `/api/reports/audit-log?${params.toString()}`;
  }

  try {
    const data = await fetchJSON(url);
    const rows = Array.isArray(data)
      ? data
      : (data && Array.isArray(data.rows) ? data.rows : []);
    renderAuditReportRows({ rows, domain: renderDomain, tbodyId });
    if (msgEl) {
      msgEl.textContent = '';
      msgEl.style.color = '';
    }
  } catch (err) {
    if (msgEl) {
      msgEl.textContent = `Failed to load audit log: ${err.message || err}`;
      msgEl.style.color = '#b91c1c';
    }
    const tbody = document.getElementById(tbodyId);
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6">(error loading audit log)</td></tr>';
    }
  }
}

function initAuditReport(config) {
  const form = document.getElementById(config.formId);
  if (!form || form.dataset.bound) return;
  form.dataset.bound = '1';

  const runBtn = document.getElementById(config.runId);
  const resetBtn = document.getElementById(config.resetId);
  const domainSelect = config.domainSelectId
    ? document.getElementById(config.domainSelectId)
    : null;

  const run = () => runAuditReport(config);

  if (runBtn) runBtn.addEventListener('click', run);
  form.addEventListener('submit', evt => {
    evt.preventDefault();
    run();
  });
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      const startInput = document.getElementById(config.startId);
      const endInput = document.getElementById(config.endId);
      const actorInput = document.getElementById(config.actorId);
      const entityInput = document.getElementById(config.entityId);
      if (startInput) startInput.value = '';
      if (endInput) endInput.value = '';
      if (actorInput) actorInput.value = '';
      if (entityInput) entityInput.value = '';
      run();
    });
  }
  if (domainSelect) {
    domainSelect.addEventListener('change', run);
  }

  run();
}

function initAuditReports() {
  if (auditReportsInitialized) return;
  auditReportsInitialized = true;
  applyAuditSectionAccess({
    sectionKey: 'audit-time-report',
    requirement: 'view_time_reports',
    messageId: 'audit-time-message'
  });
  applyAuditSectionAccess({
    sectionKey: 'audit-payroll-report',
    requirement: 'view_payroll',
    messageId: 'audit-payroll-message'
  });
  applyAuditSectionAccess({
    sectionKey: 'audit-ops-report',
    requirement: 'see_shipments',
    messageId: 'audit-ops-message'
  });
  applyAuditSectionAccess({
    sectionKey: 'audit-security-report',
    requirement: 'super_admin',
    messageId: 'audit-security-message'
  });

  initAuditReport({
    sectionKey: 'audit-time-report',
    requirement: 'view_time_reports',
    formId: 'audit-time-form',
    runId: 'audit-time-run',
    resetId: 'audit-time-reset',
    startId: 'audit-time-start',
    endId: 'audit-time-end',
    actorId: 'audit-time-actor',
    entityId: 'audit-time-entity-id',
    messageId: 'audit-time-message',
    tbodyId: 'audit-time-body',
    domain: 'time_entries'
  });

  initAuditReport({
    sectionKey: 'audit-payroll-report',
    requirement: 'view_payroll',
    formId: 'audit-payroll-form',
    runId: 'audit-payroll-run',
    resetId: 'audit-payroll-reset',
    startId: 'audit-payroll-start',
    endId: 'audit-payroll-end',
    actorId: 'audit-payroll-actor',
    entityId: 'audit-payroll-entity-id',
    messageId: 'audit-payroll-message',
    tbodyId: 'audit-payroll-body',
    domain: 'payroll_runs'
  });

  initAuditReport({
    sectionKey: 'audit-ops-report',
    requirement: 'see_shipments',
    formId: 'audit-ops-form',
    runId: 'audit-ops-run',
    resetId: 'audit-ops-reset',
    startId: 'audit-ops-start',
    endId: 'audit-ops-end',
    actorId: 'audit-ops-actor',
    entityId: 'audit-ops-entity-id',
    messageId: 'audit-ops-message',
    tbodyId: 'audit-ops-body',
    domainSelectId: 'audit-ops-domain',
    domain: 'shipments'
  });

  initAuditReport({
    sectionKey: 'audit-security-report',
    requirement: 'super_admin',
    formId: 'audit-security-form',
    runId: 'audit-security-run',
    resetId: 'audit-security-reset',
    startId: 'audit-security-start',
    endId: 'audit-security-end',
    actorId: 'audit-security-actor',
    entityId: 'audit-security-entity-id',
    messageId: 'audit-security-message',
    tbodyId: 'audit-security-body',
    domainSelectId: 'audit-security-domain',
    domain: 'access'
  });
}

function csvEscape(value) {
  const str = value == null ? '' : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildPayrollRunCsv(rows) {
  const header = ['Employee', 'Hours', 'Total Pay', 'Check #', 'Paid Date', 'Paid'];
  const lines = [header.map(csvEscape).join(',')];
  (rows || []).forEach(row => {
    const line = [
      row.employee_name || '',
      Number(row.total_hours || 0).toFixed(2),
      Number(row.total_pay || 0).toFixed(2),
      row.check_number || '',
      row.paid_date || '',
      row.paid ? 'Yes' : 'No'
    ];
    lines.push(line.map(csvEscape).join(','));
  });
  return lines.join('\n');
}

function setupReportsDownload() {
  const btn = document.getElementById('reports-download');
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', async () => {
    const runId = Number(btn.dataset.runId || currentPayrollReportRunId);
    if (!runId) {
      alert('Select a payroll run to download.');
      return;
    }
    let rows = payrollRunDetailsCache[runId];
    if (!Array.isArray(rows)) {
      try {
        rows = await fetchJSON(`/api/reports/payroll-runs/${runId}`);
        payrollRunDetailsCache[runId] = rows;
      } catch (err) {
        console.error('Error loading payroll run details for CSV:', err);
        alert('Failed to load payroll run details for download.');
        return;
      }
    }
    const csv = buildPayrollRunCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `payroll_run_${runId}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  });
}
