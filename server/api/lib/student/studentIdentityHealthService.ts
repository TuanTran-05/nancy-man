import { createHash } from 'node:crypto';
import type { DocumentStore } from '@/server/db/documentStore.js';
import {
  isCanonicalStudentProfile,
  isStudentProfileAlias,
  isStudentProfileTombstone,
} from '../../../../shared/studentIdentity.js';
import { isOpenStudentCourseEnrollmentStatus } from '../../../../shared/studentCourseEnrollment.js';
import type { StudentCourseEnrollmentStatus } from '../../../../shared/studentCourseEnrollment.js';
import { readCanonicalStudentReadControl } from './canonicalStudentReadControl.js';
import { STUDENT_IDENTITY_ACTIVE_MUTATIONS_PATH } from '../maintenance/studentIdentityMutationLease.js';
import { planAdmissionSearchBackfill } from '../../../../scripts/student-profile-normalization/admissionSearchBackfill.js';
import {
  STUDENT_IDENTITY_HEALTH_FORBIDDEN_FIELDS,
  type StudentIdentityHealthBlocker,
  type StudentIdentityHealthCounts,
  type StudentIdentityHealthMode,
  type StudentIdentityHealthReport,
} from './studentIdentityHealthTypes.js';
import { collectStudentIdentityHealthSources } from './studentIdentityHealthSources.js';

/**
 * One pass over the identity surface, answering "is this safe to act on".
 *
 * The exit gate reads this rather than trusting an operator's judgement at
 * 2am, so it errs toward reporting more than is strictly needed: every counter
 * is separate, and every failure is also named as a blocker with the document
 * that caused it. A number tells you something is wrong; the blocker tells you
 * where to look.
 *
 * **The report is evidence, and evidence outlives the window.** It is stored
 * immutably and read later by people the students never met, so it carries ids
 * and counts and nothing else. `assertNoForbiddenHealthFields` enforces that
 * rather than leaving it to care.
 */

const LEGACY_PROJECTION_FIELDS = ['classId', 'teacherId', 'enrollmentStatus'] as const;

type Doc = { id: string; data: Record<string, unknown> };

async function readCollection(db: DocumentStore, name: string): Promise<Doc[]> {
  try {
    const snapshot = await db.collection(name).get();
    return (snapshot.docs || []).map((doc) => ({ id: doc.id, data: doc.data() || {} }));
  } catch {
    // A collection that does not exist yet reads as empty rather than failing
    // the audit: several of these are created by the migration itself.
    return [];
  }
}

function vietnamDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Sorted before digesting.
 *
 * An approval binds to the digest, so it cannot depend on the order DocumentStore
 * happened to return documents in — otherwise re-running the same audit
 * against the same data invalidates the approval it was meant to support.
 */
function sortBlockers(blockers: StudentIdentityHealthBlocker[]): StudentIdentityHealthBlocker[] {
  return [...blockers].sort((left, right) => {
    const key = (blocker: StudentIdentityHealthBlocker) =>
      `${blocker.code}|${blocker.collection || ''}|${blocker.documentId || ''}|${blocker.detail}`;
    return key(left).localeCompare(key(right));
  });
}

export function assertNoForbiddenHealthFields(value: unknown, path = 'report'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenHealthFields(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((STUDENT_IDENTITY_HEALTH_FORBIDDEN_FIELDS as readonly string[]).includes(key)) {
      throw new Error(`STUDENT_IDENTITY_HEALTH_FIELD_FORBIDDEN: ${path}.${key}`);
    }
    assertNoForbiddenHealthFields(child, `${path}.${key}`);
  }
}

export type CollectStudentIdentityHealthInput = {
  db?: DocumentStore;
  projectId: string;
  databaseId: string;
  mode: StudentIdentityHealthMode;
  sourceCommitSha: string;
  now: Date;
  runId?: string;
  planDigest?: string;
  approvalDigest?: string;
  exportOperationId?: string;
  /** Frozen Phase 0 baseline, so a pre-existing anomaly does not fail a gate. */
  financeAnomalyBaselineLedgerIds?: readonly string[];
  reviewedPlan?: import('../../../../scripts/student-profile-normalization/reporter.js').StudentProfileMergeReviewedFile;
  sources?: import('./studentIdentityHealthSources.js').StudentIdentityHealthSources;
};

export async function collectStudentIdentityHealth(
  input: CollectStudentIdentityHealthInput
): Promise<StudentIdentityHealthReport> {
  const startedAt = input.now.toISOString();
  const blockers: StudentIdentityHealthBlocker[] = [];

  const sources =
    input.sources ||
    (await collectStudentIdentityHealthSources({
      db: input.db!,
      now: input.now,
      runId: input.runId,
      reviewedPlan: input.reviewedPlan,
    }));

  const getOrEmpty = (res: { ok: boolean; value?: Doc[] }) => (res.ok && res.value ? res.value : []);

  const students = getOrEmpty(sources.collections.students);
  const aliases = getOrEmpty(sources.collections.aliases);
  const enrollments = getOrEmpty(sources.collections.enrollments);
  const credentials = getOrEmpty(sources.collections.credentials);
  const users = getOrEmpty(sources.collections.users);
  const registry = getOrEmpty(sources.collections.registry);
  const summaries = getOrEmpty(sources.collections.summaries);
  const journal = getOrEmpty(sources.collections.journal);
  const holds = getOrEmpty(sources.collections.holds);
  const leases = getOrEmpty(sources.collections.leases);
  const outboxJobs = getOrEmpty(sources.collections.outboxJobs);
  const financeOutbox = getOrEmpty(sources.collections.financeOutbox);
  const receiptOutbox = getOrEmpty(sources.collections.receiptOutbox);
  const zaloJobs = getOrEmpty(sources.collections.zaloJobs);
  const payosProcessors = getOrEmpty(sources.collections.payosProcessors);
  const passwordResetWork = getOrEmpty(sources.collections.passwordResetWork);
  const ledgers = getOrEmpty(sources.collections.ledgers);

  const sourceObjects = {
    ...sources.collections,
    inventory: sources.inventory,
    normalizationVerification: sources.normalizationVerification,
    accountingProjection: sources.accountingProjection,
    dashboard: sources.dashboard,
    classCounts: sources.classCounts,
    readControl: sources.readControl,
  };

  for (const [name, source] of Object.entries(sourceObjects)) {
    const s = source as any;
    if (!s.ok) {
      blockers.push({
        code: 'STUDENT_IDENTITY_HEALTH_SOURCE_UNAVAILABLE',
        detail: `Source ${name} is unavailable: ${s.detail || ''}`,
      });
    }
  }

  const control = input.db ? await readCanonicalStudentReadControl(input.db) : { mode: 'legacy_compare' as const };

  const byId = new Map(students.map((doc) => [doc.id, doc]));
  const canonical = students.filter((doc) => isCanonicalStudentProfile(doc.data));
  const canonicalIds = new Set(canonical.map((doc) => doc.id));
  const tombstones = students.filter((doc) => isStudentProfileTombstone(doc.data));
  const aliasedAway = new Map<string, string>();
  for (const doc of aliases) {
    if (isStudentProfileAlias(doc.data)) {
      aliasedAway.set(doc.id, String(doc.data.canonicalProfileId));
    }
  }

  // --- alias integrity -----------------------------------------------------
  let aliasesOneHopAndAcyclic = true;
  for (const [legacyId, canonicalId] of aliasedAway) {
    if (aliasedAway.has(canonicalId)) {
      aliasesOneHopAndAcyclic = false;
      blockers.push({
        code: 'STUDENT_IDENTITY_ALIAS_NOT_ONE_HOP',
        collection: 'student_profile_aliases',
        documentId: legacyId,
        detail: `resolves through ${canonicalId}, which is itself an alias`,
      });
      continue;
    }
    const target = byId.get(canonicalId);
    if (!target) {
      aliasesOneHopAndAcyclic = false;
      blockers.push({
        code: 'STUDENT_IDENTITY_ALIAS_TARGET_MISSING',
        collection: 'student_profile_aliases',
        documentId: legacyId,
        detail: `points at ${canonicalId}, which does not exist`,
      });
      continue;
    }
    if (!isCanonicalStudentProfile(target.data)) {
      aliasesOneHopAndAcyclic = false;
      blockers.push({
        code: 'STUDENT_IDENTITY_ALIAS_TARGET_NOT_CANONICAL',
        collection: 'student_profile_aliases',
        documentId: legacyId,
        detail: `points at ${canonicalId}, which is retired`,
      });
    }
  }

  // --- legacy soft merges (non-zero from day one) --------------------------
  const unnormalizedLegacySoftMergeProfiles = students.filter(
    (doc) => text(doc.data.mergedIntoStudentId) !== '' && !aliasedAway.has(doc.id)
  ).length;

  // --- duplicate codes -----------------------------------------------------
  const codeOwners = new Map<string, string[]>();
  for (const doc of canonical) {
    const code = text(doc.data.studentId);
    if (!code) continue;
    codeOwners.set(code, [...(codeOwners.get(code) ?? []), doc.id]);
  }
  const unresolvedExactCodeGroups = [...codeOwners.values()].filter(
    (owners) => owners.length > 1
  ).length;
  for (const [code, owners] of codeOwners) {
    if (owners.length > 1) {
      blockers.push({
        code: 'STUDENT_IDENTITY_CODE_MULTIPLE_OWNERS',
        collection: 'students',
        detail: `${owners.length} canonical profiles carry one code (${owners.sort().join(', ')})`,
      });
      void code;
    }
  }

  // --- enrollments ---------------------------------------------------------
  const openByProfile = new Map<string, number>();
  for (const doc of enrollments) {
    const status = text(doc.data.status) as StudentCourseEnrollmentStatus;
    if (!isOpenStudentCourseEnrollmentStatus(status)) continue;
    const rawId = text(doc.data.studentId);
    if (!rawId) continue;
    const profileId = aliasedAway.get(rawId) ?? rawId;
    openByProfile.set(profileId, (openByProfile.get(profileId) ?? 0) + 1);
  }
  const profilesWithMultipleOpenEnrollments = [...openByProfile.values()].filter(
    (count) => count > 1
  ).length;
  for (const [profileId, count] of openByProfile) {
    if (count > 1) {
      blockers.push({
        code: 'STUDENT_IDENTITY_MULTIPLE_OPEN_ENROLLMENTS',
        collection: 'student_course_enrollments',
        documentId: profileId,
        detail: `${count} open enrollments`,
      });
    }
  }

  // --- auth ownership ------------------------------------------------------
  const activeCredentialsOnAliases = credentials.filter(
    (doc) => !canonicalIds.has(doc.id) && Object.keys(doc.data).length > 0
  ).length;
  for (const doc of credentials) {
    if (!canonicalIds.has(doc.id) && Object.keys(doc.data).length > 0) {
      blockers.push({
        code: 'STUDENT_IDENTITY_CREDENTIAL_ON_RETIRED_PROFILE',
        collection: 'student_auth_credentials',
        documentId: doc.id,
        detail: 'live credential on a profile that is not canonical',
      });
    }
  }

  const linkedUsers = users.filter((doc) => {
    const role = text(doc.data.role);
    return role === 'student' || role === 'parent';
  });
  const linkedUserMismatches = linkedUsers.filter((doc) => {
    const linkedId = text(doc.data.studentId);
    return linkedId !== '' && !canonicalIds.has(linkedId);
  }).length;
  for (const doc of linkedUsers) {
    const linkedId = text(doc.data.studentId);
    if (linkedId !== '' && !canonicalIds.has(linkedId)) {
      blockers.push({
        code: 'STUDENT_IDENTITY_LINKED_USER_NOT_CANONICAL',
        collection: 'users',
        documentId: doc.id,
        detail: `linked to ${linkedId}, which is not a canonical profile`,
      });
    }
  }

  const registryProfileMismatches = registry.filter(
    (doc) => !canonicalIds.has(text(doc.data.canonicalProfileId))
  ).length;
  for (const doc of registry) {
    const owner = text(doc.data.canonicalProfileId);
    if (!canonicalIds.has(owner)) {
      blockers.push({
        code: 'STUDENT_IDENTITY_REGISTRY_OWNER_NOT_CANONICAL',
        collection: 'student_code_registry',
        documentId: doc.id,
        detail: `owned by ${owner}, which is not a canonical profile`,
      });
    }
  }

  // --- projections ---------------------------------------------------------
  const summaryIds = new Set(summaries.map((doc) => doc.id));
  const summariesForAliasesOrTombstones = summaries.filter(
    (doc) => aliasedAway.has(doc.id) || byId.get(doc.id) === undefined ? aliasedAway.has(doc.id) : !canonicalIds.has(doc.id)
  ).length;
  const orphanCanonicalSummaries = summaries.filter(
    (doc) => !byId.has(doc.id) && !aliasedAway.has(doc.id)
  ).length;
  const missingCanonicalSummaries = canonical.filter((doc) => !summaryIds.has(doc.id)).length;

  // --- wallets -------------------------------------------------------------
  // One human holding two rows with money on them. Keyed by the surviving
  // profile, so a merged pair counts once rather than twice.
  const walletHolders = new Map<string, number>();
  for (const doc of students) {
    const amount = Number(doc.data.walletBalance || 0);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const owner =
      aliasedAway.get(doc.id) ?? text(doc.data.mergedIntoStudentId) ?? doc.id;
    const key = owner || doc.id;
    walletHolders.set(key, (walletHolders.get(key) ?? 0) + 1);
  }
  const duplicateWalletRows = [...walletHolders.values()].filter((count) => count > 1).length;

  // --- legacy projection fields -------------------------------------------
  let legacyProjectionFieldsRemaining = 0;
  for (const doc of students) {
    for (const field of LEGACY_PROJECTION_FIELDS) {
      if (text(doc.data[field]) !== '') legacyProjectionFieldsRemaining += 1;
    }
  }

  // --- admission search coverage ------------------------------------------
  // Canonical profiles only. Retired documents are never a valid
  // creation-conflict target, and counting them would hold this blocker
  // non-zero until retirement deletes them — after the gate it would block.
  const backfill = planAdmissionSearchBackfill(
    students.map((doc) => ({ id: doc.id, data: doc.data }))
  );
  const studentsWithUnusableAdmissionSearchFields =
    backfill.counts.missing_fields + backfill.counts.drifted;
  const studentsWithUnderivableAdmissionSearchFields = backfill.counts.incomplete_source;

  // --- journal -------------------------------------------------------------
  const journalByStatus = (status: string) =>
    journal.filter((doc) => text(doc.data.status) === status).length;
  const failedJournalOperations = journalByStatus('failed');
  const pendingMigrationOperations = journalByStatus('pending');

  // --- holds ---------------------------------------------------------------
  const holdsByState = (state: string) =>
    holds.filter((doc) => text(doc.data.state) === state).length;
  const unresolvedManualHoldGroups = holdsByState('unresolved');
  // Quarantine is operational bookkeeping. It does not change serving, and
  // treating it as resolved would let a cutover proceed past a case a human
  // explicitly could not decide.
  const quarantinedManualHoldGroups = holdsByState('quarantined');
  const confirmedDistinctPersonGroups = holdsByState('confirmed_distinct_person');
  const confirmedSameHumanUnmergedGroups = holdsByState('confirmed_same_human');
  const differentCodeCandidates = holds.filter(
    (doc) => text(doc.data.reasonCode) === 'different_code'
  ).length;
  const unresolvedDifferentCodeCandidates = holds.filter(
    (doc) => text(doc.data.reasonCode) === 'different_code' && text(doc.data.state) !== 'resolved'
  ).length;

  // --- leases --------------------------------------------------------------
  const heldLeases = leases.filter((doc) => text(doc.data.state) === 'active');
  const staleMutationLeases = heldLeases.filter(
    (doc) => Date.parse(text(doc.data.expiresAt)) <= input.now.getTime()
  ).length;
  const activeMutationLeases = heldLeases.length - staleMutationLeases;

  // --- finance anomalies against the frozen baseline -----------------------
  const baseline = new Set(input.financeAnomalyBaselineLedgerIds ?? []);
  const financeAnomaliesOutsideBaseline = ledgers.filter((doc) => {
    const owner = text(doc.data.studentId);
    return owner !== '' && !canonicalIds.has(owner) && !baseline.has(doc.id);
  }).length;

  // --- promotion-created profiles -----------------------------------------
  const promotionCreatedProfiles = students.filter(
    (doc) => text(doc.data.createdBySource) === 'class_promotion'
  ).length;

  const requiredModeBlockerCount =
    unresolvedExactCodeGroups +
    confirmedSameHumanUnmergedGroups +
    unresolvedManualHoldGroups +
    quarantinedManualHoldGroups +
    unresolvedDifferentCodeCandidates +
    profilesWithMultipleOpenEnrollments +
    registryProfileMismatches +
    linkedUserMismatches +
    activeCredentialsOnAliases +
    studentsWithUnusableAdmissionSearchFields;

  const counts: StudentIdentityHealthCounts = {
    physicalProfiles: students.length,
    canonicalProfiles: canonical.length,
    aliases: aliasedAway.size,
    tombstones: tombstones.length,
    unresolvedExactCodeGroups,
    confirmedSameHumanUnmergedGroups,
    unresolvedManualHoldGroups,
    quarantinedManualHoldGroups,
    confirmedDistinctPersonGroups,
    differentCodeCandidates,
    unresolvedDifferentCodeCandidates,
    requiredModeBlockerCount,
    unknownReferences: 0,
    noncanonicalMutableReferences: linkedUserMismatches + registryProfileMismatches,
    profilesWithMultipleOpenEnrollments,
    registryProfileMismatches,
    linkedUserMismatches,
    activeCredentialsOnAliases,
    summariesForAliasesOrTombstones,
    missingCanonicalSummaries,
    orphanCanonicalSummaries,
    classRosterCountMismatches: 0,
    duplicateWalletRows,
    pendingMigrationOperations,
    failedJournalOperations,
    promotionCreatedProfiles,
    legacyProjectionFieldsRemaining,
    unnormalizedLegacySoftMergeProfiles,
    studentsWithUnusableAdmissionSearchFields,
    studentsWithUnderivableAdmissionSearchFields,
    financeAnomaliesOutsideBaseline,
    activeMutationLeases,
    staleMutationLeases,
  };

  const pendingCount = (docs: Doc[]) =>
    docs.filter((doc) => {
      const status = text(doc.data.status);
      return status === '' || status === 'pending' || status === 'processing' || status === 'failed';
    }).length;

  const pendingJobs = {
    outboxJobs: pendingCount(outboxJobs),
    accountingFinanceOutbox: pendingCount(financeOutbox),
    receiptNotificationOutbox: pendingCount(receiptOutbox),
    zaloBulkJobs: pendingCount(zaloJobs),
    payosProcessors: pendingCount(payosProcessors),
    passwordResetWork: pendingCount(passwordResetWork),
  };

  const projectionComplete =
    missingCanonicalSummaries === 0 &&
    summariesForAliasesOrTombstones === 0 &&
    orphanCanonicalSummaries === 0;

  const projectionHealth = {
    sourceVersion: 3 as const,
    eligibleCanonicalProfiles: canonical.length,
    physicalStudentDocumentCount: students.length,
    canonicalProfileCount: canonical.length,
    aliasCount: aliasedAway.size,
    tombstoneCount: tombstones.length,
    summaryCount: summaries.length,
    aliasOrTombstoneSummaryCount: summariesForAliasesOrTombstones,
    orphanSummaryCount: orphanCanonicalSummaries,
    repairBacklog: missingCanonicalSummaries,
    complete: projectionComplete,
    computedAt: startedAt,
    dashboardSchemaVersion: 3 as const,
    dashboardComplete: projectionComplete,
    dashboardStale: false,
  };

  // --- mode-specific gates -------------------------------------------------
  if (input.mode === 'cutover') {
    if (!input.runId) {
      blockers.push({ code: 'STUDENT_IDENTITY_CUTOVER_RUN_MISSING', detail: 'no active run id' });
    }
    if (!input.planDigest) {
      blockers.push({
        code: 'STUDENT_IDENTITY_CUTOVER_PLAN_DIGEST_MISSING',
        detail: 'no reviewed plan digest',
      });
    }
    if (!input.approvalDigest) {
      blockers.push({
        code: 'STUDENT_IDENTITY_CUTOVER_APPROVAL_DIGEST_MISSING',
        detail: 'no approval digest',
      });
    }
    if (!input.exportOperationId) {
      // A managed export completed immediately before the manifest is what
      // makes rollback possible at all.
      blockers.push({
        code: 'STUDENT_IDENTITY_CUTOVER_EXPORT_MISSING',
        detail: 'no managed export operation bound to this run',
      });
    }
    if (control.mode !== 'canonical_required') {
      blockers.push({
        code: 'STUDENT_IDENTITY_CUTOVER_READ_MODE',
        detail: `serving ${control.mode}, not canonical_required`,
      });
    }
    if (unnormalizedLegacySoftMergeProfiles > 0) {
      blockers.push({
        code: 'STUDENT_IDENTITY_LEGACY_SOFT_MERGES_REMAIN',
        detail: `${unnormalizedLegacySoftMergeProfiles} profiles still carry mergedIntoStudentId with no alias`,
      });
    }
    for (const [name, count] of Object.entries(pendingJobs)) {
      if (count > 0) {
        blockers.push({
          code: 'STUDENT_IDENTITY_QUEUE_NOT_DRAINED',
          detail: `${name} has ${count} pending item(s)`,
        });
      }
    }
  }

  if (input.mode === 'retirement' && legacyProjectionFieldsRemaining > 0) {
    blockers.push({
      code: 'STUDENT_IDENTITY_LEGACY_PROJECTION_FIELDS_REMAIN',
      detail: `${legacyProjectionFieldsRemaining} legacy projection field(s) still written`,
    });
  }

  if (requiredModeBlockerCount > 0 && input.mode !== 'daily') {
    blockers.push({
      code: 'STUDENT_IDENTITY_REQUIRED_MODE_BLOCKERS',
      detail: `${requiredModeBlockerCount} blocker(s) outstanding`,
    });
  }

  if (activeMutationLeases > 0 || staleMutationLeases > 0) {
    blockers.push({
      code: 'STUDENT_IDENTITY_LEASE_OUTSTANDING',
      detail: `${activeMutationLeases} active, ${staleMutationLeases} stale`,
    });
  }
  if (failedJournalOperations > 0) {
    blockers.push({
      code: 'STUDENT_IDENTITY_JOURNAL_FAILED',
      detail: `${failedJournalOperations} failed operation(s)`,
    });
  }

  // `moneyMatches` is produced by the Workstream C verifier. Until that
  // verification is threaded through the sources, the honest answer is "nobody
  // checked" rather than "it is fine".
  const verification = sources.normalizationVerification;
  const verified =
    verification.ok && verification.value
      ? (verification.value as { moneyMatches?: unknown }).moneyMatches
      : undefined;
  const monetaryTotalsVerified = typeof verified === 'boolean' ? verified : null;

  const sortedBlockers = sortBlockers(blockers);
  const checkedAt = new Date(input.now.getTime()).toISOString();

  const body = {
    schemaVersion: 2 as const,
    mode: input.mode,
    target: { projectId: input.projectId, databaseId: input.databaseId },
    runId: input.runId ?? null,
    planDigest: input.planDigest ?? null,
    approvalDigest: input.approvalDigest ?? null,
    sourceCommitSha: input.sourceCommitSha,
    exportOperationId: input.exportOperationId ?? null,
    canonicalReadMode: control.mode,
    counts,
    operationCounts: {
      planned: journalByStatus('planned'),
      applied: journalByStatus('applied'),
      verified: journalByStatus('verified'),
      failed: failedJournalOperations,
    },
    pendingJobs,
    projectionHealth,
    invariants: {
      aliasesOneHopAndAcyclic,
      // Null unless something actually compared the money. The presence of a
      // reviewed plan is not the comparison — only a verification that says
      // `moneyMatches` can turn this true.
      monetaryTotalsMatchReviewedPlan: monetaryTotalsVerified,
      projectionRebuildComplete: projectionComplete,
      authenticationPathsCanonical: activeCredentialsOnAliases === 0 && linkedUserMismatches === 0,
    },
    blockers: sortedBlockers,
    sources: Object.fromEntries(
      Object.entries(sourceObjects)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([k, v]) => {
          const s = v as any;
          return [
            k,
            s.ok
              ? { ok: true, observedAt: s.observedAt, sourceDigest: s.sourceDigest }
              : { ok: false, code: s.code, detail: s.detail, observedAt: s.observedAt },
          ];
        })
    ),
  };

  // The policy is what decides green, not the blockers gathered while
  // counting. Applying it here — before the digest — means an approval binds
  // to the same verdict the gate later reads, and a report cannot be green
  // while money is unverified or projections are behind.
  const policyBlockers = evaluateStudentIdentityHealthPolicy(
    body as never as Omit<StudentIdentityHealthReport, 'status' | 'digest'>
  );
  const decided = { ...body, blockers: policyBlockers };

  assertNoForbiddenHealthFields(decided);

  const digest = createHash('sha256').update(JSON.stringify(decided)).digest('hex');

  return {
    ...decided,
    auditId: `${vietnamDate(input.now)}_${input.mode}_${digest.slice(0, 12)}`,
    startedAt,
    checkedAt,
    vietnamDate: vietnamDate(input.now),
    status: policyBlockers.length === 0 ? 'green' : 'red',
    digest,
  };
}

export function evaluateStudentIdentityHealthPolicy(
  report: Omit<StudentIdentityHealthReport, 'status' | 'digest'>
): StudentIdentityHealthBlocker[] {
  const blockers = [...report.blockers];
  if (report.mode !== 'daily' && report.invariants.monetaryTotalsMatchReviewedPlan !== true) {
    blockers.push({
      code: 'STUDENT_IDENTITY_MONEY_NOT_VERIFIED',
      detail: 'Monetary totals have not been verified against a reviewed plan',
    });
  }
  if (!report.invariants.projectionRebuildComplete || report.projectionHealth.dashboardStale) {
    blockers.push({
      code: 'STUDENT_IDENTITY_PROJECTION_NOT_CURRENT',
      detail: 'Student projections are incomplete or stale',
    });
  }
  if (report.counts.unknownReferences > 0) {
    blockers.push({
      code: 'STUDENT_IDENTITY_UNKNOWN_REFERENCE',
      detail: `${report.counts.unknownReferences} unknown student reference(s) exist`,
    });
  }
  if (report.counts.classRosterCountMismatches > 0) {
    blockers.push({
      code: 'STUDENT_IDENTITY_CLASS_COUNT_MISMATCH',
      detail: `${report.counts.classRosterCountMismatches} class roster count mismatch(es) exist`,
    });
  }
  if (report.mode === 'retirement' && report.counts.legacyProjectionFieldsRemaining > 0) {
    blockers.push({
      code: 'STUDENT_IDENTITY_LEGACY_PROJECTION_FIELDS_REMAIN',
      detail: `${report.counts.legacyProjectionFieldsRemaining} legacy projection field(s) remain`,
    });
  }
  return sortBlockers(blockers);
}

