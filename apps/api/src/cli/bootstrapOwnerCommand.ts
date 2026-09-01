import { StringDecoder } from 'node:string_decoder';
import { stdin as input, stdout as output } from 'node:process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';

import { issueEnrollmentToken } from '../../../../packages/security/src/mfa/enrollmentToken.js';
import {
  hashPassword,
  passwordFingerprint,
  validatePasswordPolicy
} from '../../../../packages/security/src/passwords.js';
import { getOpsPool } from '../../../../packages/db/src/client.js';

import { bootstrapOwner, type OwnerBootstrapRepository } from './bootstrapOwner.js';
import { PostgresOwnerBootstrapRepository } from './postgresOwnerBootstrapRepository.js';
import { FileSecretResolver } from '../runtime/fileSecretResolver.js';
import { readOpsRuntimeConfig } from '../runtime/runtimeConfig.js';

type OwnerBootstrapCommandInput = {
  publicUrl: string;
  additionalOwner: boolean;
  interactiveTty: boolean;
  prompts: readonly string[];
  secrets: readonly string[];
  repository: OwnerBootstrapRepository;
  hashPassword: (password: string) => Promise<string>;
  passwordFingerprint: (password: string, pepper: string) => string;
  passwordFingerprintPepper: string;
  issueEnrollmentToken: () => { plainToken: string; tokenHash: string };
  output: (line: string) => void;
};

export async function runOwnerBootstrap(
  input: OwnerBootstrapCommandInput
): Promise<{ userId: string }> {
  if (!input.interactiveTty) throw new Error('Owner bootstrap requires an interactive TTY');
  if (input.prompts.length < 4 || input.secrets.length < 2) {
    throw new Error('Owner bootstrap input is incomplete');
  }
  const [username = '', email = '', displayName = '', confirmation = ''] = input.prompts;
  const [password = '', repeatedPassword = ''] = input.secrets;
  if (confirmation !== 'CREATE OWNER') throw new Error('Owner bootstrap confirmation is required');
  if (password !== repeatedPassword) throw new Error('Owner passwords do not match');
  if (!password) throw new Error('Owner password is required');

  validatePasswordPolicy({
    password,
    username,
    email,
    fingerprintPepper: input.passwordFingerprintPepper
  });
  const result = await bootstrapOwner({
    username,
    email,
    displayName,
    password,
    publicUrl: input.publicUrl,
    interactiveConfirmation: true,
    additionalOwner: input.additionalOwner,
    repository: input.repository,
    hashPassword: input.hashPassword,
    passwordFingerprint: (value) =>
      input.passwordFingerprint(value, input.passwordFingerprintPepper),
    issueEnrollmentToken: input.issueEnrollmentToken
  });
  input.output(`Enrollment URL: ${result.enrollmentUrl}`);
  return { userId: result.userId };
}

export async function readHiddenOwnerPassword(
  inputStream: typeof input = input,
  outputStream: typeof output = output
): Promise<string> {
  if (!inputStream.isTTY || !outputStream.isTTY || typeof inputStream.setRawMode !== 'function') {
    throw new Error('Owner bootstrap requires a TTY for password input');
  }
  const wasRaw = inputStream.isRaw === true;
  const decoder = new StringDecoder('utf8');
  let password = '';
  let cancelPrompt: ((error: Error) => void) | undefined;
  const onSignal = () => cancelPrompt?.(new Error('Owner bootstrap cancelled'));
  const cleanupSignals: NodeJS.Signals[] = ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGTERM'];
  try {
    for (const signal of cleanupSignals) process.once(signal, onSignal);
    inputStream.setRawMode(true);
    inputStream.resume();
    outputStream.write('Password: ');
    return await new Promise<string>((resolvePassword, reject) => {
      let settled = false;
      const finish = (value?: string, error?: Error) => {
        if (settled) return;
        settled = true;
        inputStream.off('data', onData);
        inputStream.off('end', onEnd);
        inputStream.off('error', onError);
        if (error) reject(error);
        else resolvePassword(value ?? '');
      };
      cancelPrompt = (error) => finish(undefined, error);
      const onEnd = () => finish(undefined, new Error('Owner password input ended unexpectedly'));
      const onError = (error: Error) => finish(undefined, error);
      const onData = (chunk: Buffer | string) => {
        const text = typeof chunk === 'string' ? chunk : decoder.write(chunk);
        for (const character of text) {
          if (character === '\r' || character === '\n') {
            finish(password);
            return;
          }
          if (character === '\u0003' || character === '\u0004') {
            finish(undefined, new Error('Owner bootstrap cancelled'));
            return;
          }
          if (character === '\b' || character === '\u007f') {
            password = [...password].slice(0, -1).join('');
            continue;
          }
          if (/^[\u0020-\u007e]$/u.test(character)) {
            if (password.length >= 1_024) {
              finish(undefined, new Error('Owner password is too long'));
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

async function promptForOwnerInput(): Promise<void> {
  if (!input.isTTY || !output.isTTY) throw new Error('Owner bootstrap requires an interactive TTY');
  const config = readOpsRuntimeConfig(process.env);
  const resolver = new FileSecretResolver(config.secretDirectory);
  const databaseUrl = await resolver.resolve(config.databaseUrlReference);
  const fingerprintPepper = await resolver.resolve(config.passwordFingerprintPepperReference);
  if (!databaseUrl || !fingerprintPepper)
    throw new Error('Owner bootstrap credentials are unavailable');

  const readline = createInterface({ input, output });
  const pool = getOpsPool(databaseUrl);
  try {
    const username = await readline.question('Username: ');
    const email = await readline.question('Email: ');
    const displayName = await readline.question('Display name: ');
    const additionalOwner = process.argv.includes('--additional-owner');
    const confirmation = await readline.question('Type CREATE OWNER to continue: ');
    readline.close();
    const password = await readHiddenOwnerPassword();
    const repeatedPassword = await readHiddenOwnerPassword();
    await runOwnerBootstrap({
      publicUrl: config.publicUrl,
      additionalOwner,
      interactiveTty: true,
      prompts: [username, email, displayName, confirmation],
      secrets: [password, repeatedPassword],
      repository: new PostgresOwnerBootstrapRepository(pool),
      hashPassword,
      passwordFingerprint,
      passwordFingerprintPepper: fingerprintPepper,
      issueEnrollmentToken,
      output: (line) => output.write(`${line}\n`)
    });
  } finally {
    readline.close();
    await pool.end();
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  void promptForOwnerInput().catch(() => {
    process.stderr.write('Owner bootstrap failed\n');
    process.exitCode = 1;
  });
}
