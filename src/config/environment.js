const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';
const isVercel = Boolean(process.env.VERCEL);

const SESSION_SECRET = process.env.SESSION_SECRET || '';
if (isProduction && (!SESSION_SECRET || SESSION_SECRET.length < 32 || SESSION_SECRET.includes('replace_with'))) {
  throw new Error('Configuration error: SESSION_SECRET must be at least 32 strong characters in production.');
}

const defaultDbDriver = process.env.DB_DRIVER
  ? process.env.DB_DRIVER.toLowerCase()
  : isVercel && !process.env.DB_HOST
    ? 'sqlite'
    : 'mysql';

const defaultSqlitePath = process.env.SQLITE_PATH
  ? path.resolve(process.cwd(), process.env.SQLITE_PATH)
  : isVercel
    ? '/tmp/sms_vercel.sqlite'
    : path.resolve(process.cwd(), './data/sms_dev.sqlite');

const env = {
  nodeEnv: NODE_ENV,
  isProduction,
  isVercel,
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  appBaseUrl:
    process.env.APP_BASE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : `http://localhost:${process.env.PORT || '3000'}`),
  backupsDir: isVercel ? '/tmp/backups' : path.resolve(process.cwd(), 'backups'),

  db: {
    driver: defaultDbDriver,
    autoFallback: process.env.DB_AUTO_FALLBACK !== 'false' && (!isProduction || isVercel),
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    name: process.env.DB_NAME || 'school_management',
    user: process.env.DB_USER || 'sms_app_user',
    password: process.env.DB_PASSWORD || '',
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
    sqlitePath: defaultSqlitePath,
  },

  session: {
    secret: SESSION_SECRET || 'dev_fallback_secret_change_before_production_92f8a1b4c7d6e5f0',
    cookieName: process.env.SESSION_COOKIE_NAME || 'sms.sid',
    maxAgeMs: parseInt(process.env.SESSION_MAX_AGE_MS || String(8 * 60 * 60 * 1000), 10),
  },

  google: {
    clientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
    clientSecret: (process.env.GOOGLE_CLIENT_SECRET || '').trim(),
    callbackUrl: (process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback').trim(),
    autoLinkVerifiedEmail: process.env.GOOGLE_AUTO_LINK_VERIFIED_EMAIL !== 'false',
    get isConfigured() {
      return Boolean(this.clientId && this.clientSecret);
    },
  },

  otp: {
    // Optional outbound gateways. When left blank, one-time sign-in codes are issued in
    // interactive sandbox mode (non-production only) instead of being emailed/texted.
    emailWebhookUrl: (process.env.OTP_EMAIL_WEBHOOK_URL || '').trim(),
    smsWebhookUrl: (process.env.OTP_SMS_WEBHOOK_URL || '').trim(),
    codeTtlSeconds: parseInt(process.env.OTP_CODE_TTL_SECONDS || '600', 10),
    get isEmailGatewayConfigured() {
      return Boolean(this.emailWebhookUrl);
    },
    get isSmsGatewayConfigured() {
      return Boolean(this.smsWebhookUrl);
    },
  },

  paystack: {
    publicKey: (process.env.PAYSTACK_PUBLIC_KEY || '').trim(),
    secretKey: (process.env.PAYSTACK_SECRET_KEY || '').trim(),
    callbackUrl: (process.env.PAYSTACK_CALLBACK_URL || '/dashboard/financial').trim(),
    apiBaseUrl: 'https://api.paystack.co',
    get isLiveConfigured() {
      return Boolean(this.secretKey);
    },
    get mode() {
      if (!this.secretKey) return 'sandbox';
      return this.secretKey.startsWith('sk_live_') ? 'live' : 'test';
    },
  },

  defaults: {
    currencyCode: (process.env.DEFAULT_CURRENCY_CODE || 'GHS').toUpperCase(),
    currencySymbol: process.env.DEFAULT_CURRENCY_SYMBOL || 'GH₵',
    timezone: process.env.SCHOOL_TIMEZONE || 'Africa/Accra',
    autoSeedDemo: process.env.AUTO_SEED_DEMO === 'true' && !isProduction,
    superadminEmail: (process.env.SUPERADMIN_INITIAL_EMAIL || 'admin@school.edu.gh').toLowerCase(),
    superadminPassword: process.env.SUPERADMIN_INITIAL_PASSWORD || 'Admin@2026!',
  },
};

module.exports = env;
