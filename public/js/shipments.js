/* ───────── 11. SHIPMENTS UI ───────── */

let shipmentsBoardData = {
  statuses: [],
  shipmentsByStatus: {}
};
let currentStatusFilter = "";
const ARCHIVED_PREVIEW_LIMIT = 8;
const ARCHIVED_PREVIEW_FETCH_LIMIT = ARCHIVED_PREVIEW_LIMIT + 1;
let archivedShipmentsPreview = [];
let archivedShipmentsPreviewHasMore = false;
let shipmentsColumnOrder = [];
let shipmentsColumnSortMode = 'custom';
let draggingColumnStatusKey = null;
let draggingShipmentId = null;
let currentVerificationRow = null;
let currentShipmentDetailId = null;
let currentShipmentDetail = null;
let currentShipmentCreateStep = 1;
let lastItemsTotalValue = null;
let lastOverridePromptTotal = null;
let overridePromptInFlight = false;
let overridePromptTimer = null;
let shipmentItemsLoadedOnce = false;
let shipmentDocsLoadedOnce = false;
let shipmentsSummaryCache = null;
let shipmentsSummaryFiltersKey = '';
let currentShipmentPersonalNoteShipmentId = null;


const SHIPMENT_STATUS_ICONS = {
  "Pre-Order": "/icons/shipments/preorder.svg",
  "Ordered": "/icons/shipments/ordered.svg",
  "In Transit to Forwarder": "/icons/shipments/transit.svg",
  "Arrived at Forwarder": "/icons/shipments/forwarder.svg",
  "Sailed": "/icons/shipments/ship.svg",
  "Arrived at Port": "/icons/shipments/port.svg",
  "Awaiting Clearance": "/icons/shipments/customs.svg",
  "Cleared - Ready for Pickup": "/icons/shipments/pickup.svg",
  "Picked Up": "/icons/shipments/done.svg",
  "Archived": "/icons/shipments/archived.svg"
};

const SHIPMENT_PERSONAL_NOTE_ICON_SVG_EMPTY =
  // File-plus (add note)
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
    '<path d="M14 2v6h6"/>' +
    '<path d="M12 11v6"/>' +
    '<path d="M9 14h6"/>' +
  '</svg>';

const SHIPMENT_PERSONAL_NOTE_ICON_SVG_NOTE =
  // File-text (has note)
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
    '<path d="M14 2v6h6"/>' +
    '<path d="M16 13H8"/>' +
    '<path d="M16 17H8"/>' +
    '<path d="M10 9H8"/>' +
  '</svg>';

const SHIPMENT_PERSONAL_NOTE_ICON_SVG_DONE =
  // File-check (completed note)
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
    '<path d="M14 2v6h6"/>' +
    '<path d="M9 14l2 2 4-4"/>' +
  '</svg>';

const FORWARDER_OTHER_VALUE = '__forwarder_other__';
const SHIPMENTS_COLUMN_ORDER_KEY = 'avian_shipments_column_order';
const SHIPMENTS_COLUMN_SORT_KEY = 'avian_shipments_column_sort';

function normalizeShipmentStatusLabel(status) {
  if (!status) return '';
  return String(status)
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeShipmentStatusKey(status) {
  return normalizeShipmentStatusLabel(status).toLowerCase();
}

function normalizeShipmentStatusList(statuses = []) {
  const unique = [];
  const seen = new Set();

  (statuses || []).forEach(status => {
    const label = normalizeShipmentStatusLabel(status);
    if (!label) return;
    const key = normalizeShipmentStatusKey(label);
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(label);
  });

  return unique;
}

function normalizeShipmentsBoardData(data) {
  if (!data || typeof data !== 'object') return data;

  const order = [];
  const byStatus = {};
  const seen = new Set();

  const addStatus = (status) => {
    const label = normalizeShipmentStatusLabel(status);
    if (!label) return null;
    const key = normalizeShipmentStatusKey(label);
    if (!seen.has(key)) {
      seen.add(key);
      order.push(label);
      byStatus[label] = [];
    }
    return label;
  };

  (data.statuses || []).forEach(addStatus);

  Object.entries(data.shipmentsByStatus || {}).forEach(([status, list]) => {
    const label = addStatus(status);
    if (!label) return;
    if (Array.isArray(list) && list.length) {
      list.forEach(sh => {
        if (!sh || !sh.status) return;
        const key = normalizeShipmentStatusKey(sh.status);
        const labelKey = normalizeShipmentStatusKey(label);
        if (key && labelKey && key === labelKey && sh.status !== label) {
          sh.status = label;
        }
      });
      byStatus[label].push(...list);
    }
  });

  return {
    ...data,
    statuses: order,
    shipmentsByStatus: byStatus
  };
}

function buildShipmentsSummaryFiltersKey() {
  const search =
    document.getElementById('shipments-search')?.value || '';
  const project =
    document.getElementById('shipments-filter-project')?.value || '';
  const vendor =
    document.getElementById('shipments-filter-vendor')?.value || '';
  const status = currentStatusFilter || '';
  const shipmentId =
    document.getElementById('shipments-summary-filter-shipment')?.value || '';
  return JSON.stringify({ search, project, vendor, status, shipmentId });
}

function flattenShipmentsBoardData() {
  const byStatus = shipmentsBoardData?.shipmentsByStatus || {};
  const list = [];
  Object.values(byStatus).forEach(group => {
    if (Array.isArray(group)) list.push(...group);
  });
  return list;
}

function shipmentSummaryOptionLabel(sh) {
  const title = String(sh?.title || '(no title)').trim();
  const status = String(sh?.status || '').trim();
  const po = String(sh?.po_number || '').trim();
  const bol = String(sh?.bol_number || '').trim();
  const bits = [];
  if (status) bits.push(status);
  if (po) bits.push(`PO ${po}`);
  if (bol) bits.push(`BOL ${bol}`);
  return bits.length ? `${title} (${bits.join(' · ')})` : title;
}

function populateShipmentsSummaryStatusFilter(statuses = []) {
  const sel = document.getElementById('shipments-summary-filter-status');
  if (!sel) return;

  const selected =
    currentStatusFilter
      ? (matchNormalizedStatus(currentStatusFilter, statuses) || normalizeShipmentStatusLabel(currentStatusFilter))
      : '';

  const ordered = getOrderedShipmentStatuses(statuses || []);
  const frag = document.createDocumentFragment();

  const optAll = document.createElement('option');
  optAll.value = '';
  optAll.textContent = 'All statuses';
  frag.appendChild(optAll);

  ordered.forEach(st => {
    const opt = document.createElement('option');
    opt.value = st;
    opt.textContent = st;
    frag.appendChild(opt);
  });

  const prev = sel.value;
  sel.innerHTML = '';
  sel.appendChild(frag);
  sel.value = selected || prev || '';
}

function populateShipmentsSummaryShipmentFilter(list = []) {
  const sel = document.getElementById('shipments-summary-filter-shipment');
  if (!sel) return;

  const prev = sel.value || '';
  const unique = (Array.isArray(list) ? list : [])
    .filter(sh => sh && sh.id != null)
    .slice()
    .sort((a, b) => {
      const at = String(a.title || '').toLowerCase();
      const bt = String(b.title || '').toLowerCase();
      if (at < bt) return -1;
      if (at > bt) return 1;
      return Number(a.id) - Number(b.id);
    });

  const frag = document.createDocumentFragment();
  const optAll = document.createElement('option');
  optAll.value = '';
  optAll.textContent = 'All shipments';
  frag.appendChild(optAll);

  unique.forEach(sh => {
    const opt = document.createElement('option');
    opt.value = String(sh.id);
    opt.textContent = shipmentSummaryOptionLabel(sh);
    frag.appendChild(opt);
  });

  sel.innerHTML = '';
  sel.appendChild(frag);
  if (prev && unique.some(sh => String(sh.id) === String(prev))) {
    sel.value = String(prev);
  } else {
    sel.value = '';
  }
}

function populateShipmentsSummaryFilters() {
  populateShipmentsSummaryStatusFilter(shipmentsBoardData?.statuses || []);
  populateShipmentsSummaryShipmentFilter(flattenShipmentsBoardData());
}

function truncateText(text, max = 90) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  if (raw.length <= max) return raw;
  return raw.slice(0, max - 1).trimEnd() + '…';
}

function isShipmentFlagSet(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'y'].includes(normalized);
}

function isStatusAtOrAfterArrival(status) {
  const cls = shipmentStatusClass(status || '');
  return [
    'status-arrived',
    'status-clearance',
    'status-ready',
    'status-pickedup',
    'status-archived'
  ].includes(cls);
}

function isStatusAtOrAfterForwarder(status) {
  const cls = shipmentStatusClass(status || '');
  return [
    'status-forwarder',
    'status-sailed',
    'status-arrived',
    'status-clearance',
    'status-ready',
    'status-pickedup',
    'status-archived'
  ].includes(cls);
}

function getShipmentIdFromNotification(notification = null) {
  const raw = notification && notification.data
    ? notification.data.shipment_id
    : null;
  const id = Number(raw);
  if (Number.isInteger(id) && id > 0) return id;
  return null;
}

function buildUnreadShipmentCommentSummary(shipments = [], notifications = []) {
  if (!Array.isArray(shipments) || !shipments.length) return [];

  const shipmentById = new Map();
  shipments.forEach(sh => {
    const id = Number(sh && sh.id);
    if (!Number.isInteger(id) || id <= 0) return;
    if (!shipmentById.has(id)) shipmentById.set(id, sh);
  });
  if (!shipmentById.size) return [];

  const grouped = new Map();
  (Array.isArray(notifications) ? notifications : []).forEach(notification => {
    if (!notification || notification.type !== 'shipment_comment') return;
    const shipmentId = getShipmentIdFromNotification(notification);
    if (!shipmentId || !shipmentById.has(shipmentId)) return;

    let row = grouped.get(shipmentId);
    if (!row) {
      const shipment = shipmentById.get(shipmentId);
      row = {
        ...shipment,
        unread_comment_count: 0,
        unread_comment_latest_body: notification.body || '',
        unread_comment_latest_created_at: notification.created_at || ''
      };
      grouped.set(shipmentId, row);
    }
    row.unread_comment_count += 1;
  });

  const rows = Array.from(grouped.values());
  rows.sort((a, b) => {
    const countDiff =
      (Number(b.unread_comment_count) || 0) -
      (Number(a.unread_comment_count) || 0);
    if (countDiff) return countDiff;

    const latestA = String(a.unread_comment_latest_created_at || '');
    const latestB = String(b.unread_comment_latest_created_at || '');
    if (latestA < latestB) return 1;
    if (latestA > latestB) return -1;

    return String(a.title || '').localeCompare(String(b.title || ''));
  });

  return rows;
}

function buildShipmentSummaryData(list = []) {
  const missingCoo = [];
  const missingDocs = [];
  const unpaidForwarder = [];
  const unpaidClearing = [];
  const requestClearing = [];
  const personalNotes = [];
  const readyPickup = [];
  const needsVerification = [];
  const totalShipments = Array.isArray(list) ? list.length : 0;
  let activeShipments = 0;
  let archivedShipments = 0;
  let paymentFieldsPresent = false;

  list.forEach(sh => {
    const statusCls = shipmentStatusClass(sh.status || '');
    const isArchived = statusCls === 'status-archived';
    if (isArchived) {
      archivedShipments += 1;
    } else {
      activeShipments += 1;
    }

    if (
      !paymentFieldsPresent &&
      (Object.prototype.hasOwnProperty.call(sh, 'shipper_paid') ||
        Object.prototype.hasOwnProperty.call(sh, 'customs_paid'))
    ) {
      paymentFieldsPresent = true;
    }

    const itemsTotal = Number(sh.items_total) || 0;
    const itemsWithCoo = Number(sh.items_with_coo) || 0;
    if (itemsTotal > 0 && itemsWithCoo < itemsTotal) {
      missingCoo.push(sh);
    }

    const missing = getMissingRequiredDocsFromShipment(sh);
    if (missing && missing.length) {
      missingDocs.push({ ...sh, missing_docs: missing });
    }

    const needsForwarderPayment =
      !isArchived &&
      isStatusAtOrAfterForwarder(sh.status || '') &&
      Object.prototype.hasOwnProperty.call(sh, 'shipper_paid') &&
      !isShipmentFlagSet(sh.shipper_paid);
    if (needsForwarderPayment) {
      unpaidForwarder.push(sh);
    }

    const needsClearingPayment =
      !isArchived &&
      isStatusAtOrAfterArrival(sh.status || '') &&
      Object.prototype.hasOwnProperty.call(sh, 'customs_paid') &&
      !isShipmentFlagSet(sh.customs_paid);
    if (needsClearingPayment) {
      unpaidClearing.push(sh);
    }

    const needsRequestClearing =
      isStatusAtOrAfterArrival(sh.status || '') &&
      !isShipmentFlagSet(sh.requested_clearing);
    if (needsRequestClearing) {
      requestClearing.push(sh);
    }

    const personalNoteText = (sh.personal_note || '').trim();
    const personalNoteDone = isShipmentFlagSet(sh.personal_note_completed);
    if (personalNoteText && !personalNoteDone) {
      personalNotes.push(sh);
    }

    const statusKey = normalizeShipmentStatusKey(sh.status || '');
    const isReady =
      statusKey === normalizeShipmentStatusKey('Cleared - Ready for Pickup') &&
      Number(sh.items_verified) === 1 &&
      !(sh.picked_up_by || '').trim();
    if (isReady) {
      readyPickup.push(sh);
    }

    const isPickedUp =
      statusKey === normalizeShipmentStatusKey('Picked Up');
    if (isPickedUp && Number(sh.items_verified) === 0) {
      needsVerification.push(sh);
    }
  });

  return {
    totalShipments,
    activeShipments,
    archivedShipments,
    paymentFieldsPresent,
    missingCoo,
    missingDocs,
    unpaidForwarder,
    unpaidClearing,
    requestClearing,
    personalNotes,
    unreadShipmentComments: [],
    readyPickup,
    needsVerification
  };
}

function renderShipmentsSummaryCard({
  id,
  title,
  subtitle,
  items,
  emptyLabel,
  buildMeta,
  buildBadge,
  itemAction
}) {
  const count = Array.isArray(items) ? items.length : 0;
  const actionAttr = itemAction ? ` data-summary-action="${itemAction}"` : '';
  const rows = (items || []).map(sh => {
    const meta = buildMeta ? buildMeta(sh) : '';
    const badge = buildBadge ? buildBadge(sh) : '';
    return `
      <button type="button" class="ship-summary-item" data-summary-id="${sh.id}"${actionAttr}>
        <div class="ship-summary-item-main">${escapeHTML(sh.title || '(no title)')}</div>
        ${meta ? `<div class="ship-summary-item-meta">${meta}</div>` : ''}
        ${badge ? `<div class="ship-summary-item-badge">${badge}</div>` : ''}
      </button>
    `;
  }).join('');

  return `
    <div class="ship-summary-card" data-summary-card="${id}">
      <div class="ship-summary-card-header">
        <div>
          <div class="ship-summary-card-title">${escapeHTML(title)}</div>
          ${subtitle ? `<div class="ship-summary-card-sub">${escapeHTML(subtitle)}</div>` : ''}
        </div>
        <div class="ship-summary-card-count">${count}</div>
      </div>
      <div class="ship-summary-card-body">
        ${count
          ? rows
          : `<div class="ship-summary-empty">${escapeHTML(emptyLabel || 'Nothing to review.')}</div>`
        }
      </div>
    </div>
  `;
}

function renderShipmentsSummary(summary = {}) {
  const grid = document.getElementById('shipments-summary-grid');
  if (!grid) return;

  const statsEl = document.getElementById('shipments-summary-stats');
  if (statsEl) {
    const total = Number(summary.totalShipments) || 0;
    const active = Number(summary.activeShipments) || 0;
    const archived = Number(summary.archivedShipments) || 0;
    const parts = [];
    parts.push(`<span class="ship-summary-pill">Active: ${active}</span>`);
    if (archived) {
      parts.push(`<span class="ship-summary-pill">Archived: ${archived}</span>`);
    }
    statsEl.innerHTML = parts.join('');
  }

  const cards = [];
  const personalNotes = Array.isArray(summary.personalNotes) ? summary.personalNotes : [];
  if (personalNotes.length) {
    cards.push(renderShipmentsSummaryCard({
      id: 'personal-notes',
      title: 'My Notes',
      subtitle: 'Private notes (only you)',
      items: personalNotes,
      emptyLabel: 'No personal notes.',
      itemAction: 'personal-note',
      buildMeta: (sh) => {
        const project = sh.project_name || '—';
        const vendor = sh.vendor_name || '—';
        const status = sh.status || '—';
        return `${escapeHTML(project)} · ${escapeHTML(vendor)} · ${escapeHTML(status)}`;
      },
      buildBadge: (sh) => {
        const snippet = truncateText(sh.personal_note || '', 120);
        return snippet
          ? `<span class="ship-summary-note">${escapeHTML(snippet)}</span>`
          : '';
      }
    }));
  }

  const unreadShipmentComments = Array.isArray(summary.unreadShipmentComments)
    ? summary.unreadShipmentComments
    : [];
  if (unreadShipmentComments.length) {
    const unreadTotal = unreadShipmentComments.reduce(
      (sum, sh) => sum + (Number(sh.unread_comment_count) || 0),
      0
    );
    const unreadSubtitle = unreadTotal === 1
      ? '1 unread message'
      : `${unreadTotal} unread messages`;
    cards.push(renderShipmentsSummaryCard({
      id: 'unread-comments',
      title: 'Unread Comments',
      subtitle: unreadSubtitle,
      items: unreadShipmentComments,
      emptyLabel: 'No unread shipment comments.',
      itemAction: 'shipment-comments',
      buildMeta: (sh) => {
        const project = sh.project_name || '—';
        const vendor = sh.vendor_name || '—';
        const status = sh.status || '—';
        return `${escapeHTML(project)} · ${escapeHTML(vendor)} · ${escapeHTML(status)}`;
      },
      buildBadge: (sh) => {
        const count = Number(sh.unread_comment_count) || 0;
        const countLabel = `${count} unread`;
        const snippet = truncateText(sh.unread_comment_latest_body || '', 110);
        return snippet
          ? `<span class="ship-summary-pill danger">${escapeHTML(countLabel)}</span> <span class="ship-summary-note">${escapeHTML(snippet)}</span>`
          : `<span class="ship-summary-pill danger">${escapeHTML(countLabel)}</span>`;
      }
    }));
  }

  const missingCoo = Array.isArray(summary.missingCoo) ? summary.missingCoo : [];
  if (missingCoo.length) {
  cards.push(renderShipmentsSummaryCard({
    id: 'missing-coo',
    title: 'Missing COO',
    subtitle: 'Items without country of origin',
    items: missingCoo,
    emptyLabel: 'All items have COO.',
    buildMeta: (sh) => {
      const project = sh.project_name || '—';
      const vendor = sh.vendor_name || '—';
      const status = sh.status || '—';
      return `${escapeHTML(project)} · ${escapeHTML(vendor)} · ${escapeHTML(status)}`;
    },
    buildBadge: (sh) => {
      const total = Number(sh.items_total) || 0;
      const withCoo = Number(sh.items_with_coo) || 0;
      return `<span class="ship-summary-pill danger">${withCoo}/${total} COO</span>`;
    }
  }));
  }

  const missingDocs = Array.isArray(summary.missingDocs) ? summary.missingDocs : [];
  if (missingDocs.length) {
  cards.push(renderShipmentsSummaryCard({
    id: 'missing-docs',
    title: 'Missing Docs',
    subtitle: 'Required documents not uploaded',
    items: missingDocs,
    emptyLabel: 'All required docs are present.',
    buildMeta: (sh) => {
      const project = sh.project_name || '—';
      const vendor = sh.vendor_name || '—';
      return `${escapeHTML(project)} · ${escapeHTML(vendor)}`;
    },
    buildBadge: (sh) => {
      const missing = Array.isArray(sh.missing_docs) ? sh.missing_docs : [];
      return `<span class="ship-summary-pill warning">Missing: ${escapeHTML(missing.join(', '))}</span>`;
    }
  }));
  }

  const canShowPayments =
    summary.paymentFieldsPresent ||
    !!(CURRENT_PERMS && CURRENT_PERMS.view_payroll);
  if (canShowPayments) {
    const unpaidForwarder = Array.isArray(summary.unpaidForwarder) ? summary.unpaidForwarder : [];
    if (unpaidForwarder.length) {
    cards.push(renderShipmentsSummaryCard({
      id: 'forwarder-unpaid',
      title: 'Forwarder Payment',
      subtitle: 'Arrived at forwarder or later and unpaid',
      items: unpaidForwarder,
      emptyLabel: 'No unpaid forwarder payments.',
      buildMeta: (sh) => {
        const project = sh.project_name || '—';
        const vendor = sh.vendor_name || '—';
        const status = sh.status || '—';
        return `${escapeHTML(project)} · ${escapeHTML(vendor)} · ${escapeHTML(status)}`;
      },
      buildBadge: (sh) => {
        const amt = sh.shipper_paid_amount != null ? Number(sh.shipper_paid_amount) : null;
        const amtLabel = Number.isFinite(amt) && amt > 0 ? formatMoney(amt) : '';
        return `<span class="ship-summary-pill danger">Unpaid${amtLabel ? ` · ${escapeHTML(amtLabel)}` : ''}</span>`;
      }
    }));
    }

    const unpaidClearing = Array.isArray(summary.unpaidClearing) ? summary.unpaidClearing : [];
    if (unpaidClearing.length) {
    cards.push(renderShipmentsSummaryCard({
      id: 'clearing-unpaid',
      title: 'Clearing Payment',
      subtitle: 'Arrived at port or later and unpaid',
      items: unpaidClearing,
      emptyLabel: 'No unpaid clearing payments.',
      buildMeta: (sh) => {
        const project = sh.project_name || '—';
        const vendor = sh.vendor_name || '—';
        const status = sh.status || '—';
        return `${escapeHTML(project)} · ${escapeHTML(vendor)} · ${escapeHTML(status)}`;
      },
      buildBadge: (sh) => {
        const amt = sh.customs_paid_amount != null ? Number(sh.customs_paid_amount) : null;
        const amtLabel = Number.isFinite(amt) && amt > 0 ? formatMoney(amt) : '';
        return `<span class="ship-summary-pill danger">Unpaid${amtLabel ? ` · ${escapeHTML(amtLabel)}` : ''}</span>`;
      }
    }));
    }
  }

  const requestClearing = Array.isArray(summary.requestClearing) ? summary.requestClearing : [];
  if (requestClearing.length) {
  cards.push(renderShipmentsSummaryCard({
    id: 'request-clearing',
    title: 'Request Clearing',
    subtitle: 'Arrived at port or later without a clearing request',
    items: requestClearing,
    emptyLabel: 'All arrived shipments have clearing requested.',
    buildMeta: (sh) => {
      const project = sh.project_name || '—';
      const vendor = sh.vendor_name || '—';
      const status = sh.status || '—';
      return `${escapeHTML(project)} · ${escapeHTML(vendor)} · ${escapeHTML(status)}`;
    },
    buildBadge: () => `<span class="ship-summary-pill danger">Request clearing</span>`
  }));
  }

  const readyPickup = Array.isArray(summary.readyPickup) ? summary.readyPickup : [];
  if (readyPickup.length) {
  cards.push(renderShipmentsSummaryCard({
    id: 'ready-pickup',
    title: 'Ready for Pickup',
    subtitle: 'Verified and waiting pickup',
    items: readyPickup,
    emptyLabel: 'No shipments are ready for pickup.',
    buildMeta: (sh) => {
      const project = sh.project_name || '—';
      const arrival = sh.expected_arrival_date
        ? formatDateUS(sh.expected_arrival_date)
        : '—';
      return `${escapeHTML(project)} · ETA ${escapeHTML(arrival)}`;
    },
    buildBadge: (sh) => {
      const due = sh.storage_due_date ? formatDateUS(sh.storage_due_date) : '';
      if (!due) return '';
      return `<span class="ship-summary-pill">Storage due ${escapeHTML(due)}</span>`;
    }
  }));
  }

  const needsVerification = Array.isArray(summary.needsVerification) ? summary.needsVerification : [];
  if (needsVerification.length) {
  cards.push(renderShipmentsSummaryCard({
    id: 'needs-verification',
    title: 'Needs Verification',
    subtitle: 'Picked up but not fully verified',
    items: needsVerification,
    emptyLabel: 'No pickups awaiting verification.',
    buildMeta: (sh) => {
      const project = sh.project_name || '—';
      const vendor = sh.vendor_name || '—';
      return `${escapeHTML(project)} · ${escapeHTML(vendor)}`;
    },
    buildBadge: () => `<span class="ship-summary-pill danger">Verify items</span>`
  }));
  }

  if (!cards.length) {
    grid.innerHTML = '<div class="ship-summary-empty">No shipments need attention.</div>';
    return;
  }

  grid.innerHTML = cards.join('');

  grid.querySelectorAll('.ship-summary-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-summary-id');
      if (!id) return;
      const action = btn.getAttribute('data-summary-action') || '';
      if (action === 'personal-note') {
        openShipmentPersonalNoteModal(id);
        return;
      }
      if (action === 'shipment-comments') {
        openShipmentDetail(id)
          .then(() => {
            setShipmentDetailTab('comments');
          })
          .catch(() => {});
        return;
      }
      openShipmentDetail(id);
    });
  });
}

async function loadShipmentsSummary({ force = false, skipBoardLoad = false } = {}) {
  const message = document.getElementById('shipments-summary-message');
  const grid = document.getElementById('shipments-summary-grid');
  if (!grid) return;

  const filtersKey = buildShipmentsSummaryFiltersKey();
  if (!force && shipmentsSummaryCache && shipmentsSummaryFiltersKey === filtersKey) {
    renderShipmentsSummary(shipmentsSummaryCache);
    return;
  }

  if (message) {
    message.textContent = 'Loading summary...';
    message.style.color = 'black';
  }

  try {
    if (!skipBoardLoad) {
      await loadShipmentsBoard();
    }
    populateShipmentsSummaryFilters();

    const list = flattenShipmentsBoardData();
    const shipmentFilterId =
      document.getElementById('shipments-summary-filter-shipment')?.value || '';
    const filteredList = shipmentFilterId
      ? (list || []).filter(sh => String(sh.id) === String(shipmentFilterId))
      : list;

    const summary = buildShipmentSummaryData(filteredList);
    let unreadNotifications = [];
    if (Array.isArray(filteredList) && filteredList.length) {
      try {
        const unreadRes = await fetchJSON('/api/notifications?unread_only=1&limit=200');
        unreadNotifications = Array.isArray(unreadRes?.notifications)
          ? unreadRes.notifications
          : [];
      } catch (err) {
        console.warn('Shipments summary unread comments unavailable:', err);
      }
    }
    summary.unreadShipmentComments = buildUnreadShipmentCommentSummary(
      filteredList,
      unreadNotifications
    );
    shipmentsSummaryCache = summary;
    shipmentsSummaryFiltersKey = filtersKey;
    renderShipmentsSummary(summary);
    if (message) message.textContent = '';
  } catch (err) {
    if (message) {
      message.textContent = 'Failed to load summary: ' + err.message;
      message.style.color = 'crimson';
    }
  }
}

function matchNormalizedStatus(value, statuses = []) {
  if (!value) return '';
  const key = normalizeShipmentStatusKey(value);
  if (!key) return '';
  return (statuses || []).find(status => normalizeShipmentStatusKey(status) === key) || '';
}

function loadShipmentsColumnPrefs() {
  try {
    const raw = localStorage.getItem(SHIPMENTS_COLUMN_ORDER_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    shipmentsColumnOrder = Array.isArray(parsed) ? parsed : [];
  } catch {
    shipmentsColumnOrder = [];
  }

  try {
    const mode = localStorage.getItem(SHIPMENTS_COLUMN_SORT_KEY);
    shipmentsColumnSortMode = mode === 'reverse' ? 'reverse' : 'custom';
  } catch {
    shipmentsColumnSortMode = 'custom';
  }
}

function saveShipmentsColumnPrefs() {
  try {
    localStorage.setItem(
      SHIPMENTS_COLUMN_ORDER_KEY,
      JSON.stringify(Array.isArray(shipmentsColumnOrder) ? shipmentsColumnOrder : [])
    );
    localStorage.setItem(SHIPMENTS_COLUMN_SORT_KEY, shipmentsColumnSortMode);
  } catch {}
}

function updateShipmentsSortToggleLabel() {
  const btn = document.getElementById('shipments-sort-toggle');
  if (!btn) return;
  btn.textContent =
    shipmentsColumnSortMode === 'reverse'
      ? 'Sort: Arrived first'
      : 'Sort: Default';
}

function getOrderedShipmentStatuses(statuses = []) {
  const normalized = normalizeShipmentStatusList(statuses);
  if (!normalized.length) return normalized;

  const ordered = [];
  const used = new Set();

  (shipmentsColumnOrder || []).forEach(key => {
    const match = normalized.find(st => normalizeShipmentStatusKey(st) === key);
    if (match && !used.has(key)) {
      ordered.push(match);
      used.add(key);
    }
  });

  normalized.forEach(st => {
    const key = normalizeShipmentStatusKey(st);
    if (!used.has(key)) {
      ordered.push(st);
      used.add(key);
    }
  });

  if (shipmentsColumnSortMode === 'reverse') {
    ordered.reverse();
  }

  return ordered;
}

// ───────── CURRENT USER / EMPLOYEE CONTEXT ─────────
let CURRENT_USER = null;
let CURRENT_EMPLOYEE = null;
let CURRENT_PERMS = null;

const DEFAULT_NOTIFICATION_PREF = {
  enabled: false,
  statuses: [],
  project_ids: [],
  shipment_ids: [],
  notify_time: '',
  remind_every_days: 1
};
let shipmentNotificationPref = { ...DEFAULT_NOTIFICATION_PREF };
let shipmentNotificationTimer = null;
let lastShipmentNotificationKey = '';
let itemVerificationEditMode = false;
let shipmentSettingsCache = null;
let shipmentSettingsPromise = null;
let shipmentsProjectsCache = [];
let shipmentTemplatesCache = [];

const SHIPMENT_PAID_BY_COMPANY = '__company__';
const SHIPMENT_PAID_BY_OTHER = '__other__';
const SHIPMENT_PAID_BY_CUSTOMER_PREFIX = 'customer:';

// Fire once on load; result is cached in global vars above.
async function loadCurrentUserContext() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) return; // not logged in, kiosk mode, etc.

    const data = await res.json();
    if (!data || !data.ok) return;

    CURRENT_USER = data.user || null;
    CURRENT_EMPLOYEE = data.employee || null;
    CURRENT_PERMS = data.permissions || null;

    console.log('[SHIPMENTS] Current user:', CURRENT_USER, CURRENT_EMPLOYEE);
    applyShipmentPaymentsVisibility();
    refreshShipmentPaymentsForOpenDetail();
  } catch (err) {
    console.warn('[SHIPMENTS] Failed to load current user:', err);
  }
}

// Kick this off immediately; we don't need to await it
loadCurrentUserContext();

function isCurrentUserAdmin() {
  return !!(CURRENT_EMPLOYEE && CURRENT_EMPLOYEE.is_admin);
}

function canViewShipmentPayments() {
  if (CURRENT_PERMS == null) return true;
  return !!CURRENT_PERMS.view_payroll;
}

function applyShipmentPaymentsVisibility() {
  const paymentsTab = document.querySelector('.ship-detail-tab[data-tab="payments"]');
  const paymentsPanel = document.getElementById('ship-detail-payments');
  const permsKnown = CURRENT_PERMS != null;
  const allow = canViewShipmentPayments();

  if (paymentsTab) {
    paymentsTab.classList.toggle('hidden', permsKnown && !allow);
  }
  if (permsKnown && !allow && paymentsTab && paymentsTab.classList.contains('active')) {
    setShipmentDetailTab('overview');
  }
  if (paymentsPanel && permsKnown && !allow) {
    paymentsPanel.classList.add('hidden');
  }
}

function refreshShipmentPaymentsForOpenDetail() {
  const modal = document.getElementById('shipment-detail-modal');
  const paymentsPanel = document.getElementById('ship-detail-payments');
  if (!modal || modal.classList.contains('hidden')) return;
  if (!paymentsPanel || !currentShipmentDetailId) return;
  if (paymentsPanel.dataset.loaded === '1') return;
  if (CURRENT_PERMS == null) return;

  const allow = canViewShipmentPayments();
  if (!allow) {
    paymentsPanel.innerHTML = '<p class="small-muted">Payment details require payroll access.</p>';
    paymentsPanel.classList.remove('hidden');
    return;
  }

  paymentsPanel.innerHTML = 'Loading…';
  loadShipmentPayments(currentShipmentDetailId, currentShipmentDetail?.shipment || {});
}
function normalizeClientNotificationPref(pref) {
  return {
    enabled: !!(pref && pref.enabled),
    statuses: Array.isArray(pref?.statuses) ? pref.statuses : [],
    project_ids: Array.isArray(pref?.project_ids) ? pref.project_ids : [],
    shipment_ids: Array.isArray(pref?.shipment_ids) ? pref.shipment_ids : [],
    notify_time: pref && pref.notify_time ? pref.notify_time : '',
    remind_every_days:
      pref && pref.remind_every_days != null ? Number(pref.remind_every_days) || 1 : 1
  };
}

function showNotificationMessage(text, color) {
  const msg = document.getElementById('shipment-notify-message');
  if (!msg) return;
  msg.textContent = text || '';
  if (color) msg.style.color = color;
}

function isShipmentNotificationConnectionIssue(err) {
  const msg = err && err.message ? String(err.message) : '';
  return !navigator.onLine || /network|failed to fetch|offline/i.test(msg);
}

async function syncShipmentNotificationPrefsQueue() {
  if (!navigator.onLine) return;
  const queue = loadSettingsQueue();
  if (!queue.length) return;

  const remaining = [];

  for (const entry of queue) {
    if (!entry || entry.type !== 'shipments_notifications') {
      continue;
    }
    try {
      const res = await fetch('/api/shipments/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getCsrfHeader() },
        body: JSON.stringify(entry.payload || {})
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          remaining.push(entry);
          break;
        }
        if (res.status >= 500) {
          remaining.push(entry);
          break;
        }
        continue;
      }
      applyShipmentNotificationPrefToUI(
        data.preference || entry.payload || DEFAULT_NOTIFICATION_PREF
      );
      await maybeStartShipmentNotificationTimer(true);
    } catch (err) {
      if (isShipmentNotificationConnectionIssue(err)) {
        remaining.push(entry);
        break;
      }
    }
  }

  replaceSettingsQueueTypes(['shipments_notifications'], remaining);
}

function renderNotificationStatusCheckboxes(statuses = []) {
  const container = document.getElementById('shipment-notify-statuses');
  if (!container) return;

  const uniqueStatuses = normalizeShipmentStatusList(statuses || []);
  const selected = new Set(
    (shipmentNotificationPref.statuses || []).map(normalizeShipmentStatusKey)
  );
  const defaultChecked = selected.size === 0;

  container.innerHTML = '';

  if (!uniqueStatuses.length) {
    const p = document.createElement('p');
    p.className = 'small-muted';
    p.textContent = 'Statuses will load after shipments finish loading.';
    container.appendChild(p);
    return;
  }

  uniqueStatuses.forEach(status => {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    const span = document.createElement('span');

    checkbox.type = 'checkbox';
    checkbox.value = status;
    checkbox.checked =
      defaultChecked || selected.has(normalizeShipmentStatusKey(status));
    span.textContent = status;

    label.appendChild(checkbox);
    label.appendChild(span);
    container.appendChild(label);
  });

  container.onchange = () => {
    const picked = Array.from(
      container.querySelectorAll('input[type="checkbox"]:checked')
    ).map(cb => cb.value);
    shipmentNotificationPref.statuses = picked;
  };
}

function refreshShipmentNotificationOptions() {
  const select = document.getElementById('shipment-notify-shipments');
  if (!select) return;

  const allShipments = [];
  const byStatus = shipmentsBoardData?.shipmentsByStatus || {};

  Object.entries(byStatus).forEach(([status, list]) => {
    (list || []).forEach(sh => {
      allShipments.push({
        id: sh.id,
        title: sh.title || 'Shipment',
        status: sh.status || status || ''
      });
    });
  });

  const selected = new Set(shipmentNotificationPref.shipment_ids || []);

  select.innerHTML = '';

  if (!allShipments.length) {
    const opt = document.createElement('option');
    opt.disabled = true;
    opt.textContent = '(shipments will appear once loaded)';
    select.appendChild(opt);
    return;
  }

  allShipments
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    .forEach(row => {
      const opt = document.createElement('option');
      opt.value = row.id;
      opt.textContent = `${row.title} — ${row.status || 'Status unknown'}`;
      opt.selected = selected.has(row.id);
      select.appendChild(opt);
    });

  select.onchange = () => {
    const ids = Array.from(select.selectedOptions || [])
      .map(opt => Number(opt.value))
      .filter(n => Number.isFinite(n));
    shipmentNotificationPref.shipment_ids = ids;
  };
}

function refreshShipmentNotificationProjects(projects = []) {
  const select = document.getElementById('shipment-notify-projects');
  if (!select) return;

  const selected = new Set(shipmentNotificationPref.project_ids || []);
  select.innerHTML = '';

  if (!projects.length) {
    const opt = document.createElement('option');
    opt.disabled = true;
    opt.textContent = '(projects will appear once loaded)';
    select.appendChild(opt);
    return;
  }

  projects
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .forEach(row => {
      const opt = document.createElement('option');
      opt.value = row.id;
      opt.textContent = row.name || `Project ${row.id}`;
      opt.selected = selected.has(row.id);
      select.appendChild(opt);
    });

  select.onchange = () => {
    const ids = Array.from(select.selectedOptions || [])
      .map(opt => Number(opt.value))
      .filter(n => Number.isFinite(n));
    shipmentNotificationPref.project_ids = ids;
  };
}

function collectShipmentNotificationForm() {
  const enabled = document.getElementById('shipment-notify-enabled')?.checked || false;
  const time = document.getElementById('shipment-notify-time')?.value || '';
  const remindEveryRaw = Number(
    document.getElementById('shipment-notify-remind')?.value || 1
  );

  const statuses = Array.from(
    document.querySelectorAll('#shipment-notify-statuses input[type="checkbox"]:checked')
  ).map(cb => cb.value);

  const projectIds = Array.from(
    document.getElementById('shipment-notify-projects')?.selectedOptions || []
  ).map(opt => Number(opt.value)).filter(n => Number.isFinite(n));

  const shipmentIds = Array.from(
    document.getElementById('shipment-notify-shipments')?.selectedOptions || []
  ).map(opt => Number(opt.value)).filter(n => Number.isFinite(n));

  return {
    enabled,
    statuses,
    project_ids: projectIds,
    shipment_ids: shipmentIds,
    notify_time: time,
    remind_every_days:
      Number.isFinite(remindEveryRaw) && remindEveryRaw >= 1
        ? Math.floor(remindEveryRaw)
        : 1
  };
}

function applyShipmentNotificationPrefToUI(pref) {
  const normalized = normalizeClientNotificationPref(pref);
  shipmentNotificationPref = normalized;

  const enabledToggle = document.getElementById('shipment-notify-enabled');
  const timeInput     = document.getElementById('shipment-notify-time');
  const remindInput   = document.getElementById('shipment-notify-remind');

  if (enabledToggle) enabledToggle.checked = !!normalized.enabled;
  if (timeInput) timeInput.value = normalized.notify_time || '';
  if (remindInput) remindInput.value = normalized.remind_every_days || 1;

  // Re-render statuses with the current selection baked in
  const sourceStatuses =
    (shipmentsBoardData && Array.isArray(shipmentsBoardData.statuses) && shipmentsBoardData.statuses.length)
      ? shipmentsBoardData.statuses
      : Object.keys(SHIPMENT_STATUS_ICONS);

  renderNotificationStatusCheckboxes(sourceStatuses);
  refreshShipmentNotificationOptions();
  refreshShipmentNotificationProjects(shipmentsProjectsCache || []);
}

async function ensureNotificationPermission() {
  if (typeof Notification === 'undefined') return false;

  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  try {
    const perm = await Notification.requestPermission();
    return perm === 'granted';
  } catch (err) {
    console.warn('Notification permission request failed:', err);
    return false;
  }
}

function getShipmentsMatchingNotification(pref) {
  const map = shipmentsBoardData?.shipmentsByStatus || {};
  const statuses = Array.isArray(pref.statuses) && pref.statuses.length
    ? new Set(pref.statuses.map(normalizeShipmentStatusKey))
    : new Set(Object.keys(map).map(normalizeShipmentStatusKey));

  const limitToProjects =
    Array.isArray(pref.project_ids) && pref.project_ids.length > 0;
  const projectIds = new Set(pref.project_ids || []);

  const limitToIds =
    Array.isArray(pref.shipment_ids) && pref.shipment_ids.length > 0;
  const ids = new Set(pref.shipment_ids || []);

  const results = [];

  Object.entries(map).forEach(([statusKey, list]) => {
    (list || []).forEach(sh => {
      const status = sh.status || statusKey || '';
      if (statuses.size && !statuses.has(normalizeShipmentStatusKey(status))) return;
      if (limitToProjects && !projectIds.has(sh.project_id)) return;
      if (limitToIds && !ids.has(sh.id)) return;
      results.push(sh);
    });
  });

  return results;
}

async function triggerShipmentNotification(force = false) {
  const pref = shipmentNotificationPref || DEFAULT_NOTIFICATION_PREF;
  const matching = getShipmentsMatchingNotification(pref);
  const title = force ? 'Test: Shipments alert' : 'Shipments alert';

  let body;
  if (!matching.length) {
    body = 'No shipments currently match your notification filters.';
  } else {
    const summary = matching.slice(0, 4).map(sh => {
      const status = sh.status || 'Status';
      const titleText = sh.title || `Shipment ${sh.id || ''}`.trim();
      return `${titleText} (${status})`;
    });
    const remainder = matching.length > 4
      ? ` + ${matching.length - 4} more`
      : '';
    body = `${summary.join(', ')}${remainder}`;
  }

  const permissionOk = await ensureNotificationPermission();
  if (permissionOk) {
    try {
      new Notification(title, { body });
    } catch (err) {
      console.warn('Browser notification failed:', err);
    }
  }

  showNotificationMessage(
    force ? `Test notification sent. ${body}` : body,
    matching.length ? 'green' : '#0f172a'
  );
}

async function checkShipmentNotificationWindow(forceNow = false) {
  if (!shipmentNotificationPref.enabled) return;

  if (!forceNow) {
    const target = shipmentNotificationPref.notify_time;
    if (!target) return;

    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const current = `${hh}:${mm}`;

    if (current !== target) return;

    const key = `${now.toISOString().slice(0, 10)}-${target}`;
    if (lastShipmentNotificationKey === key) return;
    lastShipmentNotificationKey = key;
  }

  await triggerShipmentNotification(forceNow);
}

async function maybeStartShipmentNotificationTimer(forcePing = false) {
  if (shipmentNotificationTimer) {
    clearInterval(shipmentNotificationTimer);
    shipmentNotificationTimer = null;
  }

  if (!shipmentNotificationPref.enabled || !shipmentNotificationPref.notify_time) {
    return;
  }

  const ok = await ensureNotificationPermission();
  if (!ok) {
    showNotificationMessage(
      'Enable browser notifications to receive shipment alerts.',
      '#b45309'
    );
    return;
  }

  shipmentNotificationTimer = setInterval(() => {
    checkShipmentNotificationWindow(false).catch(err => {
      console.warn('Notification tick failed:', err);
    });
  }, 30000);

  if (forcePing) {
    checkShipmentNotificationWindow(true).catch(err => {
      console.warn('Notification check failed:', err);
    });
  }
}

async function loadShipmentNotificationPrefs() {
  const panel = document.getElementById('shipments-notify-panel');
  if (panel) {
    panel.classList.remove('hidden');
  }

  try {
    const res = await fetch('/api/shipments/notifications');
    const data = await res.json().catch(() => ({}));

    if (res.status === 403) {
      if (panel) panel.classList.add('hidden');
      return;
    }

    if (!res.ok) {
      throw new Error(data.error || 'Failed to load notification preferences.');
    }

    applyShipmentNotificationPrefToUI(data.preference || DEFAULT_NOTIFICATION_PREF);
    await maybeStartShipmentNotificationTimer(false);
  } catch (err) {
    console.error('Error loading shipment notification prefs:', err);
    showNotificationMessage(err.message, 'crimson');
  }
}

async function saveShipmentNotificationPrefs() {
  const payload = collectShipmentNotificationForm();
  const btn = document.getElementById('shipment-notify-save');

  try {
    if (!navigator.onLine) {
      queueSettingsUpdate('shipments_notifications', payload);
      applyShipmentNotificationPrefToUI(payload);
      await maybeStartShipmentNotificationTimer(true);
      showNotificationMessage('Saved offline — will sync when back online.', '#b45309');
      return;
    }
    if (btn) btn.disabled = true;
    showNotificationMessage('Saving notification preferences...', '');

    const res = await fetch('/api/shipments/notifications', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getCsrfHeader() },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || 'Failed to save notification preferences.');
    }

    applyShipmentNotificationPrefToUI(
      data.preference || payload
    );
    await maybeStartShipmentNotificationTimer(true);
    showNotificationMessage('Notification preferences saved.', 'green');
  } catch (err) {
    console.error('Error saving shipment notification prefs:', err);
    if (isShipmentNotificationConnectionIssue(err)) {
      queueSettingsUpdate('shipments_notifications', payload);
      applyShipmentNotificationPrefToUI(payload);
      await maybeStartShipmentNotificationTimer(true);
      showNotificationMessage('Saved offline — will sync when back online.', '#b45309');
      return;
    }
    showNotificationMessage(err.message, 'crimson');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function getInitialsFromName(name) {
  if (!name) return '';
  const parts = String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return '';

  const first = parts[0][0] || '';
  const last  = (parts.length > 1 ? parts[parts.length - 1][0] : '') || '';

  return (first + last).toUpperCase();
}

function clearVendorFromItemRows() {
  const rows = document.querySelectorAll('.shipment-item-row');
  rows.forEach(row => {
    const input = row.querySelector('.shipment-item-vendor');
    if (!input) return;

    // For now: clear every per-row vendor
    input.value = '';
  });
}


function applyVendorToItemRowsIfNeeded() {
  const vendorSelect = document.getElementById('shipment-vendor');
  const applyAll     = document.getElementById('shipment-vendor-apply-all');
  if (!vendorSelect || !applyAll || !applyAll.checked) return;

  const idx = vendorSelect.selectedIndex;
  if (idx <= 0) return;

  const vendorText = vendorSelect.options[idx].textContent.trim();
  if (!vendorText) return;

  const rows = document.querySelectorAll('.shipment-item-row');
  rows.forEach(row => {
    const input = row.querySelector('.shipment-item-vendor');
    if (!input) return;

    // Only fill blanks so manual overrides are preserved
    if (!input.value.trim()) {
      input.value = vendorText;
    }
  });
}

function setVendorOnAllItemRows(vendorText) {
  if (!vendorText) return;
  const rows = document.querySelectorAll('.shipment-item-row');
  rows.forEach(row => {
    const input = row.querySelector('.shipment-item-vendor');
    if (input) {
      input.value = vendorText;
    }
  });
}

function syncVendorApplyAllFromItems(shipmentVendorName, items = []) {
  const applyAll = document.getElementById('shipment-vendor-apply-all');
  if (!applyAll) return;

  const headerVendor = (shipmentVendorName || '').trim();
  const vendors = new Set();
  let blanks = 0;

  (items || []).forEach(it => {
    const v = (it.vendor_name || '').trim();
    if (v) vendors.add(v);
    else blanks += 1;
  });

  const singleVendorMatchesHeader =
    vendors.size === 1 && headerVendor && vendors.has(headerVendor);

  // Only auto-check when every non-blank vendor matches the header vendor
  applyAll.checked = singleVendorMatchesHeader;

  // If apply-all is checked, push header vendor name into any blank vendor cells
  if (applyAll.checked && headerVendor) {
    const rows = document.querySelectorAll('.shipment-item-row');
    rows.forEach(row => {
      const input = row.querySelector('.shipment-item-vendor');
      if (input && !input.value.trim()) {
        input.value = headerVendor;
      }
    });
  }
}


function syncVendorApplyAllCheckbox() {
  const vendorSelect = document.getElementById('shipment-vendor');
  const applyAll     = document.getElementById('shipment-vendor-apply-all');
  if (!vendorSelect || !applyAll || !applyAll.checked) return;

  const idx = vendorSelect.selectedIndex;
  if (idx <= 0) {
    applyAll.checked = false;
    return;
  }

  const expected = (vendorSelect.options[idx].textContent || '').trim();
  if (!expected) {
    applyAll.checked = false;
    return;
  }

  const rows = document.querySelectorAll('.shipment-item-row');
  for (const row of rows) {
    const input = row.querySelector('.shipment-item-vendor');
    if (!input) continue;

    const val = (input.value || '').trim();
    if (val !== expected) {
      applyAll.checked = false;
      break;
    }
  }
}

function clearCountryOfOriginFromItemRows() {
  const rows = document.querySelectorAll('.shipment-item-row');
  rows.forEach(row => {
    const input = row.querySelector('.shipment-item-coo');
    if (!input) return;
    input.value = '';
  });
}

function applyCountryOfOriginToItemRowsIfNeeded() {
  const headerInput = document.getElementById('shipment-country-origin');
  const applyAll = document.getElementById('shipment-coo-apply-all');
  if (!headerInput || !applyAll || !applyAll.checked) return;

  const headerValue = (headerInput.value || '').trim();
  if (!headerValue) return;

  const rows = document.querySelectorAll('.shipment-item-row');
  rows.forEach(row => {
    const input = row.querySelector('.shipment-item-coo');
    if (!input) return;

    if (!input.value.trim()) {
      input.value = headerValue;
    }
  });
}

function setCountryOfOriginOnAllItemRows(value) {
  if (!value) return;
  const rows = document.querySelectorAll('.shipment-item-row');
  rows.forEach(row => {
    const input = row.querySelector('.shipment-item-coo');
    if (input) {
      input.value = value;
    }
  });
}

function syncCountryOfOriginApplyAllFromItems(headerValue, items = []) {
  const applyAll = document.getElementById('shipment-coo-apply-all');
  if (!applyAll) return;

  const headerCoo = (headerValue || '').trim();
  const countries = new Set();

  (items || []).forEach(it => {
    const v = (it.country_of_origin || '').trim();
    if (v) countries.add(v);
  });

  const singleCountryMatchesHeader =
    countries.size === 1 && headerCoo && countries.has(headerCoo);

  applyAll.checked = singleCountryMatchesHeader;

  if (applyAll.checked && headerCoo) {
    const rows = document.querySelectorAll('.shipment-item-row');
    rows.forEach(row => {
      const input = row.querySelector('.shipment-item-coo');
      if (input && !input.value.trim()) {
        input.value = headerCoo;
      }
    });
  }
}

function syncCountryOfOriginApplyAllCheckbox() {
  const headerInput = document.getElementById('shipment-country-origin');
  const applyAll = document.getElementById('shipment-coo-apply-all');
  if (!headerInput || !applyAll || !applyAll.checked) return;

  const expected = (headerInput.value || '').trim();
  if (!expected) {
    applyAll.checked = false;
    return;
  }

  const rows = document.querySelectorAll('.shipment-item-row');
  for (const row of rows) {
    const input = row.querySelector('.shipment-item-coo');
    if (!input) continue;
    const val = (input.value || '').trim();
    if (val !== expected) {
      applyAll.checked = false;
      break;
    }
  }
}

function updateVerifierTagForRow(row) {
  if (!row) return;
  const span = row.querySelector('.shipment-item-verifier-tag');
  if (!span) return;

  const v = row._verification || {};

  // whatever you stored as verified_by (usually name or email)
  const raw = v.verified_by || '';

  // initials from that value
  const initials = raw ? getInitialsFromName(raw) : '';

  span.textContent = initials || '';
  span.dataset.fullLabel = raw || '';        // <-- full name/email for tooltip

  // show/hide styling
  span.classList.toggle('has-initials', !!initials);
}

function normalizeItemVerification(raw, fallbackNotes = '') {
  let v = raw;

  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      v = null;
    }
  }

  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    v = {};
  }

  return {
    status: v.status || '',
    verified_by: v.verified_by ?? v.verifiedBy ?? null,
    verified_at: v.verified_at ?? v.verifiedAt ?? '',
    storage_override: v.storage_override ?? v.storage ?? '',
    notes: v.notes ?? fallbackNotes ?? '',
    issue_type: v.issue_type ?? v.issueType ?? '',
    history: Array.isArray(v.history) ? v.history : []
  };
}

function extractItemVerification(initial = {}) {
  if (!initial) return normalizeItemVerification({});

  if (initial.verification) {
    return normalizeItemVerification(initial.verification, initial.notes);
  }

  if (initial.verification_json || initial.verificationJson) {
    return normalizeItemVerification(
      initial.verification_json || initial.verificationJson,
      initial.notes
    );
  }

  return normalizeItemVerification(
    {
      status: initial.verified ? 'verified' : '',
      notes: initial.notes || ''
    },
    initial.notes
  );
}

function rowStatusCellHtml(verification) {
  const v = normalizeItemVerification(verification);
  const status = v.status || '';
  const selected = (val) => (status === val ? ' selected' : '');

  return `
    <select class="shipment-item-status">
      <option value="">Status…</option>
      <option value="verified"${selected('verified')}>Verified</option>
      <option value="missing"${selected('missing')}>Missing</option>
      <option value="damaged"${selected('damaged')}>Damaged</option>
      <option value="wrong_item"${selected('wrong_item')}>Wrong item</option>
    </select>
    <span class="shipment-item-verifier-tag"></span>
  `;
}




 

function populateStatusDropdown(statuses) {
  const menu = document.getElementById('status-dropdown-menu');
  const label = document.getElementById('status-dropdown-label');
  const icon = document.getElementById('status-dropdown-icon');
  const uniqueStatuses = normalizeShipmentStatusList(statuses || []);

  menu.innerHTML = '';

  // Default
  const defaultOption = document.createElement('div');
  defaultOption.innerHTML = `<img src="" class="dropdown-icon"><span>All statuses</span>`;
  defaultOption.addEventListener('click', () => {
    label.textContent = "All statuses";
    icon.src = "";
    currentStatusFilter = "";
    loadShipmentsBoard();
    menu.classList.add('hidden');
  });
  menu.appendChild(defaultOption);

  // Each status
  uniqueStatuses.forEach(st => {
    const row = document.createElement('div');
    const src = SHIPMENT_STATUS_ICONS[st] || "";

    row.innerHTML = `
      <img src="${src}" class="dropdown-icon">
      <span>${st}</span>
    `;

    row.addEventListener('click', () => {
      label.textContent = st;
      icon.src = src;
      currentStatusFilter = st;
      loadShipmentsBoard().then(() => {
        const summaryView = document.getElementById('shipments-view-summary');
        if (summaryView && !summaryView.classList.contains('hidden')) {
          loadShipmentsSummary({ force: true, skipBoardLoad: true });
        }
      });
      menu.classList.add('hidden');
    });

    menu.appendChild(row);
  });
}

function setStatusDropdownSelection(status) {
  const label = document.getElementById('status-dropdown-label');
  const icon = document.getElementById('status-dropdown-icon');
  if (!label || !icon) return;

  const normalized = status ? normalizeShipmentStatusLabel(status) : '';
  if (!normalized) {
    label.textContent = 'All statuses';
    icon.src = '';
    return;
  }

  label.textContent = normalized;
  icon.src = SHIPMENT_STATUS_ICONS[normalized] || '';
}

function applyShipmentStatusFilter(status) {
  const normalized = status
    ? (matchNormalizedStatus(status, shipmentsBoardData.statuses || []) ||
        normalizeShipmentStatusLabel(status))
    : '';
  currentStatusFilter = normalized || '';
  setStatusDropdownSelection(currentStatusFilter);
  loadShipmentsBoard().then(() => {
    const summaryView = document.getElementById('shipments-view-summary');
    if (summaryView && !summaryView.classList.contains('hidden')) {
      loadShipmentsSummary({ force: true, skipBoardLoad: true });
    }
  });

  const section = document.getElementById('section-shipments');
  if (section) {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function handleShipmentColumnDragStart(evt) {
  if (shipmentsColumnSortMode !== 'custom') return;
  if (evt.target && evt.target.closest && evt.target.closest('.shipment-card')) {
    return;
  }
  const status = evt.currentTarget?.dataset?.status || '';
  const key = normalizeShipmentStatusKey(status);
  if (!key) return;
  draggingColumnStatusKey = key;
  if (evt.dataTransfer) {
    evt.dataTransfer.effectAllowed = 'move';
    evt.dataTransfer.setData('text/plain', key);
  }
  evt.currentTarget.classList.add('shipments-column--dragging');
}

function handleShipmentColumnDragOver(evt) {
  evt.preventDefault();
  if (draggingShipmentId) {
    if (evt.dataTransfer) {
      evt.dataTransfer.dropEffect = 'move';
    }
    return;
  }
  if (shipmentsColumnSortMode !== 'custom') return;
  if (evt.dataTransfer) {
    evt.dataTransfer.dropEffect = 'move';
  }
}

function handleShipmentColumnDragEnd(evt) {
  evt.currentTarget.classList.remove('shipments-column--dragging');
  draggingColumnStatusKey = null;
}

function handleShipmentColumnDrop(evt) {
  evt.preventDefault();
  if (draggingShipmentId) {
    const newStatus = evt.currentTarget?.dataset?.status;
    if (newStatus) onShipmentDrop(evt, newStatus);
    return;
  }
  if (shipmentsColumnSortMode !== 'custom') return;
  const targetStatus = evt.currentTarget?.dataset?.status || '';
  const targetKey = normalizeShipmentStatusKey(targetStatus);
  const sourceKey =
    draggingColumnStatusKey ||
    (evt.dataTransfer ? evt.dataTransfer.getData('text/plain') : '');

  if (!sourceKey || !targetKey || sourceKey === targetKey) return;

  const ordered = getOrderedShipmentStatuses(shipmentsBoardData.statuses || []);
  const keys = ordered.map(st => normalizeShipmentStatusKey(st));
  const fromIdx = keys.indexOf(sourceKey);
  const toIdx = keys.indexOf(targetKey);
  if (fromIdx < 0 || toIdx < 0) return;

  keys.splice(fromIdx, 1);
  keys.splice(toIdx, 0, sourceKey);
  shipmentsColumnOrder = keys;
  shipmentsColumnSortMode = 'custom';
  saveShipmentsColumnPrefs();
  updateShipmentsSortToggleLabel();
  renderShipmentsBoard();
}

function canVerifyItems(status) {
  if (!status) return false;
  const s = status.trim().toLowerCase();
  if (s.includes('archived')) return true;
  return s.includes('picked') && s.includes('up');
}

function closeItemVerificationModal() {
  const backdrop = document.getElementById('item-verification-backdrop');
  const modal    = document.getElementById('item-verification-modal');
  if (backdrop) backdrop.classList.add('hidden');
  if (modal)    modal.classList.add('hidden');
  currentVerificationRow = null;
}

function appendVerificationHistory(vMeta, prevStatus, newStatus) {
  if (prevStatus === newStatus) return;

  vMeta.history = Array.isArray(vMeta.history) ? vMeta.history : [];

  const emp = CURRENT_EMPLOYEE || {};
  const currentEmpId =
    emp.employee_id ||
    emp.id ||
    null;

  const currentName =
    emp.display_name ||
    emp.name ||
    emp.email ||
    null;

  vMeta.history.push({
    at: new Date().toISOString(),
    from_status: prevStatus || '',
    to_status: newStatus || '',
    by_employee_id: currentEmpId,
    by_name: currentName,
    notes: vMeta.notes || null,   // best-effort; may be null
    storage_override: vMeta.storage_override || ''
  });
}


function getCurrentVerifierInfo() {
  // Try employee first, then user
  const emp = CURRENT_EMPLOYEE || CURRENT_USER || null;
  if (!emp) {
    return { id: null, name: null };
  }

  const id =
    emp.employee_id ||
    emp.id ||
    null;

  const name =
    emp.display_name ||
    emp.name ||
    emp.email ||
    null;

  return { id, name };
}

async function saveSingleItemVerification(shipmentId, itemId, verification) {
  const sid = Number(shipmentId);
  const iid = Number(itemId);
  if (!sid || !iid || !verification) return;

  try {
    await fetchJSON(`/api/shipments/${sid}/verify-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          {
            shipment_item_id: iid,
            verification
          }
        ]
      })
    });
  } catch (err) {
    console.error('Error saving item verification inline:', err);
  }
}



// Auto-fill the top-level "Shipment verified by" if it's empty
function autoFillShipmentVerifiedByIfEmpty() {
// Intentionally blank: we now track verification per line only
}

function setupItemVerificationModal() {
  const closeBtn   = document.getElementById('item-verification-close');
  const cancelBtn  = document.getElementById('item-verification-cancel');
  const saveBtn    = document.getElementById('item-verification-save');
  const deleteBtn  = document.getElementById('item-verification-delete');
  const statusSel  = document.getElementById('item-verification-status');
  const inlineSave = document.getElementById('item-verification-edit-status');

  if (closeBtn)  closeBtn.addEventListener('click', closeItemVerificationModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeItemVerificationModal);

  // Pretty dropdown UI
  initItemVerificationStatusUI();

  if (statusSel) {
    statusSel.addEventListener('change', () => {
      const dateInput  = document.getElementById('item-verification-date');
      const byInput    = document.getElementById('item-verification-verified-by');
      const historyList = document.getElementById('item-verification-history');
      const { name: currentEmpName } = getCurrentVerifierInfo();

      if (statusSel.value) {
        if (dateInput) {
          dateInput.value = new Date().toISOString().slice(0, 10);
        }
        if (byInput) {
          byInput.value = currentEmpName || byInput.value || '';
        }
      }

      applyItemStatusStyle(statusSel);
      syncItemVerificationStatusUI(statusSel.value);
      const v = currentVerificationRow ? currentVerificationRow._verification || {} : {};
      renderItemVerificationHistory(v, historyList);
    });
  }

  if (inlineSave) {
    inlineSave.addEventListener('click', (e) => {
      e.preventDefault();
      if (inlineSave.disabled) return;

      const isEditing = inlineSave.dataset.editing === '1';

      if (!isEditing) {
        // First click: unlock fields for override/edit without closing modal
        setVerificationInputsDisabled(false);
        inlineSave.dataset.editing = '1';
        inlineSave.textContent = 'Click here to save updated verification information';
        inlineSave.classList.add('inline-save-active');
        inlineSave.classList.remove('override-state');
        return;
      }

      // Second click: commit via main save button
      const saveButton = document.getElementById('item-verification-save');
      if (saveButton) saveButton.click();
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      if (!currentVerificationRow) {
        closeItemVerificationModal();
        return;
      }

      const byInput    = document.getElementById('item-verification-verified-by');
      const dateInput  = document.getElementById('item-verification-date');
      const storageInp = document.getElementById('item-verification-storage');
      const notesArea  = document.getElementById('item-verification-notes');
      const issueSel   = document.getElementById('item-verification-issue-type');
      const rowStatus  = currentVerificationRow.querySelector('.shipment-item-status');

      const v = currentVerificationRow._verification || {};
const oldStatus = v.status || '';

const newStatus = statusSel ? (statusSel.value || '') : '';

const manualName = byInput ? byInput.value.trim() : '';

const storageOverride = storageInp ? storageInp.value.trim() : null;
const notes           = notesArea ? notesArea.value.trim() : null;
const issueType       = issueSel ? (issueSel.value || null) : null;

const { id: currentEmpId, name: currentEmpName } = getCurrentVerifierInfo();

// Decide what name to store for this "current" verification
const finalName =
  manualName ||
  v.verified_by ||
  currentEmpName ||
  null;

// Auto-managed verification date: set on status changes or when missing.
const statusChanged = newStatus !== oldStatus;
let finalDate;

if (newStatus) {
  const existingDate = v.verified_at || null;
  finalDate = (statusChanged || !existingDate)
    ? new Date().toISOString().slice(0, 10)
    : existingDate;
} else {
  finalDate = null;
}

// Update the "current state" of verification
v.status           = newStatus;
v.verified_by      = newStatus ? finalName : null;
v.verified_at      = newStatus ? finalDate : null;
v.storage_override = storageOverride;
v.notes            = notes;
v.issue_type       = issueType;
      // Maintain a history trail for this item
      if (!Array.isArray(v.history)) {
        v.history = [];
      }

      const nowIso = new Date().toISOString();

v.history.push({
  at: nowIso,
  from_status: oldStatus || '',
  to_status: newStatus || '',
  by_employee_id: currentEmpId || null,
  by_name: finalName || null,
  notes: notes || null,
  storage_override: storageOverride || null
});


      currentVerificationRow._verification = v;

      if (rowStatus) {
        rowStatus.value = v.status || '';
        applyItemStatusStyle(rowStatus);
        // keep top-level verified-by in sync if empty
        if (v.status) {
          autoFillShipmentVerifiedByIfEmpty();
        }
      }

      // Update initials tag for this row based on verification meta
      updateVerifierTagForRow(currentVerificationRow);

      // Persist inline so kiosk/admin stay in sync without requiring full Save
      const shipmentIdInput = document.getElementById('shipment-id');
      const shipmentId = shipmentIdInput ? shipmentIdInput.value : null;
      const itemId = currentVerificationRow.dataset.itemId || currentVerificationRow.dataset.id;
      saveSingleItemVerification(shipmentId, itemId, v);

      // After save, re-lock fields and reset edit button
      setVerificationInputsDisabled(false);
      const inlineSaveBtn = document.getElementById('item-verification-edit-status');
      if (inlineSaveBtn) inlineSaveBtn.textContent = 'Edit verification info';
      itemVerificationEditMode = false;

      closeItemVerificationModal();

    });
  }

  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      if (!currentVerificationRow) {
        closeItemVerificationModal();
        return;
      }
      const ok = window.confirm('Delete this item from the shipment?');
      if (!ok) return;

      currentVerificationRow.remove();
      currentVerificationRow = null;
      recalcShipmentItemsTotal({ fromUser: true });
      closeItemVerificationModal();
    });
  }
}


function formatMoneyInput(el) {
  if (!el) return;
  let v = parseFloat(el.value);
  if (isNaN(v)) {
    el.value = "";
    return;
  }
  el.value = v.toFixed(2);
}

function normalizeDateOnly(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return '';
}


function applyItemStatusStyle(selectEl) {
  if (!selectEl) return;

  selectEl.classList.remove(
    'item-status-verified',
    'item-status-damaged',
    'item-status-issue',
    'item-status-missing',
    'item-status-wrong_item'
  );

  switch (selectEl.value) {
    case 'verified':
      selectEl.classList.add('item-status-verified');
      break;
    case 'issue':
      selectEl.classList.add('item-status-damaged');
      break;
    case 'damaged':
      selectEl.classList.add('item-status-damaged');
      break;
    case 'missing':
      selectEl.classList.add('item-status-missing');
      break;
    case 'wrong_item':
      selectEl.classList.add('item-status-wrong_item');
      break;
  }
}

function openItemVerificationModal(row) {
  currentVerificationRow = row;

  const modal = document.getElementById('item-verification-modal');
  if (!modal) return;

  const desc = row.querySelector('.shipment-item-desc')?.value || '';
  const sku  = row.querySelector('.shipment-item-sku')?.value || '';
  const normalizedVerification = normalizeItemVerification(row._verification);
  row._verification = normalizedVerification;

  const header = document.getElementById('item-verification-header');
  if (header) {
    header.textContent = desc
      ? `Verify item: ${desc}`
      : (sku ? `Verify item: ${sku}` : 'Verify item');
  }

  const statusSel = document.getElementById('item-verification-status');
  const rowStatus = row.querySelector('.shipment-item-status');

  const v = row._verification || {};

  // Status dropdown
  if (statusSel) {
    statusSel.value = v.status || rowStatus?.value || '';
    applyItemStatusStyle(statusSel);
    syncItemVerificationStatusUI(statusSel.value);
  }

  // Inputs inside modal
  const byInput    = document.getElementById('item-verification-verified-by');
  const dateInput  = document.getElementById('item-verification-date');
  const storageInp = document.getElementById('item-verification-storage');
  const notesInput = document.getElementById('item-verification-notes');
  const issueSel   = document.getElementById('item-verification-issue-type');
  const editStatusBtn = document.getElementById('item-verification-edit-status');
  const historyList = document.getElementById('item-verification-history');
  const historyToggle = document.getElementById('item-verification-toggle-history');
  const historyPanel = document.getElementById('item-verification-history-panel');
  const historyClose = document.getElementById('item-verification-history-close');

  // Default "verified by" = existing value or current logged-in employee
  const { name: currentEmpName } = getCurrentVerifierInfo();
  const defaultName =
    v.verified_by ||
    currentEmpName ||
    '';

  if (byInput)   byInput.value   = defaultName;
  if (dateInput) dateInput.value = normalizeDateOnly(v.verified_at);
  if (storageInp) storageInp.value = v.storage_override || '';
  if (notesInput) notesInput.value = v.notes || '';
  if (issueSel)  issueSel.value  = v.issue_type || '';
  const itemLabel = desc || sku || '';
  renderItemVerificationHistory(v, historyList, itemLabel);

  if (historyToggle) {
    historyToggle.textContent = 'View log';
    historyToggle.onclick = () => {
      if (!historyList || !historyPanel) return;
      const itemLabel = desc || sku || '';
      renderItemVerificationHistory(v, historyList, itemLabel);
      historyPanel.classList.remove('hidden');
    };
  }

  if (historyClose && historyPanel) {
    historyClose.onclick = () => {
      historyPanel.classList.add('hidden');
    };
  }

  if (editStatusBtn) {
    const locked = !!(v.status && v.status.trim());
    editStatusBtn.classList.remove('hidden');
    editStatusBtn.disabled = false;
    editStatusBtn.textContent = locked
      ? 'Shipment already verified — click here to override'
      : 'Edit verification info';
    editStatusBtn.dataset.editing = '0';
    if (locked) {
      editStatusBtn.classList.remove('inline-save-active');
      editStatusBtn.classList.remove('override-state');
    } else {
      editStatusBtn.classList.remove('override-state');
      editStatusBtn.classList.remove('inline-save-active');
    }
  }
  // Lock editing if already verified; allow when empty.
  const locked = !!(v.status && v.status.trim());
  setVerificationInputsDisabled(locked);

  modal.classList.remove('hidden');
}

function renderItemVerificationHistory(vMeta = {}, listEl, itemLabel = '') {
  if (!listEl) return;
  listEl.innerHTML = '';

  const history = Array.isArray(vMeta.history) ? vMeta.history.slice() : [];

  // Add header row
  const header = document.createElement('li');
  header.className = 'verification-history-header-row';
  header.innerHTML = `
    <span>Item</span>
    <span>Status</span>
    <span>By</span>
    <span>Date</span>
    <span>Time</span>
    <span>Notes</span>
    <span>Storage</span>
  `;
  listEl.appendChild(header);

  if (history.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No history yet.';
    li.className = 'small-muted';
    listEl.appendChild(li);
    return;
  }

  history
    .slice()
    .reverse()
    .forEach(entry => {
      const li = document.createElement('li');
      const whenDate = entry.at ? new Date(entry.at) : null;
      const dateStr = whenDate ? formatDateUS(whenDate) : '';
      const timeStr = whenDate ? whenDate.toLocaleTimeString([], { hour12: true }) : '';
      const status = entry.to_status || '(unknown)';
      const by = entry.by_name || 'Unknown';
      const note = entry.notes && entry.notes.trim() ? entry.notes : '—';
      const storage =
        entry.storage_override && entry.storage_override.trim()
          ? entry.storage_override
          : '—';
      const statusClass = status
        ? `hist-status-${status.replace(/\s+/g, '_').toLowerCase()}`
        : 'hist-status-unknown';

      li.className = 'verification-history-row';
      li.innerHTML = `
        <span class="hist-item">${itemLabel || '(Item)'}</span>
        <span class="hist-status ${statusClass}">${status}</span>
        <span class="hist-meta hist-by">${by}</span>
        <span class="hist-meta hist-date">${dateStr}</span>
        <span class="hist-meta hist-time">${timeStr}</span>
        <span class="hist-notes">${note}</span>
        <span class="hist-storage">${storage}</span>
      `;
      listEl.appendChild(li);
    });
}



// ───────── ITEM VERIFICATION STATUS CUSTOM UI ─────────

function getItemVerificationStatusUIElements() {
  const root = document.getElementById('item-verification-status-ui');
  if (!root) return {};
  return {
    root,
    trigger: root.querySelector('.select-trigger'),
    label: root.querySelector('.select-label'),
    menu: root.querySelector('.select-menu'),
    options: Array.from(root.querySelectorAll('.select-option'))
  };
}

function syncItemVerificationStatusUI(value) {
  const statusSel = document.getElementById('item-verification-status');
  const { root, label, options } = getItemVerificationStatusUIElements();
  if (!root || !label || !options || !options.length || !statusSel) return;

  const val = value || '';
  const match =
    options.find(btn => (btn.dataset.value || '') === val) || options[0];

  // Update visible label text
  label.textContent = match.textContent.trim();

  // Highlight active option
  options.forEach(btn => {
    btn.classList.toggle('active', btn === match);
  });
}

function initItemVerificationStatusUI() {
  if (initItemVerificationStatusUI._init) return;
  initItemVerificationStatusUI._init = true;

  const statusSel = document.getElementById('item-verification-status');
  const { root, trigger, label, menu, options } =
    getItemVerificationStatusUIElements();

  if (!root || !trigger || !menu || !options || !options.length || !statusSel) {
    return;
  }

  // Toggle menu open/close
  trigger.addEventListener('click', () => {
    menu.classList.toggle('hidden');
  });

  // Option clicks: update hidden select + UI + existing logic
  options.forEach(btn => {
    btn.addEventListener('click', () => {
      const value = btn.dataset.value || '';
      statusSel.value = value;

      // Fire existing change handler so applyItemStatusStyle still runs
      statusSel.dispatchEvent(new Event('change', { bubbles: true }));

      syncItemVerificationStatusUI(value);
      menu.classList.add('hidden');
    });
  });

  // Close when clicking outside
  document.addEventListener('click', evt => {
    if (!root.contains(evt.target)) {
      menu.classList.add('hidden');
    }
  });

  // Initial sync
  syncItemVerificationStatusUI(statusSel.value || '');
}


function setVerificationInputsDisabled(disabled) {
  const controls = [
    document.getElementById('item-verification-status'),
    document.getElementById('item-verification-date'),
    document.getElementById('item-verification-verified-by'),
    document.getElementById('item-verification-storage'),
    document.getElementById('item-verification-notes'),
    document.getElementById('item-verification-issue-type')
  ];

  controls.forEach(el => {
    if (!el) return;
    el.disabled = disabled;
    if (el.id === 'item-verification-verified-by' || el.id === 'item-verification-date') {
      el.readOnly = true;
    } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.readOnly = disabled;
    }
  });

  const statusUI = document.getElementById('item-verification-status-ui');
  if (statusUI) statusUI.classList.toggle('disabled', disabled);
}


function toggleShipmentVerificationSection(statusValue) {
  const section = document.getElementById('shipment-items-verification');
  if (!section) return;

  const allowed = canVerifyItems(statusValue);

  // Show/hide the little "All items verified / Verified by / notes" strip
  section.classList.toggle('hidden', !allowed);

  // IMPORTANT: do NOT clear verification values when status changes.
  // We want them to persist if the shipment is moved backwards.
}



function initShipmentVerificationControls() {
  // ✅ Prevent double-binding when modal is opened multiple times
  if (initShipmentVerificationControls._init) return;
  initShipmentVerificationControls._init = true;

  const verifyAll = document.getElementById('shipment-verify-all');
  if (!verifyAll) return;

  verifyAll.addEventListener('change', () => {
    const selects = Array.from(
      document.querySelectorAll('.shipment-item-status')
    );

    if (!selects.length) return;

    const { name: currentEmpName } = getCurrentVerifierInfo();

    if (verifyAll.checked) {
      // ✅ CHECKED → mark every item as verified
      selects.forEach(sel => {
        const row = sel.closest('.shipment-item-row');
        if (!row) return;

        row._verification = row._verification || {};
        const prevStatus = row._verification.status || '';
        const newStatus  = 'verified';

        sel.value = newStatus;
        row._verification.status = newStatus;

        if (currentEmpName) {
          row._verification.verified_by = currentEmpName;
          row._verification.verified_at = new Date().toISOString().slice(0, 10);
        }

        if (typeof appendVerificationHistory === 'function') {
          appendVerificationHistory(row._verification, prevStatus, newStatus);
        }

        updateVerifierTagForRow(row);
        applyItemStatusStyle(sel);
      });

      if (typeof autoFillShipmentVerifiedByIfEmpty === 'function') {
        autoFillShipmentVerifiedByIfEmpty();
      }
    } else {
      // ✅ UNCHECKED → clear statuses & verifier info
      selects.forEach(sel => {
        const row = sel.closest('.shipment-item-row');
        if (!row) return;

        row._verification = row._verification || {};
        const prevStatus = row._verification.status || '';
        const newStatus  = '';

        sel.value = '';
        row._verification.status      = '';
        row._verification.verified_by = null;
        row._verification.verified_at = null;
        // (keep notes / storage_override / issue_type if you want)

        if (typeof appendVerificationHistory === 'function') {
          appendVerificationHistory(row._verification, prevStatus, newStatus);
        }

        updateVerifierTagForRow(row);
        applyItemStatusStyle(sel);
      });
    }

    // Sync after all modifications
    syncVerifyAllCheckboxState();
  });

  // Initial sync when page loads / modal opens
  syncVerifyAllCheckboxState();
}







function recalcShipmentItemsTotal(options = {}) {
  const fromUser =
    typeof options === 'boolean' ? options : !!options.fromUser;
  const rows = Array.from(document.querySelectorAll('.shipment-item-row'));
  let total = 0;

  rows.forEach(row => {
    const qtyInput = row.querySelector('.shipment-item-qty');
    const unitInput = row.querySelector('.shipment-item-unit');
    const lineDisplay = row.querySelector('.shipment-item-total');

const qty = parseFloat(qtyInput?.value || '0') || 0;
const unit = parseFloat(unitInput?.value || '0') || 0;
const lineTotal = qty * unit;

if (lineDisplay) {
  lineDisplay.textContent = formatMoney(lineTotal);
}


    total += lineTotal;
  });

  const totalDisplay = document.getElementById('shipment-items-total-display');
  const totalHidden = document.getElementById('shipment-total-price');
  const totalOverride = document.getElementById('shipment-total-price-override');

  if (totalDisplay) {
    totalDisplay.textContent = formatMoney(total);
  }
  if (totalHidden) {
    totalHidden.value = total ? total.toFixed(2) : '';
  }
  if (totalOverride && !totalOverride.value) {
    totalOverride.placeholder = total ? total.toFixed(2) : '0.00';
  }

  if (lastItemsTotalValue === null) {
    lastItemsTotalValue = total;
    return;
  }

  if (!fromUser) {
    if (!totalOverride || !totalOverride.value) {
      lastOverridePromptTotal = null;
    }
    lastItemsTotalValue = total;
    return;
  }

  if (totalOverride && totalOverride.value && total !== lastItemsTotalValue) {
    if (overridePromptTimer) clearTimeout(overridePromptTimer);
    overridePromptTimer = setTimeout(() => {
      maybePromptRecalculateTotal(total);
    }, 250);
  } else if (!totalOverride || !totalOverride.value) {
    lastOverridePromptTotal = null;
  }

  lastItemsTotalValue = total;
}

async function maybePromptRecalculateTotal(total) {
  const totalOverride = document.getElementById('shipment-total-price-override');
  const totalHidden = document.getElementById('shipment-total-price');
  if (!totalOverride || !totalOverride.value) return;
  if (overridePromptInFlight) return;
  if (lastOverridePromptTotal === total) return;

  overridePromptInFlight = true;
  lastOverridePromptTotal = total;

  const ok = await showYesNoPrompt(
    'Total price is manually overridden. Recalculate from item totals?',
    { yesLabel: 'Recalculate', noLabel: 'Keep manual' }
  );

  if (ok) {
    totalOverride.value = '';
    totalOverride.placeholder = total ? total.toFixed(2) : '0.00';
    if (totalHidden) {
      totalHidden.value = total ? total.toFixed(2) : '';
    }
    lastOverridePromptTotal = null;
  }

  overridePromptInFlight = false;
}

function addShipmentItemRow(initial) {
  const container = document.getElementById('shipment-items-rows');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'shipment-item-row';
  row.dataset.itemId = initial && initial.id ? String(initial.id) : '';

  const desc = (initial && initial.description) || '';
  const sku  = (initial && initial.sku) || '';
  const qty  =
    initial && typeof initial.quantity === 'number'
      ? initial.quantity
      : '';
  const unit =
    initial && typeof initial.unit_price === 'number'
      ? initial.unit_price
      : '';
  const lineTotal =
    initial && typeof initial.line_total === 'number'
      ? initial.line_total
      : 0;
  const baseVerification = extractItemVerification(initial);

  // Figure out default vendor for this row (header vendor + "apply to all")
  const vendorSelect   = document.getElementById('shipment-vendor');
  const vendorApplyAll = document.getElementById('shipment-vendor-apply-all');
  const cooInputHeader = document.getElementById('shipment-country-origin');
  const cooApplyAll    = document.getElementById('shipment-coo-apply-all');

  let vendorValue =
    initial && typeof initial.vendor_name === 'string'
      ? initial.vendor_name
      : '';
  let cooValue =
    initial && typeof initial.country_of_origin === 'string'
      ? initial.country_of_origin
      : '';

  // If no per-item vendor yet and "apply to all" is on, copy header vendor name
  if (!vendorValue && vendorSelect && vendorApplyAll && vendorApplyAll.checked) {
    const idx = vendorSelect.selectedIndex;
    if (idx > 0) {
      vendorValue = vendorSelect.options[idx].textContent.trim();
    }
  }
  if (!cooValue && cooInputHeader && cooApplyAll && cooApplyAll.checked) {
    const headerValue = cooInputHeader.value.trim();
    if (headerValue) {
      cooValue = headerValue;
    }
  }

  row.innerHTML = `
  <div>
    <input
      type="text"
      class="shipment-item-desc"
      placeholder="Description"
      value="${escapeHTML(desc)}"
    />
  </div>
  <div>
    <input
      type="text"
      class="shipment-item-sku"
      placeholder="SKU / Ref"
      value="${escapeHTML(sku)}"
    />
  </div>
  <div>
    <input
      type="text"
      class="shipment-item-coo"
      placeholder="Country"
      value="${escapeHTML(cooValue || '')}"
    />
  </div>
  <div>
    <input
      type="text"
      class="shipment-item-vendor"
      placeholder="Vendor"
      value="${escapeHTML(vendorValue || '')}"
    />
  </div>
  <div>
    <input
      type="number"
      min="0"
      step="1"
      class="shipment-item-qty"
      value="${qty !== '' ? qty : ''}"
    />
  </div>
  <div>
    <input
      type="number"
      min="0"
      step="0.01"
      class="shipment-item-unit"
      value="${unit !== '' ? unit : ''}"
    />
  </div>
  <div>
    <span class="shipment-item-total">${formatMoney(lineTotal)}</span>
  </div>
  <div class="shipment-item-status-cell">
    ${rowStatusCellHtml(baseVerification)}
  </div>
  <div class="shipment-item-actions">
    <button
      type="button"
      class="icon-button shipment-item-edit"
      title="Verify / edit"
    >
      ✎
    </button>
  </div>
`;


  // Hook up events
  const qtyInput     = row.querySelector('.shipment-item-qty');
  const unitInput    = row.querySelector('.shipment-item-unit');
  const statusSelect = row.querySelector('.shipment-item-status');
  const editBtn      = row.querySelector('.shipment-item-edit');
  const vendorInput  = row.querySelector('.shipment-item-vendor');
  const cooInput     = row.querySelector('.shipment-item-coo');
  const deleteBtn    = row.querySelector('.shipment-item-delete');

  // Verification meta
  row._verification = baseVerification;

  // Initialize initials tag from existing verification (if any)
  updateVerifierTagForRow(row);

  const recalc = () => recalcShipmentItemsTotal({ fromUser: true });

  qtyInput?.addEventListener('input', recalc);
  unitInput?.addEventListener('input', recalc);

  // Format money for unit price on blur
  unitInput?.addEventListener('blur', () => {
    formatMoneyInput(unitInput);
    recalcShipmentItemsTotal({ fromUser: true });
  });

  if (vendorInput) {
    vendorInput.addEventListener('input', () => {
      syncVendorApplyAllCheckbox();
    });
  }
  if (cooInput) {
    cooInput.addEventListener('input', () => {
      syncCountryOfOriginApplyAllCheckbox();
    });
  }

  if (statusSelect) {
    // If row already has a verification status, load it
    if (row._verification && row._verification.status) {
      statusSelect.value = row._verification.status;
    }
    applyItemStatusStyle(statusSelect);

    statusSelect.addEventListener('change', () => {
      row._verification = row._verification || {};

      const prevStatus = row._verification.status || '';
      const newStatus  = statusSelect.value || '';

      // Update status
      row._verification.status = newStatus;

      if (newStatus) {
        const { name: currentName } = getCurrentVerifierInfo();

        // Only use the current logged-in person
        const finalName = currentName || null;

        if (finalName) {
          row._verification.verified_by = finalName;
        }

        // Store date-only so it fits the date input
        row._verification.verified_at = new Date().toISOString().slice(0, 10);
      } else {
        // Status cleared → clear verifier info
        row._verification.verified_by = null;
        row._verification.verified_at = null;
      }

      // History
      if (typeof appendVerificationHistory === 'function') {
        appendVerificationHistory(row._verification, prevStatus, newStatus);
      }

      // Update initials tag
      updateVerifierTagForRow(row);

      // UI updates
      applyItemStatusStyle(statusSelect);
      syncVerifyAllCheckboxState();

      if (
        newStatus &&
        typeof autoFillShipmentVerifiedByIfEmpty === 'function'
      ) {
        autoFillShipmentVerifiedByIfEmpty();
      }
    });
  }

  if (editBtn) {
    editBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openItemVerificationModal(row);
    });
  }

  if (deleteBtn) {
    deleteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const ok = window.confirm('Delete this item from the shipment?');
      if (!ok) return;

      row.remove();
      recalcShipmentItemsTotal({ fromUser: true });
      syncVerifyAllCheckboxState();
    });
  }

  container.appendChild(row);
  recalcShipmentItemsTotal();
  syncVerifyAllCheckboxState();
  syncVendorApplyAllCheckbox();
  syncCountryOfOriginApplyAllCheckbox();
}


function applyItemVerificationLockForStatus(statusValue) {
  const allowed = canVerifyItems(statusValue);
  const rows = document.querySelectorAll('.shipment-item-row');

  rows.forEach(row => {
    const statusSel = row.querySelector('.shipment-item-status');
    const editBtn   = row.querySelector('.shipment-item-edit');

    // Only lock/unlock verification bits, nothing else
    if (statusSel) {
      statusSel.disabled = !allowed;
    }

    if (editBtn) {
      editBtn.disabled = !allowed;
      // optional visual cue
      editBtn.classList.toggle('verification-locked', !allowed);
    }
  });
}




function syncVerifyAllCheckboxState() {
  const verifyAll = document.getElementById('shipment-verify-all');
  if (!verifyAll) return;

  const selects = Array.from(
    document.querySelectorAll('.shipment-item-status')
  );

  if (!selects.length) {
    verifyAll.checked = false;
    return;
  }

  const allVerified = selects.every(sel => sel.value === 'verified');
  verifyAll.checked = allVerified;
}




function initShipmentItemsSection() {
  const container = document.getElementById('shipment-items-rows');
  const totalDisplay = document.getElementById('shipment-items-total-display');
  const totalHidden = document.getElementById('shipment-total-price');
  const totalOverride = document.getElementById('shipment-total-price-override');
  const vendorApplyAll = document.getElementById('shipment-vendor-apply-all');
  const cooApplyAll = document.getElementById('shipment-coo-apply-all');

  if (container) container.innerHTML = '';
  if (totalDisplay) totalDisplay.textContent = '$0.00';
  if (totalHidden) totalHidden.value = '';
  if (totalOverride) {
    totalOverride.value = '';
    totalOverride.placeholder = 'Use items total';
  }
  if (vendorApplyAll) vendorApplyAll.checked = false;
  if (cooApplyAll) cooApplyAll.checked = false;
  lastItemsTotalValue = null;
  lastOverridePromptTotal = null;
  if (overridePromptTimer) {
    clearTimeout(overridePromptTimer);
    overridePromptTimer = null;
  }
  shipmentItemsLoadedOnce = false;

  // Always start with one blank row
  addShipmentItemRow();

  if (totalOverride && !totalOverride.dataset.bound) {
    totalOverride.addEventListener('input', () => {
      lastOverridePromptTotal = null;
    });
    totalOverride.dataset.bound = '1';
  }
}

function collectShipmentItemsFromForm() {
  const rows = Array.from(document.querySelectorAll('.shipment-item-row'));
  const items = [];

  // If "apply to all" is checked, we'll fall back to the header vendor
  const headerVendorSelect = document.getElementById('shipment-vendor');
  const applyAll = document.getElementById('shipment-vendor-apply-all');
  const headerVendorText =
    headerVendorSelect && headerVendorSelect.selectedIndex > 0
      ? headerVendorSelect.options[headerVendorSelect.selectedIndex].textContent.trim()
      : '';
  const applyAllChecked = !!(applyAll && applyAll.checked);
  const headerCooInput = document.getElementById('shipment-country-origin');
  const cooApplyAll = document.getElementById('shipment-coo-apply-all');
  const headerCooText = headerCooInput ? headerCooInput.value.trim() : '';
  const cooApplyAllChecked = !!(cooApplyAll && cooApplyAll.checked);

  rows.forEach(row => {
    const desc = row.querySelector('.shipment-item-desc')?.value.trim() || '';
    const sku  = row.querySelector('.shipment-item-sku')?.value.trim() || '';
    const qty  =
      parseFloat(row.querySelector('.shipment-item-qty')?.value || '0') || 0;
    const unit =
      parseFloat(row.querySelector('.shipment-item-unit')?.value || '0') || 0;

    const statusSel   = row.querySelector('.shipment-item-status');
    const status      = statusSel ? statusSel.value : '';
    const vendorInput = row.querySelector('.shipment-item-vendor');
    let vendor_name = vendorInput ? vendorInput.value.trim() : '';
    if (applyAllChecked && headerVendorText) {
      // When apply-all is on, override item vendor with header vendor
      vendor_name = headerVendorText;
      if (vendorInput && vendorInput.value.trim() !== headerVendorText) {
        vendorInput.value = headerVendorText; // keep UI in sync
      }
    }
    const cooInput = row.querySelector('.shipment-item-coo');
    let country_of_origin = cooInput ? cooInput.value.trim() : '';
    if (cooApplyAllChecked && headerCooText) {
      country_of_origin = headerCooText;
      if (cooInput && cooInput.value.trim() !== headerCooText) {
        cooInput.value = headerCooText;
      }
    }

    const vMeta = row._verification || {};

    // Skip completely empty rows (including vendor)
    if (!desc && !sku && !qty && !unit && !vendor_name && !country_of_origin) return;

    const line_total = qty * unit;

    // Build verification object
    const verification = {
      status: status || vMeta.status || '',
      verified_by: vMeta.verified_by || null,
      verified_at: vMeta.verified_at || null,
      storage_override: vMeta.storage_override || null,
      notes: vMeta.notes || null,
      issue_type: vMeta.issue_type || null,
      history: Array.isArray(vMeta.history) ? vMeta.history : []
    };

    // If we have a status but no date yet, fill it at save time
    if (verification.status && !verification.verified_at) {
      verification.verified_at = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    }

    items.push({
      description: desc || null,
      sku: sku || null,
      country_of_origin: country_of_origin || null,
      quantity: qty,
      unit_price: unit,
      line_total,
      vendor_name: vendor_name || null,
      verification
    });
  });

  return items;
}



async function loadShipmentDocuments(shipmentId) {
  const listEl = document.getElementById('shipment-docs-list');
  const notesSection = document.querySelector('.shipment-notes-section');
  if (!listEl || !shipmentId) return;

  // Show loading
  listEl.innerHTML = '<li class="shipment-docs-empty small-muted">Loading documents…</li>';

  try {
    const res = await fetchJSON(
      `/api/shipments/${encodeURIComponent(shipmentId)}/documents`
    );

    const docs = (res && res.documents) || [];

    // No docs → message + full-width notes
    if (!docs.length) {
      listEl.innerHTML =
        '<li class="shipment-docs-empty small-muted">(No documents uploaded yet.)</li>';

      if (notesSection) notesSection.classList.remove('notes-shifted');
      updateShipmentRequiredDocsFromDocs(shipmentId, docs);
      return;
    }

    // ✅ listEl *is* the <ul>, so we just fill it with <li>s
    listEl.innerHTML = '';

    docs.forEach(doc => {
      const viewUrl = doc.view_url || doc.url || doc.file_path || '#';
      const downloadUrl = doc.download_url || doc.url || doc.file_path || '#';
      const li = document.createElement('li');
      li.className = 'shipment-docs-list-item';
      li.dataset.docId = doc.id;

      // Left side: link + meta
      const mainSpan = document.createElement('span');
      mainSpan.className = 'shipment-docs-main';

      const a = document.createElement('a');
      a.className = 'shipment-docs-link';
      a.href = viewUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = doc.title || doc.doc_label || doc.original_name || 'Document';
      mainSpan.appendChild(a);

      const typeLabel = doc.doc_label || doc.doc_type;
      if (typeLabel) {
        const tag = document.createElement('span');
        tag.className = 'shipment-docs-tag';
        tag.textContent = typeLabel;
        if (doc.doc_type && doc.doc_label && doc.doc_label !== doc.doc_type) {
          tag.title = `Type: ${doc.doc_type}`;
        }
        mainSpan.appendChild(tag);
      }

      li.appendChild(mainSpan);

      const actions = document.createElement('span');
      actions.className = 'shipment-docs-actions';

      const downloadLink = document.createElement('a');
      downloadLink.className = 'shipment-docs-download';
      downloadLink.href = downloadUrl;
      downloadLink.target = '_blank';
      downloadLink.rel = 'noopener noreferrer';
      downloadLink.textContent = 'Download';
      actions.appendChild(downloadLink);

      // Right side: small red X button
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'icon-button shipment-docs-delete';
      deleteBtn.title = 'Delete document';
      deleteBtn.textContent = '×';

      deleteBtn.addEventListener('click', async (evt) => {
        evt.preventDefault();
        evt.stopPropagation();

        const ok = await showYesNoPrompt(
          'Delete this document? This cannot be undone and the file will be removed.',
          { yesLabel: 'Delete document', noLabel: 'Nevermind, keep it', tone: 'danger' }
        );
        if (!ok) return;

        try {
          await fetchJSON(
            `/api/shipments/${encodeURIComponent(shipmentId)}/documents/${encodeURIComponent(doc.id)}`,
            { method: 'DELETE' }
          );
          await loadShipmentDocuments(shipmentId);
          await maybePromptUnpaidAfterDocDelete(doc);
        } catch (err) {
          console.error('Error deleting shipment document:', err);
          alert('Error deleting document: ' + err.message);
        }
      });

      actions.appendChild(deleteBtn);
      li.appendChild(actions);
      listEl.appendChild(li);
    });

    // Add border/scroll state class if needed
    if (listEl.scrollHeight > listEl.clientHeight + 1) {
      listEl.classList.add('is-scrollable');
    } else {
      listEl.classList.remove('is-scrollable');
    }

    // ✅ Docs exist → shift notes into left column
    if (notesSection) {
      notesSection.classList.add('notes-shifted');
    }
    updateShipmentRequiredDocsFromDocs(shipmentId, docs);
  } catch (err) {
    console.error('Error loading shipment documents', err);
    listEl.innerHTML =
      '<li class="shipment-docs-empty small-muted" style="color: crimson;">Error loading documents.</li>';
  }
}

const REQUIRED_SHIPMENT_DOCS = [
  {
    key: 'shippers_invoice',
    label: 'Shippers Invoice',
    tokens: ['shippers invoice', 'shipper invoice', "shipper's invoice"]
  },
  {
    key: 'bol',
    label: 'BOL',
    tokens: ['bol', 'bill of lading']
  }
];

function normalizeDocMatchValue(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesDocToken(text, token) {
  if (!text || !token) return false;
  return text === token;
}

function docMatchesRequirement(doc = {}, requirement) {
  const fields = [
    doc.doc_type,
    doc.doc_label
  ];
  return fields.some(field => {
    const normalized = normalizeDocMatchValue(field);
    if (!normalized) return false;
    return requirement.tokens.some(token => matchesDocToken(normalized, token));
  });
}

function getMissingRequiredDocsFromDocs(docs = []) {
  if (!Array.isArray(docs)) {
    return REQUIRED_SHIPMENT_DOCS.map(req => req.label);
  }
  return REQUIRED_SHIPMENT_DOCS
    .filter(req => !docs.some(doc => docMatchesRequirement(doc, req)))
    .map(req => req.label);
}

function getMissingRequiredDocsFromShipment(shipment) {
  if (!shipment) return null;
  const hasInvoiceRaw = shipment.has_shippers_invoice_doc;
  const hasBolRaw = shipment.has_bol_doc;
  if (hasInvoiceRaw == null && hasBolRaw == null) return null;
  const missing = [];
  if (hasInvoiceRaw != null && !Number(hasInvoiceRaw)) {
    missing.push('Shippers Invoice');
  }
  if (hasBolRaw != null && !Number(hasBolRaw)) {
    missing.push('BOL');
  }
  return missing;
}

function getShipmentCooSummary(shipment) {
  const total = Number(shipment?.items_total) || 0;
  const withCoo = Number(shipment?.items_with_coo) || 0;
  const distinct = Number(shipment?.distinct_item_coo) || 0;
  const cooValue = String(shipment?.coo_value || '').trim();
  const headerValue = String(shipment?.country_of_origin || '').trim();

  if (!total) {
    if (headerValue) {
      return { label: headerValue, missing: false };
    }
    return { label: 'MISSING', missing: true };
  }

  if (withCoo < total) {
    return { label: 'MISSING', missing: true };
  }

  if (distinct > 1) {
    return { label: 'Multiple', missing: false };
  }

  if (cooValue) {
    return { label: cooValue, missing: false };
  }

  if (headerValue) {
    return { label: headerValue, missing: false };
  }

  return { label: 'MISSING', missing: true };
}

function findShipmentInBoardData(shipmentId) {
  const byStatus = shipmentsBoardData?.shipmentsByStatus || {};
  const idNum = Number(shipmentId);
  for (const list of Object.values(byStatus)) {
    if (!Array.isArray(list)) continue;
    const hit = list.find(sh => Number(sh.id) === idNum);
    if (hit) return hit;
  }
  return null;
}

function updateShipmentCardDocAlert(shipmentId, missingDocs) {
  const card = document.querySelector(`.shipment-card[data-id="${shipmentId}"]`);
  if (!card) return;
  const body = card.querySelector('.shipment-card-body');
  if (!body) return;
  const existing = body.querySelector('.shipment-card-alert');
  if (!missingDocs || !missingDocs.length) {
    if (existing) existing.remove();
    return;
  }
  const text = `Missing docs: ${missingDocs.join(', ')}`;
  if (existing) {
    existing.textContent = text;
    return;
  }
  const alert = document.createElement('div');
  alert.className = 'shipment-card-alert';
  alert.textContent = text;
  body.appendChild(alert);
}

function updateShipmentRequiredDocsFromDocs(shipmentId, docs = []) {
  if (!shipmentId) return;
  const missing = getMissingRequiredDocsFromDocs(docs);
  const hasInvoice = !missing.includes('Shippers Invoice');
  const hasBol = !missing.includes('BOL');

  const shipment = findShipmentInBoardData(shipmentId);
  if (shipment) {
    shipment.has_shippers_invoice_doc = hasInvoice ? 1 : 0;
    shipment.has_bol_doc = hasBol ? 1 : 0;
    saveShipmentsBoardCache(shipmentsBoardData);
  }

  updateShipmentCardDocAlert(shipmentId, missing);
}

function docTextForPaymentDetection(doc = {}) {
  return [
    doc.doc_type,
    doc.doc_label,
    doc.title,
    doc.original_name,
    doc.category
  ]
    .map(v => (v || '').toString().toLowerCase())
    .filter(Boolean)
    .join(' ');
}

function docIsFreightPayment(doc = {}) {
  const text = docTextForPaymentDetection(doc);
  if (!text) return false;
  const paymenty =
    text.includes('payment') ||
    text.includes('paid') ||
    text.includes('receipt');
  const freighty =
    text.includes('freight') ||
    text.includes('forwarder') ||
    text.includes('shipper') ||
    text.includes('shipping') ||
    text.includes('logistics') ||
    text.includes('transport') ||
    text.includes('cargo') ||
    text.includes('ff');
  return paymenty && freighty;
}

function docIsClearingPayment(doc = {}) {
  const text = docTextForPaymentDetection(doc);
  if (!text) return false;
  const paymenty =
    text.includes('payment') ||
    text.includes('paid') ||
    text.includes('receipt');
  const clearingy =
    text.includes('customs') ||
    text.includes('clearing') ||
    text.includes('broker') ||
    text.includes('duty') ||
    text.includes('duties');
  return paymenty && clearingy;
}

function detectPaymentTypeFromDoc(doc = {}) {
  if (docIsFreightPayment(doc)) return 'shipper';
  if (docIsClearingPayment(doc)) return 'customs';
  return null;
}

function ensureShipConfirmStyles() {
  if (document.getElementById('ship-confirm-style')) return;
  const style = document.createElement('style');
  style.id = 'ship-confirm-style';
  style.textContent = `
    .ship-confirm-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(2, 6, 23, 0.45);
      backdrop-filter: blur(2px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
    }
    .ship-confirm-card {
      background: #fff;
      border-radius: 20px;
      padding: 24px 28px;
      width: min(560px, 92vw);
      box-shadow:
        0 32px 70px rgba(0, 0, 0, 0.28),
        0 0 0 1px var(--slate-200);
      color: var(--slate-800);
      font-family: inherit;
    }
    .ship-confirm-card p {
      margin: 0;
      line-height: 1.5;
      font-size: 1rem;
      color: var(--slate-700);
    }
    .ship-confirm-actions {
      margin-top: 18px;
      display: flex;
      gap: 12px;
      justify-content: flex-end;
    }
    .ship-confirm-actions .btn {
      min-width: 120px;
    }
    @media (max-width: 520px) {
      .ship-confirm-actions {
        justify-content: stretch;
        flex-wrap: wrap;
      }
      .ship-confirm-actions .btn {
        flex: 1 1 100%;
      }
    }
  `;
  document.head.appendChild(style);
}

function showYesNoPrompt(message, opts = {}) {
  ensureShipConfirmStyles();
  const {
    yesLabel = 'Yes',
    noLabel = 'No',
    tone = 'neutral'
  } = opts;

  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'ship-confirm-backdrop';

    const card = document.createElement('div');
    card.className = 'ship-confirm-card';

    const msg = document.createElement('p');
    msg.textContent = message || 'Are you sure?';
    card.appendChild(msg);

    const actions = document.createElement('div');
    actions.className = 'ship-confirm-actions';

    const noBtn = document.createElement('button');
    noBtn.type = 'button';
    noBtn.className = 'btn secondary';
    noBtn.textContent = noLabel || 'No';

    const yesBtn = document.createElement('button');
    yesBtn.type = 'button';
    yesBtn.className = tone === 'danger' ? 'btn danger' : 'btn primary';
    yesBtn.textContent = yesLabel || 'Yes';

    actions.appendChild(noBtn);
    actions.appendChild(yesBtn);
    card.appendChild(actions);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    const cleanup = (value) => {
      document.body.removeChild(backdrop);
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };

    noBtn.addEventListener('click', () => cleanup(false));
    yesBtn.addEventListener('click', () => cleanup(true));

    backdrop.addEventListener('click', (evt) => {
      if (evt.target === backdrop) {
        cleanup(false);
      }
    });

    const onKey = (evt) => {
      if (evt.key === 'Escape') {
        evt.preventDefault();
        cleanup(false);
      } else if (evt.key === 'Enter') {
        evt.preventDefault();
        cleanup(true);
      }
    };
    document.addEventListener('keydown', onKey);
  });
}

let shipmentFormBaseline = '';

function captureShipmentFormState() {
  const form = document.getElementById('shipment-create-form');
  if (!form) return '';

  const getVal = (id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    if (el.type === 'checkbox') return !!el.checked;
    return el.value != null ? String(el.value) : '';
  };

  const fields = {
    title: getVal('shipment-title'),
    status: getVal('shipment-status'),
    po: getVal('shipment-po-number'),
    country_of_origin: getVal('shipment-country-origin'),
    country_apply_all: getVal('shipment-coo-apply-all'),
    project: getVal('shipment-project'),
    destination: getVal('shipment-destination'),
    vendor: getVal('shipment-vendor'),
    vendor_apply_all: getVal('shipment-vendor-apply-all'),
    forwarder: getVal('shipment-forwarder'),
    forwarder_other: getVal('shipment-forwarder-other'),
    website: getVal('shipment-website-url'),
    notes: getVal('shipment-notes'),
    expected_ship: getVal('shipment-expected-ship-date'),
    expected_arrival: getVal('shipment-expected-arrival-date'),
    tracking: getVal('shipment-tracking-number'),
    bol: getVal('shipment-bol-number'),
    requested_clearing: getVal('shipment-requested-clearing'),
    requested_clearing_date: getVal('shipment-requested-clearing-date'),
    total_override: getVal('shipment-total-price-override'),
    storage_due: getVal('shipment-storage-due-date'),
    storage_daily_fee: getVal('shipment-storage-daily-fee'),
    is_container: getVal('shipment-is-container'),
    picked_by: getVal('shipment-picked-up-by'),
    picked_date: getVal('shipment-picked-up-date'),
    shipper_paid: getVal('shipment-shipper-paid'),
    shipper_paid_amount: getVal('shipment-shipper-paid-amount'),
    shipper_paid_by: getVal('shipment-shipper-paid-by'),
    shipper_paid_by_other: getVal('shipment-shipper-paid-by-other'),
    customs_paid: getVal('shipment-customs-paid'),
    customs_paid_amount: getVal('shipment-customs-paid-amount'),
    customs_paid_by: getVal('shipment-customs-paid-by'),
    customs_paid_by_other: getVal('shipment-customs-paid-by-other'),
    storage_paid: getVal('shipment-storage-paid'),
    storage_paid_amount: getVal('shipment-storage-paid-amount'),
    storage_paid_by: getVal('shipment-storage-paid-by'),
    storage_paid_by_other: getVal('shipment-storage-paid-by-other'),
    total_paid: getVal('shipment-total-paid'),
    verify_all: getVal('shipment-verify-all'),
    verification_notes: getVal('shipment-verification-notes')
  };

  const items = Array.from(document.querySelectorAll('.shipment-item-row')).map(row => ({
    desc: row.querySelector('.shipment-item-desc')?.value || '',
    sku: row.querySelector('.shipment-item-sku')?.value || '',
    coo: row.querySelector('.shipment-item-coo')?.value || '',
    vendor: row.querySelector('.shipment-item-vendor')?.value || '',
    qty: row.querySelector('.shipment-item-qty')?.value || '',
    unit: row.querySelector('.shipment-item-unit')?.value || '',
    status: row.querySelector('.shipment-item-status')?.value || ''
  }));

  return JSON.stringify({
    id: getVal('shipment-id'),
    updated_at: getVal('shipment-updated-at'),
    step: form.dataset.step || '',
    fields,
    items
  });
}

function setShipmentFormBaseline() {
  shipmentFormBaseline = captureShipmentFormState();
}

function isShipmentFormDirty() {
  if (!shipmentFormBaseline) return false;
  return captureShipmentFormState() !== shipmentFormBaseline;
}

function showShipmentClosePrompt() {
  ensureShipConfirmStyles();

  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'ship-confirm-backdrop';

    const card = document.createElement('div');
    card.className = 'ship-confirm-card';

    const msg = document.createElement('p');
    msg.textContent = 'You have unsaved changes. What would you like to do?';
    card.appendChild(msg);

    const actions = document.createElement('div');
    actions.className = 'ship-confirm-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn secondary';
    cancelBtn.textContent = 'Cancel';

    const discardBtn = document.createElement('button');
    discardBtn.type = 'button';
    discardBtn.className = 'btn danger';
    discardBtn.textContent = 'Discard changes';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn primary';
    saveBtn.textContent = 'Save draft';

    actions.appendChild(cancelBtn);
    actions.appendChild(discardBtn);
    actions.appendChild(saveBtn);
    card.appendChild(actions);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    const cleanup = (value) => {
      document.body.removeChild(backdrop);
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };

    cancelBtn.addEventListener('click', () => cleanup('cancel'));
    discardBtn.addEventListener('click', () => cleanup('discard'));
    saveBtn.addEventListener('click', () => cleanup('save'));

    backdrop.addEventListener('click', (evt) => {
      if (evt.target === backdrop) cleanup('cancel');
    });

    const onKey = (evt) => {
      if (evt.key === 'Escape') {
        evt.preventDefault();
        cleanup('cancel');
      } else if (evt.key === 'Enter') {
        evt.preventDefault();
        cleanup('save');
      }
    };
    document.addEventListener('keydown', onKey);
  });
}

async function attemptCloseShipmentCreateModal() {
  if (!isShipmentFormDirty()) {
    closeShipmentCreateModal();
    return;
  }

  const choice = await showShipmentClosePrompt();
  if (choice === 'save') {
    await saveShipmentFromModal({
      stayOpen: false,
      successMessage: 'Draft saved.'
    });
  } else if (choice === 'discard') {
    closeShipmentCreateModal();
  }
}

function setPaymentFlagFromDoc(type, paid, reason = '') {
  const mapping = {
    shipper: {
      chk: 'shipment-shipper-paid',
      amt: 'shipment-shipper-paid-amount',
      payer: 'shipment-shipper-paid-by',
      other: 'shipment-shipper-paid-by-other',
      label: 'Freight Forwarder'
    },
    customs: {
      chk: 'shipment-customs-paid',
      amt: 'shipment-customs-paid-amount',
      payer: 'shipment-customs-paid-by',
      other: 'shipment-customs-paid-by-other',
      label: 'Customs / Clearing'
    }
  };

  const entry = mapping[type];
  if (!entry) return;

  const chk = document.getElementById(entry.chk);
  const amt = document.getElementById(entry.amt);
  const payer = document.getElementById(entry.payer);
  const other = document.getElementById(entry.other);
  const msgEl = document.getElementById('shipment-create-status');

  if (chk) {
    chk.checked = !!paid;
    applyPaymentCheckboxState(chk, amt, chk.checked);
    setShipmentPaidByControlsEnabled(payer, other, chk.checked);
    updateShipmentTotalPaid();
  }

  if (msgEl) {
    const verb = paid ? 'marked as paid' : 'marked as NOT paid';
    const suffix = reason ? ` (${reason})` : '';
    msgEl.textContent = `${entry.label} ${verb}${suffix}. Remember to save the shipment.`;
    msgEl.style.color = paid ? '#065f46' : '#b45309';
  }
}

async function maybePromptUnpaidAfterDocDelete(doc = {}) {
  const type = detectPaymentTypeFromDoc(doc);
  if (!type) return;

  const label = type === 'shipper'
    ? 'Freight forwarder'
    : 'Customs / clearing';

  const ok = await showYesNoPrompt(
    `Mark ${label} as NOT paid now that the proof of payment was deleted?`,
    { yesLabel: 'Yes, mark as unpaid', noLabel: 'No, leave as paid' }
  );
  if (ok) {
    setPaymentFlagFromDoc(type, false, 'Proof of payment removed');
  }
}

function maybeMarkPaidAfterUpload(meta = {}) {
  const type = detectPaymentTypeFromDoc(meta);
  if (!type) return;

  const label = type === 'shipper'
    ? 'Freight forwarder'
    : 'Customs / clearing';

  setPaymentFlagFromDoc(type, true, `${label} proof uploaded`);
}

// ───────── OFFLINE SUPPORT FOR SHIPMENTS (LIGHTWEIGHT) ─────────

const SHIPMENTS_CACHE_KEY = 'avian_shipments_board_cache';
const SHIPMENTS_ARCHIVED_PREVIEW_CACHE_KEY = 'avian_shipments_archived_preview_cache';
const SHIPMENTS_QUEUE_KEY = 'avian_shipments_update_queue';
const SHIPMENTS_COMMENTS_QUEUE_KEY = 'avian_kiosk_shipment_comment_queue_v1';
const SHIPMENT_COMMENT_UNDO_WINDOW_MS = 5 * 60 * 1000;
const SHIPMENTS_THREAD_CATEGORIES = [
  { value: 'General', label: 'General' },
  { value: 'Payments', label: 'Payments' },
  { value: 'Documents', label: 'Documents' },
  { value: 'Pickup', label: 'Pickup' },
  { value: 'Issues', label: 'Issues' },
  { value: 'Other', label: 'Other' }
];

let shipmentThreadState = {
  shipmentId: null,
  threads: [],
  activeThreadId: null,
  search: '',
  comments: [],
  allComments: [],
  queued: []
};

// Report column configuration
const SHIP_REPORT_COLUMNS = [
  { key: 'bol', label: 'BOL', default: true },
  { key: 'sku', label: 'Internal Ref #', default: true },
  { key: 'project', label: 'Project', default: true },
  { key: 'title', label: 'Title', default: true },
  { key: 'status', label: 'Status', default: true },
  { key: 'verified', label: 'Items Verified?', default: true },
  { key: 'eta', label: 'Freight Forwarder Paid', default: true },
  { key: 'ready', label: 'Customs Paid', default: true },
  { key: 'tracking', label: 'Tracking #', default: false },
  { key: 'forwarder', label: 'Freight Forwarder', default: false },
  { key: 'vendor', label: 'Vendor', default: false },
  { key: 'vendor_paid', label: 'Vendor Paid', default: false },
  { key: 'vendor_paid_amt', label: 'Vendor Paid Amount', default: false },
  { key: 'ff_paid', label: 'Freight Forwarder Paid', default: true },
  { key: 'ff_paid_amt', label: 'Freight Forwarder Paid Amount', default: false },
  { key: 'customs_paid', label: 'Customs Paid', default: true },
  { key: 'customs_paid_amt', label: 'Customs Paid Amount', default: false },
  { key: 'total_paid', label: 'Total Paid', default: false },
  { key: 'picked_by', label: 'Picked Up By', default: false },
  { key: 'picked_date', label: 'Pickup Date', default: false }
];
let shipmentsReportData = [];

function isOnline() {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

// --- Board cache (for loading shipments when offline) ---

function stripPersonalNotesFromShipmentsBoardData(data) {
  if (!data || typeof data !== 'object') return data;
  const byStatus = data.shipmentsByStatus || {};
  const nextByStatus = {};

  Object.entries(byStatus).forEach(([status, list]) => {
    if (!Array.isArray(list)) {
      nextByStatus[status] = [];
      return;
    }
    nextByStatus[status] = list.map(sh => {
      if (!sh || typeof sh !== 'object') return sh;
      const clone = { ...sh };
      delete clone.personal_note;
      delete clone.personal_note_completed;
      delete clone.personal_note_completed_at;
      delete clone.personal_note_updated_at;
      return clone;
    });
  });

  return {
    ...data,
    shipmentsByStatus: nextByStatus
  };
}

function saveShipmentsBoardCache(data) {
  try {
    // Personal notes are private per-user; don't persist them into the shared offline cache.
    const safeData = stripPersonalNotesFromShipmentsBoardData(data);
    localStorage.setItem(SHIPMENTS_CACHE_KEY, JSON.stringify({
      at: new Date().toISOString(),
      data: safeData
    }));
  } catch {}
}

function loadShipmentsBoardCache() {
  try {
    const raw = localStorage.getItem(SHIPMENTS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.data ? parsed.data : null;
  } catch {
    return null;
  }
}

function saveShipmentsArchivedPreviewCache(payload) {
  try {
    localStorage.setItem(SHIPMENTS_ARCHIVED_PREVIEW_CACHE_KEY, JSON.stringify({
      at: new Date().toISOString(),
      data: payload
    }));
  } catch {}
}

function loadShipmentsArchivedPreviewCache() {
  try {
    const raw = localStorage.getItem(SHIPMENTS_ARCHIVED_PREVIEW_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.data ? parsed.data : null;
  } catch {
    return null;
  }
}

// --- Update queue (for saving verification while offline) ---

function getShipmentsUpdateQueue() {
  try {
    const raw = localStorage.getItem(SHIPMENTS_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveShipmentsUpdateQueue(queue) {
  try {
    localStorage.setItem(SHIPMENTS_QUEUE_KEY, JSON.stringify(queue));
  } catch {}
}

function queueShipmentUpdate(shipmentId, payload) {
  const q = getShipmentsUpdateQueue();
  const clientId =
    payload && payload.client_id ? String(payload.client_id) : makeClientId('ship');
  const ifMatch =
    payload && payload.if_match_updated_at ? payload.if_match_updated_at : null;
  const nextPayload = {
    ...(payload || {}),
    client_id: clientId
  };
  if (ifMatch) {
    nextPayload.if_match_updated_at = ifMatch;
  }

  // For simplicity, keep only the latest update per shipment
  const without = q.filter(entry => entry.id !== shipmentId);
  without.push({
    id: shipmentId,
    client_id: clientId,
    if_match_updated_at: ifMatch,
    payload: nextPayload,
    queued_at: new Date().toISOString(),
    blocked: false,
    conflict: null
  });

  saveShipmentsUpdateQueue(without);
  renderShipmentQueueStatus();
}

function renderShipmentQueueStatus() {
  const msgEl = document.getElementById('shipments-board-message');
  if (!msgEl) return;
  const q = getShipmentsUpdateQueue();
  const blocked = q.filter(entry => entry && entry.blocked);
  if (blocked.length) {
    msgEl.textContent =
      'Offline shipment edits need review before they can sync.';
    msgEl.style.color = '#b45309';
    msgEl.dataset.queueWarning = 'true';
  } else if (msgEl.dataset.queueWarning === 'true') {
    msgEl.textContent = '';
    msgEl.style.color = '';
    msgEl.dataset.queueWarning = 'false';
  }
}

async function syncShipmentsUpdateQueue() {
  if (!isOnline()) return;

  let q = getShipmentsUpdateQueue();
  if (!q.length) return;

  const remaining = [];
  let hadChanges = false;

  for (const entry of q) {
    const { id } = entry || {};
    if (!id) continue;
    if (entry.blocked) {
      remaining.push(entry);
      continue;
    }

    const payload = {
      ...(entry.payload || {}),
      client_id: entry.client_id || makeClientId('ship')
    };
    if (entry.if_match_updated_at && !payload.if_match_updated_at) {
      payload.if_match_updated_at = entry.if_match_updated_at;
    }

    try {
      const res = await fetch(`/api/shipments/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getCsrfHeader() },
        body: JSON.stringify(payload)
      });

      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        remaining.push({
          ...entry,
          blocked: true,
          conflict: data.current || data.shipment || data || null
        });
        continue;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || data.message || 'Failed to sync shipment.');
      }

      await res.json().catch(() => ({}));
      hadChanges = true;
    } catch (err) {
      console.warn('[SHIPMENTS OFFLINE] Failed to sync shipment', id, err);
      remaining.push(entry);
    }
  }

  saveShipmentsUpdateQueue(remaining);
  renderShipmentQueueStatus();

  if (hadChanges && typeof loadShipmentsBoard === 'function') {
    try {
      await loadShipmentsBoard();
    } catch {}
  }
}

function getShipmentCommentsQueue() {
  try {
    const raw = localStorage.getItem(SHIPMENTS_COMMENTS_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveShipmentCommentsQueue(queue) {
  try {
    localStorage.setItem(SHIPMENTS_COMMENTS_QUEUE_KEY, JSON.stringify(queue));
  } catch {}
}

function queueShipmentComment({ shipmentId, body, threadId }) {
  if (!shipmentId || !body) return;
  const { id: currentEmpId, name: currentEmpName } = getCurrentVerifierInfo();
  const q = getShipmentCommentsQueue();
  q.push({
    client_id: makeClientId('comment'),
    shipment_id: shipmentId,
    thread_id: threadId || null,
    body,
    queued_at: new Date().toISOString(),
    created_by: currentEmpId || null,
    created_by_name: currentEmpName || null
  });
  saveShipmentCommentsQueue(q);
}

async function syncShipmentCommentsQueue() {
  if (!isOnline()) return;
  const q = getShipmentCommentsQueue();
  if (!q.length) return;

  const remaining = [];

  for (const entry of q) {
    if (!entry || !entry.shipment_id || !entry.body) continue;
    try {
      await fetchJSON(`/api/shipments/${encodeURIComponent(entry.shipment_id)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: entry.body,
          client_id: entry.client_id,
          thread_id: entry.thread_id || null
        })
      });
    } catch (err) {
      console.warn('[SHIPMENTS OFFLINE] Failed to sync comment', entry, err);
      remaining.push(entry);
    }
  }

  saveShipmentCommentsQueue(remaining);
}

// Whenever the browser comes back online, try to flush queues
window.addEventListener('online', () => {
  syncShipmentsUpdateQueue();
  syncShipmentCommentsQueue();
  syncShipmentNotificationPrefsQueue();
});


async function loadShipmentsSection() {
  loadShipmentsColumnPrefs();
  updateShipmentsSortToggleLabel();
  await Promise.all([
    loadShipmentsBoard(),
    loadShipmentsFilters(),
    loadShipmentTemplates()
  ]);
  renderShipmentQueueStatus();
  syncShipmentsUpdateQueue();
  syncShipmentCommentsQueue();
  syncShipmentNotificationPrefsQueue();
}

function collectShipmentPaidByCustomers(projects = []) {
  const set = new Set();
  (projects || []).forEach(p => {
    if (!p) return;
    const raw = p.customer_name ? p.customer_name : p.name;
    const name = raw ? String(raw).trim() : '';
    if (name) set.add(name);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function ensurePaidByOption(selectEl, value, label) {
  if (!selectEl || !value) return;
  const exists = Array.from(selectEl.options || []).some(
    opt => opt.value === value
  );
  if (exists) return;
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = label || value;
  selectEl.appendChild(opt);
}

function populateShipmentPaidBySelect(selectEl, customers = []) {
  if (!selectEl) return;
  const current = selectEl.value;

  selectEl.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select payer…';
  selectEl.appendChild(placeholder);

  const companyOpt = document.createElement('option');
  companyOpt.value = SHIPMENT_PAID_BY_COMPANY;
  companyOpt.textContent = 'Company';
  selectEl.appendChild(companyOpt);

  if (customers.length) {
    const group = document.createElement('optgroup');
    group.label = 'Customers';
    customers.forEach(name => {
      const opt = document.createElement('option');
      opt.value = `${SHIPMENT_PAID_BY_CUSTOMER_PREFIX}${name}`;
      opt.textContent = name;
      group.appendChild(opt);
    });
    selectEl.appendChild(group);
  }

  const otherOpt = document.createElement('option');
  otherOpt.value = SHIPMENT_PAID_BY_OTHER;
  otherOpt.textContent = 'Other';
  selectEl.appendChild(otherOpt);

  if (current) {
    const exists = Array.from(selectEl.options || []).some(
      opt => opt.value === current
    );
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = current;
      opt.textContent = current.startsWith(SHIPMENT_PAID_BY_CUSTOMER_PREFIX)
        ? current.slice(SHIPMENT_PAID_BY_CUSTOMER_PREFIX.length)
        : current;
      selectEl.appendChild(opt);
    }
    selectEl.value = current;
  }
}

function refreshShipmentPaidByOptions(projects = shipmentsProjectsCache) {
  const customers = collectShipmentPaidByCustomers(projects);
  const form = document.getElementById('shipment-create-form');

  const shipperSel = document.getElementById('shipment-shipper-paid-by');
  const shipperOther = document.getElementById('shipment-shipper-paid-by-other');
  const customsSel = document.getElementById('shipment-customs-paid-by');
  const customsOther = document.getElementById('shipment-customs-paid-by-other');
  const storageSel = document.getElementById('shipment-storage-paid-by');
  const storageOther = document.getElementById('shipment-storage-paid-by-other');

  const shipperOtherValue = shipperOther ? shipperOther.value : '';
  const customsOtherValue = customsOther ? customsOther.value : '';
  const storageOtherValue = storageOther ? storageOther.value : '';

  populateShipmentPaidBySelect(shipperSel, customers);
  populateShipmentPaidBySelect(customsSel, customers);
  populateShipmentPaidBySelect(storageSel, customers);

  if (form) {
    const shipperValue = form.dataset.shipperPaidBy || '';
    const customsValue = form.dataset.customsPaidBy || '';
    const storageValue = form.dataset.storagePaidBy || '';

    if (shipperSel && shipperValue && !shipperSel.value) {
      applyShipmentPaidByValue(shipperSel, shipperOther, shipperValue);
    }
    if (customsSel && customsValue && !customsSel.value) {
      applyShipmentPaidByValue(customsSel, customsOther, customsValue);
    }
    if (storageSel && storageValue && !storageSel.value) {
      applyShipmentPaidByValue(storageSel, storageOther, storageValue);
    }
  }

  if (shipperOther && shipperSel?.value === SHIPMENT_PAID_BY_OTHER && shipperOtherValue) {
    shipperOther.value = shipperOtherValue;
  }
  if (customsOther && customsSel?.value === SHIPMENT_PAID_BY_OTHER && customsOtherValue) {
    customsOther.value = customsOtherValue;
  }
  if (storageOther && storageSel?.value === SHIPMENT_PAID_BY_OTHER && storageOtherValue) {
    storageOther.value = storageOtherValue;
  }

  updatePaidByOtherVisibility(shipperSel, shipperOther);
  updatePaidByOtherVisibility(customsSel, customsOther);
  updatePaidByOtherVisibility(storageSel, storageOther);
}

function updatePaidByOtherVisibility(selectEl, otherInput) {
  if (!selectEl || !otherInput) return;
  const showOther = selectEl.value === SHIPMENT_PAID_BY_OTHER;
  otherInput.classList.toggle('hidden', !showOther);
  otherInput.disabled = !showOther || !!selectEl.disabled;
  if (!showOther) {
    otherInput.value = '';
  }
}

function restoreShipmentPaidByFromDataset() {
  const form = document.getElementById('shipment-create-form');
  if (!form) return;

  const shipperValue = form.dataset.shipperPaidBy || '';
  const customsValue = form.dataset.customsPaidBy || '';
  const storageValue = form.dataset.storagePaidBy || '';

  const shipperSel = document.getElementById('shipment-shipper-paid-by');
  const shipperOther = document.getElementById('shipment-shipper-paid-by-other');
  const customsSel = document.getElementById('shipment-customs-paid-by');
  const customsOther = document.getElementById('shipment-customs-paid-by-other');
  const storageSel = document.getElementById('shipment-storage-paid-by');
  const storageOther = document.getElementById('shipment-storage-paid-by-other');

  if (shipperSel && shipperValue && !shipperSel.value) {
    applyShipmentPaidByValue(shipperSel, shipperOther, shipperValue);
  }
  if (customsSel && customsValue && !customsSel.value) {
    applyShipmentPaidByValue(customsSel, customsOther, customsValue);
  }
  if (storageSel && storageValue && !storageSel.value) {
    applyShipmentPaidByValue(storageSel, storageOther, storageValue);
  }
}

function applyShipmentPaidByFromData(shipment) {
  if (!shipment) return;
  const form = document.getElementById('shipment-create-form');
  const shipperSel = document.getElementById('shipment-shipper-paid-by');
  const shipperOther = document.getElementById('shipment-shipper-paid-by-other');
  const customsSel = document.getElementById('shipment-customs-paid-by');
  const customsOther = document.getElementById('shipment-customs-paid-by-other');
  const storageSel = document.getElementById('shipment-storage-paid-by');
  const storageOther = document.getElementById('shipment-storage-paid-by-other');

  if (shipperSel && !shipperSel.value && shipment.shipper_paid_by) {
    applyShipmentPaidByValue(shipperSel, shipperOther, shipment.shipper_paid_by);
  }
  if (customsSel && !customsSel.value && shipment.customs_paid_by) {
    applyShipmentPaidByValue(customsSel, customsOther, shipment.customs_paid_by);
  }
  if (storageSel && !storageSel.value && shipment.storage_paid_by) {
    applyShipmentPaidByValue(storageSel, storageOther, shipment.storage_paid_by);
  }

  if (form) {
    if (shipment.shipper_paid_by) form.dataset.shipperPaidBy = shipment.shipper_paid_by;
    if (shipment.customs_paid_by) form.dataset.customsPaidBy = shipment.customs_paid_by;
    if (shipment.storage_paid_by) form.dataset.storagePaidBy = shipment.storage_paid_by;
  }
}

function ensureShipmentPaidByValues() {
  restoreShipmentPaidByFromDataset();

  const shipperSel = document.getElementById('shipment-shipper-paid-by');
  const customsSel = document.getElementById('shipment-customs-paid-by');
  const storageSel = document.getElementById('shipment-storage-paid-by');

  const needs =
    (shipperSel && !shipperSel.value) ||
    (customsSel && !customsSel.value) ||
    (storageSel && !storageSel.value);

  if (!needs) return;

  if (currentShipmentDetail && currentShipmentDetail.shipment) {
    applyShipmentPaidByFromData(currentShipmentDetail.shipment);
  }

  const stillNeeds =
    (shipperSel && !shipperSel.value) ||
    (customsSel && !customsSel.value) ||
    (storageSel && !storageSel.value);

  if (!stillNeeds) return;

  const shipmentId = document.getElementById('shipment-id')?.value;
  if (!shipmentId || !isOnline()) return;

  fetchJSON(`/api/shipments/${encodeURIComponent(shipmentId)}`)
    .then(data => {
      if (data && data.shipment) {
        applyShipmentPaidByFromData(data.shipment);
      }
    })
    .catch(err => {
      console.warn('Failed to refresh paid-by values for shipment edit:', err);
    });
}

function parseShipmentPaidBy(value) {
  const raw = value != null ? String(value).trim() : '';
  if (!raw) return { type: 'none', value: '' };
  if (/^other:/i.test(raw)) {
    return { type: 'other', value: raw.replace(/^other:/i, '').trim() };
  }
  if (raw.toLowerCase() === 'company') {
    return { type: 'company', value: 'Company' };
  }
  return { type: 'customer', value: raw };
}

function applyShipmentPaidByValue(selectEl, otherInput, value) {
  if (!selectEl) return;
  const parsed = parseShipmentPaidBy(value);
  if (parsed.type === 'company') {
    selectEl.value = SHIPMENT_PAID_BY_COMPANY;
    if (otherInput) otherInput.value = '';
  } else if (parsed.type === 'other') {
    selectEl.value = SHIPMENT_PAID_BY_OTHER;
    if (otherInput) otherInput.value = parsed.value || '';
  } else if (parsed.type === 'customer') {
    const optionValue = `${SHIPMENT_PAID_BY_CUSTOMER_PREFIX}${parsed.value}`;
    ensurePaidByOption(selectEl, optionValue, parsed.value);
    selectEl.value = optionValue;
    if (otherInput) otherInput.value = '';
  } else {
    selectEl.value = '';
    if (otherInput) otherInput.value = '';
  }
  updatePaidByOtherVisibility(selectEl, otherInput);
}

function resolveShipmentPaidBy(selectEl, otherInput) {
  const raw = selectEl ? selectEl.value : '';
  if (!raw) return { value: null, missingOther: false };
  if (raw === SHIPMENT_PAID_BY_COMPANY) {
    return { value: 'Company', missingOther: false };
  }
  if (raw === SHIPMENT_PAID_BY_OTHER) {
    const other = otherInput ? otherInput.value.trim() : '';
    return {
      value: other ? `Other: ${other}` : null,
      missingOther: !other
    };
  }
  if (raw.startsWith(SHIPMENT_PAID_BY_CUSTOMER_PREFIX)) {
    return {
      value: raw.slice(SHIPMENT_PAID_BY_CUSTOMER_PREFIX.length),
      missingOther: false
    };
  }
  return { value: raw, missingOther: false };
}

function setShipmentPaidByControlsEnabled(selectEl, otherInput, enabled) {
  if (selectEl) {
    // Paid-by should remain editable even if the paid checkbox is toggled off.
    selectEl.disabled = false;
  }
  if (otherInput) {
    updatePaidByOtherVisibility(selectEl, otherInput);
    if (!enabled && selectEl && selectEl.value !== SHIPMENT_PAID_BY_OTHER) {
      otherInput.value = '';
    }
  }
}

function syncShipmentForwarderOtherState() {
  const selectEl = document.getElementById('shipment-forwarder');
  const wrap = document.getElementById('shipment-forwarder-other-wrap');
  const input = document.getElementById('shipment-forwarder-other');
  if (!selectEl) return;
  const showOther = selectEl.value === FORWARDER_OTHER_VALUE;
  if (wrap) wrap.classList.toggle('hidden', !showOther);
  if (input) {
    input.disabled = !showOther;
    if (!showOther) input.value = '';
  }
}

function syncRequestedClearingControls({ clearWhenUnchecked = false } = {}) {
  const checkbox = document.getElementById('shipment-requested-clearing');
  const dateInput = document.getElementById('shipment-requested-clearing-date');
  if (!checkbox || !dateInput) return;
  const isChecked = !!checkbox.checked;
  dateInput.disabled = !isChecked;
  if (!isChecked && clearWhenUnchecked) {
    dateInput.value = '';
  }
}

function getShipmentForwarderValue() {
  const selectEl = document.getElementById('shipment-forwarder');
  if (!selectEl) return null;
  if (selectEl.value === FORWARDER_OTHER_VALUE) {
    const input = document.getElementById('shipment-forwarder-other');
    const other = input ? input.value.trim() : '';
    return other || null;
  }
  return selectEl.value || null;
}

function setShipmentForwarderValue(value) {
  const selectEl = document.getElementById('shipment-forwarder');
  const input = document.getElementById('shipment-forwarder-other');
  if (!selectEl) return;
  const normalized = value != null ? String(value).trim() : '';
  if (!normalized) {
    selectEl.value = '';
    if (input) input.value = '';
    syncShipmentForwarderOtherState();
    return;
  }
  const options = Array.from(selectEl.options || []);
  const match = options.find(opt => (opt.value || '').trim() === normalized);
  if (match) {
    selectEl.value = match.value;
    syncShipmentForwarderOtherState();
    return;
  }
  selectEl.value = FORWARDER_OTHER_VALUE;
  if (input) input.value = normalized;
  syncShipmentForwarderOtherState();
}

async function loadShipmentsFilters() {
  try {
    const [vendors, projects] = await Promise.all([
      fetchJSON('/api/vendors?status=active'),
      fetchJSON('/api/projects?status=active')
    ]);

    shipmentsProjectsCache = Array.isArray(projects) ? projects : [];
    refreshShipmentNotificationProjects(shipmentsProjectsCache);
    refreshShipmentPaidByOptions(shipmentsProjectsCache);

    // Top-of-board filters
    const vendorFilter  = document.getElementById('shipments-filter-vendor');
    const projectFilter = document.getElementById('shipments-filter-project');

    if (vendorFilter) {
      vendorFilter.options.length = 1; // keep "All vendors"
      vendors.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.name;
        vendorFilter.appendChild(opt);
      });
    }

    if (projectFilter) {
      projectFilter.options.length = 1; // keep "All projects"
      projects.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.customer_name
          ? `${p.customer_name} – ${p.name}`
          : p.name;
        projectFilter.appendChild(opt);
      });
    }

    // Create-shipment modal selects
    // Create-shipment modal selects
const projectSelect = document.getElementById('shipment-project');
const forwarderSelect = document.getElementById('shipment-forwarder');
    const vendorSelect    = document.getElementById('shipment-vendor');

    // Project select (modal)
    if (projectSelect) {
      projectSelect.innerHTML = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Select project…';
      projectSelect.appendChild(placeholder);

      projects.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.customer_name
          ? `${p.customer_name} – ${p.name}`
          : p.name;
        projectSelect.appendChild(opt);
      });
    }

    // Vendor select (modal)
    if (vendorSelect) {
      vendorSelect.innerHTML = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Select vendor…';
      vendorSelect.appendChild(placeholder);

      vendors.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.name;
        vendorSelect.appendChild(opt);
      });
    }

    // Freight forwarder select (modal)
    if (forwarderSelect) {
      forwarderSelect.innerHTML = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Select forwarder…';
      forwarderSelect.appendChild(placeholder);

      const forwarderCandidates = vendors.filter(v => {
        if (v.is_freight_forwarder === 1 || v.is_freight_forwarder === true) {
          return true;
        }
        const name = (v.name || '').toLowerCase();
        return name && docIsFreightPayment({ subject: name, body: name });
      });

      forwarderCandidates.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.name; // store name as text
        opt.textContent = v.name;
        forwarderSelect.appendChild(opt);
      });

      const otherOpt = document.createElement('option');
      otherOpt.value = FORWARDER_OTHER_VALUE;
      otherOpt.textContent = 'Other…';
      forwarderSelect.appendChild(otherOpt);

      syncShipmentForwarderOtherState();
    }
  } catch (err) {
    console.error('Error loading shipment filters:', err);
  }
}

function showShipmentTemplateMessage(text, color) {
  const msg = document.getElementById('shipment-templates-message');
  if (!msg) return;
  msg.textContent = text || '';
  if (color) msg.style.color = color;
}

function toggleShipmentTemplatesHelp() {
  const help = document.getElementById('shipment-templates-help-text');
  const btn = document.getElementById('shipment-templates-help-btn');
  if (!help || !btn) return;
  const isHidden = help.classList.contains('hidden');
  help.classList.toggle('hidden', !isHidden);
  btn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
}

async function loadShipmentTemplates() {
  const body = document.getElementById('shipment-templates-body');
  if (body) {
    body.innerHTML = '<tr><td colspan="4">Loading templates…</td></tr>';
  }

  try {
    const data = await fetchJSON('/api/shipments/templates');
    shipmentTemplatesCache = Array.isArray(data.templates) ? data.templates : [];
    renderShipmentTemplates(shipmentTemplatesCache);
  } catch (err) {
    console.error('Error loading shipment templates:', err);
    if (body) {
      body.innerHTML = '<tr><td colspan="4">Failed to load templates.</td></tr>';
    }
  }
}

function renderShipmentTemplates(templates = []) {
  const body = document.getElementById('shipment-templates-body');
  if (!body) return;

  if (!Array.isArray(templates) || !templates.length) {
    body.innerHTML = '<tr><td colspan="4">(no templates yet)</td></tr>';
    return;
  }

  body.innerHTML = '';
  templates.forEach(tpl => {
    const tr = document.createElement('tr');
    const vendorName = tpl.vendor_name || '—';
    const projectName = tpl.project_name || '—';

    tr.innerHTML = `
      <td>${escapeHTML(tpl.name || 'Template')}</td>
      <td>${escapeHTML(vendorName)}</td>
      <td>${escapeHTML(projectName)}</td>
      <td>
        <button class="btn secondary btn-sm" data-template-use="${tpl.id}">Use</button>
        <button class="btn danger btn-sm" data-template-delete="${tpl.id}">Delete</button>
      </td>
    `;
    body.appendChild(tr);
  });
}

function buildTemplatePayloadFromForm(name) {
  const vendorIdRaw = document.getElementById('shipment-vendor')?.value || '';
  const projectIdRaw = document.getElementById('shipment-project')?.value || '';
  const itemsRaw = collectShipmentItemsFromForm();
  const items = itemsRaw.map(it => ({
    description: it.description || null,
    sku: it.sku || null,
    country_of_origin: it.country_of_origin || null,
    quantity: Number(it.quantity) || 0,
    unit_price: Number(it.unit_price) || 0,
    line_total: Number(it.line_total) || 0,
    vendor_name: it.vendor_name || null
  }));
  const itemsTotal = items.reduce((sum, it) => sum + (Number(it.line_total) || 0), 0);
  const totalOverrideRaw =
    document.getElementById('shipment-total-price-override')?.value || '';
  const totalOverride =
    totalOverrideRaw !== '' ? Number(totalOverrideRaw) : null;
  const finalTotal =
    totalOverride != null && !Number.isNaN(totalOverride)
      ? totalOverride
      : (itemsTotal > 0 ? itemsTotal : null);

  return {
    name: name || null,
    title: document.getElementById('shipment-title')?.value.trim() || null,
    vendor_id: vendorIdRaw ? Number(vendorIdRaw) : null,
    freight_forwarder: getShipmentForwarderValue(),
    destination: document.getElementById('shipment-destination')?.value.trim() || null,
    project_id: projectIdRaw ? Number(projectIdRaw) : null,
    country_of_origin: document.getElementById('shipment-country-origin')?.value.trim() || null,
    quantity: null,
    total_price: finalTotal != null ? finalTotal.toFixed(2) : null,
    price_per_item: null,
    website_url: document.getElementById('shipment-website-url')?.value.trim() || null,
    notes: document.getElementById('shipment-notes')?.value.trim() || null,
    items
  };
}

async function saveShipmentTemplateFromForm() {
  if (!isOnline()) {
    showShipmentTemplateMessage('Templates require an online connection.', 'crimson');
    return;
  }

  const nameInput = document.getElementById('shipment-template-name');
  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) {
    showShipmentTemplateMessage('Template name is required.', 'crimson');
    return;
  }

  try {
    showShipmentTemplateMessage('Saving template...', '');
    const payload = buildTemplatePayloadFromForm(name);
    await fetchJSON('/api/shipments/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (nameInput) nameInput.value = '';
    await loadShipmentTemplates();
    showShipmentTemplateMessage('Template saved.', 'green');
  } catch (err) {
    console.error('Error saving shipment template:', err);
    showShipmentTemplateMessage(err.message || 'Failed to save template.', 'crimson');
  }
}

function applyShipmentTemplateById(id) {
  if (!id) return;
  let template = shipmentTemplatesCache.find(t => Number(t.id) === Number(id));
  if (!template) {
    loadShipmentTemplates().then(() => {
      template = shipmentTemplatesCache.find(t => Number(t.id) === Number(id));
      if (template) applyShipmentTemplateToForm(template);
    });
    return;
  }
  applyShipmentTemplateToForm(template);
}

function applyShipmentTemplateToForm(template) {
  if (!template) return;

  openShipmentCreateModal();

  const titleInput = document.getElementById('shipment-title');
  const vendorSelect = document.getElementById('shipment-vendor');
  const projectSelect = document.getElementById('shipment-project');
  const forwarderSelect = document.getElementById('shipment-forwarder');
  const destinationInput = document.getElementById('shipment-destination');
  const countryInput = document.getElementById('shipment-country-origin');
  const websiteInput = document.getElementById('shipment-website-url');
  const notesInput = document.getElementById('shipment-notes');
  const totalOverrideInput = document.getElementById('shipment-total-price-override');

  if (titleInput) titleInput.value = template.title || '';
  if (destinationInput) destinationInput.value = template.destination || '';
  if (countryInput) {
    countryInput.value = template.country_of_origin || '';
    countryInput.dataset.prevValue = countryInput.value || '';
  }
  if (websiteInput) websiteInput.value = template.website_url || '';
  if (notesInput) notesInput.value = template.notes || '';
  if (totalOverrideInput) {
    const hasItems = Array.isArray(template.items) && template.items.length > 0;
    const itemsTotal = hasItems
      ? template.items.reduce((sum, it) => {
          const line =
            it && it.line_total != null
              ? Number(it.line_total)
              : (Number(it?.quantity) || 0) * (Number(it?.unit_price) || 0);
          return sum + (Number.isNaN(line) ? 0 : line);
        }, 0)
      : 0;
    const totalPrice =
      template.total_price != null ? Number(template.total_price) : null;
    const normalizedItemsTotal = Number.isFinite(itemsTotal)
      ? Number(itemsTotal.toFixed(2))
      : null;
    const normalizedTotalPrice =
      totalPrice != null && Number.isFinite(totalPrice)
        ? Number(totalPrice.toFixed(2))
        : null;

    if (
      hasItems &&
      normalizedTotalPrice != null &&
      normalizedItemsTotal != null &&
      Math.abs(normalizedTotalPrice - normalizedItemsTotal) < 0.01
    ) {
      totalOverrideInput.value = '';
    } else {
      totalOverrideInput.value =
        normalizedTotalPrice != null ? normalizedTotalPrice.toFixed(2) : '';
    }
  }

  if (projectSelect) {
    projectSelect.value =
      template.project_id != null ? String(template.project_id) : '';
  }

  if (vendorSelect) {
    if (template.vendor_id != null) {
      vendorSelect.value = String(template.vendor_id);
    } else if (template.vendor_name) {
      const match = Array.from(vendorSelect.options).find(
        opt => opt.textContent.trim() === template.vendor_name.trim()
      );
      vendorSelect.value = match ? match.value : '';
    } else {
      vendorSelect.value = '';
    }
  }

  if (forwarderSelect) {
    setShipmentForwarderValue(template.freight_forwarder || '');
  }

  const rowsContainer = document.getElementById('shipment-items-rows');
  if (rowsContainer) {
    rowsContainer.innerHTML = '';
    if (Array.isArray(template.items) && template.items.length) {
      template.items.forEach(item => {
        addShipmentItemRow({
          description: item.description,
          sku: item.sku,
          country_of_origin: item.country_of_origin,
          quantity: item.quantity != null ? Number(item.quantity) : '',
          unit_price: item.unit_price != null ? Number(item.unit_price) : '',
          line_total: item.line_total != null ? Number(item.line_total) : 0,
          vendor_name: item.vendor_name || ''
        });
      });
    } else {
      addShipmentItemRow();
    }
  }

  recalcShipmentItemsTotal();
  syncVerifyAllCheckboxState();
  if (countryInput) {
    syncCountryOfOriginApplyAllFromItems(
      (countryInput.value || '').trim(),
      Array.isArray(template.items) ? template.items : []
    );
  }
}

async function deleteShipmentTemplate(id) {
  if (!id) return;
  const ok = await showYesNoPrompt('Delete this template? This cannot be undone.', {
    yesLabel: 'Delete template',
    noLabel: 'Keep it',
    tone: 'danger'
  });
  if (!ok) return;

  try {
    await fetchJSON(`/api/shipments/templates/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    await loadShipmentTemplates();
  } catch (err) {
    console.error('Error deleting template:', err);
    showShipmentTemplateMessage(err.message || 'Failed to delete template.', 'crimson');
  }
}

function updateShipmentsStatusFilter(statuses) {
  const select = document.getElementById('shipments-filter-status');
  if (!select || !Array.isArray(statuses)) return;

  // Remember the currently selected value (if any)
  const previousValue = select.value;
  const normalizedStatuses = normalizeShipmentStatusList(statuses);

  // Rebuild options, keeping a default "All statuses"
  select.innerHTML = '';
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'All statuses';
  select.appendChild(defaultOpt);

  normalizedStatuses.forEach(status => {
    const opt = document.createElement('option');
    opt.value = status;
    opt.textContent = status;
    select.appendChild(opt);
  });

  // Restore selection if it still exists in the new list
  if (previousValue) {
    const matched = matchNormalizedStatus(previousValue, normalizedStatuses);
    if (matched) select.value = matched;
  }
}

async function loadArchivedShipmentsPreview(filters = {}, opts = {}) {
  if (currentStatusFilter) return;

  const skipRender = !!(opts && opts.skipRender);

  const search = filters.search || '';
  const projectId = filters.project_id || '';
  const vendorId = filters.vendor_id || '';

  if (!isOnline()) {
    const cached = loadShipmentsArchivedPreviewCache();
    if (cached) {
      archivedShipmentsPreview = Array.isArray(cached.list) ? cached.list : [];
      archivedShipmentsPreviewHasMore = !!cached.hasMore;
    }
    return;
  }

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (projectId) params.set('project_id', projectId);
  if (vendorId) params.set('vendor_id', vendorId);
  params.set('status', 'Archived');
  params.set('limit', String(ARCHIVED_PREVIEW_FETCH_LIMIT));

  try {
    const data = await fetchJSON('/api/shipments?' + params.toString());
    const normalized = normalizeShipmentsBoardData(data);
    const list = normalized.shipmentsByStatus?.Archived || [];
    const hasMore = list.length > ARCHIVED_PREVIEW_LIMIT;

    archivedShipmentsPreview = list.slice(0, ARCHIVED_PREVIEW_LIMIT);
    archivedShipmentsPreviewHasMore = hasMore;

    saveShipmentsArchivedPreviewCache({
      list: archivedShipmentsPreview,
      hasMore
    });

    if (!skipRender && !currentStatusFilter) {
      renderShipmentsBoard();
    }
  } catch (err) {
    console.error('Error loading archived shipments preview:', err);
    const cached = loadShipmentsArchivedPreviewCache();
    if (cached) {
      archivedShipmentsPreview = Array.isArray(cached.list) ? cached.list : [];
      archivedShipmentsPreviewHasMore = !!cached.hasMore;
    }
  }
}

async function loadShipmentsBoard(opts = {}) {
  const msgEl = document.getElementById('shipments-board-message');
  const boardEl = document.getElementById('shipments-board');
  if (!boardEl) return;

  const preserveBoard = !!(opts && opts.preserveBoard);
  const silent = !!(opts && opts.silent);
  const awaitArchivedPreview = !!(opts && opts.awaitArchivedPreview);

  if (!preserveBoard) {
    boardEl.innerHTML = '';
  }
  if (msgEl && !silent) {
    msgEl.textContent = isOnline()
      ? 'Loading shipments…'
      : 'Offline – showing last downloaded shipments.';
    msgEl.style.color = isOnline() ? '' : '#b45309'; // amber-ish
  }

  const search =
    document.getElementById('shipments-search')?.value || '';
  const statusFilter = currentStatusFilter || '';
  const projectFilter =
    document.getElementById('shipments-filter-project')?.value || '';
  const vendorFilter =
    document.getElementById('shipments-filter-vendor')?.value || '';
  const archivedPreviewFilters = {
    search,
    project_id: projectFilter,
    vendor_id: vendorFilter
  };

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (statusFilter) params.set('status', statusFilter);
  if (projectFilter) params.set('project_id', projectFilter);
  if (vendorFilter) params.set('vendor_id', vendorFilter);

  // If offline, skip fetch and use cache if available
  if (!isOnline()) {
    const cached = loadShipmentsBoardCache();
    if (cached) {
      const normalized = normalizeShipmentsBoardData(cached);
      shipmentsBoardData = normalized;
      if (currentStatusFilter) {
        const matched = matchNormalizedStatus(currentStatusFilter, normalized.statuses);
        if (matched) currentStatusFilter = matched;
      }
      updateShipmentsStatusFilter(normalized.statuses || []);
      if (normalized.statuses) {
        populateStatusDropdown(normalized.statuses);
      }
      renderNotificationStatusCheckboxes(normalized.statuses || []);
      refreshShipmentNotificationOptions();
      if (awaitArchivedPreview) {
        await loadArchivedShipmentsPreview(archivedPreviewFilters, { skipRender: true });
      } else {
        loadArchivedShipmentsPreview(archivedPreviewFilters);
      }
      renderShipmentsBoard();
      return;
    }
    // fall through to normal behavior → will show error message
  }

  try {
    const data = await fetchJSON('/api/shipments?' + params.toString());
    const normalized = normalizeShipmentsBoardData(data);
    shipmentsBoardData = normalized;

    // Save fresh copy for offline use
    saveShipmentsBoardCache(normalized);

    if (currentStatusFilter) {
      const matched = matchNormalizedStatus(currentStatusFilter, normalized.statuses);
      if (matched) currentStatusFilter = matched;
    }

    updateShipmentsStatusFilter(normalized.statuses || []);
    if (normalized.statuses) {
      populateStatusDropdown(normalized.statuses);
    }
    renderNotificationStatusCheckboxes(normalized.statuses || []);
    refreshShipmentNotificationOptions();
    if (awaitArchivedPreview) {
      await loadArchivedShipmentsPreview(archivedPreviewFilters, { skipRender: true });
    } else {
      loadArchivedShipmentsPreview(archivedPreviewFilters);
    }

    renderShipmentsBoard();
    if (msgEl && !silent) {
      msgEl.textContent = '';
      msgEl.style.color = '';
    }
  } catch (err) {
    // For background refreshes (ex: drag/drop status changes), avoid nuking the DOM
    // or overwriting any existing queue warnings/messages.
    if (silent && preserveBoard) {
      console.error('Error loading shipments:', err.message);
      return;
    }

    console.error('Error loading shipments:', err.message);
    if (!preserveBoard) {
      boardEl.innerHTML = '';
    }
    if (msgEl && !silent) {
      msgEl.textContent = 'Error loading shipments: ' + err.message;
      msgEl.style.color = 'red';
    }

    // If fetch failed but we *do* have a cache, use it as a fallback
    const cached = loadShipmentsBoardCache();
    if (cached) {
      const normalized = normalizeShipmentsBoardData(cached);
      shipmentsBoardData = normalized;
      if (currentStatusFilter) {
        const matched = matchNormalizedStatus(currentStatusFilter, normalized.statuses);
        if (matched) currentStatusFilter = matched;
      }
      updateShipmentsStatusFilter(normalized.statuses || []);
      if (normalized.statuses) {
        populateStatusDropdown(normalized.statuses);
      }
      renderNotificationStatusCheckboxes(normalized.statuses || []);
      refreshShipmentNotificationOptions();
      if (awaitArchivedPreview) {
        await loadArchivedShipmentsPreview(archivedPreviewFilters, { skipRender: true });
      } else {
        loadArchivedShipmentsPreview(archivedPreviewFilters);
      }
      renderShipmentsBoard();
      if (msgEl && !silent) {
        msgEl.textContent =
          'Offline – showing last downloaded shipments (may be stale).';
        msgEl.style.color = '#b45309';
      }
    }
  }
}


async function runShipmentsSummaryReport(e) {
  if (e) e.preventDefault();

  const projectId = document.getElementById('shipments-report-project')?.value || '';
  const start     = document.getElementById('shipments-report-start')?.value || '';
  const end       = document.getElementById('shipments-report-end')?.value || '';
  const status    = document.getElementById('shipments-report-status')?.value || '';

  const params = new URLSearchParams();
  if (projectId) params.set('project_id', projectId);
  if (start)     params.set('start', start);
  if (end)       params.set('end', end);
  if (status === 'all') {
    params.set('include_archived', '1');
  } else if (!status || status === 'active') {
    params.set('include_archived', '0');
  } else {
    params.set('status', status);
    if (status === 'Picked Up') {
      params.set('include_archived', '1');
    }
  }

  const tbody = document.getElementById('shipments-report-table-body');
  const msgEl = document.getElementById('shipments-report-message');

  clearInlineReportDetail();

  if (msgEl) {
    msgEl.textContent = 'Loading report…';
    msgEl.style.color = '';
  }

  try {
    const data = await fetchJSON(`/api/reports/shipment-verification?${params.toString()}`);
    shipmentsReportData = data.shipments || [];

    renderShipmentsReportTable();
    if (msgEl) msgEl.textContent = '';
  } catch (err) {
    console.error('Error loading shipment verification report:', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="8" style="color: crimson;">Error: ${err.message || 'Failed to load report'}</td></tr>`;
    }
    clearInlineReportDetail();
    if (msgEl) {
      msgEl.textContent = 'Error loading report. Please try again.';
      msgEl.style.color = 'crimson';
    }
  }
}

let currentInlineReportDetail = null;

function clearInlineReportDetail() {
  const existing = document.querySelector('.shipment-report-detail-row');
  if (existing) existing.remove();

  if (currentInlineReportDetail && currentInlineReportDetail.btn) {
    currentInlineReportDetail.btn.textContent = 'View Details';
    currentInlineReportDetail.btn.classList.remove('details-open');
  }
  currentInlineReportDetail = null;
}

function renderShipmentVerificationDetail(detail, btn) {
  clearInlineReportDetail();

  if (!detail || !detail.shipment || !btn) return;

  const shipment = detail.shipment || {};
  const items = Array.isArray(detail.items) ? detail.items : [];
  const table = document.getElementById('shipments-report-table');
  const colspan = table?.querySelectorAll('thead th').length || 9;

  const detailRow = document.createElement('tr');
  detailRow.className = 'shipment-report-detail-row';
  detailRow.innerHTML = `
    <td colspan="${colspan}">
      <div class="shipment-report-detail">
        <div class="shipment-report-detail-body">
          <table class="subtable">
            <thead>
              <tr>
                <th>Item</th>
                <th>SKU</th>
                <th>Qty</th>
                <th>Status</th>
                <th class="narrow-cell">Verified By</th>
                <th class="small-cell">Verified At</th>
                <th class="wide-notes">Notes</th>
                <th>Storage Info</th>
              </tr>
            </thead>
            <tbody>
              ${
                items.length
                  ? items.map(it => {
                      const v = it.verification || {};
                      return `
                        <tr>
                          <td>${it.description || ''}</td>
                          <td>${it.sku || ''}</td>
                          <td>${it.quantity != null ? it.quantity : ''}</td>
                          <td>${v.status || ''}</td>
                          <td class="narrow-cell">${v.verified_by || ''}</td>
                          <td class="small-cell">${v.verified_at || ''}</td>
                          <td class="wide-notes">${v.notes || ''}</td>
                          <td>${v.storage_override || ''}</td>
                        </tr>
                      `;
                    }).join('')
                  : `<tr><td colspan="8">(no items found for this shipment)</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>
    </td>
  `;

  const parentRow = btn.closest('tr');
  if (parentRow && parentRow.parentElement) {
    parentRow.insertAdjacentElement('afterend', detailRow);
  }

  btn.textContent = 'Hide Details';
  btn.classList.add('details-open');
  currentInlineReportDetail = { btn, detailRow };
}

function getSelectedReportColumns() {
  const picked = [];
  SHIP_REPORT_COLUMNS.forEach(col => {
    const checkbox = document.querySelector(`input[data-report-col="${col.key}"]`);
    if (checkbox ? checkbox.checked : col.default) {
      picked.push(col.key);
    }
  });
  // Ensure details button always present
  if (!picked.includes('details')) picked.push('details');
  return picked;
}

function renderShipmentsReportTable() {
  const tbody = document.getElementById('shipments-report-table-body');
  const thead = document.querySelector('#shipments-report-table thead tr');
  if (!tbody || !thead) return;

  clearInlineReportDetail();

  const rows = shipmentsReportData || [];
  const selected = getSelectedReportColumns();

  // Build header
  thead.innerHTML = '';
  selected.forEach(key => {
    const colDef = SHIP_REPORT_COLUMNS.find(c => c.key === key);
    const th = document.createElement('th');
    th.textContent = colDef ? colDef.label : key;
    thead.appendChild(th);
  });

  // Build body
  tbody.innerHTML = '';
  if (!rows.length) {
    const colCount = selected.length || 1;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="${colCount}">(no shipments found for this filter)</td>`;
    tbody.appendChild(tr);
    return;
  }

  rows.forEach(row => {
    const tr = document.createElement('tr');
    const readyFlag =
      row.items_verified &&
      !row.picked_up_by &&
      row.status === 'Cleared - Ready for Pickup';

    selected.forEach(key => {
      const td = document.createElement('td');
      switch (key) {
        case 'bol':
          td.textContent = row.bol_number || '—';
          break;
        case 'sku':
          td.textContent = row.sku || '';
          break;
        case 'project':
          td.textContent = `${row.customer_name || ''} – ${row.project_name || ''}`;
          break;
        case 'title':
          td.textContent = row.title || '';
          break;
        case 'status':
          td.textContent = row.status || '';
          break;
        case 'verified':
          td.textContent = row.items_verified ? 'Yes' : 'No';
          break;
        case 'eta':
          td.textContent = row.shipper_paid ? 'Paid' : 'Unpaid';
          break;
        case 'ready':
          td.textContent = row.customs_paid ? 'Paid' : 'Unpaid';
          break;
        case 'tracking':
          td.textContent = row.tracking_number || '';
          break;
        case 'forwarder':
          td.textContent = row.freight_forwarder || '';
          break;
        case 'vendor':
          td.textContent = row.vendor_name || '';
          break;
        case 'vendor_paid':
          td.textContent = row.vendor_paid ? 'Paid' : 'Unpaid';
          break;
        case 'vendor_paid_amt':
          td.textContent =
            row.vendor_paid_amount != null
              ? `$${Number(row.vendor_paid_amount).toFixed(2)}`
              : '';
          break;
        case 'ff_paid':
          td.textContent = row.shipper_paid ? 'Paid' : 'Unpaid';
          break;
        case 'ff_paid_amt':
          td.textContent =
            row.shipper_paid_amount != null
              ? `$${Number(row.shipper_paid_amount).toFixed(2)}`
              : '';
          break;
        case 'customs_paid':
          td.textContent = row.customs_paid ? 'Paid' : 'Unpaid';
          break;
        case 'customs_paid_amt':
          td.textContent =
            row.customs_paid_amount != null
              ? `$${Number(row.customs_paid_amount).toFixed(2)}`
              : '';
          break;
        case 'total_paid':
          td.textContent =
            row.total_paid != null ? `$${Number(row.total_paid).toFixed(2)}` : '';
          break;
        case 'picked_by':
          td.textContent = row.picked_up_by || '';
          break;
        case 'picked_date':
          td.textContent = row.picked_up_date || '';
          break;
        case 'details': {
          const btn = document.createElement('button');
          btn.className = 'btn btn-sm secondary';
          btn.dataset.shipmentId = row.id;
          btn.textContent = 'View Details';
          td.appendChild(btn);
          break;
        }
        default:
          td.textContent = '';
      }
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}

function bindExpandableSelect(select) {
  if (!select || select.dataset.expandSelectBound) return;
  const expand = () => {
    const count = select.options ? select.options.length : 0;
    if (count > 1) select.size = count;
  };
  const collapse = () => {
    select.size = 1;
  };
  select.addEventListener('focus', expand);
  select.addEventListener('blur', collapse);
  select.addEventListener('change', () => {
    collapse();
    select.blur();
  });
  collapse();
  select.dataset.expandSelectBound = '1';
}

function initShipmentsReportUI() {
  const form = document.getElementById('shipments-report-form');
  if (form) {
    form.addEventListener('submit', runShipmentsSummaryReport);
  }

  bindExpandableSelect(document.getElementById('shipments-report-status'));

  // Column picker
  const colToggle = document.getElementById('report-columns-toggle');
  const colMenu   = document.getElementById('report-columns-menu');
  document.querySelectorAll('input[data-report-col]').forEach(cb => {
    cb.addEventListener('change', renderShipmentsReportTable);
  });
  if (colToggle && colMenu) {
    colToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      colMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!colMenu.contains(e.target) && !colToggle.contains(e.target)) {
        colMenu.classList.add('hidden');
      }
    });
  }

  // Set initial label
  const colLabel = document.getElementById('report-columns-label');
  if (colLabel) {
    colLabel.textContent = 'Default columns';
  }

  // Click → load detail report for that shipment
  const tbody = document.getElementById('shipments-report-table-body');
  if (tbody) {
    tbody.addEventListener('click', async evt => {
      const btn = evt.target.closest('button[data-shipment-id]');
      if (!btn) return;
      const shipmentId = btn.dataset.shipmentId;
      if (!shipmentId) return;

      // Toggle hide if already open
      if (btn.classList.contains('details-open')) {
        clearInlineReportDetail();
        return;
      }

      try {
        const detail = await fetchJSON(
          `/api/reports/shipment-verification?shipment_id=${encodeURIComponent(
            shipmentId
          )}`
        );
        renderShipmentVerificationDetail(detail, btn);

        // reset other buttons
        tbody.querySelectorAll('button[data-shipment-id]').forEach(b => {
          if (b !== btn) {
            b.textContent = 'View Details';
            b.classList.remove('details-open');
          }
        });
      } catch (err) {
        console.error('Error loading shipment verification detail:', err);
        alert('Error loading shipment details: ' + err.message);
      }
    });
  }
}


function setShipmentCreateStep(step) {
  const normalized = step === 2 || step === 3 || step === 4 || step === 5 ? step : 1;
  currentShipmentCreateStep = normalized;

  const step1 = document.getElementById('shipment-create-step-1');
  const step2 = document.getElementById('shipment-create-step-2');
  const step3 = document.getElementById('shipment-create-step-3');
  const step4 = document.getElementById('shipment-create-step-4');
  const step5 = document.getElementById('shipment-create-step-5');
  const nextBtn = document.getElementById('shipment-step-next');
  const saveBtn = document.getElementById('shipment-step-save');
  const backBtn = document.getElementById('shipment-create-back');
  const stepperItems = document.querySelectorAll('.shipment-stepper-item');
  const form = document.getElementById('shipment-create-form');
  const modalCard = document.querySelector('#shipment-create-modal .modal-card-wide');

  if (step1) step1.classList.toggle('hidden', normalized !== 1);
  if (step2) step2.classList.toggle('hidden', normalized !== 2);
  if (step3) step3.classList.toggle('hidden', normalized !== 3);
  if (step4) step4.classList.toggle('hidden', normalized !== 4);
  if (step5) step5.classList.toggle('hidden', normalized !== 5);
  if (nextBtn) {
    nextBtn.classList.toggle('hidden', normalized === 5);
    if (normalized === 1) nextBtn.textContent = 'Next: Items';
    if (normalized === 2) nextBtn.textContent = 'Next: Payments';
    if (normalized === 3) nextBtn.textContent = 'Next: Documents';
    if (normalized === 4) nextBtn.textContent = 'Next: Pickup';
  }
  if (saveBtn) saveBtn.classList.toggle('hidden', normalized !== 5);
  if (backBtn) backBtn.classList.toggle('hidden', normalized === 1);
  if (form) form.dataset.step = String(normalized);

  stepperItems.forEach(item => {
    const itemStep = Number(item.dataset.step || 0);
    item.classList.toggle('active', itemStep === normalized);
    item.classList.toggle('complete', itemStep > 0 && itemStep < normalized);
  });

  if (modalCard) {
    modalCard.scrollTop = 0;
  }

  if (normalized === 2) {
    maybeRefreshShipmentItemsForEdit();
  }
  if (normalized === 3) {
    ensureShipmentPaidByValues();
  }
  if (normalized === 4) {
    maybeRefreshShipmentDocsForEdit();
  }
  if (normalized === 5) {
    updatePickupControlsForStatus(
      document.getElementById('shipment-status')?.value || ''
    );
  }
}

async function handleShipmentStepperJump(targetStep) {
  const modal = document.getElementById('shipment-create-modal');
  if (!modal || modal.classList.contains('hidden')) return;

  const form = document.getElementById('shipment-create-form');
  const currentStep = Number(form?.dataset.step || '1') || 1;
  const nextStep = Number(targetStep || 1) || 1;

  if (nextStep === currentStep) return;

  if (nextStep < currentStep) {
    setShipmentCreateStep(nextStep);
    return;
  }

  const stepper = document.querySelector('.shipment-stepper');
  if (stepper?.dataset.busy === '1') return;

  if (stepper) stepper.dataset.busy = '1';
  try {
    const result = await saveShipmentFromModal({
      stayOpen: true,
      skipItems: currentStep === 1,
      successMessage: 'Draft saved.'
    });
    if (result && result.ok) {
      setShipmentCreateStep(nextStep);
    }
  } finally {
    if (stepper) stepper.dataset.busy = '0';
  }
}

function openShipmentCreateModal() {
  // 🔒 BLOCK AUTOFILL ON SHIPMENTS SEARCH WHILE MODAL IS OPEN
  const shipmentsSearch = document.getElementById('shipments-search');
  if (shipmentsSearch) {
    shipmentsSearch.setAttribute('autocomplete', 'off');
    shipmentsSearch.setAttribute('autocorrect', 'off');
    shipmentsSearch.setAttribute('autocapitalize', 'off');
    shipmentsSearch.setAttribute('spellcheck', 'false');
    shipmentsSearch.setAttribute('name', 'shipments-search-no-autofill');
    shipmentsSearch.value = '';
    shipmentsSearch.setAttribute('disabled', 'true');
  }

  setShipmentCreateStep(1);

  const modal    = document.getElementById('shipment-create-modal');
  const backdrop = document.getElementById('shipment-create-backdrop');
  const form     = document.getElementById('shipment-create-form');
  const msgEl    = document.getElementById('shipment-create-status');
  const idInput  = document.getElementById('shipment-id');
  const updatedAtInput = document.getElementById('shipment-updated-at');
  const storageDueInput     = document.getElementById('shipment-storage-due-date');
  const storageDailyInput   = document.getElementById('shipment-storage-daily-fee');
  const containerInput      = document.getElementById('shipment-is-container');
  const storageEstimate     = document.getElementById('shipment-storage-fees-estimate');
  const storageEstimateHelp = document.getElementById('shipment-storage-fees-helper');
  const totalOverrideInput  = document.getElementById('shipment-total-price-override');
  const requestedClearingChk = document.getElementById('shipment-requested-clearing');
  const requestedClearingDateInput = document.getElementById('shipment-requested-clearing-date');
  const header   = modal ? modal.querySelector('h3') : null;

  refreshShipmentPaidByOptions(shipmentsProjectsCache);

  // NEW fields for post-pickup + payments
  const pickedUpByInput   = document.getElementById('shipment-picked-up-by');
  const pickedUpDateInput = document.getElementById('shipment-picked-up-date');
  const shipperPaidChk    = document.getElementById('shipment-shipper-paid');
  const shipperPaidAmt    = document.getElementById('shipment-shipper-paid-amount');
  const shipperPaidBySel  = document.getElementById('shipment-shipper-paid-by');
  const shipperPaidByOther = document.getElementById('shipment-shipper-paid-by-other');
  const customsPaidChk    = document.getElementById('shipment-customs-paid');
  const customsPaidAmt    = document.getElementById('shipment-customs-paid-amount');
  const customsPaidBySel  = document.getElementById('shipment-customs-paid-by');
  const customsPaidByOther = document.getElementById('shipment-customs-paid-by-other');
  const storagePaidChk    = document.getElementById('shipment-storage-paid');
  const storagePaidAmt    = document.getElementById('shipment-storage-paid-amount');
  const storagePaidBySel  = document.getElementById('shipment-storage-paid-by');
  const storagePaidByOther = document.getElementById('shipment-storage-paid-by-other');

  if (form) {
    form.reset();
    form.dataset.vendorPaid = '0';
    form.dataset.vendorPaidAmount = '';
    form.dataset.shipperPaidBy = '';
    form.dataset.customsPaidBy = '';
    form.dataset.storagePaidBy = '';
  }
  const cooInputReset = document.getElementById('shipment-country-origin');
  if (cooInputReset) cooInputReset.dataset.prevValue = cooInputReset.value || '';
  syncShipmentForwarderOtherState();
  if (requestedClearingChk) requestedClearingChk.checked = false;
  if (requestedClearingDateInput) requestedClearingDateInput.value = '';
  syncRequestedClearingControls({ clearWhenUnchecked: true });
  if (updatedAtInput) updatedAtInput.value = '';

  // Reset total paid display + hidden numeric
  const totalPaidDisplay = document.getElementById('shipment-total-paid-display');
  const totalPaidCompanyDisplay = document.getElementById('shipment-total-paid-company-display');
  const totalPaidOtherDisplay = document.getElementById('shipment-total-paid-other-display');
  const totalPaidHidden  = document.getElementById('shipment-total-paid');

  if (totalPaidDisplay) totalPaidDisplay.value = '';
  if (totalPaidCompanyDisplay) totalPaidCompanyDisplay.value = '';
  if (totalPaidOtherDisplay) totalPaidOtherDisplay.value = '';
  if (totalPaidHidden)  totalPaidHidden.value  = '';
  if (totalOverrideInput) totalOverrideInput.value = '';

  // Reset message
  if (msgEl) {
    msgEl.textContent = '';
    msgEl.style.color = 'black';
  }

  // Reset storage due date / fees
  if (storageDueInput) storageDueInput.value = '';
  if (storageDailyInput) {
    storageDailyInput.value = '';
    storageDailyInput.dataset.defaultSource = '';
    storageDailyInput.dataset.defaultValue = '';
  }
  if (containerInput) containerInput.checked = false;
  updateStorageFeeLabels();
  if (storageEstimate) storageEstimate.value = '$0.00';
  if (storageEstimateHelp) {
    storageEstimateHelp.textContent = '';
    storageEstimateHelp.style.display = 'none';
  }

  // Default payments to unpaid and disable amounts
  applyPaymentCheckboxState(shipperPaidChk, shipperPaidAmt, shipperPaidChk?.checked);
  applyPaymentCheckboxState(customsPaidChk, customsPaidAmt, customsPaidChk?.checked);
  applyPaymentCheckboxState(storagePaidChk, storagePaidAmt, storagePaidChk?.checked);
  setShipmentPaidByControlsEnabled(shipperPaidBySel, shipperPaidByOther, !!shipperPaidChk?.checked);
  setShipmentPaidByControlsEnabled(customsPaidBySel, customsPaidByOther, !!customsPaidChk?.checked);
  setShipmentPaidByControlsEnabled(storagePaidBySel, storagePaidByOther, !!storagePaidChk?.checked);

  if (idInput) idInput.value = '';
  if (header) header.textContent = 'New Shipment';

  // NEW shipment → show docs placeholder + reset doc input
  if (typeof showDocsPlaceholder === 'function') showDocsPlaceholder();

  const docsInput = document.getElementById('shipment-documents');
  if (docsInput) docsInput.value = '';

  // Clear validation styling
  const titleInput     = document.getElementById('shipment-title');
  const projectInput   = document.getElementById('shipment-project');
  const vendorSelect   = document.getElementById('shipment-vendor');
  const trackingHelper = document.getElementById('shipment-tracking-helper');

  if (trackingHelper) trackingHelper.textContent = '';
  titleInput?.classList.remove('field-error');
  projectInput?.classList.remove('field-error');
  vendorSelect?.classList.remove('field-error');

  // Reset pickup fields
  if (pickedUpByInput)   pickedUpByInput.value   = '';
  if (pickedUpDateInput) pickedUpDateInput.value = '';

  // Reset payment fields
  if (shipperPaidChk) shipperPaidChk.checked = false;
  if (shipperPaidAmt) shipperPaidAmt.value   = '';
  if (customsPaidChk) customsPaidChk.checked = false;
  if (customsPaidAmt) customsPaidAmt.value   = '';
  if (storagePaidChk) storagePaidChk.checked = false;
  if (storagePaidAmt) {
    storagePaidAmt.value = '';
    storagePaidAmt.dataset.manual = '0';
  }
  if (storagePaidBySel) storagePaidBySel.value = '';
  if (storagePaidByOther) storagePaidByOther.value = '';
  if (shipperPaidBySel) shipperPaidBySel.value = '';
  if (shipperPaidByOther) shipperPaidByOther.value = '';
  if (customsPaidBySel) customsPaidBySel.value = '';
  if (customsPaidByOther) customsPaidByOther.value = '';
  updatePaidByOtherVisibility(shipperPaidBySel, shipperPaidByOther);
  updatePaidByOtherVisibility(customsPaidBySel, customsPaidByOther);
  updatePaidByOtherVisibility(storagePaidBySel, storagePaidByOther);

  // Pre-select project based on board filter
  const boardProjectFilter  = document.getElementById('shipments-filter-project');
  const createProjectSelect = document.getElementById('shipment-project');
  if (boardProjectFilter && createProjectSelect && boardProjectFilter.value) {
    createProjectSelect.value = boardProjectFilter.value;
  }

  // Load statuses into dropdown
  const statusSelect = document.getElementById('shipment-status');
  if (statusSelect && shipmentsBoardData && Array.isArray(shipmentsBoardData.statuses)) {
    statusSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select status…';
    statusSelect.appendChild(placeholder);

    shipmentsBoardData.statuses.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      statusSelect.appendChild(opt);
    });

    // Default to Pre-Order
    if (shipmentsBoardData.statuses.includes('Pre-Order')) {
      statusSelect.value = 'Pre-Order';
    }

    applyStatusColorToSelect(statusSelect);

    // --- IMPORTANT: Verification lock handling ---
    statusSelect.onchange = () => {
      applyStatusColorToSelect(statusSelect);
      toggleShipmentVerificationSection(statusSelect.value);
      applyItemVerificationLockForStatus(statusSelect.value);
      updatePickupControlsForStatus(statusSelect.value);
    };

    toggleShipmentVerificationSection(statusSelect.value || '');
    applyItemVerificationLockForStatus(statusSelect.value || '');
    updatePickupControlsForStatus(statusSelect.value || '');
  }

  // Reset items section + one blank row
  initShipmentItemsSection();

  // Wire up header-level "verify all"
  initShipmentVerificationControls();

  // Keep vendor apply-all unchecked by default; item vendors will be populated on edit
  const vendorApplyAll = document.getElementById('shipment-vendor-apply-all');
  if (vendorApplyAll) vendorApplyAll.checked = false;
  const cooApplyAll = document.getElementById('shipment-coo-apply-all');
  if (cooApplyAll) cooApplyAll.checked = false;

  applyDefaultStorageLateFeeFromSettings();
  updateStorageFeeEstimate();

  // Show modal
  shipmentItemsLoadedOnce = false;
  shipmentDocsLoadedOnce = false;
  setShipmentFormBaseline();
  if (modal)    modal.classList.remove('hidden');
  if (backdrop) backdrop.classList.remove('hidden');
}

async function saveShipmentFromModal(options = {}) {
  const {
    stayOpen = false,
    successMessage = '',
    successColor = 'green',
    skipItems = false
  } = options;
  const msgEl   = document.getElementById('shipment-create-status');
  const idInput = document.getElementById('shipment-id');
  const updatedAtInput = document.getElementById('shipment-updated-at');
  const shipmentId = idInput && idInput.value ? idInput.value : null;

  if (msgEl) {
    msgEl.textContent = '';
    msgEl.style.color = 'black';
  }

  // Collect items and compute total (optional on early steps)
  const items = skipItems ? null : collectShipmentItemsFromForm();
  const itemsTotal = !skipItems
    ? (Array.isArray(items) ? items : []).reduce(
        (sum, it) => sum + (Number(it.line_total) || 0),
        0
      )
    : 0;
  const totalOverrideRaw =
    document.getElementById('shipment-total-price-override')?.value || '';
  const totalOverride =
    totalOverrideRaw !== '' ? Number(totalOverrideRaw) : null;
  const finalTotal =
    totalOverride != null && !Number.isNaN(totalOverride)
      ? totalOverride
      : (itemsTotal > 0 ? itemsTotal : null);

  // Required fields
  const titleInput   = document.getElementById('shipment-title');
  const projectInput = document.getElementById('shipment-project');
  const vendorSelect = document.getElementById('shipment-vendor');
  const statusInput  = document.getElementById('shipment-status');

  const title        = titleInput?.value.trim() || '';
  const projectIdRaw = projectInput?.value || '';
  const vendorIdRaw  = vendorSelect?.value || '';
  const vendorName =
    vendorSelect && vendorSelect.selectedIndex > 0
      ? vendorSelect.options[vendorSelect.selectedIndex].textContent.trim()
      : '';
  const statusRaw = statusInput?.value || '';

  // Optional website
  const websiteRaw =
    document.getElementById('shipment-website-url')?.value.trim() || '';

  // NEW: post-pickup + payments fields
  const storageDueInput     = document.getElementById('shipment-storage-due-date');
  const storageDailyInput   = document.getElementById('shipment-storage-daily-fee');
  const isContainerInput    = document.getElementById('shipment-is-container');
  const pickedUpByInput     = document.getElementById('shipment-picked-up-by');
  const pickedUpDateInput   = document.getElementById('shipment-picked-up-date');
  const requestedClearingChk = document.getElementById('shipment-requested-clearing');
  const requestedClearingDateInput = document.getElementById('shipment-requested-clearing-date');

  const shipperPaidChk      = document.getElementById('shipment-shipper-paid');
  const shipperPaidAmtInput = document.getElementById('shipment-shipper-paid-amount');
  const shipperPaidBySel    = document.getElementById('shipment-shipper-paid-by');
  const shipperPaidByOther  = document.getElementById('shipment-shipper-paid-by-other');
  const customsPaidChk      = document.getElementById('shipment-customs-paid');
  const customsPaidAmtInput = document.getElementById('shipment-customs-paid-amount');
  const customsPaidBySel    = document.getElementById('shipment-customs-paid-by');
  const customsPaidByOther  = document.getElementById('shipment-customs-paid-by-other');
  const storagePaidChk      = document.getElementById('shipment-storage-paid');
  const storagePaidAmtInput = document.getElementById('shipment-storage-paid-amount');
  const storagePaidBySel    = document.getElementById('shipment-storage-paid-by');
  const storagePaidByOther  = document.getElementById('shipment-storage-paid-by-other');

  const storageDueDate = storageDueInput?.value || '';
  const storageDailyFeeRaw = storageDailyInput?.value || '';
  const storageDailyFee =
    storageDailyFeeRaw !== '' && !Number.isNaN(Number(storageDailyFeeRaw))
      ? Number(storageDailyFeeRaw)
      : null;
  const isContainer = isContainerInput && isContainerInput.checked ? 1 : 0;
  const pickedUpBy     = pickedUpByInput?.value.trim() || '';
  const pickedUpDate   = pickedUpDateInput?.value || '';
  const requestedClearingFlag =
    requestedClearingChk && requestedClearingChk.checked ? 1 : 0;
  const requestedClearingDate = requestedClearingDateInput?.value || '';

  const formEl = document.getElementById('shipment-create-form');
  const currentStep = Number(formEl?.dataset.step || '1');
  const includePayments = currentStep >= 3;

  const shipperPaid       = shipperPaidChk && shipperPaidChk.checked ? 1 : 0;
  const shipperPaidAmount =
    shipperPaid && shipperPaidAmtInput && shipperPaidAmtInput.value
      ? Number(shipperPaidAmtInput.value)
      : null;

  const customsPaid       = customsPaidChk && customsPaidChk.checked ? 1 : 0;
  const customsPaidAmount =
    customsPaid && customsPaidAmtInput && customsPaidAmtInput.value
      ? Number(customsPaidAmtInput.value)
      : null;

  const storagePaid = storagePaidChk && storagePaidChk.checked ? 1 : 0;
  const storagePaidAmount =
    storagePaidAmtInput && storagePaidAmtInput.value !== ''
      ? Number(storagePaidAmtInput.value)
      : null;

  shipperPaidBySel?.classList.remove('field-error');
  shipperPaidByOther?.classList.remove('field-error');
  customsPaidBySel?.classList.remove('field-error');
  customsPaidByOther?.classList.remove('field-error');
  storagePaidBySel?.classList.remove('field-error');
  storagePaidByOther?.classList.remove('field-error');

  const shipperPaidByInfo = resolveShipmentPaidBy(shipperPaidBySel, shipperPaidByOther);
  const customsPaidByInfo = resolveShipmentPaidBy(customsPaidBySel, customsPaidByOther);
  const storagePaidByInfo = resolveShipmentPaidBy(storagePaidBySel, storagePaidByOther);
  const shipperPaidByValue = shipperPaidByInfo.value;
  const customsPaidByValue = customsPaidByInfo.value;
  const storagePaidByValue = storagePaidByInfo.value;
  const includeShipperPaidBy = shipperPaid || shipperPaidByValue != null;
  const includeCustomsPaidBy = customsPaid || customsPaidByValue != null;
  const includeStoragePaidBy = storagePaid || storagePaidByValue != null;

  const vendorPaidStored = formEl?.dataset.vendorPaid;
  const vendorPaidAmountStored = formEl?.dataset.vendorPaidAmount;
  const vendorPaid = vendorPaidStored === '1' ? 1 : 0;
  const vendorPaidAmount =
    vendorPaid && vendorPaidAmountStored != null && vendorPaidAmountStored !== ''
      ? Number(vendorPaidAmountStored)
      : null;

  // 🔹 Auto-calculated total from hidden input
  const totalPaidInput = document.getElementById('shipment-total-paid');
  const totalPaid =
    totalPaidInput && totalPaidInput.value
      ? Number(totalPaidInput.value)
      : null;

  // 🔹 Verification fields
  const verifyAllChk          = document.getElementById('shipment-verify-all');
  const verifiedByInput       = document.getElementById('shipment-verified-by');
  const verificationNotesArea = document.getElementById('shipment-verification-notes');

  const itemsVerified     = verifyAllChk && verifyAllChk.checked ? 1 : 0;
  const verifiedBy        = verifiedByInput?.value.trim() || '';
  const verificationNotes = verificationNotesArea?.value.trim() || '';

  // 🔹 Clear old errors
  titleInput?.classList.remove('field-error');
  projectInput?.classList.remove('field-error');
  vendorSelect?.classList.remove('field-error');

  let hasError = false;
  const paymentsAllowed =
    typeof canViewShipmentPayments === 'function' ? canViewShipmentPayments() : true;
  const ensurePaymentsStep = () => {
    const step = formEl?.dataset.step || '1';
    if (step !== '3' && typeof setShipmentCreateStep === 'function') {
      setShipmentCreateStep(3);
    }
  };

  if (!title) {
    titleInput?.classList.add('field-error');
    hasError = true;
  }
  if (!projectIdRaw) {
    projectInput?.classList.add('field-error');
    hasError = true;
  }

  if (hasError) {
    if (msgEl) {
      msgEl.textContent = 'Please fill in the required fields.';
      msgEl.style.color = 'crimson';
    }
    return { ok: false };
  }

  if (includePayments && paymentsAllowed && shipperPaid && !shipperPaidByValue) {
    ensurePaymentsStep();
    if (msgEl) {
      msgEl.textContent = 'Select who paid the freight forwarder.';
      msgEl.style.color = 'crimson';
    }
    shipperPaidBySel?.classList.add('field-error');
    if (shipperPaidByInfo.missingOther) shipperPaidByOther?.classList.add('field-error');
    if (shipperPaidByInfo.missingOther) {
      shipperPaidByOther?.focus();
    } else {
      shipperPaidBySel?.focus();
    }
    return { ok: false };
  }

  if (includePayments && paymentsAllowed && customsPaid && !customsPaidByValue) {
    ensurePaymentsStep();
    if (msgEl) {
      msgEl.textContent = 'Select who paid customs/clearing.';
      msgEl.style.color = 'crimson';
    }
    customsPaidBySel?.classList.add('field-error');
    if (customsPaidByInfo.missingOther) customsPaidByOther?.classList.add('field-error');
    if (customsPaidByInfo.missingOther) {
      customsPaidByOther?.focus();
    } else {
      customsPaidBySel?.focus();
    }
    return { ok: false };
  }

  if (includePayments && paymentsAllowed && storagePaid && !storagePaidByValue) {
    ensurePaymentsStep();
    if (msgEl) {
      msgEl.textContent = 'Select who paid storage fees.';
      msgEl.style.color = 'crimson';
    }
    storagePaidBySel?.classList.add('field-error');
    if (storagePaidByInfo.missingOther) storagePaidByOther?.classList.add('field-error');
    if (storagePaidByInfo.missingOther) {
      storagePaidByOther?.focus();
    } else {
      storagePaidBySel?.focus();
    }
    return { ok: false };
  }

  // Build final payload
  const payload = {
    title,
    po_number:
      document.getElementById('shipment-po-number')?.value.trim() || '',
    vendor_id: vendorIdRaw || null,
    vendor_name: vendorName || null,
    freight_forwarder: getShipmentForwarderValue(),
    destination:
      document.getElementById('shipment-destination')?.value.trim() || '',
    project_id: projectIdRaw || null,

    country_of_origin:
      document.getElementById('shipment-country-origin')?.value.trim() || null,
    quantity: null,
    price_per_item: null,

    total_price: finalTotal != null ? finalTotal.toFixed(2) : null,
    expected_ship_date:
      document.getElementById('shipment-expected-ship-date')?.value || '',
    expected_arrival_date:
      document.getElementById('shipment-expected-arrival-date')?.value || '',
    tracking_number:
      document.getElementById('shipment-tracking-number')?.value.trim() || '',
    bol_number:
      document.getElementById('shipment-bol-number')?.value.trim() || '',
    requested_clearing: requestedClearingFlag,
    requested_clearing_date: requestedClearingFlag
      ? (requestedClearingDate || null)
      : null,

    // Storage + pickup
    storage_due_date: storageDueDate || null,
    storage_daily_late_fee: storageDailyFee != null ? storageDailyFee : null,
    is_container: isContainer,
    picked_up_by:    pickedUpBy || null,
    picked_up_date:  pickedUpDate || null,

    // Verification
    items_verified:       itemsVerified,
    verification_notes:   verificationNotes || null,

    website_url: websiteRaw || null,
    notes: document.getElementById('shipment-notes')?.value.trim() || '',
    status: statusRaw,
  };
  if (includePayments) {
    payload.vendor_paid = vendorPaid;
    payload.vendor_paid_amount = vendorPaidAmount;
    payload.shipper_paid = shipperPaid;
    payload.shipper_paid_amount = shipperPaidAmount;
    if (includeShipperPaidBy) {
      payload.shipper_paid_by = shipperPaidByValue;
    }
    payload.customs_paid = customsPaid;
    payload.customs_paid_amount = customsPaidAmount;
    if (includeCustomsPaidBy) {
      payload.customs_paid_by = customsPaidByValue;
    }
    payload.storage_paid = storagePaid;
    payload.storage_paid_amount = storagePaidAmount;
    if (includeStoragePaidBy) {
      payload.storage_paid_by = storagePaidByValue;
    }
    payload.total_paid = totalPaid;
  }
  if (!skipItems) {
    payload.items = Array.isArray(items) ? items : [];
    payload.items_total = itemsTotal || null;
  }

  if (shipmentId && updatedAtInput && updatedAtInput.value) {
    payload.if_match_updated_at = updatedAtInput.value;
  }
 // 🔹 If offline and this is a *new* shipment → block (too messy to safely create)
  if (!isOnline() && !shipmentId) {
    if (msgEl) {
      msgEl.textContent =
        'You are offline. New shipments must be created while online.';
      msgEl.style.color = 'crimson';
    }
    return { ok: false };
  }

  // 🔹 If offline and editing an existing shipment → queue update
  if (!isOnline() && shipmentId) {
    queueShipmentUpdate(shipmentId, payload);

    if (msgEl) {
      msgEl.textContent =
        'Offline: changes saved on this device and will sync when back online.';
      msgEl.style.color = '#b45309'; // amber
    }

    // Optionally close modal & refresh board from cache
    if (!stayOpen) {
      closeShipmentCreateModal();
    } else {
      updateShipmentMoreMenuState();
      setShipmentFormBaseline();
    }
    return { ok: true, queued: true, id: shipmentId };
  }

  // 🔹 Normal ONLINE path (unchanged except small addition at end)
  try {
    if (msgEl) {
      msgEl.textContent = 'Saving...';
      msgEl.style.color = 'black';
    }

    const url = shipmentId
      ? `/api/shipments/${encodeURIComponent(shipmentId)}`
      : '/api/shipments';
    const method = shipmentId ? 'PUT' : 'POST';

    const result = await fetchJSON(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const savedShipment = result && result.shipment;
    const finalId = shipmentId || (savedShipment && savedShipment.id);

    // Upload docs after shipment creation
    if (finalId) {
      await uploadShipmentDocuments(finalId);
    }

    if (msgEl) {
      msgEl.textContent =
        successMessage || (shipmentId ? 'Shipment updated.' : 'Shipment created.');
      msgEl.style.color = successColor;
    }

    if (stayOpen) {
      if (!shipmentId && finalId && idInput) {
        idInput.value = String(finalId);
      }
      if (updatedAtInput) {
        updatedAtInput.value = savedShipment?.updated_at || '';
      }

    if (!shipmentId && finalId) {
      const header = document.querySelector('#shipment-create-modal h3');
      if (header) header.textContent = 'Edit Shipment';
      if (typeof showDocsUI === 'function') showDocsUI();
      if (typeof loadShipmentDocuments === 'function') {
        loadShipmentDocuments(finalId);
      }
    }
      setShipmentFormBaseline();
    } else {
      closeShipmentCreateModal();
    }

    // 🔹 Refresh board & cache after a successful save
    await loadShipmentsBoard();

    return { ok: true, id: finalId, shipment: savedShipment };

  } catch (err) {
    if (msgEl) {
      msgEl.textContent = 'Error saving shipment: ' + err.message;
      msgEl.style.color = 'red';
    }
    return { ok: false, error: err };
  }
}


function openShipmentEditModal(shipment, items = []) {
  // Start clean — disables/clears search etc.
  openShipmentCreateModal();

  const modal    = document.getElementById('shipment-create-modal');
  const backdrop = document.getElementById('shipment-create-backdrop');
  const form     = document.getElementById('shipment-create-form');
  const idInput  = document.getElementById('shipment-id');
  const updatedAtInput = document.getElementById('shipment-updated-at');
  const header   = modal ? modal.querySelector('h3') : null;

  if (idInput) idInput.value = shipment.id;
  if (updatedAtInput) updatedAtInput.value = shipment.updated_at || '';
  if (header) header.textContent = 'Edit Shipment';
  if (form) {
    form.dataset.vendorPaid = shipment.vendor_paid ? '1' : '0';
    form.dataset.vendorPaidAmount =
      shipment.vendor_paid_amount != null ? String(shipment.vendor_paid_amount) : '';
  }

  // Enable documents UI
  if (typeof showDocsUI === "function") showDocsUI();

  // Reset docs list
  const docsInput = document.getElementById('shipment-documents');
  if (docsInput) docsInput.value = '';
  const docsList = document.getElementById('shipment-docs-list');
  if (docsList) docsList.innerHTML = '<p class="small-muted">Loading documents…</p>';

  // Basic fields
  const titleInput       = document.getElementById('shipment-title');
  const poInput          = document.getElementById('shipment-po-number');
  const vendorSelect     = document.getElementById('shipment-vendor');
  const destInput        = document.getElementById('shipment-destination');
  const projectSelect    = document.getElementById('shipment-project');
  const statusSelect     = document.getElementById('shipment-status');
  const countryInput     = document.getElementById('shipment-country-origin');
  const forwarderSelect  = document.getElementById('shipment-forwarder');
  const websiteInput     = document.getElementById('shipment-website-url');
  const notesInput       = document.getElementById('shipment-notes');
  const expShipInput     = document.getElementById('shipment-expected-ship-date');
  const expArriveInput   = document.getElementById('shipment-expected-arrival-date');
  const trackingInput    = document.getElementById('shipment-tracking-number');
  const bolInput         = document.getElementById('shipment-bol-number');
  const requestedClearingChk = document.getElementById('shipment-requested-clearing');
  const requestedClearingDateInput = document.getElementById('shipment-requested-clearing-date');
  const storageDueInput  = document.getElementById('shipment-storage-due-date');
  const storageDailyInput= document.getElementById('shipment-storage-daily-fee');
  const containerInput   = document.getElementById('shipment-is-container');
  const totalOverrideInput = document.getElementById('shipment-total-price-override');
  if (storageDailyInput) {
    storageDailyInput.dataset.defaultSource = '';
    storageDailyInput.dataset.defaultValue = '';
  }

  // Payments + pickup
  const pickedUpByInput   = document.getElementById('shipment-picked-up-by');
  const pickedUpDateInput = document.getElementById('shipment-picked-up-date');
  const shipperPaidChk    = document.getElementById('shipment-shipper-paid');
  const shipperPaidAmt    = document.getElementById('shipment-shipper-paid-amount');
  const shipperPaidBySel  = document.getElementById('shipment-shipper-paid-by');
  const shipperPaidByOther = document.getElementById('shipment-shipper-paid-by-other');
  const customsPaidChk    = document.getElementById('shipment-customs-paid');
  const customsPaidAmt    = document.getElementById('shipment-customs-paid-amount');
  const customsPaidBySel  = document.getElementById('shipment-customs-paid-by');
  const customsPaidByOther = document.getElementById('shipment-customs-paid-by-other');
  const storagePaidChk    = document.getElementById('shipment-storage-paid');
  const storagePaidAmt    = document.getElementById('shipment-storage-paid-amount');
  const storagePaidBySel  = document.getElementById('shipment-storage-paid-by');
  const storagePaidByOther = document.getElementById('shipment-storage-paid-by-other');
  const verifyAllChk      = document.getElementById('shipment-verify-all');
  const verifiedByInput   = document.getElementById('shipment-verified-by');
  const verificationNotesArea = document.getElementById('shipment-verification-notes');

  // Fill basics
  if (titleInput) titleInput.value = shipment.title || '';
  if (poInput)    poInput.value    = shipment.po_number || '';
  if (destInput)  destInput.value  = shipment.destination || '';
  if (projectSelect) {
    projectSelect.value =
      shipment.project_id != null ? String(shipment.project_id) : '';
  }

  // Vendor
  if (vendorSelect) {
    if (shipment.vendor_id != null) {
      vendorSelect.value = String(shipment.vendor_id);
    } else if (shipment.vendor_name) {
      const match = Array.from(vendorSelect.options).find(
        opt => opt.textContent.trim() === shipment.vendor_name.trim()
      );
      vendorSelect.value = match ? match.value : '';
    } else {
      vendorSelect.value = '';
    }
  }

  // Vendor apply-all: restore checkbox state from items (all match header)
  const vendorApplyAll = document.getElementById('shipment-vendor-apply-all');
  if (vendorApplyAll) {
    const headerVendorText =
      vendorSelect && vendorSelect.selectedIndex > 0
        ? vendorSelect.options[vendorSelect.selectedIndex].textContent.trim()
        : shipment.vendor_name || '';
    syncVendorApplyAllFromItems(headerVendorText, items);
  }

  // Status + verification lock handler
  if (statusSelect) {
    if (shipment.status) {
      const match = matchNormalizedStatus(
        shipment.status,
        shipmentsBoardData?.statuses || []
      );
      statusSelect.value = match || shipment.status;
    }
    applyStatusColorToSelect(statusSelect);
    toggleShipmentVerificationSection(statusSelect.value);

    statusSelect.onchange = () => {
      applyStatusColorToSelect(statusSelect);
      toggleShipmentVerificationSection(statusSelect.value);
      applyItemVerificationLockForStatus(statusSelect.value);
      updatePickupControlsForStatus(statusSelect.value);
    };
  }

  if (countryInput) {
    countryInput.value = shipment.country_of_origin || '';
    countryInput.dataset.prevValue = countryInput.value || '';
  }
  if (forwarderSelect)  setShipmentForwarderValue(shipment.freight_forwarder || '');
  if (websiteInput)     websiteInput.value     = shipment.website_url || '';
  if (notesInput)       notesInput.value       = shipment.notes || '';
  if (expShipInput)     expShipInput.value     = shipment.expected_ship_date || '';
  if (expArriveInput)   expArriveInput.value   = shipment.expected_arrival_date || '';
  if (trackingInput)    trackingInput.value    = shipment.tracking_number || '';
  if (bolInput)         bolInput.value         = shipment.bol_number || '';
  if (requestedClearingChk)
    requestedClearingChk.checked = isShipmentFlagSet(shipment.requested_clearing);
  if (requestedClearingDateInput)
    requestedClearingDateInput.value = shipment.requested_clearing_date || '';
  syncRequestedClearingControls({ clearWhenUnchecked: true });
  if (storageDueInput)  storageDueInput.value  = shipment.storage_due_date || '';
  if (containerInput)   containerInput.checked = isContainerValue(shipment.is_container);
  if (storageDailyInput)
    storageDailyInput.value =
      shipment.storage_daily_late_fee != null
        ? Number(shipment.storage_daily_late_fee).toFixed(2)
        : '';
  if (totalOverrideInput) {
    const hasItems = Array.isArray(items) && items.length > 0;
    const itemsTotal = hasItems
      ? items.reduce((sum, it) => {
          const line =
            it && it.line_total != null
              ? Number(it.line_total)
              : (Number(it?.quantity) || 0) * (Number(it?.unit_price) || 0);
          return sum + (Number.isNaN(line) ? 0 : line);
        }, 0)
      : 0;
    const totalPrice =
      shipment.total_price != null ? Number(shipment.total_price) : null;
    const normalizedItemsTotal = Number.isFinite(itemsTotal)
      ? Number(itemsTotal.toFixed(2))
      : null;
    const normalizedTotalPrice =
      totalPrice != null && Number.isFinite(totalPrice)
        ? Number(totalPrice.toFixed(2))
        : null;

    if (
      hasItems &&
      normalizedTotalPrice != null &&
      normalizedItemsTotal != null &&
      Math.abs(normalizedTotalPrice - normalizedItemsTotal) < 0.01
    ) {
      totalOverrideInput.value = '';
    } else {
      totalOverrideInput.value =
        normalizedTotalPrice != null ? normalizedTotalPrice.toFixed(2) : '';
    }
  }
  updateStorageFeeEstimate();
  updateStorageFeeLabels();

  // Post-pickup + payments
  if (pickedUpByInput)   pickedUpByInput.value   = shipment.picked_up_by || '';
  if (pickedUpDateInput) pickedUpDateInput.value = shipment.picked_up_date || '';
  if (shipperPaidChk) shipperPaidChk.checked = !!shipment.shipper_paid;
if (shipperPaidAmt)
  shipperPaidAmt.value =
    shipment.shipper_paid_amount != null
      ? Number(shipment.shipper_paid_amount).toFixed(2)
      : '';
  if (customsPaidChk) customsPaidChk.checked = !!shipment.customs_paid;
if (customsPaidAmt)
  customsPaidAmt.value =
    shipment.customs_paid_amount != null
      ? Number(shipment.customs_paid_amount).toFixed(2)
      : '';
  if (storagePaidChk) storagePaidChk.checked = !!shipment.storage_paid;
if (storagePaidAmt)
  storagePaidAmt.value =
    shipment.storage_paid_amount != null
      ? Number(shipment.storage_paid_amount).toFixed(2)
      : '';
  if (storagePaidAmt) {
    storagePaidAmt.dataset.manual = '';
  }
  applyShipmentPaidByValue(shipperPaidBySel, shipperPaidByOther, shipment.shipper_paid_by);
  applyShipmentPaidByValue(customsPaidBySel, customsPaidByOther, shipment.customs_paid_by);
  applyShipmentPaidByValue(storagePaidBySel, storagePaidByOther, shipment.storage_paid_by);

  if (form) {
    form.dataset.shipperPaidBy = shipment.shipper_paid_by || '';
    form.dataset.customsPaidBy = shipment.customs_paid_by || '';
    form.dataset.storagePaidBy = shipment.storage_paid_by || '';
  }

  // Disable/clear payment amounts when unpaid
  applyPaymentCheckboxState(
    shipperPaidChk,
    shipperPaidAmt,
    !!shipment.shipper_paid
  );
  applyPaymentCheckboxState(
    customsPaidChk,
    customsPaidAmt,
    !!shipment.customs_paid
  );
  applyPaymentCheckboxState(
    storagePaidChk,
    storagePaidAmt,
    !!shipment.storage_paid
  );
  setShipmentPaidByControlsEnabled(shipperPaidBySel, shipperPaidByOther, !!shipment.shipper_paid);
  setShipmentPaidByControlsEnabled(customsPaidBySel, customsPaidByOther, !!shipment.customs_paid);
  setShipmentPaidByControlsEnabled(storagePaidBySel, storagePaidByOther, !!shipment.storage_paid);

  updateStorageFeeEstimate();
  applyDefaultStorageLateFeeFromSettings();

  // Verification header fields
  if (verifyAllChk) verifyAllChk.checked = !!shipment.items_verified;
  if (verifiedByInput) verifiedByInput.value = '';
  if (verificationNotesArea) verificationNotesArea.value = shipment.verification_notes || '';

  // --- Build item rows from DB ---
  const rowsContainer = document.getElementById('shipment-items-rows');
  if (rowsContainer) {
    rowsContainer.innerHTML = '';

    if (Array.isArray(items) && items.length > 0) {
      items.forEach(it => {
        addShipmentItemRow({
          id: it.id,
          description: it.description,
          sku: it.sku,
          country_of_origin: it.country_of_origin,
          quantity: it.quantity,
          unit_price: it.unit_price != null ? Number(it.unit_price) : '',
          line_total: it.line_total != null ? Number(it.line_total) : 0,
          vendor_name: it.vendor_name || '',
          notes: it.notes,
          verified: it.verified,
          verification: it.verification,
          verification_json: it.verification_json
        });
      });
      shipmentItemsLoadedOnce = true;
    } else {
      addShipmentItemRow();
    }
  }

  // Sync apply-all checkbox based on existing items/vendors
  if (vendorSelect) {
    const headerVendorText =
      vendorSelect.selectedIndex > 0
        ? vendorSelect.options[vendorSelect.selectedIndex].textContent.trim()
        : '';
    syncVendorApplyAllFromItems(headerVendorText, items);
  }
  if (countryInput) {
    const headerCountry = (countryInput.value || '').trim();
    syncCountryOfOriginApplyAllFromItems(headerCountry, items);
  }

  // Totals & checkbox sync
  recalcShipmentItemsTotal();
  syncVerifyAllCheckboxState();

  // Apply verification lock AFTER rows exist
  applyItemVerificationLockForStatus(
    shipment.status || (statusSelect && statusSelect.value) || ''
  );
  updatePickupControlsForStatus(
    shipment.status || (statusSelect && statusSelect.value) || ''
  );

  updateShipmentTotalPaid();
  initShipmentVerificationControls();

  if (typeof updateShipmentTrackingHelper === 'function') {
    updateShipmentTrackingHelper();
  }

  if (shipment.id && typeof loadShipmentDocuments === 'function') {
    loadShipmentDocuments(shipment.id);
    shipmentDocsLoadedOnce = true;
  }

  setShipmentFormBaseline();
  if (backdrop) backdrop.classList.remove('hidden');
  if (modal)    modal.classList.remove('hidden');
}


function closeShipmentCreateModal() {
  const modal    = document.getElementById('shipment-create-modal');
  const backdrop = document.getElementById('shipment-create-backdrop');
  if (modal) modal.classList.add('hidden');
  if (backdrop) backdrop.classList.add('hidden');
  setShipmentCreateStep(1);
  shipmentFormBaseline = '';
  shipmentItemsLoadedOnce = false;
  shipmentDocsLoadedOnce = false;

  // 🔓 Re-enable shipments search and keep it blank
  const shipmentsSearch = document.getElementById('shipments-search');
  if (shipmentsSearch) {
    shipmentsSearch.removeAttribute('disabled');
    shipmentsSearch.value = '';
  }
}



async function uploadShipmentDocuments(shipmentId) {
  const input = document.getElementById('shipment-documents');
  const docTypeSel = document.getElementById('shipment-doc-type');
  const docLabelInput = document.getElementById('shipment-doc-label');
  if (!input || !input.files || !input.files.length) return;

  const docType = docTypeSel?.value || '';
  const docLabel = (docLabelInput?.value || '').trim();

  const formData = new FormData();
  if (docType) formData.append('doc_type', docType);
  if (docLabel) formData.append('doc_label', docLabel);

  // The field name 'documents' must match the `name` and the multer config
  for (const file of input.files) {
    formData.append('documents', file);
  }

  try {
    await fetch(`/api/shipments/${encodeURIComponent(shipmentId)}/documents`, {
      method: 'POST',
      headers: getCsrfHeader(),
      body: formData
      // No Content-Type header on purpose – browser sets multipart boundary
    });
  } catch (err) {
    console.error('Error uploading shipment documents:', err);
  }
}

async function uploadShipmentDocumentsFromModal() {
  const idInput = document.getElementById('shipment-id');
  const msgEl   = document.getElementById('shipment-create-status');
  const docTypeSel = document.getElementById('shipment-doc-type');
  const docLabelInput = document.getElementById('shipment-doc-label');
  const docLabelWrapper = document.getElementById('shipment-doc-label-wrapper');
  const shipmentId = idInput?.value;

  if (!shipmentId) {
    if (msgEl) {
      msgEl.textContent = 'Save the shipment first, then upload documents.';
      msgEl.style.color = 'crimson';
    } else {
      alert('Save the shipment first, then upload documents.');
    }
    return;
  }

  const docType = docTypeSel?.value || '';
  const docLabel = (docLabelInput?.value || '').trim();

  if (!docType) {
    if (msgEl) {
      msgEl.textContent = 'Select a document type before uploading.';
      msgEl.style.color = 'crimson';
    }
    return;
  }

  if (docType === 'Other' && !docLabel) {
    if (msgEl) {
      msgEl.textContent = 'Enter a label for “Other” document type.';
      msgEl.style.color = 'crimson';
    }
    return;
  }

  try {
    if (msgEl) {
      msgEl.textContent = 'Uploading documents...';
      msgEl.style.color = 'black';
    }

    await uploadShipmentDocuments(shipmentId);
    maybeMarkPaidAfterUpload({ doc_type: docType, doc_label: docLabel });

    // Refresh the list so new files appear immediately
    if (typeof loadShipmentDocuments === 'function') {
      await loadShipmentDocuments(shipmentId);
    }

    const docsInput = document.getElementById('shipment-documents');
    if (docsInput) docsInput.value = '';
    if (docTypeSel) docTypeSel.value = '';
    if (docLabelInput) {
      docLabelInput.value = '';
      docLabelInput.disabled = true;
    }
    if (docLabelWrapper) {
      docLabelWrapper.hidden = true;
    }

    if (msgEl) {
      msgEl.textContent = 'Documents uploaded.';
      msgEl.style.color = 'green';
    }
  } catch (err) {
    if (msgEl) {
      msgEl.textContent = 'Error uploading documents: ' + err.message;
      msgEl.style.color = 'red';
    }
  }
}

function renderShipmentsBoard() {
  const boardEl = document.getElementById('shipments-board');
  if (!boardEl) return;

  const { statuses, shipmentsByStatus } = shipmentsBoardData;
  boardEl.innerHTML = '';

  // 🔹 FILTERED MODE: a single status is selected
  if (currentStatusFilter) {
    boardEl.classList.add('shipments-board--single');

    const list = shipmentsByStatus[currentStatusFilter] || [];

    if (!list.length) {
      boardEl.innerHTML = `<div class="empty-state">No shipments with status "${currentStatusFilter}".</div>`;
      return;
    }

    // Cards are direct children of #shipments-board
    list.forEach(sh => {
      const card = document.createElement('div');
      // add status-* class so CSS colors border + header
      // 🔹 use the shipment's own status first, fall back to the filter
      const className = shipmentStatusClass(sh.status || currentStatusFilter);
      card.className = `shipment-card ${className}`;

      card.draggable = true;
      card.dataset.id = sh.id;
      card.dataset.status = currentStatusFilter;

      const projLabel = sh.project_name || '';

      const rawEta = sh.expected_arrival_date;
      const eta = rawEta ? formatDateUS(rawEta) : '';
      const missingDocs = getMissingRequiredDocsFromShipment(sh);
      const cooInfo = getShipmentCooSummary(sh);
      const cooLabel = escapeHTML(cooInfo.label || '—');
      const personalNoteText = (sh.personal_note || '').trim();
      const personalNoteDone = isShipmentFlagSet(sh.personal_note_completed);
      const hasPersonalNote = !!personalNoteText;
      const noteBtnClass = `has-note${personalNoteDone ? ' is-complete' : ''}`;
      const noteBtnIcon = personalNoteDone
        ? SHIPMENT_PERSONAL_NOTE_ICON_SVG_DONE
        : SHIPMENT_PERSONAL_NOTE_ICON_SVG_NOTE;
      const noteBtnTitle = personalNoteDone ? 'Personal note (complete)' : 'Personal note';
      const noteBtnHtml = hasPersonalNote
        ? `
    <button
      type="button"
      class="shipment-card-note-btn ${noteBtnClass}"
      title="${noteBtnTitle}"
      aria-label="${noteBtnTitle}"
      data-shipment-note
    >
      ${noteBtnIcon}
    </button>
  `
        : '';
      const missingDocsHtml =
        missingDocs && missingDocs.length
          ? `<div class="shipment-card-alert">Missing docs: ${missingDocs.join(', ')}</div>`
          : '';

card.innerHTML = `
  <div class="shipment-card-header">
    <div class="shipment-card-title">${sh.title || '(no title)'}</div>
    ${noteBtnHtml}
  </div>
  <div class="shipment-card-body">
   <div><strong>BOL #:</strong> ${sh.bol_number || '—'}</div>
   <div><strong>Project:</strong> ${projLabel || '—'}</div>
    <div><strong>Vendor:</strong> ${sh.vendor_name || '—'}</div>
    <div class="shipment-card-coo ${cooInfo.missing ? 'is-missing' : ''}">
      <strong>COO:</strong> <span>${cooLabel}</span>
    </div>
    ${missingDocsHtml}
  </div>
`;

      card.addEventListener('click', () => {
        openShipmentDetail(sh.id);
      });

      const noteBtn = card.querySelector('[data-shipment-note]');
      if (noteBtn) {
        noteBtn.draggable = false;
        noteBtn.addEventListener('dragstart', (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
        });
        noteBtn.addEventListener('click', (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          openShipmentPersonalNoteModal(sh.id);
        });
      }

      card.addEventListener('dragstart', onShipmentDragStart);
      card.addEventListener('dragend', onShipmentDragEnd);

      boardEl.appendChild(card);
    });

    return; // ✅ done in filtered mode
  }

  // 🔹 KANBAN MODE: no status filter → show all columns
  boardEl.classList.remove('shipments-board--single');

  const orderedStatuses = getOrderedShipmentStatuses(statuses);

  orderedStatuses.forEach(status => {
    const col = document.createElement('div');
    col.className = 'shipments-column ' + shipmentStatusClass(status);
    col.dataset.status = status;
    col.draggable = shipmentsColumnSortMode === 'custom';
    col.classList.toggle('shipments-column--draggable', col.draggable);
    col.addEventListener('dragstart', handleShipmentColumnDragStart);
    col.addEventListener('dragend', handleShipmentColumnDragEnd);
    col.addEventListener('dragover', handleShipmentColumnDragOver);
    col.addEventListener('drop', handleShipmentColumnDrop);

    const list = shipmentsByStatus[status] || [];
    const isArchivedColumn = normalizeShipmentStatusKey(status) === 'archived';
    let displayList = list;
    let displayCount = list.length;
    let showArchivedMore = false;

    if (isArchivedColumn) {
      const previewList = archivedShipmentsPreview.length
        ? archivedShipmentsPreview
        : list;
      const hasMore =
        archivedShipmentsPreviewHasMore || previewList.length > ARCHIVED_PREVIEW_LIMIT;
      displayList = previewList.slice(0, ARCHIVED_PREVIEW_LIMIT);
      displayCount = hasMore ? `${ARCHIVED_PREVIEW_LIMIT}+` : displayList.length;
      showArchivedMore = hasMore;
    }

    col.innerHTML = `
      <div class="shipments-column-header">
        <div class="shipments-column-title">${status}</div>
        <div class="shipments-column-count">${displayCount}</div>
      </div>
      <div class="shipments-column-body"></div>
    `;

    const body = col.querySelector('.shipments-column-body');

    displayList.forEach(sh => {
      const card = document.createElement('div');
      // again, add status-* class for color
      card.className = `shipment-card ${shipmentStatusClass(status)}`;
      card.draggable = true;
      card.dataset.id = sh.id;
      card.dataset.status = status;

      const projLabel = sh.project_name || '';

      const rawEta = sh.expected_arrival_date;
      const eta = rawEta ? formatDateUS(rawEta) : '';
	      const missingDocs = getMissingRequiredDocsFromShipment(sh);
	      const cooInfo = getShipmentCooSummary(sh);
	      const cooLabel = escapeHTML(cooInfo.label || '—');
	      const personalNoteText = (sh.personal_note || '').trim();
	      const personalNoteDone = isShipmentFlagSet(sh.personal_note_completed);
	      const hasPersonalNote = !!personalNoteText;
	      const noteBtnClass = `has-note${personalNoteDone ? ' is-complete' : ''}`;
	      const noteBtnIcon = personalNoteDone
	        ? SHIPMENT_PERSONAL_NOTE_ICON_SVG_DONE
	        : SHIPMENT_PERSONAL_NOTE_ICON_SVG_NOTE;
	      const noteBtnTitle = personalNoteDone ? 'Personal note (complete)' : 'Personal note';
	      const noteBtnHtml = hasPersonalNote
	        ? `
	    <button
	      type="button"
	      class="shipment-card-note-btn ${noteBtnClass}"
	      title="${noteBtnTitle}"
	      aria-label="${noteBtnTitle}"
	      data-shipment-note
	    >
	      ${noteBtnIcon}
	    </button>
	  `
	        : '';
	      const missingDocsHtml =
	        missingDocs && missingDocs.length
	          ? `<div class="shipment-card-alert">Missing docs: ${missingDocs.join(', ')}</div>`
	          : '';

	card.innerHTML = `
	  <div class="shipment-card-header">
	    <div class="shipment-card-title">${sh.title || '(no title)'}</div>
	    ${noteBtnHtml}
	  </div>
	  <div class="shipment-card-body">
	  <div><strong>BOL #:</strong> ${sh.bol_number || '—'}</div>
	  <div><strong>Project:</strong> ${projLabel || '—'}</div>
	    <div><strong>Vendor:</strong> ${sh.vendor_name || '—'}</div>
    <div class="shipment-card-coo ${cooInfo.missing ? 'is-missing' : ''}">
      <strong>COO:</strong> <span>${cooLabel}</span>
    </div>
    ${missingDocsHtml}
  </div>
`;

      card.addEventListener('click', () => {
        openShipmentDetail(sh.id);
      });

      const noteBtn = card.querySelector('[data-shipment-note]');
      if (noteBtn) {
        noteBtn.draggable = false;
        noteBtn.addEventListener('dragstart', (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
        });
        noteBtn.addEventListener('click', (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          openShipmentPersonalNoteModal(sh.id);
        });
      }

      card.addEventListener('dragstart', onShipmentDragStart);
      card.addEventListener('dragend', onShipmentDragEnd);

      body.appendChild(card);
    });

    if (isArchivedColumn && showArchivedMore) {
      const footer = document.createElement('div');
      footer.className = 'shipments-column-footer';
      footer.innerHTML = `
        <button type="button" class="btn tertiary btn-sm shipments-archived-more">
          View all archived
        </button>
      `;
      const moreBtn = footer.querySelector('button');
      if (moreBtn) {
        moreBtn.addEventListener('click', () => {
          applyShipmentStatusFilter('Archived');
        });
      }
      body.appendChild(footer);
    }

    boardEl.appendChild(col);
  });
}


function shipmentStatusClass(status) {
  if (!status) return '';

  const raw = String(status).toLowerCase().trim();
  const compact = raw.replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ');
  const contains = (s) => raw.includes(s) || compact.includes(s);

  // Examples based on your likely statuses:
  // "Pre-Order"
  if (contains('pre-order') || contains('pre order') || raw === 'preorder') {
    return 'status-preorder';
  }

  // "Ordered"
  if (raw === 'ordered') {
    return 'status-ordered';
  }

  // "In Transit to Forwarder"
  if (contains('in transit') || contains('transit')) {
    return 'status-transit';
  }

  // "Arrived at Forwarder"
  if (contains('forwarder')) {
    return 'status-forwarder';
  }

  // "Sailed"
  if (contains('sailed') || contains('on water')) {
    return 'status-sailed';
  }

  // "Arrived at Port", "Arrived on Island"
  if (contains('arrived at port') || (contains('arrived') && !contains('forwarder'))) {
    return 'status-arrived';
  }

  // "Awaiting Clearance", "Customs Clearance"
  if (contains('awaiting clearance') || contains('customs') || contains('clearance')) {
    return 'status-clearance';
  }

  // "Cleared - Ready for Pickup", "Ready for Pickup"
  if (contains('ready') && contains('pickup')) {
    return 'status-ready';
  }

  // "Picked Up"
  if (contains('picked') && contains('up')) {
    return 'status-pickedup';
  }

  // "Archived"
  if (contains('archived') || contains('closed')) {
    return 'status-archived';
  }

  return '';
}

function applyStatusColorToSelect(selectEl) {
  if (!selectEl) return;

  // remove any old status-* classes
  selectEl.classList.remove(
    'status-preorder',
    'status-ordered',
    'status-transit',
    'status-forwarder',
    'status-sailed',
    'status-arrived',
    'status-clearance',
    'status-ready',
    'status-pickedup',
    'status-archived'
  );

  const cls = shipmentStatusClass(selectEl.value);
  if (cls) {
    selectEl.classList.add(cls);
  }
}

function updatePickupControlsForStatus(status) {
  const pickedUpByInput = document.getElementById('shipment-picked-up-by');
  const pickedUpDateInput = document.getElementById('shipment-picked-up-date');
  const lockedNote = document.getElementById('shipment-pickup-locked-note');

  const raw = String(status || '').toLowerCase().trim();
  const allowPickup = raw.includes('picked') && raw.includes('up');

  if (pickedUpByInput) pickedUpByInput.disabled = !allowPickup;
  if (pickedUpDateInput) pickedUpDateInput.disabled = !allowPickup;
  if (lockedNote) lockedNote.classList.toggle('hidden', allowPickup);
}

function onShipmentDragStart(evt) {
  const id = evt.currentTarget.dataset.id;
  draggingShipmentId = id;
  evt.dataTransfer.effectAllowed = 'move';
}

function onShipmentDragEnd() {
  draggingShipmentId = null;
}

function shipmentItemsFormHasContent() {
  const rows = Array.from(document.querySelectorAll('.shipment-item-row'));
  if (!rows.length) return false;

  return rows.some(row => {
    const desc = row.querySelector('.shipment-item-desc')?.value.trim() || '';
    const sku = row.querySelector('.shipment-item-sku')?.value.trim() || '';
    const coo = row.querySelector('.shipment-item-coo')?.value.trim() || '';
    const vendor = row.querySelector('.shipment-item-vendor')?.value.trim() || '';
    const qty = row.querySelector('.shipment-item-qty')?.value || '';
    const unit = row.querySelector('.shipment-item-unit')?.value || '';
    const status = row.querySelector('.shipment-item-status')?.value || '';
    return desc || sku || coo || vendor || qty || unit || status;
  });
}

function populateShipmentItemsFromList(items = []) {
  const rowsContainer = document.getElementById('shipment-items-rows');
  if (!rowsContainer) return;

  rowsContainer.innerHTML = '';

  if (Array.isArray(items) && items.length > 0) {
    items.forEach(it => {
      addShipmentItemRow({
        id: it.id,
        description: it.description,
        sku: it.sku,
        country_of_origin: it.country_of_origin,
        quantity: it.quantity,
        unit_price: it.unit_price != null ? Number(it.unit_price) : '',
        line_total: it.line_total != null ? Number(it.line_total) : 0,
        vendor_name: it.vendor_name || '',
        notes: it.notes,
        verified: it.verified,
        verification: it.verification,
        verification_json: it.verification_json
      });
    });
  } else {
    addShipmentItemRow();
  }

  recalcShipmentItemsTotal();
  syncVerifyAllCheckboxState();
}

async function maybeRefreshShipmentItemsForEdit() {
  const idInput = document.getElementById('shipment-id');
  const shipmentId = idInput && idInput.value ? idInput.value : null;
  if (!shipmentId) return;
  if (shipmentItemsLoadedOnce) return;

  try {
    const data = await fetchJSON(`/api/shipments/${encodeURIComponent(shipmentId)}`);
    const items = Array.isArray(data.items) ? data.items : [];
    populateShipmentItemsFromList(items);
    shipmentItemsLoadedOnce = true;

    const statusSelect = document.getElementById('shipment-status');
    if (statusSelect) {
      applyItemVerificationLockForStatus(statusSelect.value || '');
    }
    return;
  } catch (err) {
    console.warn('Failed to refresh shipment items for edit:', err);
  }

  const cachedDetail = currentShipmentDetail;
  if (cachedDetail && Array.isArray(cachedDetail.items)) {
    populateShipmentItemsFromList(cachedDetail.items);
    shipmentItemsLoadedOnce = true;
    const statusSelect = document.getElementById('shipment-status');
    if (statusSelect) {
      applyItemVerificationLockForStatus(statusSelect.value || '');
    }
  }
}

async function maybeRefreshShipmentDocsForEdit() {
  const idInput = document.getElementById('shipment-id');
  const shipmentId = idInput && idInput.value ? idInput.value : null;
  if (!shipmentId) return;
  if (shipmentDocsLoadedOnce) return;
  if (typeof loadShipmentDocuments !== 'function') return;

  try {
    await loadShipmentDocuments(shipmentId);
    shipmentDocsLoadedOnce = true;
  } catch (err) {
    console.warn('Failed to refresh shipment docs for edit:', err);
  }
}

function clearShipmentStatusClasses(el) {
  if (!el) return;
  el.classList.remove(
    'status-preorder',
    'status-ordered',
    'status-transit',
    'status-forwarder',
    'status-sailed',
    'status-arrived',
    'status-clearance',
    'status-ready',
    'status-pickedup',
    'status-archived'
  );
}

function normalizeStatusLabelForBoard(status) {
  return status
    ? (matchNormalizedStatus(status, shipmentsBoardData.statuses || []) ||
        normalizeShipmentStatusLabel(status))
    : '';
}

function updateShipmentColumnCount(status) {
  const normalized = normalizeStatusLabelForBoard(status);
  if (!normalized) return;
  const column = document.querySelector(`.shipments-column[data-status="${normalized}"]`);
  if (!column) return;
  const countEl = column.querySelector('.shipments-column-count');
  if (!countEl) return;

  const list = shipmentsBoardData.shipmentsByStatus?.[normalized] || [];
  const isArchivedColumn = normalizeShipmentStatusKey(normalized) === 'archived';
  if (isArchivedColumn) {
    const hasMore =
      archivedShipmentsPreviewHasMore || list.length > ARCHIVED_PREVIEW_LIMIT;
    countEl.textContent = hasMore ? `${ARCHIVED_PREVIEW_LIMIT}+` : list.length;
    return;
  }
  countEl.textContent = list.length;
}

function moveShipmentCardOptimistic(id, newStatus) {
  if (!id) return;
  const card = document.querySelector(`.shipment-card[data-id="${id}"]`);
  if (!card) return;
  const oldStatus = normalizeStatusLabelForBoard(card.dataset.status || '');
  const targetStatus = normalizeStatusLabelForBoard(newStatus);
  if (!targetStatus || oldStatus === targetStatus) return;

  const fromList = shipmentsBoardData.shipmentsByStatus?.[oldStatus] || [];
  const toList = shipmentsBoardData.shipmentsByStatus?.[targetStatus] || [];
  const idx = fromList.findIndex(sh => String(sh.id) === String(id));
  if (idx !== -1) {
    const [moved] = fromList.splice(idx, 1);
    if (moved) {
      moved.status = targetStatus;
      toList.unshift(moved);
    }
  }

  if (!shipmentsBoardData.shipmentsByStatus?.[targetStatus]) {
    shipmentsBoardData.shipmentsByStatus[targetStatus] = toList;
  }

  // Update DOM card appearance + status
  clearShipmentStatusClasses(card);
  card.classList.add(shipmentStatusClass(targetStatus));
  card.dataset.status = targetStatus;

  const targetColumn = document.querySelector(`.shipments-column[data-status="${targetStatus}"]`);
  if (targetColumn) {
    const body = targetColumn.querySelector('.shipments-column-body');
    const footer = body?.querySelector('.shipments-column-footer');
    if (body) {
      if (footer) {
        body.insertBefore(card, footer);
      } else {
        body.appendChild(card);
      }
    }
  }

  updateShipmentColumnCount(oldStatus);
  updateShipmentColumnCount(targetStatus);
}

async function onShipmentDrop(evt, newStatus) {
  evt.preventDefault();
  if (!draggingShipmentId) return;
  const targetStatus = normalizeStatusLabelForBoard(newStatus);
  moveShipmentCardOptimistic(draggingShipmentId, targetStatus);

  try {
    await fetchJSON(`/api/shipments/${draggingShipmentId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        new_status: targetStatus || newStatus
        // you could also send a note here
      })
    });
    // Refresh without clearing the board first to avoid a visible "flash" after drag/drop.
    loadShipmentsBoard({ preserveBoard: true, silent: true, awaitArchivedPreview: true });
  } catch (err) {
    await loadShipmentsBoard({ preserveBoard: true });
    alert('Error updating status: ' + err.message);
  }
}

function initVerifierTooltip() {
  // Create one floating tooltip div for the whole app
  let tooltip = document.getElementById('verifier-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'verifier-tooltip';
    tooltip.className = 'verifier-tooltip';
    tooltip.style.display = 'none';
    document.body.appendChild(tooltip);
  }

  // Show on hover
  document.addEventListener('mouseover', (evt) => {
    const tag = evt.target.closest('.shipment-item-verifier-tag.has-initials');
    if (!tag) return;

    const text = tag.dataset.fullLabel || '';
    if (!text) return;

    tooltip.textContent = text;
    tooltip.style.display = 'block';

    const rect = tag.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    // position just above/right of initials
    tooltip.style.left = (rect.left + scrollX) + 'px';
    tooltip.style.top  = (rect.top + scrollY - tooltip.offsetHeight - 6) + 'px';
  });

  // Hide as soon as you leave the initials
  document.addEventListener('mouseout', (evt) => {
    const tag = evt.target.closest('.shipment-item-verifier-tag.has-initials');
    if (!tag) return;
    tooltip.style.display = 'none';
  });
}

function setShipmentDetailTab(tab) {
  const tabs = document.querySelectorAll('.ship-detail-tab');
  tabs.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  ['overview', 'items', 'payments', 'timeline', 'documents', 'comments'].forEach(key => {
    const panel = document.getElementById(`ship-detail-${key}`);
    if (panel) panel.classList.toggle('hidden', key !== tab);
  });
}

function closeShipmentDetailModal() {
  const modal = document.getElementById('shipment-detail-modal');
  const backdrop = document.getElementById('shipment-detail-backdrop');
  if (modal) modal.classList.add('hidden');
  if (backdrop) backdrop.classList.add('hidden');
  currentShipmentDetailId = null;
  currentShipmentDetail = null;
}

function setupShipmentDetailTabs() {
  const tabButtons = document.querySelectorAll('.ship-detail-tab');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      setShipmentDetailTab(btn.dataset.tab || 'overview');
    });
  });

  const closeBtn = document.getElementById('shipment-detail-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      closeShipmentDetailModal();
    });
  }

  const personalNoteBtn = document.getElementById('shipment-detail-personal-note');
  if (personalNoteBtn && !personalNoteBtn.dataset.bound) {
    personalNoteBtn.addEventListener('click', (evt) => {
      evt.preventDefault();
      if (!currentShipmentDetailId) return;
      openShipmentPersonalNoteModal(currentShipmentDetailId);
    });
    personalNoteBtn.dataset.bound = '1';
  }

  const editBtn = document.getElementById('shipment-detail-edit');
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      if (currentShipmentDetail && currentShipmentDetail.shipment) {
        const detail = currentShipmentDetail;
        closeShipmentDetailModal();
        openShipmentEditModal(
          detail.shipment,
          detail.items || []
        );
      }
    });
  }
}

function closeShipmentPersonalNoteModal() {
  const modal = document.getElementById('shipment-personal-note-modal');
  const backdrop = document.getElementById('shipment-personal-note-backdrop');
  if (modal) modal.classList.add('hidden');
  if (backdrop) backdrop.classList.add('hidden');
  currentShipmentPersonalNoteShipmentId = null;
}

function findShipmentInBoardData(shipmentId) {
  const list = flattenShipmentsBoardData();
  return (list || []).find(sh => String(sh.id) === String(shipmentId)) || null;
}

function updateShipmentDetailPersonalNoteButton(shipmentId) {
  const btn = document.getElementById('shipment-detail-personal-note');
  if (!btn) return;

  const hasId = shipmentId != null && String(shipmentId).trim() !== '';
  if (!hasId) {
    btn.disabled = true;
    btn.innerHTML =
      `<span class="btn-icon" aria-hidden="true">${SHIPMENT_PERSONAL_NOTE_ICON_SVG_EMPTY}</span>` +
      `<span>My Note</span>`;
    btn.setAttribute('title', 'Add personal note');
    btn.setAttribute('aria-label', 'Add personal note');
    btn.classList.add('is-empty');
    btn.classList.remove('has-note', 'is-complete');
    return;
  }

  btn.disabled = false;

  const sh = findShipmentInBoardData(shipmentId);
  const personalNoteText = (sh && sh.personal_note ? String(sh.personal_note) : '').trim();
  const personalNoteDone = sh ? isShipmentFlagSet(sh.personal_note_completed) : false;
  const hasPersonalNote = !!personalNoteText;
  const icon = hasPersonalNote
    ? (personalNoteDone ? SHIPMENT_PERSONAL_NOTE_ICON_SVG_DONE : SHIPMENT_PERSONAL_NOTE_ICON_SVG_NOTE)
    : SHIPMENT_PERSONAL_NOTE_ICON_SVG_EMPTY;
  const title = hasPersonalNote
    ? (personalNoteDone ? 'Personal note (complete)' : 'Personal note')
    : 'Add personal note';

  btn.innerHTML =
    `<span class="btn-icon" aria-hidden="true">${icon}</span>` +
    `<span>My Note</span>`;
  btn.setAttribute('title', title);
  btn.setAttribute('aria-label', title);
  btn.classList.toggle('has-note', hasPersonalNote);
  btn.classList.toggle('is-complete', hasPersonalNote && personalNoteDone);
  btn.classList.toggle('is-empty', !hasPersonalNote);
}

async function refreshShipmentsBoardAndSummary() {
  await loadShipmentsBoard();
  const summaryView = document.getElementById('shipments-view-summary');
  if (summaryView && !summaryView.classList.contains('hidden')) {
    loadShipmentsSummary({ force: true, skipBoardLoad: true });
  }
}

async function openShipmentPersonalNoteModal(shipmentId) {
  const backdrop = document.getElementById('shipment-personal-note-backdrop');
  const modal = document.getElementById('shipment-personal-note-modal');
  const titleEl = document.getElementById('shipment-personal-note-title');
  const noteArea = document.getElementById('shipment-personal-note-body');
  const completeChk = document.getElementById('shipment-personal-note-complete');
  const statusEl = document.getElementById('shipment-personal-note-status');
  const deleteBtn = document.getElementById('shipment-personal-note-delete');

  if (!backdrop || !modal || !noteArea || !completeChk) return;

  currentShipmentPersonalNoteShipmentId = shipmentId;

  const sh = findShipmentInBoardData(shipmentId);
  if (titleEl) {
    titleEl.textContent = sh && sh.title
      ? `My Note: ${sh.title}`
      : 'My Note';
  }

  noteArea.value = '';
  completeChk.checked = false;
  if (deleteBtn) deleteBtn.disabled = true;
  if (statusEl) {
    statusEl.textContent = 'Loading...';
    statusEl.style.color = 'var(--slate-600)';
  }

  backdrop.classList.remove('hidden');
  modal.classList.remove('hidden');

  try {
    const data = await fetchJSON(
      `/api/shipments/${encodeURIComponent(shipmentId)}/personal-note`
    );
    const note = data && data.note ? data.note : null;
    noteArea.value = note && note.note ? String(note.note) : '';
    completeChk.checked = note ? isShipmentFlagSet(note.is_completed) : false;
    if (deleteBtn) deleteBtn.disabled = !note;
    if (statusEl) statusEl.textContent = '';
    setTimeout(() => noteArea.focus(), 0);
  } catch (err) {
    // Fallback to board data if available.
    if (sh && (sh.personal_note || '').trim()) {
      noteArea.value = String(sh.personal_note || '');
      completeChk.checked = isShipmentFlagSet(sh.personal_note_completed);
      if (deleteBtn) deleteBtn.disabled = false;
      if (statusEl) statusEl.textContent = '';
      setTimeout(() => noteArea.focus(), 0);
      return;
    }

    if (statusEl) {
      statusEl.textContent = 'Failed to load note: ' + (err.message || 'Unknown error');
      statusEl.style.color = 'crimson';
    }
  }
}

async function saveShipmentPersonalNoteFromModal() {
  const shipmentId = currentShipmentPersonalNoteShipmentId;
  if (!shipmentId) return;

  const noteArea = document.getElementById('shipment-personal-note-body');
  const completeChk = document.getElementById('shipment-personal-note-complete');
  const statusEl = document.getElementById('shipment-personal-note-status');
  const saveBtn = document.getElementById('shipment-personal-note-save');
  const deleteBtn = document.getElementById('shipment-personal-note-delete');
  const prevDeleteDisabled = deleteBtn ? deleteBtn.disabled : true;

  const note = noteArea ? noteArea.value.trim() : '';
  const isCompleted = completeChk && completeChk.checked ? true : false;

  if (statusEl) {
    statusEl.textContent = 'Saving...';
    statusEl.style.color = 'var(--slate-600)';
  }
  if (saveBtn) saveBtn.disabled = true;
  if (deleteBtn) deleteBtn.disabled = true;

  try {
    await fetchJSON(
      `/api/shipments/${encodeURIComponent(shipmentId)}/personal-note`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note, is_completed: isCompleted })
      }
    );

    closeShipmentPersonalNoteModal();
    await refreshShipmentsBoardAndSummary();
    updateShipmentDetailPersonalNoteButton(shipmentId);
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = 'Failed to save: ' + (err.message || 'Unknown error');
      statusEl.style.color = 'crimson';
    }
  } finally {
    if (saveBtn) saveBtn.disabled = false;
    if (deleteBtn) deleteBtn.disabled = prevDeleteDisabled;
  }
}

async function deleteShipmentPersonalNoteFromModal() {
  const shipmentId = currentShipmentPersonalNoteShipmentId;
  if (!shipmentId) return;

  const statusEl = document.getElementById('shipment-personal-note-status');
  const saveBtn = document.getElementById('shipment-personal-note-save');
  const deleteBtn = document.getElementById('shipment-personal-note-delete');
  const prevDeleteDisabled = deleteBtn ? deleteBtn.disabled : true;

  const ok = await showYesNoPrompt('Delete this personal note?', {
    yesLabel: 'Delete note',
    noLabel: 'Cancel',
    tone: 'danger'
  });
  if (!ok) return;

  if (statusEl) {
    statusEl.textContent = 'Deleting...';
    statusEl.style.color = 'var(--slate-600)';
  }
  if (saveBtn) saveBtn.disabled = true;
  if (deleteBtn) deleteBtn.disabled = true;

  try {
    await fetchJSON(
      `/api/shipments/${encodeURIComponent(shipmentId)}/personal-note`,
      { method: 'DELETE' }
    );

    closeShipmentPersonalNoteModal();
    await refreshShipmentsBoardAndSummary();
    updateShipmentDetailPersonalNoteButton(shipmentId);
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = 'Failed to delete: ' + (err.message || 'Unknown error');
      statusEl.style.color = 'crimson';
    }
  } finally {
    if (saveBtn) saveBtn.disabled = false;
    if (deleteBtn) deleteBtn.disabled = prevDeleteDisabled;
  }
}

function setupShipmentPersonalNoteModal() {
  const modal = document.getElementById('shipment-personal-note-modal');
  const backdrop = document.getElementById('shipment-personal-note-backdrop');
  if (!modal || !backdrop) return;
  if (modal.dataset.bound === '1') return;
  modal.dataset.bound = '1';

  const closeBtn = document.getElementById('shipment-personal-note-close');
  const cancelBtn = document.getElementById('shipment-personal-note-cancel');
  const saveBtn = document.getElementById('shipment-personal-note-save');
  const deleteBtn = document.getElementById('shipment-personal-note-delete');

  closeBtn?.addEventListener('click', closeShipmentPersonalNoteModal);
  cancelBtn?.addEventListener('click', closeShipmentPersonalNoteModal);
  saveBtn?.addEventListener('click', saveShipmentPersonalNoteFromModal);
  deleteBtn?.addEventListener('click', deleteShipmentPersonalNoteFromModal);

  backdrop.addEventListener('click', (evt) => {
    if (evt.target === backdrop) closeShipmentPersonalNoteModal();
  });
}


function setupShipmentsUI() {
  setupShipmentPersonalNoteModal();

  const search = document.getElementById('shipments-search');
  if (search) {
    // Hard-disable autofill as much as possible at runtime too
    search.setAttribute('autocomplete', 'off');
    search.setAttribute('autocorrect', 'off');
    search.setAttribute('autocapitalize', 'off');
    search.setAttribute('spellcheck', 'false');
    // Unique-ish name to prevent browser remembering previous value
    search.setAttribute('name', `shipments-search-${Date.now()}`);
    // Clear any prefill the browser might have applied on load
    search.value = '';
    search.dataset.userCleared = 'false';

    search.addEventListener('focus', () => {
      // If browser auto-filled before focus, wipe it once
      if (search.dataset.userCleared === 'false' && search.value) {
        search.value = '';
        search.dataset.userCleared = 'true';
      }
    });

    search.addEventListener('input', () => {
      // If the shipment modal is open, ignore any “mystery” input (autofill)
      const backdrop = document.getElementById('shipment-create-backdrop');
      const detailBackdrop = document.getElementById('shipment-detail-backdrop');
      const modalOpen =
        (backdrop && !backdrop.classList.contains('hidden')) ||
        (detailBackdrop && !detailBackdrop.classList.contains('hidden'));

      if (modalOpen) {
        // Ignore autofill while editing a shipment
        return;
      }

      loadShipmentsBoard().then(() => {
        const summaryView = document.getElementById('shipments-view-summary');
        if (summaryView && !summaryView.classList.contains('hidden')) {
          loadShipmentsSummary({ force: true, skipBoardLoad: true });
        }
      });
    });
  }

  // Project + vendor filters (top of board)
  ['shipments-filter-project', 'shipments-filter-vendor']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => {
        loadShipmentsBoard().then(() => {
          const summaryView = document.getElementById('shipments-view-summary');
          if (summaryView && !summaryView.classList.contains('hidden')) {
            loadShipmentsSummary({ force: true, skipBoardLoad: true });
          }
        });
      });
    });

  const forwarderSelect = document.getElementById('shipment-forwarder');
  const forwarderOtherInput = document.getElementById('shipment-forwarder-other');
  if (forwarderSelect) {
    forwarderSelect.addEventListener('change', () => {
      syncShipmentForwarderOtherState();
      if (forwarderSelect.value === FORWARDER_OTHER_VALUE && forwarderOtherInput) {
        forwarderOtherInput.focus();
      }
      updateShipmentTrackingHelper();
    });
  }
  if (forwarderOtherInput) {
    forwarderOtherInput.addEventListener('input', updateShipmentTrackingHelper);
  }

  const requestedClearingChk = document.getElementById('shipment-requested-clearing');
  const requestedClearingDateInput = document.getElementById('shipment-requested-clearing-date');
  if (requestedClearingChk && requestedClearingDateInput && !requestedClearingChk.dataset.bound) {
    requestedClearingChk.addEventListener('change', () => {
      syncRequestedClearingControls({ clearWhenUnchecked: true });
      if (requestedClearingChk.checked && !requestedClearingDateInput.value) {
        requestedClearingDateInput.focus();
      }
    });
    requestedClearingChk.dataset.bound = '1';
  }

  const stepper = document.querySelector('.shipment-stepper');
  if (stepper && !stepper.dataset.bound) {
    stepper.addEventListener('click', (evt) => {
      const item = evt.target.closest('.shipment-stepper-item');
      if (!item) return;
      const targetStep = Number(item.dataset.step || '1');
      if (!targetStep) return;
      handleShipmentStepperJump(targetStep);
    });
    stepper.dataset.bound = '1';
  }

  // Notification UI wiring
  renderNotificationStatusCheckboxes(
    (shipmentsBoardData.statuses && shipmentsBoardData.statuses.length)
      ? shipmentsBoardData.statuses
      : Object.keys(SHIPMENT_STATUS_ICONS)
  );

  const notifyToggle = document.getElementById('shipment-notify-enabled');
  if (notifyToggle) {
    notifyToggle.addEventListener('change', () => {
      shipmentNotificationPref.enabled = notifyToggle.checked;
      maybeStartShipmentNotificationTimer(true);
    });
  }

  const notifyTime = document.getElementById('shipment-notify-time');
  if (notifyTime) {
    notifyTime.addEventListener('change', () => {
      shipmentNotificationPref.notify_time = notifyTime.value || '';
    });
  }

  const notifySaveBtn = document.getElementById('shipment-notify-save');
  if (notifySaveBtn) {
    notifySaveBtn.addEventListener('click', () => {
      saveShipmentNotificationPrefs();
    });
  }

  const notifyTestBtn = document.getElementById('shipment-notify-test');
  if (notifyTestBtn) {
    notifyTestBtn.addEventListener('click', () => {
      triggerShipmentNotification(true);
    });
  }

  const notifyShipmentsSelect = document.getElementById('shipment-notify-shipments');
  if (notifyShipmentsSelect) {
    notifyShipmentsSelect.addEventListener('change', () => {
      const ids = Array.from(notifyShipmentsSelect.selectedOptions || [])
        .map(opt => Number(opt.value))
        .filter(n => Number.isFinite(n));
      shipmentNotificationPref.shipment_ids = ids;
    });
  }

  const notifyProjectsSelect = document.getElementById('shipment-notify-projects');
  if (notifyProjectsSelect) {
    notifyProjectsSelect.addEventListener('change', () => {
      const ids = Array.from(notifyProjectsSelect.selectedOptions || [])
        .map(opt => Number(opt.value))
        .filter(n => Number.isFinite(n));
      shipmentNotificationPref.project_ids = ids;
    });
  }

  const notifyRemindInput = document.getElementById('shipment-notify-remind');
  if (notifyRemindInput) {
    notifyRemindInput.addEventListener('change', () => {
      const val = Number(notifyRemindInput.value || 1);
      shipmentNotificationPref.remind_every_days =
        Number.isFinite(val) && val >= 1 ? Math.floor(val) : 1;
    });
  }

  const sortToggle = document.getElementById('shipments-sort-toggle');
  if (sortToggle) {
    sortToggle.addEventListener('click', () => {
      shipmentsColumnSortMode =
        shipmentsColumnSortMode === 'reverse' ? 'custom' : 'reverse';
      saveShipmentsColumnPrefs();
      updateShipmentsSortToggleLabel();
      renderShipmentsBoard();
    });
  }

  loadShipmentNotificationPrefs();

  const templateSaveBtn = document.getElementById('shipment-template-save');
  if (templateSaveBtn) {
    templateSaveBtn.addEventListener('click', () => {
      saveShipmentTemplateFromForm();
    });
  }

  const templateHelpBtn = document.getElementById('shipment-templates-help-btn');
  if (templateHelpBtn) {
    templateHelpBtn.addEventListener('click', toggleShipmentTemplatesHelp);
  }

  const templatesBody = document.getElementById('shipment-templates-body');
  if (templatesBody) {
    templatesBody.addEventListener('click', (evt) => {
      const useBtn = evt.target.closest('button[data-template-use]');
      const deleteBtn = evt.target.closest('button[data-template-delete]');
      if (useBtn) {
        const id = useBtn.getAttribute('data-template-use');
        if (id) applyShipmentTemplateById(Number(id));
      }
      if (deleteBtn) {
        const id = deleteBtn.getAttribute('data-template-delete');
        if (id) deleteShipmentTemplate(Number(id));
      }
    });
  }

  // Custom status dropdown
  const statusBtn = document.getElementById('status-dropdown-btn');
  const statusMenu = document.getElementById('status-dropdown-menu');

  if (statusBtn && statusMenu) {
    statusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      statusMenu.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
      if (
        !statusMenu.contains(e.target) &&
        !statusBtn.contains(e.target)
      ) {
        statusMenu.classList.add('hidden');
      }
    });
  }

  // Tabs (Board / Analytics / Templates)
  const tabButtons = document.querySelectorAll('.shipments-tab');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view || 'board';
      tabButtons.forEach(b => b.classList.toggle('active', b === btn));
      document.getElementById('shipments-view-board')?.classList.toggle(
        'hidden',
        view !== 'board'
      );
      document.getElementById('shipments-view-summary')?.classList.toggle(
        'hidden',
        view !== 'summary'
      );
      document.getElementById('shipments-view-analytics')?.classList.toggle(
        'hidden',
        view !== 'analytics'
      );
      document.getElementById('shipments-view-templates')?.classList.toggle(
        'hidden',
        view !== 'templates'
      );
      if (view === 'summary') {
        loadShipmentsSummary({ force: true });
      }
    });
  });

  // 🔹 Docs upload button
  const docsBtn = document.getElementById('shipment-upload-docs-btn');
  if (docsBtn) {
    docsBtn.addEventListener('click', uploadShipmentDocumentsFromModal);
  }

  const summaryRefresh = document.getElementById('shipments-summary-refresh');
  if (summaryRefresh) {
    summaryRefresh.addEventListener('click', () => {
      loadShipmentsSummary({ force: true });
    });
  }

  const summaryStatusFilter = document.getElementById('shipments-summary-filter-status');
  if (summaryStatusFilter && !summaryStatusFilter.dataset.bound) {
    summaryStatusFilter.addEventListener('change', () => {
      applyShipmentStatusFilter(summaryStatusFilter.value || '');
    });
    summaryStatusFilter.dataset.bound = '1';
  }

  const summaryShipmentFilter = document.getElementById('shipments-summary-filter-shipment');
  if (summaryShipmentFilter && !summaryShipmentFilter.dataset.bound) {
    summaryShipmentFilter.addEventListener('change', () => {
      loadShipmentsSummary({ force: true, skipBoardLoad: true });
    });
    summaryShipmentFilter.dataset.bound = '1';
  }

  // 🔹 Document type → toggle custom label input
  const docTypeSel = document.getElementById('shipment-doc-type');
  const docLabelInput = document.getElementById('shipment-doc-label');
  const docLabelWrapper = document.getElementById('shipment-doc-label-wrapper');
  if (docTypeSel && docLabelInput) {
    docTypeSel.addEventListener('change', () => {
      const v = docTypeSel.value || '';
      const needsLabel = v === 'Other';
      docLabelInput.disabled = !needsLabel;
      if (docLabelWrapper) docLabelWrapper.hidden = !needsLabel;
      if (!needsLabel) {
        docLabelInput.value = '';
      }
    });
  }

  // 🔹 Header-level vendor → apply-to-all wiring
const headerVendorSelect   = document.getElementById('shipment-vendor');
const headerVendorApplyAll = document.getElementById('shipment-vendor-apply-all');

if (headerVendorSelect && headerVendorApplyAll) {
  // When "apply to all items" is toggled:
  headerVendorApplyAll.addEventListener('change', () => {
    const idx = headerVendorSelect.selectedIndex;
    const headerVendorText =
      idx > 0
        ? headerVendorSelect.options[idx].textContent.trim()
        : '';

    if (headerVendorApplyAll.checked) {
      // If there are existing vendor entries, ask before overwriting
      const rows = Array.from(document.querySelectorAll('.shipment-item-row'));
      const hasAnyVendor = rows.some(row => {
        const input = row.querySelector('.shipment-item-vendor');
        return input && input.value.trim();
      });

      if (hasAnyVendor && headerVendorText) {
        const ok = window.confirm(
          'Overwrite all item vendor fields with the selected vendor?'
        );
        if (!ok) {
          headerVendorApplyAll.checked = false;
          return;
        }
        setVendorOnAllItemRows(headerVendorText);
      } else {
        // No existing vendor entries → only fill blanks
        applyVendorToItemRowsIfNeeded();
      }
    } else {
      // OFF → clear vendor fields from item rows
      clearVendorFromItemRows();
    }
  });

  // Track last vendor selection to allow reverting if user cancels overwrite
  headerVendorSelect.dataset.prevValue = headerVendorSelect.value || '';
  headerVendorSelect.dataset.prevText =
    headerVendorSelect.selectedIndex > 0
      ? headerVendorSelect.options[headerVendorSelect.selectedIndex].textContent.trim()
      : '';

  // When header vendor changes:
  headerVendorSelect.addEventListener('change', () => {
    const idx = headerVendorSelect.selectedIndex;

    const prevValue = headerVendorSelect.dataset.prevValue || '';
    const prevText = headerVendorSelect.dataset.prevText || '';
    const newValue = headerVendorSelect.value || '';
    const newText =
      idx > 0
        ? headerVendorSelect.options[idx].textContent.trim()
        : '';

    if (idx <= 0) {
      // Vendor cleared → uncheck and clear all per-row vendors
      headerVendorApplyAll.checked = false;
      clearVendorFromItemRows();
      headerVendorSelect.dataset.prevValue = '';
      headerVendorSelect.dataset.prevText = '';
      return;
    }

    // If "use on all items" is on, ask before overwriting existing vendors
    if (headerVendorApplyAll.checked) {
      const rows = Array.from(document.querySelectorAll('.shipment-item-row'));
      const hasAnyVendor = rows.some(row => {
        const input = row.querySelector('.shipment-item-vendor');
        return input && input.value.trim();
      });

      if (hasAnyVendor) {
        const ok = window.confirm(
          'Overwrite all item vendor fields with the selected vendor?'
        );
        if (!ok) {
          // Revert selection
          headerVendorSelect.value = prevValue;
          return;
        }
        setVendorOnAllItemRows(newText);
      } else {
        applyVendorToItemRowsIfNeeded();
      }
    }

    // Store new selection as previous for future cancels
    headerVendorSelect.dataset.prevValue = newValue;
    headerVendorSelect.dataset.prevText = newText;
  });

  // Optional: on initial load, if checkbox is already checked, apply once
  if (headerVendorApplyAll.checked) {
    applyVendorToItemRowsIfNeeded();
  }
}

  // 🔹 Header-level country of origin → apply-to-all wiring
  const headerCooInput = document.getElementById('shipment-country-origin');
  const headerCooApplyAll = document.getElementById('shipment-coo-apply-all');

  if (headerCooInput && headerCooApplyAll) {
    headerCooApplyAll.addEventListener('change', () => {
      const headerValue = (headerCooInput.value || '').trim();
      if (headerCooApplyAll.checked && !headerValue) {
        headerCooApplyAll.checked = false;
        return;
      }

      if (headerCooApplyAll.checked) {
        const rows = Array.from(document.querySelectorAll('.shipment-item-row'));
        const hasAnyCoo = rows.some(row => {
          const input = row.querySelector('.shipment-item-coo');
          return input && input.value.trim();
        });

        if (hasAnyCoo && headerValue) {
          const ok = window.confirm(
            'Overwrite all item country of origin fields with the shipment-level value?'
          );
          if (!ok) {
            headerCooApplyAll.checked = false;
            return;
          }
          setCountryOfOriginOnAllItemRows(headerValue);
        } else {
          applyCountryOfOriginToItemRowsIfNeeded();
        }
      } else {
        clearCountryOfOriginFromItemRows();
      }
    });

    headerCooInput.dataset.prevValue = headerCooInput.value || '';
    headerCooInput.addEventListener('change', () => {
      const prevValue = headerCooInput.dataset.prevValue || '';
      const newValue = (headerCooInput.value || '').trim();

      if (!newValue) {
        headerCooApplyAll.checked = false;
        clearCountryOfOriginFromItemRows();
        headerCooInput.dataset.prevValue = '';
        return;
      }

      if (headerCooApplyAll.checked) {
        const rows = Array.from(document.querySelectorAll('.shipment-item-row'));
        const hasAnyCoo = rows.some(row => {
          const input = row.querySelector('.shipment-item-coo');
          return input && input.value.trim();
        });

        if (hasAnyCoo) {
          const ok = window.confirm(
            'Overwrite all item country of origin fields with the shipment-level value?'
          );
          if (!ok) {
            headerCooInput.value = prevValue;
            return;
          }
          setCountryOfOriginOnAllItemRows(newValue);
        } else {
          applyCountryOfOriginToItemRowsIfNeeded();
        }
      }

      headerCooInput.dataset.prevValue = newValue;
    });

    if (headerCooApplyAll.checked) {
      applyCountryOfOriginToItemRowsIfNeeded();
    }
  }


  // Payments + verification UI
  setupStorageLateFeeListeners();
  setupShipmentPaymentListeners();
  setupItemVerificationModal();
  initVerifierTooltip();
  setupShipmentDetailTabs();
}



async function openShipmentDetail(id) {
  const backdrop = document.getElementById('shipment-detail-backdrop');
  const modal = document.getElementById('shipment-detail-modal');
  const titleEl = document.getElementById('shipment-detail-title');
  const overviewEl = document.getElementById('ship-detail-overview');
  const itemsEl = document.getElementById('ship-detail-items');
  const paymentsEl = document.getElementById('ship-detail-payments');
  const timelineEl = document.getElementById('ship-detail-timeline');
  const docsEl = document.getElementById('ship-detail-documents');
  const commentsEl = document.getElementById('ship-detail-comments');

  if (!backdrop || !modal || !overviewEl) return;

  currentShipmentDetailId = id;
  currentShipmentDetail = null;
  setShipmentDetailTab('overview');
  updateShipmentDetailPersonalNoteButton(id);

  overviewEl.innerHTML = 'Loading…';
  if (itemsEl) itemsEl.innerHTML = 'Loading…';
  if (paymentsEl) {
    paymentsEl.innerHTML = 'Loading…';
    paymentsEl.dataset.loaded = '0';
  }
  if (timelineEl) timelineEl.innerHTML = 'Loading…';
  if (docsEl) docsEl.innerHTML = 'Loading…';
  if (commentsEl) commentsEl.innerHTML = 'Loading…';

  backdrop.classList.remove('hidden');
  modal.classList.remove('hidden');

  try {
    const data = await fetchJSON(`/api/shipments/${id}`);
    const s = data.shipment || {};
    const items = Array.isArray(data.items) ? data.items : [];
    currentShipmentDetail = { shipment: s, items };

    const trackingHtml = buildTrackingLink(
      s.tracking_number,
      s.freight_forwarder,
      s.website_url
    );

    const expectedShip = s.expected_ship_date
      ? formatDateUS(s.expected_ship_date)
      : '—';

    const expectedArrival = s.expected_arrival_date
      ? formatDateUS(s.expected_arrival_date)
      : '—';
    const requestedClearing = isShipmentFlagSet(s.requested_clearing)
      ? 'Yes'
      : 'No';
    const requestedClearingDate = s.requested_clearing_date
      ? formatDateUS(s.requested_clearing_date)
      : '—';
    const pickupDue = s.storage_due_date
      ? formatDateUS(s.storage_due_date)
      : '—';
    const pickupBy = s.picked_up_by || '—';
    const pickupDate = s.picked_up_date
      ? formatDateUS(s.picked_up_date)
      : '';
    const isContainer = isContainerValue(s.is_container);
    const storageFeeType = isContainer ? 'Container' : 'Standard';
    const storageFeeRate =
      s.storage_daily_late_fee != null
        ? `${formatMoney(s.storage_daily_late_fee)}/day`
        : '—';
    const shipperPaidByLabel =
      s.shipper_paid && s.shipper_paid_by
        ? escapeHTML(s.shipper_paid_by)
        : '—';
    const customsPaidByLabel =
      s.customs_paid && s.customs_paid_by
        ? escapeHTML(s.customs_paid_by)
        : '—';

    if (titleEl) {
      titleEl.textContent = `${s.title || 'Shipment'}${s.status ? ` · ${s.status}` : ''}`;
    }

    const customerName = s.customer_name || '';
    const projectName = s.project_name || '';
    const projectLabel = escapeHTML(
      customerName && projectName
        ? `${customerName} - ${projectName}`
        : customerName || projectName || '—'
    );
    const websiteHtml = s.website_url
      ? `<a href="${escapeHTML(s.website_url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(s.website_url)}</a>`
      : '—';
    const pickupText = `${escapeHTML(pickupBy)}${pickupDate ? ` (${pickupDate})` : ''}`;
    const verificationHtml = s.items_verified
      ? '<span class="ship-detail-pill ship-detail-pill--ok">Verified</span>'
      : '<span class="ship-detail-pill ship-detail-pill--warn">Pending</span>';

    overviewEl.innerHTML = `
      <div class="ship-detail-overview">
        <div class="ship-detail-overview-grid">
          <section class="ship-detail-overview-card">
            <h4>Shipment</h4>
            <div class="ship-detail-pair"><span>Status</span><strong>${escapeHTML(s.status || '—')}</strong></div>
            <div class="ship-detail-pair"><span>Vendor</span><strong>${escapeHTML(s.vendor_name || '—')}</strong></div>
            <div class="ship-detail-pair"><span>Project</span><strong>${projectLabel}</strong></div>
            <div class="ship-detail-pair"><span>Destination</span><strong>${escapeHTML(s.destination || '—')}</strong></div>
            <div class="ship-detail-pair"><span>Forwarder</span><strong>${escapeHTML(s.freight_forwarder || '—')}</strong></div>
            <div class="ship-detail-pair"><span>BOL #</span><strong>${escapeHTML(s.bol_number || '—')}</strong></div>
            <div class="ship-detail-pair"><span>PO #</span><strong>${escapeHTML(s.po_number || '—')}</strong></div>
          </section>

          <section class="ship-detail-overview-card">
            <h4>Dates & Tracking</h4>
            <div class="ship-detail-pair"><span>Expected ship</span><strong>${expectedShip}</strong></div>
            <div class="ship-detail-pair"><span>Expected arrival</span><strong>${expectedArrival}</strong></div>
            <div class="ship-detail-pair"><span>Requested clearing</span><strong>${escapeHTML(requestedClearing)}</strong></div>
            <div class="ship-detail-pair"><span>Clearing request date</span><strong>${escapeHTML(requestedClearingDate)}</strong></div>
            <div class="ship-detail-pair"><span>Pickup due</span><strong>${pickupDue}</strong></div>
            <div class="ship-detail-pair"><span>Tracking #</span><strong>${trackingHtml}</strong></div>
            <div class="ship-detail-pair"><span>Website</span><strong>${websiteHtml}</strong></div>
          </section>

          <section class="ship-detail-overview-card">
            <h4>Payments</h4>
            <div class="ship-detail-pair"><span>Total price</span><strong>${s.total_price != null ? formatMoney(s.total_price) : '—'}</strong></div>
            <div class="ship-detail-pair"><span>Forwarder paid by</span><strong>${shipperPaidByLabel}</strong></div>
            <div class="ship-detail-pair"><span>Customs/Clearing paid by</span><strong>${customsPaidByLabel}</strong></div>
          </section>

          <section class="ship-detail-overview-card">
            <h4>Pickup & Storage</h4>
            <div class="ship-detail-pair"><span>Storage fee type</span><strong>${escapeHTML(storageFeeType)}</strong></div>
            <div class="ship-detail-pair"><span>Daily storage fee</span><strong>${escapeHTML(storageFeeRate)}</strong></div>
            <div class="ship-detail-pair"><span>Picked up</span><strong>${pickupText || '—'}</strong></div>
            <div class="ship-detail-pair"><span>Verification</span><strong>${verificationHtml}</strong></div>
          </section>

          <section class="ship-detail-overview-card ship-detail-overview-notes">
            <h4>Description</h4>
            <div class="ship-detail-notes-body">${escapeHTML(s.notes || '—')}</div>
          </section>
        </div>

      </div>
    `;

    if (itemsEl) {
      itemsEl.innerHTML = `
        <div class="ship-detail-items">
          <h4>Line items</h4>
          ${renderShipmentItemsTable(items)}
        </div>
      `;
    }

    const permsKnown = CURRENT_PERMS != null;
    const paymentsAllowed = permsKnown ? canViewShipmentPayments() : false;
    if (permsKnown && !paymentsAllowed && paymentsEl) {
      paymentsEl.innerHTML = '<p class="small-muted">Payment details require payroll access.</p>';
      paymentsEl.classList.remove('hidden');
    }

    await Promise.all([
      paymentsAllowed ? loadShipmentPayments(id, s) : Promise.resolve(),
      loadShipmentTimeline(id),
      loadShipmentDocumentsDetail(id),
      loadShipmentComments(id)
    ]);
  } catch (err) {
    const msg = 'Error loading shipment: ' + err.message;
    overviewEl.innerHTML = msg;
    if (itemsEl) itemsEl.innerHTML = msg;
    if (paymentsEl) paymentsEl.innerHTML = '';
    if (timelineEl) timelineEl.innerHTML = '';
    if (docsEl) docsEl.innerHTML = '';
    if (commentsEl) commentsEl.innerHTML = '';
  }
}

function renderShipmentItemsTable(items = []) {
  if (!items.length) {
    return '<p class="small-muted">(No items on this shipment.)</p>';
  }

  const rows = items.map(it => {
    const status =
      (it.verification && it.verification.status) ||
      (it.verified ? 'verified' : '');
    const storage =
      (it.verification && it.verification.storage_override) || '';
    const notes =
      (it.verification && it.verification.notes) ||
      it.notes ||
      '';

    return `
      <tr>
        <td>${escapeHTML(it.description || '—')}</td>
        <td>${escapeHTML(it.sku || '—')}</td>
        <td>${escapeHTML(it.country_of_origin || '—')}</td>
        <td>${escapeHTML(it.vendor_name || '—')}</td>
        <td class="num">${Number(it.quantity) || 0}</td>
        <td class="num">${formatMoney(it.unit_price || 0)}</td>
        <td class="num">${formatMoney(it.line_total || 0)}</td>
        <td>${escapeHTML(status || '—')}</td>
        <td>${escapeHTML(storage || '—')}</td>
        <td>${escapeHTML(notes || '')}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="table-wrapper">
      <table class="ship-detail-table">
        <thead>
          <tr>
            <th>Description</th>
            <th>SKU</th>
            <th>COO</th>
            <th>Vendor</th>
            <th class="num">Qty</th>
            <th class="num">Unit</th>
            <th class="num">Line total</th>
            <th>Status</th>
            <th>Storage</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

async function loadShipmentTimeline(shipmentId) {
  const panel = document.getElementById('ship-detail-timeline');
  if (!panel || !shipmentId) return;

  try {
    const data = await fetchJSON(`/api/shipments/${shipmentId}/timeline`);
    const rows = Array.isArray(data.timeline) ? data.timeline : [];
    panel.innerHTML = renderShipmentTimeline(rows);
  } catch (err) {
    panel.innerHTML = `<p class="small-muted">Failed to load timeline: ${escapeHTML(err.message || '')}</p>`;
  }
}

function renderShipmentTimeline(rows = []) {
  if (!rows.length) {
    return '<p class="small-muted">(No timeline events yet.)</p>';
  }

  const items = rows.map(ev => {
    const when = formatDateTimeLocal(ev.created_at);
    let label = escapeHTML(ev.event_type || 'event');
    if (ev.event_type === 'status_change') {
      label = `Status: ${escapeHTML(ev.old_status || '—')} → ${escapeHTML(ev.new_status || '—')}`;
    } else if (ev.event_type === 'storage_location_set') {
      label = 'Storage location set';
    }
    const note = ev.note ? `<div class="ship-detail-note">${escapeHTML(ev.note)}</div>` : '';
    const actor = ev.created_by_name
      ? `<span class="ship-detail-meta">by ${escapeHTML(ev.created_by_name)}</span>`
      : '';
    return `
      <div class="ship-detail-timeline-item">
        <div class="ship-detail-timeline-header">
          <strong>${label}</strong>
          <span class="ship-detail-meta">${escapeHTML(when || '')}</span>
        </div>
        ${actor}
        ${note}
      </div>
    `;
  }).join('');

  return `<div class="ship-detail-timeline-list">${items}</div>`;
}

async function loadShipmentDocumentsDetail(shipmentId) {
  const panel = document.getElementById('ship-detail-documents');
  if (!panel || !shipmentId) return;

  try {
    const data = await fetchJSON(`/api/shipments/${shipmentId}/documents`);
    const docs = Array.isArray(data.documents) ? data.documents : [];
    panel.innerHTML = renderShipmentDocumentsDetail(docs);
    updateShipmentRequiredDocsFromDocs(shipmentId, docs);

    panel.querySelectorAll('button[data-doc-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const docId = btn.getAttribute('data-doc-delete');
        if (!docId) return;
        const ok = await showYesNoPrompt('Delete this document?', {
          yesLabel: 'Delete document',
          noLabel: 'Keep it',
          tone: 'danger'
        });
        if (!ok) return;
        try {
          await fetchJSON(
            `/api/shipments/${encodeURIComponent(shipmentId)}/documents/${encodeURIComponent(docId)}`,
            { method: 'DELETE' }
          );
          await loadShipmentDocumentsDetail(shipmentId);
        } catch (err) {
          alert('Error deleting document: ' + err.message);
        }
      });
    });
  } catch (err) {
    panel.innerHTML = `<p class="small-muted">Failed to load documents: ${escapeHTML(err.message || '')}</p>`;
  }
}

function renderShipmentDocumentsDetail(docs = []) {
  const missing = getMissingRequiredDocsFromDocs(docs);
  const requiredAlert =
    missing && missing.length
      ? `<div class="ship-detail-alert">Missing required docs: ${missing.join(', ')}</div>`
      : '';

  if (!docs.length) {
    return `${requiredAlert}<p class="small-muted">(No documents uploaded yet.)</p>`;
  }

  const rows = docs.map(doc => {
    const label = doc.doc_label || doc.doc_type || '';
    const title = doc.title || doc.original_name || 'Document';
    const viewUrl = doc.view_url || doc.url || doc.file_path || '#';
    const downloadUrl = doc.download_url || doc.url || doc.file_path || '#';
    const date = formatDateTimeLocal(doc.uploaded_at);
    return `
      <div class="ship-detail-doc-row">
        <div>
          <a href="${escapeHTML(viewUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(title)}</a>
          ${label ? `<span class="ship-detail-tag">${escapeHTML(label)}</span>` : ''}
          <div class="ship-detail-meta">${escapeHTML(date || '')}</div>
        </div>
        <div class="ship-detail-doc-actions">
          <a class="btn secondary btn-sm" href="${escapeHTML(downloadUrl)}" target="_blank" rel="noopener noreferrer">Download</a>
          <button class="btn danger btn-sm" data-doc-delete="${doc.id}">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  return `${requiredAlert}<div class="ship-detail-docs">${rows}</div>`;
}

async function loadShipmentPayments(shipmentId, shipment) {
  const panel = document.getElementById('ship-detail-payments');
  if (!panel || !shipmentId) return;

  panel.dataset.loaded = '0';

  try {
    const data = await fetchJSON(`/api/shipments/${shipmentId}/payments`);
    const rows = Array.isArray(data.payments) ? data.payments : [];
    panel.innerHTML = renderShipmentPayments(rows, shipment);
    panel.dataset.loaded = '1';

    const form = panel.querySelector('#ship-detail-payment-form');
    if (form) {
      form.addEventListener('submit', async (evt) => {
        evt.preventDefault();
        await submitShipmentPayment(shipmentId);
      });
    }
  } catch (err) {
    panel.innerHTML = `<p class="small-muted">Failed to load payments: ${escapeHTML(err.message || '')}</p>`;
    panel.dataset.loaded = '0';
  }
}

function renderShipmentPayments(rows = [], shipment = {}) {
  const shipperPaid = !!shipment.shipper_paid;
  const customsPaid = !!shipment.customs_paid;
  const storagePaid = !!shipment.storage_paid;
  const storageTitle = isContainerValue(shipment.is_container) ? 'Container Fees' : 'Storage Fees';

  const shipperAmtRaw = shipment.shipper_paid_amount;
  const customsAmtRaw = shipment.customs_paid_amount;
  const storageAmtRaw = shipment.storage_paid_amount;

  const formatAmount = (value) => {
    if (value == null || value === '') return '—';
    const num = Number(value);
    if (Number.isNaN(num)) return '—';
    return formatMoney(num);
  };

  const formatPaidBy = (value) => {
    const parsed = parseShipmentPaidBy(value);
    if (parsed.type === 'company') return 'Company';
    if (parsed.type === 'other') {
      return parsed.value ? `Other: ${escapeHTML(parsed.value)}` : 'Other';
    }
    if (parsed.type === 'customer') return escapeHTML(parsed.value);
    return '—';
  };

  const shipperPaidBy = shipperPaid ? formatPaidBy(shipment.shipper_paid_by) : '—';
  const customsPaidBy = customsPaid ? formatPaidBy(shipment.customs_paid_by) : '—';
  const storagePaidBy = storagePaid ? formatPaidBy(shipment.storage_paid_by) : '—';

  const classifyPaidBy = (value) => {
    const parsed = parseShipmentPaidBy(value);
    if (parsed.type === 'company') return 'company';
    if (parsed.type === 'other' || parsed.type === 'customer') return 'other';
    return 'unassigned';
  };

  const shipperAmt = shipperPaid ? Number(shipperAmtRaw) || 0 : 0;
  const customsAmt = customsPaid ? Number(customsAmtRaw) || 0 : 0;
  const storageAmt = storagePaid ? Number(storageAmtRaw) || 0 : 0;

  let companyTotal = 0;
  let otherTotal = 0;

  if (shipperPaid && shipperAmt) {
    const cat = classifyPaidBy(shipment.shipper_paid_by);
    if (cat === 'company') {
      companyTotal += shipperAmt;
    } else if (cat === 'other') {
      otherTotal += shipperAmt;
    }
  }

  if (customsPaid && customsAmt) {
    const cat = classifyPaidBy(shipment.customs_paid_by);
    if (cat === 'company') {
      companyTotal += customsAmt;
    } else if (cat === 'other') {
      otherTotal += customsAmt;
    }
  }

  if (storagePaid && storageAmt) {
    const cat = classifyPaidBy(shipment.storage_paid_by);
    if (cat === 'company' || cat === 'unassigned') {
      companyTotal += storageAmt;
    } else if (cat === 'other') {
      otherTotal += storageAmt;
    }
  }

  const totalPaidValue = formatMoney(shipperAmt + customsAmt + storageAmt);

  const list = rows.length
    ? rows.map(row => {
        const type = row.type || 'other';
        const amount = formatMoney(row.amount || 0);
        const status = row.status || 'Pending';
        const due = row.due_date ? formatDateUS(row.due_date) : '—';
        const paid = row.paid_date ? formatDateUS(row.paid_date) : '—';
        const invoice = row.invoice_number || '—';
        const notes = row.notes || '';
        const created = formatDateTimeLocal(row.created_at);
        const createdBy = row.created_by_name ? `by ${row.created_by_name}` : '';
        return `
          <div class="ship-detail-payment-row">
            <div class="ship-detail-payment-main">
              <strong>${escapeHTML(type)}</strong> · ${amount} · ${escapeHTML(status)}
              <div class="ship-detail-meta">Due ${escapeHTML(due)} · Paid ${escapeHTML(paid)} · Invoice ${escapeHTML(invoice)}</div>
              ${notes ? `<div class="ship-detail-note">${escapeHTML(notes)}</div>` : ''}
              <div class="ship-detail-meta">${escapeHTML(created || '')} ${escapeHTML(createdBy)}</div>
            </div>
          </div>
        `;
      }).join('')
    : '<p class="small-muted">(No payment ledger entries yet.)</p>';

  return `
    <div class="shipment-payments-stack ship-detail-payments-stack">
      <div class="shipment-payment-section">
        <h4 class="shipment-payment-title">Freight Forwarder</h4>
        <div class="form-row-2 ship-detail-payment-grid">
          <div class="form-field">
            <label>Status</label>
            <div>${shipperPaid ? 'Paid' : 'Unpaid'}</div>
          </div>
          <div class="form-field">
            <label>Amount</label>
            <div>${formatAmount(shipperAmtRaw)}</div>
          </div>
          <div class="form-field">
            <label>Paid By</label>
            <div>${shipperPaidBy}</div>
          </div>
        </div>
      </div>

      <div class="shipment-payment-section">
        <h4 class="shipment-payment-title">Customs / Clearing</h4>
        <div class="form-row-2 ship-detail-payment-grid">
          <div class="form-field">
            <label>Status</label>
            <div>${customsPaid ? 'Paid' : 'Unpaid'}</div>
          </div>
          <div class="form-field">
            <label>Amount</label>
            <div>${formatAmount(customsAmtRaw)}</div>
          </div>
          <div class="form-field">
            <label>Paid By</label>
            <div>${customsPaidBy}</div>
          </div>
        </div>
      </div>

      <div class="shipment-payment-section">
        <h4 class="shipment-payment-title">${storageTitle}</h4>
        <div class="form-row-2 ship-detail-payment-grid">
          <div class="form-field">
            <label>Status</label>
            <div>${storagePaid ? 'Paid' : 'Unpaid'}</div>
          </div>
          <div class="form-field">
            <label>Amount</label>
            <div>${formatAmount(storageAmtRaw)}</div>
          </div>
          <div class="form-field">
            <label>Paid By</label>
            <div>${storagePaidBy}</div>
          </div>
        </div>
      </div>

      <div class="shipment-payment-section shipment-payment-summary">
        <h4 class="shipment-payment-title">Total</h4>
        <div class="form-row-2 ship-detail-payment-grid">
          <div class="form-field">
            <label>Total Paid by Company</label>
            <div>${formatMoney(companyTotal)}</div>
          </div>
          <div class="form-field">
            <label>Total Paid by Others</label>
            <div>${formatMoney(otherTotal)}</div>
          </div>
          <div class="form-field ship-detail-payment-span">
            <label>Total Paid (shipment)</label>
            <div>${totalPaidValue}</div>
          </div>
        </div>
      </div>
    </div>

    <form id="ship-detail-payment-form" class="ship-detail-form">
      <div class="form-grid">
        <div class="form-field">
          <label for="ship-payment-type">Type</label>
          <select id="ship-payment-type">
            <option value="shipper">Forwarder</option>
            <option value="customs">Customs</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div class="form-field">
          <label for="ship-payment-amount">Amount</label>
          <input id="ship-payment-amount" type="number" step="0.01" min="0" required />
        </div>
        <div class="form-field">
          <label for="ship-payment-currency">Currency</label>
          <input id="ship-payment-currency" type="text" value="USD" />
        </div>
        <div class="form-field">
          <label for="ship-payment-status">Status</label>
          <select id="ship-payment-status">
            <option value="Pending">Pending</option>
            <option value="Paid">Paid</option>
            <option value="Partial">Partial</option>
            <option value="Void">Void</option>
          </select>
        </div>
        <div class="form-field">
          <label for="ship-payment-due">Due date</label>
          <input id="ship-payment-due" type="date" />
        </div>
        <div class="form-field">
          <label for="ship-payment-paid">Paid date</label>
          <input id="ship-payment-paid" type="date" />
        </div>
        <div class="form-field">
          <label for="ship-payment-invoice">Invoice #</label>
          <input id="ship-payment-invoice" type="text" />
        </div>
        <div class="form-field">
          <label for="ship-payment-notes">Notes</label>
          <input id="ship-payment-notes" type="text" />
        </div>
      </div>
      <div class="ship-detail-actions">
        <button type="submit" class="btn primary btn-sm">Add payment</button>
        <span id="ship-payment-message" class="message"></span>
      </div>
    </form>
    <div class="ship-detail-payment-list">${list}</div>
  `;
}

async function submitShipmentPayment(shipmentId) {
  const messageEl = document.getElementById('ship-payment-message');
  const amountEl = document.getElementById('ship-payment-amount');
  const amount = amountEl ? Number(amountEl.value) : null;
  if (!amount || Number.isNaN(amount)) {
    if (messageEl) {
      messageEl.textContent = 'Amount is required.';
      messageEl.style.color = 'crimson';
    }
    return;
  }

  const payload = {
    type: document.getElementById('ship-payment-type')?.value || null,
    amount,
    currency: document.getElementById('ship-payment-currency')?.value || 'USD',
    status: document.getElementById('ship-payment-status')?.value || 'Pending',
    due_date: document.getElementById('ship-payment-due')?.value || null,
    paid_date: document.getElementById('ship-payment-paid')?.value || null,
    invoice_number: document.getElementById('ship-payment-invoice')?.value || null,
    notes: document.getElementById('ship-payment-notes')?.value || null
  };

  try {
    if (messageEl) {
      messageEl.textContent = 'Saving...';
      messageEl.style.color = '';
    }
    await fetchJSON(`/api/shipments/${encodeURIComponent(shipmentId)}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (amountEl) amountEl.value = '';
    const dueEl = document.getElementById('ship-payment-due');
    const paidEl = document.getElementById('ship-payment-paid');
    const invoiceEl = document.getElementById('ship-payment-invoice');
    const notesEl = document.getElementById('ship-payment-notes');
    if (dueEl) dueEl.value = '';
    if (paidEl) paidEl.value = '';
    if (invoiceEl) invoiceEl.value = '';
    if (notesEl) notesEl.value = '';
    if (messageEl) {
      messageEl.textContent = 'Payment added.';
      messageEl.style.color = 'green';
    }
    await loadShipmentPayments(shipmentId, currentShipmentDetail?.shipment || {});
  } catch (err) {
    if (messageEl) {
      messageEl.textContent = err.message || 'Failed to add payment.';
      messageEl.style.color = 'crimson';
    }
  }
}

function getShipmentThreadById(threads = [], threadId) {
  if (!threadId) return null;
  return threads.find(thread => Number(thread.id) === Number(threadId)) || null;
}

function getGeneralThreadId(threads = []) {
  const generalThread = threads.find(thread =>
    String(thread.title || '').trim().toLowerCase() === 'general'
  );
  return generalThread ? generalThread.id : null;
}

function normalizeShipmentThreadId(rawThreadId, generalThreadId = null) {
  const threadId = Number(rawThreadId);
  if (Number.isFinite(threadId) && threadId > 0) return threadId;
  const normalizedGeneral = Number(generalThreadId);
  return Number.isFinite(normalizedGeneral) && normalizedGeneral > 0
    ? normalizedGeneral
    : null;
}

function getShipmentCommentsForThread(comments = [], activeThreadId = null, threads = []) {
  const selectedThreadId = Number(activeThreadId);
  if (!Number.isFinite(selectedThreadId) || selectedThreadId <= 0) {
    return [];
  }
  const generalThreadId = getGeneralThreadId(threads);
  return (comments || []).filter(row => {
    const rowThreadId = normalizeShipmentThreadId(row?.thread_id, generalThreadId);
    return Number(rowThreadId) === Number(selectedThreadId);
  });
}

function buildShipmentThreadSearchText(thread = {}) {
  return [
    thread.title,
    thread.category,
    thread.last_comment_body,
    thread.last_comment_by_name
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function buildShipmentThreadSearchIndex(threads = [], comments = [], queued = []) {
  const generalThreadId = getGeneralThreadId(threads);
  const byThread = new Map();

  const appendText = (threadId, parts = []) => {
    const normalizedThreadId = Number(threadId);
    if (!Number.isFinite(normalizedThreadId) || normalizedThreadId <= 0) return;
    const existing = byThread.get(normalizedThreadId) || '';
    const next = parts
      .filter(Boolean)
      .map(value => String(value).trim().toLowerCase())
      .filter(Boolean)
      .join(' ');
    if (!next) return;
    byThread.set(normalizedThreadId, `${existing} ${next}`.trim());
  };

  (threads || []).forEach(thread => {
    appendText(normalizeShipmentThreadId(thread?.id, generalThreadId), [
      thread?.title,
      thread?.category,
      thread?.last_comment_body,
      thread?.last_comment_by_name
    ]);
  });

  (comments || []).forEach(row => {
    appendText(normalizeShipmentThreadId(row?.thread_id, generalThreadId), [
      row?.body,
      row?.created_by_name
    ]);
  });

  (queued || []).forEach(row => {
    appendText(normalizeShipmentThreadId(row?.thread_id, generalThreadId), [
      row?.body,
      row?.created_by_name
    ]);
  });

  return byThread;
}

function filterShipmentThreads(threads = [], searchTerm = '', searchIndex = null) {
  const term = String(searchTerm || '').trim().toLowerCase();
  if (!term) return threads;
  return threads.filter(thread => {
    const threadId = Number(thread?.id);
    if (searchIndex && Number.isFinite(threadId)) {
      return String(searchIndex.get(threadId) || '').includes(term);
    }
    return buildShipmentThreadSearchText(thread).includes(term);
  });
}

function buildShipmentSearchSnippetHtml(body = '', searchTerm = '') {
  const rawBody = String(body || '').trim();
  if (!rawBody) return '<span class="ship-detail-thread-search-result-empty">(No message body)</span>';
  const normalizedTerm = String(searchTerm || '').trim().toLowerCase();
  if (!normalizedTerm) {
    const plain = rawBody.length > 140 ? `${rawBody.slice(0, 140)}...` : rawBody;
    return escapeHTML(plain);
  }

  const bodyLower = rawBody.toLowerCase();
  const hitIndex = bodyLower.indexOf(normalizedTerm);
  const start = hitIndex >= 0 ? Math.max(0, hitIndex - 42) : 0;
  const end = hitIndex >= 0
    ? Math.min(rawBody.length, hitIndex + normalizedTerm.length + 84)
    : Math.min(rawBody.length, 140);
  const snippet = rawBody.slice(start, end);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < rawBody.length ? '...' : '';

  if (hitIndex < start || hitIndex >= end) {
    return `${escapeHTML(prefix)}${escapeHTML(snippet)}${escapeHTML(suffix)}`;
  }

  const localHit = hitIndex - start;
  const before = escapeHTML(snippet.slice(0, localHit));
  const hit = escapeHTML(snippet.slice(localHit, localHit + normalizedTerm.length));
  const after = escapeHTML(snippet.slice(localHit + normalizedTerm.length));
  return `${escapeHTML(prefix)}${before}<mark>${hit}</mark>${after}${escapeHTML(suffix)}`;
}

function buildShipmentMessageSearchMatches({
  threads = [],
  comments = [],
  queued = [],
  searchTerm = ''
} = {}) {
  const term = String(searchTerm || '').trim().toLowerCase();
  if (!term) return [];

  const generalThreadId = getGeneralThreadId(threads);
  const threadById = new Map(
    (threads || []).map(thread => [Number(thread && thread.id), thread || null])
  );
  const queuedRows = (queued || []).map((row, idx) => ({
    ...row,
    pending: true,
    created_at: row && row.created_at ? row.created_at : (row && row.queued_at ? row.queued_at : null),
    _local_key: String(
      (row && row.client_id) || (row && row.queued_at) || `queued-${idx}`
    )
  }));
  const rows = [...(comments || []), ...queuedRows];
  const matches = [];

  rows.forEach((row, idx) => {
    const threadId = normalizeShipmentThreadId(row && row.thread_id, generalThreadId);
    if (!Number.isFinite(threadId) || threadId <= 0) return;

    const thread = threadById.get(Number(threadId)) || null;
    const body = String(row && row.body || '');
    const author = String(row && row.created_by_name || '');
    const haystack = [
      body,
      author,
      thread && thread.title,
      thread && thread.category
    ].filter(Boolean).join(' ').toLowerCase();
    if (!haystack.includes(term)) return;

    const commentIdNum = Number(row && row.id);
    const commentId = Number.isFinite(commentIdNum) && commentIdNum > 0
      ? commentIdNum
      : null;
    const localKey = row && row.pending
      ? String(row._local_key || row.client_id || row.queued_at || `queued-${idx}`)
      : '';
    const createdAtMs = getShipmentCommentTimeMs(row);
    matches.push({
      threadId,
      threadTitle: thread && thread.title ? String(thread.title) : 'Thread',
      body,
      createdAtMs,
      author: author || 'Admin',
      commentId,
      localKey
    });
  });

  matches.sort((a, b) => {
    const at = Number.isFinite(a.createdAtMs) ? a.createdAtMs : 0;
    const bt = Number.isFinite(b.createdAtMs) ? b.createdAtMs : 0;
    return bt - at;
  });

  return matches.slice(0, 25);
}

function buildShipmentThreadPendingCounts(queued = [], threads = []) {
  const counts = {};
  const generalThreadId = getGeneralThreadId(threads);
  queued.forEach(entry => {
    const threadId = entry.thread_id || generalThreadId || null;
    if (!threadId) return;
    counts[threadId] = (counts[threadId] || 0) + 1;
  });
  return counts;
}

function renderShipmentThreadList(
  threads = [],
  activeThreadId,
  pendingCounts = {},
  searchTerm = '',
  allComments = [],
  queued = [],
  currentEmpId = null,
  offline = false
) {
  const searchIndex = buildShipmentThreadSearchIndex(threads, allComments, queued);
  const filtered = filterShipmentThreads(threads, searchTerm, searchIndex);
  if (!filtered.length) {
    const msg = threads.length
      ? 'No threads match your search.'
      : 'No threads yet.';
    return `<p class="ship-detail-thread-empty">(${escapeHTML(msg)})</p>`;
  }

  return filtered.map(thread => {
    const threadId = Number(thread && thread.id);
    const whenMs = getShipmentThreadActivityTimeMs(thread);
    const when = formatDateTimeInOrgTime(whenMs);
    const preview = thread.last_comment_body || 'No messages yet.';
    const isActive = threadId === Number(activeThreadId);
    const pendingCount = pendingCounts[threadId] || 0;
    const createdById = Number(thread && thread.created_by);
    const canEditThread = Number.isFinite(createdById) &&
      Number.isFinite(Number(currentEmpId)) &&
      Number(createdById) === Number(currentEmpId);
    const threadTitle = String(thread && thread.title || 'Thread');
    const pendingTag = pendingCount
      ? `<span class="ship-detail-thread-count">${pendingCount}</span>`
      : '';
    const metaRow = pendingTag
      ? `<div class="ship-detail-thread-item-meta">${pendingTag}</div>`
      : '';
    const editIcon = canEditThread
      ? `
        <button
          type="button"
          class="ship-detail-thread-edit-inline"
          data-thread-edit-id="${escapeHTML(String(threadId || ''))}"
          data-thread-edit-title="${escapeHTML(threadTitle)}"
          aria-label="Rename thread"
          title="${offline ? 'Go online to rename this thread.' : 'Rename thread'}"
          ${offline ? 'disabled' : ''}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 17.25V21h3.75L18.81 8.94l-3.75-3.75L3 17.25z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M14.06 4.94l3.75 3.75" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      `
      : '';
    return `
      <div class="ship-detail-thread-row-wrap ${canEditThread ? 'can-edit' : ''}">
        <button
          class="ship-detail-thread-item ${isActive ? 'active' : ''}"
          type="button"
          data-thread-id="${thread.id}"
        >
          <div class="ship-detail-thread-item-title">
            <span>${escapeHTML(threadTitle)}</span>
            <span class="ship-detail-thread-item-time">${escapeHTML(when || '')}</span>
          </div>
          <div class="ship-detail-thread-item-preview">${escapeHTML(preview)}</div>
          ${metaRow}
        </button>
        ${editIcon}
      </div>
    `;
  }).join('');
}

function formatDateTimeInOrgTime(ms) {
  if (!Number.isFinite(ms)) return '';
  const tz = window.CURRENT_ORG_TIMEZONE || null;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  if (tz) {
    try {
      const datePart = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(date);
      const timePart = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      }).format(date);
      return `${datePart}, ${timePart}`;
    } catch {
      // fall back to local formatting
    }
  }
  return formatDateTimeLocal(date);
}

function getShipmentTimestampMs(value) {
  if (value == null) return Number.NaN;
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
  const text = String(value).trim();
  if (!text) return Number.NaN;
  if (/^\d{4}-\d{2}-\d{2} /.test(text)) {
    const normalized = text.replace(' ', 'T') + 'Z';
    const parsed = Date.parse(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function getShipmentThreadActivityTimeMs(thread = {}) {
  const direct =
    thread.last_comment_at_ms ||
    thread.updated_at_ms ||
    thread.created_at_ms ||
    null;
  let ms = Number(direct);
  if (Number.isFinite(ms)) {
    if (ms > 0 && ms < 1000000000000) {
      ms = ms * 1000;
    }
    return ms;
  }
  return getShipmentTimestampMs(
    thread.last_comment_at || thread.updated_at || thread.created_at
  );
}

function getShipmentThreadCreatedTimeMs(thread = {}) {
  const direct = thread.created_at_ms || null;
  let ms = Number(direct);
  if (Number.isFinite(ms)) {
    if (ms > 0 && ms < 1000000000000) {
      ms = ms * 1000;
    }
    return ms;
  }
  return getShipmentTimestampMs(thread.created_at);
}

function getShipmentCommentTimeMs(row) {
  if (!row) return Number.NaN;
  const direct = row.created_at_ms;
  let ms = Number(direct);
  if (Number.isFinite(ms)) {
    if (ms > 0 && ms < 1000000000000) {
      ms = ms * 1000;
    }
    return ms;
  }
  return getShipmentTimestampMs(row.created_at || row.queued_at);
}

function renderShipmentThreadMessages(comments = [], queued = [], activeThread = null, threads = []) {
  const { id: currentEmpId, name: currentEmpName } = getCurrentVerifierInfo();
  const isSuperAdmin = window.CURRENT_IS_SUPER_ADMIN === true;
  const generalThreadId = getGeneralThreadId(threads);
  const pendingRows = queued.filter(entry => {
    if (!activeThread) return false;
    if (activeThread.id) {
      if (entry.thread_id) {
        return Number(entry.thread_id) === Number(activeThread.id);
      }
      return generalThreadId && Number(activeThread.id) === Number(generalThreadId);
    }
    return !entry.thread_id;
  }).map(entry => {
    const queuedAtMs = entry.queued_at ? Date.parse(entry.queued_at) : NaN;
    return {
      body: entry.body,
      created_at: entry.queued_at,
      created_at_ms: Number.isFinite(queuedAtMs) ? queuedAtMs : null,
      pending: true,
      client_id: entry.client_id || null,
      created_by: entry.created_by || currentEmpId || null,
      created_by_name: entry.created_by_name || currentEmpName || null
    };
  });

  const rows = [...comments, ...pendingRows].sort((a, b) => {
    const at = getShipmentCommentTimeMs(a);
    const bt = getShipmentCommentTimeMs(b);
    return at - bt;
  });

  if (!rows.length) {
    return '<p class="ship-detail-thread-empty">(No messages yet.)</p>';
  }

  return rows.map((row, rowIndex) => {
    const createdAtMs = getShipmentCommentTimeMs(row);
    const when = formatDateTimeInOrgTime(createdAtMs);
    const isMine =
      currentEmpId &&
      row.created_by &&
      Number(row.created_by) === Number(currentEmpId);
    const authorName = row.created_by_name
      ? row.created_by_name
      : (row.created_by ? `Admin #${row.created_by}` : 'Admin');
    const authorLabel = isMine ? 'You' : authorName;
    const avatarLabel = row.created_by_name || currentEmpName || authorName;
    const avatarText = getInitialsFromName(avatarLabel) || '?';
    const pendingTag = row.pending
      ? '<span class="ship-detail-tag ship-detail-tag--pending">Pending sync</span>'
      : '';
    const commentIdNum = Number(row.id);
    const commentIdAttr = Number.isFinite(commentIdNum) && commentIdNum > 0
      ? `data-comment-id="${escapeHTML(String(commentIdNum))}"`
      : '';
    const localKey = row.pending
      ? String(row.client_id || row.queued_at || `queued-${rowIndex}`)
      : '';
    const localKeyAttr = localKey
      ? `data-comment-local-key="${escapeHTML(localKey)}"`
      : '';
    const withinUndoWindow = Number.isFinite(createdAtMs) &&
      (Date.now() - createdAtMs <= SHIPMENT_COMMENT_UNDO_WINDOW_MS);
    const canUndo = !row.pending && isMine && withinUndoWindow;
    const canDelete = !row.pending && (isMine || isSuperAdmin) && withinUndoWindow;
    const actionControl = canUndo
      ? `<button
          type="button"
          class="ship-detail-thread-inline-action"
          data-comment-action="undo"
          data-comment-id="${escapeHTML(String(row.id || ''))}"
          data-comment-created-at-ms="${Number.isFinite(createdAtMs) ? String(createdAtMs) : ''}"
          data-comment-expire="${Number.isFinite(createdAtMs)
            ? String(createdAtMs + SHIPMENT_COMMENT_UNDO_WINDOW_MS)
            : ''}"
        >Undo Send</button>`
      : (canDelete
        ? `<button
            type="button"
            class="ship-detail-thread-inline-action"
            data-comment-action="delete"
            data-comment-id="${escapeHTML(String(row.id || ''))}"
            data-comment-expire="${Number.isFinite(createdAtMs)
              ? String(createdAtMs + SHIPMENT_COMMENT_UNDO_WINDOW_MS)
              : ''}"
          >Delete</button>`
        : '');
    const actionRow = actionControl
      ? `<div class="ship-detail-thread-inline-actions">${actionControl}</div>`
      : '';
    return `
      <div
        class="ship-detail-thread-row ${row.pending ? 'pending' : ''} ${isMine ? 'mine' : ''}"
        ${commentIdAttr}
        ${localKeyAttr}
      >
        <div class="ship-detail-thread-avatar" aria-hidden="true">
          ${escapeHTML(avatarText)}
        </div>
        <div class="ship-detail-thread-bubble">
          <div class="ship-detail-thread-meta">
            <span class="ship-detail-thread-author">${escapeHTML(authorLabel || '')}</span>
            <span class="ship-detail-thread-time">${escapeHTML(when || '')}</span>
            ${pendingTag}
          </div>
          <div class="ship-detail-thread-body">${escapeHTML(row.body || '')}</div>
          ${actionRow}
        </div>
      </div>
    `;
  }).join('');
}

function isShipmentCommentUndoOpen(createdAtMs) {
  const ts = Number(createdAtMs);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= SHIPMENT_COMMENT_UNDO_WINDOW_MS;
}

async function deleteShipmentComment(shipmentId, commentId, options = {}) {
  const { prompt = true } = options;
  if (!commentId) return;
  if (!isOnline()) {
    alert('Comment deletion requires an online connection.');
    return;
  }
  if (prompt) {
    const ok = await showYesNoPrompt('Delete this comment?', {
      yesLabel: 'Delete comment',
      noLabel: 'Keep it',
      tone: 'danger'
    });
    if (!ok) return;
  }
  try {
    await fetchJSON(
      `/api/shipments/${encodeURIComponent(shipmentId)}/comments/${encodeURIComponent(commentId)}`,
      { method: 'DELETE' }
    );
    await loadShipmentComments(shipmentId, { preserveSearch: true });
  } catch (err) {
    alert('Error deleting comment: ' + err.message);
  }
}

function renderShipmentThreadLayout({
  threads = [],
  activeThreadId = null,
  comments = [],
  allComments = [],
  queued = [],
  searchTerm = '',
  offline = false
} = {}) {
  const { id: currentEmpId } = getCurrentVerifierInfo();
  const pendingCounts = buildShipmentThreadPendingCounts(queued, threads);
  const activeThread = getShipmentThreadById(threads, activeThreadId);
  const isGeneralPlaceholder = !activeThread && !threads.length;
  const displayThread = activeThread || (isGeneralPlaceholder
    ? { id: null, title: 'General', category: 'General' }
    : null);
  const createdMeta = displayThread
    ? formatDateTimeInOrgTime(getShipmentThreadCreatedTimeMs(displayThread))
    : '';
  const createdBy = displayThread && displayThread.created_by_name
    ? `by ${displayThread.created_by_name}`
    : '';
  const title = displayThread ? displayThread.title : 'No thread selected';
  const placeholderNote = isGeneralPlaceholder
    ? 'Auto-created on first message.'
    : '';
  const headerSubtitle = [createdMeta, createdBy, placeholderNote].filter(Boolean).join(' · ');
  const categoryTag = displayThread && displayThread.category
    ? `<span class="ship-detail-tag">${escapeHTML(displayThread.category)}</span>`
    : '';
  const canEditThread = displayThread &&
    displayThread.id &&
    currentEmpId &&
    Number(displayThread.created_by) === Number(currentEmpId);
  const editForm = canEditThread
    ? `
      <form
        id="ship-thread-edit-form"
        class="ship-detail-thread-edit-form hidden"
        data-thread-id="${escapeHTML(String(displayThread.id || ''))}"
        data-thread-title="${escapeHTML(String(title || ''))}"
      >
        <input
          id="ship-thread-edit-title"
          type="text"
          maxlength="80"
          value="${escapeHTML(String(title || ''))}"
          placeholder="Thread subject"
        />
        <div class="ship-detail-thread-edit-actions">
          <button type="submit" class="btn primary btn-sm">Save</button>
          <button type="button" class="btn secondary btn-sm" id="ship-thread-edit-cancel">Cancel</button>
          <span id="ship-thread-edit-message" class="message"></span>
        </div>
      </form>
    `
    : '';
  const offlineBanner = offline
    ? '<div class="ship-detail-thread-banner">Offline: new threads require an online connection.</div>'
    : '';
  const newThreadDisabled = offline ? 'disabled' : '';
  const newThreadHint = offline ? 'title="Go online to start a new thread."' : '';
  const messagePlaceholder = displayThread
    ? `Message ${displayThread.title || 'thread'}…`
    : 'Select a thread to begin…';

  return `
    ${offlineBanner}
    <div class="ship-detail-thread-layout">
      <div class="ship-detail-thread-sidebar">
        <div class="ship-detail-thread-toolbar">
          <input
            id="ship-thread-search"
            class="ship-detail-thread-search"
            type="search"
            placeholder="Search all messages"
            value="${escapeHTML(String(searchTerm || ''))}"
          />
          <div id="ship-thread-search-results" class="ship-detail-thread-search-results hidden"></div>
          <button
            id="ship-thread-new-toggle"
            class="btn secondary btn-sm"
            type="button"
            ${newThreadDisabled}
            ${newThreadHint}
          >
            New thread
          </button>
        </div>
        <form id="ship-thread-new-form" class="ship-detail-thread-new-form hidden">
          <div class="form-field">
            <label for="ship-thread-title">Subject</label>
            <input id="ship-thread-title" type="text" placeholder="e.g., Customs docs question" />
          </div>
          <div class="form-field">
            <label for="ship-thread-category">Category</label>
            <select id="ship-thread-category">
              ${SHIPMENTS_THREAD_CATEGORIES.map(option => `
                <option value="${escapeHTML(option.value)}">${escapeHTML(option.label)}</option>
              `).join('')}
            </select>
          </div>
          <div class="ship-detail-thread-new-actions">
            <button type="submit" class="btn primary btn-sm">Create thread</button>
            <button type="button" class="btn secondary btn-sm" id="ship-thread-new-cancel">Cancel</button>
            <span id="ship-thread-new-message" class="message"></span>
          </div>
        </form>
        <div class="ship-detail-thread-list">
          ${renderShipmentThreadList(
            threads,
            activeThreadId,
            pendingCounts,
            '',
            allComments,
            queued,
            currentEmpId,
            offline
          )}
        </div>
      </div>
      <div class="ship-detail-thread-pane">
        <div class="ship-detail-thread-header">
          <div class="ship-detail-thread-title">
            <div class="ship-detail-thread-title-main">
              <h4>${escapeHTML(title || '')}</h4>
              ${categoryTag}
            </div>
          </div>
          ${editForm}
          <div class="ship-detail-thread-sub">${escapeHTML(headerSubtitle || '')}</div>
        </div>
        <div class="ship-detail-thread-messages">
          ${displayThread
            ? renderShipmentThreadMessages(comments, queued, displayThread, threads)
            : '<p class="ship-detail-thread-empty">(Select a thread to view messages.)</p>'}
        </div>
        <form id="ship-detail-comment-form" class="ship-detail-form ship-detail-thread-form">
          <div class="form-field">
            <label for="ship-detail-comment-body">Add message</label>
            <textarea
              id="ship-detail-comment-body"
              rows="3"
              placeholder="${escapeHTML(messagePlaceholder)}"
            ></textarea>
          </div>
          <div class="ship-detail-actions">
            <button type="submit" class="btn primary btn-sm">Send</button>
            <span id="ship-comment-message" class="message"></span>
          </div>
        </form>
      </div>
    </div>
  `;
}

function paintShipmentThreadPanel(panel, offline = false) {
  if (!panel) return;
  panel.innerHTML = renderShipmentThreadLayout({
    threads: shipmentThreadState.threads,
    activeThreadId: shipmentThreadState.activeThreadId,
    comments: shipmentThreadState.comments,
    allComments: shipmentThreadState.allComments,
    queued: shipmentThreadState.queued,
    searchTerm: shipmentThreadState.search,
    offline
  });
  bindShipmentThreadHandlers(panel, shipmentThreadState.shipmentId, offline);
}

async function loadShipmentComments(shipmentId, options = {}) {
  const panel = document.getElementById('ship-detail-comments');
  if (!panel || !shipmentId) return;

  const queued = getShipmentCommentsQueue().filter(
    entry => Number(entry.shipment_id) === Number(shipmentId)
  );
  const preserveSearch = options.preserveSearch !== false;
  const sameShipment = shipmentThreadState.shipmentId === shipmentId;
  const searchTerm = preserveSearch && sameShipment ? shipmentThreadState.search : '';
  const overrideThreadId = options.activeThreadId || null;

  if (!isOnline()) {
    const threads = sameShipment ? shipmentThreadState.threads : [];
    const activeThreadId = overrideThreadId ||
      (sameShipment ? shipmentThreadState.activeThreadId : null) ||
      (threads[0] ? threads[0].id : null);
    const allComments = sameShipment && Array.isArray(shipmentThreadState.allComments)
      ? shipmentThreadState.allComments
      : [];
    const comments = getShipmentCommentsForThread(allComments, activeThreadId, threads);

    shipmentThreadState = {
      shipmentId,
      threads,
      activeThreadId,
      search: searchTerm,
      comments,
      allComments,
      queued
    };
    paintShipmentThreadPanel(panel, true);
    return;
  }

  try {
    const [threadsRes, commentsRes] = await Promise.all([
      fetchJSON(`/api/shipments/${shipmentId}/comment-threads`),
      fetchJSON(`/api/shipments/${shipmentId}/comments`)
    ]);
    const threads = Array.isArray(threadsRes.threads) ? threadsRes.threads : [];
    const allComments = Array.isArray(commentsRes.comments) ? commentsRes.comments : [];
    let activeThreadId = overrideThreadId ||
      (sameShipment ? shipmentThreadState.activeThreadId : null);
    if (!activeThreadId || !threads.find(t => Number(t.id) === Number(activeThreadId))) {
      activeThreadId = threads[0] ? threads[0].id : null;
    }

    const comments = getShipmentCommentsForThread(allComments, activeThreadId, threads);

    shipmentThreadState = {
      shipmentId,
      threads,
      activeThreadId,
      search: searchTerm,
      comments,
      allComments,
      queued
    };
    paintShipmentThreadPanel(panel, false);
  } catch (err) {
    panel.innerHTML = `<p class="small-muted">Failed to load comments: ${escapeHTML(err.message || '')}</p>`;
  }
}

async function createShipmentCommentThread(shipmentId) {
  const titleInput = document.getElementById('ship-thread-title');
  const categoryInput = document.getElementById('ship-thread-category');
  const messageEl = document.getElementById('ship-thread-new-message');
  const newForm = document.getElementById('ship-thread-new-form');
  const submitBtn = newForm
    ? newForm.querySelector('button[type="submit"]')
    : null;
  const title = titleInput ? titleInput.value.trim() : '';
  const category = categoryInput ? categoryInput.value : '';

  if (!title) {
    if (messageEl) {
      messageEl.textContent = 'Subject is required.';
      messageEl.style.color = 'crimson';
    }
    return;
  }

  if (!isOnline()) {
    if (messageEl) {
      messageEl.textContent = 'Go online to create a new thread.';
      messageEl.style.color = '#b45309';
    }
    return;
  }

  try {
    if (messageEl) {
      messageEl.textContent = 'Creating...';
      messageEl.style.color = '';
    }
    if (submitBtn) submitBtn.disabled = true;
    const res = await fetchJSON(`/api/shipments/${encodeURIComponent(shipmentId)}/comment-threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        category,
        client_id: makeClientId('thread')
      })
    });
    if (titleInput) titleInput.value = '';
    if (messageEl) {
      messageEl.textContent = 'Thread created.';
      messageEl.style.color = 'green';
    }
    if (newForm) {
      newForm.classList.add('hidden');
    }
    await loadShipmentComments(shipmentId, {
      activeThreadId: res?.thread_id || null,
      preserveSearch: true
    });
  } catch (err) {
    if (messageEl) {
      messageEl.textContent = err.message || 'Failed to create thread.';
      messageEl.style.color = 'crimson';
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function updateShipmentCommentThread(shipmentId, threadId, title) {
  if (!isOnline()) {
    throw new Error('Go online to rename this thread.');
  }
  const trimmedTitle = String(title || '').trim();
  if (!trimmedTitle) {
    throw new Error('Thread title required.');
  }
  return fetchJSON(
    `/api/shipments/${encodeURIComponent(shipmentId)}/comment-threads/${encodeURIComponent(threadId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: trimmedTitle })
    }
  );
}

function focusShipmentSearchResult(panel, result = {}) {
  if (!panel || !result) return;
  const commentIdNum = Number(result.commentId);
  const localKey = String(result.localKey || '').trim();

  let target = null;
  if (Number.isFinite(commentIdNum) && commentIdNum > 0) {
    target = panel.querySelector(`.ship-detail-thread-row[data-comment-id="${commentIdNum}"]`);
  }
  if (!target && localKey) {
    target = Array.from(
      panel.querySelectorAll('.ship-detail-thread-row[data-comment-local-key]')
    ).find(row => String(row.getAttribute('data-comment-local-key') || '') === localKey) || null;
  }
  if (!target) return;

  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('search-hit');
  window.setTimeout(() => {
    if (!document.body.contains(target)) return;
    target.classList.remove('search-hit');
  }, 1600);
}

function renderShipmentThreadSearchResults(panel, shipmentId, offline = false) {
  if (!panel || !shipmentId) return;
  const resultsEl = panel.querySelector('#ship-thread-search-results');
  if (!resultsEl) return;

  const term = String(shipmentThreadState.search || '').trim();
  if (!term) {
    resultsEl.innerHTML = '';
    resultsEl.classList.add('hidden');
    return;
  }

  const matches = buildShipmentMessageSearchMatches({
    threads: shipmentThreadState.threads,
    comments: shipmentThreadState.allComments,
    queued: shipmentThreadState.queued,
    searchTerm: term
  });

  if (!matches.length) {
    resultsEl.innerHTML = '<div class="ship-detail-thread-search-empty">No messages match.</div>';
    resultsEl.classList.remove('hidden');
    return;
  }

  resultsEl.innerHTML = matches.map((match, idx) => {
    const commentIdAttr = Number.isFinite(Number(match.commentId)) && Number(match.commentId) > 0
      ? `data-search-comment-id="${escapeHTML(String(match.commentId))}"`
      : '';
    const localKeyAttr = match.localKey
      ? `data-search-local-key="${escapeHTML(String(match.localKey))}"`
      : '';
    const whenLabel = formatDateTimeInOrgTime(match.createdAtMs);
    return `
      <button
        type="button"
        class="ship-detail-thread-search-result"
        data-search-thread-id="${escapeHTML(String(match.threadId || ''))}"
        ${commentIdAttr}
        ${localKeyAttr}
        data-search-result-index="${idx}"
      >
        <div class="ship-detail-thread-search-result-top">
          <span class="ship-detail-thread-search-result-thread">${escapeHTML(match.threadTitle || 'Thread')}</span>
          ${whenLabel ? `<span class="ship-detail-thread-search-result-time">${escapeHTML(whenLabel)}</span>` : ''}
        </div>
        <div class="ship-detail-thread-search-result-body">${buildShipmentSearchSnippetHtml(match.body, term)}</div>
      </button>
    `;
  }).join('');
  resultsEl.classList.remove('hidden');

  resultsEl.querySelectorAll('.ship-detail-thread-search-result').forEach(btn => {
    btn.addEventListener('click', () => {
      const threadId = Number(btn.getAttribute('data-search-thread-id'));
      if (!Number.isFinite(threadId) || threadId <= 0) return;
      const commentId = btn.getAttribute('data-search-comment-id');
      const localKey = btn.getAttribute('data-search-local-key') || '';

      shipmentThreadState.activeThreadId = threadId;
      shipmentThreadState.comments = getShipmentCommentsForThread(
        shipmentThreadState.allComments,
        threadId,
        shipmentThreadState.threads
      );
      shipmentThreadState.search = '';
      paintShipmentThreadPanel(panel, offline);
      window.requestAnimationFrame(() => {
        focusShipmentSearchResult(panel, {
          commentId: commentId ? Number(commentId) : null,
          localKey
        });
      });
    });
  });
}

function bindShipmentThreadHandlers(panel, shipmentId, offline = false) {
  const openThreadEditForm = (titleOverride = '') => {
    const editForm = panel.querySelector('#ship-thread-edit-form');
    const editInput = panel.querySelector('#ship-thread-edit-title');
    const editMessage = panel.querySelector('#ship-thread-edit-message');
    if (!editForm) return;
    editForm.classList.remove('hidden');
    if (editInput) {
      editInput.value = titleOverride || editForm.dataset.threadTitle || '';
      editInput.focus();
      editInput.select();
    }
    if (editMessage) editMessage.textContent = '';
  };

  const searchInput = panel.querySelector('#ship-thread-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      shipmentThreadState.search = searchInput.value || '';
      renderShipmentThreadSearchResults(panel, shipmentId, offline);
    });
    searchInput.addEventListener('focus', () => {
      renderShipmentThreadSearchResults(panel, shipmentId, offline);
    });
    searchInput.addEventListener('search', () => {
      shipmentThreadState.search = searchInput.value || '';
      renderShipmentThreadSearchResults(panel, shipmentId, offline);
    });
  }

  const newToggle = panel.querySelector('#ship-thread-new-toggle');
  const newForm = panel.querySelector('#ship-thread-new-form');
  if (newToggle && newForm) {
    newToggle.addEventListener('click', () => {
      if (offline) return;
      newForm.classList.toggle('hidden');
      if (!newForm.classList.contains('hidden')) {
        const titleInput = newForm.querySelector('#ship-thread-title');
        const msg = newForm.querySelector('#ship-thread-new-message');
        if (msg) msg.textContent = '';
        const categoryInput = newForm.querySelector('#ship-thread-category');
        if (categoryInput) categoryInput.value = 'General';
        if (titleInput) {
          titleInput.value = '';
          titleInput.focus();
        }
      }
    });
  }

  const cancelBtn = panel.querySelector('#ship-thread-new-cancel');
  if (cancelBtn && newForm) {
    cancelBtn.addEventListener('click', () => {
      newForm.classList.add('hidden');
      const msg = newForm.querySelector('#ship-thread-new-message');
      if (msg) msg.textContent = '';
    });
  }

  if (newForm) {
    newForm.addEventListener('submit', async (evt) => {
      evt.preventDefault();
      await createShipmentCommentThread(shipmentId);
    });
  }

  panel.querySelectorAll('.ship-detail-thread-item').forEach(item => {
    item.addEventListener('click', () => {
      const threadId = item.getAttribute('data-thread-id');
      if (!threadId) return;
      const nextThreadId = Number(threadId);
      if (!Number.isFinite(nextThreadId) || nextThreadId <= 0) return;
      shipmentThreadState.activeThreadId = nextThreadId;
      shipmentThreadState.comments = getShipmentCommentsForThread(
        shipmentThreadState.allComments,
        nextThreadId,
        shipmentThreadState.threads
      );
      paintShipmentThreadPanel(panel, offline);
    });
  });

  panel.querySelectorAll('.ship-detail-thread-edit-inline').forEach(btn => {
    btn.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      if (offline) return;
      const threadId = Number(btn.getAttribute('data-thread-edit-id'));
      if (!Number.isFinite(threadId) || threadId <= 0) return;
      const threadTitle = String(btn.getAttribute('data-thread-edit-title') || '');
      shipmentThreadState.activeThreadId = threadId;
      shipmentThreadState.comments = getShipmentCommentsForThread(
        shipmentThreadState.allComments,
        threadId,
        shipmentThreadState.threads
      );
      paintShipmentThreadPanel(panel, offline);
      window.requestAnimationFrame(() => {
        openThreadEditForm(threadTitle);
      });
    });
  });

  const editForm = panel.querySelector('#ship-thread-edit-form');
  const editInput = panel.querySelector('#ship-thread-edit-title');
  const editCancel = panel.querySelector('#ship-thread-edit-cancel');
  const editMessage = panel.querySelector('#ship-thread-edit-message');

  const closeEdit = () => {
    if (!editForm) return;
    editForm.classList.add('hidden');
    if (editMessage) editMessage.textContent = '';
  };

  if (editCancel) {
    editCancel.addEventListener('click', () => {
      closeEdit();
    });
  }

  if (editForm) {
    editForm.addEventListener('submit', async (evt) => {
      evt.preventDefault();
      const threadId = editForm.dataset.threadId;
      const nextTitle = editInput ? editInput.value.trim() : '';
      if (!nextTitle) {
        if (editMessage) {
          editMessage.textContent = 'Subject is required.';
          editMessage.style.color = 'crimson';
        }
        return;
      }
      try {
        if (editMessage) {
          editMessage.textContent = 'Saving...';
          editMessage.style.color = '';
        }
        await updateShipmentCommentThread(shipmentId, threadId, nextTitle);
        if (editMessage) {
          editMessage.textContent = 'Saved.';
          editMessage.style.color = 'green';
        }
        await loadShipmentComments(shipmentId, {
          activeThreadId: threadId,
          preserveSearch: true
        });
      } catch (err) {
        if (editMessage) {
          editMessage.textContent = err.message || 'Failed to rename thread.';
          editMessage.style.color = 'crimson';
        }
      }
    });
  }

  const form = panel.querySelector('#ship-detail-comment-form');
  if (form) {
    form.addEventListener('submit', async (evt) => {
      evt.preventDefault();
      await submitShipmentComment(shipmentId);
    });
  }

  if (!panel.dataset.shipDetailMenuBound) {
    panel.addEventListener('click', (evt) => {
      if (!evt.target.closest('#ship-thread-search') &&
        !evt.target.closest('#ship-thread-search-results')) {
        const resultsEl = panel.querySelector('#ship-thread-search-results');
        if (resultsEl) resultsEl.classList.add('hidden');
      }
    });
    panel.dataset.shipDetailMenuBound = '1';
  }

  panel.querySelectorAll('[data-comment-action]').forEach(btn => {
    btn.addEventListener('click', async (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      const action = btn.getAttribute('data-comment-action');
      const commentId = btn.getAttribute('data-comment-id');
      if (!action || !commentId) return;
      if (action === 'undo') {
        const createdAtMs = btn.getAttribute('data-comment-created-at-ms');
        if (!isShipmentCommentUndoOpen(createdAtMs)) {
          alert('Undo send is only available for 5 minutes after posting.');
          return;
        }
        await deleteShipmentComment(shipmentId, commentId, { prompt: false });
        return;
      }
      if (action === 'delete') {
        await deleteShipmentComment(shipmentId, commentId, { prompt: true });
      }
    });
  });

  panel.querySelectorAll('[data-comment-expire]').forEach(btn => {
    const expiresAt = Number(btn.getAttribute('data-comment-expire'));
    if (!Number.isFinite(expiresAt)) return;
    const delay = expiresAt - Date.now();
    if (delay <= 0) {
      btn.classList.add('hidden');
      return;
    }
    setTimeout(() => {
      if (!document.body.contains(btn)) return;
      btn.classList.add('hidden');
    }, delay);
  });

  renderShipmentThreadSearchResults(panel, shipmentId, offline);
}

async function submitShipmentComment(shipmentId) {
  const input = document.getElementById('ship-detail-comment-body');
  const messageEl = document.getElementById('ship-comment-message');
  const body = input ? input.value.trim() : '';
  if (!body) {
    if (messageEl) {
      messageEl.textContent = 'Comment cannot be empty.';
      messageEl.style.color = 'crimson';
    }
    return;
  }

  const threadId = shipmentThreadState.activeThreadId || null;

  if (!isOnline()) {
    queueShipmentComment({ shipmentId, body, threadId });
    if (input) input.value = '';
    if (messageEl) {
      messageEl.textContent = 'Comment queued for sync.';
      messageEl.style.color = '#b45309';
    }
    await loadShipmentComments(shipmentId, { preserveSearch: true });
    return;
  }

  try {
    if (messageEl) {
      messageEl.textContent = 'Saving...';
      messageEl.style.color = '';
    }
    await fetchJSON(`/api/shipments/${encodeURIComponent(shipmentId)}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body,
        thread_id: threadId,
        client_id: makeClientId('comment')
      })
    });
    if (input) input.value = '';
    if (messageEl) {
      messageEl.textContent = 'Comment added.';
      messageEl.style.color = 'green';
    }
    await loadShipmentComments(shipmentId, {
      activeThreadId: threadId,
      preserveSearch: true
    });
  } catch (err) {
    if (messageEl) {
      messageEl.textContent = err.message || 'Failed to add comment.';
      messageEl.style.color = 'crimson';
    }
  }
}

function updateShipmentTrackingHelper() {
  const tnInput   = document.getElementById('shipment-tracking-number');
  const websiteEl = document.getElementById('shipment-website-url');
  const helper    = document.getElementById('shipment-tracking-helper');

  if (!tnInput || !helper) return;

  const tn  = tnInput.value || '';
  const fwd = getShipmentForwarderValue() || '';
  const url = websiteEl ? websiteEl.value : '';

  const linkHtml = buildTrackingLink(tn, fwd, url);

  if (!tn.trim() || linkHtml === '—') {
    helper.textContent = '';
  } else {
    const trackingUrl = buildTrackingLink(tn, fwd, url);

// trackingUrl contains <a>…TRACKINGNUMBER…</a>
// but we ONLY want the href value
const hrefMatch = trackingUrl.match(/href="([^"]+)"/);
const href = hrefMatch ? hrefMatch[1] : null;

if (href) {
  helper.innerHTML = `<a href="${href}" target="_blank" rel="noopener noreferrer">Track Shipment</a>`;
} else {
  helper.textContent = '';
}
  }
}

function buildTrackingLink(trackingNumber, forwarder, websiteUrl) {
  if (!trackingNumber) return '—';

  const tn = String(trackingNumber).trim();
  if (!tn) return '—';

  const fwd = (forwarder || '').toLowerCase();
  const url = (websiteUrl || '').toLowerCase();

  let carrier = '';

  // Detect from forwarder name / URL
  if (fwd.includes('ups') || url.includes('ups.com') || tn.toUpperCase().startsWith('1Z')) {
    carrier = 'ups';
  } else if (fwd.includes('fedex') || url.includes('fedex.com')) {
    carrier = 'fedex';
  } else if (fwd.includes('usps') || url.includes('usps.com') || /^[A-Z]{2}\d{9}US$/i.test(tn)) {
    carrier = 'usps';
  } else if (fwd.includes('dhl') || url.includes('dhl.com')) {
    carrier = 'dhl';
  } else if (fwd.includes('amazon') || url.includes('amazon.com')) {
    carrier = 'amazon';
  }

  let trackingUrl;

  switch (carrier) {
    case 'ups':
      trackingUrl = `https://www.ups.com/track?loc=en_US&tracknum=${encodeURIComponent(tn)}`;
      break;
    case 'fedex':
      trackingUrl = `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(tn)}`;
      break;
    case 'usps':
      trackingUrl = `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(tn)}`;
      break;
    case 'dhl':
      trackingUrl = `https://www.dhl.com/en/express/tracking.html?AWB=${encodeURIComponent(tn)}&brand=DHL`;
      break;
    case 'amazon':
      // Amazon is messy, so just search for it
      trackingUrl = `https://www.google.com/search?q=${encodeURIComponent('track ' + tn + ' amazon')}`;
      break;
    default:
      // Fallback: let the user’s browser open a Google search for "track <number>"
      trackingUrl = `https://www.google.com/search?q=${encodeURIComponent('track ' + tn)}`;
      break;
  }

  return `<a href="${trackingUrl}" target="_blank" rel="noopener noreferrer">${tn}</a>`;
}

function showDocsPlaceholder() {
  const section       = document.getElementById("shipment-docs-section");
  const placeholder   = document.getElementById("shipment-docs-placeholder");
  const uploadArea    = document.getElementById("shipment-docs-upload-area");
  const listContainer = document.getElementById("shipment-docs-list-container");

  if (section) section.classList.remove("hidden");

  if (placeholder)   placeholder.style.display = "block";
  if (uploadArea)    uploadArea.classList.add("hidden");
  if (listContainer) listContainer.classList.add("hidden");
}

function showDocsUI() {
  const section       = document.getElementById("shipment-docs-section");
  const placeholder   = document.getElementById("shipment-docs-placeholder");
  const uploadArea    = document.getElementById("shipment-docs-upload-area");
  const listContainer = document.getElementById("shipment-docs-list-container");

  if (section) section.classList.remove("hidden");

  if (placeholder)   placeholder.style.display = "none";
  if (uploadArea)    uploadArea.classList.remove("hidden");
  if (listContainer) listContainer.classList.remove("hidden");
}

function getShipmentIsContainer() {
  const containerInput = document.getElementById('shipment-is-container');
  return !!(containerInput && containerInput.checked);
}

function isContainerValue(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function parseStorageDefaultFee(raw) {
  if (raw === null || typeof raw === 'undefined' || raw === '') return null;
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

function getShipmentStorageDefaults(settings = {}) {
  return {
    standard: parseStorageDefaultFee(settings.storage_daily_late_fee_default),
    container: parseStorageDefaultFee(settings.storage_container_daily_late_fee_default)
  };
}

function updateStorageFeeLabels() {
  const isContainer = getShipmentIsContainer();
  const estimateLabel = document.getElementById('shipment-storage-fees-label');
  const paymentTitle = document.getElementById('shipment-storage-fee-title');
  if (estimateLabel) {
    estimateLabel.textContent = isContainer
      ? 'Est. Container Fees (auto)'
      : 'Est. Storage Fees (auto)';
  }
  if (paymentTitle) {
    paymentTitle.textContent = isContainer ? 'Container Fees' : 'Storage Fees';
  }
}

async function loadShipmentSettingsCached() {
  // Always fetch fresh to reflect any Settings changes without reload.
  if (shipmentSettingsPromise) return shipmentSettingsPromise;

  shipmentSettingsPromise = (async () => {
    try {
      const res = await fetchJSON('/api/settings');
      shipmentSettingsCache = (res && res.settings) || {};
    } catch (err) {
      console.warn('[SHIPMENTS] Failed to load settings for storage fees', err);
    } finally {
      shipmentSettingsPromise = null;
    }
    return shipmentSettingsCache || {};
  })();

  return shipmentSettingsPromise;
}

async function applyDefaultStorageLateFeeFromSettings(options = {}) {
  const feeInput = document.getElementById('shipment-storage-daily-fee');
  if (!feeInput) return;

  const currentValue = feeInput.value ? feeInput.value.trim() : '';
  const force = options && options.force === true;
  if (!force && currentValue !== '') {
    updateStorageFeeLabels();
    return;
  }

  const settings = await loadShipmentSettingsCached();
  const { standard, container } = getShipmentStorageDefaults(settings || {});
  const isContainer = getShipmentIsContainer();
  const dailyFeeNum = isContainer ? container : standard;

  if (!Number.isFinite(dailyFeeNum) || dailyFeeNum < 0) {
    feeInput.value = '';
    feeInput.dataset.defaultSource = isContainer ? 'container' : 'standard';
    feeInput.dataset.defaultValue = '';
    updateStorageFeeEstimate();
    updateStorageFeeLabels();
    return;
  }

  feeInput.value = dailyFeeNum.toFixed(2);
  feeInput.dataset.defaultSource = isContainer ? 'container' : 'standard';
  feeInput.dataset.defaultValue = dailyFeeNum.toFixed(2);
  updateStorageFeeEstimate();
  updateStorageFeeLabels();
}
function clearShipmentSettingsCache() {
  shipmentSettingsCache = null;
}
window.clearShipmentSettingsCache = clearShipmentSettingsCache;

function calculateStorageLateFees(dueDateStr, dailyFeeRaw, effectiveDateStr = '') {
  const dailyFeeText = String(dailyFeeRaw ?? '').trim();
  if (!dailyFeeText) {
    return { daysLate: 0, estimate: 0 };
  }
  const dailyFee = Number(dailyFeeText);
  if (!dueDateStr || Number.isNaN(dailyFee) || dailyFee < 0) {
    return { daysLate: 0, estimate: 0 };
  }

  const due = new Date(`${dueDateStr}T00:00:00`);
  if (Number.isNaN(due.getTime())) {
    return { daysLate: 0, estimate: 0 };
  }

  let endDate = null;
  if (effectiveDateStr) {
    const parsed = new Date(`${effectiveDateStr}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      endDate = parsed;
    }
  }
  if (!endDate) {
    endDate = new Date();
    endDate.setHours(0, 0, 0, 0);
  }

  const diffDays = Math.floor((endDate - due) / 86400000);
  const daysLate = diffDays > 0 ? diffDays : 0;
  const estimate = daysLate > 0 ? dailyFee * daysLate : 0;

  return { daysLate, estimate };
}

function updateStorageFeeEstimate() {
  const dueInput = document.getElementById('shipment-storage-due-date');
  const feeInput = document.getElementById('shipment-storage-daily-fee');
  const pickedUpInput = document.getElementById('shipment-picked-up-date');
  const estimateDisplay = document.getElementById('shipment-storage-fees-estimate');
  const helper = document.getElementById('shipment-storage-fees-helper');
  const storagePaidAmt = document.getElementById('shipment-storage-paid-amount');
  const storagePaidChk = document.getElementById('shipment-storage-paid');

  const dueDate = dueInput?.value || '';
  const dailyFeeRaw = feeInput?.value || '';
  const pickedUpDate = pickedUpInput?.value || '';
  const { daysLate, estimate } = calculateStorageLateFees(
    dueDate,
    dailyFeeRaw,
    pickedUpDate
  );

  if (estimateDisplay) {
    const overdueText =
      daysLate > 0
        ? ` [${daysLate} day${daysLate === 1 ? '' : 's'} overdue]`
        : '';
    estimateDisplay.value = `$${estimate.toFixed(2)}${overdueText}`;
    estimateDisplay.style.color = estimate > 0 ? '#b91c1c' : '';
  }

  if (helper) {
    const paymentsAllowed =
      typeof canViewShipmentPayments === 'function'
        ? canViewShipmentPayments()
        : true;
    if (!paymentsAllowed) {
      helper.textContent = '';
      helper.style.display = 'none';
    } else {
      const isContainer = getShipmentIsContainer();
      const label = isContainer ? 'Container fee' : 'Storage fee';
      const feeTrimmed = String(dailyFeeRaw || '').trim();
      const feeNum =
        feeTrimmed === '' || feeTrimmed == null ? null : Number(feeTrimmed);
      const hasFee = feeNum != null && Number.isFinite(feeNum) && feeNum >= 0;

      if (hasFee) {
        helper.textContent = `${label} rate: $${feeNum.toFixed(2)}/day.`;
        helper.style.display = 'block';
      } else {
        helper.textContent = isContainer
          ? 'No container fee set. Update Shipment Defaults in Settings to auto-calc fees.'
          : 'No storage fee set. Update Shipment Defaults in Settings to auto-calc fees.';
        helper.style.display = 'block';
      }
    }
  }

  if (storagePaidAmt) {
    const autoValue =
      daysLate > 0 || (storagePaidChk && storagePaidChk.checked)
        ? estimate.toFixed(2)
        : '';

    if (!storagePaidAmt.dataset.manual) {
      const currentRaw = storagePaidAmt.value.trim();
      const currentNum = Number(currentRaw);
      if (
        currentRaw === '' ||
        (!Number.isNaN(currentNum) && Math.abs(currentNum - estimate) < 0.01)
      ) {
        storagePaidAmt.dataset.manual = '0';
      } else {
        storagePaidAmt.dataset.manual = '1';
      }
    }

    if (storagePaidAmt.dataset.manual !== '1') {
      storagePaidAmt.value = autoValue;
      updateShipmentTotalPaid();
    }
  }
}

function setupStorageLateFeeListeners() {
  const dueInput = document.getElementById('shipment-storage-due-date');
  const feeInput = document.getElementById('shipment-storage-daily-fee');
  const pickedUpInput = document.getElementById('shipment-picked-up-date');
  const containerInput = document.getElementById('shipment-is-container');

  if (dueInput) {
    dueInput.addEventListener('change', updateStorageFeeEstimate);
  }

  if (feeInput) {
    feeInput.addEventListener('input', updateStorageFeeEstimate);
    feeInput.addEventListener('blur', () => {
      formatMoneyInput(feeInput);
      updateStorageFeeEstimate();
    });
  }

  if (pickedUpInput) {
    pickedUpInput.addEventListener('change', updateStorageFeeEstimate);
  }

  if (containerInput && containerInput.dataset.bound !== '1') {
    containerInput.addEventListener('change', () => {
      applyDefaultStorageLateFeeFromSettings({ force: true });
      updateStorageFeeEstimate();
      updateStorageFeeLabels();
    });
    containerInput.dataset.bound = '1';
  }
}


function updateShipmentTotalPaid() {
  const shipperPaidChk = document.getElementById('shipment-shipper-paid');
  const shipperAmtEl = document.getElementById('shipment-shipper-paid-amount');
  const shipperPaidBySel = document.getElementById('shipment-shipper-paid-by');
  const shipperPaidByOther = document.getElementById('shipment-shipper-paid-by-other');
  const customsPaidChk = document.getElementById('shipment-customs-paid');
  const customsAmtEl = document.getElementById('shipment-customs-paid-amount');
  const customsPaidBySel = document.getElementById('shipment-customs-paid-by');
  const customsPaidByOther = document.getElementById('shipment-customs-paid-by-other');
  const storagePaidChk = document.getElementById('shipment-storage-paid');
  const storageAmtEl = document.getElementById('shipment-storage-paid-amount');
  const storagePaidBySel = document.getElementById('shipment-storage-paid-by');
  const storagePaidByOther = document.getElementById('shipment-storage-paid-by-other');

  const displayEl = document.getElementById('shipment-total-paid-display'); // visible UI
  const companyDisplayEl = document.getElementById('shipment-total-paid-company-display');
  const otherDisplayEl = document.getElementById('shipment-total-paid-other-display');
  const hiddenEl  = document.getElementById('shipment-total-paid');         // hidden numeric

  const shipperPaid = shipperPaidChk ? shipperPaidChk.checked : true;
  const customsPaid = customsPaidChk ? customsPaidChk.checked : true;
  const storagePaid = storagePaidChk ? storagePaidChk.checked : false;

  const shipperAmt =
    shipperPaid && shipperAmtEl ? parseFloat(shipperAmtEl.value) || 0 : 0;
  const customsAmt =
    customsPaid && customsAmtEl ? parseFloat(customsAmtEl.value) || 0 : 0;
  const storageAmt =
    storagePaid && storageAmtEl ? parseFloat(storageAmtEl.value) || 0 : 0;

  const classifyPaidBy = (selectEl, otherInput) => {
    const raw = selectEl ? String(selectEl.value || '') : '';
    if (!raw) return 'unassigned';
    if (raw === SHIPMENT_PAID_BY_COMPANY) return 'company';
    if (raw === SHIPMENT_PAID_BY_OTHER) return otherInput?.value.trim() ? 'other' : 'other';
    if (raw.startsWith(SHIPMENT_PAID_BY_CUSTOMER_PREFIX)) return 'other';
    if (raw.toLowerCase() === 'company') return 'company';
    return 'other';
  };

  let companyTotal = 0;
  let otherTotal = 0;

  if (shipperPaid && shipperAmt) {
    const cat = classifyPaidBy(shipperPaidBySel, shipperPaidByOther);
    if (cat === 'company') {
      companyTotal += shipperAmt;
    } else if (cat === 'other') {
      otherTotal += shipperAmt;
    }
  }

  if (customsPaid && customsAmt) {
    const cat = classifyPaidBy(customsPaidBySel, customsPaidByOther);
    if (cat === 'company') {
      companyTotal += customsAmt;
    } else if (cat === 'other') {
      otherTotal += customsAmt;
    }
  }

  if (storagePaid && storageAmt) {
    const cat = classifyPaidBy(storagePaidBySel, storagePaidByOther);
    if (cat === 'company' || cat === 'unassigned') {
      companyTotal += storageAmt;
    } else if (cat === 'other') {
      otherTotal += storageAmt;
    }
  }

  const total = shipperAmt + customsAmt + storageAmt;

  // Pretty string in UI
  if (displayEl) {
    displayEl.value = `$${total.toFixed(2)}`;
  }
  if (companyDisplayEl) {
    companyDisplayEl.value = `$${companyTotal.toFixed(2)}`;
  }
  if (otherDisplayEl) {
    otherDisplayEl.value = `$${otherTotal.toFixed(2)}`;
  }

  // Clean numeric value used when saving
  if (hiddenEl) {
    hiddenEl.value = total ? total.toFixed(2) : '';
  }
}

function setupShipmentPaymentListeners() {
  const form = document.getElementById('shipment-create-form');
  const updatePaidByDataset = (key, payer, other) => {
    if (!form || !key || !payer) return;
    const resolved = resolveShipmentPaidBy(payer, other);
    form.dataset[key] = resolved.value || '';
  };

  const paymentPairs = [
    {
      chkId: 'shipment-shipper-paid',
      amtId: 'shipment-shipper-paid-amount',
      payerId: 'shipment-shipper-paid-by',
      otherId: 'shipment-shipper-paid-by-other',
      datasetKey: 'shipperPaidBy'
    },
    {
      chkId: 'shipment-customs-paid',
      amtId: 'shipment-customs-paid-amount',
      payerId: 'shipment-customs-paid-by',
      otherId: 'shipment-customs-paid-by-other',
      datasetKey: 'customsPaidBy'
    }
  ];

  paymentPairs.forEach(({ chkId, amtId, payerId, otherId, datasetKey }) => {
    const chk = document.getElementById(chkId);
    const amt = document.getElementById(amtId);
    const payer = document.getElementById(payerId);
    const other = document.getElementById(otherId);
    if (chk) {
      chk.addEventListener('change', () => {
        applyPaymentCheckboxState(chk, amt, chk.checked);
        setShipmentPaidByControlsEnabled(payer, other, chk.checked);
      });
      // Initialize state on load
      applyPaymentCheckboxState(chk, amt, chk.checked);
      setShipmentPaidByControlsEnabled(payer, other, chk.checked);
    }

    if (payer) {
      payer.addEventListener('change', () => {
        updatePaidByOtherVisibility(payer, other);
        updatePaidByDataset(datasetKey, payer, other);
        updateShipmentTotalPaid();
      });
      updatePaidByOtherVisibility(payer, other);
      updatePaidByDataset(datasetKey, payer, other);
      if (other) {
        other.addEventListener('input', () => {
          updatePaidByDataset(datasetKey, payer, other);
          updateShipmentTotalPaid();
        });
      }
    }
  });

  [
    'shipment-shipper-paid-amount',
    'shipment-customs-paid-amount'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      // live update total while typing
      el.addEventListener('input', updateShipmentTotalPaid);

      // normalize to 2 decimals when leaving field
      el.addEventListener('blur', () => {
        formatMoneyInput(el);
        updateShipmentTotalPaid();
      });
    }
  });

  const storagePaidChk = document.getElementById('shipment-storage-paid');
  const storagePaidAmt = document.getElementById('shipment-storage-paid-amount');
  const storagePaidBy = document.getElementById('shipment-storage-paid-by');
  const storagePaidByOther = document.getElementById('shipment-storage-paid-by-other');
  if (storagePaidChk) {
    storagePaidChk.addEventListener('change', () => {
      applyPaymentCheckboxState(storagePaidChk, storagePaidAmt, storagePaidChk.checked);
      setShipmentPaidByControlsEnabled(storagePaidBy, storagePaidByOther, storagePaidChk.checked);
      updateShipmentTotalPaid();
      updateStorageFeeEstimate();
    });
    applyPaymentCheckboxState(storagePaidChk, storagePaidAmt, storagePaidChk.checked);
    setShipmentPaidByControlsEnabled(storagePaidBy, storagePaidByOther, storagePaidChk.checked);
  }
  if (storagePaidBy) {
    storagePaidBy.addEventListener('change', () => {
      updatePaidByOtherVisibility(storagePaidBy, storagePaidByOther);
      updateShipmentTotalPaid();
      updatePaidByDataset('storagePaidBy', storagePaidBy, storagePaidByOther);
    });
    updatePaidByOtherVisibility(storagePaidBy, storagePaidByOther);
    updatePaidByDataset('storagePaidBy', storagePaidBy, storagePaidByOther);
  }
  if (storagePaidByOther) {
    storagePaidByOther.addEventListener('input', () => {
      updateShipmentTotalPaid();
      updatePaidByDataset('storagePaidBy', storagePaidBy, storagePaidByOther);
    });
  }
  if (storagePaidAmt) {
    storagePaidAmt.addEventListener('input', () => {
      if (storagePaidAmt.value.trim() === '') {
        storagePaidAmt.dataset.manual = '0';
      } else {
        storagePaidAmt.dataset.manual = '1';
      }
      updateShipmentTotalPaid();
    });
    storagePaidAmt.addEventListener('blur', () => {
      formatMoneyInput(storagePaidAmt);
      updateShipmentTotalPaid();
    });
  }
}


document.addEventListener('click', async (evt) => {
  const deleteBtn = evt.target.closest && evt.target.closest('#shipment-delete-btn');
  if (!deleteBtn) return;

  const idInput    = document.getElementById('shipment-id');
  const shipmentId = idInput && idInput.value ? idInput.value : null;
  const msgEl      = document.getElementById('shipment-create-status');

  if (!shipmentId) {
    if (msgEl) {
      msgEl.textContent = 'This shipment has not been saved yet.';
      msgEl.style.color = 'crimson';
    }
    return;
  }

  const ok = window.confirm('Delete (archive) this shipment?');
  if (!ok) return;

  try {
    await fetchJSON(`/api/shipments/${encodeURIComponent(shipmentId)}`, {
      method: 'DELETE'
    });

    if (msgEl) {
      msgEl.textContent = 'Shipment deleted.';
      msgEl.style.color = 'green';
    }

    closeShipmentCreateModal();
    await loadShipmentsBoard();
  } catch (err) {
    if (msgEl) {
      msgEl.textContent = 'Error deleting shipment: ' + err.message;
      msgEl.style.color = 'crimson';
    }
  }
});
function applyPaymentCheckboxState(chk, amtInput, enabled) {
  if (!chk || !amtInput) return;
  if (!enabled) {
    amtInput.value = '';
    amtInput.disabled = true;
  } else {
    amtInput.disabled = false;
  }
  updateShipmentTotalPaid();
}
