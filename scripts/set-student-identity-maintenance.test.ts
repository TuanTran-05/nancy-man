import { describe, expect, it } from 'vitest';
import {
  EXIT_REASON_CLI_TO_PERSISTED,
  parseSetStudentIdentityMaintenanceArgs,
} from './set-student-identity-maintenance.js';

const CONFIRM = [
  '--confirm-project-id',
  'edutrack',
  '--confirm-database-id',
  '(default)',
] as const;

describe('parseSetStudentIdentityMaintenanceArgs', () => {
  it('reads the current state without any confirmation', () => {
    expect(parseSetStudentIdentityMaintenanceArgs(['--show'])).toMatchObject({ mode: 'show' });
  });

  it('requires exactly one mode', () => {
    expect(() => parseSetStudentIdentityMaintenanceArgs([])).toThrow(
      'One of --show, --enter, --verify-drain, or --exit is required'
    );
    // Two modes in one command is an operator who is not sure what they are
    // doing, and this is not the moment to guess on their behalf.
    expect(() => parseSetStudentIdentityMaintenanceArgs(['--enter', '--exit'])).toThrow(
      'Exactly one mode is allowed'
    );
  });

  it('makes entering restate the run, its artifacts, and the target', () => {
    expect(() => parseSetStudentIdentityMaintenanceArgs(['--enter', ...CONFIRM])).toThrow(
      '--run-id'
    );

    const options = parseSetStudentIdentityMaintenanceArgs([
      '--enter',
      ...CONFIRM,
      '--expected-generation',
      '0',
      '--run-id',
      'run-1',
      '--actor-id',
      'migration',
      '--plan-digest',
      'p'.repeat(64),
      '--approval-digest',
      'q'.repeat(64),
      '--source-commit',
      'abc1234',
      '--export-operation-id',
      'export-1',
    ]);

    expect(options).toMatchObject({ mode: 'enter', runId: 'run-1', exportOperationId: 'export-1' });
  });

  it('refuses to write without the target restated', () => {
    expect(() =>
      parseSetStudentIdentityMaintenanceArgs(['--enter', '--run-id', 'run-1'])
    ).toThrow('--confirm-project-id');
  });

  it('maps the kebab reason to the value that gets persisted', () => {
    // The persisted string is read by the retirement gate months later, so it
    // must not change because somebody preferred a different flag spelling.
    const options = parseSetStudentIdentityMaintenanceArgs([
      '--exit',
      ...CONFIRM,
      '--expected-generation',
      '0',
      '--run-id',
      'run-1',
      '--actor-id',
      'migration',
      '--reason',
      'verified-cutover',
      '--health-audit-id',
      'audit-1',
      '--health-digest',
      'h'.repeat(64),
      '--smoke-evidence-id',
      'smoke-1',
      '--projection-rebuild-evidence-id',
      'rebuild-1',
    ]);

    expect(options.reason).toBe('verified_cutover');
    expect(Object.values(EXIT_REASON_CLI_TO_PERSISTED)).toEqual([
      'verified_cutover',
      'aborted_before_apply',
      'verified_rollback',
      'verified_retirement',
    ]);
  });

  it('rejects a reason nobody defined', () => {
    expect(() =>
      parseSetStudentIdentityMaintenanceArgs([
        '--exit',
        ...CONFIRM,
        '--expected-generation',
        '0',
        '--run-id',
        'run-1',
        '--actor-id',
        'migration',
        '--reason',
        'verified_cutover',
      ])
    ).toThrow('Invalid --reason');
  });

  it('demands the evidence each exit reason stands on', () => {
    const base = [
      '--exit',
      ...CONFIRM,
      '--expected-generation',
      '0',
      '--run-id',
      'run-1',
      '--actor-id',
      'migration',
      '--reason',
    ];

    expect(() =>
      parseSetStudentIdentityMaintenanceArgs([...base, 'verified-cutover'])
    ).toThrow('--health-audit-id');
    expect(() =>
      parseSetStudentIdentityMaintenanceArgs([...base, 'verified-rollback'])
    ).toThrow('--rollback-verification-id');
    expect(() =>
      parseSetStudentIdentityMaintenanceArgs([...base, 'verified-retirement'])
    ).toThrow('--retirement-verification-id');

    // An abort claims nothing was written, so there is nothing to evidence.
    expect(
      parseSetStudentIdentityMaintenanceArgs([...base, 'aborted-before-apply'])
    ).toMatchObject({ reason: 'aborted_before_apply' });
  });

  it('makes drain verification name the file it writes', () => {
    expect(() =>
      parseSetStudentIdentityMaintenanceArgs([
        '--verify-drain',
        '--expected-generation',
        '0',
        '--run-id',
        'run-1',
        '--actor-id',
        'migration',
        '--plan-digest',
        'plan-digest',
        '--approval-digest',
        'approval-digest',
      ])
    ).toThrow('--output');
  });

  it('rejects unknown, repeated, and value-less flags', () => {
    expect(() => parseSetStudentIdentityMaintenanceArgs(['--show', '--force'])).toThrow(
      'Unknown flag: --force'
    );
    expect(() =>
      parseSetStudentIdentityMaintenanceArgs(['--show', '--run-id', 'a', '--run-id', 'b'])
    ).toThrow('Repeated flag: --run-id');
    expect(() => parseSetStudentIdentityMaintenanceArgs(['--show', '--run-id'])).toThrow(
      'Missing value for --run-id'
    );
    expect(() => parseSetStudentIdentityMaintenanceArgs(['show'])).toThrow('Unexpected argument');
  });
});

import {
  runSetStudentIdentityMaintenance,
  setStudentIdentityMaintenanceCommand,
} from './set-student-identity-maintenance.js';
import { executeStudentIdentityCli, type StudentIdentityCliRuntime } from './student-identity-cli/runtime.js';
import { createInMemoryDocumentStore } from '../test-utils/inMemoryDocumentStore.js';

describe('set-student-identity-maintenance orchestration', () => {
  const TARGET = { projectId: 'edutrack', databaseId: '(default)' };

  function runtimeFor(db: unknown, overrides: Partial<StudentIdentityCliRuntime> = {}) {
    return {
      env: { FIREBASE_PROJECT_ID: 'edutrack', FIRESTORE_DATABASE_ID: '(default)' },
      now: () => new Date('2026-08-09T10:00:00.000Z'),
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      openDocumentStore: async () => ({ db: db as never, target: TARGET }),
      readText: async () => '',
      writeTextAtomic: async () => {},
      ...overrides,
    } as StudentIdentityCliRuntime;
  }

  const normal = {
    '_maintenance/student_identity': {
      mode: 'normal',
      generation: 4,
      activeRunId: null,
      migrationActorId: null,
      updatedAt: '2026-08-09T09:00:00.000Z',
      updatedBy: 'operator',
    },
  };

  it('prints the live state for --show and writes nothing', async () => {
    let printed = '';
    const { db, writeLog } = createInMemoryDocumentStore(normal);

    const code = await runSetStudentIdentityMaintenance(
      parseSetStudentIdentityMaintenanceArgs(['--show']),
      runtimeFor(db, { stdout: { write: (line: string) => { printed += line; } } })
    );

    expect(code).toBe(0);
    expect(printed).toContain('normal');
    expect(printed).toContain('4');
    expect(writeLog).toEqual([]);
  });

  it('enters the window through the gate and reports the new generation', async () => {
    const { db, store } = createInMemoryDocumentStore({
      ...normal,
      'student_profile_merge_runs/run-1': {
        runId: 'run-1',
        planDigest: 'p'.repeat(64),
        approvalDigest: 'a'.repeat(64),
        sourceCommitSha: 'abc1234',
        exportOperationId: 'export-1',
      },
    });

    const code = await runSetStudentIdentityMaintenance(
      parseSetStudentIdentityMaintenanceArgs([
        '--enter',
        ...CONFIRM,
        '--expected-generation',
        '4',
        '--run-id',
        'run-1',
        '--actor-id',
        'migration',
        '--plan-digest',
        'p'.repeat(64),
        '--approval-digest',
        'a'.repeat(64),
        '--source-commit',
        'abc1234',
        '--export-operation-id',
        'export-1',
      ]),
      runtimeFor(db)
    );

    expect(code).toBe(0);
    expect(store.get('_maintenance/student_identity')).toMatchObject({
      mode: 'read_only',
      activeRunId: 'run-1',
      migrationActorId: 'migration',
      generation: 5,
    });
  });

  it('reports a refused transition as a failure instead of exiting clean', async () => {
    const { db, store } = createInMemoryDocumentStore(normal);

    const code = await runSetStudentIdentityMaintenance(
      parseSetStudentIdentityMaintenanceArgs([
        '--enter',
        ...CONFIRM,
        '--expected-generation',
        '99',
        '--run-id',
        'run-1',
        '--actor-id',
        'migration',
        '--plan-digest',
        'p'.repeat(64),
        '--approval-digest',
        'a'.repeat(64),
        '--source-commit',
        'abc1234',
        '--export-operation-id',
        'export-1',
      ]),
      runtimeFor(db)
    ).catch(() => 'threw');

    expect(code).toBe('threw');
    expect(store.get('_maintenance/student_identity')).toMatchObject({ mode: 'normal' });
  });

  it('refuses a target the command line did not name', async () => {
    let stderr = '';
    const { db } = createInMemoryDocumentStore(normal);
    const runtime = runtimeFor(db, {
      stderr: { write: (line: string) => { stderr += line; } },
      openDocumentStore: async () => ({
        db: db as never,
        target: { projectId: 'other-project', databaseId: '(default)' },
      }),
    });

    const code = await executeStudentIdentityCli({
      argv: ['--show', ...CONFIRM],
      usage: 'usage',
      parse: parseSetStudentIdentityMaintenanceArgs,
      run: setStudentIdentityMaintenanceCommand,
      runtime,
    });

    expect(code).toBe(1);
    expect(stderr).toContain('STUDENT_IDENTITY_TARGET_CONFIRMATION_MISMATCH');
  });
});
