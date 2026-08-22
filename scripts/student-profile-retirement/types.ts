/**
 * The contracts for deleting data that cannot be brought back.
 *
 * Retirement is the only irreversible step in the program. Everything before
 * it can be rolled back from an export; a deleted tombstone and a deleted
 * credential are gone. So the plan is a document a human approves, the
 * blockers are exhaustive, and nothing is inferred at apply time that was not
 * already written down and reviewed.
 */

export const STUDENT_PROFILE_RETIREMENT_STAGES = [
  'scan_center_legacy_fields',
  'remove_center_legacy_fields',
  'remove_runtime_fallbacks',
  'verify_retirement',
] as const;

export type LegacyStudentRetirementReviewedFile = {
  planDigest: string;
  approvalDigest: string;
  auditPhase: string;
  /**
   * Exactly which operations the reviewers approved.
   *
   * Without it a reviewed plan authorises a digest and an approval signature
   * but nothing in particular, and any operation presented alongside it
   * inherits that authority. Deletion is the one step that cannot be undone,
   * so the manifest has to name what it is permitting.
   */
  operationIds?: readonly string[];
  approvals: {
    identity_technical: string;
    finance: string;
    auth_security?: string;
  };
};

export type LegacyStudentRetirementBlockerCode =
  | 'AGE_LT_30_CALENDAR_DAYS'
  | 'GREEN_DAILY_AUDIT_STREAK_LT_7'
  | 'DAILY_AUDIT_GAP'
  | 'ALIAS_MISSING'
  | 'ALIAS_INVALID'
  | 'REFERENCE_REMAINS'
  | 'UNKNOWN_REFERENCE'
  | 'ACTIVE_LINKED_USER'
  | 'ACTIVE_CREDENTIAL'
  | 'NONZERO_WALLET_OWNERSHIP'
  | 'ROLLBACK_INVESTIGATION_OPEN'
  | 'PENDING_OR_FAILED_JOURNAL'
  | 'MAINTENANCE_NOT_READ_ONLY'
  | 'RUN_OR_ACTOR_MISMATCH'
  | 'SOURCE_DRIFT'
  | 'LEGACY_PROJECTION_FIELDS_REMAIN'
  | 'LEGACY_FIELD_READER_NOT_CONVERTED'
  | 'UNNORMALIZED_LEGACY_SOFT_MERGE'
  | 'READ_MODE_NOT_CANONICAL_REQUIRED';

export type LegacyStudentRetirementBlocker = {
  code: LegacyStudentRetirementBlockerCode;
  /** Absent for center-wide blockers that belong to no single candidate. */
  documentId?: string;
  detail: string;
};

/** The three compatibility fields retirement removes, in a fixed order. */
export const LEGACY_PROJECTION_FIELDS = ['classId', 'teacherId', 'enrollmentStatus'] as const;

export type LegacyStudentRetirementOperation =
  | { kind: 'delete_profile_tombstone'; documentId: string; beforeFingerprint: string }
  | { kind: 'delete_credential_tombstone'; documentId: string; nonSecretFingerprint: string }
  | {
      kind: 'remove_legacy_profile_projection_fields';
      canonicalProfileId: string;
      fields: typeof LEGACY_PROJECTION_FIELDS;
      beforeFingerprint: string;
    }
  | {
      kind: 'remove_legacy_linked_user_projection_fields';
      userDocumentId: string;
      fields: typeof LEGACY_PROJECTION_FIELDS;
      beforeFingerprint: string;
    };

export type LegacyStudentRetirementCandidate = {
  legacyProfileId: string;
  canonicalProfileId: string;
  mergeRunId: string;
  mergedAt: string;
  /** Vietnam calendar days since the merge, which is what the 30-day rule counts. */
  ageInDays: number;
  eligible: boolean;
  blockers: LegacyStudentRetirementBlocker[];
};

export type LegacyStudentRetirementPlan = {
  schemaVersion: 1;
  migrationId: 'legacy-student-profile-retirement-v1';
  runId: string;
  generatedAt: string;
  target: { projectId: string; databaseId: string };
  sourceCommitSha: string;
  exportOperationId: string;
  latestHealthAuditId: string;
  dailyGreenAuditIds: string[];
  /**
   * Always false in a generated plan. Approval is a separate artifact produced
   * by a different command and a different person; a plan that could mark
   * itself approved would make the review a formality.
   */
  approved: false;
  candidates: LegacyStudentRetirementCandidate[];
  blockers: LegacyStudentRetirementBlocker[];
  operations: LegacyStudentRetirementOperation[];
};

/**
 * Collections retirement must never touch.
 *
 * Aliases and code reservations are how an old receipt still resolves to the
 * right child years later. Runs, journals, and audit evidence are the record
 * that any of this was reviewed at all. Deleting them would leave a center
 * that cannot explain its own history.
 */
export const RETIREMENT_PRESERVED_COLLECTIONS = [
  'student_profile_aliases',
  'student_code_registry',
  'student_profile_merge_runs',
  'student_profile_merge_journal',
  'student_identity_health_runs',
  'student_identity_health',
  'student_identity_release_proofs',
] as const;
