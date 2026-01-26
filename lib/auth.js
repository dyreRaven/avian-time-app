const crypto = require('crypto');

// Lightweight CSRF guard for session-backed requests
function csrfGuard(req, res, next) {
  const method = (req.method || '').toUpperCase();
  const unsafe = method && !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const hasSessionIdentity = req.session && (req.session.userId || req.session.employeeId);

  if (!hasSessionIdentity) return next();

  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.setHeader('X-CSRF-Token', req.session.csrfToken);

  if (!unsafe) return next();

  const headerToken = req.get('x-csrf-token') || req.get('x-xsrf-token');
  const tokenOk = headerToken && headerToken === req.session.csrfToken;
  if (tokenOk) {
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
function makeRequireAdminAccess(
  getAdminAccessPerms,
  getEmployeeAccessFlags = null,
  getOrgStatus = null,
  getMembershipStatus = null
) {
  return (checkPerm = null) => {
    return async (req, res, next) => {
      try {
        if (!req.session || !req.session.userId) {
          return res.status(401).json({ error: 'Not authenticated' });
        }

        const employeeId = req.session.employeeId;
        const orgId = req.session.orgId;
        if (!employeeId || !orgId) {
          return res.status(403).json({ error: 'Admin privileges required.' });
        }

        if (typeof getOrgStatus === 'function') {
          const status = await getOrgStatus(orgId);
          if (status && status !== 'active') {
            return res.status(403).json({ error: 'Org access denied.' });
          }
        }

        if (typeof getMembershipStatus === 'function') {
          const membership = await getMembershipStatus({
            userId: req.session.userId,
            orgId
          });
          const enabled =
            membership &&
            (membership.login_enabled === true ||
              membership.login_enabled === 1 ||
              membership.login_enabled === '1' ||
              membership.login_enabled === 'true');
          if (!enabled) {
            return res.status(403).json({ error: 'Admin privileges required.' });
          }
        }

        if (typeof getEmployeeAccessFlags === 'function') {
          const access = await getEmployeeAccessFlags({ employeeId, orgId });
          if (!access || !access.active || !access.desktop_access) {
            return res.status(403).json({ error: 'Admin privileges required.' });
          }
        }

        const perms = await getAdminAccessPerms({ employeeId, orgId });
        const isAdmin = perms && perms.view_payroll;

        const ok = typeof checkPerm === 'function' ? checkPerm(perms) : isAdmin;
        if (!ok) {
          return res.status(403).json({ error: 'Admin privileges required.' });
        }

        req.adminPerms = perms;
        return next();
      } catch (err) {
        console.error('requireAdminAccess error:', err);
        return res.status(500).json({ error: 'Authorization check failed.' });
      }
    };
  };
}

module.exports = { csrfGuard, requireAuth, makeRequireAdminAccess };
