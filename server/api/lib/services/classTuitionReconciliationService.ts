import type { DocumentStore } from '@/server/db/documentStore.js';
import {
  isCanonicalTermStart,
  discoverClassCourses,
  resolveCourseTuitionFee,
  toClassReconciliationCourseOption,
  buildClassTuitionReconciliation,
  calculateClassTuitionLedger,
  type ClassReconciliationOptionsResponse,
  type ClassTuitionReconciliationResponse,
  type ClassTuitionStudentDetailResponse,
  type ClassTuitionClassStatus,
  type ClassTuitionEnrollmentStatus,
  type ClassTuitionWarningCode,
} from '../../../../shared/classTuitionReconciliation.js';
import { ClassTuitionReconciliationRepository } from '../repositories/classTuitionReconciliationRepository.js';

export class ClassReconciliationNotFoundError extends Error {
  readonly statusCode = 404;
  readonly errorCode = 'class_reconciliation_not_found';

  constructor(message = 'Class reconciliation resource not found') {
    super(message);
    this.name = 'ClassReconciliationNotFoundError';
  }
}

export class ClassReconciliationInvalidInputError extends Error {
  readonly statusCode = 400;
  readonly errorCode = 'class_reconciliation_invalid_request';

  constructor(message = 'Invalid class reconciliation request input') {
    super(message);
    this.name = 'ClassReconciliationInvalidInputError';
  }
}

const CLASS_STATUS_ORDER: Record<ClassTuitionClassStatus, number> = {
  active: 1,
  paused: 2,
  archived: 3,
};

export async function buildClassReconciliationOptions(
  db: DocumentStore,
  input: { classId?: string }
): Promise<ClassReconciliationOptionsResponse> {
  const repo = new ClassTuitionReconciliationRepository(db);

  if (!input.classId || typeof input.classId !== 'string' || input.classId.trim() === '') {
    const rawClasses = await repo.listClasses();
    const sorted = [...rawClasses].sort((a, b) => {
      const orderA = CLASS_STATUS_ORDER[a.status] ?? 99;
      const orderB = CLASS_STATUS_ORDER[b.status] ?? 99;
      if (orderA !== orderB) return orderA - orderB;

      const nameCmp = a.name.localeCompare(b.name, 'vi', { sensitivity: 'base' });
      if (nameCmp !== 0) return nameCmp;

      return a.id.localeCompare(b.id);
    });

    return {
      success: true,
      mode: 'classes',
      classes: sorted.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        teacherId: c.teacherId,
        teacherName: c.teacherName,
      })),
    };
  }

  const classId = input.classId.trim();
  const [classSource, enrollments, ledgers] = await Promise.all([
    repo.getClass(classId),
    repo.listEnrollmentsByClass(classId),
    repo.listLedgersByClass(classId),
  ]);

  if (!classSource) {
    throw new ClassReconciliationNotFoundError(`Class with ID "${classId}" not found`);
  }

  const discovery = discoverClassCourses({
    classSource,
    enrollments,
    ledgers,
  });

  const courses = discovery.courses.map((course) => {
    const tuitionFee = resolveCourseTuitionFee({
      classSource,
      course,
      ledgers,
    });
    return toClassReconciliationCourseOption(course, tuitionFee);
  });

  return {
    success: true,
    mode: 'courses',
    selectedClass: {
      id: classSource.id,
      name: classSource.name,
      status: classSource.status,
      teacherId: classSource.teacherId,
      teacherName: classSource.teacherName,
    },
    warnings: discovery.warnings,
    courses,
  };
}

export async function buildClassTuitionReconciliationReport(
  db: DocumentStore,
  input: { classId: string; termStart: string }
): Promise<ClassTuitionReconciliationResponse> {
  if (
    !input.classId ||
    typeof input.classId !== 'string' ||
    input.classId.trim() === '' ||
    !isCanonicalTermStart(input.termStart)
  ) {
    throw new ClassReconciliationInvalidInputError('classId and canonical termStart (YYYY-MM-DD) are required');
  }

  const classId = input.classId.trim();
  const termStart = input.termStart;

  const repo = new ClassTuitionReconciliationRepository(db);

  const [classSource, enrollments, ledgers] = await Promise.all([
    repo.getClass(classId),
    repo.listEnrollmentsByCourse(classId, termStart),
    repo.listLedgersByCourse(classId, termStart),
  ]);

  if (!classSource) {
    throw new ClassReconciliationNotFoundError(`Class with ID "${classId}" not found`);
  }

  const discovery = discoverClassCourses({
    classSource,
    enrollments,
    ledgers,
  });

  const matchedCourse = discovery.courses.find((c) => c.termStart === termStart);
  if (!matchedCourse) {
    throw new ClassReconciliationNotFoundError(
      `Course with termStart "${termStart}" not found for class "${classId}"`
    );
  }

  const tuitionFee = resolveCourseTuitionFee({
    classSource,
    course: matchedCourse,
    ledgers,
  });

  const courseOption = toClassReconciliationCourseOption(matchedCourse, tuitionFee);

  const studentIds = new Set<string>();
  for (const e of enrollments) {
    if (typeof e.studentId === 'string' && e.studentId.trim() !== '') {
      studentIds.add(e.studentId.trim());
    }
  }
  for (const l of ledgers) {
    if (typeof l.studentId === 'string' && l.studentId.trim() !== '') {
      studentIds.add(l.studentId.trim());
    }
  }

  const students = await repo.listStudentsByIds(Array.from(studentIds));

  return buildClassTuitionReconciliation({
    classId,
    className: classSource.name,
    course: courseOption,
    enrollments,
    ledgers,
    students,
  });
}

const VALID_STATUS_SET = new Set<ClassTuitionEnrollmentStatus>([
  'trial',
  'active',
  'on_leave',
  'completed',
  'transferred',
  'dropped',
]);

export async function buildClassTuitionStudentDetail(
  db: DocumentStore,
  input: {
    classId: string;
    termStart: string;
    studentId?: string;
    ledgerId?: string;
  }
): Promise<ClassTuitionStudentDetailResponse> {
  if (
    !input.classId ||
    typeof input.classId !== 'string' ||
    input.classId.trim() === '' ||
    !isCanonicalTermStart(input.termStart)
  ) {
    throw new ClassReconciliationInvalidInputError(
      'classId and canonical termStart (YYYY-MM-DD) are required'
    );
  }

  const classId = input.classId.trim();
  const termStart = input.termStart;
  const hasStudentId = typeof input.studentId === 'string' && input.studentId.trim() !== '';
  const hasLedgerId = typeof input.ledgerId === 'string' && input.ledgerId.trim() !== '';

  if (hasStudentId === hasLedgerId) {
    throw new ClassReconciliationInvalidInputError(
      'Exactly one of studentId or ledgerId must be provided'
    );
  }

  const repo = new ClassTuitionReconciliationRepository(db);

  let student: { id: string | null; fullName: string; studentCode: string; recordFound: boolean };
  let studentEnrollments: any[] = [];
  let studentLedgers: any[] = [];
  let receipts: any[] = [];

  if (hasStudentId) {
    const studentId = input.studentId!.trim();
    const [scopedEnrollments, scopedLedgers] = await Promise.all([
      repo.listEnrollmentsByCourse(classId, termStart),
      repo.listLedgersByCourse(classId, termStart),
    ]);

    studentEnrollments = scopedEnrollments.filter(
      (e) => typeof e.studentId === 'string' && e.studentId.trim() === studentId
    );
    studentLedgers = scopedLedgers.filter(
      (l) => typeof l.studentId === 'string' && l.studentId.trim() === studentId
    );

    if (studentEnrollments.length === 0 && studentLedgers.length === 0) {
      throw new ClassReconciliationNotFoundError(
        `Student "${studentId}" not found in course scope "${classId}:${termStart}"`
      );
    }

    const [students, fetchedReceipts] = await Promise.all([
      repo.listStudentsByIds([studentId]),
      repo.listPostedReceiptsByStudent(studentId),
    ]);

    const studentDoc = students[0];
    student = {
      id: studentId,
      fullName: studentDoc?.fullName || '',
      studentCode: studentDoc?.studentCode || '',
      recordFound: !!studentDoc,
    };
    receipts = fetchedReceipts;
  } else {
    const ledgerId = input.ledgerId!.trim();
    const ledgerDoc = await repo.getLedger(ledgerId);

    if (
      !ledgerDoc ||
      ledgerDoc.classId !== classId ||
      ledgerDoc.termStart !== termStart
    ) {
      throw new ClassReconciliationNotFoundError(
        `Ledger "${ledgerId}" not found in scope "${classId}:${termStart}"`
      );
    }

    if (typeof ledgerDoc.studentId === 'string' && ledgerDoc.studentId.trim() !== '') {
      const studentId = ledgerDoc.studentId.trim();
      const [scopedEnrollments, scopedLedgers] = await Promise.all([
        repo.listEnrollmentsByCourse(classId, termStart),
        repo.listLedgersByCourse(classId, termStart),
      ]);

      studentEnrollments = scopedEnrollments.filter(
        (e) => typeof e.studentId === 'string' && e.studentId.trim() === studentId
      );
      studentLedgers = scopedLedgers.filter(
        (l) => typeof l.studentId === 'string' && l.studentId.trim() === studentId
      );

      const [students, fetchedReceipts] = await Promise.all([
        repo.listStudentsByIds([studentId]),
        repo.listPostedReceiptsByStudent(studentId),
      ]);

      const studentDoc = students[0];
      student = {
        id: studentId,
        fullName: studentDoc?.fullName || '',
        studentCode: studentDoc?.studentCode || '',
        recordFound: !!studentDoc,
      };
      receipts = fetchedReceipts;
    } else {
      // Orphan ledger
      student = {
        id: null,
        fullName: '',
        studentCode: '',
        recordFound: false,
      };
      studentEnrollments = [];
      studentLedgers = [ledgerDoc];
      receipts = await repo.listPostedReceiptsByClass(classId);
    }
  }

  // Parse allocations from posted receipts
  const scopedLedgerIds = new Set(studentLedgers.map((l) => l.id));
  const allocations: ClassTuitionStudentDetailResponse['allocations'] = [];

  for (const r of receipts) {
    if (r.status !== 'posted') continue;

    if (Array.isArray(r.allocations) && r.allocations.length > 0) {
      for (const alloc of r.allocations) {
        if (typeof alloc?.ledgerId === 'string' && scopedLedgerIds.has(alloc.ledgerId)) {
          const allocatedAmount =
            typeof alloc.amount === 'number' && Number.isFinite(alloc.amount)
              ? alloc.amount
              : 0;
          const discountAmount =
            typeof alloc.discountAmount === 'number' &&
            Number.isFinite(alloc.discountAmount)
              ? alloc.discountAmount
              : 0;
          const rawDiscountType = alloc.discountType ?? r.discountType ?? null;
          const discountType =
            typeof rawDiscountType === 'string' && rawDiscountType.trim() !== ''
              ? rawDiscountType.trim()
              : null;

          allocations.push({
            receiptId: r.id,
            receiptNo: typeof r.receiptNo === 'string' ? r.receiptNo : '',
            receivedDate: typeof r.receivedDate === 'string' ? r.receivedDate : '',
            paymentMethod: typeof r.paymentMethod === 'string' ? r.paymentMethod : '',
            allocatedAmount,
            discountAmount,
            discountType,
            note: typeof r.note === 'string' ? r.note : '',
          });
        }
      }
    } else if (typeof r.ledgerId === 'string' && scopedLedgerIds.has(r.ledgerId)) {
      const allocatedAmount =
        typeof r.amountReceived === 'number' && Number.isFinite(r.amountReceived)
          ? r.amountReceived
          : 0;
      const discountAmount =
        typeof r.discountAmount === 'number' && Number.isFinite(r.discountAmount)
          ? r.discountAmount
          : 0;
      const rawDiscountType = r.discountType ?? null;
      const discountType =
        typeof rawDiscountType === 'string' && rawDiscountType.trim() !== ''
          ? rawDiscountType.trim()
          : null;

      allocations.push({
        receiptId: r.id,
        receiptNo: typeof r.receiptNo === 'string' ? r.receiptNo : '',
        receivedDate: typeof r.receivedDate === 'string' ? r.receivedDate : '',
        paymentMethod: typeof r.paymentMethod === 'string' ? r.paymentMethod : '',
        allocatedAmount,
        discountAmount,
        discountType,
        note: typeof r.note === 'string' ? r.note : '',
      });
    }
  }

  // Sort allocations: receivedDate desc -> receiptNo asc -> receiptId asc
  allocations.sort((a, b) => {
    const dateCmp = b.receivedDate.localeCompare(a.receivedDate);
    if (dateCmp !== 0) return dateCmp;
    const noCmp = a.receiptNo.localeCompare(b.receiptNo);
    if (noCmp !== 0) return noCmp;
    return a.receiptId.localeCompare(b.receiptId);
  });

  // Map enrollments
  const mappedEnrollments = studentEnrollments
    .map((e) => ({
      id: e.id,
      status:
        typeof e.status === 'string' && VALID_STATUS_SET.has(e.status as any)
          ? (e.status as ClassTuitionEnrollmentStatus)
          : ('active' as ClassTuitionEnrollmentStatus),
      joinedAt: typeof e.joinedAt === 'string' && e.joinedAt !== '' ? e.joinedAt : termStart,
      endedAt: typeof e.endedAt === 'string' && e.endedAt !== '' ? e.endedAt : null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  // Map ledgers and warnings
  const warnings = new Set<ClassTuitionWarningCode>();
  if (student.id && !student.recordFound) warnings.add('student_record_missing');
  if (!student.id) warnings.add('ledger_student_missing');
  if (studentEnrollments.length > 1) warnings.add('duplicate_enrollment');
  if (studentLedgers.length > 1) warnings.add('duplicate_ledger');
  if (studentLedgers.length === 0) warnings.add('missing_ledger');
  if (studentLedgers.length > 0 && studentEnrollments.length === 0) {
    warnings.add('ledger_without_enrollment');
  }

  let totalOverpaid = 0;
  const mappedLedgers = studentLedgers
    .map((l) => {
      const m = calculateClassTuitionLedger(l);
      for (const w of m.warnings) warnings.add(w);
      if (m.overpaid !== null && m.overpaid > 0) totalOverpaid += m.overpaid;
      return {
        id: l.id,
        gross: m.gross,
        reduction: m.reduction,
        netDue: m.netDue,
        paid: m.paid,
        outstanding: m.outstanding,
        overpaid: m.overpaid,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  if (totalOverpaid > 0) warnings.add('overpaid');

  let workspaceUrl: string | null = null;
  if (student.id) {
    const params = new URLSearchParams({
      tab: 'students',
      studentLifecycleScope: 'all',
      studentClassId: classId,
      studentExpandedId: student.id,
    });
    workspaceUrl = `/tuition?${params.toString()}`;
  }

  return {
    success: true,
    scope: {
      classId,
      termStart,
      studentId: hasStudentId ? input.studentId!.trim() : null,
      ledgerId: hasLedgerId ? input.ledgerId!.trim() : null,
    },
    student,
    enrollments: mappedEnrollments,
    ledgers: mappedLedgers,
    allocations,
    warnings: Array.from(warnings),
    workspaceUrl,
  };
}
