const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const env = require('./environment');
const db = require('./database');
const logger = require('../utils/logger');

let activeSignature = '';

function deriveCallbackUrl(req) {
  const envCb = String(env.google.callbackUrl || '').trim();
  if (envCb && envCb.startsWith('http') && !envCb.includes('localhost')) {
    return envCb;
  }
  if (req && typeof req.get === 'function') {
    const forwardedHost = String(req.headers?.['x-forwarded-host'] || '')
      .split(',')[0]
      .trim();
    const rawHost = forwardedHost || req.get('host') || '';
    if (rawHost && !rawHost.startsWith('127.0.0.1') && !rawHost.startsWith('localhost')) {
      const proto =
        req.secure ||
        String(req.headers?.['x-forwarded-proto'] || '').includes('https') ||
        rawHost.endsWith('.e2b.app')
          ? 'https'
          : req.protocol || 'http';
      return `${proto}://${rawHost}/auth/google/callback`;
    }
    if (process.env.E2B_SANDBOX_ID && !String(process.env.SQLITE_PATH || '').startsWith('/tmp/')) {
      return `https://${env.port}-${process.env.E2B_SANDBOX_ID}.e2b.app/auth/google/callback`;
    }
    if (rawHost) {
      const proto =
        req.secure || String(req.headers?.['x-forwarded-proto'] || '').includes('https')
          ? 'https'
          : req.protocol || 'http';
      return `${proto}://${rawHost}/auth/google/callback`;
    }
  }
  if (envCb && envCb.startsWith('http')) {
    return envCb;
  }
  return `${env.appBaseUrl}/auth/google/callback`;
}

async function resolveGoogleOAuthSettings(req = null) {
  let settings = null;
  try {
    settings = await db.get(
      'SELECT google_oauth_enabled, google_client_id, google_client_secret FROM school_settings WHERE id = 1'
    );
  } catch (_) {
    settings = null;
  }

  const enabled = settings
    ? settings.google_oauth_enabled === undefined || settings.google_oauth_enabled === null
      ? true
      : Boolean(settings.google_oauth_enabled)
    : true;

  const clientId = String(settings?.google_client_id || env.google.clientId || '').trim();
  const clientSecret = String(
    settings?.google_client_secret || env.google.clientSecret || ''
  ).trim();
  const isLiveConfigured = Boolean(clientId && clientSecret);
  const isSandboxMode = Boolean(enabled && !isLiveConfigured && !env.isProduction);
  const isAvailable = Boolean(enabled && (isLiveConfigured || isSandboxMode));
  const callbackUrl = deriveCallbackUrl(req);

  return {
    enabled,
    clientId,
    clientSecret,
    isLiveConfigured,
    isSandboxMode,
    isAvailable,
    mode: isLiveConfigured ? 'live' : isSandboxMode ? 'sandbox' : 'disabled',
    callbackUrl,
  };
}

function configureGooglePassport(customCfg = null) {
  const clientId = String(customCfg?.clientId ?? env.google.clientId ?? '').trim();
  const clientSecret = String(customCfg?.clientSecret ?? env.google.clientSecret ?? '').trim();
  const callbackUrl = String(customCfg?.callbackUrl ?? env.google.callbackUrl ?? '/auth/google/callback').trim();

  if (!clientId || !clientSecret) {
    return passport;
  }

  const sig = `${clientId}:${clientSecret}:${callbackUrl}`;
  if (sig === activeSignature) {
    return passport;
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID: clientId,
        clientSecret,
        callbackURL: callbackUrl,
        passReqToCallback: true,
      },
      async (_req, _accessToken, _refreshToken, profile, done) => {
        try {
          const primaryEmailObj = Array.isArray(profile.emails) ? profile.emails[0] : null;
          const email = primaryEmailObj?.value || profile._json?.email || '';
          const emailVerified = Boolean(
            primaryEmailObj?.verified ?? profile._json?.email_verified ?? true
          );
          const avatarUrl =
            Array.isArray(profile.photos) && profile.photos[0]?.value
              ? profile.photos[0].value
              : '';

          return done(null, {
            googleSubjectId: String(profile.id || profile._json?.sub || ''),
            email,
            emailVerified,
            displayName: profile.displayName || '',
            avatarUrl,
          });
        } catch (err) {
          return done(err);
        }
      }
    )
  );

  activeSignature = sig;
  logger.info('Configured Passport Google OAuth 2.0 strategy', { callbackUrl });
  return passport;
}

module.exports = {
  configureGooglePassport,
  resolveGoogleOAuthSettings,
};
