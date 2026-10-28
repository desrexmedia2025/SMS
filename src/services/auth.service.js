const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const userModel = require('../models/user.model');
const { recordAudit } = require('./audit.service');
const { AppError } = require('../middleware/errorHandler');
const { requireStrongPassword } = require('../validators/schemas');

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const DUMMY_BCRYPT_HASH = bcrypt.hashSync('SmsTimingShield#2026!Constant', 10);

function isCurrentlyLocked(lockedUntilStr) {
  if (!lockedUntilStr) return false;
  const iso = String(lockedUntilStr).includes('T')
    ? String(lockedUntilStr)
    : `${String(lockedUntilStr).replace(' ', 'T')}Z`;
  const ts = new Date(iso).getTime();
  return Number.isFinite(ts) && ts > Date.now();
}

async function loginWithPassword({ identifier, password, ipAddress = '' }) {
  const cleanIdent = String(identifier || '').trim();
  const userRow = await userModel.findByEmailOrUsername(cleanIdent);
  if (!userRow || !userRow.password_hash) {
    const joinReq = await db.get(
      `SELECT id, status, password_hash
       FROM student_registration_requests
       WHERE LOWER(email) = ?
       ORDER BY id DESC LIMIT 1`,
      [cleanIdent.toLowerCase()]
    );

    if (joinReq && joinReq.password_hash) {
      const reqMatch = await bcrypt.compare(String(password || ''), joinReq.password_hash);
      if (reqMatch && joinReq.status === 'pending') {
        throw new AppError(
          403,
          'Your student join proposal is awaiting Superadmin approval. You can sign in once it is accepted.'
        );
      }
      if (reqMatch && joinReq.status === 'rejected') {
        throw new AppError(
          403,
          'Your student join proposal was not approved by the Superadmin.'
        );
      }
    } else {
      // Perform constant-work dummy bcrypt comparison to eliminate username enumeration timing side-channels
      await bcrypt.compare(String(password || ''), DUMMY_BCRYPT_HASH);
    }

    await recordAudit({
      action: 'LOGIN_FAILED',
      targetType: 'identifier',
      targetId: '[REDACTED]',
      ipAddress,
    });
    throw new AppError(401, 'Invalid email/username or password.');
  }

  // Enforce per-account brute-force lockout before password verification
  if (isCurrentlyLocked(userRow.locked_until)) {
    await recordAudit({
      actorUserId: userRow.id,
      actorRole: userRow.role || '',
      action: 'LOGIN_BLOCKED_ACCOUNT_LOCKED',
      targetType: 'user',
      targetId: String(userRow.id),
      ipAddress,
    });
    throw new AppError(
      423,
      'This account is temporarily locked after repeated failed sign-in attempts. Please wait 15 minutes or contact School Administration.'
    );
  }

  const validPassword = await bcrypt.compare(String(password || ''), userRow.password_hash);
  if (!validPassword) {
    const prevAttempts = isCurrentlyLocked(userRow.locked_until)
      ? 0
      : Number(userRow.failed_login_attempts || 0);
    const nextAttempts = prevAttempts + 1;

    if (nextAttempts >= MAX_FAILED_ATTEMPTS) {
      const lockUntilIso = new Date(Date.now() + LOCKOUT_DURATION_MS)
        .toISOString()
        .slice(0, 19)
        .replace('T', ' ');
      await db.run(
        `UPDATE users
         SET failed_login_attempts = ?, locked_until = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [nextAttempts, lockUntilIso, userRow.id]
      );
      await recordAudit({
        actorUserId: userRow.id,
        actorRole: userRow.role || '',
        action: 'ACCOUNT_LOCKED_BRUTE_FORCE',
        targetType: 'user',
        targetId: String(userRow.id),
        ipAddress,
        metadata: { attempts: nextAttempts, lockedUntil: lockUntilIso },
      });
      throw new AppError(
        423,
        'Account locked for 15 minutes after 5 consecutive failed sign-in attempts.'
      );
    }

    await db.run(
      `UPDATE users SET failed_login_attempts = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [nextAttempts, userRow.id]
    );
    await recordAudit({
      actorUserId: userRow.id,
      actorRole: userRow.role || '',
      action: 'LOGIN_FAILED_WRONG_PASSWORD',
      targetType: 'user',
      targetId: String(userRow.id),
      ipAddress,
      metadata: { attempts: nextAttempts },
    });
    throw new AppError(401, 'Invalid email/username or password.');
  }

  if (userRow.status !== 'active') {
    await recordAudit({
      actorUserId: userRow.id,
      actorRole: userRow.role || '',
      action: 'LOGIN_REJECTED_INACTIVE',
      targetType: 'user',
      targetId: String(userRow.id),
      ipAddress,
    });
    throw new AppError(
      403,
      'Your account is currently inactive or suspended. Please contact School Administration.'
    );
  }

  if (!userRow.role) {
    throw new AppError(403, 'Your account does not have an assigned dashboard role yet.');
  }

  await db.run(
    `UPDATE users
     SET failed_login_attempts = 0,
         locked_until = NULL,
         last_login_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [userRow.id]
  );

  const safeUser = userModel.toSafeSessionUser(userRow);
  await recordAudit({
    actorUserId: userRow.id,
    actorRole: userRow.role,
    action: 'LOGIN_SUCCESS',
    targetType: 'user',
    targetId: String(userRow.id),
    ipAddress,
  });

  return {
    user: safeUser,
    redirectTo: userModel.dashboardPathForRole(safeUser.role),
  };
}

async function requestPasswordReset({ email, ipAddress = '' }) {
  const userRow = await userModel.findByEmail(email);
  // Perform constant-time dummy hash even when user is absent to prevent account enumeration
  if (!userRow || userRow.status !== 'active') {
    await bcrypt.hash('dummy-reset-shield', 10);
    return { issued: false };
  }

  const rawCode = crypto.randomBytes(5).toString('hex').toUpperCase();
  const codeHash = await bcrypt.hash(rawCode, 10);
  const expiresIso = new Date(Date.now() + 15 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');

  await db.run(
    `UPDATE users
     SET password_reset_token_hash = ?,
         password_reset_expires_at = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [codeHash, expiresIso, userRow.id]
  );

  await recordAudit({
    actorUserId: userRow.id,
    actorRole: userRow.role || '',
    action: 'PASSWORD_RESET_REQUESTED',
    targetType: 'user',
    targetId: String(userRow.id),
    ipAddress,
  });

  return { issued: true, resetCodeInternal: rawCode };
}

async function confirmPasswordReset({ email, resetCode, newPassword, ipAddress = '' }) {
  const strongPassword = requireStrongPassword(newPassword, 'New password');

  const userRow = await userModel.findByEmail(email);
  if (!userRow || !userRow.password_reset_token_hash || !userRow.password_reset_expires_at) {
    await bcrypt.compare('DUMMY', DUMMY_BCRYPT_HASH);
    throw new AppError(400, 'Invalid or expired reset code.');
  }

  const expiresMs = new Date(
    String(userRow.password_reset_expires_at).replace(' ', 'T') + 'Z'
  ).getTime();
  if (Number.isNaN(expiresMs) || expiresMs < Date.now()) {
    throw new AppError(400, 'Reset code has expired. Please request a new one.');
  }

  const matches = await bcrypt.compare(
    String(resetCode || '').trim().toUpperCase(),
    userRow.password_reset_token_hash
  );
  if (!matches) {
    throw new AppError(400, 'Invalid or expired reset code.');
  }

  const newHash = await bcrypt.hash(strongPassword, 12);
  await db.withTransaction(async (tx) => {
    await tx.run(
      `UPDATE users
       SET password_hash = ?,
           password_reset_token_hash = NULL,
           password_reset_expires_at = NULL,
           failed_login_attempts = 0,
           locked_until = NULL,
           password_changed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [newHash, userRow.id]
    );
    // Revoke all existing active sessions for this user upon password reset
    await tx.run('DELETE FROM user_sessions WHERE user_id = ?', [userRow.id]);

    await recordAudit(
      {
        actorUserId: userRow.id,
        actorRole: userRow.role || '',
        action: 'PASSWORD_RESET_COMPLETED',
        targetType: 'user',
        targetId: String(userRow.id),
        ipAddress,
      },
      tx
    );
  });
}

async function changeOwnPassword({ userId, currentPassword, newPassword, currentSessionId = null, ipAddress = '' }) {
  const strongPassword = requireStrongPassword(newPassword, 'New password');
  const userRow = await userModel.findById(userId);
  if (!userRow) throw new AppError(404, 'User not found.');

  if (userRow.password_hash) {
    const ok = await bcrypt.compare(String(currentPassword || ''), userRow.password_hash);
    if (!ok) throw new AppError(400, 'Current password is incorrect.');
  }

  if (String(currentPassword || '') === strongPassword) {
    throw new AppError(400, 'New password must be different from your current password.');
  }

  const newHash = await bcrypt.hash(strongPassword, 12);
  await db.withTransaction(async (tx) => {
    await tx.run(
      `UPDATE users
       SET password_hash = ?,
           auth_provider = CASE WHEN google_subject_id IS NOT NULL THEN 'both' ELSE 'local' END,
           password_changed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [newHash, userId]
    );

    // Revoke all other sessions for this user across other devices/browsers
    if (currentSessionId) {
      await tx.run('DELETE FROM user_sessions WHERE user_id = ? AND session_id <> ?', [
        userId,
        currentSessionId,
      ]);
    } else {
      await tx.run('DELETE FROM user_sessions WHERE user_id = ?', [userId]);
    }

    await recordAudit(
      {
        actorUserId: userRow.id,
        actorRole: userRow.role || '',
        action: 'PASSWORD_CHANGED',
        targetType: 'user',
        targetId: String(userRow.id),
        ipAddress,
      },
      tx
    );
  });
}

async function submitStudentJoinRequest({
  firstName,
  lastName,
  email,
  phone = '',
  gender = '',
  dateOfBirth = '',
  requestedClassId = null,
  guardianName = '',
  guardianPhone = '',
  password,
  ipAddress = '',
}) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const strongPassword = requireStrongPassword(password, 'Password');

  const existingUser = await db.get('SELECT id FROM users WHERE LOWER(email) = ?', [cleanEmail]);
  if (existingUser) {
    throw new AppError(409, 'An account with this email address already exists. Please sign in instead.');
  }

  const existingPending = await db.get(
    `SELECT id FROM student_registration_requests
     WHERE LOWER(email) = ? AND status = 'pending'`,
    [cleanEmail]
  );
  if (existingPending) {
    throw new AppError(409, 'A student join proposal for this email is already pending Superadmin review.');
  }

  if (requestedClassId) {
    const cls = await db.get("SELECT id FROM classes WHERE id = ? AND status = 'active'", [
      requestedClassId,
    ]);
    if (!cls) throw new AppError(400, 'Selected class is not valid.');
  }

  const passwordHash = await bcrypt.hash(strongPassword, 10);
  const ins = await db.run(
    `INSERT INTO student_registration_requests
     (first_name, last_name, email, phone, gender, date_of_birth, requested_class_id, guardian_name, guardian_phone, password_hash, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      firstName,
      lastName,
      cleanEmail,
      phone,
      gender,
      dateOfBirth,
      requestedClassId || null,
      guardianName,
      guardianPhone,
      passwordHash,
    ]
  );

  await recordAudit({
    action: 'STUDENT_JOIN_REQUEST_SUBMITTED',
    targetType: 'student_registration_request',
    targetId: String(ins.insertId),
    ipAddress,
    metadata: { email: cleanEmail, requestedClassId: requestedClassId || null },
  });

  return { id: ins.insertId, status: 'pending' };
}

async function submitGoogleStudentJoinRequest({
  googleSubjectId,
  email,
  displayName = '',
  requestedClassId = null,
  gender = '',
  guardianPhone = '',
  ipAddress = '',
}) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!googleSubjectId || !cleanEmail) {
    throw new AppError(400, 'Verified Google email and subject identifier are required.');
  }

  const existingPending = await db.get(
    `SELECT id FROM student_registration_requests
     WHERE (LOWER(email) = ? OR google_subject_id = ?) AND status = 'pending'`,
    [cleanEmail, googleSubjectId]
  );
  if (existingPending) {
    await db.run(
      `UPDATE student_registration_requests
       SET google_subject_id = COALESCE(google_subject_id, ?)
       WHERE id = ?`,
      [googleSubjectId, existingPending.id]
    );
    return { id: existingPending.id, status: 'pending', alreadyPending: true };
  }

  const parts = String(displayName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const localPrefix = cleanEmail.split('@')[0] || 'Student';
  const firstName = (parts[0] || localPrefix).slice(0, 80);
  const lastName = (parts.slice(1).join(' ') || 'Applicant').slice(0, 80);

  let validClassId = null;
  if (requestedClassId) {
    const cls = await db.get("SELECT id FROM classes WHERE id = ? AND status = 'active'", [
      requestedClassId,
    ]);
    if (cls) validClassId = cls.id;
  }

  const ins = await db.run(
    `INSERT INTO student_registration_requests
     (first_name, last_name, email, phone, gender, date_of_birth, requested_class_id, guardian_name, guardian_phone, password_hash, google_subject_id, auth_provider, status)
     VALUES (?, ?, ?, '', ?, '', ?, '', ?, '', ?, 'google', 'pending')`,
    [
      firstName,
      lastName,
      cleanEmail,
      gender || '',
      validClassId,
      guardianPhone || '',
      googleSubjectId,
    ]
  );

  await recordAudit({
    action: 'STUDENT_GOOGLE_JOIN_REQUEST_SUBMITTED',
    targetType: 'student_registration_request',
    targetId: String(ins.insertId),
    ipAddress,
    metadata: { email: cleanEmail, requestedClassId: validClassId },
  });

  return { id: ins.insertId, status: 'pending', alreadyPending: false };
}

module.exports = {
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION_MS,
  isCurrentlyLocked,
  loginWithPassword,
  submitStudentJoinRequest,
  submitGoogleStudentJoinRequest,
  requestPasswordReset,
  confirmPasswordReset,
  changeOwnPassword,
};
