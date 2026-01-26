const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

const DB_PATH = path.resolve(
  process.env.DB_PATH || path.join(ROOT_DIR, 'rebuild.db')
);
const SESSION_DB_PATH = path.resolve(
  process.env.SESSION_DB_PATH || path.join(ROOT_DIR, 'sessions.db')
);

const NODE_ENV = process.env.NODE_ENV || 'development';
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/Puerto_Rico';
const PORT = process.env.PORT || 3000;

const SESSION_SECRET = process.env.SESSION_SECRET || '';
const SESSION_ENCRYPTION_KEY = process.env.SESSION_ENCRYPTION_KEY || '';
const COOKIE_SECURE = process.env.COOKIE_SECURE || '';
const COOKIE_SAMESITE = process.env.COOKIE_SAMESITE || '';

const ENABLE_IN_PROCESS_BACKUPS =
  (process.env.ENABLE_IN_PROCESS_BACKUPS || 'false').toLowerCase() === 'true';

const QBO_CLIENT_ID = process.env.QBO_CLIENT_ID || '';
const QBO_CLIENT_SECRET = process.env.QBO_CLIENT_SECRET || '';
const QBO_REDIRECT_URI = process.env.QBO_REDIRECT_URI || '';
const QBO_API_BASE =
  process.env.QBO_API_BASE || 'https://quickbooks.api.intuit.com/v3/company';
const QBO_DEBUG = (process.env.QBO_DEBUG || '').toLowerCase() === 'true';

const APNS_KEY_PATH = process.env.APNS_KEY_PATH || '';
const APNS_KEY_ID = process.env.APNS_KEY_ID || '';
const APNS_TEAM_ID = process.env.APNS_TEAM_ID || '';
const APNS_BUNDLE_ID = process.env.APNS_BUNDLE_ID || '';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || '';

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = process.env.SMTP_PORT || '';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || '';

function parsePositiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

const NOTIFICATION_RETENTION_DAYS = parsePositiveInt(
  process.env.NOTIFICATION_RETENTION_DAYS,
  90
);
const PHOTO_RETENTION_DAYS = parsePositiveInt(
  process.env.PHOTO_RETENTION_DAYS,
  30
);
const AUDIT_LOG_RETENTION_DAYS = parsePositiveInt(
  process.env.AUDIT_LOG_RETENTION_DAYS,
  365
);
const IDEMPOTENCY_RETENTION_DAYS = parsePositiveInt(
  process.env.IDEMPOTENCY_RETENTION_DAYS,
  30
);

module.exports = {
  ROOT_DIR,
  DB_PATH,
  SESSION_DB_PATH,
  NODE_ENV,
  APP_TIMEZONE,
  PORT,
  SESSION_SECRET,
  SESSION_ENCRYPTION_KEY,
  COOKIE_SECURE,
  COOKIE_SAMESITE,
  ENABLE_IN_PROCESS_BACKUPS,
  QBO_CLIENT_ID,
  QBO_CLIENT_SECRET,
  QBO_REDIRECT_URI,
  QBO_API_BASE,
  QBO_DEBUG,
  APNS_KEY_PATH,
  APNS_KEY_ID,
  APNS_TEAM_ID,
  APNS_BUNDLE_ID,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
  NOTIFICATION_RETENTION_DAYS,
  PHOTO_RETENTION_DAYS,
  AUDIT_LOG_RETENTION_DAYS,
  IDEMPOTENCY_RETENTION_DAYS
};
