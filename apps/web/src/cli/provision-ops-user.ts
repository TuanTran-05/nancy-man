import { readFile } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { stdin as input, stdout as output } from 'node:process';
import {
  createOpsProcessRuntimeTelemetryFromEnvironment,
  runConfiguredOpsTelemetryOneShot
} from '../../../../packages/telemetry-sdk/src/oneShot.js';
import type { RuntimeTelemetry } from '../../../../packages/telemetry-sdk/src/runtimeTelemetry.js';
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
  const cleanupSignals: NodeJS.Signals[] = ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGTERM'];

  try {
    for (const signal of cleanupSignals) process.once(signal, onSignal);
    inputStream.setRawMode(true);
    inputStream.resume();
    outputStream.write('Password: ');
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
    });
  } finally {
    for (const signal of cleanupSignals) process.off(signal, onSignal);
    inputStream.setRawMode(wasRaw);
    inputStream.pause();
    outputStream.write('\n');
  }
}

export async function runProvisionOpsUser(
  environment: NodeJS.ProcessEnv = process.env,
  arguments_: readonly string[] = process.argv.slice(2)
): Promise<void> {
  if (!input.isTTY || !output.isTTY)
    throw new Error('ops:provision-user requires an interactive TTY');
  const config = loadWebConfig(environment);
  const recovery = arguments_[0] === '--recover';
  const username = (recovery ? arguments_[1] : arguments_[0]) ?? '';
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

export function runProvisionOpsUserEntrypoint(
  input: {
    environment?: NodeJS.ProcessEnv;
    arguments?: readonly string[];
    telemetry?: RuntimeTelemetry;
    run?: () => Promise<void>;
    onFailure?: (error: unknown) => void | Promise<void>;
    rethrow?: boolean;
  } = {}
): Promise<void | undefined> {
  const environment = input.environment ?? process.env;
  const common = {
    createTelemetry: () =>
      input.telemetry ??
      createOpsProcessRuntimeTelemetryFromEnvironment({
        environment,
        resolveHmacSecret: async () => {
          const hmacFile = environment.OPS_TELEMETRY_HMAC_FILE?.trim();
          if (!hmacFile) throw new Error('OPS_TELEMETRY_HMAC_FILE is required');
          return readFile(hmacFile, 'utf8');
        },
        service: 'edutrack-ops-provision-user',
        spoolName: 'provision-user'
      }),
    failureContext: {
      code: 'OPS_USER_PROVISION_FAILED',
      source: 'database' as const,
      level: 'fatal' as const
    },
    run:
      input.run ??
      (() => runProvisionOpsUser(environment, input.arguments ?? process.argv.slice(2))),
    ...(input.onFailure ? { onFailure: input.onFailure } : {})
  };
  return input.rethrow === false
    ? runConfiguredOpsTelemetryOneShot({ ...common, rethrow: false })
    : runConfiguredOpsTelemetryOneShot({ ...common, rethrow: true });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void runProvisionOpsUserEntrypoint({
    rethrow: false,
    onFailure: (error: unknown) => {
      console.error(error instanceof Error ? error.message : 'Provisioning failed');
      process.exitCode = 1;
    }
  });
}
