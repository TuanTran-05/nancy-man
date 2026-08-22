import * as fs from 'node:fs/promises';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  executeStudentIdentityCli,
  createDefaultStudentIdentityCliRuntime,
  openConfirmedStudentIdentityTarget,
  runStudentIdentityCliIfDirect,
  type StudentIdentityCliOutput,
  type StudentIdentityCliRuntime,
} from './runtime.js';
import { writeJsonArtifactAtomic } from './artifacts.js';
import { canonicalJson, sha256 } from '../student-profile-normalization/canonicalJson.js';

const firebase = vi.hoisted(() => ({
  cert: vi.fn(),
  getApps: vi.fn(),
  getDocumentStore: vi.fn(),
  initializeApp: vi.fn(),
}));

vi.mock('@/server/db/documentStore.js', () => ({
  cert: firebase.cert,
  getApps: firebase.getApps,
  getDocumentStore: firebase.getDocumentStore,
  initializeApp: firebase.initializeApp,
}));

const FIREBASE_ENVIRONMENT_KEYS = [
  'FIREBASE_PROJECT_ID',
  'FIRESTORE_DATABASE_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'FIRESTORE_EMULATOR_HOST',
] as const;

async function withFirebaseEnvironment(
  values: Partial<Record<(typeof FIREBASE_ENVIRONMENT_KEYS)[number], string>>,
  action: () => Promise<void>
): Promise<void> {
  const original = Object.fromEntries(
    FIREBASE_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]])
  );
  try {
    for (const key of FIREBASE_ENVIRONMENT_KEYS) {
      if (key in values) process.env[key] = values[key];
      else delete process.env[key];
    }
    await action();
  } finally {
    for (const key of FIREBASE_ENVIRONMENT_KEYS) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

beforeEach(() => {
  firebase.cert.mockReset();
  firebase.getApps.mockReset();
  firebase.getDocumentStore.mockReset();
  firebase.initializeApp.mockReset();
  firebase.cert.mockImplementation((credential) => credential);
  firebase.getApps.mockReturnValue([]);
  firebase.initializeApp.mockImplementation((options, name) => ({ name, options }));
  firebase.getDocumentStore.mockImplementation((app, databaseId) => ({ app, databaseId }));
});

function fakeRuntime(
  overrides: Partial<StudentIdentityCliRuntime> = {}
): StudentIdentityCliRuntime {
  return {
    env: {
      FIREBASE_PROJECT_ID: 'edutrack',
      FIRESTORE_DATABASE_ID: '(default)',
    },
    now: () => new Date('2026-08-09T00:00:00.000Z'),
    stdout: vi.fn((_: string) => {}) as StudentIdentityCliOutput,
    stderr: vi.fn((_: string) => {}) as StudentIdentityCliOutput,
    openDocumentStore: vi.fn(),
    readText: vi.fn(),
    writeTextAtomic: vi.fn(),
    ...overrides,
  };
}

describe('student identity CLI runtime', () => {
  it('returns usage exit 2 before opening Firebase', async () => {
    const openDocumentStore = vi.fn();
    const code = await executeStudentIdentityCli({
      argv: ['--definitely-invalid'],
      usage: 'usage',
      parse: () => {
        throw Object.assign(new Error('Unknown flag'), { usageError: true });
      },
      run: vi.fn(),
      runtime: fakeRuntime({ openDocumentStore }),
    });

    expect(code).toBe(2);
    expect(openDocumentStore).not.toHaveBeenCalled();
  });

  it('prints help and exits 0 without parsing, Firebase, or file writes', async () => {
    const runtime = fakeRuntime();
    const parse = vi.fn();
    const code = await executeStudentIdentityCli({
      argv: ['--help'],
      usage: 'student identity help',
      parse,
      run: vi.fn(),
      runtime,
    });

    expect(code).toBe(0);
    expect(runtime.stdout).toHaveBeenCalledWith('student identity help');
    expect(parse).not.toHaveBeenCalled();
    expect(runtime.openDocumentStore).not.toHaveBeenCalled();
    expect(runtime.writeTextAtomic).not.toHaveBeenCalled();
  });

  it('does not open Firebase before a parsed command confirms its target', async () => {
    const openDocumentStore = vi.fn();
    const runtime = fakeRuntime({ openDocumentStore });
    const run = vi.fn(async () => 41);

    const code = await executeStudentIdentityCli({
      argv: ['--read-only'],
      usage: 'usage',
      parse: () => ({ mode: 'read-only' }),
      run,
      runtime,
    });

    expect(code).toBe(41);
    expect(run).toHaveBeenCalledWith({ mode: 'read-only' }, runtime);
    expect(openDocumentStore).not.toHaveBeenCalled();
  });

  it('returns only the DocumentStore instance for the confirmed target', async () => {
    const db = { collection: vi.fn() } as never;
    const runtime = fakeRuntime({
      openDocumentStore: vi.fn(async () => ({
        db,
        target: { projectId: 'edutrack', databaseId: '(default)' },
      })),
    });

    await expect(
      openConfirmedStudentIdentityTarget(runtime, {
        projectId: 'edutrack',
        databaseId: '(default)',
      })
    ).resolves.toBe(db);
    await expect(
      openConfirmedStudentIdentityTarget(runtime, {
        projectId: 'wrong-project',
        databaseId: '(default)',
      })
    ).rejects.toThrow('STUDENT_IDENTITY_TARGET_CONFIRMATION_MISMATCH');
  });

  it('rejects a target mismatch before calling the Firebase opener', async () => {
    const openDocumentStore = vi.fn(async () => ({
      db: {} as never,
      target: { projectId: 'edutrack', databaseId: '(default)' },
    }));

    await expect(
      openConfirmedStudentIdentityTarget(fakeRuntime({ openDocumentStore }), {
        projectId: 'wrong-project',
        databaseId: '(default)',
      })
    ).rejects.toThrow('STUDENT_IDENTITY_TARGET_CONFIRMATION_MISMATCH');
    expect(openDocumentStore).not.toHaveBeenCalled();
  });

  it('rejects emulator routing before initializing Firebase', async () => {
    await withFirebaseEnvironment({
      FIREBASE_PROJECT_ID: 'edutrack',
      FIRESTORE_DATABASE_ID: '(default)',
      FIREBASE_CLIENT_EMAIL: 'service@example.invalid',
      FIREBASE_PRIVATE_KEY: 'line-one\\nline-two',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    }, async () => {
      await expect(createDefaultStudentIdentityCliRuntime().openDocumentStore())
        .rejects.toThrow('STUDENT_IDENTITY_FIRESTORE_EMULATOR_FORBIDDEN');
    });

    expect(firebase.cert).not.toHaveBeenCalled();
    expect(firebase.initializeApp).not.toHaveBeenCalled();
    expect(firebase.getDocumentStore).not.toHaveBeenCalled();
  });

  it('converts the conventional escaped private-key newline before credential creation', async () => {
    await withFirebaseEnvironment({
      FIREBASE_PROJECT_ID: 'edutrack',
      FIRESTORE_DATABASE_ID: '(default)',
      FIREBASE_CLIENT_EMAIL: 'service@example.invalid',
      FIREBASE_PRIVATE_KEY: 'line-one\\nline-two',
    }, async () => {
      await createDefaultStudentIdentityCliRuntime().openDocumentStore();
    });

    expect(firebase.cert).toHaveBeenCalledWith({
      projectId: 'edutrack',
      clientEmail: 'service@example.invalid',
      privateKey: 'line-one\nline-two',
    });
  });

  it('runs direct entry points only for their own module path and preserves the exit code', async () => {
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    const modulePath = join(tmpdir(), 'student-identity-direct.ts');
    const main = vi.fn(async () => 29);
    try {
      process.argv = ['node', modulePath];
      process.exitCode = undefined;
      runStudentIdentityCliIfDirect(pathToFileURL(modulePath).href, main);
      await vi.waitFor(() => expect(main).toHaveBeenCalledOnce());
      expect(process.exitCode).toBe(29);
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
    }
  });
});

describe('writeJsonArtifactAtomic', () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('refuses a different report while an explicitly idempotent equivalent retry preserves its digest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'student-identity-artifact-'));
    tempDirectories.push(directory);
    const outputPath = join(directory, 'report.json');
    const original = { audit: { count: 2, status: 'green' }, runId: 'run-1' };
    const equivalent = { runId: 'run-1', audit: { status: 'green', count: 2 } };
    const expectedDigest = sha256(canonicalJson(original));

    const created = await writeJsonArtifactAtomic(outputPath, original);
    const retried = await writeJsonArtifactAtomic(outputPath, equivalent, { idempotent: true });

    expect(created).toEqual({ digest: expectedDigest, outcome: 'created' });
    expect(retried).toEqual({ digest: expectedDigest, outcome: 'unchanged' });
    expect(await readFile(outputPath, 'utf8')).toBe(canonicalJson(original));
    await expect(
      writeJsonArtifactAtomic(outputPath, { audit: { count: 3, status: 'green' }, runId: 'run-1' }, { idempotent: true })
    ).rejects.toThrow('STUDENT_IDENTITY_ARTIFACT_CONFLICT');
  });

  it('surfaces link EEXIST instead of replacing an existing artifact', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'student-identity-artifact-'));
    tempDirectories.push(directory);
    const outputPath = join(directory, 'report.json');
    await writeJsonArtifactAtomic(outputPath, { sequence: 1 });

    await expect(writeJsonArtifactAtomic(outputPath, { sequence: 2 }))
      .rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(outputPath, 'utf8')).toBe(canonicalJson({ sequence: 1 }));
  });

  it('removes a temporary artifact when its file write fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'student-identity-artifact-'));
    tempDirectories.push(directory);
    const probePath = join(directory, 'file-handle-prototype-probe');
    const probe = await fs.open(probePath, 'wx');
    const fileHandlePrototype = Object.getPrototypeOf(probe) as { writeFile: (...args: unknown[]) => Promise<void> };
    await probe.close();
    await fs.unlink(probePath);
    const writeFailure = vi.spyOn(fileHandlePrototype, 'writeFile')
      .mockRejectedValueOnce(new Error('simulated write failure'));

    try {
      await expect(writeJsonArtifactAtomic(join(directory, 'report.json'), { sequence: 1 }))
        .rejects.toThrow('simulated write failure');
    } finally {
      writeFailure.mockRestore();
    }
    expect(await readdir(directory)).toEqual([]);
  });

  it('preserves a pre-existing temporary collision and its open EEXIST error', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'student-identity-artifact-'));
    tempDirectories.push(directory);
    const outputPath = join(directory, 'report.json');
    const temporaryPath = `${outputPath}.tmp-${process.pid}-123-i`;
    await fs.writeFile(temporaryPath, 'another writer owns this temporary file');
    const now = vi.spyOn(Date, 'now').mockReturnValue(123);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);

    try {
      await expect(writeJsonArtifactAtomic(outputPath, { sequence: 1 }))
        .rejects.toMatchObject({ code: 'EEXIST' });
    } finally {
      random.mockRestore();
      now.mockRestore();
    }
    expect(await readFile(temporaryPath, 'utf8')).toBe('another writer owns this temporary file');
  });
});
