/**
 * Persisted contracts for the student profile merge engine.
 *
 * Two discriminated run kinds share one base shape: `profile_normalization`
 * (Workstream C) and `legacy_retirement` (Workstream D). They intentionally
 * cannot cross-validate — a retirement stage on a normalization run, or vice
 * versa, is rejected — because the two engines run under different maintenance
 * windows and a stage mix-up would mean an operation ran in the wrong phase.
 */

export type StudentProfileMergeRunKind = 'profile_normalization' | 'legacy_retirement';

export type StudentProfileMergeMigrationVersion =
  | 'student-profile-normalization-v2'
  | 'student-profile-retirement-v1';

export type StudentProfileMergeRunStatus =
  | 'preflighting'
  | 'preflighted'
  | 'applying'
  | 'verifying'
  | 'verified'
  | 'rolling_back'
  | 'rolled_back'
  | 'aborted'
  | 'failed'
  | 'forward_repair_required';

export const STUDENT_PROFILE_NORMALIZATION_STAGES = [
  'claim_codes',
  'create_aliases',
  'reconcile_profile',
  'move_academic_keys',
  'move_finance_keys',
  'rewrite_references',
  'select_credentials',
  'rewrite_linked_users',
  'rebuild_projections',
  'tombstone_legacy',
  'verify_group',
] as const;
export type StudentProfileNormalizationStage =
  (typeof STUDENT_PROFILE_NORMALIZATION_STAGES)[number];

export const STUDENT_PROFILE_RETIREMENT_STAGES = [
  'scan_center_legacy_fields',
  'remove_center_legacy_fields',
  'remove_runtime_fallbacks',
  'verify_retirement',
] as const;
export type StudentProfileRetirementStage = (typeof STUDENT_PROFILE_RETIREMENT_STAGES)[number];

export type StudentProfileMergeStage =
  | StudentProfileNormalizationStage
  | StudentProfileRetirementStage;

export type StudentProfileMergeApprovalRole = 'identity_technical' | 'finance' | 'auth_security';

export interface StudentProfileMergeRunRecordBase {
  runId: string;
  planDigest: string;
  approvalDigest: string;
  registryVersion: string;
  target: { projectId: string; databaseId: string };
  sourceCommitSha: string;
  exportOperationId: string;
  exportUri: string;
  exportEvidenceDigest: string;
  actorId: string;
  approvals: Array<{
    role: StudentProfileMergeApprovalRole;
    reviewerId: string;
    reviewedAt: string;
    planDigest: string;
  }>;
  status: StudentProfileMergeRunStatus;
  operationCount: number;
  appliedOperationCount: number;
  verifiedOperationCount: number;
  createdAt: string;
  updatedAt: string;
  maintenanceLiftedAt: string | null;
  evidence: {
    projectionHealthPath: string | null;
    normalizationVerificationPath: string | null;
    smokeEvidencePath: string | null;
    rollbackArtifactDigest: string | null;
    releaseProofPath: string | null;
  };
}

export interface StudentProfileNormalizationRunRecord extends StudentProfileMergeRunRecordBase {
  migrationVersion: 'student-profile-normalization-v2';
  runKind: 'profile_normalization';
}

export interface StudentProfileRetirementRunRecord extends StudentProfileMergeRunRecordBase {
  migrationVersion: 'student-profile-retirement-v1';
  runKind: 'legacy_retirement';
  parentNormalizationRunId: string;
  observationWindowEndedAt: string;
}

export type StudentProfileMergeRunRecord =
  | StudentProfileNormalizationRunRecord
  | StudentProfileRetirementRunRecord;

export interface StudentProfileMergeJournalRecord {
  runId: string;
  operationId: string;
  groupId: string;
  stage: StudentProfileMergeStage;
  status: 'planned' | 'applied' | 'verified' | 'failed' | 'rolled_back';
  sourcePath: string | null;
  targetPath: string | null;
  beforeFingerprint: string | null;
  afterFingerprint: string;
  actorId: string;
  appliedAt: string | null;
  verifiedAt: string | null;
  rolledBackAt: string | null;
  lastAttemptAt: string | null;
  errorCode: string | null;
  evidencePath: string | null;
}

const RUN_STATUSES: readonly StudentProfileMergeRunStatus[] = [
  'preflighting',
  'preflighted',
  'applying',
  'verifying',
  'verified',
  'rolling_back',
  'rolled_back',
  'aborted',
  'failed',
  'forward_repair_required',
];

const APPROVAL_ROLES: readonly StudentProfileMergeApprovalRole[] = [
  'identity_technical',
  'finance',
  'auth_security',
];

const JOURNAL_STATUSES = ['planned', 'applied', 'verified', 'failed', 'rolled_back'] as const;

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEvidenceShape(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const keys = ['projectionHealthPath', 'normalizationVerificationPath', 'smokeEvidencePath', 'rollbackArtifactDigest', 'releaseProofPath'];
  return keys.every((key) => isNullableString(value[key]));
}

function isApprovalsShape(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isPlainObject(entry) &&
        APPROVAL_ROLES.includes(entry.role as StudentProfileMergeApprovalRole) &&
        isString(entry.reviewerId) &&
        isString(entry.reviewedAt) &&
        isString(entry.planDigest)
    )
  );
}

function isBaseRunShape(value: Record<string, unknown>): boolean {
  return (
    isString(value.runId) &&
    isString(value.planDigest) &&
    isString(value.approvalDigest) &&
    isString(value.registryVersion) &&
    isPlainObject(value.target) &&
    isString((value.target as Record<string, unknown>).projectId) &&
    isString((value.target as Record<string, unknown>).databaseId) &&
    isString(value.sourceCommitSha) &&
    isString(value.exportOperationId) &&
    isString(value.exportUri) &&
    isString(value.exportEvidenceDigest) &&
    isString(value.actorId) &&
    isApprovalsShape(value.approvals) &&
    RUN_STATUSES.includes(value.status as StudentProfileMergeRunStatus) &&
    typeof value.operationCount === 'number' &&
    typeof value.appliedOperationCount === 'number' &&
    typeof value.verifiedOperationCount === 'number' &&
    isString(value.createdAt) &&
    isString(value.updatedAt) &&
    isNullableString(value.maintenanceLiftedAt) &&
    isEvidenceShape(value.evidence)
  );
}

export function isStudentProfileMergeRunRecord(
  value: unknown
): value is StudentProfileMergeRunRecord {
  if (!isPlainObject(value) || !isBaseRunShape(value)) return false;

  if (value.migrationVersion === 'student-profile-normalization-v2') {
    if (value.runKind !== 'profile_normalization') return false;
    return !('parentNormalizationRunId' in value) && !('observationWindowEndedAt' in value);
  }
  if (value.migrationVersion === 'student-profile-retirement-v1') {
    if (value.runKind !== 'legacy_retirement') return false;
    return isString(value.parentNormalizationRunId) && isString(value.observationWindowEndedAt);
  }
  return false;
}

export function isStudentProfileMergeJournalRecord(
  value: unknown,
  runKind: StudentProfileMergeRunKind
): value is StudentProfileMergeJournalRecord {
  if (!isPlainObject(value)) return false;

  const allowedStages: readonly string[] =
    runKind === 'profile_normalization'
      ? STUDENT_PROFILE_NORMALIZATION_STAGES
      : STUDENT_PROFILE_RETIREMENT_STAGES;

  if (
    !isString(value.runId) ||
    !isString(value.operationId) ||
    !isString(value.groupId) ||
    !allowedStages.includes(value.stage as string) ||
    !JOURNAL_STATUSES.includes(value.status as (typeof JOURNAL_STATUSES)[number]) ||
    !isNullableString(value.sourcePath) ||
    !isNullableString(value.targetPath) ||
    !isNullableString(value.beforeFingerprint) ||
    !isString(value.afterFingerprint) ||
    !isString(value.actorId) ||
    !isNullableString(value.appliedAt) ||
    !isNullableString(value.verifiedAt) ||
    !isNullableString(value.rolledBackAt) ||
    !isNullableString(value.lastAttemptAt) ||
    !isNullableString(value.errorCode) ||
    !isNullableString(value.evidencePath)
  ) {
    return false;
  }

  if (value.status === 'failed' && value.errorCode === null) return false;

  return true;
}
