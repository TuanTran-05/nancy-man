import type { AccountingStudentFinanceProjectionHealthV3 } from '../accounting/studentFinanceProjectionRepository.js';
import type { CanonicalStudentReadMode } from '../../../../shared/canonicalStudentReadModel.js';

/**
 * What "the student identity data is healthy" means, written down once.
 *
 * Every counter is separate on purpose. A single score is useless to an
 * operator holding a maintenance window open at 2am: they need to know *which*
 * way it is unhealthy, because the answer decides whether to continue, roll
 * back, or fix one record and re-run.
 *
 * The report is also evidence. It is digested and stored immutably, and the
 * exit gate reads it rather than trusting an operator's judgement — so it
 * carries ids, counts, reason codes, and nothing else. No name, no contact, no
 * date of birth, no credential material: these documents outlive the window
 * and are read by more people than the students would expect.
 */

export type StudentIdentityHealthMode = 'daily' | 'cutover' | 'retirement';

export type StudentIdentityHealthBlocker = {
  code: string;
  collection?: string;
  documentId?: string;
  detail: string;
};

/**
 * Counts, one per way the data can be wrong.
 *
 * Three of these deserve their reasoning kept next to them, because the
 * obvious version of each would make the gate unreachable:
 *
 * - `unnormalizedLegacySoftMergeProfiles` is non-zero from day one. Fifty-eight
 *   production records carry `mergedIntoStudentId` with no alias, and only
 *   Workstream C's normalization clears them. It blocks cutover, not the daily
 *   audit.
 * - `studentsWithUnusableAdmissionSearchFields` counts *canonical profiles
 *   only*. Retired documents are excluded exactly as the backfill planner
 *   excludes them: they are never a valid creation-conflict target, and their
 *   surviving twin already carries complete fields. Counting them would hold
 *   this blocker non-zero until retirement deletes them — which happens after
 *   the gate it would be blocking.
 * - `studentsWithUnderivableAdmissionSearchFields` counts profiles whose
 *   `name`, `dob`, or `contact` is itself missing, so no backfill can produce
 *   the denormalized field. Reported against the frozen baseline rather than
 *   required to be zero, because demanding zero would make the gate
 *   permanently unreachable for data nobody can repair.
 */
export type StudentIdentityHealthCounts = {
  physicalProfiles: number;
  canonicalProfiles: number;
  aliases: number;
  tombstones: number;
  unresolvedExactCodeGroups: number;
  confirmedSameHumanUnmergedGroups: number;
  unresolvedManualHoldGroups: number;
  quarantinedManualHoldGroups: number;
  confirmedDistinctPersonGroups: number;
  differentCodeCandidates: number;
  unresolvedDifferentCodeCandidates: number;
  requiredModeBlockerCount: number;
  unknownReferences: number;
  noncanonicalMutableReferences: number;
  profilesWithMultipleOpenEnrollments: number;
  registryProfileMismatches: number;
  linkedUserMismatches: number;
  activeCredentialsOnAliases: number;
  summariesForAliasesOrTombstones: number;
  missingCanonicalSummaries: number;
  orphanCanonicalSummaries: number;
  classRosterCountMismatches: number;
  duplicateWalletRows: number;
  pendingMigrationOperations: number;
  failedJournalOperations: number;
  promotionCreatedProfiles: number;
  legacyProjectionFieldsRemaining: number;
  unnormalizedLegacySoftMergeProfiles: number;
  studentsWithUnusableAdmissionSearchFields: number;
  studentsWithUnderivableAdmissionSearchFields: number;
  financeAnomaliesOutsideBaseline: number;
  activeMutationLeases: number;
  staleMutationLeases: number;
};

export type StudentIdentityHealthPendingJobs = {
  outboxJobs: number;
  accountingFinanceOutbox: number;
  receiptNotificationOutbox: number;
  zaloBulkJobs: number;
  payosProcessors: number;
  passwordResetWork: number;
};

export type StudentIdentityHealthProjection = AccountingStudentFinanceProjectionHealthV3 & {
  dashboardSchemaVersion: 3;
  dashboardComplete: boolean;
  dashboardStale: boolean;
};

export type StudentIdentityHealthInvariants = {
  aliasesOneHopAndAcyclic: boolean;
  /**
   * Null in daily mode. Money is compared against a reviewed plan, and without
   * a run there is no plan to compare to — reporting `true` would claim an
   * assurance nobody produced.
   */
  monetaryTotalsMatchReviewedPlan: boolean | null;
  projectionRebuildComplete: boolean;
  authenticationPathsCanonical: boolean;
};

export type StudentIdentityHealthReport = {
  schemaVersion: 2;
  auditId: string;
  mode: StudentIdentityHealthMode;
  target: { projectId: string; databaseId: string };
  runId: string | null;
  planDigest: string | null;
  approvalDigest: string | null;
  sourceCommitSha: string;
  exportOperationId: string | null;
  canonicalReadMode: CanonicalStudentReadMode;
  startedAt: string;
  checkedAt: string;
  /** Calendar date in `Asia/Ho_Chi_Minh`, which is what a green streak counts. */
  vietnamDate: string;
  status: 'green' | 'red';
  counts: StudentIdentityHealthCounts;
  operationCounts: { planned: number; applied: number; verified: number; failed: number };
  pendingJobs: StudentIdentityHealthPendingJobs;
  projectionHealth: StudentIdentityHealthProjection;
  invariants: StudentIdentityHealthInvariants;
  blockers: StudentIdentityHealthBlocker[];
  sources: Record<string, { ok: boolean; observedAt: string; sourceDigest?: string; code?: string; detail?: string }>;
  digest: string;
};

/**
 * Fields no report, blocker, or digest input may carry.
 *
 * Enforced rather than documented: a report is assembled from a dozen sources
 * and stored immutably, so one careless spread is a leak that no later
 * redaction takes back.
 */
export const STUDENT_IDENTITY_HEALTH_FORBIDDEN_FIELDS = [
  'password',
  'passwordHash',
  'passwordSalt',
  'loginPasswordHash',
  'loginPasswordSalt',
  'parentPasswordHash',
  'parentPasswordSalt',
  'token',
  'resetToken',
  'otp',
  'otpHash',
  'contact',
  'phone',
  'phoneNumber',
  'dob',
  'name',
  'displayName',
  'studentName',
  'email',
  'faceImage',
] as const;
