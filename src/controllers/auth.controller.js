const path = require('path');
const crypto = require('crypto');
const env = require('../config/environment');
const db = require('../config/database');
const userModel = require('../models/user.model');
const authService = require('../services/auth.service');
const accountLinkingService = require('../services/accountLinking.service');
const { recordAudit } = require('../services/audit.service');
const {
  configureGooglePassport,
  resolveGoogleOAuthSettings,
} = require('../config/googleOAuth');
const { AppError } = require('../middleware/errorHandler');
const { generateCsrfToken, isSameOrigin } = require('../middleware/csrfProtection');
const { applySessionCookiePolicy } = require('../middleware/securityHeaders');
const { computeUserAgentHash } = require('../middleware/authenticate');
const { uploadAvatar } = require('../config/upload');
const profileService = require('../services/profile.service');
const { signSessionId } = require('../utils/sessionToken');
const {
  requireString,
  optionalString,
  requireEmail,
  optionalPositiveInt,
  requireStrongPassword,
} = require('../validators/schemas');

const OAUTH_STATE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const HANDOFF_TTL_MS = 90 * 1000; // 90 seconds

function regenerateSessionWithUser(req, user) {
  const uaHash = computeUserAgentHash(req);
  const now = Date.now();
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.user = user;
      req.session.csrfToken = generateCsrfToken();
      req.session.uaHash = uaHash;
      req.session.issuedAt = now;
      req.session.lastActivityAt = now;
      applySessionCookiePolicy(req);
      req.session.save((saveErr) => {
        if (saveErr) return reject(saveErr);
        return resolve();
      });
    });
  });
}

function safeRelativePath(targetUrl) {
  const str = String(targetUrl || '/login').trim();
  if (!str.startsWith('/') || str.startsWith('//')) {
    return '/login';
  }
  return str;
}

function finishOAuthRedirect(res, targetUrl, usePopup = false, handoffToken = '') {
  const safeTarget = safeRelativePath(targetUrl);
  if (usePopup) {
    const qs = new URLSearchParams({ target: safeTarget });
    if (handoffToken) qs.set('handoff', handoffToken);
    return res.redirect(`/auth/google/popup-complete?${qs.toString()}`);
  }
  return res.redirect(safeTarget);
}

function signStateNonce(nonce) {
  return crypto
    .createHmac('sha256', env.session.secret)
    .update(String(nonce))
    .digest('hex')
    .slice(0, 28);
}

function verifySignedStateFormat(stateToken) {
  const raw = String(stateToken || '').trim();
  const dotIdx = raw.indexOf('.');
  if (dotIdx <= 0) return false;
  const nonce = raw.slice(0, dotIdx);
  const gotSig = raw.slice(dotIdx + 1);
  const expSig = signStateNonce(nonce);
  const expBuf = Buffer.from(expSig, 'utf8');
  const gotBuf = Buffer.from(gotSig, 'utf8');
  return expBuf.length === gotBuf.length && crypto.timingSafeEqual(expBuf, gotBuf);
}

async function createOAuthStateRecord({
  intent = 'login',
  usePopup = false,
  linkUserId = null,
  regMeta = null,
}) {
  const now = Date.now();
  await db.run('DELETE FROM oauth_states WHERE expires_at < ?', [now - 60_000]);

  const nonce = crypto.randomBytes(20).toString('hex');
  const stateToken = `${nonce}.${signStateNonce(nonce)}`;
  await db.run(
    `INSERT INTO oauth_states
     (state_token, intent, use_popup, link_user_id, reg_meta_json, consumed, expires_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
    [
      stateToken,
      intent,
      usePopup ? 1 : 0,
      linkUserId || null,
      regMeta ? JSON.stringify(regMeta) : null,
      now + OAUTH_STATE_TTL_MS,
    ]
  );
  return stateToken;
}

function parseStateRecord(row) {
  if (!row) return null;
  let regMeta = null;
  if (row.reg_meta_json) {
    try {
      regMeta = JSON.parse(row.reg_meta_json);
    } catch (_) {
      regMeta = null;
    }
  }
  return {
    stateToken: row.state_token,
    intent: row.intent || 'login',
    usePopup: Boolean(row.use_popup),
    linkUserId: row.link_user_id || null,
    regMeta,
  };
}

async function peekValidOAuthState(stateToken) {
  if (!verifySignedStateFormat(stateToken)) return null;
  const row = await db.get(
    'SELECT * FROM oauth_states WHERE state_token = ? AND consumed = 0 AND expires_at > ?',
    [String(stateToken).trim(), Date.now()]
  );
  return parseStateRecord(row);
}

async function consumeValidOAuthState(stateToken) {
  if (!verifySignedStateFormat(stateToken)) return null;
  const cleanToken = String(stateToken).trim();
  const now = Date.now();
  const row = await db.get(
    'SELECT * FROM oauth_states WHERE state_token = ? AND consumed = 0 AND expires_at > ?',
    [cleanToken, now]
  );
  if (!row) return null;

  const upd = await db.run(
    'UPDATE oauth_states SET consumed = 1 WHERE state_token = ? AND consumed = 0',
    [cleanToken]
  );
  if (!upd.affectedRows) return null;

  return parseStateRecord(row);
}

async function issuePopupHandoffToken(stateToken, userId, redirectTo) {
  const rawHandoff = crypto.randomBytes(24).toString('hex');
  const handoffHash = crypto.createHash('sha256').update(rawHandoff).digest('hex');
  await db.run(
    `UPDATE oauth_states
     SET handoff_token_hash = ?,
         handoff_user_id = ?,
         handoff_redirect_to = ?,
         handoff_consumed = 0,
         handoff_expires_at = ?
     WHERE state_token = ?`,
    [handoffHash, userId, redirectTo, Date.now() + HANDOFF_TTL_MS, stateToken]
  );
  return rawHandoff;
}

async function getSessionStatus(req, res) {
  const [settings, registrationClasses, oauthCfg] = await Promise.all([
    db.get(
      'SELECT school_name, school_code, motto, currency_code, currency_symbol, timezone, student_fee_portal_enabled FROM school_settings WHERE id = 1'
    ),
    db.query("SELECT id, name FROM classes WHERE status = 'active' ORDER BY level_order ASC, name ASC"),
    resolveGoogleOAuthSettings(req),
  ]);
  const sessUser =
    req.session && req.session.user ? await userModel.findById(req.session.user.id) : null;
  const activeUser =
    sessUser && sessUser.status === 'active' && sessUser.role
      ? userModel.toSafeSessionUser(sessUser)
      : null;

  await new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });

  return res.json({
    ok: true,
    csrfToken: req.session.csrfToken,
    sessionToken: signSessionId(req.sessionID),
    authenticated: Boolean(activeUser),
    user: activeUser,
    redirectTo: activeUser ? userModel.dashboardPathForRole(activeUser.role) : '/login',
    googleAuthEnabled: oauthCfg.isAvailable,
    googleAuthMode: oauthCfg.mode,
    registrationClasses: registrationClasses || [],
    school: settings || {
      school_name: 'School Management System',
      currency_code: env.defaults.currencyCode,
      currency_symbol: env.defaults.currencySymbol,
    },
  });
}

async function login(req, res) {
  const identifier = requireString(req.body.identifier, 'Email or username', { min: 2, max: 160 });
  const password = requireString(req.body.password, 'Password', { min: 1, max: 200 });

  const { user, redirectTo } = await authService.loginWithPassword({
    identifier,
    password,
    ipAddress: req.ip,
  });

  await regenerateSessionWithUser(req, user);

  return res.json({
    ok: true,
    user,
    csrfToken: req.session.csrfToken,
    sessionToken: signSessionId(req.sessionID),
    redirectTo,
  });
}

async function logout(req, res) {
  const actor = req.session && req.session.user;
  if (actor) {
    await recordAudit({
      actorUserId: actor.id,
      actorRole: actor.role || '',
      action: 'LOGOUT',
      targetType: 'user',
      targetId: String(actor.id),
      ipAddress: req.ip,
    });
  }
  req.session.destroy(() => {
    res.clearCookie(env.session.cookieName, {
      httpOnly: true,
      path: '/',
    });
    if (req.originalUrl.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
      return res.json({ ok: true, redirectTo: '/login' });
    }
    return res.redirect('/login');
  });
}

async function requestReset(req, res) {
  const email = requireEmail(req.body.email);
  await authService.requestPasswordReset({ email, ipAddress: req.ip });

  return res.json({
    ok: true,
    message:
      'If an active school account matches that email, a one-time password reset code has been dispatched through School Administration.',
  });
}

// ---------------- Profile Photo ----------------
async function uploadOwnAvatar(req, res) {
  const result = await profileService.setUserAvatar({
    actor: req.user,
    targetUserId: req.user.id,
    file: req.file,
    ipAddress: req.ip,
  });
  return res.json(result);
}

async function removeOwnAvatar(req, res) {
  const result = await profileService.clearUserAvatar({
    actor: req.user,
    targetUserId: req.user.id,
    ipAddress: req.ip,
  });
  return res.json(result);
}

async function confirmReset(req, res) {
  const email = requireEmail(req.body.email);
  const resetCode = requireString(req.body.resetCode, 'Reset code', { min: 4, max: 32 });
  const newPassword = requireString(req.body.newPassword, 'New password', { min: 8, max: 160 });

  await authService.confirmPasswordReset({
    email,
    resetCode,
    newPassword,
    ipAddress: req.ip,
  });

  return res.json({
    ok: true,
    message: 'Password updated successfully. You may now sign in.',
  });
}

async function changePassword(req, res) {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = requireString(req.body.newPassword, 'New password', { min: 8, max: 160 });

  await authService.changeOwnPassword({
    userId: req.user.id,
    currentPassword,
    newPassword,
    currentSessionId: req.sessionID,
    ipAddress: req.ip,
  });

  req.session.csrfToken = generateCsrfToken();

  return res.json({
    ok: true,
    csrfToken: req.session.csrfToken,
    message: 'Password changed successfully. Other active sessions have been signed out.',
  });
}

async function registerStudent(req, res) {
  // Strictly student-only join proposals; Teachers & Financial accounts are provisioned solely by Superadmin
  if (req.body.role && String(req.body.role).trim().toLowerCase() !== 'student') {
    throw new AppError(
      403,
      'Self-registration is strictly limited to students. Teacher and financial staff accounts are created solely by the Superadmin.'
    );
  }

  const firstName = requireString(req.body.firstName, 'First name', { min: 2, max: 80 });
  const lastName = requireString(req.body.lastName, 'Last name', { min: 2, max: 80 });
  const email = requireEmail(req.body.email);
  const password = requireStrongPassword(req.body.password, 'Password');
  const requestedClassId = optionalPositiveInt(req.body.requestedClassId);
  const gender = optionalString(req.body.gender, 20);
  const dateOfBirth = optionalString(req.body.dateOfBirth, 20);
  const guardianName = optionalString(req.body.guardianName, 140);
  const guardianPhone = optionalString(req.body.guardianPhone, 50);
  const phone = optionalString(req.body.phone, 50);

  const created = await authService.submitStudentJoinRequest({
    firstName,
    lastName,
    email,
    phone,
    gender,
    dateOfBirth,
    requestedClassId,
    guardianName,
    guardianPhone,
    password,
    acceptTerms: req.body.acceptTerms,
    ipAddress: req.ip,
  });

  return res.status(201).json({
    ok: true,
    id: created.id,
    status: created.status,
    message:
      'Your student account proposal has been submitted to the Superadmin. Once accepted, you can log in with your email and password.',
  });
}

async function completeGoogleIdentityFlow({
  req,
  res,
  stateToken,
  googleProfile,
  linkUserId = null,
  intent = 'login',
  regMeta = null,
  usePopup = false,
}) {
  // Student-only Google Sign-Up Proposal flow
  if (intent === 'register' && !linkUserId) {
    const existingOutcome = await accountLinkingService.resolveOrLinkGoogleAccount({
      ...googleProfile,
      linkToAuthenticatedUserId: null,
      ipAddress: req.ip,
    });
    if (existingOutcome.ok) {
      await regenerateSessionWithUser(req, existingOutcome.user);
      const target = userModel.dashboardPathForRole(existingOutcome.user.role);
      const needsBridge = Boolean(usePopup || !req.headers.cookie);
      const handoff = needsBridge
        ? await issuePopupHandoffToken(stateToken, existingOutcome.user.id, target)
        : '';
      return finishOAuthRedirect(res, target, needsBridge, handoff);
    }
    if (['account_disabled', 'subject_mismatch', 'no_approved_role'].includes(existingOutcome.reason)) {
      return finishOAuthRedirect(
        res,
        `/login?error=${encodeURIComponent(existingOutcome.reason)}`,
        usePopup
      );
    }

    const proposal = await authService.submitGoogleStudentJoinRequest({
      googleSubjectId: googleProfile.googleSubjectId,
      email: googleProfile.email,
      displayName: googleProfile.displayName,
      requestedClassId: regMeta?.classId || null,
      gender: regMeta?.gender || '',
      guardianPhone: regMeta?.guardianPhone || '',
      ipAddress: req.ip,
    });
    const infoCode = proposal.alreadyPending
      ? 'google_proposal_already_pending'
      : 'google_proposal_submitted';
    return finishOAuthRedirect(res, `/login?info=${infoCode}`, usePopup);
  }

  // Standard Google Sign-In or Authenticated Account Linking
  const outcome = await accountLinkingService.resolveOrLinkGoogleAccount({
    ...googleProfile,
    linkToAuthenticatedUserId: linkUserId,
    ipAddress: req.ip,
  });

  if (!outcome.ok) {
    if (linkUserId) {
      const linkUser = await userModel.findById(linkUserId);
      if (linkUser && linkUser.role) {
        const dash = userModel.dashboardPathForRole(linkUser.role);
        return finishOAuthRedirect(
          res,
          `${dash}?oauth_error=${encodeURIComponent(outcome.reason)}`,
          usePopup
        );
      }
    }
    return finishOAuthRedirect(res, `/login?error=${encodeURIComponent(outcome.reason)}`, usePopup);
  }

  await regenerateSessionWithUser(req, outcome.user);
  const rawTarget = userModel.dashboardPathForRole(outcome.user.role);
  const target = outcome.linkedNow ? `${rawTarget}?linked=google` : rawTarget;
  const needsBridge = Boolean(usePopup || !req.headers.cookie);
  const handoff = needsBridge
    ? await issuePopupHandoffToken(stateToken, outcome.user.id, target)
    : '';
  return finishOAuthRedirect(res, target, needsBridge, handoff);
}

async function startGoogleOAuth(req, res, next) {
  try {
    const oauthCfg = await resolveGoogleOAuthSettings(req);
    const usePopup = req.query.popup === '1';

    if (!oauthCfg.isAvailable) {
      return finishOAuthRedirect(res, '/login?error=google_not_configured', usePopup);
    }

    const mode = String(req.query.mode || 'login').toLowerCase();
    const intent = mode === 'register' ? 'register' : mode === 'link' ? 'link' : 'login';
    const linkUserId = mode === 'link' && req.session?.user?.id ? req.session.user.id : null;
    const regMeta =
      mode === 'register'
        ? {
            classId: optionalPositiveInt(req.query.classId),
            gender: optionalString(req.query.gender, 20),
            guardianPhone: optionalString(req.query.guardianPhone, 50),
          }
        : null;

    const state = await createOAuthStateRecord({
      intent,
      usePopup,
      linkUserId,
      regMeta,
    });

    if (oauthCfg.isLiveConfigured) {
      const passport = configureGooglePassport(oauthCfg);
      return passport.authenticate('google', {
        scope: ['openid', 'profile', 'email'],
        state,
        session: false,
        prompt: 'select_account',
      })(req, res, next);
    }

    // Interactive Sandbox Consent Screen for local/preview environments without live Google Cloud keys
    return res.redirect(`/auth/google/dev-consent?state=${encodeURIComponent(state)}`);
  } catch (err) {
    return next(err);
  }
}

async function getConsentContext(req, res) {
  if (env.isProduction) {
    throw new AppError(404, 'The requested resource was not found.');
  }
  const stateRec = await peekValidOAuthState(req.query.state);
  if (!stateRec) {
    throw new AppError(400, 'OAuth session expired. Please start Google Sign-In again.');
  }
  const settings = await db.get('SELECT school_name FROM school_settings WHERE id = 1');
  let linkEmail = '';
  let linkFullName = '';
  if (stateRec.linkUserId) {
    const u = await userModel.findById(stateRec.linkUserId);
    if (u) {
      linkEmail = u.email || '';
      linkFullName = u.full_name || '';
    }
  }
  return res.json({
    ok: true,
    intent: stateRec.intent,
    schoolName: settings?.school_name || 'School Management System',
    linkEmail,
    linkFullName,
  });
}

async function renderDevGoogleConsent(req, res) {
  if (env.isProduction) {
    throw new AppError(404, 'The requested resource was not found.');
  }
  const oauthCfg = await resolveGoogleOAuthSettings(req);
  if (!oauthCfg.isSandboxMode) {
    return res.redirect('/login');
  }
  const stateRec = await peekValidOAuthState(req.query.state);
  if (!stateRec) {
    return res.redirect('/login?error=oauth_state_invalid');
  }
  return res.sendFile(path.join(__dirname, '..', 'views', 'google-oauth-consent.html'));
}

async function authorizeDevGoogleOAuth(req, res) {
  if (env.isProduction) {
    throw new AppError(404, 'The requested resource was not found.');
  }
  if (!isSameOrigin(req)) {
    throw new AppError(403, 'Cross-origin state-changing request blocked by security policy.');
  }

  const oauthCfg = await resolveGoogleOAuthSettings(req);
  if (!oauthCfg.isSandboxMode) {
    throw new AppError(403, 'Sandbox Google OAuth is disabled when live credentials are active.');
  }

  const stateRec = await consumeValidOAuthState(req.body.state);
  if (!stateRec) {
    return res.redirect('/login?error=oauth_state_invalid');
  }

  const email = requireEmail(req.body.email);
  const displayName = optionalString(req.body.displayName, 140) || email.split('@')[0];
  const googleSubjectId = `google-oauth-${crypto
    .createHash('sha256')
    .update(email.toLowerCase())
    .digest('hex')
    .slice(0, 24)}`;

  return completeGoogleIdentityFlow({
    req,
    res,
    stateToken: stateRec.stateToken,
    googleProfile: {
      googleSubjectId,
      email,
      emailVerified: true,
      displayName,
      avatarUrl: '',
    },
    linkUserId: stateRec.linkUserId,
    intent: stateRec.intent,
    regMeta: stateRec.regMeta,
    usePopup: stateRec.usePopup,
  });
}

async function handleGoogleCallback(req, res, next) {
  if (req.query.error === 'access_denied') {
    const peeked = req.query.state ? await consumeValidOAuthState(req.query.state) : null;
    return finishOAuthRedirect(res, '/login?error=oauth_cancelled', Boolean(peeked?.usePopup));
  }
  if (req.query.error) {
    const peeked = req.query.state ? await consumeValidOAuthState(req.query.state) : null;
    return finishOAuthRedirect(res, '/login?error=oauth_failed', Boolean(peeked?.usePopup));
  }

  const stateRec = await consumeValidOAuthState(req.query.state);
  if (!stateRec) {
    return res.redirect('/login?error=oauth_state_invalid');
  }

  try {
    const oauthCfg = await resolveGoogleOAuthSettings(req);
    if (!oauthCfg.isLiveConfigured) {
      return finishOAuthRedirect(res, '/login?error=google_not_configured', stateRec.usePopup);
    }

    const passport = configureGooglePassport(oauthCfg);
    return passport.authenticate('google', { session: false }, async (err, googleProfile) => {
      try {
        if (err || !googleProfile) {
          const msg = String(err?.message || err?.code || '').toLowerCase();
          const isNetBlocked =
            msg.includes('enotfound') ||
            msg.includes('eai_again') ||
            msg.includes('econnrefused') ||
            msg.includes('etimedout') ||
            msg.includes('failed to obtain access token');
          return finishOAuthRedirect(
            res,
            `/login?error=${isNetBlocked ? 'oauth_network_restricted' : 'oauth_failed'}`,
            stateRec.usePopup
          );
        }

        return await completeGoogleIdentityFlow({
          req,
          res,
          stateToken: stateRec.stateToken,
          googleProfile,
          linkUserId: stateRec.linkUserId,
          intent: stateRec.intent,
          regMeta: stateRec.regMeta,
          usePopup: stateRec.usePopup,
        });
      } catch (callbackErr) {
        return next(callbackErr);
      }
    })(req, res, next);
  } catch (err) {
    return next(err);
  }
}

async function exchangeGoogleHandoff(req, res) {
  if (!isSameOrigin(req)) {
    throw new AppError(403, 'Cross-origin handoff request blocked.');
  }
  const rawToken = requireString(req.body.handoffToken, 'Handoff token', { min: 16, max: 128 });
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const now = Date.now();

  const row = await db.get(
    `SELECT state_token, handoff_user_id, handoff_redirect_to
     FROM oauth_states
     WHERE handoff_token_hash = ? AND handoff_consumed = 0 AND handoff_expires_at > ?`,
    [tokenHash, now]
  );
  if (!row || !row.handoff_user_id) {
    throw new AppError(401, 'Google handoff token expired or already used.');
  }

  const upd = await db.run(
    `UPDATE oauth_states
     SET handoff_consumed = 1
     WHERE state_token = ? AND handoff_consumed = 0`,
    [row.state_token]
  );
  if (!upd.affectedRows) {
    throw new AppError(401, 'Google handoff token already consumed.');
  }

  const userRow = await userModel.findById(row.handoff_user_id);
  if (!userRow || userRow.status !== 'active' || !userRow.role) {
    throw new AppError(403, 'Account is inactive or unauthorized.');
  }

  const safeUser = userModel.toSafeSessionUser(userRow);
  await regenerateSessionWithUser(req, safeUser);

  return res.json({
    ok: true,
    user: safeUser,
    csrfToken: req.session.csrfToken,
    sessionToken: signSessionId(req.sessionID),
    redirectTo: safeRelativePath(row.handoff_redirect_to || userModel.dashboardPathForRole(safeUser.role)),
  });
}

function renderPopupComplete(_req, res) {
  return res.sendFile(path.join(__dirname, '..', 'views', 'oauth-popup-complete.html'));
}

async function unlinkGoogle(req, res) {
  await accountLinkingService.unlinkGoogleAccount(req.user.id, req.ip);
  const refreshed = await userModel.findById(req.user.id);
  req.session.user = userModel.toSafeSessionUser(refreshed);
  return res.json({ ok: true, message: 'Google Sign-In unlinked from your school account.' });
}

async function acceptTerms(req, res) {
  if (!req.body || (!req.body.accept && !req.body.acceptTerms)) {
    throw new AppError(400, 'Please confirm that you accept the Terms and Conditions.');
  }
  const updatedUser = await authService.acceptUserTerms({
    userId: req.user.id,
    role: req.user.role,
    ipAddress: req.ip,
  });
  req.session.user = updatedUser;
  await new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
  return res.json({
    ok: true,
    user: updatedUser,
    termsVersion: authService.CURRENT_TERMS_VERSION,
  });
}

async function updatePreferences(req, res) {
  const updatedUser = await authService.updateUserPreferences({
    userId: req.user.id,
    theme: req.body?.theme,
    language: req.body?.language,
  });
  req.session.user = updatedUser;
  await new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
  return res.json({
    ok: true,
    user: updatedUser,
    themePreference: updatedUser.themePreference,
    languagePreference: updatedUser.languagePreference,
  });
}

module.exports = {
  regenerateSessionWithUser,
  getSessionStatus,
  login,
  registerStudent,
  logout,
  requestReset,
  confirmReset,
  changePassword,
  acceptTerms,
  updatePreferences,
  uploadOwnAvatar,
  removeOwnAvatar,
  startGoogleOAuth,
  getConsentContext,
  renderDevGoogleConsent,
  authorizeDevGoogleOAuth,
  handleGoogleCallback,
  exchangeGoogleHandoff,
  renderPopupComplete,
  unlinkGoogle,
};
