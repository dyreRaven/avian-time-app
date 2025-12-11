// public/auth.js

// Local JSON helper (does not depend on utils.js)
const fetchJSON = async (url, options = {}) => {
  const res = await fetch(url, options);
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
  const registerForm = document.getElementById('register-form');
  const msgEl = document.getElementById('auth-message');
  const toggleBtn = document.getElementById('auth-toggle-btn');
  const toggleText = document.getElementById('auth-toggle-text');
  const loginPasswordInput = document.getElementById('login-password');
  const passwordToggleBtn = document.getElementById('password-toggle');
  const urlParams = new URLSearchParams(window.location.search);

  // Confirm modal elements
  const confirmModal = document.getElementById('register-confirm-modal');
  const confirmText = document.getElementById('confirm-employee-text');
  const confirmYes = document.getElementById('confirm-employee-yes');
  const confirmNo = document.getElementById('confirm-employee-no');

  let mode = 'login'; // or 'register'
  let pendingUserId = null;
  let pendingEmployee = null;

  function getRedirectTarget() {
    const nextRaw = urlParams.get('next');
    if (nextRaw) {
      try {
        const nextUrl = new URL(nextRaw, window.location.origin);
        if (nextUrl.origin === window.location.origin) {
          return nextUrl.pathname + nextUrl.search + nextUrl.hash;
        }
      } catch (e) {
        console.warn('Ignoring invalid redirect target:', nextRaw);
      }
    }

    const prefersTouch =
      (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
      /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent || '');

    return prefersTouch ? '/kiosk' : '/';
  }

  function redirectAfterAuth() {
    window.location.href = getRedirectTarget();
  }

  function setMode(newMode) {
    mode = newMode;

    if (!loginForm || !registerForm) return;

    if (mode === 'login') {
      loginForm.classList.remove('hidden');
      registerForm.classList.add('hidden');
      if (toggleText) toggleText.textContent = "Don’t have an account?";
      if (toggleBtn) toggleBtn.textContent = 'Create one';
    } else {
      loginForm.classList.add('hidden');
      registerForm.classList.remove('hidden');
      if (toggleText) toggleText.textContent = 'Already have an account?';
      if (toggleBtn) toggleBtn.textContent = 'Sign in';
    }

    if (msgEl) {
      msgEl.textContent = '';
      msgEl.style.color = '';
    }

    if (confirmModal) {
      confirmModal.classList.add('hidden');
    }
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      setMode(mode === 'login' ? 'register' : 'login');
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

function openConfirmModal(userId, employee) {
  pendingUserId = userId;
  pendingEmployee = employee;

  if (!confirmModal || !confirmText) return;

  const name =
    employee.name_on_checks || employee.name || employee.email || 'Unknown';

  // Only show name (and email if present) – no rate
  confirmText.textContent = [
    `Name: ${name}`,
    employee.email ? `Email: ${employee.email}` : null
  ]
    .filter(Boolean)
    .join(' \u00b7 '); // · separator

  confirmModal.classList.remove('hidden');
}


  // Sign in submit
  if (loginForm) {
  loginForm.addEventListener('submit', async evt => {
    evt.preventDefault();
    if (!msgEl) return;

    msgEl.textContent = 'Signing in...';
    msgEl.style.color = 'black';

    const email = document.getElementById('login-email')?.value || '';
    const password =
      document.getElementById('login-password')?.value || '';
    const remember =
      document.getElementById('login-remember')?.checked || false;

    try {
      await fetchJSON('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, remember })
      });

      msgEl.textContent = 'Signed in. Redirecting...';
      msgEl.style.color = 'green';

      redirectAfterAuth();
    } catch (err) {
      console.error('Login error:', err);
      msgEl.textContent = err.message || 'Failed to sign in.';
      msgEl.style.color = 'red';
    }
  });
}

  // Register submit
  if (registerForm) {
    registerForm.addEventListener('submit', async evt => {
      evt.preventDefault();
      if (!msgEl) return;

      msgEl.textContent = 'Creating account...';
      msgEl.style.color = 'black';

      const email = document.getElementById('register-email')?.value || '';
      const password =
        document.getElementById('register-password')?.value || '';
      const password2 =
        document.getElementById('register-password-confirm')?.value || '';

      if (password !== password2) {
        msgEl.textContent = 'Passwords do not match.';
        msgEl.style.color = 'red';
        return;
      }

      try {
        const data = await fetchJSON('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });

        if (data.candidateEmployee) {
          msgEl.textContent =
            'Account created. We found a matching employee in QuickBooks.';
          msgEl.style.color = 'black';
          openConfirmModal(data.userId, data.candidateEmployee);
        } else {
          msgEl.textContent =
            'Account created, but we could not find a matching employee in QuickBooks. ' +
            'Please speak with whoever manages QuickBooks for your company.';
          msgEl.style.color = 'orange';
          // Still let them into the app
          redirectAfterAuth();
        }
      } catch (err) {
        console.error('Register error:', err);
        msgEl.textContent = err.message || 'Failed to create account.';
        msgEl.style.color = 'red';
      }
    });
  }

  // Confirm "Yes, that's me"
  if (confirmYes) {
    confirmYes.addEventListener('click', async () => {
      if (!pendingUserId || !pendingEmployee || !msgEl) return;

      try {
        msgEl.textContent = 'Linking your account to this employee record...';
        msgEl.style.color = 'black';

        const data = await fetchJSON('/api/auth/link-employee', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: pendingUserId,
            employeeId: pendingEmployee.id
          })
        });

        const emp = data.linkedEmployee || pendingEmployee;
        const name =
          emp.name_on_checks || emp.name || emp.email || 'your employee record';

        msgEl.textContent = `Linked to “${name}”. Redirecting…`;
        msgEl.style.color = 'green';

        if (confirmModal) confirmModal.classList.add('hidden');

        redirectAfterAuth();
      } catch (err) {
        console.error('Link employee error:', err);
        msgEl.textContent =
          err.message || 'Failed to link employee. You can try again later.';
        msgEl.style.color = 'red';
      }
    });
  }

  // Confirm "No, that's not me"
// Confirm "No, that's not me"
if (confirmNo) {
  confirmNo.addEventListener('click', async () => {
    if (!pendingUserId) {
      if (confirmModal) confirmModal.classList.add('hidden');
      return;
    }

    try {
      if (msgEl) {
        msgEl.textContent = 'Cancelling registration…';
        msgEl.style.color = 'black';
      }

      await fetchJSON('/api/auth/cancel-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: pendingUserId })
      });

      if (confirmModal) confirmModal.classList.add('hidden');
      pendingUserId = null;
      pendingEmployee = null;

      if (msgEl) {
        msgEl.textContent =
          'We did not create an account because this QuickBooks employee is not you. ' +
          'Please speak with your QuickBooks administrator to get your email added, then try again.';
        msgEl.style.color = 'orange';
      }

      // Optional: you can redirect to "/" if you want:
      // window.location.href = '/';
    } catch (err) {
      console.error('Cancel registration error:', err);
      if (msgEl) {
        msgEl.textContent =
          err.message || 'Failed to cancel registration. Please try again.';
        msgEl.style.color = 'red';
      }
    }
  });
}

});
