/* ───────── NOTIFICATIONS UI ───────── */

(() => {
  const SHIPMENT_STATUSES = [
    'Pre-Order',
    'Ordered',
    'In Transit to Forwarder',
    'Arrived at Forwarder',
    'Sailed',
    'Arrived at Port',
    'Awaiting Clearance',
    'Cleared - Ready for Pickup',
    'Picked Up',
    'Archived'
  ];

  const TIME_EVENTS = [
    { value: 'TIME_SHIFT_LONG', label: 'Long shifts (12+ hours)' },
    { value: 'TIME_SHIFT_MULTI_DAY', label: 'Multi-day shifts (24+ hours)' },
    { value: 'TIME_PUNCH_OPEN_LONG', label: 'Open punches (12+ hours)' },
    { value: 'TIME_PUNCH_OPEN_MULTI_DAY', label: 'Open punches (24+ hours)' },
    { value: 'TIME_WEEKLY_THRESHOLD_NEAR', label: 'Weekly hours near limit' },
    { value: 'TIME_WEEKLY_THRESHOLD_EXCEEDED', label: 'Weekly hours exceeded' }
  ];

  const PAYROLL_EVENTS = [
    { value: 'PAYROLL_RUN_DUE', label: 'Payroll due' },
    { value: 'PAYROLL_RUN_SUCCESS', label: 'Payroll success' },
    { value: 'PAYROLL_RUN_PARTIAL', label: 'Payroll partial' },
    { value: 'PAYROLL_RUN_FAILURE', label: 'Payroll failure' },
    { value: 'PAYROLL_FATAL_ERROR', label: 'Payroll fatal error' },
    { value: 'PAYROLL_QBO_ERROR', label: 'QuickBooks error' },
    { value: 'PAYROLL_UNPAY', label: 'Payroll unpaid' }
  ];

  let notificationsInitialized = false;
  let nextBeforeId = null;
  let unreadOnly = false;
  let pushPublicKey = '';
  let prefsCache = null;

  function getEl(id) {
    return document.getElementById(id);
  }

  function setMessage(el, text, color) {
    if (!el) return;
    el.textContent = text || '';
    if (color) el.style.color = color;
  }

  function isConnectionIssue(err) {
    const msg = err && err.message ? String(err.message) : '';
    return !navigator.onLine || /network|failed to fetch|offline/i.test(msg);
  }

  async function syncNotificationPrefsQueue() {
    if (!navigator.onLine) return;
    const queue = loadSettingsQueue();
    if (!queue.length) return;

  const remaining = [];

  for (const entry of queue) {
      if (!entry || entry.type !== 'notifications_prefs') {
        continue;
      }
      try {
        const res = await fetch('/api/notifications/prefs', {
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
        prefsCache = data.prefs || entry.payload || {};
        applyPrefsToUI(prefsCache);
      } catch (err) {
        if (isConnectionIssue(err)) {
          remaining.push(entry);
          break;
        }
      }
    }

    replaceSettingsQueueTypes(['notifications_prefs'], remaining);
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const raw = atob(base64);
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
      output[i] = raw.charCodeAt(i);
    }
    return output;
  }

  function renderCheckboxGroup(container, options, selectedSet) {
    if (!container) return;
    container.innerHTML = '';
    options.forEach(opt => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = opt.value;
      input.checked = selectedSet.has(opt.value);
      label.appendChild(input);
      label.append(` ${opt.label}`);
      container.appendChild(label);
    });
  }

  function renderStatusCheckboxes(container, statuses, selectedSet) {
    if (!container) return;
    container.innerHTML = '';
    statuses.forEach(status => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = status;
      input.checked = selectedSet.has(status);
      label.appendChild(input);
      label.append(` ${status}`);
      container.appendChild(label);
    });
  }

  function setGroupDisabled(container, disabled) {
    if (!container) return;
    container.querySelectorAll('input, select').forEach(el => {
      el.disabled = disabled;
    });
  }

  function getCheckedValues(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll('input[type="checkbox"]:checked'))
      .map(input => input.value);
  }

  function setProjectCheckboxes(container, values, defaultAll = false) {
    if (!container) return;
    const ids = new Set(values.map(v => Number(v)));
    const inputs = Array.from(container.querySelectorAll('input[type="checkbox"]'));
    const shouldSelectAll = defaultAll && ids.size === 0;
    inputs.forEach(input => {
      const id = Number(input.value);
      if (!Number.isFinite(id)) return;
      input.checked = shouldSelectAll ? true : ids.has(id);
    });
  }

  function renderNotificationRow(item) {
    const wrapper = document.createElement('div');
    const isUnread = !item.read_at;
    wrapper.className = `notification-item${isUnread ? ' unread' : ''}`;

    const title = escapeHTML(item.title || 'Notification');
    const body = escapeHTML(item.body || '');
    const created = formatDateTimeLocal(item.created_at);
    const type = escapeHTML(item.type || '');

    wrapper.innerHTML = `
      <div class="notification-content">
        <div class="notification-title">${title}</div>
        ${type ? `<div class="notification-type">${type}</div>` : ''}
        ${body ? `<div class="notification-body">${body}</div>` : ''}
        <div class="notification-meta">${created}</div>
      </div>
      <div class="notification-actions">
        ${isUnread ? '<button class="btn secondary btn-sm" data-action="mark-read">Mark read</button>' : ''}
      </div>
    `;

    if (isUnread) {
      const btn = wrapper.querySelector('[data-action="mark-read"]');
      if (btn) {
        btn.addEventListener('click', async () => {
          await markNotificationsRead({ ids: [item.id] });
          wrapper.classList.remove('unread');
          btn.remove();
        });
      }
    }

    return wrapper;
  }

  async function loadNotifications({ reset = false } = {}) {
    const list = getEl('notifications-list');
    const messageEl = getEl('notifications-message');
    const loadMoreBtn = getEl('notifications-load-more');

    if (!list) return;

    if (reset) {
      list.innerHTML = '';
      nextBeforeId = null;
    }

    const params = new URLSearchParams();
    params.set('limit', '50');
    if (nextBeforeId) params.set('before_id', nextBeforeId);
    if (unreadOnly) params.set('unread_only', '1');

    try {
      const data = await fetchJSON(`/api/notifications?${params.toString()}`);
      const items = Array.isArray(data.notifications) ? data.notifications : [];
      items.forEach(item => {
        list.appendChild(renderNotificationRow(item));
      });
      nextBeforeId = data.next_before_id || null;
      if (loadMoreBtn) {
        loadMoreBtn.classList.toggle('hidden', !nextBeforeId);
      }
      if (reset && !items.length) {
        setMessage(messageEl, 'No notifications yet.');
      } else {
        setMessage(messageEl, '');
      }
    } catch (err) {
      setMessage(messageEl, err.message || 'Failed to load notifications.', 'crimson');
    }
  }

  async function markNotificationsRead({ ids = [], all = false } = {}) {
    const payload = all ? { all: true } : { ids };
    await fetchJSON('/api/notifications/mark-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (all) {
      document.querySelectorAll('.notification-item.unread').forEach(row => {
        row.classList.remove('unread');
        const btn = row.querySelector('[data-action="mark-read"]');
        if (btn) btn.remove();
      });
    }
  }

  async function markNotificationsReadOnView() {
    await loadNotifications({ reset: true });
    try {
      await markNotificationsRead({ all: true });
    } catch (err) {
      console.warn('Failed to auto-mark notifications read:', err);
    }
    if (unreadOnly) {
      await loadNotifications({ reset: true });
    }
  }

  async function loadNotificationPrefs() {
    const msgEl = getEl('notifications-pref-message');
    try {
      const data = await fetchJSON('/api/notifications/prefs');
      prefsCache = data.prefs || {};
      pushPublicKey = data.push_public_key || '';
      applyPrefsToUI(prefsCache);
    } catch (err) {
      setMessage(msgEl, err.message || 'Failed to load preferences.', 'crimson');
    }
  }

  function applyPrefsToUI(prefs) {
    const emailToggle = getEl('notifications-email-enabled');
    const pushToggle = getEl('notifications-push-enabled');
    const shipmentsToggle = getEl('notifications-shipments-enabled');
    const timeToggle = getEl('notifications-time-enabled');
    const payrollToggle = getEl('notifications-payroll-enabled');
    const remindTime = getEl('notifications-remind-time');
    const remindEvery = getEl('notifications-remind-every');
    const clockoutToggle = getEl('notifications-clockout-enabled');
    const statusContainer = getEl('notifications-shipment-statuses');
    const timeContainer = getEl('notifications-time-events');
    const payrollContainer = getEl('notifications-payroll-events');

    if (emailToggle) emailToggle.checked = !!prefs.email_enabled;
    if (pushToggle) pushToggle.checked = !!prefs.push_enabled;

    const shipmentFilters = prefs.shipment_filters || {};
    if (shipmentsToggle) shipmentsToggle.checked = shipmentFilters.enabled !== false;

    const timeFilters = prefs.time_filters || {};
    if (timeToggle) timeToggle.checked = !!timeFilters.enabled;

    const payrollFilters = prefs.payroll_filters || {};
    if (payrollToggle) payrollToggle.checked = !!payrollFilters.enabled;

    renderStatusCheckboxes(
      statusContainer,
      SHIPMENT_STATUSES,
      new Set((shipmentFilters.statuses || []).map(String))
    );
    renderCheckboxGroup(
      timeContainer,
      TIME_EVENTS,
      new Set((timeFilters.event_types || []).map(String))
    );
    renderCheckboxGroup(
      payrollContainer,
      PAYROLL_EVENTS,
      new Set((payrollFilters.event_types || []).map(String))
    );

    if (remindTime) remindTime.value = prefs.remind_time || prefs.clockout_time || '';
    if (remindEvery) remindEvery.value = prefs.remind_every_days || 1;
    if (clockoutToggle) clockoutToggle.checked = !!prefs.clockout_enabled;

    setGroupDisabled(statusContainer, !shipmentsToggle?.checked);
    setGroupDisabled(timeContainer, !timeToggle?.checked);
    setGroupDisabled(payrollContainer, !payrollToggle?.checked);

    const projectSelect = getEl('notifications-shipment-projects');
    if (projectSelect) {
      setProjectCheckboxes(projectSelect, shipmentFilters.project_ids || [], true);
      setGroupDisabled(projectSelect, !shipmentsToggle?.checked);
    }

    refreshPushStatus().catch(err => {
      console.warn('Push status check failed:', err);
    });
  }

  function collectPrefsFromUI() {
    const emailToggle = getEl('notifications-email-enabled');
    const pushToggle = getEl('notifications-push-enabled');
    const shipmentsToggle = getEl('notifications-shipments-enabled');
    const timeToggle = getEl('notifications-time-enabled');
    const payrollToggle = getEl('notifications-payroll-enabled');
    const remindTime = getEl('notifications-remind-time');
    const remindEvery = getEl('notifications-remind-every');
    const clockoutToggle = getEl('notifications-clockout-enabled');

    const statusContainer = getEl('notifications-shipment-statuses');
    const timeContainer = getEl('notifications-time-events');
    const payrollContainer = getEl('notifications-payroll-events');

    return {
      email_enabled: !!emailToggle?.checked,
      push_enabled: !!pushToggle?.checked,
      shipment_filters: {
        enabled: !!shipmentsToggle?.checked,
        statuses: getCheckedValues(statusContainer),
        project_ids: getCheckedValues(getEl('notifications-shipment-projects'))
          .map(val => Number(val))
          .filter(num => Number.isFinite(num))
      },
      time_filters: {
        enabled: !!timeToggle?.checked,
        event_types: getCheckedValues(timeContainer)
      },
      payroll_filters: {
        enabled: !!payrollToggle?.checked,
        event_types: getCheckedValues(payrollContainer)
      },
      remind_time: remindTime?.value || '',
      remind_every_days: Number(remindEvery?.value || 1),
      clockout_enabled: !!clockoutToggle?.checked,
      clockout_time: ''
    };
  }

  async function saveNotificationPrefs() {
    const msgEl = getEl('notifications-pref-message');
    try {
      const payload = collectPrefsFromUI();
      if (!navigator.onLine) {
        queueSettingsUpdate('notifications_prefs', payload);
        prefsCache = payload;
        applyPrefsToUI(prefsCache);
        setMessage(msgEl, 'Saved offline — will sync when back online.', '#b45309');
        return;
      }
      setMessage(msgEl, 'Saving preferences...');
      const data = await fetchJSON('/api/notifications/prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      prefsCache = data.prefs || payload;
      applyPrefsToUI(prefsCache);
      setMessage(msgEl, 'Preferences saved.', 'green');
    } catch (err) {
      if (isConnectionIssue(err)) {
        const payload = collectPrefsFromUI();
        queueSettingsUpdate('notifications_prefs', payload);
        prefsCache = payload;
        applyPrefsToUI(prefsCache);
        setMessage(msgEl, 'Saved offline — will sync when back online.', '#b45309');
        return;
      }
      setMessage(msgEl, err.message || 'Failed to save preferences.', 'crimson');
    }
  }

  async function sendTestNotification() {
    const msgEl = getEl('notifications-pref-message');
    try {
      const payload = collectPrefsFromUI();
      const channels = ['in_app'];
      if (payload.email_enabled) channels.push('email');
      if (payload.push_enabled) channels.push('push');

      const data = await fetchJSON('/api/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channels,
          title: 'Test notification',
          body: 'This is a test notification from Avian.'
        })
      });

      const results = data.results || {};
      const summary = Object.entries(results)
        .map(([key, val]) => `${key}: ${val}`)
        .join(', ');

      setMessage(msgEl, summary ? `Test sent (${summary}).` : 'Test sent.', 'green');
      await loadNotifications({ reset: true });
    } catch (err) {
      setMessage(msgEl, err.message || 'Failed to send test.', 'crimson');
    }
  }

  async function loadProjectsForNotifications() {
    const select = getEl('notifications-shipment-projects');
    if (!select) return;

    select.innerHTML = '';
    try {
      const projects = await fetchJSON('/api/projects?status=active');
      projects.forEach(project => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = project.id;
        label.appendChild(input);
        label.append(
          ` ${project.customer_name ? `${project.customer_name} – ${project.name}` : project.name}`
        );
        select.appendChild(label);
      });

      const shipmentFilters = prefsCache?.shipment_filters || {};
      setProjectCheckboxes(select, shipmentFilters.project_ids || [], true);
    } catch (err) {
      console.warn('Failed to load notification projects:', err);
    }
  }

  async function refreshPushStatus() {
    const statusEl = getEl('notifications-push-status');
    const pushToggle = getEl('notifications-push-enabled');

    const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window;
    if (!pushSupported) {
      setMessage(statusEl, 'Push not supported on this browser.', '#b45309');
      if (pushToggle) pushToggle.disabled = true;
      return;
    }

    if (!pushPublicKey) {
      setMessage(statusEl, 'Push keys are not configured yet.', '#b45309');
      if (pushToggle) pushToggle.disabled = true;
      return;
    }

    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      setMessage(statusEl, 'Push is enabled on this device.', 'green');
      if (pushToggle) {
        pushToggle.disabled = false;
        pushToggle.checked = true;
      }
    } else {
      setMessage(statusEl, 'Push is not enabled on this device.');
      if (pushToggle) {
        pushToggle.disabled = false;
        pushToggle.checked = false;
      }
    }
  }

  async function subscribeToPush() {
    const statusEl = getEl('notifications-push-status');
    const pushToggle = getEl('notifications-push-enabled');
    try {
      if (!pushPublicKey) {
        setMessage(statusEl, 'Push keys are not configured yet.', '#b45309');
        if (pushToggle) pushToggle.checked = false;
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setMessage(statusEl, 'Push permission was not granted.', '#b45309');
        if (pushToggle) pushToggle.checked = false;
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(pushPublicKey)
        });
      }

      const json = sub.toJSON();
      await fetchJSON('/api/notifications/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          p256dh: json.keys?.p256dh || '',
          auth: json.keys?.auth || '',
          user_agent: navigator.userAgent
        })
      });

      setMessage(statusEl, 'Push enabled for this device.', 'green');
      if (pushToggle) pushToggle.checked = true;
      await refreshPushStatus();
    } catch (err) {
      setMessage(statusEl, err.message || 'Failed to enable push.', 'crimson');
      if (pushToggle) pushToggle.checked = false;
    }
  }

  async function unsubscribeFromPush() {
    const statusEl = getEl('notifications-push-status');
    const pushToggle = getEl('notifications-push-enabled');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setMessage(statusEl, 'Push is already disabled.');
        if (pushToggle) pushToggle.checked = false;
        await refreshPushStatus();
        return;
      }

      await fetchJSON('/api/notifications/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint })
      });

      await sub.unsubscribe();
      setMessage(statusEl, 'Push disabled for this device.', 'green');
      if (pushToggle) pushToggle.checked = false;
      await refreshPushStatus();
    } catch (err) {
      setMessage(statusEl, err.message || 'Failed to disable push.', 'crimson');
    }
  }

  async function initNotificationsSection() {
    if (notificationsInitialized) return;
    notificationsInitialized = true;

    const refreshBtn = getEl('notifications-refresh');
    const markAllBtn = getEl('notifications-mark-all');
    const loadMoreBtn = getEl('notifications-load-more');
    const unreadToggle = getEl('notifications-unread-only');
    const saveBtn = getEl('notifications-save');
    const testBtn = getEl('notifications-test');
    const pushToggle = getEl('notifications-push-enabled');
    const shipmentsToggle = getEl('notifications-shipments-enabled');
    const timeToggle = getEl('notifications-time-enabled');
    const payrollToggle = getEl('notifications-payroll-enabled');

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => loadNotifications({ reset: true }));
    }
    if (markAllBtn) {
      markAllBtn.addEventListener('click', async () => {
        await markNotificationsRead({ all: true });
        await loadNotifications({ reset: true });
      });
    }
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => loadNotifications({ reset: false }));
    }
    if (unreadToggle) {
      unreadToggle.addEventListener('change', () => {
        unreadOnly = unreadToggle.checked;
        loadNotifications({ reset: true });
      });
    }
    if (saveBtn) {
      saveBtn.addEventListener('click', saveNotificationPrefs);
    }
    if (testBtn) {
      testBtn.addEventListener('click', sendTestNotification);
    }
    if (pushToggle) {
      pushToggle.addEventListener('change', async () => {
        if (pushToggle.checked) {
          await subscribeToPush();
        } else {
          await unsubscribeFromPush();
        }
      });
    }
    if (shipmentsToggle) {
      shipmentsToggle.addEventListener('change', () => {
        const container = getEl('notifications-shipment-statuses');
        const projectSelect = getEl('notifications-shipment-projects');
        setGroupDisabled(container, !shipmentsToggle.checked);
        if (projectSelect) setGroupDisabled(projectSelect, !shipmentsToggle.checked);
      });
    }
    if (timeToggle) {
      timeToggle.addEventListener('change', () => {
        setGroupDisabled(getEl('notifications-time-events'), !timeToggle.checked);
      });
    }
    if (payrollToggle) {
      payrollToggle.addEventListener('change', () => {
        setGroupDisabled(getEl('notifications-payroll-events'), !payrollToggle.checked);
      });
    }

    await loadNotificationPrefs();
    await syncNotificationPrefsQueue();
    await loadProjectsForNotifications();
  }

  window.initNotificationsSection = initNotificationsSection;
  window.markNotificationsReadOnView = markNotificationsReadOnView;
  window.addEventListener('online', () => {
    syncNotificationPrefsQueue().catch(err => {
      console.warn('Notification prefs sync failed:', err);
    });
  });
})();
