// public/auth.js

const CSRF_TOKEN_KEY = 'avian_csrf_token_v1';
const DEVICE_MODE_KEY = 'avian_device_mode_v1';
const ONBOARDING_PENDING_KEY = 'avian_onboarding_pending_v1';
const LAST_ORG_ID_KEY = 'avian_last_org_id_v1';
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

function loadDeviceMode() {
  try {
    const stored = localStorage.getItem(DEVICE_MODE_KEY);
    if (stored === 'desktop' || stored === 'kiosk') return stored;
  } catch {
    // ignore storage failures
  }
  return null;
}

function storeDeviceMode(mode) {
  try {
    if (mode === 'desktop' || mode === 'kiosk') {
      localStorage.setItem(DEVICE_MODE_KEY, mode);
      return;
    }
    localStorage.removeItem(DEVICE_MODE_KEY);
  } catch {
    // ignore storage failures
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

document.addEventListener('DOMContentLoaded', async () => {
  const loginForm = document.getElementById('login-form');
  const bootstrapForm = document.getElementById('bootstrap-form');
  const orgSelect = document.getElementById('org-select');
  const orgSelectList = document.getElementById('org-select-list');
  const msgEl = document.getElementById('auth-message');
  const toggleBtn = document.getElementById('auth-toggle-btn');
  const toggleText = document.getElementById('auth-toggle-text');
  const toggleWrap = document.getElementById('auth-toggle');
  const loginEmailInput = document.getElementById('login-email');
  const loginPasswordInput = document.getElementById('login-password');
  const passwordToggleBtn = document.getElementById('password-toggle');
  const loginContinueBtn = document.getElementById('login-continue');
  const loginChangeEmailBtn = document.getElementById('login-change-email');
  const loginStepEmail = document.getElementById('login-step-email');
  const loginStepPassword = document.getElementById('login-step-password');
  const loginEmailDisplay = document.getElementById('login-email-display');
  const bootstrapEmailInput = document.getElementById('bootstrap-email');
  const bootstrapPasswordInput = document.getElementById('bootstrap-password');
  const bootstrapPasswordConfirmInput = document.getElementById('bootstrap-password-confirm');
  const bootstrapContinueBtn = document.getElementById('bootstrap-continue');
  const bootstrapStepAccount = document.getElementById('bootstrap-step-account');
  const bootstrapStepOrg = document.getElementById('bootstrap-step-org');
  const bootstrapEmailDisplay = document.getElementById('bootstrap-email-display');
  const tzSelect = document.getElementById('bootstrap-org-timezone');
  const deviceDesktopBtn = document.getElementById('auth-device-desktop');
  const deviceKioskBtn = document.getElementById('auth-device-kiosk');
  const deviceChooser = document.getElementById('auth-device');
  const headerText = document.querySelector('.auth-header-text');

  let mode = 'bootstrap';
  let bootstrapRequired = false;
  let loginStep = 'email';
  let bootstrapStep = 'account';

  function showMessage(text, color) {
    if (!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.style.color = color || '';
  }

  function setHeader(title, subtitle) {
    if (!headerText) return;
    headerText.innerHTML = '';
    if (title) {
      const h = document.createElement('h2');
      h.textContent = title;
      headerText.appendChild(h);
    }
    if (subtitle) {
      const p = document.createElement('p');
      p.textContent = subtitle;
      headerText.appendChild(p);
    }
  }

  function setStepEnabled(container, enabled) {
    if (!container) return;
    const fields = container.querySelectorAll('input, select, textarea, button');
    fields.forEach(field => {
      field.disabled = !enabled;
    });
  }

  function setBootstrapHeader() {
    if (mode !== 'bootstrap') return;
    if (bootstrapStep === 'org') {
      setHeader('Set Up Your Organization', 'Add company details and your admin profile.');
    } else {
      setHeader('Sign up');
    }
  }

  function hideOrgSelect() {
    if (orgSelect) orgSelect.classList.add('hidden');
    if (orgSelectList) orgSelectList.innerHTML = '';
  }

  function setLoginStep(step, { focus = false } = {}) {
    loginStep = step === 'password' ? 'password' : 'email';

    if (loginStepEmail) {
      loginStepEmail.classList.toggle('hidden', loginStep !== 'email');
      setStepEnabled(loginStepEmail, loginStep === 'email');
    }
    if (loginStepPassword) {
      loginStepPassword.classList.toggle('hidden', loginStep !== 'password');
      setStepEnabled(loginStepPassword, loginStep === 'password');
    }
    if (loginEmailDisplay && loginEmailInput) {
      loginEmailDisplay.textContent = loginEmailInput.value.trim();
    }

    if (focus) {
      if (loginStep === 'email' && loginEmailInput) {
        loginEmailInput.focus();
      }
      if (loginStep === 'password' && loginPasswordInput) {
        loginPasswordInput.focus();
      }
    }
  }

  function setBootstrapStep(step, { focus = false } = {}) {
    bootstrapStep = step === 'org' ? 'org' : 'account';

    if (bootstrapStepAccount) {
      bootstrapStepAccount.classList.toggle('hidden', bootstrapStep !== 'account');
      setStepEnabled(bootstrapStepAccount, bootstrapStep === 'account');
    }
    if (bootstrapStepOrg) {
      bootstrapStepOrg.classList.toggle('hidden', bootstrapStep !== 'org');
      setStepEnabled(bootstrapStepOrg, bootstrapStep === 'org');
    }
    if (bootstrapEmailDisplay && bootstrapEmailInput) {
      bootstrapEmailDisplay.textContent = bootstrapEmailInput.value.trim();
    }

    setBootstrapHeader();

    if (focus) {
      if (bootstrapStep === 'account' && bootstrapEmailInput) {
        bootstrapEmailInput.focus();
      }
      if (bootstrapStep === 'org') {
        const orgNameInput = document.getElementById('bootstrap-org-name');
        if (orgNameInput) orgNameInput.focus();
      }
    }
  }

  function advanceLoginStep() {
    if (!loginEmailInput) return;
    if (!loginEmailInput.checkValidity()) {
      loginEmailInput.reportValidity();
      return;
    }
    if (!loginEmailInput.value.trim()) {
      showMessage('Enter your email to continue.', 'red');
      loginEmailInput.focus();
      return;
    }
    showMessage('');
    setLoginStep('password', { focus: true });
  }

  function advanceBootstrapStep() {
    if (!bootstrapEmailInput || !bootstrapPasswordInput || !bootstrapPasswordConfirmInput) return;

    if (!bootstrapEmailInput.checkValidity()) {
      bootstrapEmailInput.reportValidity();
      return;
    }
    if (!bootstrapPasswordInput.checkValidity()) {
      bootstrapPasswordInput.reportValidity();
      return;
    }
    if (!bootstrapPasswordConfirmInput.checkValidity()) {
      bootstrapPasswordConfirmInput.reportValidity();
      return;
    }

    const email = bootstrapEmailInput.value.trim();
    if (!email) {
      showMessage('Enter an admin email to continue.', 'red');
      bootstrapEmailInput.focus();
      return;
    }

    if (bootstrapPasswordInput.value !== bootstrapPasswordConfirmInput.value) {
      showMessage('Passwords do not match.', 'red');
      bootstrapPasswordConfirmInput.focus();
      return;
    }

    showMessage('Creating admin account...', 'black');
    fetchJSON('/api/auth/bootstrap-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: bootstrapPasswordInput.value,
        password_confirm: bootstrapPasswordConfirmInput.value
      })
    })
      .then(data => {
        if (bootstrapEmailInput && data?.email) {
          bootstrapEmailInput.value = data.email;
        }
        showMessage('Sign up was successful. Redirecting...', 'green');
        window.location.href = '/';
      })
      .catch(err => {
        console.error('Bootstrap signup error:', err);
        showMessage(err.message || 'Sign up failed.', 'red');
      });
  }

  function setMode(newMode) {
    mode = newMode;

    if (loginForm) {
      loginForm.classList.toggle('hidden', mode !== 'login');
    }
    if (bootstrapForm) {
      bootstrapForm.classList.toggle('hidden', mode !== 'bootstrap');
    }
    if (deviceChooser) {
      const showChooser = mode === 'login' && !bootstrapRequired;
      deviceChooser.classList.toggle('hidden', !showChooser);
    }

    if (toggleText) {
      toggleText.textContent =
        mode === 'login' ? 'First time here?' : 'Already have an account?';
    }
    if (toggleBtn) {
      toggleBtn.textContent =
        mode === 'login' ? 'Create company admin' : 'Sign in';
    }

    if (mode === 'login') {
      setLoginStep('email');
      setHeader('', '');
    }
    if (mode === 'bootstrap') {
      setBootstrapStep('account');
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
  const storedDeviceMode = loadDeviceMode();
  const urlParams = new URLSearchParams(window.location.search);
  const forceDesktopParam = (urlParams.get('force_desktop') || '').toLowerCase();
  if (forceDesktopParam === '1' || forceDesktopParam === 'true') {
    requestedUiMode = 'desktop';
  } else if (storedDeviceMode === 'desktop') {
    requestedUiMode = 'desktop';
  }

  function setDeviceSelection(mode) {
    const isDesktop = mode === 'desktop';
    const isKiosk = mode === 'kiosk';
    if (deviceDesktopBtn) {
      deviceDesktopBtn.classList.toggle('is-selected', isDesktop);
      deviceDesktopBtn.setAttribute('aria-pressed', isDesktop ? 'true' : 'false');
    }
    if (deviceKioskBtn) {
      deviceKioskBtn.classList.toggle('is-selected', isKiosk);
      deviceKioskBtn.setAttribute('aria-pressed', isKiosk ? 'true' : 'false');
    }
  }

  async function setUiModeAndRedirect(forcedMode = null) {
    const mode = forcedMode || requestedUiMode || (isTabletDevice() ? 'kiosk' : 'desktop');
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
      storeLastOrgId(orgId);
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

  if (deviceDesktopBtn) {
    deviceDesktopBtn.addEventListener('click', () => {
      storeDeviceMode('desktop');
      requestedUiMode = 'desktop';
      setDeviceSelection('desktop');
    });
  }

  if (deviceKioskBtn) {
    deviceKioskBtn.addEventListener('click', () => {
      storeDeviceMode('kiosk');
      setDeviceSelection('kiosk');
      window.location.href = '/kiosk';
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

  if (bootstrapContinueBtn) {
    bootstrapContinueBtn.addEventListener('click', advanceBootstrapStep);
  }

  if (loginContinueBtn) {
    loginContinueBtn.addEventListener('click', advanceLoginStep);
  }

  if (loginChangeEmailBtn) {
    loginChangeEmailBtn.addEventListener('click', () => {
      setLoginStep('email', { focus: true });
      showMessage('');
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async evt => {
      evt.preventDefault();

      if (loginStep !== 'password') {
        advanceLoginStep();
        return;
      }

      const email = loginEmailInput?.value || '';
      const password = document.getElementById('login-password')?.value || '';
      const remember = document.getElementById('login-remember')?.checked || false;

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

        if (data.requires_org_setup) {
          bootstrapRequired = true;
          showMessage('Sign in successful. Redirecting...', 'green');
          setOnboardingPending(null);
          window.location.href = '/';
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

      if (bootstrapStep !== 'org') {
        advanceBootstrapStep();
        return;
      }

      const orgName = document.getElementById('bootstrap-org-name')?.value || '';
      const orgTimezone =
        document.getElementById('bootstrap-org-timezone')?.value || '';
      const adminFirst =
        document.getElementById('bootstrap-admin-first-name')?.value || '';
      const adminLast =
        document.getElementById('bootstrap-admin-last-name')?.value || '';
      const adminName = [adminFirst, adminLast].filter(Boolean).join(' ').trim();

      if (!adminName) {
        showMessage('Admin first and last name are required.', 'red');
        return;
      }

      showMessage('Creating organization...', 'black');

      try {
        const data = await fetchJSON('/api/auth/bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            org_name: orgName,
            org_timezone: orgTimezone,
            admin_name: adminName
          })
        });

        showMessage('Bootstrap complete. Redirecting...', 'green');
        setOnboardingPending(data?.orgId);
        requestedUiMode = 'desktop';
        await setUiModeAndRedirect('desktop');
      } catch (err) {
        console.error('Bootstrap error:', err);
        showMessage(err.message || 'Bootstrap failed.', 'red');
      }
    });
  }

  buildTimezoneOptions();
  setDeviceSelection(storedDeviceMode);
  setMode('bootstrap');

  try {
    const status = await fetchJSON('/api/auth/bootstrap-status');
    bootstrapRequired = !!status?.bootstrap_required;
    const bootstrapAccountReady = !!status?.bootstrap_account_created;
    const bootstrapEmail = status?.bootstrap_email || '';
    if (toggleWrap) {
      toggleWrap.classList.toggle('hidden', bootstrapRequired && !bootstrapAccountReady);
    }
    if (bootstrapRequired) {
      if (deviceChooser) deviceChooser.classList.add('hidden');
      if (bootstrapEmailInput && bootstrapEmail) {
        bootstrapEmailInput.value = bootstrapEmail;
      }
      if (bootstrapEmail) {
        setOnboardingPending(null);
        window.location.href = '/';
        return;
      } else if (bootstrapAccountReady) {
        setMode('login');
        setLoginStep('email');
        setHeader('Sign In', 'Sign in to finish setting up your company.');
      } else {
        setMode('bootstrap');
        setBootstrapStep('account');
      }
      return;
    }
  } catch (err) {
    console.warn('Failed to check bootstrap status:', err?.message || err);
  }

  setHeader('', '');
  setMode('login');
});
