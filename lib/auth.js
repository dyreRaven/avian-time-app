const crypto = require('crypto');

// Lightweight CSRF guard for session-backed requests
function csrfGuard(req, res, next) {
  if (req.session && !req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  if (req.session && req.session.csrfToken) {
    res.setHeader('X-CSRF-Token', req.session.csrfToken);
  }

  const method = (req.method || '').toUpperCase();
  const unsafe = method && !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const hasSessionIdentity = req.session && (req.session.userId || req.session.employeeId);

  if (!unsafe || !hasSessionIdentity) return next();

  const headerToken = req.get('x-csrf-token') || req.get('x-xsrf-token');
  const tokenOk = headerToken && req.session && headerToken === req.session.csrfToken;

  const origin = (req.get('origin') || req.get('referer') || '').toLowerCase();
  const host = (req.get('host') || '').toLowerCase();
  const originOk =
    origin &&
    host &&
    (origin.startsWith(`https://${host}`) || origin.startsWith(`http://${host}`));

  if (tokenOk || originOk) {
    return next();
  }

  return res.status(403).json({ error: 'CSRF validation failed.' });
}

// Require a logged-in session
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// Factory so we can inject access-check implementation
function makeRequireAdminAccess(getAdminAccessPerms) {
  return (checkPerm = null) => {
    return async (req, res, next) => {
      try {
        if (!req.session || !req.session.userId) {
          return res.status(401).json({ error: 'Not authenticated' });
        }

        const employeeId = req.session.employeeId;
        if (!employeeId) {
          return res.status(403).json({ error: 'Admin privileges required.' });
        }

        const perms = await getAdminAccessPerms(employeeId);
        const isAdmin = perms && perms.view_payroll;

        const ok = typeof checkPerm === 'function' ? checkPerm(perms) : isAdmin;
        if (!ok) {
          return res.status(403).json({ error: 'Admin privileges required.' });
        }

        return next();
      } catch (err) {
        console.error('requireAdminAccess error:', err);
        return res.status(500).json({ error: 'Authorization check failed.' });
      }
    };
  };
}

module.exports = { csrfGuard, requireAuth, makeRequireAdminAccess };
