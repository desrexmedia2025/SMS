const REDACTED_KEYS = new Set([
  'password',
  'password_hash',
  'currentPassword',
  'newPassword',
  'secret',
  'clientSecret',
  'accessToken',
  'refreshToken',
  'token',
  'cookie',
  'authorization',
]);

function sanitize(meta) {
  if (!meta || typeof meta !== 'object') return meta;
  if (Array.isArray(meta)) return meta.map(sanitize);
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (REDACTED_KEYS.has(k) || /password|secret|token|cookie/i.test(k)) {
      out[k] = '[REDACTED]';
    } else if (v && typeof v === 'object') {
      out[k] = sanitize(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

const logger = {
  info(message, meta) {
    const suffix = meta ? ` ${JSON.stringify(sanitize(meta))}` : '';
    console.log(`[INFO] ${new Date().toISOString()} ${message}${suffix}`);
  },
  warn(message, meta) {
    const suffix = meta ? ` ${JSON.stringify(sanitize(meta))}` : '';
    console.warn(`[WARN] ${new Date().toISOString()} ${message}${suffix}`);
  },
  error(message, meta) {
    const suffix = meta ? ` ${JSON.stringify(sanitize(meta))}` : '';
    console.error(`[ERROR] ${new Date().toISOString()} ${message}${suffix}`);
  },
  sanitize,
};

module.exports = logger;
