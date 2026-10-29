const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const passport = require('passport');

const env = require('./config/environment');
const db = require('./config/database');
const SqlSessionStore = require('./config/sessionStore');
const { configureGooglePassport } = require('./config/googleOAuth');
const { ensureCsrfToken } = require('./middleware/csrfProtection');
const { authenticate } = require('./middleware/authenticate');
const { authorizeRole } = require('./middleware/authorizeRole');
const { createRateLimiter } = require('./middleware/rateLimiter');
const {
  securityPolicyHeaders,
  noStoreCache,
  sanitizeRequest,
  applySessionCookiePolicy,
} = require('./middleware/securityHeaders');
const { injectFallbackSessionCookie } = require('./utils/sessionToken');
const { errorHandler, AppError } = require('./middleware/errorHandler');
const userModel = require('./models/user.model');

const authRoutes = require('./routes/auth.routes');
const superadminRoutes = require('./routes/superadmin.routes');
const teacherRoutes = require('./routes/teacher.routes');
const studentRoutes = require('./routes/student.routes');
const financialRoutes = require('./routes/financial.routes');
const paystackService = require('./services/paystack.service');
const courseworkService = require('./services/coursework.service');
const { recordSiteHit } = require('./services/analytics.service');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  const frameAncestors = env.isProduction
    ? ["'self'"]
    : ["'self'", 'https:', 'http://localhost:*', 'http://127.0.0.1:*'];

  // Hardened HTTP security headers + strict Content-Security-Policy (blocks all inline scripts & eval)
  app.use(
    helmet({
      frameguard: env.isProduction ? { action: 'sameorigin' } : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: env.isProduction ? { policy: 'same-origin-allow-popups' } : false,
      crossOriginResourcePolicy: env.isProduction ? { policy: 'same-origin' } : { policy: 'cross-origin' },
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          scriptSrcAttr: ["'none'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          mediaSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'https://api.paystack.co', 'https://checkout.paystack.com'],
          formAction: ["'self'", 'https://accounts.google.com'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors,
        },
      },
    })
  );

  app.use(securityPolicyHeaders);

  // Paystack HMAC-SHA512 webhook endpoint (must parse raw body before express.json)
  const webhookLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 60,
    keyPrefix: 'psk-wh',
    message: 'Too many webhook requests.',
  });
  app.post(
    '/api/paystack/webhook',
    webhookLimiter,
    express.raw({ type: 'application/json', limit: '256kb' }),
    async (req, res) => {
      const signature = req.headers['x-paystack-signature'] || '';
      const rawBuffer = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(JSON.stringify(req.body || {}), 'utf8');
      const result = await paystackService.handlePaystackWebhook({
        rawBody: rawBuffer,
        signature: String(signature),
        ipAddress: req.ip,
      });
      return res.json({ ok: true, ...result });
    }
  );

  app.use(express.json({ limit: '512kb' }));
  app.use(express.urlencoded({ extended: false, limit: '512kb' }));
  app.use(sanitizeRequest);

  // Normalize x-forwarded-proto when behind HTTPS cloud/preview proxies that terminate TLS upstream
  app.use((req, _res, next) => {
    const hostHeader = String(req.headers['x-forwarded-host'] || req.headers.host || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    const originHeader = String(req.headers.origin || req.headers.referer || '').toLowerCase();
    if (
      !req.headers['x-forwarded-proto'] &&
      (hostHeader.endsWith('.e2b.app') ||
        hostHeader.endsWith('.vercel.app') ||
        originHeader.startsWith('https://'))
    ) {
      req.headers['x-forwarded-proto'] = 'https';
    }
    next();
  });

  // Support HMAC-signed session token header/carrier when browsers block third-party iframe cookies
  app.use(injectFallbackSessionCookie);

  // Persistent SQL-backed server-side session (never default MemoryStore)
  const sessionStore = new SqlSessionStore({ ttlMs: env.session.maxAgeMs });
  app.use(
    session({
      name: env.session.cookieName,
      secret: env.session.secret,
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      proxy: true,
      cookie: {
        httpOnly: true,
        secure: env.isProduction ? true : 'auto',
        sameSite: 'lax',
        maxAge: env.session.maxAgeMs,
      },
    })
  );

  // Adapt cookie SameSite + CHIPS Partitioned attribute dynamically when served inside an HTTPS preview iframe
  app.use((req, _res, next) => {
    applySessionCookiePolicy(req);
    next();
  });

  configureGooglePassport();
  app.use(passport.initialize());
  app.use(ensureCsrfToken);

  // Static public assets (CSS & JS only — dashboard HTML views are strictly route-protected in src/views/)
  app.use(
    express.static(path.join(__dirname, 'public'), {
      dotfiles: 'deny',
      index: false,
      etag: true,
      maxAge: env.isProduction ? '1h' : 0,
    })
  );

  // Global API rate limiter against scraping & automated abuse
  const apiRateLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 300,
    keyPrefix: 'api',
    message: 'Too many requests from this network. Please slow down and try again shortly.',
  });
  app.use('/api', noStoreCache, apiRateLimiter);
  app.use('/auth', noStoreCache);
  app.use('/dashboard', noStoreCache);

  // Public health-check endpoint (redacts internal DB driver, file paths & secret config flags)
  app.get('/api/health', async (_req, res) => {
    const dbStatus = await db.healthCheck();
    return res.json({
      ok: Boolean(dbStatus.connected),
      status: dbStatus.connected ? 'healthy' : 'degraded',
      dashboards: ['superadmin', 'teacher', 'student', 'financial'],
      db: { connected: Boolean(dbStatus.connected) },
    });
  });

  // Root & Login routes
  app.get('/', noStoreCache, async (req, res) => {
    if (req.session?.user?.id) {
      const fresh = await userModel.findById(req.session.user.id);
      if (fresh && fresh.status === 'active' && fresh.role) {
        return res.redirect(userModel.dashboardPathForRole(fresh.role));
      }
    }
    return res.redirect('/login');
  });

  app.get('/login', noStoreCache, async (req, res) => {
    if (req.session?.user?.id) {
      const fresh = await userModel.findById(req.session.user.id);
      if (fresh && fresh.status === 'active' && fresh.role) {
        return res.redirect(userModel.dashboardPathForRole(fresh.role));
      }
    }
    await recordSiteHit('login', null);
    return res.sendFile(path.join(__dirname, 'views', 'login.html'));
  });

  // Strictly role-protected Four Dashboards
  const viewsDir = path.join(__dirname, 'views');
  app.get('/dashboard/superadmin', authenticate, authorizeRole('superadmin'), async (req, res) => {
    await recordSiteHit('dashboard:superadmin', req.user);
    res.sendFile(path.join(viewsDir, 'superadmin.html'));
  });
  app.get('/dashboard/teacher', authenticate, authorizeRole('teacher'), async (req, res) => {
    await recordSiteHit('dashboard:teacher', req.user);
    res.sendFile(path.join(viewsDir, 'teacher.html'));
  });
  app.get('/dashboard/student', authenticate, authorizeRole('student'), async (req, res) => {
    await recordSiteHit('dashboard:student', req.user);
    res.sendFile(path.join(viewsDir, 'student.html'));
  });
  app.get('/dashboard/financial', authenticate, authorizeRole('financial'), async (req, res) => {
    await recordSiteHit('dashboard:financial', req.user);
    res.sendFile(path.join(viewsDir, 'financial.html'));
  });

  // Authentication & OAuth 2.0 endpoints
  app.use('/auth', authRoutes);
  app.use('/api/auth', authRoutes);

  // Authenticated, ownership-verified multimedia streaming (PDFs, images, videos, documents)
  app.get('/api/media/:id', authenticate, courseworkService.streamMediaFile);

  // Role-protected API routers
  app.use('/api/superadmin', superadminRoutes);
  app.use('/api/teacher', teacherRoutes);
  app.use('/api/student', studentRoutes);
  app.use('/api/financial', financialRoutes);

  // Non-reflecting 404 handler (never echoes arbitrary URLs back into responses)
  app.use((_req, _res, next) => {
    next(new AppError(404, 'The requested resource was not found.'));
  });

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
