import { StringDecoder } from 'node:string_decoder';
import { stdin as input, stdout as output } from 'node:process';
import { loadWebConfig } from '../server/config.js';
import { provisionAccount, recoverAccount } from '../server/security/auth.js';
import { generateTotpSeed } from '../server/security/totp.js';
import { createOpsStore } from '../server/storage/store.js';

export async function readHiddenPassword(
  inputStream: typeof input = input,
  outputStream: typeof output = output
): Promise<string> {
  if (!inputStream.isTTY || !outputStream.isTTY || typeof inputStream.setRawMode !== 'function')
    throw new Error('A TTY is required for hidden password input');

  const wasRaw = inputStream.isRaw === true;
  const decoder = new StringDecoder('utf8');
  let password = '';
  let cancelPrompt: ((error: Error) => void) | undefined;
  const onSignal = () => cancelPrompt?.(new Error('Provisioning cancelled'));

  inputStream.setRawMode(true);
  inputStream.resume();
  outputStream.write('Password: ');
  try {
    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = (value?: string, error?: Error) => {
        if (settled) return;
        settled = true;
        inputStream.off('data', onData);
        inputStream.off('end', onEnd);
        inputStream.off('error', onError);
        if (error) reject(error);
        else resolve(value ?? '');
      };
      cancelPrompt = (error) => finish(undefined, error);
      const onEnd = () => finish(undefined, new Error('Password input ended unexpectedly'));
      const onError = (error: Error) => finish(undefined, error);
      const onData = (chunk: Buffer | string) => {
        const text = typeof chunk === 'string' ? chunk : decoder.write(chunk);
        for (const character of text) {
          if (character === '\r' || character === '\n') {
            finish(password);
            return;
          }
          if (character === '\u0003' || character === '\u0004') {
            finish(undefined, new Error('Provisioning cancelled'));
            return;
          }
          if (character === '\b' || character === '\u007f') {
            password = [...password].slice(0, -1).join('');
            continue;
          }
          if (/^[\u0020-\u007e]$/u.test(character)) {
            if (password.length >= 1024) {
              finish(undefined, new Error('Password is too long'));
              return;
            }
            password += character;
          }
        }
      };
      inputStream.on('data', onData);
      inputStream.once('end', onEnd);
      inputStream.once('error', onError);
      process.once('SIGINT', onSignal);
      process.once('SIGTERM', onSignal);
    });
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    inputStream.setRawMode(wasRaw);
    inputStream.pause();
    outputStream.write('\n');
  }
}

export async function runProvisionOpsUser(): Promise<void> {
  if (!input.isTTY || !output.isTTY)
    throw new Error('ops:provision-user requires an interactive TTY');
  const config = loadWebConfig(process.env);
  const recovery = process.argv[2] === '--recover';
  const username = (recovery ? process.argv[3] : process.argv[2]) ?? '';
  if (!username) throw new Error('Usage: ops:provision-user [--recover] <username>');
  const password = await readHiddenPassword();
  if (!password) throw new Error('Password is required');
  const seed = generateTotpSeed();
  const store = createOpsStore(config.dbPath, undefined, config.zaloRecipientKey);
  try {
    const result = recovery
      ? recoverAccount(store, { username, password, totpSeed: seed }, config.dataKey)
      : provisionAccount(store, { username, password, totpSeed: seed }, config.dataKey);
    output.write(
      `${recovery ? 'Account recovered. ' : ''}TOTP enrollment URI (store securely, shown once): ${result.enrollmentUri}\n`
    );
  } finally {
    store.getDatabaseForBackup().close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runProvisionOpsUser().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Provisioning failed');
    process.exitCode = 1;
  });
}
