const { AppError } = require('./errorHandler');

function createRateLimiter({
  windowMs = 60_000,
  max = 10,
  maxEntries = 10_000,
  keyPrefix = 'rl',
  message = 'Too many attempts. Please wait and try again.',
} = {}) {
  const hits = new Map();

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits.entries()) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  if (cleanup.unref) cleanup.unref();

  return function rateLimiter(req, res, next) {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${ip}:${req.baseUrl}${req.path}`;
    const now = Date.now();

    if (hits.size >= maxEntries && !hits.has(key)) {
      const oldestKey = hits.keys().next().value;
      if (oldestKey) hits.delete(oldestKey);
    }

    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));

    if (entry.count > max) {
      res.setHeader('Retry-After', String(retryAfterSec));
      return next(new AppError(429, message));
    }
    return next();
  };
}

module.exports = { createRateLimiter };
