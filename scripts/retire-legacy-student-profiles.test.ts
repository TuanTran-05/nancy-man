import { beforeEach, describe, expect, it } from 'vitest';
import { parseRetireLegacyStudentProfilesArgs } from './retire-legacy-student-profiles.js';

const CONFIRM = [
  '--confirm-project-id',
  'edutrack',
  '--confirm-database-id',
  '(default)',
] as const;

describe('parseRetireLegacyStudentProfilesArgs', () => {
  it('requires exactly one mode', () => {
    expect(() => parseRetireLegacyStudentProfilesArgs([])).toThrow('One of --audit-preliminary');
    expect(() => parseRetireLegacyStudentProfilesArgs(['--apply', '--verify'])).toThrow(
      'Exactly one mode is allowed'
    );
  });

  it('has no --force, and says so rather than reading as a typo', () => {
    expect(() =>
      parseRetireLegacyStudentProfilesArgs(['--apply', '--force'])
    ).toThrow('--force does not exist');
  });

  it('parses --plan mode, the deprecated spelling of the final audit', () => {
    expect(
      parseRetireLegacyStudentProfilesArgs([
        '--plan',
        '--run-id',
        'ret-1',
        '--actor-id',
        'migration',
        '--source-commit',
        'c'.repeat(40),
        '--export-operation-id',
        'op-1',
        '--output',
        'scratch/plan.json',
      ])
    ).toMatchObject({ mode: 'plan', outputPath: 'scratch/plan.json' });
  });

  it('parses the two audit modes the runbook names', () => {
    // The runbook's retirement phase types these two aliases. A parser that
    // does not know them turns a documented step into a command that exits 2
    // at 2am, in the one window where writes are already blocked.
    expect(
      parseRetireLegacyStudentProfilesArgs([
        '--audit-preliminary',
        '--run-id',
        'ret-1',
        '--actor-id',
        'migration',
        '--output',
        'scratch/preliminary.json',
      ])
    ).toMatchObject({ mode: 'audit-preliminary', outputPath: 'scratch/preliminary.json' });

    expect(
      parseRetireLegacyStudentProfilesArgs([
        '--audit-final',
        '--run-id',
        'ret-1',
        '--actor-id',
        'migration',
        '--source-commit',
        'c'.repeat(40),
        '--export-operation-id',
        'op-1',
        '--output',
        'scratch/final.json',
      ])
    ).toMatchObject({ mode: 'audit-final', exportOperationId: 'op-1' });
  });

  it('requires export evidence for the final audit and not for the preliminary one', () => {
    // Preliminary runs before the export exists; that is the point of having
    // two phases. Final is the one whose output can be approved, so it may not
    // be produced without the evidence the approval binds to.
    expect(() =>
      parseRetireLegacyStudentProfilesArgs([
        '--audit-final',
        '--run-id',
        'ret-1',
        '--actor-id',
        'migration',
        '--output',
        'scratch/final.json',
      ])
    ).toThrow('--export-operation-id');
  });

  it('parses --approve mode', () => {
    expect(
      parseRetireLegacyStudentProfilesArgs([
        '--approve',
        '--plan',
        'scratch/plan.json',
        '--approval-role',
        'identity_technical',
        '--reviewer-id',
        'someone',
        '--confirm-plan-digest',
        'p'.repeat(64),
        '--output',
        'scratch/approval.json',
      ])
    ).toMatchObject({ mode: 'approve', approvalRole: 'identity_technical' });
  });

  it('parses --apply mode', () => {
    const options = parseRetireLegacyStudentProfilesArgs([
      '--apply',
      '--run-id',
      'ret-1',
      '--actor-id',
      'migration',
      '--plan',
      'scratch/plan.json',
      '--confirm-plan-digest',
      'p'.repeat(64),
      '--confirm-approval-digest',
      'q'.repeat(64),
      ...CONFIRM,
    ]);
    expect(options).toMatchObject({ mode: 'apply', runId: 'ret-1' });
  });

  it('parses --verify mode', () => {
    const options = parseRetireLegacyStudentProfilesArgs([
      '--verify',
      '--run-id',
      'ret-1',
      '--actor-id',
      'migration',
      '--plan',
      'scratch/plan.json',
      '--confirm-plan-digest',
      'p'.repeat(64),
      '--confirm-approval-digest',
      'q'.repeat(64),
      ...CONFIRM,
    ]);
    expect(options).toMatchObject({ mode: 'verify', runId: 'ret-1' });
  });

  it('parses --rollback-plan mode', () => {
    expect(
      parseRetireLegacyStudentProfilesArgs([
        '--rollback-plan',
        '--run-id',
        'ret-1',
      ])
    ).toMatchObject({ mode: 'rollback-plan' });
  });

  it('parses --rollback-approve mode', () => {
    expect(
      parseRetireLegacyStudentProfilesArgs([
        '--rollback-approve',
        '--run-id',
        'ret-1',
      ])
    ).toMatchObject({ mode: 'rollback-approve' });
  });

  it('parses --rollback-apply mode', () => {
    expect(
      parseRetireLegacyStudentProfilesArgs([
        '--rollback-apply',
        '--run-id',
        'ret-1',
      ])
    ).toMatchObject({ mode: 'rollback-apply' });
  });

  it('parses --rollback-verify mode', () => {
    expect(
      parseRetireLegacyStudentProfilesArgs([
        '--rollback-verify',
        '--run-id',
        'ret-1',
      ])
    ).toMatchObject({ mode: 'rollback-verify' });
  });

  it('rejects unknown, repeated, and value-less flags', () => {
    expect(() =>
      parseRetireLegacyStudentProfilesArgs(['--verify', '--yolo'])
    ).toThrow('Unknown flag: --yolo');
    expect(() =>
      parseRetireLegacyStudentProfilesArgs(['--verify', '--run-id', 'a', '--run-id', 'b'])
    ).toThrow('Repeated flag: --run-id');
    expect(() => parseRetireLegacyStudentProfilesArgs(['--verify', '--run-id'])).toThrow(
      'Missing value for --run-id'
    );
    expect(() => parseRetireLegacyStudentProfilesArgs(['apply'])).toThrow('Unexpected argument');
  });
});

import {
  collectUnconvertedLegacyFieldReaders,
  retireLegacyStudentProfilesCommand,
} from './retire-legacy-student-profiles.js';
import { runStudentIdentityArchitectureCheck } from './check-student-identity-architecture.js';
import { operationId } from './student-profile-retirement/writer.js';
import { createInMemoryDocumentStore } from '../test-utils/inMemoryDocumentStore.js';
import { resetStudentIdentityMaintenanceCacheForTests } from '../server/api/lib/maintenance/studentIdentityMaintenance.js';
import type { StudentIdentityCliRuntime } from './student-identity-cli/runtime.js';

describe('retire-legacy-student-profiles orchestration', () => {
  const NOW = new Date('2026-09-15T10:00:00.000Z');
  const TARGET = { projectId: 'edutrack', databaseId: '(default)' };

  const TOMBSTONE = {
    studentProfileState: 'merged_tombstone',
    canonicalProfileId: 'canonical-1',
    mergeRunId: 'run-0',
    mergedAt: '2026-08-01T00:00:00.000Z',
    identityWriteDisabled: true,
    authDisabled: true,
    walletOwnership: 'canonicalized',
    tombstoneSourceFingerprint: 'b'.repeat(64),
  };

  const DELETE_OP = {
    kind: 'delete_profile_tombstone' as const,
    documentId: 'legacy-1',
    beforeFingerprint: '',
  };

  function runtimeFor(
    db: unknown,
    files: Record<string, string>,
    written: Record<string, string>
  ): StudentIdentityCliRuntime {
    return {
      env: { FIREBASE_PROJECT_ID: 'edutrack', FIRESTORE_DATABASE_ID: '(default)' },
      now: () => NOW,
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      openDocumentStore: async () => ({ db: db as never, target: TARGET }),
      readText: async (path: string) => {
        if (!(path in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return files[path];
      },
      writeTextAtomic: async (path: string, contents: string) => {
        written[path] = contents;
      },
    } as StudentIdentityCliRuntime;
  }

  beforeEach(() => resetStudentIdentityMaintenanceCacheForTests());

  it('writes a preliminary plan that says it cannot be applied', async () => {
    const { db } = createInMemoryDocumentStore({
      '_maintenance/student_identity': {
        mode: 'read_only',
        activeRunId: 'ret-1',
        migrationActorId: 'migration',
        updatedAt: 't',
        updatedBy: 'operator',
      },
      'students/legacy-1': TOMBSTONE,
    });
    const written: Record<string, string> = {};

    await retireLegacyStudentProfilesCommand(
      {
        mode: 'audit-preliminary',
        runId: 'ret-1',
        actorId: 'migration',
        outputPath: 'preliminary.json',
        confirmProjectId: 'edutrack',
        confirmDatabaseId: '(default)',
      },
      runtimeFor(db, {}, written)
    );

    const plan = JSON.parse(written['preliminary.json']);
    expect(plan).toMatchObject({ auditPhase: 'preliminary', applyable: false });
  });

  it('refuses to approve a plan that is only preliminary', async () => {
    // Approval is what makes a plan executable, so it may not be the step that
    // promotes a preliminary artifact — one produced before the export exists
    // and without fresh reads — into one.
    const { db } = createInMemoryDocumentStore({});
    const written: Record<string, string> = {};
    const preliminary = JSON.stringify({
      schemaVersion: 1,
      migrationId: 'legacy-student-profile-retirement-v1',
      runId: 'ret-1',
      generatedAt: NOW.toISOString(),
      target: TARGET,
      sourceCommitSha: '',
      exportOperationId: '',
      latestHealthAuditId: '',
      dailyGreenAuditIds: [],
      approved: false,
      auditPhase: 'preliminary',
      applyable: false,
      candidates: [],
      blockers: [],
      operations: [],
    });

    await expect(
      retireLegacyStudentProfilesCommand(
        {
          mode: 'approve',
          planPath: 'preliminary.json',
          approvalRole: 'identity_technical',
          reviewerId: 'someone',
          confirmPlanDigest: 'whatever',
          outputPath: 'approved.json',
          confirmProjectId: 'edutrack',
          confirmDatabaseId: '(default)',
        },
        runtimeFor(db, { 'preliminary.json': preliminary }, written)
      )
    ).rejects.toThrow('STUDENT_RETIREMENT_PLAN_NOT_APPLYABLE');

    expect(written['approved.json']).toBeUndefined();
  });

  it('refuses to apply operations the reviewed file does not name', async () => {
    const { db, store } = createInMemoryDocumentStore({
      '_maintenance/student_identity': {
        mode: 'read_only',
        activeRunId: 'ret-1',
        migrationActorId: 'migration',
        updatedAt: 't',
        updatedBy: 'operator',
      },
      'students/legacy-1': TOMBSTONE,
    });
    const written: Record<string, string> = {};
    const reviewed = JSON.stringify({
      planDigest: 'p',
      approvalDigest: 'a',
      auditPhase: 'final',
      approvals: { identity_technical: 'x', finance: 'y' },
      operationIds: [],
      operations: [DELETE_OP],
    });

    await expect(
      retireLegacyStudentProfilesCommand(
        {
          mode: 'apply',
          runId: 'ret-1',
          actorId: 'migration',
          planPath: 'reviewed.json',
          outputPath: 'apply.json',
          confirmPlanDigest: 'p',
          confirmApprovalDigest: 'a',
          confirmProjectId: 'edutrack',
          confirmDatabaseId: '(default)',
        },
        runtimeFor(db, { 'reviewed.json': reviewed }, written)
      )
    ).rejects.toThrow('STUDENT_RETIREMENT_OPERATION_NOT_REVIEWED');

    // Nothing may be deleted by a refused apply.
    expect(store.has('students/legacy-1')).toBe(true);
  });

  it('refuses a reviewed file whose digests the operator did not restate', async () => {
    const { db } = createInMemoryDocumentStore({});
    const written: Record<string, string> = {};
    const reviewed = JSON.stringify({
      planDigest: 'the-real-digest',
      approvalDigest: 'a',
      auditPhase: 'final',
      approvals: { identity_technical: 'x', finance: 'y' },
      operationIds: [operationId(DELETE_OP as never)],
      operations: [DELETE_OP],
    });

    await expect(
      retireLegacyStudentProfilesCommand(
        {
          mode: 'apply',
          runId: 'ret-1',
          actorId: 'migration',
          planPath: 'reviewed.json',
          outputPath: 'apply.json',
          confirmPlanDigest: 'a-digest-the-operator-remembered-wrong',
          confirmApprovalDigest: 'a',
          confirmProjectId: 'edutrack',
          confirmDatabaseId: '(default)',
        },
        runtimeFor(db, { 'reviewed.json': reviewed }, written)
      )
    ).rejects.toThrow('STUDENT_RETIREMENT_PLAN_DIGEST_MISMATCH');
  });
});

describe('retire-legacy-student-profiles remaining modes', () => {
  const NOW2 = new Date('2026-09-15T10:00:00.000Z');
  const TARGET2 = { projectId: 'edutrack', databaseId: '(default)' };

  function rt(files: Record<string, string>, written: Record<string, string>, db?: unknown) {
    return {
      env: { FIREBASE_PROJECT_ID: 'edutrack', FIRESTORE_DATABASE_ID: '(default)' },
      now: () => NOW2,
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      openDocumentStore: async () => ({
        db: (db ?? createInMemoryDocumentStore({}).db) as never,
        target: TARGET2,
      }),
      readText: async (p: string) => {
        if (!(p in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return files[p];
      },
      writeTextAtomic: async (p: string, c: string) => {
        written[p] = c;
      },
    } as never;
  }

  it('plans against the live center and writes a digested plan', async () => {
    const { db } = createInMemoryDocumentStore({
      '_maintenance/student_identity': {
        mode: 'read_only',
        activeRunId: 'ret-1',
        migrationActorId: 'migration',
        updatedAt: 't',
        updatedBy: 'operator',
      },
      '_maintenance/student_identity_read_model': {
        schemaVersion: 1,
        mode: 'canonical_required',
        generation: 5,
        activatedAt: 't',
        activatedBy: 'migration',
        normalizationRunId: 'run-1',
        planDigest: 'p'.repeat(64),
        approvalDigest: 'a'.repeat(64),
      },
    });
    const written: Record<string, string> = {};

    const code = await retireLegacyStudentProfilesCommand(
      {
        mode: 'plan',
        runId: 'ret-1',
        actorId: 'migration',
        outputPath: 'plan.json',
        sourceCommit: 'abc1234',
        exportOperationId: 'export-1',
        confirmProjectId: 'edutrack',
        confirmDatabaseId: '(default)',
      } as never,
      rt({}, written, db)
    );

    // This center has no seven-day green streak, so the plan is written and
    // the command reports blockers rather than pretending it may proceed.
    expect(code).toBe(1);
    const plan = JSON.parse(written['plan.json']);
    expect(plan).toMatchObject({ runId: 'ret-1', approved: false });
    expect(Array.isArray(plan.operations)).toBe(true);
    expect(plan.blockers.map((blocker: { code: string }) => blocker.code)).toContain(
      'GREEN_DAILY_AUDIT_STREAK_LT_7'
    );
    expect(plan.planDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses to approve a plan whose digest the reviewer did not restate', async () => {
    const written: Record<string, string> = {};
    // Applyable, so the refusal under test is the digest restatement rather
    // than the audit phase.
    const plan = JSON.stringify({
      runId: 'ret-1',
      operations: [],
      candidates: [],
      blockers: [],
      auditPhase: 'final',
      applyable: true,
    });

    await expect(
      retireLegacyStudentProfilesCommand(
        {
          mode: 'approve',
          runId: 'ret-1',
          planPath: 'plan.json',
          outputPath: 'approved.json',
          approvalRole: 'identity_technical',
          reviewerId: 'reviewer-1',
          confirmPlanDigest: 'a-digest-the-reviewer-remembered-wrong',
          confirmProjectId: 'edutrack',
          confirmDatabaseId: '(default)',
        } as never,
        rt({ 'plan.json': plan }, written)
      )
    ).rejects.toThrow('STUDENT_RETIREMENT_PLAN_DIGEST_MISMATCH');
  });

  it('records a verification the release gate can read', async () => {
    const { db, store } = createInMemoryDocumentStore({});
    const written: Record<string, string> = {};
    const reviewed = JSON.stringify({
      runId: 'ret-1',
      planDigest: 'p',
      approvalDigest: 'a',
      auditPhase: 'final',
      approvals: { identity_technical: 'x', finance: 'y' },
      operationIds: [],
      operations: [],
    });

    const code = await retireLegacyStudentProfilesCommand(
      {
        mode: 'verify',
        runId: 'ret-1',
        actorId: 'migration',
        planPath: 'reviewed.json',
        outputPath: 'verify.json',
        confirmPlanDigest: 'p',
        confirmApprovalDigest: 'a',
        confirmProjectId: 'edutrack',
        confirmDatabaseId: '(default)',
      } as never,
      rt({ 'reviewed.json': reviewed }, written, db)
    );

    expect(code).toBe(0);
    expect(store.get('student_profile_retirement_verifications/ret-1')).toMatchObject({
      runId: 'ret-1',
      status: 'verified',
    });
  });

  it('refuses a rollback once the irreversible boundary has been crossed', async () => {
    const { db } = createInMemoryDocumentStore({
      'student_profile_retirement_irreversible_boundaries/ret-1': {
        runId: 'ret-1',
        crossedAt: '2026-09-15T09:00:00.000Z',
      },
    });
    const written: Record<string, string> = {};

    await expect(
      retireLegacyStudentProfilesCommand(
        {
          mode: 'rollback-plan',
          runId: 'ret-1',
          actorId: 'migration',
          outputPath: 'rollback.json',
          confirmProjectId: 'edutrack',
          confirmDatabaseId: '(default)',
        } as never,
        rt({}, written, db)
      )
    ).rejects.toThrow('STUDENT_RETIREMENT_ROLLBACK_IRREVERSIBLE');
  });

  it('answers a rollback request before the boundary with the recovery that exists', async () => {
    // There is no automated retirement rollback. An operator who reaches for
    // one is in an incident, and the useful answer names what will actually
    // work — the export while writes are still blocked, forward repair after —
    // rather than reading as a tool that is merely missing today.
    const { db } = createInMemoryDocumentStore({});
    const written: Record<string, string> = {};

    await expect(
      retireLegacyStudentProfilesCommand(
        {
          mode: 'rollback-plan',
          runId: 'ret-1',
          actorId: 'migration',
          outputPath: 'rollback.json',
          confirmProjectId: 'edutrack',
          confirmDatabaseId: '(default)',
        } as never,
        rt({}, written, db)
      )
    ).rejects.toThrow(/STUDENT_RETIREMENT_ROLLBACK_NOT_AUTOMATED[\s\S]*export[\s\S]*forward repair/);
  });
});

describe('retirement planning counts references that actually survive', () => {
  const NOW3 = new Date('2026-09-15T10:00:00.000Z');

  function planRuntime(written: Record<string, string>, db: unknown) {
    return {
      env: { FIREBASE_PROJECT_ID: 'edutrack', FIRESTORE_DATABASE_ID: '(default)' },
      now: () => NOW3,
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      openDocumentStore: async () => ({
        db: db as never,
        target: { projectId: 'edutrack', databaseId: '(default)' },
      }),
      readText: async () => '',
      writeTextAtomic: async (p: string, c: string) => {
        written[p] = c;
      },
    } as never;
  }

  const RETIRABLE_WORLD = {
    '_maintenance/student_identity': {
      mode: 'read_only',
      activeRunId: 'ret-1',
      migrationActorId: 'migration',
      updatedAt: 't',
      updatedBy: 'operator',
    },
    '_maintenance/student_identity_read_model': {
      schemaVersion: 1,
      mode: 'canonical_required',
      generation: 5,
      activatedAt: 't',
      activatedBy: 'migration',
      normalizationRunId: 'run-1',
      planDigest: 'p'.repeat(64),
      approvalDigest: 'a'.repeat(64),
    },
    'students/legacy-1': {
      studentProfileState: 'merged_tombstone',
      canonicalProfileId: 'canonical-1',
      mergeRunId: 'run-0',
      mergedAt: '2026-07-01T00:00:00.000Z',
      identityWriteDisabled: true,
      authDisabled: true,
      walletOwnership: 'canonicalized',
      tombstoneSourceFingerprint: 'b'.repeat(64),
    },
    'student_profile_aliases/legacy-1': {
      legacyProfileId: 'legacy-1',
      canonicalProfileId: 'canonical-1',
      mergeRunId: 'run-0',
      reasonCode: 'profile_normalization',
      sourceFingerprint: 'a'.repeat(64),
      createdAt: 't',
      createdBy: 'merge',
    },
  };

  async function planWith(extra: Record<string, Record<string, unknown>>) {
    const { db } = createInMemoryDocumentStore({ ...RETIRABLE_WORLD, ...extra });
    const written: Record<string, string> = {};
    await retireLegacyStudentProfilesCommand(
      {
        mode: 'plan',
        runId: 'ret-1',
        actorId: 'migration',
        outputPath: 'plan.json',
        sourceCommit: 'abc1234',
        exportOperationId: 'export-1',
        confirmProjectId: 'edutrack',
        confirmDatabaseId: '(default)',
      } as never,
      planRuntime(written, db)
    );
    return JSON.parse(written['plan.json']);
  }

  function blockersFor(plan: {
    candidates?: Array<{ legacyProfileId: string; blockers: Array<{ code: string }> }>;
  }) {
    return (plan.candidates ?? [])
      .filter((candidate) => candidate.legacyProfileId === 'legacy-1')
      .flatMap((candidate) => candidate.blockers.map((blocker) => blocker.code));
  }

  it('blocks a tombstone a live document still names', async () => {
    // The planner reads an empty reference map as permission to delete. A
    // mutable document still carrying the legacy id has to reach it as a
    // blocker, not as silence.
    const plan = await planWith({
      'student_course_enrollments/enr-1': {
        id: 'enr-1',
        studentId: 'legacy-1',
        classId: 'class-1',
        termStart: '2026-07-01',
        status: 'active',
      },
    });

    expect(blockersFor(plan)).toContain('REFERENCE_REMAINS');
  });

  it('does not count the alias and code registry that retirement preserves', async () => {
    // Those records are the whole point: they are how an old receipt still
    // resolves to the right child years later.
    const plan = await planWith({
      'student_code_registry/HS-1': { studentId: 'legacy-1', code: 'HS-1' },
    });

    expect(blockersFor(plan)).not.toContain('REFERENCE_REMAINS');
  });

  it('takes its unconverted-reader blockers from the architecture scan', async () => {
    // The planner's contract says this list comes from the AST scan, "never
    // from inspection". It was being handed a literal empty array, which is
    // neither: it is an assertion that no query reads the fields this run
    // deletes, made without looking. Comparing against the scanner rather than
    // against a count keeps the test true once the readers are converted.
    const { violations } = runStudentIdentityArchitectureCheck(['--policy', 'post-retirement']);
    const expected = collectUnconvertedLegacyFieldReaders(violations);

    const plan = await planWith({});
    const reported = plan.blockers
      .filter((blocker: { code: string }) => blocker.code === 'LEGACY_FIELD_READER_NOT_CONVERTED')
      .map((blocker: { detail: string }) => blocker.detail);

    expect(reported.sort()).toEqual([...expected].sort());
  });

  it('blocks the whole run when the registry cannot describe a reference', async () => {
    const plan = await planWith({
      'some_unregistered_collection/doc-1': { studentId: 'legacy-1' },
    });

    expect(plan.blockers.map((blocker: { code: string }) => blocker.code)).toContain(
      'UNKNOWN_REFERENCE'
    );
  });
});
