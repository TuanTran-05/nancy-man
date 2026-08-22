import { describe, expect, it } from 'vitest';
import {
  buildContainedStudentReferenceValue,
  buildStudentReferenceTargetPath,
  compareStudentReferenceCollision,
  getStudentReferenceSpec,
  STUDENT_REFERENCE_FREE_COLLECTIONS,
  STUDENT_REFERENCE_REGISTRY,
  STUDENT_REFERENCE_REGISTRY_VERSION,
} from './referenceRegistry.js';

// The exact 45 top-level collections observed by the Phase 0 production
// discovery run on 2026-08-06 (scratch/discovery-2026-08-06-post-backfill).
// Six financial collections that exist in application code but were empty at
// scan time — because the 2026-08-05 wipe_finance_data_for_rebuild migration
// had just cleared them — are added here deliberately: the registry must
// cover them on code evidence even though production did not exercise them
// this run. See docs/superpowers/specs/.../design.md "Student reference
// registry" for the rule this encodes.
const PRODUCTION_COLLECTIONS_2026_08_06 = [
  'attendance',
  'audit_logs',
  '_rate_limits',
  'zalo_notifications',
  'accounting_student_summaries',
  'students',
  'class_sessions',
  'student_course_enrollments',
  'course_fee_ledgers',
  'zalo_bulk_job_items',
  'evaluations',
  'student_enrollment_migration_journal',
  'course_closing_records',
  'outbox_jobs',
  'users',
  'jobs',
  'zalo_bulk_jobs',
  'notifications',
  '_maintenance',
  'admin_notifications',
  'classes',
  'allowed_teachers',
  'knowledge_bank',
  'submissions',
  '_counters',
  'realtime_events',
  'dailyReports',
  'admissions_history',
  'finance_idempotency_keys',
  'finance_monthly_aggregates',
  'teacher_availability_profiles',
  'assignments',
  'background_jobs',
  'job_runs',
  'student_auth_credentials',
  'system_settings',
  '_payment_locks',
  '_schema_migrations',
  '_zalo_config',
  'accounting_student_summary_health',
  'config',
  'payment_order_codes',
  'read_models',
  'staff_account_requests',
  'conversations',
  // Empty at scan time due to the 2026-08-05 wipe; writer code confirmed live.
  'receipts',
  'wallet_transactions',
  'invoices',
  'payment_requests',
  'expenses',
] as const;

describe('reference registry closure against the real production inventory', () => {
  it('classifies every observed collection as registered or explicitly student-free', () => {
    const registered = new Set(STUDENT_REFERENCE_REGISTRY.map((entry) => entry.collectionPath));
    const free = new Set(STUDENT_REFERENCE_FREE_COLLECTIONS.map((entry) => entry.collectionPath));

    const unclassified = PRODUCTION_COLLECTIONS_2026_08_06.filter(
      (path) => !registered.has(path) && !free.has(path)
    );
    expect(unclassified).toEqual([]);
  });

  it('never registers and frees the same collection', () => {
    const registered = new Set(STUDENT_REFERENCE_REGISTRY.map((entry) => entry.collectionPath));
    const overlap = STUDENT_REFERENCE_FREE_COLLECTIONS.filter((entry) =>
      registered.has(entry.collectionPath)
    );
    expect(overlap).toEqual([]);
  });

  it('never writes an entry for a collection absent from both the observed set and application code', () => {
    // `background_jobs` has no writer in the repository — see the free-list
    // entry's own reasonCode, which must say so rather than asserting safety.
    const entry = STUDENT_REFERENCE_FREE_COLLECTIONS.find(
      (item) => item.collectionPath === 'background_jobs'
    );
    expect(entry?.reasonCode).toBe('no_known_writer_requires_investigation');
  });

  it('gives every free-list entry a non-empty evidence string', () => {
    for (const entry of STUDENT_REFERENCE_FREE_COLLECTIONS) {
      expect(entry.evidence.length).toBeGreaterThan(0);
    }
  });
});

/**
 * The field paths production actually writes, measured rather than drafted.
 *
 * Every row is a shape the 2026-08-10 preliminary audit found against the real
 * candidate set, with the number of distinct documents that carried it. The
 * registry had been written from the Phase 0 discovery run, which reported
 * documents but not the paths inside them, so nine of these shapes were
 * missing and 996 references were blocked as unregistered — the registry
 * describing a database that was not quite this one.
 */
const PRODUCTION_FIELD_PATHS_2026_08_10: ReadonlyArray<[string, string, number]> = [
  ['audit_logs', 'documentId', 538],
  ['audit_logs', 'metadata.studentId', 526],
  ['audit_logs', 'metadata.studentIds[]', 113],
  ['audit_logs', 'metadata.ledgerIds[]', 26],
  ['audit_logs', 'userId', 13],
  ['audit_logs', 'metadata.affectedStudentIds[]', 10],
  ['audit_logs', 'metadata.plan[].creates[].studentId', 7],
  ['audit_logs', 'metadata.plan[].creates[].ledgerId', 7],
  ['audit_logs', 'metadata.url', 3],
  ['audit_logs', 'changes.enrollmentTermEnd[].studentId', 1],
  ['audit_logs', 'changes.ledgerTermEnd[].id', 1],
  ['audit_logs', 'changes.ledgerTermEnd[].studentId', 1],
  ['students', 'archiveReason', 58],
  ['students', 'mergedIntoStudentId', 58],
  ['students', 'statusNote', 58],
  ['students', 'id', 34],
  ['outbox_jobs', 'payload.receipt.ledgerId', 27],
  ['outbox_jobs', 'payload.receipt.studentId', 27],
  ['outbox_jobs', 'payload.receipt.allocations[].ledgerId', 26],
  ['receipts', 'allocations[].ledgerId', 26],
  ['wallet_transactions', 'ledgerId', 26],
  ['admin_notifications', 'sampleFailures[].studentId', 22],
  ['course_closing_records', 'id', 15],
];

describe('registry coverage of the shapes production writes', () => {
  it.each(PRODUCTION_FIELD_PATHS_2026_08_10)(
    'registers %s.%s, seen on %i production documents',
    (collectionPath, fieldPath) => {
      const covered = STUDENT_REFERENCE_REGISTRY.filter(
        (entry) => entry.collectionPath === collectionPath
      ).some((entry) => entry.fieldPaths.includes(fieldPath));

      expect(covered).toBe(true);
    }
  );

  it('keeps every audit-log path immutable, whatever else is registered', () => {
    // These are records of what happened. Broadening the paths must never be
    // the step that makes them rewritable.
    for (const entry of STUDENT_REFERENCE_REGISTRY.filter(
      (candidate) => candidate.collectionPath === 'audit_logs'
    )) {
      expect(entry.rewriteKind).toBe('preserve_via_alias');
      expect(entry.mayRetainLegacyId).toBe(true);
    }
  });
});

describe('registry entry completeness', () => {
  it('gives every entry a unique id and every strategy id non-empty', () => {
    const ids = new Set<string>();
    for (const entry of STUDENT_REFERENCE_REGISTRY) {
      expect(ids.has(entry.id)).toBe(false);
      ids.add(entry.id);
      for (const field of [
        'pathMatcherId',
        'fieldMatcherId',
        'stateMatcherId',
        'rewriteStrategyId',
        'targetPathBuilderId',
        'collisionComparatorId',
        'verificationId',
        'rollbackStrategyId',
      ] as const) {
        expect(entry[field].length).toBeGreaterThan(0);
      }
    }
  });

  it('flags every finance entry as containing money', () => {
    for (const path of ['course_fee_ledgers', 'receipts', 'wallet_transactions', 'invoices']) {
      const entries = STUDENT_REFERENCE_REGISTRY.filter((entry) => entry.collectionPath === path);
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) expect(entry.containsMoney).toBe(true);
    }
  });

  it('marks student_progression_events as immutable and never rewritable', () => {
    const entry = getStudentReferenceSpec('student_progression_events.fields');
    expect(entry.kind).toBe('immutable_audit');
    expect(entry.rewriteKind).toBe('preserve_via_alias');
  });

  it('marks the keyed course-fee-ledger entry with a block collision policy by default', () => {
    const entry = getStudentReferenceSpec('course_fee_ledgers.keyed');
    expect(entry.collisionKind).toBe('block');
  });

  it('throws a stable error for an unregistered id rather than returning undefined', () => {
    expect(() => getStudentReferenceSpec('not-a-real-id')).toThrow(
      'STUDENT_REFERENCE_SPEC_NOT_FOUND:not-a-real-id'
    );
  });
});

describe('buildStudentReferenceTargetPath', () => {
  it('rewrites a direct-field document path unchanged and lets the caller patch studentId', () => {
    const target = buildStudentReferenceTargetPath({
      specId: 'evaluations.studentId',
      sourcePath: 'evaluations/eval-1',
      sourceData: { studentId: 'legacy-1' },
      sourceProfileId: 'legacy-1',
      canonicalProfileId: 'canonical-1',
    });
    expect(target).toBe('evaluations/eval-1');
  });

  it('builds the deterministic target path for a keyed course-fee-ledger move', () => {
    const target = buildStudentReferenceTargetPath({
      specId: 'course_fee_ledgers.keyed',
      sourcePath: 'course_fee_ledgers/legacy-1_class-1_2026-08-01_2026-09-20',
      sourceData: { studentId: 'legacy-1', classId: 'class-1', termStart: '2026-08-01', termEnd: '2026-09-20' },
      sourceProfileId: 'legacy-1',
      canonicalProfileId: 'canonical-1',
    });
    expect(target).toBe('course_fee_ledgers/canonical-1_class-1_2026-08-01_2026-09-20');
  });

  it('returns null for an immutable-audit entry, because it is never moved', () => {
    const target = buildStudentReferenceTargetPath({
      specId: 'audit_logs.fields',
      sourcePath: 'audit_logs/log-1',
      sourceData: { studentId: 'legacy-1' },
      sourceProfileId: 'legacy-1',
      canonicalProfileId: 'canonical-1',
    });
    expect(target).toBeNull();
  });
});

describe('buildContainedStudentReferenceValue', () => {
  it('rebuilds a deterministic linked-user uid with the canonical profile id', () => {
    expect(
      buildContainedStudentReferenceValue({
        specId: 'users.deterministic',
        fieldPath: 'uid',
        documentPath: 'users/student:canonical-1',
        canonicalProfileId: 'canonical-1',
      })
    ).toBe('student:canonical-1');
  });

  it('returns null when the registry has no strategy for the composed value', () => {
    expect(
      buildContainedStudentReferenceValue({
        specId: 'receipts.studentId',
        fieldPath: 'ledgerId',
        documentPath: 'receipts/r-1',
        canonicalProfileId: 'canonical-1',
      })
    ).toBeNull();
  });
});

describe('compareStudentReferenceCollision', () => {
  it('reports identical for a not_applicable-collision entry regardless of content', () => {
    const result = compareStudentReferenceCollision({
      specId: 'evaluations.studentId',
      source: { score: 8 },
      target: { score: 9 },
    });
    expect(result).toBe('identical');
  });

  it('reports conflict for two ledgers with different business/monetary fields', () => {
    const result = compareStudentReferenceCollision({
      specId: 'course_fee_ledgers.keyed',
      source: { amount: 1_000_000, status: 'unpaid' },
      target: { amount: 1_200_000, status: 'unpaid' },
    });
    expect(result).toBe('conflict');
  });

  it('reports identical for two ledgers whose business and monetary fields match exactly', () => {
    const result = compareStudentReferenceCollision({
      specId: 'course_fee_ledgers.keyed',
      source: { amount: 1_000_000, status: 'unpaid', paidTotal: 0 },
      target: { amount: 1_000_000, status: 'unpaid', paidTotal: 0 },
    });
    expect(result).toBe('identical');
  });
});
