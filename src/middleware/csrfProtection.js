const crypto = require('crypto');
const env = require('../config/environment');
const { AppError } = require('./errorHandler');

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

function ensureCsrfToken(req, _res, next) {
  if (req.session && !req.session.csrfToken) {
    req.session.csrfToken = generateCsrfToken();
  }
  next();
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  if (!origin && !referer) {
    // Non-browser API clients or same-origin requests without Origin header still must pass CSRF token check
    return true;
  }

  const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (!rawHost) return true;

  try {
    const candidate = new URL(origin || referer);
    const candHost = candidate.host.toLowerCase();
    if (candHost === rawHost) return true;

    if (!env.isProduction) {
      const isLocalBackendHost = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/.test(rawHost);
      if (
        isLocalBackendHost &&
        (candidate.hostname.endsWith('.e2b.app') ||
          /^(localhost|127\.0\.0\.1)$/.test(candidate.hostname))
      ) {
        return true;
      }
    }
    return false;
  } catch (_) {
    return false;
  }
}

function verifyCsrfToken(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  if (!isSameOrigin(req)) {
    return next(new AppError(403, 'Cross-origin state-changing request blocked by security policy.'));
  }

  const sessionToken = req.session && String(req.session.csrfToken || '');
  const incomingToken = String(
    req.headers['x-csrf-token'] || (req.body && req.body._csrf) || req.query?._csrf || ''
  );

  if (!sessionToken || !incomingToken) {
    return next(
      new AppError(403, 'Invalid or expired security token. Please refresh the page and try again.')
    );
  }

  const expectedBuf = Buffer.from(sessionToken, 'utf8');
  const incomingBuf = Buffer.from(incomingToken, 'utf8');

  if (expectedBuf.length !== incomingBuf.length || !crypto.timingSafeEqual(expectedBuf, incomingBuf)) {
    return next(
      new AppError(403, 'Invalid or expired security token. Please refresh the page and try again.')
    );
  }

  return next();
}

module.exports = { generateCsrfToken, ensureCsrfToken, isSameOrigin, verifyCsrfToken };
