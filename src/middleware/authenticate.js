const crypto = require('crypto');
const userModel = require('../models/user.model');
const { recordAudit } = require('../services/audit.service');

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes of inactivity

function computeUserAgentHash(req) {
  const ua = String(req.headers['user-agent'] || 'none').trim();
  return crypto.createHash('sha256').update(ua).digest('hex').slice(0, 32);
}

async function authenticate(req, res, next) {
  const isApi = req.originalUrl.startsWith('/api/');
  const sessUser = req.session && req.session.user;

  if (!sessUser || !sessUser.id) {
    if (isApi) {
      return res.status(401).json({ ok: false, error: 'Authentication required. Please sign in.' });
    }
    return res.redirect('/login');
  }

  // Enforce User-Agent fingerprint binding against session cookie hijacking
  const currentUaHash = computeUserAgentHash(req);
  if (req.session.uaHash && req.session.uaHash !== currentUaHash) {
    const uid = sessUser.id;
    const role = sessUser.role || '';
    await recordAudit({
      actorUserId: uid,
      actorRole: role,
      action: 'SESSION_HIJACK_BLOCKED',
      targetType: 'session',
      targetId: String(uid),
      ipAddress: req.ip,
    });
    return req.session.destroy(() => {
      if (isApi) {
        return res
          .status(401)
          .json({ ok: false, error: 'Session security check failed. Please sign in again.' });
      }
      return res.redirect('/login?error=session_expired');
    });
  }

  // Enforce rolling idle session timeout (30 minutes)
  const now = Date.now();
  if (req.session.lastActivityAt && now - Number(req.session.lastActivityAt) > IDLE_TIMEOUT_MS) {
    return req.session.destroy(() => {
      if (isApi) {
        return res
          .status(401)
          .json({ ok: false, error: 'Your session expired due to inactivity. Please sign in again.' });
      }
      return res.redirect('/login?error=session_expired');
    });
  }

  // Always re-verify status & role from the trusted local database
  const freshRow = await userModel.findById(sessUser.id);
  if (!freshRow || freshRow.status !== 'active' || !freshRow.role) {
    return req.session.destroy(() => {
      if (isApi) {
        return res.status(403).json({
          ok: false,
          error: 'Your account is inactive or lacks an approved school role.',
        });
      }
      return res.redirect('/login?error=account_disabled');
    });
  }

  req.session.lastActivityAt = now;
  const safeUser = userModel.toSafeSessionUser(freshRow);
  req.user = safeUser;
  req.session.user = safeUser;
  return next();
}

module.exports = { authenticate, computeUserAgentHash, IDLE_TIMEOUT_MS };
