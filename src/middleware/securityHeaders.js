const env = require('../config/environment');
const { AppError } = require('./errorHandler');

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_NESTING_DEPTH = 8;

function cleanObjectInPlace(obj, depth = 0) {
  if (!obj || typeof obj !== 'object') return;
  if (depth > MAX_NESTING_DEPTH) {
    throw new AppError(400, 'Request payload nesting depth exceeded security limit.');
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i += 1) {
      if (typeof obj[i] === 'string') {
        obj[i] = obj[i].replace(/\0/g, '');
      } else if (obj[i] && typeof obj[i] === 'object') {
        cleanObjectInPlace(obj[i], depth + 1);
      }
    }
    return;
  }

  for (const key of Object.keys(obj)) {
    if (DANGEROUS_KEYS.has(key)) {
      delete obj[key];
      continue;
    }
    const val = obj[key];
    if (typeof val === 'string') {
      obj[key] = val.replace(/\0/g, '');
    } else if (val && typeof val === 'object') {
      cleanObjectInPlace(val, depth + 1);
    }
  }
}

// The marketing page, the sign-in screen and the public images are the only things a
// search engine should ever be offered. Everything else - dashboards, the API and
// uploaded files - is told to stay out of the index.
const INDEXABLE = 'index, follow, max-image-preview:large';
const NOT_INDEXABLE = 'noindex, nofollow, noarchive';

function robotsTagFor(pathname) {
  if (pathname === '/' || pathname === '/login' || pathname.startsWith('/img/')) {
    return INDEXABLE;
  }
  return NOT_INDEXABLE;
}

function securityPolicyHeaders(req, res, next) {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), usb=(), payment=(self)'
  );
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('X-Robots-Tag', robotsTagFor(String(req.path || '/')));
  next();
}

function noStoreCache(_req, res, next) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
}

function sanitizeRequest(req, _res, next) {
  try {
    if (req.body && typeof req.body === 'object') {
      cleanObjectInPlace(req.body, 0);
    }
    if (req.params && typeof req.params === 'object') {
      cleanObjectInPlace(req.params, 0);
    }
    if (req.query && typeof req.query === 'object') {
      // Collapse HTTP Parameter Pollution arrays on query parameters & strip null bytes
      for (const key of Object.keys(req.query)) {
        if (DANGEROUS_KEYS.has(key)) {
          delete req.query[key];
          continue;
        }
        const val = req.query[key];
        if (Array.isArray(val)) {
          req.query[key] = String(val[val.length - 1] ?? '').replace(/\0/g, '');
        } else if (typeof val === 'string') {
          req.query[key] = val.replace(/\0/g, '');
        }
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

function applySessionCookiePolicy(req) {
  if (!req || !req.session || !req.session.cookie) return;
  const protoHeader = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  const isHttps = Boolean(req.secure || protoHeader.includes('https'));

  if (isHttps && !env.isProduction) {
    req.session.cookie.secure = true;
    req.session.cookie.sameSite = 'none';
    req.session.cookie.partitioned = true;
  } else if (env.isProduction) {
    req.session.cookie.secure = true;
    req.session.cookie.sameSite = 'lax';
    req.session.cookie.partitioned = false;
  } else {
    req.session.cookie.secure = false;
    req.session.cookie.sameSite = 'lax';
    req.session.cookie.partitioned = false;
  }
}

module.exports = {
  securityPolicyHeaders,
  robotsTagFor,
  noStoreCache,
  sanitizeRequest,
  applySessionCookiePolicy,
};
