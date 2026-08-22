import { Timestamp } from '@/server/db/documentStore.js';
import { deriveNormalizationOperationId } from './writer.js';
import type {
  StudentProfileMergePlan,
  StudentProfileMergePlanGroup,
  StudentProfileMergePlanWrite,
} from './reporter.js';
import type { StudentMergeDocumentEffect } from './rollback.js';

/**
 * Fixtures for the snapshot rehearsal.
 *
 * The shapes here are drawn from what the 2026-08-06 production discovery
 * actually found, not from what a merge engine is convenient to test against:
 * an exact-code pair whose two credentials differ (`HS260167`), legacy
 * soft-merge records that carry `mergedIntoStudentId` and no alias, profiles
 * whose denormalized search fields are absent, and instants stored three
 * different ways. A fixture that omitted these would let the engine pass a
 * rehearsal and then meet them for the first time inside the maintenance
 * window.
 *
 * Two fixtures exist on purpose. The clean one is what a deployable rehearsal
 * runs, and it must contain zero holds. The blocked one proves the engine
 * refuses rather than improvises — a rehearsal that only ever sees the happy
 * path tests nothing about the gates.
 */

export const REHEARSAL_COMMIT = 'f'.repeat(40);
export const REHEARSAL_TARGET = { projectId: 'edutrack-rehearsal', databaseId: 'edutrack' };

const FP = (seed: string) => seed.repeat(64).slice(0, 64);

function operation(input: {
  groupId: string;
  stage: string;
  registryEntryId: string;
  kind: string;
  sourcePath: string | null;
  targetPath: string | null;
  sourceFingerprint: string | null;
  targetBeforeFingerprint: string | null;
  expectedAfterFingerprint: string | null;
  write: StudentProfileMergePlanWrite;
  dependsOn?: string[];
}) {
  return {
    ...input,
    dependsOn: input.dependsOn ?? [],
    // Derived, never authored, so a fixture cannot accidentally encode an id
    // the preflight guard would reject for the wrong reason.
    operationId: deriveNormalizationOperationId({
      groupId: input.groupId,
      stage: input.stage,
      registryEntryId: input.registryEntryId,
      sourcePath: input.sourcePath,
      targetPath: input.targetPath,
      expectedAfterFingerprint: input.expectedAfterFingerprint,
      write: input.write,
    }),
  };
}

/**
 * One clean exact-code group: a ledger moves to the canonical key and the
 * legacy profile becomes a tombstone. No credential work, so `auth_security`
 * is not a required approval role — which is itself worth rehearsing.
 */
export function cleanRehearsalGroup(): StudentProfileMergePlanGroup {
  const ledgerOp = operation({
    groupId: 'g-clean',
    stage: 'move_finance_keys',
    registryEntryId: 'course_fee_ledgers.owner',
    kind: 'recreate_document',
    sourcePath: 'course_fee_ledgers/legacy-1_c-1',
    targetPath: 'course_fee_ledgers/canonical-1_c-1',
    sourceFingerprint: FP('1'),
    targetBeforeFingerprint: null,
    expectedAfterFingerprint: FP('1'),
    write: { mode: 'copy_source' },
  });
  const tombstoneOp = operation({
    groupId: 'g-clean',
    stage: 'tombstone_legacy',
    registryEntryId: 'students.profile',
    kind: 'patch_field',
    sourcePath: null,
    targetPath: 'students/legacy-1',
    sourceFingerprint: null,
    targetBeforeFingerprint: FP('3'),
    expectedAfterFingerprint: FP('4'),
    write: { mode: 'patch', payload: { studentProfileState: 'merged_tombstone' } },
    dependsOn: [ledgerOp.operationId],
  });

  return {
    groupId: 'g-clean',
    canonicalProfileId: 'canonical-1',
    legacyProfileIds: ['legacy-1'],
    candidateKind: 'exact_code',
    evidenceFingerprint: 'f'.repeat(64),
    operations: [ledgerOp, tombstoneOp],
    documentEffects: [
      {
        operationId: ledgerOp.operationId,
        path: 'course_fee_ledgers/legacy-1_c-1',
        beforeFingerprint: FP('1'),
        afterFingerprint: null,
        restoreStrategy: 'restore_before_image',
        rollbackArtifactEntryId: 'e-ledger-source',
      },
      {
        operationId: ledgerOp.operationId,
        path: 'course_fee_ledgers/canonical-1_c-1',
        beforeFingerprint: null,
        afterFingerprint: FP('1'),
        restoreStrategy: 'delete_run_created_document',
        rollbackArtifactEntryId: null,
      },
      {
        operationId: tombstoneOp.operationId,
        path: 'students/legacy-1',
        beforeFingerprint: FP('3'),
        afterFingerprint: FP('4'),
        restoreStrategy: 'restore_before_image',
        rollbackArtifactEntryId: 'e-legacy-1',
      },
    ] satisfies StudentMergeDocumentEffect[],
    decisions: { credential: { action: 'none' } },
    money: { before: { ledgerAmounts: 1_200_000 }, expectedAfter: { ledgerAmounts: 1_200_000 } },
    blockers: [],
  };
}

/**
 * The `HS260167` shape: one code, two profiles, two different credentials and
 * no evidence of which one the family uses. It must reach a reviewer, never an
 * automatic winner.
 */
export function heldCredentialGroup(): StudentProfileMergePlanGroup {
  return {
    groupId: 'g-hs260167',
    canonicalProfileId: 'canonical-2',
    legacyProfileIds: ['legacy-2'],
    candidateKind: 'exact_code',
    evidenceFingerprint: 'f'.repeat(64),
    operations: [],
    documentEffects: [],
    decisions: { credential: { action: 'hold', reasonCode: 'CREDENTIAL_AMBIGUOUS' } },
    money: { before: {}, expectedAfter: {} },
    blockers: [
      {
        code: 'CREDENTIAL_AMBIGUOUS',
        candidateId: 'canonical-2',
        detail: 'credentials differ across canonical-2, legacy-2',
      },
    ],
  };
}

export function rehearsalPlan(
  groups: StudentProfileMergePlanGroup[],
  overrides: Partial<StudentProfileMergePlan> = {}
): StudentProfileMergePlan {
  const money = groups.reduce(
    (total, group) => {
      for (const [key, value] of Object.entries(group.money.before)) {
        total.before[key] = (total.before[key] ?? 0) + value;
      }
      for (const [key, value] of Object.entries(group.money.expectedAfter)) {
        total.expectedAfter[key] = (total.expectedAfter[key] ?? 0) + value;
      }
      return total;
    },
    { before: {} as Record<string, number>, expectedAfter: {} as Record<string, number> }
  );

  return {
    schemaVersion: 1,
    auditPhase: 'final',
    runId: 'rehearsal-run-1',
    sourceCommit: REHEARSAL_COMMIT,
    registryVersion: 'student-references-v2',
    target: REHEARSAL_TARGET,
    exportEvidence: {
      operationName: `projects/${REHEARSAL_TARGET.projectId}/databases/${REHEARSAL_TARGET.databaseId}/operations/op-rehearsal`,
      outputUriPrefix: 'gs://edutrack-rehearsal-backups/x',
      snapshotTime: '2026-08-07T01:00:00.000Z',
      evidenceDigest: FP('e'),
    },
    rollbackArtifact: null,
    groups,
    money,
    blockers: [],
    ...overrides,
  };
}

/** Before-images the clean group's rollback needs. */
export function cleanRollbackEntries() {
  return [
    {
      entryId: 'e-ledger-source',
      path: 'course_fee_ledgers/legacy-1_c-1',
      before: { studentId: 'legacy-1', amount: 1_200_000 },
    },
    {
      entryId: 'e-legacy-1',
      path: 'students/legacy-1',
      before: { name: 'Quách Hoàng Minh', studentId: 'HS260101', walletBalance: 0 },
    },
  ];
}

/**
 * Documents whose instants are stored three different ways, as production
 * does: a DocumentStore `Timestamp` from the clone path, an ISO string from the
 * ordinary write paths, and an epoch number from the drifted user documents.
 * All three describe the same moment and must fingerprint identically.
 */
export function mixedInstantDocuments() {
  const moment = '2026-07-01T00:00:00.000Z';
  return [
    { id: 'stamped', data: { createdAt: Timestamp.fromDate(new Date(moment)) } },
    { id: 'iso', data: { createdAt: moment } },
    { id: 'epoch', data: { createdAt: Date.parse(moment) } },
  ];
}

/**
 * Profiles the Phase 0 census found: a canonical one with complete fields, one
 * whose denormalized fields were never written, one whose contact drifted, and
 * a legacy soft-merge record that carries `mergedIntoStudentId` and no alias.
 */
export function censusShapedProfiles() {
  return [
    {
      id: 'canonical-1',
      name: 'Quách Hoàng Minh',
      dob: '2014-05-02',
      contact: '0900000000',
      admissionSearchName: 'quach hoang minh',
      admissionSearchDob: '2014-05-02',
      admissionSearchContact: '84900000000',
    },
    { id: 'never-written', name: 'Nguyễn An', dob: '2015-01-01', contact: '0900000001' },
    {
      id: 'drifted',
      name: 'Trần Bảo',
      dob: '2015-02-02',
      contact: '0900000002',
      admissionSearchName: 'tran bao',
      admissionSearchDob: '2015-02-02',
      admissionSearchContact: '84900000999',
    },
    {
      id: 'legacy-soft-merged',
      mergedIntoStudentId: 'canonical-1',
      studentLifecycle: 'archived',
      name: 'Quách Hoàng Minh',
      dob: '2014-05-02',
      contact: '0900000000',
    },
  ];
}
