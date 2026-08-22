import { FieldValue, type DocumentStore } from '@/server/db/documentStore.js';
import { createOutboxJob } from '../jobs/outbox.js';
import { readStoredStudentCourseEnrollment } from '../student/courseEnrollmentRepository.js';
import {
  ACCOUNTING_FINANCE_SOURCE_VERSION,
  rebuildStudentAccountingSummary as rebuildInTransaction,
} from '../accounting/studentFinanceProjectionRepository.js';
import {
  buildAccountingStudentSummary as buildPureSummary,
  type FinanceProjectionLedger,
} from '../accounting/studentFinanceProjection.js';
import type { AccountingStudentSummary } from '../../../../shared/accountingStudentFinance.js';
import { getVietnamTodayStr } from '../../../../shared/classSchedule.js';
import type { StudentIdentityMutationContext } from '../maintenance/studentIdentityMutationTransaction.js';
import { invalidateAdminClassTuitionSnapshotHealth } from './adminClassTuitionSnapshotInvalidation.js';

export const ACCOUNTING_STUDENT_SUMMARY_VERSION = ACCOUNTING_FINANCE_SOURCE_VERSION;

async function readInputs(db: DocumentStore, studentId: string) {
  const studentSnap = await db.collection('students').doc(studentId).get();
  if (!studentSnap.exists) return null;
  const [enrollmentSnap, ledgerSnap] = await Promise.all([
    db
      .collection('student_course_enrollments')
      .where('studentId', '==', studentId)
      .orderBy('termStart', 'desc')
      .get(),
    db.collection('course_fee_ledgers').where('studentId', '==', studentId).get(),
  ]);
  const enrollments = enrollmentSnap.docs.map((doc) => readStoredStudentCourseEnrollment(doc));
  const ledgers: FinanceProjectionLedger[] = ledgerSnap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      id: doc.id,
      classId: typeof data.classId === 'string' ? data.classId : null,
      termStart: typeof data.termStart === 'string' ? data.termStart : null,
      amount: data.amount,
      discountTotal: data.discountTotal,
      paidTotal: data.paidTotal,
      dueDate: typeof data.dueDate === 'string' ? data.dueDate : null,
      waived: data.status === 'waived',
      tuitionReminderCount: data.tuitionReminderCount,
      tuitionReminderLastSentAt: data.tuitionReminderLastSentAt,
    };
  });
  return { student: { id: studentId, ...(studentSnap.data() || {}) }, enrollments, ledgers };
}

export async function buildAccountingStudentSummary(
  db: DocumentStore,
  studentId: string,
  now = new Date()
): Promise<AccountingStudentSummary> {
  const input = await readInputs(db, studentId);
  if (!input) throw Object.assign(new Error('Student not found'), { statusCode: 404 });
  return buildPureSummary({
    ...input,
    today: getVietnamTodayStr(now),
    sourceVersion: ACCOUNTING_STUDENT_SUMMARY_VERSION,
    rebuiltAt: now.toISOString(),
  });
}

export async function rebuildAccountingStudentSummary(
  db: DocumentStore,
  studentId: string,
  now = new Date()
): Promise<AccountingStudentSummary> {
  let summary: AccountingStudentSummary | null = null;
  await db.runTransaction(async (tx) => {
    summary = (await rebuildInTransaction(
      tx,
      db,
      studentId,
      getVietnamTodayStr(now),
      now.toISOString()
    )) as AccountingStudentSummary | null;
  });
  if (!summary) throw Object.assign(new Error('Student not found'), { statusCode: 404 });
  return summary;
}

export async function refreshAccountingStudentSummariesAfterCommit(
  db: DocumentStore,
  studentIds: string[],
  cause: string,
  context: StudentIdentityMutationContext,
  dependencies?: {
    rebuild?: typeof rebuildAccountingStudentSummary;
    queue?: (
      db: DocumentStore,
      studentId: string,
      cause: string,
      context: StudentIdentityMutationContext
    ) => Promise<void>;
    invalidateSnapshotHealth?: typeof invalidateAdminClassTuitionSnapshotHealth;
  }
): Promise<{ rebuilt: string[]; queued: string[]; failed: string[] }> {
  const rebuild = dependencies?.rebuild || rebuildAccountingStudentSummary;
  const queue =
    dependencies?.queue ||
    (async (
      targetDb: DocumentStore,
      studentId: string,
      retryCause: string,
      mutationContext: StudentIdentityMutationContext
    ) => {
      await createOutboxJob(
        targetDb,
        {
          type: 'rebuild_accounting_student_summary',
          payload: { studentId, cause: retryCause },
          idempotencyKey: `accounting-summary-${studentId}`,
        },
        mutationContext
      );
    });
  const uniqueStudentIds = [...new Set(studentIds.filter(Boolean))];
  const enrollmentCollection = db.collection('student_course_enrollments');
  if (typeof enrollmentCollection?.where !== 'function') {
    return { rebuilt: [], queued: [], failed: uniqueStudentIds };
  }
  const studentCollection = db.collection('students');
  if (
    typeof studentCollection?.doc !== 'function' ||
    typeof studentCollection.doc('__probe__')?.get !== 'function'
  ) {
    return { rebuilt: [], queued: [], failed: uniqueStudentIds };
  }
  const rebuilt: string[] = [];
  const queued: string[] = [];
  const failed: string[] = [];
  for (const studentId of uniqueStudentIds) {
    try {
      await rebuild(db, studentId);
      rebuilt.push(studentId);
    } catch (error) {
      console.error('[accounting-summary] rebuild failed; queueing retry', {
        studentId,
        cause,
        error,
      });
      try {
        const outboxCollection = db.collection('outbox_jobs');
        if (typeof outboxCollection?.doc !== 'function') {
          failed.push(studentId);
          continue;
        }
        await queue(db, studentId, cause, context);
        queued.push(studentId);
      } catch (queueError) {
        failed.push(studentId);
        console.error('[accounting-summary] unable to queue rebuild', { studentId, queueError });
      }
    }
  }
  if (uniqueStudentIds.length > 0) {
    const invalidateSnapshotHealth =
      dependencies?.invalidateSnapshotHealth || invalidateAdminClassTuitionSnapshotHealth;
    await invalidateSnapshotHealth(db, `accounting:${cause}`);
  }
  return { rebuilt, queued, failed };
}

export async function writeAccountingSummaryHealth(db: DocumentStore, patch: Record<string, unknown>) {
  await db
    .collection('accounting_student_summary_health')
    .doc('current')
    .set(
      {
        sourceVersion: ACCOUNTING_STUDENT_SUMMARY_VERSION,
        ...patch,
        checkedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}
