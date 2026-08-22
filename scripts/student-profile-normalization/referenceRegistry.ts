import { buildCourseLedgerId } from '../../server/api/lib/accounting/courseLedgerIdentity.js';
import { makeStudentCourseEnrollmentId } from '../../shared/studentCourseEnrollment.js';
import { courseClosingRecordId } from '../../shared/courseClosingRecords.js';
import type { StudentReferenceSpec } from './types.js';

/**
 * The typed student reference registry.
 *
 * Every entry here traces to one of two kinds of evidence, and each entry's
 * comment says which:
 *
 * - **Observed**: the Phase 0 production discovery run
 *   (`scratch/discovery-2026-08-06-post-backfill`) found a real match for one
 *   of the 58 legacy soft-merge ids in this collection, at these field paths.
 * - **Code-evidenced but unobserved**: the collection was empty at scan time
 *   — five of six because the 2026-08-05 `wipe_finance_data_for_rebuild`
 *   migration had just cleared it, one (`student_progression_events`) because
 *   Workstream A has not shipped yet — but an active writer in the current
 *   codebase proves the shape and field name. Registering only observed
 *   collections would silently drop the entire finance surface the moment
 *   real receipts exist again, most likely inside a maintenance window.
 *
 * Version `student-references-v1` is immutable once a reviewed normalization
 * plan is produced from it. Workstream D extends it as
 * `student-references-v2-retirement` rather than mutating v1's meaning for an
 * existing run.
 */
export const STUDENT_REFERENCE_REGISTRY_VERSION = 'student-references-v1';

export type StudentReferenceFreeCollection = {
  collectionPath: string;
  reasonCode:
    | 'no_studentId_field_confirmed_by_rules_and_schema'
    | 'unrelated_feature_currently_empty'
    | 'no_known_writer_requires_investigation'
    | 'internal_infrastructure_no_business_data'
    | 'staff_only_no_student_linkage';
  evidence: string;
};

/**
 * Collections deliberately classified as holding no student reference, with
 * the evidence that justifies the classification. `background_jobs` is
 * listed here but its reason code says the classification is unresolved: it
 * has two documents in production, no writer anywhere in this repository,
 * and a job-log shape (`jobName/status/details/startedAt/finishedAt`) whose
 * `details` field is untyped and could hold anything. Zero matches against
 * the current 58-id candidate set is evidence about this run only; it is not
 * proof the collection can never reference a student. It must be traced to
 * an owner (a Cloud Function deployed outside this repository, most likely)
 * before it can move to a confident reason code.
 */
export const STUDENT_REFERENCE_FREE_COLLECTIONS: readonly StudentReferenceFreeCollection[] = [
  {
    collectionPath: 'staff_account_requests',
    reasonCode: 'staff_only_no_student_linkage',
    evidence:
      'documentStore.rules restricts to admin-only with no studentId ownership check; documents carry name/phone/role/status — staff onboarding, not student data.',
  },
  {
    collectionPath: 'conversations',
    reasonCode: 'unrelated_feature_currently_empty',
    evidence:
      'scripts/delete-conversations.mjs is the only repository reference; an AI-chat log feature unrelated to student identity. Zero documents in production.',
  },
  {
    collectionPath: 'background_jobs',
    reasonCode: 'no_known_writer_requires_investigation',
    evidence:
      'Two production documents (jobName/status/details/startedAt/finishedAt/createdAt); no writer found anywhere in this repository. Zero matches against the current candidate set, which is evidence for this run only. Requires owner investigation before a confident classification.',
  },
  {
    collectionPath: '_maintenance',
    reasonCode: 'internal_infrastructure_no_business_data',
    evidence:
      'Existing documents are notificationDigest_*, schemaMigrationFramework, and auditLogCleanup markers — operational bookkeeping, not student data. Workstream A adds student_identity and student_identity_read_model documents to this same collection; those are covered by their own dedicated identity/maintenance code paths, not this registry.',
  },
  {
    collectionPath: '_rate_limits',
    reasonCode: 'internal_infrastructure_no_business_data',
    evidence: 'Rate-limit bookkeeping keyed by request signature, not student identity.',
  },
  {
    collectionPath: '_counters',
    reasonCode: 'internal_infrastructure_no_business_data',
    evidence: 'Sequence counters for code generation; values are integers, not references.',
  },
  {
    collectionPath: '_schema_migrations',
    reasonCode: 'internal_infrastructure_no_business_data',
    evidence: 'Migration-runner version bookkeeping (docs/migrations.md); no student fields.',
  },
  {
    collectionPath: '_zalo_config',
    reasonCode: 'internal_infrastructure_no_business_data',
    evidence: 'Zalo integration configuration singleton; no student fields.',
  },
  {
    collectionPath: 'system_settings',
    reasonCode: 'internal_infrastructure_no_business_data',
    evidence: 'Center-wide configuration singleton; no student fields.',
  },
  {
    collectionPath: 'config',
    reasonCode: 'internal_infrastructure_no_business_data',
    evidence: 'Application configuration singleton; no student fields.',
  },
  {
    collectionPath: 'read_models',
    reasonCode: 'internal_infrastructure_no_business_data',
    evidence:
      'Rebuildable aggregate projections (e.g. dashboard_global) keyed by model id, not student id; derived entirely from canonical sources and requires no reference rewrite.',
  },
  {
    collectionPath: 'accounting_student_summary_health',
    reasonCode: 'internal_infrastructure_no_business_data',
    evidence: 'Singleton health counters, not per-student records.',
  },
  {
    collectionPath: 'finance_monthly_aggregates',
    reasonCode: 'internal_infrastructure_no_business_data',
    evidence: 'Center-wide monthly rollups keyed by month, not by student.',
  },
  {
    collectionPath: 'allowed_teachers',
    reasonCode: 'staff_only_no_student_linkage',
    evidence: 'Teacher allowlist by email; no student fields.',
  },
  {
    collectionPath: 'teacher_availability_profiles',
    reasonCode: 'staff_only_no_student_linkage',
    evidence: 'Teacher scheduling data; no student fields.',
  },
  {
    collectionPath: 'knowledge_bank',
    reasonCode: 'unrelated_feature_currently_empty',
    evidence: 'Shared teaching material library, not owned by any student.',
  },
  {
    collectionPath: 'class_sessions',
    reasonCode: 'unrelated_feature_currently_empty',
    evidence: 'Class-level scheduling records keyed by classId; attendance (the student-linked record) is the separate collection already registered.',
  },
  {
    collectionPath: 'realtime_events',
    reasonCode: 'internal_infrastructure_no_business_data',
    evidence: 'Realtime delta broadcast queue; payloads are ephemeral and consumed within seconds, never a durable student reference.',
  },
  {
    collectionPath: 'classes',
    reasonCode: 'unrelated_feature_currently_empty',
    evidence: 'Class documents reference teacherId, not studentId; class membership is owned by student_course_enrollments.',
  },
  {
    collectionPath: 'job_runs',
    reasonCode: 'internal_infrastructure_no_business_data',
    evidence: 'Scheduled-job execution log keyed by job name, not student id.',
  },
  {
    collectionPath: '_payment_locks',
    reasonCode: 'internal_infrastructure_no_business_data',
    evidence:
      'Currently empty (cleared by the finance wipe); when populated it locks by ledger operation, covered by the finance_idempotency_keys registry entry pattern rather than being a separate student reference.',
  },
  {
    collectionPath: 'finance_idempotency_keys',
    reasonCode: 'internal_infrastructure_no_business_data',
    evidence: 'Currently empty; idempotency keys are opaque operation hashes, not student references.',
  },
] as const;

const NOT_APPLICABLE_COLLISION_ID = 'collision.not_applicable';

function directFieldEntry(input: {
  id: string;
  collectionPath: string;
  fieldPaths: readonly string[];
  containsMoney?: boolean;
  collisionKind?: StudentReferenceSpec['collisionKind'];
}): StudentReferenceSpec {
  return {
    id: input.id,
    collectionPath: input.collectionPath,
    kind: 'direct_field',
    rewriteKind: 'patch_field',
    collisionKind: input.collisionKind ?? 'not_applicable',
    rollbackKind: 'reverse_patch',
    containsMoney: input.containsMoney ?? false,
    mayRetainLegacyId: false,
    fieldPaths: input.fieldPaths,
    pathMatcherId: `path.${input.collectionPath}`,
    fieldMatcherId: `field.${input.id}`,
    stateMatcherId: `state.${input.id}.any`,
    rewriteStrategyId: `rewrite.patch_field.${input.id}`,
    targetPathBuilderId: 'target.unchanged_path',
    collisionComparatorId: NOT_APPLICABLE_COLLISION_ID,
    verificationId: `verify.field_patched.${input.id}`,
    rollbackStrategyId: `rollback.reverse_patch.${input.id}`,
  };
}

export const STUDENT_REFERENCE_REGISTRY: readonly StudentReferenceSpec[] = [
  // --- Profile ---
  // Observed: students/{58 legacy ids} matched on __documentId__, plus
  // faceImage/faceImageStoragePath on unrelated canonical profiles whose
  // Cloud Storage path embeds a legacy id.
  {
    id: 'students.profile',
    collectionPath: 'students',
    kind: 'profile_owned',
    rewriteKind: 'patch_field',
    collisionKind: 'not_applicable',
    rollbackKind: 'reverse_patch',
    containsMoney: false,
    mayRetainLegacyId: true,
    // `mergedIntoStudentId` is the old promotion path's soft-merge pointer —
    // the very thing this run exists to replace — and `id`, `archiveReason`
    // and `statusNote` are where that promotion recorded itself, the last two
    // as prose containing the id. All four are observed on the 58 production
    // pointer profiles.
    //
    // Listing them changes nothing about what happens to a profile: this entry
    // may retain the legacy id, so the generic rewrite never touches it. The
    // profile is written by its own reconcile and tombstone stages, which is
    // where a decision about a merged profile belongs.
    fieldPaths: ['legacyProfileIds', 'mergedIntoStudentId', 'id', 'archiveReason', 'statusNote'],
    pathMatcherId: 'path.students',
    fieldMatcherId: 'field.students.profile',
    stateMatcherId: 'state.students.profile.any',
    rewriteStrategyId: 'rewrite.reconcile_profile',
    targetPathBuilderId: 'target.unchanged_path',
    collisionComparatorId: NOT_APPLICABLE_COLLISION_ID,
    verificationId: 'verify.profile_reconciled',
    rollbackStrategyId: 'rollback.reverse_patch.students_profile',
  },
  {
    id: 'students.faceImage',
    collectionPath: 'students',
    kind: 'nested_payload',
    rewriteKind: 'preserve_via_alias',
    collisionKind: 'not_applicable',
    rollbackKind: 'preserve_immutable',
    containsMoney: false,
    mayRetainLegacyId: true,
    fieldPaths: ['faceImage', 'faceImageStoragePath'],
    pathMatcherId: 'path.students',
    fieldMatcherId: 'field.students.faceImage',
    stateMatcherId: 'state.students.faceImage.any',
    rewriteStrategyId: 'rewrite.retain_and_fingerprint',
    targetPathBuilderId: 'target.unchanged_path',
    collisionComparatorId: NOT_APPLICABLE_COLLISION_ID,
    verificationId: 'verify.face_image_fingerprinted',
    rollbackStrategyId: 'rollback.preserve_immutable.students_faceImage',
  },

  // --- Academic ---
  directFieldEntry({ id: 'admissions_history.studentId', collectionPath: 'admissions_history', fieldPaths: ['studentId'] }),
  directFieldEntry({ id: 'evaluations.studentId', collectionPath: 'evaluations', fieldPaths: ['studentId'] }),
  directFieldEntry({ id: 'submissions.studentId', collectionPath: 'submissions', fieldPaths: ['studentId'] }),
  directFieldEntry({ id: 'dailyReports.studentId', collectionPath: 'dailyReports', fieldPaths: ['studentId'] }),
  directFieldEntry({
    id: 'assignments.targeting',
    collectionPath: 'assignments',
    fieldPaths: ['targetStudentIds'],
  }),

  {
    id: 'attendance.keyed',
    collectionPath: 'attendance',
    kind: 'keyed_document',
    rewriteKind: 'recreate_document',
    collisionKind: 'semantic_identity_only',
    rollbackKind: 'restore_source_delete_target',
    containsMoney: false,
    mayRetainLegacyId: true,
    fieldPaths: ['studentId'],
    pathMatcherId: 'path.attendance',
    fieldMatcherId: 'field.attendance.studentId',
    stateMatcherId: 'state.attendance.any',
    rewriteStrategyId: 'rewrite.recreate_keyed_document',
    targetPathBuilderId: 'target.attendance_keyed',
    collisionComparatorId: 'collision.attendance_semantic',
    verificationId: 'verify.attendance_moved',
    rollbackStrategyId: 'rollback.restore_source_delete_target.attendance',
  },

  // Observed: course_closing_records/{14 docs} matched on the document id and
  // on evaluationDocument.storagePath / tuitionDocument.storagePath, both
  // Cloud Storage paths that embed the legacy profile id.
  {
    id: 'course_closing_records.keyed',
    collectionPath: 'course_closing_records',
    kind: 'keyed_document',
    rewriteKind: 'recreate_document',
    collisionKind: 'block',
    rollbackKind: 'restore_source_delete_target',
    containsMoney: false,
    mayRetainLegacyId: true,
    // `id` repeats the document key inside the document. Observed on all 15
    // closing records that named a candidate on 2026-08-10.
    fieldPaths: ['studentId', 'id', 'evaluationDocument.storagePath', 'tuitionDocument.storagePath'],
    pathMatcherId: 'path.course_closing_records',
    fieldMatcherId: 'field.course_closing_records.studentId',
    stateMatcherId: 'state.course_closing_records.any',
    rewriteStrategyId: 'rewrite.recreate_keyed_document',
    targetPathBuilderId: 'target.course_closing_record_keyed',
    collisionComparatorId: 'collision.course_closing_record',
    verificationId: 'verify.course_closing_record_moved',
    rollbackStrategyId: 'rollback.restore_source_delete_target.course_closing_records',
  },

  {
    id: 'student_course_enrollments.keyed',
    collectionPath: 'student_course_enrollments',
    kind: 'keyed_document',
    rewriteKind: 'recreate_document',
    collisionKind: 'block',
    rollbackKind: 'restore_source_delete_target',
    containsMoney: false,
    mayRetainLegacyId: false,
    fieldPaths: ['studentId'],
    pathMatcherId: 'path.student_course_enrollments',
    fieldMatcherId: 'field.student_course_enrollments.studentId',
    stateMatcherId: 'state.student_course_enrollments.any',
    rewriteStrategyId: 'rewrite.recreate_keyed_document',
    targetPathBuilderId: 'target.enrollment_keyed',
    collisionComparatorId: 'collision.enrollment_open_uniqueness',
    verificationId: 'verify.enrollment_moved_one_open',
    rollbackStrategyId: 'rollback.restore_source_delete_target.student_course_enrollments',
  },

  // Code-evidenced but unobserved: Workstream A has not shipped, so no
  // production document exists yet. Registered ahead of that ship date
  // because the events this collection will hold are the direct product of
  // the progression service this same program builds.
  {
    id: 'student_progression_events.fields',
    collectionPath: 'student_progression_events',
    kind: 'immutable_audit',
    rewriteKind: 'preserve_via_alias',
    collisionKind: 'not_applicable',
    rollbackKind: 'preserve_immutable',
    containsMoney: false,
    mayRetainLegacyId: true,
    fieldPaths: ['profileId', 'sourceClassId', 'targetClassId'],
    pathMatcherId: 'path.student_progression_events',
    fieldMatcherId: 'field.student_progression_events.any',
    stateMatcherId: 'state.student_progression_events.any',
    rewriteStrategyId: 'rewrite.preserve_immutable_event',
    targetPathBuilderId: 'target.immutable_no_move',
    collisionComparatorId: NOT_APPLICABLE_COLLISION_ID,
    verificationId: 'verify.progression_event_alias_resolvable',
    rollbackStrategyId: 'rollback.preserve_immutable.student_progression_events',
  },

  // Observed: production's actual audit-trail collection is `audit_logs`
  // (not `student_enrollment_migration_journal`, which is a distinct, also
  // observed collection covered separately below). 368 matches, the largest
  // single reference surface — immutable evidence, resolved through alias,
  // never rewritten.
  {
    id: 'audit_logs.fields',
    collectionPath: 'audit_logs',
    kind: 'immutable_audit',
    rewriteKind: 'preserve_via_alias',
    collisionKind: 'not_applicable',
    rollbackKind: 'preserve_immutable',
    containsMoney: false,
    mayRetainLegacyId: true,
    // Measured against production on 2026-08-10, not drafted. The Phase 0 run
    // reported which documents matched but not the paths inside them, so this
    // entry named three fields while the collection writes twelve, and 801
    // audit records were blocked as unregistered. Every path is listed
    // explicitly — the design's rule is that audit_logs is known by exact
    // schema, never by collection name — and none of them is ever rewritten.
    //
    // `metadata.url` and `documentId` are here for the same reason as the
    // rest: the id appears in them, so the registry has to say so. Whether the
    // id is the whole value or part of one is recorded per match by the scan,
    // which is what stops a rewrite touching a composed value.
    fieldPaths: [
      'studentId',
      'entityId',
      'targetId',
      'documentId',
      'userId',
      'metadata.studentId',
      'metadata.studentIds[]',
      'metadata.affectedStudentIds[]',
      'metadata.ledgerIds[]',
      'metadata.plan[].creates[].studentId',
      'metadata.plan[].creates[].ledgerId',
      'metadata.url',
      // Observed in run 7 after the nine manually adjudicated duplicate
      // profiles were removed. This immutable repair log records the before
      // and after values in arrays under `changes`; aliases keep those ids
      // resolvable, so the evidence itself is never edited.
      'changes.enrollmentTermEnd[].studentId',
      'changes.ledgerTermEnd[].id',
      'changes.ledgerTermEnd[].studentId',
    ],
    pathMatcherId: 'path.audit_logs',
    fieldMatcherId: 'field.audit_logs.any',
    stateMatcherId: 'state.audit_logs.any',
    rewriteStrategyId: 'rewrite.preserve_immutable_event',
    targetPathBuilderId: 'target.immutable_no_move',
    collisionComparatorId: NOT_APPLICABLE_COLLISION_ID,
    verificationId: 'verify.audit_log_alias_resolvable',
    rollbackStrategyId: 'rollback.preserve_immutable.audit_logs',
  },

  // Observed: has a direct `studentId` field (confirmed 2026-08-06). Not
  // previously named in any draft of this registry — found only because the
  // registry is derived from the real inventory rather than drafted first.
  // It is the durable journal the safe-enrollment-backfill script
  // (scripts/student-enrollment-backfill/writer.ts) writes; immutable and
  // resolved through alias like audit_logs, never rewritten.
  {
    id: 'student_enrollment_migration_journal.fields',
    collectionPath: 'student_enrollment_migration_journal',
    kind: 'immutable_audit',
    rewriteKind: 'preserve_via_alias',
    collisionKind: 'not_applicable',
    rollbackKind: 'preserve_immutable',
    containsMoney: false,
    mayRetainLegacyId: true,
    fieldPaths: ['studentId', 'documentId'],
    pathMatcherId: 'path.student_enrollment_migration_journal',
    fieldMatcherId: 'field.student_enrollment_migration_journal.any',
    stateMatcherId: 'state.student_enrollment_migration_journal.any',
    rewriteStrategyId: 'rewrite.preserve_immutable_event',
    targetPathBuilderId: 'target.immutable_no_move',
    collisionComparatorId: NOT_APPLICABLE_COLLISION_ID,
    verificationId: 'verify.enrollment_migration_journal_alias_resolvable',
    rollbackStrategyId: 'rollback.preserve_immutable.student_enrollment_migration_journal',
  },

  // --- Finance ---
  {
    id: 'course_fee_ledgers.keyed',
    collectionPath: 'course_fee_ledgers',
    kind: 'keyed_document',
    rewriteKind: 'recreate_document',
    collisionKind: 'block',
    rollbackKind: 'restore_source_delete_target',
    containsMoney: true,
    mayRetainLegacyId: true,
    fieldPaths: ['studentId', 'amount', 'paidTotal', 'discountTotal', 'status'],
    pathMatcherId: 'path.course_fee_ledgers',
    fieldMatcherId: 'field.course_fee_ledgers.studentId',
    stateMatcherId: 'state.course_fee_ledgers.any',
    rewriteStrategyId: 'rewrite.recreate_keyed_document',
    targetPathBuilderId: 'target.course_fee_ledger_keyed',
    collisionComparatorId: 'collision.course_fee_ledger',
    verificationId: 'verify.course_fee_ledger_moved_money_exact',
    rollbackStrategyId: 'rollback.restore_source_delete_target.course_fee_ledgers',
  },

  // Code-evidenced but unobserved: cleared by the 2026-08-05 finance wipe.
  // server/api/finance/handlers/receipts.ts writes studentId and amount.
  // A receipt allocates against one or more ledgers, and a course-fee ledger
  // id is `<studentId>__<courseId>` — so the allocations name the student
  // too. Observed on 26 receipts on 2026-08-10. These are composed values,
  // not bare ids: the scan records that, and the plan refuses to assign a
  // profile id over them rather than replacing a key with half of one.
  directFieldEntry({
    id: 'receipts.studentId',
    collectionPath: 'receipts',
    fieldPaths: ['studentId', 'ledgerId', 'allocations[].ledgerId'],
    containsMoney: true,
  }),
  // server/api/finance/handlers/wallet.ts writes studentId; amounts are
  // per-allocation, so the entry patches ownership and the finance
  // reconciler (Task 7) verifies allocation totals separately.
  directFieldEntry({ id: 'wallet_transactions.studentId', collectionPath: 'wallet_transactions', fieldPaths: ['studentId', 'ledgerId'], containsMoney: true }),
  // server/api/finance/handlers/invoices.ts writes studentId.
  directFieldEntry({ id: 'invoices.studentId', collectionPath: 'invoices', fieldPaths: ['studentId', 'ledgerId'], containsMoney: true }),
  // server/api/payments/payos/handlers/create.ts writes studentId via the
  // authenticated parent context.
  directFieldEntry({ id: 'payment_requests.studentId', collectionPath: 'payment_requests', fieldPaths: ['studentId', 'ledgerId'], containsMoney: true }),
  // server/api/finance/handlers/expenses.ts writes studentId as a
  // beneficiary reference; the expense posting itself is immutable.
  directFieldEntry({ id: 'expenses.studentId', collectionPath: 'expenses', fieldPaths: ['studentId'], containsMoney: true }),
  // server/api/payments/payos/handlers/create.ts writes studentId when the
  // order code is reserved for a specific student's ledger.
  directFieldEntry({ id: 'payment_order_codes.studentId', collectionPath: 'payment_order_codes', fieldPaths: ['studentId'], containsMoney: false }),

  // Observed: accounting_student_summaries/{58 docs}, one summary per legacy
  // profile — the derived projection this population must not keep after
  // normalization.
  {
    id: 'accounting_student_summaries.derived',
    collectionPath: 'accounting_student_summaries',
    kind: 'derived_projection',
    rewriteKind: 'delete_and_rebuild',
    collisionKind: 'not_applicable',
    rollbackKind: 'rebuild_projection',
    containsMoney: true,
    mayRetainLegacyId: false,
    fieldPaths: [],
    pathMatcherId: 'path.accounting_student_summaries',
    fieldMatcherId: 'field.accounting_student_summaries.document_id',
    stateMatcherId: 'state.accounting_student_summaries.any',
    rewriteStrategyId: 'rewrite.delete_legacy_rebuild_canonical',
    targetPathBuilderId: 'target.summary_by_canonical_id',
    collisionComparatorId: NOT_APPLICABLE_COLLISION_ID,
    verificationId: 'verify.summary_rebuilt_one_per_canonical',
    rollbackStrategyId: 'rollback.rebuild_projection.accounting_student_summaries',
  },

  // --- Authentication ---
  {
    id: 'users.field_query',
    collectionPath: 'users',
    kind: 'direct_field',
    rewriteKind: 'patch_field',
    collisionKind: 'not_applicable',
    rollbackKind: 'reverse_patch',
    containsMoney: false,
    mayRetainLegacyId: false,
    fieldPaths: ['studentId'],
    pathMatcherId: 'path.users',
    fieldMatcherId: 'field.users.studentId',
    stateMatcherId: 'state.users.any',
    rewriteStrategyId: 'rewrite.patch_field',
    targetPathBuilderId: 'target.unchanged_path',
    collisionComparatorId: NOT_APPLICABLE_COLLISION_ID,
    verificationId: 'verify.linked_user_ownership_canonical',
    rollbackStrategyId: 'rollback.reverse_patch.users_field_query',
  },
  // Observed: users/student:{legacyId} matched on `uid`, one document — a
  // linked user whose deterministic-id field was repointed without the
  // document itself being renamed.
  {
    id: 'users.deterministic',
    collectionPath: 'users',
    kind: 'deterministic_identity',
    rewriteKind: 'recreate_document',
    collisionKind: 'block',
    rollbackKind: 'restore_source_delete_target',
    containsMoney: false,
    mayRetainLegacyId: false,
    fieldPaths: ['uid'],
    pathMatcherId: 'path.users.deterministic',
    fieldMatcherId: 'field.users.deterministic.uid',
    stateMatcherId: 'state.users.deterministic.any',
    rewriteStrategyId: 'rewrite.recreate_deterministic_user',
    targetPathBuilderId: 'target.deterministic_user_id',
    collisionComparatorId: 'collision.linked_user_deterministic',
    verificationId: 'verify.linked_user_deterministic_id_canonical',
    rollbackStrategyId: 'rollback.restore_source_delete_target.users_deterministic',
  },
  directFieldEntry({ id: 'student_auth_credentials.metadata', collectionPath: 'student_auth_credentials', fieldPaths: [] }),

  // --- Messaging ---
  directFieldEntry({ id: 'notifications.ownership', collectionPath: 'notifications', fieldPaths: ['targetId', 'studentId'] }),
  // Observed: admin_notifications/{22 docs} matched on a nested payload
  // field, not a top-level studentId. The 2026-08-10 audit showed the shape
  // exactly: these are failure digests, and the ids sit in a
  // `sampleFailures` array rather than under `payload`.
  directFieldEntry({
    id: 'admin_notifications.nested_payload',
    collectionPath: 'admin_notifications',
    fieldPaths: ['payload.studentId', 'payload.targetId', 'sampleFailures[].studentId'],
  }),
  directFieldEntry({ id: 'zalo_notifications.ownership', collectionPath: 'zalo_notifications', fieldPaths: ['studentId'] }),
  directFieldEntry({ id: 'zalo_bulk_job_items.nested_payload', collectionPath: 'zalo_bulk_job_items', fieldPaths: ['studentId'] }),

  // --- Jobs ---
  {
    id: 'outbox_jobs.student_linked',
    collectionPath: 'outbox_jobs',
    kind: 'pending_job',
    rewriteKind: 'drain_or_rewrite',
    collisionKind: 'not_applicable',
    rollbackKind: 'reverse_patch',
    containsMoney: false,
    mayRetainLegacyId: false,
    // The receipt-confirmation job carries a whole receipt in its payload, so
    // the student and its ledgers appear nested inside it. Observed on 27
    // pending jobs on 2026-08-10; registering only `payload.studentId` left
    // every one of them unregistered.
    fieldPaths: [
      'payload.studentId',
      'payload.receipt.studentId',
      'payload.receipt.ledgerId',
      'payload.receipt.allocations[].ledgerId',
    ],
    pathMatcherId: 'path.outbox_jobs',
    fieldMatcherId: 'field.outbox_jobs.payload_studentId',
    stateMatcherId: 'state.outbox_jobs.pending_only',
    rewriteStrategyId: 'rewrite.drain_or_rewrite_pending_payload',
    targetPathBuilderId: 'target.unchanged_path',
    collisionComparatorId: NOT_APPLICABLE_COLLISION_ID,
    verificationId: 'verify.outbox_job_payload_canonical_or_drained',
    rollbackStrategyId: 'rollback.reverse_patch.outbox_jobs',
  },
  // server/api/lib/jobs/jobStore.ts writes an untyped JsonValue payload for
  // lightweight jobs such as exports. Registered narrowly to the export job
  // type and the payload.studentId path only; any other job type or payload
  // shape carrying an id remains UNKNOWN_REFERENCE, per the design's rule
  // that generic job collections are known only by exact type plus field
  // path, never by collection name alone.
  {
    id: 'jobs.export_payload',
    collectionPath: 'jobs',
    kind: 'pending_job',
    rewriteKind: 'drain_or_rewrite',
    collisionKind: 'not_applicable',
    rollbackKind: 'reverse_patch',
    containsMoney: false,
    mayRetainLegacyId: false,
    fieldPaths: ['payload.studentId'],
    pathMatcherId: 'path.jobs',
    fieldMatcherId: 'field.jobs.export_payload_studentId',
    stateMatcherId: 'state.jobs.export_type_only',
    rewriteStrategyId: 'rewrite.drain_or_rewrite_pending_payload',
    targetPathBuilderId: 'target.unchanged_path',
    collisionComparatorId: NOT_APPLICABLE_COLLISION_ID,
    verificationId: 'verify.job_payload_canonical_or_drained',
    rollbackStrategyId: 'rollback.reverse_patch.jobs',
  },
  // The zalo_bulk_jobs parent document carries an `items` array whose
  // entries embed studentId, distinct from the flat per-item
  // zalo_bulk_job_items collection registered above.
  {
    id: 'zalo_bulk_jobs.items',
    collectionPath: 'zalo_bulk_jobs',
    kind: 'nested_payload',
    rewriteKind: 'rewrite_nested',
    collisionKind: 'not_applicable',
    rollbackKind: 'reverse_patch',
    containsMoney: false,
    mayRetainLegacyId: false,
    fieldPaths: ['items'],
    pathMatcherId: 'path.zalo_bulk_jobs',
    fieldMatcherId: 'field.zalo_bulk_jobs.items_studentId',
    stateMatcherId: 'state.zalo_bulk_jobs.any',
    rewriteStrategyId: 'rewrite.rewrite_nested_array',
    targetPathBuilderId: 'target.unchanged_path',
    collisionComparatorId: NOT_APPLICABLE_COLLISION_ID,
    verificationId: 'verify.zalo_bulk_job_items_canonical',
    rollbackStrategyId: 'rollback.reverse_patch.zalo_bulk_jobs',
  },

  // --- Identity (Workstream A/C collections) ---
  {
    id: 'student_code_registry.claim',
    collectionPath: 'student_code_registry',
    kind: 'deterministic_identity',
    rewriteKind: 'claim_registry',
    collisionKind: 'not_applicable',
    rollbackKind: 'reverse_patch',
    containsMoney: false,
    mayRetainLegacyId: false,
    fieldPaths: ['canonicalProfileId'],
    pathMatcherId: 'path.student_code_registry',
    fieldMatcherId: 'field.student_code_registry.canonicalProfileId',
    stateMatcherId: 'state.student_code_registry.any',
    rewriteStrategyId: 'rewrite.claim_registry_for_merge',
    targetPathBuilderId: 'target.unchanged_path',
    collisionComparatorId: NOT_APPLICABLE_COLLISION_ID,
    verificationId: 'verify.registry_owner_canonical',
    rollbackStrategyId: 'rollback.reverse_patch.student_code_registry',
  },
  {
    id: 'student_profile_aliases.create',
    collectionPath: 'student_profile_aliases',
    kind: 'deterministic_identity',
    rewriteKind: 'create_alias',
    collisionKind: 'not_applicable',
    rollbackKind: 'delete_run_created_document',
    containsMoney: false,
    mayRetainLegacyId: true,
    fieldPaths: ['legacyProfileId', 'canonicalProfileId'],
    pathMatcherId: 'path.student_profile_aliases',
    fieldMatcherId: 'field.student_profile_aliases.any',
    stateMatcherId: 'state.student_profile_aliases.any',
    rewriteStrategyId: 'rewrite.create_alias_document',
    targetPathBuilderId: 'target.alias_by_legacy_id',
    collisionComparatorId: NOT_APPLICABLE_COLLISION_ID,
    verificationId: 'verify.alias_one_hop_acyclic',
    rollbackStrategyId: 'rollback.delete_run_created_document.student_profile_aliases',
  },
] as const;

const registryById = new Map(STUDENT_REFERENCE_REGISTRY.map((entry) => [entry.id, entry]));

export function getStudentReferenceSpec(id: string): StudentReferenceSpec {
  const entry = registryById.get(id);
  if (!entry) throw new Error(`STUDENT_REFERENCE_SPEC_NOT_FOUND:${id}`);
  return entry;
}

/**
 * Rebuilds a value that embeds a profile id when the registry owns an exact
 * composition strategy for it.
 *
 * Returning `null` is deliberate: a composite value without a registered
 * strategy must remain a blocker. The generic planner may never guess how to
 * rebuild a ledger id, URL, sentence, or other value merely because it found
 * the retired id inside it.
 */
export function buildContainedStudentReferenceValue(input: {
  specId: string;
  fieldPath: string;
  documentPath: string;
  canonicalProfileId: string;
}): string | null {
  const spec = getStudentReferenceSpec(input.specId);
  if (
    spec.rewriteStrategyId !== 'rewrite.recreate_deterministic_user' ||
    input.fieldPath !== 'uid'
  ) {
    return null;
  }

  const match = /^users\/(student|parent):[^/]+$/.exec(input.documentPath);
  if (!match) return null;
  return `${match[1]}:${input.canonicalProfileId}`;
}

function textField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function buildStudentReferenceTargetPath(input: {
  specId: string;
  sourcePath: string;
  sourceData: Record<string, unknown>;
  sourceProfileId: string;
  canonicalProfileId: string;
}): string | null {
  const spec = getStudentReferenceSpec(input.specId);

  switch (spec.targetPathBuilderId) {
    case 'target.unchanged_path':
      return input.sourcePath;
    case 'target.immutable_no_move':
      return null;
    case 'target.course_fee_ledger_keyed':
    case 'target.course_fee_ledger_keyed_dependent': {
      const classId = textField(input.sourceData.classId);
      const termStart = textField(input.sourceData.termStart);
      const termEnd = textField(input.sourceData.termEnd);
      return `course_fee_ledgers/${buildCourseLedgerId(input.canonicalProfileId, classId, termStart, termEnd)}`;
    }
    case 'target.enrollment_keyed': {
      const classId = textField(input.sourceData.classId);
      const termStart = textField(input.sourceData.termStart);
      return `student_course_enrollments/${makeStudentCourseEnrollmentId(input.canonicalProfileId, classId, termStart)}`;
    }
    case 'target.course_closing_record_keyed': {
      const courseId = textField(input.sourceData.courseId) || textField(input.sourceData.classId);
      return `course_closing_records/${courseClosingRecordId(courseId, input.canonicalProfileId)}`;
    }
    case 'target.attendance_keyed': {
      const classId = textField(input.sourceData.classId);
      const date = textField(input.sourceData.date);
      return `attendance/${[input.canonicalProfileId, classId, date].filter(Boolean).join('_')}`;
    }
    case 'target.deterministic_user_id': {
      const role = input.sourcePath.includes('parent:') ? 'parent' : 'student';
      return `users/${role}:${input.canonicalProfileId}`;
    }
    case 'target.summary_by_canonical_id':
      return `accounting_student_summaries/${input.canonicalProfileId}`;
    case 'target.alias_by_legacy_id':
      return `student_profile_aliases/${input.sourceProfileId}`;
    default:
      return input.sourcePath;
  }
}

const MONEY_COMPARISON_FIELDS: Record<string, readonly string[]> = {
  'collision.course_fee_ledger': ['amount', 'paidTotal', 'discountTotal', 'status', 'termStart', 'termEnd'],
  'collision.course_closing_record': ['status', 'tuitionDocument.storagePath', 'evaluationDocument.storagePath'],
  'collision.attendance_semantic': ['status', 'date'],
  'collision.enrollment_open_uniqueness': ['status', 'termStart', 'classId'],
  'collision.linked_user_deterministic': ['uid'],
};

function readNested(value: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && !Array.isArray(acc)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, value);
}

export function compareStudentReferenceCollision(input: {
  specId: string;
  source: Record<string, unknown>;
  target: Record<string, unknown>;
}): 'identical' | 'conflict' {
  const spec = getStudentReferenceSpec(input.specId);
  if (spec.collisionKind === 'not_applicable') return 'identical';

  const fields = MONEY_COMPARISON_FIELDS[spec.collisionComparatorId] ?? [];
  for (const field of fields) {
    const left = readNested(input.source, field);
    const right = readNested(input.target, field);
    if (left !== right) return 'conflict';
  }
  return 'identical';
}
