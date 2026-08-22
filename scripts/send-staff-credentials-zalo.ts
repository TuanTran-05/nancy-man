import { existsSync, readFileSync } from 'node:fs';

function loadLocalEnv() {
  if (!existsSync('.env')) return;

  const lines = readFileSync('.env', 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }

  const servicePath = 'service-account-key.json';
  const firebaseConfigPath = 'firebase-applet-config.json';

  if (existsSync(servicePath)) {
    const serviceAccount = JSON.parse(readFileSync(servicePath, 'utf8'));
    process.env.FIREBASE_PROJECT_ID ||= serviceAccount.project_id;
    process.env.FIREBASE_CLIENT_EMAIL ||= serviceAccount.client_email;
    process.env.FIREBASE_PRIVATE_KEY ||= serviceAccount.private_key;
  }

  if (existsSync(firebaseConfigPath)) {
    const firebaseConfig = JSON.parse(readFileSync(firebaseConfigPath, 'utf8'));
    process.env.FIRESTORE_DATABASE_ID ||= firebaseConfig.documentStoreDatabaseId;
  }

  process.env.APP_URL ||= 'http://localhost:5173';
  process.env.OTP_PEPPER ||= 'local-zalo-script';
  process.env.CRON_SECRET ||= 'local-zalo-script';
}

function parseArgs() {
  const options: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq === -1) continue;
    options[arg.slice(2, eq)] = arg.slice(eq + 1).replace(/^['"]|['"]$/g, '');
  }
  return options;
}

async function main() {
  loadLocalEnv();

  const options = parseArgs();
  const name = options.name?.trim();
  const email = options.email?.trim().toLowerCase();
  const password = options.password;
  const phone = options.phone?.trim();

  if (!name || !email || !password || !phone) {
    throw new Error(
      'Usage: npx tsx scripts/send-staff-credentials-zalo.ts --name="<name>" --email=<email> --password=<password> --phone=<phone>'
    );
  }

  const { getZaloConfig, sendZaloZNSMessage } = await import(
    '../server/api/lib/zalo/zaloHelper.js'
  );

  const cfg = getZaloConfig();
  if (!cfg.znsStaffTemplateId) {
    throw new Error('Missing ZALO_ZNS_STAFF_TEMPLATE_ID');
  }

  const result = await sendZaloZNSMessage(
    cfg.znsStaffTemplateId,
    {
      name,
      user_name: email,
      pass_word: password,
    },
    phone,
    `edutrack_staff_manual_${Date.now()}`.slice(0, 48)
  );

  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
