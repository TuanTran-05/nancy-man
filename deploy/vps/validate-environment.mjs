const required = [
  'NODE_ENV',
  'DEPLOYMENT_STAGE',
  'APP_URL',
  'PUBLIC_BASE_URL',
  'INTERNAL_API_BASE_URL',
  'APP_COMMIT_SHA',
  'GLOBAL_WRITE_FREEZE',
  'DATABASE_URL',
  'STORAGE_LOCAL_ROOT',
  'STORAGE_SIGNING_SECRET',
  'SESSION_SECRET',
  'OTP_PEPPER',
  'LOOKUP_CHALLENGE_SECRET',
  'CRON_SECRET',
  'VITE_TURNSTILE_SITE_KEY',
  'TURNSTILE_SECRET_KEY',
];

const missing = required.filter((name) => !process.env[name]?.trim());
if (process.env.NODE_ENV && process.env.NODE_ENV !== 'production') {
  throw new Error('NODE_ENV must be production');
}
if (
  process.env.DEPLOYMENT_STAGE &&
  !['staging', 'production'].includes(process.env.DEPLOYMENT_STAGE)
) {
  throw new Error('DEPLOYMENT_STAGE must be staging or production');
}
if (process.env.APP_COMMIT_SHA && !/^[0-9a-f]{40}$/i.test(process.env.APP_COMMIT_SHA)) {
  throw new Error('APP_COMMIT_SHA must be a full 40-character Git commit SHA');
}
if (
  process.env.GLOBAL_WRITE_FREEZE &&
  !['true', 'false'].includes(process.env.GLOBAL_WRITE_FREEZE)
) {
  throw new Error('GLOBAL_WRITE_FREEZE must be true or false');
}
if (
  process.env.CANONICAL_STUDENT_READ_MODE &&
  !['legacy_compare', 'canonical_preferred', 'canonical_required'].includes(
    process.env.CANONICAL_STUDENT_READ_MODE
  )
) {
  throw new Error(
    'CANONICAL_STUDENT_READ_MODE must be legacy_compare, canonical_preferred, or canonical_required'
  );
}
const backupMode = process.env.POSTGRES_BACKUP_MODE?.trim() || '';
const backupDiskLimit = process.env.POSTGRES_BACKUP_MAX_DISK_USAGE_PERCENT?.trim() || '';
if (backupMode && !['local', 'offsite'].includes(backupMode)) {
  throw new Error('POSTGRES_BACKUP_MODE must be local or offsite');
}
if (
  backupDiskLimit &&
  (!/^\d+$/.test(backupDiskLimit) || Number(backupDiskLimit) < 50 || Number(backupDiskLimit) > 95)
) {
  throw new Error('POSTGRES_BACKUP_MAX_DISK_USAGE_PERCENT must be an integer from 50 to 95');
}
if (process.env.DEPLOYMENT_STAGE === 'production') {
  const ageRecipient = process.env.POSTGRES_BACKUP_AGE_RECIPIENT?.trim() || '';
  const offsiteRemote = process.env.POSTGRES_BACKUP_RCLONE_REMOTE?.trim() || '';
  if (!backupMode) {
    throw new Error('Production requires POSTGRES_BACKUP_MODE=local or offsite');
  }
  if (!backupDiskLimit) {
    throw new Error('Production requires POSTGRES_BACKUP_MAX_DISK_USAGE_PERCENT');
  }
  if (!ageRecipient.startsWith('age1') && !ageRecipient.startsWith('ssh-')) {
    throw new Error('Production requires a valid POSTGRES_BACKUP_AGE_RECIPIENT');
  }
  if (backupMode === 'offsite' && !/^[A-Za-z0-9._-]+:.+/.test(offsiteRemote)) {
    throw new Error('Production requires POSTGRES_BACKUP_RCLONE_REMOTE outside the VPS');
  }
  if (backupMode === 'local') {
    console.warn('WARNING: POSTGRES_BACKUP_MODE=local cannot recover from total VPS or disk loss');
  }
}

if (process.env.DEPLOYMENT_STAGE === 'staging') {
  if (process.env.ZALO_BOT_ENABLED !== 'false') {
    throw new Error('Staging preparation must keep ZALO_BOT_ENABLED=false');
  }
  if (process.env.ZALO_BOT_DAILY_DIGEST_ENABLED !== 'false') {
    throw new Error('Staging preparation must keep ZALO_BOT_DAILY_DIGEST_ENABLED=false');
  }
  if (process.env.ZALO_BOT_DRY_RUN !== 'true') {
    throw new Error('Staging preparation must keep ZALO_BOT_DRY_RUN=true');
  }
  if (process.env.ZALO_BOT_ADMIN_SNAPSHOT_REFRESH_ENABLED !== 'false') {
    throw new Error('Staging preparation must keep ZALO_BOT_ADMIN_SNAPSHOT_REFRESH_ENABLED=false');
  }
}

function assertOrigin(name, raw, { allowLoopbackHttp = false, requireLoopback = false } = {}) {
  if (!raw) return;
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
}

for (const origin of String(process.env.APP_URL || '')
  .split(',')
  .filter(Boolean)) {
  assertOrigin('APP_URL', origin.trim());
}
assertOrigin('PUBLIC_BASE_URL', process.env.PUBLIC_BASE_URL);
assertOrigin('INTERNAL_API_BASE_URL', process.env.INTERNAL_API_BASE_URL, {
  allowLoopbackHttp: true,
  requireLoopback: true,
});
if (process.env.STORAGE_BACKEND && process.env.STORAGE_BACKEND !== 'local') {
  throw new Error('STORAGE_BACKEND must be local');
}
if (process.env.STORAGE_LOCAL_ROOT && !process.env.STORAGE_LOCAL_ROOT.startsWith('/')) {
  throw new Error('STORAGE_LOCAL_ROOT must be an absolute path');
}
if (process.env.STORAGE_SIGNING_SECRET && process.env.STORAGE_SIGNING_SECRET.trim().length < 32) {
  throw new Error('STORAGE_SIGNING_SECRET must contain at least 32 characters');
}
if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length < 32) {
  throw new Error('SESSION_SECRET must contain at least 32 characters');
}

if (process.env.DATABASE_URL) {
  const database = new URL(process.env.DATABASE_URL);
  if (database.protocol !== 'postgres:' || database.hostname !== '127.0.0.1') {
    throw new Error('DATABASE_URL must target local PostgreSQL on the VPS');
  }
}

console.log(`Environment variables checked: ${required.length}`);
console.log(`Missing required: ${missing.join(', ') || 'none'}`);
if (missing.length > 0) process.exitCode = 2;
