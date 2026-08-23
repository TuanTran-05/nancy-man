import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { loadWebConfig } from '../server/config.js';
import { provisionAccount } from '../server/security/auth.js';
import { generateTotpSeed } from '../server/security/totp.js';
import { createOpsStore } from '../server/storage/store.js';

export async function runProvisionOpsUser(): Promise<void> {
  if (!input.isTTY || !output.isTTY) throw new Error('ops:provision-user requires an interactive TTY');
  const config = loadWebConfig(process.env);
  const username = process.argv[2] ?? '';
  if (!username) throw new Error('Usage: ops:provision-user <username>');
  const readline = createInterface({ input, output });
  try {
    const password = await readline.question('Password (hidden input is required): ');
    if (!password) throw new Error('Password is required');
    const seed = generateTotpSeed();
    const store = createOpsStore(config.dbPath);
    const result = provisionAccount(store, { username, password, totpSeed: seed }, config.dataKey);
    console.log(`TOTP enrollment URI (store securely, shown once): ${result.enrollmentUri}`);
  } finally {
    readline.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runProvisionOpsUser().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Provisioning failed');
    process.exitCode = 1;
  });
}
