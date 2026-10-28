const db = require('../config/database');
const env = require('../config/environment');
const userModel = require('../models/user.model');
const { recordAudit } = require('./audit.service');
const { AppError } = require('../middleware/errorHandler');

/**
 * Resolves or safely links a verified Google OAuth 2.0 identity against local school accounts.
 * Enforces Blueprint Revision 2.1 Section 4 rules:
 *  - Never creates privileged accounts automatically
 *  - Rejects disabled/inactive accounts even if Google login succeeded
 *  - Uses google_subject_id as the stable provider identity
 *  - Role always comes from the local MySQL/MariaDB database
 */
async function resolveOrLinkGoogleAccount({
  googleSubjectId,
  email,
  emailVerified,
  displayName,
  avatarUrl = '',
  linkToAuthenticatedUserId = null,
  ipAddress = '',
}) {
  if (!googleSubjectId) {
    throw new AppError(400, 'Missing verified Google subject identifier.');
  }

  const normalizedEmail = String(email || '').trim().toLowerCase();

  // Case 1: Explicit account linking initiated by an already signed-in user
  if (linkToAuthenticatedUserId) {
    const existingGoogleOwner = await userModel.findByGoogleSubjectId(googleSubjectId);
    if (existingGoogleOwner && existingGoogleOwner.id !== linkToAuthenticatedUserId) {
      await recordAudit({
        actorUserId: linkToAuthenticatedUserId,
        action: 'GOOGLE_LINK_CONFLICT',
        targetType: 'user',
        targetId: String(linkToAuthenticatedUserId),
        ipAddress,
      });
      return { ok: false, reason: 'google_already_linked' };
    }

    const currentUser = await userModel.findById(linkToAuthenticatedUserId);
    if (!currentUser || currentUser.status !== 'active' || !currentUser.role) {
      return { ok: false, reason: 'account_disabled' };
    }

    await db.run(
      `UPDATE users
       SET google_subject_id = ?,
           email_verified = CASE WHEN ? = 1 THEN 1 ELSE email_verified END,
           auth_provider = CASE WHEN password_hash IS NOT NULL THEN 'both' ELSE 'google' END,
           avatar_url = CASE WHEN avatar_url = '' THEN ? ELSE avatar_url END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [googleSubjectId, emailVerified ? 1 : 0, avatarUrl, currentUser.id]
    );

    await recordAudit({
      actorUserId: currentUser.id,
      actorRole: currentUser.role,
      action: 'GOOGLE_ACCOUNT_LINKED',
      targetType: 'user',
      targetId: String(currentUser.id),
      ipAddress,
      metadata: { googleEmail: normalizedEmail },
    });

    const refreshed = await userModel.findById(currentUser.id);
    return { ok: true, user: userModel.toSafeSessionUser(refreshed), linkedNow: true };
  }

  // Case 2: Lookup by stable google_subject_id first
  let localAccount = await userModel.findByGoogleSubjectId(googleSubjectId);

  // Case 3: Safe verified-email match against an existing school-approved account
  if (!localAccount && normalizedEmail && emailVerified && env.google.autoLinkVerifiedEmail) {
    const emailMatch = await userModel.findByEmail(normalizedEmail);
    if (emailMatch) {
      // If the local account already has a DIFFERENT google_subject_id linked, refuse mismatch
      if (emailMatch.google_subject_id && emailMatch.google_subject_id !== googleSubjectId) {
        await recordAudit({
          actorUserId: emailMatch.id,
          actorRole: emailMatch.role || '',
          action: 'GOOGLE_LOGIN_SUBJECT_MISMATCH',
          targetType: 'user',
          targetId: String(emailMatch.id),
          ipAddress,
        });
        return { ok: false, reason: 'subject_mismatch' };
      }

      if (emailMatch.status !== 'active') {
        await recordAudit({
          actorUserId: emailMatch.id,
          actorRole: emailMatch.role || '',
          action: 'GOOGLE_LOGIN_REJECTED_DISABLED',
          targetType: 'user',
          targetId: String(emailMatch.id),
          ipAddress,
        });
        return { ok: false, reason: 'account_disabled' };
      }

      if (!emailMatch.role) {
        return { ok: false, reason: 'no_approved_role' };
      }

      await db.run(
        `UPDATE users
         SET google_subject_id = ?,
             email_verified = 1,
             auth_provider = CASE WHEN password_hash IS NOT NULL THEN 'both' ELSE 'google' END,
             avatar_url = CASE WHEN avatar_url = '' THEN ? ELSE avatar_url END,
             last_login_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [googleSubjectId, avatarUrl, emailMatch.id]
      );

      await recordAudit({
        actorUserId: emailMatch.id,
        actorRole: emailMatch.role,
        action: 'GOOGLE_AUTO_LINKED_VERIFIED_ACCOUNT',
        targetType: 'user',
        targetId: String(emailMatch.id),
        ipAddress,
        metadata: { email: normalizedEmail, displayName },
      });

      localAccount = await userModel.findById(emailMatch.id);
    }
  }

  // Case 4: Unknown Google identity -> Check if student join proposal exists, otherwise reject (NEVER auto-create active account!)
  if (!localAccount) {
    const existingProposal = await db.get(
      `SELECT id, status
       FROM student_registration_requests
       WHERE google_subject_id = ? OR (LOWER(email) = ? AND ? <> '')
       ORDER BY id DESC LIMIT 1`,
      [googleSubjectId, normalizedEmail, normalizedEmail]
    );
    if (existingProposal && existingProposal.status === 'pending') {
      return { ok: false, reason: 'google_proposal_pending' };
    }
    if (existingProposal && existingProposal.status === 'rejected') {
      return { ok: false, reason: 'google_proposal_rejected' };
    }

    await recordAudit({
      action: 'GOOGLE_LOGIN_UNKNOWN_ACCOUNT',
      targetType: 'oauth_email',
      targetId: normalizedEmail || 'unknown',
      ipAddress,
    });
    return { ok: false, reason: 'unregistered_google' };
  }

  // Case 5: Disabled / suspended / unapproved local account -> Reject even though Google succeeded!
  if (localAccount.status !== 'active') {
    await recordAudit({
      actorUserId: localAccount.id,
      actorRole: localAccount.role || '',
      action: 'GOOGLE_LOGIN_REJECTED_DISABLED',
      targetType: 'user',
      targetId: String(localAccount.id),
      ipAddress,
    });
    return { ok: false, reason: 'account_disabled' };
  }

  if (!localAccount.role) {
    await recordAudit({
      actorUserId: localAccount.id,
      action: 'GOOGLE_LOGIN_REJECTED_NO_ROLE',
      targetType: 'user',
      targetId: String(localAccount.id),
      ipAddress,
    });
    return { ok: false, reason: 'no_approved_role' };
  }

  await db.run('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [localAccount.id]);

  await recordAudit({
    actorUserId: localAccount.id,
    actorRole: localAccount.role,
    action: 'GOOGLE_LOGIN_SUCCESS',
    targetType: 'user',
    targetId: String(localAccount.id),
    ipAddress,
  });

  return { ok: true, user: userModel.toSafeSessionUser(localAccount), linkedNow: false };
}

async function unlinkGoogleAccount(userId, ipAddress = '') {
  const user = await userModel.findById(userId);
  if (!user) throw new AppError(404, 'User account not found.');
  if (!user.password_hash) {
    throw new AppError(
      400,
      'Set a local password first before unlinking Google Sign-In so you do not lose account access.'
    );
  }
  await db.run(
    `UPDATE users
     SET google_subject_id = NULL, auth_provider = 'local', updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [userId]
  );
  await recordAudit({
    actorUserId: user.id,
    actorRole: user.role || '',
    action: 'GOOGLE_ACCOUNT_UNLINKED',
    targetType: 'user',
    targetId: String(user.id),
    ipAddress,
  });
}

module.exports = {
  resolveOrLinkGoogleAccount,
  unlinkGoogleAccount,
};
