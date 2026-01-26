// public/auth.js

const CSRF_TOKEN_KEY = 'avian_csrf_token_v1';
let csrfToken = null;

function loadCsrfToken() {
  if (csrfToken) return csrfToken;
  try {
    const stored = localStorage.getItem(CSRF_TOKEN_KEY);
    if (stored) csrfToken = stored;
  } catch {
    // ignore storage failures
  }
  return csrfToken;
}

function storeCsrfToken(token) {
  if (!token) return;
  csrfToken = token;
  try {
    localStorage.setItem(CSRF_TOKEN_KEY, token);
  } catch {
    // ignore storage failures
  }
}

// Local JSON helper (does not depend on utils.js)
const fetchJSON = async (url, options = {}) => {
  const opts = Object.assign({ credentials: 'same-origin' }, options);
  const method = (opts.method || 'GET').toUpperCase();
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const headers = new Headers(opts.headers || {});
  const token = loadCsrfToken();
  if (unsafe && token && !headers.get('X-CSRF-Token')) {
    headers.set('X-CSRF-Token', token);
  }
  opts.headers = headers;

  const res = await fetch(url, opts);
  const nextToken = res.headers.get('X-CSRF-Token');
  if (nextToken) storeCsrfToken(nextToken);
  let data = {};
  try {
    data = await res.json();
  } catch (e) {
    data = {};
  }
  if (!res.ok) {
    const msg = data.error || data.message || 'Request failed';
    throw new Error(msg);
  }
  return data;
};

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('login-form');
  const bootstrapForm = document.getElementById('bootstrap-form');
  const orgSelect = document.getElementById('org-select');
  const orgSelectList = document.getElementById('org-select-list');
  const msgEl = document.getElementById('auth-message');
  const toggleBtn = document.getElementById('auth-toggle-btn');
  const toggleText = document.getElementById('auth-toggle-text');
  const loginPasswordInput = document.getElementById('login-password');
  const passwordToggleBtn = document.getElementById('password-toggle');
  const tzSelect = document.getElementById('bootstrap-org-timezone');

  let mode = 'login';

  function showMessage(text, color) {
    if (!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.style.color = color || '';
  }

  function hideOrgSelect() {
    if (orgSelect) orgSelect.classList.add('hidden');
    if (orgSelectList) orgSelectList.innerHTML = '';
  }

  function setMode(newMode) {
    mode = newMode;

    if (loginForm) {
      loginForm.classList.toggle('hidden', mode !== 'login');
    }
    if (bootstrapForm) {
      bootstrapForm.classList.toggle('hidden', mode !== 'bootstrap');
    }

    if (toggleText) {
      toggleText.textContent =
        mode === 'login' ? 'First time here?' : 'Already have an account?';
    }
    if (toggleBtn) {
      toggleBtn.textContent =
        mode === 'login' ? 'Create company admin' : 'Sign in';
    }

    hideOrgSelect();
    showMessage('');
  }

  function buildTimezoneOptions() {
    if (!tzSelect) return;
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

    tzSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select timezone';
    placeholder.disabled = true;
    placeholder.selected = true;
    tzSelect.appendChild(placeholder);

    zones.forEach(zone => {
      const option = document.createElement('option');
      option.value = zone;
      option.textContent = zone;
      tzSelect.appendChild(option);
    });

    if (zones.includes(defaultTz)) {
      tzSelect.value = defaultTz;
    } else if (zones.length > 0) {
      tzSelect.value = zones[0];
    }
  }

  function isTabletDevice() {
    const hasTouch =
      'ontouchstart' in window ||
      (navigator && navigator.maxTouchPoints > 0);
    const width = Math.min(window.innerWidth || 0, window.innerHeight || 0);
    return hasTouch && width > 0 && width <= 1024;
  }

  let requestedUiMode = null;
  const urlParams = new URLSearchParams(window.location.search);
  const forceDesktopParam = (urlParams.get('force_desktop') || '').toLowerCase();
  if (forceDesktopParam === '1' || forceDesktopParam === 'true') {
    requestedUiMode = 'desktop';
    const forceDesktopEl = document.getElementById('login-force-desktop');
    if (forceDesktopEl) forceDesktopEl.checked = true;
  }

  async function setUiModeAndRedirect() {
    const mode = requestedUiMode || (isTabletDevice() ? 'kiosk' : 'desktop');
    try {
      await fetchJSON('/api/auth/ui-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode })
      });
    } catch (err) {
      console.warn('Failed to set UI mode:', err.message || err);
    }

    const target = mode === 'kiosk' ? '/kiosk' : '/';
    window.location.href = target;
  }

  async function handleOrgSelection(orgId) {
    try {
      showMessage('Selecting organization...', 'black');
      await fetchJSON('/api/auth/select-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId })
      });
      showMessage('Signed in. Redirecting...', 'green');
      await setUiModeAndRedirect();
    } catch (err) {
      console.error('Select org error:', err);
      showMessage(err.message || 'Failed to select organization.', 'red');
    }
  }

  function renderOrgSelect(orgs) {
    if (!orgSelect || !orgSelectList) return;

    orgSelectList.innerHTML = '';
    orgs.forEach(org => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn secondary w-full';
      button.textContent = `${org.name} (${org.timezone})`;
      button.addEventListener('click', () => handleOrgSelection(org.id));
      orgSelectList.appendChild(button);
    });

    if (loginForm) loginForm.classList.add('hidden');
    if (bootstrapForm) bootstrapForm.classList.add('hidden');
    orgSelect.classList.remove('hidden');
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      setMode(mode === 'login' ? 'bootstrap' : 'login');
    });
  }

  if (passwordToggleBtn && loginPasswordInput) {
    passwordToggleBtn.addEventListener('click', () => {
      const isHidden = loginPasswordInput.type === 'password';
      loginPasswordInput.type = isHidden ? 'text' : 'password';
      passwordToggleBtn.setAttribute('aria-pressed', isHidden ? 'true' : 'false');
      passwordToggleBtn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async evt => {
      evt.preventDefault();

      const email = document.getElementById('login-email')?.value || '';
      const password = document.getElementById('login-password')?.value || '';
      const remember = document.getElementById('login-remember')?.checked || false;
      const forceDesktop =
        document.getElementById('login-force-desktop')?.checked || false;
      requestedUiMode = forceDesktop ? 'desktop' : null;

      showMessage('Signing in...', 'black');

      try {
        const data = await fetchJSON('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, remember })
        });

        if (data.requires_org_selection && Array.isArray(data.orgs)) {
          showMessage('Select your organization.', 'black');
          renderOrgSelect(data.orgs);
          return;
        }

        showMessage('Signed in. Redirecting...', 'green');
        await setUiModeAndRedirect();
      } catch (err) {
        console.error('Login error:', err);
        showMessage(err.message || 'Failed to sign in.', 'red');
      }
    });
  }

  if (bootstrapForm) {
    bootstrapForm.addEventListener('submit', async evt => {
      evt.preventDefault();

      const orgName = document.getElementById('bootstrap-org-name')?.value || '';
      const orgTimezone =
        document.getElementById('bootstrap-org-timezone')?.value || '';
      const adminFirst =
        document.getElementById('bootstrap-admin-first-name')?.value || '';
      const adminLast =
        document.getElementById('bootstrap-admin-last-name')?.value || '';
      const adminName = [adminFirst, adminLast].filter(Boolean).join(' ').trim();
      const email = document.getElementById('bootstrap-email')?.value || '';
      const password =
        document.getElementById('bootstrap-password')?.value || '';
      const passwordConfirm =
        document.getElementById('bootstrap-password-confirm')?.value || '';

      if (!adminName) {
        showMessage('Admin first and last name are required.', 'red');
        return;
      }

      if (password !== passwordConfirm) {
        showMessage('Passwords do not match.', 'red');
        return;
      }

      showMessage('Creating organization...', 'black');

      try {
        await fetchJSON('/api/auth/bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            org_name: orgName,
            org_timezone: orgTimezone,
            admin_name: adminName,
            email,
            password
          })
        });

        showMessage('Bootstrap complete. Redirecting...', 'green');
        await setUiModeAndRedirect();
      } catch (err) {
        console.error('Bootstrap error:', err);
        showMessage(err.message || 'Bootstrap failed.', 'red');
      }
    });
  }

  buildTimezoneOptions();
  setMode('login');
});
