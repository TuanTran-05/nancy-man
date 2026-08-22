import { type DocumentStore } from '@/server/db/documentStore.js';
import { ACCOUNTING_FINANCE_SOURCE_VERSION, ACCOUNTING_STUDENT_SUMMARIES_COLLECTION } from '../server/api/lib/accounting/studentFinanceProjectionRepository.js';

export type AccountingFinanceHealth = {
  studentCount: number;
  summaryCount: number;
  sourceVersion: number;
  repairBacklog: number;
  checkedAt: string;
};

export async function checkAccountingStudentFinanceHealth(db: DocumentStore): Promise<AccountingFinanceHealth> {
  const [students, summaries, outbox] = await Promise.all([
    db.collection('students').get(),
    db.collection(ACCOUNTING_STUDENT_SUMMARIES_COLLECTION).get(),
    db.collection('accounting_finance_outbox').where('status', '==', 'pending').get(),
  ]);
  const sourceVersions = (summaries.docs || []).map((doc) => Number(doc.data().sourceVersion || 0));
  return {
    studentCount: students.docs.length,
    summaryCount: summaries.docs.length,
    sourceVersion: sourceVersions.length ? Math.max(...sourceVersions) : ACCOUNTING_FINANCE_SOURCE_VERSION,
    repairBacklog: outbox.docs.length + Math.max(0, students.docs.length - summaries.docs.length),
    checkedAt: new Date().toISOString(),
  };
}
