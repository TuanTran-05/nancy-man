import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptRollbackBeforeImages } from './rollbackArtifact.js';
import {
  applyStudentProfileNormalizationRollback,
  createReviewedStudentProfileNormalizationRollback,
  MAINTENANCE_DOC_PATH,
  planStudentProfileNormalizationRollback,
  type NormalizationTransaction,
} from './writer.js';

const KEY = randomBytes(32).toString('base64');
const FP_BEFORE = '1'.repeat(64);
const FP_AFTER = '2'.repeat(64);
const PLAN_DIGEST = 'a'.repeat(64);
const APPROVAL_DIGEST = 'b'.repeat(64);

const AAD = {
  projectId: 'edutrack-prod',
  databaseId: 'edutrack',
  runId: 'run-1',
  planPreimageDigest: 'p'.repeat(64),
};

/**
 * The ledger was created by the run and is deleted on reversal; the profile
 * existed before and is restored from its before image. Both shapes appear in
 * every real group, so both are exercised together.
 */
const EFFECTS = [
  {
    path: 'course_fee_ledgers/canonical-1_c-1',
    beforeFingerprint: null,
    afterFingerprint: FP_AFTER,
    restoreStrategy: 'delete_run_created_document' as const,
    rollbackArtifactEntryId: null,
  },
  {
    path: 'students/legacy-1',
    beforeFingerprint: FP_BEFORE,
    afterFingerprint: FP_AFTER,
    restoreStrategy: 'restore_before_image' as const,
    rollbackArtifactEntryId: 'e-1',
  },
];

function artifactFor(
  entries: Array<{ entryId: string; path: string; before: Record<string, unknown> }> = [
    { entryId: 'e-1', path: 'students/legacy-1', before: { name: 'Quách Hoàng Minh' } },
  ]
) {
  return encryptRollbackBeforeImages({ entries, aad: AAD, keyBase64: KEY });
}

function rollbackBase(overrides: Record<string, unknown> = {}) {
  const artifact = artifactFor();
  return {
    runId: 'run-1',
    planDigest: PLAN_DIGEST,
    approvalDigest: APPROVAL_DIGEST,
    rollbackArtifactDigest: artifact.digest,
    documentEffects: EFFECTS,
    artifact,
    ...overrides,
  };
}

type Doc = { data: Record<string, unknown>; fingerprint: string };

function makeStore(seed: Record<string, Doc>) {
  const docs = new Map(Object.entries(seed).map(([path, doc]) => [path, { ...doc }]));
  return {
    docs,
    async runTransaction<T>(fn: (tx: NormalizationTransaction) => Promise<T>): Promise<T> {
      const staged = new Map<string, Doc | null>();
      const tx: NormalizationTransaction = {
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
}

describe('rollback planning', () => {
  it('binds plan, approval, artifact, and ordered effects into one digest', () => {
    const plan = planStudentProfileNormalizationRollback(rollbackBase());

    expect(plan).toMatchObject({ approved: false, runId: 'run-1' });
    expect(plan.rollbackDigest).toHaveLength(64);
  });

  it.each([
    ['plan digest', { planDigest: 'z'.repeat(64) }],
    ['approval digest', { approvalDigest: 'z'.repeat(64) }],
    ['artifact digest', { rollbackArtifactDigest: 'z'.repeat(64) }],
  ])('produces a different digest when the %s differs', (_label, override) => {
    expect(
      planStudentProfileNormalizationRollback(rollbackBase(override)).rollbackDigest
    ).not.toBe(planStudentProfileNormalizationRollback(rollbackBase()).rollbackDigest);
  });

  it('produces a different digest when effects are reordered', () => {
    // Reversal order is the plan. Two orderings undo different things.
    expect(
      planStudentProfileNormalizationRollback(
        rollbackBase({ documentEffects: [...EFFECTS].reverse() })
      ).rollbackDigest
    ).not.toBe(planStudentProfileNormalizationRollback(rollbackBase()).rollbackDigest);
  });
});

describe('rollback approval', () => {
  function approve(overrides: Record<string, unknown> = {}) {
    const plan = planStudentProfileNormalizationRollback(rollbackBase());
    return createReviewedStudentProfileNormalizationRollback({
      rollbackPlan: plan,
      confirmRollbackDigest: plan.rollbackDigest,
      approvals: [
        { role: 'rollback_technical', reviewerId: 'r1', reviewedAt: 't', rollbackDigest: plan.rollbackDigest },
        { role: 'rollback_finance', reviewerId: 'r2', reviewedAt: 't', rollbackDigest: plan.rollbackDigest },
      ],
      authorizedReviewers: { rollback_technical: ['r1'], rollback_finance: ['r2'] },
      ...overrides,
    } as Parameters<typeof createReviewedStudentProfileNormalizationRollback>[0]);
  }

  it('accepts two distinct authorized reviewers', () => {
    const reviewed = approve();

    expect(reviewed).toMatchObject({ approved: true });
    expect(reviewed.rollbackApprovalDigest).toHaveLength(64);
  });

  it('refuses a confirmation that does not match the plan digest', () => {
    expect(() => approve({ confirmRollbackDigest: 'z'.repeat(64) })).toThrow(
      'STUDENT_PROFILE_ROLLBACK_DIGEST_MISMATCH'
    );
  });

  it('refuses one person signing both rollback roles', () => {
    const plan = planStudentProfileNormalizationRollback(rollbackBase());

    expect(() =>
      createReviewedStudentProfileNormalizationRollback({
        rollbackPlan: plan,
        confirmRollbackDigest: plan.rollbackDigest,
        approvals: [
          { role: 'rollback_technical', reviewerId: 'r1', reviewedAt: 't', rollbackDigest: plan.rollbackDigest },
          { role: 'rollback_finance', reviewerId: 'r1', reviewedAt: 't', rollbackDigest: plan.rollbackDigest },
        ],
        authorizedReviewers: { rollback_technical: ['r1'], rollback_finance: ['r1'] },
      })
    ).toThrow('STUDENT_PROFILE_ROLLBACK_APPROVAL_NOT_DISTINCT');
  });

  it('refuses a missing rollback role', () => {
    const plan = planStudentProfileNormalizationRollback(rollbackBase());

    expect(() =>
      createReviewedStudentProfileNormalizationRollback({
        rollbackPlan: plan,
        confirmRollbackDigest: plan.rollbackDigest,
        approvals: [
          { role: 'rollback_technical', reviewerId: 'r1', reviewedAt: 't', rollbackDigest: plan.rollbackDigest },
        ],
        authorizedReviewers: { rollback_technical: ['r1'], rollback_finance: ['r2'] },
      })
    ).toThrow('STUDENT_PROFILE_ROLLBACK_APPROVAL_ROLE_MISSING');
  });

  it('refuses a signature bound to a different rollback digest', () => {
    const plan = planStudentProfileNormalizationRollback(rollbackBase());

    expect(() =>
      createReviewedStudentProfileNormalizationRollback({
        rollbackPlan: plan,
        confirmRollbackDigest: plan.rollbackDigest,
        approvals: [
          { role: 'rollback_technical', reviewerId: 'r1', reviewedAt: 't', rollbackDigest: 'z'.repeat(64) },
          { role: 'rollback_finance', reviewerId: 'r2', reviewedAt: 't', rollbackDigest: plan.rollbackDigest },
        ],
        authorizedReviewers: { rollback_technical: ['r1'], rollback_finance: ['r2'] },
      })
    ).toThrow('STUDENT_PROFILE_ROLLBACK_APPROVAL_STALE');
  });
});

describe('rollback apply', () => {
  function applyInput(overrides: Record<string, unknown> = {}) {
    const base = rollbackBase();
    const plan = planStudentProfileNormalizationRollback(base);
    const reviewed = createReviewedStudentProfileNormalizationRollback({
      rollbackPlan: plan,
      confirmRollbackDigest: plan.rollbackDigest,
      approvals: [
        { role: 'rollback_technical', reviewerId: 'r1', reviewedAt: 't', rollbackDigest: plan.rollbackDigest },
        { role: 'rollback_finance', reviewerId: 'r2', reviewedAt: 't', rollbackDigest: plan.rollbackDigest },
      ],
      authorizedReviewers: { rollback_technical: ['r1'], rollback_finance: ['r2'] },
    });

    return {
      reviewed,
      store: makeStore({
        [MAINTENANCE_DOC_PATH]: {
          data: { mode: 'read_only', activeRunId: 'run-1', migrationActorId: 'actor' },
          fingerprint: 'm',
        },
        'course_fee_ledgers/canonical-1_c-1': { data: { amount: 1000 }, fingerprint: FP_AFTER },
        'students/legacy-1': { data: { studentProfileState: 'merged_tombstone' }, fingerprint: FP_AFTER },
      }),
      artifact: base.artifact,
      rollbackAad: AAD,
      rollbackKeyBase64: KEY,
      confirmRollbackDigest: reviewed.rollbackDigest,
      expectedActorId: 'actor',
      maintenanceLiftedAt: null,
      ...overrides,
    } as Parameters<typeof applyStudentProfileNormalizationRollback>[0] & {
      store: ReturnType<typeof makeStore>;
    };
  }

  it('reverses effects in exact reverse order', async () => {
    const result = await applyStudentProfileNormalizationRollback(applyInput());

    expect(result.status).toBe('rolled_back');
    expect(result.reversedPaths).toEqual([
      'students/legacy-1',
      'course_fee_ledgers/canonical-1_c-1',
    ]);
  });

  it('restores a before image and deletes a run-created document', async () => {
    const input = applyInput();
    await applyStudentProfileNormalizationRollback(input);

    expect(input.store.docs.has('course_fee_ledgers/canonical-1_c-1')).toBe(false);
    expect(input.store.docs.get('students/legacy-1')).toMatchObject({
      data: { name: 'Quách Hoàng Minh' },
      fingerprint: FP_BEFORE,
    });
  });

  it('refuses once maintenance has been lifted and demands forward repair', async () => {
    const result = await applyStudentProfileNormalizationRollback(
      applyInput({ maintenanceLiftedAt: '2026-08-07T03:30:00.000Z' })
    );

    // Past the lift the world has seen the merged state; restoring would
    // silently discard whatever was written after it.
    expect(result.status).toBe('refused');
    expect(result.refusal?.code).toBe('STUDENT_PROFILE_ROLLBACK_WINDOW_CLOSED');
    expect(result.forwardRepairRequired).toBe(true);
  });

  it('refuses a mismatched rollback digest confirmation', async () => {
    const result = await applyStudentProfileNormalizationRollback(
      applyInput({ confirmRollbackDigest: 'z'.repeat(64) })
    );

    expect(result.status).toBe('refused');
    expect(result.refusal?.code).toBe('STUDENT_PROFILE_ROLLBACK_DIGEST_MISMATCH');
  });

  it('refuses an unapproved rollback plan', async () => {
    const input = applyInput();
    const unapproved = { ...input.reviewed, approved: false } as unknown as typeof input.reviewed;

    const result = await applyStudentProfileNormalizationRollback({
      ...input,
      reviewed: unapproved,
    });

    expect(result.status).toBe('refused');
    expect(result.refusal?.code).toBe('STUDENT_PROFILE_ROLLBACK_NOT_APPROVED');
  });

  it('refuses the entire rollback when one document drifted after apply', async () => {
    const input = applyInput();
    input.store.docs.set('students/legacy-1', { data: {}, fingerprint: 'drifted-since-apply' });

    const result = await applyStudentProfileNormalizationRollback(input);

    // All or nothing: a partial reversal leaves a state nobody planned or
    // reviewed, which is worse than the merged state it was undoing.
    expect(result.status).toBe('refused');
    expect(result.refusal?.code).toBe('STUDENT_PROFILE_ROLLBACK_DRIFT');
    expect(result.reversedPaths).toEqual([]);
    expect(input.store.docs.has('course_fee_ledgers/canonical-1_c-1')).toBe(true);
  });

  it('refuses when a before image the plan needs is missing from the artifact', async () => {
    const input = applyInput();
    const wrongArtifact = artifactFor([{ entryId: 'unrelated', path: 'x', before: {} }]);

    const result = await applyStudentProfileNormalizationRollback({
      ...input,
      artifact: wrongArtifact,
    });

    expect(result.status).toBe('refused');
    expect(result.refusal?.code).toBe('STUDENT_PROFILE_ROLLBACK_ARTIFACT_MISMATCH');
  });

  it('refuses when maintenance is no longer read_only', async () => {
    const input = applyInput();
    input.store.docs.set(MAINTENANCE_DOC_PATH, { data: { mode: 'normal' }, fingerprint: 'm' });

    const result = await applyStudentProfileNormalizationRollback(input);

    expect(result.status).toBe('refused');
    expect(result.refusal?.code).toBe('STUDENT_PROFILE_ROLLBACK_MAINTENANCE_LOST');
  });
});
