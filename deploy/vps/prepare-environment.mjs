import { randomBytes } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const [sourcePath, targetPath] = process.argv.slice(2);
const databasePassword = process.env.VPS_DATABASE_PASSWORD;
const publicOriginValue = process.env.VPS_PUBLIC_ORIGIN?.trim();
const deploymentStage = process.env.VPS_DEPLOYMENT_STAGE?.trim() || 'staging';
if (!sourcePath || !targetPath || !databasePassword || !publicOriginValue) {
  throw new Error(
    'Usage: VPS_DATABASE_PASSWORD=... VPS_PUBLIC_ORIGIN=https://vps.thienuy.edu.vn node prepare-environment.mjs <source-env> <target-env>'
  );
}
if (!['staging', 'production'].includes(deploymentStage)) {
  throw new Error('VPS_DEPLOYMENT_STAGE must be staging or production');
}
if (deploymentStage === 'production' && process.env.VPS_CONFIRM_PRODUCTION_CUTOVER !== 'approved') {
  throw new Error(
    'Refusing to prepare a production environment without VPS_CONFIRM_PRODUCTION_CUTOVER=approved'
  );
}

const source = parseEnv(readFileSync(sourcePath, 'utf8'));
const randomSecret = () => randomBytes(32).toString('hex');
const externalSecret = (name) =>
  deploymentStage === 'production' ? source[name] || '' : process.env[`VPS_${name}`]?.trim() || '';
const normalizeOrigin = (
  raw,
  name,
  { allowLoopbackHttp = false, requireLoopback = false } = {}
) => {
  const parsed = new URL(raw);
  const loopback =
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === 'localhost' ||
    parsed.hostname === '[::1]';
  if (requireLoopback && !loopback) {
    throw new Error(`${name} must target localhost or a loopback IP address`);
  }
  if (
    parsed.protocol !== 'https:' &&
    !(allowLoopbackHttp && loopback && parsed.protocol === 'http:')
  ) {
    throw new Error(`${name} must use HTTPS${allowLoopbackHttp ? ' or loopback HTTP' : ''}`);
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== '/'
  ) {
    throw new Error(`${name} must be an origin without credentials, path, query, or fragment`);
  }
  return parsed.origin;
};
const publicOrigin = normalizeOrigin(publicOriginValue, 'VPS_PUBLIC_ORIGIN');
const internalApiBaseUrl = normalizeOrigin(
  process.env.VPS_INTERNAL_API_BASE_URL?.trim() || 'http://127.0.0.1:3000',
  'VPS_INTERNAL_API_BASE_URL',
  { allowLoopbackHttp: true, requireLoopback: true }
);
const appUrl = (process.env.VPS_APP_URL?.trim() || publicOrigin)
  .split(',')
  .map((origin) => normalizeOrigin(origin.trim(), 'VPS_APP_URL'))
  .join(',');
const publicHostname = new URL(publicOrigin).hostname;

const values = {
  NODE_ENV: 'production',
  DEPLOYMENT_STAGE: deploymentStage,
  HOST: '127.0.0.1',
  PORT: '3000',
  TZ: 'Asia/Ho_Chi_Minh',
  APP_URL: appUrl,
  PUBLIC_BASE_URL: publicOrigin,
  INTERNAL_API_BASE_URL: internalApiBaseUrl,
  APP_COMMIT_SHA: process.env.APP_COMMIT_SHA || source.APP_COMMIT_SHA || '',
  GLOBAL_WRITE_FREEZE: 'false',

  DATABASE_URL: `postgres://edutrack:${encodeURIComponent(databasePassword)}@127.0.0.1:5432/edutrack`,
  POSTGRES_POOL_MAX: '10',
  POSTGRES_IDLE_TIMEOUT_MS: '30000',
  POSTGRES_CONNECT_TIMEOUT_MS: '5000',
  POSTGRES_APPLICATION_NAME: 'edutrack-api',
  POSTGRES_SSL: 'disable',

  STORAGE_BACKEND: 'local',
  STORAGE_LOCAL_ROOT: '/srv/edutrack/shared/uploads',
  STORAGE_SIGNING_SECRET: randomSecret(),
  SESSION_SECRET: randomSecret(),
  VITE_REALTIME_POLL_MS: '10000',

  VITE_ENABLE_ACCOUNTING_STUDENT_WORKSPACE: 'true',
  VITE_ENABLE_DIRECT_STUDENT_SNAPSHOTS: 'false',

  // Staging never inherits credentials that can charge or notify real users.
  // Supply explicit VPS_* sandbox credentials when those integrations are tested.
  PAYOS_ENABLED: 'false',
  VITE_PAYOS_ENABLED: 'false',
  PAYOS_CLIENT_ID: externalSecret('PAYOS_CLIENT_ID'),
  PAYOS_API_KEY: externalSecret('PAYOS_API_KEY'),
  PAYOS_CHECKSUM_KEY: externalSecret('PAYOS_CHECKSUM_KEY'),
  PAYOS_RETURN_URL: process.env.VPS_PAYOS_RETURN_URL || `${publicOrigin}/parent/tuition`,
  PAYOS_CANCEL_URL: process.env.VPS_PAYOS_CANCEL_URL || `${publicOrigin}/parent/tuition`,

  VITE_TURNSTILE_SITE_KEY: source.VITE_TURNSTILE_SITE_KEY || '',
  TURNSTILE_SECRET_KEY: source.TURNSTILE_SECRET_KEY || '',
  TURNSTILE_EXPECTED_HOSTNAME: process.env.VPS_TURNSTILE_EXPECTED_HOSTNAME || publicHostname,

  POSTGRES_BACKUP_MODE:
    deploymentStage === 'production' ? source.POSTGRES_BACKUP_MODE || 'offsite' : 'local',
  POSTGRES_BACKUP_DIR: '/srv/edutrack/shared/backups/postgres',
  POSTGRES_BACKUP_RETENTION_DAYS: source.POSTGRES_BACKUP_RETENTION_DAYS || '14',
  POSTGRES_BACKUP_MAX_DISK_USAGE_PERCENT: source.POSTGRES_BACKUP_MAX_DISK_USAGE_PERCENT || '85',
  POSTGRES_BACKUP_AGE_RECIPIENT: externalSecret('POSTGRES_BACKUP_AGE_RECIPIENT'),
  POSTGRES_BACKUP_RCLONE_REMOTE: externalSecret('POSTGRES_BACKUP_RCLONE_REMOTE'),

  CRON_SECRET: source.CRON_SECRET || randomSecret(),
  OTP_PEPPER: randomSecret(),
  LOOKUP_CHALLENGE_SECRET: randomSecret(),
  GEMINI_API_KEY: externalSecret('GEMINI_API_KEY'),

  ZALO_OA_ACCESS_TOKEN: externalSecret('ZALO_OA_ACCESS_TOKEN'),
  ZALO_OA_ID: externalSecret('ZALO_OA_ID'),
  ZALO_APP_ID: externalSecret('ZALO_APP_ID'),
  ZALO_APP_SECRET: externalSecret('ZALO_APP_SECRET'),
  ZALO_REFRESH_TOKEN: externalSecret('ZALO_REFRESH_TOKEN'),
  ZALO_ZNS_TEMPLATE_ID: externalSecret('ZALO_ZNS_TEMPLATE_ID'),
  ZALO_ZNS_OTP_TEMPLATE_ID: externalSecret('ZALO_ZNS_OTP_TEMPLATE_ID'),
  ZALO_ZNS_EVAL_TEMPLATE_ID: externalSecret('ZALO_ZNS_EVAL_TEMPLATE_ID'),
  ZALO_ZNS_STAFF_TEMPLATE_ID: externalSecret('ZALO_ZNS_STAFF_TEMPLATE_ID'),
  ZALO_ZNS_PAYMENT_TEMPLATE_ID: externalSecret('ZALO_ZNS_PAYMENT_TEMPLATE_ID'),
  ZALO_ZNS_TUITION_NOTICE_TEMPLATE_ID: externalSecret('ZALO_ZNS_TUITION_NOTICE_TEMPLATE_ID'),
  ZALO_ZNS_NEXT_COURSE_TUITION_TEMPLATE_ID: externalSecret(
    'ZALO_ZNS_NEXT_COURSE_TUITION_TEMPLATE_ID'
  ),
  ZALO_ZNS_RANK_TEMPLATE_ID: externalSecret('ZALO_ZNS_RANK_TEMPLATE_ID'),

  ZALO_BOT_TOKEN: externalSecret('ZALO_BOT_TOKEN'),
  ZALO_BOT_WEBHOOK_SECRET: externalSecret('ZALO_BOT_WEBHOOK_SECRET'),
  ZALO_BOT_LINK_CODE_PEPPER: externalSecret('ZALO_BOT_LINK_CODE_PEPPER'),
  ZALO_BOT_CHAT_HASH_SECRET: externalSecret('ZALO_BOT_CHAT_HASH_SECRET'),
  ZALO_BOT_REQUEST_TIMEOUT_MS: source.ZALO_BOT_REQUEST_TIMEOUT_MS || '10000',
  ZALO_BOT_ENABLED: deploymentStage === 'production' ? source.ZALO_BOT_ENABLED || 'false' : 'false',
  ZALO_BOT_DAILY_DIGEST_ENABLED:
    deploymentStage === 'production' ? source.ZALO_BOT_DAILY_DIGEST_ENABLED || 'false' : 'false',
  ZALO_BOT_DRY_RUN: deploymentStage === 'production' ? source.ZALO_BOT_DRY_RUN || 'true' : 'true',
  ZALO_BOT_CHAT_ENABLED:
    deploymentStage === 'production' ? source.ZALO_BOT_CHAT_ENABLED || 'false' : 'false',
  ZALO_BOT_ADMIN_DATA_ENABLED:
    deploymentStage === 'production' ? source.ZALO_BOT_ADMIN_DATA_ENABLED || 'false' : 'false',
  ZALO_BOT_ADMIN_INTENTS_ENABLED: source.ZALO_BOT_ADMIN_INTENTS_ENABLED || '',
  ZALO_BOT_ADMIN_SNAPSHOT_REFRESH_ENABLED:
    deploymentStage === 'production'
      ? source.ZALO_BOT_ADMIN_SNAPSHOT_REFRESH_ENABLED || 'false'
      : 'false',
  ZALO_BOT_ADMIN_PILOT_UIDS: source.ZALO_BOT_ADMIN_PILOT_UIDS || '',
  ZALO_BOT_ADMIN_READ_AUDIT_RETENTION_DAYS: source.ZALO_BOT_ADMIN_READ_AUDIT_RETENTION_DAYS || '90',

  CANONICAL_STUDENT_READ_MODE: 'legacy_compare',
  STUDENT_IDENTITY_MAINTENANCE_REQUIRED: 'false',
};

function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

const output = Object.entries(values)
  .map(([name, value]) => `${name}=${quote(value)}`)
  .join('\n');
writeFileSync(targetPath, `${output}\n`, { encoding: 'utf8', mode: 0o600 });
chmodSync(targetPath, 0o600);

const missingRequired = ['VITE_TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'].filter(
  (name) => !values[name]
);
const missingOptional = ['PAYOS_API_KEY', 'PAYOS_CHECKSUM_KEY', 'GEMINI_API_KEY'].filter(
  (name) => !values[name]
);
console.log(`Prepared VPS environment with ${Object.keys(values).length} variables`);
console.log(`Missing required: ${missingRequired.join(', ') || 'none'}`);
console.log(`Missing optional: ${missingOptional.join(', ') || 'none'}`);
