import { cert, getApps, initializeApp } from '@/server/db/documentStore.js';
import { getDocumentStore, type DocumentStore } from '@/server/db/documentStore.js';
import { GoogleAuth } from 'google-auth-library';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { ManagedExportOperation } from '../student-profile-normalization/managedExportEvidence.js';

const execFileAsync = promisify(execFile);

export type StudentIdentityTarget = {
  projectId: string;
  databaseId: string;
};

export type StudentIdentityCliOutput =
  | ((line: string) => void)
  | { write: (line: string) => void };

export type StudentIdentityCliRuntime = {
  env: NodeJS.ProcessEnv;
  now: () => Date;
  stdout: StudentIdentityCliOutput;
  stderr: StudentIdentityCliOutput;
  openDocumentStore: () => Promise<{
    db: DocumentStore;
    target: StudentIdentityTarget;
  }>;
  /** Required only by normalization's commit-bound final-audit/apply path. */
  currentGitCommit?: () => Promise<string>;
  /** Required only when a final audit verifies an authoritative export operation. */
  readManagedExportOperation?: (operationName: string) => Promise<ManagedExportOperation>;
  readText: (filePath: string) => Promise<string>;
  writeTextAtomic: (filePath: string, contents: string) => Promise<void>;
};

function writeRuntimeOutput(output: StudentIdentityCliOutput, line: string): void {
  if (typeof output === 'function') {
    output(line);
    return;
  }
  output.write(line);
}

function requireFirebaseEnvironmentValue(env: NodeJS.ProcessEnv, name: keyof NodeJS.ProcessEnv): string {
  const value = env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`STUDENT_IDENTITY_FIREBASE_ENVIRONMENT_MISSING:${name}`);
  }
  return value;
}

export function isStudentIdentityCliUsageError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('usageError' in error && error.usageError === true) return true;
  const name = (error as { name?: unknown }).name;
  return typeof name === 'string' && name.endsWith('UsageError');
}

export function assertConfirmedTarget(actual: StudentIdentityTarget, expected: Partial<StudentIdentityTarget>): void;
export function assertConfirmedTarget(
  actual: StudentIdentityTarget,
  expectedProjectId: string,
  expectedDatabaseId: string
): void;
export function assertConfirmedTarget(
  actual: StudentIdentityTarget,
  expected: Partial<StudentIdentityTarget> | string,
  expectedDatabaseId?: string
): void {
  const confirmed = typeof expected === 'string'
    ? { projectId: expected, databaseId: expectedDatabaseId }
    : expected;
  if (actual.projectId !== confirmed.projectId || actual.databaseId !== confirmed.databaseId) {
    throw new Error('STUDENT_IDENTITY_TARGET_CONFIRMATION_MISMATCH');
  }
}

export async function openConfirmedStudentIdentityTarget(
  runtime: StudentIdentityCliRuntime,
  expected: StudentIdentityTarget
): Promise<DocumentStore> {
  assertConfirmedTarget({
    projectId: requireFirebaseEnvironmentValue(runtime.env, 'FIREBASE_PROJECT_ID'),
    databaseId: requireFirebaseEnvironmentValue(runtime.env, 'FIRESTORE_DATABASE_ID'),
  }, expected);
  const opened = await runtime.openDocumentStore();
  assertConfirmedTarget(opened.target, expected);
  return opened.db;
}

export function createDefaultStudentIdentityCliRuntime(): StudentIdentityCliRuntime {
  const env = process.env;
  return {
    env,
    now: () => new Date(),
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
    openDocumentStore: async () => {
      if (env.FIRESTORE_EMULATOR_HOST) {
        throw new Error('STUDENT_IDENTITY_FIRESTORE_EMULATOR_FORBIDDEN');
      }
      const projectId = requireFirebaseEnvironmentValue(env, 'FIREBASE_PROJECT_ID');
      const databaseId = requireFirebaseEnvironmentValue(env, 'FIRESTORE_DATABASE_ID');
      const clientEmail = requireFirebaseEnvironmentValue(env, 'FIREBASE_CLIENT_EMAIL');
      const privateKey = requireFirebaseEnvironmentValue(env, 'FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n');
      const appName = `student-identity-cli:${projectId}`;
      const app = getApps().find((candidate) => candidate.name === appName) ?? initializeApp({
        projectId,
        credential: cert({ projectId, clientEmail, privateKey }),
      }, appName);

      return {
        db: getDocumentStore(app, databaseId),
        target: { projectId, databaseId },
      };
    },
    currentGitCommit: async () => {
      const result = await execFileAsync('git', ['rev-parse', 'HEAD'], {
        cwd: process.cwd(),
        windowsHide: true,
      });
      const commit = result.stdout.trim();
      if (!/^[0-9a-f]{40}$/i.test(commit)) {
        throw new Error('STUDENT_IDENTITY_GIT_COMMIT_UNREADABLE');
      }
      return commit;
    },
    readManagedExportOperation: async (operationName) => {
      const clientEmail = requireFirebaseEnvironmentValue(env, 'FIREBASE_CLIENT_EMAIL');
      const privateKey = requireFirebaseEnvironmentValue(env, 'FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n');
      const auth = new GoogleAuth({
        credentials: { client_email: clientEmail, private_key: privateKey },
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
      const client = await auth.getClient();
      const response = await client.request<ManagedExportOperation>({
        url: `https://documentStore.googleapis.com/v1/${operationName}`,
        method: 'GET',
      });
      return response.data;
    },
    readText: (filePath) => fs.readFile(filePath, 'utf8'),
    writeTextAtomic: async (filePath, contents) => {
      const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const handle = await fs.open(temporaryPath, 'wx', 0o600);
      try {
        await handle.writeFile(contents, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await fs.link(temporaryPath, filePath);
      } finally {
        await fs.unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
    },
  };
}

export async function executeStudentIdentityCli<T>(input: {
  argv: readonly string[];
  usage: string;
  parse: (argv: readonly string[]) => T;
  run: (options: T, runtime: StudentIdentityCliRuntime) => Promise<number>;
  runtime?: StudentIdentityCliRuntime;
}): Promise<number> {
  const runtime = input.runtime ?? createDefaultStudentIdentityCliRuntime();
  if (input.argv.includes('--help')) {
    writeRuntimeOutput(runtime.stdout, input.usage);
    return 0;
  }
  try {
    return await input.run(input.parse(input.argv), runtime);
  } catch (error) {
    writeRuntimeOutput(runtime.stderr, error instanceof Error ? error.message : String(error));
    return isStudentIdentityCliUsageError(error) ? 2 : 1;
  }
}

export function runStudentIdentityCliIfDirect(
  importMetaUrl: string,
  main: () => Promise<number>
): void {
  if (process.argv[1] && fileURLToPath(importMetaUrl) === process.argv[1]) {
    void main().then((code) => {
      process.exitCode = code;
    }).catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
  }
}
