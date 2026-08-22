import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  normalizeStudentProfilesCommand,
  parseStudentProfileNormalizationArgs,
} from './normalize-student-profiles.js';
import type { StudentIdentityCliRuntime } from './student-identity-cli/runtime.js';
import { createInMemoryDocumentStore } from '../test-utils/inMemoryDocumentStore.js';
import { resetStudentIdentityMaintenanceCacheForTests } from '../server/api/lib/maintenance/studentIdentityMaintenance.js';
import {
  createStudentProfileMergeApprovalDigest,
  createStudentProfileMergePlanDigest,
  type StudentProfileMergePlan,
} from './student-profile-normalization/reporter.js';
import { encryptRollbackBeforeImages } from './student-profile-normalization/rollbackArtifact.js';
import { fingerprintDocumentProjection } from './student-profile-normalization/canonicalJson.js';
import { deriveNormalizationOperationId } from './student-profile-normalization/writer.js';
import { STUDENT_REFERENCE_REGISTRY_VERSION } from './student-profile-normalization/referenceRegistry.js';

/**
 * The merge engine had every part except a way to run it.
 *
 * These cover the two commands that touch production: `--apply`, which is the
 * only one that writes, and `--verify`, whose result the release gate reads
 * before it will reopen writes. Both are exercised end to end through the
 * command, not through the engine modules underneath, because the gap was
 * never in the engine.
 */

const NOW = new Date('2026-08-09T10:00:00.000Z');
const TARGET = { projectId: 'edutrack', databaseId: '(default)' };
const COMMIT = 'a'.repeat(40);
const KEY = randomBytes(32).toString('base64');
const EXPORT_OPERATION = {
  name: `projects/${TARGET.projectId}/databases/${TARGET.databaseId}/operations/op-1`,
  done: true,
  metadata: {
    operationState: 'SUCCESSFUL',
    outputUriPrefix: 'gs://backups/run-1',
    startTime: '2026-08-09T08:58:00.000Z',
    endTime: '2026-08-09T09:01:00.000Z',
    snapshotTime: '2026-08-09T09:00:00.000Z',
  },
};

function ledgerData(studentId: string) {
  return { studentId, classId: 'c-1', amount: 1_000_000 };
}

const SOURCE_PATH = 'course_fee_ledgers/legacy-1_c-1';
const TARGET_PATH = 'course_fee_ledgers/canonical-1_c-1';

// The engine derives an operation's id from its own content and refuses any
// other, so the fixture has to name it the same way rather than inventing one.
const MOVE_OPERATION_ID = deriveNormalizationOperationId({
  groupId: 'g-1',
  stage: 'move_finance',
  registryEntryId: 'course_fee_ledgers',
  sourcePath: SOURCE_PATH,
  targetPath: TARGET_PATH,
  // A keyed move copies the document to its canonical path; rewriting the
  // owning field is a separate operation the engine plans on its own. So the
  // document expected afterwards is the one that was there before.
  expectedAfterFingerprint: fingerprintDocumentProjection(ledgerData('legacy-1')),
  write: { mode: 'copy_source' },
});

function basePlan(): StudentProfileMergePlan {
  const before = ledgerData('legacy-1');
  return {
    schemaVersion: 1,
    auditPhase: 'final',
    runId: 'run-1',
    sourceCommit: COMMIT,
    registryVersion: STUDENT_REFERENCE_REGISTRY_VERSION,
    target: TARGET,
    exportEvidence: {
      operationName: `projects/${TARGET.projectId}/databases/${TARGET.databaseId}/operations/export-1`,
      outputUriPrefix: 'gs://backups/run-1',
      snapshotTime: '2026-08-09T09:00:00.000Z',
      evidenceDigest: 'e'.repeat(64),
    },
    rollbackArtifact: null,
    groups: [
      {
        groupId: 'g-1',
        canonicalProfileId: 'canonical-1',
        legacyProfileIds: ['legacy-1'],
        candidateKind: 'exact_code',
        evidenceFingerprint: 'f'.repeat(64),
        operations: [
          {
            operationId: MOVE_OPERATION_ID,
            stage: 'move_finance',
            sourcePath: SOURCE_PATH,
            targetPath: TARGET_PATH,
            registryEntryId: 'course_fee_ledgers',
            kind: 'keyed_document',
            dependsOn: [],
            sourceFingerprint: fingerprintDocumentProjection(before),
            targetBeforeFingerprint: null,
            expectedAfterFingerprint: fingerprintDocumentProjection(before),
            write: { mode: 'copy_source' },
          },
        ],
        documentEffects: [],
        decisions: { credential: { action: 'none' } },
        money: { before: { ledgerAmounts: 1_000_000 }, expectedAfter: { ledgerAmounts: 1_000_000 } },
        blockers: [],
      },
    ],
    money: { before: { ledgerAmounts: 1_000_000 }, expectedAfter: { ledgerAmounts: 1_000_000 } },
    blockers: [],
  };
}

/**
 * A plan and the artifact it was sealed with.
 *
 * The artifact is sealed against the plan as it stood *before* its own digest
 * was written in, because the finished plan contains that digest and cannot
 * exist before it.
 */
function sealed(overrides: Partial<StudentProfileMergePlan> = {}) {
  const source = { ...basePlan(), ...overrides };
  const artifact = encryptRollbackBeforeImages({
    keyBase64: KEY,
    aad: {
      projectId: TARGET.projectId,
      databaseId: TARGET.databaseId,
      runId: 'run-1',
      planPreimageDigest: createStudentProfileMergePlanDigest({ ...source, rollbackArtifact: null }),
    },
    entries: [{ entryId: 'e-1', path: SOURCE_PATH, before: ledgerData('legacy-1') }],
  });
  source.rollbackArtifact = {
    fileName: artifact.fileName,
    digest: artifact.digest,
    entryCount: artifact.entryCount,
  };
  return { plan: source, artifact };
}

// Sealing encrypts with a fresh IV, so each call produces a different
// artifact and therefore a different plan digest. The default pair is sealed
// once and reused, the way a real run has exactly one.
const DEFAULT_SEALED = sealed();

function plan(): StudentProfileMergePlan {
  return DEFAULT_SEALED.plan;
}

function reviewedFor(source: StudentProfileMergePlan) {
  const planDigest = createStudentProfileMergePlanDigest(source);
  const approvals = [
    { role: 'identity_technical' as const, reviewerId: 'r-identity', reviewedAt: 't', planDigest },
    { role: 'finance' as const, reviewerId: 'r-finance', reviewedAt: 't', planDigest },
  ];
  return {
    approved: true as const,
    applyable: true as const,
    planDigest,
    approvalDigest: createStudentProfileMergeApprovalDigest({ planDigest, approvals }),
    approvals,
    target: TARGET,
    plan: source,
  };
}

function drainEvidence() {
  const reviewed = reviewedFor(plan());
  return {
    runId: 'run-1',
    observedAt: NOW.toISOString(),
    recordedBy: 'migration',
    queueCounts: {
      outboxJobs: 0,
      accountingFinanceOutbox: 0,
      receiptNotificationOutbox: 0,
      zaloBulkJobs: 0,
      payosProcessors: 0,
      passwordResetWork: 0,
    },
    activeLeases: 0,
    staleLeases: 0,
    planDigest: reviewed.planDigest,
    approvalDigest: reviewed.approvalDigest,
  };
}

function world() {
  const reviewed = reviewedFor(plan());
  return {
    '_maintenance/student_identity': {
      mode: 'read_only',
      activeRunId: 'run-1',
      migrationActorId: 'migration',
      generation: 3,
      updatedAt: 't',
      updatedBy: 'operator',
    },
    [SOURCE_PATH]: ledgerData('legacy-1'),
    'student_identity_drain_evidence/run-1': drainEvidence(),
    'student_profile_merge_runs/run-1': {
      runId: 'run-1',
      status: 'prepared',
      planDigest: reviewed.planDigest,
      approvalDigest: reviewed.approvalDigest,
      sourceCommitSha: COMMIT,
      exportOperationId: plan().exportEvidence?.operationName,
      rollbackArtifactDigest: DEFAULT_SEALED.artifact.digest,
      registryVersion: STUDENT_REFERENCE_REGISTRY_VERSION,
      actorId: 'migration',
      plannedOperationCount: 1,
      pendingOperationCount: 1,
      appliedOperationCount: 0,
      verifiedOperationCount: 0,
      failedOperationCount: 0,
    },
  };
}

function runtimeFor(
  db: unknown,
  files: Record<string, string>,
  written: Record<string, string>,
  env: Record<string, string> = {}
): StudentIdentityCliRuntime {
  return {
    env: {
      FIREBASE_PROJECT_ID: TARGET.projectId,
      FIRESTORE_DATABASE_ID: TARGET.databaseId,
      STUDENT_PROFILE_ROLLBACK_KEY_BASE64: KEY,
      ...env,
    },
    now: () => NOW,
    stdout: { write: () => {} },
    stderr: { write: () => {} },
    openDocumentStore: async () => ({ db: db as never, target: TARGET }),
    currentGitCommit: async () => COMMIT,
    readManagedExportOperation: async () => EXPORT_OPERATION,
    readText: async (path: string) => {
      const readable = {
        'drain.json': JSON.stringify({ generation: 3, evidence: drainEvidence() }),
        ...files,
      };
      if (!(path in readable)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return readable[path];
    },
    writeTextAtomic: async (path: string, contents: string) => {
      written[path] = contents;
    },
  } as StudentIdentityCliRuntime;
}

function applyArgv() {
  const reviewed = reviewedFor(plan());
  return [
    '--apply',
    '--reviewed-plan', 'reviewed.json',
    '--rollback-artifact', 'rollback.json',
    '--confirm-plan-digest', reviewed.planDigest,
    '--confirm-approval-digest', reviewed.approvalDigest,
    '--confirm-project', TARGET.projectId,
    '--confirm-database', TARGET.databaseId,
    '--confirm-commit', COMMIT,
    '--confirm-export', `projects/${TARGET.projectId}/databases/${TARGET.databaseId}/operations/export-1`,
    '--actor-id', 'migration',
    '--drain-evidence', 'drain.json',
    // No --run-id: apply takes the run from the plan it was handed, so an
    // operator cannot point a reviewed plan at a different run.
    '--report-dir', 'reports/run-1',
  ];
}

describe('normalize-student-profiles --prepare', () => {
  it('creates the immutable control record maintenance requires without touching business data', async () => {
    const reviewed = reviewedFor(plan());
    const seed = world();
    delete seed['student_profile_merge_runs/run-1'];
    const { db, store } = createInMemoryDocumentStore(seed);

    const code = await normalizeStudentProfilesCommand(
      {
        mode: 'prepare',
        reviewedPlanPath: 'reviewed.json',
        rollbackArtifactPath: 'rollback.json',
        confirmPlanDigest: reviewed.planDigest,
        confirmApprovalDigest: reviewed.approvalDigest,
        confirmProjectId: TARGET.projectId,
        confirmDatabaseId: TARGET.databaseId,
        confirmCommit: COMMIT,
        confirmExportOperationId: plan().exportEvidence?.operationName,
        actorId: 'migration',
      },
      runtimeFor(
        db,
        {
          'reviewed.json': JSON.stringify(reviewed),
          'rollback.json': JSON.stringify(DEFAULT_SEALED.artifact),
        },
        {}
      )
    );

    expect(code).toBe(0);
    expect(store.get('student_profile_merge_runs/run-1')).toMatchObject({
      status: 'prepared',
      plannedOperationCount: 1,
      appliedOperationCount: 0,
      planDigest: reviewed.planDigest,
    });
    expect(store.get(SOURCE_PATH)).toEqual(ledgerData('legacy-1'));
  });
});

describe('normalize-student-profiles --apply', () => {
  beforeEach(() => resetStudentIdentityMaintenanceCacheForTests());

  it('moves the document the reviewed plan names and journals the operation', async () => {
    const source = plan();
    const reviewed = reviewedFor(source);
    const { db, store } = createInMemoryDocumentStore(world());
    const written: Record<string, string> = {};

    const code = await normalizeStudentProfilesCommand(
      parseStudentProfileNormalizationArgs(applyArgv()),
      runtimeFor(
        db,
        {
          'reviewed.json': JSON.stringify(reviewed),
          'rollback.json': JSON.stringify(DEFAULT_SEALED.artifact),
        },
        written
      )
    );

    expect(code).toBe(0);
    expect(store.get(TARGET_PATH)).toMatchObject(ledgerData('legacy-1'));
    expect(store.get('student_profile_merge_runs/run-1')).toMatchObject({
      status: 'applied',
      plannedOperationCount: 1,
      appliedOperationCount: 1,
      pendingOperationCount: 0,
    });
    // The journal and the document move together or not at all.
    expect([...store.keys()].some((key) => key.includes(MOVE_OPERATION_ID))).toBe(true);
  });

  it('refuses when the operator restated a digest the file does not carry', async () => {
    const reviewed = reviewedFor(plan());
    const { db, store } = createInMemoryDocumentStore(world());
    const written: Record<string, string> = {};
    const argv = applyArgv();
    argv[argv.indexOf('--confirm-plan-digest') + 1] = 'c'.repeat(64);

    await expect(
      normalizeStudentProfilesCommand(
        parseStudentProfileNormalizationArgs(argv),
        runtimeFor(
          db,
          {
            'reviewed.json': JSON.stringify(reviewed),
            'rollback.json': JSON.stringify(DEFAULT_SEALED.artifact),
          },
          written
        )
      )
    ).rejects.toThrow(/DIGEST_MISMATCH/);

    // Nothing may move on a refused apply.
    expect(store.has(TARGET_PATH)).toBe(false);
    expect(store.get(SOURCE_PATH)).toMatchObject(ledgerData('legacy-1'));
  });

  it('refuses to write once the maintenance window has closed', async () => {
    const reviewed = reviewedFor(plan());
    const seed = world();
    seed['_maintenance/student_identity'] = {
      ...seed['_maintenance/student_identity'],
      mode: 'normal',
      activeRunId: null,
      migrationActorId: null,
    };
    const { db, store } = createInMemoryDocumentStore(seed);
    const written: Record<string, string> = {};

    await expect(
      normalizeStudentProfilesCommand(
        parseStudentProfileNormalizationArgs(applyArgv()),
        runtimeFor(
          db,
          {
            'reviewed.json': JSON.stringify(reviewed),
            'rollback.json': JSON.stringify(DEFAULT_SEALED.artifact),
          },
          written
        )
      )
    ).rejects.toThrow();

    expect(store.has(TARGET_PATH)).toBe(false);
  });
});

describe('normalize-student-profiles --verify', () => {
  beforeEach(() => resetStudentIdentityMaintenanceCacheForTests());

  function verifyArgv() {
    const reviewed = reviewedFor(plan());
    return [
      '--verify',
      '--reviewed-plan', 'reviewed.json',
      '--confirm-plan-digest', reviewed.planDigest,
      '--confirm-approval-digest', reviewed.approvalDigest,
      '--confirm-project', TARGET.projectId,
      '--confirm-database', TARGET.databaseId,
      '--run-id', 'run-1',
    ];
  }

  it('records a verification the identity health service can read', async () => {
    // This is the link that was missing: nothing carried the engine's money
    // check into the evidence the release gate reads.
    const reviewed = reviewedFor(plan());
    const seed = world();
    delete seed[SOURCE_PATH];
    const { db, store } = createInMemoryDocumentStore({
      ...seed,
      [TARGET_PATH]: ledgerData('canonical-1'),
      'students/canonical-1': { studentId: 'HS-1', studentLifecycle: 'enrolled' },
      'students/legacy-1': { studentProfileState: 'merged_tombstone' },
      'student_profile_aliases/legacy-1': {
        legacyProfileId: 'legacy-1',
        canonicalProfileId: 'canonical-1',
      },
      [`student_profile_merge_journal/run-1_${MOVE_OPERATION_ID}`]: {
        runId: 'run-1',
        operationId: MOVE_OPERATION_ID,
        status: 'applied',
      },
      'student_profile_merge_runs/run-1': {
        ...world()['student_profile_merge_runs/run-1'],
        status: 'applied',
        appliedOperationCount: 1,
        pendingOperationCount: 0,
      },
    });
    const written: Record<string, string> = {};

    await normalizeStudentProfilesCommand(
      parseStudentProfileNormalizationArgs(verifyArgv()),
      runtimeFor(db, { 'reviewed.json': JSON.stringify(reviewed) }, written)
    );

    const verification = store.get('student_profile_normalization_verifications/run-1');
    expect(verification).toMatchObject({ runId: 'run-1', moneyMatches: true });
    expect(verification).toMatchObject({ blockers: [] });
    expect(store.get('student_profile_merge_runs/run-1')).toMatchObject({
      status: 'verified',
      verifiedOperationCount: 1,
    });
  });

  it('does not record a passing money check when nothing was observed', async () => {
    const emptyMoneyPlan = { ...plan(), money: { before: {}, expectedAfter: {} } };
    const reviewed = reviewedFor(emptyMoneyPlan);
    const { db, store } = createInMemoryDocumentStore(world());
    const written: Record<string, string> = {};
    const argv = verifyArgv();
    argv[argv.indexOf('--confirm-plan-digest') + 1] = reviewed.planDigest;
    argv[argv.indexOf('--confirm-approval-digest') + 1] = reviewed.approvalDigest;

    await normalizeStudentProfilesCommand(
      parseStudentProfileNormalizationArgs(argv),
      runtimeFor(db, { 'reviewed.json': JSON.stringify(reviewed) }, written)
    ).catch(() => undefined);

    const verification = store.get('student_profile_normalization_verifications/run-1') as
      | { moneyMatches?: boolean }
      | undefined;
    expect(verification?.moneyMatches).not.toBe(true);
  });
});

describe('audit and approval chain', () => {
  const REVIEWERS = {
    STUDENT_PROFILE_IDENTITY_REVIEWERS: 'reviewer-identity',
    STUDENT_PROFILE_FINANCE_REVIEWERS: 'reviewer-finance',
    STUDENT_PROFILE_AUTH_REVIEWERS: 'reviewer-auth',
  };

  function duplicateWorld() {
    return {
      'students/canonical-1': {
        name: 'QUÁCH HOÀNG MINH',
        dob: '2014-05-02',
        contact: '0900000000',
        studentId: 'HS260167',
        admissionSearchName: 'QUACH HOANG MINH',
        admissionSearchDob: '2014-05-02',
        admissionSearchContact: '0900000000',
        studentLifecycle: 'enrolled',
        walletBalance: 500_000,
      },
      'students/legacy-1': {
        name: 'QUÁCH HOÀNG MINH',
        dob: '2014-05-02',
        contact: '0900000000',
        studentId: 'HS260167',
        admissionSearchName: 'QUACH HOANG MINH',
        admissionSearchDob: '2014-05-02',
        admissionSearchContact: '0900000000',
        studentLifecycle: 'archived',
        walletBalance: 0,
      },
    };
  }

  /**
   * A pair already soft-merged by the old promotion path.
   *
   * The pointer is the adjudication: the centre has said these are one human,
   * so the assembler proceeds past the identity decision and reconciles
   * credentials and accounts. That is where account classification happens,
   * and it is the shape 58 of the 67 production groups have.
   */
  function softMergedWorld() {
    const world = duplicateWorld() as Record<string, Record<string, unknown>>;
    world['students/legacy-1'] = { ...world['students/legacy-1'], mergedIntoStudentId: 'canonical-1' };
    return world;
  }

  async function reportDir(name: string) {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    return path.join(await mkdtemp(path.join(tmpdir(), 'student-audit-' + name + '-')), 'run');
  }

  async function readArtifact(dir: string) {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    return JSON.parse(await readFile(path.join(dir, 'student-profile-plan.json'), 'utf8'));
  }

  it('produces a plan a reviewer can read and cannot execute', async () => {
    const { db } = createInMemoryDocumentStore(duplicateWorld());
    const written: Record<string, string> = {};
    const dir = await reportDir('preliminary');

    const code = await normalizeStudentProfilesCommand(
      {
        mode: 'audit-preliminary',
        runId: 'run-1',
        reportDir: dir,
        sourceCommit: COMMIT,
        confirmProjectId: TARGET.projectId,
        confirmDatabaseId: TARGET.databaseId,
      } as never,
      runtimeFor(db, {}, written)
    );

    const artifact = await readArtifact(dir);

    // Blockers are expected: nobody has adjudicated the candidate yet. What
    // matters is that the artifact exists, names the group, and says plainly
    // that it may not be run.
    expect(code).toBe(1);
    expect(artifact.applyable).toBe(false);
    expect(artifact.planDigest).toBeNull();
    expect(artifact.plan.groups).toHaveLength(1);
    expect(artifact.plan.groups[0].legacyProfileIds).toEqual(['legacy-1']);
  });

  it('classifies a linked account by its role field, not only by its document id', async () => {
    // `student:<id>` / `parent:<id>` is what studentProfileSync writes, but it
    // is not the only spelling in production: accounts also exist keyed by the
    // Firebase Auth uid, and every serving path — authz, the health service,
    // realtime recipients — reads the `role` field to classify those. An audit
    // that looks only at the id prefix calls all of them `unknown`, and an
    // unknown role blocks the merge outright. The first production audit
    // blocked 36 of 58 pointer groups this way.
    const { db } = createInMemoryDocumentStore({
      ...softMergedWorld(),
      'users/2u3XGOO1wLhrBZzCFm9SILPuZIv2': { role: 'student', studentId: 'legacy-1' },
    });
    const written: Record<string, string> = {};
    const dir = await reportDir('linked-role');

    await normalizeStudentProfilesCommand(
      {
        mode: 'audit-preliminary',
        runId: 'run-1',
        reportDir: dir,
        sourceCommit: COMMIT,
        confirmProjectId: TARGET.projectId,
        confirmDatabaseId: TARGET.databaseId,
      } as never,
      runtimeFor(db, {}, written)
    );

    const artifact = await readArtifact(dir);
    const codes = artifact.plan.groups.flatMap((group: { blockers: { code: string }[] }) =>
      group.blockers.map((blocker) => blocker.code)
    );

    expect(codes).not.toContain('UNKNOWN_LINKED_ROLE');
  });

  it('still refuses to guess when neither the id nor the role field says', async () => {
    // The blocker is right when nothing classifies the account. It grants
    // someone access, and a merge that ignores it either strands or orphans
    // that access — so the fix above must not become "assume student".
    const { db } = createInMemoryDocumentStore({
      ...softMergedWorld(),
      'users/2u3XGOO1wLhrBZzCFm9SILPuZIv2': { role: 'operator', studentId: 'legacy-1' },
    });
    const written: Record<string, string> = {};
    const dir = await reportDir('linked-role-unknown');

    await normalizeStudentProfilesCommand(
      {
        mode: 'audit-preliminary',
        runId: 'run-1',
        reportDir: dir,
        sourceCommit: COMMIT,
        confirmProjectId: TARGET.projectId,
        confirmDatabaseId: TARGET.databaseId,
      } as never,
      runtimeFor(db, {}, written)
    );

    const artifact = await readArtifact(dir);
    const codes = artifact.plan.groups.flatMap((group: { blockers: { code: string }[] }) =>
      group.blockers.map((blocker) => blocker.code)
    );

    expect(codes).toContain('UNKNOWN_LINKED_ROLE');
  });

  it('records every unregistered reference in the inventory artifact, field paths included', async () => {
    // An unknown reference blocks the global apply, so a reviewer's next move
    // is to add the missing registry entry — and the field path is the only
    // part of the finding that says which entry that is. The blocker line
    // carries `documentPath names <ids>` and nothing else, so dropping the
    // field paths from the evidence file leaves the finding unactionable.
    // The first production audit reported 996 of these and the artifact
    // recorded none of them.
    const { db } = createInMemoryDocumentStore({
      ...duplicateWorld(),
      // Registered collection, unregistered field: audit_logs is known by
      // studentId/entityId/targetId only, never by collection name alone.
      'audit_logs/log-1': { action: 'student.updated', details: { studentId: 'legacy-1' } },
    });
    const written: Record<string, string> = {};
    const dir = await reportDir('unknown-refs');

    await normalizeStudentProfilesCommand(
      {
        mode: 'audit-preliminary',
        runId: 'run-1',
        reportDir: dir,
        sourceCommit: COMMIT,
        confirmProjectId: TARGET.projectId,
        confirmDatabaseId: TARGET.databaseId,
      } as never,
      runtimeFor(db, {}, written)
    );

    const { readFile } = await import('node:fs/promises');
    const nodePath = await import('node:path');
    const inventory = JSON.parse(
      await readFile(nodePath.join(dir, 'student-profile-reference-inventory.json'), 'utf8')
    );

    expect(inventory.unknown).toEqual([
      {
        documentPath: 'audit_logs/log-1',
        matchedFieldPaths: ['details.studentId'],
        matchedProfileIds: ['legacy-1'],
      },
    ]);
  });

  it('turns a reviewed decision into an approvable plan and signs it', async () => {
    const { db } = createInMemoryDocumentStore(duplicateWorld());
    const written: Record<string, string> = {};
    const preliminaryDir = await reportDir('final-a');
    const finalDir = await reportDir('final-b');

    await normalizeStudentProfilesCommand(
      {
        mode: 'audit-preliminary',
        runId: 'run-1',
        reportDir: preliminaryDir,
        sourceCommit: COMMIT,
      } as never,
      runtimeFor(db, {}, written)
    );
    const preliminary = await readArtifact(preliminaryDir);
    const group = preliminary.plan.groups[0];

    // The decision names the candidate and the evidence it was reported with,
    // so it cannot be carried onto a different reading of the database.
    const decisions = JSON.stringify({
      decisions: [
        {
          candidateId: group.groupId,
          evidenceFingerprint: group.evidenceFingerprint,
          decision: 'merge_same_human',
          canonicalProfileId: 'canonical-1',
          reviewerId: 'reviewer-identity',
          reason: 'same child, two codes',
        },
      ],
    });

    await normalizeStudentProfilesCommand(
      {
        mode: 'audit-final',
        runId: 'run-1',
        reportDir: finalDir,
        sourceCommit: COMMIT,
        reviewDecisionsPath: 'decisions.json',
        exportOperationId: 'op-1',
        exportUri: 'gs://backups/run-1',
        rollbackArtifactPath: `${finalDir}/student-profile-rollback-before-images.enc`,
      } as never,
      runtimeFor(db, { 'decisions.json': decisions }, written)
    );

    const finalArtifact = await readArtifact(finalDir);
    expect(finalArtifact.applyable).toBe(true);
    expect(finalArtifact.planDigest).toMatch(/^[0-9a-f]{64}$/);

    const stages = finalArtifact.plan.groups[0].operations.map(
      (operation: { stage: string }) => operation.stage
    );
    expect(stages).toContain('create_aliases');
    expect(stages).toContain('tombstone_legacy');

    // Approval attests; it does not author. Two roles, two people, one digest.
    await normalizeStudentProfilesCommand(
      {
        mode: 'approve',
        planPath: 'plan.json',
        approvalRole: 'identity_technical',
        reviewerId: 'reviewer-identity',
        confirmPlanDigest: finalArtifact.planDigest,
        outputPath: 'approved-1.json',
      } as never,
      runtimeFor(db, { 'plan.json': JSON.stringify(finalArtifact) }, written, REVIEWERS)
    );

    await normalizeStudentProfilesCommand(
      {
        mode: 'approve',
        planPath: 'approved-1.json',
        approvalRole: 'finance',
        reviewerId: 'reviewer-finance',
        confirmPlanDigest: finalArtifact.planDigest,
        outputPath: 'reviewed.json',
      } as never,
      runtimeFor(db, { 'approved-1.json': written['approved-1.json'] }, written, REVIEWERS)
    );

    const reviewed = JSON.parse(written['reviewed.json']);
    expect(reviewed.approved).toBe(true);
    expect(reviewed.applyable).toBe(true);
    expect(reviewed.approvals.map((approval: { role: string }) => approval.role).sort()).toEqual([
      'finance',
      'identity_technical',
    ]);
  });

  it('refuses to approve a preliminary artifact', async () => {
    const { db } = createInMemoryDocumentStore({});
    const written: Record<string, string> = {};
    const preliminary = JSON.stringify({
      approved: false,
      auditPhase: 'preliminary',
      applyable: false,
      planDigest: null,
      plan: { groups: [] },
    });

    await expect(
      normalizeStudentProfilesCommand(
        {
          mode: 'approve',
          planPath: 'plan.json',
          approvalRole: 'identity_technical',
          reviewerId: 'reviewer-identity',
          confirmPlanDigest: 'whatever',
          outputPath: 'approved.json',
        } as never,
        runtimeFor(db, { 'plan.json': preliminary }, written, REVIEWERS)
      )
    ).rejects.toThrow('STUDENT_PROFILE_PLAN_NOT_APPLYABLE');
  });
});
