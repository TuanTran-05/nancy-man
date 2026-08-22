import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  applyStudentProfileNormalizationRollback,
  createReviewedStudentProfileNormalizationRollback,
  planStudentProfileNormalizationRollback,
} from './rollback.js';
import {
  encryptRollbackBeforeImages,
  type RollbackBeforeImageEntry,
} from './rollbackArtifact.js';
import { MAINTENANCE_DOC_PATH, type NormalizationTransaction } from './writerCore.js';
import type { StudentMergeDocumentEffect } from './types.js';

const KEY = randomBytes(32).toString('base64');
const AAD = {
  projectId: 'edutrack',
  databaseId: '(default)',
  runId: 'run-1',
  planPreimageDigest: 'a'.repeat(64),
};

type Doc = { data: Record<string, unknown>; fingerprint: string };

function makeStore(seed: Record<string, Doc>) {
  const docs = new Map(Object.entries(seed));
  const maintenance = docs.get(MAINTENANCE_DOC_PATH);
  if (maintenance?.data.mode === 'read_only') {
    maintenance.data = { activeRunId: 'run-1', migrationActorId: 'actor', ...maintenance.data };
  }
  let committedTransactions = 0;
  return {
    docs,
    get committedTransactions() {
      return committedTransactions;
    },
    async runTransaction<T>(work: (tx: NormalizationTransaction) => Promise<T>): Promise<T> {
      const staged = new Map<string, Doc | null>();
      const result = await work({
        get: async (path) => docs.get(path) ?? null,
        set: (path, doc) => staged.set(path, doc),
        delete: (path) => staged.set(path, null),
      });
      for (const [path, doc] of staged) {
        if (doc === null) docs.delete(path);
        else docs.set(path, doc);
      }
      committedTransactions += 1;
      return result;
    },
  };
}

function reviewed(
  effects: StudentMergeDocumentEffect[],
  entries: RollbackBeforeImageEntry[] = [
    { entryId: 'before-0', path: 'students/s-1', before: { state: 'original' } },
    { entryId: 'before-1', path: 'students/s-1', before: { state: 'middle' } },
  ]
) {
  const artifact = encryptRollbackBeforeImages({
    entries,
    aad: AAD,
    keyBase64: KEY,
  });
  const rollbackPlan = planStudentProfileNormalizationRollback({
    runId: 'run-1',
    planDigest: AAD.planPreimageDigest,
    approvalDigest: 'b'.repeat(64),
    rollbackArtifactDigest: artifact.digest,
    documentEffects: effects,
  });
  const approvals = [
    {
      role: 'rollback_technical' as const,
      reviewerId: 'technical',
      reviewedAt: '2026-08-09T10:00:00.000Z',
      rollbackDigest: rollbackPlan.rollbackDigest,
    },
    {
      role: 'rollback_finance' as const,
      reviewerId: 'finance',
      reviewedAt: '2026-08-09T10:00:00.000Z',
      rollbackDigest: rollbackPlan.rollbackDigest,
    },
  ];
  return {
    artifact,
    reviewed: createReviewedStudentProfileNormalizationRollback({
      rollbackPlan,
      confirmRollbackDigest: rollbackPlan.rollbackDigest,
      approvals,
      authorizedReviewers: {
        rollback_technical: ['technical'],
        rollback_finance: ['finance'],
      },
    }),
  };
}

const chainedEffects: StudentMergeDocumentEffect[] = [
  {
    operationId: 'op-1',
    path: 'students/s-1',
    beforeFingerprint: 'fp-original',
    afterFingerprint: 'fp-middle',
    restoreStrategy: 'restore_before_image',
    rollbackArtifactEntryId: 'before-0',
  },
  {
    operationId: 'op-2',
    path: 'students/s-1',
    beforeFingerprint: 'fp-middle',
    afterFingerprint: 'fp-final',
    restoreStrategy: 'restore_before_image',
    rollbackArtifactEntryId: 'before-1',
  },
];

describe('normalization rollback', () => {
  it('collapses a valid same-path effect chain and restores atomically to the first before-image', async () => {
    const input = reviewed(chainedEffects);
    const store = makeStore({
      [MAINTENANCE_DOC_PATH]: { data: { mode: 'read_only' }, fingerprint: 'maintenance' },
      'students/s-1': { data: { state: 'final' }, fingerprint: 'fp-final' },
    });

    const result = await applyStudentProfileNormalizationRollback({
      ...input,
      store,
      rollbackAad: AAD,
      rollbackKeyBase64: KEY,
      confirmRollbackDigest: input.reviewed.rollbackDigest,
      expectedActorId: 'actor',
      maintenanceLiftedAt: null,
    });

    expect(result.status).toBe('rolled_back');
    expect(result.reversedPaths).toEqual(['students/s-1']);
    expect(store.docs.get('students/s-1')).toEqual({
      data: { state: 'original' },
      fingerprint: 'fp-original',
    });
    expect(store.committedTransactions).toBe(1);
  });

  it('reverses partial patch images while preserving credential fields kept in DocumentStore', async () => {
    const effects: StudentMergeDocumentEffect[] = [
      {
        operationId: 'op-1',
        path: 'students/s-1',
        beforeFingerprint: 'fp-original',
        afterFingerprint: 'fp-middle',
        restoreStrategy: 'restore_before_image',
        rollbackArtifactEntryId: 'patch-0',
      },
      {
        operationId: 'op-2',
        path: 'students/s-1',
        beforeFingerprint: 'fp-middle',
        afterFingerprint: 'fp-final',
        restoreStrategy: 'restore_before_image',
        rollbackArtifactEntryId: 'patch-1',
      },
    ];
    const input = reviewed(effects, [
      {
        entryId: 'patch-0',
        path: 'students/s-1',
        restoreMode: 'patch' as const,
        before: { state: 'original' },
        absentFieldPaths: ['addedByFirstPatch'],
      },
      {
        entryId: 'patch-1',
        path: 'students/s-1',
        restoreMode: 'patch' as const,
        before: { note: 'middle' },
        absentFieldPaths: [],
      },
    ]);
    const store = makeStore({
      [MAINTENANCE_DOC_PATH]: { data: { mode: 'read_only' }, fingerprint: 'maintenance' },
      'students/s-1': {
        data: {
          state: 'final',
          note: 'final',
          addedByFirstPatch: true,
          loginPasswordHash: 'keep-current-secret',
        },
        fingerprint: 'fp-final',
      },
    });

    const result = await applyStudentProfileNormalizationRollback({
      ...input,
      store,
      rollbackAad: AAD,
      rollbackKeyBase64: KEY,
      confirmRollbackDigest: input.reviewed.rollbackDigest,
      expectedActorId: 'actor',
      maintenanceLiftedAt: null,
    });

    expect(result.status).toBe('rolled_back');
    expect(store.docs.get('students/s-1')).toEqual({
      data: {
        state: 'original',
        note: 'middle',
        loginPasswordHash: 'keep-current-secret',
      },
      fingerprint: 'fp-original',
    });
  });

  it('refuses before writing when the chain between two effects is broken', async () => {
    const broken = chainedEffects.map((effect) => ({ ...effect }));
    broken[1].beforeFingerprint = 'not-the-first-after';
    const input = reviewed(broken);
    const store = makeStore({
      [MAINTENANCE_DOC_PATH]: { data: { mode: 'read_only' }, fingerprint: 'maintenance' },
      'students/s-1': { data: { state: 'final' }, fingerprint: 'fp-final' },
    });

    const result = await applyStudentProfileNormalizationRollback({
      ...input,
      store,
      rollbackAad: AAD,
      rollbackKeyBase64: KEY,
      confirmRollbackDigest: input.reviewed.rollbackDigest,
      expectedActorId: 'actor',
      maintenanceLiftedAt: null,
    });

    expect(result.refusal?.code).toBe('STUDENT_PROFILE_ROLLBACK_EFFECT_CHAIN_INVALID');
    expect(store.docs.get('students/s-1')?.data).toEqual({ state: 'final' });
    expect(store.committedTransactions).toBe(0);
  });

  it('refuses all paths when any final after-state drifted', async () => {
    const input = reviewed(chainedEffects);
    const store = makeStore({
      [MAINTENANCE_DOC_PATH]: { data: { mode: 'read_only' }, fingerprint: 'maintenance' },
      'students/s-1': { data: { state: 'changed-later' }, fingerprint: 'drift' },
    });

    const result = await applyStudentProfileNormalizationRollback({
      ...input,
      store,
      rollbackAad: AAD,
      rollbackKeyBase64: KEY,
      confirmRollbackDigest: input.reviewed.rollbackDigest,
      expectedActorId: 'actor',
      maintenanceLiftedAt: null,
    });

    expect(result.refusal?.code).toBe('STUDENT_PROFILE_ROLLBACK_DRIFT');
    expect(store.docs.get('students/s-1')?.data).toEqual({ state: 'changed-later' });
  });
});
