import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fingerprintDocumentProjection } from './canonicalJson.js';
import { planAdmissionSearchBackfill } from './admissionSearchBackfill.js';
import {
  createReviewedStudentProfileNormalizationPlan,
  createStudentProfileMergeApprovalDigest,
  createStudentProfileMergePlanDigest,
  writeStudentProfileNormalizationReports,
  type StudentProfileMergeApproval,
  type StudentProfileMergePlan,
} from './reporter.js';
import { encryptRollbackBeforeImages } from './rollbackArtifact.js';
import {
  applyStudentProfileNormalization,
  applyStudentProfileNormalizationRollback,
  createReviewedStudentProfileNormalizationRollback,
  MAINTENANCE_DOC_PATH,
  planStudentProfileNormalizationRollback,
  preflightStudentProfileNormalization,
  type NormalizationTransaction,
} from './writer.js';
import { verifyStudentProfileNormalization } from './verifier.js';
import {
  censusShapedProfiles,
  cleanRehearsalGroup,
  cleanRollbackEntries,
  heldCredentialGroup,
  mixedInstantDocuments,
  rehearsalPlan,
  REHEARSAL_COMMIT,
  REHEARSAL_TARGET,
} from './rehearsalFixture.js';

const KEY = randomBytes(32).toString('base64');
const AAD = {
  projectId: REHEARSAL_TARGET.projectId,
  databaseId: REHEARSAL_TARGET.databaseId,
  runId: 'rehearsal-run-1',
  planPreimageDigest: 'p'.repeat(64),
};

const REVIEWERS = {
  identity_technical: ['reviewer-identity'],
  finance: ['reviewer-finance'],
  auth_security: ['reviewer-auth'],
};

function sealedCleanPlan() {
  const plan = rehearsalPlan([cleanRehearsalGroup()]);
  const artifact = encryptRollbackBeforeImages({
    entries: cleanRollbackEntries(),
    aad: AAD,
    keyBase64: KEY,
  });
  plan.rollbackArtifact = {
    fileName: artifact.fileName,
    digest: artifact.digest,
    entryCount: artifact.entryCount,
  };
  return { plan, artifact };
}

function approvalsFor(planDigest: string): StudentProfileMergeApproval[] {
  return [
    { role: 'identity_technical', reviewerId: 'reviewer-identity', reviewedAt: 't', planDigest },
    { role: 'finance', reviewerId: 'reviewer-finance', reviewedAt: 't', planDigest },
  ];
}

function reviewedFor(plan: StudentProfileMergePlan) {
  const planDigest = createStudentProfileMergePlanDigest(plan);
  return createReviewedStudentProfileNormalizationPlan({
    plan,
    planDigest,
    approvals: approvalsFor(planDigest),
    authorizedReviewers: REVIEWERS,
  });
}

type Doc = { data: Record<string, unknown>; fingerprint: string };

function makeStore(seed: Record<string, Doc>) {
  const docs = new Map(Object.entries(seed).map(([p, d]) => [p, { ...d }]));
  const maintenance = docs.get(MAINTENANCE_DOC_PATH);
  if (maintenance?.data.mode === 'read_only') {
    maintenance.data = {
      activeRunId: 'rehearsal-run-1',
      migrationActorId: 'operator-1',
      ...maintenance.data,
    };
    if (!docs.has('student_profile_merge_runs/rehearsal-run-1')) {
      docs.set('student_profile_merge_runs/rehearsal-run-1', {
        data: { runId: 'rehearsal-run-1', status: 'prepared', appliedOperationCount: 0 },
        fingerprint: 'prepared',
      });
    }
  }
  return {
    docs,
    async runTransaction<T>(fn: (tx: NormalizationTransaction) => Promise<T>): Promise<T> {
      const staged = new Map<string, Doc | null>();
      const tx: NormalizationTransaction = {
        async get(p: string) {
          if (staged.has(p)) return staged.get(p);
          return docs.get(p) ?? null;
        },
        set(p: string, doc: Doc) {
          staged.set(p, doc);
        },
        delete(p: string) {
          staged.set(p, null);
        },
      };
      const result = await fn(tx);
      for (const [p, doc] of staged) {
        if (doc === null) docs.delete(p);
        else docs.set(p, doc);
      }
      return result;
    },
  };
}

function productionStore() {
  const group = cleanRehearsalGroup();
  const ledgerOp = group.operations[0];
  const tombstoneOp = group.operations[1];
  return makeStore({
    [MAINTENANCE_DOC_PATH]: { data: { mode: 'read_only' }, fingerprint: 'm' },
    [ledgerOp.sourcePath!]: {
      data: { studentId: 'legacy-1', amount: 1_200_000 },
      fingerprint: ledgerOp.sourceFingerprint!,
    },
    [tombstoneOp.targetPath!]: {
      data: { name: 'Quách Hoàng Minh', studentId: 'HS260101', walletBalance: 0 },
      fingerprint: tombstoneOp.targetBeforeFingerprint!,
    },
  });
}

function baseConfirmations(reviewed: ReturnType<typeof reviewedFor>) {
  return {
    planDigest: reviewed.planDigest,
    approvalDigest: reviewed.approvalDigest,
    projectId: REHEARSAL_TARGET.projectId,
    databaseId: REHEARSAL_TARGET.databaseId,
    sourceCommit: REHEARSAL_COMMIT,
    exportOperationId: `projects/${REHEARSAL_TARGET.projectId}/databases/${REHEARSAL_TARGET.databaseId}/operations/op-rehearsal`,
    actorId: 'operator-1',
    runId: 'rehearsal-run-1',
  };
}

const OBSERVED = {
  projectId: REHEARSAL_TARGET.projectId,
  databaseId: REHEARSAL_TARGET.databaseId,
  currentCommit: REHEARSAL_COMMIT,
  registryVersion: 'student-references-v2',
  maintenanceMode: 'read_only',
  activeRunId: 'rehearsal-run-1',
  migrationActorId: 'operator-1',
};

describe('rehearsal: audit phases', () => {
  it('emits a preliminary plan that is not applyable and carries no digest', async () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), 'rehearsal-')), 'run');
    const paths = await writeStudentProfileNormalizationReports({
      outputDir: dir,
      plan: rehearsalPlan([cleanRehearsalGroup()], { auditPhase: 'preliminary' }),
      inventory: { collections: [], matches: [], unknown: [] },
    });

    const file = JSON.parse(readFileSync(paths.planPath, 'utf8'));
    expect(file).toMatchObject({ approved: false, applyable: false, planDigest: null });
  });

  it('refuses to approve a preliminary plan however it is signed', () => {
    const preliminary = rehearsalPlan([cleanRehearsalGroup()], { auditPhase: 'preliminary' });

    expect(() => reviewedFor(preliminary)).toThrow('STUDENT_PROFILE_PLAN_NOT_FINAL');
  });
});

describe('rehearsal: the HS260167 hold', () => {
  it('reports the hold but refuses to approve the plan containing it', () => {
    const held = rehearsalPlan([cleanRehearsalGroup(), heldCredentialGroup()]);

    // Reportable, so a reviewer sees it — but never approvable, so it cannot
    // reach production while the credential question is open.
    expect(held.groups[1].blockers[0].code).toBe('CREDENTIAL_AMBIGUOUS');
    expect(() => reviewedFor(held)).toThrow('STUDENT_PROFILE_PLAN_HAS_BLOCKERS');
  });

  it('never lets a hold reach preflight, so no business write can occur', () => {
    const held = rehearsalPlan([heldCredentialGroup()]);
    const artifact = encryptRollbackBeforeImages({
      entries: cleanRollbackEntries(),
      aad: AAD,
      keyBase64: KEY,
    });
    held.rollbackArtifact = {
      fileName: artifact.fileName,
      digest: artifact.digest,
      entryCount: artifact.entryCount,
    };
    const planDigest = createStudentProfileMergePlanDigest(held);
    const approvals = approvalsFor(planDigest);
    // A real approval digest, so this test cannot pass for the unrelated
    // reason that the digest was wrong. The blocker check is the only thing
    // left to refuse it.
    const approvalDigest = createStudentProfileMergeApprovalDigest({ planDigest, approvals });

    // A hand-built "reviewed" file that skipped the approval gate is still
    // refused one layer deeper, at preflight.
    expect(() =>
      preflightStudentProfileNormalization({
        reviewed: {
          approved: true,
          applyable: true,
          planDigest,
          approvalDigest,
          approvals,
          target: REHEARSAL_TARGET,
          plan: held,
        },
        rollbackArtifact: artifact,
        rollbackAad: AAD,
        rollbackKeyBase64: KEY,
        confirmations: {
          planDigest,
          approvalDigest,
          projectId: REHEARSAL_TARGET.projectId,
          databaseId: REHEARSAL_TARGET.databaseId,
          sourceCommit: REHEARSAL_COMMIT,
          exportOperationId: `projects/${REHEARSAL_TARGET.projectId}/databases/${REHEARSAL_TARGET.databaseId}/operations/op-rehearsal`,
          actorId: 'operator-1',
          runId: 'rehearsal-run-1',
        },
        observed: OBSERVED,
      })
    ).toThrow('STUDENT_PROFILE_PREFLIGHT_PLAN_HAS_BLOCKERS');
  });
});

describe('rehearsal: approval attests without authoring', () => {
  it('refuses a missing role', () => {
    const { plan } = sealedCleanPlan();
    const planDigest = createStudentProfileMergePlanDigest(plan);

    expect(() =>
      createReviewedStudentProfileNormalizationPlan({
        plan,
        planDigest,
        approvals: [approvalsFor(planDigest)[0]],
        authorizedReviewers: REVIEWERS,
      })
    ).toThrow('STUDENT_PROFILE_APPROVAL_ROLE_MISSING');
  });

  it('leaves the operations byte-identical to the ones it signed', () => {
    const { plan } = sealedCleanPlan();
    const before = JSON.stringify(plan.groups[0].operations);

    const reviewed = reviewedFor(plan);

    expect(JSON.stringify(reviewed.plan.groups[0].operations)).toBe(before);
  });
});

describe('rehearsal: full apply, verify, rollback cycle', () => {
  it('preflights, applies, and verifies a clean reviewed plan', async () => {
    const { plan, artifact } = sealedCleanPlan();
    const reviewed = reviewedFor(plan);
    const store = productionStore();

    const preflighted = preflightStudentProfileNormalization({
      reviewed,
      rollbackArtifact: artifact,
      rollbackAad: AAD,
      rollbackKeyBase64: KEY,
      confirmations: baseConfirmations(reviewed),
      observed: OBSERVED,
    });
    expect(preflighted.status).toBe('preflighted');

    const applied = await applyStudentProfileNormalization({ preflighted, store });
    expect(applied.failure).toBeNull();
    expect(applied.status).toBe('applied');
    expect(applied.appliedOperationIds).toHaveLength(2);
    expect(store.docs.has('course_fee_ledgers/canonical-1_c-1')).toBe(true);

    const verification = verifyStudentProfileNormalization({
      runId: 'rehearsal-run-1',
      plannedOperationCount: 2,
      journal: applied.appliedOperationIds.map((operationId) => ({
        operationId,
        status: 'applied',
      })),
      observations: {
        profiles: [
          {
            id: 'canonical-1',
            name: 'Quách Hoàng Minh',
            dob: '2014-05-02',
            contact: '0900000000',
            admissionSearchName: 'quach hoang minh',
            admissionSearchDob: '2014-05-02',
            admissionSearchContact: '84900000000',
          },
          { id: 'legacy-1', studentProfileState: 'merged_tombstone' },
        ],
        aliases: [{ legacyProfileId: 'legacy-1', canonicalProfileId: 'canonical-1' }],
        codeOwners: [{ code: 'HS260101', profileId: 'canonical-1' }],
        mutableLegacyReferences: [],
        unknownReferences: [],
        openEnrollmentCountByProfile: { 'canonical-1': 1 },
        aliasOwnedUserIds: [],
        aliasOwnedCredentialIds: [],
        aliasOwnedSummaryIds: [],
        classCounts: [{ classId: 'c-1', rosterCount: 1, enrollmentCount: 1 }],
        money: { before: { ledgerAmounts: 1_200_000 }, after: { ledgerAmounts: 1_200_000 } },
        financeAnomalies: [],
      },
      baseline: { financeAnomalies: [] },
    });

    expect(verification.valid).toBe(true);
    expect(verification.moneyMatches).toBe(true);
  });

  it('aborts before any business write when an unknown reference is present', async () => {
    const { plan, artifact } = sealedCleanPlan();
    plan.blockers = [
      { code: 'UNKNOWN_REFERENCE', candidateId: 'mystery/x', detail: 'unregistered studentId' },
    ];
    const digest = createStudentProfileMergePlanDigest(plan);
    const store = productionStore();

    expect(() =>
      createReviewedStudentProfileNormalizationPlan({
        plan,
        planDigest: digest,
        approvals: approvalsFor(digest),
        authorizedReviewers: REVIEWERS,
      })
    ).toThrow('STUDENT_PROFILE_PLAN_HAS_BLOCKERS');

    expect(store.docs.has('course_fee_ledgers/canonical-1_c-1')).toBe(false);
    expect(artifact.entryCount).toBe(2);
  });

  it('rolls back exactly, restoring the before image and removing the created document', async () => {
    const { plan, artifact } = sealedCleanPlan();
    const reviewed = reviewedFor(plan);
    const store = productionStore();
    const preflighted = preflightStudentProfileNormalization({
      reviewed,
      rollbackArtifact: artifact,
      rollbackAad: AAD,
      rollbackKeyBase64: KEY,
      confirmations: baseConfirmations(reviewed),
      observed: OBSERVED,
    });
    await applyStudentProfileNormalization({ preflighted, store });

    const rollbackPlan = planStudentProfileNormalizationRollback({
      runId: 'rehearsal-run-1',
      planDigest: reviewed.planDigest,
      approvalDigest: reviewed.approvalDigest,
      rollbackArtifactDigest: artifact.digest,
      documentEffects: plan.groups[0].documentEffects.map((effect) => ({
        ...effect,
        restoreStrategy: effect.restoreStrategy,
        rollbackArtifactEntryId: effect.rollbackArtifactEntryId,
      })),
    });
    const reviewedRollback = createReviewedStudentProfileNormalizationRollback({
      rollbackPlan,
      confirmRollbackDigest: rollbackPlan.rollbackDigest,
      approvals: [
        { role: 'rollback_technical', reviewerId: 'r1', reviewedAt: 't', rollbackDigest: rollbackPlan.rollbackDigest },
        { role: 'rollback_finance', reviewerId: 'r2', reviewedAt: 't', rollbackDigest: rollbackPlan.rollbackDigest },
      ],
      authorizedReviewers: { rollback_technical: ['r1'], rollback_finance: ['r2'] },
    });

    const result = await applyStudentProfileNormalizationRollback({
      reviewed: reviewedRollback,
      store,
      artifact,
      rollbackAad: AAD,
      rollbackKeyBase64: KEY,
      confirmRollbackDigest: reviewedRollback.rollbackDigest,
      expectedActorId: 'operator-1',
      maintenanceLiftedAt: null,
    });

    expect(result.status).toBe('rolled_back');
    expect(store.docs.has('course_fee_ledgers/canonical-1_c-1')).toBe(false);
    expect(store.docs.get('students/legacy-1')?.data).toMatchObject({
      name: 'Quách Hoàng Minh',
      walletBalance: 0,
    });
  });

  it('refuses the same rollback once maintenance has been lifted', async () => {
    const { plan, artifact } = sealedCleanPlan();
    const reviewed = reviewedFor(plan);
    const store = productionStore();
    const rollbackPlan = planStudentProfileNormalizationRollback({
      runId: 'rehearsal-run-1',
      planDigest: reviewed.planDigest,
      approvalDigest: reviewed.approvalDigest,
      rollbackArtifactDigest: artifact.digest,
      documentEffects: plan.groups[0].documentEffects,
    });
    const reviewedRollback = createReviewedStudentProfileNormalizationRollback({
      rollbackPlan,
      confirmRollbackDigest: rollbackPlan.rollbackDigest,
      approvals: [
        { role: 'rollback_technical', reviewerId: 'r1', reviewedAt: 't', rollbackDigest: rollbackPlan.rollbackDigest },
        { role: 'rollback_finance', reviewerId: 'r2', reviewedAt: 't', rollbackDigest: rollbackPlan.rollbackDigest },
      ],
      authorizedReviewers: { rollback_technical: ['r1'], rollback_finance: ['r2'] },
    });

    const result = await applyStudentProfileNormalizationRollback({
      reviewed: reviewedRollback,
      store,
      artifact,
      rollbackAad: AAD,
      rollbackKeyBase64: KEY,
      confirmRollbackDigest: reviewedRollback.rollbackDigest,
      expectedActorId: 'operator-1',
      maintenanceLiftedAt: '2026-08-07T04:00:00.000Z',
    });

    expect(result.status).toBe('refused');
    expect(result.forwardRepairRequired).toBe(true);
  });
});

describe('rehearsal: census-shaped data', () => {
  it('fingerprints all three stored instant representations identically', () => {
    const [stamped, iso, epoch] = mixedInstantDocuments();

    const first = fingerprintDocumentProjection(stamped.data);
    expect(fingerprintDocumentProjection(iso.data)).toBe(first);
    expect(fingerprintDocumentProjection(epoch.data)).toBe(first);
  });

  it('separates absent, drifted, and retired profiles the way the gate needs', () => {
    const plan = planAdmissionSearchBackfill(
      censusShapedProfiles().map((profile) => ({ id: profile.id, data: profile }))
    );

    expect(plan.counts.already_complete).toBe(1);
    expect(plan.counts.missing_fields).toBe(1);
    expect(plan.counts.drifted).toBe(1);
    // The legacy soft-merge record is skipped, not counted against coverage:
    // its canonical twin already carries the fields.
    expect(plan.counts.skipped_retired).toBe(1);
  });

  it('blocks a legacy soft-merge record that has no alias and no tombstone', () => {
    const verification = verifyStudentProfileNormalization({
      runId: 'rehearsal-run-1',
      plannedOperationCount: 0,
      journal: [],
      observations: {
        profiles: censusShapedProfiles(),
        aliases: [],
        codeOwners: [],
        mutableLegacyReferences: [],
        unknownReferences: [],
        openEnrollmentCountByProfile: {},
        aliasOwnedUserIds: [],
        aliasOwnedCredentialIds: [],
        aliasOwnedSummaryIds: [],
        classCounts: [],
        money: { before: {}, after: {} },
        financeAnomalies: [],
      },
      baseline: { financeAnomalies: [] },
    });

    expect(verification.unnormalizedLegacySoftMergeProfileIds).toEqual(['legacy-soft-merged']);
    expect(verification.valid).toBe(false);
  });
});

describe('rehearsal: no artifact carries credential material', () => {
  it('keeps salts, hashes, and the rollback key out of every produced artifact', async () => {
    const { plan, artifact } = sealedCleanPlan();
    const reviewed = reviewedFor(plan);
    const dir = path.join(mkdtempSync(path.join(tmpdir(), 'rehearsal-')), 'run');
    const paths = await writeStudentProfileNormalizationReports({
      outputDir: dir,
      plan,
      inventory: { collections: [], matches: [], unknown: [] },
    });

    const serialized = [
      JSON.stringify(reviewed),
      JSON.stringify(artifact),
      readFileSync(paths.planPath, 'utf8'),
      readFileSync(paths.reportPath, 'utf8'),
      readFileSync(paths.csvPath, 'utf8'),
      readFileSync(paths.reviewDecisionsTemplatePath, 'utf8'),
    ].join('\n');

    for (const forbidden of ['loginPasswordHash', 'loginPasswordSalt', 'parentPasswordHash', KEY]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
