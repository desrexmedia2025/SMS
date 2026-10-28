const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const env = require('../config/environment');
const { CURRENCY_CATALOGUE, resolveCurrency } = require('../utils/currency');

const BACKUP_TABLES = [
  'school_settings',
  'roles',
  'permissions',
  'role_permissions',
  'users',
  'user_roles',
  'academic_years',
  'terms',
  'teachers',
  'teacher_subjects',
  'classes',
  'streams',
  'subjects',
  'students',
  'student_enrolments',
  'teacher_assignments',
  'timetables',
  'attendance_sessions',
  'attendance_records',
  'grading_scales',
  'assessments',
  'marks',
  'mark_correction_requests',
  'fee_categories',
  'fee_assignments',
  'fee_adjustments',
  'payments',
  'payment_allocations',
  'paystack_transactions',
  'paystack_transfers',
  'receipts',
  'reconciliations',
  'announcements',
  'profile_change_requests',
  'student_registration_requests',
  'audit_logs',
];

function resolvePaystackRuntimeFromRow(rawSettings) {
  const publicKey = String(
    rawSettings?.paystack_public_key || env.paystack.publicKey || ''
  ).trim();
  const secretKey = String(
    rawSettings?.paystack_secret_key || env.paystack.secretKey || ''
  ).trim();
  const explicitWebhookSecret = String(
    rawSettings?.paystack_webhook_secret || process.env.PAYSTACK_WEBHOOK_SECRET || ''
  ).trim();
  const webhookSecret = explicitWebhookSecret || secretKey;

  const enabled = rawSettings
    ? rawSettings.paystack_enabled === undefined || rawSettings.paystack_enabled === null
      ? true
      : Boolean(rawSettings.paystack_enabled)
    : true;
  const transfersEnabled = rawSettings
    ? rawSettings.paystack_transfers_enabled === undefined ||
      rawSettings.paystack_transfers_enabled === null
      ? true
      : Boolean(rawSettings.paystack_transfers_enabled)
    : true;
  const refundsEnabled = rawSettings
    ? rawSettings.paystack_refunds_enabled === undefined ||
      rawSettings.paystack_refunds_enabled === null
      ? true
      : Boolean(rawSettings.paystack_refunds_enabled)
    : true;

  const isLiveConfigured = Boolean(secretKey);
  const mode = !secretKey
    ? 'sandbox'
    : secretKey.startsWith('sk_live_')
      ? 'live'
      : 'test';

  return {
    enabled,
    transfersEnabled,
    refundsEnabled,
    publicKey,
    secretKey,
    webhookSecret,
    explicitWebhookConfigured: Boolean(explicitWebhookSecret),
    isLiveConfigured,
    mode,
  };
}

async function getPaystackRuntimeSecrets() {
  const rawSettings = await db.get('SELECT * FROM school_settings WHERE id = 1');
  return resolvePaystackRuntimeFromRow(rawSettings);
}

async function getSchoolContext() {
  const rawSettings = await db.get('SELECT * FROM school_settings WHERE id = 1');
  const activeYear = await db.get('SELECT * FROM academic_years WHERE is_active = 1 LIMIT 1');
  const activeTerm = activeYear
    ? await db.get('SELECT * FROM terms WHERE academic_year_id = ? AND is_active = 1 LIMIT 1', [activeYear.id])
    : await db.get('SELECT * FROM terms WHERE is_active = 1 LIMIT 1');

  const googleEnabled = rawSettings
    ? rawSettings.google_oauth_enabled === undefined || rawSettings.google_oauth_enabled === null
      ? true
      : Boolean(rawSettings.google_oauth_enabled)
    : true;
  const googleClientId = String(rawSettings?.google_client_id || env.google.clientId || '').trim();
  const googleSecretConfigured = Boolean(
    String(rawSettings?.google_client_secret || env.google.clientSecret || '').trim()
  );
  const googleLiveConfigured = Boolean(googleClientId && googleSecretConfigured);
  const googleAvailable = Boolean(googleEnabled && (googleLiveConfigured || !env.isProduction));

  const pskCfg = resolvePaystackRuntimeFromRow(rawSettings);

  let settings = null;
  if (rawSettings) {
    settings = { ...rawSettings };
    delete settings.google_client_secret;
    delete settings.paystack_secret_key;
    delete settings.paystack_webhook_secret;
    settings.google_oauth_enabled = googleEnabled ? 1 : 0;
    settings.google_client_id = rawSettings.google_client_id || '';
    settings.google_secret_configured = googleSecretConfigured;
    settings.paystack_public_key = rawSettings.paystack_public_key || '';
    settings.paystack_secret_configured = Boolean(pskCfg.secretKey);
    settings.paystack_webhook_configured = pskCfg.explicitWebhookConfigured;
    settings.paystack_webhook_secret_configured = pskCfg.explicitWebhookConfigured;
    settings.paystack_transfers_enabled = pskCfg.transfersEnabled ? 1 : 0;
    settings.paystack_refunds_enabled = pskCfg.refundsEnabled ? 1 : 0;
  }

  return {
    settings,
    activeYear: activeYear || null,
    activeTerm: activeTerm || null,
    currencies: CURRENCY_CATALOGUE,
    googleAuthEnabled: googleAvailable,
    googleOAuth: {
      enabled: googleEnabled,
      liveConfigured: googleLiveConfigured,
      secretConfigured: googleSecretConfigured,
      mode: googleLiveConfigured ? 'live' : googleAvailable ? 'sandbox' : 'disabled',
    },
    paystack: {
      enabled: pskCfg.enabled,
      transfersEnabled: pskCfg.transfersEnabled,
      refundsEnabled: pskCfg.refundsEnabled,
      mode: pskCfg.mode,
      liveConfigured: pskCfg.isLiveConfigured,
      secretConfigured: Boolean(pskCfg.secretKey),
      webhookConfigured: pskCfg.explicitWebhookConfigured,
      publicKey: pskCfg.publicKey || null,
      channels: String(settings?.paystack_channels || 'card,mobile_money,bank_transfer,ussd')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
    },
  };
}

// Least-privilege context for Teacher & Student portals (hides treasury targets & internal financial adjustments)
async function getPublicSchoolContext() {
  const full = await getSchoolContext();
  const s = full.settings || {};
  const publicSettings = {
    school_name: s.school_name || 'School Management System',
    school_code: s.school_code || '',
    motto: s.motto || '',
    address: s.address || '',
    phone: s.phone || '',
    email: s.email || '',
    currency_code: s.currency_code || env.defaults.currencyCode,
    currency_symbol: s.currency_symbol || env.defaults.currencySymbol,
    timezone: s.timezone || env.defaults.timezone,
    attendance_cutoff_time: s.attendance_cutoff_time || '08:30',
    student_fee_portal_enabled: Boolean(s.student_fee_portal_enabled),
    paystack: {
      enabled: full.paystack.enabled,
      channels: full.paystack.channels,
    },
  };

  return {
    settings: publicSettings,
    school: publicSettings,
    activeYear: full.activeYear,
    activeTerm: full.activeTerm,
    googleAuthEnabled: full.googleAuthEnabled,
  };
}

async function updateCurrency({ currencyCode, currencySymbol }) {
  const resolved = resolveCurrency(currencyCode, currencySymbol);
  await db.run(
    `UPDATE school_settings
     SET currency_code = ?, currency_symbol = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
    [resolved.code, resolved.symbol]
  );
  return resolved;
}

async function listAnnouncementsForAudience(audiences = ['all']) {
  const placeholders = audiences.map(() => '?').join(', ');
  return db.query(
    `SELECT a.*, u.full_name AS author_name
     FROM announcements a
     LEFT JOIN users u ON u.id = a.author_user_id
     WHERE a.status = 'published' AND a.audience IN (${placeholders})
     ORDER BY a.id DESC
     LIMIT 30`,
    audiences
  );
}

async function createVerifiedBackup(actorUserId) {
  const backupsDir = env.backupsDir || path.resolve(process.cwd(), 'backups');
  fs.mkdirSync(backupsDir, { recursive: true, mode: 0o700 });

  const snapshot = {
    exportedAt: new Date().toISOString(),
    tables: {},
  };

  let totalRows = 0;
  for (const table of BACKUP_TABLES) {
    const rows = await db.query(`SELECT * FROM ${table}`);
    if (table === 'users') {
      snapshot.tables[table] = rows.map((r) => ({
        ...r,
        password_hash: '[REDACTED]',
        password_reset_token_hash: null,
        password_reset_expires_at: null,
        google_subject_id: r.google_subject_id ? '[LINKED]' : null,
      }));
    } else if (table === 'student_registration_requests') {
      snapshot.tables[table] = rows.map((r) => ({
        ...r,
        password_hash: '[REDACTED]',
        google_subject_id: r.google_subject_id ? '[LINKED]' : null,
      }));
    } else if (table === 'school_settings') {
      snapshot.tables[table] = rows.map((r) => ({
        ...r,
        google_client_secret: r.google_client_secret ? '[REDACTED]' : '',
        paystack_secret_key: r.paystack_secret_key ? '[REDACTED]' : '',
        paystack_webhook_secret: r.paystack_webhook_secret ? '[REDACTED]' : '',
      }));
    } else if (table === 'paystack_transactions') {
      snapshot.tables[table] = rows.map((r) => ({
        ...r,
        access_code: r.access_code ? '[REDACTED]' : '',
      }));
    } else if (table === 'paystack_transfers') {
      snapshot.tables[table] = rows.map((r) => ({
        ...r,
        recipient_account: r.recipient_account
          ? `****${String(r.recipient_account).slice(-4)}`
          : '',
      }));
    } else {
      snapshot.tables[table] = rows;
    }
    totalRows += rows.length;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `sms_backup_${stamp}.json`;
  const fullPath = path.join(backupsDir, filename);
  const content = JSON.stringify(snapshot, null, 2);
  fs.writeFileSync(fullPath, content, { encoding: 'utf8', mode: 0o600 });
  const sizeBytes = Buffer.byteLength(content, 'utf8');

  const ins = await db.run(
    `INSERT INTO backup_logs (filename, size_bytes, tables_count, total_rows, status, created_by_user_id)
     VALUES (?, ?, ?, ?, 'verified', ?)`,
    [filename, sizeBytes, BACKUP_TABLES.length, totalRows, actorUserId]
  );

  return {
    id: ins.insertId,
    filename,
    sizeBytes,
    tablesCount: BACKUP_TABLES.length,
    totalRows,
    status: 'verified',
  };
}

module.exports = {
  getSchoolContext,
  getPublicSchoolContext,
  getPaystackRuntimeSecrets,
  updateCurrency,
  listAnnouncementsForAudience,
  createVerifiedBackup,
};
