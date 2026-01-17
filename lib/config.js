const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

const DB_PATH = process.env.DB_PATH || path.join(ROOT_DIR, 'rebuild.db');

const SEED_ORG_NAME = process.env.SEED_ORG_NAME || 'Avian Group';
const SEED_ORG_TIMEZONE =
  process.env.SEED_ORG_TIMEZONE || 'America/Puerto_Rico';
const SEED_ADMIN_NAME = process.env.SEED_ADMIN_NAME || 'Admin';
const SEED_COMPANY_EMAIL = process.env.SEED_COMPANY_EMAIL || '';

const SEED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || '';
const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || '';

module.exports = {
  ROOT_DIR,
  DB_PATH,
  SEED_ORG_NAME,
  SEED_ORG_TIMEZONE,
  SEED_ADMIN_NAME,
  SEED_COMPANY_EMAIL,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD
};
