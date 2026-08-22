import { AggregateField, FieldPath, type DocumentStore, type Query } from '@/server/db/documentStore.js';
import type { FinanceDetailCursor } from '../../../../shared/centerFinanceReportDetails.js';

const RANGE_END = '\uf8ff';

export const MAX_REPORT_DOCS_PER_COLLECTION = 5000;

export type FinanceReceiptRow = {
  id: string;
  receiptNo?: string;
  invoiceNo?: string;
  studentId?: string;
  ledgerId?: string;
  amountReceived?: number;
  discountAmount?: number;
  discountType?: string;
  siblingDiscount?: boolean;
  receivedDate?: string;
  classId?: string;
  paymentMethod?: string;
  note?: string;
  /** True for wallet top-up receipts, which are not tied to a course. */
  walletDeposit?: boolean;
  flowVersion?: 'wallet-manual-v2';
  classIds?: string[];
  allocations?: Array<{
    ledgerId: string;
    classId: string;
    amount: number;
    discountAmount?: number;
  }>;
  source?: 'manual' | 'payos' | 'migration';
};

export type FinanceExpenseRow = {
  id: string;
  expenseNo?: string;
  amount?: number;
  paidDate?: string;
  category?: string;
  type?: 'activity' | 'wallet_refund';
  studentId?: string;
  classId?: string;
  purpose?: string;
  reason?: string;
  note?: string;
  payee?: string;
  createdBy?: string;
  createdByName?: string;
};

export type FinanceReceiptDetailRow = FinanceReceiptRow;

export type FinanceExpenseDetailRow = FinanceExpenseRow;

export type FinanceLedgerRow = {
  id: string;
  studentId?: string;
  amount?: number;
  paidTotal?: number;
  discountTotal?: number;
  status?: string;
  periodType?: string;
  month?: string;
  termStart?: string;
  termEnd?: string;
  termLabel?: string;
  createdAt?: string; // normalized from a DocumentStore Timestamp
  dueDate?: string | null;
  classId?: string;
};

export type FinanceStudentRow = {
  id: string;
  name?: string;
  studentId?: string;
  dob?: string;
  contact?: string;
  walletBalance?: number;
};

export type FinanceDetailPage<T> = {
  rows: T[];
  totalCount: number;
  totalAmount: number;
  nextCursor: FinanceDetailCursor | null;
};

export type FinanceDetailPageInput = {
  startDate: string;
  endDate: string;
  pageSize: number;
  cursor: FinanceDetailCursor | null;
};

export type FinanceClassInfoRow = {
  id: string;
  className: string;
  teacherId: string;
  teacherName: string;
};

function toDateString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return undefined;
}

function finiteAggregateNumber(value: unknown): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

type AggregateCapableQuery = Query & {
  aggregate: (spec: Record<string, unknown>) => {
    get: () => Promise<{ data: () => Record<string, unknown> }>;
  };
};

export type FinanceClassLevelMap = Record<string, string>;

export type FinanceMonthlyAggregateDoc = {
  month: string;
  totalIncome: number;
  totalExpenses: number;
  totalScholarships?: number;
  incomeByLevel: Array<{ level: string; amount: number }>;
  expensesByCategory: Array<{ category: string; amount: number }>;
  sourceCounts: {
    receipts: number;
    expenses: number;
    classes: number;
  };
  range: {
    startDate: string;
    endDate: string;
  };
  generatedAt: string;
  schemaVersion: number;
};

export class ReportRangeTooLargeError extends Error {
  statusCode = 413;
  limit = MAX_REPORT_DOCS_PER_COLLECTION;

  constructor(collectionName: string) {
    super(`Report range is too large for ${collectionName}. Please narrow the date range.`);
    this.name = 'ReportRangeTooLargeError';
  }
}

export class FinanceRepository {
  constructor(private readonly db: DocumentStore) {}

  private detailBaseQuery(
    collectionName: string,
    dateField: string,
    startDate: string,
    endDate: string
  ) {
    let query: Query = this.db.collection(collectionName).where('status', '==', 'posted');
    if (startDate) query = query.where(dateField, '>=', startDate);
    if (endDate) query = query.where(dateField, '<=', endDate + RANGE_END);
    return query;
  }

  private async aggregateDetailPage(
    query: Query,
    amountField: 'amountReceived' | 'amount'
  ): Promise<{ totalCount: number; totalAmount: number }> {
    const aggregateSnap = await (query as AggregateCapableQuery)
      .aggregate({
        totalCount: AggregateField.count(),
        totalAmount: AggregateField.sum(amountField),
      })
      .get();
    const data = aggregateSnap.data();
    return {
      totalCount: finiteAggregateNumber(data.totalCount),
      totalAmount: finiteAggregateNumber(data.totalAmount),
    };
  }

  async listPostedReceiptDetailsPage(
    input: FinanceDetailPageInput
  ): Promise<FinanceDetailPage<FinanceReceiptDetailRow>> {
    const baseQuery = this.detailBaseQuery(
      'receipts',
      'receivedDate',
      input.startDate,
      input.endDate
    );
    const aggregate = await this.aggregateDetailPage(baseQuery, 'amountReceived');
    let pageQuery = baseQuery
      .orderBy('receivedDate', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');
    if (input.cursor) pageQuery = pageQuery.startAfter(input.cursor.date, input.cursor.id);
    pageQuery = pageQuery.limit(input.pageSize + 1);

    const snap = await pageQuery.get();
    const rows = snap.docs
      .slice(0, input.pageSize)
      .map((doc) => ({ id: doc.id, ...doc.data() }) as FinanceReceiptDetailRow);
    const lastRow = rows[rows.length - 1];
    return {
      ...aggregate,
      rows,
      nextCursor:
        snap.docs.length > input.pageSize && lastRow
          ? { date: lastRow.receivedDate || '', id: lastRow.id }
          : null,
    };
  }

  async listPostedExpenseDetailsPage(
    input: FinanceDetailPageInput
  ): Promise<FinanceDetailPage<FinanceExpenseDetailRow>> {
    const baseQuery = this.detailBaseQuery('expenses', 'paidDate', input.startDate, input.endDate);
    const aggregate = await this.aggregateDetailPage(baseQuery, 'amount');
    let pageQuery = baseQuery.orderBy('paidDate', 'desc').orderBy(FieldPath.documentId(), 'desc');
    if (input.cursor) pageQuery = pageQuery.startAfter(input.cursor.date, input.cursor.id);
    pageQuery = pageQuery.limit(input.pageSize + 1);

    const snap = await pageQuery.get();
    const rows = snap.docs
      .slice(0, input.pageSize)
      .map((doc) => ({ id: doc.id, ...doc.data() }) as FinanceExpenseDetailRow);
    const lastRow = rows[rows.length - 1];
    return {
      ...aggregate,
      rows,
      nextCursor:
        snap.docs.length > input.pageSize && lastRow
          ? { date: lastRow.paidDate || '', id: lastRow.id }
          : null,
    };
  }

  async listPostedReceipts(startDate: string, endDate: string): Promise<FinanceReceiptRow[]> {
    let receiptQuery: Query = this.db.collection('receipts').where('status', '==', 'posted');
    if (startDate) receiptQuery = receiptQuery.where('receivedDate', '>=', startDate);
    if (endDate) receiptQuery = receiptQuery.where('receivedDate', '<=', endDate + RANGE_END);
    receiptQuery = receiptQuery
      .orderBy('receivedDate', 'asc')
      .limit(MAX_REPORT_DOCS_PER_COLLECTION + 1);

    const snap = await receiptQuery.get();
    if (snap.size > MAX_REPORT_DOCS_PER_COLLECTION) {
      throw new ReportRangeTooLargeError('receipts');
    }
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as FinanceReceiptRow);
  }

  async listPostedExpenses(startDate: string, endDate: string): Promise<FinanceExpenseRow[]> {
    let expenseQuery: Query = this.db.collection('expenses').where('status', '==', 'posted');
    if (startDate) expenseQuery = expenseQuery.where('paidDate', '>=', startDate);
    if (endDate) expenseQuery = expenseQuery.where('paidDate', '<=', endDate + RANGE_END);
    expenseQuery = expenseQuery
      .orderBy('paidDate', 'asc')
      .limit(MAX_REPORT_DOCS_PER_COLLECTION + 1);

    const snap = await expenseQuery.get();
    if (snap.size > MAX_REPORT_DOCS_PER_COLLECTION) {
      throw new ReportRangeTooLargeError('expenses');
    }
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as FinanceExpenseRow);
  }

  async getClassReportContext(): Promise<{
    classLevelMap: FinanceClassLevelMap;
    classes: FinanceClassInfoRow[];
    classCount: number;
  }> {
    const classesSnap = await this.db.collection('classes').get();
    const classLevelMap: FinanceClassLevelMap = {};
    const classes = classesSnap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        className: typeof data.name === 'string' ? data.name : '',
        teacherId: typeof data.teacherId === 'string' ? data.teacherId : '',
        teacherName: '',
      };
    });
    for (const doc of classesSnap.docs) {
      const grade = doc.data().grade as number | undefined;
      if (!grade) continue;
      if (grade >= 1 && grade <= 5) classLevelMap[doc.id] = 'primary';
      else if (grade >= 6 && grade <= 9) classLevelMap[doc.id] = 'lower_secondary';
      else if (grade >= 10 && grade <= 12) classLevelMap[doc.id] = 'upper_secondary';
    }

    const teacherNames = new Map<string, string>();
    const teacherIds = [...new Set(classes.map((row) => row.teacherId).filter(Boolean))];
    for (let index = 0; index < teacherIds.length; index += 100) {
      const chunk = teacherIds.slice(index, index + 100);
      const snapshots = await this.db.getAll(
        ...chunk.map((id) => this.db.collection('users').doc(id))
      );
      for (const snapshot of snapshots) {
        if (!snapshot.exists) continue;
        const data = snapshot.data() || {};
        const name =
          (typeof data.displayName === 'string' && data.displayName) ||
          (typeof data.name === 'string' && data.name) ||
          (typeof data.email === 'string' && data.email) ||
          '';
        teacherNames.set(snapshot.id, name);
      }
    }

    for (const row of classes) row.teacherName = teacherNames.get(row.teacherId) || '';
    return { classLevelMap, classes, classCount: classesSnap.size };
  }

  async getClassLevelMap(): Promise<{
    classLevelMap: FinanceClassLevelMap;
    classCount: number;
  }> {
    const snap = await this.db.collection('classes').get();
    const classLevelMap: FinanceClassLevelMap = {};
    for (const doc of snap.docs) {
      const grade = doc.data().grade as number | undefined;
      if (!grade) continue;
      if (grade >= 1 && grade <= 5) classLevelMap[doc.id] = 'primary';
      else if (grade >= 6 && grade <= 9) classLevelMap[doc.id] = 'lower_secondary';
      else if (grade >= 10 && grade <= 12) classLevelMap[doc.id] = 'upper_secondary';
    }
    return { classLevelMap, classCount: snap.size };
  }

  async getMonthlyAggregates(months: string[]): Promise<FinanceMonthlyAggregateDoc[]> {
    if (months.length === 0) return [];

    const docs = await Promise.all(
      months.map(async (month) => {
        const snap = await this.db.collection('finance_monthly_aggregates').doc(month).get();
        if (!snap.exists) return null;
        return snap.data() as FinanceMonthlyAggregateDoc;
      })
    );

    return docs.filter((doc): doc is FinanceMonthlyAggregateDoc => Boolean(doc));
  }

  async saveMonthlyAggregate(aggregate: FinanceMonthlyAggregateDoc): Promise<void> {
    await this.db.collection('finance_monthly_aggregates').doc(aggregate.month).set(aggregate, {
      merge: true,
    });
  }

  async listLedgersByCohortMonths(months: string[]): Promise<FinanceLedgerRow[]> {
    if (months.length === 0) return [];
    const sorted = [...months].sort();
    const firstMonth = sorted[0];
    const lastMonth = sorted[sorted.length - 1];

    const byId = new Map<string, FinanceLedgerRow>();
    const collect = (docs: AppDocumentStore.QueryDocumentSnapshot[]) => {
      for (const doc of docs) {
        const data = doc.data();
        byId.set(doc.id, {
          ...data,
          id: doc.id,
          createdAt: toDateString(data.createdAt),
        } as FinanceLedgerRow);
      }
      // Cap the MERGED result, not each snapshot — two queries could otherwise return ~2x the cap.
      if (byId.size > MAX_REPORT_DOCS_PER_COLLECTION) {
        throw new ReportRangeTooLargeError('course_fee_ledgers');
      }
    };

    // Monthly ledgers, chunked to satisfy DocumentStore's 30-value `in` limit.
    for (let i = 0; i < sorted.length; i += 30) {
      const chunk = sorted.slice(i, i + 30);
      const snap = await this.db
        .collection('course_fee_ledgers')
        .where('month', 'in', chunk)
        .limit(MAX_REPORT_DOCS_PER_COLLECTION + 1)
        .get();
      collect(snap.docs);
    }

    // Course ledgers whose inclusive term range intersects the report window.
    const termSnap = await this.db
      .collection('course_fee_ledgers')
      .where('termEnd', '>=', `${firstMonth}-01`)
      .where('termStart', '<=', `${lastMonth}-31`)
      .orderBy('termEnd', 'asc')
      .orderBy('termStart', 'asc')
      .limit(MAX_REPORT_DOCS_PER_COLLECTION + 1)
      .get();
    collect(termSnap.docs);

    // Orphan course ledgers whose class had no startDate — the generator wrote termStart: '' (see
    // classHelpers.ts:525; startDate is optional). They match neither query above, so recover them
    // by equality and let the caller attribute them by createdAt month (ledgerCohortMonth fallback).
    // Cohort filtering happens in buildCenterMonths, which drops any whose createdAt month is outside
    // the window, so fetching all of them here is safe.
    const orphanSnap = await this.db
      .collection('course_fee_ledgers')
      .where('termStart', '==', '')
      .limit(MAX_REPORT_DOCS_PER_COLLECTION + 1)
      .get();
    collect(orphanSnap.docs);

    // Also recover incomplete course ledgers with a start date but no end date. Their fallback
    // behavior remains start-month-only until the source class dates are repaired.
    const missingEndSnap = await this.db
      .collection('course_fee_ledgers')
      .where('termEnd', '==', '')
      .limit(MAX_REPORT_DOCS_PER_COLLECTION + 1)
      .get();
    collect(missingEndSnap.docs);

    return [...byId.values()];
  }

  async listStudentsByIds(studentIds: string[]): Promise<FinanceStudentRow[]> {
    const uniqueIds = [...new Set(studentIds.filter(Boolean))];
    const students: FinanceStudentRow[] = [];

    for (let index = 0; index < uniqueIds.length; index += 100) {
      const chunk = uniqueIds.slice(index, index + 100);
      const refs = chunk.map((id) => this.db.collection('students').doc(id));
      const snapshots = await this.db.getAll(...refs);
      for (const snapshot of snapshots) {
        if (!snapshot.exists) continue;
        const data = snapshot.data() || {};
        students.push({
          id: snapshot.id,
          name: typeof data.name === 'string' ? data.name : undefined,
          studentId: typeof data.studentId === 'string' ? data.studentId : undefined,
          dob: typeof data.dob === 'string' ? data.dob : undefined,
          contact: typeof data.contact === 'string' ? data.contact : undefined,
          walletBalance: finiteAggregateNumber(data.walletBalance),
        });
      }
    }

    return students;
  }

  async listLedgersByIds(ids: string[]): Promise<FinanceLedgerRow[]> {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    const ledgers: FinanceLedgerRow[] = [];

    for (let index = 0; index < uniqueIds.length; index += 100) {
      const chunk = uniqueIds.slice(index, index + 100);
      const snapshots = await this.db.getAll(
        ...chunk.map((id) => this.db.collection('course_fee_ledgers').doc(id))
      );
      for (const snapshot of snapshots) {
        if (!snapshot.exists) continue;
        const data = snapshot.data() || {};
        ledgers.push({
          ...data,
          id: snapshot.id,
          createdAt: toDateString(data.createdAt),
        } as FinanceLedgerRow);
      }
    }

    return ledgers;
  }

  async listClassesByIds(ids: string[]): Promise<Array<{ id: string; className: string }>> {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    const classes: Array<{ id: string; className: string }> = [];

    for (let index = 0; index < uniqueIds.length; index += 100) {
      const chunk = uniqueIds.slice(index, index + 100);
      const snapshots = await this.db.getAll(
        ...chunk.map((id) => this.db.collection('classes').doc(id))
      );
      for (const snapshot of snapshots) {
        if (!snapshot.exists) continue;
        const data = snapshot.data() || {};
        classes.push({
          id: snapshot.id,
          className:
            (typeof data.name === 'string' && data.name) ||
            (typeof data.className === 'string' && data.className) ||
            '',
        });
      }
    }

    return classes;
  }
}
