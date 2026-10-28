class AppError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
  }
}

function errorHandler(err, req, res, _next) {
  const logger = require('../utils/logger');
  const statusCode = err.statusCode || 500;
  const isApi = req.originalUrl.startsWith('/api/') || req.headers.accept?.includes('application/json');

  if (statusCode >= 500) {
    logger.error('Unhandled request error', {
      method: req.method,
      path: req.originalUrl,
      error: err.message,
    });
  }

  const safeMessage =
    err.isOperational && statusCode < 500
      ? err.message
      : 'An unexpected server error occurred. Please try again.';

  if (isApi) {
    return res.status(statusCode).json({
      ok: false,
      error: safeMessage,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  return res.status(statusCode).send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Error ${statusCode}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/css/styles.css"></head>
<body class="centered-shell">
  <div class="card status-card">
    <div class="badge badge-danger">HTTP ${statusCode}</div>
    <h1>Unable to complete request</h1>
    <p>${escapeHtml(safeMessage)}</p>
    <a href="/" class="btn btn-primary">Return to Portal</a>
  </div>
</body></html>`);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { AppError, errorHandler, escapeHtml };
