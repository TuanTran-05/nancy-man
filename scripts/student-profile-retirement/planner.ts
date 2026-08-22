import { createHash } from 'node:crypto';
import {
  isStudentProfileAlias,
  isStudentProfileTombstone,
} from '../../shared/studentIdentity.js';
import {
  LEGACY_PROJECTION_FIELDS,
  type LegacyStudentRetirementBlocker,
  type LegacyStudentRetirementCandidate,
  type LegacyStudentRetirementOperation,
  type LegacyStudentRetirementPlan,
} from './types.js';

/**
 * Decides what may be deleted, and refuses far more often than it agrees.
 *
 * Two separable jobs live here, and the plan needs both:
 *
 * - **Per-candidate eligibility.** A retired profile may be deleted only once
 *   nothing points at it, nobody can log in as it, it holds no money, and it
 *   has been retired long enough that a problem would have surfaced.
 * - **A center-wide field sweep.** Every canonical profile and every linked
 *   student or parent account gets a removal operation for the three legacy
 *   compatibility fields — not only the profiles caught up in a merge. The
 *   fields are a global compatibility layer, and leaving them on the
 *   untouched majority would mean retirement never actually finished.
 *
 * The 30-day rule and the green streak count Vietnam calendar days, because
 * that is when the center is open and when somebody would notice.
 */

export type PlannerSource = { id: string; data: Record<string, unknown> };

export type PlanLegacyRetirementInput = {
  runId: string;
  generatedAt: string;
  target: { projectId: string; databaseId: string };
  sourceCommitSha: string;
  exportOperationId: string;
  latestHealthAuditId: string;
  /** Exactly seven consecutive green daily audit ids, newest last. */
  dailyGreenAuditIds: readonly string[];
  dailyAuditMissingDates: readonly string[];
  students: readonly PlannerSource[];
  aliases: readonly PlannerSource[];
  credentials: readonly PlannerSource[];
  linkedUsers: readonly PlannerSource[];
  /** Every remaining reference to a legacy profile id, from the C inventory. */
  remainingReferences: ReadonlyMap<string, number>;
  unknownReferenceCount: number;
  journalPendingCount: number;
  journalFailedCount: number;
  openRollbackInvestigations: number;
  maintenanceMode: string;
  maintenanceRunId: string | null;
  maintenanceActorId: string | null;
  actorId: string;
  canonicalReadMode: string;
  /** From the AST architecture scan, never from inspection. */
  unconvertedLegacyFieldReaders: readonly string[];
  now: Date;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Vietnam calendar date, which is what "a day" means for this center. */
function vietnamDate(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function calendarDaysBetween(from: Date, to: Date): number {
  const start = Date.parse(`${vietnamDate(from)}T00:00:00.000Z`);
  const end = Date.parse(`${vietnamDate(to)}T00:00:00.000Z`);
  return Math.floor((end - start) / (24 * 60 * 60 * 1000));
}

/**
 * A credential fingerprint that carries no credential.
 *
 * The plan is written to disk and reviewed by a person. Hashing the field
 * *names* rather than the values proves the document was the one inspected
 * without putting a salt or a hash anywhere it could be copied out.
 */
function nonSecretCredentialFingerprint(data: Record<string, unknown>): string {
  return fingerprint(Object.keys(data).sort());
}

export function planLegacyStudentRetirement(
  input: PlanLegacyRetirementInput
): LegacyStudentRetirementPlan {
  const blockers: LegacyStudentRetirementBlocker[] = [];

  // --- center-wide gates ---------------------------------------------------
  if (input.canonicalReadMode !== 'canonical_required') {
    blockers.push({
      code: 'READ_MODE_NOT_CANONICAL_REQUIRED',
      detail: `serving ${input.canonicalReadMode}`,
    });
  }
  if (input.maintenanceMode !== 'read_only') {
    blockers.push({
      code: 'MAINTENANCE_NOT_READ_ONLY',
      detail: `maintenance is ${input.maintenanceMode}`,
    });
  }
  if (input.maintenanceRunId !== input.runId || input.maintenanceActorId !== input.actorId) {
    blockers.push({
      code: 'RUN_OR_ACTOR_MISMATCH',
      detail: `window holds ${input.maintenanceRunId ?? 'no run'} for ${
        input.maintenanceActorId ?? 'nobody'
      }`,
    });
  }
  if (input.dailyGreenAuditIds.length < 7) {
    blockers.push({
      code: 'GREEN_DAILY_AUDIT_STREAK_LT_7',
      detail: `${input.dailyGreenAuditIds.length} green daily audit(s)`,
    });
  }
  if (input.dailyAuditMissingDates.length > 0) {
    // A missing day is a day nobody checked, which is not evidence that
    // anything was healthy.
    blockers.push({
      code: 'DAILY_AUDIT_GAP',
      detail: `no daily audit for ${input.dailyAuditMissingDates.join(', ')}`,
    });
  }
  if (input.journalPendingCount > 0 || input.journalFailedCount > 0) {
    blockers.push({
      code: 'PENDING_OR_FAILED_JOURNAL',
      detail: `${input.journalPendingCount} pending, ${input.journalFailedCount} failed`,
    });
  }
  if (input.openRollbackInvestigations > 0) {
    blockers.push({
      code: 'ROLLBACK_INVESTIGATION_OPEN',
      detail: `${input.openRollbackInvestigations} open investigation(s)`,
    });
  }
  if (input.unknownReferenceCount > 0) {
    blockers.push({
      code: 'UNKNOWN_REFERENCE',
      detail: `${input.unknownReferenceCount} reference(s) the registry does not describe`,
    });
  }
  for (const reader of input.unconvertedLegacyFieldReaders) {
    // Evaluated against the architecture scan rather than by inspection.
    // `users.classId` is the dangerous one: its readers fail silently, so a
    // missed conversion produces no error at all.
    blockers.push({
      code: 'LEGACY_FIELD_READER_NOT_CONVERTED',
      detail: reader,
    });
  }

  const aliasByLegacyId = new Map(
    input.aliases
      .filter((doc) => isStudentProfileAlias(doc.data))
      .map((doc) => [doc.id, text(doc.data.canonicalProfileId)])
  );
  const credentialsById = new Map(input.credentials.map((doc) => [doc.id, doc.data]));
  const linkedByStudentId = new Map<string, string[]>();
  const linkedByLoginPath = new Map<string, string[]>();
  for (const doc of input.linkedUsers) {
    const studentId = text(doc.data.studentId);
    if (studentId) {
      linkedByStudentId.set(studentId, [...(linkedByStudentId.get(studentId) ?? []), doc.id]);
    }
    const loginPath = text(doc.data.loginPath);
    if (loginPath) {
      linkedByLoginPath.set(loginPath, [...(linkedByLoginPath.get(loginPath) ?? []), doc.id]);
    }
  }

  // A soft merge with no alias cannot be retired: its old links would stop
  // resolving the moment the document went away.
  for (const doc of input.students) {
    if (text(doc.data.mergedIntoStudentId) && !aliasByLegacyId.has(doc.id)) {
      blockers.push({
        code: 'UNNORMALIZED_LEGACY_SOFT_MERGE',
        documentId: doc.id,
        detail: 'carries mergedIntoStudentId with no alias',
      });
    }
  }

  // --- per-candidate eligibility ------------------------------------------
  const candidates: LegacyStudentRetirementCandidate[] = [];
  // Anything *claiming* to be a tombstone is a candidate, valid or not. A
  // half-written retirement record — say one whose wallet ownership was never
  // canonicalized — would otherwise be invisible here: not a live profile, not
  // a candidate, and never reported. Silently skipped is the one outcome this
  // planner must not produce.
  const tombstones = input.students.filter(
    (doc) => text(doc.data.studentProfileState) === 'merged_tombstone'
  );

  for (const doc of [...tombstones].sort((left, right) => left.id.localeCompare(right.id))) {
    const candidateBlockers: LegacyStudentRetirementBlocker[] = [];
    const canonicalProfileId = text(doc.data.canonicalProfileId);
    const mergedAt = text(doc.data.mergedAt);
    const ageInDays = mergedAt ? calendarDaysBetween(new Date(mergedAt), input.now) : -1;

    if (ageInDays < 30) {
      candidateBlockers.push({
        code: 'AGE_LT_30_CALENDAR_DAYS',
        documentId: doc.id,
        detail: `${ageInDays} calendar day(s) since the merge`,
      });
    }

    const aliasTarget = aliasByLegacyId.get(doc.id);
    if (!aliasTarget) {
      candidateBlockers.push({
        code: 'ALIAS_MISSING',
        documentId: doc.id,
        detail: 'no alias would keep old links resolving after deletion',
      });
    } else if (aliasTarget !== canonicalProfileId) {
      candidateBlockers.push({
        code: 'ALIAS_INVALID',
        documentId: doc.id,
        detail: `alias points at ${aliasTarget}, tombstone names ${canonicalProfileId}`,
      });
    }

    const remaining = input.remainingReferences.get(doc.id) ?? 0;
    if (remaining > 0) {
      candidateBlockers.push({
        code: 'REFERENCE_REMAINS',
        documentId: doc.id,
        detail: `${remaining} mutable reference(s) still name this id`,
      });
    }

    const linked = linkedByStudentId.get(doc.id) ?? [];
    if (linked.length > 0) {
      candidateBlockers.push({
        code: 'ACTIVE_LINKED_USER',
        documentId: doc.id,
        detail: `${linked.length} account(s) still linked`,
      });
    }

    const credential = credentialsById.get(doc.id);
    if (credential && Object.keys(credential).length > 0) {
      const isRetiredTombstone = text(credential.credentialState) === 'retired_tombstone';
      const isInactive = credential.active === false;
      const canonicalMatch = text(credential.canonicalProfileId) === canonicalProfileId;
      const mergeMatch = text(credential.mergeRunId) === text(doc.data.mergeRunId);
      const disabledAt = text(credential.disabledAt);
      const disabledAgeInDays = disabledAt ? calendarDaysBetween(new Date(disabledAt), input.now) : -1;
      const loginPathUsed = (linkedByLoginPath.get(doc.id) ?? []).length > 0;

      if (
        !isRetiredTombstone ||
        !isInactive ||
        !canonicalMatch ||
        !mergeMatch ||
        loginPathUsed ||
        disabledAgeInDays < 30
      ) {
        candidateBlockers.push({
          code: 'ACTIVE_CREDENTIAL',
          documentId: doc.id,
          detail: 'a live credential would be deleted without being moved',
        });
      }
    }

    const wallet = Number(doc.data.walletBalance ?? 0);
    if (Number.isFinite(wallet) && wallet !== 0) {
      candidateBlockers.push({
        code: 'NONZERO_WALLET_OWNERSHIP',
        documentId: doc.id,
        detail: 'money is still attributed to this document',
      });
    }
    if (!isStudentProfileTombstone(doc.data)) {
      candidateBlockers.push({
        code: 'SOURCE_DRIFT',
        documentId: doc.id,
        detail: 'claims to be a tombstone but is not a well-formed one',
      });
    }
    if (text(doc.data.walletOwnership) !== 'canonicalized') {
      candidateBlockers.push({
        code: 'NONZERO_WALLET_OWNERSHIP',
        documentId: doc.id,
        detail: 'wallet ownership was never marked canonicalized',
      });
    }

    candidates.push({
      legacyProfileId: doc.id,
      canonicalProfileId,
      mergeRunId: text(doc.data.mergeRunId),
      mergedAt,
      ageInDays,
      eligible: candidateBlockers.length === 0,
      blockers: candidateBlockers,
    });
  }

  // --- operations ----------------------------------------------------------
  const operations: LegacyStudentRetirementOperation[] = [];
  const centerWideBlocked = blockers.length > 0;

  for (const candidate of candidates) {
    if (!candidate.eligible || centerWideBlocked) continue;
    const doc = tombstones.find((entry) => entry.id === candidate.legacyProfileId)!;
    operations.push({
      kind: 'delete_profile_tombstone',
      documentId: candidate.legacyProfileId,
      beforeFingerprint: fingerprint(doc.data),
    });
    const credential = credentialsById.get(candidate.legacyProfileId);
    if (credential) {
      operations.push({
        kind: 'delete_credential_tombstone',
        documentId: candidate.legacyProfileId,
        nonSecretFingerprint: nonSecretCredentialFingerprint(credential),
      });
    }
  }

  // The field sweep covers everyone, not only merged profiles. These fields
  // are a center-wide compatibility layer; leaving them on the untouched
  // majority would mean retirement never finished.
  if (!centerWideBlocked) {
    const liveProfiles = input.students.filter((doc) => !isStudentProfileTombstone(doc.data));
    for (const doc of [...liveProfiles].sort((left, right) => left.id.localeCompare(right.id))) {
      if (!LEGACY_PROJECTION_FIELDS.some((field) => text(doc.data[field]) !== '')) continue;
      operations.push({
        kind: 'remove_legacy_profile_projection_fields',
        canonicalProfileId: doc.id,
        fields: LEGACY_PROJECTION_FIELDS,
        beforeFingerprint: fingerprint(doc.data),
      });
    }
    for (const doc of [...input.linkedUsers].sort((left, right) => left.id.localeCompare(right.id))) {
      if (!LEGACY_PROJECTION_FIELDS.some((field) => text(doc.data[field]) !== '')) continue;
      operations.push({
        kind: 'remove_legacy_linked_user_projection_fields',
        userDocumentId: doc.id,
        fields: LEGACY_PROJECTION_FIELDS,
        beforeFingerprint: fingerprint(doc.data),
      });
    }
  }

  return {
    schemaVersion: 1,
    migrationId: 'legacy-student-profile-retirement-v1',
    runId: input.runId,
    generatedAt: input.generatedAt,
    target: input.target,
    sourceCommitSha: input.sourceCommitSha,
    exportOperationId: input.exportOperationId,
    latestHealthAuditId: input.latestHealthAuditId,
    dailyGreenAuditIds: [...input.dailyGreenAuditIds],
    // Approval is a separate artifact from a different command and a different
    // person; a plan that could approve itself makes the review a formality.
    approved: false,
    candidates,
    blockers: [...blockers].sort((left, right) =>
      `${left.code}|${left.documentId ?? ''}`.localeCompare(`${right.code}|${right.documentId ?? ''}`)
    ),
    operations,
  };
}
