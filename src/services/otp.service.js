const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const db = require('../config/database');
const env = require('../config/environment');
const logger = require('../utils/logger');
const userModel = require('../models/user.model');
const { recordAudit } = require('./audit.service');
const { AppError } = require('../middleware/errorHandler');

const PURPOSE = 'login';
const DUMMY_OTP_HASH = bcrypt.hashSync('SmsOtpTimingShield#2026!Constant', 10);
const REQUEST_WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 3;
const MAX_VERIFY_ATTEMPTS = 5;

function codeTtlMs() {
  const seconds = Number(env.otp.codeTtlSeconds);
  return Number.isFinite(seconds) && seconds > 30
    ? Math.min(seconds, 3600) * 1000
    : 10 * 60 * 1000;
}

function maskEmail(email) {
  const [name, domain] = String(email || '').split('@');
  if (!domain) return 'your email address';
  const head = name.slice(0, 1);
  const tail = name.length > 2 ? name.slice(-1) : '';
  return `${head}${'*'.repeat(Math.max(2, name.length - 2))}${tail}@${domain}`;
}

function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 4) return 'your phone number';
  return `${'*'.repeat(Math.max(2, digits.length - 2))}${digits.slice(-2)}`;
}

function toSqlDateTime(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function parseSqlDateTime(value) {
  if (!value) return NaN;
  const raw = String(value).includes('T') ? String(value) : `${String(value).replace(' ', 'T')}Z`;
  return new Date(raw).getTime();
}

async function findUserForIdentifier(identifier) {
  const clean = String(identifier || '').trim();
  if (!clean) return null;
  const byEmailOrUsername = await userModel.findByEmailOrUsername(clean);
  if (byEmailOrUsername) return byEmailOrUsername;
  const phoneDigits = clean.replace(/\D/g, '');
  if (phoneDigits.length >= 7) {
    const byPhone = await db.get(
      `SELECT u.*, r.slug AS role, r.name AS role_name
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE REPLACE(REPLACE(REPLACE(REPLACE(u.phone, ' ', ''), '-', ''), '+', ''), '(', '') = ?
          OR REPLACE(REPLACE(REPLACE(REPLACE(u.phone, ' ', ''), '-', ''), '+', ''), '(', '') = ?
       LIMIT 1`,
      [phoneDigits, clean]
    );
    if (byPhone) return byPhone;
  }
  return null;
}

async function deliverCode({ channel, destination, code, fullName }) {
  const webhookUrl =
    channel === 'phone' ? env.otp.smsWebhookUrl : env.otp.emailWebhookUrl;

  if (webhookUrl && /^https?:\/\//i.test(webhookUrl)) {
    const message = `${code} is your School Management System sign-in code. It expires in ${Math.round(
      codeTtlMs() / 60000
    )} minutes. Do not share it with anyone.`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: destination,
          channel,
          code,
          subject: 'Your School Management System sign-in code',
          message,
          fullName,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`Gateway responded ${res.status}`);
      return { delivered: true, mode: 'gateway' };
    } catch (err) {
      logger.warn('OTP delivery gateway failed', { channel, error: err.message });
      return { delivered: false, mode: 'gateway-failed' };
    }
  }

  // Interactive sandbox (non-production only): the code is surfaced in the UI instead of being sent
  if (!env.isProduction) {
    logger.info('OTP sandbox code issued', { channel, destination, code });
  }
  return { delivered: false, mode: 'sandbox' };
}

async function requestLoginCode({ identifier, channel, ipAddress = '' }) {
  const wanted = String(channel || 'email').toLowerCase() === 'phone' ? 'phone' : 'email';
  const userRow = await findUserForIdentifier(identifier);

  // Constant-work shield: never reveal whether the account exists
  if (!userRow || userRow.status !== 'active') {
    await bcrypt.compare('000000', DUMMY_OTP_HASH);
    return {
      issued: false,
      channel: wanted,
      destinationHint: wanted === 'phone' ? 'your phone number' : 'your email address',
      expiresInSeconds: Math.round(codeTtlMs() / 1000),
      sandboxCode: '',
      mode: 'sandbox',
      delivered: false,
    };
  }

  if (userRow.status === 'locked') {
    throw new AppError(423, 'This account is locked. Contact the school administrator.');
  }

  const destination = wanted === 'phone' ? String(userRow.phone || '').trim() : userRow.email;
  if (!destination) {
    throw new AppError(
      400,
      wanted === 'phone'
        ? 'No phone number is on file for this account. Sign in with a password or ask the administrator to add your phone number.'
        : 'No email address is on file for this account.'
    );
  }

  const sinceIso = toSqlDateTime(Date.now() - REQUEST_WINDOW_MS);
  const recent = await db.get(
    `SELECT COUNT(*) AS total FROM login_otp_codes
     WHERE user_id = ? AND purpose = ? AND created_at >= ?`,
    [userRow.id, PURPOSE, sinceIso]
  );
  if (Number(recent?.total || 0) >= MAX_REQUESTS_PER_WINDOW) {
    throw new AppError(
      429,
      'Too many sign-in codes requested. Please wait a few minutes before requesting another.'
    );
  }

  // Only one live code at a time
  await db.run(
    `UPDATE login_otp_codes
     SET consumed_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL`,
    [userRow.id, PURPOSE]
  );

  const rawCode = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const codeHash = await bcrypt.hash(rawCode, 10);
  const expiresAt = toSqlDateTime(Date.now() + codeTtlMs());

  await db.run(
    `INSERT INTO login_otp_codes
     (user_id, channel, destination, code_hash, purpose, attempts, max_attempts, expires_at, request_ip)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [userRow.id, wanted, destination, codeHash, PURPOSE, MAX_VERIFY_ATTEMPTS, expiresAt, String(ipAddress || '').slice(0, 64)]
  );

  const delivery = await deliverCode({
    channel: wanted,
    destination,
    code: rawCode,
    fullName: userRow.full_name,
  });

  await recordAudit({
    actorUserId: userRow.id,
    actorRole: userRow.role || '',
    action: 'OTP_LOGIN_CODE_REQUESTED',
    targetType: 'user',
    targetId: String(userRow.id),
    ipAddress,
    metadata: { channel: wanted, mode: delivery.mode },
  });

  return {
    issued: true,
    channel: wanted,
    destinationHint: wanted === 'phone' ? maskPhone(destination) : maskEmail(destination),
    expiresInSeconds: Math.round(codeTtlMs() / 1000),
    sandboxCode: delivery.delivered || env.isProduction ? '' : rawCode,
    mode: delivery.mode,
    delivered: delivery.delivered,
  };
}

async function verifyLoginCode({ identifier, code, ipAddress = '' }) {
  const cleanCode = String(code || '').replace(/\D/g, '').slice(0, 6);
  if (cleanCode.length !== 6) {
    throw new AppError(400, 'Enter the 6-digit sign-in code.');
  }

  const userRow = await findUserForIdentifier(identifier);
  if (!userRow || userRow.status !== 'active') {
    await bcrypt.compare(cleanCode, DUMMY_OTP_HASH);
    throw new AppError(400, 'Invalid or expired sign-in code.');
  }

  const record = await db.get(
    `SELECT * FROM login_otp_codes
     WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL
     ORDER BY id DESC LIMIT 1`,
    [userRow.id, PURPOSE]
  );

  if (!record) {
    await bcrypt.compare(cleanCode, DUMMY_OTP_HASH);
    throw new AppError(400, 'Invalid or expired sign-in code.');
  }

  const expiresMs = parseSqlDateTime(record.expires_at);
  if (!Number.isFinite(expiresMs) || expiresMs < Date.now()) {
    await db.run('UPDATE login_otp_codes SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?', [
      record.id,
    ]);
    throw new AppError(400, 'That sign-in code has expired. Request a new one.');
  }

  if (Number(record.attempts || 0) >= Number(record.max_attempts || MAX_VERIFY_ATTEMPTS)) {
    throw new AppError(
      429,
      'Too many incorrect codes. Request a new sign-in code to continue.'
    );
  }

  const matches = await bcrypt.compare(cleanCode, record.code_hash);
  if (!matches) {
    await db.run(
      `UPDATE login_otp_codes SET attempts = attempts + 1, request_ip = ? WHERE id = ?`,
      [String(ipAddress || '').slice(0, 64), record.id]
    );
    await recordAudit({
      actorUserId: userRow.id,
      actorRole: userRow.role || '',
      action: 'OTP_LOGIN_CODE_REJECTED',
      targetType: 'user',
      targetId: String(userRow.id),
      ipAddress,
    });
    throw new AppError(400, 'Invalid or expired sign-in code.');
  }

  await db.run(
    `UPDATE login_otp_codes
     SET consumed_at = CURRENT_TIMESTAMP, attempts = attempts + 1
     WHERE id = ?`,
    [record.id]
  );

  await db.run(
    `UPDATE users
     SET last_login_at = CURRENT_TIMESTAMP,
         failed_login_attempts = 0,
         locked_until = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [userRow.id]
  );

  await recordAudit({
    actorUserId: userRow.id,
    actorRole: userRow.role || '',
    action: 'OTP_LOGIN_SUCCEEDED',
    targetType: 'user',
    targetId: String(userRow.id),
    ipAddress,
    metadata: { channel: record.channel },
  });

  const fresh = await userModel.findById(userRow.id);
  const safeUser = userModel.toSafeSessionUser(fresh || userRow);
  return {
    user: safeUser,
    redirectTo: userModel.dashboardPathForRole(safeUser.role),
  };
}

module.exports = {
  requestLoginCode,
  verifyLoginCode,
  findUserForIdentifier,
};
