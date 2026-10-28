const { AppError } = require('../middleware/errorHandler');

function stripControlChars(raw) {
  // Strip null bytes and non-printable ASCII control characters (except \t, \n, \r)
  return String(raw ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

function requireString(val, fieldName, { min = 1, max = 255 } = {}) {
  const s = stripControlChars(val).trim();
  if (s.length < min) {
    throw new AppError(400, `${fieldName} is required.`);
  }
  if (s.length > max) {
    throw new AppError(400, `${fieldName} must not exceed ${max} characters.`);
  }
  return s;
}

function optionalString(val, max = 255) {
  return stripControlChars(val).trim().slice(0, max);
}

function requireEmail(val, fieldName = 'Email') {
  const email = stripControlChars(val).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
    throw new AppError(400, `Please enter a valid ${fieldName.toLowerCase()}.`);
  }
  return email;
}

const WEAK_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  'qwertyui',
  'qwerty123',
  'admin123',
  'welcome1',
  'letmein1',
]);

function requireStrongPassword(val, fieldName = 'Password') {
  const raw = stripControlChars(val);
  if (raw.length < 8) {
    throw new AppError(400, `${fieldName} must be at least 8 characters long.`);
  }
  if (raw.length > 160) {
    throw new AppError(400, `${fieldName} must not exceed 160 characters.`);
  }
  if (WEAK_PASSWORDS.has(raw.toLowerCase())) {
    throw new AppError(400, `${fieldName} is too common. Please choose a stronger password.`);
  }

  let classes = 0;
  if (/[a-z]/.test(raw)) classes += 1;
  if (/[A-Z]/.test(raw)) classes += 1;
  if (/[0-9]/.test(raw)) classes += 1;
  if (/[^A-Za-z0-9]/.test(raw)) classes += 1;

  if (raw.length < 12 && classes < 3) {
    throw new AppError(
      400,
      `${fieldName} must include at least three of: uppercase letter, lowercase letter, number, and symbol (or be 12+ characters).`
    );
  }
  return raw;
}

function requirePositiveInt(val, fieldName) {
  const n = Number(val);
  if (!Number.isInteger(n) || n <= 0) {
    throw new AppError(400, `${fieldName} must be a valid positive ID.`);
  }
  return n;
}

function optionalPositiveInt(val) {
  if (val === null || val === undefined || val === '' || val === '0' || val === 0) return null;
  const n = Number(val);
  if (!Number.isInteger(n) || n <= 0) {
    throw new AppError(400, 'Invalid numeric reference supplied.');
  }
  return n;
}

function requireMoney(val, fieldName, { allowZero = false } = {}) {
  const n = Number(val);
  if (!Number.isFinite(n) || (allowZero ? n < 0 : n <= 0) || n > 999999999) {
    throw new AppError(400, `${fieldName} must be a valid monetary amount.`);
  }
  return Math.round(n * 100) / 100;
}

function requireSignedMoney(val, fieldName) {
  const n = Number(val ?? 0);
  if (!Number.isFinite(n) || n < -999999999 || n > 999999999) {
    throw new AppError(400, `${fieldName} must be a valid numeric amount.`);
  }
  return Math.round(n * 100) / 100;
}

function requireEnum(val, allowed, fieldName) {
  const s = stripControlChars(val).trim();
  if (!allowed.includes(s)) {
    throw new AppError(400, `Invalid ${fieldName}. Allowed values: ${allowed.join(', ')}.`);
  }
  return s;
}

module.exports = {
  requireString,
  optionalString,
  requireEmail,
  requireStrongPassword,
  requirePositiveInt,
  optionalPositiveInt,
  requireMoney,
  requireSignedMoney,
  requireEnum,
};
