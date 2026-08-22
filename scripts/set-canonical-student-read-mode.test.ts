import { describe, expect, it } from 'vitest';
import {
  READ_MODE_CLI_TO_PERSISTED,
  parseSetCanonicalStudentReadModeArgs,
} from './set-canonical-student-read-mode.js';

const TRANSITION = [
  '--run-id',
  'run-1',
  '--actor-id',
  'migration',
  '--plan-digest',
  'p'.repeat(64),
  '--approval-digest',
  'q'.repeat(64),
  '--confirm-project-id',
  'edutrack',
  '--confirm-database-id',
  '(default)',
] as const;

describe('parseSetCanonicalStudentReadModeArgs', () => {
  it('maps kebab command-line values to the snake values that get persisted', () => {
    // Two vocabularies on purpose: the persisted string is compared by the
    // cutover gate and by every read handler.
    expect(READ_MODE_CLI_TO_PERSISTED).toEqual({
      'legacy-compare': 'legacy_compare',
      'canonical-preferred': 'canonical_preferred',
      'canonical-required': 'canonical_required',
    });

    const options = parseSetCanonicalStudentReadModeArgs([
      '--from',
      'legacy-compare',
      '--to',
      'canonical-preferred',
      '--expected-generation',
      '3',
      ...TRANSITION,
    ]);

    expect(options).toMatchObject({
      mode: 'transition',
      from: 'legacy_compare',
      to: 'canonical_preferred',
      expectedGeneration: 3,
    });
  });

  it('rejects the persisted spelling on the command line', () => {
    expect(() =>
      parseSetCanonicalStudentReadModeArgs([
        '--from',
        'legacy_compare',
        '--to',
        'canonical-preferred',
        '--expected-generation',
        '3',
        ...TRANSITION,
      ])
    ).toThrow('Invalid --from');
  });

  it('requires the starting mode to be stated, not assumed', () => {
    // An operator who believes the center is on `canonical_preferred` and is
    // wrong should be refused rather than silently applied to a different
    // starting point.
    expect(() =>
      parseSetCanonicalStudentReadModeArgs(['--to', 'canonical-required', ...TRANSITION])
    ).toThrow('--from');
  });

  it('rejects a transition to the mode already named as the source', () => {
    expect(() =>
      parseSetCanonicalStudentReadModeArgs([
        '--from',
        'canonical-preferred',
        '--to',
        'canonical-preferred',
        '--expected-generation',
        '4',
        ...TRANSITION,
      ])
    ).toThrow('nothing to transition');
  });

  it('rejects a generation that is not a whole number', () => {
    expect(() =>
      parseSetCanonicalStudentReadModeArgs([
        '--from',
        'legacy-compare',
        '--to',
        'canonical-preferred',
        '--expected-generation',
        'latest',
        ...TRANSITION,
      ])
    ).toThrow('Invalid --expected-generation');
  });

  it('refuses to choose an output path for --show', () => {
    expect(() => parseSetCanonicalStudentReadModeArgs(['--show'])).toThrow('--output FILE');
    expect(
      parseSetCanonicalStudentReadModeArgs(['--show', '--output', 'scratch/mode.json'])
    ).toMatchObject({ mode: 'show', outputPath: 'scratch/mode.json' });
  });

  it('rejects unknown, repeated, and value-less flags', () => {
    expect(() =>
      parseSetCanonicalStudentReadModeArgs(['--show', '--output', 'x.json', '--yolo'])
    ).toThrow('Unknown flag: --yolo');
    expect(() =>
      parseSetCanonicalStudentReadModeArgs(['--from', 'legacy-compare', '--from', 'legacy-compare'])
    ).toThrow('Repeated flag: --from');
    expect(() => parseSetCanonicalStudentReadModeArgs(['--from'])).toThrow('Missing value for --from');
  });
});

import {
  runSetCanonicalStudentReadMode,
  setCanonicalStudentReadModeCommand,
} from './set-canonical-student-read-mode.js';
import { executeStudentIdentityCli, type StudentIdentityCliRuntime } from './student-identity-cli/runtime.js';
import { createInMemoryDocumentStore } from '../test-utils/inMemoryDocumentStore.js';
import { resetCanonicalStudentReadControlCacheForTests } from '../server/api/lib/student/canonicalStudentReadControl.js';

describe('set-canonical-student-read-mode orchestration', () => {
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

  it('prints the serving mode for --show without writing', async () => {
    resetCanonicalStudentReadControlCacheForTests();
    let printed = '';
    const { db, writeLog } = createInMemoryDocumentStore({
      '_maintenance/student_identity_read_model': {
        schemaVersion: 1,
        mode: 'legacy_compare',
        generation: 2,
        updatedAt: '2026-08-09T09:00:00.000Z',
        updatedBy: 'operator',
        planDigest: null,
        approvalDigest: null,
      },
    });

    let artifact = '';
    const code = await runSetCanonicalStudentReadMode(
      parseSetCanonicalStudentReadModeArgs(['--show', '--output', 'mode.json']),
      runtimeFor(db, {
        stdout: { write: (line: string) => { printed += line; } },
        writeTextAtomic: async (_path: string, contents: string) => { artifact = contents; },
      }),
      db as never
    );

    expect(code).toBe(0);
    expect(printed).toContain('legacy_compare');
    expect(JSON.parse(artifact)).toMatchObject({ mode: 'legacy_compare', generation: 2 });
    // Reading the serving mode must not itself be a write to DocumentStore.
    expect(writeLog).toEqual([]);
  });

  it('refuses a target the command line did not name', async () => {
    resetCanonicalStudentReadControlCacheForTests();
    let stderr = '';
    const { db } = createInMemoryDocumentStore({});
    const runtime = runtimeFor(db, {
      stderr: { write: (line: string) => { stderr += line; } },
      openDocumentStore: async () => ({
        db: db as never,
        target: { projectId: 'other-project', databaseId: '(default)' },
      }),
    });

    const code = await executeStudentIdentityCli({
      argv: [
        '--show',
        '--output',
        'mode.json',
        '--confirm-project-id',
        'edutrack',
        '--confirm-database-id',
        '(default)',
      ],
      usage: 'usage',
      parse: parseSetCanonicalStudentReadModeArgs,
      run: setCanonicalStudentReadModeCommand,
      runtime,
    });

    expect(code).toBe(1);
    expect(stderr).toContain('STUDENT_IDENTITY_TARGET_CONFIRMATION_MISMATCH');
  });
});

describe('set-canonical-student-read-mode derives readiness from measured evidence', () => {
  const TARGET2 = { projectId: 'edutrack', databaseId: '(default)' };

  function rt(db: unknown) {
    return {
      env: { FIREBASE_PROJECT_ID: 'edutrack', FIRESTORE_DATABASE_ID: '(default)' },
      now: () => new Date('2026-08-09T10:00:00.000Z'),
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      openDocumentStore: async () => ({ db: db as never, target: TARGET2 }),
      readText: async () => '',
      writeTextAtomic: async () => {},
    } as StudentIdentityCliRuntime;
  }

  function world(healthCounts: Record<string, number>) {
    return {
      '_maintenance/student_identity': {
        mode: 'read_only',
        activeRunId: 'run-1',
        migrationActorId: 'migration',
        generation: 3,
        updatedAt: 't',
        updatedBy: 'operator',
      },
      '_maintenance/student_identity_read_model': {
        schemaVersion: 1,
        mode: 'canonical_preferred',
        generation: 4,
        activatedAt: 't',
        activatedBy: 'migration',
        normalizationRunId: 'run-1',
        planDigest: 'p'.repeat(64),
        approvalDigest: 'q'.repeat(64),
      },
      'student_profile_merge_runs/run-1': {
        runId: 'run-1',
        planDigest: 'p'.repeat(64),
        approvalDigest: 'q'.repeat(64),
      },
      'student_identity_health_runs/audit-1': {
        auditId: 'audit-1',
        runId: 'run-1',
        status: 'green',
        counts: healthCounts,
      },
    };
  }

  const TRANSITION = {
    mode: 'transition' as const,
    from: 'canonical_preferred' as const,
    to: 'canonical_required' as const,
    expectedGeneration: 4,
    runId: 'run-1',
    actorId: 'migration',
    planDigest: 'p'.repeat(64),
    approvalDigest: 'q'.repeat(64),
    healthAuditId: 'audit-1',
    confirmProjectId: 'edutrack',
    confirmDatabaseId: '(default)',
  };

  it('refuses canonical_required while a stored audit still counts blockers', async () => {
    resetCanonicalStudentReadControlCacheForTests();
    const { db } = createInMemoryDocumentStore(
      world({
        requiredModeBlockerCount: 2,
        confirmedSameHumanUnmergedGroups: 0,
        unresolvedDifferentCodeCandidates: 0,
        quarantinedManualHoldGroups: 0,
      })
    );

    await expect(
      runSetCanonicalStudentReadMode(TRANSITION as never, rt(db), db as never)
    ).rejects.toThrow('CANONICAL_READ_REQUIRED_MODE_BLOCKED');
  });

  it('activates canonical_required when the audit measured zero of each blocker', async () => {
    resetCanonicalStudentReadControlCacheForTests();
    const { db, store } = createInMemoryDocumentStore(
      world({
        requiredModeBlockerCount: 0,
        confirmedSameHumanUnmergedGroups: 0,
        unresolvedDifferentCodeCandidates: 0,
        quarantinedManualHoldGroups: 0,
      })
    );

    const code = await runSetCanonicalStudentReadMode(TRANSITION as never, rt(db), db as never);

    expect(code).toBe(0);
    expect(store.get('_maintenance/student_identity_read_model')).toMatchObject({
      mode: 'canonical_required',
    });
  });

  it('refuses to invent readiness when no audit was named', async () => {
    resetCanonicalStudentReadControlCacheForTests();
    const { db } = createInMemoryDocumentStore(world({ requiredModeBlockerCount: 0 }));

    await expect(
      runSetCanonicalStudentReadMode(
        { ...TRANSITION, healthAuditId: undefined } as never,
        rt(db),
        db as never
      )
    ).rejects.toThrow('CANONICAL_READ_READINESS_AUDIT_REQUIRED');
  });
});
