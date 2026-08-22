import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { fingerprintDocumentProjection } from './canonicalJson.js';
import {
  createReviewedStudentProfileNormalizationPlan,
  createStudentProfileMergePlanDigest,
  type StudentProfileMergePlan,
} from './reporter.js';
import { encryptRollbackBeforeImages } from './rollbackArtifact.js';
import {
  applyStudentProfileNormalization,
  deriveNormalizationOperationId,
  MAINTENANCE_DOC_PATH,
  preflightStudentProfileNormalization,
  type NormalizationTransaction,
} from './writer.js';

const KEY = randomBytes(32).toString('base64');
const COMMIT = 'a'.repeat(40);
const FP_SOURCE = '1'.repeat(64);
const FP_AFTER = '2'.repeat(64);

function basePlan(): StudentProfileMergePlan {
  return {
    schemaVersion: 1,
    auditPhase: 'final',
    runId: 'run-1',
    sourceCommit: COMMIT,
    registryVersion: 'student-references-v2',
    target: { projectId: 'edutrack-prod', databaseId: 'edutrack' },
    exportEvidence: {
      operationName: 'projects/edutrack-prod/databases/edutrack/operations/op-1',
      outputUriPrefix: 'gs://backups/x',
      snapshotTime: '2026-08-07T01:00:00.000Z',
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
            operationId: 'will-be-replaced',
            stage: 'move_finance_keys',
            registryEntryId: 'course_fee_ledgers.owner',
            kind: 'recreate_document',
            dependsOn: [],
            sourcePath: 'course_fee_ledgers/legacy-1_c-1',
            targetPath: 'course_fee_ledgers/canonical-1_c-1',
            sourceFingerprint: FP_SOURCE,
            targetBeforeFingerprint: null,
            expectedAfterFingerprint: FP_SOURCE,
            write: { mode: 'copy_source' },
          },
        ],
        documentEffects: [],
        decisions: {},
        money: { before: { ledgerAmounts: 1000 }, expectedAfter: { ledgerAmounts: 1000 } },
        blockers: [],
      },
    ],
    money: { before: { ledgerAmounts: 1000 }, expectedAfter: { ledgerAmounts: 1000 } },
    blockers: [],
  };
}

const AAD = {
  projectId: 'edutrack-prod',
  databaseId: 'edutrack',
  runId: 'run-1',
  planPreimageDigest: 'p'.repeat(64),
};

function sealedPlan(mutate: (plan: StudentProfileMergePlan) => void = () => {}) {
  const plan = basePlan();
  // Operation ids are derived, never authored, so a hand-written plan cannot
  // name an operation whose content differs from its id.
  for (const group of plan.groups) {
    for (const operation of group.operations) {
      operation.operationId = deriveNormalizationOperationId({
        groupId: group.groupId,
        stage: operation.stage,
        registryEntryId: operation.registryEntryId!,
        sourcePath: operation.sourcePath,
        targetPath: operation.targetPath,
        expectedAfterFingerprint: operation.expectedAfterFingerprint!,
        write: operation.write,
      });
    }
  }
  const artifact = encryptRollbackBeforeImages({
    entries: [{ entryId: 'e-1', path: 'course_fee_ledgers/legacy-1_c-1', before: { amount: 1000 } }],
    aad: AAD,
    keyBase64: KEY,
  });
  plan.rollbackArtifact = {
    fileName: artifact.fileName,
    digest: artifact.digest,
    entryCount: artifact.entryCount,
  };
  mutate(plan);
  return { plan, artifact };
}

function reviewedFor(plan: StudentProfileMergePlan) {
  const planDigest = createStudentProfileMergePlanDigest(plan);
  return createReviewedStudentProfileNormalizationPlan({
    plan,
    planDigest,
    approvals: [
      { role: 'identity_technical', reviewerId: 'r1', reviewedAt: '2026-08-07T02:00:00.000Z', planDigest },
      { role: 'finance', reviewerId: 'r2', reviewedAt: '2026-08-07T02:00:00.000Z', planDigest },
    ],
    authorizedReviewers: { identity_technical: ['r1'], finance: ['r2'], auth_security: ['r3'] },
  });
}

function preflightInput(
  overrides: Record<string, unknown> = {},
  mutate: (plan: StudentProfileMergePlan) => void = () => {}
) {
  // The mutation runs before the digest is computed and the plan is signed, so
  // the resulting artifact is internally consistent. That is the case worth
  // testing: a digest check alone cannot catch someone who edits a plan and
  // re-signs it, which is exactly why operation ids are content-derived.
  const { plan, artifact } = sealedPlan(mutate);
  const reviewed = reviewedFor(plan);
  return {
    reviewed,
    rollbackArtifact: artifact,
    rollbackAad: AAD,
    rollbackKeyBase64: KEY,
    confirmations: {
      planDigest: reviewed.planDigest,
      approvalDigest: reviewed.approvalDigest,
      projectId: 'edutrack-prod',
      databaseId: 'edutrack',
      sourceCommit: COMMIT,
      exportOperationId: 'projects/edutrack-prod/databases/edutrack/operations/op-1',
      actorId: 'admin:tt',
      runId: 'run-1',
    },
    observed: {
      projectId: 'edutrack-prod',
      databaseId: 'edutrack',
      currentCommit: COMMIT,
      registryVersion: 'student-references-v2',
      maintenanceMode: 'read_only',
      activeRunId: 'run-1',
      migrationActorId: 'admin:tt',
    },
    ...overrides,
  } as Parameters<typeof preflightStudentProfileNormalization>[0];
}

describe('operation id derivation', () => {
  const base = {
    groupId: 'g-1',
    stage: 'move_finance_keys',
    registryEntryId: 'course_fee_ledgers.owner',
    sourcePath: 'a',
    targetPath: 'b',
    expectedAfterFingerprint: FP_AFTER,
  };

  it('is stable for identical content', () => {
    expect(deriveNormalizationOperationId(base)).toBe(deriveNormalizationOperationId(base));
  });

  it.each([
    ['groupId', { groupId: 'g-2' }],
    ['stage', { stage: 'rewrite_references' }],
    ['registryEntryId', { registryEntryId: 'receipts.owner' }],
    ['sourcePath', { sourcePath: 'z' }],
    ['targetPath', { targetPath: 'z' }],
    ['expectedAfterFingerprint', { expectedAfterFingerprint: '3'.repeat(64) }],
  ])('changes when %s changes', (_label, override) => {
    expect(deriveNormalizationOperationId({ ...base, ...override })).not.toBe(
      deriveNormalizationOperationId(base)
    );
  });
});

describe('preflight binding', () => {
  it('accepts a fully bound reviewed plan and reports preflighted', () => {
    const result = preflightStudentProfileNormalization(preflightInput());

    expect(result.status).toBe('preflighted');
    expect(result.runId).toBe('run-1');
    expect(result.operations).toHaveLength(1);
    expect(result.journalSkeletons[0]).toMatchObject({ status: 'pending', runId: 'run-1' });
  });

  it.each([
    ['plan digest', { confirmations: { planDigest: 'z'.repeat(64) } }],
    ['approval digest', { confirmations: { approvalDigest: 'z'.repeat(64) } }],
    ['project', { confirmations: { projectId: 'edutrack-staging' } }],
    ['database', { confirmations: { databaseId: 'other' } }],
    ['commit', { confirmations: { sourceCommit: 'b'.repeat(40) } }],
    ['export operation', { confirmations: { exportOperationId: 'projects/edutrack-prod/databases/edutrack/operations/op-2' } }],
    ['run id', { confirmations: { runId: 'run-2' } }],
  ])('rejects a mismatched %s confirmation', (_label, override) => {
    const input = preflightInput();
    Object.assign(input.confirmations, (override as { confirmations: object }).confirmations);

    expect(() => preflightStudentProfileNormalization(input)).toThrow(
      'STUDENT_PROFILE_PREFLIGHT_CONFIRMATION_MISMATCH'
    );
  });

  it('rejects when the live database is not the one the plan targets', () => {
    const input = preflightInput();
    input.observed.projectId = 'edutrack-staging';

    // The operator's confirmation agreeing with the plan proves nothing about
    // which database the process actually opened.
    expect(() => preflightStudentProfileNormalization(input)).toThrow(
      'STUDENT_PROFILE_PREFLIGHT_TARGET_MISMATCH'
    );
  });

  it('rejects when the deployed commit drifted from the reviewed one', () => {
    const input = preflightInput();
    input.observed.currentCommit = 'c'.repeat(40);

    expect(() => preflightStudentProfileNormalization(input)).toThrow(
      'STUDENT_PROFILE_PREFLIGHT_COMMIT_DRIFT'
    );
  });

  it('rejects when maintenance is not read_only', () => {
    const input = preflightInput();
    input.observed.maintenanceMode = 'normal';

    expect(() => preflightStudentProfileNormalization(input)).toThrow(
      'STUDENT_PROFILE_PREFLIGHT_MAINTENANCE_NOT_READ_ONLY'
    );
  });

  it('rejects a registry version the plan was not built against', () => {
    const input = preflightInput();
    input.observed.registryVersion = 'student-references-v3';

    expect(() => preflightStudentProfileNormalization(input)).toThrow(
      'STUDENT_PROFILE_PREFLIGHT_REGISTRY_VERSION_MISMATCH'
    );
  });

  it('rejects a rollback artifact that is not the one the plan names', () => {
    const input = preflightInput();
    input.rollbackArtifact = encryptRollbackBeforeImages({
      entries: [{ entryId: 'other', path: 'x', before: {} }],
      aad: AAD,
      keyBase64: KEY,
    });

    expect(() => preflightStudentProfileNormalization(input)).toThrow(
      'STUDENT_PROFILE_PREFLIGHT_ROLLBACK_ARTIFACT_MISMATCH'
    );
  });

  it('rejects a rollback artifact it cannot decrypt', () => {
    const input = preflightInput();
    input.rollbackKeyBase64 = randomBytes(32).toString('base64');

    // An artifact that cannot be opened is not a rollback path, and apply must
    // not start without one.
    expect(() => preflightStudentProfileNormalization(input)).toThrow(
      'STUDENT_PROFILE_ROLLBACK_ARTIFACT_UNAUTHENTIC'
    );
  });

  it('rejects a plan carrying any blocker', () => {
    const { plan, artifact } = sealedPlan((p) => {
      p.groups[0].blockers = [{ code: 'CREDENTIAL_AMBIGUOUS', candidateId: 'c', detail: 'd' }];
    });

    expect(() => reviewedFor(plan)).toThrow('STUDENT_PROFILE_PLAN_HAS_BLOCKERS');
    expect(artifact.entryCount).toBe(1);
  });

  it('rejects an operation whose id does not match its content, even when re-signed', () => {
    const input = preflightInput({}, (plan) => {
      plan.groups[0].operations[0].operationId = 'hand-written';
    });

    expect(() => preflightStudentProfileNormalization(input)).toThrow(
      'STUDENT_PROFILE_PREFLIGHT_OPERATION_ID_MISMATCH'
    );
  });

  it('rejects an operation retargeted after its id was derived', () => {
    // The forgery this actually defends against: a valid operation pointed at
    // a different document, then re-digested and re-approved.
    const input = preflightInput({}, (plan) => {
      plan.groups[0].operations[0].targetPath = 'course_fee_ledgers/somewhere-else';
    });

    expect(() => preflightStudentProfileNormalization(input)).toThrow(
      'STUDENT_PROFILE_PREFLIGHT_OPERATION_ID_MISMATCH'
    );
  });

  it('rejects a final operation missing its execution fields', () => {
    const input = preflightInput({}, (plan) => {
      delete plan.groups[0].operations[0].expectedAfterFingerprint;
    });

    expect(() => preflightStudentProfileNormalization(input)).toThrow(
      'STUDENT_PROFILE_PREFLIGHT_OPERATION_INCOMPLETE'
    );
  });

  it('still rejects a plan edited after signing, before it reaches the operation checks', () => {
    const input = preflightInput();
    input.reviewed.plan.groups[0].operations[0].targetPath = 'course_fee_ledgers/somewhere-else';

    expect(() => preflightStudentProfileNormalization(input)).toThrow(
      'STUDENT_PROFILE_PREFLIGHT_PLAN_DIGEST_MISMATCH'
    );
  });
});

// --- Executor ---

type Doc = { data: Record<string, unknown>; fingerprint: string };

function makeStore(seed: Record<string, Doc>) {
  const docs = new Map(Object.entries(seed).map(([path, doc]) => [path, { ...doc }]));
  const maintenance = docs.get(MAINTENANCE_DOC_PATH);
  if (maintenance?.data.mode === 'read_only') {
    maintenance.data = {
      activeRunId: 'run-1',
      migrationActorId: 'admin:tt',
      ...maintenance.data,
    };
    if (!docs.has('student_profile_merge_runs/run-1')) {
      docs.set('student_profile_merge_runs/run-1', {
        data: { runId: 'run-1', status: 'prepared', appliedOperationCount: 0 },
        fingerprint: 'prepared',
      });
    }
  }
  const transactions: string[] = [];

  const store = {
    docs,
    transactions,
    async runTransaction<T>(fn: (tx: NormalizationTransaction) => Promise<T>): Promise<T> {
      transactions.push('begin');
      const staged = new Map<string, Doc | null>();
      const tx = {
        async get(path: string) {
          if (staged.has(path)) return staged.get(path);
          return docs.get(path) ?? null;
        },
        set(path: string, doc: Doc) {
          staged.set(path, doc);
        },
        delete(path: string) {
          staged.set(path, null);
        },
      };
      const result = await fn(tx);
      for (const [path, doc] of staged) {
        if (doc === null) docs.delete(path);
        else docs.set(path, doc);
      }
      return result;
    },
  };
  return store;
}

function executorSeed() {
  const preflighted = preflightStudentProfileNormalization(preflightInput());
  const operation = preflighted.operations[0];
  return {
    preflighted,
    operation,
    store: makeStore({
      [MAINTENANCE_DOC_PATH]: { data: { mode: 'read_only' }, fingerprint: 'm' },
      [operation.sourcePath!]: { data: { amount: 1000 }, fingerprint: FP_SOURCE },
    }),
  };
}

describe('journaled apply', () => {
  it('applies an operation and journals it in the same transaction', async () => {
    const { preflighted, operation, store } = executorSeed();

    const result = await applyStudentProfileNormalization({ preflighted, store });

    expect(result.status).toBe('applied');
    expect(result.appliedOperationIds).toEqual([operation.operationId]);
    expect(store.docs.has(operation.targetPath!)).toBe(true);
    expect(store.docs.has(operation.sourcePath!)).toBe(false);
    expect(store.docs.get(`student_profile_merge_journal/run-1_${operation.operationId}`)).toMatchObject(
      { data: expect.objectContaining({ status: 'applied' }) }
    );
  });

  it('refuses to write when maintenance left read_only between preflight and apply', async () => {
    const { preflighted, store } = executorSeed();
    store.docs.set(MAINTENANCE_DOC_PATH, { data: { mode: 'normal' }, fingerprint: 'm' });

    const result = await applyStudentProfileNormalization({ preflighted, store });

    // The guard is re-read inside the operation transaction, not trusted from
    // preflight: writes reopening mid-run is exactly the race this prevents.
    expect(result.status).toBe('failed');
    expect(result.failure?.code).toBe('STUDENT_PROFILE_APPLY_MAINTENANCE_LOST');
  });

  it('stops on source drift and journals the failure', async () => {
    const { preflighted, operation, store } = executorSeed();
    store.docs.set(operation.sourcePath!, { data: { amount: 999 }, fingerprint: 'drifted' });

    const result = await applyStudentProfileNormalization({ preflighted, store });

    expect(result.status).toBe('failed');
    expect(result.failure?.code).toBe('STUDENT_PROFILE_APPLY_SOURCE_DRIFT');
    expect(store.docs.has(operation.targetPath!)).toBe(false);
    expect(
      store.docs.get(`student_profile_merge_journal/run-1_${operation.operationId}`)?.data
    ).toMatchObject({ status: 'failed', errorCode: 'STUDENT_PROFILE_APPLY_SOURCE_DRIFT' });
  });

  it('treats an already-applied journal as an idempotent retry', async () => {
    const { preflighted, operation, store } = executorSeed();
    await applyStudentProfileNormalization({ preflighted, store });
    const writesAfterFirst = store.transactions.length;

    const second = await applyStudentProfileNormalization({ preflighted, store });

    expect(second.status).toBe('applied');
    expect(second.skippedOperationIds).toEqual([operation.operationId]);
    expect(store.transactions.length).toBeGreaterThan(writesAfterFirst);
  });

  it('refuses to resume a run whose journal records a failure', async () => {
    const { preflighted, operation, store } = executorSeed();
    store.docs.set(`student_profile_merge_journal/run-1_${operation.operationId}`, {
      data: { runId: 'run-1', operationId: operation.operationId, status: 'failed', errorCode: 'X' },
      fingerprint: 'j',
    });

    const result = await applyStudentProfileNormalization({ preflighted, store });

    // A failed operation needs a human decision; silently retrying it would
    // paper over whatever made it fail.
    expect(result.status).toBe('failed');
    expect(result.failure?.code).toBe('STUDENT_PROFILE_APPLY_JOURNAL_FAILED_PRESENT');
  });

  it('does not run an operation whose dependency has not applied', async () => {
    const preflighted = preflightStudentProfileNormalization(preflightInput());
    const first = preflighted.operations[0];
    const dependent = {
      ...first,
      operationId: 'dependent-op',
      sourcePath: 'receipts/r-1',
      targetPath: 'receipts/r-1',
      dependsOn: ['never-applied'],
    };
    preflighted.operations.push(dependent);
    const store = makeStore({
      [MAINTENANCE_DOC_PATH]: { data: { mode: 'read_only' }, fingerprint: 'm' },
      [first.sourcePath!]: { data: { amount: 1000 }, fingerprint: FP_SOURCE },
      'receipts/r-1': { data: {}, fingerprint: FP_SOURCE },
    });

    const result = await applyStudentProfileNormalization({ preflighted, store });

    expect(result.status).toBe('failed');
    expect(result.failure?.code).toBe('STUDENT_PROFILE_APPLY_DEPENDENCY_UNSATISFIED');
  });

  it('applies a dependent operation after the one it waits on', async () => {
    const preflighted = preflightStudentProfileNormalization(preflightInput());
    const first = preflighted.operations[0];
    preflighted.operations.push({
      ...first,
      operationId: 'dependent-op',
      sourcePath: 'receipts/r-1',
      targetPath: 'receipts/r-2',
      dependsOn: [first.operationId],
    });
    const store = makeStore({
      [MAINTENANCE_DOC_PATH]: { data: { mode: 'read_only' }, fingerprint: 'm' },
      [first.sourcePath!]: { data: { amount: 1000 }, fingerprint: FP_SOURCE },
      'receipts/r-1': { data: { amount: 1000 }, fingerprint: FP_SOURCE },
    });

    const result = await applyStudentProfileNormalization({ preflighted, store });

    expect(result.status).toBe('applied');
    expect(result.appliedOperationIds).toEqual([first.operationId, 'dependent-op']);
  });

  it('stops at the first failure instead of continuing down the list', async () => {
    const preflighted = preflightStudentProfileNormalization(preflightInput());
    const first = preflighted.operations[0];
    preflighted.operations.push({
      ...first,
      operationId: 'later-op',
      sourcePath: 'receipts/r-1',
      targetPath: 'receipts/r-2',
      dependsOn: [],
    });
    const store = makeStore({
      [MAINTENANCE_DOC_PATH]: { data: { mode: 'read_only' }, fingerprint: 'm' },
      // First operation's source is missing entirely.
      'receipts/r-1': { data: {}, fingerprint: FP_SOURCE },
    });

    const result = await applyStudentProfileNormalization({ preflighted, store });

    expect(result.status).toBe('failed');
    expect(result.appliedOperationIds).toEqual([]);
    expect(store.docs.has('receipts/r-2')).toBe(false);
  });
});

/**
 * What an operation does to a document.
 *
 * The executor could only copy a source document to a target path. That covers
 * a keyed move and nothing else: claiming a code, writing an alias, patching a
 * reconciled field, rewriting an owner, pruning a stale summary, and laying a
 * tombstone are the other ten stages, and none of them are a copy. An
 * operation with no source silently wrote nothing at all and still journalled
 * itself applied.
 *
 * The payload lives in the reviewed plan and inside its digest, so what will
 * be written is what somebody signed — the executor still invents nothing.
 */
describe('operation write modes', () => {
  function planWith(
    write: Record<string, unknown>,
    operation: Partial<Record<string, unknown>> = {}
  ) {
    return preflightInput({}, (plan) => {
      const group = plan.groups[0];
      const target = group.operations[0];
      Object.assign(target, { write, ...operation });
      // Re-derived after the mutation, the way a planner would emit it: an id
      // is a hash of the operation's content, so editing content without
      // re-deriving is the hand-edited plan preflight exists to refuse.
      target.operationId = deriveNormalizationOperationId({
        groupId: group.groupId,
        stage: target.stage,
        registryEntryId: target.registryEntryId!,
        sourcePath: target.sourcePath,
        targetPath: target.targetPath,
        expectedAfterFingerprint: target.expectedAfterFingerprint!,
        write: target.write,
      });
    });
  }

  it('creates a document from the reviewed payload when there is no source', async () => {
    const input = planWith(
      { mode: 'set', payload: { legacyProfileId: 'legacy-1', canonicalProfileId: 'canonical-1' } },
      {
        stage: 'create_aliases',
        sourcePath: null,
        sourceFingerprint: null,
        targetPath: 'student_profile_aliases/legacy-1',
        targetBeforeFingerprint: null,
        expectedAfterFingerprint: fingerprintDocumentProjection({
          legacyProfileId: 'legacy-1',
          canonicalProfileId: 'canonical-1',
        }),
      }
    );
    const preflighted = preflightStudentProfileNormalization(input);
    const store = makeStore({
      [MAINTENANCE_DOC_PATH]: { data: { mode: 'read_only' }, fingerprint: 'm' },
    });

    const result = await applyStudentProfileNormalization({ preflighted, store });

    expect(result.status).toBe('applied');
    expect(store.docs.get('student_profile_aliases/legacy-1')?.data).toEqual({
      legacyProfileId: 'legacy-1',
      canonicalProfileId: 'canonical-1',
    });
  });

  it('merges a patch into the target and leaves the rest of the document alone', async () => {
    const input = planWith(
      { mode: 'patch', payload: { studentId: 'canonical-1' } },
      {
        stage: 'rewrite_references',
        sourcePath: null,
        sourceFingerprint: null,
        targetPath: 'attendance/att-1',
        targetBeforeFingerprint: FP_SOURCE,
        expectedAfterFingerprint: fingerprintDocumentProjection({
          studentId: 'canonical-1',
          date: '2026-05-02',
          status: 'present',
        }),
      }
    );
    const preflighted = preflightStudentProfileNormalization(input);
    const store = makeStore({
      [MAINTENANCE_DOC_PATH]: { data: { mode: 'read_only' }, fingerprint: 'm' },
      'attendance/att-1': {
        data: { studentId: 'legacy-1', date: '2026-05-02', status: 'present' },
        fingerprint: FP_SOURCE,
      },
    });

    const result = await applyStudentProfileNormalization({ preflighted, store });

    expect(result.status).toBe('applied');
    expect(store.docs.get('attendance/att-1')?.data).toEqual({
      studentId: 'canonical-1',
      date: '2026-05-02',
      status: 'present',
    });
  });

  it('refuses to patch a document that is not there', async () => {
    // Creating it would invent a record nobody reviewed, and the absence is
    // drift: the plan was built against a database where it existed.
    const input = planWith(
      { mode: 'patch', payload: { studentId: 'canonical-1' } },
      {
        stage: 'rewrite_references',
        sourcePath: null,
        sourceFingerprint: null,
        targetPath: 'attendance/missing',
        targetBeforeFingerprint: null,
        expectedAfterFingerprint: fingerprintDocumentProjection({ studentId: 'canonical-1' }),
      }
    );
    const preflighted = preflightStudentProfileNormalization(input);
    const store = makeStore({
      [MAINTENANCE_DOC_PATH]: { data: { mode: 'read_only' }, fingerprint: 'm' },
    });

    const result = await applyStudentProfileNormalization({ preflighted, store });

    expect(result.status).toBe('failed');
    expect(result.failure?.code).toBe('STUDENT_PROFILE_APPLY_TARGET_MISSING');
  });

  it('deletes a document the plan retires', async () => {
    const input = planWith(
      { mode: 'delete' },
      {
        stage: 'rebuild_projections',
        sourcePath: null,
        sourceFingerprint: null,
        targetPath: 'accounting_student_summaries/legacy-1',
        targetBeforeFingerprint: 'x',
        expectedAfterFingerprint: null,
      }
    );
    const preflighted = preflightStudentProfileNormalization(input);
    const store = makeStore({
      [MAINTENANCE_DOC_PATH]: { data: { mode: 'read_only' }, fingerprint: 'm' },
      'accounting_student_summaries/legacy-1': { data: { studentId: 'legacy-1' }, fingerprint: 'x' },
    });

    const result = await applyStudentProfileNormalization({ preflighted, store });

    expect(result.status).toBe('applied');
    expect(store.docs.has('accounting_student_summaries/legacy-1')).toBe(false);
  });

  it('refuses an operation that would write nothing', async () => {
    // The shape that used to journal itself applied while touching no
    // document: a stage with no source and no instruction.
    const input = planWith(
      {},
      { stage: 'claim_codes', sourcePath: null, sourceFingerprint: null, targetPath: null }
    );

    expect(() => preflightStudentProfileNormalization(input)).toThrow(
      'STUDENT_PROFILE_PREFLIGHT_OPERATION_INCOMPLETE'
    );
  });

  it('binds the payload into the operation id', async () => {
    // Otherwise two operations differing only in what they write share an id,
    // and the approval covers neither of them in particular.
    const base = {
      groupId: 'g-1',
      stage: 'reconcile_profile',
      registryEntryId: 'students.profile',
      sourcePath: null,
      targetPath: 'students/canonical-1',
      expectedAfterFingerprint: FP_AFTER,
    };

    expect(
      deriveNormalizationOperationId({ ...base, write: { mode: 'patch', payload: { dob: '2014-05-02' } } })
    ).not.toBe(
      deriveNormalizationOperationId({ ...base, write: { mode: 'patch', payload: { dob: '2015-01-01' } } })
    );
  });
});
