import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthService } from '../server/security/auth.js';
import { totpCode } from '../server/security/totp.js';
import { createOpsStore } from '../server/storage/store.js';
import { readHiddenPassword } from './provision-ops-user.js';

interface PtyResult {
  status: number | null;
  transcript: string;
}

const key = Buffer.alloc(32, 19).toString('base64');
const webRoot = fileURLToPath(new URL('../../', import.meta.url));
let bundleDirectory: string;
let bundlePath: string;

beforeAll(async () => {
  bundleDirectory = mkdtempSync(join(webRoot, '.ops-cli-pty-'));
  bundlePath = join(bundleDirectory, 'provision-ops-user.mjs');
  await build({
    entryPoints: [join(webRoot, 'src/cli/provision-ops-user.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    outfile: bundlePath,
    packages: 'external'
  });
});

afterAll(() => {
  if (bundleDirectory) rmSync(bundleDirectory, { recursive: true, force: true });
});

function config(databasePath: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'test',
    OPS_DB_PATH: databasePath,
    OPS_DATA_KEY: key,
    OPS_ALERT_ZALO_BOT_TOKEN: 'test-token',
    OPS_ZALO_WEBHOOK_SECRET: 'w'.repeat(32),
    OPS_ZALO_LINK_CODE_PEPPER: 'p'.repeat(32),
    OPS_ZALO_CHAT_HASH_SECRET: 'h'.repeat(32),
    OPS_ZALO_RECIPIENT_KEY: key
  };
}

function runPty(
  input: string | '\u0003',
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<PtyResult> {
  return new Promise((resolve, reject) => {
    const command = [
      `"${process.execPath}"`,
      `"${bundlePath}"`,
      ...args.map((argument) => `"${argument}"`)
    ].join(' ');
    const child = spawn(
      'script',
      ['-qfec', `${command}; status=$?; stty -a; exit $status`, '/dev/null'],
      { env, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    let transcript = '';
    let submitted = false;
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`PTY command timed out: ${transcript}`));
    }, 15_000);
    const capture = (chunk: Buffer) => {
      transcript += chunk.toString('utf8');
      if (!submitted && transcript.includes('Password')) {
        submitted = true;
        child.stdin.write(input === '\u0003' ? '\u0003' : `${input}\n`);
      }
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (status) => {
      clearTimeout(timeout);
      resolve({ status, transcript });
    });
  });
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

function runPtyExternalSignal(
  signal: NodeJS.Signals,
  args: string[],
  env: NodeJS.ProcessEnv,
  pidPath: string
): Promise<PtyResult> {
  return new Promise((resolve, reject) => {
    const innerCommand = [
      `echo $$ > ${shellQuote(pidPath)}`,
      `exec ${[process.execPath, bundlePath, ...args].map(shellQuote).join(' ')}`
    ].join('; ');
    const command = `sh -c ${shellQuote(innerCommand)}; status=$?; stty -a; exit $status`;
    const child = spawn('script', ['-qfec', command, '/dev/null'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let transcript = '';
    let signalled = false;
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`PTY signal command timed out: ${transcript}`));
    }, 15_000);
    const capture = (chunk: Buffer) => {
      transcript += chunk.toString('utf8');
      if (!signalled && transcript.includes('Password') && existsSync(pidPath)) {
        signalled = true;
        process.kill(Number(readFileSync(pidPath, 'utf8').trim()), signal);
      }
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (status) => {
      clearTimeout(timeout);
      resolve({ status, transcript });
    });
  });
}

const expectEchoRestored = (transcript: string) => {
  expect(transcript).toMatch(/(?:^|[;\s])echo(?:[;\s]|$)/u);
  expect(transcript).not.toMatch(/(?:^|[;\s])-echo(?:[;\s]|$)/u);
};

describe('provision Ops user hidden TTY prompt', () => {
  it('restores raw mode when writing the prompt fails during setup', async () => {
    class SyntheticInput extends EventEmitter {
      isTTY = true;
      isRaw = false;
      resumed = false;

      setRawMode(value: boolean) {
        this.isRaw = value;
        return this;
      }

      resume() {
        this.resumed = true;
        return this;
      }

      pause() {
        this.resumed = false;
        return this;
      }
    }

    const syntheticInput = new SyntheticInput();
    const syntheticOutput = {
      isTTY: true,
      write() {
        throw new Error('synthetic TTY write failure');
      }
    };

    await expect(
      readHiddenPassword(syntheticInput as never, syntheticOutput as never)
    ).rejects.toThrow('synthetic TTY write failure');
    expect(syntheticInput.isRaw).toBe(false);
    expect(syntheticInput.resumed).toBe(false);
  });

  it('does not echo the password and restores echo after success', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-cli-success-'));
    const password = 'SUCCESS-PTY-PASSWORD-784215';
    try {
      const result = await runPty(
        password,
        ['ops-pty-success'],
        config(join(directory, 'ops.sqlite'))
      );
      expect(result.status).toBe(0);
      expect(result.transcript).toContain('TOTP enrollment URI');
      expect(result.transcript).not.toContain(password);
      expectEchoRestored(result.transcript);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 20_000);

  it('does not echo the password and restores echo after an application failure', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-cli-failure-'));
    const databasePath = join(directory, 'ops.sqlite');
    try {
      await runPty('FIRST-PTY-PASSWORD-593187', ['ops-pty-duplicate'], config(databasePath));
      const password = 'FAILURE-PTY-PASSWORD-906412';
      const result = await runPty(password, ['ops-pty-duplicate'], config(databasePath));
      expect(result.status).not.toBe(0);
      expect(result.transcript).not.toContain(password);
      expectEchoRestored(result.transcript);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 20_000);

  it('restores echo when the hidden prompt receives an interrupt', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-cli-signal-'));
    try {
      const result = await runPty(
        '\u0003',
        ['ops-pty-signal'],
        config(join(directory, 'ops.sqlite'))
      );
      expect(result.status).not.toBe(0);
      expectEchoRestored(result.transcript);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 20_000);

  it('restores echo when the process receives an external SIGTERM', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-cli-external-signal-'));
    const pidPath = join(directory, 'cli.pid');
    try {
      const result = await runPtyExternalSignal(
        'SIGTERM',
        ['ops-pty-external-signal'],
        config(join(directory, 'ops.sqlite')),
        pidPath
      );
      expect(result.status).not.toBe(0);
      expect(result.transcript).toContain('Provisioning cancelled');
      expectEchoRestored(result.transcript);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 20_000);

  it('restores echo when the terminal session sends SIGHUP', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-cli-external-hup-'));
    const pidPath = join(directory, 'cli.pid');
    try {
      const result = await runPtyExternalSignal(
        'SIGHUP',
        ['ops-pty-external-hup'],
        config(join(directory, 'ops.sqlite')),
        pidPath
      );
      expect(result.status).not.toBe(0);
      expect(result.transcript).toContain('Provisioning cancelled');
      expectEchoRestored(result.transcript);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 20_000);

  it('provides a no-echo offline recovery command that rotates working credentials', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-cli-recovery-'));
    const databasePath = join(directory, 'ops.sqlite');
    const password = 'RECOVERY-PTY-PASSWORD-641720';
    try {
      await runPty('ORIGINAL-PTY-PASSWORD-195824', ['ops-pty-recovery'], config(databasePath));
      const result = await runPty(
        password,
        ['--recover', 'ops-pty-recovery'],
        config(databasePath)
      );
      expect(result.status).toBe(0);
      expect(result.transcript).toContain('Account recovered');
      expect(result.transcript).not.toContain(password);
      expectEchoRestored(result.transcript);

      const seed = /secret=([A-Z2-7]+)/u.exec(result.transcript)?.[1];
      expect(seed).toBeTruthy();
      const dataKey = Buffer.from(key, 'base64');
      const store = createOpsStore(databasePath, () => new Date(), dataKey);
      const auth = createAuthService({ store, dataKey });
      await expect(
        auth.authenticate({
          username: 'ops-pty-recovery',
          password,
          totp: totpCode(seed!, Math.floor(Date.now() / 1000 / 30))
        })
      ).resolves.toMatchObject({ username: 'ops-pty-recovery' });
      store.getDatabaseForBackup().close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 20_000);
});
