import type { DocumentStore } from '@/server/db/documentStore.js';
import type {
  ClassTuitionClassSource,
  ClassTuitionEnrollmentSource,
  ClassTuitionLedgerSource,
  ClassTuitionReceiptSource,
  ClassTuitionStudentSource,
} from '../../../../shared/classTuitionReconciliation.js';

export const MAX_CLASS_RECONCILIATION_DOCS = 5000;
export const MAX_CLASS_RECONCILIATION_RECEIPTS = 500;
export const MAX_CLASS_RECONCILIATION_CLASS_RECEIPTS = 5000;

export class ClassReconciliationTooLargeError extends Error {
  readonly statusCode = 413;
  readonly errorCode = 'class_reconciliation_too_large';
  readonly limit: number;
  readonly collectionName: string;

  constructor(limit: number, collectionName: string) {
    super(`Query exceeded maximum document limit of ${limit} for collection ${collectionName}`);
    this.name = 'ClassReconciliationTooLargeError';
    this.limit = limit;
    this.collectionName = collectionName;
  }
}

const TEACHER_LOOKUP_CHUNK_SIZE = 100;

export class ClassTuitionReconciliationRepository {
  constructor(private readonly db: DocumentStore) {}

  /**
   * Resolves user ids to display names in chunks, mirroring
   * financeRepository.getClassReportContext. Ids with no surviving user doc are
   * simply absent from the map, so callers fall back to an empty name.
   */
  private async resolveTeacherNames(teacherIds: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    const uniqueIds = [...new Set(teacherIds.filter(Boolean))];

    for (let index = 0; index < uniqueIds.length; index += TEACHER_LOOKUP_CHUNK_SIZE) {
      const chunk = uniqueIds.slice(index, index + TEACHER_LOOKUP_CHUNK_SIZE);
      const snapshots = await this.db.getAll(
        ...chunk.map((id) => this.db.collection('users').doc(id))
      );
      for (const snapshot of snapshots) {
        if (!snapshot.exists) continue;
        const data = (snapshot.data?.() || {}) as Record<string, unknown>;
        const name =
          (typeof data.displayName === 'string' && data.displayName) ||
          (typeof data.name === 'string' && data.name) ||
          (typeof data.email === 'string' && data.email) ||
          '';
        names.set(snapshot.id, name);
      }
    }

    return names;
  }

  async listClasses(): Promise<ClassTuitionClassSource[]> {
    const snap = await this.db.collection('classes').get();
    const result: ClassTuitionClassSource[] = [];
    for (const doc of snap.docs) {
      const data = (doc.data?.() || {}) as Record<string, unknown>;
      const status = data.status;
      if (status === 'active' || status === 'paused' || status === 'archived') {
        result.push({
          id: doc.id,
          name: typeof data.name === 'string' ? data.name : '',
          status,
          teacherId: typeof data.teacherId === 'string' ? data.teacherId : '',
          teacherName: '',
          currentCourseId: data.currentCourseId,
          startDate: data.startDate,
          endDate: data.endDate,
          tuitionFee: data.tuitionFee,
          terms: Array.isArray(data.terms)
            ? data.terms.map((t: any) => ({
                id: String(t?.id || ''),
                name: String(t?.name || ''),
                startDate: t?.startDate,
                endDate: t?.endDate,
                courseId: t?.courseId,
                tuitionFee: t?.tuitionFee,
              }))
            : [],
        });
      }
    }

    const teacherNames = await this.resolveTeacherNames(result.map((row) => row.teacherId));
    for (const row of result) row.teacherName = teacherNames.get(row.teacherId) || '';

    return result;
  }

  async getClass(classId: string): Promise<ClassTuitionClassSource | null> {
    const snap = await this.db.collection('classes').doc(classId).get();
    if (!snap.exists) return null;
    const data = (snap.data?.() || {}) as Record<string, unknown>;
    const status = data.status;
    const teacherId = typeof data.teacherId === 'string' ? data.teacherId : '';
    const teacherNames = await this.resolveTeacherNames([teacherId]);

    return {
      id: snap.id,
      name: typeof data.name === 'string' ? data.name : '',
      status:
        status === 'active' || status === 'paused' || status === 'archived'
          ? status
          : 'active',
      teacherId,
      teacherName: teacherNames.get(teacherId) || '',
      currentCourseId: data.currentCourseId,
      startDate: data.startDate,
      endDate: data.endDate,
      tuitionFee: data.tuitionFee,
      terms: Array.isArray(data.terms)
        ? data.terms.map((t: any) => ({
            id: String(t?.id || ''),
            name: String(t?.name || ''),
            startDate: t?.startDate,
            endDate: t?.endDate,
            courseId: t?.courseId,
            tuitionFee: t?.tuitionFee,
          }))
        : [],
    };
  }

  async listEnrollmentsByClass(
    classId: string
  ): Promise<ClassTuitionEnrollmentSource[]> {
    const snap = await this.db
      .collection('student_course_enrollments')
      .where('classId', '==', classId)
      .limit(MAX_CLASS_RECONCILIATION_DOCS + 1)
      .get();

    if (snap.size > MAX_CLASS_RECONCILIATION_DOCS) {
      throw new ClassReconciliationTooLargeError(
        MAX_CLASS_RECONCILIATION_DOCS,
        'student_course_enrollments'
      );
    }

    return snap.docs.map((doc) => {
      const d = (doc.data?.() || {}) as Record<string, unknown>;
      return {
        id: doc.id,
        classId: d.classId,
        studentId: d.studentId,
        courseId: d.courseId,
        termStart: d.termStart,
        termEnd: d.termEnd,
        label: d.label,
        status: d.status,
        joinedAt: d.joinedAt,
        endedAt: d.endedAt,
      };
    });
  }

  async listLedgersByClass(
    classId: string
  ): Promise<ClassTuitionLedgerSource[]> {
    const snap = await this.db
      .collection('course_fee_ledgers')
      .where('classId', '==', classId)
      .limit(MAX_CLASS_RECONCILIATION_DOCS + 1)
      .get();

    if (snap.size > MAX_CLASS_RECONCILIATION_DOCS) {
      throw new ClassReconciliationTooLargeError(
        MAX_CLASS_RECONCILIATION_DOCS,
        'course_fee_ledgers'
      );
    }

    return snap.docs.map((doc) => {
      const d = (doc.data?.() || {}) as Record<string, unknown>;
      return {
        id: doc.id,
        classId: d.classId,
        studentId: d.studentId,
        courseId: d.courseId,
        termStart: d.termStart,
        termEnd: d.termEnd,
        termLabel: d.termLabel,
        amount: d.amount,
        discountTotal: d.discountTotal,
        paidTotal: d.paidTotal,
      };
    });
  }

  async listEnrollmentsByCourse(
    classId: string,
    termStart: string
  ): Promise<ClassTuitionEnrollmentSource[]> {
    const snap = await this.db
      .collection('student_course_enrollments')
      .where('classId', '==', classId)
      .where('termStart', '==', termStart)
      .limit(MAX_CLASS_RECONCILIATION_DOCS + 1)
      .get();

    if (snap.size > MAX_CLASS_RECONCILIATION_DOCS) {
      throw new ClassReconciliationTooLargeError(
        MAX_CLASS_RECONCILIATION_DOCS,
        'student_course_enrollments'
      );
    }

    return snap.docs.map((doc) => {
      const d = (doc.data?.() || {}) as Record<string, unknown>;
      return {
        id: doc.id,
        classId: d.classId,
        studentId: d.studentId,
        courseId: d.courseId,
        termStart: d.termStart,
        termEnd: d.termEnd,
        label: d.label,
        status: d.status,
        joinedAt: d.joinedAt,
        endedAt: d.endedAt,
      };
    });
  }

  async listLedgersByCourse(
    classId: string,
    termStart: string
  ): Promise<ClassTuitionLedgerSource[]> {
    const snap = await this.db
      .collection('course_fee_ledgers')
      .where('classId', '==', classId)
      .where('termStart', '==', termStart)
      .limit(MAX_CLASS_RECONCILIATION_DOCS + 1)
      .get();

    if (snap.size > MAX_CLASS_RECONCILIATION_DOCS) {
      throw new ClassReconciliationTooLargeError(
        MAX_CLASS_RECONCILIATION_DOCS,
        'course_fee_ledgers'
      );
    }

    return snap.docs.map((doc) => {
      const d = (doc.data?.() || {}) as Record<string, unknown>;
      return {
        id: doc.id,
        classId: d.classId,
        studentId: d.studentId,
        courseId: d.courseId,
        termStart: d.termStart,
        termEnd: d.termEnd,
        termLabel: d.termLabel,
        amount: d.amount,
        discountTotal: d.discountTotal,
        paidTotal: d.paidTotal,
      };
    });
  }

  async listStudentsByIds(
    studentIds: string[]
  ): Promise<ClassTuitionStudentSource[]> {
    if (studentIds.length === 0) return [];
    const uniqueIds = Array.from(new Set(studentIds));
    const chunks: string[][] = [];
    for (let i = 0; i < uniqueIds.length; i += 100) {
      chunks.push(uniqueIds.slice(i, i + 100));
    }

    const students: ClassTuitionStudentSource[] = [];
    for (const chunk of chunks) {
      const refs = chunk.map((id) => this.db.collection('students').doc(id));
      const snaps = await this.db.getAll(...refs);
      for (const snap of snaps) {
        if (snap.exists) {
          const d = (snap.data?.() || {}) as Record<string, unknown>;
          students.push({
            id: snap.id,
            fullName: typeof d.name === 'string' ? d.name : '',
            studentCode: typeof d.studentId === 'string' ? d.studentId : '',
          });
        }
      }
    }
    return students;
  }

  async getLedger(ledgerId: string): Promise<ClassTuitionLedgerSource | null> {
    const snap = await this.db.collection('course_fee_ledgers').doc(ledgerId).get();
    if (!snap.exists) return null;
    const d = (snap.data?.() || {}) as Record<string, unknown>;
    return {
      id: snap.id,
      classId: d.classId,
      studentId: d.studentId,
      courseId: d.courseId,
      termStart: d.termStart,
      termEnd: d.termEnd,
      termLabel: d.termLabel,
      amount: d.amount,
      discountTotal: d.discountTotal,
      paidTotal: d.paidTotal,
    };
  }

  async listPostedReceiptsByStudent(
    studentId: string
  ): Promise<ClassTuitionReceiptSource[]> {
    const snap = await this.db
      .collection('receipts')
      .where('studentId', '==', studentId)
      .where('status', '==', 'posted')
      .limit(MAX_CLASS_RECONCILIATION_RECEIPTS + 1)
      .get();

    if (snap.size > MAX_CLASS_RECONCILIATION_RECEIPTS) {
      throw new ClassReconciliationTooLargeError(
        MAX_CLASS_RECONCILIATION_RECEIPTS,
        'receipts'
      );
    }

    return snap.docs.map((doc) => {
      const d = (doc.data?.() || {}) as Record<string, unknown>;
      return {
        id: doc.id,
        receiptNo: d.receiptNo,
        studentId: d.studentId,
        classId: d.classId,
        classIds: d.classIds,
        ledgerId: d.ledgerId,
        amountReceived: d.amountReceived,
        discountAmount: d.discountAmount,
        discountType: d.discountType,
        paymentMethod: d.paymentMethod,
        receivedDate: d.receivedDate,
        note: d.note,
        walletDeposit: d.walletDeposit,
        status: d.status,
        allocations: d.allocations,
      };
    });
  }

  async listPostedReceiptsByClass(
    classId: string
  ): Promise<ClassTuitionReceiptSource[]> {
    const baseQuery = this.db
      .collection('receipts')
      .where('classIds', 'array-contains', classId)
      .where('status', '==', 'posted')
      .orderBy('createdAt', 'desc')
      .limit(500);

    const allDocs: any[] = [];
    let lastDoc: any = null;

    while (true) {
      const currentQuery =
        lastDoc && typeof baseQuery.startAfter === 'function'
          ? baseQuery.startAfter(lastDoc)
          : baseQuery;

      const snap = await currentQuery.get();
      if (!snap || snap.empty || snap.docs.length === 0) {
        break;
      }

      allDocs.push(...snap.docs);
      if (allDocs.length > MAX_CLASS_RECONCILIATION_CLASS_RECEIPTS) {
        throw new ClassReconciliationTooLargeError(
          MAX_CLASS_RECONCILIATION_CLASS_RECEIPTS,
          'receipts'
        );
      }

      if (snap.docs.length < 500) {
        break;
      }
      lastDoc = snap.docs[snap.docs.length - 1];
    }

    return allDocs.map((doc) => {
      const d = (doc.data?.() || {}) as Record<string, unknown>;
      return {
        id: doc.id,
        receiptNo: d.receiptNo,
        studentId: d.studentId,
        classId: d.classId,
        classIds: d.classIds,
        ledgerId: d.ledgerId,
        amountReceived: d.amountReceived,
        discountAmount: d.discountAmount,
        discountType: d.discountType,
        paymentMethod: d.paymentMethod,
        receivedDate: d.receivedDate,
        note: d.note,
        walletDeposit: d.walletDeposit,
        status: d.status,
        allocations: d.allocations,
      };
    });
  }
}
