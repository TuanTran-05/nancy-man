import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { parseEnv } from 'node:util';

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const retiredPlatformArtifacts = [
  '.firebaserc',
  '.vercel',
  '.vercelignore',
  'database.rules.json',
  'firebase.json',
  'firebase-applet-config.json',
  'firebase-blueprint.json',
  'documentStore.indexes.json',
  'documentStore.rules',
  'service-account-key.json',
  'storage.rules',
  'vercel.json',
];
for (const relativePath of retiredPlatformArtifacts) {
  check(!existsSync(relativePath), `Retired platform artifact must stay removed: ${relativePath}`);
}

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const packageNames = new Set([
  ...Object.keys(packageJson.dependencies || {}),
  ...Object.keys(packageJson.devDependencies || {}),
]);
for (const retiredPackage of ['@vercel/node', 'firebase', 'firebase-admin']) {
  check(!packageNames.has(retiredPackage), `Retired runtime package must stay removed: ${retiredPackage}`);
}

const nativeApiRoutes = [
  'admissions',
  'attendance',
  'audit',
  'auth',
  'classes',
  'edu',
  'finance',
  'knowledge-bank',
  'payments/payos',
  'read',
  'storage',
  'students',
  'zalo',
];
for (const route of nativeApiRoutes) {
  check(existsSync(`server/api/${route}/route.ts`), `Native VPS API route is missing: ${route}`);
}

const examplePath = new URL('../deploy/vps/.env.example', import.meta.url);
const example = parseEnv(readFileSync(examplePath, 'utf8'));
const canonicalAppHostname = 'vps.thienuy.edu.vn';

function readOrigin(name, { loopbackOnly = false } = {}) {
  try {
    const parsed = new URL(example[name] || '');
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
    check(parsed.username === '' && parsed.password === '', `${name} must not contain credentials`);
    check(parsed.search === '' && parsed.hash === '', `${name} must not contain query or hash`);
    check(parsed.pathname === '/', `${name} must be an origin without a path`);
    if (loopbackOnly) {
      check(loopback && parsed.protocol === 'http:', `${name} must use loopback HTTP`);
    } else {
      check(parsed.protocol === 'https:', `${name} must use HTTPS`);
      check(
        parsed.hostname === canonicalAppHostname,
        `${name} in the committed template must use ${canonicalAppHostname}`
      );
    }
    return parsed;
  } catch {
    failures.push(`${name} must be a valid URL origin`);
    return null;
  }
}

const appOrigin = readOrigin('APP_URL');
const publicOrigin = readOrigin('PUBLIC_BASE_URL');
readOrigin('INTERNAL_API_BASE_URL', { loopbackOnly: true });

check(example.DEPLOYMENT_STAGE === 'staging', 'DEPLOYMENT_STAGE must default to staging');
check(!('DATA_BACKEND' in example), 'DATA_BACKEND is obsolete; PostgreSQL is unconditional');
check(example.ZALO_BOT_ENABLED === 'false', 'ZALO_BOT_ENABLED must default to false');
check(
  example.ZALO_BOT_DAILY_DIGEST_ENABLED === 'false',
  'ZALO_BOT_DAILY_DIGEST_ENABLED must default to false'
);
check(example.ZALO_BOT_DRY_RUN === 'true', 'ZALO_BOT_DRY_RUN must default to true');
check(
  example.ZALO_BOT_ADMIN_SNAPSHOT_REFRESH_ENABLED === 'false',
  'ZALO_BOT_ADMIN_SNAPSHOT_REFRESH_ENABLED must default to false'
);
check(
  !example.PAYOS_CLIENT_ID && !example.PAYOS_API_KEY && !example.PAYOS_CHECKSUM_KEY,
  'PayOS credentials must stay empty in the committed template'
);
check(
  appOrigin?.origin === publicOrigin?.origin,
  'APP_URL and PUBLIC_BASE_URL must use the same safe template origin'
);

try {
  const database = new URL(example.DATABASE_URL || '');
  check(database.protocol === 'postgres:', 'DATABASE_URL must use postgres:');
  check(database.hostname === '127.0.0.1', 'DATABASE_URL must use loopback PostgreSQL');
} catch {
  failures.push('DATABASE_URL must be a valid PostgreSQL URL');
}

const migrationDirectory = new URL('../db/migrations/', import.meta.url);
const migrationNumbers = readdirSync(migrationDirectory)
  .map((name) => /^(\d{4})_.+\.sql$/.exec(name))
  .filter(Boolean)
  .map((match) => Number(match[1]))
  .sort((left, right) => left - right);
check(migrationNumbers.length > 0, 'No SQL migrations found');
check(
  migrationNumbers.every((number, index) => number === index + 1),
  'SQL migrations must be unique and contiguous from 0001'
);

const gitignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
check(gitignore.includes('db/data.sql'), 'db/data.sql must remain ignored');
check(gitignore.includes('.env*'), 'private .env files must remain ignored');

if (failures.length > 0) {
  console.error('VPS source safety check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(
    `VPS source safety passed: safe staging defaults, loopback services, ${migrationNumbers.length} contiguous migrations`
  );
}
