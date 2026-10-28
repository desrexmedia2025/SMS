const signature = require('cookie-signature');
const cookie = require('cookie');
const env = require('../config/environment');

function signSessionId(sessionId) {
  if (!sessionId) return '';
  return signature.sign(String(sessionId), env.session.secret);
}

function verifySessionToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return false;
  const trimmed = rawToken.trim();
  if (trimmed.length < 16 || trimmed.length > 256) return false;
  return signature.unsign(trimmed, env.session.secret);
}

/**
 * Allows embedded cross-origin preview iframes where browsers block all third-party cookies
 * (Safari ITP, Brave Shields, Firefox Strict, Chrome 3PC-blocked) to present the exact same
 * HMAC-signed express-session ID via `X-SMS-Session` header (API calls) or one-time `?_st=`
 * navigation parameter (immediately stripped from URL bar on load).
 */
function injectFallbackSessionCookie(req, _res, next) {
  const headerToken = req.headers['x-sms-session'];
  const navToken =
    req.method === 'GET' && req.query && typeof req.query._st === 'string'
      ? req.query._st
      : '';
  const candidate = String(headerToken || navToken || '').trim();

  if (candidate && verifySessionToken(candidate) !== false) {
    const existingCookies = req.headers.cookie ? cookie.parse(req.headers.cookie) : {};
    existingCookies[env.session.cookieName] = `s:${candidate}`;
    req.headers.cookie = Object.entries(existingCookies)
      .map(([k, v]) => cookie.serialize(k, v))
      .join('; ');
  }

  return next();
}

module.exports = {
  signSessionId,
  verifySessionToken,
  injectFallbackSessionCookie,
};
