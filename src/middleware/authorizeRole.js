const { recordAudit } = require('../services/audit.service');
const { dashboardPathForRole } = require('../models/user.model');
const { escapeHtml } = require('./errorHandler');

function authorizeRole(...allowedRoles) {
  return async function roleGuard(req, res, next) {
    const isApi = req.originalUrl.startsWith('/api/');
    if (!req.user || !req.user.role) {
      if (isApi) {
        return res.status(401).json({ ok: false, error: 'Authentication required.' });
      }
      return res.redirect('/login');
    }

    if (!allowedRoles.includes(req.user.role)) {
      await recordAudit({
        actorUserId: req.user.id,
        actorRole: req.user.role,
        action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
        targetType: 'route',
        targetId: `${req.method} ${req.originalUrl}`,
        ipAddress: req.ip,
        metadata: { requiredRoles: allowedRoles },
      });

      if (isApi) {
        return res.status(403).json({
          ok: false,
          error: 'Access denied: your role does not have permission for this resource.',
        });
      }

      const ownDashboard = dashboardPathForRole(req.user.role);
      return res.status(403).send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>403 Access Denied</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/css/styles.css"></head>
<body class="centered-shell">
  <div class="card status-card">
    <div class="badge badge-danger">403 Forbidden</div>
    <h1>Access Restricted</h1>
    <p>Signed in as <strong>${escapeHtml(req.user.fullName)}</strong> (${escapeHtml(req.user.roleName)}). Your account does not have permission to open this dashboard.</p>
    <div style="display:flex;gap:10px;justify-content:center;margin-top:18px;">
      <a href="${escapeHtml(ownDashboard)}" class="btn btn-primary">Go to My Dashboard</a>
    </div>
  </div>
</body></html>`);
    }

    return next();
  };
}

module.exports = { authorizeRole };
