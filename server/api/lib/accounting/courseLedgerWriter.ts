import { FieldValue, type DocumentStore } from '@/server/db/documentStore.js';
import { courseTuitionDueDate } from '../../../../shared/tuitionDueDate.js';
import type { PlannedLedger } from './courseLedgerPlanner.js';

export type WriteRequest = { classId: string; ledger: PlannedLedger };

export type LedgerWriteResult = {
  createdCount: number;
  /** Kept in step with createdCount so both describe the committed set. */
  createdAmount: number;
  affectedStudentIds: string[];
  errors: Array<{ classId: string; message: string }>;
};

/** Small enough that one rejected `create` cannot take down a large batch. */
export const LEDGER_WRITE_CHUNK_SIZE = 100;

/**
 * Writes with `create`, not `set`: two concurrent applies plan the same tuple
 * and therefore the same doc id, and `set` would let the later one overwrite a
 * ledger whose `paidTotal` had already moved.
 *
 * Accepted limit: `create` locks one doc id, not the whole tuple. Two runs
 * straddling a `class.endDate` change would produce two ids for one tuple and
 * neither would collide. The tuple index built at read time covers every
 * sequential case; closing the concurrent one needs a transaction or a lock
 * document, which is out of proportion to the odds.
 *
 * Counters advance only after a chunk commits, so a reported ledger is a ledger
 * that exists.
 */
export async function writeCourseFeeLedgers(
  db: DocumentStore,
  requests: WriteRequest[],
  chunkSize: number = LEDGER_WRITE_CHUNK_SIZE
): Promise<LedgerWriteResult> {
  const result: LedgerWriteResult = {
    createdCount: 0,
    createdAmount: 0,
    affectedStudentIds: [],
    errors: [],
  };
  const affected = new Set<string>();
  const size = Math.max(1, chunkSize);

  for (let start = 0; start < requests.length; start += size) {
    const chunk = requests.slice(start, start + size);
    const batch = db.batch();
    for (const { classId, ledger } of chunk) {
      batch.create(db.collection('course_fee_ledgers').doc(ledger.ledgerId), {
        studentId: ledger.studentId,
        classId,
        amount: ledger.amount,
        paidTotal: 0,
        discountTotal: 0,
        status: 'unpaid',
        termStart: ledger.termStart,
        termEnd: ledger.termEnd,
        /**
         * Without this the ledger can never age: `deriveAccountingPaymentStatus`
         * only reports `overdue` when a due date has passed, so every unpaid
         * ledger stayed indistinguishable from one issued this morning.
         */
        dueDate: courseTuitionDueDate(ledger.termStart),
        source: 'course',
        periodType: 'course',
        enrollmentId: ledger.enrollmentId,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    try {
      await batch.commit();
      result.createdCount += chunk.length;
      for (const { ledger } of chunk) {
        result.createdAmount += ledger.amount;
        affected.add(ledger.studentId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A rejected chunk is recoverable: the operation is idempotent, so a
      // re-run fills the gap. Report the classes involved and move on.
      for (const classId of new Set(chunk.map((item) => item.classId))) {
        result.errors.push({ classId, message });
      }
    }
  }

  result.affectedStudentIds = [...affected];
  return result;
}
