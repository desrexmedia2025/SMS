const brandIcons = require('../brand/brand-icons');

// The school mark is served from embedded data rather than from disk so the logo always
// resolves - including on serverless hosts where files outside the function bundle are
// not guaranteed to ship.

function sendIcon(res, type, body, maxAgeSeconds = 7 * 24 * 60 * 60) {
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', `public, max-age=${maxAgeSeconds}`);
  res.setHeader('Content-Length', Buffer.byteLength(body));
  return res.end(body);
}

function faviconIco(_req, res) {
  return sendIcon(res, 'image/x-icon', brandIcons.faviconIco);
}

function faviconSvg(_req, res) {
  return sendIcon(res, 'image/svg+xml', brandIcons.faviconSvg);
}

function appleTouchIcon(_req, res) {
  return sendIcon(res, 'image/png', brandIcons.appleTouchIcon);
}

module.exports = {
  faviconIco,
  faviconSvg,
  appleTouchIcon,
};
