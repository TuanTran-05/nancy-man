import { FieldValue, type DocumentStore, type Transaction } from '@/server/db/documentStore.js';
import { readStoredStudentCourseEnrollment } from '../student/courseEnrollmentRepository.js';
import { resolveCanonicalStudentIdInTransaction } from '../student/studentIdentityResolver.js';
import { isCanonicalStudentProfile } from '../../../../shared/studentIdentity.js';
import { buildAccountingStudentSummary, type FinanceProjectionLedger } from './studentFinanceProjection.js';

export const ACCOUNTING_STUDENT_SUMMARIES_COLLECTION = 'accounting_student_summaries';
export const ACCOUNTING_FINANCE_OUTBOX_COLLECTION = 'accounting_finance_outbox';
export const ACCOUNTING_STUDENT_SUMMARY_HEALTH_COLLECTION = 'accounting_student_summary_health';
/**
 * Version 3 is the canonical projection: one summary per canonical profile.
 *
 * Version 2 wrote one per physical `students` document, so a merged child had
 * two summaries and each carried part of their money. The version number is
 * what lets Workstream D refuse to activate `canonical_required` against a
 * projection that was built the old way.
 */
export const ACCOUNTING_FINANCE_SOURCE_VERSION = 3;

export type AccountingStudentFinanceProjectionHealthV3 = {
  sourceVersion: 3;
  eligibleCanonicalProfiles: number;
  physicalStudentDocumentCount: number;
  canonicalProfileCount: number;
  aliasCount: number;
  tombstoneCount: number;
  summaryCount: number;
  aliasOrTombstoneSummaryCount: number;
  orphanSummaryCount: number;
  repairBacklog: number;
  complete: boolean;
  computedAt: string;
};

/**
 * Every counter stands alone because "incomplete" is useless to an operator
 * who cannot see which way it is incomplete.
 *
 * `physicalStudentDocumentCount` is observability only: tombstones are
 * retained on purpose, so it exceeding the canonical count is the expected
 * steady state rather than a fault.
 */
export function buildAccountingProjectionHealth(
  input: Omit<AccountingStudentFinanceProjectionHealthV3, 'sourceVersion' | 'complete'>
): AccountingStudentFinanceProjectionHealthV3 {
  const complete =
    input.summaryCount === input.eligibleCanonicalProfiles &&
    input.aliasOrTombstoneSummaryCount === 0 &&
    input.orphanSummaryCount === 0 &&
    input.repairBacklog === 0;
  return { ...input, sourceVersion: 3, complete };
}

function finiteCount(value: unknown): number | null {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : null;
}

/**
 * Reads both the canonical v3 health record and the short-lived transitional
 * record produced while v2 fields were still merged into `current`.
 *
 * `studentCount` deliberately does not participate for v3: it counted physical
 * documents, while v3 owns one summary per canonical profile. Aliases and
 * tombstones make those totals different in a healthy steady state.
 */
export function isAccountingProjectionHealthIncomplete(
  health: Record<string, unknown> | null | undefined
): boolean {
  if (!health) return true;

  const sourceVersion = finiteCount(health.sourceVersion);
  if (sourceVersion === null || sourceVersion < ACCOUNTING_FINANCE_SOURCE_VERSION) return true;
  if (health.complete !== true) return true;

  const repairBacklog = finiteCount(health.repairBacklog);
  if (repairBacklog === null || repairBacklog > 0) return true;

  const eligibleCanonicalProfiles = finiteCount(health.eligibleCanonicalProfiles);
  const summaryCount = finiteCount(health.summaryCount);
  if (
    eligibleCanonicalProfiles !== null &&
    summaryCount !== null &&
    eligibleCanonicalProfiles !== summaryCount
  ) {
    return true;
  }

  for (const key of ['aliasOrTombstoneSummaryCount', 'orphanSummaryCount'] as const) {
    const count = finiteCount(health[key]);
    if (count !== null && count > 0) return true;
  }

  return false;
}

/**
 * Replaces the singleton instead of merging it so a v3 rebuild cannot retain
 * legacy counters that describe physical documents.
 */
export async function writeAccountingProjectionHealth(
  db: DocumentStore,
  health: AccountingStudentFinanceProjectionHealthV3
): Promise<void> {
  await db
    .collection(ACCOUNTING_STUDENT_SUMMARY_HEALTH_COLLECTION)
    .doc('current')
    .set(
      {
        ...health,
        checkedAt: FieldValue.serverTimestamp(),
      },
      { merge: false }
    );
}

export async function rebuildStudentAccountingSummary(
  tx: Transaction,
  db: DocumentStore,
  requestedStudentId: string,
  today: string,
  now = new Date().toISOString()
) {
  // Resolved first, so the summary lands on the profile that owns the money.
  // Writing `accounting_student_summaries/{retiredId}` produced the second row
  // an operator saw on the finance list, holding half the balance.
  const studentId = (
    await resolveCanonicalStudentIdInTransaction(tx, db, requestedStudentId).catch(() => null)
  )?.canonicalProfileId;
  if (!studentId) return null;

  const studentRef = db.collection('students').doc(studentId);
  const studentSnap = await tx.get(studentRef);
  if (!studentSnap.exists) return null;
  // A tombstone is not a student with no money; it is a record that the money
  // moved. Projecting one would recreate the row the merge removed.
  if (!isCanonicalStudentProfile({ id: studentId, ...(studentSnap.data() || {}) })) return null;
  const [enrollmentSnap, ledgerSnap] = await Promise.all([
    tx.get(db.collection('student_course_enrollments').where('studentId', '==', studentId)),
    tx.get(db.collection('course_fee_ledgers').where('studentId', '==', studentId)),
  ]);
  const enrollments = (enrollmentSnap.docs || []).map((doc) => readStoredStudentCourseEnrollment(doc));
  const ledgers: FinanceProjectionLedger[] = (ledgerSnap.docs || []).map((doc) => {
    const data = doc.data() || {};
    return { id: doc.id, classId: typeof data.classId === 'string' ? data.classId : null, termStart: typeof data.termStart === 'string' ? data.termStart : null, amount: data.amount, discountTotal: data.discountTotal, paidTotal: data.paidTotal, dueDate: typeof data.dueDate === 'string' ? data.dueDate : null, waived: data.status === 'waived', tuitionReminderCount: data.tuitionReminderCount, tuitionReminderLastSentAt: data.tuitionReminderLastSentAt };
  });
  const summary = buildAccountingStudentSummary({ student: { id: studentId, ...(studentSnap.data() || {}) }, enrollments, ledgers, today, sourceVersion: ACCOUNTING_FINANCE_SOURCE_VERSION, rebuiltAt: now });
  tx.set(db.collection(ACCOUNTING_STUDENT_SUMMARIES_COLLECTION).doc(studentId), summary, { merge: true });
  return summary;
}

export function queueAccountingFinanceOutbox(
  tx: Transaction,
  db: DocumentStore,
  input: { eventId: string; studentId: string; reason: string; occurredAt?: string }
) {
  const ref = db.collection(ACCOUNTING_FINANCE_OUTBOX_COLLECTION).doc(input.eventId);
  tx.create(ref, {
    id: input.eventId,
    studentId: input.studentId,
    reason: input.reason,
    occurredAt: input.occurredAt || new Date().toISOString(),
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
  });
}

export async function processAccountingFinanceOutbox(
  db: DocumentStore,
  today: string,
  limit = 50
): Promise<{ processed: number; failed: number }> {
  const pending = await db.collection(ACCOUNTING_FINANCE_OUTBOX_COLLECTION)
    .where('status', '==', 'pending')
    .orderBy('occurredAt', 'asc')
    .limit(limit)
    .get();
  let processed = 0;
  let failed = 0;
  for (const event of pending.docs || []) {
    try {
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(event.ref);
        if (!fresh.exists || fresh.data()?.status !== 'pending') return;
        const studentId = String(fresh.data()?.studentId || '');
        if (!studentId) {
          tx.update(event.ref, { status: 'failed', error: 'missing_student_id', updatedAt: FieldValue.serverTimestamp() });
          return;
        }
        await rebuildStudentAccountingSummary(tx, db, studentId, today);
        tx.update(event.ref, { status: 'processed', processedAt: FieldValue.serverTimestamp() });
      });
      processed += 1;
    } catch (error) {
      failed += 1;
      console.error('[accounting-finance-outbox] failed to process event', event.id, error);
    }
  }
  return { processed, failed };
}
