import { describe, expect, it } from 'vitest';
import {
  CheckStudentIdentityHealthUsageError,
  CHECK_STUDENT_IDENTITY_HEALTH_USAGE,
  checkStudentIdentityHealthCommand,
  exitCodeForHealth,
  parseCheckStudentIdentityHealthArgs,
} from './check-student-identity-health.js';
import { executeStudentIdentityCli, type StudentIdentityCliRuntime } from './student-identity-cli/runtime.js';
import { createInMemoryDocumentStore } from '../test-utils/inMemoryDocumentStore.js';

/**
 * Every case here is a way an operator at 2am ends up believing something
 * about what this command is doing that is not true.
 */
describe('parseCheckStudentIdentityHealthArgs', () => {
  it('defaults to a read-only daily report at a path the operator named', () => {
    const options = parseCheckStudentIdentityHealthArgs(['--output', 'scratch/health.json']);

    expect(options).toMatchObject({
      mode: 'daily',
      write: false,
      assertGreen: false,
      outputPath: 'scratch/health.json',
    });
  });

  it('refuses to choose an output path', () => {
    // A report written somewhere nobody named is a report nobody reads, and
    // its absence gets mistaken for success.
    expect(() => parseCheckStudentIdentityHealthArgs([])).toThrow(
      CheckStudentIdentityHealthUsageError
    );
    expect(() => parseCheckStudentIdentityHealthArgs([])).toThrow('--output FILE is required');
  });

  it('requires the target to be restated before it will write', () => {
    expect(() => parseCheckStudentIdentityHealthArgs(['--write'])).toThrow(
      '--confirm-project-id and --confirm-database-id'
    );

    expect(
      parseCheckStudentIdentityHealthArgs([
        '--write',
        '--confirm-project-id',
        'edutrack',
        '--confirm-database-id',
        '(default)',
      ])
    ).toMatchObject({ write: true, confirmProjectId: 'edutrack' });
  });

  it('rejects an unknown flag rather than ignoring it', () => {
    // A silently dropped flag is how somebody comes to believe a safety option
    // is in effect when it is not.
    expect(() =>
      parseCheckStudentIdentityHealthArgs(['--output', 'x.json', '--dry-run'])
    ).toThrow('Unknown flag: --dry-run');
  });

  it('rejects a repeated flag rather than taking the last one', () => {
    expect(() =>
      parseCheckStudentIdentityHealthArgs([
        '--output',
        'first.json',
        '--output',
        'second.json',
      ])
    ).toThrow('Repeated flag: --output');
  });

  it('rejects a flag whose value is missing', () => {
    expect(() => parseCheckStudentIdentityHealthArgs(['--output', '--write'])).toThrow(
      'Missing value for --output'
    );
  });

  it('rejects a mode nobody defined', () => {
    expect(() =>
      parseCheckStudentIdentityHealthArgs(['--mode', 'yolo', '--output', 'x.json'])
    ).toThrow('Invalid --mode');
  });

  it('requires a cutover audit to name its run, plan, approval, and export', () => {
    // Without them the report cannot say which cutover it is evidence about,
    // and rollback has nothing to bind to.
    expect(() =>
      parseCheckStudentIdentityHealthArgs(['--mode', 'cutover', '--output', 'x.json'])
    ).toThrow('--run-id');

    const options = parseCheckStudentIdentityHealthArgs([
      '--mode',
      'cutover',
      '--output',
      'x.json',
      '--run-id',
      'run-1',
      '--plan-digest',
      'p'.repeat(64),
      '--approval-digest',
      'q'.repeat(64),
      '--export-operation-id',
      'export-1',
    ]);
    expect(options).toMatchObject({ mode: 'cutover', runId: 'run-1' });
  });

  it('rejects a positional argument', () => {
    expect(() => parseCheckStudentIdentityHealthArgs(['health.json'])).toThrow(
      'Unexpected argument'
    );
  });
});

describe('exitCodeForHealth', () => {
  it('succeeds on red unless asked to assert', () => {
    // A scheduled audit should keep collecting evidence rather than failing a
    // cron job the moment something needs attention.
    expect(exitCodeForHealth('red', { assertGreen: false })).toBe(0);
  });

  it('fails on red when asserting', () => {
    expect(exitCodeForHealth('red', { assertGreen: true })).toBe(1);
    expect(exitCodeForHealth('green', { assertGreen: true })).toBe(0);
  });
});

describe('CLI execution', () => {
  const TARGET = { projectId: 'edutrack', databaseId: '(default)' };

  function testRuntime(overrides: Partial<StudentIdentityCliRuntime> = {}): StudentIdentityCliRuntime {
    return {
      env: { FIREBASE_PROJECT_ID: 'edutrack', FIRESTORE_DATABASE_ID: '(default)' },
      now: () => new Date('2026-08-09T10:00:00Z'),
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      openDocumentStore: async () => ({ db: createInMemoryDocumentStore({}).db as never, target: TARGET }),
      readText: async () => '',
      writeTextAtomic: async () => {},
      ...overrides,
    };
  }

  it('handles --help', async () => {
    let stdout = '';
    const runtime = testRuntime({ stdout: { write: (s: string) => { stdout += s; } } });
    
    const code = await executeStudentIdentityCli({
      argv: ['--help'],
      usage: CHECK_STUDENT_IDENTITY_HEALTH_USAGE,
      parse: parseCheckStudentIdentityHealthArgs,
      run: checkStudentIdentityHealthCommand,
      runtime,
    });

    expect(code).toBe(0);
    expect(stdout).toContain('Usage:');
  });

  it('rejects unknown flags', async () => {
    let stderr = '';
    const runtime = testRuntime({ stderr: { write: (s: string) => { stderr += s; } } });
    
    const code = await executeStudentIdentityCli({
      argv: ['--unknown'],
      usage: CHECK_STUDENT_IDENTITY_HEALTH_USAGE,
      parse: parseCheckStudentIdentityHealthArgs,
      run: checkStudentIdentityHealthCommand,
      runtime,
    });

    expect(code).toBe(2);
    expect(stderr).toContain('Unknown flag');
  });

  it('requires target confirmation for write', async () => {
    let stderr = '';
    const runtime = testRuntime({ stderr: { write: (s: string) => { stderr += s; } } });
    
    const code = await executeStudentIdentityCli({
      argv: ['--write'],
      usage: CHECK_STUDENT_IDENTITY_HEALTH_USAGE,
      parse: parseCheckStudentIdentityHealthArgs,
      run: checkStudentIdentityHealthCommand,
      runtime,
    });

    expect(code).toBe(2);
    expect(stderr).toContain('--confirm-project-id');
  });

  it('writes the report the operator asked for and asserts on it', async () => {
    let outputPath = '';
    let outputData = '';
    const { db } = createInMemoryDocumentStore({
      '_maintenance/student_identity': {
        mode: 'normal',
        activeRunId: null,
        migrationActorId: null,
        updatedAt: '2026-08-09T09:00:00.000Z',
        updatedBy: 'operator',
      },
      // A canonical profile with no accounting summary: the projection is
      // behind, which is a real blocker in every mode.
      'students/s1': { studentId: 'HS-1', studentLifecycle: 'enrolled' },
    });
    const runtime = testRuntime({
      openDocumentStore: async () => ({ db: db as never, target: TARGET }),
      writeTextAtomic: async (p: string, c: string) => {
        outputPath = p;
        outputData = c;
      },
    });

    const code = await executeStudentIdentityCli({
      argv: ['--output', 'out.json', '--assert-green'],
      usage: CHECK_STUDENT_IDENTITY_HEALTH_USAGE,
      parse: parseCheckStudentIdentityHealthArgs,
      run: checkStudentIdentityHealthCommand,
      runtime,
    });

    // A profile carrying mergedIntoStudentId with no alias is a real blocker,
    // so this center is red and --assert-green has to say so.
    expect(code).toBe(1);
    expect(outputPath).toBe('out.json');
    expect(JSON.parse(outputData)).toMatchObject({ status: 'red', mode: 'daily' });
  });

  it('refuses to touch a database that is not the one named on the command line', async () => {
    let stderr = '';
    const { db } = createInMemoryDocumentStore({});
    const runtime = testRuntime({
      stderr: { write: (s: string) => { stderr += s; } },
      openDocumentStore: async () => ({
        db: db as never,
        target: { projectId: 'some-other-project', databaseId: '(default)' },
      }),
      env: { FIREBASE_PROJECT_ID: 'some-other-project', FIRESTORE_DATABASE_ID: '(default)' },
    });

    const code = await executeStudentIdentityCli({
      argv: [
        '--output',
        'out.json',
        '--write',
        '--confirm-project-id',
        'edutrack',
        '--confirm-database-id',
        '(default)',
      ],
      usage: CHECK_STUDENT_IDENTITY_HEALTH_USAGE,
      parse: parseCheckStudentIdentityHealthArgs,
      run: checkStudentIdentityHealthCommand,
      runtime,
    });

    expect(code).toBe(1);
    expect(stderr).toContain('STUDENT_IDENTITY_TARGET_CONFIRMATION_MISMATCH');
  });
});
